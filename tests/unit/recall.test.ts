import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getContext, resetContextCache } from "../../src/context.js";
import { handlers } from "../../src/hooks/index.js";
import type { HookInput, HookOutput } from "../../src/hooks/types.js";
import { indexContent } from "../../src/index/indexer.js";
import { write } from "../../src/memory/store.js";
import { renderProjectBrief } from "../../src/session/brief.js";
import {
  memoriesForFile,
  promptTerms,
  recallForText,
  requiredMatches,
} from "../../src/session/recall.js";
import { markServerAlive } from "../../src/session/server-alive.js";
import { closeAllStorage, getStorage } from "../../src/storage/index.js";

let root: string;
let unmark: () => void;
const base = (over: Partial<HookInput>): HookInput => ({
  session_id: "r1",
  cwd: root,
  hook_event_name: "x",
  ...over,
});
const ctxText = (out: HookOutput | undefined) => out?.hookSpecificOutput?.additionalContext ?? "";

function setConfig(over: Record<string, unknown>): void {
  writeFileSync(
    join(root, "eminiar.config.json"),
    JSON.stringify({ routing: { mode: "enforce", deferToContextMode: false }, ...over }),
  );
  resetContextCache();
}

beforeAll(() => {
  process.env.EMINIAR_HOME = mkdtempSync(join(tmpdir(), "em-home-"));
  root = mkdtempSync(join(tmpdir(), "em-recall-"));
  writeFileSync(join(root, "package.json"), "{}");
  mkdirSync(join(root, "src/storage"), { recursive: true });
  writeFileSync(join(root, "src/storage/pool.ts"), "export const pool = 1;\n");
  writeFileSync(join(root, "src/plain.ts"), "export const plain = 1;\n");
  setConfig({});
  unmark = markServerAlive(getContext(root));

  const ctx = getContext(root);
  const db = getStorage(ctx, { vectors: false });
  write(ctx, db, {
    name: "decision/sqlite-connection-pool",
    kind: "decision",
    content:
      "The SQLite connection pool is capped at one writer; WAL mode handles concurrent readers.",
    related: ["file:src/storage/pool.ts"],
  });
  write(ctx, db, {
    name: "constraint/no-pnpm",
    kind: "constraint",
    content: "Use npm, never pnpm: the lockfile and CI scripts assume npm.",
  });
  write(ctx, db, {
    name: "decision/old-pool-design",
    kind: "decision",
    status: "superseded",
    content: "The SQLite connection pool opened one connection per request.",
  });
  write(ctx, db, {
    name: "note/pool-symbol",
    kind: "note",
    content: "acquire() must release on every error path.",
    related: ["sym:src/storage/pool.ts#acquire"],
  });
  write(ctx, db, {
    name: "onboarding/structure",
    kind: "onboarding",
    content:
      "Layout:\nsrc/storage holds the SQLite connection pool and the concurrent writers queue.",
  });
  indexContent(db, {
    source: "docs:better-sqlite3",
    title: "better-sqlite3 › WAL mode",
    uri: "https://example.test/better-sqlite3/wal",
    content:
      "Enable WAL journal mode for concurrent readers: db.pragma('journal_mode = WAL'). A single writer connection avoids SQLITE_BUSY.",
    kind: "markdown",
  });
});
afterAll(() => {
  unmark();
  closeAllStorage();
  delete process.env.EMINIAR_HOME;
});

describe("prompt terms", () => {
  it("drops filler, stopwords, numbers and the slash command", () => {
    expect(promptTerms("/em-docs please can you fix the sqlite pool 42")).toEqual([
      "fix",
      "sqlite",
      "pool",
    ]);
    expect(requiredMatches(2)).toBe(2);
    expect(requiredMatches(8)).toBe(2);
    expect(requiredMatches(16)).toBe(3);
  });
});

describe("recallForText", () => {
  it("finds matching memories and doc pages, skipping superseded ones", async () => {
    const db = getStorage(getContext(root), { vectors: false });
    const r = await recallForText(
      db,
      "Should the SQLite connection pool allow concurrent writers?",
    );
    expect(r.text).toContain("memory decision/sqlite-connection-pool [decision]");
    expect(r.text).toContain("docs:better-sqlite3 › better-sqlite3 › WAL mode");
    expect(r.text).not.toContain("old-pool-design");
    // onboarding memories match everything; the session brief carries them instead
    expect(r.text).not.toContain("onboarding/structure");
    expect(r.keys).toContain("memory:decision/sqlite-connection-pool");
  });
  it("stays quiet for vague prompts and single shared words", async () => {
    const db = getStorage(getContext(root), { vectors: false });
    expect((await recallForText(db, "ok thanks")).text).toBe("");
    // "pool" alone is shared with the memories, nothing else is
    expect((await recallForText(db, "draw a swimming pool diagram for the garden")).text).toBe("");
  });
});

