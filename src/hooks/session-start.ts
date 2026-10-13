import { appendFileSync } from "node:fs";
import { getContext } from "../context.js";
import { setCurrentSession } from "../session/current.js";
import { renderGuide } from "../session/guide.js";
import { getStorage } from "../storage/index.js";
import { effectiveRoutingMode } from "./coexist.js";
import type { HookHandler } from "./types.js";

const MAX_INJECT = 8000;

export function routingGuidance(mode: string): string {
  return [
    `eminiar is active (routing: ${mode}). Keep raw tool output out of the context window:`,
    "- em_execute {language, code, intent}: run shell/JS/TS/python/… in the project; outputs over 5 KB are indexed and only sections matching `intent` come back, plus searchable terms.",
    "- em_batch_execute {commands:[{label, command}], queries}: several commands in parallel, answers in one round trip.",
    "- em_execute_file {path, code}: process a large file; your code gets $EM_FILE and only what it prints returns.",
    "- em_fetch_and_index {url, queries}: docs and web pages, indexed with a 24h cache.",
    '- em_search {queries, sort:"timeline"}: everything indexed plus session memory; em_recall {query} for past decisions, constraints and errors.',
    "- em_remember {content, kind}: record a decision/constraint/fact so it survives compaction.",
    "- em_graph_impact {node}: dependents and co-changing files before a refactor. em_stats shows savings.",
    "Plain Bash/Read/Grep remain right for short fixed output and files you are about to edit.",
  ].join("\n");
}

export const sessionStart: HookHandler = (input) => {
  const ctx = getContext(input.cwd);
  const sessionId = input.session_id || "unknown";
  setCurrentSession(ctx, sessionId);
  const db = getStorage(ctx, { vectors: false });
  db.sessionUpsert({
    id: sessionId,
    project_root: ctx.root,
    source: input.source,
    transcript_path: input.transcript_path,
  });
  db.eventInsert({
    sessionId,
    category: "session_start",
    priority: 4,
    payload: { source: input.source },
  });

  if (process.env.CLAUDE_ENV_FILE) {
    try {
      appendFileSync(
        process.env.CLAUDE_ENV_FILE,
        `export EMINIAR_SESSION_ID=${JSON.stringify(sessionId)}\nexport EMINIAR_PROJECT_ROOT=${JSON.stringify(ctx.root)}\n`,
      );
    } catch {
      // env file is optional
    }
  }

  const parts: string[] = [];
  if (input.source === "compact" || input.source === "resume") {
    const snap = db.snapshotLatestUnconsumed(sessionId);
    if (snap) {
      parts.push(`## Session Guide (eminiar)\n${snap.body}`);
      db.snapshotMarkConsumed(snap.id);
    } else {
      // No PreCompact snapshot (e.g. resume after a crash): build one from recent events.
      const prev = input.source === "resume" ? db.sessionLatest() : undefined;
      const guide = renderGuide(db, prev && prev.id !== sessionId ? prev.id : sessionId, 2048);
      if (guide) parts.push(`## Session Guide (eminiar)\n${guide}`);
    }
  }
  parts.push(routingGuidance(effectiveRoutingMode(ctx.config)));
  const docs = db.countDocuments();
  const latest = db.sessionLatest();
  parts.push(
    `eminiar index: ${docs} documents${latest && latest.id !== sessionId && latest.started_at ? `; previous session ${new Date(latest.started_at).toISOString().slice(0, 16)}` : ""}. Use em_search {sort:"timeline"} or em_recall to pick up where you left off.`,
  );
  return {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: parts.join("\n\n").slice(0, MAX_INJECT),
    },
  };
};
