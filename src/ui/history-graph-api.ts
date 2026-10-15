import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ProjectContext } from "../context.js";
import { categoryInfo } from "../docs/category.js";
import { ensureDocsGraph } from "../docs/graph.js";
import { fileId, fileOf, memoryId, parseId } from "../graph/ids.js";
import { branchLineage } from "../history/lineage.js";
import {
  commitsForFile,
  getHistory,
  type HistoryCommit,
  type HistoryModel,
  resolveCommit,
} from "../history/model.js";
import { memoriesRel, reconcile } from "../memory/store.js";
import type { StorageAdapter } from "../storage/adapter.js";
import { getStorage } from "../storage/index.js";
import type { VisNode } from "./graph-api.js";

/**
 * The history graph: branches and commits linked to the files they touched, and
 * through those files to the memories and doc sources about them. Edges:
 * - `contains`: branch → its own commits (see src/history/lineage.ts);
 * - `merged_into`: a merged branch → the default branch;
 * - `touches`: commit → file (lockfiles skipped, the biggest changes per commit kept);
 * - `records`: commit → memory whose markdown file it changed;
 * - `fixes`: fix commit → the commit its removed lines trace back to (SZZ links);
 * - `mentions` / `documents`: memory / doc source → file, from the knowledge graph.
 * Without `focus` the newest branches are drawn; a focus (`branch:`, `commit:`,
 * `file:`, `memory:`, `doc:`) re-centres the picture on that node.
 */
export type HistoryGraphGroup = "branch" | "commit" | "file" | "memory" | "doc";

export interface HistoryGraphNode extends VisNode {
  group: HistoryGraphGroup;
  seed?: boolean | undefined;
  /** A file gone from the working tree, a memory deleted since a commit changed it. */
  missing?: boolean | undefined;
  /** Commit kind, memory kind or doc category id. */
  sub?: string | undefined;
  /** Commit kind bucket (feat, fix …) for colour. */
  bucket?: string | undefined;
  /** Memory lifecycle. */
  status?: string | undefined;
  detail?: string | undefined;
  at?: number | undefined;
  author?: string | undefined;
  short?: string | undefined;
  risk?: number | undefined;
  fixes?: number | undefined;
  /** Branch: own commit count, whether merged / still a ref / the default, PR numbers. */
  commits?: number | undefined;
  merged?: boolean | undefined;
  live?: boolean | undefined;
  isDefault?: boolean | undefined;
  prs?: number[] | undefined;
}

export interface HistoryGraphEdge {
  src: string;
  dst: string;
  kind: string;
  weight: number;
}

export interface HistoryGraphOptions {
  focus?: string | undefined;
  /** Feature branches drawn without a focus, newest first (default 8). */
  branches?: number | undefined;
  /** Own commits drawn per branch (default 25). */
  commitsPerBranch?: number | undefined;
  /** Files kept per commit, by lines changed (default 12). */
  filesPerCommit?: number | undefined;
  /** Node cap (default 400). */
  limit?: number | undefined;
}

export const HISTORY_GRAPH_EDGES = [
  "contains",
  "merged_into",
  "touches",
  "records",
  "fixes",
  "mentions",
  "documents",
] as const;

const LOCKFILE =
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|uv\.lock|composer\.lock|Gemfile\.lock)$/;

const branchId = (name: string) => `branch:${name}`;
const commitId = (sha: string) => `commit:${sha}`;

function parseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function metaOf(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const NO_GIT = { git: false as const, error: "not a git repository (or no commits yet)" };

export function historyGraphKnowledgePayload(ctx: ProjectContext, opts: HistoryGraphOptions = {}) {
  const db = getStorage(ctx);
  const m = getHistory(ctx, db);
  if (!m) return NO_GIT;
  reconcile(ctx, db);
  try {
    ensureDocsGraph(ctx, db);
  } catch {
    // a broken manifest leaves the doc nodes as they were
  }
  return buildHistoryGraph(ctx, db, m, opts);
}

/** Exported for tests: the payload over a built history model. */
export function buildHistoryGraph(
  ctx: ProjectContext,
  db: StorageAdapter,
  m: HistoryModel,
  opts: HistoryGraphOptions = {},
) {
  const nBranches = Math.max(1, Math.min(50, opts.branches ?? 8));
  const perBranch = Math.max(1, Math.min(200, opts.commitsPerBranch ?? 25));
  const perCommit = Math.max(1, Math.min(200, opts.filesPerCommit ?? 12));
  const limit = Math.max(20, Math.min(2000, opts.limit ?? 400));
  const focus = opts.focus?.trim() || null;

  const { defaultName, branches, ownerOf } = branchLineage(m);
  const branchBy = new Map(branches.map((b) => [b.name, b]));

  const memDir = `${memoriesRel(ctx)}/`;
  const memoryOfPath = (p: string) =>
    p.startsWith(memDir) && p.endsWith(".md") ? p.slice(memDir.length, -3) : undefined;
  const memRows = new Map(
    db
      .memoryList({ limit: 100_000 })
      .filter((r) => r.name)
      .map((r) => [r.name!, r] as const),
  );
  /** Memory name → the files its related: header names (directly or through a symbol). */
  const memFiles = new Map<string, string[]>();
  for (const [name, row] of memRows) {
    const paths = new Set<string>();
    for (const id of parseList(row.node_ids)) {
      const f = fileOf(id);
      if (f) paths.add(f);
    }
    if (paths.size) memFiles.set(name, [...paths]);
  }

  const nonMerge = (cs: HistoryCommit[]) => cs.filter((c) => !c.merge);
  const touching = (paths: Iterable<string>, cap: number): HistoryCommit[] => {
    const out = new Map<string, HistoryCommit>();
    for (const p of paths) for (const c of nonMerge(commitsForFile(m, p))) out.set(c.sha, c);
    return [...out.values()].sort((a, b) => b.at - a.at).slice(0, cap);
  };

  // --- seeds -------------------------------------------------------------------------
  const commitSet = new Map<string, HistoryCommit>();
  const branchSet = new Set<string>();
  /** When set, only these files are drawn (a file, memory or doc focus). */
  let onlyFiles: Set<string> | null = null;
  const addCommits = (cs: HistoryCommit[]) => {
    for (const c of cs) commitSet.set(c.sha, c);
  };
  let focusId: string | null = null;
  let followOwners = true;

  const kind = focus ? parseId(focus).kind : null;
  if (!focus) {
    followOwners = false;
    const feature = branches
      .filter((b) => !b.isDefault && b.commits.length)
      .sort((a, b) => b.tipAt - a.tipAt)
      .slice(0, nBranches);
    for (const b of feature) {
      branchSet.add(b.name);
      addCommits(b.commits.slice(0, perBranch).map((s) => m.bySha.get(s)!));
    }
    const def = branchBy.get(defaultName);
    if (def) {
      branchSet.add(def.name);
      // Direct commits on the default branch, back to the oldest feature branch drawn.
      const oldest = Math.min(...feature.map((b) => b.tipAt), Date.now());
      addCommits(
        def.commits
          .map((s) => m.bySha.get(s)!)
          .filter((c, i) => i < perBranch && (feature.length < nBranches || c.at >= oldest)),
      );
    }
  } else if (kind === "branch") {
    const name = focus.slice("branch:".length);
    const b = branchBy.get(name) ?? branches.find((x) => x.name.endsWith(`/${name}`));
    if (b) {
      focusId = branchId(b.name);
      branchSet.add(b.name);
      if (b.merged) branchSet.add(defaultName);
      addCommits(b.commits.slice(0, 150).map((s) => m.bySha.get(s)!));
    }
    followOwners = false;
  } else if (kind === "commit") {
    const c = resolveCommit(m, focus.slice("commit:".length));
    if (c) {
      focusId = commitId(c.sha);
      addCommits([c]);
      addCommits([...c.origins, ...c.blamedBy].flatMap((s) => m.bySha.get(s) ?? []));
    }
  } else if (kind === "memory") {
    const name = focus.slice("memory:".length);
    focusId = memoryId(name);
    const paths = memFiles.get(name) ?? [];
    onlyFiles = new Set(paths);
    const own = `${memDir}${name}.md`;
    addCommits([...touching(paths, 60), ...touching([own], 20)]);
  } else if (kind === "doc") {
    focusId = focus;
    const paths = db
      .graphEdgesFrom([focus], ["documents"])
      .map((e) => fileOf(e.dst))
      .filter((p): p is string => !!p);
    onlyFiles = new Set(paths);
    addCommits(touching(paths, 60));
  } else {
    const path = fileOf(focus) ?? focus.replace(/^file:/, "");
    focusId = fileId(path);
    onlyFiles = new Set([path]);
    addCommits(touching([path], 60));
  }
  if (followOwners)
    for (const sha of commitSet.keys())
      for (const name of ownerOf.get(sha) ?? []) branchSet.add(name);

  // --- edges -------------------------------------------------------------------------
  const edges = new Map<string, HistoryGraphEdge>();
  const addEdge = (src: string, dst: string, kind: string, weight = 1) => {
    if (src === dst) return;
    const key = `${src}|${dst}|${kind}`;
    if (!edges.has(key)) edges.set(key, { src, dst, kind, weight });
  };

  for (const name of branchSet) {
    const b = branchBy.get(name);
    if (!b) continue;
    for (const sha of b.commits)
      if (commitSet.has(sha)) addEdge(branchId(name), commitId(sha), "contains");
    if (b.merged && !b.isDefault && branchSet.has(defaultName))
      addEdge(branchId(name), branchId(defaultName), "merged_into");
  }

  // Files: the biggest changes per commit, then the files most commits in view share.
  const touchCount = new Map<string, number>();
  const commitFiles = new Map<string, string[]>();
  const recorded = new Map<string, string[]>();
  for (const c of commitSet.values()) {
    const mems: string[] = [];
    const paths: string[] = [];
    for (const f of [...c.files].sort((a, b) => b.added + b.deleted - (a.added + a.deleted))) {
      const mem = memoryOfPath(f.path);
      if (mem) {
        mems.push(mem);
        continue;
      }
      if (LOCKFILE.test(f.path)) continue;
      if (onlyFiles && !onlyFiles.has(f.path)) continue;
      paths.push(f.path);
    }
    const kept = paths.slice(0, perCommit);
    commitFiles.set(c.sha, kept);
    for (const p of kept) touchCount.set(p, (touchCount.get(p) ?? 0) + 1);
    if (mems.length) recorded.set(c.sha, mems);
  }
  // A focused file / memory / doc keeps its files even when no commit touched them.
  for (const p of onlyFiles ?? []) if (!touchCount.has(p)) touchCount.set(p, 0);
  const fileBudget = Math.max(10, limit - branchSet.size - commitSet.size - 40);
  const files = new Set(
    [...touchCount.entries()]
      .sort(
        (a, b) =>
          Number(onlyFiles?.has(b[0]) ?? false) - Number(onlyFiles?.has(a[0]) ?? false) ||
          b[1] - a[1] ||
          (m.files.get(b[0])?.risk ?? 0) - (m.files.get(a[0])?.risk ?? 0) ||
          a[0].localeCompare(b[0]),
      )
      .slice(0, fileBudget)
      .map(([p]) => p),
  );
  for (const [sha, paths] of commitFiles)
    for (const p of paths) if (files.has(p)) addEdge(commitId(sha), fileId(p), "touches");

  // Knowledge: memories recorded by a commit in view or related to a file in view…
  const memories = new Set<string>();
  for (const [sha, mems] of recorded)
    for (const name of mems) {
      memories.add(name);
      addEdge(commitId(sha), memoryId(name), "records");
    }
  for (const [name, paths] of memFiles)
    for (const p of paths)
      if (files.has(p)) {
        memories.add(name);
        addEdge(memoryId(name), fileId(p), "mentions");
      }
  if (kind === "memory" && focus) memories.add(focus.slice("memory:".length));
  // …and doc sources that cover a file in view.
  const docs = new Set<string>();
  if (files.size)
    for (const e of db.graphEdgesTo(
      [...files].map((p) => fileId(p)),
      ["documents"],
    )) {
      docs.add(e.src);
      addEdge(e.src, e.dst, "documents");
    }
  if (kind === "doc" && focus) docs.add(focus);

  // Fix → origin, between commits in view.
  for (const l of m.links)
    if (commitSet.has(l.fix) && commitSet.has(l.origin))
      addEdge(commitId(l.fix), commitId(l.origin), "fixes", Math.min(3, 1 + l.lines / 20));

  // --- nodes -------------------------------------------------------------------------
  const nodes: HistoryGraphNode[] = [];
  for (const name of branchSet) {
    const b = branchBy.get(name);
    if (!b) continue;
    const id = branchId(name);
    nodes.push({
      id,
      label: name,
      kind: "branch",
      group: "branch",
      path: null,
      line: null,
      root: id === focusId,
      at: b.tipAt,
      commits: b.commits.length,
      merged: b.merged,
      live: b.live,
      isDefault: b.isDefault,
      prs: b.prs.length ? b.prs : undefined,
    });
  }
  for (const c of commitSet.values()) {
    const id = commitId(c.sha);
    nodes.push({
      id,
      label: c.subject,
      kind: "commit",
      group: "commit",
      path: null,
      line: null,
      root: id === focusId,
      sub: c.kind,
      bucket: c.bucket,
      at: c.at,
      author: c.author,
      short: c.short,
      risk: c.risk,
    });
  }
  for (const p of files) {
    const id = fileId(p);
    const h = m.files.get(p);
    nodes.push({
      id,
      label: p,
      kind: "file",
      group: "file",
      path: p,
      line: null,
      root: id === focusId,
      missing: existsSync(join(ctx.root, p)) ? undefined : true,
      risk: h?.risk,
      fixes: h?.fixes,
    });
  }
  for (const name of memories) {
    const id = memoryId(name);
    const row = memRows.get(name);
    nodes.push({
      id,
      label: name,
      kind: "memory",
      group: "memory",
      path: row?.path ?? null,
      line: null,
      root: id === focusId,
      missing: row ? undefined : true,
      sub: row?.kind,
      status: row?.status ?? (row?.kind === "decision" ? "accepted" : undefined),
      detail: name.includes("/") ? `${name.split("/")[0]}/` : undefined,
    });
  }
  const docRows = new Map(db.graphGetNodes([...docs]).map((n) => [n.id, n]));
  for (const id of docs) {
    const row = docRows.get(id);
    const meta = metaOf(row?.meta);
    const cat = typeof meta.category === "string" ? meta.category : undefined;
    nodes.push({
      id,
      label: row?.name ?? id.slice("doc:".length),
      kind: "doc",
      group: "doc",
      path: row?.path ?? null,
      line: null,
      root: id === focusId,
      missing: row ? undefined : true,
      sub: cat,
      detail: cat ? categoryInfo(cat).label : undefined,
    });
  }
  // The focus stays on screen even when nothing links to it.
  if (focusId && !nodes.some((n) => n.id === focusId)) {
    const p = parseId(focusId);
    nodes.push({
      id: focusId,
      label: p.rest,
      kind: p.kind,
      group: (["branch", "commit", "memory", "doc"].includes(p.kind)
        ? p.kind
        : "file") as HistoryGraphGroup,
      path: p.kind === "file" ? p.rest : null,
      line: null,
      root: true,
      missing: true,
    });
  }
  for (const n of nodes) if (n.root) n.seed = true;

  // --- limit -------------------------------------------------------------------------
  const deg = new Map<string, number>();
  for (const e of edges.values()) {
    deg.set(e.src, (deg.get(e.src) ?? 0) + 1);
    deg.set(e.dst, (deg.get(e.dst) ?? 0) + 1);
  }
  const RANK: Record<HistoryGraphGroup, number> = {
    branch: 1,
    commit: 2,
    memory: 3,
    doc: 3,
    file: 4,
  };
  nodes.sort(
    (a, b) =>
      (a.root ? 0 : RANK[a.group]) - (b.root ? 0 : RANK[b.group]) ||
      (b.at ?? 0) - (a.at ?? 0) ||
      (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0) ||
      a.id.localeCompare(b.id),
  );
  const total = nodes.length;
  const kept = nodes.slice(0, limit);
  const keep = new Set(kept.map((n) => n.id));
  const keptEdges = [...edges.values()].filter((e) => keep.has(e.src) && keep.has(e.dst));

  return {
    git: true as const,
    focus: focusId ?? focus,
    defaultBranch: defaultName,
    nodes: kept,
    edges: keptEdges,
    truncated: total > kept.length,
    total,
    /** Every branch with own commits, newest first, for the focus picker. */
    branches: branches
      .filter((b) => b.commits.length)
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.tipAt - a.tipAt)
      .map((b) => ({
        name: b.name,
        commits: b.commits.length,
        tipAt: b.tipAt,
        merged: b.merged,
        live: b.live,
        isDefault: b.isDefault,
      })),
  };
}
