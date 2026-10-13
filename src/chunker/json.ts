import { chunkText } from "./text.js";
import { type ChunkerOptions, DEFAULT_CHUNKER, type RawChunk } from "./types.js";

/**
 * Chunk JSON by key path: each chunk is `path = value`. Values that are too big
 * are split one level deeper; arrays are grouped into runs of items that fit.
 * Line numbers are not meaningful for re-serialised JSON, so they are 0.
 */
export function chunkJson(
  text: string,
  baseTitle: string,
  opts: ChunkerOptions = DEFAULT_CHUNKER,
): RawChunk[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return chunkText(text, baseTitle, opts);
  }
  const out: RawChunk[] = [];
  walk(value, "$", baseTitle, opts, out);
  return out;
}

function render(path: string, v: unknown): string {
  return `${path} = ${JSON.stringify(v, null, 1)}`;
}

function walk(
  v: unknown,
  path: string,
  baseTitle: string,
  opts: ChunkerOptions,
  out: RawChunk[],
): void {
  const whole = render(path, v);
  if (whole.length <= opts.maxChars || v === null || typeof v !== "object") {
    pushMaybeSplit(out, `${baseTitle} ${path}`, whole, opts);
    return;
  }
  if (Array.isArray(v)) {
    let run: unknown[] = [];
    let runStart = 0;
    const flush = (i: number) => {
      if (!run.length) return;
      const p = run.length === 1 ? `${path}[${runStart}]` : `${path}[${runStart}..${i - 1}]`;
      pushMaybeSplit(out, `${baseTitle} ${p}`, render(p, run.length === 1 ? run[0] : run), opts);
      run = [];
    };
    v.forEach((item, i) => {
      const itemLen = JSON.stringify(item, null, 1).length;
      if (itemLen > opts.maxChars) {
        flush(i);
        runStart = i + 1;
        walk(item, `${path}[${i}]`, baseTitle, opts, out);
        return;
      }
      if (!run.length) runStart = i;
      if (render(path, [...run, item]).length > opts.maxChars) {
        flush(i);
        runStart = i;
      }
      run.push(item);
    });
    flush(v.length);
    return;
  }
  for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
    const key = /^[A-Za-z_$][\w$]*$/.test(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`;
    walk(child, key, baseTitle, opts, out);
  }
}

function pushMaybeSplit(out: RawChunk[], title: string, body: string, opts: ChunkerOptions): void {
  if (body.length <= opts.maxChars * 2) {
    out.push({ title, body, startLine: 0, endLine: 0 });
    return;
  }
  // A single scalar/string bigger than two windows: fall back to text windows.
  for (const c of chunkText(body, title, opts)) out.push({ ...c, startLine: 0, endLine: 0 });
}
