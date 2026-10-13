import { accessSync, constants, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDirs } from "../paths.js";
import { run } from "./shell.js";

export interface PinnedNode {
  path: string;
  version: string;
}

function versionOf(bin: string): string | undefined {
  const r = run(bin, ["-p", "process.versions.node"]);
  return r.ok ? r.stdout.trim() : undefined;
}

export function nodeOk(version: string): boolean {
  const [maj = 0, min = 0] = version.split(".").map(Number);
  return maj > 22 || (maj === 22 && min >= 12);
}

/**
 * Pin the Node binary hooks and the MCP server will use. Prefers an explicit
 * path, then the one running the installer. Written to ~/.eminiar/node-path so
 * the bin/ shims never depend on Claude Code's PATH.
 */
export function pinNode(explicit?: string): PinnedNode {
  const candidate = explicit ?? process.execPath;
  accessSync(candidate, constants.X_OK);
  const version = versionOf(candidate);
  if (!version) throw new Error(`${candidate} does not look like a node binary`);
  if (!nodeOk(version))
    throw new Error(`node ${version} at ${candidate} is too old; need >= 22.12`);
  writeFileSync(ensureDirs().nodePathFile, candidate);
  return { path: candidate, version };
}

export function pinnedNode(): PinnedNode | undefined {
  try {
    const path = readFileSync(ensureDirs().nodePathFile, "utf8").trim();
    const version = versionOf(path);
    return version ? { path, version } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Pin the package root whose dist/ the bin/ shims run when their own directory
 * cannot resolve dependencies (Claude Code's plugin cache copies dist/ but not
 * node_modules/). Written to ~/.eminiar/root-path; read by bin/_resolve.sh.
 */
export function pinRoot(root: string): string {
  if (!existsSync(join(root, "dist", "server.js")))
    throw new Error(`${root} has no dist/server.js; cannot pin it as the stable root`);
  writeFileSync(ensureDirs().rootPathFile, root);
  return root;
}

/** The pinned root, or undefined when missing or no longer runnable. */
export function pinnedRoot(): string | undefined {
  try {
    const root = readFileSync(ensureDirs().rootPathFile, "utf8").trim();
    return root && existsSync(join(root, "dist", "server.js")) ? root : undefined;
  } catch {
    return undefined;
  }
}
