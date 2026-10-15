import type { StorageAdapter } from "../storage/adapter.js";
import type { GraphMetricInput, GraphNodeRow } from "../storage/types.js";
import { commonDir, cycles, labelPropagation, type WeightedEdge } from "./clusters.js";
import { fileOf } from "./ids.js";

/** Kinds that count as code symbols for metrics (everything the parsers define inside a file). */
export const SYMBOL_KINDS = [
  "function",
  "class",
  "method",
  "interface",
  "trait",
  "type",
  "enum",
  "field",
  "variable",
  "route",
];

/** Edge kinds that mean "depends on" for fan-in/fan-out. */
export const DEPENDENCY_KINDS = [
  "calls",
  "references",
  "extends",
  "implements",
  "imports",
  "reexports",
  "handles",
];

export interface ClusterSummary {
  id: number;
  size: number;
  /** Common directory of the members, or the most common top-level folder. */
  label: string;
  /** Highest-scoring member files. */
  files: string[];
  /** Edges to other clusters: cluster id → count. */
  links: Record<string, number>;
}

export interface MetricsSummary {
  nodes: number;
  clusters: number;
  cycles: number;
}

function meta(n: GraphNodeRow): Record<string, unknown> {
  if (!n.meta) return {};
  try {
    return JSON.parse(n.meta) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** log-scaled 0..1 against the largest value of the group; a flat group scores 0. */
function normalizer(values: number[]): (v: number) => number {
  const max = Math.log1p(Math.max(0, ...values));
  return (v) => (max > 0 ? Math.log1p(Math.max(0, v)) / max : 0);
}

/**
 * Recompute graph_metrics for every file and symbol, plus module clusters and import
 * cycles (stored in meta `clusters` / `cycles`). The hotspot score mixes fan-in, recent
 * churn and complexity on a log scale; it points at places worth a look, it is not a
 * quality grade. Cheap enough to run after every reindex that changed something.
 */
export function computeMetrics(db: StorageAdapter): MetricsSummary {
  const files = db.graphFileNodes();
  const symbols = db.graphNodesByKind(SYMBOL_KINDS);
  const degrees = db.graphDegrees(DEPENDENCY_KINDS);

  // --- clusters over parsed files: imports (1.0 each) + co-change weight ----------
  // Git-only file nodes (docs, configs) and external stubs carry no code structure.
  const fileIds = files.filter((f) => f.source === "tree-sitter").map((f) => f.id);
  const fileSet = new Set(fileIds);
  const wEdges: WeightedEdge[] = [];
  const importEdges: Array<{ from: string; to: string }> = [];
  for (const e of db.graphEdgesAll(["imports", "reexports", "co_changes"])) {
    if (!fileSet.has(e.src) || !fileSet.has(e.dst)) continue;
    if (e.kind === "co_changes") wEdges.push({ a: e.src, b: e.dst, weight: e.weight });
    else {
      wEdges.push({ a: e.src, b: e.dst, weight: 1 });
      importEdges.push({ from: e.src, to: e.dst });
    }
  }
  const clusterOf = labelPropagation(fileIds, wEdges);
  const sccs = cycles(fileIds, importEdges);

  // --- per-file rows --------------------------------------------------------------
  const fileCommits = new Map<string, number>();
  const fileRows: GraphMetricInput[] = [];
  const symbolsByFile = new Map<string, GraphNodeRow[]>();
  for (const s of symbols) {
    const f = s.path ? `file:${s.path}` : undefined;
    if (!f) continue;
    const list = symbolsByFile.get(f) ?? [];
    list.push(s);
    symbolsByFile.set(f, list);
  }
  for (const f of files) {
    const m = meta(f);
    const syms = symbolsByFile.get(f.id) ?? [];
    const d = degrees.get(f.id) ?? { fanIn: 0, fanOut: 0 };
    // Fan-in of a file also counts whoever depends on its symbols.
    const symFanIn = syms.reduce((a, s) => a + (degrees.get(s.id)?.fanIn ?? 0), 0);
    const commits = num(m.commits_90d);
    fileCommits.set(f.id, commits);
    fileRows.push({
      node_id: f.id,
      kind: "file",
      path: f.path,
      fan_in: d.fanIn + symFanIn,
      fan_out: d.fanOut,
      loc: num(m.loc) || (f.end_line ?? 0),
      complexity: num(m.complexity) || syms.reduce((a, s) => a + num(meta(s).complexity), 0),
      commits_90d: commits,
      score: 0,
      cluster: clusterOf.get(f.id) ?? null,
    });
  }
  const symbolRows: GraphMetricInput[] = symbols.map((s) => {
    const d = degrees.get(s.id) ?? { fanIn: 0, fanOut: 0 };
    const m = meta(s);
    const file = s.path ? `file:${s.path}` : undefined;
    return {
      node_id: s.id,
      kind: s.kind,
      path: s.path,
      fan_in: d.fanIn,
      fan_out: d.fanOut,
      loc: num(m.loc) || Math.max(0, (s.end_line ?? 0) - (s.start_line ?? 0) + 1),
      complexity: num(m.complexity),
      commits_90d: file ? (fileCommits.get(file) ?? 0) : 0,
      score: 0,
      cluster: file ? (clusterOf.get(file) ?? null) : null,
    };
  });
  for (const group of [fileRows, symbolRows]) {
    const nIn = normalizer(group.map((r) => r.fan_in));
    const nCh = normalizer(group.map((r) => r.commits_90d));
    const nCx = normalizer(group.map((r) => r.complexity));
    for (const r of group) {
      r.score = Number(
        (0.4 * nIn(r.fan_in) + 0.4 * nCh(r.commits_90d) + 0.2 * nCx(r.complexity)).toFixed(4),
      );
    }
  }
  db.metricsReplace([...fileRows, ...symbolRows]);

  // --- cluster summaries ----------------------------------------------------------
  const members = new Map<number, GraphMetricInput[]>();
  for (const r of fileRows) {
    if (r.cluster === null) continue;
    const list = members.get(r.cluster) ?? [];
    list.push(r);
    members.set(r.cluster, list);
  }
  const links = new Map<number, Map<number, number>>();
  for (const e of importEdges) {
    const a = clusterOf.get(e.from);
    const b = clusterOf.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    const row = links.get(a) ?? new Map<number, number>();
    row.set(b, (row.get(b) ?? 0) + 1);
    links.set(a, row);
  }
  const summaries: ClusterSummary[] = [...members.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, rows]) => {
      const paths = rows.map((r) => r.path ?? "");
      const dir = commonDir(paths);
      return {
        id,
        size: rows.length,
        label: dir || topFolder(paths),
        files: [...rows]
          .sort((a, b) => b.score - a.score || a.node_id.localeCompare(b.node_id))
          .slice(0, 5)
          .map((r) => r.path ?? r.node_id),
        links: Object.fromEntries([...(links.get(id) ?? [])].map(([k, v]) => [String(k), v])),
      };
    });
  db.metaSet("clusters", JSON.stringify(summaries));
  db.metaSet("cycles", JSON.stringify(sccs.map((c) => c.map((id) => fileOf(id) ?? id))));
  db.metaSet("metrics_at", String(Date.now()));
  return {
    nodes: fileRows.length + symbolRows.length,
    clusters: summaries.length,
    cycles: sccs.length,
  };
}

function topFolder(paths: string[]): string {
  const counts = new Map<string, number>();
  for (const p of paths) {
    const top = p.includes("/") ? `${p.split("/")[0]}/` : "(root)";
    counts.set(top, (counts.get(top) ?? 0) + 1);
  }
  return (
    [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? ""
  );
}

export function readClusters(db: StorageAdapter): ClusterSummary[] {
  try {
    return JSON.parse(db.metaGet("clusters") ?? "[]") as ClusterSummary[];
  } catch {
    return [];
  }
}

export function readCycles(db: StorageAdapter): string[][] {
  try {
    return JSON.parse(db.metaGet("cycles") ?? "[]") as string[][];
  } catch {
    return [];
  }
}
