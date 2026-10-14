/**
 * Whole-graph structure: module clusters and import cycles. Pure functions over
 * adjacency lists so they can be unit-tested without a database.
 */

export interface WeightedEdge {
  a: string;
  b: string;
  weight: number;
}

/**
 * Deterministic label propagation: every node starts in its own cluster and
 * repeatedly adopts the label with the largest summed edge weight among its
 * neighbours (ties → smallest label). Nodes are visited in sorted order and
 * iterations are capped, so the same graph always yields the same clusters.
 * Returns node → cluster id (0..n-1, numbered by cluster size, largest first).
 */
export function labelPropagation(
  nodes: string[],
  edges: WeightedEdge[],
  maxIterations = 20,
): Map<string, number> {
  const order = [...nodes].sort();
  const index = new Map(order.map((n, i) => [n, i]));
  const adj = new Map<string, Array<{ n: string; w: number }>>();
  for (const n of order) adj.set(n, []);
  for (const e of edges) {
    if (!index.has(e.a) || !index.has(e.b) || e.a === e.b) continue;
    adj.get(e.a)!.push({ n: e.b, w: e.weight });
    adj.get(e.b)!.push({ n: e.a, w: e.weight });
  }
  const label = new Map(order.map((n) => [n, index.get(n)!]));
  for (let it = 0; it < maxIterations; it++) {
    let changed = 0;
    for (const n of order) {
      const votes = new Map<number, number>();
      for (const { n: m, w } of adj.get(n)!) {
        const l = label.get(m)!;
        votes.set(l, (votes.get(l) ?? 0) + w);
      }
      if (!votes.size) continue;
      let best = label.get(n)!;
      let bestW = votes.get(best) ?? 0;
      for (const [l, w] of votes) {
        if (w > bestW || (w === bestW && l < best)) {
          best = l;
          bestW = w;
        }
      }
      if (best !== label.get(n)) {
        label.set(n, best);
        changed++;
      }
    }
    if (!changed) break;
  }
  // Renumber by size, largest first, ties by smallest member.
  const groups = new Map<number, string[]>();
  for (const [n, l] of label) {
    const g = groups.get(l) ?? [];
    g.push(n);
    groups.set(l, g);
  }
  const ordered = [...groups.values()]
    .map((g) => g.sort())
    .sort((a, b) => b.length - a.length || a[0]!.localeCompare(b[0]!));
  const out = new Map<string, number>();
  ordered.forEach((g, i) => {
    for (const n of g) out.set(n, i);
  });
  return out;
}

/** Tarjan's strongly connected components over a directed graph; only cycles (size > 1) are returned. */
export function cycles(nodes: string[], edges: Array<{ from: string; to: string }>): string[][] {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n, []);
  for (const e of edges) {
    if (adj.has(e.from) && adj.has(e.to) && e.from !== e.to) adj.get(e.from)!.push(e.to);
  }
  let counter = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  // Iterative Tarjan so deep import chains cannot overflow the call stack.
  for (const start of [...nodes].sort()) {
    if (idx.has(start)) continue;
    const work: Array<{ n: string; i: number }> = [{ n: start, i: 0 }];
    idx.set(start, counter);
    low.set(start, counter);
    counter++;
    stack.push(start);
    onStack.add(start);
    while (work.length) {
      const top = work[work.length - 1]!;
      const succ = adj.get(top.n)!;
      if (top.i < succ.length) {
        const m = succ[top.i++]!;
        if (!idx.has(m)) {
          idx.set(m, counter);
          low.set(m, counter);
          counter++;
          stack.push(m);
          onStack.add(m);
          work.push({ n: m, i: 0 });
        } else if (onStack.has(m)) {
          low.set(top.n, Math.min(low.get(top.n)!, idx.get(m)!));
        }
      } else {
        work.pop();
        const parent = work[work.length - 1];
        if (parent) low.set(parent.n, Math.min(low.get(parent.n)!, low.get(top.n)!));
        if (low.get(top.n) === idx.get(top.n)) {
          const comp: string[] = [];
          let m: string;
          do {
            m = stack.pop()!;
            onStack.delete(m);
            comp.push(m);
          } while (m !== top.n);
          if (comp.length > 1) out.push(comp.sort());
        }
      }
    }
  }
  return out.sort((a, b) => b.length - a.length || a[0]!.localeCompare(b[0]!));
}

/** Longest common directory prefix of a set of paths (`src/graph/` or ``). */
export function commonDir(paths: string[]): string {
  if (!paths.length) return "";
  const parts = paths.map((p) => p.split("/").slice(0, -1));
  const first = parts[0]!;
  let n = first.length;
  for (const p of parts.slice(1)) {
    let i = 0;
    while (i < n && i < p.length && p[i] === first[i]) i++;
    n = i;
  }
  return n ? `${first.slice(0, n).join("/")}/` : "";
}
