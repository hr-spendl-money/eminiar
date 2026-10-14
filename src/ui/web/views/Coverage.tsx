import type { JSX } from "preact";
import { useMemo, useState } from "preact/hooks";
import { api, post } from "../api.js";
import { Empty, ErrorBox, KV, Spinner, Tag, toast, useAsync, useSort } from "../components.js";
import { navigate } from "../router.js";
import { ago, cls, fmt } from "../util.js";

interface CoverageFile {
  path: string;
  status: string;
  reason: string | null;
  language: string | null;
  symbols: number | null;
  size: number | null;
  indexed_at: number;
  errors: string | null;
}
interface Coverage {
  summary: {
    byStatus: Record<string, number>;
    reasons: Array<{ reason: string; n: number }>;
    lastIndexedAt: number | null;
  };
  freshness: {
    head?: string;
    indexedHead?: string;
    headMatches: boolean;
    queued: number;
    dirty: string[];
    lastRun: number | null;
  };
  scan: {
    at?: number;
    scanned?: number;
    durationMs?: number;
    include?: string[];
    exclude?: string[];
  } | null;
  files: CoverageFile[];
}

export function Coverage(): JSX.Element {
  const q = useAsync(() => api<Coverage>("/api/coverage"), []);
  const [status, setStatus] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const rows = useMemo(() => {
    const f = text.trim().toLowerCase();
    return (q.data?.files ?? []).filter(
      (r) =>
        (!status || r.status === status) &&
        (!f || r.path.toLowerCase().includes(f) || (r.reason ?? "").toLowerCase().includes(f)),
    );
  }, [q.data, status, text]);
  const { sorted, th } = useSort(rows, "path", false);
  const run = async (label: string, body: Record<string, unknown>) => {
    setBusy(label);
    try {
      const r = await post<{ ok: boolean; output: string }>("/api/actions", body);
      toast(r.output.split("\n")[0] ?? "done", !r.ok);
      q.reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  };
  if (q.error)
    return (
      <div class="page">
        <ErrorBox error={q.error} />
      </div>
    );
  const d = q.data;
  if (!d)
    return (
      <div class="page">
        <Spinner />
      </div>
    );
  const b = d.summary.byStatus;
  const total = Object.values(b).reduce((a, n) => a + n, 0);
  const fresh = d.freshness.headMatches && !d.freshness.dirty.length && !d.freshness.queued;
  const cards: Array<[string, number, string]> = [
    ["indexed", b.indexed ?? 0, "parsed into the graph and search"],
    ["partial", b.partial ?? 0, "indexed, syntax errors recovered"],
    ["skipped", b.skipped ?? 0, "too large or parser error"],
    ["unsupported", b.unsupported ?? 0, "matched by globs, no parser"],
  ];
  return (
    <div class="page">
      <div class="grid">
        {cards.map(([k, n, sub]) => (
          <div
            class={cls("card")}
            style={{ cursor: "pointer" }}
            onClick={() => setStatus(status === k ? "" : k)}
          >
            <h3>
              {k}
              {status === k ? <span class="right">filtering</span> : null}
            </h3>
            <div
              class={cls(
                "big",
                k === "skipped" && n > 0 && "bad",
                k === "partial" && n > 0 && "warn",
              )}
            >
              {n}
            </div>
            <div class="sub">{sub}</div>
          </div>
        ))}
        <div class="card">
          <h3>freshness</h3>
          <div class={cls("big", fresh ? "ok" : "warn")}>
            {fresh
              ? "fresh"
              : d.freshness.dirty.length || d.freshness.queued
                ? "stale"
                : "git behind"}
          </div>
          <div class="sub">
            {d.freshness.dirty.length} changed · {d.freshness.queued} queued
          </div>
        </div>
      </div>
      <div class="grid wide">
        <div class="card">
          <h3>
            files{" "}
            <span class="right">
              {sorted.length} of {total}
            </span>
          </h3>
          <div class="row" style={{ marginBottom: 8 }}>
            <input
              type="search"
              class="grow"
              placeholder="filter by path or reason…"
              value={text}
              onInput={(e) => setText((e.target as HTMLInputElement).value)}
            />
            <select
              value={status}
              onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}
            >
              <option value="">any status</option>
              {["indexed", "partial", "skipped", "unsupported"].map((s) => (
                <option value={s}>{s}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => run("code", { action: "reindex", scope: "code" })}
            >
              {busy === "code" ? <Spinner /> : "Reindex code"}
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => run("full", { action: "reindex", scope: "code", full: true })}
            >
              {busy === "full" ? <Spinner /> : "Full reindex"}
            </button>
          </div>
          <div class="list" style={{ maxHeight: 560 }}>
            <table>
              <thead>
                <tr>
                  {th("path", "path")}
                  {th("status", "status")}
                  {th("reason", "reason")}
                  {th("symbols", "symbols", true)}
                  {th("size", "size", true)}
                  {th("indexed_at", "indexed", true)}
                  <th />
                </tr>
              </thead>
              <tbody>
                {sorted.length ? (
                  sorted.slice(0, 500).map((r) => (
                    <tr>
                      <td class="break">
                        <a onClick={() => navigate("explore", { file: r.path })}>{r.path}</a>
                      </td>
                      <td>
                        <Tag
                          class={
                            r.status === "indexed"
                              ? "s-accepted"
                              : r.status === "partial"
                                ? "s-proposed"
                                : "risk-high"
                          }
                        >
                          {r.status}
                        </Tag>
                      </td>
                      <td class="muted small">
                        {r.reason ?? ""}
                        {r.errors ? <div class="bad small">{r.errors.slice(0, 160)}</div> : null}
                      </td>
                      <td class="num">{r.symbols ?? ""}</td>
                      <td class="num">{fmt(r.size ?? 0)}</td>
                      <td class="num muted small">{ago(r.indexed_at)}</td>
                      <td>
                        <button
                          type="button"
                          class="sm"
                          disabled={!!busy}
                          onClick={() =>
                            run(r.path, { action: "reindex", scope: "code", paths: [r.path] })
                          }
                        >
                          {busy === r.path ? <Spinner /> : "reindex"}
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7}>
                      <Empty>no files match</Empty>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div class="stack">
          <div class="card">
            <h3>index state</h3>
            <KV
              rows={[
                ["HEAD", d.freshness.head?.slice(0, 10) ?? "no git"],
                [
                  "git signals at",
                  d.freshness.indexedHead
                    ? `${d.freshness.indexedHead.slice(0, 10)}${d.freshness.headMatches ? " (current)" : " (behind)"}`
                    : "never",
                ],
                ["last run", d.freshness.lastRun ? ago(d.freshness.lastRun) : "never"],
                ["queued", String(d.freshness.queued)],
                [
                  "last scan",
                  d.scan?.at
                    ? `${ago(d.scan.at)} · ${d.scan.scanned} files · ${d.scan.durationMs} ms`
                    : "n/a",
                ],
              ]}
            />
          </div>
          {d.freshness.dirty.length ? (
            <div class="card">
              <h3>changed since indexed · {d.freshness.dirty.length}</h3>
              <div class="list" style={{ maxHeight: 200 }}>
                {d.freshness.dirty.map((p) => (
                  <div class="item" onClick={() => navigate("explore", { file: p })}>
                    <div class="p">{p}</div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                class="sm"
                style={{ marginTop: 6 }}
                disabled={!!busy}
                onClick={() =>
                  run("dirty", { action: "reindex", scope: "code", paths: d.freshness.dirty })
                }
              >
                {busy === "dirty" ? <Spinner /> : "Reindex changed files"}
              </button>
            </div>
          ) : null}
          {d.summary.reasons.length ? (
            <div class="card">
              <h3>why files are not fully indexed</h3>
              <table>
                <tbody>
                  {d.summary.reasons.map((r) => (
                    <tr class="click" onClick={() => setText(r.reason)}>
                      <td>{r.reason}</td>
                      <td class="num">{r.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div class="card">
            <h3>scope</h3>
            <div class="small">
              <div class="muted">include</div>
              <div class="mono break">{(d.scan?.include ?? []).join("  ") || "(defaults)"}</div>
              <div class="muted" style={{ marginTop: 4 }}>
                exclude
              </div>
              <div class="mono break">{(d.scan?.exclude ?? []).join("  ") || "(defaults)"}</div>
              <div class="muted" style={{ marginTop: 6 }}>
                Change them in eminiar.config.json under graph.include / graph.exclude. A clean
                coverage result means no recorded gap, not proof of completeness.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
