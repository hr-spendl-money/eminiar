import { z } from "zod";
import { describeRun, execute } from "../sandbox/execute.js";
import { processOutput } from "../sandbox/output.js";
import { formatResults } from "../search/format.js";
import { type SearchResponse, search } from "../search/pipeline.js";
import { recordStat } from "../stats/record.js";
import { getStorage } from "../storage/index.js";
import { defineTool, text } from "./types.js";

const INLINE_LIMIT = 1024;

export const emBatchExecute = defineTool({
  name: "em_batch_execute",
  description:
    "Run several labelled commands in parallel, index every output under its label, and answer `queries` against all of them in the same round trip. Ideal for research: git status + recent commits + test output + dependency list in one call. Small outputs are returned inline; large ones only through the query hits.",
  schema: {
    commands: z
      .array(
        z.object({
          label: z.string().min(1).describe("Section title for this output; make it descriptive"),
          command: z.string().min(1),
          language: z.string().optional().describe("default shell"),
        }),
      )
      .min(1)
      .max(32),
    queries: z.array(z.string()).optional().describe("Questions to answer across all outputs"),
    intent: z.string().optional().describe("Overall goal; used as an extra query"),
    concurrency: z.number().int().min(1).max(8).optional(),
    timeout_ms: z.number().int().min(100).max(600_000).optional(),
    max_tokens: z.number().int().min(100).max(20_000).optional(),
  },
  handler: async (args, ctx) => {
    const started = Date.now();
    const db = getStorage(ctx);
    const concurrency = args.concurrency ?? 4;
    const results: Array<{
      label: string;
      header: string;
      inline?: string | undefined;
      docId?: number | undefined;
      stderr?: string | undefined;
    }> = [];
    let rawChars = 0;

    const queue = [...args.commands];
    const worker = async () => {
      for (;;) {
        const cmd = queue.shift();
        if (!cmd) return;
        try {
          const r = await execute(ctx, {
            language: cmd.language ?? "shell",
            code: cmd.command,
            timeoutMs: args.timeout_ms,
          });
          rawChars += r.stdout.length + r.stderr.length;
          const p = await processOutput(db, ctx, {
            stdout: r.stdout,
            title: cmd.label,
            source: "batch",
            forceIndex: true,
          });
          results.push({
            label: cmd.label,
            header: describeRun(r),
            inline: r.stdout.length <= INLINE_LIMIT ? r.stdout : undefined,
            docId: p.documentId,
            stderr: r.exitCode !== 0 ? r.stderr.trim().slice(-800) : undefined,
          });
        } catch (err) {
          results.push({ label: cmd.label, header: `failed: ${(err as Error).message}` });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));

    const order = new Map(args.commands.map((c, i) => [c.label, i]));
    results.sort((a, b) => (order.get(a.label) ?? 0) - (order.get(b.label) ?? 0));

    const lines: string[] = [];
    for (const r of results) {
      lines.push(`## ${r.label} — ${r.header}${r.docId ? ` · doc ${r.docId}` : ""}`);
      if (r.inline !== undefined) lines.push(r.inline.trimEnd());
      if (r.stderr) lines.push(`stderr: ${r.stderr}`);
      lines.push("");
    }

    const queries = [...(args.queries ?? [])];
    if (args.intent && !queries.includes(args.intent)) queries.unshift(args.intent);
    const docIds = results.map((r) => r.docId).filter((d): d is number => d !== undefined);
    if (queries.length && docIds.length) {
      const responses: SearchResponse[] = [];
      for (const q of queries) {
        responses.push(
          await search(db, q, { limit: 5, mode: "lexical", filters: { documentIds: docIds } }),
        );
      }
      lines.push("# query hits");
      lines.push(formatResults(responses, args.max_tokens ?? 2000));
    }
    const out = lines.join("\n");
    recordStat(ctx, "em_batch_execute", {
      rawChars,
      returnedChars: out.length,
      durationMs: Date.now() - started,
    });
    return text(out);
  },
});
