import { describe, expect, it } from "vitest";
import {
  applyKnowledgeFilter,
  type KnowledgeEdgeLike,
  type KnowledgeFilter,
  type KnowledgeNodeLike,
  knowledgeColorOf,
  knowledgeEdgeStyleOf,
  knowledgeShapeOf,
  NO_FILTER,
} from "../../src/ui/web/graph/knowledge.js";
import { KIND_COLORS } from "../../src/ui/web/util.js";

const node = (id: string, extra: Partial<KnowledgeNodeLike> = {}): KnowledgeNodeLike => {
  const kind = extra.kind ?? id.split(":")[0]!;
  return {
    id,
    label: id.slice(id.indexOf(":") + 1),
    kind,
    group: kind === "memory" ? "memory" : kind === "doc" ? "doc" : "code",
    ...extra,
  };
};
const edge = (src: string, dst: string, kind: string): KnowledgeEdgeLike => ({ src, dst, kind });

const g = {
  nodes: [
    node("memory:a", { seed: true, status: "accepted", sub: "decision" }),
    node("memory:old", { seed: true, status: "superseded", sub: "decision" }),
    node("memory:note", { seed: true, sub: "note" }),
    node("doc:zod", { seed: true, sub: "library" }),
    node("doc:readme", { seed: true, sub: "readme" }),
    node("file:src/a.ts", { kind: "file" }),
    node("pkg:zod", { kind: "package" }),
    node("tag:x", { kind: "tag", group: "hub" }),
  ],
  edges: [
    edge("memory:a", "file:src/a.ts", "mentions"),
    edge("memory:a", "memory:old", "supersedes"),
    edge("memory:a", "tag:x", "tagged"),
    edge("memory:note", "tag:x", "tagged"),
    edge("doc:zod", "pkg:zod", "documents"),
    edge("doc:readme", "file:src/a.ts", "documents"),
  ],
};
const f = (p: Partial<KnowledgeFilter>): KnowledgeFilter => ({ ...NO_FILTER, ...p });
const ids = (v: { nodes: KnowledgeNodeLike[] }) => v.nodes.map((n) => n.id).sort();

describe("knowledge galaxy filters", () => {
  it("keeps everything without a filter", () => {
    const v = applyKnowledgeFilter(g, NO_FILTER);
    expect(v.nodes).toHaveLength(g.nodes.length);
    expect(v.edges).toHaveLength(g.edges.length);
  });

  it("an edge chip removes the edges and the nodes only they connected", () => {
    const v = applyKnowledgeFilter(g, f({ hiddenEdges: new Set(["tagged"]) }));
    expect(v.edges.some((e) => e.kind === "tagged")).toBe(false);
    expect(ids(v)).not.toContain("tag:x");
    // seeds stay even with no edge left
    expect(ids(v)).toContain("memory:note");
    const docsOff = applyKnowledgeFilter(g, f({ hiddenEdges: new Set(["documents"]) }));
    expect(ids(docsOff)).not.toContain("pkg:zod");
    expect(ids(docsOff)).toContain("file:src/a.ts"); // still mentioned by memory:a
  });

  it("a kind chip hides nodes and their edges", () => {
    const v = applyKnowledgeFilter(g, f({ hiddenKinds: new Set(["memory"]) }));
    expect(ids(v)).toEqual(["doc:readme", "doc:zod", "file:src/a.ts", "pkg:zod"]);
    expect(v.edges.every((e) => !e.src.startsWith("memory:"))).toBe(true);
  });

  it("filters memories by status and hides superseded ones, leaving docs alone", () => {
    const hide = applyKnowledgeFilter(g, f({ hideSuperseded: true }));
    expect(ids(hide)).not.toContain("memory:old");
    expect(hide.edges.some((e) => e.kind === "supersedes")).toBe(false);
    const accepted = applyKnowledgeFilter(g, f({ status: "accepted" }));
    // a memory without a status counts as accepted
    expect(ids(accepted)).toContain("memory:note");
    expect(ids(accepted)).not.toContain("memory:old");
    expect(ids(accepted)).toContain("doc:zod");
  });

  it("filters doc sources by category", () => {
    const v = applyKnowledgeFilter(g, f({ category: "library" }));
    expect(ids(v)).toContain("doc:zod");
    expect(ids(v)).not.toContain("doc:readme");
    expect(ids(v)).toContain("memory:a");
  });

  it("tells kinds apart by shape on the grey/blue palette", () => {
    const shapes = ["memory:a", "doc:zod", "tag:x", "file:src/a.ts"].map((id) =>
      knowledgeShapeOf(g.nodes.find((n) => n.id === id)!),
    );
    expect(new Set(shapes).size).toBe(4);
    expect(knowledgeShapeOf(node("memory:gone", { missing: true }))).toBe("ring");
    expect(KIND_COLORS.memory).toBe("#2563eb");
    expect(knowledgeColorOf(g.nodes[1]!)).not.toBe(knowledgeColorOf(g.nodes[0]!));
    expect(knowledgeEdgeStyleOf("links").dash).toBeDefined();
    expect(knowledgeEdgeStyleOf("documents").directed).toBe(true);
  });
});
