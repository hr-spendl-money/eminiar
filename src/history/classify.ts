import type { CommitFile } from "./log.js";

export type CommitKind =
  | "feat"
  | "fix"
  | "refactor"
  | "perf"
  | "test"
  | "docs"
  | "chore"
  | "build"
  | "ci"
  | "style"
  | "revert"
  | "merge"
  | "release"
  | "wip"
  | "other";

/** Every kind, in display order. */
export const KINDS: CommitKind[] = [
  "feat",
  "fix",
  "refactor",
  "perf",
  "test",
  "docs",
  "chore",
  "build",
  "ci",
  "style",
  "revert",
  "merge",
  "release",
  "wip",
  "other",
];

/** Chart buckets: the kinds people reason about, everything else folds into `other`. */
export type KindBucket = "feat" | "fix" | "refactor" | "perf" | "test" | "docs" | "other";
export const BUCKETS: KindBucket[] = ["feat", "fix", "refactor", "perf", "test", "docs", "other"];

export function bucketOf(kind: CommitKind): KindBucket {
  switch (kind) {
    case "feat":
    case "fix":
    case "refactor":
    case "perf":
    case "test":
    case "docs":
      return kind;
    case "revert":
      return "fix";
    default:
      return "other";
  }
}

export interface Classification {
  kind: CommitKind;
  /** Conventional-commit scope, e.g. `graph` in `feat(graph): …`. */
  scope?: string | undefined;
  /** `feat!:` or a `BREAKING CHANGE` footer. */
  breaking: boolean;
  /** `#123`, `GH-123`, `ABC-123`. */
  issues: string[];
  /** Pull request number from a merge subject or `(#123)` suffix. */
  pr?: number | undefined;
  /** For reverts: the sha named in `This reverts commit …`. */
  revertOf?: string | undefined;
  /** True when the subject followed the conventional-commit grammar. */
  conventional: boolean;
}

const CONVENTIONAL =
  /^(feat|feature|fix|bugfix|hotfix|refactor|perf|test|tests|docs?|chore|build|ci|style|revert|release|wip)(?:\(([^)]*)\))?(!)?:\s*/i;

const FIX_WORDS =
  /\b(fix(e[sd])?|bug|bugs|crash(es|ed)?|broken|breaks?|regression|hotfix|patch(es|ed)?|resolve[sd]?|correct(s|ed)?|repair(s|ed)?|workaround|fault|error|issue|leak|race|deadlock|null|undefined|nan|typo|wrong|incorrect|fails?|failing|failure|handle)\b/i;
const FEAT_WORDS =
  /\b(add(s|ed)?|implement(s|ed)?|introduce[sd]?|support(s|ed)?|new|create[sd]?|enable[sd]?|allow(s|ed)?|expose[sd]?|feature)\b/i;
const REFACTOR_WORDS =
  /\b(refactor(s|ed|ing)?|clean(s|ed)?[- ]?up|rename[sd]?|move[sd]?|extract(s|ed)?|simplif(y|ies|ied)|reorgani[sz]e[sd]?|restructure[sd]?|split(s)?|inline[sd]?|dedup(e|licate)[sd]?|tidy|consolidate[sd]?|rework(ed)?)\b/i;
const PERF_WORDS =
  /\b(perf(ormance)?|speed(s|ed)?( up)?|faster|optimi[sz](e|es|ed|ation)|cache[sd]?|latency|hot[- ]?path|bench(mark)?)\b/i;
const DOCS_WORDS =
  /\b(docs?|documentation|readme|changelog|comments?|typos? in docs|jsdoc|guide)\b/i;
const TEST_WORDS = /\b(tests?|spec|specs|coverage|fixtures?|e2e|unit test)\b/i;
const RELEASE_WORDS = /\b(release|bump|version|v\d+\.\d+(\.\d+)?|publish|tag)\b/i;
const CHORE_WORDS =
  /\b(chore|deps?|dependenc(y|ies)|upgrade[sd]?|update[sd]? (deps|dependencies|packages)|lockfile|lint(ing)?|format(ting)?|prettier|biome|eslint|gitignore|license|housekeeping)\b/i;
const CI_WORDS = /\b(ci|pipeline|workflow|github actions?|travis|circleci|jenkins)\b/i;
const BUILD_WORDS =
  /\b(build|bundle[sr]?|tsup|webpack|rollup|esbuild|vite|tsconfig|compile[sd]?)\b/i;
const WIP_WORDS = /^(wip|tmp|temp|fixup!|squash!|checkpoint|save)\b/i;

const TEST_PATH =
  /(^|\/)(tests?|__tests__|spec|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py)$/;
const DOC_PATH = /\.(md|mdx|rst|txt|adoc)$|(^|\/)docs?\//i;

