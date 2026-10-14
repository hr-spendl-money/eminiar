export interface TreeNode {
  name: string;
  path: string;
  size: number;
  value?: number;
  children?: TreeNode[];
  data?: unknown;
}

export interface Rect {
  node: TreeNode;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
}

/** Squarified treemap (Bruls, Huizing, van Wijk) for one level of children. */
function squarify(items: TreeNode[], x: number, y: number, w: number, h: number): Rect[] {
  const total = items.reduce((a, n) => a + (n.value ?? n.size), 0);
  if (!total || !items.length) return [];
  const scale = (w * h) / total;
  const rows: Rect[] = [];
  let i = 0;
  let cx = x;
  let cy = y;
  let cw = w;
  let ch = h;
  const sorted = [...items].sort((a, b) => (b.value ?? b.size) - (a.value ?? a.size));
  while (i < sorted.length) {
    const horizontal = cw >= ch;
    const side = horizontal ? ch : cw;
    let row: TreeNode[] = [];
    let rowArea = 0;
    let worst = Number.POSITIVE_INFINITY;
    while (i < sorted.length) {
      const n = sorted[i]!;
      const a = (n.value ?? n.size) * scale;
      const candidate = [...row, n];
      const area = rowArea + a;
      const max = Math.max(...candidate.map((c) => (c.value ?? c.size) * scale));
      const min = Math.min(...candidate.map((c) => (c.value ?? c.size) * scale));
      const ratio = Math.max(
        (side * side * max) / (area * area),
        (area * area) / (side * side * min),
      );
      if (ratio > worst && row.length) break;
      worst = ratio;
      row = candidate;
      rowArea = area;
      i++;
    }
    const thick = side ? rowArea / side : 0;
    let off = 0;
    for (const n of row) {
      const len = thick ? ((n.value ?? n.size) * scale) / thick : 0;
      rows.push(
        horizontal
          ? { node: n, x: cx, y: cy + off, w: thick, h: len, depth: 0 }
          : { node: n, x: cx + off, y: cy, w: len, h: thick, depth: 0 },
      );
      off += len;
    }
    if (horizontal) {
      cx += thick;
      cw -= thick;
    } else {
      cy += thick;
      ch -= thick;
    }
  }
  return rows;
}

/** Lay out `root.children` and, for folders, their children inside (two levels). */
export function layoutTreemap(root: TreeNode, w: number, h: number, pad = 18): Rect[] {
  const out: Rect[] = [];
  for (const r of squarify(root.children ?? [], 0, 0, w, h)) {
    out.push({ ...r, depth: 0 });
    if (r.node.children?.length && r.w > 40 && r.h > 30) {
      for (const c of squarify(
        r.node.children,
        r.x + 2,
        r.y + pad,
        Math.max(0, r.w - 4),
        Math.max(0, r.h - pad - 2),
      ))
        out.push({ ...c, depth: 1 });
    }
  }
  return out;
}

/** Fold flat file rows into a folder tree rooted at `prefix` (`""` for the project). */
export function buildTree<T extends { path: string }>(
  files: T[],
  prefix: string,
  value: (f: T) => number,
): TreeNode {
  const root: TreeNode = { name: prefix || "(project)", path: prefix, size: 0, children: [] };
  const dirs = new Map<string, TreeNode>([["", root]]);
  const dirOf = (p: string): TreeNode => {
    const hit = dirs.get(p);
    if (hit) return hit;
    const parent = dirOf(p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
    const node: TreeNode = { name: p.split("/").pop() ?? p, path: p, size: 0, children: [] };
    parent.children!.push(node);
    dirs.set(p, node);
    return node;
  };
  for (const f of files) {
    if (prefix && !f.path.startsWith(prefix)) continue;
    const rel = prefix ? f.path.slice(prefix.length).replace(/^\//, "") : f.path;
    const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    const v = Math.max(1, value(f));
    dirOf(dir).children!.push({
      name: rel.split("/").pop() ?? rel,
      path: f.path,
      size: v,
      data: f,
    });
  }
  const sum = (n: TreeNode): number => {
    if (!n.children?.length) return n.size;
    n.size = n.children.reduce((a, c) => a + sum(c), 0);
    return n.size;
  };
  sum(root);
  return root;
}
