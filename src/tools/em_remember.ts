import { z } from "zod";
import { kickEmbedding } from "../embeddings/queue.js";
import { indexContent } from "../index/indexer.js";
import { getCurrentSession } from "../session/current.js";
import { getStorage } from "../storage/index.js";
import { defineTool, text } from "./types.js";

export const MEMORY_KINDS = ["decision", "constraint", "fact", "preference", "todo"] as const;

export const emRemember = defineTool({
  name: "em_remember",
  description:
    "Record something worth keeping across sessions: a decision and why, a constraint, a project fact, a user preference or a todo. It is indexed for em_search / em_recall and linked to the graph when related files are given.",
  schema: {
    content: z.string().min(3).describe("The memory, written so it makes sense without context"),
    kind: z.enum(MEMORY_KINDS),
    tags: z.array(z.string()).optional(),
    related_files: z
      .array(z.string())
      .optional()
      .describe("Project-relative paths this memory is about"),
    related_nodes: z
      .array(z.string())
      .optional()
      .describe("Graph node ids (file:…, sym:…, concept:…)"),
  },
  handler: async (args, ctx) => {
    const db = getStorage(ctx);
    const nodeIds = [
      ...(args.related_files ?? []).map((f) => `file:${f.replace(/^\.\//, "")}`),
      ...(args.related_nodes ?? []),
    ];
    const sessionId = getCurrentSession(ctx);
    const body = [
      args.content,
      args.tags?.length ? `tags: ${args.tags.join(", ")}` : "",
      nodeIds.length ? `related: ${nodeIds.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const doc = indexContent(db, {
      source: "memory",
      title: `${args.kind}: ${args.content.slice(0, 60)}`,
      content: body,
      kind: "prose",
      sessionId,
      meta: { kind: args.kind, tags: args.tags ?? [], nodeIds },
    });
    const id = db.memoryInsert({
      kind: args.kind,
      content: args.content,
      tags: args.tags,
      nodeIds,
      sessionId,
      documentId: doc.documentId,
    });
    db.eventInsert({
      sessionId,
      category:
        args.kind === "constraint" ? "constraint" : args.kind === "decision" ? "decision" : "data",
      priority: args.kind === "constraint" || args.kind === "decision" ? 2 : 4,
      payload: { text: args.content.slice(0, 300), by: "em_remember", memoryId: id },
    });
    kickEmbedding(ctx, db);
    return text(`remembered #${id} (${args.kind}): ${args.content.slice(0, 120)}`);
  },
});
