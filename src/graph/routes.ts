/**
 * HTTP route detection shared by the language parsers. Four sources:
 *  - call-based registration (`app.get("/users/:id", handler)`) for express, fastify,
 *    koa-router (including named routes and `prefix`), hono, restify and similar
 *    `method(path, ...handlers)` APIs;
 *  - config-object registration (`server.route({ method, path, handler })`) for hapi and
 *    fastify's `route()`;
 *  - schema-declared routes for moleculer: `aliases` maps of a moleculer-web gateway and
 *    `rest` shorthands on service actions;
 *  - file-based routing (Next.js `app/**\/route.ts` and `pages/api/**`);
 *  - PHP (in `languages/php.ts`): Laravel's `Route::` facade (verbs, `match`, `view`,
 *    `redirect`, `resource(s)`, `prefix()->group()`), Symfony `#[Route]` attributes and
 *    `@Route` annotations, spatie/laravel-route-attributes, and `$app->get()` /
 *    `$router->get()` / `$routes->get()` for Slim, Lumen and CodeIgniter 4.
 * Routes are graph nodes (`route:<METHOD> <path>`, kind `route`); the handler symbol
 * gets a `handles` edge to the route and the file a `defines` edge, so impact queries
 * from a handler reach the route and the explorer can list endpoints per file.
 */

export const ROUTE_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "all",
]);

/** JS-only verb aliases (`router.del` in koa-router and restify). Kept out of ROUTE_METHODS
 *  because Go's `http.Header.Del` would otherwise look like a registration. */
const JS_METHOD_ALIASES: Record<string, string> = { del: "DELETE" };

/** `"get"` → `"GET"`, `"del"` → `"DELETE"`, `"*"` → `"ALL"`; undefined when it is not a verb. */
export function httpMethod(token: string): string | undefined {
  const t = token.trim();
  if (t === "*") return "ALL";
  const lower = t.toLowerCase();
  if (ROUTE_METHODS.has(lower)) return lower.toUpperCase();
  return JS_METHOD_ALIASES[lower];
}

/** Join URL path segments the way routers mount them: one slash between, none trailing. */
export function joinRoutePath(...parts: Array<string | undefined>): string {
  const segs = parts
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
  return `/${segs.join("/")}`;
}

/** hapi's `{id}`, `{id?}`, `{rest*}` and `{p*2}` params rewritten to the `:id` / `*rest` style
 *  the rest of the graph uses, so the same endpoint has one id whichever framework wrote it. */
export function normalizeRoutePath(path: string): string {
  return path
    .replace(/\{([^}]+?)\*\d*\}/g, "*$1")
    .replace(/\{([^}]+?)\?\}/g, ":$1?")
    .replace(/\{([^}]+?)\}/g, ":$1");
}

export interface RouteSpec {
  method: string;
  path: string;
  /** moleculer: the `service.action` the route dispatches to, when the alias names one. */
  action?: string | undefined;
}

/** moleculer-web `REST <path>` expands to the five CRUD aliases plus PATCH. */
const REST_ALIASES: Array<[string, string, string]> = [
  ["GET", "", "list"],
  ["GET", "/:id", "get"],
  ["POST", "", "create"],
  ["PUT", "/:id", "update"],
  ["PATCH", "/:id", "patch"],
  ["DELETE", "/:id", "remove"],
];

/**
 * One key of a moleculer-web `aliases` map: `"GET users/:id"`, `"REST users"` or a bare
 * `"users"` (any method). `target` is the alias value when it is an action-name string
 * (`"users.get"`); for REST it is the service name the six actions hang off.
 */
export function parseAliasKey(key: string, target?: string): RouteSpec[] {
  const parts = key.trim().split(/\s+/);
  let verb = parts.length > 1 ? parts[0]! : undefined;
  const rawPath = parts.length > 1 ? parts.slice(1).join(" ") : parts[0]!;
  if (verb?.toUpperCase() === "REST") {
    const base = joinRoutePath(rawPath);
    return REST_ALIASES.map(([method, suffix, action]) => ({
      method,
      path: base === "/" ? suffix || "/" : `${base}${suffix}`,
      action: target ? `${target}.${action}` : undefined,
    }));
  }
  if (verb && !httpMethod(verb)) {
    // not a verb: the whole key is the path (paths never contain spaces in practice)
    verb = undefined;
  }
  const method = verb ? httpMethod(verb)! : "ALL";
  return [{ method, path: joinRoutePath(rawPath), action: target }];
}

