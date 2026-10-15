import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  httpMethod,
  joinRoutePath,
  laravelResource,
  normalizeRoutePath,
  parseAliasKey,
  parseRestShorthand,
  parseRouteAnnotations,
  phpRoutePath,
} from "../../src/graph/routes.js";
import { type ParsedFile, parseFile } from "../../src/graph/treesitter.js";

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "em-routes-"));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A fixture file under the temp root (PHP handler resolution needs real class files). */
function write(rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

/** `<?php namespace …; class …` with the given methods, at the PSR-4 path of `fqcn`. */
function phpClass(file: string, fqcn: string, methods: string[] = []): void {
  const parts = fqcn.split("\\");
  const name = parts.pop()!;
  const body = methods.map((m) => `    public function ${m}() {}`).join("\n");
  write(file, `<?php\nnamespace ${parts.join("\\")};\n\nclass ${name}\n{\n${body}\n}\n`);
}

/** `[ "GET /users <framework>", ... ]` sorted, plus handler ids per route. */
function summarise(p: ParsedFile) {
  const routes = p.nodes
    .filter((n) => n.kind === "route")
    .map((n) => `${n.name} ${(n.meta as { framework: string }).framework}`)
    .sort();
  const handlers: Record<string, string[]> = {};
  for (const e of p.edges.filter((e) => e.kind === "handles")) {
    const list = handlers[e.dst] ?? [];
    list.push(e.src);
    handlers[e.dst] = list;
  }
  return { routes, handlers };
}

describe("route helpers", () => {
  it("maps verbs and aliases to HTTP methods", () => {
    expect(httpMethod("get")).toBe("GET");
    expect(httpMethod("DELETE")).toBe("DELETE");
    expect(httpMethod("del")).toBe("DELETE");
    expect(httpMethod("*")).toBe("ALL");
    expect(httpMethod("route")).toBeUndefined();
  });

  it("joins mount prefixes and paths", () => {
    expect(joinRoutePath("/api", "/users")).toBe("/api/users");
    expect(joinRoutePath("/api/", "users/")).toBe("/api/users");
    expect(joinRoutePath(undefined, "/")).toBe("/");
    expect(joinRoutePath("/api", "/")).toBe("/api");
    expect(joinRoutePath()).toBe("/");
  });

  it("normalises hapi path parameters", () => {
    expect(normalizeRoutePath("/users/{id}")).toBe("/users/:id");
    expect(normalizeRoutePath("/files/{path*}")).toBe("/files/*path");
    expect(normalizeRoutePath("/files/{segments*2}")).toBe("/files/*segments");
    expect(normalizeRoutePath("/u/{id?}")).toBe("/u/:id?");
    expect(normalizeRoutePath("/plain/:id")).toBe("/plain/:id");
  });

  it("parses moleculer-web alias keys", () => {
    expect(parseAliasKey("GET users/:id", "users.get")).toEqual([
      { method: "GET", path: "/users/:id", action: "users.get" },
    ]);
    expect(parseAliasKey("users", "users.list")).toEqual([
      { method: "ALL", path: "/users", action: "users.list" },
    ]);
    expect(
      parseAliasKey("REST posts", "posts").map((s) => `${s.method} ${s.path} ${s.action}`),
    ).toEqual([
      "GET /posts posts.list",
      "GET /posts/:id posts.get",
      "POST /posts posts.create",
      "PUT /posts/:id posts.update",
      "PATCH /posts/:id posts.patch",
      "DELETE /posts/:id posts.remove",
    ]);
    expect(parseAliasKey("REST /", "root").map((s) => s.path)).toEqual([
      "/",
      "/:id",
      "/",
      "/:id",
      "/:id",
      "/:id",
    ]);
  });

  it("parses moleculer action rest shorthands", () => {
    expect(parseRestShorthand("GET /:id", "get")).toEqual([{ method: "GET", path: "/:id" }]);
    expect(parseRestShorthand("/search", "find")).toEqual([{ method: "ALL", path: "/search" }]);
    expect(parseRestShorthand(true, "welcome")).toEqual([{ method: "ALL", path: "/welcome" }]);
  });

  it("joins PHP route paths and drops parameter requirements", () => {
    expect(phpRoutePath(undefined, "users/{id}")).toBe("/users/:id");
    expect(phpRoutePath("/admin", "users/{id?}")).toBe("/admin/users/:id?");
    expect(phpRoutePath("/api", "/items/{id:[0-9]+}")).toBe("/api/items/:id");
    expect(phpRoutePath("/y", "{year:\\d{4}}")).toBe("/y/:year");
    expect(phpRoutePath("/blog", "/{id<\\d+>}/edit")).toBe("/blog/:id/edit");
    expect(phpRoutePath("/blog", "")).toBe("/blog");
  });

  it("expands Laravel resources", () => {
    expect(laravelResource("photos").map((s) => `${s.method} ${s.path} ${s.action}`)).toEqual([
      "GET /photos index",
      "GET /photos/create create",
      "POST /photos store",
      "GET /photos/:photo show",
      "GET /photos/:photo/edit edit",
      "PUT /photos/:photo update",
      "PATCH /photos/:photo update",
      "DELETE /photos/:photo destroy",
    ]);
    expect(laravelResource("categories", true, undefined, ["destroy"]).map((s) => s.path)).toEqual([
      "/categories",
      "/categories",
      "/categories/:category",
      "/categories/:category",
      "/categories/:category",
    ]);
    expect(laravelResource("posts.comments", false, ["show"])).toEqual([
      { method: "GET", path: "/posts/:post/comments/:comment", action: "show" },
    ]);
  });

  it("parses Symfony @Route annotations", () => {
    const doc = '/**\n * @Route("/legacy/{id}", name="legacy", methods={"GET", "POST"})\n */';
    expect(parseRouteAnnotations(doc)).toEqual([
      { method: "GET", path: "/legacy/{id}" },
      { method: "POST", path: "/legacy/{id}" },
    ]);
    expect(parseRouteAnnotations('/** @Route(path="/any") */')).toEqual([
      { method: "ALL", path: "/any" },
    ]);
    expect(parseRouteAnnotations("/** @return Response */")).toEqual([]);
  });
});

describe("koa-router", () => {
  it("handles named routes, del, constructor and method prefixes", async () => {
    const code = [
      'import Router from "@koa/router";',
      'const router = new Router({ prefix: "/api" });',
      "export async function listUsers(ctx) { ctx.body = []; }",
      "export async function removeUser(ctx) {}",
      'router.get("users", "/users", listUsers);',
      'router.del("/users/:id", removeUser);',
      'router.post("/users", async (ctx) => { ctx.status = 201; });',
      "const admin = new Router();",
      'admin.get("/stats", listUsers);',
      'admin.prefix("/admin");',
      "export default router;",
    ].join("\n");
    const { routes, handlers } = summarise(await parseFile(root, "src/routes.ts", code));
    expect(routes).toEqual([
      "DELETE /api/users/:id koa",
      "GET /admin/stats koa",
      "GET /api/users koa",
      "POST /api/users koa",
    ]);
    expect(handlers["route:GET /api/users"]).toEqual(["sym:src/routes.ts#listUsers"]);
    expect(handlers["route:DELETE /api/users/:id"]).toEqual(["sym:src/routes.ts#removeUser"]);
    expect(handlers["route:POST /api/users"]).toEqual(["file:src/routes.ts"]);
  });

  it("labels CommonJS koa-router files via require()", async () => {
    const code = [
      'const Router = require("koa-router");',
      "const router = new Router();",
      'router.get("/health", (ctx) => { ctx.body = "ok"; });',
      "module.exports = router;",
    ].join("\n");
    const p = await parseFile(root, "src/health.js", code);
    expect(summarise(p).routes).toEqual(["GET /health koa"]);
    expect(p.edges.find((e) => e.kind === "imports")?.dst).toBe("pkg:koa-router");
  });
});

describe("hapi", () => {
  it("reads single and array route configs, method arrays, nested handlers", async () => {
    const code = [
      'import Hapi from "@hapi/hapi";',
      "const server = Hapi.server({ port: 3000 });",
      "export function getUser(request, h) { return {}; }",
      "export function saveUser(request, h) { return {}; }",
      'server.route({ method: "GET", path: "/users/{id}", handler: getUser });',
      "server.route([",
      '  { method: ["POST", "PUT"], path: "/users/{id?}", options: { handler: saveUser } },',
      '  { method: "*", path: "/{p*}", handler: (request, h) => h.response("fallback") },',
      "]);",
      'server.route({ method: "GET", path: "/static", handler: { directory: { path: "." } } });',
    ].join("\n");
    const { routes, handlers } = summarise(await parseFile(root, "src/server.ts", code));
    expect(routes).toEqual([
      "ALL /*p hapi",
      "GET /static hapi",
      "GET /users/:id hapi",
      "POST /users/:id? hapi",
      "PUT /users/:id? hapi",
    ]);
    expect(handlers["route:GET /users/:id"]).toEqual(["sym:src/server.ts#getUser"]);
    expect(handlers["route:PUT /users/:id?"]).toEqual(["sym:src/server.ts#saveUser"]);
    // inline and non-function handlers fall back to the file
    expect(handlers["route:ALL /*p"]).toEqual(["file:src/server.ts"]);
    expect(handlers["route:GET /static"]).toEqual(["file:src/server.ts"]);
  });

  it("recognises fastify's route() with url and config.handler", async () => {
    const code = [
      'import Fastify from "fastify";',
      "const app = Fastify();",
      "export const ping = async () => 'pong';",
      'app.route({ method: "GET", url: "/ping", handler: ping });',
      'app.route({ method: "POST", url: "/echo", config: { handler: ping } });',
      'app.get("/plain", { schema: {} }, ping);',
    ].join("\n");
    const { routes, handlers } = summarise(await parseFile(root, "src/app.ts", code));
    expect(routes).toEqual(["GET /ping fastify", "GET /plain fastify", "POST /echo fastify"]);
    expect(handlers["route:POST /echo"]).toEqual(["sym:src/app.ts#ping"]);
  });

  it("ignores express's app.route(path) chaining without a path literal", async () => {
    const code = [
      'import express from "express";',
      "const app = express();",
      'app.route("/books").get((req, res) => {}).post((req, res) => {});',
      'app.get("/ok", (req, res) => {});',
    ].join("\n");
    expect(summarise(await parseFile(root, "src/x.ts", code)).routes).toEqual(["GET /ok express"]);
  });
});

describe("moleculer", () => {
  it("expands moleculer-web gateway aliases under the settings and route paths", async () => {
    const code = [
      'import ApiGateway from "moleculer-web";',
      "export function authorize(ctx, route, req) {}",
      "export default {",
      '  name: "api",',
      "  mixins: [ApiGateway],",
      "  settings: {",
      '    path: "/api",',
      "    routes: [",
      "      {",
      '        path: "/v1",',
      "        aliases: {",
      '          "GET users/:id": "users.get",',
      '          "POST login": [authorize, "auth.login"],',
      '          "REST posts": "posts",',
      '          "health"(req, res) { res.end("ok"); },',
      "        },",
      "      },",
      '      { path: "/admin", aliases: { "GET stats": "admin.stats" } },',
      "    ],",
      "  },",
      "};",
    ].join("\n");
    const p = await parseFile(root, "src/api.service.ts", code);
    const { routes, handlers } = summarise(p);
    expect(routes).toEqual([
      "ALL /api/v1/health moleculer",
      "DELETE /api/v1/posts/:id moleculer",
      "GET /api/admin/stats moleculer",
      "GET /api/v1/posts moleculer",
      "GET /api/v1/posts/:id moleculer",
      "GET /api/v1/users/:id moleculer",
      "PATCH /api/v1/posts/:id moleculer",
      "POST /api/v1/login moleculer",
      "POST /api/v1/posts moleculer",
      "PUT /api/v1/posts/:id moleculer",
    ]);
    const meta = (id: string) => p.nodes.find((n) => n.id === id)?.meta as { action?: string };
    expect(meta("route:GET /api/v1/users/:id").action).toBe("users.get");
    expect(meta("route:POST /api/v1/login").action).toBe("auth.login");
    expect(meta("route:PUT /api/v1/posts/:id").action).toBe("posts.update");
    expect(meta("route:ALL /api/v1/health").action).toBeUndefined();
    // the middleware function in the array is a local handler; the inline method is the file
    expect(handlers["route:POST /api/v1/login"]).toEqual(["sym:src/api.service.ts#authorize"]);
    expect(handlers["route:ALL /api/v1/health"]).toEqual(["file:src/api.service.ts"]);
  });

  it("derives routes from action rest shorthands with settings.rest or the service name", async () => {
    const code = [
      "module.exports = {",
      '  name: "users",',
      "  version: 2,",
      "  actions: {",
      '    list: { rest: "GET /", handler(ctx) { return []; } },',
      '    get: { rest: { method: "GET", path: "/:id" }, async handler(ctx) {} },',
      '    search: { rest: ["GET /search", "POST /search"], handler(ctx) {} },',
      "    welcome: { rest: true, handler(ctx) {} },",
      "    internal: { handler(ctx) {} },",
      "    shorthand(ctx) {},",
      "  },",
      "};",
    ].join("\n");
    const p = await parseFile(root, "services/users.service.js", code);
    const { routes } = summarise(p);
    expect(routes).toEqual([
      "ALL /v2/users/welcome moleculer",
      "GET /v2/users moleculer",
      "GET /v2/users/:id moleculer",
      "GET /v2/users/search moleculer",
      "POST /v2/users/search moleculer",
    ]);
    const meta = (id: string) => p.nodes.find((n) => n.id === id)?.meta as { action?: string };
    expect(meta("route:GET /v2/users/:id").action).toBe("users.get");

    const withRest = await parseFile(
      root,
      "services/posts.service.js",
      [
        "module.exports = {",
        '  name: "posts",',
        '  settings: { rest: "/blog" },',
        "  actions: {",
        '    list: { rest: "GET /", handler(ctx) {} },',
        '    byTag: { rest: { method: "GET", path: "/tag/:tag", basePath: "/labels" }, handler(ctx) {} },',
        "  },",
        "};",
      ].join("\n"),
    );
    expect(summarise(withRest).routes).toEqual([
      "GET /blog moleculer",
      "GET /labels/tag/:tag moleculer",
    ]);
  });

  it("does not mistake unrelated `aliases` objects for a gateway", async () => {
    const code = 'export const config = { aliases: { "@": "./src", "~": "./lib" } };\n';
    expect(summarise(await parseFile(root, "build.config.ts", code)).routes).toEqual([]);
  });
});

describe("laravel", () => {
  const ctl = (name: string) => `sym:laravel/app/Http/Controllers/${name}.php#${name}`;
  beforeAll(() => {
    write("laravel/composer.json", JSON.stringify({ autoload: { "psr-4": { "App\\": "app/" } } }));
    phpClass(
      "laravel/app/Http/Controllers/UserController.php",
      "App\\Http\\Controllers\\UserController",
    );
    phpClass(
      "laravel/app/Http/Controllers/PhotoController.php",
      "App\\Http\\Controllers\\PhotoController",
    );
    phpClass(
      "laravel/app/Http/Controllers/PostController.php",
      "App\\Http\\Controllers\\PostController",
    );
  });

  it("reads verbs, match/any, prefix and controller groups and facade chains", async () => {
    const code = [
      "<?php",
      "use App\\Http\\Controllers\\UserController;",
      "use Illuminate\\Support\\Facades\\Route;",
      "",
      "Route::get('/users/{id}', [UserController::class, 'show'])->name('users.show');",
      "Route::post('users', 'UserController@store');",
      "Route::match(['get', 'post'], '/contact', fn () => view('contact'));",
      "Route::any('/fallback', function () { return 'x'; });",
      "Route::middleware('auth')->put('/me', [UserController::class, 'update']);",
      "Route::prefix('admin')->middleware('auth')->group(function () {",
      "    Route::delete('/users/{id?}', [UserController::class, 'destroy']);",
      "    Route::group(['prefix' => 'reports'], function () {",
      "        Route::get('daily', [UserController::class, 'daily']);",
      "    });",
      "});",
      "Route::controller(UserController::class)->group(function () {",
      "    Route::get('/profile', 'profile');",
      "});",
    ].join("\n");
    const { routes, handlers } = summarise(await parseFile(root, "laravel/routes/web.php", code));
    expect(routes).toEqual([
      "ALL /fallback laravel",
      "DELETE /admin/users/:id? laravel",
      "GET /admin/reports/daily laravel",
      "GET /contact laravel",
      "GET /profile laravel",
      "GET /users/:id laravel",
      "POST /contact laravel",
      "POST /users laravel",
      "PUT /me laravel",
    ]);
    expect(handlers["route:GET /users/:id"]).toEqual([`${ctl("UserController")}.show`]);
    // `'Controller@method'` strings resolve against App\Http\Controllers
    expect(handlers["route:POST /users"]).toEqual([`${ctl("UserController")}.store`]);
    expect(handlers["route:GET /admin/reports/daily"]).toEqual([`${ctl("UserController")}.daily`]);
    expect(handlers["route:GET /profile"]).toEqual([`${ctl("UserController")}.profile`]);
    expect(handlers["route:PUT /me"]).toEqual([`${ctl("UserController")}.update`]);
    expect(handlers["route:GET /contact"]).toEqual(["file:laravel/routes/web.php"]);
  });

  it("expands resources with only/except and serves routes/api.php under /api", async () => {
    const code = [
      "<?php",
      "use Illuminate\\Support\\Facades\\Route;",
      "Route::resource('photos', PhotoController::class)->only(['index', 'show']);",
      "Route::apiResource('posts.comments', 'PostController')->except(['destroy']);",
    ].join("\n");
    const { routes, handlers } = summarise(await parseFile(root, "laravel/routes/api.php", code));
    expect(routes).toEqual([
      "GET /api/photos laravel",
      "GET /api/photos/:photo laravel",
      "GET /api/posts/:post/comments laravel",
      "GET /api/posts/:post/comments/:comment laravel",
      "PATCH /api/posts/:post/comments/:comment laravel",
      "POST /api/posts/:post/comments laravel",
      "PUT /api/posts/:post/comments/:comment laravel",
    ]);
    expect(handlers["route:GET /api/photos/:photo"]).toEqual([`${ctl("PhotoController")}.show`]);
    expect(handlers["route:POST /api/posts/:post/comments"]).toEqual([
      `${ctl("PostController")}.store`,
    ]);
  });

  it("reads view and redirect routes, resources() maps and resource options", async () => {
    const code = [
      "<?php",
      "use App\\Http\\Controllers\\PhotoController;",
      "use Illuminate\\Support\\Facades\\Route;",
      "Route::view('/welcome', 'welcome');",
      "Route::redirect('/here', '/there');",
      "Route::permanentRedirect('/old', '/new');",
      "Route::resources(['photos' => PhotoController::class]);",
      "Route::resource('posts', 'PostController', ['only' => ['show']]);",
    ].join("\n");
    const file = "laravel/routes/web.php";
    const { routes, handlers } = summarise(await parseFile(root, file, code));
    expect(routes).toEqual([
      "ALL /here laravel",
      "ALL /old laravel",
      "DELETE /photos/:photo laravel",
      "GET /photos laravel",
      "GET /photos/:photo laravel",
      "GET /photos/:photo/edit laravel",
      "GET /photos/create laravel",
      "GET /posts/:post laravel",
      "GET /welcome laravel",
      "PATCH /photos/:photo laravel",
      "POST /photos laravel",
      "PUT /photos/:photo laravel",
    ]);
    expect(handlers["route:GET /welcome"]).toEqual([`file:${file}`]);
    expect(handlers["route:GET /photos/:photo"]).toEqual([`${ctl("PhotoController")}.show`]);
    expect(handlers["route:GET /posts/:post"]).toEqual([`${ctl("PostController")}.show`]);
  });

  it("reads spatie route attributes with a class prefix and resource", async () => {
    const code = [
      "<?php",
      "namespace App\\Http\\Controllers;",
      "",
      "use Spatie\\RouteAttributes\\Attributes\\Get;",
      "use Spatie\\RouteAttributes\\Attributes\\Post;",
      "use Spatie\\RouteAttributes\\Attributes\\Prefix;",
      "use Spatie\\RouteAttributes\\Attributes\\Resource;",
      "use Spatie\\RouteAttributes\\Attributes\\Route;",
      "",
      "#[Prefix('admin')]",
      "class AdminController",
      "{",
      "    #[Get('users/{user}')]",
      "    public function show() {}",
      "",
      "    #[Post(uri: 'users')]",
      "    public function store() {}",
      "",
      "    #[Route(['put', 'patch'], 'users/{user}')]",
      "    public function update() {}",
      "}",
      "",
      "#[Resource('tags', apiResource: true, only: ['index'])]",
      "class TagController",
      "{",
      "    public function index() {}",
      "}",
    ].join("\n");
    const file = "laravel/app/Http/Controllers/AdminController.php";
    const { routes, handlers } = summarise(await parseFile(root, file, code));
    expect(routes).toEqual([
      "GET /admin/users/:user laravel",
      "GET /tags laravel",
      "PATCH /admin/users/:user laravel",
      "POST /admin/users laravel",
      "PUT /admin/users/:user laravel",
    ]);
    expect(handlers["route:GET /admin/users/:user"]).toEqual([`sym:${file}#AdminController.show`]);
    expect(handlers["route:GET /tags"]).toEqual([`sym:${file}#TagController.index`]);
  });
});

describe("symfony", () => {
  it("reads #[Route] attributes with a class prefix, requirements and @Route annotations", async () => {
    const code = [
      "<?php",
      "namespace App\\Controller;",
      "",
      "use Symfony\\Bundle\\FrameworkBundle\\Controller\\AbstractController;",
      "use Symfony\\Component\\HttpFoundation\\Response;",
      "use Symfony\\Component\\Routing\\Attribute\\Route;",
      "",
      "#[Route('/blog', name: 'blog_')]",
      "class BlogController extends AbstractController",
      "{",
      "    #[Route('', name: 'index', methods: ['GET'])]",
      "    public function index(): Response { return $this->render('blog/index.html.twig'); }",
      "",
      "    #[Route('/{slug}', name: 'show', methods: ['GET', 'HEAD'])]",
      "    public function show(string $slug): Response { return new Response($slug); }",
      "",
      "    #[Route(path: '/{id<\\d+>}/edit', methods: 'POST')]",
      "    public function edit(int $id): Response { return new Response(''); }",
      "",
      "    /**",
      '     * @Route("/legacy", methods={"GET"})',
      "     */",
      "    public function legacy(): Response { return new Response(''); }",
      "",
      "    public function helper(): void {}",
      "}",
      "",
      "#[Route('/health', name: 'health', methods: ['GET'])]",
      "final class HealthController",
      "{",
      "    public function __invoke(): Response { return new Response('ok'); }",
      "}",
    ].join("\n");
    const file = "symfony/src/Controller/BlogController.php";
    const { routes, handlers } = summarise(await parseFile(root, file, code));
    expect(routes).toEqual([
      "GET /blog symfony",
      "GET /blog/:slug symfony",
      "GET /blog/legacy symfony",
      "GET /health symfony",
      "HEAD /blog/:slug symfony",
      "POST /blog/:id/edit symfony",
    ]);
    expect(handlers["route:GET /blog/:slug"]).toEqual([`sym:${file}#BlogController.show`]);
    expect(handlers["route:GET /blog/legacy"]).toEqual([`sym:${file}#BlogController.legacy`]);
    expect(handlers["route:GET /health"]).toEqual([`sym:${file}#HealthController.__invoke`]);
  });
});

describe("slim, lumen and codeigniter", () => {
  beforeAll(() => {
    write("slim/composer.json", JSON.stringify({ autoload: { "psr-4": { "App\\": "src/" } } }));
    phpClass("slim/src/Action/ListItemsAction.php", "App\\Action\\ListItemsAction", ["__invoke"]);
    phpClass("slim/src/Action/CreateItemAction.php", "App\\Action\\CreateItemAction", ["handle"]);
  });

  it("reads $app routes, groups and map() in a Slim app", async () => {
    const code = [
      "<?php",
      "use App\\Action\\ListItemsAction;",
      "use Psr\\Http\\Message\\ResponseInterface as Response;",
      "use Slim\\Factory\\AppFactory;",
      "use Slim\\Routing\\RouteCollectorProxy;",
      "",
      "$app = AppFactory::create();",
      "$app->get('/hello/{name}', function ($request, Response $response, array $args) {",
      "    return $response;",
      "});",
      "$app->group('/api', function (RouteCollectorProxy $group) {",
      "    $group->get('/items/{id:[0-9]+}', ListItemsAction::class);",
      "    $group->post('/items', 'App\\Action\\CreateItemAction:handle');",
      "});",
      "$app->map(['GET', 'POST'], '/form', fn ($req, $res) => $res);",
      "$app->run();",
      "$settings = $container->get('settings');",
    ].join("\n");
    const file = "slim/public/index.php";
    const { routes, handlers } = summarise(await parseFile(root, file, code));
    expect(routes).toEqual([
      "GET /api/items/:id slim",
      "GET /form slim",
      "GET /hello/:name slim",
      "POST /api/items slim",
      "POST /form slim",
    ]);
    expect(handlers["route:GET /api/items/:id"]).toEqual([
      "sym:slim/src/Action/ListItemsAction.php#ListItemsAction",
    ]);
    expect(handlers["route:POST /api/items"]).toEqual([
      "sym:slim/src/Action/CreateItemAction.php#CreateItemAction.handle",
    ]);
    expect(handlers["route:GET /hello/:name"]).toEqual([`file:${file}`]);
  });

  it("reads Lumen $router and CodeIgniter $routes registrations", async () => {
    const lumen = [
      "<?php",
      "$router->get('lumen', ['as' => 'profile', 'uses' => 'LumenController@index']);",
      "$router->group(['prefix' => 'api'], function () use ($router) {",
      "    $router->post('items', 'ItemController@store');",
      "});",
    ].join("\n");
    expect(summarise(await parseFile(root, "lumen/routes/web.php", lumen)).routes).toEqual([
      "GET /lumen http",
      "POST /api/items http",
    ]);
    // composer.json's `require` names the framework when no `use` does
    write(
      "lumen2/composer.json",
      JSON.stringify({ require: { "laravel/lumen-framework": "^10.0" } }),
    );
    expect(summarise(await parseFile(root, "lumen2/routes/web.php", lumen)).routes).toEqual([
      "GET /lumen lumen",
      "POST /api/items lumen",
    ]);
    const ci = [
      "<?php",
      "use CodeIgniter\\Router\\RouteCollection;",
      "",
      "/** @var RouteCollection $routes */",
      "$routes->get('/', 'Home::index');",
      "$routes->group('admin', static function ($routes) {",
      "    $routes->get('users', 'Admin\\Users::index');",
      "});",
    ].join("\n");
    expect(summarise(await parseFile(root, "ci/app/Config/Routes.php", ci)).routes).toEqual([
      "GET / codeigniter",
      "GET /admin/users codeigniter",
    ]);
  });

  it("ignores test requests, getters and HTTP clients", async () => {
    const code = [
      "<?php",
      "class UsersTest extends TestCase",
      "{",
      "    public function test_index(): void",
      "    {",
      "        $this->get('/api/users')->assertOk();",
      "        $name = $request->get('name', 'default');",
      "        $value = $cache->get('/key');",
      "        $client->get('/api/users', ['headers' => ['Accept' => 'json']]);",
      "        $config->get('app/name', fn () => 1);",
      "    }",
      "}",
    ].join("\n");
    expect(summarise(await parseFile(root, "tests/UsersTest.php", code)).routes).toEqual([]);
  });
});
