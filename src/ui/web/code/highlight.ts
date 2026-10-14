import Prism from "prismjs";
import "prismjs/components/prism-javascript.js";
import "prismjs/components/prism-typescript.js";
import "prismjs/components/prism-jsx.js";
import "prismjs/components/prism-tsx.js";
import "prismjs/components/prism-python.js";
import "prismjs/components/prism-go.js";
import "prismjs/components/prism-json.js";
import "prismjs/components/prism-markdown.js";
import "prismjs/components/prism-bash.js";

const escapeHtml = (s: string): string =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);

/** One HTML string per line (line boundaries survive highlighting so rows line up). */
export function highlightLines(code: string, lang: string): string[] {
  const grammar = Prism.languages[lang];
  if (!grammar) return code.split("\n").map(escapeHtml);
  // Highlight the whole file once, then split the HTML at line breaks while keeping
  // open spans balanced per line.
  const html = Prism.highlight(code, grammar, lang);
  const out: string[] = [];
  const open: string[] = [];
  let cur = "";
  const tokens = html.split(/(<span[^>]*>|<\/span>|\n)/);
  for (const t of tokens) {
    if (t === "\n") {
      out.push(cur + "</span>".repeat(open.length));
      cur = open.join("");
    } else if (t.startsWith("<span")) {
      open.push(t);
      cur += t;
    } else if (t === "</span>") {
      open.pop();
      cur += t;
    } else cur += t;
  }
  out.push(cur + "</span>".repeat(open.length));
  return out;
}
