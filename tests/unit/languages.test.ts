import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { overview } from "../../src/code/symbols.js";
import { ConfigSchema } from "../../src/config.js";
import type { ProjectContext } from "../../src/context.js";
import { resetGoCache, resolveGoPackage } from "../../src/graph/languages/go.js";
import { parsePython, resolvePython } from "../../src/graph/languages/python.js";
import { deadCode, impact, routes } from "../../src/graph/query.js";
import { reindexCode } from "../../src/graph/reindex.js";
import { parseFile } from "../../src/graph/treesitter.js";
import { SqliteAdapter } from "../../src/storage/sqlite/adapter.js";

let root: string;
let ctx: ProjectContext;
let db: SqliteAdapter;

const files: Record<string, string> = {
  // --- python package with a flask app ------------------------------------------
  "app/__init__.py": "",
  "app/models.py":
    "import os\nfrom dataclasses import dataclass\n\n@dataclass\nclass User:\n    name: str\n    limit = 10\n\n    def greet(self):\n        return self.name\n\n    def _hidden(self):\n        return os.getcwd()\n\nclass Admin(User):\n    def promote(self):\n        return self.greet()\n\ndef helper(x):\n    if x and x > 1 or x < 0:\n        return x\n    return 0\n\ndef unused_py():\n    return 1\n",
  "app/views.py":
    "from flask import Flask\nfrom .models import User, helper as h\nfrom app import models\n\napp = Flask(__name__)\n\n@app.get('/users')\ndef list_users():\n    u = User('a')\n    return h(1) + models.helper(2)\n\n@app.route('/admin', methods=['POST', 'DELETE'])\ndef admin():\n    return models.Admin('b').promote()\n",
  // --- go module with two packages -----------------------------------------------
  "go.mod": "module example.com/demo\n\ngo 1.22\n",
  "main.go":
    'package main\n\nimport (\n\t"net/http"\n\t"example.com/demo/store"\n)\n\nfunc main() {\n\ts := store.New()\n\thttp.HandleFunc("/items", listItems)\n\thttp.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) { s.Count() })\n\tserve()\n}\n\nfunc listItems(w http.ResponseWriter, r *http.Request) {\n\tst := store.Store{}\n\tif st.Count() > 0 && true {\n\t\tst.Add("x")\n\t}\n}\n',
  "server.go": "package main\n\nfunc serve() {}\n",
  "store/store.go":
    "package store\n\ntype Store struct {\n\titems []string\n}\n\nfunc New() *Store { return &Store{} }\n\nfunc (s *Store) Add(v string) { s.items = append(s.items, v); s.touch() }\n\nfunc (s *Store) Count() int { return len(s.items) }\n\nfunc unusedGo() {}\n",
  "store/extra.go":
    "package store\n\nfunc (s *Store) touch() {}\n\ntype Counter interface {\n\tCount() int\n}\n",
};

beforeAll(async () => {
  process.env.EMINIAR_PLUGIN_ROOT = process.cwd();
  root = mkdtempSync(join(tmpdir(), "em-lang-"));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(root, p, ".."), { recursive: true });
    writeFileSync(join(root, p), c);
  }
  writeFileSync(join(root, "package.json"), "{}");
  resetGoCache();
  ctx = { root, id: "l", dbPath: join(root, "l.db"), config: ConfigSchema.parse({}) };
  db = new SqliteAdapter(ctx.dbPath);
}, 60_000);

afterAll(() => {
  db.close();
  delete process.env.EMINIAR_PLUGIN_ROOT;
});

describe("python", () => {
  it("resolves relative, absolute and src-layout modules", () => {
    expect(resolvePython(root, "app/views.py", "models", 1)).toBe("app/models.py");
    expect(resolvePython(root, "app/views.py", "app.models", 0)).toBe("app/models.py");
    expect(resolvePython(root, "app/views.py", "app", 0)).toBe("app/__init__.py");
    expect(resolvePython(root, "app/views.py", "flask", 0)).toBeUndefined();
  });

  it("emits classes, methods, fields, heritage, calls, references and routes", async () => {
    const m = await parsePython(root, "app/models.py", files["app/models.py"]!);
    const kinds = Object.fromEntries(m.nodes.map((n) => [n.name, n.kind]));
    expect(kinds).toMatchObject({
      User: "class",
      "User.greet": "method",
      "User._hidden": "method",
      "User.limit": "field",
      Admin: "class",
      helper: "function",
    });
    expect(m.exports).toEqual(expect.arrayContaining(["User", "Admin", "helper"]));
    expect(m.exports).not.toContain("_hidden");
    const ex = m.edges.find((e) => e.kind === "extends");
    expect(ex).toMatchObject({ src: "sym:app/models.py#Admin", dst: "sym:app/models.py#User" });
    const calls = m.edges.filter((e) => e.kind === "calls").map((e) => `${e.src}→${e.dst}`);
    expect(calls).toContain("sym:app/models.py#Admin.promote→sym:app/models.py#Admin.greet");
    expect(calls).toContain("sym:app/models.py#User._hidden→pkg:os");
    expect(m.nodes.find((n) => n.name === "helper")?.meta).toMatchObject({ complexity: 4 });

    const v = await parseFile(root, "app/views.py", files["app/views.py"]!);
    const imports = v.edges.filter((e) => e.kind === "imports").map((e) => e.dst);
    expect(imports).toEqual(
      expect.arrayContaining(["pkg:flask", "file:app/models.py", "file:app/__init__.py"]),
    );
    const vcalls = v.edges.filter((e) => e.kind === "calls").map((e) => `${e.src}→${e.dst}`);
    expect(vcalls).toContain("sym:app/views.py#list_users→sym:app/models.py#helper"); // alias h
    expect(vcalls).toContain("sym:app/views.py#list_users→sym:app/models.py#User");
    expect(vcalls).toContain("sym:app/views.py#list_users→sym:app/models.py#helper"); // `from app import models` binds the module
    const r = v.nodes
      .filter((n) => n.kind === "route")
      .map((n) => n.name)
      .sort();
    expect(r).toEqual(["DELETE /admin", "GET /users", "POST /admin"]);
    expect(v.nodes.find((n) => n.kind === "route")?.meta).toMatchObject({ framework: "flask" });
    expect(v.edges.find((e) => e.kind === "handles" && e.dst === "route:GET /users")?.src).toBe(
      "sym:app/views.py#list_users",
    );
  });
});

