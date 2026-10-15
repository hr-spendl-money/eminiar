---
name: decision/proactive-recall-in-hooks
kind: decision
tags: [hooks, memory, docs, recall]
related: [file:src/session/recall.ts, file:src/hooks/capture.ts, file:src/hooks/routing.ts, file:src/hooks/session-start.ts, file:src/session/brief.ts, file:hooks/hooks.json]
created: 2026-10-15T17:01:57.400Z
updated: 2026-10-15T17:01:57.400Z
---

Memories and docs are pushed to Claude by hooks, not only pulled via em_recall/em_docs (branch feature/docs-memory-recall, 2026-10-15). `src/session/recall.ts` powers three paths: UserPromptSubmit injects up to 3 memories + 2 docs pages matching the prompt ("eminiar recall"); PreToolUse on Read/Edit/MultiEdit/Write injects memories whose `related` names the file or a symbol in it ("eminiar memory", independent of routing mode); Agent/Task briefs include recall for the subagent's task.

Why these rules: hooks open storage with vectors:false, so recall is lexical FTS only (~10 ms over the ~65 ms hook baseline). A hit must share >= 2 distinctive prompt terms (3 for long prompts), using rerank's `matched`, so the OR fallback cannot inject noise. Onboarding memories are excluded from prompt recall (they match everything; the session brief carries them), as are superseded/deprecated ones. Each memory/page is shown once per context window, tracked as `recall` events; the window resets at the latest `session_start` event (startup/compact/resume) so compacted-away knowledge comes back.

Config: `recall.{onPrompt,onFile,onAgent,maxMemories,maxDocs}`. Also: session brief now lists constraints & preferences, and its fitBudget drop order was fixed (it used to drop lines in document order, i.e. the overview first).
