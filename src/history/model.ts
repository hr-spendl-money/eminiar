import type { ProjectContext } from "../context.js";
import { indexContent } from "../index/indexer.js";
import type { StorageAdapter } from "../storage/adapter.js";
import {
  BUCKETS,
  bucketOf,
  type CommitKind,
  classifyCommit,
  KINDS,
  type KindBucket,
  sizeOf,
} from "./classify.js";
import {
  aheadBehind,
  type BranchRef,
  type CommitFile,
  currentBranch,
  defaultBranch,
  headSha,
  isGitRepo,
  mergedInto,
  reachable,
  readBranches,
  readCommits,
  readTags,
  refsFingerprint,
  type TagRef,
  workingTreeFiles,
} from "./log.js";
import { type BugLink, traceFixOrigins } from "./szz.js";

const DAY = 86_400_000;
const TEST_PATH =
  /(^|\/)(tests?|__tests__|spec|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py)$/;
const CODE_PATH = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|c|cc|cpp|h|hpp|cs|swift)$/i;

export interface HistoryCommit {
  sha: string;
  short: string;
  parents: string[];
  merge: boolean;
  /** Reachable from HEAD (false for commits only on other branches). */
  onHead: boolean;
  author: string;
  email: string;
  at: number;
  subject: string;
  body: string;
  refs: string[];
  tags: string[];
  files: CommitFile[];
  kind: CommitKind;
  bucket: KindBucket;
  scope?: string | undefined;
  breaking: boolean;
  issues: string[];
  pr?: number | undefined;
  revertOf?: string | undefined;
  revertedBy?: string | undefined;
  added: number;
  deleted: number;
  size: "xs" | "s" | "m" | "l" | "xl";
  /** Fix commits whose removed lines trace back to this commit. */
  blamedBy: string[];
  /** For fixes: the commits whose lines this fix removed. */
  origins: string[];
  touchesTests: boolean;
  /** 0–1: how much attention this change deserves in hindsight, with the reasons. */
  risk: number;
  riskReasons: string[];
}

export interface FileHistory {
  path: string;
  commits: number;
  fixes: number;
  feats: number;
  refactors: number;
  reverts: number;
  firstAt: number;
  lastAt: number;
  authors: Record<string, number>;
  added: number;
  deleted: number;
  /** Fix commits that traced removed lines to an earlier change of this file. */
  bugOrigins: number;
  /** Fixes that landed within 7 days of a non-fix change to the file. */
  quickFixes: number;
  commits90d: number;
  /** Commits per month, oldest → newest, last 12 months. */
  months: number[];
  risk: number;
  reasons: string[];
  renamedFrom?: string | undefined;
}

export interface BranchInfo extends BranchRef {
  ahead: number;
  behind: number;
  merged: boolean;
  isDefault: boolean;
  lastAuthor?: string | undefined;
  lastSubject?: string | undefined;
}

export interface AuthorStats {
  name: string;
  commits: number;
  fixes: number;
  files: number;
  firstAt: number;
  lastAt: number;
  added: number;
  deleted: number;
}

export interface WeekBucket {
  /** Monday of the week, YYYY-MM-DD. */
  week: string;
  at: number;
  total: number;
  byBucket: Record<KindBucket, number>;
  added: number;
  deleted: number;
}

export interface HistoryModel {
  root: string;
  head: string;
  branch?: string | undefined;
  base?: string | undefined;
  builtAt: number;
  range: { from: number; to: number };
  commits: HistoryCommit[];
  bySha: Map<string, HistoryCommit>;
  files: Map<string, FileHistory>;
  authors: AuthorStats[];
  branches: BranchInfo[];
  tags: TagRef[];
  weeks: WeekBucket[];
  kinds: Record<CommitKind, number>;
  links: BugLink[];
  lessons: string[];
  stats: {
    commits: number;
    onHead: number;
    fixes: number;
    reverts: number;
    merges: number;
    authors: number;
    files: number;
    fixesTraced: number;
    linksTraced: number;
    tracePending: number;
  };
}

