import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { VisEdge, VisNode } from "../api.js";

export interface SimNode extends SimulationNodeDatum, VisNode {
  deg: number;
  r: number;
}
export interface SimLink extends SimulationLinkDatum<SimNode> {
  kind: string;
  weight: number;
  count?: number | undefined;
  lines?: number[] | undefined;
}

export interface Layout {
  nodes: SimNode[];
  links: SimLink[];
  sim: Simulation<SimNode, SimLink>;
  byId: Map<string, SimNode>;
}

/**
 * Build a d3-force simulation for a node/edge set. Nodes that already have a
 * position (from the previous view) keep it, so expanding a graph grows it in place
 * instead of reshuffling everything.
 */
export function layout(nodes: VisNode[], edges: VisEdge[], prev?: Map<string, SimNode>): Layout {
  const byId = new Map<string, SimNode>();
  const simNodes: SimNode[] = nodes.map((n) => {
    const old = prev?.get(n.id);
    const sn: SimNode = { ...n, deg: 0, r: 4 };
    if (old) {
      sn.x = old.x;
      sn.y = old.y;
    }
    byId.set(n.id, sn);
    return sn;
  });
  const links: SimLink[] = [];
  for (const e of edges) {
    const a = byId.get(e.src);
    const b = byId.get(e.dst);
    if (!a || !b || a === b) continue;
    a.deg++;
    b.deg++;
    links.push({
      source: a,
      target: b,
      kind: e.kind,
      weight: e.weight,
      count: e.count,
      lines: e.lines,
    });
  }
  for (const n of simNodes) n.r = 4 + Math.min(12, Math.sqrt(n.deg) * 1.8) + (n.root ? 3 : 0);
  const n = simNodes.length;
  const sim = forceSimulation<SimNode, SimLink>(simNodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(links)
        .distance((l) => (l.kind === "co_changes" ? 90 : l.kind === "defines" ? 36 : 60))
        .strength((l) => (l.kind === "co_changes" ? 0.15 : 0.5)),
    )
    .force(
      "charge",
      forceManyBody<SimNode>()
        .strength(n > 400 ? -60 : -140)
        .distanceMax(600),
    )
    .force(
      "collide",
      forceCollide<SimNode>()
        .radius((d) => d.r + 4)
        .iterations(2),
    )
    .force("center", forceCenter(0, 0).strength(0.05))
    .force("x", forceX<SimNode>(0).strength(0.02))
    .force("y", forceY<SimNode>(0).strength(0.02))
    .alphaDecay(n > 400 ? 0.05 : 0.03)
    .velocityDecay(0.4);
  return { nodes: simNodes, links, sim, byId };
}

/**
 * Hierarchy layout: files grouped by folder in columns ordered by depth, their
 * symbols fanned out beneath them. Static (no simulation), good for reading structure.
 */
export function hierarchy(nodes: VisNode[], edges: VisEdge[]): Layout {
  const l = layout(nodes, edges);
  l.sim.stop();
  const files = l.nodes.filter((n) => n.kind === "file");
  const others = l.nodes.filter((n) => n.kind !== "file");
  const byDir = new Map<string, SimNode[]>();
  for (const f of files) {
    const dir = (f.path ?? f.label).split("/").slice(0, -1).join("/") || ".";
    (byDir.get(dir) ?? byDir.set(dir, []).get(dir)!).push(f);
  }
  const dirs = [...byDir.keys()].sort(
    (a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b),
  );
  const colW = 220;
  const rowH = 34;
  let x = (-(dirs.length - 1) * colW) / 2;
  const fileOf = new Map<string, SimNode>();
  for (const d of dirs) {
    const group = byDir.get(d)!.sort((a, b) => a.label.localeCompare(b.label));
    let y = (-(group.length - 1) * rowH) / 2;
    for (const f of group) {
      f.x = x;
      f.y = y;
      f.fx = x;
      f.fy = y;
      fileOf.set(f.path ?? f.label, f);
      y += rowH;
    }
    x += colW;
  }
  // symbols: next to their file, stacked to the right
  const perFile = new Map<string, number>();
  const loose: SimNode[] = [];
  for (const s of others) {
    const f = s.path ? fileOf.get(s.path) : undefined;
    if (!f) {
      loose.push(s);
      continue;
    }
    const k = perFile.get(f.id) ?? 0;
    perFile.set(f.id, k + 1);
    s.x = (f.x ?? 0) + 70 + (k % 3) * 46;
    s.y = (f.y ?? 0) + Math.floor(k / 3) * 14 - 8;
    s.fx = s.x;
    s.fy = s.y;
  }
  let ly = ((dirs.length ? byDir.get(dirs[0]!)!.length : 0) * rowH) / 2 + 60;
  for (const s of loose) {
    s.x = (-(loose.length - 1) * 60) / 2 + loose.indexOf(s) * 60;
    s.y = ly;
    s.fx = s.x;
    s.fy = s.y;
  }
  ly += 40;
  return l;
}
