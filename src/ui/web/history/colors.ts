/** Same union as Bucket in ../api.ts; kept local so this module imports nothing (node tests and the web bundle both load it). */
type Bucket = "feat" | "fix" | "refactor" | "perf" | "test" | "docs" | "other";

/**
 * Commit kinds, in a fixed order with fixed hues (validated for adjacent-pair CVD
 * separation; `other` is the neutral bucket). Legends and tags always carry the label
 * too, so identity never rests on colour alone.
 */
export const BUCKET_ORDER: Bucket[] = ["feat", "test", "perf", "refactor", "fix", "docs", "other"];
export const BUCKET_COLORS: Record<Bucket, string> = {
  feat: "#2563eb",
  test: "#16a34a",
  perf: "#d97706",
  refactor: "#7c3aed",
  fix: "#e11d48",
  docs: "#0284c7",
  other: "#9ca3af",
};
export const bucketColor = (b: string): string => BUCKET_COLORS[b as Bucket] ?? BUCKET_COLORS.other;
