import { type ChunkerOptions, DEFAULT_CHUNKER, type RawChunk, windowLines } from "./types.js";

/** Prose/log output: windows broken on blank lines, titled by line range. */
export function chunkText(
  text: string,
  baseTitle: string,
  opts: ChunkerOptions = DEFAULT_CHUNKER,
): RawChunk[] {
  const lines = text.split("\n");
  if (text.length <= opts.maxChars) {
    return [{ title: baseTitle, body: text, startLine: 1, endLine: lines.length }];
  }
  return windowLines(
    lines,
    { ...opts, overlapLines: 0 },
    (line) => line.trim() === "",
    (a, b) => `${baseTitle} (L${a}-${b})`,
  );
}
