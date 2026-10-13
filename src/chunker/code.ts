import { type ChunkerOptions, DEFAULT_CHUNKER, type RawChunk, windowLines } from "./types.js";

/** Lines that start a top-level declaration are good window boundaries. */
const TOP_LEVEL =
  /^(export\s|function\s|class\s|interface\s|type\s|enum\s|const\s|let\s|var\s|def\s|fn\s|func\s|pub\s|impl\s|struct\s|module\s|package\s|#\[|@\w)/;

/** Source code: ~maxChars windows, broken before top-level declarations or blank lines, with overlap. */
export function chunkCode(
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
    opts,
    (line, i) => TOP_LEVEL.test(line) || (line.trim() === "" && TOP_LEVEL.test(lines[i + 1] ?? "")),
    (a, b) => `${baseTitle} (L${a}-${b})`,
  );
}
