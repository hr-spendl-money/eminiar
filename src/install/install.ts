import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigSchema } from "../config.js";
import { formatDoctor } from "../doctor.js";
import { ensureDirs } from "../paths.js";
import { resolveProjectRoot } from "../project.js";
import { globalDb } from "../stats/global.js";
import { version } from "../version.js";
import { type Json, readJson, writeInstallRecord, writeJsonWithBackup } from "./claude-config.js";
import { fullDoctor } from "./doctor.js";
import { downloadModel, materialize, nativeCheck, rebuildNative } from "./materialize.js";
import { pinNode } from "./node-resolve.js";
import { registerPlugin, registerSettings, setStatusline } from "./register.js";
import { claudeCli, confirm, log } from "./shell.js";

export interface InstallOptions {
  noModel?: boolean;
  method?: "plugin" | "settings" | undefined;
  team?: boolean;
  marketplace?: string | undefined;
  node?: string | undefined;
  yes?: boolean;
  statusline?: boolean;
  /** Registry spec to install instead of packing the running copy (upgrade uses this). */
  spec?: string | undefined;
}

export async function install(opts: InstallOptions): Promise<number> {
  console.log(`eminiar v${version()} installer`);

  log.step("node");
  const node = pinNode(opts.node);
  log.ok(`pinned ${node.path} (v${node.version})`);

  log.step("stable copy");
  const { root: stable, fromSpec } = materialize(opts.spec);

  log.step("native modules");
  let failures = nativeCheck(node.path, stable);
  if (failures.length) {
    log.warn(`${failures.join("; ")} — rebuilding better-sqlite3 for node ${node.version}`);
    rebuildNative(stable);
    failures = nativeCheck(node.path, stable);
  }
  if (failures.length) {
    for (const f of failures) log.fail(f);
    if (!failures.every((f) => f.startsWith("@huggingface"))) {
      log.fail("core native modules do not load; aborting before touching Claude Code config");
      log.info(`try: cd ${stable} && npm rebuild`);
      return 1;
    }
    log.warn("embeddings will be unavailable (lexical search still works)");
  } else {
    log.ok("better-sqlite3, sqlite-vec, web-tree-sitter, transformers load");
  }

  log.step("data directory");
  const p = ensureDirs();
  if (!existsSync(p.configFile))
    writeFileSync(p.configFile, `${JSON.stringify(ConfigSchema.parse({}), null, 2)}\n`);
  globalDb();
  log.ok(p.home);

  if (!opts.noModel && !failures.some((f) => f.startsWith("@huggingface"))) {
    log.step("embedding model (one-time download, ~35 MB)");
    const err = downloadModel(node.path, stable, ConfigSchema.parse({}).embeddings.model);
    if (err) log.warn(`download failed (${err}); it will be retried lazily on first hybrid search`);
    else log.ok("ready");
  }

  log.step("register with Claude Code");
  const method = opts.method ?? (claudeCli() ? "plugin" : "settings");
  if (
    !(await confirm(
      `Register eminiar with Claude Code using the ${method} method? This edits your user-level Claude config.`,
      !!opts.yes,
    ))
  ) {
    log.warn("skipped registration; re-run with --yes or confirm interactively");
    return 1;
  }
  let wrote: Parameters<typeof writeInstallRecord>[0]["wrote"] = {};
  let usedMethod: "plugin" | "settings" = method;
  if (method === "plugin") {
    const r = registerPlugin(stable);
    if (r.ok) {
      log.ok(r.detail);
      wrote = { marketplace: true };
    } else {
      log.warn(`${r.detail}; falling back to settings method`);
      usedMethod = "settings";
    }
  }
  if (usedMethod === "settings") {
    wrote = registerSettings(stable);
    log.ok(
      "hooks written to ~/.claude/settings.json, MCP server to ~/.claude.json, skills to ~/.claude/skills",
    );
  }
  if (opts.statusline || (opts.yes && !opts.team)) {
    if (setStatusline(stable)) {
      wrote.statusline = true;
      log.ok("statusLine set to `eminiar statusline`");
    }
  }

  writeInstallRecord({
    version: version(),
    method: usedMethod,
    node: node.path,
    stableRoot: stable,
    fromSpec,
    installedAt: new Date().toISOString(),
    wrote,
  });

  if (opts.team) {
    log.step("team defaults");
    writeTeamFiles(resolveProjectRoot(), opts.marketplace);
  }

  log.step("doctor");
  const checks = await fullDoctor();
  console.log(formatDoctor(checks));
  console.log(
    `\nRestart Claude Code to load eminiar. Try /em-doctor, then em_execute with an intent.`,
  );
  return checks.every((c) => c.ok) ? 0 : 1;
}

/** Commit-able defaults so teammates get the same behaviour from `npx eminiar install`. */
export function writeTeamFiles(root: string, marketplace?: string): void {
  const cfg = join(root, "eminiar.config.json");
  if (!existsSync(cfg)) {
    writeFileSync(
      cfg,
      `${JSON.stringify(
        {
          $schema:
            "https://raw.githubusercontent.com/ryandick/eminiar/main/eminiar.config.schema.json",
          routing: { mode: "auto", deferToContextMode: true },
          graph: {
            exclude: [
              "**/node_modules/**",
              "**/dist/**",
              "**/build/**",
              "**/.git/**",
              "**/coverage/**",
              "**/*.d.ts",
            ],
          },
          index: { docs: ["**/*.md", "docs/**"] },
          permissions: { extraDeny: [] },
        },
        null,
        2,
      )}\n`,
    );
    log.ok(`wrote ${cfg} — commit it`);
  } else {
    log.ok(`${cfg} already exists`);
  }
  if (marketplace) {
    const m = /^github:(.+)$/.exec(marketplace);
    const file = join(root, ".claude", "settings.json");
    const settings = readJson(file);
    const known = (settings.extraKnownMarketplaces as Json | undefined) ?? {};
    known.eminiar = m
      ? { source: { source: "github", repo: m[1] } }
      : { source: { source: "url", url: marketplace } };
    settings.extraKnownMarketplaces = known;
    const enabled = (settings.enabledPlugins as Json | undefined) ?? {};
    enabled["eminiar@eminiar"] = true;
    settings.enabledPlugins = enabled;
    writeJsonWithBackup(file, settings);
    log.ok(
      `${file}: marketplace + enabledPlugins added — teammates are prompted to install on next launch`,
    );
  } else {
    log.info("teammates: `npx eminiar install` (reads the committed eminiar.config.json)");
  }
}
