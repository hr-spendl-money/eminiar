---
name: decision/sandbox-hot-path-performance
kind: decision
tags: [performance, sandbox, startup]
related: [file:src/sandbox/execute.ts, file:src/sandbox/output.ts, file:src/storage/terms.ts, file:src/storage/sqlite/adapter.ts, file:tsup.config.ts, file:bin/_resolve.sh, file:scripts/bench-hotpath.mjs]
created: 2026-10-14T21:40:00.000Z
updated: 2026-10-14T21:40:00.000Z
---

em_execute / em_batch_execute are the hot paths; keep them within ~1 ms of the raw spawn cost and keep server start-up module-light. Decisions taken on branch feature/permance_on_hotpaths (2026-10-14):

- Never query `chunks_vocab_instance` filtered by chunk id: fts5vocab cannot push the filter down and scans the whole index (≈450 ms per call at 60k chunks). "Searchable terms" are computed in JS from the document's own chunk bodies (`topTermsOf` in src/storage/terms.ts).
- Pure-JS dependencies (zod, MCP SDK, fast-glob, ignore) are bundled into dist (`noExternal`) and each entry is one file (`splitting: false`); only native/heavy modules (better-sqlite3, sqlite-vec, transformers, tree-sitter, tsx, turndown) stay external. Externalised deps cost ~500 module loads per boot. The shim exports NODE_COMPILE_CACHE so V8 bytecode is reused across launches.
- Per-call caches: permission rules (stat-revalidated), compiled bash rule regexes, env allowlist patterns, interpreter detection, session id (mtime), prepared statements in SqliteAdapter (`prep()`). Stats are recorded on setImmediate so the reply is written first. Sandbox tools do not await the reindex-queue drain.
- Measure with `npm run bench` (scripts/bench-hotpath.mjs drives dist/server.js over stdio) before and after any change to these paths; run it alone, not concurrently with tests.
