import { parse as parseYaml } from "yaml";

/**
 * OpenAPI / Swagger documents and Postman collections rendered as markdown with one heading
 * per operation, so the heading-based chunker yields one searchable chunk per endpoint.
 */
export type SpecKind = "openapi" | "postman";

export interface SpecMarkdown {
  kind: SpecKind;
  title: string;
  markdown: string;
  operations: number;
}

type Obj = Record<string, unknown>;
const MAX_DESC = 600;
const MAX_OUT = 1_500_000;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function clip(s: unknown, max = MAX_DESC): string {
  if (typeof s !== "string") return "";
  const t = s.replace(/\r/g, "").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Parse JSON, then YAML; undefined when neither works or the result is not an object. */
export function parseSpecText(text: string): Obj | undefined {
  const t = text.trim();
  if (!t) return undefined;
  // fetchMarkdown wraps JSON bodies in a fence
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/.exec(t);
  const body = fenced ? fenced[1]! : t;
  if (body.startsWith("{") || body.startsWith("[")) {
    try {
      const v = JSON.parse(body) as unknown;
      return isObj(v) ? v : undefined;
    } catch {
      return undefined;
    }
  }
  if (/^(openapi|swagger|info|paths|servers)\s*:/m.test(body)) {
    try {
      const v = parseYaml(body) as unknown;
      return isObj(v) ? v : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function detectSpec(doc: Obj): SpecKind | undefined {
  if (typeof doc.openapi === "string" || typeof doc.swagger === "string")
    return isObj(doc.paths) || isObj(doc.components) ? "openapi" : undefined;
  const info = doc.info;
  if (
    isObj(info) &&
    typeof info.schema === "string" &&
    /postman/i.test(info.schema) &&
    Array.isArray(doc.item)
  )
    return "postman";
  if (
    Array.isArray(doc.item) &&
    isObj(info) &&
    typeof info.name === "string" &&
    doc.item.some((i) => isObj(i) && (isObj(i.request) || Array.isArray(i.item)))
  )
    return "postman";
  return undefined;
}

// --- OpenAPI ----------------------------------------------------------------------------

function deref(doc: Obj, node: unknown, seen = new Set<string>()): Obj | undefined {
  if (!isObj(node)) return undefined;
  const ref = node.$ref;
  if (typeof ref !== "string") return node;
  if (seen.has(ref)) return { description: `(recursive ${ref})` };
  seen.add(ref);
  if (!ref.startsWith("#/")) return { description: `(external ${ref})` };
  let cur: unknown = doc;
  for (const part of ref.slice(2).split("/")) {
    if (!isObj(cur)) return undefined;
    cur = cur[part.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return deref(doc, cur, seen);
}

function refName(node: unknown): string | undefined {
  return isObj(node) && typeof node.$ref === "string" ? node.$ref.split("/").pop() : undefined;
}

/** `{ id: string, items: Item[], meta: { page: integer } }` — two levels, refs by name. */
function schemaSummary(doc: Obj, schema: unknown, depth = 0): string {
  const name = refName(schema);
  const s = deref(doc, schema);
  if (!s) return "";
  if (name && depth > 0) return name;
  const type =
    typeof s.type === "string"
      ? s.type
      : Array.isArray(s.type)
        ? (s.type as string[]).join("|")
        : undefined;
  if (Array.isArray(s.enum))
    return `enum(${(s.enum as unknown[]).slice(0, 8).map(String).join(", ")}${s.enum.length > 8 ? ", …" : ""})`;
  for (const k of ["oneOf", "anyOf", "allOf"]) {
    const list = s[k];
    if (Array.isArray(list))
      return `${k}<${list
        .slice(0, 4)
        .map((x) => schemaSummary(doc, x, depth + 1))
        .join(" | ")}>`;
  }
  if (type === "array" || s.items) return `${schemaSummary(doc, s.items, depth + 1) || "any"}[]`;
  if (type === "object" || isObj(s.properties)) {
    if (depth >= 2) return name ?? "object";
    const props = isObj(s.properties) ? Object.entries(s.properties) : [];
    const req = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
    const inner = props
      .slice(0, 24)
      .map(
        ([k, v]) => `${k}${req.has(k) ? "" : "?"}: ${schemaSummary(doc, v, depth + 1) || "any"}`,
      );
    if (props.length > 24) inner.push(`… ${props.length - 24} more`);
    return `${name ? `${name} ` : ""}{ ${inner.join(", ")} }`;
  }
  const fmt = typeof s.format === "string" ? `(${s.format})` : "";
  return `${type ?? name ?? "any"}${fmt}`;
}

function paramTable(doc: Obj, params: unknown[]): string[] {
  const rows: string[] = [];
  for (const raw of params) {
    const p = deref(doc, raw);
    if (!p) continue;
    const schema =
      p.schema ??
      (p.type ? { type: p.type, format: p.format, enum: p.enum, items: p.items } : undefined);
    rows.push(
      `| ${String(p.name ?? "")} | ${String(p.in ?? "")} | ${p.required ? "yes" : "no"} | ${schemaSummary(doc, schema) || ""} | ${clip(p.description, 200).replace(/\n+/g, " ")} |`,
    );
  }
  return rows.length
    ? ["| name | in | required | type | description |", "|---|---|---|---|---|", ...rows]
    : [];
}

function contentSummary(doc: Obj, content: unknown): string[] {
  if (!isObj(content)) return [];
  const out: string[] = [];
  for (const [type, media] of Object.entries(content).slice(0, 4)) {
    const m = isObj(media) ? media : {};
    const schema = schemaSummary(doc, m.schema);
    const example =
      m.example !== undefined
        ? m.example
        : isObj(m.examples)
          ? Object.values(m.examples)[0]
          : undefined;
    out.push(`- \`${type}\`${schema ? `: ${schema}` : ""}`);
    if (example !== undefined) {
      const ex = isObj(example) && "value" in example ? (example as Obj).value : example;
      const text = typeof ex === "string" ? ex : JSON.stringify(ex, null, 1);
      if (text && text.length < 1200)
        out.push("  ```json", `  ${text.split("\n").join("\n  ")}`, "  ```");
    }
  }
  return out;
}

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"];

export function openapiToMarkdown(doc: Obj): SpecMarkdown {
  const info = isObj(doc.info) ? doc.info : {};
  const title = `${String(info.title ?? "API")}${info.version ? ` v${String(info.version)}` : ""}`;
  const out: string[] = [`# ${title}`, ""];
  if (info.description) out.push(clip(info.description, 2000), "");
  const servers = Array.isArray(doc.servers) ? doc.servers : [];
  if (servers.length)
    out.push(
      `Servers: ${servers.map((s) => (isObj(s) ? `${String(s.url)}${s.description ? ` (${clip(s.description, 80)})` : ""}` : String(s))).join(", ")}`,
      "",
    );
  else if (doc.host)
    out.push(`Host: ${String(doc.host)}${doc.basePath ? String(doc.basePath) : ""}`, "");
  const comps = isObj(doc.components) ? doc.components : {};
  const sec = isObj(comps.securitySchemes)
    ? comps.securitySchemes
    : isObj(doc.securityDefinitions)
      ? doc.securityDefinitions
      : undefined;
  if (sec) {
    out.push("## Authentication", "");
    for (const [name, raw] of Object.entries(sec)) {
      const s = deref(doc, raw) ?? {};
      out.push(
        `- **${name}**: ${String(s.type ?? "")}${s.scheme ? ` ${String(s.scheme)}` : ""}${s.in ? ` in ${String(s.in)}${s.name ? ` (${String(s.name)})` : ""}` : ""}${s.description ? ` — ${clip(s.description, 200)}` : ""}`,
      );
    }
    out.push("");
  }
  let operations = 0;
  const paths = isObj(doc.paths) ? doc.paths : {};
  for (const [path, rawItem] of Object.entries(paths)) {
    const item = deref(doc, rawItem);
    if (!item) continue;
    const shared = Array.isArray(item.parameters) ? item.parameters : [];
    for (const method of METHODS) {
      const op = item[method];
      if (!isObj(op)) continue;
      operations++;
      const summary = clip(op.summary, 120) || clip(op.operationId, 80);
      out.push(`## ${method.toUpperCase()} ${path}${summary ? ` — ${summary}` : ""}`, "");
      const tags = Array.isArray(op.tags) ? op.tags.map(String) : [];
      const meta = [
        op.operationId ? `operationId: ${String(op.operationId)}` : "",
        tags.length ? `tags: ${tags.join(", ")}` : "",
        op.deprecated ? "**deprecated**" : "",
      ].filter(Boolean);
      if (meta.length) out.push(meta.join(" · "), "");
      if (op.description) out.push(clip(op.description, 1200), "");
      const security = Array.isArray(op.security) ? op.security : undefined;
      if (security)
        out.push(
          `Security: ${security.length ? security.map((s) => (isObj(s) ? Object.keys(s).join("+") : String(s))).join(" or ") : "none"}`,
          "",
        );
      const params = [...shared, ...(Array.isArray(op.parameters) ? op.parameters : [])];
      const table = paramTable(doc, params);
      if (table.length) out.push("Parameters:", "", ...table, "");
      const body = deref(doc, op.requestBody);
      if (body) {
        out.push(
          `Request body${body.required ? " (required)" : ""}:${body.description ? ` ${clip(body.description, 200)}` : ""}`,
          "",
        );
        out.push(...contentSummary(doc, body.content), "");
      } else {
        const bodyParam = params.map((p) => deref(doc, p)).find((p) => p?.in === "body");
        if (bodyParam)
          out.push("Request body:", "", `- ${schemaSummary(doc, bodyParam.schema)}`, "");
      }
      const responses = isObj(op.responses) ? op.responses : {};
      const lines: string[] = [];
      for (const [code, rawRes] of Object.entries(responses)) {
        const res = deref(doc, rawRes) ?? {};
        const content = contentSummary(
          doc,
          res.content ?? (res.schema ? { "application/json": { schema: res.schema } } : undefined),
        );
        lines.push(`- **${code}** ${clip(res.description, 200).replace(/\n+/g, " ")}`);
        for (const l of content) lines.push(`  ${l}`);
      }
      if (lines.length) out.push("Responses:", "", ...lines, "");
    }
  }
  const schemas = isObj(comps.schemas)
    ? comps.schemas
    : isObj(doc.definitions)
      ? doc.definitions
      : {};
  const names = Object.keys(schemas);
  if (names.length) {
    out.push("## Schemas", "");
    for (const name of names.slice(0, 300)) {
      const s = deref(doc, schemas[name]);
      out.push(`### ${name}`, "");
      if (s?.description) out.push(clip(s.description, 400), "");
      out.push(
        `\`${schemaSummary(doc, { $ref: `#/components/schemas/${name}` }) || schemaSummary(doc, s)}\``,
        "",
      );
    }
    if (names.length > 300) out.push(`… ${names.length - 300} more schemas`, "");
  }
  let markdown = out.join("\n");
  if (markdown.length > MAX_OUT) markdown = `${markdown.slice(0, MAX_OUT)}\n\n… truncated`;
  return { kind: "openapi", title, markdown, operations };
}

// --- Postman ------------------------------------------------------------------------------

function postmanUrl(url: unknown): string {
  if (typeof url === "string") return url;
  if (!isObj(url)) return "";
  if (typeof url.raw === "string") return url.raw;
  const host = Array.isArray(url.host) ? url.host.join(".") : String(url.host ?? "");
  const path = Array.isArray(url.path) ? url.path.join("/") : String(url.path ?? "");
  return `${url.protocol ? `${String(url.protocol)}://` : ""}${host}/${path}`;
}

function postmanBody(body: unknown): string[] {
  if (!isObj(body)) return [];
  const mode = String(body.mode ?? "");
  if (mode === "raw" && typeof body.raw === "string") {
    const raw = body.raw.trim();
    const lang =
      isObj(body.options) && isObj(body.options.raw)
        ? String(body.options.raw.language ?? "json")
        : "json";
    return raw.length > 2000
      ? [`Body (${lang}): ${raw.slice(0, 2000)}…`]
      : ["Body:", "", `\`\`\`${lang}`, raw, "```"];
  }
  const list = body[mode];
  if (Array.isArray(list)) {
    const keys = list
      .filter(isObj)
      .map(
        (e) =>
          `${String(e.key)}${e.type && e.type !== "text" ? ` (${String(e.type)})` : ""}${e.description ? ` — ${clip(e.description, 100)}` : ""}`,
      );
    return keys.length ? [`Body (${mode}): ${keys.join(", ")}`] : [];
  }
  if (mode === "graphql" && isObj(body.graphql))
    return ["Body (graphql):", "", "```graphql", String(body.graphql.query ?? ""), "```"];
  return [];
}

function postmanDescription(d: unknown): string {
  return isObj(d) ? clip(d.content, 1200) : clip(d, 1200);
}

function postmanItems(items: unknown[], out: string[], depth: number, count: { n: number }): void {
  for (const raw of items) {
    if (!isObj(raw)) continue;
    if (Array.isArray(raw.item)) {
      out.push(`${"#".repeat(Math.min(2 + depth, 5))} ${String(raw.name ?? "Folder")}`, "");
      const d = postmanDescription(raw.description);
      if (d) out.push(d, "");
      postmanItems(raw.item, out, depth + 1, count);
      continue;
    }
    const req = isObj(raw.request)
      ? raw.request
      : typeof raw.request === "string"
        ? { url: raw.request, method: "GET" }
        : undefined;
    if (!req) continue;
    count.n++;
    const method = String(req.method ?? "GET").toUpperCase();
    const url = postmanUrl(req.url);
    out.push(`## ${method} ${url}${raw.name ? ` — ${clip(raw.name, 100)}` : ""}`, "");
    const d = postmanDescription(req.description) || postmanDescription(raw.description);
    if (d) out.push(d, "");
    if (isObj(req.auth)) out.push(`Auth: ${String(req.auth.type ?? "")}`, "");
    const headers = Array.isArray(req.header)
      ? req.header.filter(isObj).filter((h) => !h.disabled)
      : [];
    if (headers.length)
      out.push(
        `Headers: ${headers.map((h) => `${String(h.key)}: ${clip(h.value, 80)}`).join("; ")}`,
        "",
      );
    const query = isObj(req.url) && Array.isArray(req.url.query) ? req.url.query.filter(isObj) : [];
    if (query.length)
      out.push(
        `Query: ${query.map((q) => `${String(q.key)}=${clip(q.value, 60)}${q.description ? ` (${postmanDescription(q.description).slice(0, 80)})` : ""}`).join(", ")}`,
        "",
      );
    const vars =
      isObj(req.url) && Array.isArray(req.url.variable) ? req.url.variable.filter(isObj) : [];
    if (vars.length)
      out.push(
        `Path variables: ${vars.map((v) => `${String(v.key)}${v.description ? ` (${postmanDescription(v.description).slice(0, 80)})` : ""}`).join(", ")}`,
        "",
      );
    out.push(...postmanBody(req.body));
    const responses = Array.isArray(raw.response) ? raw.response.filter(isObj) : [];
    if (responses.length) {
      out.push("", "Example responses:", "");
      for (const r of responses.slice(0, 4)) {
        out.push(`- **${String(r.code ?? "")}** ${clip(r.name ?? r.status, 100)}`);
        if (typeof r.body === "string" && r.body.trim() && r.body.length < 1500)
          out.push("  ```json", `  ${r.body.trim().split("\n").join("\n  ")}`, "  ```");
      }
    }
    out.push("");
  }
}

export function postmanToMarkdown(doc: Obj): SpecMarkdown {
  const info = isObj(doc.info) ? doc.info : {};
  const title = `${String(info.name ?? "Postman collection")} (Postman collection)`;
  const out: string[] = [`# ${title}`, ""];
  const d = postmanDescription(info.description);
  if (d) out.push(d, "");
  const vars = Array.isArray(doc.variable) ? doc.variable.filter(isObj) : [];
  if (vars.length)
    out.push(
      `Variables: ${vars.map((v) => `{{${String(v.key)}}}${v.value ? ` = ${clip(v.value, 60)}` : ""}`).join(", ")}`,
      "",
    );
  if (isObj(doc.auth)) out.push(`Collection auth: ${String(doc.auth.type ?? "")}`, "");
  const count = { n: 0 };
  postmanItems(Array.isArray(doc.item) ? doc.item : [], out, 0, count);
  let markdown = out.join("\n");
  if (markdown.length > MAX_OUT) markdown = `${markdown.slice(0, MAX_OUT)}\n\n… truncated`;
  return { kind: "postman", title, markdown, operations: count.n };
}

/** Markdown for an OpenAPI document or Postman collection, or undefined when `text` is neither. */
export function specToMarkdown(text: string): SpecMarkdown | undefined {
  const doc = parseSpecText(text);
  if (!doc) return undefined;
  const kind = detectSpec(doc);
  if (kind === "openapi") return openapiToMarkdown(doc);
  if (kind === "postman") return postmanToMarkdown(doc);
  return undefined;
}

/** Cheap pre-check so ordinary files are not parsed: name or first bytes look like a spec. */
export function looksLikeSpec(nameOrUrl: string, head: string): boolean {
  if (
    /(openapi|swagger|api-docs|postman_collection|asyncapi)[^/]*(\.(json|ya?ml))?$/i.test(nameOrUrl)
  )
    return true;
  const h = head.slice(0, 4000);
  return (
    /"(openapi|swagger)"\s*:\s*"/.test(h) ||
    /^(openapi|swagger)\s*:/m.test(h) ||
    /schema\.getpostman\.com|postman\.com\/json\/collection/.test(h)
  );
}
