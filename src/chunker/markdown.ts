import { type ChunkerOptions, DEFAULT_CHUNKER, type RawChunk, windowLines } from "./types.js";

interface Section {
  path: string[];
  lines: string[];
  startLine: number;
}

/**
 * Split markdown by heading (any level), ignoring headings inside fenced code
 * blocks. Each section's title is its heading path ("Install > macOS"). Sections
 * longer than maxChars are windowed on paragraph boundaries; fences stay intact.
 */
export function chunkMarkdown(
  text: string,
  baseTitle: string,
  opts: ChunkerOptions = DEFAULT_CHUNKER,
): RawChunk[] {
  const lines = text.split("\n");
  const sections: Section[] = [];
  let current: Section = { path: [], lines: [], startLine: 1 };
  let inFence = false;
  const stack: Array<{ level: number; text: string }> = [];

  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = !inFence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      if (current.lines.length) sections.push(current);
      const level = m[1]!.length;
      while (stack.length && stack[stack.length - 1]!.level >= level) stack.pop();
      stack.push({ level, text: m[2]! });
      current = { path: stack.map((s) => s.text), lines: [], startLine: i + 1 };
      return;
    }
    current.lines.push(line);
  });
  if (current.lines.length) sections.push(current);

  const out: RawChunk[] = [];
  for (const s of sections) {
    const title = s.path.length ? `${baseTitle} > ${s.path.join(" > ")}` : baseTitle;
    const body = s.lines.join("\n");
    if (body.length <= opts.maxChars) {
      out.push({ title, body, startLine: s.startLine, endLine: s.startLine + s.lines.length - 1 });
      continue;
    }
    // Window on blank lines, never inside a fence.
    let fence = false;
    const fenceState = s.lines.map((l) => {
      if (/^\s*(```|~~~)/.test(l)) fence = !fence;
      return fence;
    });
    out.push(
      ...windowLines(
        s.lines,
        { ...opts, overlapLines: 0 },
        (line, i) => line.trim() === "" && !fenceState[i],
        (a, b) => `${title} (L${a}-${b})`,
        s.startLine - 1,
      ),
    );
  }
  return out;
}
