---
name: em-onboard
description: Onboard eminiar to this project — write the onboarding memories (overview, structure, commands, conventions) under .eminiar/memories so every future session starts knowing how the project is built, tested and organised.
user-invocable: true
allowed-tools: mcp__plugin_eminiar_eminiar__em_execute, mcp__plugin_eminiar_eminiar__em_batch_execute, mcp__plugin_eminiar_eminiar__em_graph_query, mcp__plugin_eminiar_eminiar__em_memory, mcp__plugin_eminiar_eminiar__em_remember
---

Write four `onboarding` memories, each a few short paragraphs or bullet lists, so a fresh
session can start work without rediscovering the basics. Check first with
`em_memory {action: "list", topic: "onboarding"}`; if they exist, only refresh what changed
(`em_remember` with `replace: true`).

Gather the facts with the sandbox, not by reading whole files into context:

1. `em_batch_execute` with labelled commands: the manifest (`cat package.json` / `pyproject.toml`
   / `go.mod` …), `ls` of the top level and `src/`, the test and lint configs, and `git log
   --oneline -15`. Ask `queries` like "scripts", "entry points", "test command".
2. `em_graph_query {preset: "stats"}`, `{preset: "hotspots"}` and `{preset: "orphans"}` for
   where the code concentrates and what the entry points are.

Then write, via `em_remember {kind: "onboarding", name: …, content: …}`:

- `onboarding/overview` — what the project is, who it is for, the main runtime pieces.
- `onboarding/structure` — top-level layout, where each kind of code lives, entry points,
  hotspots; add `related_files` for the key paths.
- `onboarding/commands` — exact commands to install, build, test, lint, run and release, plus
  any env vars or services they need.
- `onboarding/conventions` — code style, naming, how tests are organised, commit/PR habits,
  anything a newcomer gets wrong.

Finish with one line listing the four names; mention that the files live under
`.eminiar/memories/onboarding/` and should be committed.
