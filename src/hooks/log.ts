import { appendFileSync } from "node:fs";
import { ensureDirs } from "../paths.js";

/** Hooks must stay silent on stdout; diagnostics go to ~/.eminiar/hook.log. */
export function hookLog(level: "info" | "error", msg: string): void {
  try {
    const p = ensureDirs();
    appendFileSync(p.hookLog, `${new Date().toISOString()} ${level} ${msg}\n`);
  } catch {
    // never let logging break a hook
  }
}
