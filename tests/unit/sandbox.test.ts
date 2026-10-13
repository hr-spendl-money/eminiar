import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigSchema } from "../../src/config.js";
import type { ProjectContext } from "../../src/context.js";
import { execute } from "../../src/sandbox/execute.js";
import { processOutput } from "../../src/sandbox/output.js";
import { runProcess } from "../../src/sandbox/run.js";
import { SqliteAdapter } from "../../src/storage/sqlite/adapter.js";

let ctx: ProjectContext;
let db: SqliteAdapter;
beforeAll(() => {
  const home = mkdtempSync(join(tmpdir(), "em-home-"));
  process.env.EMINIAR_HOME = home;
  const root = mkdtempSync(join(tmpdir(), "em-root-"));
  writeFileSync(join(root, "package.json"), "{}");
  ctx = { root, id: "test", dbPath: join(home, "t.db"), config: ConfigSchema.parse({}) };
  db = new SqliteAdapter(ctx.dbPath);
});
afterAll(() => {
  db.close();
  delete process.env.EMINIAR_HOME;
});

describe("runProcess", () => {
  it("captures stdout and exit code", async () => {
    const r = await runProcess(["sh", "-c", "echo hi; exit 3"], {
      cwd: ctx.root,
      env: { PATH: process.env.PATH ?? "" },
      timeoutMs: 5000,
      maxOutputBytes: 1024,
    });
    expect(r.stdout).toBe("hi\n");
    expect(r.exitCode).toBe(3);
  });
  it("times out and truncates", async () => {
    const t = await runProcess(["sh", "-c", "sleep 5"], {
      cwd: ctx.root,
      env: { PATH: process.env.PATH ?? "" },
      timeoutMs: 200,
      maxOutputBytes: 1024,
    });
    expect(t.timedOut).toBe(true);
    const big = await runProcess(["sh", "-c", "yes | head -c 100000"], {
      cwd: ctx.root,
      env: { PATH: process.env.PATH ?? "" },
      timeoutMs: 5000,
      maxOutputBytes: 2048,
    });
    expect(big.truncated).toBe(true);
    expect(big.stdout.length).toBeLessThanOrEqual(2048);
  });
});

describe("execute", () => {
  it("runs shell, javascript and typescript in the project root", async () => {
    const sh = await execute(ctx, { language: "shell", code: "pwd; echo $EMINIAR_PROJECT_ROOT" });
    expect(sh.stdout.split("\n")[0]).toContain(ctx.root.split("/").pop());
    const js = await execute(ctx, { language: "javascript", code: "console.log(1+1)" });
    expect(js.stdout.trim()).toBe("2");
    const ts = await execute(ctx, {
      language: "typescript",
      code: "const x: number = 40; console.log(x + 2)",
    });
    expect(ts.stdout.trim()).toBe("42");
  }, 30_000);

  it("refuses denied shell commands and unknown languages", async () => {
    const denied = {
      ...ctx,
      config: ConfigSchema.parse({ permissions: { extraDeny: ["Bash(sudo *)"] } }),
    };
    await expect(execute(denied, { language: "shell", code: "ls; sudo ls" })).rejects.toThrow(
      /sudo/,
    );
    await expect(execute(ctx, { language: "cobol", code: "x" })).rejects.toThrow(
      /unknown language/,
    );
  });
});

describe("processOutput", () => {
  it("returns small outputs verbatim and indexes large ones by intent", async () => {
    const small = await processOutput(db, ctx, { stdout: "ok", title: "t", source: "exec" });
    expect(small.text).toBe("ok");
    expect(small.documentId).toBeUndefined();

    const big = Array.from({ length: 400 }, (_, i) =>
      i === 250 ? "ERROR: connection refused to postgres" : `line ${i} routine output noise`,
    ).join("\n");
    const r = await processOutput(db, ctx, {
      stdout: big,
      title: "logs",
      source: "exec",
      intent: "connection refused error",
    });
    expect(r.documentId).toBeDefined();
    expect(r.text).toContain("connection refused");
    expect(r.text).toContain("searchable terms");
    expect(r.text.length).toBeLessThan(big.length / 2);

    const noIntent = await processOutput(db, ctx, { stdout: big, title: "logs2", source: "exec" });
    expect(noIntent.text).toContain("chars omitted");
  });
});
