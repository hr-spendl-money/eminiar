import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigSchema } from "../../src/config.js";
import type { ProjectContext } from "../../src/context.js";
import { branchLineage, mergedBranchName } from "../../src/history/lineage.js";
import { buildHistory, type HistoryModel } from "../../src/history/model.js";
import { write } from "../../src/memory/store.js";
import { SqliteAdapter } from "../../src/storage/sqlite/adapter.js";
import { buildHistoryGraph } from "../../src/ui/history-graph-api.js";
import {
  historyColorOf,
  historyEdgeStyleOf,
  historyLabelOf,
  historyShapeOf,
} from "../../src/ui/web/history/graph-style.js";

let root: string;
let ctx: ProjectContext;
let db: SqliteAdapter;
let m: HistoryModel;

beforeAll(() => {
  process.env.EMINIAR_PLUGIN_ROOT = process.cwd();
  root = mkdtempSync(join(tmpdir(), "em-hgraph-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "package.json"), '{"name":"demo"}');
  writeFileSync(join(root, "package-lock.json"), "{}");
  writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
  ctx = { root, id: "hg", dbPath: join(root, "hg.db"), config: ConfigSchema.parse({}) };
  db = new SqliteAdapter(ctx.dbPath);
  let clock = 1_700_000_000;
  const git = (cmd: string) => {
    clock += 86_400;
    return execSync(`git ${cmd}`, {
      cwd: root,
      stdio: "pipe",
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "dev",
        GIT_AUTHOR_EMAIL: "d@x",
        GIT_COMMITTER_NAME: "dev",
        GIT_COMMITTER_EMAIL: "d@x",
        GIT_AUTHOR_DATE: `${clock} +0000`,
        GIT_COMMITTER_DATE: `${clock} +0000`,
      },
    });
  };
  git("init -q -b main");
  git('add . && git commit -qm "initial commit"');

  // A feature branch merged through a PR merge commit, then deleted.
  git("checkout -q -b feature/widgets");
  writeFileSync(join(root, "src/widget.ts"), "export const w = 1;\n");
  writeFileSync(join(root, "package-lock.json"), '{"v":2}');
  git('add . && git commit -qm "feat: add widgets"');
  write(ctx, db, {
    name: "decision/widgets",
    kind: "decision",
    content: "Widgets live in src/widget.ts.",
    related: ["file:src/widget.ts"],
  });
  git('add . && git commit -qm "docs: record the widget decision"');
  git("checkout -q main");
  writeFileSync(join(root, "src/a.ts"), "export const a = 2;\n");
  git('add . && git commit -qm "chore: tweak a"');
  git('merge -q --no-ff feature/widgets -m "Merge pull request #5 from me/feature/widgets"');
  git("branch -q -D feature/widgets");

  // A live branch that is not merged.
  git("checkout -q -b fix/a");
  writeFileSync(join(root, "src/a.ts"), "export const a = 3;\n");
  git('add . && git commit -qm "fix: a was wrong"');
  git("checkout -q main");

  // A doc source that documents src/widget.ts.
  db.graphUpsertNodes([
    { id: "doc:widgets-guide", kind: "doc", name: "widgets-guide", source: "curated" },
  ]);
  db.graphUpsertEdges([
    { src: "doc:widgets-guide", dst: "file:src/widget.ts", kind: "documents", source: "curated" },
  ]);
  m = buildHistory(ctx, db, { trace: false })!;
}, 60_000);

afterAll(() => {
  db.close();
  delete process.env.EMINIAR_PLUGIN_ROOT;
});

describe("mergedBranchName", () => {
  it("reads PR and plain merge subjects", () => {
    expect(mergedBranchName("Merge pull request #23 from rydn/feature/knowledge-galaxy")).toEqual({
      name: "feature/knowledge-galaxy",
      pr: 23,
    });
    expect(mergedBranchName("Merge branch 'fix/x' into main")).toEqual({ name: "fix/x" });
    expect(mergedBranchName("Merge remote-tracking branch 'origin/y'")).toEqual({ name: "y" });
    expect(mergedBranchName("feat: merge two lists")).toBeUndefined();
  });
});

describe("branchLineage", () => {
  it("recovers deleted merged branches, live branches and direct commits", () => {
    const { defaultName, branches, ownerOf } = branchLineage(m);
    expect(defaultName).toBe("main");
    const by = new Map(branches.map((b) => [b.name, b]));
    const widgets = by.get("feature/widgets")!;
    expect(widgets).toMatchObject({ merged: true, live: false, prs: [5] });
    expect(widgets.commits.map((s) => m.bySha.get(s)!.subject)).toEqual([
      "docs: record the widget decision",
      "feat: add widgets",
    ]);
    expect(by.get("fix/a")).toMatchObject({ live: true, merged: false });
    expect(by.get("fix/a")!.commits).toHaveLength(1);
    // main owns its direct commits but neither the merge nor the branch's commits.
    const main = by.get("main")!.commits.map((s) => m.bySha.get(s)!.subject);
    expect(main).toEqual(["chore: tweak a", "initial commit"]);
    expect(ownerOf.get(widgets.commits[0]!)).toEqual(["feature/widgets"]);
  });
});

describe("history graph payload", () => {
  const kinds = (p: { edges: Array<{ kind: string }> }) => new Set(p.edges.map((e) => e.kind));

  it("links branches, commits, files, memories and docs", () => {
    const p = buildHistoryGraph(ctx, db, m);
    const ids = new Set(p.nodes.map((n) => n.id));
    expect(ids.has("branch:feature/widgets")).toBe(true);
    expect(ids.has("branch:fix/a")).toBe(true);
    expect(ids.has("branch:main")).toBe(true);
    expect(ids.has("file:src/widget.ts")).toBe(true);
    // Lockfiles never become nodes; memory files show as memories, not files.
    expect(ids.has("file:package-lock.json")).toBe(false);
    expect([...ids].some((id) => id.startsWith("file:.eminiar/"))).toBe(false);
    expect(kinds(p)).toEqual(
      new Set(["contains", "merged_into", "touches", "records", "mentions", "documents"]),
    );
    expect(p.edges).toContainEqual(
      expect.objectContaining({
        src: "branch:feature/widgets",
        dst: "branch:main",
        kind: "merged_into",
      }),
    );
    expect(p.edges).toContainEqual(
      expect.objectContaining({
        src: "memory:decision/widgets",
        dst: "file:src/widget.ts",
        kind: "mentions",
      }),
    );
    expect(p.edges).toContainEqual(
      expect.objectContaining({
        src: "doc:widgets-guide",
        dst: "file:src/widget.ts",
        kind: "documents",
      }),
    );
    const rec = p.edges.find((e) => e.kind === "records")!;
    expect(p.nodes.find((n) => n.id === rec.src)!.label).toBe("docs: record the widget decision");
    expect(p.branches.map((b) => b.name)[0]).toBe("main");
  });

  it("focuses a file: only that file, the commits touching it and their branches", () => {
    const p = buildHistoryGraph(ctx, db, m, { focus: "file:src/a.ts" });
    expect(p.focus).toBe("file:src/a.ts");
    const files = p.nodes.filter((n) => n.kind === "file").map((n) => n.id);
    expect(files).toEqual(["file:src/a.ts"]);
    const commits = p.nodes.filter((n) => n.kind === "commit").map((n) => n.label);
    expect(commits.sort()).toEqual(["chore: tweak a", "fix: a was wrong", "initial commit"]);
    const branches = p.nodes.filter((n) => n.kind === "branch").map((n) => n.label);
    expect(branches.sort()).toEqual(["fix/a", "main"]);
    expect(p.nodes.find((n) => n.root)?.id).toBe("file:src/a.ts");
  });

  it("focuses a memory through the files it relates to and the commit that wrote it", () => {
    const p = buildHistoryGraph(ctx, db, m, { focus: "memory:decision/widgets" });
    const ids = new Set(p.nodes.map((n) => n.id));
    expect(ids.has("memory:decision/widgets")).toBe(true);
    expect(ids.has("file:src/widget.ts")).toBe(true);
    expect(ids.has("file:src/a.ts")).toBe(false);
    expect(ids.has("branch:feature/widgets")).toBe(true);
    expect(kinds(p).has("records")).toBe(true);
  });

  it("focuses a branch, a commit and a doc", () => {
    const b = buildHistoryGraph(ctx, db, m, { focus: "branch:feature/widgets" });
    expect(b.nodes.filter((n) => n.kind === "commit")).toHaveLength(2);
    expect(b.nodes.find((n) => n.root)?.id).toBe("branch:feature/widgets");

    const sha = m.commits.find((c) => c.subject === "fix: a was wrong")!.short;
    const c = buildHistoryGraph(ctx, db, m, { focus: `commit:${sha}` });
    expect(c.focus).toMatch(/^commit:[0-9a-f]{40}$/);
    expect(c.nodes.map((n) => n.id)).toContain("branch:fix/a");

    const d = buildHistoryGraph(ctx, db, m, { focus: "doc:widgets-guide" });
    expect(d.nodes.find((n) => n.root)?.id).toBe("doc:widgets-guide");
    expect(d.nodes.some((n) => n.label === "feat: add widgets")).toBe(true);
  });

  it("keeps the focus on screen when nothing matches", () => {
    const p = buildHistoryGraph(ctx, db, m, { focus: "file:src/nowhere.ts" });
    expect(p.nodes).toHaveLength(1);
    expect(p.nodes[0]).toMatchObject({ id: "file:src/nowhere.ts", root: true, missing: true });
  });
});

describe("history graph style", () => {
  it("shapes by kind and colours commits by kind bucket", () => {
    expect(historyShapeOf({ kind: "branch" })).toBe("hexagon");
    expect(historyShapeOf({ kind: "commit" })).toBe("triangle");
    expect(historyShapeOf({ kind: "file" })).toBe("circle");
    expect(historyShapeOf({ kind: "file", missing: true } as { kind: string })).toBe("ring");
    expect(historyColorOf({ kind: "commit", bucket: "fix" } as { kind: string })).toBe("#e11d48");
    expect(historyEdgeStyleOf("fixes").directed).toBe(true);
    expect(historyEdgeStyleOf("mentions").color).toBe("#2563eb");
    expect(historyLabelOf({ kind: "file", label: "src/ui/a.ts" })).toBe("a.ts");
    expect(historyLabelOf({ kind: "commit", label: "x".repeat(50) })).toHaveLength(32);
  });
});
