/** Node id conventions: `file:<rel>`, `sym:<rel>#<Outer.inner>`, `pkg:<name>`, `person:<name>`, `concept:<slug>`, `memory:<topic/name>`. */
export const fileId = (rel: string): string => `file:${rel}`;
export const memoryId = (name: string): string => `memory:${name}`;
export const symId = (rel: string, name: string): string => `sym:${rel}#${name}`;
export const pkgId = (name: string): string => `pkg:${name}`;
export const personId = (name: string): string => `person:${name}`;
export const conceptId = (name: string): string =>
  `concept:${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;

export function parseId(id: string): { kind: string; rest: string } {
  const i = id.indexOf(":");
  return i === -1 ? { kind: "concept", rest: id } : { kind: id.slice(0, i), rest: id.slice(i + 1) };
}

/** The file a symbol belongs to, or the file itself. */
export function fileOf(id: string): string | undefined {
  const { kind, rest } = parseId(id);
  if (kind === "file") return rest;
  if (kind === "sym") return rest.split("#")[0];
  return undefined;
}
