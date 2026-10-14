/**
 * HTTP route detection shared by the language parsers. Two sources:
 *  - call-based registration (`app.get("/users/:id", handler)`) for express, fastify,
 *    koa-router, hono and similar `method(path, ...handlers)` APIs;
 *  - file-based routing (Next.js `app/**\/route.ts` and `pages/api/**`).
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

/** Packages whose import marks the registering object as a known framework. */
const FRAMEWORK_PKGS: Record<string, string> = {
  express: "express",
  fastify: "fastify",
  hono: "hono",
  koa: "koa",
  "@koa/router": "koa",
  "koa-router": "koa",
  "@hapi/hapi": "hapi",
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
