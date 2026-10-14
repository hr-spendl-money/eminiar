import { readFileSync, statSync, writeFileSync } from "node:fs";
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

let cached: { file: string; mtimeMs: number; id: string } | undefined;

export function getCurrentSession(ctx: ProjectContext): string {
  if (process.env.EMINIAR_SESSION_ID) return process.env.EMINIAR_SESSION_ID;
  const f = file(ctx);
  // Read on every tool call; one stat() revalidates instead of exists + read.
  let mtimeMs: number;
  try {
    mtimeMs = statSync(f).mtimeMs;
  } catch {
    return "unknown";
  }
  if (cached && cached.file === f && cached.mtimeMs === mtimeMs) return cached.id;
  const id = readFileSync(f, "utf8").trim() || "unknown";
  cached = { file: f, mtimeMs, id };
  return id;
}
