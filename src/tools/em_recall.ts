import { z } from "zod";
import { search } from "../search/pipeline.js";
import { getStorage } from "../storage/index.js";
import { MEMORY_KINDS } from "./em_remember.js";
import { defineTool, text } from "./types.js";

export const emRecall = defineTool({
  name: "em_recall",
  description:
    "Recall memories (em_remember) and captured session history — decisions, constraints, errors and their fixes, rejected approaches — matching a query. Without a query, lists the most recent memories. Use at the start of a task to avoid re-deciding or re-breaking things.",
  schema: {
    query: z.string().optional(),
    kind: z.enum(MEMORY_KINDS).optional().describe("Restrict to one memory kind"),
    limit: z.number().int().min(1).max(50).optional(),
    include_session_history: z
      .boolean()
      .optional()
      .describe("Also search captured session events (default true)"),
  },
  handler: async (args, ctx) => {
    const db = getStorage(ctx);
    const limit = args.limit ?? 8;
    const lines: string[] = [];

    if (!args.query) {
      const rows = db.memoryList({ kind: args.kind, limit });
      if (!rows.length)
        return text("no memories yet; use em_remember to record decisions and constraints");
      for (const m of rows) {
        lines.push(
          `#${m.id} [${m.kind}] ${new Date(m.created_at).toISOString().slice(0, 10)} — ${m.content}`,
        );
      }
      return text(lines.join("\n"));
    }

    const sources = args.include_session_history === false ? ["memory"] : ["memory", "session"];
    const r = await search(db, args.query, {
      limit,
      mode: "lexical",
      filters: { source: sources },
    });
    const memories = new Map(db.memoryList({ limit: 1000 }).map((m) => [m.document_id, m]));
    for (const h of r.hits) {
      const d = h.chunk.document;
      const m = memories.get(d.id);
      if (m) {
        if (args.kind && m.kind !== args.kind) continue;
        lines.push(
          `#${m.id} [${m.kind}] ${new Date(m.created_at).toISOString().slice(0, 10)} — ${m.content}`,
        );
      } else if (!args.kind) {
        lines.push(
          `[session ${d.title}] ${new Date(d.created_at).toISOString().slice(0, 10)} — ${h.snippet.replace(/\s+/g, " ")}`,
        );
      }
    }
    if (r.corrections.length)
      lines.unshift(`(corrected: ${r.corrections.map((c) => `${c.from}→${c.to}`).join(", ")})`);
    return text(lines.length ? lines.join("\n") : `nothing recalled for "${args.query}"`);
  },
});
