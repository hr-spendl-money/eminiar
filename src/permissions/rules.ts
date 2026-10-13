export interface Rule {
  raw: string;
  tool: string;
  /** undefined = the whole tool (e.g. "Bash"). */
  pattern?: string | undefined;
}

export interface PermissionRules {
  allow: Rule[];
  deny: Rule[];
  ask: Rule[];
}

/** Parse a Claude Code permission rule like `Bash(git log:*)` or `Read(~/.ssh/**)`. */
export function parseRule(raw: string): Rule | undefined {
  const m = /^([A-Za-z][\w-]*)(?:\((.*)\))?$/s.exec(raw.trim());
  if (!m) return undefined;
  return { raw, tool: m[1]!, pattern: m[2] };
}

function escapeRe(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Bash patterns: `cmd:*` and the legacy `cmd *` are prefix rules (the command must
 * start with `cmd` at a word boundary); other `*` are wildcards; no `*` is exact.
 */
function bashRegex(pattern: string): RegExp {
  if (pattern.endsWith(":*")) {
    return new RegExp(`^\\s*${escapeRe(pattern.slice(0, -2))}(\\s|$)`);
  }
  if (pattern.endsWith(" *")) {
    return new RegExp(`^\\s*${escapeRe(pattern.slice(0, -2))}(\\s|$)`);
  }
  if (!pattern.includes("*")) {
    return new RegExp(`^\\s*${escapeRe(pattern)}\\s*$`);
  }
  return new RegExp(`^\\s*${pattern.split("*").map(escapeRe).join(".*")}\\s*$`);
}

export function matchBash(rule: Rule, command: string): boolean {
  if (rule.tool !== "Bash") return false;
  if (rule.pattern === undefined) return true;
  return bashRegex(rule.pattern).test(command);
}

/** Read(path) rules: glob with `**` and `*`; `~` expands to $HOME. */
export function matchRead(rule: Rule, absPath: string): boolean {
  if (rule.tool !== "Read") return false;
  if (rule.pattern === undefined) return true;
  let p = rule.pattern;
  if (p.startsWith("~")) p = (process.env.HOME ?? "") + p.slice(1);
  const re = new RegExp(
    `^${p
      .split("**")
      .map((seg) => seg.split("*").map(escapeRe).join("[^/]*"))
      .join(".*")}$`,
  );
  return re.test(absPath);
}
