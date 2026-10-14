import { realpathSync, statSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import type { ProjectContext } from "../context.js";
import { getContext } from "../context.js";
import { renderProjectBrief } from "../session/brief.js";
import { serverAlive } from "../session/server-alive.js";
import type { StorageAdapter } from "../storage/adapter.js";
import { getStorage } from "../storage/index.js";
import { contextModeInstalled, effectiveRoutingMode } from "./coexist.js";
import { hookLog } from "./log.js";
import type { HookHandler, HookInput, HookOutput } from "./types.js";

const SYMBOL_KINDS = ["function", "class", "method", "interface", "type", "enum", "variable"];

/** The longest identifier-like run in a Grep/Glob pattern (`parse\w+File` → `parse`). */
export function literalOf(pattern: string): string | undefined {
  const runs = pattern.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? [];
  const best = runs.sort((a, b) => b.length - a.length)[0];
  return best && !/^(ts|js|tsx|jsx|src|lib|test|spec|index)$/i.test(best) ? best : undefined;
}

/**
 * Graph symbols whose name contains the pattern's literal: a jump target instead of a
 * grep, delivered as context without blocking the call.
 */
export function symbolHints(db: StorageAdapter, pattern: string): string | undefined {
  const lit = literalOf(pattern);
  if (!lit) return undefined;
  const nodes = db.graphFindNodes({ query: lit, kinds: SYMBOL_KINDS, limit: 5 });
  if (!nodes.length) return undefined;
  const list = nodes
    .map((n) => `${n.kind} ${n.name} (${n.path}:${n.start_line ?? "?"})`)
    .join("; ");
  return `eminiar graph: symbols matching "${lit}": ${list}. em_symbols {name_path, include_body: true} reads one; {mode:"references"} lists its callers.`;
}

/** Why a file is not fully in the graph, so absence of callers is not over-trusted. */
export function coverageHint(db: StorageAdapter, rel: string): string | undefined {
  const row = db.fileIndexGet(rel);
  if (!row || row.status === "indexed") return undefined;
  return `eminiar graph: ${rel} is ${row.status}${row.reason ? ` (${row.reason})` : ""}; graph answers about it may be incomplete.`;
}

interface Suggestion {
  tool: string;
  reason: string;
  /** For Agent/Task in enforce mode: prefix the prompt instead of denying. */
  prefixPrompt?: string;
}

const HEAVY_BASH =
  /^\s*(git\s+(log|diff|show|blame)|npm\s+(test|run|ls|list|outdated|audit|why)|pnpm\s+(test|run|ls|list|outdated|why)|yarn\s+(test|run|list|why)|npx\s+(vitest|jest|tsc|eslint|biome)|cat\s|head\s|tail\s|find\s|grep\s|rg\s|ls\s+-[a-zA-Z]*R|tree\b|curl\s|wget\s|docker\s|kubectl\s|du\s|df\s|ps\s|lsof\s|brew\s+(list|outdated)|pip\s+(list|freeze)|cargo\s+(test|build)|go\s+(test|build)|make\b|pytest\b|mvn\b|gradle\b)/;
const TINY_BASH =
  /^\s*(git\s+(status|branch)\b[^|]*|pwd|ls(\s+-[a-zA-Z]+)?(\s+\S+)?|echo\s.*|which\s+\S+|node\s+-v|npm\s+-v|cd\s+\S+|mkdir\s.*|touch\s.*|cp\s.*|mv\s.*|rm\s.*|chmod\s.*|date|whoami)\s*$/;
const BIG_TEXT_EXT = new Set([
  ".log",
  ".json",
  ".jsonl",
  ".csv",
  ".tsv",
  ".xml",
  ".txt",
  ".ndjson",
  ".sql",
  ".har",
]);

/** Decide whether a native tool call is better served by an em_* tool. */
export function suggest(
  toolName: string,
  input: Record<string, unknown>,
  root: string,
): Suggestion | undefined {
  switch (toolName) {
    case "Bash": {
      const cmd = String(input.command ?? "");
      if (!cmd || TINY_BASH.test(cmd)) return undefined;
      if (HEAVY_BASH.test(cmd) || /\|\s*(head|tail|grep|wc|sort|uniq|jq|less)\b/.test(cmd)) {
        return {
          tool: "em_execute",
          reason: `this command is likely to print a lot; em_execute {language:"shell", code, intent} keeps the output out of context and returns only matching sections`,
        };
      }
      return undefined;
    }
    case "Read": {
      const fp = String(input.file_path ?? "");
      if (!fp) return undefined;
      try {
        const st = statSync(resolve(root, fp));
        const ext = extname(fp).toLowerCase();
        if (st.size > 200 * 1024 || (BIG_TEXT_EXT.has(ext) && st.size > 20 * 1024)) {
          return {
            tool: "em_execute_file",
            reason: `${fp} is ${Math.round(st.size / 1024)} KB; em_execute_file {path, code} processes it in the sandbox so only what you print enters context`,
          };
        }
      } catch {
        // missing file: let Read report it
      }
      return undefined;
    }
    case "Grep": {
      if (input.output_mode === "content" && !input.head_limit) {
        return {
          tool: "em_execute",
          reason: `content-mode grep can be large; em_execute with rg and an intent returns only matching sections`,
        };
      }
      return undefined;
    }
    case "WebFetch":
      return {
        tool: "em_fetch_and_index",
        reason: `em_fetch_and_index {url, queries} indexes the page and returns only the relevant sections`,
      };
    case "Agent":
    case "Task":
      return {
        tool: "em_*",
        reason:
          "subagents should prefer em_execute / em_batch_execute / em_search over Bash, Read and Grep",
        prefixPrompt:
          "Use the eminiar tools (em_execute, em_batch_execute, em_execute_file, em_fetch_and_index, em_search) instead of Bash/Read/Grep/WebFetch whenever output may be large; return only derived answers.\n\n",
      };
    default:
      return undefined;
  }
}

/**
 * Non-blocking context for navigation tools: matching graph symbols for Grep/Glob
 * patterns, coverage gaps for files about to be read. Never denies anything.
 */
function graphContext(ctx: ProjectContext, input: HookInput): string | undefined {
  try {
    const db = getStorage(ctx, { vectors: false });
    if (!db.graphCounts().nodes) return undefined;
    if (input.tool_name === "Grep" || input.tool_name === "Glob") {
      const pattern = String(input.tool_input?.pattern ?? "");
      return pattern ? symbolHints(db, pattern) : undefined;
    }
    if (input.tool_name === "Read") {
      const fp = String(input.tool_input?.file_path ?? "");
      if (!fp) return undefined;
      let abs = resolve(ctx.root, fp);
      try {
        abs = realpathSync(abs); // the project root is a real path; tool paths may go through symlinks
      } catch {
        // missing file: let Read report it
      }
      const rel = relative(ctx.root, abs).split("\\").join("/");
      return rel.startsWith("..") ? undefined : coverageHint(db, rel);
    }
  } catch {
    // hints are optional
  }
  return undefined;
}

function withContext(
  out: HookOutput | undefined,
  extra: string | undefined,
): HookOutput | undefined {
  if (!extra) return out;
  if (!out)
    return { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: extra } };
  const cur = out.hookSpecificOutput?.additionalContext;
  return {
    ...out,
    hookSpecificOutput: {
      ...out.hookSpecificOutput,
      hookEventName: "PreToolUse",
      additionalContext: cur ? `${cur}\n${extra}` : extra,
    },
  };
}

