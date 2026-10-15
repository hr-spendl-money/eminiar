---
name: decision/knowledge-galaxy
kind: decision
tags: [dashboard, graph, docs, memory]
related: [file:src/docs/graph.ts, file:src/ui/knowledge-api.ts, file:src/memory/store.ts, file:src/ui/web/views/KnowledgeGalaxy.tsx, file:src/ui/web/graph/knowledge.ts, file:src/ui/web/graph/GraphCanvas.tsx, file:src/ui/web/util.ts]
created: 2026-10-15T21:40:00.000Z
updated: 2026-10-15T21:40:00.000Z
---

Knowledge galaxy (branch feature/knowledge-galaxy, v0.7.0, 2026-10-15). Docs and memories share the code graph instead of a parallel store:
- Every source in .eminiar/docs.json is a `doc:<name>` node (kind `doc`, source `curated`, path = the manifest) with `documents` edges to `pkg:` nodes (npm:/pypi:/go: providers; the canonical id even when nothing imports it yet) and to tree-sitter `file:` nodes its local pages are or name by path. `syncDocsGraph` (src/docs/graph.ts) rebuilds them all after docs add/sync/remove; `ensureDocsGraph` rebuilds lazily from a stamp (manifest mtime/size, file and package counts, sync times) so hand edits show up. It deletes with `keepFile: true` so a memory's `related: file:.eminiar/docs.json` edge survives. It never creates `file:` edges to unindexed paths, because linkGraph would stub them as external files.
- Memory `related: mem:x` resolves to `memory:x` only for the graph (`relatedTarget`); the file keeps the `mem:` spelling the UI documents. `mem:` references in a body are a separate `links` edge kind, so the deliberate `related:` list stays distinguishable from passing mentions.
- `about` (memory → local doc source indexing a related page), `tagged`, `in_topic` and the `tag:`/`topic:` hub nodes are derived per request in src/ui/knowledge-api.ts and never stored.
- The dashboard filters the fetched payload client-side (`applyKnowledgeFilter`), so every chip changes what is drawn. Do not refetch on chip changes; that was the main galaxy's bug. GraphCanvas re-lays out on the edge *set*, not its length.
- Palette: no new hues. memory = accent #2563eb (was pink #db2777), doc = #1e40af, tag/topic = greys. Kinds differ by shape: memory diamond, doc square, tag triangle, topic hexagon, missing target hollow ring.
