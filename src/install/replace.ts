import {
  type Json,
  pluginInstalled,
  readJson,
  settingsPath,
  writeJsonWithBackup,
} from "./claude-config.js";
import { claudeCli, confirm, log, run } from "./shell.js";

const CM_HOOK = /context-mode\/hooks\/|context-mode-cache-heal\.mjs/;

interface Findings {
  plugin: boolean;
  hookEntries: Array<{ event: string; command: string }>;
  gatewayEnv: string[];
}

export function findContextMode(): Findings {
  const settings = readJson(settingsPath());
  const hooks = (settings.hooks as Record<string, Json[]> | undefined) ?? {};
  const hookEntries: Findings["hookEntries"] = [];
  for (const [event, list] of Object.entries(hooks)) {
    for (const entry of list) {
      for (const h of (entry.hooks as Json[] | undefined) ?? []) {
        if (typeof h.command === "string" && CM_HOOK.test(h.command))
          hookEntries.push({ event, command: h.command });
      }
    }
  }
  const env = (settings.env as Record<string, string> | undefined) ?? {};
  const gatewayEnv = Object.keys(env).filter(
    (k) =>
      (k === "ANTHROPIC_BASE_URL" && /context-mode/.test(env[k] ?? "")) ||
      (k === "ANTHROPIC_CUSTOM_HEADERS" && /x-cm-/.test(env[k] ?? "")),
  );
  return { plugin: pluginInstalled("context-mode@context-mode"), hookEntries, gatewayEnv };
}

/**
 * Remove context-mode once eminiar reaches parity. Shows exactly what will go,
 * confirms, and treats the hosted-gateway env vars as a separate decision because
 * they are unrelated to the local features eminiar replaces.
 */
export async function replaceContextMode(opts: {
  yes?: boolean;
  revertGateway?: boolean;
}): Promise<number> {
  const f = findContextMode();
  if (!f.plugin && !f.hookEntries.length && !f.gatewayEnv.length) {
    log.ok("context-mode is not installed; nothing to do");
    return 0;
  }
  console.log("Found context-mode:");
  if (f.plugin)
    console.log("  - plugin context-mode@context-mode (will run `claude plugin uninstall`)");
  for (const h of f.hookEntries) console.log(`  - ${h.event} hook: ${h.command}`);
  if (f.gatewayEnv.length)
    console.log(
      `  - hosted gateway env in settings.json: ${f.gatewayEnv.join(", ")} (left alone unless --revert-gateway)`,
    );
  console.log(
    "  ~/.context-mode data is never touched. A backup of settings.json is written first.",
  );
  if (!(await confirm("Remove the context-mode plugin and its hooks?", !!opts.yes))) return 1;

  if (f.plugin) {
    const claude = claudeCli();
    if (claude) {
      const r = run(claude, ["plugin", "uninstall", "context-mode@context-mode"]);
      if (r.ok) log.ok("plugin uninstalled");
      else log.warn(`plugin uninstall reported: ${(r.stderr || r.stdout).trim().slice(-200)}`);
      run(claude, ["plugin", "marketplace", "remove", "context-mode"]);
    } else {
      log.warn("claude CLI not found; uninstall the plugin from inside Claude Code (/plugin)");
    }
  }
  if (f.hookEntries.length) {
    const settings = readJson(settingsPath());
    const hooks = (settings.hooks as Record<string, Json[]> | undefined) ?? {};
    for (const [event, list] of Object.entries(hooks)) {
      const kept = list
        .map((entry) => ({
          ...entry,
          hooks: ((entry.hooks as Json[] | undefined) ?? []).filter(
            (h) => !(typeof h.command === "string" && CM_HOOK.test(h.command)),
          ),
        }))
        .filter((entry) => (entry.hooks as Json[]).length > 0);
      if (kept.length) hooks[event] = kept;
      else delete hooks[event];
    }
    settings.hooks = hooks;
    writeJsonWithBackup(settingsPath(), settings);
    log.ok(`removed ${f.hookEntries.length} hook entr${f.hookEntries.length === 1 ? "y" : "ies"}`);
  }
  if (f.gatewayEnv.length) {
    const doIt =
      opts.revertGateway ||
      (await confirm(
        "Also remove the context-mode gateway env (ANTHROPIC_BASE_URL / ANTHROPIC_CUSTOM_HEADERS)? Requests then go straight to Anthropic.",
        !!opts.yes && !!opts.revertGateway,
      ));
    if (doIt) {
      const settings = readJson(settingsPath());
      const env = (settings.env as Record<string, string> | undefined) ?? {};
      for (const k of f.gatewayEnv) delete env[k];
      if (Object.keys(env).length) settings.env = env;
      else delete settings.env;
      writeJsonWithBackup(settingsPath(), settings);
      log.ok("gateway env removed");
    } else {
      log.info("gateway env kept");
    }
  }
  log.info(
    "eminiar routing switches to `enforce` automatically now that context-mode is gone (routing.mode=auto). Restart Claude Code.",
  );
  return 0;
}
