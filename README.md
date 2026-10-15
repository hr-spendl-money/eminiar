# Eminiar
*Pronounced ee-MIN-ee-ar*

Local-first context, memory and knowledge graph for Claude Code. Nothing leaves your machine.

Eminiar keeps raw tool output out of the model's context window and gives Claude Code local tools
that make it work better:

- **Sandbox** — `em_execute`, `em_batch_execute`, `em_execute_file`: run shell / JS / TS (plus
  Python, Ruby, Go, PHP, Perl, R, Elixir, Rust, C# when installed) inside the project and get back
  only what matters. Large outputs are indexed; with an `intent` only the matching sections return.
- **Search** — `em_search`, `em_fetch_and_index`, `em_index`: SQLite FTS5 (porter + trigram, BM25,
  typo correction) fused with local ONNX embeddings (bge-small via sqlite-vec). Hybrid by default,
  never blocks on the model download.
- **Documentation knowledge base** — `em_docs`: discovers the project's own docs (READMEs, docs
  folders, ADRs, OpenAPI / Swagger / Postman specs, agent instructions, env references) and the
  third-party libraries, services, infrastructure and APIs it depends on (package manifests, env
  prefixes, container images, Terraform / Kubernetes files, outbound HTTP calls in code), maps each
  to its documentation through a built-in catalogue, the npm / PyPI / Go registries or a probe of
  the usual docs locations, crawls it into the index under `docs:<name>` and answers questions from
  it before the web. API specs are rendered one section per operation. The manifest
  `.eminiar/docs.json` is committed; `/em-docs` and `/em-onboard` drive it.
- **Session continuity** — hooks capture prompts, decisions, constraints, files, errors and loops
  into 23 categories; a ≤2 KB Session Guide is snapshotted before `/compact` and replayed on resume.
- **Memory** — `em_remember` / `em_recall` / `em_memory`: named markdown memories under
  `.eminiar/memories/<topic>/<name>.md` (human-editable, committed with the repo), mirrored into
  the search index and the graph. Decisions carry an ADR-style `status` and `supersedes`.
  `/em-onboard` writes the onboarding set; every session starts with a short project brief.
- **Knowledge graph** — `em_architecture`, `em_graph_impact`, `em_graph_changes`,
  `em_graph_query`, `em_graph_add`, `em_index_status`: tree-sitter (TypeScript/JavaScript, Python,
  Go) files, symbols, imports and re-exports, calls, references, inheritance and HTTP routes; a
  link pass that follows barrels, default exports, Go packages and inherited methods; fan-in,
  complexity, churn and a hotspot score per node; module clusters and import cycles; git co-change
  coupling; curated concepts and memories. Query it with presets or a structured pattern walk.
- **Symbols** — `em_symbols`: file overview, find by name path (`Class/method`,
  `src/x.ts#Class.method`) with the body, and references, Serena-style but without language
  servers. Code search chunks are cut at declarations and titled by symbol. A database built by
  an older version gets one automatic full code reindex on first use.
- **History** — `em_history`: the git history read for Claude, not by Claude. Every commit across
  every branch is classified (feat/fix/refactor/perf/test/docs/…), branches carry ahead/behind and
  merge state against the base, and every fix is traced back (by blaming the lines it removed) to
  the commit that wrote them, so changes that later needed fixing are flagged and files get a
  history-risk score with reasons. Ask it for a file before editing, for the working tree before
  committing, for one commit, a branch, a symbol's line history or a search over messages, which
  are also indexed for `em_search` (source `git`). The dashboard's **History** tab is the
  interactive explorer: weekly activity by kind with a brush, the commit DAG with lanes, a
  churn-vs-fix-share scatter, per-file stories, branch comparison and the lessons the history
  teaches. `/em-history` is the slash command.
- **Stats** — `em_stats`, a statusline, and a local web dashboard (`eminiar ui`): source explorer
  with impact and code details, a galaxy graph, architecture map, hotspots, routes, clusters,
  history explorer, decision record, documentation sources, index coverage, sessions and
  maintenance actions.

## Install

```sh
npx eminiar install            # pins node, installs a stable copy, registers the plugin, downloads the model
npx eminiar doctor             # verifies every piece
```

Teams: run `npx eminiar install --team` once, commit the generated `eminiar.config.json`, and
teammates run `npx eminiar install`. With `--team --marketplace github:org/repo` the project's
`.claude/settings.json` also prompts teammates to install the plugin on next launch.

Other commands: `upgrade`, `uninstall [--purge-data]`, `replace-context-mode` (removes the
context-mode plugin and its hooks once you are happy with parity; the hosted gateway env is a
separate, explicit choice).

## Using it from Claude Code

The plugin injects short routing guidance at session start. Slash commands: `/em-stats`,
`/em-doctor`, `/em-index`, `/em-search`, `/em-docs`, `/em-graph`, `/em-history`, `/em-onboard`,
`/em-purge`.

