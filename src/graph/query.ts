import type { StorageAdapter } from "../storage/adapter.js";
import type { GraphEdgeRow, GraphNodeRow } from "../storage/types.js";
import { fileId, fileOf, symId } from "./ids.js";

export const STRUCTURAL = ["imports", "calls", "extends", "implements", "references"];

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

export function hotspots(
  db: StorageAdapter,
  limit = 15,
): Array<{ path: string; commits_90d: number; commits: number; last_touched: string }> {
  return db
    .graphFileNodes()
    .map((n) => ({
      path: n.path ?? n.name,
      ...(n.meta
        ? (JSON.parse(n.meta) as { commits_90d?: number; commits?: number; last_touched?: string })
        : {}),
    }))
    .filter((f) => f.commits)
    .map((f) => ({
      path: f.path,
      commits_90d: f.commits_90d ?? 0,
      commits: f.commits ?? 0,
      last_touched: f.last_touched ?? "",
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
        ["imports"],
      )
      .map((e) => e.dst),
  );
  return files
    .filter((f) => !imported.has(f.id))
    .map((f) => f.path ?? f.name)
    .slice(0, limit);
}
