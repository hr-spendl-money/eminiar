---
name: onboarding/commands
kind: onboarding
tags: [onboarding, commands]
related: [file:package.json, file:tsup.config.ts, file:tsup.web.config.ts, file:tsconfig.web.json, file:vitest.config.ts, file:biome.json, file:scripts/copy-grammars.mjs, file:scripts/gen-schema.ts, file:src/cli.ts]
created: 2026-10-13T16:18:36.772Z
updated: 2026-10-14T16:31:30.090Z
---

Commands for working on eminiar. Use npm, not pnpm (Ryan's preference). Node >= 22.12 required.

Install and build:
- `npm install`
- `npm run build` — `tsup` (node bundles server.js/hook.js/cli.js into `dist/`), then `tsup --config tsup.web.config.ts` (browser bundle `dist/ui/app.global.js` + copies `src/ui/web/public/` → `dist/ui/`), then `node scripts/copy-grammars.mjs` (vendors typescript/tsx/javascript/python/go wasm into `vendor/grammars/`), then `tsx scripts/gen-schema.ts`. `prepack` runs build.
- `npm run dev` — node bundles in watch mode; `npm run dev:ui` / `npm run build:ui` — the dashboard bundle only. `eminiar ui` serves whatever is in `dist/ui`, with mtime-versioned asset URLs, so a rebuild shows on reload.
- `npm run typecheck` — `tsc --noEmit` for node code plus `tsc --noEmit -p tsconfig.web.json` for the frontend (DOM lib, Preact JSX).

Test:
- `npm test` — `vitest run` over `tests/**/*.test.ts` (103 tests). Requires a prior `npm run build` because graph tests load `vendor/grammars/*.wasm` via `EMINIAR_PLUGIN_ROOT=cwd`.
- Single file: `npx vitest run tests/unit/languages.test.ts`. Key suites: `graph.test.ts` (TS parse + queries), `graph-depth.test.ts` (barrels, defaults, routes, metrics, cycles, pattern, changes, coverage, decisions), `languages.test.ts` (Python + Go), `clusters.test.ts`, `hooks.test.ts` (routing, brief, hints), `tests/integration/dashboard.test.ts` (every API route + origin checks).
- `EMINIAR_TEST_EMBED=1 npm test` also runs the real embedding model test.

Lint and format: Biome. `npm run lint` (`biome check .`), `npm run lint:fix` (`biome check --write .`). Formatting is enforced, so run `--write` before committing.

Plugin validation and local run:
- `npm run validate` — `claude plugin validate .`
- `claude --plugin-dir "$PWD"` after a build; dev tools appear as `mcp__plugin_eminiar_eminiar__*` and need ToolSearch first.
- `npx eminiar install [--team] [--marketplace github:org/repo] [--statusline]`, `eminiar upgrade` (re-pins the stable copy after a release), `eminiar doctor [--fix]`, `eminiar uninstall [--purge-data]`, `eminiar replace-context-mode`.
- Smoke-test the graph on a repo without touching the live data: `EMINIAR_HOME=/tmp/emhome EMINIAR_EMBEDDINGS=0 node dist/cli.js reindex --scope code` then `node dist/cli.js graph architecture | status | hotspots | dead_code | clusters | changes HEAD | pattern '<json>'`, and `node dist/cli.js ui --port 7399 --no-open` for the dashboard.
- CLI equivalents of the tools: `eminiar search "q" [--timeline] [--code] [--source X]`, `eminiar graph <architecture|status|changes [ref]|impact|deps|neighbors|path a b|find|pattern <json>|hotspots|routes|dead_code|cycles|clusters|coupled|orphans|stats> [node]`, `eminiar index <dir>`, `eminiar reindex [--scope code|git|metrics|docs|memories|embeddings|all] [--full]`, `eminiar stats`, `eminiar recall "q"`, `eminiar ui [--port 7331] [--no-open]`, `eminiar statusline`.

Env vars and services:
- `EMINIAR_*` overrides any config key; `EMINIAR_HOME` relocates `~/.eminiar` (tests and smoke runs use a temp dir); `EMINIAR_EMBEDDINGS=0` disables the model; `EMINIAR_ROUTING_MODE`; `EMINIAR_PLUGIN_ROOT` points at the checkout for grammars; `EMINIAR_UI_DIR` overrides where the dashboard bundle is read from.
- No external services; only `em_fetch_and_index` and the model download touch the network.

Release: bump `version` in `package.json` and `.claude-plugin/plugin.json` together (0.2.0 now), `npm run build && npm run typecheck && npm run lint && npm test && npm run validate`, update README and the relevant `skills/*/SKILL.md`, PR to `main` via `gh pr create`, then `npm publish` (prepack builds) and `eminiar upgrade` on installs. Existing project DBs migrate automatically (schema v4) and run one full reparse when `CODE_INDEX_VERSION` changes. No CI workflow exists yet.
