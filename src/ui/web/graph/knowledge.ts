import { color, DIRECTED, edgeColor } from "../util.js";
import type { EdgeStyle, NodeShape } from "./shapes.js";

/**
 * Pure helpers for the knowledge galaxy (no DOM): what a filter leaves on screen, and
 * how each node and edge kind looks. Filtering happens here, on the payload already
 * fetched, so every chip changes the picture at once instead of refetching the same
 * graph. Types are structural (KnowledgeNodeUi in api.ts fits) so node-side tests can
 * import this without the DOM library.
 */
export interface KnowledgeNodeLike {
  id: string;
  label: string;
  kind: string;
  group?: "memory" | "doc" | "hub" | "code" | undefined;
  seed?: boolean | undefined;
  root?: boolean | undefined;
  missing?: boolean | undefined;
  sub?: string | undefined;
  status?: string | undefined;
}
export interface KnowledgeEdgeLike {
  src: string;
  dst: string;
  kind: string;
}
export interface KnowledgeFilter {
  /** Node kinds switched off (memory, doc, file, package, tag, topic …). */
  hiddenKinds: ReadonlySet<string>;
  /** Edge kinds switched off (mentions, links, documents …). */
  hiddenEdges: ReadonlySet<string>;
  /** Memory lifecycle to keep, "" for any; memories without one count as accepted. */
  status: string;
  /** Doc category id to keep, "" for any. */
  category: string;
  hideSuperseded: boolean;
}

export const NO_FILTER: KnowledgeFilter = {
  hiddenKinds: new Set(),
  hiddenEdges: new Set(),
  status: "",
  category: "",
  hideSuperseded: false,
};

export interface KnowledgeView<N extends KnowledgeNodeLike, E extends KnowledgeEdgeLike> {
  nodes: N[];
  edges: E[];
}

function passes(n: KnowledgeNodeLike, f: KnowledgeFilter): boolean {
  if (f.hiddenKinds.has(n.kind)) return false;
  if (n.group === "memory" && !n.missing) {
    const status = n.status ?? "accepted";
    if (f.hideSuperseded && status === "superseded") return false;
    if (f.status && status !== f.status) return false;
  }
  if (n.group === "doc" && !n.missing && f.category && n.sub !== f.category) return false;
  return true;
}

/**
 * Nodes that pass the filter and edges whose kind is on and whose ends both stayed.
 * Seeds (the memories / docs the view is about) and the focus stay even when no edge
 * is left; anything else that lost all its edges goes, so hiding `mentions` really
 * removes the files only memories pointed at.
 */
export function applyKnowledgeFilter<N extends KnowledgeNodeLike, E extends KnowledgeEdgeLike>(
  g: KnowledgeView<N, E>,
  f: KnowledgeFilter,
): KnowledgeView<N, E> {
  const visible = new Set(g.nodes.filter((n) => passes(n, f)).map((n) => n.id));
  const edges = g.edges.filter(
    (e) => !f.hiddenEdges.has(e.kind) && visible.has(e.src) && visible.has(e.dst),
  );
  const linked = new Set(edges.flatMap((e) => [e.src, e.dst]));
  const nodes = g.nodes.filter((n) => visible.has(n.id) && (n.seed || n.root || linked.has(n.id)));
  return { nodes, edges };
}

/** Kind → count over a list, for chip labels. */
export function countBy<T>(items: T[], key: (t: T) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const it of items) out.set(key(it), (out.get(key(it)) ?? 0) + 1);
  return out;
}

const SHAPES: Record<string, NodeShape> = {
  memory: "diamond",
  doc: "square",
  tag: "triangle",
  topic: "hexagon",
};

/** Knowledge kinds by shape; code keeps its circle. A missing node is a hollow ring. */
export function knowledgeShapeOf(n: { kind: string }): NodeShape {
  if ((n as KnowledgeNodeLike).missing) return "ring";
  return SHAPES[n.kind] ?? "circle";
}

/** Kind colour, a lighter blue for memories that are superseded or deprecated. */
export function knowledgeColorOf(n: { kind: string }): string {
  const k = n as KnowledgeNodeLike;
  if (k.group === "memory" && (k.status === "superseded" || k.status === "deprecated"))
    return "#93c5fd";
  return color(n.kind);
}

/** Knowledge edges: solid for what a file states, dashed for references and derivations. */
export function knowledgeEdgeStyleOf(kind: string): EdgeStyle {
  const dash: Record<string, number[]> = {
    links: [4, 3],
    supersedes: [6, 3],
    about: [2, 3],
    tagged: [1, 3],
    in_topic: [1, 3],
  };
  return {
    color: edgeColor(kind),
    dash: dash[kind],
    width: kind === "documents" || kind === "mentions" ? 1.4 : 1,
    alpha: kind === "tagged" || kind === "in_topic" ? 0.35 : 0.55,
    directed: DIRECTED.has(kind),
  };
}

/** Memory and doc names whole (`auth/tokens`), code as the code galaxy labels it. */
export function knowledgeLabelOf(n: { kind: string; label: string }): string {
  const k = n as KnowledgeNodeLike;
  if (k.group === "memory" || k.group === "doc" || k.group === "hub") return n.label;
  if (n.kind === "package") return n.label;
  if (n.kind === "file") return n.label.split("/").pop() ?? n.label;
  return n.label.split(".").pop() ?? n.label;
}
