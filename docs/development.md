# Development

[← Docs index](README.md)

## Build and run

```sh
npm install
npm run build             # tsup (node + browser bundles), tree-sitter grammars, config schema
claude --plugin-dir "$PWD"   # run Claude Code with this checkout as the plugin
```

| Script | What it does |
|---|---|
| `npm run build` | Full build |
| `npm run dev` | Rebuild the node bundles on change |
| `npm run dev:ui` | Rebuild the dashboard on change. `eminiar ui` serves `dist/ui` as it is |
| `npm test` | Vitest. `EMINIAR_TEST_EMBED=1` also runs the model test |
| `npm run typecheck` | `tsc` for the node and web projects |
| `npm run lint` / `lint:fix` | Biome |
| `npm run validate` | `claude plugin validate .` |
| `npm run bench` | Hot-path benchmark (see below) |

## Project layout

| Path | Contents |
|---|---|
| `bin/` | POSIX `sh` shims: `eminiar`, `em-server`, `em-hook` |
| `hooks/hooks.json` | Hook registration for Claude Code |
| `skills/` | The slash commands (`/em-*`) and the `eminiar` skill |
| `src/server.ts` | MCP server entry |
| `src/hook.ts`, `src/hooks/` | Hook entry and handlers: routing, capture, session start, pre-compact |
| `src/session/` | Session brief, guide and proactive recall |
| `src/tools/` | One file per `em_*` tool |
| `src/sandbox/`, `src/permissions/` | Code execution and permission checks |
| `src/search/`, `src/index/`, `src/chunker/`, `src/embeddings/` | Indexing and hybrid search |
| `src/graph/` | tree-sitter parsers (`languages/`), link pass, metrics, clusters, routes, changes |
| `src/history/` | Commit classification and fix-origin tracing |
| `src/memory/` | Memory files and their mirror in the index |
| `src/docs/` | Documentation discovery, catalogue, crawl and sync |
| `src/storage/` | `adapter.ts` interface. `sqlite/` is the only module with SQL |
| `src/ui/` | Dashboard server. `src/ui/web/` is the Preact app |
| `src/install/` | Installer, registration and doctor |
| `tests/unit/` | Vitest tests, one file per module |

## Conventions

- **Tests use real storage.** Tests build a temporary project and a fresh SQLite database. Do
  not mock storage.
- **SQL stays in `src/storage/sqlite/`.** Everything else goes through `StorageAdapter`, so a
  Postgres or libSQL adapter can be added later.
- **Shims are POSIX `sh`.** The sandbox runs shell under `zsh` on macOS, so quote globs.

## Benchmarks

`em_execute` and `em_batch_execute` are the hot paths. Keep them within about 1 ms of a raw
process spawn, and keep server start-up light.

```sh
npm run build && npm run bench    # drives dist/server.js over stdio, like Claude Code
```

- Run the benchmark **alone**, not at the same time as tests.
- Compare before and after: build `origin/main` and your branch, and run both.
