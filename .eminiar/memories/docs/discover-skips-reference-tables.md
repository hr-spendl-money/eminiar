---
name: docs/discover-skips-reference-tables
kind: decision
tags: []
related: [file:src/docs/discover.ts, file:src/docs/catalog.ts]
created: 2026-10-15T18:54:23.079Z
updated: 2026-10-15T18:54:23.079Z
---

Docs discovery (apiSignals in src/docs/discover.ts) skips any source file that names >= 15 distinct external hosts (REFERENCE_TABLE_HOSTS): such a file is a reference table (eminiar's own src/docs/catalog.ts, link lists, CSP allow-lists), not integration code, and used to surface ~85 bogus `link:` providers when eminiar scanned itself. Lines containing `placeholder` are ignored too (example input text, e.g. Docs.tsx). Branch fix/docs-discover-reference-tables, PR #20, v0.5.2, 2026-10-15. If a real project legitimately wires 15+ vendors in one config file, it loses discovery for those — revisit the threshold rather than special-casing paths.