| Tool | Use for |
|---|---|
| `em_execute {language, code, intent}` | git log/diff, tests, dependency trees, logs, API calls |
| `em_batch_execute {commands[{label, command}], queries}` | several commands + questions in one round trip |
| `em_execute_file {path, code}` | big files; your code gets `$EM_FILE` |
| `em_fetch_and_index {url, queries}` | docs and web pages (24 h cache) |
| `em_docs {action: lookup \| discover \| add \| sync \| list \| remove \| resolve}` | the documentation knowledge base: ask it before WebFetch/WebSearch; `add {pick: "recommended"}` builds it |
| `em_search {queries, sort}` | anything indexed, `sort: "timeline"` after a resume |
| `em_recall {query}` / `em_remember {content, kind, name?}` | past decisions, constraints, errors |
| `em_memory {action: list \| read \| edit \| rename \| delete \| status, name}` | the memory files themselves |
| `em_architecture {aspects?}` | the project map: languages, folders, entry points, routes, hotspots, clusters, cycles, decisions |
| `em_symbols {mode: overview \| find \| references, file, name_path, include_body}` | navigate code by symbol instead of reading files |
| `em_search {queries, mode: "regex"}` | grep indexed content with context |
| `em_graph_impact {node}` | what breaks if a file/symbol changes, and why |
| `em_graph_changes {ref?}` | the symbols a diff touches, their exposure, and the files it can reach |
| `em_graph_query {preset: "hotspots" \| "routes" \| "dead_code" \| "cycles" \| "clusters" \| "coupled" \| "orphans"}` | where change concentrates, what is exposed, what nothing uses |
| `em_graph_query {pattern: {from, edge: {kinds, direction, depth}, to}}` | walk typed edges from a filter to a filter |
| `em_history {action: overview \| file \| risk \| commit \| branch \| symbol \| search \| timeline}` | what changed, why, by whom; which changes later needed fixing; branch state; a file's story before editing it |
| `em_index_status` | is the graph fresh, which files were skipped and why |
| `em_stats`, `em_doctor`, `em_reindex`, `em_purge` | housekeeping |

Routing: `routing.mode` is `auto` — eminiar only *annotates* native Bash/Read/Grep/WebFetch calls
while the context-mode plugin is installed (so the two never deny each other), and switches to
hard `enforce` (deny + redirect to the `em_*` tool) once it is gone. Set `off`, `annotate` or
`enforce` explicitly in `eminiar.config.json`. `enforce` only denies while an eminiar MCP server
is running for the project (the server leaves a pid marker under `~/.eminiar/projects/<id>/servers/`);
with no server up it annotates instead, so Claude is never told to retry with a tool it cannot reach.

Permissions: shell snippets are checked against Claude Code's `permissions.deny` / `ask` Bash
rules per chained segment; `ask` counts as deny. Sandboxed processes get a stripped environment
plus credential passthrough for gh / aws / gcloud / kubectl / docker.

## Memories

`em_remember` writes `.eminiar/memories/<topic>/<name>.md` with a small header:

```markdown
---
name: auth/session-tokens
kind: decision
status: accepted            # decisions: proposed | accepted | superseded | deprecated
supersedes: auth/long-lived-tokens
tags: [auth, security]
related: [file:src/auth.ts, sym:src/auth.ts#issueToken]
created: 2026-10-13T15:00:00Z
updated: 2026-10-13T15:04:11Z
---

Tokens rotate every 15 minutes because …
```

`em_remember {kind: "decision", supersedes}` marks the older decision superseded;
`em_architecture` and the session brief list the accepted ones.

The files are the source of truth: edit, move or delete them by hand and the next memory call
re-imports them (`em_reindex {scope: "memories"}` forces it). Each file is indexed for hybrid
search (`em_recall`, `em_search {source: "memory"}`) and becomes a `memory:<name>` graph node whose
`mentions` edges make `em_graph_impact` list the memories to re-read before changing a file.
Commit the directory so teammates share it. Rows recorded before 0.1.2 are migrated into files
on first use. `/em-onboard` writes `onboarding/{overview,structure,commands,conventions,documentation}`,
which every session start points at until they exist.

### Recall without asking

Claude does not have to remember to call `em_recall` or `em_docs`; the hooks bring the relevant
knowledge to it:

- **Every prompt** (`UserPromptSubmit`) is matched against the memories and the indexed
  documentation. Up to 3 memories and 2 doc pages that share at least two distinctive terms with
  the prompt (three for long prompts) are attached as `eminiar recall — …`, with the name to read
  in full. Superseded and deprecated memories are skipped.
