#!/usr/bin/env node
// Benchmark the em_execute / em_batch_execute hot paths against the built server
// (dist/server.js) over real stdio, the way Claude Code drives it.
//
//   npm run build && node scripts/bench-hotpath.mjs [--runs 40] [--json]
//
// Measures: cold start to first tools/list reply, round-trip latency for a tiny
// em_execute, em_batch_execute with 8 small commands, and em_execute on a large
// (≈400 KB) output with an intent. Uses a throwaway EMINIAR_HOME and project so
// nothing you have indexed is touched.

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SERVER = join(here, "..", "dist", "server.js");
const args = process.argv.slice(2);
const RUNS = Number(args[args.indexOf("--runs") + 1]) || 40;
const JSON_OUT = args.includes("--json");

const home = mkdtempSync(join(tmpdir(), "em-bench-home-"));
const root = mkdtempSync(join(tmpdir(), "em-bench-root-"));
writeFileSync(join(root, "package.json"), "{}");
mkdirSync(join(root, ".git"));
// No embeddings (no model download), no code graph warm-up noise.
writeFileSync(
  join(root, "eminiar.config.json"),
  JSON.stringify({ embeddings: { enabled: false }, graph: { include: [] } }),
);

const env = {
  ...process.env,
  EMINIAR_HOME: home,
  EMINIAR_PROJECT_ROOT: root,
  EMINIAR_EMBEDDINGS: "0",
};

class Client {
  constructor() {
    this.id = 0;
    this.pending = new Map();
    this.buf = "";
    this.child = spawn(process.execPath, [SERVER], { env, cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (d) => {
      this.buf += d;
      let nl;
      while ((nl = this.buf.indexOf("\n")) !== -1) {
        const line = this.buf.slice(0, nl);
        this.buf = this.buf.slice(nl + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          p(msg);
        }
      }
    });
    this.stderr = "";
    this.child.stderr.on("data", (d) => {
      this.stderr += d;
    });
  }
  request(method, params) {
    const id = ++this.id;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }
  notify(method, params) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }
  async init() {
    await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "bench", version: "0" },
    });
    this.notify("notifications/initialized", {});
  }
  call(name, a) {
    return this.request("tools/call", { name, arguments: a });
  }
  close() {
    this.child.kill("SIGTERM");
  }
}

const now = () => performance.now();
function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], p50: q(0.5), p95: q(0.95), max: s[s.length - 1], mean: s.reduce((a, b) => a + b, 0) / s.length };
}
const fmt = (s) => `n=${s.n}  min ${s.min.toFixed(1)}  p50 ${s.p50.toFixed(1)}  p95 ${s.p95.toFixed(1)}  max ${s.max.toFixed(1)}  mean ${s.mean.toFixed(1)} ms`;

async function timed(fn) {
  const t = now();
  const r = await fn();
  return [now() - t, r];
}

const results = {};

// --- cold start: spawn → initialize → tools/list -------------------------------
{
  const xs = [];
  for (let i = 0; i < Math.min(RUNS, 10); i++) {
    const t = now();
    const c = new Client();
    await c.init();
    await c.request("tools/list", {});
    xs.push(now() - t);
    c.close();
    await new Promise((r) => c.child.on("exit", r));
  }
  results.coldStart = stats(xs);
}

const c = new Client();
await c.init();
await c.request("tools/list", {});

// Pre-warm once so the first-call costs (db open, migrations) are not in the steady-state numbers.
await c.call("em_execute", { language: "shell", code: "echo warm" });
await c.call("em_batch_execute", { commands: [{ label: "a", command: "echo warm" }] });

// --- em_execute, tiny shell ------------------------------------------------------
{
  const xs = [];
  for (let i = 0; i < RUNS; i++) {
    const [ms, r] = await timed(() => c.call("em_execute", { language: "shell", code: `echo hi ${i}` }));
    if (r.error || r.result?.isError) throw new Error(`em_execute failed: ${JSON.stringify(r).slice(0, 300)}`);
    xs.push(ms);
  }
  results.execTinyShell = stats(xs);
}

// --- raw spawn floor: what the shell itself costs ---------------------------------
{
  const xs = [];
  const sh = /\/(zsh|bash)$/.test(process.env.SHELL ?? "") ? process.env.SHELL : "bash";
  for (let i = 0; i < RUNS; i++) {
    const [ms] = await timed(
      () =>
        new Promise((resolve) => {
          const p = spawn(sh, ["-c", `echo hi ${i}`], { stdio: ["ignore", "pipe", "pipe"] });
          p.stdout.on("data", () => {});
          p.on("close", resolve);
        }),
    );
    xs.push(ms);
  }
  results.spawnFloor = stats(xs);
}

// --- em_execute, tiny javascript (node startup dominates) -------------------------
{
  const xs = [];
  for (let i = 0; i < Math.min(RUNS, 15); i++) {
    const [ms, r] = await timed(() => c.call("em_execute", { language: "javascript", code: `console.log(${i})` }));
    if (r.error || r.result?.isError) throw new Error(`em_execute js failed: ${JSON.stringify(r).slice(0, 300)}`);
    xs.push(ms);
  }
  results.execTinyJs = stats(xs);
}

// --- em_batch_execute, 8 tiny commands -----------------------------------------
{
  const xs = [];
  const commands = Array.from({ length: 8 }, (_, i) => ({ label: `cmd ${i}`, command: `echo batch ${i}; echo second line` }));
  for (let i = 0; i < Math.min(RUNS, 25); i++) {
    const [ms, r] = await timed(() => c.call("em_batch_execute", { commands, queries: ["second line"] }));
    if (r.error || r.result?.isError) throw new Error(`em_batch_execute failed: ${JSON.stringify(r).slice(0, 300)}`);
    xs.push(ms);
  }
  results.batch8Tiny = stats(xs);
}

// --- em_execute, large output (~400 KB) with intent -------------------------------
{
  const xs = [];
  const code =
    'for i in $(seq 1 12000); do echo "line $i: lorem ipsum dolor sit amet, consectetur $((i % 97)) adipiscing"; done; echo "ERROR: needle in the haystack at the end"';
  for (let i = 0; i < Math.min(RUNS, 8); i++) {
    const [ms, r] = await timed(() =>
      c.call("em_execute", { language: "shell", code, intent: "error needle", queries: ["haystack"] }),
    );
    if (r.error || r.result?.isError) throw new Error(`em_execute large failed: ${JSON.stringify(r).slice(0, 300)}`);
    xs.push(ms);
  }
  results.execLarge400k = stats(xs);
}

c.close();
rmSync(home, { recursive: true, force: true });
rmSync(root, { recursive: true, force: true });

if (JSON_OUT) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const w = Math.max(...Object.keys(results).map((k) => k.length));
  for (const [k, v] of Object.entries(results)) console.log(`${k.padEnd(w)}  ${fmt(v)}`);
}
