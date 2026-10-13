---
name: onboarding/structure
kind: onboarding
tags: [onboarding, structure]
related: [file:src/server.ts, file:src/hook.ts, file:src/cli.ts, file:src/tools/index.ts, file:src/storage/adapter.ts, file:src/storage/sqlite/adapter.ts, file:src/graph/reindex.ts, file:src/memory/store.ts, file:src/hooks/routing.ts, file:src/code/symbols.ts, file:bin/_resolve.sh, file:tsup.config.ts, file:.claude-plugin/plugin.json, file:hooks/hooks.json]
created: 2026-10-13T16:18:19.211Z
updated: 2026-10-13T16:18:19.211Z
---

Top-level layout of the eminiar repo:
- `src/` — all TypeScript (ESM, NodeNext). Three entry points bundled by `tsup.config.ts`: `src/server.ts` (MCP server), `src/hook.ts` (hook runner), `src/cli.ts` (CLI). Shared root modules: `config.ts`, `paths.ts` (~/.eminiar layout), `project.ts` (project id/root), `context.ts`, `doctor.ts`, `version.ts`.
- `bin/` — POSIX sh shims: `_resolve.sh` (sourced by the others; picks the pinned node binary from `~/.eminiar/node-path` and falls back to the stable copy in `~/.eminiar/root-path` when the launch dir has no node_modules), `em-server`, `em-hook`, `eminiar`. Hooks must never block Claude: if nothing can run they print `{}` and exit 0.
- `hooks/hooks.json` — every Claude Code hook event wired to `bin/em-hook`.
- `.claude-plugin/plugin.json` — plugin manifest with the inline `mcpServers.eminiar` entry. There is deliberately NO repo-root `.mcp.json` (Claude Code would load it as a project-scope server with an empty `${CLAUDE_PLUGIN_ROOT}` and fail with ENOENT). Do not reintroduce it.
- `skills/<name>/SKILL.md` — the slash-command skills (eminiar, em-doctor, em-graph, em-index, em-onboard, em-purge, em-search, em-stats).
- `scripts/` — `copy-grammars.mjs` (vendors tree-sitter wasm grammars into `vendor/`), `gen-schema.ts` (writes `eminiar.config.schema.json` from the zod config schema).
- `tests/unit/*.test.ts`, `tests/integration/*.test.ts` — vitest.
- `vendor/` — vendored tree-sitter grammars (build output, lint-ignored). `dist/` — build output, gitignored.
- `.eminiar/memories/<topic>/<name>.md` — committed project memories (this file lives here).

Where each kind of code lives under `src/`:
- `tools/` (16 files) — one file per MCP tool (`em_execute.ts`, `em_search.ts`, `em_symbols.ts`, `em_graph.ts` holds graph_query/graph_impact/graph_add/reindex, …), `tools/index.ts` lists them, `tools/types.ts` the ToolDef shape.
- `sandbox/` — `run.ts`/`execute.ts` (spawn in project root), `languages.ts` (shell/js/ts/python/… runners), `env.ts` (stripped env + credential passthrough for gh/aws/gcloud/kubectl/docker), `output.ts` (5 KB index threshold, intent-based section selection), `file.ts` (`$EM_FILE` for em_execute_file).
- `permissions/` — checks sandbox shell snippets against Claude Code's `permissions.deny`/`ask` Bash rules per chained segment (`split.ts`, `rules.ts`, `settings.ts`).
- `search/` — hybrid pipeline: `query.ts`, `fusion.ts` (BM25 porter+trigram + vectors), `rerank.ts`, `typo.ts`, `snippets.ts`, `format.ts`.
- `index/indexer.ts` + `chunker/` — markdown by heading, JSON by key path, code by declaration (symbol-aligned chunks).
- `code/` — `backend.ts` (CodeBackend interface, tree-sitter only), `treesitter-backend.ts`, `namepath.ts`, `symbols.ts` (powers em_symbols overview/find/references).
- `graph/` — `treesitter.ts` (symbols, imports, calls, references), `git.ts` (co-change, hotspots), `reindex.ts` (CODE_INDEX_VERSION triggers an automatic full pass), `query.ts`, `resolve.ts`, `ids.ts` (`file:`, `sym:<path>#name`, `memory:<name>`, `concept:` node ids), `format.ts`.
- `memory/` — `frontmatter.ts` (small key: value header) and `store.ts` (mirrors `.eminiar/memories/*.md` into the index and graph; files are the source of truth).
- `hooks/` — per-event handlers: `session-start.ts`, `routing.ts` (off/annotate/enforce), `coexist.ts` (context-mode detection), `capture.ts`, `pre-compact.ts`, `log.ts`.
- `session/` — `current.ts`, `guide.ts` (routing guidance text), `server-alive.ts` (pid marker).
- `embeddings/` — `provider.ts`, `transformers.ts` (bge-small via @huggingface/transformers, optional), `queue.ts`.
- `fetch/` — `fetcher.ts` (24 h cache) and `html.ts` (turndown to markdown).
- `storage/` — `adapter.ts` (interface), `types.ts`, `sqlite/adapter.ts` + `sqlite/schema.ts` (better-sqlite3, FTS5, sqlite-vec; the only SQL in the repo).
- `stats/` — `record.ts`, `global.ts`, `statusline.ts`. `capture/` — tool-output capture. `ui/` — `server.ts`, `api.ts`, `page.ts` (dashboard for `eminiar serve`).
- `install/` — `install.ts`, `upgrade.ts`, `uninstall.ts`, `replace.ts` (replace-context-mode), `doctor.ts`, `register.ts` + `claude-config.ts` (plugin registration in Claude settings), `materialize.ts` (stable copy), `node-resolve.ts`, `shell.ts`.

Hotspots (most-changed files so far): `.claude-plugin/plugin.json`, `README.md`, `package.json`, `src/server.ts`, `src/cli.ts`, `src/config.ts`, `src/install/{install,doctor,register,claude-config}.ts`, `src/storage/adapter.ts`, `src/storage/sqlite/adapter.ts`. Graph entry points (nothing imports them): `src/server.ts`, `src/hook.ts`, `src/cli.ts`, `src/ui/server.ts`, `src/stats/statusline.ts`, `src/install/{upgrade,uninstall,replace}.ts`, `src/embeddings/transformers.ts` (loaded dynamically).
