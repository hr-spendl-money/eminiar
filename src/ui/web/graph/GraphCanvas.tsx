import type { JSX, Ref } from "preact";
import { useEffect, useImperativeHandle, useRef, useState } from "preact/hooks";
import type { VisEdge, VisNode } from "../api.js";
import { basename, cls, color, DIRECTED, edgeColor } from "../util.js";
import { hierarchy, type Layout, layout, type SimNode } from "./force.js";

export interface GraphHandle {
  fit: () => void;
}

export interface GraphCanvasProps {
  nodes: VisNode[];
  edges: VisEdge[];
  mode?: "galaxy" | "hierarchy";
  selected?: string | null;
  /** Edge keys (`src|dst|kind`) drawn highlighted (a path). */
  highlight?: Set<string> | undefined;
  onSelect?: (id: string | null) => void;
  onActivate?: (id: string) => void;
  legend?: boolean;
  handle?: Ref<GraphHandle | null>;
  /** Keep previous positions when the node set grows (expand). */
  keepPositions?: boolean;
}

interface View {
  k: number;
  x: number;
  y: number;
}

const prefersDark = () =>
  document.documentElement.getAttribute("data-theme") === "dark" ||
  (document.documentElement.getAttribute("data-theme") !== "light" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches);

/**
 * Canvas renderer for node/edge graphs: force layout (d3-force) or a static folder
 * hierarchy; pan, zoom, drag, hover, click, double-click. Labels appear by zoom and
 * degree so large graphs stay readable; selecting a node dims everything that is not
 * adjacent to it.
 */