export interface BuildOptions {
  maxCommits?: number | undefined;
  /** Blame calls allowed for untraced fixes this build (the rest are picked up next time). */
  traceBudget?: number | undefined;
  /** Skip the fix-origin trace entirely. */
  trace?: boolean | undefined;
}

// --- cache ---------------------------------------------------------------------------

const cache = new Map<string, { key: string; model: HistoryModel }>();

export function invalidateHistory(root?: string): void {
  if (root) cache.delete(root);
  else cache.clear();
}

/**
 * The project's history model, rebuilt when HEAD or any ref moves. Analysis results
 * that depend only on immutable commits (fix-origin traces, indexed messages) are kept
 * in the project database so a rebuild costs one `git log` and a few ref listings.
 */
export function getHistory(
  ctx: ProjectContext,
  db: StorageAdapter,
  opts: BuildOptions & { refresh?: boolean | undefined } = {},
): HistoryModel | undefined {
  if (!isGitRepo(ctx.root)) return undefined;
  const head = headSha(ctx.root);
  if (!head) return undefined;
  const key = `${head}:${refsFingerprint(ctx.root)}:${opts.maxCommits ?? ctx.config.git.maxCommits}`;
  const hit = cache.get(ctx.root);
  if (hit && hit.key === key && !opts.refresh && !hit.model.stats.tracePending) return hit.model;
  const model = buildHistory(ctx, db, opts);
  if (model) cache.set(ctx.root, { key, model });
  return model;
}

// --- build ---------------------------------------------------------------------------

