import { knowledgeEdgeStyleOf } from "../graph/knowledge.js";
import type { EdgeStyle, NodeShape } from "../graph/shapes.js";
import { color } from "../util.js";
import { bucketColor } from "./colors.js";

/**
 * How the history graph draws (no DOM, so node-side tests can import it). Commits keep
 * the History tab's commit-kind palette; branches, files and knowledge stay on the
 * grey/blue palette and differ by shape: branch hexagon, commit triangle, file circle,
 * memory diamond, doc square, anything missing a hollow ring.
 */
export interface HistoryGraphNodeLike {
  id: string;
  label: string;
  kind: string;
  group?: string | undefined;
  missing?: boolean | undefined;
  bucket?: string | undefined;
  status?: string | undefined;
  isDefault?: boolean | undefined;
  merged?: boolean | undefined;
  live?: boolean | undefined;
}

const SHAPES: Record<string, NodeShape> = {
  branch: "hexagon",
  commit: "triangle",
  memory: "diamond",
  doc: "square",
};

export function historyShapeOf(n: { kind: string }): NodeShape {
  if ((n as HistoryGraphNodeLike).missing) return "ring";
  return SHAPES[n.kind] ?? "circle";
}

export function historyColorOf(n: { kind: string }): string {
  const h = n as HistoryGraphNodeLike;
  if (h.kind === "commit") return bucketColor(h.bucket ?? "other");
  // Mid slate reads at ~3:1 on both themes; a branch whose ref is gone is lighter.
  if (h.kind === "branch") return h.live || h.isDefault ? "#64748b" : "#9ca3af";
  if (h.kind === "memory" && (h.status === "superseded" || h.status === "deprecated"))
    return "#93c5fd";
  return color(n.kind);
}

const HISTORY_EDGES: Record<string, EdgeStyle> = {
  contains: { color: "#64748b", width: 1.2, alpha: 0.55, directed: true },
  merged_into: { color: "#64748b", dash: [6, 3], width: 1.6, alpha: 0.6, directed: true },
  touches: { color: "#94a3b8", width: 0.9, alpha: 0.4, directed: true },
  records: { color: "#2563eb", dash: [2, 3], width: 1.2, alpha: 0.6, directed: true },
  fixes: { color: "#e11d48", dash: [4, 3], width: 1.6, alpha: 0.75, directed: true },
};

/** History edges here; mentions / documents look as they do in the knowledge galaxy. */
export function historyEdgeStyleOf(kind: string): EdgeStyle {
  return HISTORY_EDGES[kind] ?? knowledgeEdgeStyleOf(kind);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Commits by subject (clipped), files by basename, the rest by name. */
export function historyLabelOf(n: { kind: string; label: string }): string {
  if (n.kind === "commit") return clip(n.label, 32);
  if (n.kind === "file") return n.label.split("/").pop() ?? n.label;
  return n.label;
}