- **Reading or editing a file** (`Read`, `Edit`, `MultiEdit`, `Write`) attaches the memories whose
  `related` list names that file or a symbol in it, as `eminiar memory: …`. This works in every
  routing mode, including `off`.
- **Editing a file** (`Edit`, `MultiEdit`, `Write`) also attaches its **fix history** when it is
  bug-prone (`eminiar history: … 5/9 commits were fixes; 2 earlier changes later needed fixing;
  last fix …`) and its **fan-in** when five or more files import it (`eminiar graph: … imported by
  N files`).
- **`git commit`** (Bash) lists the bug-prone and widely imported files the commit includes, from
  the index (plus tracked changes with `-a`).
- **A failed tool call** (`PostToolUseFailure`, now synchronous so the answer arrives with the
  error) attaches earlier occurrences of the same error with the resolution recorded after them,
  and memories that mention it.
- **WebSearch / WebFetch** attach the indexed doc pages that already cover the query
  (`eminiar docs: …`); in enforce mode they appear in the WebFetch denial reason.
- **Subagents** get the memories and doc pages matching their task in their brief, because they
  never see the parent's session start or prompts.
- The **session brief** lists constraints and preferences next to the accepted decisions, and the
  session guidance opens with the recall-first workflow.

Each memory, page, file note or past error is shown once per context window: the window restarts
after a compaction or resume, so knowledge that was summarised away comes back when it is
relevant again. Hooks never run `git log` or load the embedding model: recall is a few FTS
queries, and history comes from a per-file risk table that every history build persists and the
server warm-up rebuilds when HEAD moves. Tune or disable each path with `recall` in
`eminiar.config.json`.

## Documentation knowledge base

`em_docs {action: "discover"}` scans the project (and one level of sub-projects, for multi-repo
workspaces and monorepos) without fetching anything:

- **local**: READMEs and top-level guides, `docs/` and ADR folders, `.github` Copilot / Claude /
  Cursor instructions, OpenAPI / Swagger / AsyncAPI / Postman / GraphQL / protobuf specs, env
  examples, and the Terraform / Kubernetes / Helm / Compose / CI files;
- **providers**: npm, PyPI and Go dependencies, env var prefixes (`SUMSUB_*`), container images,
  infrastructure signals (Terraform, Kubernetes, Istio, Karpenter, Helm, Docker, GitHub Actions)
  and **third-party APIs called from code** (every URL literal on a request-looking line, grouped
  by host). Each is matched to the built-in catalogue (~120 libraries, services and tools with
  their documentation URLs); packages the catalogue does not know are resolved through the
  registries at add time (homepage + README), and unknown API hosts are probed for a docs site
  (`docs.`, `developer.`, `/docs`, `/openapi.json`, …). A spec URL referenced in code is used
  directly.

`em_docs {action: "add", pick: "recommended"}` registers the local docs, the **third-party
services** the project integrates and the APIs found in code in `.eminiar/docs.json` and indexes
them. It is deliberately small: catalogue entries carry a tier, and frameworks (`library`) and
platform (`infra`) stay out unless you ask (`pick: "infra" | "catalog" | "registry" | "all"`, or
`names`), because Claude already knows them and their reference sites are large.
`{action: "add", url | path | provider}` adds one source. **External APIs are indexed in full**:
hosts called from code, documentation linked from code, probed docs sites and service-tier
catalogue entries get `docs.crawl.api` (depth 2, up to 150 pages); dependencies get the small
budget (depth 1, **8 pages** per source). Pages are cut at 120 KB and cached 7 days; OpenAPI documents and Postman collections — local or fetched — are rendered one markdown
section per operation (parameters, request body, responses, schemas) so a lookup returns the exact
endpoint. Documentation is **lexical-only by default** (`docs.embed: true` turns on vectors), so a
crawl never queues model work. Pages land in the index under `docs:<name>`; `em_docs {action:
"lookup", query}` searches them all (`em_search {source: "docs:*"}` does the same), `sync`
refreshes, `remove` drops a source and its pages.

Hooks keep Claude on the index: a `WebFetch` of a site that is already a documentation source is
annotated with the source name, a `WebSearch` is told which sources exist, the session brief lists
them, and `/em-onboard` builds the set and writes `onboarding/documentation`. The dashboard's
**Docs** tab shows sources, pages, sync state, a discovery screen with checkboxes, and a
docs-only search. Teams extend the catalogue with `docs.catalog` in `eminiar.config.json`.

## Configuration

