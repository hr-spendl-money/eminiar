import { findSymbols } from "../code/symbols.js";
import type { ProjectContext } from "../context.js";
import { BUCKETS, type CommitKind, KINDS } from "../history/classify.js";
import { branchesContaining, commitDiff, logForLines, workingTreeFiles } from "../history/log.js";
import {
  type CommitFilter,
  commitsForFile,
  type FileHistory,
  filterCommits,
  getHistory,
  type HistoryCommit,
  type HistoryModel,
  originsForFile,
  resolveCommit,
  riskyFiles,
} from "../history/model.js";
import { branchOnlyCommits, symbolsTouched } from "../history/narrate.js";
import { getStorage } from "../storage/index.js";

/** A commit as the dashboard lists it (no body, no per-file rows). */
export interface CommitRowUi {
  sha: string;
  short: string;
  parents: string[];
  merge: boolean;
  onHead: boolean;
  author: string;
  at: number;
  subject: string;
  refs: string[];
  tags: string[];
  kind: CommitKind;
  bucket: string;
  scope?: string | undefined;
  breaking: boolean;
  issues: string[];
  pr?: number | undefined;
  files: number;
  added: number;
  deleted: number;
  size: string;
  blamedBy: number;
  origins: number;
  reverted: boolean;
  risk: number;
  riskReasons: string[];
}

export function commitRow(c: HistoryCommit): CommitRowUi {
  return {
    sha: c.sha,
    short: c.short,
    parents: c.parents,
    merge: c.merge,
    onHead: c.onHead,
    author: c.author,
    at: c.at,
    subject: c.subject,
    refs: c.refs,
    tags: c.tags,
    kind: c.kind,
    bucket: c.bucket,
    scope: c.scope,
    breaking: c.breaking,
    issues: c.issues,
    pr: c.pr,
    files: c.files.length,
    added: c.added,
    deleted: c.deleted,
    size: c.size,
    blamedBy: c.blamedBy.length,
    origins: c.origins.length,
    reverted: !!c.revertedBy,
    risk: c.risk,
    riskReasons: c.riskReasons,
  };
}

function fileRow(f: FileHistory) {
  return {
    ...f,
    authors: Object.entries(f.authors)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5),
  };
}

function model(ctx: ProjectContext, refresh = false): HistoryModel | undefined {
  const db = getStorage(ctx);
  return getHistory(ctx, db, { refresh });
}

const NO_GIT = { git: false as const, error: "not a git repository (or no commits yet)" };

/** Everything the History view's header, charts and side cards need in one call. */
export function historyPayload(ctx: ProjectContext, opts: { refresh?: boolean } = {}) {
  const m = model(ctx, opts.refresh);
  if (!m) return NO_GIT;
  const now = Date.now();
  const DAY = 86_400_000;
  const nonMerge = m.commits.filter((c) => !c.merge);
  return {
    git: true as const,
    head: m.head,
    branch: m.branch,
    base: m.base,
    builtAt: m.builtAt,
    range: m.range,
    stats: {
      ...m.stats,
      last30: nonMerge.filter((c) => now - c.at < 30 * DAY).length,
      prior30: nonMerge.filter((c) => now - c.at >= 30 * DAY && now - c.at < 60 * DAY).length,
      branches: m.branches.filter((b) => !b.remote).length,
      remoteBranches: m.branches.filter((b) => b.remote).length,
      unmerged: m.branches.filter((b) => !b.merged && !b.remote && !b.isDefault).length,
      tags: m.tags.length,
      workingTree: workingTreeFiles(ctx.root).length,
    },
    kinds: m.kinds,
    buckets: BUCKETS,
    kindList: KINDS,
    weeks: m.weeks,
    authors: m.authors,
    tags: m.tags.slice(0, 50),
    branches: m.branches,
    lessons: m.lessons,
    risky: riskyFiles(m, { limit: 12 })
      .filter((f) => f.risk > 0)
      .map(fileRow),
    notable: m.commits
      .filter((c) => !c.merge && (c.risk >= 0.3 || c.blamedBy.length || c.revertedBy || c.breaking))
      .slice(0, 12)
      .map(commitRow),
  };
}

