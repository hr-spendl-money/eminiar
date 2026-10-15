// Copies package.json's version into .claude-plugin/plugin.json. Runs from the npm
// `version` lifecycle script, so `npm version <bump>` keeps both in step (Claude Code
// names its plugin cache directory after the plugin.json version).
// `--check` only compares and exits 1 on a mismatch (used by the publish workflow).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const pluginFile = join(root, ".claude-plugin", "plugin.json");
const plugin = JSON.parse(readFileSync(pluginFile, "utf8"));

if (plugin.version === version) {
  console.log(`.claude-plugin/plugin.json already at ${version}`);
} else if (process.argv.includes("--check")) {
  console.error(`.claude-plugin/plugin.json is ${plugin.version}, package.json is ${version}`);
  process.exit(1);
} else {
  plugin.version = version;
  writeFileSync(pluginFile, `${JSON.stringify(plugin, null, 2)}\n`);
  console.log(`.claude-plugin/plugin.json -> ${version}`);
}
