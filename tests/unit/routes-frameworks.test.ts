import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  httpMethod,
  joinRoutePath,
  normalizeRoutePath,
  parseAliasKey,
  parseRestShorthand,
} from "../../src/graph/routes.js";
import { type ParsedFile, parseFile } from "../../src/graph/treesitter.js";

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "em-routes-"));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

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
