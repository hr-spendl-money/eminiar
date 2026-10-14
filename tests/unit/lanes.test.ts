import { describe, expect, it } from "vitest";
import { laneSegments, layoutLanes } from "../../src/ui/web/history/lanes.js";

/**
 * M ← merge of A (first parent) and B
 * A ← C
 * B ← C
 * C ← (root)
 */
const dag = [
  { sha: "M", parents: ["A", "B"] },
  { sha: "A", parents: ["C"] },
  { sha: "B", parents: ["C"] },
  { sha: "C", parents: [] },
];

describe("layoutLanes", () => {
  it("keeps the first parent in the lane, forks the second, joins at the common ancestor", () => {
    const { rows, lanes } = layoutLanes(dag);
    expect(lanes).toBe(2);
    expect(rows.map((r) => [r.c.sha, r.lane])).toEqual([
      ["M", 0],
      ["A", 0],
      ["B", 1],
      ["C", 0],
    ]);
    expect(rows[0]!.forks).toEqual([1]);
    expect(rows[3]!.joins).toEqual([1]);
    expect(rows[3]!.after).toEqual([]);
  });
  it("yields a fork curve after the merge and a join curve into the ancestor", () => {
    const segs = laneSegments(layoutLanes(dag).rows);
    expect(segs).toContainEqual({ kind: "curve", fromLane: 0, toLane: 1, from: 0, to: 1, lane: 1 });
    expect(segs).toContainEqual({ kind: "line", lane: 0, from: 0, to: 1 });
    expect(segs).toContainEqual({ kind: "line", lane: 1, from: 1, to: 2 });
    expect(segs).toContainEqual({ kind: "curve", fromLane: 1, toLane: 0, from: 2, to: 3, lane: 1 });
    expect(segs).toContainEqual({ kind: "line", lane: 0, from: 2, to: 3 });
  });
  it("handles a linear history and a second parent that is the very next commit", () => {
    const linear = layoutLanes([
      { sha: "b", parents: ["a"] },
      { sha: "a", parents: [] },
    ]);
    expect(linear.lanes).toBe(1);
    expect(laneSegments(linear.rows)).toEqual([{ kind: "line", lane: 0, from: 0, to: 1 }]);
    // merge whose second parent is listed right after it: the fork lands on the next row
    const tight = layoutLanes([
      { sha: "M", parents: ["A", "B"] },
      { sha: "B", parents: ["A"] },
      { sha: "A", parents: [] },
    ]);
    expect(tight.rows.map((r) => r.lane)).toEqual([0, 1, 0]);
    const segs = laneSegments(tight.rows);
    expect(segs).toContainEqual({ kind: "curve", fromLane: 0, toLane: 1, from: 0, to: 1, lane: 1 });
    expect(segs).toContainEqual({ kind: "curve", fromLane: 1, toLane: 0, from: 1, to: 2, lane: 1 });
  });
});
