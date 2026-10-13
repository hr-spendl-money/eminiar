import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT_MARKERS = [
  ".git",
  "package.json",
  "pnpm-workspace.yaml",
  "go.mod",
  "Cargo.toml",
  "pyproject.toml",
];

/** Walk up from `start` until a project marker is found; falls back to `start`. */
export function findProjectRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    for (const marker of ROOT_MARKERS) {
      if (existsSync(join(dir, marker))) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

/**
 * The MCP server does not receive CLAUDE_PROJECT_DIR, so the root is resolved from
 * (1) an explicit hint (tool arg), (2) EMINIAR_PROJECT_ROOT / CLAUDE_PROJECT_DIR env,
 * (3) walking up from cwd.
 */
export function resolveProjectRoot(hint?: string): string {
  const candidate =
    hint || process.env.EMINIAR_PROJECT_ROOT || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const root = findProjectRoot(candidate);
  try {
    return realpathSync(root);
  } catch {
    return root;
  }
}

/** Stable per-project identifier used for the data directory name. */
export function projectId(root: string): string {
  return createHash("sha256").update(root).digest("hex").slice(0, 16);
}
