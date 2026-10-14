import { createRequire } from "node:module";
import type TurndownService from "turndown";

const require = createRequire(import.meta.url);

// Loaded on first fetch rather than at server start: turndown is only needed by
// em_fetch_and_index, and its rule tables are not free to build.
let td: TurndownService | undefined;
function turndown(): TurndownService {
  if (!td) {
    const Turndown = require("turndown") as typeof TurndownService;
    td = new Turndown({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
    });
    td.remove(["script", "style", "noscript", "iframe", "svg", "nav", "footer", "form"]);
  }
  return td;
}

/** Best-effort HTML → markdown without a DOM: strip chrome, keep headings/code/lists/links. */
export function htmlToMarkdown(html: string): { title: string | null; markdown: string } {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
  // Prefer <main>/<article> when present — most docs sites wrap content there.
  const main = /<(main|article)[\s>][\s\S]*?<\/\1>/i.exec(html)?.[0] ?? html;
  let md: string;
  try {
    md = turndown().turndown(main);
  } catch {
    md = main.replace(/<[^>]+>/g, " ");
  }
  md = md.replace(/\n{3,}/g, "\n\n").trim();
  return { title, markdown: md };
}
