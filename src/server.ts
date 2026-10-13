import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getContext } from "./context.js";
import { kickEmbedding } from "./embeddings/queue.js";
import { drainReindexQueue } from "./graph/reindex.js";
import { markServerAlive } from "./session/server-alive.js";
import { getStorage } from "./storage/index.js";
import { tools } from "./tools/index.js";
import { errorResult } from "./tools/types.js";
import { pluginRoot, version } from "./version.js";

// `em-server --probe` is the installer's and doctor's cheap "can this copy start?" check:
// reaching this line means every static import above (better-sqlite3, sqlite-vec, the MCP
// SDK) resolved, which is exactly what fails when Claude Code launches a cache copy that
// has no node_modules.
if (process.argv.includes("--probe")) {
  process.stdout.write(`eminiar ${version()} ok root=${pluginRoot()} node=${process.execPath}\n`);
  process.exit(0);
}

const server = new McpServer({ name: "eminiar", version: version() });

for (const tool of tools) {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      // Every tool accepts an optional project_root because the MCP server is not told
      // CLAUDE_PROJECT_DIR; without it the root is resolved from cwd.
      inputSchema: { ...tool.schema, project_root: z.string().optional() },
    },
    async (args: Record<string, unknown>) => {
      const { project_root, ...rest } = args;
      try {
        const ctx = getContext(typeof project_root === "string" ? project_root : undefined);
        // Files edited since the last call get re-parsed before any tool runs.
        if (!tool.name.startsWith("em_graph") && tool.name !== "em_reindex") {
          await drainReindexQueue(ctx, getStorage(ctx)).catch(() => undefined);
        }
        return await tool.handler(rest, ctx);
      } catch (err) {
        return errorResult(`${tool.name} failed: ${(err as Error).stack ?? String(err)}`);
      }
    },
  );
}

await server.connect(new StdioServerTransport());

// Leave a pid marker so the PreToolUse hook knows an em_* server is reachable for this
// project and may safely deny native calls in enforce mode. The marker goes away on any
// orderly exit; the hook discards markers whose pid no longer exists.
try {
  const unmark = markServerAlive(getContext());
  process.on("exit", unmark);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
    process.on(sig, () => process.exit(0));
  // A stdio server has no reason to outlive its client.
  process.stdin.on("end", () => process.exit(0));
} catch (err) {
  process.stderr.write(`eminiar: liveness marker skipped: ${(err as Error).message}\n`);
}

// Warm the project in the background so the first em_* call is fast: parse
// changed code into the graph, refresh git signals, embed pending chunks.
const warm = setTimeout(async () => {
  try {
    const ctx = getContext();
    const db = getStorage(ctx);
    const { reindexCode, reindexGitSignals } = await import("./graph/reindex.js");
    await reindexCode(ctx, db);
    try {
      reindexGitSignals(ctx, db);
    } catch {
      // not a git repo
    }
    kickEmbedding(ctx, db, 100);
  } catch (err) {
    process.stderr.write(`eminiar: warm-up skipped: ${(err as Error).message}\n`);
  }
}, 3000);
warm.unref();
