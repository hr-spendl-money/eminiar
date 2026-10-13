import { spawnSync } from "node:child_process";
import type { StorageAdapter } from "../storage/adapter.js";
import type { GraphEdge } from "../storage/types.js";
import { fileId, personId } from "./ids.js";

interface Commit {
  sha: string;
  author: string;
  at: number;
  files: string[];
}

const DAY = 86_400_000;

/** `git log --name-only` since `after` (exclusive), newest first. */
function readLog(root: string, maxCommits: number, after?: string): Commit[] {
  const range = after ? [`${after}..HEAD`] : [];
  const r = spawnSync(
    "git",
    [
      "log",
      "--name-only",
      "--no-merges",
      "--format=%x00%H%x1f%an%x1f%at",
      `-n`,
      String(maxCommits),
      ...range,
      "--",
      ".",
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0 || !r.stdout) return [];
  const commits: Commit[] = [];
  for (const block of r.stdout.split("\u0000")) {
    if (!block.trim()) continue;
    const [header, ...rest] = block.split("\n");
    const [sha, author, at] = (header ?? "").split("\u001f");
    if (!sha) continue;
    const files = rest.map((l) => l.trim()).filter(Boolean);
    commits.push({ sha, author: author ?? "?", at: Number(at) * 1000, files });
  }
  return commits;
}

export interface GitSummary {
  commits: number;
  coChangeEdges: number;
  files: number;
}

/**
 * Co-change coupling (Jaccard over commits, decayed by age), hotspots
 * (commits in 90d, last touched) and authorship. Incremental via meta.last_git_sha;
 * `full` recomputes from scratch.
 */
export function reindexGit(
  db: StorageAdapter,
  root: string,
  opts: { maxCommits: number; full?: boolean },
): GitSummary {
  const head = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).stdout?.trim();
  if (!head) return { commits: 0, coChangeEdges: 0, files: 0 };
  const since = opts.full ? undefined : db.metaGet("last_git_sha");
  if (since === head) return { commits: 0, coChangeEdges: 0, files: 0 };

  // For simplicity the coupling statistics are always recomputed over the window;
  // the incremental check only avoids re-reading git when nothing changed.
  const commits = readLog(root, opts.maxCommits);
  if (!commits.length) return { commits: 0, coChangeEdges: 0, files: 0 };
  const now = Date.now();

  const perFile = new Map<
    string,
    { commits: number; recent: number; last: number; authors: Map<string, number> }
  >();
  const pair = new Map<string, { count: number; weight: number }>();
  for (const c of commits) {
    const age = Math.max(0, now - c.at);
    const decay = 0.5 ** (age / (180 * DAY));
    for (const f of c.files) {
      const s = perFile.get(f) ?? { commits: 0, recent: 0, last: 0, authors: new Map() };
      s.commits++;
      if (age < 90 * DAY) s.recent++;
      s.last = Math.max(s.last, c.at);
      s.authors.set(c.author, (s.authors.get(c.author) ?? 0) + 1);
      perFile.set(f, s);
    }
    if (c.files.length > 30 || c.files.length < 2) continue;
    const files = [...c.files].sort();
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const key = `${files[i]}\u0000${files[j]}`;
        const p = pair.get(key) ?? { count: 0, weight: 0 };
        p.count++;
        p.weight += decay;
        pair.set(key, p);
      }
    }
  }

  db.graphDeleteBySource("git");
  const edges: GraphEdge[] = [];
  for (const [key, p] of pair) {
    if (p.count < 3) continue;
    const [a, b] = key.split("\u0000") as [string, string];
    const ca = perFile.get(a)?.commits ?? 1;
    const cb = perFile.get(b)?.commits ?? 1;
    const jaccard = p.count / (ca + cb - p.count);
    if (jaccard < 0.2) continue;
    const weight = Math.min(1, jaccard * (p.weight / p.count));
    const meta = { count: p.count, jaccard: Number(jaccard.toFixed(3)) };
    edges.push({ src: fileId(a), dst: fileId(b), kind: "co_changes", source: "git", weight, meta });
    edges.push({ src: fileId(b), dst: fileId(a), kind: "co_changes", source: "git", weight, meta });
  }
  db.transaction(() => {
    for (const [f, s] of perFile) {
      db.graphMergeNodeMeta(fileId(f), "file", f, "git", {
        commits: s.commits,
        commits_90d: s.recent,
        last_touched: new Date(s.last).toISOString().slice(0, 10),
      });
      const total = [...s.authors.values()].reduce((x, y) => x + y, 0);
      for (const [author, n] of s.authors) {
        if (n / total < 0.2) continue;
        edges.push({
          src: personId(author),
          dst: fileId(f),
          kind: "authored",
          source: "git",
          weight: n / total,
          meta: { commits: n },
        });
      }
    }
    db.graphUpsertNodes(
      [...new Set(edges.filter((e) => e.src.startsWith("person:")).map((e) => e.src))].map(
        (id) => ({
          id,
          kind: "person",
          name: id.slice(7),
          source: "git" as const,
        }),
      ),
    );
    db.graphUpsertEdges(edges);
  });
  db.metaSet("last_git_sha", head);
  return {
    commits: commits.length,
    coChangeEdges: edges.filter((e) => e.kind === "co_changes").length / 2,
    files: perFile.size,
  };
}
