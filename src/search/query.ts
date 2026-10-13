export interface ParsedQuery {
  /** Individual terms (lower-cased), identifiers kept whole. */
  terms: string[];
  /** Quoted phrases, matched as-is. */
  phrases: string[];
}

const STOP = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "is",
  "are",
  "was",
  "it",
  "this",
  "that",
  "with",
  "as",
  "by",
  "at",
  "be",
  "from",
  "how",
  "what",
  "why",
  "when",
  "where",
  "do",
  "does",
]);

/** Tokenise a user query: pull out "quoted phrases", then words/identifiers. */
export function parseQuery(q: string): ParsedQuery {
  const phrases: string[] = [];
  const rest = q.replace(/"([^"]+)"/g, (_m, p: string) => {
    phrases.push(p.trim().toLowerCase());
    return " ";
  });
  const terms = rest
    .toLowerCase()
    .split(/[^\p{L}\p{N}_.\-/]+/u)
    .map((t) => t.replace(/^[.\-/]+|[.\-/]+$/g, ""))
    .filter((t) => t.length >= 2 && !STOP.has(t));
  return { terms: [...new Set(terms)], phrases };
}

function quote(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Build FTS5 MATCH expressions. `and` requires every term; `or` any. Terms with a
 * trailing `*` are prefix queries (used for typo-corrected stems).
 */
export function buildMatch(
  parsed: ParsedQuery,
  mode: "and" | "or",
  minLen = 1,
): string | undefined {
  const parts: string[] = [];
  for (const p of parsed.phrases) parts.push(quote(p));
  for (const t of parsed.terms) {
    if (t.length < minLen) continue;
    // Identifiers like foo.bar or a/b/c: FTS5 tokenises on punctuation, so quote
    // them as a phrase so the token sequence must match in order.
    if (t.endsWith("*")) parts.push(`${quote(t.slice(0, -1))}*`);
    else parts.push(quote(t));
  }
  if (!parts.length) return undefined;
  return parts.join(mode === "and" ? " " : " OR ");
}
