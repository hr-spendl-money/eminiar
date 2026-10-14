import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectContext } from "../context.js";
import { list as listMemories } from "../memory/store.js";
import type { StorageAdapter } from "../storage/adapter.js";
import type { GraphMetricRow } from "../storage/types.js";
import { type ClusterSummary, readClusters, readCycles } from "./metrics.js";
import { type Hotspot, hotspots, orphans, type RouteRow, routes } from "./query.js";

export const ASPECTS = [
  "overview",
  "folders",
  "entry_points",
  "routes",
  "hotspots",
  "clusters",
  "cycles",
  "decisions",
] as const;
export type Aspect = (typeof ASPECTS)[number];

export interface FolderRow {
  path: string;
  files: number;
  loc: number;
  /** Mean hotspot score of the files inside. */
  score: number;
  languages: Record<string, number>;
}

export interface EntryPoint {
  kind: "bin" | "main" | "exports" | "script" | "orphan";
  name: string;
  path: string;
}

export interface Architecture {
  project: {
    name?: string | undefined;
    version?: string | undefined;
    description?: string | undefined;
    root: string;
  };
  overview: {
    files: number;
    symbols: number;
    edges: number;
    languages: Record<string, number>;
    coverage: Record<string, number>;
    indexedHead?: string | undefined;
    metricsAt?: number | undefined;
  };
  folders: FolderRow[];
  entryPoints: EntryPoint[];
  routes: RouteRow[];
  hotspots: Hotspot[];
  clusters: ClusterSummary[];
  cycles: string[][];
  decisions: Array<{ name: string; title: string; status: string; updated: number }>;
}

