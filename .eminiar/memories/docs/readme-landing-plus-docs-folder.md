---
name: docs/readme-landing-plus-docs-folder
kind: decision
tags: [docs, readme]
related: [file:README.md, file:docs/README.md, file:src/cli.ts]
created: 2026-10-15T17:28:44.072Z
updated: 2026-10-15T17:28:44.072Z
---

Documentation layout (branch docs/readme-refresh, PR #14, 2026-10-15): README.md is a short landing page (problem, with/without table, features, real hook output, quick start, Mermaid diagram, privacy). All reference material lives in docs/, one topic per page: getting-started, how-it-works, tools, memory-and-recall, knowledge-graph, documentation-kb, dashboard, configuration, cli, troubleshooting, development (index: docs/README.md). Style: short sentences, active voice, tables, simplified technical English. Why: the old README had grown into a 300-line wall of reference text that buried the unique features. How to apply: when a feature, tool, config key or CLI flag changes, update the matching docs/ page (configuration.md defaults come from eminiar.config.schema.json; tools.md parameters from the zod schemas in src/tools; cli.md from USAGE in src/cli.ts) and touch README only for a headline feature. Mermaid edge labels use the `-->|label|` form, and labels avoid HTML entities. Repo is github.com/rydn/eminiar (ryandick/eminiar returns 404).