/**
 * A moleculer action's `rest` shorthand: `"GET /:id"`, `"/users"` (any method) or `true`
 * (any method at `/<action>`). Object and array forms are handled by the parser, which
 * has the literal values.
 */
export function parseRestShorthand(rest: string | true, actionName: string): RouteSpec[] {
  if (rest === true) return [{ method: "ALL", path: joinRoutePath(actionName) }];
  const parts = rest.trim().split(/\s+/);
  if (parts.length > 1 && httpMethod(parts[0]!)) {
    return [{ method: httpMethod(parts[0]!)!, path: joinRoutePath(parts.slice(1).join(" ")) }];
  }
  return [{ method: "ALL", path: joinRoutePath(rest) }];
}

/** PHP route path from its parts: prefixes joined, Slim/FastRoute `{id:\d+}` and Symfony
 *  `{id<\d+>}` requirements dropped, `{id}` / `{id?}` rewritten to `:id` / `:id?`. Laravel
 *  writes paths without the leading slash (`'users'`), which the join adds. */
export function phpRoutePath(...parts: Array<string | undefined>): string {
  return normalizeRoutePath(
    joinRoutePath(...parts)
      .replace(/\{(\w+)\s*:[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, "{$1}")
      .replace(/\{(\w+)<[^>]*>[^}]*\}/g, "{$1}"),
  );
}

/** Laravel `Route::resource` actions: method, path suffix (`{p}` is the parameter), action. */
const RESOURCE_ACTIONS: Array<[string, string, string]> = [
  ["GET", "", "index"],
  ["GET", "/create", "create"],
  ["POST", "", "store"],
  ["GET", "/{p}", "show"],
  ["GET", "/{p}/edit", "edit"],
  ["PUT", "/{p}", "update"],
  ["PATCH", "/{p}", "update"],
  ["DELETE", "/{p}", "destroy"],
];

/** The route parameter Laravel names after a resource segment (`photos` → `photo`). */
function resourceParam(segment: string): string {
  return segment
    .replace(/-/g, "_")
    .replace(/ies$/, "y")
    .replace(/(s|x|z|ch|sh)es$/, "$1")
    .replace(/([^s])s$/, "$1");
}

/**
 * `Route::resource('photos.comments', …)` → its CRUD routes, `action` naming the controller
 * method. `api` (apiResource) drops `create` and `edit`; `only` / `except` filter by action.
 * Nested names put the parent's parameter in the path (`/photos/:photo/comments/:comment`).
 */
export function laravelResource(
  name: string,
  api = false,
  only?: string[],
  except?: string[],
): RouteSpec[] {
  const segs = name.split(".").filter(Boolean);
  const last = segs.pop();
  if (!last) return [];
  const base = joinRoutePath(...segs.map((s) => `${s}/:${resourceParam(s)}`), last);
  const param = `:${resourceParam(last)}`;
  return RESOURCE_ACTIONS.filter(
    ([, , action]) =>
      !(api && (action === "create" || action === "edit")) &&
      (!only || only.includes(action)) &&
      !except?.includes(action),
  ).map(([method, suffix, action]) => ({
    method,
    path: `${base === "/" ? "" : base}${suffix.replace("{p}", param)}` || "/",
    action,
  }));
}

/**
 * Doctrine-style `@Route("/path", methods={"GET", "POST"})` annotations in a docblock
 * (Symfony before attributes). A missing `methods` means any method.
 */
export function parseRouteAnnotations(doc: string): RouteSpec[] {
  const out: RouteSpec[] = [];
  for (const m of doc.matchAll(/@Route\(([^)]*)\)/g)) {
    const body = m[1] ?? "";
    const path = /^\s*"([^"]*)"/.exec(body)?.[1] ?? /\bpath\s*=\s*"([^"]*)"/.exec(body)?.[1];
    if (path === undefined) continue;
    const list = /\bmethods\s*=\s*(\{[^}]*\}|"[^"]*")/.exec(body)?.[1] ?? "";
    const methods = [...list.matchAll(/"([^"]+)"/g)]
      .map((x) => httpMethod(x[1]!))
      .filter((x): x is string => !!x);
    for (const method of methods.length ? methods : ["ALL"]) out.push({ method, path });
  }
  return out;
}