export function buildHistory(
  ctx: ProjectContext,
  db: StorageAdapter,
  opts: BuildOptions = {},
): HistoryModel | undefined {
  const root = ctx.root;
  if (!isGitRepo(root)) return undefined;
  const head = headSha(root);
  if (!head) return undefined;
  const maxCommits = opts.maxCommits ?? ctx.config.git.maxCommits;
  const raw = readCommits(root, { maxCommits, all: true });
  if (!raw.length) return undefined;
  const onHead = reachable(root, "HEAD", maxCommits);
  const tags = readTags(root);
  const tagsBySha = new Map<string, string[]>();
  for (const t of tags) tagsBySha.set(t.sha, [...(tagsBySha.get(t.sha) ?? []), t.name]);

  const commits: HistoryCommit[] = raw.map((c) => {
    const merge = c.parents.length > 1;
    const cls = classifyCommit(c.subject, c.body, { merge, files: c.files });
    const added = c.files.reduce((a, f) => a + f.added, 0);
    const deleted = c.files.reduce((a, f) => a + f.deleted, 0);
    return {
      sha: c.sha,
      short: c.sha.slice(0, 7),
      parents: c.parents,
      merge,
      onHead: onHead.has(c.sha),
      author: c.author,
      email: c.email,
      at: c.at,
      subject: c.subject,
      body: c.body,
      refs: c.refs,
      tags: tagsBySha.get(c.sha) ?? [],
      files: c.files,
      kind: cls.kind,
      bucket: bucketOf(cls.kind),
      scope: cls.scope,
      breaking: cls.breaking,
      issues: cls.issues,
      pr: cls.pr,
      revertOf: cls.revertOf,
      added,
      deleted,
      size: sizeOf(added + deleted),
      blamedBy: [],
      origins: [],
      touchesTests: c.files.some((f) => TEST_PATH.test(f.path)),
      risk: 0,
      riskReasons: [],
    };
  });
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  const resolve = (prefix: string): HistoryCommit | undefined => {
    if (bySha.has(prefix)) return bySha.get(prefix);
    for (const c of commits) if (c.sha.startsWith(prefix)) return c;
    return undefined;
  };

  // Reverts link directly to what they undo.
  for (const c of commits) {
    if (c.kind !== "revert" || !c.revertOf) continue;
    const target = resolve(c.revertOf);
    if (target) {
      target.revertedBy = c.sha;
      c.origins.push(target.sha);
    }
  }

  // Fix-origin trace (SZZ), cached per fix sha: a commit's diff never changes.
  const links: BugLink[] = [];
  let fixesTraced = 0;
  let tracePending = 0;
  if (opts.trace !== false) {
    const budget = { blames: opts.traceBudget ?? 120 };
    const fixes = commits.filter((c) => c.kind === "fix" && !c.merge && c.files.length);
    for (const f of fixes) {
      const cached = db.metaGet(`szz:${f.sha}`);
      let own: BugLink[];
      if (cached !== undefined) {
        own = JSON.parse(cached) as BugLink[];
      } else if (budget.blames > 0) {
        own = traceFixOrigins(root, f, { budget });
        db.metaSet(`szz:${f.sha}`, JSON.stringify(own));
      } else {
        tracePending++;
        continue;
      }
      fixesTraced++;
      for (const l of own) {
        links.push(l);
        const origin = bySha.get(l.origin);
        if (origin && !origin.blamedBy.includes(f.sha)) origin.blamedBy.push(f.sha);
        if (!f.origins.includes(l.origin)) f.origins.push(l.origin);
      }
    }
  }

  // Files.
  const files = new Map<string, FileHistory>();
  const now = Date.now();
  const monthIndex = (at: number): number => {
    const d = new Date(at);
    const n = new Date(now);
    return (
      11 - ((n.getUTCFullYear() - d.getUTCFullYear()) * 12 + (n.getUTCMonth() - d.getUTCMonth()))
    );
  };
  const ascending = [...commits].filter((c) => !c.merge).sort((a, b) => a.at - b.at);
  const lastNonFix = new Map<string, number>();
  for (const c of ascending) {
    for (const f of c.files) {
      const h = files.get(f.path) ?? {
        path: f.path,
        commits: 0,
        fixes: 0,
        feats: 0,
        refactors: 0,
        reverts: 0,
        firstAt: c.at,
        lastAt: c.at,
        authors: {},
        added: 0,
        deleted: 0,
        bugOrigins: 0,
        quickFixes: 0,
        commits90d: 0,
        months: new Array(12).fill(0) as number[],
        risk: 0,
        reasons: [],
        renamedFrom: f.renamedFrom,
      };
      h.commits++;
      h.lastAt = Math.max(h.lastAt, c.at);
      h.firstAt = Math.min(h.firstAt, c.at);
      h.added += f.added;
      h.deleted += f.deleted;
      h.authors[c.author] = (h.authors[c.author] ?? 0) + 1;
      if (now - c.at < 90 * DAY) h.commits90d++;
      const mi = monthIndex(c.at);
      if (mi >= 0 && mi < 12) h.months[mi] = (h.months[mi] ?? 0) + 1;
      if (c.kind === "fix") {
        h.fixes++;
        const prev = lastNonFix.get(f.path);
        if (prev !== undefined && c.at - prev < 7 * DAY) h.quickFixes++;
      } else if (c.kind === "feat") h.feats++;
      else if (c.kind === "refactor") h.refactors++;
      else if (c.kind === "revert") h.reverts++;
      if (c.kind !== "fix" && c.kind !== "revert") lastNonFix.set(f.path, c.at);
      files.set(f.path, h);
    }
  }
  for (const l of links) {
    const h = files.get(l.path);
    if (h) h.bugOrigins++;
  }
  for (const h of files.values()) scoreFile(h);

  // Commit risk: size, spread, hotspots, hindsight.
  const hot = new Map<string, number>();
  for (const m of db.metricsTop({ kind: "file", limit: 60 }))
    if (m.path && m.score >= 0.6) hot.set(m.path, m.score);
  for (const c of commits) scoreCommit(c, hot, bySha);

  // Branches.
  const branchRefs = readBranches(root);
  const base = defaultBranch(root, branchRefs);
  const merged = base ? mergedInto(root, base) : new Set<string>();
  const branches: BranchInfo[] = branchRefs
    .sort((a, b) => b.at - a.at)
    .map((b, i) => {
      const tip = bySha.get(b.sha);
      const ab =
        base && b.name !== base && i < 60
          ? aheadBehind(root, base, b.name)
          : { ahead: 0, behind: 0 };
      return {
        ...b,
        ...ab,
        merged: b.name === base || merged.has(b.name),
        isDefault: b.name === base,
        lastAuthor: tip?.author,
        lastSubject: tip?.subject,
      };
    });

  // Authors, weeks, kinds.
  const authorMap = new Map<string, AuthorStats & { fileSet: Set<string> }>();
  for (const c of commits) {
    if (c.merge) continue;
    const a = authorMap.get(c.author) ?? {
      name: c.author,
      commits: 0,
      fixes: 0,
      files: 0,
      firstAt: c.at,
      lastAt: c.at,
      added: 0,
      deleted: 0,
      fileSet: new Set<string>(),
    };
    a.commits++;
    if (c.kind === "fix") a.fixes++;
    a.firstAt = Math.min(a.firstAt, c.at);
    a.lastAt = Math.max(a.lastAt, c.at);
    a.added += c.added;
    a.deleted += c.deleted;
    for (const f of c.files) a.fileSet.add(f.path);
    authorMap.set(c.author, a);
  }
  const authors: AuthorStats[] = [...authorMap.values()]
    .map(({ fileSet, ...a }) => ({ ...a, files: fileSet.size }))
    .sort((x, y) => y.commits - x.commits);

  const weekMap = new Map<string, WeekBucket>();
  for (const c of commits) {
    const monday = startOfWeek(c.at);
    const key = new Date(monday).toISOString().slice(0, 10);
    const w = weekMap.get(key) ?? {
      week: key,
      at: monday,
      total: 0,
      byBucket: Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<KindBucket, number>,
      added: 0,
      deleted: 0,
    };
    w.total++;
    w.byBucket[c.bucket]++;
    w.added += c.added;
    w.deleted += c.deleted;
    weekMap.set(key, w);
  }
  const weeks = [...weekMap.values()].sort((a, b) => a.at - b.at);
  // Fill silent weeks so the chart has a continuous axis.
  if (weeks.length) {
    const filled: WeekBucket[] = [];
    // At least 16 weeks of axis so a young repository is not one full-width bar.
    let t = Math.min(weeks[0]!.at, startOfWeek(now) - 15 * 7 * DAY);
    const end = weeks[weeks.length - 1]!.at;
    let i = 0;
    while (t <= end && filled.length < 600) {
      const key = new Date(t).toISOString().slice(0, 10);
      if (weeks[i]?.week === key) filled.push(weeks[i++]!);
      else
        filled.push({
          week: key,
          at: t,
          total: 0,
          byBucket: Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<KindBucket, number>,
          added: 0,
          deleted: 0,
        });
      t += 7 * DAY;
    }
    weeks.splice(0, weeks.length, ...filled);
  }
  const kinds = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<CommitKind, number>;
  for (const c of commits) kinds[c.kind]++;

  const model: HistoryModel = {
    root,
    head,
    branch: currentBranch(root),
    base,
    builtAt: now,
    range: {
      from: Math.min(...commits.map((c) => c.at)),
      to: Math.max(...commits.map((c) => c.at)),
    },
    commits,
    bySha,
    files,
    authors,
    branches,
    tags,
    weeks,
    kinds,
    links,
    lessons: [],
    stats: {
      commits: commits.length,
      onHead: commits.filter((c) => c.onHead).length,
      fixes: kinds.fix,
      reverts: kinds.revert,
      merges: kinds.merge,
      authors: authors.length,
      files: files.size,
      fixesTraced,
      linksTraced: links.length,
      tracePending,
    },
  };
  model.lessons = deriveLessons(model);

  indexCommitMessages(db, model);
  writeBriefSummary(db, model);
  return model;
}

