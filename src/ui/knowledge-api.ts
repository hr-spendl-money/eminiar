import type { ProjectContext } from "../context.js";
import { categoryInfo } from "../docs/category.js";
import { ensureDocsGraph, localDocPages } from "../docs/graph.js";
import { docId, fileOf, memoryId, parseId } from "../graph/ids.js";
import { reconcile } from "../memory/store.js";
import type { StorageAdapter } from "../storage/adapter.js";
import { getStorage } from "../storage/index.js";
import type { GraphEdgeRow, GraphNodeRow } from "../storage/types.js";
import { type VisNode, vis } from "./graph-api.js";

/**
 * The knowledge galaxy: how memories and documentation sources connect to the code
 * and to each other. Seeds are the `memory:` and/or `doc:` nodes, expanded one hop
 * over the knowledge edges (`mentions`, `links`, `supersedes`, `documents`), plus
 * edges derived here and never stored:
 * - `about`: a memory relates to a page of a local doc source → that source;
 * - `tagged` / `in_topic`: hub nodes for tags, the memory topic (`auth/` of
 *   `auth/tokens`) and a doc source's category.
 * With `focus`, the picture centres on one node and walks two knowledge hops, so a
 * file shows every memory and doc about it and what those relate to in turn.
 */
export type KnowledgeScope = "memory" | "docs" | "all";

export const KNOWLEDGE_EDGES = ["mentions", "links", "supersedes", "documents"] as const;

export interface KnowledgeNode extends VisNode {
  /** memory | doc | hub | code: what the frontend shapes the node by. */
  group: "memory" | "doc" | "hub" | "code";
  seed?: boolean | undefined;
  /** An edge points here but nothing defines the node (deleted memory, unimported package). */
  missing?: boolean | undefined;
  /** Memory kind (decision, fact …) or doc category id. */
  sub?: string | undefined;
  /** Memory lifecycle; decisions without one read as accepted. */
  status?: string | undefined;
  tags?: string[] | undefined;
  provider?: string | undefined;
  /** Doc category label, memory topic. */
  detail?: string | undefined;
}

export interface KnowledgeEdge {
  src: string;
  dst: string;
  kind: string;
  weight: number;
  /** Derived for this view (about, tagged, in_topic), not stored in the graph. */
  derived?: boolean | undefined;
}

export interface KnowledgePayload {
  scope: KnowledgeScope;
  focus: string | null;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  truncated: boolean;
  /** Nodes before the limit. */
  total: number;
  counts: { nodes: Record<string, number>; edges: Record<string, number> };
}

export interface KnowledgeOptions {
  scope?: KnowledgeScope | undefined;
  focus?: string | undefined;
  limit?: number | undefined;
}

const ALL_KINDS = [...KNOWLEDGE_EDGES];

