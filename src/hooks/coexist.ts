import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config, RoutingMode } from "../config.js";
import { pluginsDir } from "../install/claude-config.js";

let cached: boolean | undefined;

/**
 * Is the context-mode plugin installed for this user? Checked once per process.
 * Only the plugin registry counts: `plugins/data/<plugin>` survives an uninstall
 * (and is recreated by some `claude plugin` commands), so it must not be used as a signal.
 */
export function contextModeInstalled(): boolean {
  if (cached !== undefined) return cached;
  try {
    const reg = JSON.parse(readFileSync(join(pluginsDir(), "installed_plugins.json"), "utf8")) as {
      plugins?: Record<string, unknown>;
    };
    cached = Object.keys(reg.plugins ?? {}).some((id) => id.startsWith("context-mode@"));
  } catch {
    cached = false;
  }
  return cached;
}

/** auto → annotate while context-mode is present (never fight its deny decisions), enforce otherwise. */
export function effectiveRoutingMode(config: Config): Exclude<RoutingMode, "auto"> {
  if (config.routing.mode !== "auto") return config.routing.mode;
  return contextModeInstalled() ? "annotate" : "enforce";
}
