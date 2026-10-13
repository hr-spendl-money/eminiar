import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectContext } from "../context.js";
import { projectDir } from "../paths.js";

/**
 * Routing in `enforce` mode denies a native tool call and tells Claude to retry with an
 * em_* tool. That is only safe while an eminiar MCP server is actually connected for the
 * project; otherwise Claude is left with nothing to retry with. The server leaves a pid
 * marker here for as long as it runs and the PreToolUse hook checks it before denying.
 */
function markersDir(ctx: ProjectContext): string {
  return join(projectDir(ctx.id), "servers");
}

/** Write a marker for `pid`; returns a function that removes it again. */
export function markServerAlive(ctx: ProjectContext, pid = process.pid): () => void {
  const dir = markersDir(ctx);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, String(pid));
  writeFileSync(file, new Date().toISOString());
  return () => {
    try {
      rmSync(file, { force: true });
    } catch {
      // best effort; a stale marker is discarded by liveServers()
    }
  };
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Pids of eminiar servers currently running for this project. Stale markers are removed. */
export function liveServers(ctx: ProjectContext): number[] {
  const dir = markersDir(ctx);
  if (!existsSync(dir)) return [];
  const live: number[] = [];
  for (const name of readdirSync(dir)) {
    const pid = Number(name);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (processAlive(pid)) live.push(pid);
    else rmSync(join(dir, name), { force: true });
  }
  return live;
}

export function serverAlive(ctx: ProjectContext): boolean {
  return liveServers(ctx).length > 0;
}
