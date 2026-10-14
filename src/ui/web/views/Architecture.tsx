import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  type Architecture as Arch,
  api,
  type ClusterSummary,
  type EdgeWithNode,
  type Hotspot,
  type RouteRow,
  type TreeFile,
  type VisEdge,
  type VisNode,
} from "../api.js";
import {
  Bar,
  Empty,
  ErrorBox,
  KindTag,
  Spinner,
  SubTabs,
  Tag,
  useAsync,
  useSort,
} from "../components.js";
import { GraphCanvas } from "../graph/GraphCanvas.js";
import { buildTree, layoutTreemap, type Rect } from "../graph/treemap.js";
import { navigate } from "../router.js";
import { cls, color, fmt } from "../util.js";

type Tab = "overview" | "routes" | "hotspots" | "structure" | "behavior";

// --- overview: folder map ---------------------------------------------------------------

const LANG_COLORS: Record<string, string> = {
  typescript: "#2563eb",
  tsx: "#3b82f6",
  javascript: "#d97706",
  python: "#16a34a",
  go: "#0d9488",
  other: "#6b7280",
};
function heat(score: number): string {
  // blue → amber ramp on the palette
  const t = Math.max(0, Math.min(1, score));
  const r = Math.round(37 + (217 - 37) * t);
  const g = Math.round(99 + (119 - 99) * t);
  const b = Math.round(235 + (6 - 235) * t);
  return `rgb(${r},${g},${b})`;
}

