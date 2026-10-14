import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { URL } from "node:url";
import { pluginRoot } from "../version.js";
import {
  type ActionInput,
  addMemory,
  ctxFor,
  deleteMemory,
  doctorPayload,
  eventsPayload,
  graphMap,
  graphPayload,
  graphSubgraph,
  listProjects,
  type MemoryWrite,
  memoriesPayload,
  memoryBody,
  renameMemory,
  runAction,
  searchPayload,
  sessionsPayload,
  setMemoryStatus,
  statsPayload,
  updateMemory,
} from "./api.js";
import {
  architecturePayload,
  behaviorPayload,
  changesPayload,
  clustersPayload,
  coveragePayload,
  fileImpactPayload,
  filePayload,
  graphExpand,
  graphPathPayload,
  hotspotsPayload,
  nodeSearchPayload,
  routesPayload,
  runsPayload,
  statusPayload,
  symbolPayload,
  treePayload,
} from "./graph-api.js";

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return (raw ? JSON.parse(raw) : {}) as T;
}

function strList(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === "string")
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return undefined;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/** Where the built frontend lives (`npm run build` writes it next to the node bundles). */
export function uiDir(): string {
  return process.env.EMINIAR_UI_DIR || join(pluginRoot(), "dist", "ui");
}

const FALLBACK_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>eminiar</title>
<style>body{font:14px system-ui;margin:40px;color:#1b1f24;background:#f5f6f8}code{background:#e5e7eb;padding:2px 5px;border-radius:4px}</style></head>
<body><h1>eminiar dashboard</h1><p>The frontend bundle is missing. Run <code>npm run build</code> in the eminiar checkout (or reinstall the package) and reload.</p>
<p>The JSON API is available under <code>/api/*</code>.</p></body></html>`;

/** Only the loopback origins may call the API: blocks DNS-rebinding and cross-site POSTs. */
function originAllowed(req: IncomingMessage, port: number): boolean {
  const host = req.headers.host ?? "";
  const ok = (h: string) =>
    h === `127.0.0.1:${port}` || h === `localhost:${port}` || h === `[::1]:${port}`;
  if (!ok(host)) return false;
  const method = req.method ?? "GET";
  if (method === "GET" || method === "HEAD") return true;
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (!ok(new URL(origin).host)) return false;
    } catch {
      return false;
    }
  }
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") return false;
  const type = String(req.headers["content-type"] ?? "");
  return type.startsWith("application/json");
}

function serveStatic(res: ServerResponse, p: string): boolean {
  const dir = uiDir();
  const rel = p === "/" ? "index.html" : p.replace(/^\/+/, "");
  const file = normalize(join(dir, rel));
  if (!file.startsWith(normalize(dir))) return false;
  if (!existsSync(file) || !statSync(file).isFile()) return false;
  const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
  if (rel === "index.html") {
    // Asset URLs carry the bundle's mtime so a rebuild is never served from cache.
    const stamp = (name: string) => {
      try {
        return `/${name}?v=${Math.floor(statSync(join(dir, name)).mtimeMs)}`;
      } catch {
        return `/${name}`;
      }
    };
    const html = readFileSync(file, "utf8")
      .replace('"/app.global.js"', `"${stamp("app.global.js")}"`)
      .replace('"/styles.css"', `"${stamp("styles.css")}"`);
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    res.end(html);
    return true;
  }
  res.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
  res.end(readFileSync(file));
  return true;
}

/**
 * Local dashboard: binds 127.0.0.1 only. Reads are GET; memory writes and system
 * actions use other methods with a JSON content type and a loopback Origin, so
 * neither a stray link nor a cross-site form can trigger them.
 */
