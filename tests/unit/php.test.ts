import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { overview } from "../../src/code/symbols.js";
import { ConfigSchema } from "../../src/config.js";
import type { ProjectContext } from "../../src/context.js";
import { resetPhpCache, resolvePhpClass } from "../../src/graph/languages/php.js";
import { deadCode, impact, routes } from "../../src/graph/query.js";
import { reindexCode } from "../../src/graph/reindex.js";
import { parseFile } from "../../src/graph/treesitter.js";
import { SqliteAdapter } from "../../src/storage/sqlite/adapter.js";

let root: string;
let ctx: ProjectContext;
let db: SqliteAdapter;

const files: Record<string, string> = {
  // --- a Laravel-shaped app autoloaded through composer.json PSR-4 ---------------
  "composer.json": JSON.stringify({
    autoload: { "psr-4": { "App\\": "app/" } },
    "autoload-dev": { "psr-4": { "Tests\\": "tests/" } },
  }),
  "app/Models/User.php": [
    "<?php",
    "",
    "namespace App\\Models;",
    "",
    "use App\\Concerns\\Notifiable;",
    "use Illuminate\\Database\\Eloquent\\Model;",
    "",
    "class User extends Model implements HasName",
    "{",
    "    use Notifiable;",
    "",
    "    public const ROLE = 'user';",
    "    protected array $fillable = ['name'];",
    "",
    "    public function greet(): string",
    "    {",
    "        return 'hi ' . $this->name();",
    "    }",
    "",
    "    public function name(): string",
    "    {",
    "        return $this->fillable[0] ?? '';",
    "    }",
    "",
    "    public function unusedPhp(): void {}",
    "}",
    "",
  ].join("\n"),
  "app/Models/HasName.php":
    "<?php\nnamespace App\\Models;\n\ninterface HasName\n{\n    public function name(): string;\n}\n",
  "app/Concerns/Notifiable.php":
    "<?php\nnamespace App\\Concerns;\n\ntrait Notifiable\n{\n    public function notify(): void {}\n}\n",
  "app/Services/Mailer.php": [
    "<?php",
    "namespace App\\Services;",
    "",
    "use App\\Models\\User;",
    "",
    "final class Mailer",
    "{",
    "    public function send(User $user): bool",
    "    {",
    "        if ($user->greet() && strlen($user->name()) > 0 || false) {",
    "            return true;",
    "        }",
    "        return false;",
    "    }",
    "}",
    "",
  ].join("\n"),
  "app/Http/Controllers/Controller.php":
    "<?php\nnamespace App\\Http\\Controllers;\n\nabstract class Controller\n{\n    protected function authorize(): void {}\n}\n",
  "app/Http/Controllers/UserController.php": [
    "<?php",
    "",
    "namespace App\\Http\\Controllers;",
    "",
    "use App\\Models\\User;",
    "use App\\Services\\Mailer;",
    "",
    "class UserController extends Controller",
    "{",
    "    public function __construct(private Mailer $mailer) {}",
    "",
    "    public function index()",
    "    {",
    "        return User::all();",
    "    }",
    "",
    "    public function show(int $id)",
    "    {",
    "        parent::authorize();",
    "        $user = new User();",
    "        $this->mailer->send($user);",
    "        return $user->greet();",
    "    }",
    "",
    "    public function store()",
    "    {",
    "        return $this->index();",
    "    }",
    "}",
    "",
  ].join("\n"),
  "app/helpers.php": [
    "<?php",
    "",
    "const APP_NAME = 'demo';",
    "define('APP_DEBUG', false);",
    "",
    "if (!function_exists('greet_all')) {",
    "    function greet_all(array $users): array",
    "    {",
    "        return array_map(fn ($u) => $u->greet(), $users);",
    "    }",
    "}",
    "",
  ].join("\n"),
  "routes/web.php": [
    "<?php",
    "",
    "use App\\Http\\Controllers\\UserController;",
    "use Illuminate\\Support\\Facades\\Route;",
    "",
    "require __DIR__ . '/../app/helpers.php';",
    "",
    "Route::get('/users', [UserController::class, 'index']);",
    "Route::get('users/{id}', [UserController::class, 'show'])->name('users.show');",
    "Route::post('/users', 'UserController@store');",
    "",
  ].join("\n"),
};

