import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigSchema } from "../../src/config.js";
import type { ProjectContext } from "../../src/context.js";
import { coupled, dependencies, hotspots, impact, neighbors, path } from "../../src/graph/query.js";
import { reindexCode, reindexGitSignals } from "../../src/graph/reindex.js";
import { resolveImport } from "../../src/graph/resolve.js";
import { parseFile } from "../../src/graph/treesitter.js";
import { SqliteAdapter } from "../../src/storage/sqlite/adapter.js";

let root: string;
let ctx: ProjectContext;
let db: SqliteAdapter;

const files: Record<string, string> = {
  "src/util.ts": `export function helper(x: number) { return x * 2; }\nexport const K = 1;\n`,
  "src/service.ts": `import { helper } from "./util.js";\nimport { Base } from "@/base";\nimport fg from "fast-glob";\nexport class Service extends Base {\n  run() { return helper(1) + this.inner(); }\n  private inner() { return fg.sync("x").length; }\n}\n`,
  "src/base.ts": `export class Base { setup() {} }\n`,
  "src/main.ts": `import { Service } from "./service.js";\nconst s = new Service();\ns.run();\n`,
  "tsconfig.json": `{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }`,
};

beforeAll(async () => {
  process.env.EMINIAR_PLUGIN_ROOT = process.cwd();
  root = mkdtempSync(join(tmpdir(), "em-graph-"));
  mkdirSync(join(root, "src"));
  for (const [p, c] of Object.entries(files)) writeFileSync(join(root, p), c);
  writeFileSync(join(root, "package.json"), "{}");
  ctx = { root, id: "g", dbPath: join(root, "g.db"), config: ConfigSchema.parse({}) };
  db = new SqliteAdapter(ctx.dbPath);
  const git = (cmd: string) =>
    execSync(`git ${cmd}`, {
      cwd: root,
      stdio: "pipe",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "dev",
        GIT_AUTHOR_EMAIL: "d@x",
        GIT_COMMITTER_NAME: "dev",
        GIT_COMMITTER_EMAIL: "d@x",
      },
    });
  git("init -q");
  git("add . && git commit -qm one");
  for (let i = 0; i < 3; i++) {
    writeFileSync(join(root, "src/service.ts"), `${files["src/service.ts"]}// ${i}\n`);
    writeFileSync(join(root, "src/util.ts"), `${files["src/util.ts"]}// ${i}\n`);
    git(`add . && git commit -qm change${i}`);
  }
}, 60_000);
afterAll(() => {
  db.close();
  delete process.env.EMINIAR_PLUGIN_ROOT;
});

describe("resolveImport", () => {
  it("resolves relative .js → .ts, tsconfig paths and bare packages", () => {
    expect(resolveImport(root, "src/service.ts", "./util.js")).toBe("src/util.ts");
    expect(resolveImport(root, "src/service.ts", "@/base")).toBe("src/base.ts");
    expect(resolveImport(root, "src/service.ts", "fast-glob")).toBeUndefined();
  });
});

describe("parseFile", () => {
  it("emits symbols, imports, calls and heritage", async () => {
    const p = await parseFile(root, "src/service.ts", files["src/service.ts"]!);
    const ids = p.nodes.map((n) => n.id);
    expect(ids).toContain("sym:src/service.ts#Service");
    expect(ids).toContain("sym:src/service.ts#Service.run");
    expect(p.exports).toContain("Service");
    const kinds = p.edges.map((e) => `${e.kind}:${e.dst}`);
    expect(kinds).toContain("imports:file:src/util.ts");
    expect(kinds).toContain("imports:pkg:fast-glob");
    expect(kinds).toContain("calls:sym:src/util.ts#helper");
    expect(kinds).toContain("calls:sym:src/service.ts#Service.inner");
    expect(kinds).toContain("extends:sym:src/base.ts#Base");
  });
});

describe("graph index + queries", () => {
  it("indexes incrementally and answers impact/dependencies/path/neighbors", async () => {
    const first = await reindexCode(ctx, db);
    expect(first.parsed).toBe(4);
    const again = await reindexCode(ctx, db);
    expect(again.parsed).toBe(0);
    expect(again.unchanged).toBe(4);

    const g = reindexGitSignals(ctx, db, true);
    expect(g.commits).toBe(4);

    const imp = impact(db, "src/util.ts")!;
    const paths = imp.hits.map((h) => h.id);
    expect(paths[0]).toBe("file:src/service.ts");
    expect(imp.hits[0]!.reasons.join(" ")).toMatch(/imports|calls/);
    expect(imp.hits[0]!.reasons.join(" ")).toMatch(/co-changed/);
    expect(paths).toContain("file:src/main.ts"); // 2 hops

    const deps = dependencies(db, "src/service.ts")!;
    expect(deps.hits.map((h) => h.id)).toEqual(
      expect.arrayContaining(["file:src/util.ts", "file:src/base.ts", "pkg:fast-glob"]),
    );

    const p = path(db, "src/main.ts", "src/util.ts")!;
    expect(p.length).toBeGreaterThanOrEqual(2);

    const n = neighbors(db, "src/service.ts#Service.run")!;
    expect(n.edges.some((e) => e.kind === "calls")).toBe(true);

    expect(hotspots(db)[0]!.path).toMatch(/service|util/);
    // initial commit + 3 paired changes
    expect(coupled(db)[0]).toMatchObject({ count: 4 });
  }, 60_000);

  it("re-parses only changed files and drops removed ones", async () => {
    writeFileSync(
      join(root, "src/util.ts"),
      `export function helper(x: number) { return x; }\nexport function extra() {}\n`,
    );
    const s = await reindexCode(ctx, db, { paths: ["src/util.ts", "src/gone.ts"] });
    expect(s.parsed).toBe(1);
    expect(db.graphGetNode("sym:src/util.ts#extra")).toBeDefined();
    expect(db.graphGetNode("sym:src/util.ts#K")).toBeUndefined();
    // git meta survives a tree-sitter re-parse of the file node
    expect(db.graphGetNode("file:src/util.ts")?.meta).toContain("commits");
  });
});
