---
name: onboarding/commands
kind: onboarding
tags: [onboarding, commands]
related: [file:package.json, file:tsup.config.ts, file:vitest.config.ts, file:biome.json, file:scripts/copy-grammars.mjs, file:scripts/gen-schema.ts, file:src/cli.ts, file:src/install/install.ts, file:src/install/doctor.ts]
created: 2026-10-13T16:18:36.772Z
updated: 2026-10-13T16:41:42.636Z
---

Commands for working on eminiar. Use npm, not pnpm (Ryan's preference). Node >= 22.12 required (`engines`).

Install and build:
- `npm install`
- `npm run build` — runs `tsup` (three ESM bundles into `dist/`: server.js, hook.js, cli.js), then `node scripts/copy-grammars.mjs` (vendors tree-sitter grammars into `vendor/`), then `tsx scripts/gen-schema.ts` (regenerates `eminiar.config.schema.json`). `prepack` runs build automatically before `npm pack`/publish.
- `npm run dev` — `tsup --watch`.
- `npm run typecheck` — `tsc --noEmit`.

Test:
- `npm test` — `vitest run` over `tests/**/*.test.ts` (node environment, 20 s per-test timeout).
- `npm run test:watch` — `vitest`.
- `EMINIAR_TEST_EMBED=1 npm test` — also runs the integration test that loads the real embedding model (`tests/integration/embeddings.test.ts`); skipped otherwise because the model download is slow.
- Run a single file: `npx vitest run tests/unit/search.test.ts`.

Lint and format (Biome, not ESLint/Prettier):
- `npm run lint` — `biome check .`
- `npm run lint:fix` — `biome check --write .`

Plugin validation and local run:
- `npm run validate` — `claude plugin validate .`
- `claude --plugin-dir "$PWD"` — launch Claude Code with the dev checkout as the plugin. In dev mode the tools appear as `mcp__plugin_eminiar_eminiar__*` and must be loaded via ToolSearch before use. Build first: the shims run `dist/*.js`.
- `npx eminiar install` — pins node, materializes the stable copy under `~/.eminiar/plugin/`, registers the plugin, downloads the model. `npx eminiar install --team` also writes a committed `eminiar.config.json`; `--statusline` adds the status line entry.
- `npx eminiar doctor` / `eminiar doctor --fix` — verifies node, SQLite FTS5, sqlite-vec, model, sandbox languages, routing mode, MCP server marker; `--fix` re-pins the root and clears Claude Code's cached MCP launch failure (`mcp-needs-auth-cache.json`). Also `eminiar upgrade`, `eminiar uninstall [--purge-data]`, `eminiar replace-context-mode`.
- CLI equivalents of the tools: `eminiar search "q" [--timeline] [--code] [--source X]`, `eminiar graph impact <file> | deps | neighbors | path a b | hotspots | coupled | orphans`, `eminiar index <dir>`, `eminiar reindex [--scope code|git|docs|embeddings|all]`, `eminiar stats`, `eminiar recall "q"`, `eminiar ui [--port 7331] [--no-open]` (web dashboard: stats, memories editor, graph, search, sessions, actions; `serve` is the old alias and does not auto-open), `eminiar statusline`.

Env vars and services:
- `EMINIAR_*` env overrides any config key (highest precedence). `EMINIAR_PLUGIN_ROOT` / `EMINIAR_PLUGIN_DATA` are set by the plugin manifest; `EMINIAR_LAUNCH_ROOT` is set by `bin/_resolve.sh` when it falls back to the stable copy.
- `~/.eminiar/` holds everything: `node-path`, `root-path`, `config.json`, `projects/<id>/eminiar.db`, `models/`, `plugin/`, `tmp/`.
- No external services. Embeddings run locally; `em_fetch_and_index` is the only thing that touches the network (plus the model download at install).

Release: bump `version` in `package.json` and `.claude-plugin/plugin.json` (keep them in sync; `src/version.ts` reads it), `npm run build && npm test && npm run lint && npm run validate`, then `npm publish` (prepack builds). After publishing, `eminiar upgrade` refreshes the stable copy for existing installs. There is no CI workflow yet (`.github/workflows` does not exist).
