import type { ProjectContext } from "../context.js";
import { kickEmbedding } from "../embeddings/queue.js";
import { type Fetched, fetchMarkdown } from "../fetch/fetcher.js";
import { indexContent, indexPath } from "../index/indexer.js";
import type { StorageAdapter } from "../storage/adapter.js";
import { type DocSource, docsTag, readManifest, setSyncState } from "./manifest.js";
import { looksLikeSpec, specToMarkdown } from "./specs.js";

export interface SyncResult {
  name: string;
  kind: DocSource["kind"];
  /** Pages fetched or files scanned. */
  pages: number;
  indexed: number;
  unchanged: number;
  cached: number;
  chunks: number;
  skipped: number;
  /** OpenAPI documents / Postman collections rendered per operation. */
  specs: number;
  errors: string[];
  ms: number;
}

export interface SyncOptions {
  force?: boolean | undefined;
  concurrency?: number | undefined;
  /** Injectable for tests. */
  fetchImpl?: typeof fetchMarkdown | undefined;
  onPage?: ((url: string, line: string) => void) | undefined;
}

const SKIP_EXT =
  /\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|map|zip|gz|tgz|tar|pdf|woff2?|ttf|otf|eot|mp4|mp3|webm|xml|rss|atom|wasm)$/i;

/** The part of a seed's path that crawled links must stay under. */
export function scopeOf(seed: URL): string {
  const p = seed.pathname;
  if (p.endsWith("/")) return p;
  const last = p.slice(p.lastIndexOf("/") + 1);
  // `/docs/api.html` → `/docs/`; `/reference/react` → `/reference/react` (a section prefix)
  return last.includes(".") ? p.slice(0, p.lastIndexOf("/") + 1) : p;
}

export function normalizeUrl(href: string, base: string): string | undefined {
  try {
    const u = new URL(href, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    u.hash = "";
    u.search = "";
    return u.toString();
  } catch {
    return undefined;
  }
}

/** Links in turndown-style markdown: `[text](href)`, `<https://…>`; images are skipped by extension later. */
export function extractLinks(markdown: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of markdown.matchAll(/\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g)) {
    const u = normalizeUrl(m[1]!, base);
    if (u) out.add(u);
  }
  for (const m of markdown.matchAll(/<(https?:\/\/[^>\s]+)>/g)) {
    const u = normalizeUrl(m[1]!, base);
    if (u) out.add(u);
  }
  return [...out];
}

function inScope(url: string, scopes: Array<{ origin: string; prefix: string }>): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (SKIP_EXT.test(u.pathname)) return false;
  return scopes.some((s) => u.origin === s.origin && u.pathname.startsWith(s.prefix));
}

async function syncUrlSource(
  ctx: ProjectContext,
  db: StorageAdapter,
  src: DocSource,
  r: SyncResult,
  opts: SyncOptions,
): Promise<void> {
  const tag = docsTag(src.name);
  const depthMax = src.crawl?.depth ?? ctx.config.docs.crawl.depth;
  const maxPages = src.crawl?.maxPages ?? ctx.config.docs.crawl.maxPages;
  const ttlMs = (src.ttlHours ?? ctx.config.docs.ttlHours) * 3600 * 1000;
  const fetchPage = opts.fetchImpl ?? fetchMarkdown;
  const seeds = (src.urls ?? []).map((u) => normalizeUrl(u, u)).filter((u): u is string => !!u);
  const scopes = seeds.map((s) => {
    const u = new URL(s);
    return { origin: u.origin, prefix: scopeOf(u) };
  });
  if (opts.force) db.deleteDocumentsBySource(tag);

  const queue: Array<{ url: string; depth: number }> = seeds.map((url) => ({ url, depth: 0 }));
  const seen = new Set(seeds);
  let claimed = 0;
  const worker = async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      if (claimed >= maxPages) return;
      claimed++;
      let f: Fetched;
      try {
        f = await fetchPage(next.url, { ttlMs, force: opts.force ?? false, timeoutMs: 15_000 });
      } catch (err) {
        r.errors.push(`${next.url}: ${(err as Error).message}`);
        continue;
      }
      r.pages++;
      if (f.cached) r.cached++;
      if (f.status && f.status >= 400) {
        r.errors.push(`${next.url}: HTTP ${f.status}`);
        continue;
      }
      if (!f.markdown.trim()) {
        r.skipped++;
        continue;
      }
      // An OpenAPI document or Postman collection is rendered one section per operation.
      const spec = looksLikeSpec(next.url, f.markdown) ? specToMarkdown(f.markdown) : undefined;
      if (spec) r.specs++;
      const ir = indexContent(db, {
        source: tag,
        title: spec
          ? `${spec.title} (${next.url})`
          : f.title
            ? `${f.title} (${next.url})`
            : next.url,
        uri: next.url,
        content: spec?.markdown ?? f.markdown,
        kind: "markdown",
        meta: {
          docs: src.name,
          url: next.url,
          depth: next.depth,
          ...(spec ? { spec: spec.kind, operations: spec.operations } : {}),
        },
      });
      if (ir.created) r.indexed++;
      else r.unchanged++;
      r.chunks += ir.chunks;
      opts.onPage?.(next.url, `${f.cached ? "cached" : "fetched"} · ${ir.chunks} chunks`);
      if (next.depth < depthMax && !spec) {
        for (const link of extractLinks(f.markdown, next.url)) {
          if (seen.has(link) || !inScope(link, scopes)) continue;
          seen.add(link);
          queue.push({ url: link, depth: next.depth + 1 });
        }
      }
    }
  };
  // Workers re-check the queue after each page, so links found late are still crawled.
  const n = Math.max(1, Math.min(opts.concurrency ?? 3, maxPages));
  let active = true;
  while (active) {
    await Promise.all(Array.from({ length: n }, worker));
    active = queue.length > 0 && claimed < maxPages;
  }
}

