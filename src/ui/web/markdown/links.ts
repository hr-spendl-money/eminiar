/**
 * Where a link inside a memory should take the reader. Memories reference the project
 * with the same prefixes as their `related:` header (`mem:name`, `file:path`,
 * `sym:path#Name`), so those resolve to dashboard routes; web links open in a new tab;
 * anything with another scheme (javascript:, data:, …) is rendered as plain text.
 */
export type LinkTarget =
  | { kind: "memory"; name: string }
  | { kind: "file"; file: string }
  | { kind: "external"; href: string }
  | { kind: "anchor"; href: string }
  | { kind: "text" };

const SCHEME = /^([a-z][a-z0-9+.-]*):(.*)$/i;

export function classifyHref(href: string): LinkTarget {
  const h = href.trim();
  if (!h) return { kind: "text" };
  if (h.startsWith("#")) return { kind: "anchor", href: h };
  const m = SCHEME.exec(h);
  if (!m) {
    // Scheme-less: a project-relative path such as `src/x.ts` or `./README.md#L10`.
    const file = h.replace(/^\.\//, "").split("#")[0] ?? "";
    return file ? { kind: "file", file } : { kind: "text" };
  }
  const scheme = m[1]!.toLowerCase();
  const rest = m[2]!;
  switch (scheme) {
    case "mem":
    case "memory": // the graph node id, accepted in `related:` too
      return rest ? { kind: "memory", name: rest } : { kind: "text" };
    case "file":
    case "sym": {
      const file = rest.replace(/^\/+/, "").split("#")[0] ?? "";
      return file ? { kind: "file", file } : { kind: "text" };
    }
    case "http":
    case "https":
    case "mailto":
      return { kind: "external", href: h };
    default:
      return { kind: "text" };
  }
}

/** The dashboard hash route for an in-app target; undefined for anything else. */
export function dashboardHref(target: LinkTarget): string | undefined {
  if (target.kind === "memory") return `#/memory?name=${encodeURIComponent(target.name)}`;
  if (target.kind === "file") return `#/explore?file=${encodeURIComponent(target.file)}`;
  return undefined;
}