export async function serve(opts: { port: number; open: boolean; root?: string }): Promise<void> {
  const defaultRoot = opts.root;
  const server = createServer(async (req, res) => {
    try {
      if (!originAllowed(req, opts.port)) return json(res, 403, { error: "forbidden origin" });
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const p = url.pathname;
      const q = url.searchParams;
      const root = q.get("root") ?? defaultRoot ?? undefined;
      const ctx = () => ctxFor(root);
      const num = (k: string, d: number) => Number(q.get(k) ?? d) || d;
      const str = (k: string) => q.get(k)?.trim() || undefined;
      const method = req.method ?? "GET";

      if (!p.startsWith("/api/")) {
        if (serveStatic(res, p)) return;
        if (p === "/" || p === "/index.html") {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          return res.end(FALLBACK_PAGE);
        }
        return json(res, 404, { error: "not found" });
      }

      // --- project, stats, status ------------------------------------------------
      if (p === "/api/projects")
        return json(res, 200, { current: ctx().root, projects: listProjects() });
      if (p === "/api/stats") return json(res, 200, statsPayload(ctx()));
      if (p === "/api/status") return json(res, 200, statusPayload(ctx()));
      if (p === "/api/sessions") return json(res, 200, sessionsPayload(ctx(), num("limit", 50)));

      if (p === "/api/search") {
        const query = str("q");
        if (!query) return json(res, 400, { error: "q required" });
        const mode =
          (q.get("mode") as "hybrid" | "lexical" | "semantic" | "regex" | null) ?? "hybrid";
        return json(
          res,
          200,
          await searchPayload(ctx(), query, mode, num("limit", 10), str("source")),
        );
      }

      // --- memories ----------------------------------------------------------------
      if (p === "/api/memories") {
        const name = str("name");
        if (method === "POST") {
          const body = await readJson<MemoryWrite & { tags?: unknown; related?: unknown }>(req);
          if (!body.content?.trim()) return json(res, 400, { error: "content required" });
          try {
            return json(
              res,
              200,
              addMemory(ctx(), {
                kind: body.kind,
                content: body.content.trim(),
                name: body.name?.trim() || undefined,
                tags: strList(body.tags),
                related: strList(body.related),
                status: body.status,
                supersedes: body.supersedes?.trim() || undefined,
              }),
            );
          } catch (err) {
            return json(res, 400, { error: (err as Error).message });
          }
        }
        if (method === "PUT") {
          if (!name) return json(res, 400, { error: "name required" });
          const body = await readJson<MemoryWrite & { tags?: unknown; related?: unknown }>(req);
          if (typeof body.content !== "string")
            return json(res, 400, { error: "content required" });
          try {
            return json(
              res,
              200,
              updateMemory(ctx(), name, {
                kind: body.kind,
                content: body.content,
                tags: strList(body.tags),
                related: strList(body.related),
                status: body.status,
                supersedes: body.supersedes?.trim() || undefined,
              }),
            );
          } catch (err) {
            return json(res, 400, { error: (err as Error).message });
          }
        }
        if (method === "PATCH") {
          if (!name) return json(res, 400, { error: "name required" });
          const body = await readJson<{ to?: string; status?: string }>(req);
          try {
            if (body.status) return json(res, 200, setMemoryStatus(ctx(), name, body.status));
            if (!body.to?.trim()) return json(res, 400, { error: "to or status required" });
            return json(res, 200, renameMemory(ctx(), name, body.to.trim()));
          } catch (err) {
            return json(res, 400, { error: (err as Error).message });
          }
        }
        if (method === "DELETE") {
          const removed = deleteMemory(ctx(), name || num("id", 0));
          return json(res, 200, { ok: removed });
        }
        if (name) {
          const m = memoryBody(ctx(), name);
          return m ? json(res, 200, m) : json(res, 404, { error: "not found" });
        }
        return json(
          res,
          200,
          memoriesPayload(ctx(), { kind: str("kind"), topic: str("topic"), status: str("status") }),
        );
      }

      // --- graph -------------------------------------------------------------------
      if (p === "/api/graph") {
        const mode = q.get("mode") ?? "impact";
        const node = q.get("node") ?? "";
        if (mode === "map")
          return json(
            res,
            200,
            graphMap(ctx(), {
              limit: num("limit", 150),
              coChanges: q.get("cochanges") !== "0",
              pathFilter: str("path"),
            }),
          );
        if (mode === "subgraph")
          return json(
            res,
            200,
            graphSubgraph(ctx(), node, {
              depth: num("depth", 1),
              limit: num("limit", 120),
              kinds: strList(q.get("kinds")),
            }),
          );
        if (mode === "expand") {
          if (!node) return json(res, 400, { error: "node required" });
          return json(
            res,
            200,
            graphExpand(ctx(), {
              node,
              direction: (q.get("direction") as "out" | "in" | "both" | null) ?? "both",
              kinds: strList(q.get("kinds")),
              depth: num("depth", 1),
              limit: num("limit", 150),
            }),
          );
        }
        if (mode === "path") {
          const to = str("to");
          if (!node || !to) return json(res, 400, { error: "node and to required" });
          return json(res, 200, graphPathPayload(ctx(), node, to));
        }
        return json(res, 200, graphPayload(ctx(), node, mode, num("limit", 25)));
      }
      if (p === "/api/nodes/search") {
        const query = str("q");
        if (!query) return json(res, 400, { error: "q required" });
        return json(
          res,
          200,
          nodeSearchPayload(ctx(), query, { kind: str("kind"), limit: num("limit", 15) }),
        );
      }

      // --- explorer ----------------------------------------------------------------
      if (p === "/api/tree") return json(res, 200, treePayload(ctx()));
      if (p === "/api/file") {
        const path = str("path");
        if (!path) return json(res, 400, { error: "path required" });
        try {
          const f = filePayload(ctx(), path);
          return json(res, "error" in f ? 404 : 200, f);
        } catch (err) {
          return json(res, 403, { error: (err as Error).message });
        }
      }
      if (p === "/api/file-impact") {
        const path = str("path");
        if (!path) return json(res, 400, { error: "path required" });
        return json(res, 200, fileImpactPayload(ctx(), path));
      }
      if (p === "/api/symbol") {
        const id = str("id");
        if (!id) return json(res, 400, { error: "id required" });
        return json(res, 200, symbolPayload(ctx(), id));
      }
      if (p === "/api/behavior") {
        const id = str("id");
        if (!id) return json(res, 400, { error: "id required" });
        return json(res, 200, behaviorPayload(ctx(), id));
      }

      // --- architecture, coverage, changes -----------------------------------------
      if (p === "/api/architecture")
        return json(res, 200, architecturePayload(ctx(), strList(q.get("aspects"))));
      if (p === "/api/hotspots")
        return json(
          res,
          200,
          hotspotsPayload(ctx(), {
            kind: (q.get("kind") as "file" | "symbol" | null) ?? "file",
            path: str("path"),
            limit: num("limit", 50),
          }),
        );
      if (p === "/api/routes") return json(res, 200, routesPayload(ctx()));
      if (p === "/api/clusters") return json(res, 200, clustersPayload(ctx()));
      if (p === "/api/coverage") return json(res, 200, coveragePayload(ctx()));
      if (p === "/api/changes") return json(res, 200, changesPayload(ctx(), str("ref")));
      if (p === "/api/runs") return json(res, 200, runsPayload(ctx()));

      // --- sessions, doctor, actions -----------------------------------------------
      if (p === "/api/events")
        return json(
          res,
          200,
          eventsPayload(ctx(), {
            limit: num("limit", 100),
            session: str("session"),
            categories: strList(q.get("category")),
          }),
        );
      if (p === "/api/doctor") return json(res, 200, await doctorPayload(q.get("fix") === "1"));
      if (p === "/api/actions") {
        if (method !== "POST") return json(res, 405, { error: "POST only" });
        const body = await readJson<ActionInput & { glob?: unknown; paths?: unknown }>(req);
        if (!body.action) return json(res, 400, { error: "action required" });
        return json(
          res,
          200,
          await runAction(ctx(), { ...body, glob: strList(body.glob), paths: strList(body.paths) }),
        );
      }

      json(res, 404, { error: "not found" });
    } catch (err) {
      json(res, 500, { error: (err as Error).message });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${opts.port}/`;
  console.log(`eminiar dashboard at ${url} (Ctrl-C to stop)`);
  if (opts.open) {
    const cmd =
      process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  }
  await new Promise(() => undefined);
}