// --- scoring -------------------------------------------------------------------------

function scoreFile(h: FileHistory): void {
  const reasons: string[] = [];
  const ratio = h.commits >= 3 ? h.fixes / h.commits : 0;
  if (h.fixes >= 2) reasons.push(`${h.fixes} of ${h.commits} commits were fixes`);
  if (h.bugOrigins)
    reasons.push(
      `${h.bugOrigins} later fix${h.bugOrigins === 1 ? "" : "es"} traced back to changes here`,
    );
  if (h.quickFixes)
    reasons.push(
      `${h.quickFixes} fix${h.quickFixes === 1 ? "" : "es"} landed within a week of a change`,
    );
  if (h.reverts) reasons.push(`reverted ${h.reverts}×`);
  if (h.commits90d >= 5) reasons.push(`${h.commits90d} commits in 90 days`);
  h.risk = Math.min(
    1,
    0.4 * ratio +
      0.25 * Math.min(1, h.bugOrigins / 4) +
      0.15 * Math.min(1, h.quickFixes / 3) +
      0.1 * Math.min(1, h.reverts / 2) +
      0.1 * Math.min(1, h.commits90d / 10),
  );
  h.reasons = reasons;
}

function scoreCommit(
  c: HistoryCommit,
  hot: Map<string, number>,
  bySha: Map<string, HistoryCommit>,
): void {
  if (c.merge) return;
  const reasons: string[] = [];
  let r = 0;
  const changed = c.added + c.deleted;
  if (changed >= 1000) {
    r += 0.3;
    reasons.push(`${changed} lines changed`);
  } else if (changed >= 250) {
    r += 0.15;
    reasons.push(`${changed} lines changed`);
  }
  if (c.files.length >= 15) {
    r += 0.15;
    reasons.push(`${c.files.length} files touched`);
  }
  const hotFiles = c.files.filter((f) => hot.has(f.path)).map((f) => f.path);
  if (hotFiles.length) {
    r += 0.2;
    reasons.push(
      `touches hotspot${hotFiles.length === 1 ? "" : "s"} ${hotFiles.slice(0, 3).join(", ")}`,
    );
  }
  if (c.blamedBy.length) {
    r += Math.min(0.4, 0.2 * c.blamedBy.length);
    reasons.push(
      `${c.blamedBy.length} later fix${c.blamedBy.length === 1 ? "" : "es"} removed lines from this commit (${c.blamedBy
        .slice(0, 3)
        .map((s) => bySha.get(s)?.short ?? s.slice(0, 7))
        .join(", ")})`,
    );
  }
  if (c.revertedBy) {
    r += 0.4;
    reasons.push(`reverted by ${bySha.get(c.revertedBy)?.short ?? c.revertedBy.slice(0, 7)}`);
  }
  if (c.breaking) {
    r += 0.15;
    reasons.push("declared breaking");
  }
  if (
    changed >= 100 &&
    !c.touchesTests &&
    c.files.some((f) => CODE_PATH.test(f.path) && !TEST_PATH.test(f.path))
  ) {
    r += 0.1;
    reasons.push("no tests changed");
  }
  c.risk = Math.min(1, r);
  c.riskReasons = reasons;
}

