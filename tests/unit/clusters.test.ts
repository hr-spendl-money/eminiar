import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../../src/graph/changes.js";
import { commonDir, cycles, labelPropagation } from "../../src/graph/clusters.js";
import { fileRoutes, routePathFromLiteral } from "../../src/graph/routes.js";

describe("labelPropagation", () => {
  it("separates two dense groups joined by one weak edge and numbers by size", () => {
    const nodes = ["a", "b", "c", "x", "y", "z", "w"];
    const edges = [
      { a: "a", b: "b", weight: 1 },
      { a: "b", b: "c", weight: 1 },
      { a: "a", b: "c", weight: 1 },
      { a: "x", b: "y", weight: 1 },
      { a: "y", b: "z", weight: 1 },
      { a: "x", b: "z", weight: 1 },
      { a: "z", b: "w", weight: 1 },
      { a: "c", b: "x", weight: 0.1 },
    ];
    const l = labelPropagation(nodes, edges);
    expect(l.get("a")).toBe(l.get("b"));
    expect(l.get("b")).toBe(l.get("c"));
    expect(l.get("x")).toBe(l.get("y"));
    expect(l.get("z")).toBe(l.get("w"));
    expect(l.get("a")).not.toBe(l.get("x"));
    // the 4-node group is cluster 0
    expect(l.get("x")).toBe(0);
    expect(l.get("a")).toBe(1);
    // deterministic
    expect([...labelPropagation(nodes, edges)]).toEqual([...l]);
  });

  it("gives isolated nodes their own cluster", () => {
    const l = labelPropagation(["a", "b"], []);
    expect(l.get("a")).not.toBe(l.get("b"));
  });
});

describe("cycles", () => {
  it("returns strongly connected components with more than one node", () => {
    const c = cycles(
      ["a", "b", "c", "d", "e", "f"],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" },
        { from: "c", to: "d" },
        { from: "d", to: "e" },
        { from: "e", to: "d" },
        { from: "e", to: "f" },
      ],
    );
    expect(c).toEqual([
      ["a", "b", "c"],
      ["d", "e"],
    ]);
  });

  it("handles long chains without recursion", () => {
    const n = 5000;
    const nodes = Array.from({ length: n }, (_, i) => `n${i}`);
    const edges = nodes.slice(1).map((to, i) => ({ from: `n${i}`, to }));
    edges.push({ from: `n${n - 1}`, to: "n0" });
    expect(cycles(nodes, edges)[0]!.length).toBe(n);
  });
});

describe("commonDir", () => {
  it("finds the shared folder", () => {
    expect(commonDir(["src/graph/a.ts", "src/graph/b.ts"])).toBe("src/graph/");
    expect(commonDir(["src/graph/a.ts", "src/ui/b.ts"])).toBe("src/");
    expect(commonDir(["a.ts", "src/b.ts"])).toBe("");
  });
});

describe("parseUnifiedDiff", () => {
  it("maps hunks to new-side line ranges, treating deletions as one touched line", () => {
    const text = [
      "diff --git a/src/x.ts b/src/x.ts",
      "--- a/src/x.ts",
      "+++ b/src/x.ts",
      "@@ -3,0 +4,2 @@",
      "+a",
      "+b",
      "@@ -10 +12 @@",
      "-old",
      "+new",
      "@@ -20,3 +22,0 @@",
      "-gone",
      "diff --git a/src/removed.ts b/src/removed.ts",
      "--- a/src/removed.ts",
      "+++ /dev/null",
      "@@ -1,5 +0,0 @@",
    ].join("\n");
    expect(parseUnifiedDiff(text)).toEqual([
      { path: "src/x.ts", start: 4, end: 5 },
      { path: "src/x.ts", start: 12, end: 12 },
      { path: "src/x.ts", start: 22, end: 22 },
    ]);
  });
});

describe("routes helpers", () => {
  it("accepts string and template literals that start with /", () => {
    expect(routePathFromLiteral('"/users/:id"')).toBe("/users/:id");
    expect(routePathFromLiteral("`/health`")).toBe("/health");
    expect(routePathFromLiteral("`/x/${id}`")).toBeUndefined();
    expect(routePathFromLiteral('"users"')).toBeUndefined();
  });

  it("derives Next.js routes from file locations", () => {
    expect(
      fileRoutes("app/api/users/[id]/route.ts", ["GET", "DELETE", "helper"], undefined),
    ).toEqual([
      { method: "GET", path: "/api/users/:id", handler: "GET", framework: "next" },
      { method: "DELETE", path: "/api/users/:id", handler: "DELETE", framework: "next" },
    ]);
    expect(fileRoutes("src/app/(marketing)/blog/[...slug]/route.ts", ["POST"], undefined)).toEqual([
      { method: "POST", path: "/blog/*slug", handler: "POST", framework: "next" },
    ]);
    expect(fileRoutes("pages/api/hello.ts", [], "handler")).toEqual([
      { method: "ALL", path: "/api/hello", handler: "handler", framework: "next" },
    ]);
    expect(fileRoutes("src/lib/route.helper.ts", ["GET"], undefined)).toEqual([]);
  });
});
