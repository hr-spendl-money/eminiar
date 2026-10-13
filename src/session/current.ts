import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectContext } from "../context.js";
import { projectDir } from "../paths.js";

/**
 * The MCP server is started once per Claude Code launch and never told the
 * session id. The SessionStart hook records it here so tool calls can attribute
 * stats and indexed documents to the right session.
 */
function file(ctx: ProjectContext): string {
  return join(projectDir(ctx.id), "current-session");
}

export function setCurrentSession(ctx: ProjectContext, sessionId: string): void {
  writeFileSync(file(ctx), sessionId);
}

export function getCurrentSession(ctx: ProjectContext): string {
  if (process.env.EMINIAR_SESSION_ID) return process.env.EMINIAR_SESSION_ID;
  const f = file(ctx);
  if (existsSync(f)) {
    const id = readFileSync(f, "utf8").trim();
    if (id) return id;
  }
  return "unknown";
}