describe("go", () => {
  it("resolves in-module import paths to package files", () => {
    expect(resolveGoPackage(root, "main.go", "example.com/demo/store")).toEqual([
      "store/extra.go",
      "store/store.go",
    ]);
    expect(resolveGoPackage(root, "main.go", "net/http")).toEqual([]);
  });

  it("emits functions, methods with receivers, structs, interfaces, calls and routes", async () => {
    const s = await parseFile(root, "store/store.go", files["store/store.go"]!);
    const kinds = Object.fromEntries(s.nodes.map((n) => [n.name, n.kind]));
    expect(kinds).toMatchObject({
      Store: "class",
      "Store.items": "field",
      New: "function",
      "Store.Add": "method",
      "Store.Count": "method",
      unusedGo: "function",
    });
    expect(s.exports).toEqual(expect.arrayContaining(["Store", "New", "Store.Add"]));
    expect(s.exports).not.toContain("unusedGo");
    const calls = s.edges.filter((e) => e.kind === "calls").map((e) => `${e.src}→${e.dst}`);
    // receiver call to a method defined in a sibling file: points here, the link pass moves it
    expect(calls).toContain("sym:store/store.go#Store.Add→sym:store/store.go#Store.touch");

    const m = await parseFile(root, "main.go", files["main.go"]!);
    const imports = m.edges.filter((e) => e.kind === "imports").map((e) => e.dst);
    expect(imports).toEqual(
      expect.arrayContaining(["pkg:net/http", "file:store/store.go", "file:store/extra.go"]),
    );
    const mcalls = m.edges.filter((e) => e.kind === "calls").map((e) => `${e.src}→${e.dst}`);
    expect(mcalls).toContain("sym:main.go#main→sym:store/extra.go#New"); // first file of the package; link pass fixes
    expect(mcalls).toContain("sym:main.go#listItems→sym:store/extra.go#Store.Count"); // via st := store.Store{}; the link pass moves it
    expect(mcalls).toContain("sym:main.go#main→sym:main.go#serve"); // sibling in package main
    expect(m.nodes.find((n) => n.name === "listItems")?.meta).toMatchObject({ complexity: 3 });
    const r = m.nodes
      .filter((n) => n.kind === "route")
      .map((n) => n.name)
      .sort();
    expect(r).toEqual(["ALL /health", "ALL /items"]);
    expect(m.edges.find((e) => e.kind === "handles" && e.dst === "route:ALL /items")?.src).toBe(
      "sym:main.go#listItems",
    );
    expect(m.edges.find((e) => e.kind === "handles" && e.dst === "route:ALL /health")?.src).toBe(
      "sym:main.go#main",
    );
  });
});

describe("mixed index", () => {
  it("indexes both languages, links same-package Go symbols and answers graph queries", async () => {
    const s = await reindexCode(ctx, db, { full: true });
    expect(s.parsed).toBe(7);
    expect(s.unsupported).toBe(0);
    expect(db.fileIndexGet("app/views.py")?.language).toBe("python");
    expect(db.fileIndexGet("main.go")?.language).toBe("go");
    // Go: sibling-file resolution through the link pass
    const add = db.graphEdgesFrom(["sym:store/store.go#Store.Add"], ["calls"]).map((e) => e.dst);
    expect(add).toContain("sym:store/extra.go#Store.touch");
    const main = db.graphEdgesFrom(["sym:main.go#main"], ["calls"]).map((e) => e.dst);
    expect(main).toContain("sym:store/store.go#New");
    expect(main).toContain("sym:server.go#serve"); // sibling file of package main
    expect(db.graphEdgesFrom(["sym:main.go#listItems"], ["calls"]).map((e) => e.dst)).toContain(
      "sym:store/store.go#Store.Count",
    );
    // Python: module attribute call demoted to the module file is fine; alias resolved directly
    expect(impact(db, "app/models.py#helper")!.hits.map((h) => h.id)).toContain(
      "file:app/views.py",
    );
    expect(overview(db, "store/store.go").map((n) => n.name)).toEqual([
      "Store",
      "Store.items",
      "New",
      "Store.Add",
      "Store.Count",
      "unusedGo",
    ]);
    const rs = routes(db).map((r) => `${r.method} ${r.path} ${r.framework}`);
    expect(rs).toEqual(
      expect.arrayContaining(["GET /users flask", "ALL /items net/http", "POST /admin flask"]),
    );
    const dead = deadCode(db).map((d) => d.node.name);
    expect(dead).toContain("unused_py");
    expect(dead).toContain("unusedGo");
    expect(dead).not.toContain("list_users");
    expect(dead).not.toContain("listItems");
  }, 60_000);
});
