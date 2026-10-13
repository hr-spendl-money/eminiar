---
name: em-index
description: Index files, a directory or pasted content into eminiar's local knowledge base so em_search can find it later.
user-invocable: true
argument-hint: <path or glob> [--source name]
allowed-tools: mcp__plugin_eminiar_eminiar__em_index, mcp__plugin_eminiar_eminiar__em_reindex
---

Index what the user asked for with `em_index`:
- a file or directory path → `{ path }` (directories default to markdown; pass `glob` for other files)
- `docs`, `code`, `git` or `all` → `em_reindex { scope }`
- pasted text → `{ content, title }`

Report the one-line summary the tool returns: $ARGUMENTS
