import { z } from "zod";
import { getStorage } from "../storage/index.js";
import { defineTool, errorResult, text } from "./types.js";

export const emPurge = defineTool({
  name: "em_purge",
  description:
    "Permanently delete eminiar data for this project. scope: index (documents/chunks/vectors/caches), sessions (events, snapshots, stats), graph, memories, or all. Requires confirm: true.",
  schema: {
    scope: z.enum(["index", "sessions", "graph", "memories", "all"]),
    confirm: z.boolean().describe("Must be true; this cannot be undone"),
  },
  handler: async (args, ctx) => {
    if (!args.confirm) return errorResult("refusing to purge without confirm: true");
    const db = getStorage(ctx);
    const before = db.countDocuments();
    db.purge(args.scope);
    return text(`purged ${args.scope} for ${ctx.root} (${before} documents before)`);
  },
});
