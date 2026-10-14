import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProjectContext } from "../context.js";
import type { StorageAdapter } from "../storage/adapter.js";

/** Index source tag prefix for every documentation page: `docs:<name>`. */
export const DOCS_PREFIX = "docs:";

/** One registered documentation source: a local path or a set of URL seeds to crawl. */
export interface DocSource {
  /** Slug, unique in the manifest; the index tag is `docs:<name>`. */
  name: string;
  kind: "url" | "path";
  /** URL seeds (kind `url`); same-origin pages under each seed's directory are crawled. */
  urls?: string[] | undefined;
  /** Project-relative file or directory (kind `path`). */
  path?: string | undefined;
  /** Globs for a directory path (default: the config `index.docs` globs). */
  glob?: string[] | undefined;
  /** Where the source came from: `npm:zod`, `pypi:fastapi`, `go:<module>`, `env:SUMSUB`, `image:nats`, `files:terraform`, `manual`. */
  provider?: string | undefined;
  title?: string | undefined;
  crawl?: { depth?: number | undefined; maxPages?: number | undefined } | undefined;
  ttlHours?: number | undefined;
  tags?: string[] | undefined;
  notes?: string | undefined;
  addedAt: string;
}

export interface DocsManifest {
  version: 1;
  sources: DocSource[];
}

/** What the last sync of a source did; kept in the project DB, not in the committed manifest. */
export interface DocsSyncState {
  at: number;
  pages: number;
  documents: number;
  chunks: number;
  errors: string[];
  skipped: number;
  ms: number;
}

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function docsTag(name: string): string {
  return `${DOCS_PREFIX}${name}`;
}

export function nameFromTag(tag: string): string | undefined {
  return tag.startsWith(DOCS_PREFIX) ? tag.slice(DOCS_PREFIX.length) : undefined;
}

export function isValidName(name: string): boolean {
  return NAME_RE.test(name);
}

/** `@aws-sdk/client-s3` → `aws-sdk-client-s3`, `Sumsub KYC` → `sumsub-kyc`. */
export function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
  return (s || "source").slice(0, 64);
}

export function manifestPathAt(root: string, rel = ".eminiar/docs.json"): string {
  return join(root, rel);
}

export function manifestPath(ctx: ProjectContext): string {
  return manifestPathAt(ctx.root, ctx.config.docs.manifest);
}

function empty(): DocsManifest {
  return { version: 1, sources: [] };
}

function normalize(raw: unknown): DocsManifest {
  if (!raw || typeof raw !== "object") return empty();
  const sources = Array.isArray((raw as DocsManifest).sources) ? (raw as DocsManifest).sources : [];
  const out: DocSource[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    if (!s || typeof s !== "object" || typeof s.name !== "string") continue;
    if (!isValidName(s.name) || seen.has(s.name)) continue;
    if (s.kind !== "url" && s.kind !== "path") continue;
    if (s.kind === "url" && !(Array.isArray(s.urls) && s.urls.length)) continue;
    if (s.kind === "path" && typeof s.path !== "string") continue;
    seen.add(s.name);
    out.push({
      ...s,
      addedAt: typeof s.addedAt === "string" ? s.addedAt : new Date(0).toISOString(),
    });
  }
  return { version: 1, sources: out };
}

/** Read a manifest file; a missing or malformed file reads as empty. */
export function readManifestAt(file: string): DocsManifest {
  if (!existsSync(file)) return empty();
  try {
    return normalize(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return empty();
  }
}

export function readManifest(ctx: ProjectContext): DocsManifest {
  return readManifestAt(manifestPath(ctx));
}

export function writeManifest(ctx: ProjectContext, m: DocsManifest): string {
  const file = manifestPath(ctx);
  mkdirSync(dirname(file), { recursive: true });
  const sorted = {
    version: 1 as const,
    sources: [...m.sources].sort((a, b) => a.name.localeCompare(b.name)),
  };
  writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
  return file;
}

export type DocSourceInput = Omit<DocSource, "addedAt"> & { addedAt?: string | undefined };

/** Validate and fill one source; throws on a bad name or an empty definition. */
export function makeSource(input: DocSourceInput): DocSource {
  const name = isValidName(input.name) ? input.name : slugify(input.name);
  if (!isValidName(name)) throw new Error(`invalid source name "${input.name}"`);
  const urls = (input.urls ?? []).map((u) => u.trim()).filter(Boolean);
  for (const u of urls) {
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      throw new Error(`${name}: "${u}" is not a URL`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      throw new Error(`${name}: only http(s) URLs can be crawled`);
  }
  const path = input.path?.trim();
  if (input.kind === "url" && !urls.length) throw new Error(`${name}: a url source needs urls`);
  if (input.kind === "path" && !path) throw new Error(`${name}: a path source needs a path`);
  if (path && (path.startsWith("/") || path.startsWith("..")))
    throw new Error(`${name}: path must be inside the project`);
  const src: DocSource = {
    name,
    kind: input.kind,
    addedAt: input.addedAt ?? new Date().toISOString(),
  };
  if (input.kind === "url") src.urls = [...new Set(urls)];
  if (input.kind === "path") src.path = path;
  if (input.glob?.length) src.glob = input.glob;
  if (input.provider) src.provider = input.provider;
  if (input.title) src.title = input.title;
  if (input.crawl && (input.crawl.depth !== undefined || input.crawl.maxPages !== undefined))
    src.crawl = {
      ...(input.crawl.depth !== undefined ? { depth: input.crawl.depth } : {}),
      ...(input.crawl.maxPages !== undefined ? { maxPages: input.crawl.maxPages } : {}),
    };
  if (input.ttlHours !== undefined) src.ttlHours = input.ttlHours;
  if (input.tags?.length) src.tags = [...new Set(input.tags)];
  if (input.notes) src.notes = input.notes;
  return src;
}

/** Add or replace sources by name; returns which were new and which replaced an entry. */
export function upsertSources(
  ctx: ProjectContext,
  inputs: DocSourceInput[],
): { added: string[]; updated: string[]; file: string } {
  const m = readManifest(ctx);
  const added: string[] = [];
  const updated: string[] = [];
  for (const input of inputs) {
    const src = makeSource(input);
    const i = m.sources.findIndex((s) => s.name === src.name);
    if (i === -1) {
      m.sources.push(src);
      added.push(src.name);
    } else {
      m.sources[i] = { ...src, addedAt: m.sources[i]!.addedAt };
      updated.push(src.name);
    }
  }
  const file = writeManifest(ctx, m);
  return { added, updated, file };
}

export function removeSource(ctx: ProjectContext, name: string): boolean {
  const m = readManifest(ctx);
  const before = m.sources.length;
  m.sources = m.sources.filter((s) => s.name !== name);
  if (m.sources.length === before) return false;
  writeManifest(ctx, m);
  return true;
}

export function getSource(ctx: ProjectContext, name: string): DocSource | undefined {
  return readManifest(ctx).sources.find((s) => s.name === name);
}

const SYNC_KEY = (name: string) => `docs.sync.${name}`;

export function syncState(db: StorageAdapter, name: string): DocsSyncState | undefined {
  const raw = db.metaGet(SYNC_KEY(name));
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as DocsSyncState;
  } catch {
    return undefined;
  }
}

export function setSyncState(db: StorageAdapter, name: string, state: DocsSyncState): void {
  db.metaSet(SYNC_KEY(name), JSON.stringify(state));
}

export function clearSyncState(db: StorageAdapter, name: string): void {
  db.metaSet(SYNC_KEY(name), "");
}
