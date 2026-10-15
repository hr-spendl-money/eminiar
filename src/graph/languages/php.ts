import { readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import type { Node as TSNode } from "web-tree-sitter";
import type { GraphEdge, GraphNode } from "../../storage/types.js";
import { fileId, pkgId, symId } from "../ids.js";
import {
  frameworkOf,
  httpMethod,
  laravelResource,
  parseRouteAnnotations,
  phpRoutePath,
  ROUTE_METHODS,
  type RouteSpec,
  routeId,
} from "../routes.js";
import type { ParsedFile } from "../treesitter.js";
import { complexityOf, getParser, literalText, RefCollector } from "./parser.js";

const BRANCHES = [
  "if_statement",
  "else_if_clause",
  "for_statement",
  "foreach_statement",
  "while_statement",
  "do_statement",
  "case_statement",
  "catch_clause",
  "conditional_expression",
  "match_conditional_expression",
  "binary_expression",
];
const BOOL_OPS = new Set(["&&", "||", "and", "or", "??"]);
const CALLS = [
  "function_call_expression",
  "member_call_expression",
  "nullsafe_member_call_expression",
  "scoped_call_expression",
  "object_creation_expression",
];
const CLASS_KINDS: Record<string, string> = {
  class_declaration: "class",
  interface_declaration: "interface",
  trait_declaration: "trait",
  enum_declaration: "enum",
};
/** Names that mean "this class" or its parent, never a class of their own. */
const RELATIVE = new Set(["self", "static", "parent"]);
/** Variables that hold a router in Slim, Lumen and CodeIgniter apps (`$app->get('users', …)`). */
const ROUTER_VARS = new Set(["$app", "$router", "$routes", "$route", "$group", "$r"]);
/** Where Laravel's and CodeIgniter's string controller references (`'UserController@show'`) live. */
const CONTROLLER_NAMESPACES = ["App\\Http\\Controllers", "App\\Controllers"];

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

const toRel = (root: string, abs: string): string =>
  normalize(relative(root, abs)).split("\\").join("/");

interface Autoload {
  dir: string;
  /** PSR-4 namespace prefixes (with trailing `\`), longest first. */
  psr4: Array<{ prefix: string; dirs: string[] }>;
}

const composerCache = new Map<string, Autoload | null>();

/** The nearest composer.json above `fromAbs` (within root) that declares PSR-4 autoloading. */
export function composerAutoload(root: string, fromAbs: string): Autoload | undefined {
  let dir = dirname(fromAbs);
  while (dir.startsWith(root)) {
    const hit = composerCache.get(dir);
    if (hit !== undefined) {
      if (hit) return hit;
    } else {
      const file = join(dir, "composer.json");
      let info: Autoload | null = null;
      if (isFile(file)) {
        try {
          const json = JSON.parse(readFileSync(file, "utf8")) as Record<
            string,
            { "psr-4"?: Record<string, string | string[]> } | undefined
          >;
          const psr4: Autoload["psr4"] = [];
          for (const section of [json.autoload, json["autoload-dev"]]) {
            for (const [prefix, dirs] of Object.entries(section?.["psr-4"] ?? {})) {
              psr4.push({
                prefix: prefix && !prefix.endsWith("\\") ? `${prefix}\\` : prefix,
                dirs: Array.isArray(dirs) ? dirs : [dirs],
              });
            }
          }
          if (psr4.length) {
            psr4.sort((a, b) => b.prefix.length - a.prefix.length);
            info = { dir, psr4 };
          }
        } catch {
          info = null;
        }
      }
      composerCache.set(dir, info);
      if (info) return info;
    }
    if (dir === root) break;
    dir = dirname(dir);
  }
  return undefined;
}

/**
 * Resolve a fully-qualified class name to a project file through composer.json's PSR-4
 * prefixes (`App\` → `app/`). Without a composer.json, namespaces are taken as directories
 * from the project root or `src/`.
 */
export function resolvePhpClass(root: string, fromRel: string, fqcn: string): string | undefined {
  const name = fqcn.replace(/^\\+/, "");
  if (!name) return undefined;
  const candidates: string[] = [];
  const auto = composerAutoload(root, resolve(root, fromRel));
  if (auto) {
    for (const { prefix, dirs } of auto.psr4) {
      if (!name.startsWith(prefix)) continue;
      const rest = name.slice(prefix.length).split("\\");
      for (const d of dirs) candidates.push(join(auto.dir, d, ...rest));
    }
  } else {
    const parts = name.split("\\");
    candidates.push(resolve(root, ...parts), resolve(root, "src", ...parts));
  }
  for (const c of candidates) {
    const f = `${c}.php`;
    if (isFile(f) && !relative(root, f).startsWith("..")) return toRel(root, f);
  }
  return undefined;
}

export function resetPhpCache(): void {
  composerCache.clear();
}

/** Text of a PHP string literal without quotes; undefined for interpolated strings. */
function phpString(n: TSNode | null | undefined): string | undefined {
  if (!n || (n.type !== "string" && n.type !== "encapsed_string")) return undefined;
  if (n.namedChildren.some((c) => c && c.type !== "string_content" && c.type !== "escape_sequence"))
    return undefined;
  return literalText(n)?.replace(/\\(\\|')/g, "$1");
}

/** The expressions passed to a call, unwrapped from their `argument` nodes. */
function argsOf(call: TSNode): TSNode[] {
  const list = call.childForFieldName("arguments") ?? call.childForFieldName("parameters");
  return (list?.namedChildren ?? [])
    .filter((a): a is TSNode => a?.type === "argument")
    .map((a) => a.namedChildren[a.namedChildren.length - 1])
    .filter((a): a is TSNode => !!a);
}

/** Arguments passed by position (no `name:` label). */
function positionalArgs(call: TSNode): TSNode[] {
  const list = call.childForFieldName("arguments") ?? call.childForFieldName("parameters");
  return (list?.namedChildren ?? [])
    .filter((a): a is TSNode => a?.type === "argument" && !a.childForFieldName("name"))
    .map((a) => a.namedChildren[0])
    .filter((a): a is TSNode => !!a);
}

/** A named argument (`methods: [...]`) by name. */
function namedArg(call: TSNode, name: string): TSNode | undefined {
  const list = call.childForFieldName("arguments") ?? call.childForFieldName("parameters");
  for (const a of list?.namedChildren ?? []) {
    if (a?.type === "argument" && a.childForFieldName("name")?.text === name)
      return a.namedChildren[a.namedChildren.length - 1] ?? undefined;
  }
  return undefined;
}

/** `'GET'` or `['GET', 'POST']` → string values. */
function stringsOf(n: TSNode | undefined): string[] {
  if (!n) return [];
  if (n.type !== "array_creation_expression") {
    const s = phpString(n);
    return s === undefined ? [] : [s];
  }
  return n.namedChildren.flatMap((el) => {
    const s = el?.namedChildren.length === 1 ? phpString(el.namedChildren[0]) : undefined;
    return s === undefined ? [] : [s];
  });
}

/** `[key, value]` pairs of an array literal; unkeyed elements have no key. */
function arrayElements(arr: TSNode): Array<{ key?: string | undefined; value: TSNode }> {
  const out: Array<{ key?: string | undefined; value: TSNode }> = [];
  for (const el of arr.namedChildren) {
    if (el?.type !== "array_element_initializer") continue;
    const kids = el.namedChildren.filter((c): c is TSNode => !!c);
    if (kids.length === 1) out.push({ value: kids[0]! });
    else if (kids.length === 2) out.push({ key: phpString(kids[0]), value: kids[1]! });
  }
  return out;
}

/** A controller reference in a string: `'UserController@show'`, `'Home::index'`, `'Action:run'`. */
const CONTROLLER_STRING = /^\\?([\w\\]+?)(?:@|::?)(\w+)$/;

/** Whether a route argument looks like a handler (closure, `X::class`, controller string or
 *  callable array) rather than a default value or an options array. */
function handlerShaped(a: TSNode | undefined): boolean {
  if (!a) return false;
  switch (a.type) {
    case "anonymous_function":
    case "arrow_function":
    case "class_constant_access_expression":
      return true;
    case "string":
    case "encapsed_string":
      return CONTROLLER_STRING.test(phpString(a) ?? "");
    case "array_creation_expression":
      return arrayElements(a).some((e) => (e.key ? e.key === "uses" : handlerShaped(e.value)));
    default:
      return false;
  }
}

const isPublic = (m: TSNode): boolean =>
  !m.namedChildren.some((c) => c?.type === "visibility_modifier" && c.text !== "public");

/** The class of a `Class.method` caller. */
const classOf = (caller: string | undefined): string | undefined =>
  caller?.includes(".") ? caller.split(".")[0] : undefined;

const lastSegment = (name: string): string => name.split("\\").pop() ?? name;
const isCall = (n: TSNode): boolean =>
  n.type === "member_call_expression" || n.type === "scoped_call_expression";

/**
 * PHP: one class per file under PSR-4, so class names resolve through `use` imports and
 * the current namespace to the file composer would autoload (`sym:<file>#Class`).
 * Unresolvable `use` targets (vendor code) become packages named by their top-level
 * namespace (`pkg:Illuminate`). Member calls resolve through `$this`, `self::`/`static::`/
 * `parent::`, typed parameters and properties, and `new` assignments.
 */
export async function parsePhp(root: string, rel: string, code: string): Promise<ParsedFile> {
  const p = await getParser("php");
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
  /** functions and constants by local name (declared here or `use function`). */
  const scope = new Map<string, { id: string; confidence: number }>();
  /** `use` alias → fully-qualified class name. */
  const classUses = new Map<string, string>();
  /** class-like names declared in this file (resolved before their declaration is reached). */
  const declared = new Set<string>();
  const localSyms = new Map<string, string>();
  /** variable scoped to `<fn>\0$var` (or `\0$var` at top level) → class symbol id. */
  const varTypes = new Map<string, string>();
  /** `Class.prop` → class symbol id of its declared or promoted type. */
  const propTypes = new Map<string, string>();
  /** class → its parent class symbol (for `parent::`). */
  const parents = new Map<string, string>();
  /** import edges by target, so repeated `use`/`require` of one file or package aggregate. */
  const imports = new Map<string, GraphEdge>();
  const resolvedClasses = new Map<string, string | null>();
  const importedPkgs = new Set<string>();
  const refs = new RefCollector();
  let complexity = 0;
  let namespace = "";
  const namespaces: string[] = [];
  const pushEdge = (e: GraphEdge) => edges.push({ confidence: 1, weight: 1, ...e });

  // `namespace X;` applies to the statements after it; `namespace X { … }` to its body.
  const stmts: Array<[TSNode, string]> = [];
  for (const stmt of tree.rootNode.namedChildren) {
    if (!stmt) continue;
    if (stmt.type === "namespace_definition") {
      namespace = stmt.childForFieldName("name")?.text ?? "";
      if (namespace) addNamespace(stmt, namespace);
      for (const s of stmt.childForFieldName("body")?.namedChildren ?? [])
        if (s) stmts.push([s, namespace]);
    } else stmts.push([stmt, namespace]);
  }
  for (const [stmt] of stmts) {
    const name = CLASS_KINDS[stmt.type] ? stmt.childForFieldName("name")?.text : undefined;
    if (name) declared.add(name);
  }
  for (const [stmt, ns] of stmts) {
    namespace = ns;
    if (stmt.type === "namespace_use_declaration") handleUse(stmt);
  }
  for (const [stmt, ns] of stmts) {
    namespace = ns;
    if (stmt.type !== "namespace_use_declaration") collectDecls(stmt);
  }
  for (const [stmt, ns] of stmts) {
    namespace = ns;
    if (stmt.type !== "namespace_use_declaration") walkRefs(stmt);
  }
  handleIncludes(tree.rootNode);
  edges.push(...imports.values());
  edges.push(...refs.edges());
  const errors = tree.rootNode.hasError ? tree.rootNode.descendantsOfType("ERROR").length : 0;
  fileNode.meta = {
    loc: tree.rootNode.endPosition.row + 1,
    complexity,
    ...(namespaces.length ? { php_namespace: namespaces[0] } : {}),
    ...(errors ? { parse_errors: errors } : {}),
  };
  return { nodes, edges, exports: exportsList, errors };

  function addNamespace(n: TSNode, name: string): void {
    if (namespaces.includes(name)) return;
    namespaces.push(name);
    const id = symId(rel, name);
    nodes.push({
      id,
      kind: "namespace",
      name,
      path: rel,
      startLine: n.startPosition.row + 1,
      endLine: n.endPosition.row + 1,
      source: "tree-sitter",
    });
    pushEdge({ src: fid, dst: id, kind: "defines", source: "tree-sitter" });
  }

  function addImport(dst: string, name: string, spec: string, line: number, conf: number): void {
    const cur = imports.get(dst);
    if (cur?.meta) {
      const names = cur.meta.names as string[];
      if (!names.includes(name)) names.push(name);
      return;
    }
    imports.set(dst, {
      src: fid,
      dst,
      kind: "imports",
      source: "tree-sitter",
      confidence: conf,
      weight: 1,
      meta: { names: [name], spec, line },
    });
  }

  /** `use A\B\C;`, `use A\{B, C as D};`, `use function A\f;`, `use const A\X;` */
  function handleUse(decl: TSNode): void {
    const group = decl.childForFieldName("body");
    const prefix = group
      ? decl.namedChildren.find((c) => c?.type === "namespace_name")?.text
      : undefined;
    const declKind = decl.children.find((c) => c?.type === "function" || c?.type === "const")?.type;
    for (const c of (group ?? decl).namedChildren) {
      if (c?.type !== "namespace_use_clause") continue;
      const alias = c.childForFieldName("alias");
      const target = c.namedChildren.find(
        (x) => x && x.id !== alias?.id && (x.type === "qualified_name" || x.type === "name"),
      );
      if (!target) continue;
      const fqn = (prefix ? `${prefix}\\${target.text}` : target.text).replace(/^\\+/, "");
      const local = alias?.text ?? lastSegment(fqn);
      const kind =
        c.children.find((x) => x?.type === "function" || x?.type === "const")?.type ?? declKind;
      const line = c.startPosition.row + 1;
      const label = alias ? `${fqn} as ${alias.text}` : fqn;
      const file = kind ? undefined : classFile(fqn);
      if (file) {
        if (file !== rel) addImport(fileId(file), label, fqn, line, 0.95);
      } else {
        const top = fqn.split("\\")[0]!;
        importedPkgs.add(top);
        if (!imports.has(pkgId(top)))
          nodes.push({ id: pkgId(top), kind: "package", name: top, source: "tree-sitter" });
        addImport(pkgId(top), label, fqn, line, 1);
      }
      if (kind) scope.set(local, { id: pkgId(fqn.split("\\")[0]!), confidence: 0.6 });
      else classUses.set(local, fqn);
    }
  }

  /** `require __DIR__ . '/x.php'`, `include 'lib/y.php'`, `require_once dirname(__DIR__) . '/z.php'` */
  function handleIncludes(rootNode: TSNode): void {
    const here = dirname(resolve(root, rel));
    for (const inc of rootNode.descendantsOfType([
      "require_expression",
      "require_once_expression",
      "include_expression",
      "include_once_expression",
    ])) {
      const arg = inc.namedChildren[0];
      if (!arg) continue;
      const candidates: string[] = [];
      const plain = phpString(arg);
      if (plain !== undefined) candidates.push(resolve(here, plain), resolve(root, plain));
      else if (arg.type === "binary_expression") {
        const left = arg.childForFieldName("left")?.text.replace(/\s+/g, "") ?? "";
        const right = phpString(arg.childForFieldName("right"));
        const up = /^dirname\(__(?:DIR|FILE)__(?:,(\d+))?\)$/.exec(left);
        let base: string | undefined;
        if (left === "__DIR__" || left === "dirname(__FILE__)") base = here;
        else if (up) {
          base = here;
          for (let i = left.includes("__FILE__") ? 1 : 0; i < Number(up[1] ?? 1); i++)
            base = dirname(base);
        }
        if (base && right !== undefined) candidates.push(join(base, right));
      }
      const hit = candidates.find((c) => isFile(c) && !relative(root, c).startsWith(".."));
      if (!hit) continue;
      const file = toRel(root, hit);
      if (file !== rel) addImport(fileId(file), "*", arg.text, inc.startPosition.row + 1, 0.9);
    }
  }

  function classFile(fqcn: string): string | undefined {
    let hit = resolvedClasses.get(fqcn);
    if (hit === undefined) {
      hit = resolvePhpClass(root, rel, fqcn) ?? null;
      resolvedClasses.set(fqcn, hit);
    }
    return hit ?? undefined;
  }

  /** Fully-qualified name of a class reference: `use` aliases first, then the current namespace. */
  function fqcnOf(name: string): string {
    if (name.startsWith("\\")) return name.slice(1);
    const [head, ...rest] = name.split("\\");
    const used = classUses.get(head!);
    if (used) return [used, ...rest].join("\\");
    return namespace ? `${namespace}\\${name}` : name;
  }

  /**
   * Symbol a class name denotes: a class declared in this file, the PSR-4 file of the
   * name, or the package of an unresolved `use`. Built-ins and unknown names are undefined.
   */
  function classRef(name: string): { id: string; confidence: number } | undefined {
    if (!name || RELATIVE.has(name.toLowerCase())) return undefined;
    if (!name.includes("\\") && !classUses.has(name) && declared.has(name))
      return { id: symId(rel, name), confidence: 0.9 };
    const fqcn = fqcnOf(name);
    const file = classFile(fqcn);
    if (file) return { id: symId(file, lastSegment(fqcn)), confidence: file === rel ? 0.9 : 0.85 };
    const used = classUses.get(name.replace(/^\\/, "").split("\\")[0]!);
    if (used && !name.startsWith("\\")) return { id: pkgId(used.split("\\")[0]!), confidence: 0.6 };
    return undefined;
  }

  /** Class symbol of a type node (`Foo`, `?Foo`, `Foo|Bar` takes the first class). */
  function typeRef(n: TSNode | null | undefined): string | undefined {
    if (!n) return undefined;
    const named = n.type === "named_type" ? n : n.descendantsOfType("named_type")[0];
    const t = named ? classRef(named.text) : undefined;
    return t?.id.startsWith("sym:") ? t.id : undefined;
  }

  function collectDecls(n: TSNode): void {
    if (CLASS_KINDS[n.type]) {
      collectClass(n);
      return;
    }
    switch (n.type) {
      case "function_definition": {
        const name = n.childForFieldName("name")?.text;
        if (name) addFunction(name, n);
        return;
      }
      case "if_statement": {
        // `if (!function_exists('helper')) { function helper() {} }`
        for (const f of n.descendantsOfType("function_definition")) {
          const name = f.childForFieldName("name")?.text;
          if (name && !insideDecl(f, n)) addFunction(name, f);
        }
        return;
      }
      case "const_declaration": {
        for (const el of n.namedChildren) {
          const name = el?.type === "const_element" ? el.namedChildren[0]?.text : undefined;
          if (name) addSym(name, "variable", el!, true);
        }
        return;
      }
      case "expression_statement": {
        // define('NAME', value)
        const call = n.namedChildren[0];
        if (call?.type !== "function_call_expression") return;
        if (call.childForFieldName("function")?.text !== "define") return;
        const name = phpString(argsOf(call)[0]);
        if (name && /^\w+$/.test(name)) addSym(name, "variable", call, true);
        return;
      }
      default:
        return;
    }
  }

  /** Whether `n` sits in a function, method or class below `top`. */
  function insideDecl(n: TSNode, top: TSNode): boolean {
    for (let cur = n.parent; cur && cur.id !== top.id; cur = cur.parent) {
      if (cur.type === "function_definition" || cur.type === "method_declaration") return true;
      if (CLASS_KINDS[cur.type]) return true;
    }
    return false;
  }

  function addFunction(name: string, n: TSNode): void {
    addSym(name, "function", n, true);
    scope.set(name, { id: symId(rel, name), confidence: 0.9 });
  }

  function collectClass(n: TSNode): void {
    const name = n.childForFieldName("name")?.text;
    const kind = CLASS_KINDS[n.type];
    if (!name || !kind) return;
    addSym(name, kind, n, true);
    const self = symId(rel, name);
    for (const h of n.namedChildren) {
      if (h?.type !== "base_clause" && h?.type !== "class_interface_clause") continue;
      for (const b of h.namedChildren) {
        if (b?.type !== "name" && b?.type !== "qualified_name") continue;
        const target = heritage(self, b.text, h.type === "base_clause" ? "extends" : "implements");
        if (target && h.type === "base_clause" && kind === "class") parents.set(name, target);
      }
    }
    const body = n.childForFieldName("body");
    for (const m of body?.namedChildren ?? []) {
      if (!m) continue;
      switch (m.type) {
        case "method_declaration": {
          const mname = m.childForFieldName("name")?.text;
          if (!mname) break;
          addSym(`${name}.${mname}`, "method", m, isPublic(m));
          const params = m.childForFieldName("parameters")?.namedChildren ?? [];
          for (const prm of params) {
            if (prm?.type !== "property_promotion_parameter") continue;
            const pname = prm.childForFieldName("name")?.text.replace(/^\$/, "");
            if (!pname) continue;
            addSym(`${name}.${pname}`, "field", prm, isPublic(prm));
            const t = typeRef(prm.childForFieldName("type"));
            if (t) propTypes.set(`${name}.${pname}`, t);
          }
          break;
        }
        case "property_declaration": {
          const t = typeRef(m.childForFieldName("type"));
          for (const el of m.namedChildren) {
            if (el?.type !== "property_element") continue;
            const pname = el.childForFieldName("name")?.text.replace(/^\$/, "");
            if (!pname) continue;
            addSym(`${name}.${pname}`, "field", el, isPublic(m));
            if (t) propTypes.set(`${name}.${pname}`, t);
          }
          break;
        }
        case "const_declaration": {
          for (const el of m.namedChildren) {
            const cname = el?.type === "const_element" ? el.namedChildren[0]?.text : undefined;
            if (cname) addSym(`${name}.${cname}`, "field", el!, isPublic(m));
          }
          break;
        }
        case "enum_case": {
          const cname = m.childForFieldName("name")?.text;
          if (cname) addSym(`${name}.${cname}`, "field", m, true);
          break;
        }
        case "use_declaration": {
          // trait use: the trait's members become the class's own
          for (const t of m.namedChildren) {
            if (t?.type === "name" || t?.type === "qualified_name")
              heritage(self, t.text, "extends", { trait: true });
          }
          break;
        }
        default:
          break;
      }
    }
    attributeRoutes(n, name);
  }

  /** extends / implements / trait-use edge; unresolvable names stay local guesses (0.5). */
  function heritage(
    src: string,
    name: string,
    kind: string,
    meta?: Record<string, unknown>,
  ): string | undefined {
    const ref =
      classRef(name) ??
      (name.startsWith("\\") && !name.slice(1).includes("\\")
        ? undefined // a global built-in (`\Countable`)
        : { id: symId(rel, lastSegment(name)), confidence: 0.5 });
    if (!ref) return undefined;
    pushEdge({
      src,
      dst: ref.id,
      kind,
      source: "tree-sitter",
      confidence: ref.confidence,
      ...(meta ? { meta } : {}),
    });
    return ref.id.startsWith("sym:") ? ref.id : undefined;
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
  }

  function enclosing(n: TSNode): string | undefined {
    let cur: TSNode | null = n.parent;
    while (cur) {
      if (cur.type === "method_declaration") {
        const name = cur.childForFieldName("name")?.text;
        const owner = cur.parent?.parent?.childForFieldName("name")?.text;
        const q = owner && name ? `${owner}.${name}` : undefined;
        if (q && localSyms.has(q)) return q;
      }
      if (cur.type === "function_definition") {
        const name = cur.childForFieldName("name")?.text;
        if (name && localSyms.has(name)) return name;
      }
      cur = cur.parent;
    }
    return undefined;
  }

  /** Class symbol of `$this`, a typed/`new`-assigned variable or a typed `$this->prop`. */
  function objectType(
    obj: TSNode,
    caller: string | undefined,
  ): { id: string; confidence: number } | undefined {
    const cls = classOf(caller);
    if (obj.type === "variable_name") {
      if (obj.text === "$this") return cls ? { id: symId(rel, cls), confidence: 0.9 } : undefined;
      const t = varTypes.get(`${caller ?? ""}\u0000${obj.text}`);
      return t ? { id: t, confidence: 0.8 } : undefined;
    }
    if (
      obj.type === "member_access_expression" ||
      obj.type === "nullsafe_member_access_expression"
    ) {
      const inner = obj.childForFieldName("object");
      const prop = obj.childForFieldName("name")?.text;
      if (inner?.text !== "$this" || !cls || !prop) return undefined;
      const t = propTypes.get(`${cls}.${prop}`);
      return t ? { id: t, confidence: 0.8 } : undefined;
    }
    return undefined;
  }

  /** Class symbol of a `X::` scope: `self`/`static` (this class), `parent`, or a class name. */
  function scopeType(
    s: TSNode,
    caller: string | undefined,
  ): { id: string; confidence: number } | undefined {
    const cls = classOf(caller);
    if (s.type === "relative_scope" || RELATIVE.has(s.text.toLowerCase())) {
      const word = s.text.toLowerCase();
      if (!cls) return undefined;
      if (word === "parent") {
        const p = parents.get(cls);
        return p ? { id: p, confidence: 0.8 } : undefined;
      }
      return { id: symId(rel, cls), confidence: 0.9 };
    }
    if (s.type === "name" || s.type === "qualified_name") return classRef(s.text);
    return undefined;
  }

  function callTarget(
    call: TSNode,
    caller: string | undefined,
  ): { id: string; confidence: number } | undefined {
    switch (call.type) {
      case "function_call_expression": {
        const fn = call.childForFieldName("function");
        return fn?.type === "name" ? scope.get(fn.text) : undefined;
      }
      case "member_call_expression":
      case "nullsafe_member_call_expression": {
        const obj = call.childForFieldName("object");
        const m = call.childForFieldName("name");
        if (!obj || m?.type !== "name") return undefined;
        const t = objectType(obj, caller);
        return t ? { id: `${t.id}.${m.text}`, confidence: t.confidence } : undefined;
      }
      case "scoped_call_expression": {
        const s = call.childForFieldName("scope");
        const m = call.childForFieldName("name");
        if (!s || m?.type !== "name") return undefined;
        const t = scopeType(s, caller);
        if (t?.id.startsWith("pkg:")) return t;
        return t ? { id: `${t.id}.${m.text}`, confidence: t.confidence } : undefined;
      }
      case "object_creation_expression": {
        const cls = call.namedChildren.find(
          (c) => c?.type === "name" || c?.type === "qualified_name",
        );
        return cls ? classRef(cls.text) : undefined;
      }
      default:
        return undefined;
    }
  }

  /** `$x = new Foo()` and `function f(Foo $x)`: remember `$x`'s class for `$x->m()`. */
  function noteVarTypes(n: TSNode): void {
    for (const prm of n.descendantsOfType("simple_parameter")) {
      const t = typeRef(prm.childForFieldName("type"));
      const v = prm.childForFieldName("name")?.text;
      if (t && v) varTypes.set(`${enclosing(prm) ?? ""}\u0000${v}`, t);
    }
    for (const a of n.descendantsOfType("assignment_expression")) {
      const left = a.childForFieldName("left");
      const right = a.childForFieldName("right");
      if (left?.type !== "variable_name" || right?.type !== "object_creation_expression") continue;
      const cls = right.namedChildren.find(
        (c) => c?.type === "name" || c?.type === "qualified_name",
      );
      const t = cls ? classRef(cls.text) : undefined;
      if (t?.id.startsWith("sym:")) varTypes.set(`${enclosing(a) ?? ""}\u0000${left.text}`, t.id);
    }
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
    for (const h of handlers)
      pushEdge({ src: h, dst: id, kind: "handles", source: "tree-sitter", confidence });
  }

  /**
   * A controller class named in code (`UserController::class`: imports and namespace) or in
   * a string (`'UserController@show'`: fully qualified, or relative to the default controller
   * namespaces of Laravel/Lumen and CodeIgniter, never to imports).
   */
  function controllerRef(
    name: string,
    literal = false,
  ): { id: string; confidence: number } | undefined {
    if (!literal) {
      const direct = classRef(name);
      if (direct?.id.startsWith("sym:")) return direct;
    }
    const fq = name.replace(/^\\+/, "");
    const candidates = CONTROLLER_NAMESPACES.map((ns) => `${ns}\\${fq}`);
    if (literal) candidates.push(fq);
    for (const c of candidates) {
      const file = classFile(c);
      if (file) return { id: symId(file, lastSegment(fq)), confidence: 0.85 };
    }
    return undefined;
  }

  /** `Foo::class` → Foo's symbol. */
  function classConstant(n: TSNode): { id: string; confidence: number } | undefined {
    if (n.type !== "class_constant_access_expression") return undefined;
    const [cls, member] = n.namedChildren;
    if (!cls || member?.text !== "class") return undefined;
    const t = controllerRef(cls.text);
    return t?.id.startsWith("sym:") ? t : undefined;
  }

  /**
   * Handler symbols of a route registration: `[UserController::class, 'show']`,
   * `'UserController@show'` (Laravel/Lumen), `'Home::index'` (CodeIgniter), `Action::class`
   * (invokable), a bare method name inside `Route::controller(X::class)->group()`, Lumen's
   * `['uses' => …]`; closures attribute to the enclosing symbol or the file.
   */
  function handlersOf(
    arg: TSNode | undefined,
    caller: string | undefined,
    controller: { id: string; confidence: number } | undefined,
  ): { handlers: string[]; confidence: number } {
    const handlers: string[] = [];
    let confidence = 0.9;
    const self = caller ? symId(rel, caller) : fid;
    const visit = (a: TSNode | undefined): void => {
      if (!a) return;
      if (a.type === "anonymous_function" || a.type === "arrow_function") {
        handlers.push(self);
        confidence = Math.min(confidence, 0.7);
      } else if (a.type === "class_constant_access_expression") {
        const t = classConstant(a);
        if (t) handlers.push(t.id);
      } else if (a.type === "string" || a.type === "encapsed_string") {
        const s = phpString(a) ?? "";
        const m = CONTROLLER_STRING.exec(s);
        const t = m ? controllerRef(m[1]!, true) : undefined;
        if (t && m) handlers.push(`${t.id}.${m[2]}`);
        else if (controller && /^\w+$/.test(s)) handlers.push(`${controller.id}.${s}`);
      } else if (a.type === "array_creation_expression") {
        const els = arrayElements(a);
        const [first, second] = els;
        const method = second && !second.key ? phpString(second.value) : undefined;
        const cls = first && !first.key ? classConstant(first.value) : undefined;
        if (els.length === 2 && cls && method) handlers.push(`${cls.id}.${method}`);
        else for (const el of els) if (!el.key || el.key === "uses") visit(el.value);
      }
    };
    visit(arg);
    if (!handlers.length) {
      handlers.push(self);
      confidence = 0.5;
    }
    return { handlers: [...new Set(handlers)], confidence };
  }

  /**
   * Prefixes and controller from the groups a registration sits in, outermost first:
   * `Route::prefix('admin')->group(fn)`, `Route::group(['prefix' => 'admin'], fn)`,
   * `Route::controller(X::class)->group(fn)`, `$app->group('/v1', fn)` (Slim, CodeIgniter).
   */
  function groupContext(n: TSNode): {
    prefixes: string[];
    controller?: { id: string; confidence: number } | undefined;
  } {
    const prefixes: string[] = [];
    let controller: { id: string; confidence: number } | undefined;
    for (let cur = n.parent; cur; cur = cur.parent) {
      if (cur.type !== "anonymous_function" && cur.type !== "arrow_function") continue;
      const call = cur.parent?.type === "argument" ? cur.parent.parent?.parent : undefined;
      if (!call || !isCall(call) || call.childForFieldName("name")?.text !== "group") continue;
      const own: string[] = [];
      const first = argsOf(call)[0];
      const direct = first && first.id !== cur.id ? phpString(first) : undefined;
      if (direct !== undefined) own.push(direct);
      else if (first?.type === "array_creation_expression") {
        const prefix = arrayElements(first).find((e) => e.key === "prefix");
        const s = prefix ? phpString(prefix.value) : undefined;
        if (s !== undefined) own.push(s);
      }
      // the fluent chain before `->group()`: `Route::prefix('a')->controller(X::class)`
      for (let link = call.childForFieldName("object"); link && isCall(link); ) {
        const name = link.childForFieldName("name")?.text;
        const a0 = argsOf(link)[0];
        if (name === "prefix") {
          const s = phpString(a0);
          if (s !== undefined) own.unshift(s);
        } else if (name === "controller" && a0 && !controller) {
          const s = phpString(a0);
          controller = classConstant(a0) ?? (s ? controllerRef(s, true) : undefined);
        }
        link = link.childForFieldName("object");
      }
      prefixes.unshift(...own);
    }
    return { prefixes, controller };
  }

  /** `routes/api.php` routes are served under `/api` by Laravel's default route provider. */
  function laravelBase(): string | undefined {
    return /(^|\/)routes\/api\.php$/.test(rel) ? "/api" : undefined;
  }

  /**
   * Laravel `Route::get('users', …)` / `Route::match([...], …)` / `Route::any(…)` /
   * `Route::resource(…)`, and `$app->get('/users', …)` style registrations (Slim, Lumen,
   * CodeIgniter 4). Member calls need a handler-shaped argument and either a router-like
   * variable or a path starting with `/`, so `$request->get('name')` is not a route.
   */
  function routeFromCall(call: TSNode, caller: string | undefined): void {
    // `Route::get(…)`, or a fluent chain started on the facade: `Route::middleware('auth')->get(…)`
    let facade = false;
    const chained: string[] = [];
    for (let link: TSNode | null = call; link && isCall(link); ) {
      if (link.type === "scoped_call_expression") {
        facade = lastSegment(link.childForFieldName("scope")?.text ?? "") === "Route";
        break;
      }
      link = link.childForFieldName("object");
      if (link && isCall(link) && link.childForFieldName("name")?.text === "prefix") {
        const s = phpString(argsOf(link)[0]);
        if (s !== undefined) chained.unshift(s);
      }
    }
    const obj = call.type === "member_call_expression" ? call.childForFieldName("object") : null;
    const member = !facade && obj?.type === "variable_name" && obj.text !== "$this";
    if (!facade && !member) return;
    const verb = call.childForFieldName("name")?.text ?? "";
    const lower = verb.toLowerCase();
    const args = argsOf(call);
    if (facade && (verb === "resource" || verb === "apiResource")) {
      resourceRoutes(call, verb === "apiResource", args, caller, chained);
      return;
    }
    let methods: string[];
    let rest: TSNode[];
    if (lower === "match" || lower === "map") {
      methods = stringsOf(args[0])
        .map((m) => httpMethod(m))
        .filter((m): m is string => !!m);
      rest = args.slice(1);
    } else if (lower === "any") {
      methods = ["ALL"];
      rest = args;
    } else if (ROUTE_METHODS.has(lower) && lower !== "all") {
      methods = [lower.toUpperCase()];
      rest = args;
    } else return;
    const raw = phpString(rest[0]);
    if (raw === undefined || !methods.length) return;
    if (
      member &&
      (!handlerShaped(rest[1]) || (!raw.startsWith("/") && !ROUTER_VARS.has(obj!.text)))
    )
      return;
    const ctx = groupContext(call);
    const { handlers, confidence } = handlersOf(rest[1], caller, ctx.controller);
    const path = phpRoutePath(facade ? laravelBase() : undefined, ...ctx.prefixes, ...chained, raw);
    const framework = facade ? "laravel" : (frameworkOf(importedPkgs) ?? "http");
    for (const m of methods)
      addRoute(m, path, framework, call.startPosition.row + 1, handlers, confidence);
  }

  /** `Route::resource('photos', PhotoController::class)->only([...])` → the CRUD routes. */
  function resourceRoutes(
    call: TSNode,
    api: boolean,
    args: TSNode[],
    caller: string | undefined,
    chained: string[],
  ): void {
    const name = phpString(args[0]);
    if (!name) return;
    let only: string[] | undefined;
    let except: string[] | undefined;
    for (let cur = call; cur.parent?.type === "member_call_expression"; cur = cur.parent) {
      if (cur.parent.childForFieldName("object")?.id !== cur.id) break;
      const m = cur.parent.childForFieldName("name")?.text;
      if (m === "only") only = stringsOf(argsOf(cur.parent)[0]);
      if (m === "except") except = stringsOf(argsOf(cur.parent)[0]);
    }
    const ctx = groupContext(call);
    const literal = phpString(args[1]);
    const cls = args[1]
      ? (classConstant(args[1]) ?? (literal ? controllerRef(literal, true) : undefined))
      : undefined;
    const self = caller ? symId(rel, caller) : fid;
    for (const spec of laravelResource(name, api, only, except)) {
      addRoute(
        spec.method,
        phpRoutePath(laravelBase(), ...ctx.prefixes, ...chained, spec.path),
        "laravel",
        call.startPosition.row + 1,
        [cls ? `${cls.id}.${spec.action}` : self],
        cls ? 0.9 : 0.5,
      );
    }
  }

  /** `#[Route('/path', methods: ['GET'])]` attributes and `@Route(...)` docblock annotations. */
  function routeSpecs(n: TSNode): RouteSpec[] {
    const out: RouteSpec[] = [];
    for (const attr of n.childForFieldName("attributes")?.descendantsOfType("attribute") ?? []) {
      const name = attr.namedChildren[0]?.text ?? "";
      if (lastSegment(name) !== "Route") continue;
      const path = phpString(namedArg(attr, "path")) ?? phpString(positionalArgs(attr)[0]);
      if (path === undefined) continue;
      const methods = stringsOf(namedArg(attr, "methods"))
        .map((m) => httpMethod(m))
        .filter((m): m is string => !!m);
      for (const method of methods.length ? methods : ["ALL"]) out.push({ method, path });
    }
    const doc = n.previousNamedSibling;
    if (doc?.type === "comment" && doc.text.includes("@Route"))
      out.push(...parseRouteAnnotations(doc.text));
    return out;
  }

  /**
   * Symfony: a class-level route is the prefix of its methods' routes, or the route of an
   * invokable controller (`__invoke`) whose method declares none.
   */
  function attributeRoutes(cls: TSNode, className: string): void {
    const classSpecs = routeSpecs(cls);
    const prefix = classSpecs[0]?.path;
    const framework = frameworkOf(importedPkgs) ?? "symfony";
    for (const m of cls.childForFieldName("body")?.namedChildren ?? []) {
      if (m?.type !== "method_declaration") continue;
      const mname = m.childForFieldName("name")?.text;
      if (!mname) continue;
      const specs = routeSpecs(m);
      if (!specs.length && mname === "__invoke" && classSpecs.length) {
        for (const s of classSpecs)
          addRoute(
            s.method,
            phpRoutePath(s.path),
            framework,
            cls.startPosition.row + 1,
            [symId(rel, `${className}.${mname}`)],
            0.95,
          );
        continue;
      }
      for (const s of specs) {
        addRoute(
          s.method,
          phpRoutePath(prefix, s.path),
          framework,
          m.startPosition.row + 1,
          [symId(rel, `${className}.${mname}`)],
          0.95,
        );
      }
    }
  }

  function walkRefs(n: TSNode): void {
    noteVarTypes(n);
    for (const call of n.descendantsOfType(CALLS)) {
      const caller = enclosing(call);
      routeFromCall(call, caller);
      const target = callTarget(call, caller);
      if (!target) continue;
      refs.push(
        caller ? symId(rel, caller) : fid,
        target.id,
        "calls",
        target.confidence,
        call.startPosition.row + 1,
      );
    }
    // references: type hints, `X::class` / `X::CONST` / `X::$prop`, `instanceof X`
    const named: TSNode[] = [];
    for (const t of n.descendantsOfType("named_type")) named.push(t);
    for (const a of n.descendantsOfType([
      "class_constant_access_expression",
      "scoped_property_access_expression",
    ])) {
      const s = a.namedChildren[0];
      if (s && (s.type === "name" || s.type === "qualified_name")) named.push(s);
    }
    for (const b of n.descendantsOfType("binary_expression")) {
      const right = b.childForFieldName("right");
      if (b.childForFieldName("operator")?.type === "instanceof" && right) named.push(right);
    }
    for (const t of named) {
      const target = classRef(t.text);
      if (!target) continue;
      const caller = enclosing(t);
      refs.push(
        caller ? symId(rel, caller) : fid,
        target.id,
        "references",
        target.confidence * 0.9,
        t.startPosition.row + 1,
      );
    }
    // `$this->prop` reads inside a class
    for (const me of n.descendantsOfType([
      "member_access_expression",
      "nullsafe_member_access_expression",
    ])) {
      if (me.childForFieldName("object")?.text !== "$this") continue;
      const caller = enclosing(me);
      const cls = classOf(caller);
      const prop = me.childForFieldName("name")?.text;
      if (!cls || !prop || !localSyms.has(`${cls}.${prop}`)) continue;
      refs.push(
        symId(rel, caller!),
        symId(rel, `${cls}.${prop}`),
        "references",
        0.81,
        me.startPosition.row + 1,
      );
    }
  }
}
