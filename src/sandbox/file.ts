import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { PermissionRules } from "../permissions/rules.js";
import { matchRead } from "../permissions/rules.js";

/**
 * `em_execute_file` may only touch files under the project root, unless a Claude
 * Code `Read(<path>)` allow rule opts a path in. Returns the real absolute path.
 */
export function confinePath(root: string, target: string, rules: PermissionRules): string {
  const abs = resolve(root, target);
  let real: string;
  try {
    real = realpathSync(abs);
  } catch {
    throw new Error(`file not found: ${target}`);
  }
  const rel = relative(root, real);
  const inside = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  if (inside) return real;
  if (rules.allow.some((r) => matchRead(r, real))) return real;
  throw new Error(
    `${target} is outside the project root; add a Read(${real}) rule to permissions.allow to opt it in`,
  );
}