function FolderMap({ files, arch }: { files: TreeFile[]; arch: Arch | undefined }): JSX.Element {
  const [prefix, setPrefix] = useState("");
  const [colorBy, setColorBy] = useState<"language" | "heat">("language");
  const [sizeBy, setSizeBy] = useState<"loc" | "uniform">("loc");
  const [sel, setSel] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 520 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const rects = useMemo(() => {
    const tree = buildTree(files, prefix, (f) =>
      sizeBy === "uniform" ? 1 : f.loc || Math.max(1, f.size / 40),
    );
    return layoutTreemap(tree, size.w, size.h);
  }, [files, prefix, sizeBy, size]);
  const info = (p: string) => files.filter((f) => f.path === p || f.path.startsWith(`${p}/`));
  const selected = sel ? info(sel) : [];
  const selFile = selected.length === 1 && selected[0]?.path === sel ? selected[0] : undefined;
  const entry = arch?.entryPoints.filter((e) => e.kind !== "script") ?? [];
  return (
    <div class="grid wide" style={{ alignItems: "start" }}>
      <div>
        <div class="row" style={{ marginBottom: 8 }}>
          <span class="row tight">
            <a onClick={() => setPrefix("")}>{arch?.project.name ?? "project"}</a>
            {prefix
              .split("/")
              .filter(Boolean)
              .map((seg, i, all) => (
                <>
                  <span class="muted">›</span>
                  <a onClick={() => setPrefix(all.slice(0, i + 1).join("/"))}>{seg}</a>
                </>
              ))}
          </span>
          <span class="spacer" />
          <span class="row tight">
            <button
              type="button"
              class={cls("chip", sizeBy === "loc" && "on")}
              onClick={() => setSizeBy("loc")}
            >
              size: loc
            </button>
            <button
              type="button"
              class={cls("chip", sizeBy === "uniform" && "on")}
              onClick={() => setSizeBy("uniform")}
            >
              uniform
            </button>
            <button
              type="button"
              class={cls("chip", colorBy === "language" && "on")}
              onClick={() => setColorBy("language")}
            >
              color: language
            </button>
            <button
              type="button"
              class={cls("chip", colorBy === "heat" && "on")}
              onClick={() => setColorBy("heat")}
            >
              heat
            </button>
          </span>
        </div>
        <div class="treemap" ref={box}>
          {rects.map((r: Rect) => {
            const f = r.node.data as TreeFile | undefined;
            const isDir = !!r.node.children?.length;
            const bg = f
              ? colorBy === "heat"
                ? heat(f.score)
                : (LANG_COLORS[f.language ?? "other"] ?? LANG_COLORS.other)
              : undefined;
            return (
              <div
                class={cls("cell", isDir && "dir", sel === r.node.path && "sel")}
                style={{
                  left: r.x,
                  top: r.y,
                  width: Math.max(0, r.w),
                  height: Math.max(0, r.h),
                  background: bg,
                }}
                title={
                  f
                    ? `${f.path} · ${f.loc} loc · ${f.symbols} symbols · heat ${f.score.toFixed(2)}`
                    : `${r.node.path} · ${r.node.size} loc`
                }
                onClick={(e) => {
                  e.stopPropagation();
                  setSel(r.node.path);
                }}
                onDblClick={(e) => {
                  e.stopPropagation();
                  if (isDir) setPrefix(r.node.path);
                  else if (f) navigate("explore", { file: f.path });
                }}
              >
                {isDir ? (
                  <span class="lbl">{r.node.name}/</span>
                ) : r.w > 50 && r.h > 14 ? (
                  r.node.name
                ) : (
                  ""
                )}
              </div>
            );
          })}
        </div>
        <div class="muted small" style={{ marginTop: 6 }}>
          Area is lines of code (or uniform). Double-click a folder to open it, a file to read it.
          Heat mixes fan-in, recent commits and complexity; it is a signal, not a grade.
        </div>
      </div>
      <div class="stack">
        <div class="card">
          <h3>{sel ?? "selection"}</h3>
          {selFile ? (
            <>
              <div class="row small">
                <Tag>{selFile.language ?? "?"}</Tag>
                <Tag>{selFile.loc} loc</Tag>
                <Tag>{selFile.symbols} symbols</Tag>
                <Tag>fan-in {selFile.fanIn}</Tag>
                <Tag>heat {selFile.score.toFixed(2)}</Tag>
                <Tag>{selFile.status}</Tag>
              </div>
              <div class="row" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  class="sm"
                  onClick={() => navigate("explore", { file: selFile.path })}
                >
                  Open source
                </button>
                <button
                  type="button"
                  class="sm"
                  onClick={() => navigate("galaxy", { node: `file:${selFile.path}` })}
                >
                  Galaxy
                </button>
              </div>
            </>
          ) : selected.length ? (
            <div class="row small">
              <Tag>{selected.length} files</Tag>
              <Tag>{fmt(selected.reduce((a, f) => a + f.loc, 0))} loc</Tag>
              <Tag>{selected.reduce((a, f) => a + f.symbols, 0)} symbols</Tag>
              <Tag>
                mean heat {(selected.reduce((a, f) => a + f.score, 0) / selected.length).toFixed(2)}
              </Tag>
            </div>
          ) : (
            <div class="muted small">Click a cell.</div>
          )}
        </div>
        <div class="card">
          <h3>entry points</h3>
          {entry.length ? (
            <table>
              <tbody>
                {entry.map((e) => (
                  <tr class="click" onClick={() => navigate("explore", { file: e.path })}>
                    <td>
                      <Tag>{e.kind}</Tag>
                    </td>
                    <td class="break">{e.name}</td>
                    <td class="muted small break">{e.path}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div class="muted small">none found</div>
          )}
        </div>
        {arch && (
          <div class="card">
            <h3>overview</h3>
            <div class="row small">
              <Tag>{arch.overview.files} files</Tag>
              <Tag>{arch.overview.symbols} symbols</Tag>
              <Tag>{arch.overview.edges} edges</Tag>
              {Object.entries(arch.overview.languages).map(([l, n]) => (
                <Tag>
                  {l} {n}
                </Tag>
              ))}
            </div>
            {arch.project.description ? (
              <div class="muted small" style={{ marginTop: 6 }}>
                {arch.project.description}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

// --- routes -------------------------------------------------------------------------

function Routes(): JSX.Element {
  const q = useAsync(() => api<RouteRow[]>("/api/routes"), []);
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <Spinner />;
  if (!q.data.length)
    return (
      <Empty>
        No routes detected. express/fastify/hono/koa registrations and Next.js route files are
        recognised.
      </Empty>
    );
  return (
    <div class="card flush">
      <table>
        <thead>
          <tr>
            <th>method</th>
            <th>path</th>
            <th>framework</th>
            <th>handler</th>
            <th>registered in</th>
          </tr>
        </thead>
        <tbody>
          {q.data.map((r) => (
            <tr>
              <td>
                <Tag>{r.method}</Tag>
              </td>
              <td class="mono">{r.path}</td>
              <td class="muted">{r.framework}</td>
              <td>
                {r.handlers.map((h) => (
                  <div>
                    <a
                      onClick={() =>
                        h.path
                          ? navigate("explore", { file: h.path, symbol: h.id })
                          : navigate("galaxy", { node: h.id })
                      }
                    >
                      {h.name}
                    </a>
                    {h.path ? <span class="muted small"> {h.path}</span> : null}
                  </div>
                ))}
              </td>
              <td class="muted small">
                <a
                  onClick={() =>
                    navigate("explore", { file: r.file, line: r.line ? String(r.line) : undefined })
                  }
                >
                  {r.file}
                  {r.line ? `:${r.line}` : ""}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- hotspots -----------------------------------------------------------------------

function Hotspots(): JSX.Element {
  const [kind, setKind] = useState<"file" | "symbol">("file");
  const [path, setPath] = useState("");
  const q = useAsync(
    () => api<Hotspot[]>("/api/hotspots", { kind, path: path.trim() || undefined, limit: 80 }),
    [kind, path],
  );
  const { sorted, th } = useSort(q.data, "score");
  const max = {
    fan_in: Math.max(1, ...sorted.map((h) => h.fan_in)),
    commits_90d: Math.max(1, ...sorted.map((h) => h.commits_90d)),
    complexity: Math.max(1, ...sorted.map((h) => h.complexity)),
  };
  return (
    <>
      <div class="row" style={{ marginBottom: 10 }}>
        <button
          type="button"
          class={cls("chip", kind === "file" && "on")}
          onClick={() => setKind("file")}
        >
          files
        </button>
        <button
          type="button"
          class={cls("chip", kind === "symbol" && "on")}
          onClick={() => setKind("symbol")}
        >
          functions and classes
        </button>
        <input
          type="text"
          placeholder="folder prefix, e.g. src/graph/"
          value={path}
          onInput={(e) => setPath((e.target as HTMLInputElement).value)}
          style={{ width: 260 }}
        />
        <span class="muted small">
          Score = 0.4·fan-in + 0.4·commits/90d + 0.2·complexity, log-scaled. A signal of where
          attention goes, not a quality grade.
        </span>
      </div>
      {q.error ? (
        <ErrorBox error={q.error} />
      ) : !q.data ? (
        <Spinner />
      ) : (
        <div class="card flush">
          <table>
            <thead>
              <tr>
                {th("path", kind === "file" ? "file" : "symbol")}
                {th("fan_in", "fan-in", true)}
                {th("commits_90d", "commits/90d", true)}
                {th("complexity", "complexity", true)}
                {th("loc", "loc", true)}
                {th("score", "score", true)}
                <th>last</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((h) => (
                <tr
                  class="click"
                  onClick={() =>
                    h.kind === "file"
                      ? navigate("explore", { file: h.path })
                      : navigate("explore", { file: h.path.split(" > ")[0]!, symbol: h.id })
                  }
                >
                  <td class="break">
                    {h.kind !== "file" ? <KindTag kind={h.kind} /> : null}
                    {h.path}
                  </td>
                  <td class="num">
                    <Bar value={h.fan_in} max={max.fan_in} width={60} /> {h.fan_in}
                  </td>
                  <td class="num">
                    <Bar value={h.commits_90d} max={max.commits_90d} width={60} /> {h.commits_90d}
                  </td>
                  <td class="num">
                    <Bar value={h.complexity} max={max.complexity} width={60} /> {h.complexity}
                  </td>
                  <td class="num">{h.loc}</td>
                  <td class="num">
                    <b>{h.score.toFixed(2)}</b>
                  </td>
                  <td class="muted small">{h.last_touched}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// --- structure: clusters and cycles ------------------------------------------------------

interface Clusters {
  clusters: ClusterSummary[];
  cycles: string[][];
  members: Record<string, Array<{ path: string; score: number; fanIn: number }>>;
}

function Structure(): JSX.Element {
  const q = useAsync(() => api<Clusters>("/api/clusters"), []);
  const [sel, setSel] = useState<string | null>(null);
  const [cycle, setCycle] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const graph = useMemo(() => {
    const d = q.data;
    if (!d) return { nodes: [] as VisNode[], edges: [] as VisEdge[] };
    const nodes: VisNode[] = [];
    const edges: VisEdge[] = [];
    if (cycle !== null) {
      const files = d.cycles[cycle] ?? [];
      for (const f of files)
        nodes.push({ id: `file:${f}`, label: f, kind: "file", path: f, line: null });
      for (let i = 0; i < files.length; i++)
        edges.push({
          src: `file:${files[i]}`,
          dst: `file:${files[(i + 1) % files.length]}`,
          kind: "imports",
          weight: 1,
        });
      return { nodes, edges };
    }
    for (const c of d.clusters) {
      if (expanded.has(c.id)) {
        for (const m of d.members[String(c.id)] ?? [])
          nodes.push({
            id: `file:${m.path}`,
            label: m.path,
            kind: "file",
            path: m.path,
            line: null,
            score: m.score,
          });
        // members link to their cluster hub through the hub node
      }
      nodes.push({
        id: `cluster:${c.id}`,
        label: `#${c.id} ${c.label} (${c.size})`,
        kind: "cluster",
        path: null,
        line: null,
      });
      if (expanded.has(c.id))
        for (const m of d.members[String(c.id)] ?? [])
          edges.push({ src: `file:${m.path}`, dst: `cluster:${c.id}`, kind: "link", weight: 0.5 });
      for (const [to, n] of Object.entries(c.links))
        edges.push({
          src: `cluster:${c.id}`,
          dst: `cluster:${to}`,
          kind: "imports",
          weight: Math.min(1, n / 10),
          count: n,
        });
    }
    return { nodes, edges };
  }, [q.data, cycle, expanded]);
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;
  if (!d) return <Spinner />;
  const selCluster = sel?.startsWith("cluster:")
    ? d.clusters.find((c) => String(c.id) === sel.slice(8))
    : undefined;
  return (
    <div class="grid wide" style={{ alignItems: "start" }}>
      <div class="card flush" style={{ height: 560 }}>
        {graph.nodes.length ? (
          <GraphCanvas
            nodes={graph.nodes}
            edges={graph.edges}
            selected={sel}
            onSelect={setSel}
            onActivate={(id) => {
              if (id.startsWith("cluster:")) {
                const n = Number(id.slice(8));
                setExpanded((s) => {
                  const next = new Set(s);
                  if (next.has(n)) next.delete(n);
                  else next.add(n);
                  return next;
                });
              } else if (id.startsWith("file:")) navigate("explore", { file: id.slice(5) });
            }}
          />
        ) : (
          <Empty>No clusters yet. Run a reindex.</Empty>
        )}
      </div>
      <div class="stack">
        <div class="card">
          <h3>clusters · {d.clusters.length}</h3>
          <div class="muted small" style={{ marginBottom: 6 }}>
            Connectivity groups from imports and co-change (label propagation). Double-click a
            cluster to expand its files; they are not proof of architectural boundaries.
          </div>
          <div class="list" style={{ maxHeight: 260 }}>
            {d.clusters.map((c) => (
              <div
                class={cls("item", sel === `cluster:${c.id}` && "sel")}
                onClick={() => {
                  setCycle(null);
                  setSel(`cluster:${c.id}`);
                }}
              >
                <div class="n">
                  #{c.id} {c.label} <span class="muted">· {c.size} files</span>
                </div>
                <div class="p">{c.files.slice(0, 3).join(", ")}</div>
              </div>
            ))}
          </div>
        </div>
        {selCluster && (
          <div class="card">
            <h3>cluster #{selCluster.id} members</h3>
            <div class="list" style={{ maxHeight: 220 }}>
              {(d.members[String(selCluster.id)] ?? []).map((m) => (
                <div class="item" onClick={() => navigate("explore", { file: m.path })}>
                  <div class="p">
                    {m.path} <span class="muted">· heat {m.score.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div class="card">
          <h3>import cycles · {d.cycles.length}</h3>
          {d.cycles.length ? (
            <div class="list" style={{ maxHeight: 220 }}>
              {d.cycles.map((c, i) => (
                <div
                  class={cls("item", cycle === i && "sel")}
                  onClick={() => {
                    setCycle(cycle === i ? null : i);
                    setSel(null);
                  }}
                >
                  <div class="p">
                    {c.length} files: {c.slice(0, 4).join(" → ")}
                    {c.length > 4 ? " …" : ""}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div class="muted small">none</div>
          )}
          {cycle !== null ? (
            <button
              type="button"
              class="sm"
              style={{ marginTop: 6 }}
              onClick={() => setCycle(null)}
            >
              show clusters
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// --- behavior: callee tree ---------------------------------------------------------------

interface BehaviorNode {
  root: VisNode & { endLine?: number | null; loc?: number; complexity?: number };
  callees: EdgeWithNode[];
}

function BehaviorTree({
  id,
  depth,
  onSelect,
  selected,
}: {
  id: string;
  depth: number;
  onSelect: (n: BehaviorNode) => void;
  selected: string | null;
}): JSX.Element {
  const q = useAsync(() => api<BehaviorNode>("/api/behavior", { id }), [id]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (q.error) return <div class="muted small">{q.error}</div>;
  if (!q.data) return <Spinner />;
  const d = q.data;
  return (
    <>
      {depth === 0 && (
        <div class={cls("bnode", selected === d.root.id && "sel")} onClick={() => onSelect(d)}>
          <Tag>start</Tag>
          <KindTag kind={d.root.kind} />
          <b>{d.root.label}</b>
          <span class="muted small">{d.root.path}</span>
        </div>
      )}
      <div class="kids">
        {d.callees.length ? (
          d.callees.map((c) => {
            const isOpen = open.has(c.node.id);
            return (
              <>
                <div
                  class={cls("bnode", selected === c.node.id && "sel")}
                  onClick={() => onSelect({ root: c.node, callees: [] })}
                >
                  <span
                    class="arrow"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen((s) => {
                        const n = new Set(s);
                        if (n.has(c.node.id)) n.delete(c.node.id);
                        else n.add(c.node.id);
                        return n;
                      });
                    }}
                  >
                    {c.node.kind === "package" || c.node.kind === "route"
                      ? "·"
                      : isOpen
                        ? "▾"
                        : "▸"}
                  </span>
                  <Tag>{c.kind === "handles" ? "handles" : "possible call"}</Tag>
                  <KindTag kind={c.node.kind} />
                  <span>{c.node.label}</span>
                  <span class="muted small">
                    {c.lines?.length ? `L${c.lines.join(", L")}` : ""}
                    {c.count && c.count > 1 ? ` ×${c.count}` : ""}
                  </span>
                </div>
                {isOpen && depth < 6 ? (
                  <BehaviorTree
                    id={c.node.id}
                    depth={depth + 1}
                    onSelect={onSelect}
                    selected={selected}
                  />
                ) : null}
              </>
            );
          })
        ) : (
          <div class="muted small" style={{ padding: "2px 6px" }}>
            no resolved calls
          </div>
        )}
      </div>
    </>
  );
}

function Behavior({ params }: { params: Record<string, string> }): JSX.Element {
  const [start, setStart] = useState<string | null>(params.node ?? null);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<VisNode[]>([]);
  const [sel, setSel] = useState<BehaviorNode | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) return setRows([]);
    const t = setTimeout(() => {
      api<VisNode[]>("/api/nodes/search", { q: q.trim(), limit: 10 })
        .then((r) => setRows(r.filter((n) => n.kind !== "file" && n.kind !== "package")))
        .catch(() => setRows([]));
    }, 180);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div class="grid wide" style={{ alignItems: "start" }}>
      <div class="card">
        <div class="row" style={{ marginBottom: 10, position: "relative" }}>
          <span class="muted small">Start</span>
          <input
            type="text"
            placeholder="function or method…"
            value={q}
            onInput={(e) => setQ((e.target as HTMLInputElement).value)}
            style={{ width: 320 }}
          />
          {rows.length > 0 && (
            <div class="suggest" style={{ top: 36, left: 40 }}>
              {rows.map((r) => (
                <div
                  onMouseDown={() => {
                    setStart(r.id);
                    setQ("");
                    setRows([]);
                    setSel(null);
                  }}
                >
                  <KindTag kind={r.kind} />
                  <span class="ellipsis">{r.label}</span>
                  <span class="path">{r.path}</span>
                </div>
              ))}
            </div>
          )}
          <span class="muted small">
            Branches are possible static calls from the index, not an execution order.
          </span>
        </div>
        <div class="btree">
          {start ? (
            <BehaviorTree id={start} depth={0} onSelect={setSel} selected={sel?.root.id ?? null} />
          ) : (
            <Empty>Choose a starting operation.</Empty>
          )}
        </div>
      </div>
      <div class="card">
        <h3>{sel ? "selected operation" : "starting operation"}</h3>
        {sel ? (
          <>
            <div class="row tight">
              <KindTag kind={sel.root.kind} />
              <b class="break">{sel.root.label}</b>
            </div>
            <div class="muted small">
              {sel.root.path}
              {sel.root.line ? `:${sel.root.line}` : ""}
              {sel.root.endLine ? `–${sel.root.endLine}` : ""}
            </div>
            {sel.root.complexity ? (
              <div class="row small" style={{ marginTop: 6 }}>
                <Tag>complexity {sel.root.complexity}</Tag>
                <Tag>{sel.root.loc} loc</Tag>
              </div>
            ) : null}
            <div class="row" style={{ marginTop: 8 }}>
              {sel.root.path ? (
                <button
                  type="button"
                  class="sm"
                  onClick={() =>
                    navigate("explore", {
                      file: sel.root.path!,
                      line: sel.root.line ? String(sel.root.line) : undefined,
                      symbol: sel.root.id,
                    })
                  }
                >
                  Open definition
                </button>
              ) : null}
              <button
                type="button"
                class="sm"
                onClick={() => {
                  setStart(sel.root.id);
                  setSel(null);
                }}
              >
                Start here
              </button>
              <button
                type="button"
                class="sm"
                onClick={() => navigate("galaxy", { node: sel.root.id })}
              >
                Galaxy
              </button>
            </div>
          </>
        ) : (
          <div class="muted small">Click an operation in the tree.</div>
        )}
      </div>
    </div>
  );
}

// --- view -------------------------------------------------------------------------------

export function Architecture({ params }: { params: Record<string, string> }): JSX.Element {
  const [tab, setTab] = useState<Tab>((params.tab as Tab) || "overview");
  useEffect(() => {
    if (params.tab) setTab(params.tab as Tab);
  }, [params.tab]);
  const tree = useAsync(() => api<{ files: TreeFile[] }>("/api/tree"), []);
  const arch = useAsync(
    () => api<Arch>("/api/architecture", { aspects: "overview,entry_points" }),
    [],
  );
  return (
    <div class="page">
      <SubTabs
        tabs={[
          ["overview", "Overview"],
          ["routes", "Routes"],
          ["hotspots", "Hotspots"],
          ["structure", "System structure"],
          ["behavior", "Behavior"],
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "overview" &&
        (tree.data ? (
          <FolderMap files={tree.data.files} arch={arch.data} />
        ) : tree.error ? (
          <ErrorBox error={tree.error} />
        ) : (
          <Spinner />
        ))}
      {tab === "routes" && <Routes />}
      {tab === "hotspots" && <Hotspots />}
      {tab === "structure" && <Structure />}
      {tab === "behavior" && <Behavior params={params} />}
    </div>
  );
}

export { color };
