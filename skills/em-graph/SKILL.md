---
name: em-graph
description: Explore the project knowledge graph — architecture overview, impact of changing a file or symbol, dependencies, what a git diff touches, hotspots, routes, dead-code candidates, import cycles, clusters, files that change together, orphans, index freshness.
user-invocable: true
argument-hint: <architecture|impact|deps|neighbors|path|changes|pattern|status|hotspots|routes|dead_code|cycles|clusters|coupled|orphans> [file, symbol or ref]
allowed-tools: mcp__plugin_eminiar_eminiar__em_architecture, mcp__plugin_eminiar_eminiar__em_graph_impact, mcp__plugin_eminiar_eminiar__em_graph_query, mcp__plugin_eminiar_eminiar__em_graph_changes, mcp__plugin_eminiar_eminiar__em_index_status, mcp__plugin_eminiar_eminiar__em_graph_add, mcp__plugin_eminiar_eminiar__em_reindex
---

Arguments: $ARGUMENTS

- `architecture` (or no argument) → `em_architecture`; add `aspects` (`overview`, `folders`,
  `entry_points`, `routes`, `hotspots`, `clusters`, `cycles`, `decisions`) to narrow it.
- `impact <node>` / `deps <node>` / `neighbors <node>` / `path <a> <b>` → `em_graph_impact` with the
  matching `mode` (`deps` = `dependencies`). A node is a project-relative path, `path#Symbol`, or a name.
- `changes [ref]` → `em_graph_changes`: the symbols the working tree (or a diff against `ref`) touches,
  their exposure, and the files the change can reach.
- `hotspots` / `routes` / `dead_code` / `cycles` / `clusters` / `coupled` / `orphans` / `stats` →
  `em_graph_query { preset }`. `hotspots` takes `hotspot_kind: "symbol"` for functions instead of files.
- `pattern <json>` → `em_graph_query { pattern: { from, edge: { kinds, direction, depth }, to, return } }`,
  e.g. callers of a function two hops up: `{"from":{"name":"^parse$"},"edge":{"kinds":["calls"],"direction":"in","depth":2}}`.
- `status` → `em_index_status`: HEAD vs indexed commit, files changed since indexed, skipped files.
- A bare name → `em_graph_query { query }` to find the node first.
- "remember that X relates to Y" → `em_graph_add`.

Present the ranked list with the reasons the tool gives; do not re-derive them from source. Hotspot
scores and clusters are signals, not quality grades or boundary claims. Before saying "nothing calls
X", check `em_index_status` for coverage gaps.
