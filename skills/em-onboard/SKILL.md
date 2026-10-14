---
name: em-onboard
description: Onboard eminiar to this project — write the onboarding memories (overview, structure, commands, conventions, documentation) under .eminiar/memories and build the documentation knowledge base (local docs, API specs and the third-party libraries, services and APIs the code uses) so every future session starts knowing how the project is built, tested, organised and documented.
user-invocable: true
allowed-tools: mcp__plugin_eminiar_eminiar__em_execute, mcp__plugin_eminiar_eminiar__em_batch_execute, mcp__plugin_eminiar_eminiar__em_graph_query, mcp__plugin_eminiar_eminiar__em_memory, mcp__plugin_eminiar_eminiar__em_remember, mcp__plugin_eminiar_eminiar__em_docs
---

Write five `onboarding` memories, each a few short paragraphs or bullet lists, so a fresh
session can start work without rediscovering the basics. Check first with
`em_memory {action: "list", topic: "onboarding"}`; if they exist, only refresh what changed
(`em_remember` with `replace: true`).

Gather the facts with the sandbox, not by reading whole files into context:

1. `em_batch_execute` with labelled commands: the manifest (`cat package.json` / `pyproject.toml`
   / `go.mod` …), `ls` of the top level and `src/`, the test and lint configs, and `git log
   --oneline -15`. Ask `queries` like "scripts", "entry points", "test command".
2. `em_graph_query {preset: "stats"}`, `{preset: "hotspots"}` and `{preset: "orphans"}` for
   where the code concentrates and what the entry points are.
3. `em_docs {action: "discover"}` — local READMEs, docs folders, ADRs, OpenAPI / Swagger /
   Postman specs, agent instructions and env references, plus the npm / PyPI / Go packages,
   env var prefixes, container images, infrastructure files and third-party API hosts the code
   calls, each mapped to its documentation. Then `em_docs {action: "add", pick: "recommended"}`
   registers and indexes the local docs, the third-party services and the APIs found in code
   (unknown API hosts are probed for a docs site; a referenced spec URL is used directly; external
   APIs are crawled in full, dependencies shallowly). Keep it small: frameworks, infrastructure and registry packages stay out unless the user asks
   (`pick: "infra" | "catalog" | "registry"`). Add anything the project clearly depends on that
   came back `unknown` with `{action: "add", name, url}` when you know the URL. Do not paste the
   candidate list into the reply.

Then write, via `em_remember {kind: "onboarding", name: …, content: …}`:

- `onboarding/overview` — what the project is, who it is for, the main runtime pieces.
- `onboarding/structure` — top-level layout, where each kind of code lives, entry points,
  hotspots; add `related_files` for the key paths.
- `onboarding/commands` — exact commands to install, build, test, lint, run and release, plus
  any env vars or services they need.
- `onboarding/conventions` — code style, naming, how tests are organised, commit/PR habits,
  anything a newcomer gets wrong.
- `onboarding/documentation` — which documentation sources are registered (name → what it
  covers), which third-party services and APIs the project integrates and where their docs
  are, which local specs exist, and the rule: `em_docs {action: "lookup", query}` before
  WebFetch/WebSearch for anything the project depends on.

Finish with one line listing the five names; mention that the files live under
`.eminiar/memories/onboarding/` and the manifest at `.eminiar/docs.json`, and that both
should be committed.
