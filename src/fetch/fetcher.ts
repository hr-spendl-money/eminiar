import { globalDb } from "../stats/global.js";
import { htmlToMarkdown } from "./html.js";

export interface Fetched {
  url: string;
  title: string | null;
  markdown: string;
  cached: boolean;
  status?: number;
}

const MAX_BYTES = 5 * 1024 * 1024;

/** Fetch a URL as markdown, with a TTL cache in the global DB. */
export async function fetchMarkdown(
  url: string,
  opts: { ttlMs: number; force?: boolean; timeoutMs?: number },
): Promise<Fetched> {
  const g = globalDb();
  if (!opts.force) {
    const hit = g.cacheGet(url);
    if (hit) return { url, title: hit.title, markdown: hit.markdown, cached: true };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "user-agent": "eminiar/0.1 (+local context indexer)",
        accept: "text/html,text/*,application/json",
      },
      redirect: "follow",
    });
    const type = res.headers.get("content-type") ?? "";
    const buf = Buffer.from(await res.arrayBuffer());
    const body = buf.subarray(0, MAX_BYTES).toString("utf8");
    let title: string | null = null;
    let markdown: string;
    if (/html/i.test(type) || /^\s*<(!doctype|html)/i.test(body)) {
      ({ title, markdown } = htmlToMarkdown(body));
    } else if (/json/i.test(type)) {
      try {
        markdown = `\`\`\`json\n${JSON.stringify(JSON.parse(body), null, 1)}\n\`\`\``;
      } catch {
        markdown = body;
      }
    } else {
      markdown = body;
    }
    if (res.ok) g.cacheSet(url, title, markdown, opts.ttlMs);
    return { url, title, markdown, cached: false, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}
