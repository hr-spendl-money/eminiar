/** Reciprocal rank fusion over several ranked lists of chunk ids. */
export function rrf(lists: Array<{ ids: number[]; weight: number }>, k = 60): Map<number, number> {
  const scores = new Map<number, number>();
  for (const { ids, weight } of lists) {
    ids.forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + weight / (k + rank + 1));
    });
  }
  return scores;
}
