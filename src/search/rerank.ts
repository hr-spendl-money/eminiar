import type { ChunkWithDoc } from "../storage/types.js";

export interface Scored {
  chunk: ChunkWithDoc;
  score: number;
  matched: string[];
}

function positions(body: string, term: string): number[] {
  const out: number[] = [];
  const t = term.endsWith("*") ? term.slice(0, -1) : term;
  if (!t) return out;
  let i = body.indexOf(t);
  while (i !== -1 && out.length < 50) {
    out.push(i);
    i = body.indexOf(t, i + t.length);
  }
  return out;
}

/**
 * Proximity rerank for multi-term queries: +15% when every term occurs inside a
 * 60-char window, +5% for each additional term present, -30% for tiny chunks.
 */
export function rerank(candidates: Scored[], terms: string[]): Scored[] {
  const lower = terms.map((t) => t.toLowerCase());
  for (const c of candidates) {
    const body = c.chunk.body.toLowerCase();
    const title = c.chunk.title.toLowerCase();
    const present = lower.filter(
      (t) => body.includes(t.replace(/\*$/, "")) || title.includes(t.replace(/\*$/, "")),
    );
    c.matched = present;
    // Fragments (a bare heading, a stray line) rank below real content.
    if (c.chunk.body.trim().length < 16) c.score *= 0.7;
    if (lower.length < 2) continue;
    c.score *= 1 + 0.05 * Math.max(0, present.length - 1);
    if (present.length === lower.length && allWithinWindow(body, lower, 60)) c.score *= 1.15;
  }
  return candidates.sort((a, b) => b.score - a.score);
}

function allWithinWindow(body: string, terms: string[], window: number): boolean {
  const lists = terms.map((t) => positions(body, t));
  if (lists.some((l) => !l.length)) return false;
  // Small inputs: brute force over first term's positions.
  for (const p of lists[0]!) {
    if (lists.every((l) => l.some((q) => Math.abs(q - p) <= window))) return true;
  }
  return false;
}