export const preToolUse: HookHandler = (input: HookInput): HookOutput | undefined => {
  if (!input.tool_name || !input.tool_input) return undefined;
  const ctx = getContext(input.cwd);
  const mode = effectiveRoutingMode(ctx.config);
  if (mode === "off") return undefined;
  const coexisting = contextModeInstalled() && ctx.config.routing.deferToContextMode;
  // context-mode already routes these; adding a second opinion only confuses the model.
  if (coexisting && ["Bash", "Read", "Grep", "WebFetch"].includes(input.tool_name))
    return undefined;

  const hint = graphContext(ctx, input);
  const s = suggest(input.tool_name, input.tool_input, ctx.root);
  if (!s) return withContext(undefined, hint);

  if (mode === "enforce") {
    if (s.prefixPrompt) {
      const prompt = String(input.tool_input.prompt ?? "");
      if (prompt.startsWith(s.prefixPrompt)) return undefined;
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          updatedInput: {
            ...input.tool_input,
            prompt: s.prefixPrompt + briefFor(ctx) + prompt,
          },
        },
      };
    }
    // Denying only makes sense if there is an em_* server to retry with. If none is
    // running for this project (failed to start, not yet connected, dev checkout
    // without the plugin loaded), fall back to annotating so Claude is never stranded.
    if (!serverAlive(ctx)) {
      hookLog(
        "info",
        `enforce → annotate for ${input.tool_name}: no eminiar MCP server running for ${ctx.root}`,
      );
      return withContext(
        annotate(
          s,
          " eminiar MCP server is not running, so this call is allowed; /em-doctor explains.",
        ),
        hint,
      );
    }
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `eminiar: ${s.reason}. Retry with ${s.tool}.${hint ? ` ${hint}` : ""}`,
      },
    };
  }
  // Annotate mode: subagents get the project brief as context since their prompt is untouched.
  const extra = s.prefixPrompt ? [briefFor(ctx).trim(), hint].filter(Boolean).join("\n") : hint;
  return withContext(annotate(s), extra || undefined);
};

/** The project brief for a subagent prompt (empty when the graph is not built yet). */
function briefFor(ctx: ProjectContext): string {
  try {
    const db = getStorage(ctx, { vectors: false });
    const brief = renderProjectBrief(ctx, db, 1200);
    return brief
      ? `Project brief (eminiar):\n${brief}\nVerify structure with em_symbols / em_graph_impact before reading files; check em_index_status before claiming something is unused.\n\n`
      : "";
  } catch {
    return "";
  }
}

function annotate(s: Suggestion, note = ""): HookOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: `eminiar: ${s.reason} (${s.tool}).${note}`.slice(0, 400),
    },
  };
}
