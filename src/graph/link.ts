import type { StorageAdapter } from "../storage/adapter.js";
import type { GraphEdge, GraphEdgeRow } from "../storage/types.js";
import { fileId, parseId, symId } from "./ids.js";

export interface LinkSummary {
  /** Edges whose `sym:` target was found through a barrel or default export. */
  resolved: number;
  /** Edges re-pointed at the file because the symbol does not exist there. */
  demoted: number;
  /** Previously demoted edges whose symbol now exists. */
  restored: number;
  /** Stub file nodes created for imported files outside the indexed set. */
  stubs: number;
}

const MAX_BARREL_DEPTH = 4;

function metaOf(e: GraphEdgeRow): Record<string, unknown> {
  if (!e.meta) return {};
  try {
    return JSON.parse(e.meta) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Follow `reexports` edges from a file to find where `name` is really defined.
 * `export { a as b } from "./x"` maps b → a in x; `export *` passes the name through.
 */
function viaReexports(
  db: StorageAdapter,
  path: string,
  name: string,
  depth: number,
  seen: Set<string>,
): string | undefined {
  if (depth > MAX_BARREL_DEPTH || seen.has(`${path}#${name}`)) return undefined;
  seen.add(`${path}#${name}`);
  for (const e of db.graphEdgesFrom([fileId(path)], ["reexports"])) {
    if (!e.dst.startsWith("file:")) continue;
    const target = e.dst.slice(5);
    const names = (metaOf(e).names as string[] | undefined) ?? ["*"];
    let inner: string | undefined;
    for (const n of names) {
      if (n === "*") inner = name;
      else if (n === name) inner = name;
      else {
        const m = /^(.+?) as (.+)$/.exec(n);
        if (m && m[2] === name) inner = m[1];
      }
      if (inner) break;
    }
    if (!inner) continue;
    const id = symId(target, inner);
    if (db.graphGetNode(id)) return id;
    const deeper = viaReexports(db, target, inner, depth + 1, seen);
    if (deeper) return deeper;
  }
  return undefined;
}

function defaultExportOf(db: StorageAdapter, path: string): string | undefined {
  const f = db.graphGetNode(fileId(path));
  if (!f?.meta) return undefined;
  try {
    const name = (JSON.parse(f.meta) as { default_export?: string }).default_export;
    return name ? symId(path, name) : undefined;
  } catch {
    return undefined;
  }
}

function replace(db: StorageAdapter, old: GraphEdgeRow, next: GraphEdge): void {
  db.graphDeleteEdges([old]);
  const existing = db
    .graphEdgesFrom([next.src], [next.kind])
    .find((e) => e.dst === next.dst && e.source === next.source);
  if (existing) {
    // Merge counts when the rewritten edge collides with one the parser already emitted.
    const a = metaOf(existing);
    const b = next.meta ?? {};
    next.meta = {
      ...b,
      ...a,
      count: Number(a.count ?? 1) + Number(b.count ?? 1),
    };
    next.confidence = Math.max(existing.confidence, next.confidence ?? 0);
  }
  db.graphUpsertEdges([next]);
}

/**
 * Repair what a single-file parse cannot know, after files have been (re)parsed:
 *  - `sym:barrel#x` → the symbol behind the re-export chain;
 *  - `sym:file#default` → the symbol `export default` names;
 *  - still-unknown symbols → the file node, with `meta.unresolved`, so file-level
 *    impact stays connected and the explorer can count resolution gaps;
 *  - edges to files outside the indexed set get a stub node.
 * Demoted edges are promoted back when their symbol appears later.
 */
export function linkGraph(db: StorageAdapter): LinkSummary {
  const s: LinkSummary = { resolved: 0, demoted: 0, restored: 0, stubs: 0 };
  db.transaction(() => {
    for (const e of db.graphDanglingEdges("sym:")) {
      if (e.source !== "tree-sitter") continue;
      const { rest } = parseId(e.dst);
      const hash = rest.indexOf("#");
      if (hash === -1) continue;
      const path = rest.slice(0, hash);
      const name = rest.slice(hash + 1);
      const meta = metaOf(e);
      const head = name.split(".")[0]!;
      let target: string | undefined;
      if (head === "default") target = defaultExportOf(db, path);
      if (!target) target = viaReexports(db, path, head, 0, new Set());
      if (target && name.includes(".")) {
        const member = `${target}.${name.slice(name.indexOf(".") + 1)}`;
        target = db.graphGetNode(member) ? member : undefined;
      }
      if (target && target !== e.src) {
        replace(db, e, {
          src: e.src,
          dst: target,
          kind: e.kind,
          source: e.source,
          confidence: e.confidence,
          weight: e.weight,
          meta: { ...meta, via: e.dst },
        });
        s.resolved++;
        continue;
      }
      const file = fileId(path);
      if (db.graphGetNode(file) && file !== e.src) {
        replace(db, e, {
          src: e.src,
          dst: file,
          kind: e.kind,
          source: e.source,
          confidence: e.confidence * 0.5,
          weight: e.weight,
          meta: { ...meta, unresolved: name },
        });
        s.demoted++;
      }
    }
    // Promote demoted edges whose symbol exists now (the target file was parsed later).
    for (const e of db.graphEdgesAll()) {
      if (!e.meta?.includes('"unresolved"') || !e.dst.startsWith("file:")) continue;
      const meta = metaOf(e);
      const name = meta.unresolved as string | undefined;
      if (!name) continue;
      const id = symId(e.dst.slice(5), name);
      const target = db.graphGetNode(id)
        ? id
        : viaReexports(db, e.dst.slice(5), name.split(".")[0]!, 0, new Set());
      if (!target || target === e.src) continue;
      const { unresolved: _u, ...rest } = meta;
      replace(db, e, {
        src: e.src,
        dst: target,
        kind: e.kind,
        source: e.source,
        confidence: Math.min(1, e.confidence * 2),
        weight: e.weight,
        meta: rest,
      });
      s.restored++;
    }
    // Imported files that are not in the graph (excluded by glob, e.g. *.d.ts) get a stub.
    const stubs = new Map<string, string>();
    for (const e of db.graphDanglingEdges("file:")) stubs.set(e.dst, e.dst.slice(5));
    if (stubs.size) {
      db.graphUpsertNodes(
        [...stubs].map(([id, path]) => ({
          id,
          kind: "file",
          name: path,
          path,
          source: "analysis" as const,
          meta: { external: true },
        })),
      );
      s.stubs = stubs.size;
    }
  });
  return s;
}
