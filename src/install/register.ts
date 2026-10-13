import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  claudeJsonPath,
  type InstallRecord,
  type Json,
  marketplaceKnown,
  pluginInstalled,
  readJson,
  settingsPath,
  writeJsonWithBackup,
} from "./claude-config.js";
import { claudeCli, log, run } from "./shell.js";

const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "SubagentStop",
  "PreCompact",
  "Stop",
  "SessionEnd",
];

/** Register through Claude Code's plugin system (preferred). */
export function registerPlugin(stable: string): { ok: boolean; detail: string } {
  const claude = claudeCli();
  if (!claude) return { ok: false, detail: "claude CLI not on PATH" };
  if (!marketplaceKnown("eminiar")) {
    const add = run(claude, ["plugin", "marketplace", "add", stable]);
    if (!add.ok)
      return {
        ok: false,
        detail: `marketplace add failed: ${(add.stderr || add.stdout).trim().slice(-300)}`,
      };
  } else {
    run(claude, ["plugin", "marketplace", "update", "eminiar"]);
  }
  const inst = pluginInstalled("eminiar@eminiar")
    ? run(claude, ["plugin", "update", "eminiar@eminiar"])
    : run(claude, ["plugin", "install", "eminiar@eminiar", "--scope", "user"]);
  if (!inst.ok && !pluginInstalled("eminiar@eminiar")) {
    return {
      ok: false,
      detail: `plugin install failed: ${(inst.stderr || inst.stdout).trim().slice(-300)}`,
    };
  }
  return {
    ok: true,
    detail: pluginInstalled("eminiar@eminiar")
      ? "registered via claude plugin"
      : "install command ran; verify with `claude plugin list`",
  };
}

export function unregisterPlugin(): void {
  const claude = claudeCli();
  if (!claude) return;
  run(claude, ["plugin", "uninstall", "eminiar@eminiar"]);
  run(claude, ["plugin", "marketplace", "remove", "eminiar"]);
}

function isOurs(cmd: unknown, stable: string): boolean {
  return typeof cmd === "string" && (cmd.includes("/.eminiar/plugin/") || cmd.includes(stable));
}

/** Fallback: write hooks + MCP server directly, context-mode style. */
export function registerSettings(stable: string): InstallRecord["wrote"] {
  const settings = readJson(settingsPath());
  const hooks = (settings.hooks as Record<string, unknown[]> | undefined) ?? {};
  const hookCmd = `"${join(stable, "bin", "em-hook")}"`;
  for (const ev of HOOK_EVENTS) {
    const list = (hooks[ev] as Json[] | undefined) ?? [];
    const filtered = list.filter(
      (entry) =>
        !((entry.hooks as Json[] | undefined) ?? []).some((h) => isOurs(h.command, stable)),
    );
    const entry: Json = {
      hooks: [{ type: "command", command: hookCmd, timeout: ev === "PreCompact" ? 15 : 10 }],
    };
    if (ev === "PreToolUse") entry.matcher = "Bash|Read|Grep|Glob|WebFetch|Agent|Task";
    if (ev === "PostToolUse" || ev === "PostToolUseFailure")
      (entry.hooks as Json[])[0]!.async = true;
    filtered.push(entry);
    hooks[ev] = filtered;
  }
  settings.hooks = hooks;
  writeJsonWithBackup(settingsPath(), settings);

  const cj = readJson(claudeJsonPath());
  const servers = (cj.mcpServers as Json | undefined) ?? {};
  servers.eminiar = {
    type: "stdio",
    command: join(stable, "bin", "em-server"),
    args: [],
    env: { EMINIAR_PLUGIN_ROOT: stable },
  };
  cj.mcpServers = servers;
  writeJsonWithBackup(claudeJsonPath(), cj);

  const skills: string[] = [];
  const skillsDir = join(settingsPath(), "..", "skills");
  mkdirSync(skillsDir, { recursive: true });
  for (const name of readdirSync(join(stable, "skills"))) {
    cpSync(join(stable, "skills", name), join(skillsDir, name), { recursive: true });
    skills.push(name);
  }
  return { hookEvents: HOOK_EVENTS, mcpServer: true, skills };
}

export function unregisterSettings(stable: string, wrote: InstallRecord["wrote"]): void {
  if (wrote.hookEvents?.length) {
    const settings = readJson(settingsPath());
    const hooks = (settings.hooks as Record<string, Json[]> | undefined) ?? {};
    for (const ev of wrote.hookEvents) {
      const list = hooks[ev];
      if (!list) continue;
      const kept = list.filter(
        (entry) =>
          !((entry.hooks as Json[] | undefined) ?? []).some((h) => isOurs(h.command, stable)),
      );
      if (kept.length) hooks[ev] = kept;
      else delete hooks[ev];
    }
    if (Object.keys(hooks).length) settings.hooks = hooks;
    else delete settings.hooks;
    writeJsonWithBackup(settingsPath(), settings);
  }
  if (wrote.mcpServer) {
    const cj = readJson(claudeJsonPath());
    const servers = cj.mcpServers as Json | undefined;
    if (servers?.eminiar) {
      delete servers.eminiar;
      writeJsonWithBackup(claudeJsonPath(), cj);
    }
  }
  for (const name of wrote.skills ?? []) {
    const dir = join(settingsPath(), "..", "skills", name);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

export function setStatusline(stable: string): boolean {
  const settings = readJson(settingsPath());
  if (settings.statusLine) {
    log.warn(
      "a statusLine is already configured; leaving it alone (set it to `eminiar statusline` to show savings)",
    );
    return false;
  }
  settings.statusLine = {
    type: "command",
    command: `"${join(stable, "bin", "eminiar")}" statusline`,
  };
  writeJsonWithBackup(settingsPath(), settings);
  return true;
}

export function clearStatusline(stable: string): void {
  const settings = readJson(settingsPath());
  const sl = settings.statusLine as Json | undefined;
  if (sl && isOurs(sl.command, stable)) {
    delete settings.statusLine;
    writeJsonWithBackup(settingsPath(), settings);
  }
}
