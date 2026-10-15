/** Drawing vocabulary shared by the canvas and pure modules; no DOM types here. */

/** How a node is outlined; `ring` is a hollow circle (something referenced but missing). */
export type NodeShape = "circle" | "square" | "diamond" | "triangle" | "hexagon" | "ring";

export interface EdgeStyle {
  color: string;
  /** Dash pattern in screen pixels (scaled by the zoom when drawn). */
  dash?: number[] | undefined;
  /** Line width in screen pixels. */
  width?: number | undefined;
  alpha?: number | undefined;
  /** Draw an arrow head at the target. */
  directed?: boolean | undefined;
}
