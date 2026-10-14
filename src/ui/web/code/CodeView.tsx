import type { JSX } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import type { FileSymbol } from "../api.js";
import { cls } from "../util.js";
import { highlightLines } from "./highlight.js";

export function CodeView({
  code,
  lang,
  symbols,
  highlight,
  scrollTo,
  onLine,
}: {
  code: string;
  lang: string;
  symbols?: FileSymbol[];
  /** Line range to tint. */
  highlight?: [number, number] | null;
  scrollTo?: number | null;
  onLine?: (line: number, symbol: FileSymbol | undefined) => void;
}): JSX.Element {
  const lines = useMemo(() => highlightLines(code, lang), [code, lang]);
  const starts = useMemo(() => {
    const m = new Map<number, FileSymbol>();
    for (const s of symbols ?? []) if (s.start_line && !m.has(s.start_line)) m.set(s.start_line, s);
    return m;
  }, [symbols]);
  const symbolAt = (line: number): FileSymbol | undefined => {
    let best: FileSymbol | undefined;
    for (const s of symbols ?? []) {
      if (s.start_line && s.end_line && s.start_line <= line && s.end_line >= line) {
        if (!best || s.end_line - s.start_line < best.end_line! - best.start_line!) best = s;
      }
    }
    return best;
  };
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scrollTo || !box.current) return;
    const row = box.current.querySelector<HTMLElement>(`tr[data-l="${scrollTo}"]`);
    if (row) row.scrollIntoView({ block: "center" });
  }, [scrollTo]);
  return (
    <div class="code" ref={box}>
      <table>
        <tbody>
          {lines.map((html, i) => {
            const n = i + 1;
            const sym = starts.get(n);
            const hl = highlight && n >= highlight[0] && n <= highlight[1];
            return (
              <tr data-l={n} class={cls(hl && "hl", sym && "sym")}>
                <td
                  class="ln"
                  onClick={() => onLine?.(n, symbolAt(n))}
                  title={sym ? `${sym.kind} ${sym.name}` : undefined}
                >
                  {n}
                </td>
                <td dangerouslySetInnerHTML={{ __html: html || " " }} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
