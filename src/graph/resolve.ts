import { existsSync, readFileSync, statSync } from "node:fs";
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

/**
 * Resolve an import specifier from `fromRel` to a project-relative path, or
 * undefined for bare package specifiers that are not path-mapped.
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
  return undefined;
}

/** Bare specifier → package name (`@scope/pkg/sub` → `@scope/pkg`). */
export function packageName(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}
