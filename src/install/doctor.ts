import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigSchema } from "../config.js";
import { getContext } from "../context.js";
import { type Check, runDoctor } from "../doctor.js";
import { contextModeInstalled, effectiveRoutingMode } from "../hooks/coexist.js";
import { availableLanguages } from "../sandbox/languages.js";
import { liveServers } from "../session/server-alive.js";
import { getStorage } from "../storage/index.js";
import { pluginInstalled, readInstallRecord } from "./claude-config.js";
import { stableRoot } from "./materialize.js";
import { pinnedNode } from "./node-resolve.js";
import { pluginCacheStale } from "./register.js";
import { run } from "./shell.js";

/** Spawn a binary, send one MCP initialize request, expect a JSON-RPC reply within `ms`. */
function mcpHandshake(bin: string, ms = 15_000): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(bin, [], { stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve(`no reply in ${ms / 1000}s${err ? `: ${err.trim().slice(-200)}` : ""}`);
    }, ms);
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      if (buf.includes('"result"')) {
        clearTimeout(timer);
        child.kill();
        const m = /"serverInfo":\{"name":"([^"]+)","version":"([^"]+)"/.exec(buf);
        resolve(m ? `${m[1]} v${m[2]}` : "ok");
      }
    });
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString();
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve(`spawn failed: ${e.message}`);
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "doctor", version: "0" } } })}\n`,
    );
  });
}

/** Everything `runDoctor` checks plus installation, hooks, MCP and config. */
export async function fullDoctor(): Promise<Check[]> {
  const checks = runDoctor();
  const rec = readInstallRecord();
  const stable = rec?.stableRoot ?? stableRoot();
  const hasStable = existsSync(join(stable, "dist", "server.js"));
  const bins = hasStable ? stable : join(process.argv[1] ?? "", "..", "..");

  checks.push({
    name: "install",
    ok: !!rec,
    detail: rec
      ? `v${rec.version} via ${rec.method} at ${rec.installedAt.slice(0, 10)} (${rec.stableRoot})`
      : "not installed (run `npx eminiar install`)",
  });
  const pinned = pinnedNode();
  checks.push({
    name: "pinned node",
    ok: !!pinned,
    detail: pinned ? `${pinned.path} v${pinned.version}` : "none (hooks will use PATH node)",
  });

  if (rec?.method === "plugin" || !rec) {
    const reg = pluginInstalled("eminiar@eminiar");
    const stale = reg && hasStable ? pluginCacheStale(stable) : undefined;
    checks.push({
      name: "plugin registration",
      ok: (reg && !stale) || !rec,
      detail: reg
        ? stale
          ? `eminiar@eminiar installed but Claude Code's cached copy is out of date (${stale}); run \`eminiar upgrade\``
          : "eminiar@eminiar installed, cache matches the stable copy"
        : "not in installed_plugins.json",
    });
  } else {
    const s = existsSync(join(process.env.HOME ?? "", ".claude", "settings.json"))
      ? readFileSync(join(process.env.HOME ?? "", ".claude", "settings.json"), "utf8")
      : "";
    checks.push({
      name: "hooks in settings.json",
      ok: s.includes("em-hook"),
      detail: s.includes("em-hook") ? "present" : "missing",
    });
  }

  const hookBin = join(bins, "bin", "em-hook");
  if (existsSync(hookBin)) {
    const r = run(hookBin, ["--selftest"], { env: { ...process.env } });
    checks.push({
      name: "hook self-test",
      ok: r.ok && r.stdout.includes("eminiar hook ok"),
      detail: r.ok ? r.stdout.trim() : r.stderr.trim().slice(-200) || "failed",
    });
  }
  const serverBin = join(bins, "bin", "em-server");
  if (existsSync(serverBin)) {
    const reply = await mcpHandshake(serverBin);
    checks.push({ name: "MCP handshake", ok: /^eminiar v|^ok$/.test(reply), detail: reply });
  }

  try {
    const ctx = getContext();
    const db = getStorage(ctx, { vectors: false });
    checks.push({
      name: "project",
      ok: true,
      detail: `${ctx.root} · ${db.countDocuments()} docs · ${db.memoryCount()} memories · graph ${db.graphCounts().nodes} nodes`,
    });
    const cfgFile = join(ctx.root, "eminiar.config.json");
    if (existsSync(cfgFile)) {
      try {
        const parsed = ConfigSchema.safeParse(JSON.parse(readFileSync(cfgFile, "utf8")));
        checks.push({
          name: "eminiar.config.json",
          ok: parsed.success,
          detail: parsed.success
            ? "valid"
            : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        });
      } catch (err) {
        checks.push({ name: "eminiar.config.json", ok: false, detail: (err as Error).message });
      }
    }
    const mode = effectiveRoutingMode(ctx.config);
    const cm = contextModeInstalled();
    checks.push({
      name: "routing",
      ok: !(mode === "enforce" && cm && ctx.config.routing.mode !== "auto"),
      detail: `${ctx.config.routing.mode} → ${mode}${cm ? " · context-mode installed (coexisting; run `eminiar replace-context-mode` when ready)" : ""}${mode === "enforce" && cm && ctx.config.routing.mode !== "auto" ? " · WARNING: enforce + context-mode will deny each other's suggestions" : ""}`,
    });
    const live = liveServers(ctx);
    checks.push({
      name: "MCP server",
      ok: true,
      detail: live.length
        ? `running for this project (pid ${live.join(", ")})`
        : "none running for this project right now; enforce routing annotates instead of denying until one connects",
    });
    // A project-scope .mcp.json cannot use plugin variables: Claude Code leaves
    // ${CLAUDE_PLUGIN_ROOT} empty there, so the server fails with ENOENT at startup.
    const projectMcp = join(ctx.root, ".mcp.json");
    if (existsSync(projectMcp)) {
      const raw = readFileSync(projectMcp, "utf8");
      const bad = raw.includes(`\${CLAUDE_PLUGIN_ROOT}`) && raw.includes("em-server");
      checks.push({
        name: "project .mcp.json",
        ok: !bad,
        detail: bad
          ? "registers em-server via the CLAUDE_PLUGIN_ROOT variable, which is empty for project-scope servers (ENOENT at startup); declare it under mcpServers in .claude-plugin/plugin.json instead"
          : "present, no eminiar entry using plugin variables",
      });
    }
  } catch (err) {
    checks.push({ name: "project", ok: false, detail: (err as Error).message });
  }
  checks.push({
    name: "sandbox languages",
    ok: true,
    detail: availableLanguages()
      .filter((l) => l.bin)
      .map((l) => l.id)
      .join(", "),
  });
  return checks;
}
