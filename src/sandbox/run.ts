import { spawn } from "node:child_process";

export interface RunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputBytes: number;
  stdin?: string | undefined;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

/**
 * Spawn a process in its own group so a timeout kills the whole tree. stdout is
 * capped at `maxOutputBytes` (the process is killed once exceeded); stderr keeps
 * only its last 8 KB.
 */
export function runProcess(argv: string[], opts: RunOptions): Promise<RunResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const [cmd, ...args] = argv;
    const child = spawn(cmd!, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: [opts.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const out: Buffer[] = [];
    let outBytes = 0;
    let errTail = "";
    let truncated = false;
    let timedOut = false;
    let done = false;

    const kill = () => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        // already gone
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.timeoutMs);

    child.stdout?.on("data", (d: Buffer) => {
      if (truncated) return;
      outBytes += d.length;
      if (outBytes > opts.maxOutputBytes) {
        out.push(d.subarray(0, Math.max(0, d.length - (outBytes - opts.maxOutputBytes))));
        truncated = true;
        kill();
        return;
      }
      out.push(d);
    });
    child.stderr?.on("data", (d: Buffer) => {
      errTail = (errTail + d.toString()).slice(-8192);
    });
    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: errTail,
        exitCode,
        signal,
        timedOut,
        truncated,
        durationMs: Date.now() - started,
      });
    };
    child.on("error", (err) => {
      errTail += `\n${err.message}`;
      finish(127, null);
    });
    child.on("close", finish);
    if (opts.stdin !== undefined && child.stdin) {
      child.stdin.end(opts.stdin);
    }
  });
}
