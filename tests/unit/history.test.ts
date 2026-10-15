import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigSchema } from "../../src/config.js";
import type { ProjectContext } from "../../src/context.js";
import { reindexCode } from "../../src/graph/reindex.js";
import { bucketOf, classifyCommit, sizeOf } from "../../src/history/classify.js";
import { parseLog, renamePath } from "../../src/history/log.js";
import {
  buildHistory,
  commitsForFile,
  filterCommits,
  getHistory,
  originsForFile,
  readBriefSummary,
  readFileRisk,
  refreshHistorySummary,
  resolveCommit,
  riskyFiles,
} from "../../src/history/model.js";
import {
  branchOnlyCommits,
  renderBranch,
  renderCommit,
  renderFile,
  renderOverview,
  renderRisk,
} from "../../src/history/narrate.js";
import { search } from "../../src/search/pipeline.js";
import { SqliteAdapter } from "../../src/storage/sqlite/adapter.js";
import { emHistory } from "../../src/tools/em_history.js";

let root: string;
let ctx: ProjectContext;
let db: SqliteAdapter;
let git: (cmd: string, env?: Record<string, string>) => string;

const SERVICE_V1 = `export function parse(input: string) {
  const parts = input.split(",");
  return parts.map((p) => p.trim());
}
export function total(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0);
}
`;
// The "bug": a feature commit adds a lookup that forgets the empty case.
const SERVICE_V2 = `${SERVICE_V1}export function first(xs: string[]) {
  const head = xs[0];
  return head.toUpperCase();
}
`;
// The fix removes the faulty line and replaces it.
const SERVICE_V3 = SERVICE_V2.replace(
  "  return head.toUpperCase();\n",
  '  return head ? head.toUpperCase() : "";\n',
);

beforeAll(() => {
  process.env.EMINIAR_PLUGIN_ROOT = process.cwd();
  root = mkdtempSync(join(tmpdir(), "em-history-"));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "tests"));
  writeFileSync(join(root, "package.json"), '{"name":"demo"}');
  writeFileSync(join(root, "README.md"), "# demo\n");
  writeFileSync(join(root, "src/service.ts"), SERVICE_V1);
  writeFileSync(join(root, "src/util.ts"), "export const K = 1;\n");
  ctx = { root, id: "h", dbPath: join(root, "h.db"), config: ConfigSchema.parse({}) };
  db = new SqliteAdapter(ctx.dbPath);
  let clock = 1_700_000_000;
  git = (cmd, env = {}) => {
    clock += 86_400; // one commit per day so lead times are measurable
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
        ...env,
      },
    });
  };
  git("init -q -b main");
  git('add . && git commit -qm "initial commit"');
  writeFileSync(join(root, "src/service.ts"), SERVICE_V2);
  git('add . && git commit -qm "feat(service): add first() helper"');
  writeFileSync(join(root, "README.md"), "# demo\n\nMore words.\n");
  git('add . && git commit -qm "docs: expand readme"');
  writeFileSync(join(root, "src/service.ts"), SERVICE_V3);
  git('add . && git commit -qm "fix(service): first() crashed on empty input (#12)"');
  writeFileSync(join(root, "src/util.ts"), "export const K = 2;\n");
  git('add . && git commit -qm "bump K"', { GIT_AUTHOR_NAME: "ana", GIT_COMMITTER_NAME: "ana" });
  git("tag v0.1.0");
  // A feature branch with one commit, not merged.
  git("checkout -q -b feature/thing");
  writeFileSync(join(root, "src/thing.ts"), "export const thing = 1;\n");
  git('add . && git commit -qm "add thing module"');
  git("checkout -q main");
  // A revert on main.
  writeFileSync(join(root, "src/util.ts"), "export const K = 3;\n");
  git('add . && git commit -qm "refactor: tune K"');
  git("revert --no-edit HEAD");
}, 60_000);

afterAll(() => {
  db.close();
  delete process.env.EMINIAR_PLUGIN_ROOT;
});

