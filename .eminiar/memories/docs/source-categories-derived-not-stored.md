---
name: docs/source-categories-derived-not-stored
kind: decision
tags: [docs, dashboard]
related: [file:src/docs/category.ts, file:src/ui/web/views/Docs.tsx, file:src/ui/api.ts, file:src/tools/em_docs.ts]
created: 2026-10-14T22:40:32.193Z
updated: 2026-10-14T22:40:32.193Z
---

Documentation sources are grouped by a derived document category (src/docs/category.ts), not by a field stored in .eminiar/docs.json. `docCategory(source, catalogEntry)` reads the discovery title/name suffix/globs of a path source (readme, guides, adr, agent-instructions, api-specs, env-reference, deploy-config, local) and the catalogue tier or provider prefix of a url source (service, api, infra, library, web). The dashboard Sources list, em_docs {action:"list"} and docsPayload all use it, so every listing groups the same way and existing manifests need no migration. The module is import-free and structurally typed because the browser bundle (tsconfig.web.json) imports its label table; importing manifest.ts or catalog.ts types from it drags node types into the web typecheck. Note the catalogue tiers GitHub and the AWS/Datadog/Gemini SDKs as `service`, so they appear under Services, not Libraries; change the catalogue entry's tier to move them.