beforeAll(async () => {
  process.env.EMINIAR_PLUGIN_ROOT = process.cwd();
  root = mkdtempSync(join(tmpdir(), "em-php-"));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(root, p, ".."), { recursive: true });
    writeFileSync(join(root, p), c);
  }
  writeFileSync(join(root, "package.json"), "{}");
  resetPhpCache();
  ctx = { root, id: "p", dbPath: join(root, "p.db"), config: ConfigSchema.parse({}) };
  db = new SqliteAdapter(ctx.dbPath);
}, 60_000);

afterAll(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
  delete process.env.EMINIAR_PLUGIN_ROOT;
});

describe("php", () => {
  it("resolves namespaces to files through composer PSR-4", () => {
    expect(resolvePhpClass(root, "routes/web.php", "App\\Models\\User")).toBe(
      "app/Models/User.php",
    );
    expect(resolvePhpClass(root, "routes/web.php", "\\App\\Http\\Controllers\\Controller")).toBe(
      "app/Http/Controllers/Controller.php",
    );
    expect(resolvePhpClass(root, "routes/web.php", "App\\Models\\Missing")).toBeUndefined();
    expect(resolvePhpClass(root, "routes/web.php", "Illuminate\\Support\\Str")).toBeUndefined();
  });

  it("emits namespaces, classes, members, heritage, imports and calls", async () => {
    const m = await parseFile(root, "app/Models/User.php", files["app/Models/User.php"]!);
    const kinds = Object.fromEntries(m.nodes.map((n) => [n.name, n.kind]));
    expect(kinds).toMatchObject({
      "App\\Models": "namespace",
      User: "class",
      "User.ROLE": "field",
      "User.fillable": "field",
      "User.greet": "method",
      "User.name": "method",
    });
    expect(m.exports).toEqual(expect.arrayContaining(["User", "User.greet", "User.ROLE"]));
    expect(m.exports).not.toContain("User.fillable"); // protected
    const heritage = m.edges
      .filter((e) => e.kind === "extends" || e.kind === "implements")
      .map((e) => `${e.kind} ${e.dst}`);
    expect(heritage).toEqual(
      expect.arrayContaining([
        "extends pkg:Illuminate",
        "implements sym:app/Models/HasName.php#HasName", // same namespace, no `use`
        "extends sym:app/Concerns/Notifiable.php#Notifiable", // trait use
      ]),
    );
    const imports = m.edges.filter((e) => e.kind === "imports").map((e) => e.dst);
    expect(imports).toEqual(["file:app/Concerns/Notifiable.php", "pkg:Illuminate"]);
    const calls = m.edges.filter((e) => e.kind === "calls").map((e) => `${e.src}→${e.dst}`);
    expect(calls).toContain("sym:app/Models/User.php#User.greet→sym:app/Models/User.php#User.name");

    const s = await parseFile(root, "app/Services/Mailer.php", files["app/Services/Mailer.php"]!);
    const scalls = s.edges.filter((e) => e.kind === "calls").map((e) => `${e.src}→${e.dst}`);
    // typed parameter: `$user->greet()` resolves through `User $user`
    expect(scalls).toContain(
      "sym:app/Services/Mailer.php#Mailer.send→sym:app/Models/User.php#User.greet",
    );
    expect(s.nodes.find((n) => n.name === "Mailer.send")?.meta).toMatchObject({ complexity: 4 });
    expect(s.edges.find((e) => e.kind === "references")?.dst).toBe("sym:app/Models/User.php#User");

    const c = await parseFile(
      root,
      "app/Http/Controllers/UserController.php",
      files["app/Http/Controllers/UserController.php"]!,
    );
    const ccalls = c.edges.filter((e) => e.kind === "calls").map((e) => `${e.src}→${e.dst}`);
    const ctl = "sym:app/Http/Controllers/UserController.php#UserController";
    expect(ccalls).toEqual(
      expect.arrayContaining([
        `${ctl}.index→sym:app/Models/User.php#User.all`, // static call
        `${ctl}.show→sym:app/Models/User.php#User`, // new
        `${ctl}.show→sym:app/Models/User.php#User.greet`, // $user = new User()
        `${ctl}.show→sym:app/Services/Mailer.php#Mailer.send`, // promoted, typed property
        `${ctl}.show→sym:app/Http/Controllers/Controller.php#Controller.authorize`, // parent::
        `${ctl}.store→${ctl}.index`, // $this->
      ]),
    );
    expect(c.nodes.find((n) => n.name === "UserController.mailer")?.kind).toBe("field");
  });

  it("collects functions and constants, conditional helpers and require/include", async () => {
    const h = await parseFile(root, "app/helpers.php", files["app/helpers.php"]!);
    const kinds = Object.fromEntries(h.nodes.map((n) => [n.name, n.kind]));
    expect(kinds).toMatchObject({
      APP_NAME: "variable",
      APP_DEBUG: "variable",
      greet_all: "function",
    });
    const r = await parseFile(root, "routes/web.php", files["routes/web.php"]!);
    const imports = r.edges.filter((e) => e.kind === "imports").map((e) => e.dst);
    expect(imports).toEqual(
      expect.arrayContaining([
        "file:app/Http/Controllers/UserController.php",
        "pkg:Illuminate",
        "file:app/helpers.php",
      ]),
    );
    const names = r.nodes
      .filter((n) => n.kind === "route")
      .map((n) => n.name)
      .sort();
    expect(names).toEqual(["GET /users", "GET /users/:id", "POST /users"]);
    const handler = (route: string) =>
      r.edges.filter((e) => e.kind === "handles" && e.dst === route).map((e) => e.src);
    const ctl = "sym:app/Http/Controllers/UserController.php#UserController";
    expect(handler("route:GET /users/:id")).toEqual([`${ctl}.show`]);
    // string controller reference: resolved against App\Http\Controllers
    expect(handler("route:POST /users")).toEqual([`${ctl}.store`]);
  });
});