describe("classifyCommit", () => {
  const none = { merge: false, files: [] };
  it("reads conventional commits", () => {
    const c = classifyCommit("feat(graph)!: add pattern walk", "", none);
    expect(c).toMatchObject({ kind: "feat", scope: "graph", breaking: true, conventional: true });
    expect(classifyCommit("fix: null deref (#42)", "", none)).toMatchObject({
      kind: "fix",
      issues: ["#42"],
      pr: 42,
    });
    expect(classifyCommit("docs: readme", "", none).kind).toBe("docs");
  });
  it("falls back to keywords and file lists", () => {
    expect(classifyCommit("Fix crash when input is empty", "", none).kind).toBe("fix");
    expect(classifyCommit("Add null check to fix crash", "", none).kind).toBe("fix");
    expect(classifyCommit("Rename helper and move into util", "", none).kind).toBe("refactor");
    expect(classifyCommit("Speed up hot path", "", none).kind).toBe("perf");
    expect(
      classifyCommit("tweak", "", {
        merge: false,
        files: [{ path: "docs/a.md", added: 1, deleted: 0, binary: false }],
      }).kind,
    ).toBe("docs");
    expect(
      classifyCommit("tweak", "", {
        merge: false,
        files: [{ path: "tests/a.test.ts", added: 1, deleted: 0, binary: false }],
      }).kind,
    ).toBe("test");
    expect(
      classifyCommit("Merge pull request #7 from x/y", "", { merge: true, files: [] }),
    ).toMatchObject({ kind: "merge", pr: 7 });
    expect(
      classifyCommit('Revert "tune K"', "This reverts commit abcdef1234567.", none),
    ).toMatchObject({
      kind: "revert",
      revertOf: "abcdef1234567",
    });
    expect(classifyCommit("WIP", "", none).kind).toBe("wip");
    expect(classifyCommit("Release 1.2.0", "", none).kind).toBe("release");
  });
  it("buckets and sizes", () => {
    expect(bucketOf("revert")).toBe("fix");
    expect(bucketOf("ci")).toBe("other");
    expect(sizeOf(5)).toBe("xs");
    expect(sizeOf(5000)).toBe("xl");
  });
});

describe("log parsing", () => {
  it("collapses rename notation", () => {
    expect(renamePath("src/{old => new}/a.ts")).toEqual({
      path: "src/new/a.ts",
      from: "src/old/a.ts",
    });
    expect(renamePath("a.ts => b.ts")).toEqual({ path: "b.ts", from: "a.ts" });
    expect(renamePath("plain.ts")).toEqual({ path: "plain.ts" });
  });
  it("parses the NUL/US/RS framed log with numstat", () => {
    const sample =
      "\u0000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\u001fbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\u001fdev\u001fd@x\u001f1700000000\u001fHEAD -> main, tag: v1\u001fsubject here\u001fbody line\nmore\u001e\n\n3\t1\tsrc/a.ts\n-\t-\timg.png\n";
    const [c] = parseLog(sample);
    expect(c?.sha.startsWith("aaaa")).toBe(true);
    expect(c?.parents).toHaveLength(1);
    expect(c?.refs).toEqual(["main", "tag: v1"]);
    expect(c?.body).toBe("body line\nmore");
    expect(c?.files).toEqual([
      { path: "src/a.ts", added: 3, deleted: 1, binary: false, renamedFrom: undefined },
      { path: "img.png", added: 0, deleted: 0, binary: true, renamedFrom: undefined },
    ]);
  });
});

