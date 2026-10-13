import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { paths } from "../paths.js";
import { pluginRoot, version } from "../version.js";
import { log, npmCli, run } from "./shell.js";

/** Where the stable, Claude-facing copy of the package lives. */
export function stableRoot(): string {
  return join(paths().plugin, "node_modules", "eminiar");
}

export function stableVersion(): string | undefined {
  try {
    return (
      JSON.parse(readFileSync(join(stableRoot(), "package.json"), "utf8")) as { version?: string }
    ).version;
  } catch {
    return undefined;
  }
}

/**
 * Install the package into ~/.eminiar/plugin so Claude Code never points at an
 * npx cache or a dev checkout. `spec` may be a registry spec ("eminiar@latest")
 * or omitted, in which case the currently running package is packed and installed
 * (works for dev checkouts and the npx cache alike).
 */
export function materialize(spec?: string, force = false): { root: string; fromSpec: string } {
  const prefix = paths().plugin;
  mkdirSync(prefix, { recursive: true });
  const root = stableRoot();
  const here = pluginRoot();
  if (!force && !spec && here === root) return { root, fromSpec: "self" };
  if (
    !force &&
    !spec &&
    stableVersion() === version() &&
    existsSync(join(root, "dist", "server.js"))
  ) {
    log.ok(`stable copy already at v${version()} (${root})`);
    return { root, fromSpec: `pack:${here}` };
  }
  let target = spec;
  if (!target) {
    if (!existsSync(join(here, "dist", "server.js"))) {
      throw new Error(`${here} has no dist/ — run \`npm run build\` first`);
    }
    const dest = paths().tmp;
    mkdirSync(dest, { recursive: true });
    const pack = run(
      npmCli(),
      ["pack", "--ignore-scripts", "--pack-destination", dest, "--silent"],
      { cwd: here },
    );
    if (!pack.ok) throw new Error(`npm pack failed: ${pack.stderr || pack.stdout}`);
    const tarball = pack.stdout.trim().split("\n").pop()!;
    target = join(dest, tarball);
  }
  const install = run(
    npmCli(),
    [
      "install",
      "--prefix",
      prefix,
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      "--loglevel=error",
      target,
    ],
    {
      env: { ...process.env, npm_config_update_notifier: "false" },
    },
  );
  if (!install.ok) throw new Error(`npm install failed: ${install.stderr || install.stdout}`);
  if (!spec && target.endsWith(".tgz")) rmSync(target, { force: true });
  // `files` excludes tests etc., but make sure the pieces Claude needs are there.
  for (const must of [
    "dist/server.js",
    "dist/hook.js",
    "bin/em-hook",
    ".claude-plugin/plugin.json",
    "hooks/hooks.json",
  ]) {
    if (!existsSync(join(root, must))) throw new Error(`stable copy is missing ${must}`);
  }
  log.ok(
    `installed v${stableVersion()} into ${root} (${readdirSync(join(prefix, "node_modules")).length} packages)`,
  );
  return { root, fromSpec: spec ?? `pack:${here}` };
}

/**
 * Load each native/heavy module with the pinned node from the stable copy.
 * Returns the failures; an empty list means everything resolves and loads.
 */
export function nativeCheck(node: string, root: string): string[] {
  const script = `
    const { createRequire } = require("node:module");
    const req = createRequire(${JSON.stringify(join(root, "package.json"))});
    const out = [];
    for (const m of ["better-sqlite3", "sqlite-vec", "web-tree-sitter", "@huggingface/transformers"]) {
      try { const x = req(m); if (m === "better-sqlite3") { const db = new x(":memory:"); req("sqlite-vec").load(db); db.close(); } }
      catch (e) { out.push(m + ": " + (e && e.message ? e.message.split("\\n")[0] : e)); }
    }
    process.stdout.write(JSON.stringify(out));
  `;
  const r = run(node, ["-e", script], { cwd: root });
  if (!r.ok) return [`native check could not run: ${r.stderr.trim().split("\n").pop()}`];
  try {
    return JSON.parse(r.stdout) as string[];
  } catch {
    return [`native check returned garbage: ${r.stdout.slice(0, 200)}`];
  }
}

export function rebuildNative(root: string): boolean {
  const r = run(
    npmCli(),
    ["rebuild", "better-sqlite3", "--prefix", paths().plugin, "--loglevel=error"],
    { cwd: root },
  );
  return r.ok;
}

/** Download the embedding model with the pinned node (so the cache matches the runtime). */
export function downloadModel(node: string, root: string, model: string): string | undefined {
  const script = `
    (async () => {
      const tf = await import("@huggingface/transformers");
      tf.env.cacheDir = ${JSON.stringify(paths().models)};
      const p = await tf.pipeline("feature-extraction", ${JSON.stringify(model)}, { dtype: "q8", device: "cpu" });
      const r = await p(["warm up"], { pooling: "cls", normalize: true });
      process.stdout.write(String(r.tolist()[0].length));
    })().catch((e) => { process.stderr.write(String(e && e.message || e)); process.exit(1); });
  `;
  const r = run(node, ["--input-type=module", "-e", script], { cwd: root });
  return r.ok ? undefined : r.stderr.trim().split("\n").pop();
}