function startOfWeek(at: number): number {
  const d = new Date(at);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}

/** Project-level patterns worth telling a newcomer (or a model) before they change code. */
export function deriveLessons(m: HistoryModel): string[] {
  const out: string[] = [];
  const risky = [...m.files.values()]
    .filter((f) => f.risk >= 0.2 && f.commits >= 3)
    .sort((a, b) => b.risk - a.risk)
    .slice(0, 5);
  if (risky.length)
    out.push(
      `Bug-prone files (fix density, traced origins, quick fixes): ${risky
        .map((f) => `${f.path} (${f.fixes}/${f.commits} fixes)`)
        .join(", ")}.`,
    );
  if (m.links.length) {
    const byKind = new Map<CommitKind, number>();
    const lead: number[] = [];
    const seen = new Set<string>();
    for (const l of m.links) {
      const key = `${l.fix}:${l.origin}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const o = m.bySha.get(l.origin);
      const f = m.bySha.get(l.fix);
      if (o) byKind.set(o.kind, (byKind.get(o.kind) ?? 0) + 1);
      if (o && f) lead.push((f.at - o.at) / DAY);
    }
    const parts = [...byKind.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k, n]) => `${n} ${k}`);
    if (parts.length)
      out.push(`Fixes traced back to earlier commits by kind: ${parts.join(", ")}.`);
    const med = median(lead);
    if (med !== undefined)
      out.push(
        `Bugs typically surfaced ${med < 1 ? "within a day" : `${Math.round(med)} day${Math.round(med) === 1 ? "" : "s"}`} after the change that caused them (median over ${lead.length} traced pairs).`,
      );
  }
  const reverts = m.commits.filter((c) => c.kind === "revert");
  if (reverts.length)
    out.push(
      `${reverts.length} revert${reverts.length === 1 ? "" : "s"}: ${reverts
        .slice(0, 3)
        .map((c) => `${c.short} ${c.subject.slice(0, 60)}`)
        .join("; ")}.`,
    );
  const untested = m.commits.filter(
    (c) =>
      !c.merge &&
      c.added + c.deleted >= 250 &&
      !c.touchesTests &&
      c.files.some((f) => CODE_PATH.test(f.path)),
  );
  if (untested.length >= 3)
    out.push(`${untested.length} commits over 250 lines changed code without touching tests.`);
  const breaking = m.commits.filter((c) => c.breaking);
  if (breaking.length)
    out.push(
      `${breaking.length} commit${breaking.length === 1 ? "" : "s"} declared breaking changes (latest ${breaking[0]!.short}).`,
    );
  const stale = m.branches.filter(
    (b) => !b.merged && !b.remote && !b.current && Date.now() - b.at > 30 * DAY,
  );
  if (stale.length)
    out.push(
      `${stale.length} local branch${stale.length === 1 ? "" : "es"} unmerged for over 30 days: ${stale
        .slice(0, 4)
        .map((b) => b.name)
        .join(", ")}.`,
    );
  const conventional = m.commits.filter((c) => !c.merge).length;
  const classified = m.commits.filter((c) => !c.merge && c.kind !== "other").length;
  if (conventional && classified / conventional < 0.6)
    out.push(
      "Many commit messages do not say what kind of change they are; prefer `fix:`/`feat:` style subjects so history stays searchable.",
    );
  return out;
}

// --- side effects: search index and session brief ------------------------------------

/** One searchable document per commit (source `git`, uri `git:<sha>`); only new shas are added. */
function indexCommitMessages(db: StorageAdapter, m: HistoryModel): void {
  const fp = `${m.head}:${m.commits.length}`;
  if (db.metaGet("history_indexed") === fp) return;
  db.transaction(() => {
    for (const c of m.commits) {
      if (c.merge && !c.body) continue;
      const uri = `git:${c.sha}`;
      if (db.findDocumentByUri(uri)) continue;
      const when = new Date(c.at).toISOString().slice(0, 10);
      const content = [
        c.subject,
        "",
        c.body,
        "",
        `${c.kind}${c.scope ? `(${c.scope})` : ""} by ${c.author} on ${when} · ${c.short}`,
        c.files.length
          ? `files: ${c.files
              .slice(0, 40)
              .map((f) => f.path)
              .join(", ")}`
          : "",
      ]
        .filter((l, i, all) => l !== "" || all[i - 1] !== "")
        .join("\n");
      indexContent(db, {
        source: "git",
        title: `${c.short} ${c.subject}`.slice(0, 160),
        content,
        uri,
        kind: "prose",
        meta: { sha: c.sha, kind: c.kind, author: c.author, at: c.at },
      });
    }
  });
  db.metaSet("history_indexed", fp);
}

export interface HistoryBrief {
  builtAt: number;
  head: string;
  commits: number;
  fixes90d: number;
  commits90d: number;
  risky: string[];
  lesson?: string | undefined;
}

function writeBriefSummary(db: StorageAdapter, m: HistoryModel): void {
  const cutoff = Date.now() - 90 * DAY;
  const recent = m.commits.filter((c) => c.at >= cutoff && !c.merge);
  const brief: HistoryBrief = {
    builtAt: m.builtAt,
    head: m.head,
    commits: m.stats.commits,
    commits90d: recent.length,
    fixes90d: recent.filter((c) => c.kind === "fix").length,
    risky: [...m.files.values()]
      .filter((f) => f.risk >= 0.2 && f.commits >= 3)
      .sort((a, b) => b.risk - a.risk)
      .slice(0, 4)
      .map((f) => f.path),
    lesson: m.lessons.find((l) => l.startsWith("Bugs typically")),
  };
  db.metaSet("history_brief", JSON.stringify(brief));
}

export function readBriefSummary(db: StorageAdapter): HistoryBrief | undefined {
  const raw = db.metaGet("history_brief");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as HistoryBrief;
  } catch {
    return undefined;
  }
}

// --- queries used by the tool and the dashboard --------------------------------------

export interface CommitFilter {
  kinds?: CommitKind[] | undefined;
  buckets?: KindBucket[] | undefined;
  author?: string | undefined;
  path?: string | undefined;
  since?: number | undefined;
  until?: number | undefined;
  query?: string | undefined;
  onHead?: boolean | undefined;
  risky?: boolean | undefined;
}

export function filterCommits(m: HistoryModel, f: CommitFilter): HistoryCommit[] {
  const q = f.query?.toLowerCase();
  const re = q ? safeRegex(q) : undefined;
  const author = f.author?.toLowerCase();
  const prefix = f.path?.replace(/^\.\//, "");
  return m.commits.filter((c) => {
    if (f.kinds?.length && !f.kinds.includes(c.kind)) return false;
    if (f.buckets?.length && !f.buckets.includes(c.bucket)) return false;
    if (
      author &&
      !c.author.toLowerCase().includes(author) &&
      !c.email.toLowerCase().includes(author)
    )
      return false;
    if (f.since !== undefined && c.at < f.since) return false;
    if (f.until !== undefined && c.at > f.until) return false;
    if (f.onHead && !c.onHead) return false;
    if (f.risky && c.risk < 0.3 && !c.blamedBy.length && !c.revertedBy) return false;
    if (
      prefix &&
      !c.files.some(
        (x) =>
          x.path === prefix ||
          x.path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`) ||
          x.path.startsWith(prefix),
      )
    )
      return false;
    if (q) {
      const hay =
        `${c.sha} ${c.subject}\n${c.body}\n${c.author} ${c.issues.join(" ")}`.toLowerCase();
      if (re ? !re.test(hay) : !hay.includes(q)) return false;
    }
    return true;
  });
}

