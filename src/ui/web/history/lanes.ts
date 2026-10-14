/**
 * Lane layout for a commit DAG listed newest first (what `git log --graph` draws, as
 * data). Each lane waits for one sha; a commit lands in the lane waiting for it (or a
 * free one), its first parent inherits the lane, other parents fork into new lanes, and
 * lanes that were waiting for the same commit join it. Pure, so it is unit-tested.
 */
export interface LaneCommit {
  sha: string;
  parents: string[];
}

export interface LaneRow<T extends LaneCommit = LaneCommit> {
  c: T;
  lane: number;
  /** Lanes still active after this row, each with the sha it is waiting for. */
  after: Array<string | null>;
  /** Lanes (other than `lane`) that were waiting for this commit: they merge in here. */
  joins: number[];
  /** Lanes that second and later parents continue in (new or already waiting for them). */
  forks: number[];
}

export function layoutLanes<T extends LaneCommit>(
  commits: T[],
): { rows: LaneRow<T>[]; lanes: number } {
  const lanes: Array<string | null> = [];
  const rows: LaneRow<T>[] = [];
  let max = 0;
  const slot = (sha: string) => {
    let i = lanes.indexOf(null);
    if (i === -1) {
      i = lanes.length;
      lanes.push(sha);
    } else lanes[i] = sha;
    return i;
  };
  for (const c of commits) {
    let lane = lanes.indexOf(c.sha);
    if (lane === -1) lane = slot(c.sha);
    const joins: number[] = [];
    for (let j = 0; j < lanes.length; j++)
      if (j !== lane && lanes[j] === c.sha) {
        joins.push(j);
        lanes[j] = null;
      }
    const forks: number[] = [];
    const parents = c.parents;
    if (!parents.length) lanes[lane] = null;
    else {
      lanes[lane] = parents[0]!;
      for (const p of parents.slice(1)) {
        let pl = lanes.indexOf(p);
        if (pl === -1) pl = slot(p);
        forks.push(pl);
      }
    }
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    max = Math.max(max, lanes.length, lane + 1);
    rows.push({ c, lane, after: [...lanes], joins, forks });
  }
  return { rows, lanes: max };
}

export type Segment =
  | { kind: "line"; lane: number; from: number; to: number }
  | { kind: "curve"; fromLane: number; toLane: number; from: number; to: number; lane: number };

/** The drawable segments between consecutive rows, derived from the layout. */
export function laneSegments(rows: LaneRow[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const r = rows[i]!;
    const next = rows[i + 1]!;
    for (let j = 0; j < r.after.length; j++) {
      const expect = r.after[j];
      if (!expect) continue;
      if (expect === next.c.sha && j !== next.lane)
        // this lane's line of history ends in the next commit, drawn in another lane
        out.push({ kind: "curve", fromLane: j, toLane: next.lane, from: i, to: i + 1, lane: j });
      else if (r.forks.includes(j) && j !== r.lane)
        // a second parent leaves this commit towards its own lane
        out.push({ kind: "curve", fromLane: r.lane, toLane: j, from: i, to: i + 1, lane: j });
      else out.push({ kind: "line", lane: j, from: i, to: i + 1 });
    }
  }
  return out;
}
