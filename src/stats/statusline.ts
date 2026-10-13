import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getContext } from "../context.js";
import { paths } from "../paths.js";
import { getStorage } from "../storage/index.js";
import { globalDb } from "./global.js";
import { fmtTokens, summarize } from "./record.js";

interface StatuslineInput {
  session_id?: string;
  cwd?: string;
  workspace?: { current_dir?: string };
}

/**
 * Claude Code statusline command: reads its JSON on stdin and prints one line.
 * Cached for 5 s because the statusline is re-rendered often.
 */
export function renderStatusline(raw: string): string {
  let input: StatuslineInput = {};
  try {
    input = raw.trim() ? (JSON.parse(raw) as StatuslineInput) : {};
  } catch {
    // fall through with defaults
  }
  const cache = paths().statuslineCache;
  try {
    if (existsSync(cache)) {
      const c = JSON.parse(readFileSync(cache, "utf8")) as {
        at: number;
        line: string;
        key: string;
      };
      if (Date.now() - c.at < 5000 && c.key === (input.session_id ?? "")) return c.line;
    }
  } catch {
    // ignore cache errors
  }
  let line: string;
  try {
    const ctx = getContext(input.cwd ?? input.workspace?.current_dir);
    const db = getStorage(ctx, { vectors: false });
    const session = summarize(db.statsBySession(input.session_id ?? ""));
    const life = summarize(globalDb().lifetime());
    const pct = session.rawTokens
      ? Math.round(session.efficiency * 100)
      : life.rawTokens
        ? Math.round(life.efficiency * 100)
        : 0;
    line = `eminiar · ${fmtTokens(session.savedTokens)} saved · ${fmtTokens(life.savedTokens)} lifetime · ${pct}% efficient`;
  } catch (err) {
    line = `eminiar · unavailable (${(err as Error).message.slice(0, 40)})`;
  }
  try {
    writeFileSync(cache, JSON.stringify({ at: Date.now(), line, key: input.session_id ?? "" }));
  } catch {
    // cache is best effort
  }
  return line;
}
