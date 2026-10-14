import { fileId } from "../graph/ids.js";
import type { StorageAdapter } from "../storage/adapter.js";
import type { GraphNodeRow } from "../storage/types.js";
import { BUCKETS, type CommitKind } from "./classify.js";
import { branchesContaining, diffRanges, logForLines } from "./log.js";
import {
  type CommitFilter,
  commitsForFile,
  type FileHistory,
  filterCommits,
  type HistoryCommit,
  type HistoryModel,
  originsForFile,
  riskyFiles,
} from "./model.js";

const DAY = 86_400_000;

export const day = (at: number): string => new Date(at).toISOString().slice(0, 10);

export function ago(at: number, now = Date.now()): string {
  const d = Math.max(0, now - at);
  if (d < 36e5) return `${Math.max(1, Math.round(d / 6e4))}m ago`;
  if (d < DAY) return `${Math.round(d / 36e5)}h ago`;
  if (d < 60 * DAY) return `${Math.round(d / DAY)}d ago`;
  if (d < 730 * DAY) return `${Math.round(d / (30 * DAY))}mo ago`;
  return `${(d / (365 * DAY)).toFixed(1)}y ago`;
}

function trunc(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** One commit on one line: sha, date, kind, subject, author, size and hindsight flags. */
export function commitLine(
  c: HistoryCommit,
  m: HistoryModel,
  opts: { files?: boolean } = {},
): string {
  const flags: string[] = [];
  if (c.blamedBy.length)
    flags.push(
      `⚠ ${c.blamedBy.length} later fix${c.blamedBy.length === 1 ? "" : "es"} (${c.blamedBy
        .slice(0, 2)
        .map((s) => m.bySha.get(s)?.short ?? s.slice(0, 7))
        .join(", ")})`,
    );
  if (c.revertedBy)
    flags.push(`↩ reverted by ${m.bySha.get(c.revertedBy)?.short ?? c.revertedBy.slice(0, 7)}`);
  if (c.kind === "fix" && c.origins.length)
    flags.push(
      `fixes ${c.origins
        .map((s) => m.bySha.get(s)?.short ?? s.slice(0, 7))
        .slice(0, 3)
        .join(", ")}`,
    );
  if (c.kind === "revert" && c.origins.length)
    flags.push(
      `reverts ${c.origins.map((s) => m.bySha.get(s)?.short ?? s.slice(0, 7)).join(", ")}`,
    );
  if (c.breaking) flags.push("BREAKING");
  if (c.tags.length) flags.push(`tag ${c.tags.join(", ")}`);
  if (!c.onHead) flags.push("not on HEAD");
  const size = c.merge
    ? "merge"
    : `+${c.added}/-${c.deleted}, ${c.files.length} file${c.files.length === 1 ? "" : "s"}`;
  const line = `- ${c.short} ${day(c.at)} [${c.kind}${c.scope ? `(${c.scope})` : ""}] ${trunc(c.subject, 90)} (${c.author}; ${size})${flags.length ? ` · ${flags.join(" · ")}` : ""}`;
  if (!opts.files || !c.files.length) return line;
  return `${line}\n    ${c.files
    .slice(0, 8)
    .map((f) => f.path)
    .join(", ")}${c.files.length > 8 ? ` … +${c.files.length - 8}` : ""}`;
}

function kindMix(cs: HistoryCommit[]): string {
  const n = new Map<string, number>();
  for (const c of cs) n.set(c.bucket, (n.get(c.bucket) ?? 0) + 1);
  return BUCKETS.filter((b) => n.get(b))
    .map((b) => `${b} ${n.get(b)}`)
    .join(", ");
}

// --- overview ------------------------------------------------------------------------

export function renderOverview(m: HistoryModel, opts: { limit?: number } = {}): string {
  const now = Date.now();
  const lines: string[] = [];
  const nonMerge = m.commits.filter((c) => !c.merge);
  const recent = nonMerge.filter((c) => now - c.at < 30 * DAY);
  const prior = nonMerge.filter((c) => now - c.at >= 30 * DAY && now - c.at < 60 * DAY);
  lines.push(
    `${m.stats.commits} commits (${m.stats.onHead} on HEAD) across ${m.branches.filter((b) => !b.remote).length} local / ${m.branches.filter((b) => b.remote).length} remote branches, ${m.authors.length} author${m.authors.length === 1 ? "" : "s"}, ${m.files.size} files, ${day(m.range.from)} → ${day(m.range.to)} · HEAD ${m.head.slice(0, 7)}${m.branch ? ` on ${m.branch}` : ""}${m.base ? ` (base ${m.base})` : ""}`,
  );
  lines.push(
    `activity: ${recent.length} commits in the last 30 days (${prior.length} the 30 before); mix overall: ${kindMix(nonMerge)}; fixes ${m.stats.fixes}, reverts ${m.stats.reverts}, merges ${m.stats.merges}`,
  );
  if (m.stats.fixesTraced)
    lines.push(
      `fix-origin trace: ${m.stats.fixesTraced} fixes blamed back to ${new Set(m.links.map((l) => l.origin)).size} earlier commits${m.stats.tracePending ? ` (${m.stats.tracePending} fixes still to trace; call again)` : ""}`,
    );
  if (m.lessons.length) {
    lines.push("lessons:");
    for (const l of m.lessons) lines.push(`- ${l}`);
  }
  const risky = riskyFiles(m, { limit: 8 }).filter((f) => f.risk >= 0.2);
  if (risky.length) {
    lines.push("bug-prone files (history risk 0–1, reasons):");
    for (const f of risky)
      lines.push(
        `- ${f.path} · ${f.risk.toFixed(2)} · ${f.reasons.join("; ") || `${f.commits} commits`}`,
      );
  }
  const unmerged = m.branches.filter((b) => !b.merged && !b.isDefault && !b.remote).slice(0, 8);
  if (unmerged.length) {
    lines.push(`unmerged local branches (ahead/behind ${m.base ?? "base"}):`);
    for (const b of unmerged)
      lines.push(
        `- ${b.name}${b.current ? " (current)" : ""} +${b.ahead}/-${b.behind} · last ${ago(b.at, now)}${b.lastSubject ? ` · ${trunc(b.lastSubject, 60)}` : ""}`,
      );
  }
  if (m.tags.length)
    lines.push(
      `releases: ${m.tags
        .slice(0, 6)
        .map((t) => `${t.name} (${day(t.at)})`)
        .join(", ")}`,
    );
  const notable = m.commits
    .filter((c) => !c.merge && (c.risk >= 0.3 || c.blamedBy.length || c.revertedBy || c.breaking))
    .slice(0, opts.limit ?? 8);
  if (notable.length) {
    lines.push("recent commits worth knowing about:");
    for (const c of notable)
      lines.push(
        `${commitLine(c, m)}${c.riskReasons.length ? `\n    why: ${c.riskReasons.join("; ")}` : ""}`,
      );
  }
  lines.push(
    'next: em_history {action:"file", path} before editing a file, {action:"risk"} for the working tree, {action:"commit", sha} for one change, {action:"search", query} to find when something happened.',
  );
  return lines.join("\n");
}

// --- timeline / search ---------------------------------------------------------------

export function renderTimeline(
  m: HistoryModel,
  f: CommitFilter,
  limit: number,
  title?: string,
): string {
  const rows = filterCommits(m, f);
  const lines = [
    title ??
      `${rows.length} matching commit${rows.length === 1 ? "" : "s"}${rows.length > limit ? `, showing ${limit}` : ""}:`,
  ];
  for (const c of rows.slice(0, limit)) lines.push(commitLine(c, m));
  if (rows.length > limit)
    lines.push(`… ${rows.length - limit} more (narrow with kinds, author, path, since/until)`);
  if (rows.length > 1)
    lines.push(
      `mix: ${kindMix(rows)}; authors: ${[...new Set(rows.map((c) => c.author))].slice(0, 6).join(", ")}`,
    );
  return lines.join("\n");
}

// --- file ----------------------------------------------------------------------------

export function renderFile(
  m: HistoryModel,
  db: StorageAdapter,
  path: string,
  opts: { limit?: number } = {},
): string {
  const clean = path.replace(/^\.\//, "");
  const h = m.files.get(clean);
  const commits = commitsForFile(m, clean);
  if (!h || !commits.length)
    return `no history for ${clean} in the last ${m.stats.commits} commits (new file, renamed, or outside the project).`;
  const now = Date.now();
  const lines: string[] = [];
  const authors = Object.entries(h.authors).sort((a, b) => b[1] - a[1]);
  lines.push(
    `${clean}: ${h.commits} commits by ${authors.length} author${authors.length === 1 ? "" : "s"} (${authors
      .slice(0, 3)
      .map(([a, n]) => `${a} ${n}`)
      .join(
        ", ",
      )}), ${day(h.firstAt)} → ${day(h.lastAt)} (${ago(h.lastAt, now)}), +${h.added}/-${h.deleted}${h.renamedFrom ? `, renamed from ${h.renamedFrom}` : ""}`,
  );
  lines.push(
    `history risk ${h.risk.toFixed(2)}: ${h.reasons.length ? h.reasons.join("; ") : "no fix pattern recorded"}; mix: ${kindMix(commits)}`,
  );
  const origins = originsForFile(m, clean);
  if (origins.length) {
    lines.push("changes here that later needed fixing:");
    for (const c of origins.slice(0, 6)) {
      const fixes = c.blamedBy.map((s) => m.bySha.get(s)).filter(Boolean) as HistoryCommit[];
      lines.push(
        `- ${c.short} ${day(c.at)} [${c.kind}] ${trunc(c.subject, 70)} → fixed by ${fixes
          .slice(0, 3)
          .map(
            (f) =>
              `${f.short} "${trunc(f.subject, 50)}" (${Math.max(0, Math.round((f.at - c.at) / DAY))}d later)`,
          )
          .join(", ")}`,
      );
    }
  }
  const fixes = commits.filter((c) => c.kind === "fix");
  if (fixes.length) {
    lines.push(`fixes to this file (${fixes.length}):`);
    for (const c of fixes.slice(0, 6))
      lines.push(
        `- ${c.short} ${day(c.at)} ${trunc(c.subject, 80)}${c.issues.length ? ` ${c.issues.join(" ")}` : ""}`,
      );
  }
  const coChange = coChanges(db, clean);
  if (coChange.length) lines.push(`usually changes together with: ${coChange.join(", ")}`);
  const memories = memoriesMentioning(db, clean);
  if (memories.length)
    lines.push(`memories mentioning it: ${memories.join(", ")} (em_memory {action:"read", name})`);
  const limit = opts.limit ?? 15;
  lines.push(
    `timeline (newest first${commits.length > limit ? `, ${limit} of ${commits.length}` : ""}):`,
  );
  for (const c of commits.slice(0, limit)) lines.push(commitLine(c, m));
  return lines.join("\n");
}

function coChanges(db: StorageAdapter, path: string): string[] {
  try {
    return db
      .graphEdgesFrom([fileId(path)], ["co_changes"])
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 5)
      .map((e) => `${e.dst.replace(/^file:/, "")} (${e.weight.toFixed(2)})`);
  } catch {
    return [];
  }
}

function memoriesMentioning(db: StorageAdapter, path: string): string[] {
  try {
    return db
      .graphEdgesTo([fileId(path)], ["mentions"])
      .map((e) => e.src)
      .filter((id) => id.startsWith("memory:"))
      .map((id) => id.slice(7))
      .slice(0, 5);
  } catch {
    return [];
  }
}

// --- commit --------------------------------------------------------------------------

/** Symbols at a commit's added ranges, only when the file has not changed since (lines still line up). */
export function symbolsTouched(
  m: HistoryModel,
  db: StorageAdapter,
  c: HistoryCommit,
  maxFiles = 8,
): Array<{ path: string; symbols: GraphNodeRow[]; stale: boolean }> {
  const out: Array<{ path: string; symbols: GraphNodeRow[]; stale: boolean }> = [];
  for (const f of c.files.slice(0, maxFiles)) {
    if (f.binary || !db.graphGetNode(fileId(f.path))) continue;
    const later = m.commits.find(
      (x) => x.onHead && x.at > c.at && x.sha !== c.sha && x.files.some((y) => y.path === f.path),
    );
    if (later) {
      out.push({ path: f.path, symbols: [], stale: true });
      continue;
    }
    const { added } = diffRanges(m.root, c.sha, f.path);
    const seen = new Map<string, GraphNodeRow>();
    for (const [a, b] of added) {
      for (const n of db.graphNodesAtLines(f.path, a, b)) {
        if (n.kind === "route" || n.kind === "file") continue;
        if ([...seen.values()].some((s) => s.name.startsWith(`${n.name}.`))) continue;
        seen.set(n.id, n);
        if (seen.size >= 6) break;
      }
    }
    out.push({ path: f.path, symbols: [...seen.values()], stale: false });
  }
  return out;
}

export function renderCommit(m: HistoryModel, db: StorageAdapter, c: HistoryCommit): string {
  const lines: string[] = [];
  lines.push(
    `${c.sha} · ${day(c.at)} ${new Date(c.at).toISOString().slice(11, 16)}Z · ${c.author} <${c.email}> · [${c.kind}${c.scope ? `(${c.scope})` : ""}]${c.breaking ? " BREAKING" : ""}${c.pr ? ` · PR #${c.pr}` : ""}${c.issues.length ? ` · ${c.issues.join(" ")}` : ""}${c.tags.length ? ` · tags ${c.tags.join(", ")}` : ""}`,
  );
  lines.push(c.subject);
  if (c.body) lines.push(trunc(c.body, 600));
  lines.push(
    `${c.merge ? `merge of ${c.parents.map((p) => p.slice(0, 7)).join(" + ")}` : `+${c.added}/-${c.deleted} in ${c.files.length} file${c.files.length === 1 ? "" : "s"} (${c.size})`}${c.onHead ? "" : " · not reachable from HEAD"}${c.refs.length ? ` · refs: ${c.refs.join(", ")}` : ""}`,
  );
  if (c.riskReasons.length)
    lines.push(`hindsight: ${c.riskReasons.join("; ")} (risk ${c.risk.toFixed(2)})`);
  if (c.blamedBy.length) {
    lines.push("later fixes that removed lines from this commit:");
    for (const s of c.blamedBy.slice(0, 6)) {
      const f = m.bySha.get(s);
      const paths = [
        ...new Set(m.links.filter((l) => l.fix === s && l.origin === c.sha).map((l) => l.path)),
      ];
      lines.push(
        f
          ? `- ${f.short} ${day(f.at)} ${trunc(f.subject, 70)} (${Math.round((f.at - c.at) / DAY)}d later; ${paths.join(", ")})`
          : `- ${s.slice(0, 7)}`,
      );
    }
  }
  if (c.origins.length) {
    lines.push(
      c.kind === "revert" ? "reverts:" : "removed lines last written by (likely cause of the bug):",
    );
    for (const s of c.origins.slice(0, 6)) {
      const o = m.bySha.get(s);
      const paths = [
        ...new Set(m.links.filter((l) => l.fix === c.sha && l.origin === s).map((l) => l.path)),
      ];
      lines.push(
        o
          ? `- ${o.short} ${day(o.at)} [${o.kind}] ${trunc(o.subject, 70)} (${o.author}${paths.length ? `; ${paths.join(", ")}` : ""})`
          : `- ${s.slice(0, 7)} (outside the loaded window)`,
      );
    }
  }
  if (c.revertedBy) {
    const r = m.bySha.get(c.revertedBy);
    lines.push(
      `reverted by ${r ? `${r.short} ${day(r.at)} ${trunc(r.subject, 70)}` : c.revertedBy.slice(0, 7)}`,
    );
  }
  if (c.files.length) {
    lines.push("files:");
    const touched = symbolsTouched(m, db, c);
    for (const f of c.files.slice(0, 25)) {
      const t = touched.find((x) => x.path === f.path);
      const syms =
        t && !t.stale && t.symbols.length
          ? ` → ${t.symbols.map((s) => `${s.kind} ${s.name}`).join(", ")}`
          : "";
      const hist = m.files.get(f.path);
      const flag = hist && hist.risk >= 0.3 ? ` · file risk ${hist.risk.toFixed(2)}` : "";
      lines.push(
        `- ${f.path} +${f.added}/-${f.deleted}${f.renamedFrom ? ` (from ${f.renamedFrom})` : ""}${syms}${flag}`,
      );
    }
    if (c.files.length > 25) lines.push(`… +${c.files.length - 25} files`);
  }
  const branches = branchesContaining(m.root, c.sha);
  if (branches.length)
    lines.push(
      `on branches: ${branches.slice(0, 8).join(", ")}${branches.length > 8 ? ` … +${branches.length - 8}` : ""}`,
    );
  return lines.join("\n");
}

// --- branch --------------------------------------------------------------------------

export function renderBranch(m: HistoryModel, name: string, limit = 20): string {
  const b =
    m.branches.find((x) => x.name === name) ?? m.branches.find((x) => x.name.endsWith(`/${name}`));
  if (!b)
    return `no branch named ${name}. Known: ${m.branches
      .slice(0, 15)
      .map((x) => x.name)
      .join(", ")}`;
  const lines: string[] = [];
  lines.push(
    `${b.name}${b.current ? " (current)" : ""}${b.isDefault ? " (base branch)" : ""}${b.remote ? " [remote]" : ""} · tip ${b.sha.slice(0, 7)} ${ago(b.at)}${b.upstream ? ` · tracks ${b.upstream}` : ""}${b.isDefault ? "" : ` · ${b.merged ? "merged into" : "not merged into"} ${m.base ?? "base"} · +${b.ahead} ahead / -${b.behind} behind`}`,
  );
  const own = b.isDefault
    ? m.commits.filter((c) => c.refs.includes(b.name) || c.onHead).slice(0, limit)
    : branchOnlyCommits(m, b);
  if (!b.isDefault) {
    lines.push(
      `${own.length} commit${own.length === 1 ? "" : "s"} unique to the branch${own.length ? `; mix: ${kindMix(own)}` : ""}`,
    );
    const files = new Map<string, number>();
    for (const c of own) for (const f of c.files) files.set(f.path, (files.get(f.path) ?? 0) + 1);
    const top = [...files.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 10);
    if (top.length)
      lines.push(
        `files touched: ${top.map(([p, n]) => (n > 1 ? `${p} ×${n}` : p)).join(", ")}${files.size > 10 ? ` … +${files.size - 10}` : ""}`,
      );
    const risky = top
      .map(([p]) => m.files.get(p))
      .filter((f): f is FileHistory => !!f && f.risk >= 0.3);
    if (risky.length)
      lines.push(
        `touches bug-prone files: ${risky.map((f) => `${f.path} (${f.risk.toFixed(2)})`).join(", ")}`,
      );
  }
  for (const c of own.slice(0, limit)) lines.push(commitLine(c, m));
  if (own.length > limit) lines.push(`… ${own.length - limit} more`);
  return lines.join("\n");
}

/** Commits reachable from the branch tip but not from the base, walking parents inside the model. */
export function branchOnlyCommits(
  m: HistoryModel,
  b: { sha: string; isDefault: boolean },
): HistoryCommit[] {
  if (b.isDefault) return [];
  const baseTip = m.base ? m.branches.find((x) => x.name === m.base)?.sha : undefined;
  const baseSet = new Set<string>();
  if (baseTip) walk(m, baseTip, baseSet, 5000);
  const own = new Set<string>();
  walk(m, b.sha, own, 2000, baseSet);
  return m.commits.filter((c) => own.has(c.sha));
}

function walk(
  m: HistoryModel,
  start: string,
  out: Set<string>,
  max: number,
  stop?: Set<string>,
): void {
  const stack = [start];
  while (stack.length && out.size < max) {
    const sha = stack.pop()!;
    if (out.has(sha) || stop?.has(sha)) continue;
    const c = m.bySha.get(sha);
    if (!c) continue;
    out.add(sha);
    for (const p of c.parents) stack.push(p);
  }
}

// --- risk for a set of paths ---------------------------------------------------------

export function renderRisk(m: HistoryModel, paths: string[], title: string): string {
  const lines: string[] = [title];
  if (!paths.length) return `${title}\nnothing to assess.`;
  const rows = paths
    .map((p) => ({ path: p.replace(/^\.\//, ""), h: m.files.get(p.replace(/^\.\//, "")) }))
    .sort((a, b) => (b.h?.risk ?? -1) - (a.h?.risk ?? -1));
  for (const { path, h } of rows.slice(0, 40)) {
    if (!h) {
      lines.push(`- ${path} · no history (new file)`);
      continue;
    }
    const commits = commitsForFile(m, path);
    const lastFix = commits.find((c) => c.kind === "fix");
    const origins = originsForFile(m, path).slice(0, 2);
    const parts = [
      `risk ${h.risk.toFixed(2)}`,
      `${h.commits} commits`,
      `${h.fixes} fixes`,
      `last change ${ago(h.lastAt)}`,
    ];
    if (lastFix) parts.push(`last fix ${lastFix.short} "${trunc(lastFix.subject, 50)}"`);
    if (origins.length)
      parts.push(
        `past changes that needed fixing: ${origins.map((c) => `${c.short} [${c.kind}]`).join(", ")}`,
      );
    lines.push(
      `- ${path} · ${parts.join(" · ")}${h.reasons.length ? `\n    ${h.reasons.join("; ")}` : ""}`,
    );
  }
  if (rows.length > 40) lines.push(`… +${rows.length - 40} paths`);
  const worst = rows.filter((r) => r.h && r.h.risk >= 0.3);
  if (worst.length)
    lines.push(
      `advice: ${worst.length} of these files have a fix-heavy history; read their recent fixes (em_history {action:"file", path}) before changing them and add tests for the behaviours those fixes restored.`,
    );
  else lines.push("advice: no fix-heavy history among these files; normal care applies.");
  return lines.join("\n");
}

// --- symbol --------------------------------------------------------------------------

export function renderSymbol(m: HistoryModel, node: GraphNodeRow, limit = 15): string {
  if (!node.path || !node.start_line) return `symbol ${node.name} has no line range in the graph.`;
  const rows = logForLines(
    m.root,
    node.path,
    node.start_line,
    node.end_line ?? node.start_line,
    limit,
  );
  const lines = [
    `${node.kind} ${node.name} (${node.path}:${node.start_line}${node.end_line ? `-${node.end_line}` : ""}): ${rows.length} commit${rows.length === 1 ? "" : "s"} touched these lines (git log -L)`,
  ];
  for (const r of rows) {
    const c = m.bySha.get(r.sha);
    lines.push(
      c
        ? commitLine(c, m)
        : `- ${r.sha.slice(0, 7)} ${day(r.at)} ${trunc(r.subject, 90)} (${r.author})`,
    );
  }
  const fixes = rows
    .map((r) => m.bySha.get(r.sha))
    .filter((c): c is HistoryCommit => !!c && c.kind === "fix");
  if (fixes.length)
    lines.push(
      `${fixes.length} of them were fixes; the behaviour they restored is worth a test before changing this symbol.`,
    );
  return lines.join("\n");
}

export function kindList(): CommitKind[] {
  return [
    "feat",
    "fix",
    "refactor",
    "perf",
    "test",
    "docs",
    "chore",
    "build",
    "ci",
    "style",
    "revert",
    "merge",
    "release",
    "wip",
    "other",
  ];
}
