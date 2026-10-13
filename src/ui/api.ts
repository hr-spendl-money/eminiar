import { readdirSync } from "node:fs";
import { join } from "node:path";
import { getContext, type ProjectContext } from "../context.js";
import { vectorRanker } from "../embeddings/queue.js";
import { nodeLabel } from "../graph/format.js";
import { coupled, dependencies, hotspots, impact, neighbors, orphans } from "../graph/query.js";
import { indexContent } from "../index/indexer.js";
import { fullDoctor } from "../install/doctor.js";
import { paths } from "../paths.js";
import { search } from "../search/pipeline.js";
import { getCurrentSession } from "../session/current.js";
import { globalDb } from "../stats/global.js";
import { summarize } from "../stats/record.js";
import { getStorage } from "../storage/index.js";
import { SqliteAdapter } from "../storage/sqlite/adapter.js";

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

export function statsPayload(ctx: ProjectContext) {
  const db = getStorage(ctx);
  const sessionId = getCurrentSession(ctx);
  const g = globalDb();
  return {
    project: ctx.root,
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
        ["exec", "batch", "file", "url", "code", "memory", "session"].map((s) => [
          s,
          db.countDocuments(s),
        ]),
      ),
      vectors: db.vecCount(),
      memories: db.memoryCount(),
      graph: db.graphCounts(),
    },
  };
}

export async function searchPayload(
  ctx: ProjectContext,
  q: string,
  mode: "hybrid" | "lexical" | "semantic",
  limit: number,
) {
  const db = getStorage(ctx);
  const vectorSearch = mode === "lexical" ? undefined : await vectorRanker(ctx, db);
  const r = await search(db, q, { limit, mode, vectorSearch });
  return {
    query: r.query,
    used: r.used,
    corrections: r.corrections,
    hits: r.hits.map((h) => ({
      title: h.chunk.title,
      source: h.chunk.document.source,
      doc: h.chunk.document_id,
      chunk: h.chunk.ord,
      lines: h.chunk.start_line ? `${h.chunk.start_line}-${h.chunk.end_line}` : null,
      created: h.chunk.document.created_at,
      score: h.score,
      snippet: h.snippet,
    })),
  };
}

export function memoriesPayload(ctx: ProjectContext) {
  return getStorage(ctx).memoryList({ limit: 500 });
}

export function addMemory(ctx: ProjectContext, kind: string, content: string) {
  const db = getStorage(ctx);
  const doc = indexContent(db, {
    source: "memory",
    title: `${kind}: ${content.slice(0, 60)}`,
    content,
    kind: "prose",
    meta: { kind },
  });
  return db.memoryInsert({ kind, content, documentId: doc.documentId, sessionId: "dashboard" });
}

export function deleteMemory(ctx: ProjectContext, id: number) {
  getStorage(ctx).memoryDelete(id);
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
        .map((n) => ({ id: n.id, label: nodeLabel(n, n.id), kind: n.kind })),
    };
  if (mode === "dependencies") {
    const r = dependencies(db, node);
    return r
      ? {
          root: nodeLabel(r.root, r.root.id),
          hits: r.hits.slice(0, limit).map((h) => ({
            id: h.id,
            label: nodeLabel(h.node, h.id),
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
      root: nodeLabel(r.root, r.root.id),
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
        root: nodeLabel(r.root, r.root.id),
        hits: r.hits.slice(0, limit).map((h) => ({
          id: h.id,
          label: nodeLabel(h.node, h.id),
          score: h.score,
          reasons: h.reasons,
        })),
      }
    : { error: "unknown node" };
}

export function eventsPayload(ctx: ProjectContext, limit: number) {
  const db = getStorage(ctx);
  return db.eventsRecent(limit).map((e) => ({
    id: e.id,
    ts: e.ts,
    session: e.session_id,
    category: e.category,
    priority: e.priority,
    tool: e.tool,
    payload: JSON.parse(e.payload) as unknown,
  }));
}

export async function doctorPayload() {
  return fullDoctor();
}
