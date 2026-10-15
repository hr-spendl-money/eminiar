import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getContext, resetContextCache } from "../../src/context.js";
import { reindexCode } from "../../src/graph/reindex.js";
import { closeAllStorage, getStorage } from "../../src/storage/index.js";

let port = 0;
let root: string;

async function freePort(): Promise<number> {
  return new Promise((res) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });
}

beforeAll(async () => {
  process.env.EMINIAR_HOME = mkdtempSync(join(tmpdir(), "em-home-"));
  process.env.EMINIAR_EMBEDDINGS = "0";
  process.env.EMINIAR_PLUGIN_ROOT = process.cwd();
  root = mkdtempSync(join(tmpdir(), "em-kroot-"));
  writeFileSync(join(root, "package.json"), '{"name":"demo"}');
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/a.ts"), "export function a() { return 1; }\n");
  // A manifest written by hand: the API must notice it and build the doc nodes.
  mkdirSync(join(root, ".eminiar"));
  writeFileSync(
    join(root, ".eminiar/docs.json"),
    JSON.stringify({
      version: 1,
      sources: [
        { name: "zod", kind: "url", urls: ["https://zod.dev/"], provider: "npm:zod", addedAt: "" },
      ],
    }),
  );
  resetContextCache();
  const ctx = getContext(root);
  await reindexCode(ctx, getStorage(ctx));
  port = await freePort();
  const { serve } = await import("../../src/ui/server.js");
  void serve({ port, open: false, root });
  await new Promise((r) => setTimeout(r, 300));
});
afterAll(() => {
  closeAllStorage();
  delete process.env.EMINIAR_HOME;
  delete process.env.EMINIAR_EMBEDDINGS;
  delete process.env.EMINIAR_PLUGIN_ROOT;
});

type K = {
  scope: string;
  focus: string | null;
  nodes: Array<{ id: string; group: string; root?: boolean; missing?: boolean }>;
  edges: Array<{ src: string; dst: string; kind: string }>;
  counts: { nodes: Record<string, number>; edges: Record<string, number> };
};
const j = async <T>(p: string, init?: RequestInit): Promise<T> =>
  (await (await fetch(`http://127.0.0.1:${port}${p}`, init)).json()) as T;

describe("knowledge galaxy endpoint", () => {
  it("serves memories, docs and a focused view", async () => {
    await fetch(`http://127.0.0.1:${port}/api/memories`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "decision",
        name: "core/use-a",
        content: "Call a() from src/a.ts. See mem:core/other.",
        related: "file:src/a.ts",
        tags: "core",
      }),
    });
    const mem = await j<K>("/api/knowledge?scope=memory");
    expect(mem.scope).toBe("memory");
    const ids = mem.nodes.map((n) => n.id);
    expect(ids).toEqual(
      expect.arrayContaining(["memory:core/use-a", "file:src/a.ts", "tag:core", "topic:core"]),
    );
    expect(mem.nodes.find((n) => n.id === "memory:core/other")?.missing).toBe(true);
    expect(mem.counts.edges.links).toBe(1);

    const docs = await j<K>("/api/knowledge?scope=docs");
    expect(docs.nodes.find((n) => n.id === "doc:zod")?.group).toBe("doc");
    expect(docs.edges).toContainEqual(
      expect.objectContaining({ src: "doc:zod", dst: "pkg:zod", kind: "documents" }),
    );

    const focused = await j<K>(`/api/knowledge?focus=${encodeURIComponent("file:src/a.ts")}`);
    expect(focused.focus).toBe("file:src/a.ts");
    expect(focused.nodes.find((n) => n.root)?.id).toBe("file:src/a.ts");
    expect(focused.nodes.map((n) => n.id)).toContain("memory:core/use-a");
  });
});