function safeRegex(q: string): RegExp | undefined {
  if (!/[.*+?^${}()|[\]\\]/.test(q)) return undefined;
  try {
    return new RegExp(q, "i");
  } catch {
    return undefined;
  }
}

/** Commits of one file, newest first, following its last rename when known. */
export function commitsForFile(m: HistoryModel, path: string): HistoryCommit[] {
  const clean = path.replace(/^\.\//, "");
  const from = m.files.get(clean)?.renamedFrom;
  return m.commits.filter((c) =>
    c.files.some((f) => f.path === clean || (from && f.path === from)),
  );
}

/** Commits whose changes *to this file* were later removed by a fix, newest first. */
export function originsForFile(m: HistoryModel, path: string): HistoryCommit[] {
  const clean = path.replace(/^\.\//, "");
  const shas = new Set(m.links.filter((l) => l.path === clean).map((l) => l.origin));
  return m.commits.filter((c) => shas.has(c.sha));
}

/** Resolve a sha prefix, a tag or a branch name to a commit in the model. */
export function resolveCommit(m: HistoryModel, ref: string): HistoryCommit | undefined {
  const r = ref.trim();
  if (m.bySha.has(r)) return m.bySha.get(r);
  const tag = m.tags.find((t) => t.name === r);
  if (tag) return m.bySha.get(tag.sha);
  const br = m.branches.find((b) => b.name === r);
  if (br) return m.bySha.get(br.sha);
  if (/^[0-9a-f]{4,40}$/i.test(r)) return m.commits.find((c) => c.sha.startsWith(r.toLowerCase()));
  return undefined;
}

/** Files ranked by history risk (bug-proneness), highest first. */
export function riskyFiles(
  m: HistoryModel,
  opts: { limit?: number; pathPrefix?: string } = {},
): FileHistory[] {
  const prefix = opts.pathPrefix?.replace(/^\.\//, "");
  return [...m.files.values()]
    .filter((f) => !prefix || f.path.startsWith(prefix))
    .sort((a, b) => b.risk - a.risk || b.fixes - a.fixes || b.commits - a.commits)
    .slice(0, opts.limit ?? 20);
}

export { workingTreeFiles };
