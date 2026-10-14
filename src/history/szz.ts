import { blameOrigins, type CommitRecord, diffRanges } from "./log.js";

/** A fix commit removed lines that `origin` had written: the change the fix repaired. */
export interface BugLink {
  fix: string;
  origin: string;
  path: string;
  /** Non-trivial removed lines attributed to `origin`. */
  lines: number;
}

/** Files whose removed lines say nothing about logic errors. */
const SKIP_PATH =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|go\.sum|Cargo\.lock|poetry\.lock)$|\.(md|mdx|txt|rst|svg|png|jpe?g|gif|ico|woff2?|lock|snap|min\.js|map)$|(^|\/)(dist|build|vendor|node_modules)\//i;

export interface TraceOptions {
  /** Files examined per fix (largest deletions first). */
  maxFiles?: number | undefined;
  /** Files with more removed lines than this are rewrites, not fixes; skipped. */
  maxRemovedLines?: number | undefined;
  /** Blame calls allowed for this fix. */
  budget?: { blames: number };
}

/**
 * SZZ-style trace: for a fix commit, blame the lines it removed (as they stood just
 * before the fix) and attribute them to the commits that last wrote them. Those
 * commits are the likely bug-introducing changes. Whitespace and brace-only lines are
 * ignored; the fix itself and merges are never their own origin.
 */
export function traceFixOrigins(
  root: string,
  fix: CommitRecord,
  opts: TraceOptions = {},
): BugLink[] {
  if (fix.parents.length !== 1) return [];
  const maxFiles = opts.maxFiles ?? 6;
  const maxRemoved = opts.maxRemovedLines ?? 400;
  const files = fix.files
    .filter((f) => !f.binary && f.deleted > 0 && f.deleted <= maxRemoved && !SKIP_PATH.test(f.path))
    .sort((a, b) => b.deleted - a.deleted)
    .slice(0, maxFiles);
  const links: BugLink[] = [];
  for (const f of files) {
    if (opts.budget && opts.budget.blames <= 0) break;
    const { removed } = diffRanges(root, fix.sha, f.path);
    if (!removed.length) continue;
    if (opts.budget) opts.budget.blames--;
    const origins = blameOrigins(root, fix.sha, f.path, removed);
    for (const [origin, lines] of origins) {
      if (origin === fix.sha || lines <= 0) continue;
      links.push({ fix: fix.sha, origin, path: f.path, lines });
    }
  }
  return links;
}
