import { appendFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getContext } from "../context.js";
import { readManifest } from "../docs/manifest.js";
import { memoriesDir } from "../memory/store.js";
import { renderProjectBrief } from "../session/brief.js";
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
    '- em_docs {action:"lookup", query}: the project\'s documentation knowledge base (local docs plus the libraries, services and APIs it uses) — ask it before WebFetch/WebSearch; {action:"discover"} / {action:"add", pick:"recommended"} build it, {action:"sync"} refreshes it.',
    '- em_search {queries, sort:"timeline"}: everything indexed plus session memory; em_recall {query} for past decisions, constraints and errors.',
    "- em_remember {content, kind, name?, status?}: record a decision/constraint/fact as a markdown memory under .eminiar/memories (survives compaction, shareable via git); em_memory {action: list|read|edit|rename|delete|status} manages them.",
    '- em_architecture {aspects?}: the project map (folders, entry points, routes, hotspots, decisions) in one call; em_symbols {name_path | mode:"overview", file} for a symbol or a file outline; em_graph_impact {node} before a refactor; em_graph_changes for what the current diff reaches; em_graph_query {pattern | preset} to walk the graph; em_index_status for coverage. em_stats shows savings.',
    "- em_history {action: overview | file {path} | risk | commit {sha} | branch {name} | symbol {name_path} | search {query}}: the git history classified (feat/fix/refactor…), branches vs base, and each fix traced back to the commit that caused it — ask it before editing a file or committing instead of running git log/blame; commit messages are searchable via em_search (source git).",
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
  // A fresh context gets the project brief; after a compaction the Session Guide has the
  // room, so only the one-line index state is added.
  try {
    const brief = renderProjectBrief(ctx, db, 1500, {
      freshnessOnly: input.source === "compact" || input.source === "resume",
    });
    if (brief) parts.push(brief);
  } catch {
    // the brief is optional
  }
  try {
    const onboarding = join(memoriesDir(ctx), "onboarding");
    const onboarded =
      existsSync(onboarding) && readdirSync(onboarding).some((f) => f.endsWith(".md"));
    if (!onboarded)
      parts.push(
        "No onboarding memories yet: run /eminiar:em-onboard once so future sessions start with the project's structure, build and test commands.",
      );
    else if (!readManifest(ctx).sources.length)
      parts.push(
        'No documentation sources registered yet: em_docs {action:"discover"} maps this project\'s libraries, services and APIs to their documentation, and {action:"add", pick:"recommended"} indexes it for em_docs lookup.',
      );
  } catch {
    // the nudge is optional
  }
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
