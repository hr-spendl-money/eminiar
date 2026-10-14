/**
 * What kind of documentation a registered source holds. Derived, not stored: the
 * manifest only knows `url | path` and a provider id, so this reads the discovery
 * rule that produced a local source (its title, name suffix, globs) and the catalogue
 * tier of an external one. Shared by the dashboard, em_docs and the CLI so every
 * listing groups sources the same way. Keep it free of node imports: the browser
 * bundle uses the label table, and the types here are structural for the same reason.
 */
/** The fields this module reads; structural so the browser bundle needs no node types. */
export interface CategorisableSource {
  kind: "url" | "path";
  name: string;
  provider?: string | undefined;
  title?: string | undefined;
  path?: string | undefined;
  glob?: string[] | undefined;
  urls?: string[] | undefined;
}
export interface CategoryEntry {
  tier?: "service" | "infra" | "library" | undefined;
}

export type DocCategory =
  | "readme"
  | "guides"
  | "adr"
  | "agent-instructions"
  | "api-specs"
  | "env-reference"
  | "deploy-config"
  | "local"
  | "service"
  | "api"
  | "infra"
  | "library"
  | "web";

export type DocGroup = "project" | "external";

export interface DocCategoryInfo {
  id: DocCategory;
  group: DocGroup;
  label: string;
  /** One line for tooltips and the CLI. */
  blurb: string;
}

/** Display order: the project's own documentation first, then what it depends on. */
export const DOC_CATEGORIES: readonly DocCategoryInfo[] = [
  {
    id: "readme",
    group: "project",
    label: "Readme & guides",
    blurb: "README, CONTRIBUTING, CHANGELOG and other top-level guides",
  },
  {
    id: "guides",
    group: "project",
    label: "Docs folders",
    blurb: "docs/ directories: handbooks, how-tos, references",
  },
  {
    id: "adr",
    group: "project",
    label: "Decision records",
    blurb: "architecture decision records",
  },
  {
    id: "agent-instructions",
    group: "project",
    label: "Agent instructions",
    blurb: "Copilot, Claude and Cursor instructions, agents and skills",
  },
  {
    id: "api-specs",
    group: "project",
    label: "API specs",
    blurb: "OpenAPI, Postman, GraphQL and protobuf definitions",
  },
  {
    id: "env-reference",
    group: "project",
    label: "Environment reference",
    blurb: ".env examples: every variable the project reads",
  },
  {
    id: "deploy-config",
    group: "project",
    label: "Deploy config",
    blurb: "Terraform, Kubernetes, Helm, Compose and CI workflows",
  },
  { id: "local", group: "project", label: "Other local files", blurb: "hand-registered paths" },
  {
    id: "service",
    group: "external",
    label: "Services",
    blurb: "third-party products and APIs the project integrates",
  },
  {
    id: "api",
    group: "external",
    label: "External APIs",
    blurb: "hosts the code calls, found by probing their docs",
  },
  {
    id: "infra",
    group: "external",
    label: "Infrastructure",
    blurb: "platforms the project runs on",
  },
  { id: "library", group: "external", label: "Libraries", blurb: "frameworks and packages" },
  { id: "web", group: "external", label: "Web pages", blurb: "hand-registered URLs" },
];

const BY_ID = new Map(DOC_CATEGORIES.map((c) => [c.id, c]));

export function categoryInfo(id: DocCategory | string | undefined): DocCategoryInfo {
  return BY_ID.get(id as DocCategory) ?? BY_ID.get("local")!;
}

export const GROUP_LABELS: Record<DocGroup, string> = {
  project: "Project documentation",
  external: "External documentation",
};

/** Discovery titles (`why`) → category; the most reliable signal for discovered sources. */
const TITLE_RULES: Array<[RegExp, DocCategory]> = [
  [/^project readme/i, "readme"],
  [/^(docs|doc|documentation)\/ directory$/i, "guides"],
  [/decision records/i, "adr"],
  [/copilot|claude|cursor/i, "agent-instructions"],
  [/openapi|postman|graphql|protobuf/i, "api-specs"],
  [/environment variable/i, "env-reference"],
  [/terraform|kubernetes|helm|compose|workflow/i, "deploy-config"],
];

/** Name suffixes discovery uses (`<subproject>-readme`, `docs`, `adr`, …). */
const NAME_RULES: Array<[RegExp, DocCategory]> = [
  [/(^|-)readme$/, "readme"],
  [/(^|-)docs$/, "guides"],
  [/(^|-)adrs?$/, "adr"],
  [/(^|-)agent-instructions$/, "agent-instructions"],
  [/(^|-)api-specs$/, "api-specs"],
  [/(^|-)env-example$/, "env-reference"],
  [/(^|-)deploy-config$/, "deploy-config"],
];

/** Hand-registered paths: look at what they point to. */
const GLOB_RULES: Array<[RegExp, DocCategory]> = [
  [/openapi|swagger|postman_collection|asyncapi|\.graphql$|\.proto$/i, "api-specs"],
  [/^\.env\./, "env-reference"],
  [
    /\.tf$|tfvars|^k8s\/|^helm\/|^charts\/|^manifests\/|compose.*\.ya?ml|\.github\/workflows/i,
    "deploy-config",
  ],
  [
    /copilot-instructions|\.github\/(instructions|agents|skills)|\.claude\/(agents|skills)|\.cursor\/rules|^(AGENTS|CLAUDE)\.md$/i,
    "agent-instructions",
  ],
  [/^(README|CONTRIBUTING|CHANGELOG|SECURITY)(\.md)?$/i, "readme"],
  [/^\*\*\/\*\.(md|mdx|rst|txt)$/i, "guides"],
];

function localCategory(s: CategorisableSource): DocCategory {
  const title = s.title ?? "";
  for (const [re, cat] of TITLE_RULES) if (re.test(title)) return cat;
  for (const [re, cat] of NAME_RULES) if (re.test(s.name)) return cat;
  const path = s.path ?? "";
  if (/(^|\/)(adrs?|decisions)$/i.test(path)) return "adr";
  const globs = s.glob ?? [];
  const hits = new Map<DocCategory, number>();
  for (const g of globs)
    for (const [re, cat] of GLOB_RULES)
      if (re.test(g)) {
        hits.set(cat, (hits.get(cat) ?? 0) + 1);
        break;
      }
  if (hits.size) return [...hits.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  if (/(^|\/)(docs?|documentation)$/i.test(path)) return "guides";
  if (/README|CONTRIBUTING|CHANGELOG/i.test(path)) return "readme";
  return "local";
}

/**
 * Classify a source. `entry` is the catalogue entry for its provider when one exists
 * (`catalogForProvider`); the caller resolves it so this module stays import-free.
 */
export function docCategory(
  s: CategorisableSource,
  entry?: CategoryEntry | undefined,
): DocCategory {
  if (s.kind === "path") return localCategory(s);
  if (entry) {
    const tier = entry.tier ?? "library";
    return tier === "service" ? "service" : tier === "infra" ? "infra" : "library";
  }
  const provider = s.provider ?? "";
  const i = provider.indexOf(":");
  const kind = i === -1 ? provider : provider.slice(0, i);
  switch (kind) {
    case "api":
      return "api";
    case "env":
      return "service";
    case "image":
    case "files":
      return "infra";
    case "npm":
    case "pypi":
    case "go":
      return "library";
    default:
      return "web";
  }
}

/** Stable sort key: category display order, then name. */
export function categoryRank(id: DocCategory | string): number {
  const i = DOC_CATEGORIES.findIndex((c) => c.id === id);
  return i === -1 ? DOC_CATEGORIES.length : i;
}