function syncPathSource(
  ctx: ProjectContext,
  db: StorageAdapter,
  src: DocSource,
  r: SyncResult,
  opts: SyncOptions,
): void {
  const tag = docsTag(src.name);
  if (opts.force) db.deleteDocumentsBySource(tag);
  const s = indexPath(db, ctx.root, src.path as string, {
    source: tag,
    globs: src.glob ?? ctx.config.index.docs,
    recursive: true,
    transform: (content, rel) => {
      if (!looksLikeSpec(rel, content)) return undefined;
      const spec = specToMarkdown(content);
      if (!spec) return undefined;
      r.specs++;
      return { content: spec.markdown, title: spec.title, kind: "markdown" };
    },
  });
  r.pages = s.files;
  r.indexed = s.indexed;
  r.unchanged = s.unchanged;
  r.chunks = s.chunks;
  r.skipped = s.skipped.length;
  r.errors.push(...s.skipped.slice(0, 5).map((k) => `${k.path}: ${k.reason}`));
}

/** Fetch/scan one source and (re)index it under `docs:<name>`; records the outcome in the DB. */
export async function syncSource(
  ctx: ProjectContext,
  db: StorageAdapter,
  src: DocSource,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const started = Date.now();
  const r: SyncResult = {
    name: src.name,
    kind: src.kind,
    pages: 0,
    indexed: 0,
    unchanged: 0,
    cached: 0,
    chunks: 0,
    skipped: 0,
    specs: 0,
    errors: [],
    ms: 0,
  };
  try {
    if (src.kind === "url") await syncUrlSource(ctx, db, src, r, opts);
    else syncPathSource(ctx, db, src, r, opts);
  } catch (err) {
    r.errors.push((err as Error).message);
  }
  r.ms = Date.now() - started;
  setSyncState(db, src.name, {
    at: Date.now(),
    pages: r.pages,
    documents: db.countDocuments(docsTag(src.name)),
    chunks: r.chunks,
    errors: r.errors.slice(0, 10),
    skipped: r.skipped,
    ms: r.ms,
  });
  kickEmbedding(ctx, db);
  return r;
}

/** Sync every registered source, or only `names`. Unknown names are reported as errors. */
export async function syncSources(
  ctx: ProjectContext,
  db: StorageAdapter,
  names?: string[] | undefined,
  opts: SyncOptions = {},
): Promise<SyncResult[]> {
  const m = readManifest(ctx);
  const wanted = names?.length ? m.sources.filter((s) => names.includes(s.name)) : m.sources;
  const out: SyncResult[] = [];
  for (const name of names ?? []) {
    if (!m.sources.some((s) => s.name === name))
      out.push({
        name,
        kind: "url",
        pages: 0,
        indexed: 0,
        unchanged: 0,
        cached: 0,
        chunks: 0,
        skipped: 0,
        specs: 0,
        errors: ["not registered"],
        ms: 0,
      });
  }
  for (const src of wanted) out.push(await syncSource(ctx, db, src, opts));
  return out;
}

export function formatSync(results: SyncResult[]): string {
  return results
    .map((r) => {
      const bits = [
        `${r.pages} ${r.kind === "url" ? "page(s)" : "file(s)"}`,
        `${r.indexed} indexed`,
        `${r.unchanged} unchanged`,
        ...(r.cached ? [`${r.cached} from cache`] : []),
        `${r.chunks} chunks`,
        ...(r.specs ? [`${r.specs} API spec(s) rendered per operation`] : []),
        ...(r.skipped ? [`${r.skipped} skipped`] : []),
        `${r.ms} ms`,
      ];
      const errs = r.errors.length
        ? `\n  ${r.errors.slice(0, 5).join("\n  ")}${r.errors.length > 5 ? `\n  … ${r.errors.length - 5} more` : ""}`
        : "";
      return `${r.name}: ${bits.join(" · ")}${errs}`;
    })
    .join("\n");
}