export function GraphCanvas(props: GraphCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<Layout | null>(null);
  const viewRef = useRef<View>({ k: 1, x: 0, y: 0 });
  /** The user zoomed or panned since the layout was built: auto-fit must leave the view alone. */
  const userViewRef = useRef(false);
  const hoverRef = useRef<SimNode | null>(null);
  const dragRef = useRef<{
    node?: SimNode | undefined;
    px: number;
    py: number;
    vx: number;
    vy: number;
    moved: boolean;
  } | null>(null);
  const [hover, setHover] = useState<SimNode | null>(null);
  const [dragging, setDragging] = useState(false);
  const propsRef = useRef(props);
  propsRef.current = props;

  const draw = () => {
    const canvas = canvasRef.current;
    const l = layoutRef.current;
    if (!canvas || !l) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;
    const v = viewRef.current;
    const dark = prefersDark();
    const { selected, highlight } = propsRef.current;
    const focus = selected ? l.byId.get(selected) : undefined;
    const near = new Set<string>();
    if (focus) {
      near.add(focus.id);
      for (const e of l.links) {
        const s = e.source as SimNode;
        const t = e.target as SimNode;
        if (s.id === focus.id) near.add(t.id);
        if (t.id === focus.id) near.add(s.id);
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.translate(W / 2 + v.x, H / 2 + v.y);
    ctx.scale(v.k, v.k);
    // edges
    for (const e of l.links) {
      const s = e.source as SimNode;
      const t = e.target as SimNode;
      if (s.x === undefined || t.x === undefined) continue;
      const key = `${s.id}|${t.id}|${e.kind}`;
      const hl = highlight?.has(key);
      const dim =
        focus && !(near.has(s.id) && near.has(t.id)) && s.id !== focus.id && t.id !== focus.id;
      ctx.globalAlpha = hl ? 1 : dim ? 0.06 : e.kind === "co_changes" ? 0.35 : 0.45;
      ctx.strokeStyle = edgeColor(e.kind);
      ctx.lineWidth = (hl ? 2.5 : e.kind === "co_changes" ? 1 + e.weight * 2 : 1) / v.k;
      ctx.setLineDash(
        e.kind === "calls"
          ? [4 / v.k, 3 / v.k]
          : e.kind === "co_changes"
            ? [1 / v.k, 3 / v.k]
            : e.kind === "references"
              ? [2 / v.k, 2 / v.k]
              : [],
      );
      ctx.beginPath();
      ctx.moveTo(s.x, s.y ?? 0);
      ctx.lineTo(t.x, t.y ?? 0);
      ctx.stroke();
      ctx.setLineDash([]);
      if (DIRECTED.has(e.kind) && v.k > 0.5) {
        const dx = t.x - s.x;
        const dy = (t.y ?? 0) - (s.y ?? 0);
        const d = Math.hypot(dx, dy) || 1;
        const ux = dx / d;
        const uy = dy / d;
        const ax = t.x - ux * (t.r + 2);
        const ay = (t.y ?? 0) - uy * (t.r + 2);
        const sz = 5 / v.k;
        ctx.fillStyle = edgeColor(e.kind);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - ux * sz * 2 - uy * sz, ay - uy * sz * 2 + ux * sz);
        ctx.lineTo(ax - ux * sz * 2 + uy * sz, ay - uy * sz * 2 - ux * sz);
        ctx.closePath();
        ctx.fill();
      }
    }
    // nodes
    const n = l.nodes.length;
    const showAll = n <= 120 || v.k > 1.6;
    ctx.font = `${11 / v.k}px system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    for (const d of l.nodes) {
      if (d.x === undefined || d.y === undefined) continue;
      const dim = focus && !near.has(d.id);
      ctx.globalAlpha = dim ? 0.2 : 1;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r / Math.max(1, v.k ** 0.5), 0, Math.PI * 2);
      ctx.fillStyle = color(d.kind);
      ctx.fill();
      if (d.root || d.id === selected || d === hoverRef.current) {
        ctx.lineWidth = 2.5 / v.k;
        ctx.strokeStyle = dark ? "#e5e7eb" : "#1b1f24";
        ctx.stroke();
      } else if (d.kind === "file" && d.exported === false) {
        // nothing
      }
      const label =
        showAll ||
        d.root ||
        d.deg > 3 ||
        near.has(d.id) ||
        d === hoverRef.current ||
        d.id === selected;
      if (label) {
        const text =
          d.kind === "file" || d.kind === "package"
            ? basename(d.label)
            : (d.label.split(".").pop() ?? d.label);
        const x = d.x + d.r / Math.max(1, v.k ** 0.5) + 3 / v.k;
        ctx.lineWidth = 3 / v.k;
        ctx.strokeStyle = dark ? "#171a21" : "#ffffff";
        ctx.strokeText(text, x, d.y);
        ctx.fillStyle = dark ? "#e5e7eb" : "#1b1f24";
        ctx.fillText(text, x, d.y);
      }
    }
    ctx.globalAlpha = 1;
  };

  const fitView = () => {
    const canvas = canvasRef.current;
    const l = layoutRef.current;
    if (!canvas || !l?.nodes.length) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    for (const d of l.nodes) {
      if (d.x === undefined || d.y === undefined) continue;
      x0 = Math.min(x0, d.x);
      y0 = Math.min(y0, d.y);
      x1 = Math.max(x1, d.x);
      y1 = Math.max(y1, d.y);
    }
    const w = Math.max(100, x1 - x0 + 120);
    const h = Math.max(100, y1 - y0 + 120);
    const k = Math.min(2.5, Math.min(W / w, H / h));
    viewRef.current = { k, x: -((x0 + x1) / 2) * k, y: -((y0 + y1) / 2) * k };
    draw();
  };

  useImperativeHandle(props.handle ?? null, () => ({ fit: fitView }), []);

  // (re)build the layout when the node set changes
  const nodeKey = props.nodes.map((n) => n.id).join("|");
  const edgeKey = props.edges.length;
  const mode = props.mode ?? "galaxy";
  useEffect(() => {
    const prev = props.keepPositions ? layoutRef.current?.byId : undefined;
    layoutRef.current?.sim.stop();
    const l =
      mode === "hierarchy"
        ? hierarchy(props.nodes, props.edges)
        : layout(props.nodes, props.edges, prev);
    layoutRef.current = l;
    userViewRef.current = false;
    let fitted = false;
    let settled = false;
    let ticks = 0;
    if (mode === "hierarchy") {
      fitView();
      return;
    }
    l.sim.on("tick", () => {
      ticks++;
      if (ticks % 2 === 0 || l.sim.alpha() < 0.05) draw();
      if (!fitted && (ticks === 30 || l.sim.alpha() < 0.3)) {
        fitted = true;
        if (!userViewRef.current) fitView();
      }
    });
    // Fit once more when the first layout settles (it keeps spreading after the early
    // fit). Later "end"s come from node drags restarting the simulation and must not
    // move the camera, and neither may any fit after the user zoomed or panned.
    l.sim.on("end", () => {
      if (settled) return;
      settled = true;
      fitted = true;
      if (!userViewRef.current) fitView();
    });
    return () => l.sim.stop();
  }, [nodeKey, edgeKey, mode]);

  // redraw on selection / highlight / theme changes
  useEffect(() => {
    draw();
  }, [props.selected, props.highlight, hover]);

  // size the canvas to its box
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, wrap.clientWidth * dpr);
      canvas.height = Math.max(1, wrap.clientHeight * dpr);
      draw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", draw);
    const mo = new MutationObserver(draw);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", draw);
      mo.disconnect();
    };
  }, []);

  const toWorld = (e: MouseEvent) => {
    const canvas = canvasRef.current!;
    const b = canvas.getBoundingClientRect();
    const v = viewRef.current;
    return {
      x: (e.clientX - b.left - b.width / 2 - v.x) / v.k,
      y: (e.clientY - b.top - b.height / 2 - v.y) / v.k,
    };
  };
  const pick = (e: MouseEvent): SimNode | null => {
    const l = layoutRef.current;
    if (!l) return null;
    const p = toWorld(e);
    const v = viewRef.current;
    let best: SimNode | null = null;
    let bd = Number.POSITIVE_INFINITY;
    for (const d of l.nodes) {
      if (d.x === undefined || d.y === undefined) continue;
      const dist = Math.hypot(d.x - p.x, d.y - p.y);
      const r = d.r / Math.max(1, v.k ** 0.5) + 6 / v.k;
      if (dist < r && dist < bd) {
        bd = dist;
        best = d;
      }
    }
    return best;
  };

  const onMouseDown = (e: MouseEvent) => {
    const node = pick(e);
    const v = viewRef.current;
    dragRef.current = {
      node: node ?? undefined,
      px: e.clientX,
      py: e.clientY,
      vx: v.x,
      vy: v.y,
      moved: false,
    };
    if (node) {
      node.fx = node.x;
      node.fy = node.y;
      layoutRef.current?.sim.alphaTarget(0.2).restart();
    }
    setDragging(true);
    e.preventDefault();
  };
  const onMouseMove = (e: MouseEvent) => {
    const d = dragRef.current;
    if (d) {
      const dx = e.clientX - d.px;
      const dy = e.clientY - d.py;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      if (d.node) {
        const p = toWorld(e);
        d.node.fx = p.x;
        d.node.fy = p.y;
        if (mode === "hierarchy") {
          d.node.x = p.x;
          d.node.y = p.y;
          draw();
        }
      } else {
        if (d.moved) userViewRef.current = true;
        viewRef.current = { ...viewRef.current, x: d.vx + dx, y: d.vy + dy };
        draw();
      }
      return;
    }
    const h = pick(e);
    if (h !== hoverRef.current) {
      hoverRef.current = h;
      setHover(h);
    }
  };
  const onMouseUp = (e: MouseEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (!d) return;
    if (d.node) {
      if (mode !== "hierarchy") {
        d.node.fx = null;
        d.node.fy = null;
        layoutRef.current?.sim.alphaTarget(0);
      }
      if (!d.moved)
        propsRef.current.onSelect?.(d.node.id === propsRef.current.selected ? null : d.node.id);
    } else if (!d.moved) {
      propsRef.current.onSelect?.(null);
    }
    void e;
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current!;
    const b = canvas.getBoundingClientRect();
    const v = viewRef.current;
    userViewRef.current = true;
    const f = e.deltaY > 0 ? 0.9 : 1.1;
    const k = Math.max(0.05, Math.min(8, v.k * f));
    const mx = e.clientX - b.left - b.width / 2;
    const my = e.clientY - b.top - b.height / 2;
    viewRef.current = { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
    draw();
  };
  const onDblClick = (e: MouseEvent) => {
    const n = pick(e);
    if (n) propsRef.current.onActivate?.(n.id);
  };

  const kinds = [...new Set(props.nodes.map((n) => n.kind))];
  const ekinds = [...new Set(props.edges.map((e) => e.kind))];
  return (
    <div class="gwrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        class={cls(dragging && "drag", hover && !dragging && "hover")}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => {
          hoverRef.current = null;
          setHover(null);
          if (dragRef.current && !dragRef.current.node) dragRef.current = null;
        }}
        onWheel={onWheel}
        onDblClick={onDblClick}
      />
      {hover && !dragging && (
        <div class="overlay tip" style={{ left: 12, top: 12 }}>
          <b>{hover.kind}</b> {hover.label}
          {hover.path && hover.kind !== "file" ? (
            <span class="muted">
              {" "}
              · {hover.path}
              {hover.line ? `:${hover.line}` : ""}
            </span>
          ) : null}
          <span class="muted">
            {" "}
            · {hover.deg} edge{hover.deg === 1 ? "" : "s"}
          </span>
        </div>
      )}
      {props.legend !== false && (
        <div class="overlay legend">
          {kinds.map((k) => (
            <span>
              <i style={{ background: color(k) }} />
              {k}
            </span>
          ))}
          {ekinds.map((k) => (
            <span>
              <s style={{ borderColor: edgeColor(k) }} />
              {k}
            </span>
          ))}
        </div>
      )}
      <button type="button" class="overlay fit" onClick={fitView}>
        fit view
      </button>
    </div>
  );
}
