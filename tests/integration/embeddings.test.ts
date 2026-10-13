import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../../src/config.js";
import { getProvider } from "../../src/embeddings/provider.js";
import { embedPending } from "../../src/embeddings/queue.js";
import { indexContent } from "../../src/index/indexer.js";
import { search } from "../../src/search/pipeline.js";
import { SqliteAdapter } from "../../src/storage/sqlite/adapter.js";

// Downloads ~35 MB on first run; opt in with EMINIAR_TEST_EMBED=1.
const enabled = process.env.EMINIAR_TEST_EMBED === "1";

describe.skipIf(!enabled)("local embeddings", () => {
  it("embeds chunks and finds a paraphrase that shares no keywords", async () => {
    const dir = mkdtempSync(join(tmpdir(), "em-vec-"));
    const db = new SqliteAdapter(join(dir, "t.db"));
    const config = ConfigSchema.parse({});
    const provider = (await getProvider(config))!;
    expect(provider).toBeDefined();

    indexContent(db, { source: "file", title: "a", content: "The cat sat on the mat." });
    indexContent(db, {
      source: "file",
      title: "b",
      content: "Quarterly revenue grew by twelve percent.",
    });
    indexContent(db, {
      source: "file",
      title: "c",
      content: "Restart the postgres service after changing max_connections.",
    });
    const n = await embedPending(db, provider);
    expect(n).toBe(3);
    expect(db.vecCount()).toBe(3);

    const vectorSearch = async (q: string, k: number) => {
      const [v] = await provider.embed([q], "query");
      return db.vecSearch(v!, k).map((h) => h.chunkId);
    };
    const r = await search(db, "feline resting on a rug", { mode: "semantic", vectorSearch });
    expect(r.used).toEqual(["vector"]);
    expect(r.hits[0]!.chunk.title).toBe("a");

    const hybrid = await search(db, "database connection limit", { mode: "hybrid", vectorSearch });
    expect(hybrid.hits[0]!.chunk.title).toBe("c");
    db.close();
  }, 300_000);
});
