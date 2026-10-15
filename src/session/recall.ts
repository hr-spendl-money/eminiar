import { fileOf } from "../graph/ids.js";
import { search } from "../search/pipeline.js";
import { parseQuery } from "../search/query.js";
import type { StorageAdapter } from "../storage/adapter.js";
import type { MemoryRow } from "../storage/types.js";

/**
 * Proactive recall for hooks: the memories and documentation pages relevant to a prompt
 * (or a file about to be touched), delivered as context so Claude does not have to
 * remember to call em_recall / em_docs. Lexical only — hooks never load the embedding
 * model — and gated on matched terms so common words do not drag in noise. Each memory
 * or page is shown once per context window: the window restarts at the latest
 * session_start event (written on startup, compact and resume).
 */

/** Words that carry no topic in a prompt (on top of the search stopwords). */
const PROMPT_FILLER = new Set([
  "please",
  "can",
  "could",
  "would",
  "should",
  "you",
  "we",
  "me",
  "my",
  "our",
  "us",
  "let",
  "lets",
  "let's",
  "want",
  "need",
  "make",
  "use",
  "using",
  "add",
  "get",
  "now",
  "also",
  "just",
  "like",
  "then",
  "so",
  "not",
  "all",
  "any",
  "some",
  "into",
  "about",
  "there",
  "here",
  "have",
  "has",
  "will",
  "which",
  "them",
  "they",
  "its",
  "if",
  "than",
  "more",
  "once",
  "complete",
  "done",
  "work",
  "thing",
  "things",
  "sure",
  "ok",
  "okay",
  "thanks",
  "yes",
  "no",
]);

const MAX_TERMS = 16;
const RECALL_CATEGORY = "recall";

export interface RecallOptions {
  maxMemories?: number;
  maxDocs?: number;
  /** Skip what this session was already shown in the current context window. */
  sessionId?: string | undefined;
}

export interface RecallResult {
  /** Rendered lines, ready to inject (empty when nothing cleared the bar). */
  text: string;
  /** Keys shown (`memory:<name>`, `doc:<chunk id>`), for recordShown. */
  keys: string[];
}

/** Distinctive terms of a prompt: no stopwords, no filler, no slash command, capped. */
export function promptTerms(prompt: string): string[] {
  const body = prompt.replace(/^\s*\/\S+/, " ");
  return parseQuery(body)
    .terms.filter((t) => t.length >= 3 && !PROMPT_FILLER.has(t) && !/^\d+$/.test(t))
    .slice(0, MAX_TERMS);
}

/** Hits must share this many terms with the prompt: 2 for short prompts, 3 for long ones. */
export function requiredMatches(termCount: number): number {
  return Math.min(3, Math.max(2, Math.ceil(termCount * 0.2)));
}

/** Keys already shown since the latest session_start of this session. */
export function shownKeys(db: StorageAdapter, sessionId: string): Set<string> {
  const events = db.eventsBySession(sessionId, {
    categories: [RECALL_CATEGORY, "session_start"],
  });
  const out = new Set<string>();
  for (const e of events) {
    if (e.category === "session_start") {
      out.clear();
      continue;
    }
    try {
      for (const k of (JSON.parse(e.payload) as { keys?: string[] }).keys ?? []) out.add(k);
    } catch {
      // malformed payload: ignore
    }
  }
  return out;
}

