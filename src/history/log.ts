import { spawnSync } from "node:child_process";

/** One file's change inside a commit (from `git log --numstat`). */
export interface CommitFile {
  path: string;
  added: number;
  deleted: number;
  binary: boolean;
  renamedFrom?: string | undefined;
}

/** A commit as git reports it, before classification or analysis. */
export interface CommitRecord {
  sha: string;
  parents: string[];
  author: string;
  email: string;
  /** Author time, ms since epoch. */
  at: number;
  subject: string;
  body: string;
  /** Decorations: branch names (`main`, `origin/main`) and `tag: v1.2.0`. */
  refs: string[];
  files: CommitFile[];
}

export interface BranchRef {
  name: string;
  sha: string;
  at: number;
  remote: boolean;
  current: boolean;
  upstream?: string | undefined;
}

export interface TagRef {
  name: string;
  sha: string;
  at: number;
}

const MAX_BUFFER = 256 * 1024 * 1024;

export function git(root: string, args: string[], opts: { allowFail?: boolean } = {}): string {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: MAX_BUFFER });
  if (r.status !== 0) {
    if (opts.allowFail) return "";
    throw new Error((r.stderr || `git ${args[0]} failed`).trim());
  }
  return r.stdout ?? "";
}

export function isGitRepo(root: string): boolean {
  return git(root, ["rev-parse", "--is-inside-work-tree"], { allowFail: true }).trim() === "true";
}

export function headSha(root: string): string | undefined {
  return git(root, ["rev-parse", "HEAD"], { allowFail: true }).trim() || undefined;
}

export function currentBranch(root: string): string | undefined {
  const b = git(root, ["rev-parse", "--abbrev-ref", "HEAD"], { allowFail: true }).trim();
  return b && b !== "HEAD" ? b : undefined;
}