describe("history model", () => {
  it("builds commits, branches, tags and traces the fix to the feature that caused it", async () => {
    await reindexCode(ctx, db);
    const m = buildHistory(ctx, db);
    expect(m).toBeDefined();
    if (!m) return;
    expect(m.stats.commits).toBe(8);
    expect(m.branch).toBe("main");
    expect(m.base).toBe("main");
    const fix = m.commits.find((c) => c.kind === "fix");
    const feat = m.commits.find((c) => c.subject.startsWith("feat(service)"));
    expect(fix && feat).toBeTruthy();
    // SZZ: the fix removed the line the feature wrote.
    expect(fix!.origins).toContain(feat!.sha);
    expect(feat!.blamedBy).toContain(fix!.sha);
    expect(feat!.riskReasons.join(" ")).toMatch(/later fix/);
    expect(m.links.some((l) => l.path === "src/service.ts" && l.origin === feat!.sha)).toBe(true);
    // The revert links to what it undid.
    const revert = m.commits.find((c) => c.kind === "revert");
    const tuned = m.commits.find((c) => c.subject === "refactor: tune K");
    expect(revert!.origins).toContain(tuned!.sha);
    expect(tuned!.revertedBy).toBe(revert!.sha);
    // Branches: feature/thing is ahead of main and unmerged; its commit is not on HEAD.
    const feature = m.branches.find((b) => b.name === "feature/thing");
    expect(feature).toMatchObject({ ahead: 1, merged: false, remote: false });
    const thing = m.commits.find((c) => c.subject === "add thing module");
    expect(thing?.onHead).toBe(false);
    expect(branchOnlyCommits(m, feature!).map((c) => c.sha)).toEqual([thing!.sha]);
    // Tags decorate the commit they point at.
    expect(m.tags[0]?.name).toBe("v0.1.0");
    expect(m.commits.find((c) => c.subject === "bump K")?.tags).toEqual(["v0.1.0"]);
    // File stats.
    const svc = m.files.get("src/service.ts");
    expect(svc).toMatchObject({ commits: 3, fixes: 1, bugOrigins: 1, quickFixes: 1 });
    expect(svc!.risk).toBeGreaterThan(0.2);
    expect(riskyFiles(m, { limit: 1 })[0]?.path).toBe("src/service.ts");
    expect(m.authors.map((a) => a.name)).toEqual(["dev", "ana"]);
    expect(m.weeks.length).toBeGreaterThan(0);
    expect(m.weeks.reduce((a, w) => a + w.total, 0)).toBe(8);
    expect(m.lessons.join("\n")).toMatch(/Bug-prone files/);
    expect(m.lessons.join("\n")).toMatch(/1 revert/);
  });

  it("caches per HEAD and persists the trace and a brief", () => {
    const a = getHistory(ctx, db);
    const b = getHistory(ctx, db);
    expect(a).toBe(b);
    const fix = a!.commits.find((c) => c.kind === "fix")!;
    expect(db.metaGet(`szz:${fix.sha}`)).toBeDefined();
    const brief = readBriefSummary(db);
    expect(brief?.commits).toBe(8);
    expect(brief?.risky).toContain("src/service.ts");
    // the per-file table the edit and commit hooks read instead of running git
    const service = readFileRisk(db)["src/service.ts"];
    expect(service?.fixes).toBeGreaterThan(0);
    expect(service?.lastFix).toMatch(/^[0-9a-f]{7,} /);
    // HEAD has not moved: the warm-up refresh is a no-op
    expect(refreshHistorySummary(ctx, db)).toBe(false);
  });

  it("indexes commit messages for search", async () => {
    const hits = await search(db, "crashed on empty input", { mode: "lexical", limit: 5 });
    expect(
      hits.hits.some(
        (h) =>
          h.chunk.document.source === "git" && h.chunk.document.title.includes("first() crashed"),
      ),
    ).toBe(true);
  });

  it("filters and resolves", () => {
    const m = getHistory(ctx, db)!;
    expect(filterCommits(m, { kinds: ["fix"] })).toHaveLength(1);
    expect(filterCommits(m, { author: "ana" })).toHaveLength(1);
    expect(filterCommits(m, { path: "src/util.ts" }).length).toBe(4);
    expect(filterCommits(m, { query: "readme" })).toHaveLength(1);
    expect(filterCommits(m, { risky: true }).map((c) => c.subject)).toContain(
      "feat(service): add first() helper",
    );
    expect(originsForFile(m, "src/service.ts").map((c) => c.kind)).toEqual(["feat"]);
    expect(originsForFile(m, "src/util.ts")).toEqual([]);
    expect(resolveCommit(m, "v0.1.0")?.subject).toBe("bump K");
    expect(resolveCommit(m, "feature/thing")?.subject).toBe("add thing module");
    expect(resolveCommit(m, m.commits[0]!.sha.slice(0, 6))?.sha).toBe(m.commits[0]!.sha);
    expect(commitsForFile(m, "./src/service.ts")).toHaveLength(3);
  });

  it("narrates", () => {
    const m = getHistory(ctx, db)!;
    const overview = renderOverview(m);
    expect(overview).toMatch(/8 commits/);
    expect(overview).toMatch(/bug-prone files/);
    expect(overview).toMatch(/feature\/thing/);
    const file = renderFile(m, db, "src/service.ts");
    expect(file).toMatch(/changes here that later needed fixing/);
    expect(file).toMatch(/fixed by/);
    const fix = m.commits.find((c) => c.kind === "fix")!;
    const commit = renderCommit(m, db, fix);
    expect(commit).toMatch(/likely cause of the bug/);
    expect(commit).toMatch(/feat\(service\)/);
    expect(commit).toMatch(/on branches: .*main/);
    const branch = renderBranch(m, "feature/thing");
    expect(branch).toMatch(/1 commit unique to the branch/);
    expect(branch).toMatch(/not merged into main/);
    const risk = renderRisk(m, ["src/service.ts", "src/new.ts"], "risk:");
    expect(risk).toMatch(/src\/new\.ts · no history/);
    expect(risk).toMatch(/fix-heavy history/);
  });

  it("answers through the tool", async () => {
    const r = await emHistory.handler({ action: "symbol", name_path: "first" }, ctx);
    expect(r.isError).toBeFalsy();
    expect(r.content[0]!.text).toMatch(/function first/);
    expect(r.content[0]!.text).toMatch(/fix\(service\)/);
    const risk = await emHistory.handler({ action: "risk", paths: ["src/service.ts"] }, ctx);
    expect(risk.content[0]!.text).toMatch(/risk 0\.\d\d/);
    const search = await emHistory.handler({ action: "search", query: "thing" }, ctx);
    expect(search.content[0]!.text).toMatch(/not on HEAD/);
    const missing = await emHistory.handler({ action: "commit", sha: "deadbeef" }, ctx);
    expect(missing.isError).toBe(true);
  });
});

describe("outside git", () => {
  it("returns undefined instead of throwing", () => {
    const plain = mkdtempSync(join(tmpdir(), "em-nogit-"));
    const c: ProjectContext = {
      root: plain,
      id: "n",
      dbPath: join(plain, "n.db"),
      config: ConfigSchema.parse({}),
    };
    const d = new SqliteAdapter(c.dbPath);
    expect(buildHistory(c, d)).toBeUndefined();
    d.close();
  });
});
