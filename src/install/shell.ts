import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { findOnPath } from "../sandbox/languages.js";

export interface RunOut {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
}

/** Run a command without a shell and capture output. Never throws. */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; quiet?: boolean } = {},
): RunOut {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.error) return { ok: false, stdout: "", stderr: r.error.message, status: null };
  return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

export function claudeCli(): string | undefined {
  return findOnPath("claude");
}

export function npmCli(): string {
  return findOnPath("npm") ?? "npm";
}

/** y/N prompt; non-interactive stdin counts as "no" unless `yes` was passed. */
export async function confirm(question: string, yes: boolean): Promise<boolean> {
  if (yes) return true;
  if (!process.stdin.isTTY) {
    console.log(`${question} [y/N] (non-interactive: no; pass --yes to accept)`);
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((res) => rl.question(`${question} [y/N] `, res));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

export const log = {
  step: (s: string) => console.log(`\n▸ ${s}`),
  ok: (s: string) => console.log(`  ✓ ${s}`),
  warn: (s: string) => console.log(`  ! ${s}`),
  fail: (s: string) => console.log(`  ✗ ${s}`),
  info: (s: string) => console.log(`    ${s}`),
};
