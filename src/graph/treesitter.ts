import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import type { Language as TSLanguage, Node as TSNode, Parser as TSParser } from "web-tree-sitter";
import type { GraphEdge, GraphNode } from "../storage/types.js";
import { pluginRoot } from "../version.js";
import { fileId, pkgId, symId } from "./ids.js";
import { packageName, resolveImport } from "./resolve.js";

export type Grammar = "typescript" | "tsx" | "javascript";

export function grammarFor(path: string): Grammar | undefined {
  switch (extname(path).toLowerCase()) {
    case ".ts":
    case ".mts":
    case ".cts":
      return "typescript";
    case ".tsx":
      return "tsx";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "javascript";
    default:
      return undefined;
  }
}

let parserMod: typeof import("web-tree-sitter") | undefined;
let parser: TSParser | undefined;
const languages = new Map<Grammar, TSLanguage>();

async function getParser(grammar: Grammar): Promise<TSParser> {
  if (!parserMod) {
    parserMod = await import("web-tree-sitter");
    await parserMod.Parser.init();
    parser = new parserMod.Parser();
  }
  let lang = languages.get(grammar);
  if (!lang) {
    const file = join(pluginRoot(), "vendor", "grammars", `${grammar}.wasm`);
    if (!existsSync(file)) throw new Error(`grammar missing: ${file}`);
    lang = await parserMod.Language.load(file);
    languages.set(grammar, lang);
  }
  parser!.setLanguage(lang);
  return parser!;
}

export interface ParsedFile {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Exported symbol names (for callers resolving imports). */
  exports: string[];
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

/**
 * Walk a TS/JS syntax tree and emit graph nodes/edges for one file: file,
 * declarations (`sym:`), imports (resolved to files or `pkg:`), exports,
 * calls, extends/implements. Confidence reflects how sure the resolution is.
 */
export async function parseFile(root: string, rel: string, code: string): Promise<ParsedFile> {
  const grammar = grammarFor(rel);
  if (!grammar) return { nodes: [], edges: [], exports: [] };
  const p = await getParser(grammar);
  const tree = p.parse(code);
  if (!tree) return { nodes: [], edges: [], exports: [] };

  const fid = fileId(rel);
  const nodes: GraphNode[] = [
    { id: fid, kind: "file", name: rel, path: rel, source: "tree-sitter" },
  ];
  const edges: GraphEdge[] = [];
  const exportsList: string[] = [];
  /** local name → node id it refers to (imports and local declarations). */
  const scope = new Map<string, { id: string; confidence: number }>();
  const localSyms = new Map<string, string>();

  const pushEdge = (e: GraphEdge) => edges.push({ confidence: 1, weight: 1, ...e });

  // Pass 1: imports and top-level declarations populate the scope.
  for (const stmt of tree.rootNode.namedChildren) {
    if (!stmt) continue;
    if (stmt.type === "import_statement") handleImport(stmt);
    else collectDecls(stmt, undefined, stmt.type === "export_statement");
  }
  // Pass 2: calls and heritage inside declarations.
  for (const stmt of tree.rootNode.namedChildren) {
    if (stmt) walkCalls(stmt, undefined);
  }
  return { nodes, edges, exports: exportsList };

  function handleImport(stmt: TSNode): void {
    const src =
      stmt.childForFieldName("source")?.namedChildren[0]?.text ??
      stmt.descendantsOfType("string_fragment")[0]?.text;
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
    const resolved = resolveImport(root, rel, src);
    const target = resolved ? fileId(resolved) : pkgId(packageName(src));
    if (!resolved)
      nodes.push({ id: target, kind: "package", name: packageName(src), source: "tree-sitter" });
    pushEdge({
      src: fid,
      dst: target,
      kind: "imports",
      source: "tree-sitter",
      confidence: resolved ? 0.95 : 1,
      meta: { names, spec: src },
    });
  }

  function registerImport(local: string, exported: string, spec: string): void {
    const resolved = resolveImport(root, rel, spec);
    if (resolved)
      scope.set(local, {
        id: symId(resolved, exported === "default" ? "default" : exported),
        confidence: 0.8,
      });
    else scope.set(local, { id: pkgId(packageName(spec)), confidence: 0.6 });
  }

  function declName(n: TSNode): string | undefined {
    return n.childForFieldName("name")?.text;
  }

  function collectDecls(n: TSNode, parentName: string | undefined, exported: boolean): void {
    if (n.type === "export_statement") {
      const decl =
        n.childForFieldName("declaration") ?? n.namedChildren.find((c) => c && DECL_TYPES[c.type]);
      if (decl) collectDecls(decl, parentName, true);
      else if (
        n.childForFieldName("value") ||
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
      }
    }
  }

  function addSym(qualified: string, kind: string, n: TSNode, exported: boolean): void {
    const id = symId(rel, qualified);
    nodes.push({
      id,
      kind,
      name: qualified,
      path: rel,
      startLine: n.startPosition.row + 1,
      endLine: n.endPosition.row + 1,
      source: "tree-sitter",
      meta: exported ? { exported: true } : undefined,
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

  /** Find the enclosing declaration's qualified name for a node. */
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
    return parts.length ? parts.join(".") : undefined;
  }

  function walkCalls(n: TSNode, _parentName: string | undefined): void {
    for (const call of n.descendantsOfType(["call_expression", "new_expression"])) {
      const fn = call.childForFieldName("function") ?? call.childForFieldName("constructor");
      if (!fn) continue;
      const caller = enclosing(call);
      const src = caller ? symId(rel, caller) : fid;
      let target: { id: string; confidence: number } | undefined;
      if (fn.type === "identifier" || fn.type === "type_identifier") {
        target = scope.get(fn.text);
      } else if (fn.type === "member_expression") {
        const obj = fn.childForFieldName("object");
        const prop = fn.childForFieldName("property")?.text;
        if (obj?.type === "this" && prop && caller) {
          const cls = caller.split(".")[0]!;
          target = { id: symId(rel, `${cls}.${prop}`), confidence: 0.9 };
        } else if (obj?.type === "identifier" && prop) {
          const base = scope.get(obj.text);
          if (base?.id.startsWith("sym:"))
            target = { id: `${base.id.replace(/#.*$/, "")}#${prop}`, confidence: 0.5 };
          else if (base?.id.startsWith("pkg:")) target = { id: base.id, confidence: 0.6 };
        }
      }
      if (!target || target.id === src) continue;
      pushEdge({
        src,
        dst: target.id,
        kind: "calls",
        source: "tree-sitter",
        confidence: target.confidence,
      });
    }
  }
}
