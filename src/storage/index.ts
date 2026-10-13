import type { ProjectContext } from "../context.js";
import type { StorageAdapter } from "./adapter.js";
import { SqliteAdapter } from "./sqlite/adapter.js";

const open = new Map<string, StorageAdapter>();

/** One adapter per project DB per process. Hooks pass `vectors: false` to skip loading sqlite-vec. */
export function getStorage(ctx: ProjectContext, opts: { vectors?: boolean } = {}): StorageAdapter {
  const key = `${ctx.dbPath}|${opts.vectors === false ? "novec" : "vec"}`;
  let adapter = open.get(key);
  if (!adapter) {
    adapter = new SqliteAdapter(ctx.dbPath, {
      dims: ctx.config.embeddings.dims,
      vectors: opts.vectors ?? true,
    });
    open.set(key, adapter);
  }
  return adapter;
}

export function closeAllStorage(): void {
  for (const a of open.values()) a.close();
  open.clear();
}
