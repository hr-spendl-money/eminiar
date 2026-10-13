import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getContext, type ProjectContext } from "../context.js";
import { embeddingStatus, kickEmbedding, vectorRanker } from "../embeddings/queue.js";
import { nodeLabel } from "../graph/format.js";
import { coupled, dependencies, hotspots, impact, neighbors, orphans } from "../graph/query.js";
import { fullDoctor } from "../install/doctor.js";
import {
  gitignoreHint,
  list,
  MEMORY_KINDS,
  memoriesDir,
  read,
  reconcile,
  remove,
  rename,
  write,
} from "../memory/store.js";
import { paths } from "../paths.js";
import { search } from "../search/pipeline.js";
import { getCurrentSession } from "../session/current.js";
import { globalDb } from "../stats/global.js";
import { summarize } from "../stats/record.js";
import { getStorage } from "../storage/index.js";
import { SqliteAdapter } from "../storage/sqlite/adapter.js";
import type { GraphEdgeRow, GraphNodeRow, StatRow } from "../storage/types.js";
import { emIndex } from "../tools/em_index.js";
import { emPurge } from "../tools/em_purge.js";
import type { ToolResult } from "../tools/types.js";

/** Every project that has a database under ~/.eminiar/projects, with its root when known. */
export function listProjects(): Array<{ id: string; root: string | null }> {
  const dir = paths().projects;
  const out: Array<{ id: string; root: string | null }> = [];
  for (const id of readdirSync(dir, { withFileTypes: true })) {
    if (!id.isDirectory()) continue;
    const db = join(dir, id.name, "eminiar.db");
    try {
      const a = new SqliteAdapter(db, { vectors: false });
      out.push({ id: id.name, root: a.sessionLatest()?.project_root ?? null });
      a.close();
    } catch {
      // skip unreadable
    }
  }
  return out;
}

export function ctxFor(root?: string): ProjectContext {
  return getContext(root);
}

// --- stats ---------------------------------------------------------------

function groupBySession(rows: StatRow[]): Map<string, StatRow[]> {
  const m = new Map<string, StatRow[]>();
  for (const r of rows) {
    const arr = m.get(r.session_id) ?? [];
    arr.push(r);
    m.set(r.session_id, arr);
  }
  return m;
}

export function statsPayload(ctx: ProjectContext) {
  const db = getStorage(ctx);
  const sessionId = getCurrentSession(ctx);
  const g = globalDb();
  const onboardingDir = join(memoriesDir(ctx), "onboarding");
  const onboarding = existsSync(onboardingDir)
    ? readdirSync(onboardingDir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.slice(0, -3))
    : [];
  return {
    project: ctx.root,
    projectId: ctx.id,
    dbPath: ctx.dbPath,
    session: {
      id: sessionId,
      ...summarize(db.statsBySession(sessionId)),
      tools: db.statsBySession(sessionId),
    },
    projectTotals: summarize(db.statsAll()),
    lifetime: { ...summarize(g.lifetime()), tools: g.lifetime() },
    daily: g.daily(30).reverse(),
    index: {
      documents: db.countDocuments(),
      bySource: Object.fromEntries(
        ["exec", "batch", "file", "url", "code", "memory", "session", "inline"].map((s) => [
          s,
          db.countDocuments(s),
        ]),
      ),
      vectors: db.vecCount(),
      pendingEmbeddings: db.unembeddedChunkIds(1).length > 0,
      embeddings: embeddingStatus(ctx, db),
      memories: db.memoryCount(),
      graph: db.graphCounts(),
    },
    memoriesDir: ctx.config.memories.dir,
    onboarding,
    routing: ctx.config.routing.mode,
    sessions: sessionsPayload(ctx, 8),
  };
}

export function sessionsPayload(ctx: ProjectContext, limit: number) {
  const db = getStorage(ctx);
  const byId = groupBySession(db.statsAll());
  const current = getCurrentSession(ctx);
  return db.sessionsRecent(limit).map((s) => ({
    id: s.id,
    current: s.id === current,
    started_at: s.started_at,
    ended_at: s.ended_at,
    source: s.source,
    last_prompt: s.last_prompt,
    ...summarize(byId.get(s.id) ?? []),
  }));
}

// --- search --------------------------------------------------------------