describe("php index", () => {
  it("indexes PHP files and answers graph queries across them", async () => {
    const s = await reindexCode(ctx, db, { full: true });
    expect(s.parsed).toBe(8);
    expect(db.fileIndexGet("app/Models/User.php")?.language).toBe("php");
    expect(overview(db, "app/Models/User.php").map((n) => n.name)).toEqual([
      "App\\Models",
      "User",
      "User.ROLE",
      "User.fillable",
      "User.greet",
      "User.name",
      "User.unusedPhp",
    ]);
    // the model's impact reaches the controller, the mailer and (through the controller) the routes file
    const hits = impact(db, "app/Models/User.php#User")!.hits.map((h) => h.id);
    expect(hits).toEqual(
      expect.arrayContaining([
        "file:app/Services/Mailer.php",
        "file:app/Http/Controllers/UserController.php",
      ]),
    );
    const rs = routes(db).map((r) => `${r.method} ${r.path} ${r.framework}`);
    expect(rs).toEqual(
      expect.arrayContaining([
        "GET /users laravel",
        "GET /users/:id laravel",
        "POST /users laravel",
      ]),
    );
    const dead = deadCode(db).map((d) => d.node.name);
    expect(dead).toContain("User.unusedPhp");
    expect(dead).not.toContain("UserController.show"); // a route handler
    expect(dead).not.toContain("User.greet");
  }, 60_000);

  it("keeps route handlers owned by the routes file when a controller is re-parsed", async () => {
    const ctlFile = "app/Http/Controllers/UserController.php";
    const show = `sym:${ctlFile}#UserController.show`;
    writeFileSync(join(root, ctlFile), `${files[ctlFile]}\n// touched\n`);
    await reindexCode(ctx, db, { paths: [ctlFile] });
    expect(db.graphEdgesFrom([show], ["handles"]).map((e) => e.dst)).toEqual([
      "route:GET /users/:id",
    ]);
    // re-parsing the routes file without the route drops its edge
    const web = files["routes/web.php"]!.replace(/^Route::get\('users.*$/m, "");
    writeFileSync(join(root, "routes/web.php"), web);
    await reindexCode(ctx, db, { paths: ["routes/web.php"] });
    expect(db.graphEdgesFrom([show], ["handles"])).toEqual([]);
  }, 60_000);
});

describe("php composer autoload, namespace blocks and inheritance", () => {
  let legacyRoot: string;
  let legacyDb: SqliteAdapter;
  const legacy: Record<string, string> = {
    "composer.json": JSON.stringify({
      require: { php: "^8.1", "laravel/lumen-framework": "^10.0" },
      autoload: {
        "psr-0": { Legacy_: "lib/" },
        classmap: ["database/seeds", "src"],
        files: ["src/helpers.php"],
      },
    }),
    "lib/Legacy/Mailer.php": "<?php\nclass Legacy_Mailer\n{\n    public function send() {}\n}\n",
    "database/seeds/UserSeeder.php":
      "<?php\n\nfinal class UserSeeder\n{\n    public function run() {}\n}\n",
    "src/helpers.php": "<?php\n\nfunction format_money($v)\n{\n    return $v;\n}\n",
    "src/Base.php": [
      "<?php",
      "trait Audits",
      "{",
      "    public function audit() {}",
      "}",
      "",
      "class Base",
      "{",
      "    public function save() {}",
      "}",
      "",
    ].join("\n"),
    "src/Report.php": [
      "<?php",
      "class Report extends Base",
      "{",
      "    use Audits;",
      "",
      "    public function render()",
      "    {",
      "        $this->save();",
      "        $this->audit();",
      "        return format_money(1);",
      "    }",
      "}",
      "",
    ].join("\n"),
    "src/blocks.php": [
      "<?php",
      "namespace A {",
      "    use Lib\\Thing;",
      "    class X { public function f() { return new Thing(); } }",
      "}",
      "namespace B {",
      "    class Thing {}",
      "    class Y { public function g() { return new Thing(); } }",
      "}",
      "",
    ].join("\n"),
    "routes/web.php": "<?php\n$router->get('/ping', 'PingController@ping');\n",
  };

  beforeAll(() => {
    legacyRoot = mkdtempSync(join(tmpdir(), "em-php-legacy-"));
    for (const [p, c] of Object.entries(legacy)) {
      mkdirSync(join(legacyRoot, p, ".."), { recursive: true });
      writeFileSync(join(legacyRoot, p), c);
    }
    writeFileSync(join(legacyRoot, "package.json"), "{}");
    legacyDb = new SqliteAdapter(join(legacyRoot, "p.db"));
  });

  afterAll(() => {
    legacyDb.close();
    rmSync(legacyRoot, { recursive: true, force: true });
  });

  it("resolves PSR-0 and classmap classes", () => {
    expect(resolvePhpClass(legacyRoot, "src/Report.php", "Legacy_Mailer")).toBe(
      "lib/Legacy/Mailer.php",
    );
    expect(resolvePhpClass(legacyRoot, "src/Report.php", "UserSeeder")).toBe(
      "database/seeds/UserSeeder.php",
    );
    expect(resolvePhpClass(legacyRoot, "src/Report.php", "Missing")).toBeUndefined();
  });

  it("links composer `files` helpers and labels routes from composer `require`", async () => {
    const r = await parseFile(legacyRoot, "src/Report.php", legacy["src/Report.php"]!);
    const calls = r.edges.filter((e) => e.kind === "calls").map((e) => e.dst);
    expect(calls).toContain("sym:src/helpers.php#format_money");
    const web = await parseFile(legacyRoot, "routes/web.php", legacy["routes/web.php"]!);
    expect(web.nodes.find((n) => n.kind === "route")?.meta).toMatchObject({ framework: "lumen" });
  });

  it("keeps `use` imports to their own braced namespace block", async () => {
    const b = await parseFile(legacyRoot, "src/blocks.php", legacy["src/blocks.php"]!);
    const calls = b.edges.filter((e) => e.kind === "calls").map((e) => `${e.src}→${e.dst}`);
    expect(calls).toEqual(
      expect.arrayContaining([
        "sym:src/blocks.php#X.f→pkg:Lib",
        "sym:src/blocks.php#Y.g→sym:src/blocks.php#Thing",
      ]),
    );
  });

  it("links $this-> calls to inherited and trait methods", async () => {
    const lctx: ProjectContext = {
      root: legacyRoot,
      id: "legacy",
      dbPath: join(legacyRoot, "p.db"),
      config: ConfigSchema.parse({}),
    };
    await reindexCode(lctx, legacyDb, { full: true });
    const calls = legacyDb
      .graphEdgesFrom(["sym:src/Report.php#Report.render"], ["calls"])
      .map((e) => e.dst);
    expect(calls).toEqual(
      expect.arrayContaining([
        "sym:src/Base.php#Base.save",
        "sym:src/Base.php#Audits.audit",
        "sym:src/helpers.php#format_money",
      ]),
    );
  }, 60_000);
});
