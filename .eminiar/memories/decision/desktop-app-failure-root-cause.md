---
name: decision/desktop-app-failure-root-cause
kind: decision
tags: [desktop, plugin-cache, install]
related: [file:bin/em-server, file:bin/em-hook, file:src/install/register.ts, file:src/install/doctor.ts]
created: 2026-10-13T15:30:33.241Z
updated: 2026-10-13T15:30:33.241Z
---

Desktop app failure root cause (2026-10-13): Claude Code desktop's bundled CLI (2.1.29x) launches the eminiar plugin from ~/.claude/plugins/cache/eminiar/eminiar/<ver>, a copy with dist/ but no node_modules/, so ESM imports of better-sqlite3 fail (ERR_MODULE_NOT_FOUND) and Claude Code caches the failure in ~/.claude/mcp-needs-auth-cache.json for 15 min. Terminal CLI 2.1.287 runs from ~/.eminiar/plugin/node_modules/eminiar where deps exist. Fix: bin/_resolve.sh pins the stable root (~/.eminiar/root-path) and shims fall back to it when their own dir cannot resolve deps; server --probe flag; doctor --fix clears the needs-auth entry.
