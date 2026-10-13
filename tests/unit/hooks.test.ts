import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classifyPrompt, classifyToolCall } from "../../src/capture/classify.js";
import { getContext, resetContextCache } from "../../src/context.js";
import { handlers } from "../../src/hooks/index.js";
import { suggest } from "../../src/hooks/routing.js";
import type { HookInput } from "../../src/hooks/types.js";
import { renderWithin } from "../../src/session/guide.js";
import { closeAllStorage, getStorage } from "../../src/storage/index.js";

let root: string;
const base = (over: Partial<HookInput>): HookInput => ({
  session_id: "s1",
  cwd: root,
  hook_event_name: "x",
  ...over,
});

beforeAll(() => {
  process.env.EMINIAR_HOME = mkdtempSync(join(tmpdir(), "em-home-"));
  process.env.EMINIAR_ROUTING_MODE = "enforce";
  root = mkdtempSync(join(tmpdir(), "em-root-"));
  writeFileSync(join(root, "package.json"), "{}");
  // context-mode may be installed on the dev machine; the test wants hard routing regardless
  writeFileSync(
    join(root, "eminiar.config.json"),
    JSON.stringify({ routing: { mode: "enforce", deferToContextMode: false } }),
  );
  writeFileSync(join(root, "big.log"), "x".repeat(30 * 1024));
  resetContextCache();
});
afterAll(() => {
  closeAllStorage();
  delete process.env.EMINIAR_HOME;
  delete process.env.EMINIAR_ROUTING_MODE;
});

describe("classify", () => {
  it("extracts decisions, constraints and intent from prompts", () => {
    const cats = classifyPrompt("Let's go with better-sqlite3. We must never commit secrets.").map(
      (d) => d.category,
    );
    expect(cats).toContain("user_prompt");
    expect(cats).toContain("decision");
    expect(cats).toContain("constraint");
    expect(cats).toContain("intent");
  });
  it("classifies tool calls", () => {
    const edit = classifyToolCall({
      toolName: "Edit",
      toolInput: { file_path: `${root}/src/a.ts` },
      root,
    });
    expect(edit.find((d) => d.category === "files")?.payload.path).toBe("src/a.ts");
    const git = classifyToolCall({
      toolName: "Bash",
      toolInput: { command: "git commit -m x" },
      root,
    });
    expect(git.map((d) => d.category)).toContain("git");
    const slowFail = classifyToolCall({
      toolName: "Bash",
      toolInput: { command: "npm test" },
      toolResponse: { stdout: "", stderr: "boom", exit_code: 1 },
      durationMs: 9000,
      root,
    });
    expect(slowFail.map((d) => d.category)).toEqual(expect.arrayContaining(["latency", "error"]));
  });
});

describe("routing suggestions", () => {
  it("flags heavy bash, big reads, content grep, webfetch and agents; leaves tiny calls alone", () => {
    expect(suggest("Bash", { command: "git log --oneline -50" }, root)?.tool).toBe("em_execute");
    expect(suggest("Bash", { command: "ls -la | grep foo" }, root)?.tool).toBe("em_execute");
    expect(suggest("Bash", { command: "git status" }, root)).toBeUndefined();
    expect(suggest("Bash", { command: "pwd" }, root)).toBeUndefined();
    expect(suggest("Read", { file_path: "big.log" }, root)?.tool).toBe("em_execute_file");
    expect(suggest("Read", { file_path: "package.json" }, root)).toBeUndefined();
    expect(suggest("Grep", { pattern: "x", output_mode: "content" }, root)?.tool).toBe(
      "em_execute",
    );
    expect(suggest("Grep", { pattern: "x" }, root)).toBeUndefined();
    expect(suggest("WebFetch", { url: "https://x" }, root)?.tool).toBe("em_fetch_and_index");
    expect(suggest("Agent", { prompt: "p" }, root)?.prefixPrompt).toBeDefined();
  });
});

describe("hook handlers end to end", () => {
  it("records a session, routes in enforce mode, snapshots and replays a guide", async () => {
    const start = await handlers.SessionStart!(
      base({ hook_event_name: "SessionStart", source: "startup" }),
    );
    expect(start?.hookSpecificOutput?.additionalContext).toContain(
      "eminiar is active (routing: enforce)",
    );

    await handlers.UserPromptSubmit!(
      base({
        hook_event_name: "UserPromptSubmit",
        prompt: "Fix the flaky test; let's go with vitest",
      }),
    );
    await handlers.PostToolUse!(
      base({
        hook_event_name: "PostToolUse",
        tool_name: "Edit",
        tool_input: { file_path: `${root}/src/x.ts` },
        tool_response: {},
      }),
    );
    for (let i = 0; i < 3; i++) {
      await handlers.PostToolUse!(
        base({
          hook_event_name: "PostToolUse",
          tool_name: "Bash",
          tool_input: { command: "npm test" },
          tool_response: { exit_code: 1, stderr: "fail" },
        }),
      );
    }
    await handlers.Stop!(
      base({
        hook_event_name: "Stop",
        last_assistant_message: "Fixed the flaky test by awaiting the promise.",
      }),
    );

    const deny = await handlers.PreToolUse!(
      base({
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "git log" },
      }),
    );
    expect(deny?.hookSpecificOutput?.permissionDecision).toBe("deny");
    const agent = await handlers.PreToolUse!(
      base({ hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { prompt: "do x" } }),
    );
    expect(agent?.hookSpecificOutput?.updatedInput?.prompt).toMatch(/^Use the eminiar tools/);

    await handlers.PreCompact!(base({ hook_event_name: "PreCompact", trigger: "auto" }));
    const db = getStorage(getContext(root), { vectors: false });
    const snap = db.snapshotLatestUnconsumed("s1");
    expect(snap).toBeDefined();
    expect(snap!.bytes).toBeLessThanOrEqual(2048);
    expect(snap!.body).toMatch(/\*\*Files Modified\*\*: .*src\/x\.ts/);
    expect(snap!.body).toContain("**Loops**");
    expect(snap!.body).toContain("**Key Decisions**");

    const resume = await handlers.SessionStart!(
      base({ hook_event_name: "SessionStart", source: "compact" }),
    );
    expect(resume?.hookSpecificOutput?.additionalContext).toContain("## Session Guide (eminiar)");
    expect(db.snapshotLatestUnconsumed("s1")).toBeUndefined();
  });
});

describe("renderWithin", () => {
  it("drops low-priority sections and trims to the budget", () => {
    const sections = [
      { title: "Last Request", priority: 1, items: ["a".repeat(500)] },
      {
        title: "Files Modified",
        priority: 1,
        items: Array.from({ length: 50 }, (_, i) => `file${i}.ts`),
      },
      { title: "Intent", priority: 4, items: ["x".repeat(900)] },
      { title: "Slow Calls", priority: 3, items: ["y".repeat(900)] },
    ];
    const out = renderWithin(sections, 1024);
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(1024);
    expect(out).not.toContain("Intent");
    expect(out).toContain("Last Request");
  });
});
