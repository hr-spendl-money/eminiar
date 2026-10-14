import type { StorageAdapter } from "../storage/adapter.js";
import type { GraphEdgeRow, GraphNodeRow } from "../storage/types.js";
import { fileId, fileOf, symId } from "./ids.js";

export const STRUCTURAL = [
  "imports",
  "reexports",
  "calls",
  "extends",
  "implements",
  "references",
  "handles",
];

/** Accept a node id, a file path, or a bare symbol name and find the node. */
export function resolveNode(db: StorageAdapter, ref: string): GraphNodeRow | undefined {
  const direct = db.graphGetNode(ref);
  if (direct) return direct;
  const clean = ref.replace(/^\.\//, "");
  const asFile = db.graphGetNode(fileId(clean));
  if (asFile) return asFile;
  if (clean.includes("#")) {
    const [p, n] = clean.split("#") as [string, string];
    const s = db.graphGetNode(symId(p, n));
    if (s) return s;
  }
  const found = db.graphFindNodes({ query: clean, limit: 5 });
  return found.find((n) => n.name === clean) ?? found[0];
}

/** For a file node, include its symbols so edges to members count as edges to the file. */
function expand(db: StorageAdapter, node: GraphNodeRow): string[] {
  if (node.kind !== "file") return [node.id];
  const ids = db.graphEdgesFrom([node.id], ["defines"]).map((e) => e.dst);
  return [node.id, ...ids];
}

export interface Hit {
  id: string;
  node?: GraphNodeRow | undefined;
  score: number;
  hops: number;
  reasons: string[];
}

function toFile(id: string): string {
  const f = fileOf(id);
  return f ? fileId(f) : id;
}

/**
 * Who is affected if `ref` changes: reverse closure over structural edges up to
 * `depth`, plus files that historically change together. Results are grouped by
 * file, scored by Σ confidence×weight/hops and annotated with reasons.
 */
export function impact(
  db: StorageAdapter,
  ref: string,
  opts: {
    depth?: number | undefined;
    includeGit?: boolean | undefined;
    edgeKinds?: string[] | undefined;
  } = {},
): { root: GraphNodeRow; hits: Hit[] } | undefined {
  const root = resolveNode(db, ref);
  if (!root) return undefined;
  const depth = opts.depth ?? 2;
  const kinds = opts.edgeKinds ?? STRUCTURAL;
  const hits = new Map<string, Hit>();
  const add = (id: string, score: number, hops: number, reason: string) => {
    const key = toFile(id);
    if (key === toFile(root.id)) return;
    const h = hits.get(key) ?? { id: key, score: 0, hops, reasons: [] };
    h.score += score;
    h.hops = Math.min(h.hops, hops);
    if (!h.reasons.includes(reason) && h.reasons.length < 4) h.reasons.push(reason);
    hits.set(key, h);
  };

  const start = expand(db, root);
  let frontier = start;
  const seen = new Set(frontier);
  for (let hop = 1; hop <= depth; hop++) {
    const incoming = db.graphEdgesTo(frontier, kinds);
    const next: string[] = [];
    for (const e of incoming) {
      const via = e.dst === root.id ? root.name : e.dst.replace(/^sym:[^#]*#/, "");
      add(
        e.src,
        (e.confidence * e.weight) / hop,
        hop,
        `${e.kind} ${via}${hop > 1 ? ` (via ${hop - 1} hop)` : ""}`,
      );
      if (!seen.has(e.src)) {
        seen.add(e.src);
        next.push(e.src);
      }
    }
    // Members of affected files also matter at the next hop.
    frontier = next;
    if (!frontier.length) break;
  }
  // Memories (.eminiar/memories) that mention the node or one of its symbols are
  // context to re-read before changing it, so they surface alongside dependents.
  for (const e of db.graphEdgesTo(start, ["mentions"])) {
    const via = e.dst === root.id ? root.name : e.dst.replace(/^sym:[^#]*#/, "");
    add(e.src, 0.5 * e.confidence, 1, `memory mentions ${via}`);
  }
  if (opts.includeGit !== false) {
    const file = toFile(root.id);
    for (const e of db.graphEdgesFrom([file], ["co_changes"])) {
      if (e.weight < 0.3) continue;
      const meta = e.meta ? (JSON.parse(e.meta) as { count?: number }) : {};
      add(e.dst, e.weight, 1, `co-changed ${meta.count ?? "?"}× (${Math.round(e.weight * 100)}%)`);
    }
  }
  const list = [...hits.values()].sort((a, b) => b.score - a.score);
  const nodes = new Map(db.graphGetNodes(list.map((h) => h.id)).map((n) => [n.id, n]));
  for (const h of list) h.node = nodes.get(h.id);
  return { root, hits: list };
}

/** Forward structural edges from a node (what it depends on). */
export function dependencies(
  db: StorageAdapter,
  ref: string,
  depth = 1,
): { root: GraphNodeRow; hits: Hit[] } | undefined {
  const root = resolveNode(db, ref);
  if (!root) return undefined;
  const hits = new Map<string, Hit>();
  let frontier = expand(db, root);
  const seen = new Set(frontier);
  for (let hop = 1; hop <= depth; hop++) {
    const out = db.graphEdgesFrom(frontier, STRUCTURAL);
    const next: string[] = [];
    for (const e of out) {
      const key = e.dst.startsWith("sym:") ? toFile(e.dst) : e.dst;
      if (key === toFile(root.id)) continue;
      const h = hits.get(key) ?? { id: key, score: 0, hops: hop, reasons: [] };
      h.score += (e.confidence * e.weight) / hop;
      const reason =
        `${e.kind}${e.meta ? ` ${(JSON.parse(e.meta) as { names?: string[] }).names?.slice(0, 5).join(", ") ?? ""}` : ""}`.trim();
      if (!h.reasons.includes(reason) && h.reasons.length < 4) h.reasons.push(reason);
      hits.set(key, h);
      if (!seen.has(e.dst)) {
        seen.add(e.dst);
        next.push(e.dst);
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  const list = [...hits.values()].sort((a, b) => b.score - a.score);
  const nodes = new Map(db.graphGetNodes(list.map((h) => h.id)).map((n) => [n.id, n]));
  for (const h of list) h.node = nodes.get(h.id);
  return { root, hits: list };
}

/** Undirected neighbourhood up to `depth`, any edge kind. */
export function neighbors(
  db: StorageAdapter,
  ref: string,
  depth = 1,
  kinds?: string[],
): { root: GraphNodeRow; edges: GraphEdgeRow[]; nodes: GraphNodeRow[] } | undefined {
  const root = resolveNode(db, ref);
  if (!root) return undefined;
  const seen = new Set([root.id]);
  let frontier = [root.id];
  const edges: GraphEdgeRow[] = [];
  for (let hop = 1; hop <= depth; hop++) {
    const batch = [...db.graphEdgesFrom(frontier, kinds), ...db.graphEdgesTo(frontier, kinds)];
    const next: string[] = [];
    for (const e of batch) {
      edges.push(e);
      for (const id of [e.src, e.dst]) {
        if (!seen.has(id)) {
          seen.add(id);
          next.push(id);
        }
      }
    }
    frontier = next;
    if (!frontier.length || edges.length > 2000) break;
  }
  const uniq = new Map(edges.map((e) => [`${e.src}|${e.dst}|${e.kind}|${e.source}`, e]));
  return { root, edges: [...uniq.values()], nodes: db.graphGetNodes([...seen]) };
}

/** Shortest undirected path between two nodes (BFS, depth ≤ 6). */
export function path(db: StorageAdapter, from: string, to: string): GraphEdgeRow[] | undefined {
  const a = resolveNode(db, from);
  const b = resolveNode(db, to);
  if (!a || !b) return undefined;
  const prev = new Map<string, GraphEdgeRow | null>([[a.id, null]]);
  let frontier = [a.id];
  for (let hop = 0; hop < 6 && frontier.length; hop++) {
    const next: string[] = [];
    for (const e of [...db.graphEdgesFrom(frontier), ...db.graphEdgesTo(frontier)]) {
      for (const [here, there] of [
        [e.src, e.dst],
        [e.dst, e.src],
      ] as const) {
        if (!prev.has(here) || prev.has(there)) continue;
        prev.set(there, e);
        next.push(there);
        if (there === b.id) {
          const out: GraphEdgeRow[] = [];
          let cur: string | undefined = b.id;
          while (cur && prev.get(cur)) {
            const edge: GraphEdgeRow = prev.get(cur)!;
            out.unshift(edge);
            cur = edge.src === cur ? edge.dst : edge.src;
          }
          return out;
        }
      }
    }
    frontier = next;
  }
  return undefined;
}

export interface Hotspot {
  id: string;
  path: string;
  kind: string;
  commits_90d: number;
  commits: number;
  last_touched: string;
  fan_in: number;
  fan_out: number;
  complexity: number;
  loc: number;
  /** 0..1 hotspot signal (fan-in, churn, complexity); not a quality grade. */
  score: number;
}

/**
 * Files (default) or symbols that deserve attention: ranked by the metrics score when
 * metrics exist, else by git churn alone (first run before the metrics pass).
 */
export function hotspots(
  db: StorageAdapter,
  limit = 15,
  opts: { kind?: "file" | "symbol" | undefined; pathPrefix?: string | undefined } = {},
): Hotspot[] {
  const symbolKinds = ["function", "class", "method"];
  const rows =
    opts.kind === "symbol"
      ? db.metricsTop({ kinds: symbolKinds, pathPrefix: opts.pathPrefix, limit })
      : db.metricsTop({ kind: "file", pathPrefix: opts.pathPrefix, limit });
  const gitMeta = (meta: string | null) => {
    if (!meta) return {};
    try {
      return JSON.parse(meta) as { commits_90d?: number; commits?: number; last_touched?: string };
    } catch {
      return {};
    }
  };
  if (rows.length) {
    const nodes = new Map(db.graphGetNodes(rows.map((r) => r.node_id)).map((n) => [n.id, n]));
    return rows.map((r) => {
      const n = nodes.get(r.node_id);
      const file = r.kind === "file" ? n : n?.path ? db.graphGetNode(fileId(n.path)) : undefined;
      const g = gitMeta(file?.meta ?? null);
      return {
        id: r.node_id,
        path: r.kind === "file" ? (r.path ?? r.node_id) : `${r.path} > ${n?.name ?? r.node_id}`,
        kind: r.kind,
        commits_90d: r.commits_90d,
        commits: g.commits ?? 0,
        last_touched: g.last_touched ?? "",
        fan_in: r.fan_in,
        fan_out: r.fan_out,
        complexity: r.complexity,
        loc: r.loc,
        score: r.score,
      };
    });
  }
  return db
    .graphFileNodes()
    .map((n) => ({ n, g: gitMeta(n.meta) }))
    .filter((x) => x.g.commits)
    .map(({ n, g }) => ({
      id: n.id,
      path: n.path ?? n.name,
      kind: "file",
      commits_90d: g.commits_90d ?? 0,
      commits: g.commits ?? 0,
      last_touched: g.last_touched ?? "",
      fan_in: 0,
      fan_out: 0,
      complexity: 0,
      loc: 0,
      score: 0,
    }))
    .sort((a, b) => b.commits_90d - a.commits_90d || b.commits - a.commits)
    .slice(0, limit);
}

export function coupled(
  db: StorageAdapter,
  limit = 15,
): Array<{ a: string; b: string; weight: number; count: number }> {
  const seen = new Set<string>();
  const out: Array<{ a: string; b: string; weight: number; count: number }> = [];
  for (const e of db.graphEdgesByKind("co_changes", limit * 4)) {
    const key = [e.src, e.dst].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const meta = e.meta ? (JSON.parse(e.meta) as { count?: number }) : {};
    out.push({ a: e.src.slice(5), b: e.dst.slice(5), weight: e.weight, count: meta.count ?? 0 });
    if (out.length >= limit) break;
  }
  return out;
}

/** Files nothing imports (candidates for entry points or dead code). */
export function orphans(db: StorageAdapter, limit = 30): string[] {
  const files = db.graphFileNodes().filter((n) => n.source === "tree-sitter");
  const imported = new Set(
    db
      .graphEdgesTo(
        files.map((f) => f.id),
        ["imports", "reexports"],
      )
      .map((e) => e.dst),
  );
  return files
    .filter((f) => !imported.has(f.id))
    .map((f) => f.path ?? f.name)
    .slice(0, limit);
}

const TEST_PATH = /(^|\/)(tests?|__tests__|spec|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const LIFECYCLE = new Set([
  "constructor",
  "default",
  "main",
  "render",
  "toString",
  "toJSON",
  "componentDidMount",
  "componentWillUnmount",
  "ngOnInit",
  "setup",
]);

export interface DeadCodeCandidate {
  node: GraphNodeRow;
  reason: string;
}

/**
 * Functions, methods and classes with no indexed caller, reference or subclass.
 * Exported symbols of files nothing imports are entry points and are left out, as are
 * tests, route handlers and lifecycle names. Dynamic dispatch, framework conventions
 * and files outside the index are invisible here, so these are candidates, not verdicts.
 */
export function deadCode(db: StorageAdapter, limit = 30): DeadCodeCandidate[] {
  const symbols = db.graphNodesByKind(["function", "method", "class"]);
  const degrees = db.graphDegrees(["calls", "references", "extends", "implements", "handles"]);
  const files = db.graphFileNodes();
  const importedFiles = new Set(
    db
      .graphEdgesTo(
        files.map((f) => f.id),
        ["imports", "reexports"],
      )
      .map((e) => e.dst),
  );
  const handlers = new Set(db.graphEdgesAll(["handles"]).map((e) => e.src));
  const out: DeadCodeCandidate[] = [];
  for (const s of symbols) {
    if (!s.path || TEST_PATH.test(s.path) || handlers.has(s.id)) continue;
    const short = s.name.split(".").pop()!;
    if (LIFECYCLE.has(short) || short.startsWith("_")) continue;
    if (degrees.get(s.id)?.fanIn) continue;
    const exported = !!s.meta && /"exported":true/.test(s.meta);
    const fileImported = importedFiles.has(fileId(s.path));
    if (exported && !fileImported) continue; // an entry point's public surface
    if (s.kind === "method" && !s.name.includes(".")) continue;
    out.push({
      node: s,
      reason: exported ? "exported but nothing in the index uses it" : "no callers or references",
    });
    if (out.length >= limit) break;
  }
  return out;
}

export interface RouteRow {
  id: string;
  method: string;
  path: string;
  framework: string;
  file: string;
  line: number | null;
  handlers: Array<{ id: string; name: string; path: string | null }>;
}

/** Every HTTP route in the graph with the symbols that handle it. */
export function routes(db: StorageAdapter, limit = 200): RouteRow[] {
  const nodes = db.graphNodesByKind(["route"]).slice(0, limit);
  const handles = db.graphEdgesTo(
    nodes.map((n) => n.id),
    ["handles"],
  );
  const handlerNodes = new Map(
    db.graphGetNodes([...new Set(handles.map((e) => e.src))]).map((n) => [n.id, n]),
  );
  return nodes
    .map((n) => {
      const meta = n.meta
        ? (JSON.parse(n.meta) as { method?: string; route?: string; framework?: string })
        : {};
      return {
        id: n.id,
        method: meta.method ?? n.name.split(" ")[0] ?? "",
        path: meta.route ?? n.name.slice(n.name.indexOf(" ") + 1),
        framework: meta.framework ?? "http",
        file: n.path ?? "",
        line: n.start_line,
        handlers: handles
          .filter((e) => e.dst === n.id)
          .map((e) => {
            const h = handlerNodes.get(e.src);
            return { id: e.src, name: h?.name ?? e.src, path: h?.path ?? null };
          }),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

// --- structured pattern query -----------------------------------------------------

export interface NodeFilter {
  id?: string | undefined;
  kind?: string | string[] | undefined;
  /** JS regular expression over the name (a plain substring also works). */
  name?: string | undefined;
  /** Substring of the path. */
  path?: string | undefined;
  /** Folder prefix of the path. */
  pathPrefix?: string | undefined;
}

export interface Pattern {
  from?: NodeFilter | undefined;
  edge?:
    | {
        kinds?: string[] | undefined;
        direction?: "out" | "in" | "both" | undefined;
        depth?: number | undefined;
      }
    | undefined;
  to?: NodeFilter | undefined;
  return?: "nodes" | "edges" | "paths" | undefined;
  limit?: number | undefined;
}

export interface PatternResult {
  starts: GraphNodeRow[];
  /** Nodes reached that satisfy `to` (all reached nodes when `to` is absent), nearest first. */
  nodes: Array<{ node: GraphNodeRow; hops: number }>;
  edges: GraphEdgeRow[];
  paths: GraphEdgeRow[][];
  truncated: boolean;
}

function nameMatcher(pattern: string | undefined): (name: string) => boolean {
  if (!pattern) return () => true;
  try {
    const re = new RegExp(pattern);
    return (name) => re.test(name);
  } catch {
    return (name) => name.includes(pattern);
  }
}

function matchesFilter(n: GraphNodeRow, f: NodeFilter | undefined, nameOk: (s: string) => boolean) {
  if (!f) return true;
  if (f.id && n.id !== f.id) return false;
  if (f.kind && !(Array.isArray(f.kind) ? f.kind : [f.kind]).includes(n.kind)) return false;
  if (f.path && !(n.path ?? "").includes(f.path)) return false;
  if (f.pathPrefix && !(n.path ?? "").startsWith(f.pathPrefix)) return false;
  return nameOk(n.name);
}

function candidates(db: StorageAdapter, f: NodeFilter, max: number): GraphNodeRow[] {
  if (f.id) {
    const n = resolveNode(db, f.id);
    return n ? [n] : [];
  }
  const nameOk = nameMatcher(f.name);
  const kinds = f.kind ? (Array.isArray(f.kind) ? f.kind : [f.kind]) : undefined;
  return db
    .graphFindNodes({ kinds, path: f.path, pathPrefix: f.pathPrefix, limit: max * 20 })
    .filter((n) => nameOk(n.name))
    .slice(0, max);
}

/**
 * `from -[edge]-> to`: start at nodes matching `from`, walk `depth` hops along the
 * given edge kinds and direction, keep what matches `to`. Without `from`, the walk
 * starts at `to` and runs the other way. Returns nodes, the edges that reached them,
 * and one shortest path per node.
 */
export function pattern(db: StorageAdapter, p: Pattern): PatternResult {
  const limit = p.limit ?? 50;
  const depth = Math.min(6, Math.max(0, p.edge?.depth ?? 1));
  let direction = p.edge?.direction ?? "out";
  let fromF = p.from;
  let toF = p.to;
  if (!fromF && toF) {
    fromF = toF;
    toF = undefined;
    direction = direction === "out" ? "in" : direction === "in" ? "out" : "both";
  }
  if (!fromF) return { starts: [], nodes: [], edges: [], paths: [], truncated: false };
  const starts = candidates(db, fromF, 200);
  const toOk = nameMatcher(toF?.name);
  const kinds = p.edge?.kinds;
  const parent = new Map<string, GraphEdgeRow | null>(starts.map((s) => [s.id, null]));
  const hopOf = new Map<string, number>(starts.map((s) => [s.id, 0]));
  let frontier = starts.map((s) => s.id);
  const reached: string[] = [];
  let truncated = false;
  for (let hop = 1; hop <= depth && frontier.length; hop++) {
    const batch: GraphEdgeRow[] = [];
    if (direction !== "in") batch.push(...db.graphEdgesFrom(frontier, kinds));
    if (direction !== "out") batch.push(...db.graphEdgesTo(frontier, kinds));
    const next: string[] = [];
    for (const e of batch) {
      const here = direction === "in" ? e.dst : direction === "out" ? e.src : undefined;
      const there =
        here === undefined ? (parent.has(e.src) ? e.dst : e.src) : here === e.src ? e.dst : e.src;
      if (parent.has(there)) continue;
      parent.set(there, e);
      hopOf.set(there, hop);
      next.push(there);
      reached.push(there);
    }
    frontier = next;
    if (reached.length > 5000) {
      truncated = true;
      break;
    }
  }
  const pool = depth === 0 ? starts.map((s) => s.id) : reached;
  const nodesById = new Map(db.graphGetNodes(pool).map((n) => [n.id, n]));
  const matched: Array<{ node: GraphNodeRow; hops: number }> = [];
  for (const id of pool) {
    const n = nodesById.get(id);
    if (!n || !matchesFilter(n, toF, toOk)) continue;
    matched.push({ node: n, hops: hopOf.get(id) ?? 0 });
  }
  matched.sort((a, b) => a.hops - b.hops || a.node.id.localeCompare(b.node.id));
  if (matched.length > limit) truncated = true;
  const kept = matched.slice(0, limit);
  const paths: GraphEdgeRow[][] = [];
  const edgeSet = new Map<string, GraphEdgeRow>();
  for (const m of kept) {
    const chain: GraphEdgeRow[] = [];
    let cur: string | undefined = m.node.id;
    while (cur && parent.get(cur)) {
      const e: GraphEdgeRow = parent.get(cur)!;
      chain.unshift(e);
      edgeSet.set(`${e.src}|${e.dst}|${e.kind}|${e.source}`, e);
      cur = e.src === cur ? e.dst : e.src;
    }
    paths.push(chain);
  }
  return { starts, nodes: kept, edges: [...edgeSet.values()], paths, truncated };
}
