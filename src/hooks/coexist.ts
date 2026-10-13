import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Config, RoutingMode } from "../config.js";

let cached: boolean | undefined;

/** Is the context-mode plugin installed for this user? Checked once per process. */
export function contextModeInstalled(): boolean {
  if (cached !== undefined) return cached;
  const base = join(homedir(), ".claude", "plugins");
  cached = existsSync(join(base, "data", "context-mode-context-mode"));
  if (!cached) {
    try {
      const installed = readFileSync(join(base, "installed_plugins.json"), "utf8");
      cached = installed.includes("context-mode");
    } catch {
      cached = false;
    }
  }
  return cached;
}

/** auto → annotate while context-mode is present (never fight its deny decisions), enforce otherwise. */
export function effectiveRoutingMode(config: Config): Exclude<RoutingMode, "auto"> {
  if (config.routing.mode !== "auto") return config.routing.mode;
  return contextModeInstalled() ? "annotate" : "enforce";
}