export function historyCommitsPayload(
  ctx: ProjectContext,
  f: CommitFilter & { limit?: number | undefined; offset?: number | undefined },
) {
  const m = model(ctx);
  if (!m) return NO_GIT;
  const rows = filterCommits(m, f);
  const offset = f.offset ?? 0;
  const limit = f.limit ?? 200;
  return {
    git: true as const,
    total: rows.length,
    offset,
    commits: rows.slice(offset, offset + limit).map(commitRow),
  };
}

/** One commit in full: message, files with symbols touched, trace links, diff stat. */
export function historyCommitPayload(ctx: ProjectContext, ref: string) {
  const m = model(ctx);
  if (!m) return NO_GIT;
  const c = resolveCommit(m, ref);
  if (!c) return { git: true as const, error: "commit not found" };
  const db = getStorage(ctx);
  const touched = new Map(symbolsTouched(m, db, c, 40).map((t) => [t.path, t]));
  const link = (sha: string) => {
    const x = m.bySha.get(sha);
    return x
      ? {
          ...commitRow(x),
          paths: [
            ...new Set(
              m.links
                .filter(
                  (l) =>
                    (l.fix === sha && l.origin === c.sha) || (l.fix === c.sha && l.origin === sha),
                )
                .map((l) => l.path),
            ),
          ],
        }
      : {
          sha,
          short: sha.slice(0, 7),
          subject: "(outside the loaded window)",
          paths: [] as string[],
        };
  };
  return {
    git: true as const,
    commit: {
      ...commitRow(c),
      body: c.body,
      email: c.email,
      revertOf: c.revertOf,
      revertedBy: c.revertedBy,
    },
    files: c.files.map((f) => {
      const t = touched.get(f.path);
      const h = m.files.get(f.path);
      return {
        ...f,
        symbols:
          t && !t.stale
            ? t.symbols.map((s) => ({ id: s.id, name: s.name, kind: s.kind, line: s.start_line }))
            : [],
        stale: t?.stale ?? false,
        fileRisk: h?.risk ?? 0,
        fileFixes: h?.fixes ?? 0,
      };
    }),
    blamedBy: c.blamedBy.map(link),
    origins: c.origins.map(link),
    revertedBy: c.revertedBy ? link(c.revertedBy) : null,
    branches: branchesContaining(ctx.root, c.sha).slice(0, 30),
  };
}

export function historyDiffPayload(ctx: ProjectContext, sha: string, path?: string) {
  const m = model(ctx);
  if (!m) return NO_GIT;
  const c = resolveCommit(m, sha);
  if (!c) return { git: true as const, error: "commit not found" };
  const d = commitDiff(ctx.root, c.sha, { path, maxBytes: 300_000 });
  return { git: true as const, sha: c.sha, path: path ?? null, ...d };
}

