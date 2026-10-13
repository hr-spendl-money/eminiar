import { statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { getContext } from "../context.js";
import { contextModeInstalled, effectiveRoutingMode } from "./coexist.js";
import type { HookHandler, HookInput, HookOutput } from "./types.js";

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

export const preToolUse: HookHandler = (input: HookInput): HookOutput | undefined => {
  if (!input.tool_name || !input.tool_input) return undefined;
  const ctx = getContext(input.cwd);
  const mode = effectiveRoutingMode(ctx.config);
  if (mode === "off") return undefined;
  const coexisting = contextModeInstalled() && ctx.config.routing.deferToContextMode;
  // context-mode already routes these; adding a second opinion only confuses the model.
  if (coexisting && ["Bash", "Read", "Grep", "WebFetch"].includes(input.tool_name))
    return undefined;

  const s = suggest(input.tool_name, input.tool_input, ctx.root);
  if (!s) return undefined;

  if (mode === "enforce") {
    if (s.prefixPrompt) {
      const prompt = String(input.tool_input.prompt ?? "");
      if (prompt.startsWith(s.prefixPrompt)) return undefined;
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          updatedInput: { ...input.tool_input, prompt: s.prefixPrompt + prompt },
        },
      };
    }
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `eminiar: ${s.reason}. Retry with ${s.tool}.`,
      },
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: `eminiar: ${s.reason} (${s.tool}).`.slice(0, 400),
    },
  };
};
