---
name: em-stats
description: Show how much context eminiar has kept out of the conversation (tokens seen vs returned per tool, session / project / lifetime) and the size of the local index.
user-invocable: true
allowed-tools: mcp__plugin_eminiar_eminiar__em_stats
---

Call `em_stats` with `scope: "all"` and show the result verbatim. If the user named a scope
(session, project, lifetime) pass it. Do not add commentary beyond one line.
