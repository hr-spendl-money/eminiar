import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetContextCache } from "../../src/context.js";
import { closeAllStorage } from "../../src/storage/index.js";

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
  root = mkdtempSync(join(tmpdir(), "em-root-"));
  writeFileSync(join(root, "package.json"), "{}");
  writeFileSync(join(root, "README.md"), "# Demo\n\nThe dashboard shows savings.\n");
  resetContextCache();
  port = await freePort();
  const { serve } = await import("../../src/ui/server.js");
  // serve() never resolves (it keeps the process alive); run it detached.
  void serve({ port, open: false, root });
  await new Promise((r) => setTimeout(r, 300));
});
afterAll(() => {
  closeAllStorage();
  delete process.env.EMINIAR_HOME;
  delete process.env.EMINIAR_EMBEDDINGS;
});

const get = async (p: string, init?: RequestInit) => {
  const r = await fetch(`http://127.0.0.1:${port}${p}`, init);
  return { status: r.status, body: await r.text() };
};

describe("dashboard", () => {
  it("serves the page and the JSON API", async () => {
    const page = await get("/");
    expect(page.status).toBe(300 > page.status ? page.status : 200);
    expect(page.body).toContain("<title>eminiar</title>");

    const stats = JSON.parse((await get("/api/stats")).body) as {
      project: string;
      index: { documents: number };
    };
    expect(stats.project).toBe(realpathSync(root));

    const { emIndex } = await import("../../src/tools/em_index.js");
    const { getContext } = await import("../../src/context.js");
    await emIndex.handler({ path: "README.md" }, getContext(root));
    const search = JSON.parse((await get("/api/search?q=savings&mode=lexical")).body) as {
      hits: Array<{ title: string }>;
    };
    expect(search.hits[0]?.title).toContain("README.md");

    const post = (p: string, body: unknown, method = "POST") =>
      get(p, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    const added = JSON.parse(
      (
        await post("/api/memories", {
          kind: "fact",
          content: "dashboard test memory",
          tags: "a, b",
        })
      ).body,
    ) as { id: number; name: string };
    expect(added.id).toBeGreaterThan(0);
    expect(added.name).toBe("fact/dashboard-test-memory");
    type MemList = { memories: Array<{ id: number; name: string; tags: string[] }> };
    const list = JSON.parse((await get("/api/memories")).body) as MemList;
    const mine = list.memories.find((m) => m.id === added.id);
    expect(mine?.tags).toEqual(["a", "b"]);

    const updated = JSON.parse(
      (
        await post(
          `/api/memories?name=${added.name}`,
          { content: "edited body", kind: "note" },
          "PUT",
        )
      ).body,
    ) as { name: string };
    expect(updated.name).toBe(added.name);
    const body = JSON.parse((await get(`/api/memories?name=${added.name}`)).body) as {
      body: string;
      kind: string;
      tags: string[];
    };
    expect(body.body).toBe("edited body");
    expect(body.kind).toBe("note");
    expect(body.tags).toEqual(["a", "b"]);

    const renamed = JSON.parse(
      (await post(`/api/memories?name=${added.name}`, { to: "note/renamed-memory" }, "PATCH")).body,
    ) as { name: string };
    expect(renamed.name).toBe("note/renamed-memory");

    await get("/api/memories?name=note/renamed-memory", { method: "DELETE" });
    expect((JSON.parse((await get("/api/memories")).body) as MemList).memories.length).toBe(
      list.memories.length - 1,
    );

    const sessions = JSON.parse((await get("/api/sessions")).body) as unknown[];
    expect(Array.isArray(sessions)).toBe(true);

    const map = JSON.parse((await get("/api/graph?mode=map")).body) as {
      mode: string;
      nodes: unknown[];
      edges: unknown[];
    };
    expect(map.mode).toBe("map");
    expect(Array.isArray(map.nodes)).toBe(true);
    const sub = JSON.parse((await get("/api/graph?mode=subgraph&node=nope")).body) as {
      error?: string;
    };
    expect(sub.error).toBe("unknown node");

    const action = JSON.parse((await post("/api/actions", { action: "reconcile" })).body) as {
      ok: boolean;
      output: string;
    };
    expect(action.ok).toBe(true);
    expect(action.output).toContain("memories:");
    const refused = JSON.parse(
      (await post("/api/actions", { action: "purge", scope: "index" })).body,
    ) as { ok: boolean };
    expect(refused.ok).toBe(false);
    expect((await get("/api/actions")).status).toBe(405);

    expect((await get("/api/nope")).status).toBe(404);
    expect((await get("/api/search")).status).toBe(400);
  });
});
