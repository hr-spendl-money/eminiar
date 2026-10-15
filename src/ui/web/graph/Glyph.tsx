import type { JSX } from "preact";
import { type NodeShape, shapeSvgPath } from "./style.js";

/** A node's shape and colour at legend size; `ring` draws hollow. */
export function Glyph({ shape, color }: { shape: NodeShape; color: string }): JSX.Element {
  const hollow = shape === "ring";
  return (
    <svg class="glyph" width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d={shapeSvgPath(shape)}
        fill={hollow ? "none" : color}
        stroke={color}
        stroke-width={hollow ? 1.6 : 0}
      />
    </svg>
  );
}

/** An edge kind's stroke at legend size, dashed like the canvas draws it. */
export function EdgeGlyph({ color, dash }: { color: string; dash?: number[] | undefined }) {
  return (
    <svg class="glyph" width="18" height="8" viewBox="0 0 18 8" aria-hidden="true">
      <line
        x1="0"
        y1="4"
        x2="18"
        y2="4"
        stroke={color}
        stroke-width="2"
        stroke-dasharray={dash?.length ? dash.join(" ") : undefined}
      />
    </svg>
  );
}
