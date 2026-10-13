import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { paths } from "../paths.js";

export const claudeDir = (): string => process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
export const settingsPath = (): string => join(claudeDir(), "settings.json");
/** User-scope MCP servers live in ~/.claude.json, not settings.json. */
export const claudeJsonPath = (): string => join(homedir(), ".claude.json");
export const pluginsDir = (): string => join(claudeDir(), "plugins");

export type Json = Record<string, unknown>;

export function readJson(file: string): Json {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Json;
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${(err as Error).message}`);
  }
}

/** Write JSON, keeping a one-off `.eminiar.bak` copy of the previous content. */
export function writeJsonWithBackup(file: string, obj: Json): void {
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) copyFileSync(file, `${file}.eminiar.bak`);
  writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);
}

export interface InstallRecord {
  version: string;
  method: "plugin" | "settings";
  node: string;
  stableRoot: string;
  fromSpec: string;
  installedAt: string;
  /** Exact things we wrote so uninstall can remove only those. */
  wrote: {
    hookEvents?: string[];
    mcpServer?: boolean;
    skills?: string[];
    statusline?: boolean;
    marketplace?: boolean;
  };
}

export function readInstallRecord(): InstallRecord | undefined {
  const f = paths().installFile;
  if (!existsSync(f)) return undefined;
  try {
    return JSON.parse(readFileSync(f, "utf8")) as InstallRecord;
  } catch {
    return undefined;
  }
}

export function writeInstallRecord(r: InstallRecord): void {
  writeFileSync(paths().installFile, `${JSON.stringify(r, null, 2)}\n`);
}

/** Is a plugin id (e.g. "eminiar@eminiar" or "context-mode@context-mode") registered with Claude Code? */
export function pluginInstalled(id: string): boolean {
  try {
    const raw = readFileSync(join(pluginsDir(), "installed_plugins.json"), "utf8");
    return raw.includes(`"${id}"`);
  } catch {
    return false;
  }
}

/** Where Claude Code copied the plugin to (its cache); undefined when not installed. */
export function pluginInstallPath(id: string): string | undefined {
  try {
    const reg = JSON.parse(
      readFileSync(join(pluginsDir(), "installed_plugins.json"), "utf8"),
    ) as { plugins?: Record<string, { installPath?: string }[]> };
    return reg.plugins?.[id]?.[0]?.installPath;
  } catch {
    return undefined;
  }
}

export function marketplaceKnown(name: string): boolean {
  try {
    const raw = readFileSync(join(pluginsDir(), "known_marketplaces.json"), "utf8");
    return raw.includes(`"${name}"`);
  } catch {
    return false;
  }
}