function metaOf(row: { meta: string | null } | undefined): Record<string, unknown> {
  if (!row?.meta) return {};
  try {
    return JSON.parse(row.meta) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const tagId = (t: string) => `tag:${t}`;
const topicId = (t: string) => `topic:${t}`;

/** Kind for an id nothing defines, from its prefix. */
function kindOfMissing(id: string): string {
  const k = parseId(id).kind;
  return k === "pkg" ? "package" : k === "sym" ? "symbol" : k === "doc" ? "doc" : k;
}

export function scopeOf(raw: string | undefined | null): KnowledgeScope {
  return raw === "memory" || raw === "docs" ? raw : "all";
}

export function knowledgePayload(
  ctx: ProjectContext,
  opts: KnowledgeOptions = {},
): KnowledgePayload {
  const db = getStorage(ctx);
  reconcile(ctx, db);
  try {
    ensureDocsGraph(ctx, db);
  } catch {
    // a broken manifest leaves the doc nodes as they were
  }
  return buildKnowledge(ctx, db, opts);
}

/** Exported for tests: the payload over an already reconciled database. */
export function buildKnowledge(
  ctx: ProjectContext,
  db: StorageAdapter,
  opts: KnowledgeOptions = {},
): KnowledgePayload {
  const scope = opts.scope ?? "all";
  const limit = Math.max(10, Math.min(2000, opts.limit ?? 300));
  const focus = opts.focus?.trim() || null;

  const memRows = new Map(
    db
      .memoryList({ limit: 100_000 })
      .filter((r) => r.name)
      .map((r) => [r.name!, r] as const),
  );
  const memNodes = db.graphNodesByKind(["memory"]);
  const docNodes = db.graphNodesByKind(["doc"]);
  const rows = new Map<string, GraphNodeRow>();
  for (const n of [...memNodes, ...docNodes]) rows.set(n.id, n);

  // Which memories / docs carry a tag or sit in a topic, for hub focus and hub edges.
  const hubsOf = (id: string): Array<{ id: string; kind: "tag" | "topic"; label: string }> => {
    const n = rows.get(id);
    if (!n) return [];
    const m = metaOf(n);
    const out: Array<{ id: string; kind: "tag" | "topic"; label: string }> = [];
    if (n.kind === "memory") {
      const row = memRows.get(n.name);
      const tags = row?.tags ? (JSON.parse(row.tags) as string[]) : ((m.tags as string[]) ?? []);
      for (const t of tags) out.push({ id: tagId(t), kind: "tag", label: `#${t}` });
      if (n.name.includes("/")) {
        const topic = n.name.split("/")[0]!;
        out.push({ id: topicId(topic), kind: "topic", label: `${topic}/` });
      }
    } else if (n.kind === "doc") {
      for (const t of (m.tags as string[] | undefined) ?? [])
        out.push({ id: tagId(t), kind: "tag", label: `#${t}` });
      const cat = typeof m.category === "string" ? m.category : "local";
      out.push({ id: topicId(`docs/${cat}`), kind: "topic", label: categoryInfo(cat).label });
    }
    return out;
  };

  // --- seeds ---------------------------------------------------------------------
  const scoped = [
    ...(scope !== "docs" ? memNodes : []),
    ...(scope !== "memory" ? docNodes : []),
  ].map((n) => n.id);
  let seeds: string[];
  if (!focus) seeds = scoped;
  else if (focus.startsWith("tag:") || focus.startsWith("topic:"))
    seeds = [...memNodes, ...docNodes]
      .map((n) => n.id)
      .filter((id) => hubsOf(id).some((h) => h.id === focus));
  else seeds = [focus];

  // --- edges ---------------------------------------------------------------------
  const edges = new Map<string, KnowledgeEdge>();
  const addEdge = (e: KnowledgeEdge) => {
    if (e.src === e.dst) return;
    const key = `${e.src}|${e.dst}|${e.kind}`;
    if (!edges.has(key)) edges.set(key, e);
  };
  const stored = (e: GraphEdgeRow) =>
    addEdge({ src: e.src, dst: e.dst, kind: e.kind, weight: e.weight });

  const hop = (ids: string[]): string[] => {
    if (!ids.length) return [];
    const found = new Set<string>();
    for (const e of db.graphEdgesFrom(ids, ALL_KINDS)) {
      stored(e);
      found.add(e.dst);
    }
    for (const e of db.graphEdgesTo(ids, ALL_KINDS)) {
      stored(e);
      found.add(e.src);
    }
    return [...found];
  };
  const first = hop(seeds);
  // A focused node (a file, a package, one memory) walks a second knowledge hop from
  // what it touched: every other memory / doc about the same code shows up.
  if (focus && !focus.startsWith("tag:") && !focus.startsWith("topic:")) {
    const fresh = first.filter((id) => !seeds.includes(id));
    // From code nodes only knowledge sources point back; from memories/docs, both ways.
    hop(fresh);
  }

  // `about`: a memory related to a page that a local doc source indexes.
  const pages = localDocPages(ctx, db);
  const knowledgeIds = () =>
    new Set([...edges.values()].flatMap((e) => [e.src, e.dst]).concat(seeds));
  if (pages.size) {
    for (const id of knowledgeIds()) {
      if (!id.startsWith("memory:")) continue;
      const row = memRows.get(id.slice("memory:".length));
      const related = row?.node_ids ? (JSON.parse(row.node_ids) as string[]) : [];
      for (const r of related) {
        const f = fileOf(r);
        for (const name of (f && pages.get(f)) || [])
          addEdge({ src: id, dst: docId(name), kind: "about", weight: 1, derived: true });
      }
    }
    // …and the other direction when a doc source is in view.
    const docsInView = [...knowledgeIds()].filter((id) => id.startsWith("doc:"));
    if (docsInView.length) {
      for (const [name, row] of memRows) {
        const related = row.node_ids ? (JSON.parse(row.node_ids) as string[]) : [];
        for (const r of related) {
          const f = fileOf(r);
          for (const doc of (f && pages.get(f)) || [])
            if (docsInView.includes(docId(doc)))
              addEdge({
                src: memoryId(name),
                dst: docId(doc),
                kind: "about",
                weight: 1,
                derived: true,
              });
        }
      }
    }
  }

  // Hubs for every memory / doc in view.
  const hubNodes = new Map<string, KnowledgeNode>();
  for (const id of knowledgeIds()) {
    for (const h of hubsOf(id)) {
      if (!hubNodes.has(h.id))
        hubNodes.set(h.id, {
          id: h.id,
          label: h.label,
          kind: h.kind,
          path: null,
          line: null,
          group: "hub",
        });
      addEdge({
        src: id,
        dst: h.id,
        kind: h.kind === "tag" ? "tagged" : "in_topic",
        weight: 0.5,
        derived: true,
      });
    }
  }
  if (focus && (focus.startsWith("tag:") || focus.startsWith("topic:")) && !hubNodes.has(focus))
    hubNodes.set(focus, {
      id: focus,
      label: focus.startsWith("tag:") ? `#${focus.slice(4)}` : `${focus.slice(6)}/`,
      kind: focus.startsWith("tag:") ? "tag" : "topic",
      path: null,
      line: null,
      group: "hub",
    });

  // --- nodes -----------------------------------------------------------------------
  const ids = knowledgeIds();
  for (const h of hubNodes.keys()) ids.add(h);
  const graphRows = new Map(
    db.graphGetNodes([...ids].filter((id) => !hubNodes.has(id))).map((n) => [n.id, n]),
  );
  const seedSet = new Set(seeds);
  if (focus) seedSet.add(focus);
  const nodes: KnowledgeNode[] = [];
  for (const id of ids) {
    const hub = hubNodes.get(id);
    if (hub) {
      nodes.push({ ...hub, seed: seedSet.has(id) || undefined, root: id === focus });
      continue;
    }
    const row = graphRows.get(id);
    const base = vis(row, id, id === focus);
    const m = metaOf(row);
    const node: KnowledgeNode = {
      ...base,
      kind: row ? row.kind : kindOfMissing(id),
      group: "code",
      seed: seedSet.has(id) || undefined,
      missing: row ? undefined : true,
    };
    if (node.kind === "memory") {
      const name = row?.name ?? id.slice("memory:".length);
      const mr = memRows.get(name);
      node.group = "memory";
      node.label = name;
      node.sub = mr?.kind ?? (m.kind as string | undefined);
      node.status =
        mr?.status ??
        (m.status as string | undefined) ??
        (node.sub === "decision" ? "accepted" : undefined);
      node.tags = mr?.tags ? (JSON.parse(mr.tags) as string[]) : (m.tags as string[] | undefined);
      node.detail = name.includes("/") ? `${name.split("/")[0]}/` : undefined;
    } else if (node.kind === "doc") {
      node.group = "doc";
      node.label = row?.name ?? id.slice("doc:".length);
      node.sub = typeof m.category === "string" ? m.category : undefined;
      node.detail = node.sub ? categoryInfo(node.sub).label : undefined;
      node.provider = typeof m.provider === "string" ? m.provider : undefined;
      node.tags = m.tags as string[] | undefined;
    }
    nodes.push(node);
  }

  // --- limit -----------------------------------------------------------------------
  const deg = new Map<string, number>();
  for (const e of edges.values()) {
    deg.set(e.src, (deg.get(e.src) ?? 0) + 1);
    deg.set(e.dst, (deg.get(e.dst) ?? 0) + 1);
  }
  const updated = (n: KnowledgeNode) =>
    n.kind === "memory" ? (memRows.get(n.label)?.updated_at ?? 0) : 0;
  const rank = (n: KnowledgeNode) =>
    n.root
      ? 0
      : n.seed
        ? 1
        : n.group === "memory" || n.group === "doc"
          ? 2
          : n.group === "hub"
            ? 3
            : 4;
  nodes.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      updated(b) - updated(a) ||
      (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0) ||
      a.id.localeCompare(b.id),
  );
  const total = nodes.length;
  const kept = nodes.slice(0, limit);
  const keep = new Set(kept.map((n) => n.id));
  const keptEdges = [...edges.values()].filter((e) => keep.has(e.src) && keep.has(e.dst));

  const counts = { nodes: {} as Record<string, number>, edges: {} as Record<string, number> };
  for (const n of kept) counts.nodes[n.kind] = (counts.nodes[n.kind] ?? 0) + 1;
  for (const e of keptEdges) counts.edges[e.kind] = (counts.edges[e.kind] ?? 0) + 1;
  return {
    scope,
    focus,
    nodes: kept,
    edges: keptEdges,
    truncated: total > kept.length,
    total,
    counts,
  };
}