function allFiles(files: CommitFile[], re: RegExp): boolean {
  return files.length > 0 && files.every((f) => re.test(f.path));
}

/** Fraction of the files matching `re` (0 when the commit lists no files). */
function share(files: CommitFile[], re: RegExp): number {
  return files.length ? files.filter((f) => re.test(f.path)).length / files.length : 0;
}

/** Kind, scope and references of a commit from its message (and its file list as a tiebreak). */
export function classifyCommit(
  subject: string,
  body: string,
  opts: { merge: boolean; files: CommitFile[] },
): Classification {
  const text = `${subject}\n${body}`;
  const issues = [
    ...new Set(
      [...text.matchAll(/(?:^|[\s(,:])(?:GH-|#)(\d{1,7})\b/g)]
        .map((m) => `#${m[1]}`)
        .concat([...text.matchAll(/\b([A-Z][A-Z0-9]{1,9}-\d{1,6})\b/g)].map((m) => m[1] ?? "")),
    ),
  ].filter(Boolean);
  const prMerge = /^Merge pull request #(\d+)/.exec(subject);
  const prSuffix = /\(#(\d+)\)\s*$/.exec(subject);
  const pr = prMerge ? Number(prMerge[1]) : prSuffix ? Number(prSuffix[1]) : undefined;
  const breaking = /!:\s/.test(subject) || /BREAKING[ -]CHANGE/.test(body);
  const revertOf = /This reverts commit ([0-9a-f]{7,40})/.exec(body)?.[1];

  const base = { issues, pr, breaking, revertOf, conventional: false };
  if (/^Revert\b/i.test(subject) || revertOf) return { ...base, kind: "revert" };
  if (opts.merge || /^Merge (branch|pull request|remote-tracking)/.test(subject))
    return { ...base, kind: "merge", conventional: false };

  const conv = CONVENTIONAL.exec(subject);
  if (conv) {
    const t = (conv[1] ?? "").toLowerCase();
    const kind: CommitKind =
      t === "feature"
        ? "feat"
        : t === "bugfix" || t === "hotfix"
          ? "fix"
          : t === "tests"
            ? "test"
            : t === "doc"
              ? "docs"
              : (t as CommitKind);
    return {
      ...base,
      kind,
      scope: conv[2] || undefined,
      breaking: breaking || conv[3] === "!",
      conventional: true,
    };
  }

  if (WIP_WORDS.test(subject)) return { ...base, kind: "wip" };
  if (allFiles(opts.files, DOC_PATH)) return { ...base, kind: "docs" };
  if (allFiles(opts.files, TEST_PATH)) return { ...base, kind: "test" };
  if (RELEASE_WORDS.test(subject) && /\d+\.\d+/.test(subject) && opts.files.length <= 4)
    return { ...base, kind: "release" };
  // Fixes win over features: "add null check to fix crash" is a fix.
  if (FIX_WORDS.test(subject)) return { ...base, kind: "fix" };
  if (REFACTOR_WORDS.test(subject)) return { ...base, kind: "refactor" };
  if (PERF_WORDS.test(subject)) return { ...base, kind: "perf" };
  if (CI_WORDS.test(subject) && !FEAT_WORDS.test(subject)) return { ...base, kind: "ci" };
  if (CHORE_WORDS.test(subject)) return { ...base, kind: "chore" };
  if (BUILD_WORDS.test(subject) && !FEAT_WORDS.test(subject)) return { ...base, kind: "build" };
  if (TEST_WORDS.test(subject) && share(opts.files, TEST_PATH) >= 0.5)
    return { ...base, kind: "test" };
  if (DOCS_WORDS.test(subject) && share(opts.files, DOC_PATH) >= 0.5)
    return { ...base, kind: "docs" };
  if (FEAT_WORDS.test(subject)) return { ...base, kind: "feat" };
  // Only an explicit footer in the body ("Fixes #12", "Resolves ABC-7") makes a fix; prose mentioning
  // an error somewhere in a long feature description does not.
  if (/^(fix(es|ed)?|close[sd]?|resolve[sd]?)\s+#?[A-Za-z]*-?\d/im.test(body))
    return { ...base, kind: "fix" };
  if (/^(\w+):/.test(subject)) return { ...base, kind: "chore" };
  return { ...base, kind: opts.files.length ? "feat" : "other" };
}

/** Lines added + deleted → a t-shirt size. */
export function sizeOf(changed: number): "xs" | "s" | "m" | "l" | "xl" {
  if (changed < 10) return "xs";
  if (changed < 60) return "s";
  if (changed < 250) return "m";
  if (changed < 1000) return "l";
  return "xl";
}
