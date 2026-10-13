import type { StorageAdapter } from "../storage/adapter.js";

/** Damerau-Levenshtein (optimal string alignment) distance, capped at `max`+1 for speed. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let cur = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2]! + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2.splice(0, prev2.length, ...prev);
    [prev, cur] = [cur, prev];
  }
  return prev[b.length]!;
}

export interface Correction {
  from: string;
  to: string;
}

/**
 * Replace query terms that do not occur in the index with the closest vocabulary
 * term. The vocabulary holds porter stems, so a correction is returned as a
 * prefix query (`stem*`). Short terms allow 1 edit, longer ones 2.
 */
export function correctTerms(
  db: StorageAdapter,
  terms: string[],
): { terms: string[]; corrections: Correction[] } {
  const corrections: Correction[] = [];
  const out = terms.map((term) => {
    if (term.length < 4 || /[^a-z0-9]/.test(term) || db.termExists(term)) return term;
    const max = term.length >= 7 ? 2 : 1;
    const candidates = db.vocabCandidates(term[0]!, 3000);
    let best: { term: string; d: number; df: number } | undefined;
    for (const c of candidates) {
      if (c.term.length < 3) continue;
      const d = editDistance(term, c.term, max);
      if (d > max) continue;
      if (!best || d < best.d || (d === best.d && c.df > best.df))
        best = { term: c.term, d, df: c.df };
    }
    if (!best) return term;
    corrections.push({ from: term, to: best.term });
    return `${best.term}*`;
  });
  return { terms: out, corrections };
}
