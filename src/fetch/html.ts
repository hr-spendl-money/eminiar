import TurndownService from "turndown";

const td = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});
td.remove(["script", "style", "noscript", "iframe", "svg", "nav", "footer", "form"]);

/** Best-effort HTML → markdown without a DOM: strip chrome, keep headings/code/lists/links. */
export function htmlToMarkdown(html: string): { title: string | null; markdown: string } {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
  // Prefer <main>/<article> when present — most docs sites wrap content there.
  const main = /<(main|article)[\s>][\s\S]*?<\/\1>/i.exec(html)?.[0] ?? html;
  let md: string;
  try {
    md = td.turndown(main);
  } catch {
    md = main.replace(/<[^>]+>/g, " ");
  }
  md = md.replace(/\n{3,}/g, "\n\n").trim();
  return { title, markdown: md };
}
