import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import type { Node as TSNode } from "web-tree-sitter";
import type { GraphEdge, GraphNode } from "../../storage/types.js";
import { fileId, pkgId, symId } from "../ids.js";
import { frameworkOf, ROUTE_METHODS, routeId, routePathFromLiteral } from "../routes.js";
import type { ParsedFile } from "../treesitter.js";
import { complexityOf, getParser, literalText, RefCollector } from "./parser.js";

const BRANCHES = [
  "if_statement",
  "for_statement",
  "expression_case",
  "type_case",
  "communication_case",
  "default_case",
  "binary_expression",
];
const BOOL_OPS = new Set(["&&", "||"]);
const BUILTINS = new Set([
  "make",
  "len",
  "cap",
  "append",
  "new",
  "panic",
  "recover",
  "delete",
  "copy",
  "close",
  "print",
  "println",
  "min",
  "max",
  "clear",
  "string",
  "int",
  "int64",
  "int32",
  "uint",
  "byte",
  "rune",
  "float64",
  "float32",
  "bool",
  "error",
  "any",
]);

const goModCache = new Map<string, { module: string; dir: string } | null>();

/** The nearest go.mod above `fromAbs` (within root): its module path and directory. */
export function goModule(
  root: string,
  fromAbs: string,
): { module: string; dir: string } | undefined {
  let dir = dirname(fromAbs);
  while (dir.startsWith(root)) {
    const hit = goModCache.get(dir);
    if (hit !== undefined) {
      if (hit) return hit;
    } else {
      const file = join(dir, "go.mod");
      if (existsSync(file)) {
        const m = /^module\s+(\S+)/m.exec(readFileSync(file, "utf8"));
        const info = m ? { module: m[1]!, dir } : null;
        goModCache.set(dir, info);
        if (info) return info;
      } else goModCache.set(dir, null);
    }
    if (dir === root) break;
    dir = dirname(dir);
  }
  return undefined;
}

/** Non-test .go files of an in-module import path, project-relative and sorted. */
export function resolveGoPackage(root: string, fromRel: string, importPath: string): string[] {
  const mod = goModule(root, resolve(root, fromRel));
  if (!mod) return [];
  let dir: string | undefined;
  if (importPath === mod.module) dir = mod.dir;
  else if (importPath.startsWith(`${mod.module}/`))
    dir = join(mod.dir, importPath.slice(mod.module.length + 1));
  if (!dir || !existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".go") && !f.endsWith("_test.go"))
      .sort()
      .map((f) =>
        normalize(relative(root, join(dir!, f)))
          .split("\\")
          .join("/"),
      );
  } catch {
    return [];
  }
}

export function resetGoCache(): void {
  goModCache.clear();
}

const isExported = (name: string): boolean => /^[A-Z]/.test(name);

/**
 * Go: one package per directory, so identifiers the file does not define are assumed
 * to live in a sibling file (`sym:<this file>#Name`); the link pass moves such edges
 * to the file that defines the name. Imported packages map to the first file of the
 * package (`sym:<first file>#*`), resolved the same way.
 */