export async function searchPayload(
  ctx: ProjectContext,
  q: string,
  mode: "hybrid" | "lexical" | "semantic",
  limit: number,
  source?: string,
) {
  const db = getStorage(ctx);
  const vectorSearch = mode === "lexical" ? undefined : await vectorRanker(ctx, db);
  const r = await search(db, q, {
    limit,
    mode,
    vectorSearch,
    ...(source ? { filters: { source } } : {}),
  });
  return {
    query: r.query,
    used: r.used,
    corrections: r.corrections,
    hits: r.hits.map((h) => ({
      title: h.chunk.title,
      source: h.chunk.document.source,
      uri: h.chunk.document.uri,
      doc: h.chunk.document_id,
      chunk: h.chunk.ord,
      lines: h.chunk.start_line ? `${h.chunk.start_line}-${h.chunk.end_line}` : null,
      created: h.chunk.document.created_at,
      score: h.score,
      snippet: h.snippet,
    })),
  };
}

// --- memories ------------------------------------------------------------

export const memoryKinds = [...MEMORY_KINDS];

export function memoriesPayload(
  ctx: ProjectContext,
  opts: { kind?: string | undefined; topic?: string | undefined } = {},
) {
  const db = getStorage(ctx);
  const summary = reconcile(ctx, db);
  const rows = list(ctx, db, { kind: opts.kind, topic: opts.topic, limit: 1000 }).map((r) => ({
    id: r.id,
    name: r.name,
    topic: r.name?.includes("/") ? r.name.split("/")[0] : "",
    kind: r.kind,
    content: r.content,
    tags: r.tags ? (JSON.parse(r.tags) as string[]) : [],
    related: r.node_ids ? (JSON.parse(r.node_ids) as string[]) : [],
    path: r.path,
    size: r.file_size,
    created_at: r.created_at,
    updated_at: r.updated_at ?? r.created_at,
  }));
  const topics = [...new Set(rows.map((r) => r.topic).filter(Boolean))].sort();
  return {
    dir: ctx.config.memories.dir,
    kinds: memoryKinds,
    topics,
    skipped: summary.skipped,
    gitignored: !!gitignoreHint(ctx),
    memories: rows,
  };
}

export function memoryBody(ctx: ProjectContext, name: string) {
  const m = read(ctx, getStorage(ctx), name);
  return m ? { ...m, row: undefined } : undefined;
}

export interface MemoryWrite {
  kind?: string | undefined;
  content: string;
  name?: string | undefined;
  tags?: string[] | undefined;
  related?: string[] | undefined;
}

export function addMemory(ctx: ProjectContext, input: MemoryWrite) {
  const db = getStorage(ctx);
  reconcile(ctx, db);
  const r = write(ctx, db, {
    kind: input.kind ?? "fact",
    content: input.content,
    name: input.name,
    tags: input.tags,
    related: input.related,
    sessionId: "dashboard",
  });
  kickEmbedding(ctx, db);
  return { id: r.row.id, name: r.name, path: r.path, created: r.created };
}

/** Replace the whole memory (body, kind, tags, related); the created date is kept. */
export function updateMemory(ctx: ProjectContext, name: string, input: MemoryWrite) {
  const db = getStorage(ctx);
  const prev = read(ctx, db, name);
  if (!prev) throw new Error(`memory "${name}" does not exist`);
  const r = write(ctx, db, {
    name,
    kind: input.kind ?? prev.kind,
    content: input.content,
    tags: input.tags ?? prev.tags,
    related: input.related ?? prev.related,
    replace: true,
    sessionId: "dashboard",
  });
  kickEmbedding(ctx, db);
  return { id: r.row.id, name: r.name, path: r.path };
}

export function renameMemory(ctx: ProjectContext, from: string, to: string) {
  const db = getStorage(ctx);
  const r = rename(ctx, db, from, to);
  return { name: to, ...r };
}

/** By row id (old UI) or by name; file-backed memories lose their file too. */
export function deleteMemory(ctx: ProjectContext, ref: number | string) {
  const db = getStorage(ctx);
  if (typeof ref === "string") return remove(ctx, db, ref);
  const row = db.memoryGet(ref);
  if (row?.name) return remove(ctx, db, row.name);
  db.memoryDelete(ref);
  return !!row;
}

// --- graph ---------------------------------------------------------------

export interface VisNode {
  id: string;
  label: string;
  kind: string;
  path: string | null;
  root?: boolean | undefined;
  /** Only for file nodes with git signals. */
  commits?: number | undefined;
}
export interface VisEdge {
  src: string;
  dst: string;
  kind: string;
  weight: number;
}

function visNode(n: GraphNodeRow | undefined, id: string, root = false): VisNode {
  const meta = n?.meta ? (JSON.parse(n.meta) as { commits?: number }) : {};
  return {
    id,
    label: n ? (n.kind === "file" ? n.name : n.name) : id,
    kind: n?.kind ?? id.split(":")[0] ?? "?",
    path: n?.path ?? null,
    root,
    commits: meta.commits,
  };
}

