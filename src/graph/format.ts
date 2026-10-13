import type { GraphEdgeRow, GraphNodeRow } from "../storage/types.js";
import type { Hit } from "./query.js";

export function nodeLabel(n: GraphNodeRow | undefined, id: string): string {
  if (!n) return id;
  const loc =
    n.path && n.start_line
      ? ` (${n.path}:${n.start_line})`
      : n.path && n.kind !== "file"
        ? ` (${n.path})`
        : "";
  return `${n.kind} ${n.name}${loc}`;
}

export function formatHits(title: string, hits: Hit[], limit: number): string {
  if (!hits.length) return `${title} none`;
  const lines = [title];
  for (const h of hits.slice(0, limit)) {
    lines.push(`- ${nodeLabel(h.node, h.id)} · ${h.score.toFixed(2)} · ${h.reasons.join("; ")}`);
  }
  if (hits.length > limit) lines.push(`… ${hits.length - limit} more`);
  return lines.join("\n");
}

export function formatEdges(
  edges: GraphEdgeRow[],
  nodes: Map<string, GraphNodeRow>,
  limit: number,
): string {
  const lines = edges
    .slice(0, limit)
    .map(
      (e) =>
        `- ${nodeLabel(nodes.get(e.src), e.src)} —${e.kind}${e.weight !== 1 ? ` ${e.weight.toFixed(2)}` : ""}→ ${nodeLabel(nodes.get(e.dst), e.dst)}`,
    );
  if (edges.length > limit) lines.push(`… ${edges.length - limit} more edges`);
  return lines.join("\n");
}