export async function parseGo(root: string, rel: string, code: string): Promise<ParsedFile> {
  const p = await getParser("go");
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
  /** variable (optionally scoped to `<fn>\0<var>`) → type symbol id. */
  const varTypes = new Map<string, string>();
  const importedPkgs = new Set<string>();
  const refs = new RefCollector();
  let complexity = 0;
  let pkgName = "";
  const pushEdge = (e: GraphEdge) => edges.push({ confidence: 1, weight: 1, ...e });

  for (const stmt of tree.rootNode.namedChildren) {
    if (!stmt) continue;
    if (stmt.type === "package_clause") pkgName = stmt.namedChildren[0]?.text ?? "";
    else if (stmt.type === "import_declaration") handleImports(stmt);
    else collectDecls(stmt);
  }
  for (const stmt of tree.rootNode.namedChildren) {
    if (stmt && stmt.type !== "import_declaration" && stmt.type !== "package_clause")
      walkRefs(stmt);
  }
  edges.push(...refs.edges());
  const errors = tree.rootNode.hasError ? tree.rootNode.descendantsOfType("ERROR").length : 0;
  fileNode.meta = {
    loc: tree.rootNode.endPosition.row + 1,
    complexity,
    go_package: pkgName,
    ...(errors ? { parse_errors: errors } : {}),
  };
  return { nodes, edges, exports: exportsList, errors };

  function handleImports(decl: TSNode): void {
    for (const spec of decl.descendantsOfType("import_spec")) {
      const path = literalText(spec.childForFieldName("path"));
      if (!path) continue;
      const alias = spec.childForFieldName("name")?.text;
      const files = resolveGoPackage(root, rel, path);
      const local =
        alias && alias !== "_" && alias !== "." ? alias : (path.split("/").pop() ?? path);
      if (files.length) {
        for (const f of files) {
          if (f === rel) continue;
          pushEdge({
            src: fid,
            dst: fileId(f),
            kind: "imports",
            source: "tree-sitter",
            confidence: 0.9,
            meta: { names: [local], spec: path, line: spec.startPosition.row + 1 },
          });
        }
        scope.set(local, { id: symId(files[0]!, "*"), confidence: 0.75 });
      } else {
        importedPkgs.add(path);
        const target = pkgId(path);
        nodes.push({ id: target, kind: "package", name: path, source: "tree-sitter" });
        pushEdge({
          src: fid,
          dst: target,
          kind: "imports",
          source: "tree-sitter",
          confidence: 1,
          meta: { names: [local], spec: path, line: spec.startPosition.row + 1 },
        });
        scope.set(local, { id: target, confidence: 0.6 });
      }
    }
  }

  /** Plain name of a receiver/type node (`*Store` → `Store`), for qualified symbol names. */
  function typeName(n: TSNode | null | undefined): string | undefined {
    if (!n) return undefined;
    if (n.type === "type_identifier") return n.text;
    if (n.type === "pointer_type" || n.type === "generic_type" || n.type === "parenthesized_type")
      return typeName(n.namedChildren[0]);
    if (n.type === "qualified_type") return n.text;
    return undefined;
  }

  /** Symbol id a type node denotes: a local type, a sibling-package type, or an imported one. */
  function typeRef(n: TSNode | null | undefined): string | undefined {
    if (!n) return undefined;
    if (n.type === "type_identifier") return localSyms.get(n.text) ?? symId(rel, n.text);
    if (n.type === "pointer_type" || n.type === "generic_type" || n.type === "parenthesized_type")
      return typeRef(n.namedChildren[0]);
    if (n.type === "qualified_type") {
      const pkg = n.namedChildren.find((c) => c?.type === "package_identifier")?.text;
      const t = n.namedChildren.find((c) => c?.type === "type_identifier")?.text;
      const base = pkg ? scope.get(pkg) : undefined;
      if (!base || !t) return undefined;
      if (base.id.startsWith("sym:") && base.id.endsWith("#*"))
        return `${base.id.slice(0, -1)}${t}`;
      return undefined; // external package type
    }
    return undefined;
  }

  function collectDecls(n: TSNode): void {
    switch (n.type) {
      case "function_declaration": {
        const name = n.childForFieldName("name")?.text;
        if (name) addSym(name, "function", n, isExported(name));
        return;
      }
      case "method_declaration": {
        const name = n.childForFieldName("name")?.text;
        const recv = n.childForFieldName("receiver")?.descendantsOfType("parameter_declaration")[0];
        const recvType = typeName(recv?.childForFieldName("type"));
        if (!name) return;
        const qualified = recvType ? `${recvType}.${name}` : name;
        addSym(qualified, "method", n, isExported(name));
        const recvName = recv?.childForFieldName("name")?.text;
        if (recvName && recvType)
          varTypes.set(`${qualified}\u0000${recvName}`, symId(rel, recvType));
        return;
      }
      case "type_declaration": {
        for (const spec of n.descendantsOfType("type_spec")) {
          const name = spec.childForFieldName("name")?.text;
          const t = spec.childForFieldName("type");
          if (!name) continue;
          const kind =
            t?.type === "struct_type"
              ? "class"
              : t?.type === "interface_type"
                ? "interface"
                : "type";
          addSym(name, kind, spec, isExported(name));
          if (t?.type === "struct_type") {
            for (const f of t.descendantsOfType("field_declaration")) {
              const fname = f.childForFieldName("name")?.text;
              if (fname) addSym(`${name}.${fname}`, "field", f, false);
              else {
                const embedded = typeRef(f.childForFieldName("type") ?? f.namedChildren[0]);
                if (embedded)
                  pushEdge({
                    src: symId(rel, name),
                    dst: embedded,
                    kind: "extends",
                    source: "tree-sitter",
                    confidence: 0.7,
                  });
              }
            }
          }
          if (t?.type === "interface_type") {
            for (const m of t.descendantsOfType("method_elem")) {
              const mname = m.childForFieldName("name")?.text;
              if (mname) addSym(`${name}.${mname}`, "method", m, false);
            }
          }
        }
        return;
      }
      case "var_declaration":
      case "const_declaration": {
        for (const spec of n.descendantsOfType(["var_spec", "const_spec"])) {
          for (const idn of spec.namedChildren.filter((c) => c?.type === "identifier")) {
            if (!idn) continue;
            addSym(idn.text, "variable", spec, isExported(idn.text));
            const t = typeRef(spec.childForFieldName("type"));
            if (t) varTypes.set(idn.text, t);
          }
        }
        return;
      }
      default:
        return;
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
    let cur: TSNode | null = n.parent;
    while (cur) {
      if (cur.type === "function_declaration") {
        const name = cur.childForFieldName("name")?.text;
        if (name && localSyms.has(name)) return name;
      }
      if (cur.type === "method_declaration") {
        const name = cur.childForFieldName("name")?.text;
        const recv = typeName(
          cur
            .childForFieldName("receiver")
            ?.descendantsOfType("parameter_declaration")[0]
            ?.childForFieldName("type"),
        );
        const q = recv && name ? `${recv}.${name}` : name;
        if (q && localSyms.has(q)) return q;
      }
      cur = cur.parent;
    }
    return undefined;
  }

  /** Same-package identifiers point at this file; the link pass finds the sibling that defines them. */
  function samePackage(name: string): { id: string; confidence: number } {
    return {
      id: localSyms.get(name) ?? symId(rel, name),
      confidence: localSyms.has(name) ? 0.9 : 0.6,
    };
  }

  function callTarget(
    fn: TSNode,
    caller: string | undefined,
  ): { id: string; confidence: number } | undefined {
    if (fn.type === "identifier") {
      if (BUILTINS.has(fn.text)) return undefined;
      return scope.get(fn.text) ?? samePackage(fn.text);
    }
    if (fn.type !== "selector_expression") return undefined;
    const operand = fn.childForFieldName("operand");
    const field = fn.childForFieldName("field")?.text;
    if (!operand || !field) return undefined;
    if (operand.type === "identifier") {
      const vt =
        (caller ? varTypes.get(`${caller}\u0000${operand.text}`) : undefined) ??
        varTypes.get(operand.text);
      if (vt) return { id: `${vt}.${field}`, confidence: 0.8 };
      const base = scope.get(operand.text);
      if (base?.id.startsWith("sym:"))
        return base.id.endsWith("#*")
          ? { id: `${base.id.slice(0, -1)}${field}`, confidence: 0.7 }
          : { id: `${base.id}.${field}`, confidence: 0.6 };
      if (base?.id.startsWith("pkg:")) return { id: base.id, confidence: 0.6 };
    }
    return undefined;
  }

  /** `x := T{}` / `x := &pkg.T{}` / `var x T` inside a function (or at top level). */
  function noteVarTypes(n: TSNode, caller: string | undefined): void {
    for (const d of n.descendantsOfType(["short_var_declaration", "var_spec"])) {
      const left = d.type === "short_var_declaration" ? d.childForFieldName("left") : d;
      const name = left?.descendantsOfType("identifier")[0]?.text;
      if (!name) continue;
      let t = typeRef(d.childForFieldName("type"));
      if (!t) {
        const rhs =
          d.type === "short_var_declaration"
            ? d.childForFieldName("right")
            : d.childForFieldName("value");
        const lit = rhs?.descendantsOfType("composite_literal")[0];
        if (lit) t = typeRef(lit.childForFieldName("type"));
      }
      if (!t) continue;
      const fn = caller ?? enclosing(d);
      if (fn) varTypes.set(`${fn}\u0000${name}`, t);
      else varTypes.set(name, t);
    }
  }

  /** `http.HandleFunc("/p", h)`, `r.GET("/p", h)`, `mux.Handle("/p", h)` → route + handles. */
  function routeFromCall(call: TSNode, caller: string | undefined): void {
    const fn = call.childForFieldName("function");
    if (fn?.type !== "selector_expression") return;
    const field = fn.childForFieldName("field")?.text ?? "";
    const lower = field.toLowerCase();
    const method = ROUTE_METHODS.has(lower)
      ? field.toUpperCase()
      : /^handle(func)?$/i.test(field)
        ? "ALL"
        : undefined;
    if (!method) return;
    const args = call.childForFieldName("arguments")?.namedChildren ?? [];
    const path = routePathFromLiteral(args[0]?.text ?? "");
    if (!path) return;
    const framework = frameworkOf(importedPkgs) ?? "net/http";
    const handlers: string[] = [];
    for (const a of args.slice(1)) {
      if (!a) continue;
      if (a.type === "identifier") handlers.push((scope.get(a.text) ?? samePackage(a.text)).id);
      else if (a.type === "selector_expression") {
        const t = callTarget(a, caller);
        if (t?.id.startsWith("sym:")) handlers.push(t.id);
      } else if (a.type === "func_literal") handlers.push(caller ? symId(rel, caller) : fid);
    }
    if (!handlers.length) handlers.push(caller ? symId(rel, caller) : fid);
    const id = routeId(method, path);
    if (!nodes.some((n) => n.id === id)) {
      nodes.push({
        id,
        kind: "route",
        name: `${method} ${path}`,
        path: rel,
        startLine: call.startPosition.row + 1,
        endLine: call.startPosition.row + 1,
        source: "tree-sitter",
        meta: { method, route: path, framework },
      });
      pushEdge({ src: fid, dst: id, kind: "defines", source: "tree-sitter" });
    }
    for (const h of handlers)
      pushEdge({ src: h, dst: id, kind: "handles", source: "tree-sitter", confidence: 0.85 });
  }

  function walkRefs(n: TSNode): void {
    noteVarTypes(n, undefined);
    for (const call of n.descendantsOfType("call_expression")) {
      const caller = enclosing(call);
      routeFromCall(call, caller);
      const fn = call.childForFieldName("function");
      if (!fn) continue;
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
    // references: package members used outside calls, and local/imported types
    for (const sel of n.descendantsOfType("selector_expression")) {
      const operand = sel.childForFieldName("operand");
      const field = sel.childForFieldName("field")?.text;
      if (operand?.type !== "identifier" || !field) continue;
      if (
        sel.parent?.type === "call_expression" &&
        sel.parent.childForFieldName("function")?.id === sel.id
      )
        continue;
      const base = scope.get(operand.text);
      if (!base?.id.startsWith("sym:")) continue;
      const caller = enclosing(sel);
      const target = base.id.endsWith("#*")
        ? `${base.id.slice(0, -1)}${field}`
        : `${base.id}.${field}`;
      refs.push(
        caller ? symId(rel, caller) : fid,
        target,
        "references",
        base.confidence * 0.9,
        sel.startPosition.row + 1,
      );
    }
    for (const t of n.descendantsOfType(["type_identifier", "qualified_type"])) {
      if (t.parent?.type === "type_spec" && t.parent.childForFieldName("name")?.id === t.id)
        continue;
      if (t.type === "type_identifier" && t.parent?.type === "qualified_type") continue;
      const id = typeRef(t);
      if (!id || id === symId(rel, t.text)) {
        // unknown same-package type: still worth an edge for the link pass to resolve
        if (!id) continue;
      }
      const caller = enclosing(t);
      refs.push(caller ? symId(rel, caller) : fid, id, "references", 0.7, t.startPosition.row + 1);
    }
  }
}
