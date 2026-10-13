import type { ProjectContext } from "../context.js";
import type { StorageAdapter } from "../storage/adapter.js";
import type { SearchFilters } from "../storage/types.js";
import { type EmbeddingProvider, getProvider, providerIfLoaded } from "./provider.js";

/** Embed chunks with embedded=0 in batches; returns how many were embedded. */
export async function embedPending(
  db: StorageAdapter,
  provider: EmbeddingProvider,
  opts: { max?: number; batch?: number } = {},
): Promise<number> {
  const max = opts.max ?? 5000;
  const batchSize = opts.batch ?? 64;
  let total = 0;
  while (total < max) {
    const ids = db.unembeddedChunkIds(Math.min(batchSize, max - total));
    if (!ids.length) break;
    const chunks = db.getChunks(ids);
    const texts = chunks.map((c) => (c.title ? `${c.title}\n${c.body}` : c.body));
    const vectors = await provider.embed(texts, "passage");
    db.transaction(() => {
      chunks.forEach((c, i) => {
        const v = vectors[i];
        if (v) db.vecUpsert(c.id, v);
      });
      db.markEmbedded(chunks.map((c) => c.id));
    });
    total += chunks.length;
    // A chunk that produced no vector is still marked embedded so we never spin on it.
  }
  return total;
}

const pending = new Map<string, NodeJS.Timeout>();
let running = false;

/**
 * Debounced background embedding for a project. Called after any indexing;
 * never awaited by tool handlers so they stay fast. Runs one project at a time.
 */
export function kickEmbedding(ctx: ProjectContext, db: StorageAdapter, delayMs = 500): void {
  if (!ctx.config.embeddings.enabled) return;
  const key = ctx.dbPath;
  const prev = pending.get(key);
  if (prev) clearTimeout(prev);
  const t = setTimeout(async () => {
    pending.delete(key);
    if (running) {
      kickEmbedding(ctx, db, 2000);
      return;
    }
    running = true;
    try {
      const provider = await getProvider(ctx.config);
      if (provider) await embedPending(db, provider, { max: 2000 });
    } catch (err) {
      process.stderr.write(`eminiar: background embedding failed: ${(err as Error).message}\n`);
    } finally {
      running = false;
    }
  }, delayMs);
  t.unref();
  pending.set(key, t);
}

/**
 * Vector ranker for the search pipeline. If the model is not loaded yet it
 * starts loading in the background and returns no hits (lexical results carry
 * the query), so a search never waits on a download.
 */
export async function vectorRanker(
  ctx: ProjectContext,
  db: StorageAdapter,
): Promise<((q: string, k: number, f?: SearchFilters) => Promise<number[]>) | undefined> {
  const provider = await getProvider(ctx.config);
  if (!provider) return undefined;
  if (!provider.ready()) {
    provider.warm();
    return undefined;
  }
  return async (q, k, f) => {
    const [v] = await provider.embed([q], "query");
    if (!v) return [];
    return db.vecSearch(v, k, f).map((h) => h.chunkId);
  };
}

export function embeddingStatus(ctx: ProjectContext, db: StorageAdapter): string {
  if (!ctx.config.embeddings.enabled) return "disabled";
  const p = providerIfLoaded();
  const backlog = db.unembeddedChunkIds(1).length ? ", backlog pending" : "";
  if (p?.error()) return `failed: ${p.error()}`;
  return p?.ready()
    ? `ready · ${ctx.config.embeddings.model} · ${db.vecCount()} vectors${backlog}`
    : `not loaded yet · ${db.vecCount()} vectors${backlog}`;
}
