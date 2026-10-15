export const fmt = (n: number): string =>
  n >= 1e6
    ? `${(n / 1e6).toFixed(1)}M`
    : n >= 1e3
      ? `${(n / 1e3).toFixed(1)}k`
      : String(Math.round(n));

export function ago(ts: number | null | undefined): string {
  if (!ts) return "";
  const d = Date.now() - ts;
  if (d < 6e4) return "just now";
  if (d < 36e5) return `${Math.round(d / 6e4)}m ago`;
  if (d < 864e5) return `${Math.round(d / 36e5)}h ago`;
  return `${Math.round(d / 864e5)}d ago`;
}

export const day = (ts: number | string | null | undefined): string =>
  ts ? new Date(ts).toISOString().slice(0, 10) : "";

export const time = (ts: number | null | undefined): string =>
  ts ? new Date(ts).toLocaleTimeString() : "";

export const basename = (p: string): string => p.split("/").pop() ?? p;
export const dirname = (p: string): string =>
  p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";

/** Node kind colours, shared by graph, tags and legends (same hues in both themes). */
export const KIND_COLORS: Record<string, string> = {
  file: "#2563eb",
  function: "#16a34a",
  method: "#0d9488",
  class: "#d97706",
  interface: "#7c3aed",
  type: "#8b5cf6",
  enum: "#a855f7",
  field: "#64748b",
  variable: "#64748b",
  route: "#e11d48",
  package: "#6b7280",
  // Knowledge kinds stay on the grey/blue palette (accent, its darker and lighter
  // steps, greys); the knowledge galaxy tells them apart by shape.
  memory: "#2563eb",
  doc: "#1e40af",
  tag: "#9ca3af",
  topic: "#6b7280",
  person: "#f59e0b",
  concept: "#0ea5e9",
  cluster: "#2563eb",
};
export const color = (kind: string): string => KIND_COLORS[kind] ?? "#94a3b8";

export const EDGE_COLORS: Record<string, string> = {
  imports: "#2563eb",
  reexports: "#3b82f6",
  calls: "#16a34a",
  references: "#0ea5e9",
  extends: "#7c3aed",
  implements: "#8b5cf6",
  handles: "#e11d48",
  defines: "#9ca3af",
  exports: "#9ca3af",
  co_changes: "#f59e0b",
  mentions: "#2563eb",
  supersedes: "#6b7280",
  links: "#3b82f6",
  documents: "#1e40af",
  about: "#93c5fd",
  tagged: "#9ca3af",
  in_topic: "#cdd2da",
  authored: "#d97706",
  link: "#2563eb",
};
export const edgeColor = (kind: string): string => EDGE_COLORS[kind] ?? "#94a3b8";
export const DIRECTED = new Set([
  "imports",
  "reexports",
  "calls",
  "references",
  "extends",
  "implements",
  "handles",
  "mentions",
  "supersedes",
  "links",
  "documents",
  "about",
]);
export const EDGE_KINDS = [
  "imports",
  "calls",
  "references",
  "extends",
  "implements",
  "handles",
  "reexports",
  "co_changes",
  "mentions",
  "defines",
];

export const cls = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(" ");

export function debounce<A extends unknown[]>(
  fn: (...a: A) => void,
  ms: number,
): (...a: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export const pct = (x: number | undefined): string => `${Math.round((x ?? 0) * 100)}%`;

export function langOf(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return (
    {
      ts: "typescript",
      mts: "typescript",
      cts: "typescript",
      tsx: "tsx",
      js: "javascript",
      mjs: "javascript",
      cjs: "javascript",
      jsx: "jsx",
      py: "python",
      go: "go",
      php: "php",
      json: "json",
      md: "markdown",
      sh: "bash",
    }[ext] ?? "plain"
  );
}
