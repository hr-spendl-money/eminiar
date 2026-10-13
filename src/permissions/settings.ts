import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { matchBash, type PermissionRules, parseRule, type Rule } from "./rules.js";
import { splitCommand } from "./split.js";

interface SettingsFile {
  permissions?: { allow?: string[]; deny?: string[]; ask?: string[] };
}

function readRules(file: string): Partial<Record<keyof PermissionRules, string[]>> {
  if (!existsSync(file)) return {};
  try {
    const s = JSON.parse(readFileSync(file, "utf8")) as SettingsFile;
    return s.permissions ?? {};
  } catch {
    return {};
  }
}

/**
 * Claude Code's permission rules, merged from user, project and local settings,
 * plus eminiar's own `permissions.extraDeny`. The sandbox honours these so
 * `em_execute` cannot be used to sidestep a `Bash(sudo *)` deny.
 */
export function loadPermissionRules(root: string, extraDeny: string[] = []): PermissionRules {
  const files = [
    join(homedir(), ".claude", "settings.json"),
    join(root, ".claude", "settings.json"),
    join(root, ".claude", "settings.local.json"),
  ];
  const out: PermissionRules = { allow: [], deny: [], ask: [] };
  const push = (list: Rule[], raws: string[] | undefined) => {
    for (const raw of raws ?? []) {
      const r = parseRule(raw);
      if (r) list.push(r);
    }
  };
  for (const f of files) {
    const p = readRules(f);
    push(out.allow, p.allow);
    push(out.deny, p.deny);
    push(out.ask, p.ask);
  }
  push(out.deny, extraDeny);
  return out;
}

export interface CommandCheck {
  allowed: boolean;
  segment?: string;
  rule?: string;
  kind?: "deny" | "ask";
}

/** Deny wins; `ask` is treated as deny because the sandbox has no way to prompt. */
export function checkCommand(rules: PermissionRules, command: string): CommandCheck {
  for (const segment of splitCommand(command)) {
    for (const r of rules.deny) {
      if (matchBash(r, segment)) return { allowed: false, segment, rule: r.raw, kind: "deny" };
    }
    for (const r of rules.ask) {
      if (matchBash(r, segment)) return { allowed: false, segment, rule: r.raw, kind: "ask" };
    }
  }
  return { allowed: true };
}