export function historyFilePayload(ctx: ProjectContext, path: string) {
  const m = model(ctx);
  if (!m) return NO_GIT;
  const clean = path.replace(/^\.\//, "");
  const h = m.files.get(clean);
  const commits = commitsForFile(m, clean);
  const origins = originsForFile(m, clean).map((c) => ({
    ...commitRow(c),
    fixes: c.blamedBy
      .map((s) => m.bySha.get(s))
      .filter((x): x is HistoryCommit => !!x)
      .map((x) => ({ ...commitRow(x), daysLater: Math.round((x.at - c.at) / 86_400_000) })),
  }));
  return {
    git: true as const,
    path: clean,
    file: h ? fileRow(h) : null,
    commits: commits.map(commitRow),
    origins,
  };
}

export function historyFilesPayload(
  ctx: ProjectContext,
  opts: { limit?: number | undefined; prefix?: string | undefined; sort?: string | undefined },
) {
  const m = model(ctx);
  if (!m) return NO_GIT;
  const prefix = opts.prefix?.replace(/^\.\//, "");
  let rows = [...m.files.values()].filter((f) => !prefix || f.path.startsWith(prefix));
  const key = (opts.sort ?? "risk") as keyof FileHistory;
  rows = rows.sort((a, b) => {
    const x = a[key];
    const y = b[key];
    return typeof x === "number" && typeof y === "number" ? y - x : b.risk - a.risk;
  });
  return {
    git: true as const,
    total: rows.length,
    files: rows.slice(0, opts.limit ?? 300).map(fileRow),
  };
}

export function historyBranchPayload(ctx: ProjectContext, name: string) {
  const m = model(ctx);
  if (!m) return NO_GIT;
  const b =
    m.branches.find((x) => x.name === name) ?? m.branches.find((x) => x.name.endsWith(`/${name}`));
  if (!b) return { git: true as const, error: "branch not found" };
  const own = branchOnlyCommits(m, b);
  const files = new Map<string, number>();
  for (const c of own) for (const f of c.files) files.set(f.path, (files.get(f.path) ?? 0) + 1);
  return {
    git: true as const,
    branch: b,
    commits: own.map(commitRow),
    files: [...files.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 60)
      .map(([path, n]) => ({
        path,
        commits: n,
        risk: m.files.get(path)?.risk ?? 0,
        fixes: m.files.get(path)?.fixes ?? 0,
      })),
  };
}

/** The commit DAG for the lane graph: newest first, capped. */
export function historyGraphPayload(ctx: ProjectContext, limit: number) {
  const m = model(ctx);
  if (!m) return NO_GIT;
  const rows = m.commits.slice(0, limit);
  const present = new Set(rows.map((c) => c.sha));
  return {
    git: true as const,
    base: m.base,
    head: m.head,
    commits: rows.map((c) => ({
      ...commitRow(c),
      parents: c.parents.filter((p) => present.has(p)),
      allParents: c.parents,
    })),
    branches: m.branches.map((b) => ({
      name: b.name,
      sha: b.sha,
      remote: b.remote,
      current: b.current,
      isDefault: b.isDefault,
      merged: b.merged,
    })),
  };
}

/** History risk of the working tree (or given paths). */
export function historyRiskPayload(ctx: ProjectContext, paths?: string[]) {
  const m = model(ctx);
  if (!m) return NO_GIT;
  const list = paths?.length ? paths : workingTreeFiles(ctx.root);
  return {
    git: true as const,
    source: paths?.length ? "paths" : "working tree",
    files: list.map((p) => {
      const clean = p.replace(/^\.\//, "");
      const h = m.files.get(clean);
      const commits = commitsForFile(m, clean);
      return {
        path: clean,
        file: h ? fileRow(h) : null,
        lastFix: commits.find((c) => c.kind === "fix")?.subject ?? null,
        origins: originsForFile(m, clean).slice(0, 3).map(commitRow),
      };
    }),
  };
}

export function historySymbolPayload(ctx: ProjectContext, namePath: string) {
  const m = model(ctx);
  if (!m) return NO_GIT;
  const db = getStorage(ctx);
  const node = findSymbols(db, namePath, { limit: 1 })[0];
  if (!node?.path || !node.start_line) return { git: true as const, error: "symbol not found" };
  const rows = logForLines(
    ctx.root,
    node.path,
    node.start_line,
    node.end_line ?? node.start_line,
    40,
  );
  return {
    git: true as const,
    symbol: {
      id: node.id,
      name: node.name,
      kind: node.kind,
      path: node.path,
      line: node.start_line,
      endLine: node.end_line,
    },
    commits: rows.map((r) => {
      const c = m.bySha.get(r.sha);
      return c
        ? commitRow(c)
        : {
            sha: r.sha,
            short: r.sha.slice(0, 7),
            subject: r.subject,
            author: r.author,
            at: r.at,
            kind: "other",
          };
    }),
  };
}
