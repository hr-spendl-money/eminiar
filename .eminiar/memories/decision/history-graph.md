---
name: decision/history-graph
kind: decision
tags: [history, dashboard, graph, memory, docs]
related: [file:src/history/lineage.ts, file:src/ui/history-graph-api.ts, file:src/ui/web/views/HistoryGraph.tsx, file:src/ui/web/history/graph-style.ts, file:src/ui/web/history/colors.ts, file:src/ui/web/graph/knowledge.ts]
created: 2026-10-15T21:36:44.578Z
updated: 2026-10-15T21:36:44.578Z
---

History graph (branch feature/history-graph, v0.8.0, 2026-10-15): the dashboard History tab has a Graph sub-tab (`src/ui/web/views/HistoryGraph.tsx`) fed by `/api/history/knowledge` (`src/ui/history-graph-api.ts`; `/api/history/graph` was already the lane DAG). Nodes: `branch:<name>`, `commit:<sha>`, `file:`, `memory:`, `doc:`. Edges: contains (branch→commit), merged_into (branch→default), touches (commit→file), records (commit→memory whose .md it changed), fixes (fix→SZZ origin), mentions/documents (from memory node_ids via fileOf, and stored doc `documents` edges). All derived per request; nothing stored.
- Branch membership (`src/history/lineage.ts`, pure): a branch owns its first-parent chain down to the default branch's first-parent line (mainline). This works for merged branches, unlike `branchOnlyCommits` (which returns nothing once merged). Deleted branches are recovered from mainline merge subjects (GitHub "Merge pull request #N from owner/x", "Merge branch 'x'"), using the merge's second parent as the old tip. Merge commits are walked through but never owned.
- Density controls: lockfiles skipped, memory .md files shown as memory nodes rather than files, top 12 files per commit by churn, then files ranked by how many in-view commits share them. Overview = newest 8 branches by default.
- The client filters reuse `applyKnowledgeFilter` (its `group` type was widened to string). The commit-kind palette moved to `src/ui/web/history/colors.ts` with a local Bucket type, because that module must import nothing: node tests and the web bundle both load it (importing ../api.ts drags DOM types into tsc, and classify.ts drags in node:child_process).
- Colours: branches mid slate #64748b (lighter #9ca3af once the ref is deleted) for ~3:1 contrast in both themes; #475569 / #1f2937 disappeared in dark mode.
