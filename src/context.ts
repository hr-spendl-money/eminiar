import { type Config, loadConfig } from "./config.js";
import { ensureDirs, projectDbPath } from "./paths.js";
import { projectId, resolveProjectRoot } from "./project.js";

/** Everything a tool or hook needs that is scoped to one project. */
export interface ProjectContext {
  root: string;
  id: string;
  dbPath: string;
  config: Config;
}

const cache = new Map<string, ProjectContext>();

/** Resolve (and memoise per root) the project context. Cheap after the first call. */
export function getContext(rootHint?: string): ProjectContext {
  const root = resolveProjectRoot(rootHint);
  const hit = cache.get(root);
  if (hit) return hit;
  ensureDirs();
  const id = projectId(root);
  const ctx: ProjectContext = { root, id, dbPath: projectDbPath(id), config: loadConfig(root) };
  cache.set(root, ctx);
  return ctx;
}

export function resetContextCache(): void {
  cache.clear();
}
