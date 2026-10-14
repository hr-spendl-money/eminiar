---
name: onboarding/conventions
kind: onboarding
tags: [onboarding, conventions]
related: [file:biome.json, file:tsconfig.json, file:tsconfig.web.json, file:tsup.config.ts, file:src/tools/index.ts, file:src/config.ts, file:src/storage/adapter.ts, file:src/storage/sqlite/schema.ts, file:src/graph/reindex.ts, file:src/graph/link.ts, file:src/ui/web/public/styles.css, file:tests/unit/graph-depth.test.ts]
created: 2026-10-13T16:18:59.535Z
updated: 2026-10-14T16:31:57.082Z
---

Conventions in the eminiar repo.

Code style (Biome, `biome.json`): 2-space indent, line width 100, double quotes, semicolons, trailing commas. Linter is `recommended` with `noConsole` and `noNonNullAssertion` off. For `src/ui/web/**` an override disables the a11y click/anchor rules, `useExhaustiveDependencies`, `noDangerouslySetInnerHtml`, and the CSS `noImportantStyles`/`noDescendingSpecificity` rules (mouse-driven local dashboard). Biome also formats CSS and the inline script in `index.html`. TypeScript is strict with `exactOptionalPropertyTypes` (write `prop?: T | undefined` when assigning possibly-undefined values) and `noUncheckedIndexedAccess`; node code is ESM NodeNext, the frontend is `tsconfig.web.json` (ESNext/Bundler, DOM, Preact `react-jsx`). The root tsconfig excludes `src/ui/web`.

Naming and layout:
- MCP tools are `em_<verb>` in `src/tools/em_<verb>.ts` exporting a `defineTool({name, description, schema, handler})`; add them to `src/tools/index.ts`. Tool descriptions double as routing hints for Claude, so say when to use the tool and what it saves. Graph tools call `recordStat` with `rawChars: fileBytes(db, paths)` so savings are real.
- Slash commands are skills under `skills/em-<name>/SKILL.md`; keep them tool-driven. Routing text for SessionStart lives in `src/hooks/session-start.ts` (`routingGuidance`); update it when adding a tool Claude should reach for.
- Graph node ids: `file:<path>`, `sym:<path>#<Outer.inner>`, `route:<METHOD> <path>`, `pkg:<name>`, `memory:<name>`, `concept:<slug>`, `person:<name>`. Edge kinds: imports, reexports, defines, exports, calls, references, extends, implements, handles, co_changes, authored, mentions, supersedes, plus curated kinds. Parsers emit same-file or barrel targets they cannot resolve and let `src/graph/link.ts` repair them; unresolved symbols are demoted to the file node with `meta.unresolved` rather than dropped.
- Adding a language: a module in `src/graph/languages/` using `getParser`, `RefCollector` and `complexityOf` from `parser.ts`; add the extension to `grammarFor`, dispatch in `treesitter.ts`, vendor the grammar in `scripts/copy-grammars.mjs`, extend `graph.include` defaults in `src/config.ts` and the reparse regex in `src/hooks/capture.ts`, and cover it in `tests/unit/languages.test.ts`.
- All SQL stays in `src/storage/sqlite/`; new tables/columns go in a new migration in `schema.ts` (v4 is current) with matching `StorageAdapter` methods and `types.ts` rows. Bump `CODE_INDEX_VERSION` in `src/graph/reindex.ts` when parse output changes so old DBs reparse once. `graph_metrics`, clusters and cycles are recomputed by `finalizeGraph` after any reindex that changed something.
- Config keys are a zod schema in `src/config.ts`; never hand-edit `eminiar.config.schema.json`.
- Hooks never block Claude: fail open with `{}`. Graph hints and briefs are `additionalContext` only; `enforce` denies only while a live server pid marker exists.
- Dashboard: Preact + d3-force + Prism only, bundled, no CDN. Keep the grey/blue CSS tokens in `public/styles.css` (`--bg`, `--accent`, dark variants under `prefers-color-scheme` and `[data-theme]`); hash routing `#/view?params`, and views must react to param changes with an effect (a hash-only change does not remount). Server endpoints are thin wrappers in `src/ui/graph-api.ts` over `src/graph` functions; file reads check the real path stays under the project root.
- Shell shims are POSIX sh. The sandbox runs shell under zsh: quote globs and `===`.

Tests: vitest, `tests/unit/<module>.test.ts`; tests build a temp project and a fresh SQLite DB, never mock storage; language/graph tests write fixture files inline and run `reindexCode`. Dashboard tests drive the real HTTP server. Use `node:http` (not fetch) when a test must send a custom Host header.

Git and PR habits: `main` default; feature branches (`feature/graph_enhancement` is the current one, PR #6) merged via GitHub PRs with `gh pr create`; imperative commit subjects describing behaviour, one commit per phase of a plan, each feature bumps the version and updates README plus skills. Decisions go in `.eminiar/memories/decision/` with `status`/`supersedes`; onboarding under `.eminiar/memories/onboarding/`; both committed.

Things newcomers get wrong: no root `.mcp.json`; keep `package.json` and `.claude-plugin/plugin.json` versions in sync; build before testing or running `claude --plugin-dir`; the desktop app launches from `~/.claude/plugins/cache/...` without node_modules (hence `eminiar doctor --fix`); the running plugin in a Claude session is the pinned stable copy, not the checkout, so new tools need `eminiar upgrade`; the dashboard served old bundles until asset URLs were versioned, so do not add long-lived cache headers to `src/ui/server.ts`; use npm, not pnpm.
