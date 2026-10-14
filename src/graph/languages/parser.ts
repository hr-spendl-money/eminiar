import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import type { Language as TSLanguage, Node as TSNode, Parser as TSParser } from "web-tree-sitter";
import type { GraphEdge } from "../../storage/types.js";
import { pluginRoot } from "../../version.js";

export type Grammar = "typescript" | "tsx" | "javascript" | "python" | "go";

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
    case ".py":
    case ".pyi":
      return "python";
    case ".go":
      return "go";
    default:
      return undefined;
  }
}

let parserMod: typeof import("web-tree-sitter") | undefined;
let parser: TSParser | undefined;
const languages = new Map<Grammar, TSLanguage>();

/** One shared parser; grammars load lazily from vendor/grammars/<name>.wasm. */
export async function getParser(grammar: Grammar): Promise<TSParser> {
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

export interface Ref {
  src: string;
  dst: string;
  kind: string;
  confidence: number;
  count: number;
  lines: number[];
}

/** Aggregates repeated (src, dst, kind) uses into one edge with a count and first lines. */
export class RefCollector {
  private readonly refs = new Map<string, Ref>();

  push(src: string, dst: string, kind: string, confidence: number, line: number): void {
    if (dst === src) return;
    const key = `${src}\u0000${dst}\u0000${kind}`;
    const cur = this.refs.get(key);
    if (cur) {
      cur.count++;
      cur.confidence = Math.max(cur.confidence, confidence);
      if (cur.lines.length < 5) cur.lines.push(line);
    } else this.refs.set(key, { src, dst, kind, confidence, count: 1, lines: [line] });
  }

  edges(): GraphEdge[] {
    return [...this.refs.values()].map((r) => ({
      src: r.src,
      dst: r.dst,
      kind: r.kind,
      source: "tree-sitter" as const,
      confidence: r.confidence,
      weight: 1,
      meta: { count: r.count, lines: r.lines },
    }));
  }
}

/** 1 + the number of branching constructs, with short-circuit operators counted when `ops` names them. */
export function complexityOf(n: TSNode, branchTypes: string[], ops?: Set<string>): number {
  let c = 1;
  for (const b of n.descendantsOfType(branchTypes)) {
    if (ops && (b.type === "binary_expression" || b.type === "boolean_operator")) {
      const op =
        b.childForFieldName("operator")?.type ?? b.children.find((x) => x && ops.has(x.type))?.type;
      if (op && ops.has(op)) c++;
    } else c++;
  }
  return c;
}

/** Text of a string literal node without quotes (`"a"`, `'a'`, `` `a` ``, `"""a"""`). */
export function literalText(n: TSNode | null | undefined): string | undefined {
  if (!n) return undefined;
  const t = n.text;
  const m = /^[rbuf]*(["'`]{3}|["'`])([\s\S]*?)\1$/i.exec(t);
  return m ? m[2] : undefined;
}
