---
name: onboarding/conventions
kind: onboarding
tags: [onboarding, conventions]
related: [file:biome.json, file:tsconfig.json, file:tsup.config.ts, file:src/tools/index.ts, file:src/config.ts, file:src/storage/adapter.ts, file:src/graph/reindex.ts, file:src/session/server-alive.ts, file:bin/_resolve.sh, file:tests/unit/search.test.ts]
created: 2026-10-13T16:18:59.535Z
updated: 2026-10-13T16:18:59.535Z
---

Conventions in the eminiar repo.

Code style (enforced by Biome, `biome.json`): 2-space indent, line width 100, double quotes, semicolons always, trailing commas everywhere. Linter is Biome `recommended` with `noConsole` and `noNonNullAssertion` turned off (console output is how the CLI/hooks talk; `!` is accepted). Biome covers `src/**`, `tests/**`, root `*.ts`/`*.json`, and ignores `dist`, `vendor`, `eminiar.config.schema.json`. TypeScript is strict, ESM-only (`module: NodeNext`, `type: module`), target ES2023 / node22, no emitted d.ts (`dts: false`).

Naming and layout:
- Every MCP tool is `em_<verb>` and lives in `src/tools/em_<verb>.ts` exporting a ToolDef (`name`, `description`, zod input schema, handler); several related tools may share a file (`em_graph.ts` has graph_query/graph_impact/graph_add/reindex). Add new tools to `src/tools/index.ts`; `src/server.ts` registers them in a loop. Keep the `em_` prefix: hooks, skills and the routing guide all key on it.
- Slash commands are skills under `skills/em-<name>/SKILL.md`; keep them short and tool-driven (call the tool, show the result, minimal commentary).
- Graph node ids: `file:<path>`, `sym:<path>#<name>` (nested symbols joined by `/` name paths), `memory:<name>`, `concept:<slug>`, `pkg:<name>`.
- All SQL stays in `src/storage/sqlite/`; everything else talks to `StorageAdapter` (`src/storage/adapter.ts`). Schema changes go in `src/storage/sqlite/schema.ts`; bump `CODE_INDEX_VERSION` in `src/graph/reindex.ts` when the code index shape changes so existing DBs get one automatic full reindex.
- Heavy or native deps (better-sqlite3, sqlite-vec, @huggingface/transformers, tree-sitter, web-tree-sitter) are `external` in tsup and must resolve from `node_modules` at runtime; embeddings and tree-sitter are optional and loaded lazily so the server still starts without them.
- Config keys are defined once as a zod schema in `src/config.ts`; `scripts/gen-schema.ts` derives `eminiar.config.schema.json` from it, so never hand-edit the JSON schema.
- Hooks must never block Claude Code: on any failure print `{}` (or an empty additionalContext) and exit 0. PreToolUse only denies in `enforce` mode while a live server pid marker exists (`src/session/server-alive.ts`); otherwise it annotates.
- Shell shims in `bin/` are POSIX sh (no bashisms); they source `bin/_resolve.sh`. Note the sandbox runs shell snippets under zsh, so bare `===` tokens and unquoted globs (`eslint.config.*`) error; quote them or use `printf`.

Tests: vitest, `tests/unit/<module>.test.ts` named after the module under test (chunker, config, doctor-cache, graph, hooks, memory, namepath, permissions, sandbox, search, shim, symbols-chunker), `tests/integration/` for things that need the dashboard server or the real model. Tests build a temp project dir and a fresh SQLite DB rather than mocking storage. The embedding model test is gated by `EMINIAR_TEST_EMBED=1`.

Git and PR habits: `main` is the default branch; work happens on feature branches (`desktop-cache-fix`, `feature/plain_text_memories`, `feature/symbol-search`) merged via GitHub PRs on github.com/rydn/eminiar. Commit subjects are imperative sentences describing the behaviour ("Run from the pinned stable copy when launched from Claude Code's plugin cache"). Each feature bumps the version and updates `README.md` plus the relevant `skills/*/SKILL.md` in the same commit. Project decisions are recorded as memories under `.eminiar/memories/decision/` and committed; onboarding memories live under `.eminiar/memories/onboarding/`.

Things newcomers get wrong:
- Do not add a root `.mcp.json`; the server is registered inline in `.claude-plugin/plugin.json`.
- Keep `package.json` and `.claude-plugin/plugin.json` versions in sync.
- Run `npm run build` before testing the plugin with `claude --plugin-dir`; the shims execute `dist/`.
- The desktop app launches plugins from `~/.claude/plugins/cache/eminiar/eminiar/<ver>` with no `node_modules`; that is why the shims fall back to `~/.eminiar/root-path`. If the MCP server "did not connect", run `eminiar doctor --fix`.
- Use npm, not pnpm.