/** `a/{old => new}/b.ts` and `old => new` (numstat rename notation) → the new path. */
export function renamePath(raw: string): { path: string; from?: string | undefined } {
  const braces = /\{([^{}]*) => ([^{}]*)\}/.exec(raw);
  if (braces) {
    const path = raw.replace(braces[0], braces[2] ?? "").replace(/\/\//g, "/");
    const from = raw.replace(braces[0], braces[1] ?? "").replace(/\/\//g, "/");
    return { path, from };
  }
  const arrow = raw.indexOf(" => ");
  if (arrow !== -1) return { path: raw.slice(arrow + 4), from: raw.slice(0, arrow) };
  return { path: raw };
}

/**
 * Commits with numstat, newest first. `all` walks every ref (branches included),
 * otherwise only HEAD's ancestry. Paths are relative to `root` so they match graph ids.
 */
export function readCommits(
  root: string,
  opts: {
    maxCommits: number;
    all?: boolean | undefined;
    range?: string | undefined;
    paths?: string[] | undefined;
  },
): CommitRecord[] {
  const args = [
    "log",
    "--numstat",
    "--relative",
    "--full-history",
    "--no-color",
    "--format=%x00%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1f%b%x1e",
    "-n",
    String(opts.maxCommits),
  ];
  if (opts.all) args.push("--all");
  if (opts.range) args.push(opts.range);
  if (opts.paths?.length) args.push("--", ...opts.paths);
  else args.push("--", ".");
  const out = git(root, args, { allowFail: true });
  return parseLog(out);
}

export function parseLog(out: string): CommitRecord[] {
  const commits: CommitRecord[] = [];
  for (const block of out.split("\u0000")) {
    if (!block.trim()) continue;
    const end = block.indexOf("\u001e");
    const header = end === -1 ? block : block.slice(0, end);
    const rest = end === -1 ? "" : block.slice(end + 1);
    const [sha, parents, author, email, at, refs, subject, body] = header.split("\u001f");
    if (!sha) continue;
    const files: CommitFile[] = [];
    for (const line of rest.split("\n")) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
      if (!m) continue;
      const binary = m[1] === "-";
      const { path, from } = renamePath(m[3] ?? "");
      files.push({
        path,
        added: binary ? 0 : Number(m[1]),
        deleted: binary ? 0 : Number(m[2]),
        binary,
        renamedFrom: from,
      });
    }
    commits.push({
      sha,
      parents: (parents ?? "").split(" ").filter(Boolean),
      author: author || "?",
      email: email ?? "",
      at: Number(at) * 1000,
      subject: (subject ?? "").trim(),
      body: (body ?? "").trim(),
      refs: (refs ?? "")
        .split(", ")
        .map((r) => r.replace(/^HEAD -> /, "").trim())
        .filter((r) => r && r !== "HEAD"),
      files,
    });
  }
  return commits;
}

/** Shas reachable from `ref`, capped. */
export function reachable(root: string, ref: string, max: number): Set<string> {
  const out = git(root, ["rev-list", "-n", String(max), ref], { allowFail: true });
  return new Set(
    out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function readBranches(root: string): BranchRef[] {
  const out = git(
    root,
    [
      "for-each-ref",
      "--format=%(refname)%1f%(refname:short)%1f%(objectname)%1f%(committerdate:unix)%1f%(upstream:short)%1f%(HEAD)",
      "refs/heads",
      "refs/remotes",
    ],
    { allowFail: true },
  );
  const refs: BranchRef[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [full, name, sha, at, upstream, head] = line.split("\u001f");
    if (!full || !name || !sha || name.endsWith("/HEAD")) continue;
    refs.push({
      name,
      sha,
      at: Number(at) * 1000,
      remote: full.startsWith("refs/remotes/"),
      current: head?.trim() === "*",
      upstream: upstream || undefined,
    });
  }
  return refs;
}

export function readTags(root: string): TagRef[] {
  const out = git(
    root,
    [
      "for-each-ref",
      "--format=%(refname:short)%1f%(if)%(*objectname)%(then)%(*objectname)%(else)%(objectname)%(end)%1f%(creatordate:unix)",
      "refs/tags",
    ],
    { allowFail: true },
  );
  const tags: TagRef[] = [];
  for (const line of out.split("\n")) {
    const [name, sha, at] = line.split("\u001f");
    if (name && sha) tags.push({ name, sha, at: Number(at) * 1000 });
  }
  return tags.sort((a, b) => b.at - a.at);
}

/** The integration branch: origin/HEAD's target, else main/master, else the current branch. */
export function defaultBranch(root: string, branches: BranchRef[]): string | undefined {
  const sym = git(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], {
    allowFail: true,
  }).trim();
  if (sym) {
    const local = sym.replace(/^origin\//, "");
    if (branches.some((b) => b.name === local && !b.remote)) return local;
    return sym;
  }
  for (const cand of ["main", "master", "develop", "trunk"])
    if (branches.some((b) => b.name === cand && !b.remote)) return cand;
  return branches.find((b) => b.current)?.name ?? branches[0]?.name;
}

/** Commits only on `branch` (ahead) and only on `base` (behind). */
export function aheadBehind(
  root: string,
  base: string,
  branch: string,
): { ahead: number; behind: number } {
  const out = git(root, ["rev-list", "--left-right", "--count", `${base}...${branch}`], {
    allowFail: true,
  }).trim();
  const [behind, ahead] = out.split(/\s+/).map(Number);
  return { ahead: ahead || 0, behind: behind || 0 };
}

/** Names of refs already merged into `target`. */
export function mergedInto(root: string, target: string): Set<string> {
  const out = git(
    root,
    [
      "for-each-ref",
      `--merged=${target}`,
      "--format=%(refname:short)",
      "refs/heads",
      "refs/remotes",
    ],
    { allowFail: true },
  );
  return new Set(
    out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** Modified, added, renamed and untracked paths in the working tree. */
export function workingTreeFiles(root: string): string[] {
  const out = git(root, ["status", "--porcelain", "--untracked-files=all"], { allowFail: true });
  const files: string[] = [];
  for (const line of out.split("\n")) {
    if (line.length < 4) continue;
    let p = line.slice(3).trim();
    const arrow = p.indexOf(" -> ");
    if (arrow !== -1) p = p.slice(arrow + 4);
    if (p) files.push(p.replace(/^"|"$/g, ""));
  }
  return files;
}

export type LineRange = [number, number];

/** Old-side (`-a,b`) and new-side (`+a,b`) ranges of a commit's diff for one file. */
export function diffRanges(
  root: string,
  sha: string,
  path: string,
): { removed: LineRange[]; added: LineRange[] } {
  const parent = `${sha}^`;
  const out = git(
    root,
    ["diff", "--unified=0", "--no-color", "--no-ext-diff", "--relative", parent, sha, "--", path],
    { allowFail: true },
  );
  const removed: LineRange[] = [];
  const added: LineRange[] = [];
  for (const line of out.split("\n")) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m) continue;
    const rs = Number(m[1]);
    const rl = m[2] === undefined ? 1 : Number(m[2]);
    const as = Number(m[3]);
    const al = m[4] === undefined ? 1 : Number(m[4]);
    if (rl > 0) removed.push([rs, rs + rl - 1]);
    if (al > 0) added.push([as, as + al - 1]);
  }
  return { removed, added };
}

/** Lines of code that carry no logic; removing them tells nothing about who introduced a bug. */
const TRIVIAL =
  /^\s*(?:[{}()[\];,]*|\/\/.*|\/?\*.*|#.*|import .*|export \{.*|else|return;?|break;?)\s*$/;

/**
 * Blame `ranges` of `path` as it was just before `sha`, returning how many non-trivial
 * removed lines each origin commit wrote. This is the core of the fix-origin trace.
 */
export function blameOrigins(
  root: string,
  sha: string,
  path: string,
  ranges: LineRange[],
): Map<string, number> {
  const out = new Map<string, number>();
  if (!ranges.length) return out;
  const args = ["blame", "--porcelain", "-w"];
  for (const [a, b] of ranges) args.push("-L", `${a},${b}`);
  args.push(`${sha}^`, "--", path);
  const text = git(root, args, { allowFail: true });
  let origin: string | undefined;
  for (const line of text.split("\n")) {
    const h = /^([0-9a-f]{40}) \d+ \d+(?: \d+)?$/.exec(line);
    if (h) {
      origin = h[1];
      continue;
    }
    if (line.startsWith("\t") && origin) {
      if (!TRIVIAL.test(line.slice(1))) out.set(origin, (out.get(origin) ?? 0) + 1);
    }
  }
  return out;
}

/** Unified diff of one commit (optionally one file), capped in size. */
export function commitDiff(
  root: string,
  sha: string,
  opts: { path?: string | undefined; maxBytes?: number | undefined } = {},
): { text: string; truncated: boolean } {
  const args = ["show", "--format=", "--no-color", "--no-ext-diff", "--relative", "-U3", sha];
  if (opts.path) args.push("--", opts.path);
  const text = git(root, args, { allowFail: true });
  const max = opts.maxBytes ?? 200_000;
  return text.length > max
    ? { text: text.slice(0, max), truncated: true }
    : { text, truncated: false };
}

/** Commits that touched a line range, following the range through history (`git log -L`). */
export function logForLines(
  root: string,
  path: string,
  start: number,
  end: number,
  limit: number,
): Array<{ sha: string; author: string; at: number; subject: string }> {
  const out = git(
    root,
    [
      "log",
      `-L${start},${end}:${path}`,
      "--no-patch",
      "-n",
      String(limit),
      "--format=%x00%H%x1f%an%x1f%at%x1f%s",
    ],
    { allowFail: true },
  );
  const rows: Array<{ sha: string; author: string; at: number; subject: string }> = [];
  for (const block of out.split("\u0000")) {
    const [sha, author, at, subject] = block.trim().split("\u001f");
    if (sha && /^[0-9a-f]{40}$/.test(sha))
      rows.push({ sha, author: author ?? "?", at: Number(at) * 1000, subject: subject ?? "" });
  }
  return rows;
}

/** Branches (local and remote) whose history contains `sha`. */
export function branchesContaining(root: string, sha: string): string[] {
  const out = git(root, ["branch", "-a", "--contains", sha, "--format=%(refname:short)"], {
    allowFail: true,
  });
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s && !s.endsWith("/HEAD"));
}

/** A fingerprint of every ref tip; changes whenever a branch moves or a tag appears. */
export function refsFingerprint(root: string): string {
  const out = git(root, ["for-each-ref", "--format=%(objectname)"], { allowFail: true });
  let h = 0;
  for (let i = 0; i < out.length; i++) h = (h * 31 + out.charCodeAt(i)) | 0;
  return `${out.length}:${h}`;
}
