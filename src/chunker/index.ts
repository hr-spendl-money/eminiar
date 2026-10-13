import { extname } from "node:path";
import type { ChunkInput, ContentType } from "../storage/types.js";
import { chunkCode } from "./code.js";
import { chunkJson } from "./json.js";
import { chunkMarkdown } from "./markdown.js";
import { chunkText } from "./text.js";
import { type ChunkerOptions, DEFAULT_CHUNKER, finalize } from "./types.js";

export { DEFAULT_CHUNKER, hashText } from "./types.js";

const CODE_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cs",
  ".php",
  ".sol",
  ".sh",
  ".zsh",
  ".bash",
  ".sql",
  ".yaml",
  ".yml",
  ".toml",
  ".css",
  ".scss",
  ".html",
  ".vue",
  ".svelte",
  ".ex",
  ".exs",
  ".r",
  ".pl",
  ".lua",
  ".zig",
]);
const MD_EXT = new Set([".md", ".mdx", ".markdown"]);

export type Kind = ContentType | "markdown";

/** Guess how to chunk from the file name first, then from the content itself. */
export function sniffKind(content: string, uri?: string): Kind {
  const ext = uri ? extname(uri).toLowerCase() : "";
  if (MD_EXT.has(ext)) return "markdown";
  if (ext === ".json" || ext === ".jsonl") return "json";
  if (CODE_EXT.has(ext)) return "code";
  const head = content.slice(0, 4000);
  const trimmed = head.trimStart();
  if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && looksLikeJson(content)) return "json";
  if (/^#{1,6}\s+\S/m.test(head) || /^```/m.test(head)) return "markdown";
  const lines = head.split("\n").filter((l) => l.trim());
  const codey = lines.filter((l) =>
    /[{};]\s*$|^\s*(import|export|const|let|def|function|class|fn|func)\b/.test(l),
  ).length;
  if (lines.length >= 5 && codey / lines.length > 0.4) return "code";
  return "prose";
}

function looksLikeJson(s: string): boolean {
  if (s.length > 5_000_000) return false;
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

export function kindToContentType(kind: Kind): ContentType {
  return kind === "markdown" ? "prose" : kind;
}

/** Chunk any content. `kind` defaults to a sniff on uri/content. */
export function chunk(
  content: string,
  baseTitle: string,
  kind?: Kind,
  uri?: string,
  opts: ChunkerOptions = DEFAULT_CHUNKER,
): { chunks: ChunkInput[]; kind: Kind } {
  const k = kind ?? sniffKind(content, uri);
  const raw =
    k === "markdown"
      ? chunkMarkdown(content, baseTitle, opts)
      : k === "json"
        ? chunkJson(content, baseTitle, opts)
        : k === "code"
          ? chunkCode(content, baseTitle, opts)
          : chunkText(content, baseTitle, opts);
  return { chunks: finalize(raw, kindToContentType(k)), kind: k };
}
