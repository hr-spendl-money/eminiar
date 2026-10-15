import type { HistoryCommit, HistoryModel } from "./model.js";

/**
 * Which commits belong to which branch, for the history graph. A branch's own commits
 * are its first-parent chain down to the mainline (the base branch's first-parent
 * chain), so a feature branch merged with a merge commit keeps its commits even after
 * main has moved on. Branches deleted after merging come back from the mainline merge
 * subjects ("Merge pull request #12 from owner/feature/x", "Merge branch 'x'"): the
 * merge's second parent is the old tip. Merge commits inside a branch (main merged
 * into the feature) are walked through but not listed.
 */
export interface BranchLineage {
  name: string;
  /** Own non-merge commits, newest first. */
  commits: string[];
  /** Newest own commit (or the tip) time. */
  tipAt: number;
  isDefault: boolean;
  /** A ref still exists (local, or remote with no local of the same name). */
  live: boolean;
  merged: boolean;
  /** PR numbers of the mainline merges that brought it in. */
  prs: number[];
  /** Mainline merge commits that brought it in. */
  merges: string[];
}

const PR_MERGE = /^Merge pull request #(\d+) from [^/\s]+\/(\S+)/;
const BRANCH_MERGE = /^Merge (?:remote-tracking )?branch '([^']+)'/;

/** The branch a mainline merge commit brought in, from its subject. */
export function mergedBranchName(subject: string): { name: string; pr?: number } | undefined {
  const pr = PR_MERGE.exec(subject);
  if (pr) return { name: pr[2]!, pr: Number(pr[1]) };
  const br = BRANCH_MERGE.exec(subject);
  if (br) return { name: br[1]!.replace(/^origin\//, "") };
  return undefined;
}

/** The first-parent chain from `sha`, stopping at `stop` or outside the loaded window. */
function firstParents(
  m: HistoryModel,
  sha: string | undefined,
  stop: Set<string>,
  max: number,
): HistoryCommit[] {
  const out: HistoryCommit[] = [];
  let cur = sha ? m.bySha.get(sha) : undefined;
  while (cur && !stop.has(cur.sha) && out.length < max) {
    out.push(cur);
    cur = cur.parents[0] ? m.bySha.get(cur.parents[0]) : undefined;
  }
  return out;
}

export function branchLineage(m: HistoryModel, opts: { maxPerBranch?: number } = {}) {
  const max = opts.maxPerBranch ?? 500;
  const def =
    m.branches.find((b) => b.isDefault && !b.remote) ?? m.branches.find((b) => b.isDefault);
  const defaultName = def
    ? def.remote
      ? def.name.replace(/^[^/]+\//, "")
      : def.name
    : (m.base ?? "main");
  const mainline = firstParents(m, def?.sha ?? m.head, new Set(), 100_000);
  const onMain = new Set(mainline.map((c) => c.sha));

  const byName = new Map<string, BranchLineage>();
  const entry = (name: string): BranchLineage => {
    let b = byName.get(name);
    if (!b) {
      b = {
        name,
        commits: [],
        tipAt: 0,
        isDefault: name === defaultName,
        live: false,
        merged: false,
        prs: [],
        merges: [],
      };
      byName.set(name, b);
    }
    return b;
  };
  const own = new Map<string, Set<string>>();
  const add = (name: string, cs: HistoryCommit[]) => {
    const set = own.get(name) ?? new Set<string>();
    for (const c of cs) if (!c.merge) set.add(c.sha);
    own.set(name, set);
    const b = entry(name);
    for (const c of cs) b.tipAt = Math.max(b.tipAt, c.at);
  };

  // The default branch owns the commits made straight on the mainline.
  add(defaultName, mainline);
  entry(defaultName).live = !!def;

  // Branches merged into the mainline, whether or not their ref survives.
  for (const c of mainline) {
    if (!c.merge || c.parents.length < 2) continue;
    const found = mergedBranchName(c.subject);
    const name = found?.name ?? (c.pr ? `PR #${c.pr}` : `merge ${c.short}`);
    if (name === defaultName) continue;
    add(name, firstParents(m, c.parents[1], onMain, max));
    const b = entry(name);
    b.merged = true;
    b.merges.push(c.sha);
    const pr = found?.pr ?? c.pr;
    if (pr && !b.prs.includes(pr)) b.prs.push(pr);
  }

  // Live refs: locals first, then remotes that have no local of the same name.
  const locals = new Set(m.branches.filter((b) => !b.remote).map((b) => b.name));
  for (const ref of [...m.branches].sort((a, b) => Number(a.remote) - Number(b.remote))) {
    if (ref.isDefault) continue;
    const name = ref.remote ? ref.name.replace(/^[^/]+\//, "") : ref.name;
    if (ref.remote && (locals.has(name) || name === "HEAD" || !name)) continue;
    if (name === defaultName) continue;
    add(name, firstParents(m, ref.sha, onMain, max));
    const b = entry(name);
    b.live = true;
    b.merged ||= ref.merged;
    if (!b.tipAt) b.tipAt = ref.at;
  }

  for (const [name, set] of own) {
    entry(name).commits = [...set]
      .map((s) => m.bySha.get(s)!)
      .sort((a, b) => b.at - a.at)
      .map((c) => c.sha);
  }
  const branches = [...byName.values()];
  /** Commit sha → the branches that own it. */
  const ownerOf = new Map<string, string[]>();
  for (const b of branches)
    for (const s of b.commits) ownerOf.set(s, [...(ownerOf.get(s) ?? []), b.name]);
  return { defaultName, branches, ownerOf };
}
