---
name: em-graph
description: Explore the project knowledge graph — impact of changing a file or symbol, dependencies, hotspots, files that change together, orphans.
user-invocable: true
argument-hint: <impact|deps|neighbors|path|hotspots|coupled|orphans> [file or symbol]
allowed-tools: mcp__plugin_eminiar_eminiar__em_graph_impact, mcp__plugin_eminiar_eminiar__em_graph_query, mcp__plugin_eminiar_eminiar__em_graph_add, mcp__plugin_eminiar_eminiar__em_reindex
---

Arguments: $ARGUMENTS

- `impact <node>` / `deps <node>` / `neighbors <node>` / `path <a> <b>` → `em_graph_impact` with the
  matching `mode` (`deps` = `dependencies`). A node is a project-relative path, `path#Symbol`, or a name.
- `hotspots` / `coupled` / `orphans` / `stats` → `em_graph_query { preset }`.
- A bare name → `em_graph_query { query }` to find the node first.
- "remember that X relates to Y" → `em_graph_add`.

Present the ranked list with the reasons the tool gives; do not re-derive them from source.