/** Packages whose import marks the registering object as a known framework. */
const FRAMEWORK_PKGS: Record<string, string> = {
  express: "express",
  fastify: "fastify",
  hono: "hono",
  koa: "koa",
  "@koa/router": "koa",
  "koa-router": "koa",
  "@hapi/hapi": "hapi",
  hapi: "hapi",
  moleculer: "moleculer",
  "moleculer-web": "moleculer",
  restify: "restify",
  polka: "polka",
  "@nestjs/common": "nest",
  elysia: "elysia",
  // Python
  flask: "flask",
  fastapi: "fastapi",
  starlette: "starlette",
  aiohttp: "aiohttp",
  sanic: "sanic",
  tornado: "tornado",
  django: "django",
  // Go (import path prefixes)
  "net/http": "net/http",
  "github.com/gin-gonic/gin": "gin",
  "github.com/go-chi/chi": "chi",
  "github.com/labstack/echo": "echo",
  "github.com/gorilla/mux": "gorilla",
  "github.com/gofiber/fiber": "fiber",
  "github.com/julienschmidt/httprouter": "httprouter",
  // PHP (top-level namespace of a `use` the project cannot resolve)
  Illuminate: "laravel",
  Symfony: "symfony",
  Slim: "slim",
  CodeIgniter: "codeigniter",
  // PHP (composer.json `require`, when no `use` in the file names the framework)
  "laravel/lumen-framework": "lumen",
  "laravel/framework": "laravel",
  "symfony/framework-bundle": "symfony",
  "slim/slim": "slim",
  "codeigniter4/framework": "codeigniter",
};

export function frameworkOf(importedPackages: Iterable<string>): string | undefined {
  for (const p of importedPackages) {
    const f = FRAMEWORK_PKGS[p];
    if (f) return f;
    for (const [key, name] of Object.entries(FRAMEWORK_PKGS)) {
      if (key.includes("/") && p.startsWith(`${key}/`)) return name;
    }
  }
  return undefined;
}

export const routeId = (method: string, path: string): string => `route:${method} ${path}`;

/** `"/users/:id"` from a string or substitution-free template literal source text, else undefined. */
export function routePathFromLiteral(text: string): string | undefined {
  const m = /^(['"`])([^'"`$]*)\1$/.exec(text.trim());
  if (!m) return undefined;
  const p = m[2]!;
  return p.startsWith("/") ? p : undefined;
}

const NEXT_APP_ROUTE = /(?:^|\/)app\/(.*?)(?:\/)?route\.(?:ts|tsx|js|jsx|mjs)$/;
const NEXT_PAGES_API = /(?:^|\/)pages\/api\/(.+?)\.(?:ts|tsx|js|jsx|mjs)$/;
const HTTP_EXPORTS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

/** Turn a Next.js route directory into a URL path: `(group)` dropped, `[id]` → `:id`, `[...slug]` → `*slug`. */
function nextPath(dir: string): string {
  const parts = dir
    .split("/")
    .filter((s) => s && !/^\(.*\)$/.test(s))
    .map((s) =>
      s
        .replace(/^\[\[?\.\.\.(.+?)\]?\]$/, "*$1")
        .replace(/^\[(.+)\]$/, ":$1")
        .replace(/^index$/, ""),
    )
    .filter(Boolean);
  return `/${parts.join("/")}`;
}

export interface FileRoute {
  method: string;
  path: string;
  /** Exported symbol name that handles it (`GET`, or the default export). */
  handler: string;
  framework: string;
}

/**
 * Routes implied by a file's location. `exportedNames` are the file's top-level exports
 * (qualified names) and `defaultExport` the symbol `export default` points at, if any.
 */
export function fileRoutes(
  rel: string,
  exportedNames: string[],
  defaultExport: string | undefined,
): FileRoute[] {
  const out: FileRoute[] = [];
  const app = NEXT_APP_ROUTE.exec(rel);
  if (app) {
    const path = nextPath(app[1] ?? "");
    for (const name of exportedNames) {
      if (HTTP_EXPORTS.has(name))
        out.push({ method: name, path, handler: name, framework: "next" });
    }
    return out;
  }
  const pages = NEXT_PAGES_API.exec(rel);
  if (pages && defaultExport) {
    out.push({
      method: "ALL",
      path: `/api${nextPath(pages[1] ?? "")}`,
      handler: defaultExport,
      framework: "next",
    });
  }
  return out;
}