describe("UserPromptSubmit recall", () => {
  it("injects matches once per context window and again after a compaction", async () => {
    const prompt = "Change the sqlite connection pool to allow concurrent writers";
    const first = await handlers.UserPromptSubmit!(
      base({ hook_event_name: "UserPromptSubmit", prompt }),
    );
    expect(first?.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
    expect(ctxText(first)).toMatch(/^eminiar recall/);
    expect(ctxText(first)).toContain("decision/sqlite-connection-pool");

    const again = await handlers.UserPromptSubmit!(
      base({ hook_event_name: "UserPromptSubmit", prompt }),
    );
    expect(again).toBeUndefined();

    await handlers.SessionStart!(base({ hook_event_name: "SessionStart", source: "compact" }));
    const afterCompact = await handlers.UserPromptSubmit!(
      base({ hook_event_name: "UserPromptSubmit", prompt }),
    );
    expect(ctxText(afterCompact)).toContain("decision/sqlite-connection-pool");
  });
  it("can be switched off", async () => {
    setConfig({ recall: { onPrompt: false } });
    const out = await handlers.UserPromptSubmit!(
      base({
        session_id: "r-off",
        hook_event_name: "UserPromptSubmit",
        prompt: "Change the sqlite connection pool to allow concurrent writers",
      }),
    );
    expect(out).toBeUndefined();
    setConfig({});
  });
});

describe("file-linked memories", () => {
  it("lists memories naming the file or a symbol in it", () => {
    const db = getStorage(getContext(root), { vectors: false });
    const r = memoriesForFile(db, "src/storage/pool.ts");
    expect(r.text).toContain("decision/sqlite-connection-pool [decision]");
    expect(r.text).toContain("note/pool-symbol [note]");
    expect(memoriesForFile(db, "src/plain.ts").text).toBe("");
  });
  it("annotates an Edit once per window, without denying, even with routing off", async () => {
    const edit = (sid: string) =>
      handlers.PreToolUse!(
        base({
          session_id: sid,
          hook_event_name: "PreToolUse",
          tool_name: "Edit",
          tool_input: { file_path: join(root, "src/storage/pool.ts") },
        }),
      );
    const out = await edit("r-edit");
    expect(out?.hookSpecificOutput?.permissionDecision).toBeUndefined();
    expect(ctxText(out)).toContain("eminiar memory: src/storage/pool.ts is covered by");
    expect(await edit("r-edit")).toBeUndefined();

    setConfig({ routing: { mode: "off" } });
    expect(ctxText(await edit("r-edit-off"))).toContain("decision/sqlite-connection-pool");
    setConfig({});
  });
});

describe("subagent brief", () => {
  it("prefixes the recall rules and the memories matching the task", async () => {
    const out = await handlers.PreToolUse!(
      base({
        hook_event_name: "PreToolUse",
        tool_name: "Agent",
        tool_input: { prompt: "Investigate SQLITE_BUSY errors in the connection pool writer" },
      }),
    );
    const prompt = String(out?.hookSpecificOutput?.updatedInput?.prompt);
    expect(prompt).toMatch(/^Use the eminiar tools/);
    expect(prompt).toContain("em_recall {query}");
    expect(prompt).toContain("decision/sqlite-connection-pool");
    expect(prompt.endsWith("Investigate SQLITE_BUSY errors in the connection pool writer")).toBe(
      true,
    );
  });
});

describe("session brief", () => {
  it("lists constraints and drops lines in priority order, keeping the rules", () => {
    const ctx = getContext(root);
    const db = getStorage(ctx, { vectors: false });
    const full = renderProjectBrief(ctx, db, 5000);
    expect(full).toContain("Constraints & preferences: constraint/no-pnpm: Use npm, never pnpm");
    expect(full).toContain("Accepted decisions");
    // too small for both: the decisions go first, the constraints stay
    const tight = renderProjectBrief(ctx, db, 260);
    expect(tight).toContain("Constraints & preferences");
    expect(tight).not.toContain("Accepted decisions");
  });
  it("opens the session guidance with the recall-first workflow", async () => {
    const out = await handlers.SessionStart!(
      base({ session_id: "r-start", hook_event_name: "SessionStart", source: "startup" }),
    );
    expect(ctxText(out)).toMatch(/^Project knowledge \(check before deciding/);
  });
});
