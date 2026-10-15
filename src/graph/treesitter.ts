import type { Node as TSNode } from "web-tree-sitter";
import type { GraphEdge, GraphNode } from "../storage/types.js";
import { fileId, pkgId, symId } from "./ids.js";
import { parseGo } from "./languages/go.js";
import { type Grammar, getParser, grammarFor } from "./languages/parser.js";
import { parsePhp } from "./languages/php.js";
import { parsePython } from "./languages/python.js";
import { packageName, resolveImport } from "./resolve.js";
import {
  fileRoutes,
  frameworkOf,
  httpMethod,
  joinRoutePath,
  normalizeRoutePath,
  parseAliasKey,
  parseRestShorthand,
  type RouteSpec,
  routeId,
  routePathFromLiteral,
} from "./routes.js";

export { type Grammar, grammarFor };

export interface ParsedFile {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Exported symbol names (for callers resolving imports). */
  exports: string[];
  /** Syntax errors the parser recovered from (tree-sitter never fails outright). */
  errors?: number | undefined;
}

const DECL_TYPES: Record<string, string> = {
  function_declaration: "function",
  generator_function_declaration: "function",
  class_declaration: "class",
  abstract_class_declaration: "class",
  interface_declaration: "interface",
  type_alias_declaration: "type",
  enum_declaration: "enum",
  method_definition: "method",
  method_signature: "method",
  public_field_definition: "field",
  abstract_method_signature: "method",
};

/** Syntax that opens a branch; one plus their count is a cyclomatic-style complexity. */
const BRANCH_TYPES = [
  "if_statement",
  "for_statement",
  "for_in_statement",
  "while_statement",
  "do_statement",
  "switch_case",
  "catch_clause",
  "ternary_expression",
  "binary_expression",
];