function pkgJson(root: string): Record<string, unknown> {
  try {
    const f = join(root, "package.json");
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Fold file metrics into folders: every top-level folder, plus the children of large ones. */
export function folderRows(files: GraphMetricRow[], languages: Map<string, string>): FolderRow[] {
  const acc = new Map<
    string,
    { files: number; loc: number; score: number; langs: Record<string, number> }
  >();
  const add = (key: string, r: GraphMetricRow) => {
    const a = acc.get(key) ?? { files: 0, loc: 0, score: 0, langs: {} };
    a.files++;
    a.loc += r.loc;
    a.score += r.score;
    const l = languages.get(r.path ?? "") ?? "other";
    a.langs[l] = (a.langs[l] ?? 0) + 1;
    acc.set(key, a);
  };
  for (const r of files) {
    const parts = (r.path ?? "").split("/");
    add(parts.length > 1 ? `${parts[0]}/` : "(root)", r);
    if (parts.length > 2) add(`${parts[0]}/${parts[1]}/`, r);
  }
  const rows = [...acc.entries()].map(([path, a]) => ({
    path,
    files: a.files,
    loc: a.loc,
    score: Number((a.score / a.files).toFixed(3)),
    languages: a.langs,
  }));
  const top = new Map(rows.filter((r) => r.path.split("/").length <= 2).map((r) => [r.path, r]));
  // Keep second-level folders only under top-level folders with enough files to be worth splitting.
  return rows
    .filter((r) => {
      const segs = r.path.split("/");
      if (segs.length <= 2) return true;
      return (top.get(`${segs[0]}/`)?.files ?? 0) >= 12;
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function entryPoints(root: string, db: StorageAdapter): EntryPoint[] {
  const pkg = pkgJson(root);
  const out: EntryPoint[] = [];
  const push = (kind: EntryPoint["kind"], name: string, path: unknown) => {
    if (typeof path !== "string") return;
    const clean = path.replace(/^\.\//, "");
    if (!out.some((e) => e.kind === kind && e.name === name)) out.push({ kind, name, path: clean });
  };
  const bin = pkg.bin;
  if (typeof bin === "string") push("bin", String(pkg.name ?? "bin"), bin);
  else if (bin && typeof bin === "object")
    for (const [k, v] of Object.entries(bin as Record<string, unknown>)) push("bin", k, v);
  for (const k of ["main", "module", "source"]) push("main", k, pkg[k]);
  const ex = pkg.exports;
  if (typeof ex === "string") push("exports", ".", ex);
  else if (ex && typeof ex === "object") {
    for (const [k, v] of Object.entries(ex as Record<string, unknown>)) {
      const target =
        typeof v === "string"
          ? v
          : v && typeof v === "object"
            ? Object.values(v as Record<string, unknown>).find((x) => typeof x === "string")
            : undefined;
      if (k.startsWith(".")) push("exports", k, target);
    }
  }
  const scripts = pkg.scripts;
  if (scripts && typeof scripts === "object") {
    for (const [k, v] of Object.entries(scripts as Record<string, unknown>).slice(0, 12)) {
      if (typeof v === "string") out.push({ kind: "script", name: k, path: v.slice(0, 80) });
    }
  }
  for (const p of orphans(db, 8)) {
    if (!/\.(test|spec)\./.test(p) && !out.some((e) => e.path === p))
      out.push({ kind: "orphan", name: p.split("/").pop() ?? p, path: p });
  }
  return out;
}

/**
 * The structured picture of a project: what it is, how it is laid out, where it is
 * entered, its HTTP surface, hotspots, module clusters, import cycles and the
 * accepted decisions on record. Everything comes from the graph, metrics and memories;
 * nothing here reads source files.
 */
export function architecture(
  ctx: ProjectContext,
  db: StorageAdapter,
  aspects: readonly Aspect[] = ASPECTS,
): Architecture {
  const want = new Set(aspects);
  const pkg = pkgJson(ctx.root);
  const fileRows = db.metricsTop({ kind: "file", limit: 100_000 });
  const languages = new Map(db.fileIndexAll().map((r) => [r.path, r.language ?? "other"] as const));
  const langCounts: Record<string, number> = {};
  for (const l of languages.values()) langCounts[l] = (langCounts[l] ?? 0) + 1;
  const counts = db.graphCounts();
  const nodeCounts = db.graphNodeCounts();
  const symbols = Object.entries(nodeCounts)
    .filter(([k]) => !["file", "package", "person", "concept", "memory"].includes(k))
    .reduce((a, [, n]) => a + n, 0);
  const out: Architecture = {
    project: {
      name: typeof pkg.name === "string" ? pkg.name : undefined,
      version: typeof pkg.version === "string" ? pkg.version : undefined,
      description: typeof pkg.description === "string" ? pkg.description : undefined,
      root: ctx.root,
    },
    overview: {
      files: fileRows.filter((r) => languages.has(r.path ?? "")).length,
      symbols,
      edges: counts.edges,
      languages: langCounts,
      coverage: db.fileIndexSummary().byStatus,
      indexedHead: db.metaGet("last_git_sha"),
      metricsAt: Number(db.metaGet("metrics_at") ?? 0) || undefined,
    },
    folders: want.has("folders") ? folderRows(fileRows, languages) : [],
    entryPoints: want.has("entry_points") ? entryPoints(ctx.root, db) : [],
    routes: want.has("routes") ? routes(db) : [],
    hotspots: want.has("hotspots") ? hotspots(db, 12) : [],
    clusters: want.has("clusters") ? readClusters(db) : [],
    cycles: want.has("cycles") ? readCycles(db) : [],
    decisions: want.has("decisions")
      ? listMemories(ctx, db, { kind: "decision", limit: 50 })
          .filter((r) => (r.status ?? "accepted") === "accepted")
          .map((r) => ({
            name: r.name ?? "",
            title:
              r.content
                .split("\n")[0]
                ?.replace(/^#+\s*/, "")
                .slice(0, 120) ?? "",
            status: r.status ?? "accepted",
            updated: r.updated_at ?? r.created_at,
          }))
      : [],
  };
  return out;
}

/** Compact text for the MCP tool; sections only for requested aspects. */
export function formatArchitecture(a: Architecture, aspects: readonly Aspect[] = ASPECTS): string {
  const want = new Set(aspects);
  const lines: string[] = [];
  const o = a.overview;
  lines.push(
    `${a.project.name ?? a.project.root}${a.project.version ? ` v${a.project.version}` : ""}${a.project.description ? ` — ${a.project.description}` : ""}`,
  );
  lines.push(
    `${o.files} files, ${o.symbols} symbols, ${o.edges} edges · ${Object.entries(o.languages)
      .sort((x, y) => y[1] - x[1])
      .map(([l, n]) => `${l} ${n}`)
      .join(", ")}${
      o.coverage.skipped || o.coverage.unsupported || o.coverage.partial
        ? ` · coverage: ${o.coverage.partial ?? 0} partial, ${o.coverage.skipped ?? 0} skipped, ${o.coverage.unsupported ?? 0} unsupported`
        : ""
    }${o.indexedHead ? ` · git ${o.indexedHead.slice(0, 7)}` : ""}`,
  );
  if (want.has("folders") && a.folders.length) {
    lines.push("folders:");
    for (const f of a.folders.filter((x) => x.path.split("/").length <= 2))
      lines.push(
        `- ${f.path} · ${f.files} files · ${f.loc} loc${f.score ? ` · heat ${f.score}` : ""}`,
      );
  }
  if (want.has("entry_points") && a.entryPoints.length) {
    lines.push("entry points:");
    for (const e of a.entryPoints.filter((x) => x.kind !== "script"))
      lines.push(`- ${e.kind} ${e.name} → ${e.path}`);
    const scripts = a.entryPoints.filter((x) => x.kind === "script");
    if (scripts.length) lines.push(`- scripts: ${scripts.map((s) => s.name).join(", ")}`);
  }
  if (want.has("routes")) {
    lines.push(a.routes.length ? `routes (${a.routes.length}):` : "routes: none detected");
    for (const r of a.routes.slice(0, 40))
      lines.push(
        `- ${r.method} ${r.path} · ${r.framework} · ${r.handlers.map((h) => h.name).join(", ") || r.file}${r.line ? ` (${r.file}:${r.line})` : ""}`,
      );
    if (a.routes.length > 40) lines.push(`… ${a.routes.length - 40} more`);
  }
  if (want.has("hotspots") && a.hotspots.length) {
    lines.push("hotspots (fan-in · commits/90d · complexity → score):");
    for (const h of a.hotspots)
      lines.push(`- ${h.path} · ${h.fan_in} · ${h.commits_90d} · ${h.complexity} → ${h.score}`);
  }
  if (want.has("clusters") && a.clusters.length) {
    lines.push(`clusters (${a.clusters.length}, by connectivity, not a boundary claim):`);
    for (const c of a.clusters.slice(0, 12))
      lines.push(
        `- #${c.id} ${c.label} · ${c.size} files · e.g. ${c.files.slice(0, 3).join(", ")}`,
      );
    if (a.clusters.length > 12) lines.push(`… ${a.clusters.length - 12} more`);
  }
  if (want.has("cycles")) {
    if (!a.cycles.length) lines.push("import cycles: none");
    else {
      lines.push(`import cycles (${a.cycles.length}):`);
      for (const c of a.cycles.slice(0, 8))
        lines.push(`- ${c.slice(0, 6).join(" → ")}${c.length > 6 ? ` … (${c.length} files)` : ""}`);
    }
  }
  if (want.has("decisions")) {
    if (!a.decisions.length) lines.push('decisions: none recorded (em_remember {kind:"decision"})');
    else {
      lines.push(`decisions (${a.decisions.length} accepted):`);
      for (const d of a.decisions.slice(0, 15)) lines.push(`- ${d.name}: ${d.title}`);
    }
  }
  return lines.join("\n");
}
