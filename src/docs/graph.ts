import { existsSync, statSync } from "node:fs";
import { dirname, posix, relative, sep } from "node:path";
import type { ProjectContext } from "../context.js";
import { docId, pkgId } from "../graph/ids.js";
import type { StorageAdapter } from "../storage/adapter.js";
import type { GraphEdge, GraphNode } from "../storage/types.js";
import { type CatalogEntry, catalogForProvider, mergedCatalog } from "./catalog.js";
import { categoryInfo, docCategory } from "./category.js";
import { type DocSource, docsTag, manifestPath, readManifest, syncState } from "./manifest.js";

/**
 * Documentation sources in the code graph. Each source in `.eminiar/docs.json` is a
 * `doc:<name>` node (kind `doc`, source `curated`, path = the manifest) with
 * `documents` edges to what it is about:
 * - a package source (`npm:zod`, `pypi:x`, `go:<module>`) → the `pkg:` node(s) the
 *   code imports it as (the canonical id when nothing imports it yet);
 * - a local source → indexed code files its pages are, or name by path.
 * Rebuilt whole on every call (a manifest holds tens of sources), so a removed source
 * or a renamed file never leaves a stale edge behind.
 */
export const DOCUMENTS_EDGE = "documents";

/** Pages scanned per local source, and edges kept per source. */
const MAX_PAGES = 500;
const MAX_EDGES = 400;

/** `src/x.ts`, `./a/b.md`, `../lib/c.py`: at least one slash and an extension. */
const PATH_RE =
  /(?:^|[\s(`'"[<])((?:\.{1,2}\/)*(?:[\w@.-]+\/)+[\w@.-]+\.[A-Za-z0-9]{1,8})(?=$|[\s)`'"\]>:#,;!?]|\.(?:\s|$))/gm;

function manifestRel(ctx: ProjectContext): string {
  return relative(ctx.root, manifestPath(ctx)).split(sep).join("/");
}

/** Package node ids a provider names, best first. */
export function packageCandidates(provider: string | undefined): string[] {
  if (!provider) return [];
  const i = provider.indexOf(":");
  if (i === -1) return [];
  const kind = provider.slice(0, i);
  const name = provider.slice(i + 1).trim();
  if (!name) return [];
  if (kind === "npm" || kind === "go") return [pkgId(name)];
  if (kind === "pypi") {
    const lower = name.toLowerCase();
    return [...new Set([pkgId(lower.replace(/-/g, "_")), pkgId(lower), pkgId(name)])];
  }
  return [];
}

/** Code files a page names by path, resolved against the project root or the page's folder. */
export function pathsIn(text: string, pageRel: string | undefined, files: Set<string>): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(PATH_RE)) {
    const raw = m[1]!;
    const tries = [raw.replace(/^(\.\/)+/, "")];
    if (pageRel && raw.startsWith("."))
      tries.unshift(posix.normalize(posix.join(dirname(pageRel), raw)));
    for (const t of tries) {
      if (files.has(t)) {
        out.add(t);
        break;
      }
    }
  }
  return [...out];
}

function pageRelOf(ctx: ProjectContext, uri: string | null): string | undefined {
  if (!uri?.startsWith("file://")) return undefined;
  const rel = relative(ctx.root, uri.slice("file://".length)).split(sep).join("/");
  return rel.startsWith("..") ? undefined : rel;
}

function localEdges(
  ctx: ProjectContext,
  db: StorageAdapter,
  src: DocSource,
  files: Set<string>,
): GraphEdge[] {
  const id = docId(src.name);
  const hits = new Map<string, { via: "covers" | "mentions"; count: number }>();
  for (const page of db.documentsBySource(docsTag(src.name), MAX_PAGES)) {
    const rel = pageRelOf(ctx, page.uri);
    if (rel && files.has(rel)) hits.set(rel, { via: "covers", count: 1 });
    const text = db
      .chunksOfDocument(page.id)
      .map((c) => c.body)
      .join("\n");
    for (const f of pathsIn(text, rel, files)) {
      const h = hits.get(f);
      if (h) h.count++;
      else hits.set(f, { via: "mentions", count: 1 });
    }
    if (hits.size >= MAX_EDGES) break;
  }
  return [...hits]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, MAX_EDGES)
    .map(([rel, h]) => ({
      src: id,
      dst: `file:${rel}`,
      kind: DOCUMENTS_EDGE,
      source: "curated" as const,
      confidence: h.via === "covers" ? 1 : 0.8,
      weight: Math.min(1, 0.5 + h.count / 10),
      meta: { via: h.via, count: h.count },
    }));
}