/** `"users"` / `'users'` / `` `users` `` (no substitutions) → `users`; anything else undefined. */
function stringValue(n: TSNode): string | undefined {
  if (n.type !== "string" && n.type !== "template_string") return undefined;
  const m = /^(['"`])([^'"`$]*)\1$/.exec(n.text.trim());
  return m ? m[2] : undefined;
}

/** The literal name of an object key: `foo`, `"foo"` or `'foo'`; computed keys are skipped. */
function propertyKey(k: TSNode): string | undefined {
  if (k.type === "property_identifier" || k.type === "identifier" || k.type === "number")
    return k.text;
  return stringValue(k);
}

/**
 * `{ a: x, "b": y, c() {}, d }` → key → value node. Methods and shorthand properties map
 * to their own node so handler attribution can treat them like inline functions.
 */
function objectEntries(obj: TSNode): Map<string, TSNode> {
  const out = new Map<string, TSNode>();
  for (const c of obj.namedChildren) {
    if (!c) continue;
    if (c.type === "pair") {
      const k = c.childForFieldName("key");
      const v = c.childForFieldName("value");
      const key = k ? propertyKey(k) : undefined;
      if (key && v) out.set(key, v);
    } else if (c.type === "method_definition") {
      const nameNode = c.childForFieldName("name");
      const key = nameNode ? propertyKey(nameNode) : undefined;
      if (key) out.set(key, c);
    } else if (c.type === "shorthand_property_identifier") {
      out.set(c.text, c);
    }
  }
  return out;
}

function complexityOf(n: TSNode): number {
  let c = 1;
  for (const b of n.descendantsOfType(BRANCH_TYPES)) {
    if (b.type === "binary_expression") {
      const op = b.childForFieldName("operator")?.type;
      if (op === "&&" || op === "||" || op === "??") c++;
    } else c++;
  }
  return c;
}

/**
 * Walk a TS/JS syntax tree and emit graph nodes/edges for one file: file,
 * declarations (`sym:`), imports and re-exports (resolved to files or `pkg:`),
 * exports, calls, references, extends/implements, HTTP routes. Confidence reflects
 * how sure the resolution is; the link pass (`link.ts`) repairs what a single file
 * cannot know (barrels, default exports).
 */
export async function parseFile(root: string, rel: string, code: string): Promise<ParsedFile> {
  const grammar = grammarFor(rel);
  if (!grammar) return { nodes: [], edges: [], exports: [] };
  if (grammar === "python") return parsePython(root, rel, code);
  if (grammar === "go") return parseGo(root, rel, code);
  if (grammar === "php") return parsePhp(root, rel, code);
  const p = await getParser(grammar);
  const tree = p.parse(code);
  if (!tree) return { nodes: [], edges: [], exports: [] };

  const fid = fileId(rel);
  const fileNode: GraphNode = {
    id: fid,
    kind: "file",
    name: rel,
    path: rel,
    source: "tree-sitter",
  };
  const nodes: GraphNode[] = [fileNode];
  const edges: GraphEdge[] = [];
  const exportsList: string[] = [];
  /** local name → node id it refers to (imports and local declarations). */
  const scope = new Map<string, { id: string; confidence: number }>();
  const localSyms = new Map<string, string>();
  /** local variable → class symbol it was constructed from (`const s = new Service()`). */
  const instanceOf = new Map<string, { id: string; confidence: number }>();
  /** bare package names imported by this file (framework detection). */
  const importedPkgs = new Set<string>();
  /** router variable → mount prefix (`new Router({ prefix })`, `router.prefix("/api")`). */
  const routerPrefix = new Map<string, string>();
  /** calls/references collected in pass 2, keyed (src, dst, kind) so repeats aggregate. */
  const refs = new Map<string, Ref>();
  let defaultExport: string | undefined;
  let complexity = 0;

  const pushEdge = (e: GraphEdge) => edges.push({ confidence: 1, weight: 1, ...e });

  // Pass 1: imports and top-level declarations populate the scope.
  for (const stmt of tree.rootNode.namedChildren) {
    if (!stmt) continue;
    if (stmt.type === "import_statement") handleImport(stmt);
    else collectDecls(stmt, undefined, stmt.type === "export_statement");
  }
  // Pass 2: calls, identifier references and route registrations inside declarations.
  collectPrefixCalls(tree.rootNode);
  for (const stmt of tree.rootNode.namedChildren) {
    if (stmt && stmt.type !== "import_statement") walkRefs(stmt);
  }
  flushRefs();
  moleculerRoutes(tree.rootNode);

  /** `router.prefix("/api")` applies to routes registered before and after it, so it is
   *  collected before pass 2 rather than in document order. */
  function collectPrefixCalls(rootNode: TSNode): void {
    for (const call of rootNode.descendantsOfType("call_expression")) {
      const fn = call.childForFieldName("function");
      if (fn?.type !== "member_expression") continue;
      if (fn.childForFieldName("property")?.text !== "prefix") continue;
      const obj = fn.childForFieldName("object");
      const arg = call.childForFieldName("arguments")?.namedChildren[0];
      const p = arg ? routePathFromLiteral(arg.text) : undefined;
      if (obj?.type === "identifier" && p) routerPrefix.set(obj.text, p);
    }
  }
  for (const r of fileRoutes(rel, exportsList, defaultExport)) {
    addRoute(r.method, r.path, r.framework, 1, [symId(rel, r.handler)], 0.95);
  }
  const errors = tree.rootNode.hasError ? tree.rootNode.descendantsOfType("ERROR").length : 0;
  fileNode.meta = {
    loc: tree.rootNode.endPosition.row + 1,
    complexity,
    ...(defaultExport ? { default_export: defaultExport } : {}),
    ...(errors ? { parse_errors: errors } : {}),
  };
  return { nodes, edges, exports: exportsList, errors };

  /** The module specifier of an import, or of an `export … from` (which needs the `from` keyword). */
  function sourceOf(stmt: TSNode): string | undefined {
    const src = stmt.childForFieldName("source");
    if (src) return src.namedChildren[0]?.text ?? src.text.replace(/^['"`]|['"`]$/g, "");
    if (stmt.type !== "import_statement") return undefined;
    return stmt.descendantsOfType("string_fragment")[0]?.text;
  }

  function linkModule(stmt: TSNode, src: string, kind: "imports" | "reexports", names: string[]) {
    const resolved = resolveImport(root, rel, src);
    const target = resolved ? fileId(resolved) : pkgId(packageName(src));
    if (!resolved) {
      importedPkgs.add(packageName(src));
      nodes.push({ id: target, kind: "package", name: packageName(src), source: "tree-sitter" });
    }
    pushEdge({
      src: fid,
      dst: target,
      kind,
      source: "tree-sitter",
      confidence: resolved ? 0.95 : 1,
      meta: { names, spec: src, line: stmt.startPosition.row + 1 },
    });
  }

  function handleImport(stmt: TSNode): void {
    const src = sourceOf(stmt);
    if (!src) return;
    const names: string[] = [];
    for (const spec of stmt.descendantsOfType("import_specifier")) {
      const name = spec.childForFieldName("name")?.text;
      const alias = spec.childForFieldName("alias")?.text ?? name;
      if (name && alias) names.push(alias === name ? name : `${name} as ${alias}`);
      if (name && alias) registerImport(alias, name, src);
    }
    const clause = stmt.namedChildren.find((c) => c?.type === "import_clause");
    for (const c of clause?.namedChildren ?? []) {
      if (c?.type === "identifier") {
        names.push(`default as ${c.text}`);
        registerImport(c.text, "default", src);
      }
      if (c?.type === "namespace_import") {
        const alias = c.descendantsOfType("identifier")[0]?.text;
        if (alias) {
          names.push(`* as ${alias}`);
          registerImport(alias, "*", src);
        }
      }
    }
    linkModule(stmt, src, "imports", names);
  }

  function registerImport(local: string, exported: string, spec: string): void {
    const resolved = resolveImport(root, rel, spec);
    if (resolved) scope.set(local, { id: symId(resolved, exported), confidence: 0.8 });
    else scope.set(local, { id: pkgId(packageName(spec)), confidence: 0.6 });
  }

  function declName(n: TSNode): string | undefined {
    return n.childForFieldName("name")?.text;
  }

  function collectDecls(n: TSNode, parentName: string | undefined, exported: boolean): void {
    if (n.type === "export_statement") {
      const src = sourceOf(n);
      const isDefault = n.children.some((c) => c?.type === "default");
      if (src) {
        // `export … from "x"`: a barrel. Names are recorded so the link pass can follow them.
        const names: string[] = [];
        for (const spec of n.descendantsOfType("export_specifier")) {
          const name = spec.childForFieldName("name")?.text;
          const alias = spec.childForFieldName("alias")?.text ?? name;
          if (name && alias) {
            names.push(alias === name ? name : `${name} as ${alias}`);
            exportsList.push(alias);
          }
        }
        const ns = n.descendantsOfType("namespace_export")[0];
        if (ns) {
          const alias = ns.descendantsOfType("identifier")[0]?.text;
          if (alias) {
            names.push(`* as ${alias}`);
            exportsList.push(alias);
          }
        } else if (!names.length) names.push("*");
        linkModule(n, src, "reexports", names);
        return;
      }
      const decl =
        n.childForFieldName("declaration") ?? n.namedChildren.find((c) => c && DECL_TYPES[c.type]);
      if (decl) {
        collectDecls(decl, parentName, true);
        if (isDefault) defaultExport = declName(decl) ?? defaultExport;
        return;
      }
      const value = n.childForFieldName("value");
      if (isDefault && value) {
        // `export default foo` aliases a symbol; `export default () => …` is one.
        if (value.type === "identifier") defaultExport = value.text;
        else {
          const k = /class/.test(value.type)
            ? "class"
            : /function|arrow_function/.test(value.type)
              ? "function"
              : "variable";
          addSym("default", k, value, true);
          defaultExport = "default";
        }
        return;
      }
      if (
        n.namedChildren.some(
          (c) => c?.type === "lexical_declaration" || c?.type === "variable_declaration",
        )
      ) {
        for (const c of n.namedChildren) if (c) collectDecls(c, parentName, true);
      }
      for (const spec of n.descendantsOfType("export_specifier")) {
        const name = spec.childForFieldName("alias")?.text ?? spec.childForFieldName("name")?.text;
        if (name) exportsList.push(name);
      }
      return;
    }
    const kind = DECL_TYPES[n.type];
    if (kind) {
      const name = declName(n);
      if (!name) return;
      const qualified = parentName ? `${parentName}.${name}` : name;
      addSym(qualified, kind, n, exported && !parentName);
      if (kind === "class" || kind === "interface") {
        const body = n.childForFieldName("body");
        for (const m of body?.namedChildren ?? []) if (m) collectDecls(m, qualified, false);
        for (const h of n.descendantsOfType([
          "extends_clause",
          "implements_clause",
          "class_heritage",
        ])) {
          for (const idn of h.descendantsOfType([
            "identifier",
            "type_identifier",
            "member_expression",
          ])) {
            if (idn.parent?.type === "member_expression" && idn.type !== "member_expression")
              continue;
            const ref =
              scope.get(idn.text) ??
              (localSyms.has(idn.text)
                ? { id: localSyms.get(idn.text)!, confidence: 0.9 }
                : undefined);
            pushEdge({
              src: symId(rel, qualified),
              dst: ref?.id ?? symId(rel, idn.text),
              kind: h.type === "implements_clause" ? "implements" : "extends",
              source: "tree-sitter",
              confidence: ref?.confidence ?? 0.5,
            });
          }
        }
      }
      return;
    }
    if (n.type === "lexical_declaration" || n.type === "variable_declaration") {
      for (const d of n.namedChildren) {
        if (d?.type !== "variable_declarator") continue;
        const name = declName(d);
        const value = d.childForFieldName("value");
        if (!name) continue;
        const k = value && /function|arrow_function/.test(value.type) ? "function" : "variable";
        addSym(parentName ? `${parentName}.${name}` : name, k, d, exported && !parentName);
        noteInstance(d);
        noteRequire(d, name);
        noteRouterPrefix(d, name);
      }
    }
  }

  /** `const x = require("pkg")`: a CommonJS import, linked like an `import` statement. */
  function noteRequire(declarator: TSNode, name: string): void {
    const value = declarator.childForFieldName("value");
    if (value?.type !== "call_expression") return;
    if (value.childForFieldName("function")?.text !== "require") return;
    const arg = value.childForFieldName("arguments")?.namedChildren[0];
    const spec = arg ? stringValue(arg) : undefined;
    if (!spec) return;
    linkModule(declarator, spec, "imports", [name]);
  }

  /** `const router = new Router({ prefix: "/api" })` (koa-router): remember the prefix. */
  function noteRouterPrefix(declarator: TSNode, name: string): void {
    const value = declarator.childForFieldName("value");
    if (value?.type !== "new_expression") return;
    const opts = value.childForFieldName("arguments")?.namedChildren[0];
    if (opts?.type !== "object") return;
    const prefix = objectEntries(opts).get("prefix");
    const p = prefix ? routePathFromLiteral(prefix.text) : undefined;
    if (p) routerPrefix.set(name, p);
  }

  /** `const x = new Y()` anywhere: remember x's class so `x.method()` resolves to `Y.method`. */
  function noteInstance(declarator: TSNode): void {
    const name = declName(declarator);
    const value = declarator.childForFieldName("value");
    if (!name || value?.type !== "new_expression") return;
    const ctor = value.childForFieldName("constructor");
    if (ctor?.type !== "identifier") return;
    const target = scope.get(ctor.text);
    if (target?.id.startsWith("sym:")) instanceOf.set(name, target);
  }

  function addSym(qualified: string, kind: string, n: TSNode, exported: boolean): void {
    const id = symId(rel, qualified);
    const c = kind === "function" || kind === "method" ? complexityOf(n) : 0;
    complexity += c;
    nodes.push({
      id,
      kind,
      name: qualified,
      path: rel,
      startLine: n.startPosition.row + 1,
      endLine: n.endPosition.row + 1,
      source: "tree-sitter",
      meta: {
        ...(exported ? { exported: true } : {}),
        loc: n.endPosition.row - n.startPosition.row + 1,
        ...(c ? { complexity: c } : {}),
      },
    });
    pushEdge({ src: fid, dst: id, kind: "defines", source: "tree-sitter" });
    if (exported) {
      exportsList.push(qualified);
      pushEdge({ src: fid, dst: id, kind: "exports", source: "tree-sitter" });
    }
    if (!qualified.includes(".")) {
      localSyms.set(qualified, id);
      scope.set(qualified, { id, confidence: 0.9 });
    } else {
      localSyms.set(qualified, id);
    }
  }

  /**
   * The symbol a node sits in. Nested arrow functions and inner `const`s are not
   * symbols themselves, so the longest prefix of the declaration chain that is a
   * known symbol wins (a reference inside `run`'s inner callback belongs to `run`).
   */
  function enclosing(n: TSNode): string | undefined {
    const parts: string[] = [];
    let cur: TSNode | null = n.parent;
    while (cur) {
      if (DECL_TYPES[cur.type] || cur.type === "variable_declarator") {
        const name = declName(cur);
        if (name) parts.unshift(name);
      }
      cur = cur.parent;
    }
    for (let i = parts.length; i > 0; i--) {
      const q = parts.slice(0, i).join(".");
      if (localSyms.has(q)) return q;
    }
    return undefined;
  }

  /** Edges are keyed (src, dst, kind); repeated uses aggregate into count + first lines. */
  function pushRef(src: string, dst: string, kind: string, confidence: number, line: number): void {
    if (dst === src) return;
    const key = `${src}\u0000${dst}\u0000${kind}`;
    const cur = refs.get(key);
    if (cur) {
      cur.count++;
      cur.confidence = Math.max(cur.confidence, confidence);
      if (cur.lines.length < 5) cur.lines.push(line);
    } else refs.set(key, { src, dst, kind, confidence, count: 1, lines: [line] });
  }

  function flushRefs(): void {
    for (const r of refs.values()) {
      pushEdge({
        src: r.src,
        dst: r.dst,
        kind: r.kind,
        source: "tree-sitter",
        confidence: r.confidence,
        meta: { count: r.count, lines: r.lines },
      });
    }
  }

  /** `calls`: the callee of a call/new expression resolved through imports, locals and instances. */
  function callTarget(
    fn: TSNode,
    caller: string | undefined,
  ): { id: string; confidence: number } | undefined {
    if (fn.type === "identifier" || fn.type === "type_identifier") return scope.get(fn.text);
    if (fn.type !== "member_expression") return undefined;
    const obj = fn.childForFieldName("object");
    const prop = fn.childForFieldName("property")?.text;
    if (obj?.type === "this" && prop && caller) {
      return { id: symId(rel, `${caller.split(".")[0]!}.${prop}`), confidence: 0.9 };
    }
    if (obj?.type === "identifier" && prop) {
      const inst = instanceOf.get(obj.text);
      if (inst) return { id: `${inst.id}.${prop}`, confidence: inst.confidence * 0.9 };
      const base = scope.get(obj.text);
      if (base?.id.startsWith("sym:")) {
        // `* as ns` → a member of the module; otherwise a static member of the symbol.
        return base.id.endsWith("#*")
          ? { id: `${base.id.slice(0, -1)}${prop}`, confidence: 0.7 }
          : { id: `${base.id}.${prop}`, confidence: 0.6 };
      }
      if (base?.id.startsWith("pkg:")) return { id: base.id, confidence: 0.6 };
    }
    return undefined;
  }

  function addRoute(
    method: string,
    path: string,
    framework: string,
    line: number,
    handlers: string[],
    confidence: number,
    extra: Record<string, unknown> = {},
  ): void {
    const id = routeId(method, path);
    if (!nodes.some((n) => n.id === id)) {
      nodes.push({
        id,
        kind: "route",
        name: `${method} ${path}`,
        path: rel,
        startLine: line,
        endLine: line,
        source: "tree-sitter",
        meta: { method, route: path, framework, ...extra },
      });
      pushEdge({ src: fid, dst: id, kind: "defines", source: "tree-sitter" });
    }
    for (const h of handlers) {
      pushEdge({ src: h, dst: id, kind: "handles", source: "tree-sitter", confidence });
    }
  }

  /**
   * The symbols a list of handler expressions refers to: identifiers and members resolve
   * through the scope; inline functions (and object methods) attribute to the enclosing
   * symbol or the file; arrays (`[auth, handler]`) are flattened. Confidence drops as the
   * attribution gets vaguer; with nothing resolvable the enclosing symbol is a 0.5 guess.
   */
  function handlersOf(
    exprs: Array<TSNode | undefined>,
    caller: string | undefined,
  ): { handlers: string[]; confidence: number } {
    const handlers: string[] = [];
    let confidence = 0.9;
    const self = caller ? symId(rel, caller) : fid;
    const visit = (a: TSNode | undefined): void => {
      if (!a) return;
      if (a.type === "identifier" || a.type === "shorthand_property_identifier") {
        const t = scope.get(a.text);
        if (t?.id.startsWith("sym:")) handlers.push(t.id);
      } else if (a.type === "member_expression") {
        const t = callTarget(a, caller);
        if (t?.id.startsWith("sym:")) handlers.push(t.id);
      } else if (/function|arrow_function|method_definition/.test(a.type)) {
        handlers.push(self);
        confidence = Math.min(confidence, 0.7);
      } else if (a.type === "array") {
        for (const el of a.namedChildren) visit(el ?? undefined);
      }
    };
    for (const e of exprs) visit(e);
    if (!handlers.length) {
      handlers.push(self);
      confidence = 0.5;
    }
    return { handlers: [...new Set(handlers)], confidence };
  }

  /**
   * `app.get("/path", h1, h2)` → a route node handled by h1/h2 (or the enclosing symbol).
   * Also koa-router named routes (`router.get("name", "/path", h)`), the `del` alias,
   * router prefixes, and `server.route({...})` config objects (hapi, fastify).
   */
  function routeFromCall(call: TSNode): void {
    const fn = call.childForFieldName("function");
    if (fn?.type !== "member_expression") return;
    const prop = fn.childForFieldName("property")?.text;
    if (!prop) return;
    const obj = fn.childForFieldName("object");
    const args = (call.childForFieldName("arguments")?.namedChildren ?? []).filter(
      (a): a is TSNode => !!a,
    );
    const first = args[0];
    if (!first) return;
    if (prop === "route" && (first.type === "object" || first.type === "array")) {
      routesFromConfig(first, call);
      return;
    }
    const method = httpMethod(prop);
    if (!method) return;
    let path = routePathFromLiteral(first.text);
    let rest = args.slice(1);
    if (!path && first.type === "string" && args[1]) {
      // koa-router named route: the name comes first, the path second
      path = routePathFromLiteral(args[1].text);
      rest = args.slice(2);
    }
    if (!path) return;
    if (obj?.type === "identifier" && routerPrefix.has(obj.text)) {
      path = joinRoutePath(routerPrefix.get(obj.text), path);
    }
    const framework = frameworkOf(importedPkgs) ?? "http";
    const caller = enclosing(call);
    const { handlers, confidence } = handlersOf(rest, caller);
    addRoute(method, path, framework, call.startPosition.row + 1, handlers, confidence);
  }

  /**
   * `server.route({ method: "GET", path: "/users/{id}", handler })` and
   * `server.route([{...}, {...}])` (hapi; fastify spells the path `url` and may nest the
   * handler under `options`/`config`). `method` may be a string, `"*"` or an array.
   */
  function routesFromConfig(arg: TSNode, call: TSNode): void {
    const configs = arg.type === "array" ? arg.namedChildren : [arg];
    const framework = frameworkOf(importedPkgs) ?? "http";
    const caller = enclosing(call);
    for (const cfg of configs) {
      if (cfg?.type !== "object") continue;
      const entries = objectEntries(cfg);
      const methodNode = entries.get("method");
      const pathNode = entries.get("path") ?? entries.get("url");
      if (!methodNode || !pathNode) continue;
      const rawPath = stringValue(pathNode);
      if (!rawPath?.startsWith("/")) continue;
      const methods = methodsOf(methodNode);
      if (!methods.length) continue;
      const options = entries.get("options") ?? entries.get("config");
      const handlerNode =
        entries.get("handler") ??
        (options?.type === "object" ? objectEntries(options).get("handler") : undefined);
      const { handlers, confidence } = handlersOf([handlerNode], caller);
      const path = normalizeRoutePath(rawPath);
      for (const m of methods) {
        addRoute(m, path, framework, cfg.startPosition.row + 1, handlers, confidence);
      }
    }
  }

  /** `"GET"`, `"*"` or `["GET", "POST"]` → upper-case methods; unknown verbs are dropped. */
  function methodsOf(n: TSNode): string[] {
    const lits = n.type === "array" ? n.namedChildren.filter((c): c is TSNode => !!c) : [n];
    const out: string[] = [];
    for (const lit of lits) {
      const s = stringValue(lit);
      const m = s ? httpMethod(s) : undefined;
      if (m) out.push(m);
    }
    return out;
  }

  /**
   * moleculer routes are declared as data, often in files that import nothing:
   *  - moleculer-web gateway: `settings.routes[].aliases` maps `"GET users/:id"` keys to
   *    action names, handlers or arrays of middleware; the route's `path` and the
   *    gateway's `settings.path` prefix every alias; `REST users` expands to CRUD.
   *  - service schema: `actions.<name>.rest` (`"GET /:id"`, `{ method, path }`, `true`)
   *    under the base path `settings.rest` (default `/<version>/<service name>`).
   */
  function moleculerRoutes(rootNode: TSNode): void {
    const framework = "moleculer";
    const fromImport = frameworkOf(importedPkgs) === framework;
    for (const pair of rootNode.descendantsOfType("pair")) {
      const key = pair.childForFieldName("key");
      const value = pair.childForFieldName("value");
      if (!key || value?.type !== "object") continue;
      const k = propertyKey(key);
      if (k === "aliases") {
        const group = pair.parent?.type === "object" ? objectEntries(pair.parent) : undefined;
        const looksLikeGateway =
          fromImport ||
          !!group?.has("path") ||
          !!group?.has("whitelist") ||
          !!group?.has("mappingPolicy") ||
          !!group?.has("bodyParsers");
        if (!looksLikeGateway) continue;
        const groupPath = group ? literalOf(group.get("path")) : undefined;
        const gateway = pair.parent ? enclosingSettings(pair.parent, "routes") : undefined;
        const base = joinRoutePath(gateway ? literalOf(gateway.get("path")) : undefined, groupPath);
        for (const [aliasKey, target] of objectEntries(value)) {
          const action = target.type === "array" ? lastString(target) : stringValue(target);
          for (const spec of parseAliasKey(aliasKey, action)) {
            emitSpec(spec, base, target, pair, framework);
          }
        }
      } else if (k === "actions") {
        const schema = pair.parent?.type === "object" ? objectEntries(pair.parent) : undefined;
        if (!schema) continue;
        const settings = schema.get("settings");
        const settingsRest =
          settings?.type === "object" ? literalOf(objectEntries(settings).get("rest")) : undefined;
        const name = literalOf(schema.get("name"));
        const version = schema.get("version")?.text.replace(/^['"`]|['"`]$/g, "");
        const base =
          settingsRest ??
          (name
            ? joinRoutePath(version && /^\d+$/.test(version) ? `v${version}` : version, name)
            : undefined);
        for (const [actionName, def] of objectEntries(value)) {
          if (def.type !== "object") continue;
          const action = objectEntries(def);
          const restNode = action.get("rest");
          if (!restNode) continue;
          const handler = action.get("handler") ?? def;
          for (const spec of restSpecs(restNode, actionName)) {
            const b = spec.basePath ?? base;
            emitSpec(spec, b, handler, def, framework, name ? `${name}.${actionName}` : undefined);
          }
        }
      }
    }
  }

  function emitSpec(
    spec: RouteSpec,
    base: string | undefined,
    handlerNode: TSNode,
    at: TSNode,
    framework: string,
    actionName?: string,
  ): void {
    const caller = enclosing(at);
    const { handlers, confidence } = handlersOf([handlerNode], caller);
    const action = spec.action ?? actionName;
    addRoute(
      spec.method,
      joinRoutePath(base, spec.path),
      framework,
      at.startPosition.row + 1,
      handlers,
      confidence,
      action ? { action } : {},
    );
  }

  /** `rest: "GET /:id"`, `rest: true`, `rest: { method, path, basePath }` or an array of those. */
  function restSpecs(n: TSNode, actionName: string): Array<RouteSpec & { basePath?: string }> {
    if (n.type === "array") {
      return n.namedChildren.flatMap((c) => (c ? restSpecs(c, actionName) : []));
    }
    if (n.type === "true") return parseRestShorthand(true, actionName);
    const s = stringValue(n);
    if (s) return parseRestShorthand(s, actionName);
    if (n.type !== "object") return [];
    const e = objectEntries(n);
    const method = literalOf(e.get("method"));
    const path = literalOf(e.get("path"));
    const basePath = literalOf(e.get("basePath"));
    if (!path) return [];
    const spec: RouteSpec & { basePath?: string } = {
      method: (method && httpMethod(method)) || "ALL",
      path: joinRoutePath(path),
    };
    if (basePath) spec.basePath = basePath;
    return [spec];
  }

  /** The nearest ancestor object literal that has a `<key>` entry (e.g. the gateway `settings`). */
  function enclosingSettings(n: TSNode, key: string): Map<string, TSNode> | undefined {
    let cur: TSNode | null = n.parent;
    while (cur) {
      if (cur.type === "object") {
        const e = objectEntries(cur);
        if (e.has(key)) return e;
      }
      cur = cur.parent;
    }
    return undefined;
  }

  function literalOf(n: TSNode | undefined): string | undefined {
    return n ? stringValue(n) : undefined;
  }

  function lastString(arr: TSNode): string | undefined {
    for (let i = arr.namedChildren.length - 1; i >= 0; i--) {
      const c = arr.namedChildren[i];
      const s = c ? stringValue(c) : undefined;
      if (s) return s;
    }
    return undefined;
  }

  function walkRefs(n: TSNode): void {
    for (const d of n.descendantsOfType("variable_declarator")) noteInstance(d);
    for (const call of n.descendantsOfType(["call_expression", "new_expression"])) {
      if (call.type === "call_expression") routeFromCall(call);
      const fn = call.childForFieldName("function") ?? call.childForFieldName("constructor");
      if (!fn) continue;
      const caller = enclosing(call);
      const target = callTarget(fn, caller);
      if (!target) continue;
      pushRef(
        caller ? symId(rel, caller) : fid,
        target.id,
        "calls",
        target.confidence,
        call.startPosition.row + 1,
      );
    }
    // `references`: every other use of an imported or top-level name (values and types),
    // discounted so they never outrank calls/imports in impact scoring.
    for (const idn of n.descendantsOfType(["identifier", "type_identifier"])) {
      const p = idn.parent;
      if (!p || REF_SKIP_PARENT.has(p.type)) continue;
      if (p.childForFieldName("name")?.id === idn.id) continue; // the thing being declared
      const fn = p.childForFieldName("function") ?? p.childForFieldName("constructor");
      if (fn?.id === idn.id) continue; // callee: counted as a call
      if (p.type === "member_expression" && p.childForFieldName("object")?.id !== idn.id) continue;
      const target = scope.get(idn.text);
      if (!target) continue;
      const caller = enclosing(idn);
      pushRef(
        caller ? symId(rel, caller) : fid,
        target.id,
        "references",
        target.confidence * 0.9,
        idn.startPosition.row + 1,
      );
    }
    // `this.member` reads (not calls) inside a class.
    for (const me of n.descendantsOfType("member_expression")) {
      const prop = me.childForFieldName("property")?.text;
      if (me.childForFieldName("object")?.type !== "this" || !prop) continue;
      const p = me.parent;
      const callee = p
        ? (p.childForFieldName("function") ?? p.childForFieldName("constructor"))
        : null;
      if (callee?.id === me.id) continue;
      const caller = enclosing(me);
      if (!caller) continue;
      const member = `${caller.split(".")[0]!}.${prop}`;
      if (!localSyms.has(member)) continue;
      pushRef(symId(rel, caller), symId(rel, member), "references", 0.81, me.startPosition.row + 1);
    }
  }
}

type Ref = {
  src: string;
  dst: string;
  kind: string;
  confidence: number;
  count: number;
  lines: number[];
};

/** Parents under which an identifier is a declaration, a binding or already an edge of another kind. */
const REF_SKIP_PARENT = new Set([
  "import_specifier",
  "namespace_import",
  "import_clause",
  "export_specifier",
  "required_parameter",
  "optional_parameter",
  "rest_pattern",
  "array_pattern",
  "object_pattern",
  "pair_pattern",
  "catch_clause",
  "extends_clause",
  "implements_clause",
  "class_heritage",
  "extends_type_clause",
  "property_signature",
  "method_signature",
  "labeled_statement",
]);
