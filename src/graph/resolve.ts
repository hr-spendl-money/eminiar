import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";

const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];

interface TsPaths {
  baseUrl: string;
  paths: Array<{ prefix: string; suffix: string; targets: string[] }>;
}

const tsPathsCache = new Map<string, TsPaths | null>();

/** Minimal tsconfig `paths` support (`@/*` → `src/*`). Cached per root. */
function loadTsPaths(root: string): TsPaths | null {
  const hit = tsPathsCache.get(root);
  if (hit !== undefined) return hit;
  let out: TsPaths | null = null;
  try {
    const file = join(root, "tsconfig.json");
    if (existsSync(file)) {
      // tsconfig allows comments/trailing commas; strip the common cases.
      const raw = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/,(\s*[}\]])/g, "$1");
      const cfg = JSON.parse(raw) as {
        compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
      };
      const co = cfg.compilerOptions ?? {};
      if (co.paths) {
        out = {
          baseUrl: resolve(root, co.baseUrl ?? "."),
          paths: Object.entries(co.paths).map(([k, v]) => {
            const star = k.indexOf("*");
            return star === -1
              ? { prefix: k, suffix: "\u0000", targets: v }
              : { prefix: k.slice(0, star), suffix: k.slice(star + 1), targets: v };
          }),
        };
      }
    }
  } catch {
    out = null;
  }
  tsPathsCache.set(root, out);
  return out;
}

function probe(abs: string): string | undefined {
  const tryFile = (p: string) => {
    try {
      return statSync(p).isFile() ? p : undefined;
    } catch {
      return undefined;
    }
  };
  // "./x.js" written for ESM but the source is x.ts
  const swapped = abs.replace(
    /\.(js|jsx|mjs|cjs)$/,
    (m) => ({ ".js": ".ts", ".jsx": ".tsx", ".mjs": ".mts", ".cjs": ".cts" })[m] ?? m,
  );
  for (const cand of [abs, swapped]) {
    if (tryFile(cand)) return cand;
  }
  for (const ext of EXTS) {
    if (tryFile(abs + ext)) return abs + ext;
  }
  for (const ext of EXTS) {
    const idx = join(abs, `index${ext}`);
    if (tryFile(idx)) return idx;
  }
  return undefined;
}

interface PackageJson {
  name?: string;
  main?: string;
  module?: string;
  source?: string;
  types?: string;
  exports?: unknown;
  workspaces?: string[] | { packages?: string[] };
}

function readPackageJson(dir: string): PackageJson | undefined {
  try {
    const file = join(dir, "package.json");
    if (!existsSync(file)) return undefined;
    return JSON.parse(readFileSync(file, "utf8")) as PackageJson;
  } catch {
    return undefined;
  }
}

const workspaceCache = new Map<string, Map<string, string>>();

/**
 * Workspace packages (npm/yarn `workspaces`, pnpm-workspace.yaml) and the root package
 * itself, by name → absolute directory. Cached per root; only one glob level (`pkgs/*`)
 * is expanded, which covers the common layouts without a glob dependency here.
 */
function loadWorkspaces(root: string): Map<string, string> {
  const hit = workspaceCache.get(root);
  if (hit) return hit;
  const out = new Map<string, string>();
  const rootPkg = readPackageJson(root);
  if (rootPkg?.name) out.set(rootPkg.name, root);
  const globs: string[] = [];
  const ws = rootPkg?.workspaces;
  if (Array.isArray(ws)) globs.push(...ws);
  else if (ws?.packages) globs.push(...ws.packages);
  try {
    const yaml = join(root, "pnpm-workspace.yaml");
    if (existsSync(yaml)) {
      for (const m of readFileSync(yaml, "utf8").matchAll(/^\s*-\s*['"]?([^'"\n#]+?)['"]?\s*$/gm))
        globs.push(m[1]!.trim());
    }
  } catch {
    // ignore
  }
  for (const g of globs) {
    if (g.startsWith("!")) continue;
    const star = g.indexOf("*");
    const dirs: string[] = [];
    if (star === -1) dirs.push(resolve(root, g));
    else {
      const base = resolve(root, g.slice(0, star));
      try {
        for (const d of readdirSync(base, { withFileTypes: true })) {
          if (d.isDirectory()) dirs.push(join(base, d.name));
        }
      } catch {
        // missing dir
      }
    }
    for (const d of dirs) {
      const pkg = readPackageJson(d);
      if (pkg?.name && !out.has(pkg.name)) out.set(pkg.name, d);
    }
  }
  workspaceCache.set(root, out);
  return out;
}