function visEdges(edges: GraphEdgeRow[]): VisEdge[] {
  return edges.map((e) => ({ src: e.src, dst: e.dst, kind: e.kind, weight: e.weight }));
}

/**
 * The file-level map of the project: every tree-sitter file node, `imports` edges
 * between files, and `co_changes` edges above `minCoChange`. Packages are folded
 * away so the picture stays about the repo. Capped at `limit` files by degree.
 */
export function graphMap(
  ctx: ProjectContext,
  opts: {
    limit?: number | undefined;
    coChanges?: boolean | undefined;
    pathFilter?: string | undefined;
  } = {},
) {
  const db = getStorage(ctx);
  const limit = opts.limit ?? 150;
  let files = db.graphFileNodes();
  if (opts.pathFilter)
    files = files.filter((f) => (f.path ?? f.name).includes(opts.pathFilter as string));
  const ids = files.map((f) => f.id);
  const idSet = new Set(ids);
  const kinds = opts.coChanges === false ? ["imports"] : ["imports", "co_changes"];
  const raw = db.graphEdgesFrom(ids, kinds).filter((e) => idSet.has(e.dst));
  const degree = new Map<string, number>();
  for (const e of raw) {
    degree.set(e.src, (degree.get(e.src) ?? 0) + 1);
    degree.set(e.dst, (degree.get(e.dst) ?? 0) + 1);
  }
  const keep = new Set(
    [...files]
      .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
      .slice(0, limit)
      .map((f) => f.id),
  );
  const seenEdge = new Set<string>();
  const edges: VisEdge[] = [];
  for (const e of raw) {
    if (!keep.has(e.src) || !keep.has(e.dst)) continue;
    if (e.kind === "co_changes" && e.weight < 0.3) continue;
    const key =
      e.kind === "co_changes"
        ? `${[e.src, e.dst].sort().join("|")}|co`
        : `${e.src}|${e.dst}|${e.kind}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    edges.push({ src: e.src, dst: e.dst, kind: e.kind, weight: e.weight });
  }
  return {
    mode: "map",
    total: files.length,
    nodes: files.filter((f) => keep.has(f.id)).map((f) => visNode(f, f.id)),
    edges,
  };
}

/** Undirected neighbourhood around a node as nodes + edges, for the force layout. */
export function graphSubgraph(
  ctx: ProjectContext,
  ref: string,
  opts: {
    depth?: number | undefined;
    limit?: number | undefined;
    kinds?: string[] | undefined;
  } = {},
) {
  const db = getStorage(ctx);
  const r = neighbors(db, ref, opts.depth ?? 1, opts.kinds);
  if (!r) return { error: "unknown node" };
  const limit = opts.limit ?? 120;
  const nodeMap = new Map(r.nodes.map((n) => [n.id, n]));
  // keep the root plus the highest-weight edges
  const edges = [...r.edges].sort((a, b) => b.weight * b.confidence - a.weight * a.confidence);
  const keep = new Set<string>([r.root.id]);
  const out: GraphEdgeRow[] = [];
  for (const e of edges) {
    const grows = Number(!keep.has(e.src)) + Number(!keep.has(e.dst));
    if (keep.size + grows > limit) continue;
    keep.add(e.src);
    keep.add(e.dst);
    out.push(e);
  }
  return {
    mode: "subgraph",
    root: r.root.id,
    rootLabel: nodeLabel(r.root, r.root.id),
    truncated: r.nodes.length > keep.size,
    nodes: [...keep].map((id) => visNode(nodeMap.get(id), id, id === r.root.id)),
    edges: visEdges(out),
  };
}

export function graphPayload(ctx: ProjectContext, node: string, mode: string, limit: number) {
  const db = getStorage(ctx);
  if (mode === "hotspots") return { preset: mode, rows: hotspots(db, limit) };
  if (mode === "coupled") return { preset: mode, rows: coupled(db, limit) };
  if (mode === "orphans") return { preset: mode, rows: orphans(db, limit) };
  if (mode === "find")
    return {
      preset: mode,
      rows: db
        .graphFindNodes({ query: node, limit })
        .map((n) => ({ id: n.id, label: nodeLabel(n, n.id), kind: n.kind, path: n.path })),
    };
  if (mode === "dependencies") {
    const r = dependencies(db, node);
    return r
      ? {
          root: r.root.id,
          rootLabel: nodeLabel(r.root, r.root.id),
          hits: r.hits.slice(0, limit).map((h) => ({
            id: h.id,
            label: nodeLabel(h.node, h.id),
            kind: h.node?.kind ?? "?",
            score: h.score,
            reasons: h.reasons,
          })),
        }
      : { error: "unknown node" };
  }
  if (mode === "neighbors") {
    const r = neighbors(db, node);
    if (!r) return { error: "unknown node" };
    const nodes = new Map(r.nodes.map((n) => [n.id, n]));
    return {
      root: r.root.id,
      rootLabel: nodeLabel(r.root, r.root.id),
      edges: r.edges.slice(0, limit).map((e) => ({
        src: nodeLabel(nodes.get(e.src), e.src),
        kind: e.kind,
        dst: nodeLabel(nodes.get(e.dst), e.dst),
        weight: e.weight,
      })),
    };
  }
  const r = impact(db, node);
  return r
    ? {
        root: r.root.id,
        rootLabel: nodeLabel(r.root, r.root.id),
        hits: r.hits.slice(0, limit).map((h) => ({
          id: h.id,
          label: nodeLabel(h.node, h.id),
          kind: h.node?.kind ?? "?",
          score: h.score,
          reasons: h.reasons,
        })),
      }
    : { error: "unknown node" };
}

// --- sessions & events ---------------------------------------------------

export function eventsPayload(
  ctx: ProjectContext,
  opts: { limit: number; session?: string | undefined; categories?: string[] | undefined },
) {
  const db = getStorage(ctx);
  const rows = opts.session
    ? db.eventsBySession(opts.session, {
        limit: opts.limit,
        ...(opts.categories ? { categories: opts.categories } : {}),
      })
    : db.eventsRecent(opts.limit, opts.categories);
  return rows.map((e) => ({
    id: e.id,
    ts: e.ts,
    session: e.session_id,
    category: e.category,
    priority: e.priority,
    tool: e.tool,
    document: e.document_id,
    payload: JSON.parse(e.payload) as unknown,
  }));
}

// --- doctor & actions ----------------------------------------------------

export async function doctorPayload(fix = false) {
  return fullDoctor({ fix });
}

export type ActionName =
  | "reindex"
  | "index"
  | "purge"
  | "doctor"
  | "embed"
  | "reconcile"
  | "purge-fetch-cache";

export interface ActionInput {
  action: ActionName;
  scope?: string | undefined;
  full?: boolean | undefined;
  path?: string | undefined;
  glob?: string[] | undefined;
  source?: string | undefined;
  confirm?: boolean | undefined;
  fix?: boolean | undefined;
}

function toolText(r: ToolResult): string {
  return r.content.map((c) => c.text).join("\n");
}

/**
 * Mutating operations the dashboard exposes. Each returns a plain-text report the
 * page shows in its action log. Purge needs `confirm` exactly like em_purge.
 */
export async function runAction(
  ctx: ProjectContext,
  input: ActionInput,
): Promise<{ ok: boolean; output: string; ms: number }> {
  const started = Date.now();
  const done = (ok: boolean, output: string) => ({ ok, output, ms: Date.now() - started });
  switch (input.action) {
    case "reindex": {
      const { emReindex } = await import("../tools/em_graph.js");
      const scope = (input.scope ?? "all") as "all";
      const r = await emReindex.handler({ scope, full: !!input.full }, ctx);
      return done(!r.isError, toolText(r));
    }
    case "embed": {
      const { emReindex } = await import("../tools/em_graph.js");
      const r = await emReindex.handler({ scope: "embeddings" }, ctx);
      return done(!r.isError, toolText(r));
    }
    case "index": {
      if (!input.path?.trim()) return done(false, "path required");
      const r = await emIndex.handler(
        {
          path: input.path.trim(),
          glob: input.glob?.length ? input.glob : undefined,
          source: input.source || undefined,
        },
        ctx,
      );
      return done(!r.isError, toolText(r));
    }
    case "reconcile": {
      const s = reconcile(ctx, getStorage(ctx));
      return done(
        true,
        `memories: ${s.files} files, ${s.synced} synced, ${s.removed} removed, ${s.migrated} migrated${s.skipped.length ? `, skipped: ${s.skipped.join(", ")}` : ""}`,
      );
    }
    case "purge": {
      if (!input.confirm) return done(false, "refusing to purge without confirm");
      const scope = input.scope as "index" | "sessions" | "graph" | "memories" | "all" | undefined;
      if (!scope) return done(false, "scope required");
      const r = await emPurge.handler({ scope, confirm: true }, ctx);
      return done(!r.isError, toolText(r));
    }
    case "purge-fetch-cache": {
      globalDb().purgeCache();
      return done(true, "fetch cache emptied");
    }
    case "doctor": {
      const checks = await fullDoctor({ fix: !!input.fix });
      const bad = checks.filter((c) => !c.ok);
      return done(
        bad.length === 0,
        checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`).join("\n"),
      );
    }
    default:
      return done(false, `unknown action ${String(input.action)}`);
  }
}