function packageEdges(src: DocSource, packages: Set<string>): GraphEdge[] {
  const id = docId(src.name);
  const cands = packageCandidates(src.provider);
  if (!cands.length) return [];
  let targets = cands.filter((c) => packages.has(c));
  // A Go module is imported by its packages: `go:github.com/x/y` documents `…/y/sub`.
  if (src.provider?.startsWith("go:"))
    targets = [...targets, ...[...packages].filter((p) => p.startsWith(`${cands[0]}/`))];
  if (!targets.length) targets = [cands[0]!];
  return [...new Set(targets)].map((dst) => ({
    src: id,
    dst,
    kind: DOCUMENTS_EDGE,
    source: "curated" as const,
    confidence: 1,
    weight: 1,
    meta: { via: "provider" },
  }));
}

/** Project-relative page path → the local sources that index it (`docs`, `readme` …). */
export function localDocPages(ctx: ProjectContext, db: StorageAdapter): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const s of readManifest(ctx).sources) {
    if (s.kind !== "path") continue;
    for (const page of db.documentsBySource(docsTag(s.name), MAX_PAGES)) {
      const rel = pageRelOf(ctx, page.uri);
      if (!rel) continue;
      const names = out.get(rel) ?? [];
      if (!names.includes(s.name)) names.push(s.name);
      out.set(rel, names);
    }
  }
  return out;
}

const STAMP_KEY = "docs.graph.stamp";

/** Changes when the manifest, a sync or the code graph's files/packages change. */
function stampOf(ctx: ProjectContext, db: StorageAdapter): string {
  const file = manifestPath(ctx);
  const st = existsSync(file) ? statSync(file) : undefined;
  const counts = db.graphNodeCounts();
  const syncs = readManifest(ctx)
    .sources.map((s) => syncState(db, s.name)?.at ?? 0)
    .join(",");
  return `${st ? `${Math.floor(st.mtimeMs)}:${st.size}` : "none"}|${counts.file ?? 0}|${counts.package ?? 0}|${syncs}`;
}

export interface DocsGraphSummary {
  sources: number;
  edges: number;
}

/** Rebuild every `doc:` node and its `documents` edges from the manifest and the index. */
export function syncDocsGraph(ctx: ProjectContext, db: StorageAdapter): DocsGraphSummary {
  const rel = manifestRel(ctx);
  const m = readManifest(ctx);
  const catalog = mergedCatalog(ctx.config.docs.catalog as CatalogEntry[]);
  const files = new Set(
    db
      .graphFileNodes()
      .filter((n) => n.source === "tree-sitter" && n.path)
      .map((n) => n.path!),
  );
  const packages = new Set(db.graphNodesByKind(["package"]).map((n) => n.id));
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (const s of m.sources) {
    const category = docCategory(
      s,
      s.provider ? catalogForProvider(s.provider, catalog) : undefined,
    );
    nodes.push({
      id: docId(s.name),
      kind: "doc",
      name: s.name,
      path: rel,
      source: "curated",
      meta: {
        category,
        group: categoryInfo(category).group,
        sourceKind: s.kind,
        ...(s.provider ? { provider: s.provider } : {}),
        ...(s.title ? { title: s.title } : {}),
        ...(s.tags?.length ? { tags: s.tags } : {}),
        ...(s.kind === "path" ? { target: s.path } : { url: s.urls?.[0] }),
        documents: db.countDocuments(docsTag(s.name)),
      },
    });
    edges.push(...packageEdges(s, packages));
    if (s.kind === "path") edges.push(...localEdges(ctx, db, s, files));
  }
  // keepFile: a memory's `related: file:.eminiar/docs.json` edge must survive.
  db.graphDeleteForPath("curated", rel, { keepFile: true });
  if (nodes.length) db.graphUpsertNodes(nodes);
  if (edges.length) db.graphUpsertEdges(edges);
  db.metaSet(STAMP_KEY, stampOf(ctx, db));
  return { sources: nodes.length, edges: edges.length };
}

/** Rebuild only when something it reads changed (a hand-edited manifest included). */
export function ensureDocsGraph(ctx: ProjectContext, db: StorageAdapter): boolean {
  if (db.metaGet(STAMP_KEY) === stampOf(ctx, db)) return false;
  syncDocsGraph(ctx, db);
  return true;
}

/** Never let graph bookkeeping fail a docs command. */
export function syncDocsGraphQuietly(ctx: ProjectContext, db: StorageAdapter): void {
  try {
    syncDocsGraph(ctx, db);
  } catch {
    // the dashboard rebuilds it lazily (ensureDocsGraph)
  }
}
