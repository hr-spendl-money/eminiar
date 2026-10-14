import type { JSX } from "preact";
import { api } from "../api.js";
import { ErrorBox, KV, Spinner, Tag, useAsync } from "../components.js";
import { navigate } from "../router.js";
import { ago, fmt, pct } from "../util.js";

interface ToolRow {
  tool: string;
  calls: number;
  raw_chars: number;
  returned_chars: number;
}
interface Totals {
  calls: number;
  savedTokens: number;
  efficiency: number;
}
interface Stats {
  project: string;
  dbPath: string;
  session: Totals & { id: string; tools: ToolRow[] };
  projectTotals: Totals;
  lifetime: Totals & { tools: ToolRow[] };
  daily: Array<{ day: string; calls: number; saved_chars: number }>;
  index: {
    documents: number;
    bySource: Record<string, number>;
    vectors: number;
    pendingEmbeddings: boolean;
    embeddings: string;
    memories: number;
    graph: { nodes: number; edges: number; byKind: Record<string, number> };
  };
  memoriesDir: string;
  onboarding: string[];
  routing: string;
  sessions: Array<{
    id: string;
    current: boolean;
    started_at: number | null;
    last_prompt: string | null;
    calls: number;
    savedTokens: number;
  }>;
}

function ToolTable({ rows }: { rows: ToolRow[] }): JSX.Element {
  const sorted = [...rows].sort((a, b) => b.raw_chars - a.raw_chars);
  return (
    <table>
      <thead>
        <tr>
          <th>tool</th>
          <th class="num">calls</th>
          <th class="num">seen</th>
          <th class="num">returned</th>
          <th class="num">saved</th>
        </tr>
      </thead>
      <tbody>
        {sorted.length ? (
          sorted.map((r) => {
            const s = Math.ceil(r.raw_chars / 4);
            const t = Math.ceil(r.returned_chars / 4);
            return (
              <tr>
                <td>{r.tool}</td>
                <td class="num">{r.calls}</td>
                <td class="num">{fmt(s)}</td>
                <td class="num">{fmt(t)}</td>
                <td class="num">{fmt(Math.max(0, s - t))}</td>
              </tr>
            );
          })
        ) : (
          <tr>
            <td class="muted" colSpan={5}>
              no calls yet
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export function Overview(): JSX.Element {
  const q = useAsync(() => api<Stats>("/api/stats"), []);
  if (q.error)
    return (
      <div class="page">
        <ErrorBox error={q.error} />
      </div>
    );
  const s = q.data;
  if (!s)
    return (
      <div class="page">
        <Spinner />
      </div>
    );
  const kpis: Array<[string, string, JSX.Element | string]> = [
    [
      "session saved",
      fmt(s.session.savedTokens),
      `${pct(s.session.efficiency)} efficient · ${s.session.calls} calls`,
    ],
    [
      "project saved",
      fmt(s.projectTotals.savedTokens),
      `${pct(s.projectTotals.efficiency)} efficient · ${s.projectTotals.calls} calls`,
    ],
    [
      "lifetime saved",
      fmt(s.lifetime.savedTokens),
      `${pct(s.lifetime.efficiency)} efficient · ${s.lifetime.calls} calls`,
    ],
    [
      "documents",
      String(s.index.documents),
      <>
        {s.index.vectors} vectors
        {s.index.pendingEmbeddings ? <span class="warn"> · backlog</span> : null}
      </>,
    ],
    ["memories", String(s.index.memories), `${s.onboarding.length}/4 onboarding`],
    ["graph", `${s.index.graph.nodes} nodes`, `${s.index.graph.edges} edges`],
  ];
  const max = Math.max(1, ...s.daily.map((d) => d.saved_chars));
  const missing = ["overview", "structure", "commands", "conventions"].filter(
    (n) => !s.onboarding.includes(n),
  );
  return (
    <div class="page">
      <div class="grid">
        {kpis.map(([h, v, sub]) => (
          <div class="card">
            <h3>{h}</h3>
            <div class="big">{v}</div>
            <div class="sub">{sub}</div>
          </div>
        ))}
      </div>
      <div class="grid wide">
        <div class="card">
          <h3>
            tokens saved per day
            <span class="right">
              {s.daily.length ? `${s.daily[0]?.day} → ${s.daily[s.daily.length - 1]?.day}` : ""}
            </span>
          </h3>
          <div class="bars">
            {s.daily.length ? (
              s.daily.map((d) => (
                <div
                  title={`${d.day}: ${fmt(Math.ceil(d.saved_chars / 4))} tokens, ${d.calls} calls`}
                  style={{ height: `${Math.max(2, (100 * d.saved_chars) / max)}%` }}
                />
              ))
            ) : (
              <div class="muted">no data yet</div>
            )}
          </div>
        </div>
        <div class="card">
          <h3>system</h3>
          <KV
            rows={[
              ["project", s.project],
              ["database", s.dbPath],
              ["routing", s.routing],
              ["embeddings", s.index.embeddings],
              ["memories dir", s.memoriesDir],
              [
                "onboarding",
                missing.length ? (
                  <span class="warn">missing: {missing.join(", ")} — run /eminiar:em-onboard</span>
                ) : (
                  <span class="ok">complete</span>
                ),
              ],
              ["session", s.session.id],
            ]}
          />
        </div>
      </div>
      <div class="grid two">
        <div class="card">
          <h3>this session · by tool</h3>
          <ToolTable rows={s.session.tools} />
        </div>
        <div class="card">
          <h3>lifetime · by tool</h3>
          <ToolTable rows={s.lifetime.tools} />
        </div>
      </div>
      <div class="grid">
        <div class="card">
          <h3>index by source</h3>
          <table>
            <tbody>
              {Object.entries(s.index.bySource)
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <tr>
                    <td>{k}</td>
                    <td class="num">{v}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div class="card">
          <h3>graph by edge kind</h3>
          <table>
            <tbody>
              {Object.entries(s.index.graph.byKind ?? {})
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => (
                  <tr>
                    <td>{k}</td>
                    <td class="num">{v}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div class="card" style={{ gridColumn: "span 2" }}>
          <h3>
            recent sessions{" "}
            <a class="right" onClick={() => navigate("sessions")}>
              all →
            </a>
          </h3>
          <table>
            <thead>
              <tr>
                <th>started</th>
                <th>session</th>
                <th>last prompt</th>
                <th class="num">calls</th>
                <th class="num">saved</th>
              </tr>
            </thead>
            <tbody>
              {s.sessions.map((x) => (
                <tr>
                  <td class="muted">
                    {ago(x.started_at)} {x.current ? <Tag>current</Tag> : null}
                  </td>
                  <td>
                    <code>{x.id.slice(0, 8)}</code>
                  </td>
                  <td class="muted">{(x.last_prompt ?? "").slice(0, 90)}</td>
                  <td class="num">{x.calls}</td>
                  <td class="num">{fmt(x.savedTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
