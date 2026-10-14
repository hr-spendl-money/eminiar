import type { VocabTerm } from "./types.js";

/**
 * Words too common to help anyone search; the FTS porter tokenizer keeps them, so
 * they used to crowd the "searchable terms" list of every large output.
 */
const STOP = new Set([
  "the",
  "and",
  "for",
  "are",
  "but",
  "not",
  "you",
  "all",
  "any",
  "can",
  "had",
  "her",
  "was",
  "one",
  "our",
  "out",
  "has",
  "his",
  "how",
  "its",
  "may",
  "new",
  "now",
  "old",
  "see",
  "two",
  "way",
  "who",
  "did",
  "get",
  "let",
  "say",
  "she",
  "too",
  "use",
  "with",
  "that",
  "this",
  "from",
  "they",
  "have",
  "been",
  "were",
  "will",
  "your",
  "what",
  "when",
  "then",
  "than",
  "them",
  "there",
  "their",
  "which",
  "would",
  "could",
  "should",
  "about",
  "into",
  "also",
  "more",
  "some",
  "such",
  "only",
  "other",
  "these",
  "those",
  "being",
  "over",
  "after",
  "before",
  "where",
  "while",
]);

const TOKEN = /[\p{L}\p{N}]+/gu;

/**
 * Terms by document frequency across `bodies` (how many bodies contain each term),
 * numbers last, ties alphabetical. Pure JS over just the given text, so the cost is
 * proportional to the output being summarised rather than to the size of the index.
 */
export function topTermsOf(bodies: Iterable<string>, limit: number): VocabTerm[] {
  const df = new Map<string, number>();
  for (const body of bodies) {
    const seen = new Set<string>();
    for (const m of body.toLowerCase().matchAll(TOKEN)) {
      const t = m[0];
      if (t.length < 3 || seen.has(t) || STOP.has(t)) continue;
      seen.add(t);
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }
  const isNum = (t: string) => t.charCodeAt(0) >= 48 && t.charCodeAt(0) <= 57;
  return [...df.entries()]
    .sort((a, b) => {
      const na = isNum(a[0]) ? 1 : 0;
      const nb = isNum(b[0]) ? 1 : 0;
      if (na !== nb) return na - nb;
      if (a[1] !== b[1]) return b[1] - a[1];
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    })
    .slice(0, limit)
    .map(([term, d]) => ({ term, df: d }));
}
