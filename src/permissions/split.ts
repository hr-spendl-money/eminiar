/**
 * Split a shell command line into the simple commands it would run, so each can be
 * checked against permission rules. Splits on `&&`, `||`, `;`, `|`, `&` and newlines
 * outside quotes, and recurses into `$(...)`, backticks and `( ... )` subshells.
 */
export function splitCommand(line: string): string[] {
  const segments: string[] = [];
  let cur = "";
  let i = 0;
  let quote: '"' | "'" | null = null;
  let depth = 0;
  const flush = () => {
    const s = cur.trim();
    if (s) segments.push(s);
    cur = "";
  };
  while (i < line.length) {
    const ch = line[i]!;
    const next = line[i + 1];
    if (quote) {
      cur += ch;
      if (ch === "\\" && quote === '"' && next !== undefined) {
        cur += next;
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === "\\" && next !== undefined) {
      cur += ch + next;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      i++;
      continue;
    }
    if (ch === "`") {
      const end = line.indexOf("`", i + 1);
      const inner = end === -1 ? line.slice(i + 1) : line.slice(i + 1, end);
      segments.push(...splitCommand(inner));
      cur += " ";
      i = end === -1 ? line.length : end + 1;
      continue;
    }
    if (ch === "$" && next === "(") {
      const end = matchParen(line, i + 1);
      segments.push(...splitCommand(line.slice(i + 2, end)));
      cur += " ";
      i = end + 1;
      continue;
    }
    if (ch === "(" && depth === 0 && cur.trim() === "") {
      const end = matchParen(line, i);
      segments.push(...splitCommand(line.slice(i + 1, end)));
      i = end + 1;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0) {
      if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) {
        flush();
        i += 2;
        continue;
      }
      if (ch === ";" || ch === "|" || ch === "\n" || ch === "&") {
        flush();
        i++;
        continue;
      }
    }
    cur += ch;
    i++;
  }
  flush();
  return segments.map(normalize).filter(Boolean);
}

function matchParen(s: string, open: number): number {
  let d = 0;
  for (let j = open; j < s.length; j++) {
    if (s[j] === "(") d++;
    else if (s[j] === ")") {
      d--;
      if (d === 0) return j;
    }
  }
  return s.length;
}

/** Strip leading `VAR=x` assignments and `env`, `command`, `exec`, `time`, `nice` wrappers. */
export function normalize(seg: string): string {
  let s = seg.trim();
  for (;;) {
    const before = s;
    s = s.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/, "");
    s = s.replace(/^(?:env|command|exec|time|nohup|builtin)\s+(?:-\S+\s+)*/, "");
    s = s.replace(/^nice\s+(?:-n\s+\S+\s+|-\S+\s+)*/, "");
    if (s === before) break;
  }
  return s;
}
