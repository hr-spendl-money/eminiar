import { existsSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import type { Node as TSNode } from "web-tree-sitter";
import type { GraphEdge, GraphNode } from "../../storage/types.js";
import { fileId, pkgId, symId } from "../ids.js";
import { frameworkOf, ROUTE_METHODS, routeId, routePathFromLiteral } from "../routes.js";
import type { ParsedFile } from "../treesitter.js";
import { complexityOf, getParser, literalText, RefCollector } from "./parser.js";

const BRANCHES = [
  "if_statement",
  "elif_clause",
  "for_statement",
  "while_statement",
  "except_clause",
  "conditional_expression",
  "boolean_operator",
  "case_clause",
  "for_in_clause",
];
const BOOL_OPS = new Set(["and", "or"]);

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/**
 * Resolve a Python module to a project file: relative imports from the importing
 * file's package, absolute ones from the project root, a `src/` layout, and every
 * ancestor package of the importing file (how `python -m` and most test runners see it).
 */
export function resolvePython(
  root: string,
  fromRel: string,
  module: string,
  level: number,
): string | undefined {
  const parts = module ? module.split(".") : [];
  const candidates: string[] = [];
  if (level > 0) {
    let base = dirname(resolve(root, fromRel));
    for (let i = 1; i < level; i++) base = dirname(base);
    candidates.push(join(base, ...parts));
  } else {
    candidates.push(resolve(root, ...parts), resolve(root, "src", ...parts));
    let dir = dirname(resolve(root, fromRel));
    while (dir.startsWith(root) && dir !== root) {
      candidates.push(join(dir, ...parts));
      dir = dirname(dir);
    }
  }
  for (const c of candidates) {
    for (const f of [`${c}.py`, join(c, "__init__.py"), `${c}.pyi`]) {
      if (isFile(f) && !relative(root, f).startsWith(".."))
        return normalize(relative(root, f)).split("\\").join("/");
    }
  }
  return undefined;
}

/** Top-level distribution name of an absolute import (`os.path` → `os`). */
const topModule = (module: string): string => module.split(".")[0] ?? module;

export async function parsePython(root: string, rel: string, code: string): Promise<ParsedFile> {
  const p = await getParser("python");
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
  const scope = new Map<string, { id: string; confidence: number }>();
  const localSyms = new Map<string, string>();
  const importedPkgs = new Set<string>();
  const refs = new RefCollector();
  let complexity = 0;
  const pushEdge = (e: GraphEdge) => edges.push({ confidence: 1, weight: 1, ...e });

  for (const stmt of tree.rootNode.namedChildren) {
    if (!stmt) continue;
    if (stmt.type === "import_statement") handleImport(stmt);
    else if (stmt.type === "import_from_statement") handleFromImport(stmt);
    else collectDecls(stmt, undefined);
  }
  for (const stmt of tree.rootNode.namedChildren) {
    if (stmt && stmt.type !== "import_statement" && stmt.type !== "import_from_statement")
      walkRefs(stmt);
  }
  edges.push(...refs.edges());
  if (!existsSync(join(root, rel))) {
    // nothing: parse of in-memory content still works
  }
  const errors = tree.rootNode.hasError ? tree.rootNode.descendantsOfType("ERROR").length : 0;
  fileNode.meta = {
    loc: tree.rootNode.endPosition.row + 1,
    complexity,
    ...(errors ? { parse_errors: errors } : {}),
  };
  return { nodes, edges, exports: exportsList, errors };

  function linkModule(
    stmt: TSNode,
    module: string,
    level: number,
    names: string[],
  ): string | undefined {
    const resolved = level || module ? resolvePython(root, rel, module, level) : undefined;
    const target = resolved ? fileId(resolved) : pkgId(topModule(module || "."));
    if (!resolved) {
      importedPkgs.add(topModule(module || "."));
      nodes.push({
        id: target,
        kind: "package",
        name: topModule(module || "."),
        source: "tree-sitter",
      });
    }
    pushEdge({
      src: fid,
      dst: target,
      kind: "imports",
      source: "tree-sitter",
      confidence: resolved ? 0.95 : 1,
      meta: { names, spec: `${".".repeat(level)}${module}`, line: stmt.startPosition.row + 1 },
    });
    return resolved;
  }

  /** `import a.b as c`, `import os` */
  function handleImport(stmt: TSNode): void {
    for (const child of stmt.namedChildren) {
      if (!child) continue;
      let module: string | undefined;
      let alias: string | undefined;
      if (child.type === "dotted_name") module = child.text;
      else if (child.type === "aliased_import") {
        module = child.childForFieldName("name")?.text;
        alias = child.childForFieldName("alias")?.text;
      }
      if (!module) continue;
      const resolved = linkModule(stmt, module, 0, [alias ? `${module} as ${alias}` : module]);
      const local = alias ?? module.split(".")[0]!;
      if (resolved) scope.set(local, { id: symId(resolved, "*"), confidence: 0.8 });
      else scope.set(local, { id: pkgId(topModule(module)), confidence: 0.6 });
    }
  }

  /** `from .x import a as b, c`, `from pkg import *` */
  function handleFromImport(stmt: TSNode): void {
    const modNode = stmt.childForFieldName("module_name");
    let level = 0;
    let module = "";
    if (modNode?.type === "relative_import") {
      level = (modNode.text.match(/^\.+/)?.[0] ?? "").length;
      module = modNode.text.replace(/^\.+/, "");
    } else module = modNode?.text ?? "";
    const names: string[] = [];
    const specs = stmt.namedChildren.filter((c) => c && c !== modNode);
    const wildcard = stmt.children.some((c) => c?.type === "wildcard_import");
    const resolved = linkModule(stmt, module, level, wildcard ? ["*"] : []);
    for (const s of specs) {
      if (!s) continue;
      let name: string | undefined;
      let alias: string | undefined;
      if (s.type === "dotted_name") name = s.text;
      else if (s.type === "aliased_import") {
        name = s.childForFieldName("name")?.text;
        alias = s.childForFieldName("alias")?.text;
      }
      if (!name) continue;
      names.push(alias && alias !== name ? `${name} as ${alias}` : name);
      const local = alias ?? name;
      // `from pkg import submodule` binds a module, not a symbol in pkg/__init__.py
      const asModule = resolvePython(root, rel, module ? `${module}.${name}` : name, level);
      if (asModule && asModule !== resolved) {
        scope.set(local, { id: symId(asModule, "*"), confidence: 0.8 });
        pushEdge({
          src: fid,
          dst: fileId(asModule),
          kind: "imports",
          source: "tree-sitter",
          confidence: 0.95,
          meta: {
            names: ["*"],
            spec: `${".".repeat(level)}${module}.${name}`,
            line: stmt.startPosition.row + 1,
          },
        });
      } else if (resolved) scope.set(local, { id: symId(resolved, name), confidence: 0.8 });
      else scope.set(local, { id: pkgId(topModule(module)), confidence: 0.6 });
    }
    // patch the names onto the edge just pushed
    const e = edges[edges.length - 1];
    if (e?.meta && !wildcard) e.meta = { ...e.meta, names };
  }

  function nameOf(n: TSNode): string | undefined {
    return n.childForFieldName("name")?.text;
  }

  function collectDecls(n: TSNode, parent: string | undefined): void {
    if (n.type === "decorated_definition") {
      const def = n.childForFieldName("definition");
      if (def) {
        collectDecls(def, parent);
        const name = nameOf(def);
        if (name) routesFromDecorators(n, parent ? `${parent}.${name}` : name);
      }
      return;
    }
    if (n.type === "function_definition" || n.type === "class_definition") {
      const name = nameOf(n);
      if (!name) return;
      const qualified = parent ? `${parent}.${name}` : name;
      const kind = n.type === "class_definition" ? "class" : parent ? "method" : "function";
      addSym(qualified, kind, n, !parent && !name.startsWith("_"));
      if (n.type === "class_definition") {
        for (const sup of n.childForFieldName("superclasses")?.namedChildren ?? []) {
          if (!sup) continue;
          const base =
            sup.type === "identifier" ? sup.text : sup.type === "attribute" ? sup.text : undefined;
          if (!base || sup.type === "keyword_argument") continue;
          const ref = scope.get(base.split(".")[0]!);
          const target =
            sup.type === "attribute" && ref?.id.startsWith("sym:")
              ? `${ref.id.replace(/#\*$/, "#")}${sup.childForFieldName("attribute")?.text ?? ""}`
              : (ref?.id ?? localSyms.get(base) ?? symId(rel, base));
          pushEdge({
            src: symId(rel, qualified),
            dst: target,
            kind: "extends",
            source: "tree-sitter",
            confidence: ref?.confidence ?? (localSyms.has(base) ? 0.9 : 0.5),
          });
        }
        for (const m of n.childForFieldName("body")?.namedChildren ?? []) {
          if (!m) continue;
          if (m.type === "function_definition" || m.type === "decorated_definition")
            collectDecls(m, qualified);
          else if (m.type === "expression_statement") {
            const a = m.namedChildren[0];
            const left = a?.type === "assignment" ? a.childForFieldName("left") : undefined;
            if (left?.type === "identifier")
              addSym(`${qualified}.${left.text}`, "field", a!, false);
          }
        }
      }
      return;
    }
    if (n.type === "expression_statement" && !parent) {
      const a = n.namedChildren[0];
      if (a?.type !== "assignment") return;
      const left = a.childForFieldName("left");
      if (left?.type === "identifier") {
        if (left.text === "__all__") return;
        addSym(left.text, "variable", a, !left.text.startsWith("_"));
      }
    }
  }

  function addSym(qualified: string, kind: string, n: TSNode, exported: boolean): void {
    const id = symId(rel, qualified);
    const c = kind === "function" || kind === "method" ? complexityOf(n, BRANCHES, BOOL_OPS) : 0;
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
    localSyms.set(qualified, id);
    if (!qualified.includes(".")) scope.set(qualified, { id, confidence: 0.9 });
  }

  function enclosing(n: TSNode): string | undefined {
    const parts: string[] = [];
    let cur: TSNode | null = n.parent;
    while (cur) {
      if (cur.type === "function_definition" || cur.type === "class_definition") {
        const name = nameOf(cur);
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

  function callTarget(
    fn: TSNode,
    caller: string | undefined,
  ): { id: string; confidence: number } | undefined {
    if (fn.type === "identifier") return scope.get(fn.text);
    if (fn.type !== "attribute") return undefined;
    const obj = fn.childForFieldName("object");
    const attr = fn.childForFieldName("attribute")?.text;
    if (!obj || !attr) return undefined;
    if (obj.type === "identifier" && (obj.text === "self" || obj.text === "cls") && caller) {
      return { id: symId(rel, `${caller.split(".")[0]!}.${attr}`), confidence: 0.9 };
    }
    if (obj.type === "identifier") {
      const base = scope.get(obj.text);
      if (base?.id.startsWith("sym:"))
        return base.id.endsWith("#*")
          ? { id: `${base.id.slice(0, -1)}${attr}`, confidence: 0.7 }
          : { id: `${base.id}.${attr}`, confidence: 0.6 };
      if (base?.id.startsWith("pkg:")) return { id: base.id, confidence: 0.6 };
    }
    if (obj.type === "attribute") {
      // a.b.c(): resolve a.b first, then .c
      const inner = callTarget(obj, caller);
      if (inner?.id.startsWith("sym:"))
        return { id: `${inner.id}.${attr}`, confidence: inner.confidence * 0.8 };
      if (inner?.id.startsWith("pkg:")) return inner;
    }
    return undefined;
  }

  /** `@app.get("/x")`, `@router.post("/x")`, `@app.route("/x", methods=["POST"])`. */
  function routesFromDecorators(decorated: TSNode, handler: string): void {
    for (const d of decorated.descendantsOfType("decorator")) {
      const call = d.namedChildren.find((c) => c?.type === "call");
      const fn = call?.childForFieldName("function");
      if (!call || fn?.type !== "attribute") continue;
      const method = fn.childForFieldName("attribute")?.text ?? "";
      const args = call.childForFieldName("arguments")?.namedChildren ?? [];
      const path = routePathFromLiteral(args[0]?.text ?? "");
      if (!path) continue;
      let methods: string[] = [];
      if (ROUTE_METHODS.has(method)) methods = [method.toUpperCase()];
      else if (method === "route" || method === "api_route" || method === "add_api_route") {
        const kw = args.find(
          (a) => a?.type === "keyword_argument" && a.childForFieldName("name")?.text === "methods",
        );
        methods = kw
          ? (
              kw
                .childForFieldName("value")
                ?.descendantsOfType("string")
                .map((s) => literalText(s)?.toUpperCase() ?? "") ?? []
            ).filter(Boolean)
          : ["GET"];
      } else continue;
      const framework = frameworkOf(importedPkgs) ?? "http";
      for (const m of methods) {
        const id = routeId(m, path);
        if (!nodes.some((n) => n.id === id)) {
          nodes.push({
            id,
            kind: "route",
            name: `${m} ${path}`,
            path: rel,
            startLine: d.startPosition.row + 1,
            endLine: d.startPosition.row + 1,
            source: "tree-sitter",
            meta: { method: m, route: path, framework },
          });
          pushEdge({ src: fid, dst: id, kind: "defines", source: "tree-sitter" });
        }
        pushEdge({
          src: symId(rel, handler),
          dst: id,
          kind: "handles",
          source: "tree-sitter",
          confidence: 0.95,
        });
      }
    }
  }

  function walkRefs(n: TSNode): void {
    for (const call of n.descendantsOfType("call")) {
      const fn = call.childForFieldName("function");
      if (!fn) continue;
      const caller = enclosing(call);
      const target = callTarget(fn, caller);
      if (!target) continue;
      refs.push(
        caller ? symId(rel, caller) : fid,
        target.id,
        "calls",
        target.confidence,
        call.startPosition.row + 1,
      );
    }
    for (const idn of n.descendantsOfType("identifier")) {
      const p = idn.parent;
      if (!p || REF_SKIP_PARENT.has(p.type)) continue;
      if (p.childForFieldName("name")?.id === idn.id) continue;
      if (p.type === "call" && p.childForFieldName("function")?.id === idn.id) continue;
      if (p.type === "attribute" && p.childForFieldName("object")?.id !== idn.id) continue;
      if (
        p.type === "attribute" &&
        p.parent?.type === "call" &&
        p.parent.childForFieldName("function")?.id === p.id
      )
        continue;
      if (p.type === "assignment" && p.childForFieldName("left")?.id === idn.id) continue;
      const target = scope.get(idn.text);
      if (!target) continue;
      const caller = enclosing(idn);
      refs.push(
        caller ? symId(rel, caller) : fid,
        target.id,
        "references",
        target.confidence * 0.9,
        idn.startPosition.row + 1,
      );
    }
  }
}

const REF_SKIP_PARENT = new Set([
  "import_statement",
  "import_from_statement",
  "aliased_import",
  "dotted_name",
  "parameters",
  "default_parameter",
  "typed_parameter",
  "typed_default_parameter",
  "keyword_argument",
  "lambda_parameters",
  "for_statement",
  "except_clause",
  "as_pattern_target",
  "global_statement",
  "nonlocal_statement",
  "class_definition",
  "function_definition",
]);
