import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
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
  statsPayload,
  updateMemory,
} from "./api.js";
import { PAGE } from "./page.js";

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

/**
 * Local dashboard: binds 127.0.0.1 only, no auth needed because only this user
 * can reach it. Reads are GET; memory writes and system actions are POST/PUT/
 * PATCH/DELETE so a stray link cannot trigger them.
 */
export async function serve(opts: { port: number; open: boolean; root?: string }): Promise<void> {
  const defaultRoot = opts.root;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const p = url.pathname;
      const q = url.searchParams;
      const root = q.get("root") ?? defaultRoot ?? undefined;
      const ctx = () => ctxFor(root);
      const num = (k: string, d: number) => Number(q.get(k) ?? d) || d;
      const method = req.method ?? "GET";

      if (p === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(PAGE);
      }
      if (p === "/api/projects")
        return json(res, 200, { current: ctx().root, projects: listProjects() });
      if (p === "/api/stats") return json(res, 200, statsPayload(ctx()));
      if (p === "/api/sessions") return json(res, 200, sessionsPayload(ctx(), num("limit", 50)));

      if (p === "/api/search") {
        const query = q.get("q")?.trim();
        if (!query) return json(res, 400, { error: "q required" });
        const mode =
          (q.get("mode") as "hybrid" | "lexical" | "semantic" | "regex" | null) ?? "hybrid";
        return json(
          res,
          200,
          await searchPayload(ctx(), query, mode, num("limit", 10), q.get("source") ?? undefined),
        );
      }

      if (p === "/api/memories") {
        const name = q.get("name")?.trim();
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
              }),
            );
          } catch (err) {
            return json(res, 400, { error: (err as Error).message });
          }
        }
        if (method === "PATCH") {
          if (!name) return json(res, 400, { error: "name required" });
          const body = await readJson<{ to?: string }>(req);
          if (!body.to?.trim()) return json(res, 400, { error: "to required" });
          try {
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
          memoriesPayload(ctx(), {
            kind: q.get("kind") ?? undefined,
            topic: q.get("topic") ?? undefined,
          }),
        );
      }

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
              pathFilter: q.get("path") ?? undefined,
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
        return json(res, 200, graphPayload(ctx(), node, mode, num("limit", 25)));
      }

      if (p === "/api/events")
        return json(
          res,
          200,
          eventsPayload(ctx(), {
            limit: num("limit", 100),
            session: q.get("session") ?? undefined,
            categories: strList(q.get("category")),
          }),
        );
      if (p === "/api/doctor") return json(res, 200, await doctorPayload(q.get("fix") === "1"));

      if (p === "/api/actions") {
        if (method !== "POST") return json(res, 405, { error: "POST only" });
        const body = await readJson<ActionInput & { glob?: unknown }>(req);
        if (!body.action) return json(res, 400, { error: "action required" });
        return json(res, 200, await runAction(ctx(), { ...body, glob: strList(body.glob) }));
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
