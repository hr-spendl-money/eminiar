import type { VisNode } from "../api.js";
import { color, DIRECTED, edgeColor } from "../util.js";
import type { EdgeStyle, NodeShape } from "./shapes.js";

export type { EdgeStyle, NodeShape };

export const defaultColorOf = (n: VisNode): string => color(n.kind);
export const defaultShapeOf = (_n: VisNode): NodeShape => "circle";

/** The code galaxy's edge look: dashes by kind, co-change width by weight. */
export function defaultEdgeStyleOf(kind: string, weight = 1): EdgeStyle {
  return {
    color: edgeColor(kind),
    dash:
      kind === "calls"
        ? [4, 3]
        : kind === "co_changes"
          ? [1, 3]
          : kind === "references"
            ? [2, 2]
            : undefined,
    width: kind === "co_changes" ? 1 + weight * 2 : 1,
    alpha: kind === "co_changes" ? 0.35 : 0.45,
    directed: DIRECTED.has(kind),
  };
}

/** Trace a node outline of radius `r` at (x, y); the caller fills/strokes it. */
export function traceShape(
  ctx: CanvasRenderingContext2D,
  shape: NodeShape,
  x: number,
  y: number,
  r: number,
): void {
  ctx.beginPath();
  switch (shape) {
    case "square": {
      const s = r * 0.88;
      ctx.rect(x - s, y - s, s * 2, s * 2);
      break;
    }
    case "diamond": {
      const s = r * 1.25;
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s, y);
      ctx.lineTo(x, y + s);
      ctx.lineTo(x - s, y);
      ctx.closePath();
      break;
    }
    case "triangle": {
      const s = r * 1.3;
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s * 0.87, y + s * 0.5);
      ctx.lineTo(x - s * 0.87, y + s * 0.5);
      ctx.closePath();
      break;
    }
    case "hexagon": {
      const s = r * 1.12;
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        const px = x + s * Math.cos(a);
        const py = y + s * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    default:
      ctx.arc(x, y, r, 0, Math.PI * 2);
  }
}

/** The same outline as an SVG path in a 12×12 box, for legends and chips. */
export function shapeSvgPath(shape: NodeShape): string {
  switch (shape) {
    case "square":
      return "M1.5 1.5H10.5V10.5H1.5Z";
    case "diamond":
      return "M6 0.5L11.5 6L6 11.5L0.5 6Z";
    case "triangle":
      return "M6 0.8L11.4 10.6H0.6Z";
    case "hexagon":
      return "M11.5 6L8.75 10.76H3.25L0.5 6L3.25 1.24H8.75Z";
    default:
      return "M6 1A5 5 0 1 1 5.99 1Z";
  }
}
