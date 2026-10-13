import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { ensureDirs, paths } from "./paths.js";
import { pluginRoot, version } from "./version.js";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const require = createRequire(import.meta.url);

function check(name: string, fn: () => string): Check {
  try {
    return { name, ok: true, detail: fn() };
  } catch (err) {
    return { name, ok: false, detail: (err as Error).message };
  }
}

/** Shared by `em_doctor` and `eminiar doctor`. Each check is independent and never throws. */
export function runDoctor(): Check[] {
  const p = ensureDirs();
  const checks: Check[] = [];

  checks.push({ name: "eminiar", ok: true, detail: `v${version()} at ${pluginRoot()}` });

  checks.push(
    check("node", () => {
      const [major, minor] = process.versions.node.split(".").map(Number);
      if ((major ?? 0) < 22 || ((major ?? 0) === 22 && (minor ?? 0) < 12)) {
        throw new Error(`node ${process.versions.node} too old; need >= 22.12`);
      }
      return `${process.versions.node} (${process.execPath})`;
    }),
  );

  checks.push(
    check("node-path pin", () => {
      if (!existsSync(p.nodePathFile)) return "not pinned (run `eminiar install`); using PATH node";
      const pinned = readFileSync(p.nodePathFile, "utf8").trim();
      accessSync(pinned, constants.X_OK);
      return pinned;
    }),
  );

  checks.push(
    check("data dir", () => {
      accessSync(p.home, constants.W_OK);
      return p.home;
    }),
  );

  checks.push(
    check("better-sqlite3 + FTS5", () => {
      const Database = require("better-sqlite3") as typeof import("better-sqlite3");
      const db = new Database(":memory:");
      try {
        const ver = (db.prepare("select sqlite_version() v").get() as { v: string }).v;
        db.exec("create virtual table t using fts5(x, tokenize='porter unicode61')");
        db.exec("create virtual table t2 using fts5(x, tokenize='trigram')");
        return `sqlite ${ver}, fts5 porter+trigram ok`;
      } finally {
        db.close();
      }
    }),
  );

  checks.push(
    check("sqlite-vec", () => {
      const Database = require("better-sqlite3") as typeof import("better-sqlite3");
      const vec = require("sqlite-vec") as { load: (db: unknown) => void };
      const db = new Database(":memory:");
      try {
        vec.load(db);
        const v = (db.prepare("select vec_version() v").get() as { v: string }).v;
        return `vec ${v}`;
      } finally {
        db.close();
      }
    }),
  );

  checks.push(
    check("embedding model", () => {
      const dir = paths().models;
      return existsSync(dir) ? `${dir} (downloaded lazily on first hybrid search)` : "not present";
    }),
  );

  return checks;
}

export function formatDoctor(checks: Check[]): string {
  const lines = checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
  const failed = checks.filter((c) => !c.ok).length;
  lines.push(failed === 0 ? "all checks passed" : `${failed} check(s) failed`);
  return lines.join("\n");
}
