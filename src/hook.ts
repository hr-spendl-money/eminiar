import { handlers } from "./hooks/index.js";
import { hookLog } from "./hooks/log.js";
import type { HookInput, HookOutput } from "./hooks/types.js";

/**
 * Single hook entry point. hooks.json routes every event here; we dispatch on
 * `hook_event_name` from stdin. Contract with Claude Code: stdout is JSON only,
 * exit 0 means "continue". We never exit non-zero — a broken hook must not block Claude.
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function emit(out: HookOutput): void {
  process.stdout.write(JSON.stringify(out));
}

async function main(): Promise<void> {
  // `--event <name>` lets the CLI / tests force an event without a full payload.
  const forced = process.argv.indexOf("--event");
  const raw = await readStdin();
  let input: HookInput;
  try {
    input = raw.trim() ? (JSON.parse(raw) as HookInput) : ({} as HookInput);
  } catch (err) {
    hookLog("error", `bad stdin JSON: ${(err as Error).message}`);
    return emit({});
  }
  if (forced !== -1 && process.argv[forced + 1]) input.hook_event_name = process.argv[forced + 1]!;
  if (process.argv.includes("--selftest")) return emit({ systemMessage: "eminiar hook ok" });

  const handler = handlers[input.hook_event_name];
  if (!handler) return emit({});
  try {
    const out = await handler(input);
    emit(out ?? {});
  } catch (err) {
    hookLog("error", `${input.hook_event_name}: ${(err as Error).stack ?? String(err)}`);
    emit({});
  }
}

main().catch((err) => {
  hookLog("error", `fatal: ${(err as Error).stack ?? String(err)}`);
  process.stdout.write("{}");
});
