import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The plugin root is the package directory (one level above dist/). */
export function pluginRoot(): string {
  if (process.env.EMINIAR_PLUGIN_ROOT) return process.env.EMINIAR_PLUGIN_ROOT;
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

let cached: string | undefined;
export function version(): string {
  if (cached) return cached;
  try {
    const pkg = JSON.parse(readFileSync(join(pluginRoot(), "package.json"), "utf8")) as {
      version?: string;
    };
    cached = pkg.version ?? "0.0.0";
  } catch {
    cached = "0.0.0";
  }
  return cached;
}