/** First string target inside a package.json `exports` value (conditions in preference order). */
function exportTarget(v: unknown, depth = 0): string | undefined {
  if (typeof v === "string") return v;
  if (depth > 4 || !v || typeof v !== "object") return undefined;
  if (Array.isArray(v)) {
    for (const x of v) {
      const t = exportTarget(x, depth + 1);
      if (t) return t;
    }
    return undefined;
  }
  const o = v as Record<string, unknown>;
  for (const key of ["source", "import", "module", "default", "node", "require", "types"]) {
    if (key in o) {
      const t = exportTarget(o[key], depth + 1);
      if (t) return t;
    }
  }
  return undefined;
}

/** Entry file of a package directory for a sub-path (`""` for the root entry). */
function resolvePackageEntry(dir: string, sub: string): string | undefined {
  const pkg = readPackageJson(dir);
  const candidates: string[] = [];
  const ex = pkg?.exports;
  if (ex && typeof ex === "object" && !Array.isArray(ex)) {
    const map = ex as Record<string, unknown>;
    const key = sub ? `./${sub}` : ".";
    const direct = map[key];
    if (direct !== undefined) {
      const t = exportTarget(direct);
      if (t) candidates.push(t);
    } else if (!sub) {
      // conditions object at the top level (`exports: { import: "./x.js" }`)
      const t = exportTarget(ex);
      if (t) candidates.push(t);
    }
  } else if (typeof ex === "string" && !sub) candidates.push(ex);
  if (!sub) {
    for (const f of [pkg?.source, pkg?.module, pkg?.main, pkg?.types]) if (f) candidates.push(f);
    candidates.push("src/index", "index", "src/main", "lib/index");
  } else candidates.push(sub, `src/${sub}`, `lib/${sub}`);
  for (const c of candidates) {
    if (c.includes("*")) continue;
    const hit = probe(resolve(dir, c));
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Resolve an import specifier from `fromRel` to a project-relative path, or
 * undefined for bare package specifiers that are neither path-mapped nor
 * workspace packages.
 */
export function resolveImport(root: string, fromRel: string, spec: string): string | undefined {
  if (spec.startsWith(".") || spec.startsWith("/")) {
    const abs = spec.startsWith("/") ? spec : resolve(root, dirname(fromRel), spec);
    const hit = probe(abs);
    return hit ? normalize(relative(root, hit)) : undefined;
  }
  const tp = loadTsPaths(root);
  if (tp) {
    for (const p of tp.paths) {
      const exact = p.suffix === "\u0000";
      if (exact ? spec === p.prefix : spec.startsWith(p.prefix) && spec.endsWith(p.suffix)) {
        const star = exact ? "" : spec.slice(p.prefix.length, spec.length - p.suffix.length);
        for (const t of p.targets) {
          const hit = probe(resolve(tp.baseUrl, t.replace("*", star)));
          if (hit) return normalize(relative(root, hit));
        }
      }
    }
  }
  const name = packageName(spec);
  const dir = loadWorkspaces(root).get(name);
  if (dir) {
    const hit = resolvePackageEntry(dir, spec.slice(name.length + 1));
    if (hit && !relative(root, hit).startsWith("..")) return normalize(relative(root, hit));
  }
  return undefined;
}

/** Drop cached tsconfig/workspace lookups (tests, or after a config edit). */
export function resetResolveCache(): void {
  tsPathsCache.clear();
  workspaceCache.clear();
}

/** Bare specifier → package name (`@scope/pkg/sub` → `@scope/pkg`). */
export function packageName(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}