/** Remember what was injected so the next prompt does not repeat it. */
export function recordShown(db: StorageAdapter, sessionId: string, keys: string[]): void {
  if (!keys.length) return;
  db.eventInsert({ sessionId, category: RECALL_CATEGORY, priority: 4, payload: { keys } });
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** First non-heading line of a memory body; a line ending in ":" takes the next one along. */
function gist(m: MemoryRow, max = 160): string {
  const lines = m.content.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (!lines.length) return clip(m.content, max);
  const first = lines[0]!.trim();
  return clip(first.endsWith(":") && lines[1] ? `${first} ${lines[1].trim()}` : first, max);
}

/** Superseded and deprecated memories are history, not guidance. */
function live(m: MemoryRow): boolean {
  return m.status !== "superseded" && m.status !== "deprecated";
}

/**
 * Onboarding memories describe the whole project, so they match nearly every prompt; the
 * session brief already carries them. Prompt recall is for the specific ones.
 */
function specific(m: MemoryRow): boolean {
  return m.kind !== "onboarding";
}

/**
 * Memories and documentation pages relevant to free text (a prompt, a subagent task).
 * Returns empty text when the prompt is too vague or nothing shares enough terms.
 */
export async function recallForText(
  db: StorageAdapter,
  text: string,
  opts: RecallOptions = {},
): Promise<RecallResult> {
  const maxMemories = opts.maxMemories ?? 3;
  const maxDocs = opts.maxDocs ?? 2;
  const terms = promptTerms(text);
  if (terms.length < 2 || (maxMemories <= 0 && maxDocs <= 0)) return { text: "", keys: [] };
  const need = requiredMatches(terms.length);
  const query = terms.join(" ");
  const seen = opts.sessionId ? shownKeys(db, opts.sessionId) : new Set<string>();
  const lines: string[] = [];
  const keys: string[] = [];

  if (maxMemories > 0) {
    const r = await search(db, query, {
      mode: "lexical",
      // room for the onboarding / superseded hits that are skipped below
      limit: maxMemories * 3 + 5,
      filters: { source: "memory" },
    });
    let n = 0;
    for (const h of r.hits) {
      if (n >= maxMemories) break;
      if (h.matched.length < need) continue;
      const uri = h.chunk.document.uri;
      const name = uri?.startsWith("memory:") ? uri.slice(7) : undefined;
      const m = name ? db.memoryGetByName(name) : undefined;
      const key = `memory:${name}`;
      if (!m?.name || !live(m) || !specific(m) || seen.has(key) || keys.includes(key)) continue;
      lines.push(`- memory ${m.name} [${m.kind}]: ${gist(m)}`);
      keys.push(key);
      n++;
    }
  }

  if (maxDocs > 0) {
    const r = await search(db, query, {
      mode: "lexical",
      limit: maxDocs * 3,
      filters: { sourcePrefix: "docs:" },
    });
    let n = 0;
    const docsSeen = new Set<number>();
    for (const h of r.hits) {
      if (n >= maxDocs) break;
      if (h.matched.length < need) continue;
      const d = h.chunk.document;
      const key = `doc:${d.id}`;
      if (docsSeen.has(d.id) || seen.has(key)) continue;
      docsSeen.add(d.id);
      lines.push(`- ${d.source} › ${clip(d.title, 80)}: ${clip(h.snippet, 160)}`);
      keys.push(key);
      n++;
    }
  }

  if (!lines.length) return { text: "", keys: [] };
  return {
    text: [
      "eminiar recall — project memories and indexed docs that match this request (check them before deciding; superseded ones are omitted):",
      ...lines,
      'Full text: em_memory {action:"read", name} for a memory, em_docs {action:"lookup", query} for docs; em_recall {query} searches further.',
    ].join("\n"),
    keys,
  };
}

/** True when a memory's `related` ids name this file or a symbol inside it. */
function mentionsFile(m: MemoryRow, rel: string): boolean {
  if (!m.node_ids) return false;
  try {
    return (JSON.parse(m.node_ids) as string[]).some((id) => fileOf(id) === rel);
  } catch {
    return false;
  }
}

/**
 * Memories linked to a file (`related: [file:<path>]` or a `sym:<path>#…` in their
 * header), for a hook about to read or edit it. Only those not yet shown in this
 * context window. Scans the memory rows: a project has tens of memories, not thousands.
 */
export function memoriesForFile(
  db: StorageAdapter,
  rel: string,
  opts: { sessionId?: string | undefined; max?: number } = {},
): RecallResult {
  const linked = db.memoryList({ limit: 1000 }).filter((m) => live(m) && mentionsFile(m, rel));
  if (!linked.length) return { text: "", keys: [] };
  const seen = opts.sessionId ? shownKeys(db, opts.sessionId) : new Set<string>();
  const lines: string[] = [];
  const keys: string[] = [];
  for (const m of linked) {
    if (lines.length >= (opts.max ?? 3)) break;
    const key = `memory:${m.name}`;
    if (!m.name || seen.has(key)) continue;
    lines.push(`${m.name} [${m.kind}]: ${gist(m, 140)}`);
    keys.push(key);
  }
  if (!lines.length) return { text: "", keys: [] };
  return {
    text: `eminiar memory: ${rel} is covered by ${lines.join(" · ")} — respect it (em_memory {action:"read", name} for the full text) or update the memory if this change overrides it.`,
    keys,
  };
}
