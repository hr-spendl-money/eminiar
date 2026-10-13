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

    const added = JSON.parse(
      (
        await get("/api/memories", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: "fact", content: "dashboard test memory" }),
        })
      ).body,
    ) as { id: number };
    expect(added.id).toBeGreaterThan(0);
    const list = JSON.parse((await get("/api/memories")).body) as Array<{ id: number }>;
    expect(list.some((m) => m.id === added.id)).toBe(true);
    await get(`/api/memories?id=${added.id}`, { method: "DELETE" });
    expect((JSON.parse((await get("/api/memories")).body) as unknown[]).length).toBe(
      list.length - 1,
    );

    expect((await get("/api/nope")).status).toBe(404);
    expect((await get("/api/search")).status).toBe(400);
  });
});