`~/.eminiar/config.json` (user) < `<project>/eminiar.config.json` (team, commit it) < `EMINIAR_*` env.
See `eminiar.config.schema.json` for every key: `routing`, `sandbox` (timeouts, output cap, env
allowlist, disabled languages), `search`, `embeddings`, `graph.include/exclude` (TS/JS, Python and
Go by default; `node_modules`, `dist`, `vendor`, virtualenvs excluded), `git.maxCommits`,
`index.docs`, `permissions.extraDeny`, `memories.dir` (default `.eminiar/memories`), `recall`
(`onPrompt`, `onFile`, `onAgent`, `onCommit`, `onError`, `onWeb`, `maxMemories` 3, `maxDocs` 2), `docs`
(`manifest`, `ttlHours`, `crawl.depth/maxPages/maxPageBytes`, `embed`,
`discover.includeDev/subprojects`, extra `catalog` entries with a `tier`).

Hooks add graph context without blocking anything: a session starts with a project brief
(overview, accepted decisions, constraints and preferences, hot files, index freshness),
subagents get the same brief plus the memories matching their task, a Grep
or Glob is annotated with matching symbols, and reading a partially indexed file says so.

All data lives in `~/.eminiar/`: one SQLite DB per project (`projects/<id>/eminiar.db`), a global DB
for lifetime stats and the fetch cache, the embedding model under `models/`, and the stable plugin
copy under `plugin/`.

## CLI

```
eminiar search "query" [--timeline] [--code] [--source X]
eminiar graph architecture | status | changes [ref] | impact src/foo.ts | deps | neighbors | path a b
eminiar graph hotspots | routes | dead_code | cycles | clusters | coupled | orphans | pattern '<json>'
eminiar index docs/ | reindex [--scope code|git|metrics|docs|memories|embeddings|all] [--full]
eminiar docs discover | add --pick recommended | add --url U | add --provider npm:zod | sync | lookup "q" | list | remove name
eminiar stats | recall "query" | ui [--port 7331] [--no-open] | statusline
```

`eminiar ui` opens the local dashboard (127.0.0.1 only, grey/blue, light or dark):

- **Overview** — token savings per session, project and lifetime, index and graph sizes.
- **Explore** — file tree with index status and heat, syntax-highlighted source with a symbol
  gutter, *file impact* (dependents, affected files, tests, co-changed files, memories) and
  *code details* (callers, calls, references, metrics) for the symbol under the cursor.
- **Galaxy** — the graph on a canvas: search a node, choose direction and edge kinds, expand by
  layer, find a path, switch to a folder hierarchy, step back and forward.
- **Architecture** — folder treemap by size or heat, routes with handlers, hotspot table,
  cluster structure with import cycles, and a behavior tree of possible calls from an operation.
- **Memory** — browser and editor for `.eminiar/memories`, decision status and supersedes, and
  a compiled decision record.
- **Docs** — documentation sources with their pages and sync state, add by url / path / provider,
  a discovery screen (local docs, catalogue providers, APIs found in code, registry packages,
  unknowns with a URL field) and a docs-only search.
- **Coverage** — indexed, partial, skipped and unsupported files with reasons, freshness against
  HEAD and the working tree, per-file reindex.
- **Sessions** and **System** — event timelines, actions, doctor checks and the index-run log.

The server only answers loopback hosts and requires a JSON content type plus a loopback Origin
on anything that writes. `serve` is the older name for the same command.

Add `"statusLine": {"type": "command", "command": "eminiar statusline"}` to `~/.claude/settings.json`
(or pass `--statusline` to `install`) for `eminiar · 12.3k saved · 1.1M lifetime · 87% efficient`.

## Troubleshooting

**"The eminiar plugin server did not connect this session (retries in about 15 minutes)"**,
typically in the Claude Code desktop app while the terminal works. Claude Code launches plugins
from a copy under `~/.claude/plugins/cache/eminiar/eminiar/<version>` that has `dist/` but no
`node_modules/`. The `bin/` shims handle this by running the stable copy pinned in
`~/.eminiar/root-path` whenever their own directory cannot resolve dependencies. If the pin is
missing (installs before 0.1.1) run:

```sh
npx eminiar install      # or: eminiar upgrade — re-pins and refreshes the cache copy
eminiar doctor --fix     # re-pins and clears Claude Code's cached launch failure
```

then restart Claude Code. `eminiar doctor` probes every cached copy with `bin/em-server --probe`
and reports the cached failure with the time it expires.

## Develop

```sh
npm install
npm run build          # tsup (node + browser bundles) + vendor tree-sitter grammars + config schema
npm run dev:ui         # rebuild the dashboard on change; `eminiar ui` serves dist/ui as is
npm test               # vitest (EMINIAR_TEST_EMBED=1 also runs the model test)
claude --plugin-dir "$PWD"
```

The dashboard lives in `src/ui/web` (Preact, d3-force, Prism; no CDN), the parsers in
`src/graph/languages`, the analysis passes in `src/graph/{link,metrics,clusters,changes}.ts`.

Storage goes through `src/storage/adapter.ts`; `src/storage/sqlite/` is the only module with SQL,
so a Postgres/pgvector or libSQL adapter can back a team-shared knowledge base later.
