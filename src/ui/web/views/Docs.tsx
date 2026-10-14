import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  api,
  type DiscoveryUi,
  type DocPage,
  type DocSourceUi,
  type DocsAddResult,
  type DocsList,
  del,
  post,
  type SearchHitUi,
} from "../api.js";
import { Empty, ErrorBox, KV, Spinner, SubTabs, toast, useAsync } from "../components.js";
import { navigate } from "../router.js";
import { ago, cls, day, fmt } from "../util.js";

const KIND_COLORS: Record<string, string> = { url: "#2563eb", path: "#16a34a" };
const CONF_COLORS: Record<string, string> = {
  catalog: "#16a34a",
  probe: "#2563eb",
  registry: "#d97706",
  unknown: "#6b7280",
};

function KindTag({ kind }: { kind: string }): JSX.Element {
  return (
    <span class="tag kind" style={{ color: KIND_COLORS[kind] ?? "#6b7280" }}>
      {kind}
    </span>
  );
}

function Links({ urls }: { urls: string[] }): JSX.Element {
  return (
    <span class="break">
      {urls.map((u, i) => (
        <>
          {i ? ", " : ""}
          <a href={u} target="_blank" rel="noreferrer">
            {u}
          </a>
        </>
      ))}
    </span>
  );
}

// --- sources --------------------------------------------------------------------------

function SourceDetail({
  s,
  busy,
  onSync,
  onRemove,
}: {
  s: DocSourceUi;
  busy: string | null;
  onSync: (force: boolean) => void;
  onRemove: () => void;
}): JSX.Element {
  const pages = useAsync(
    () => api<DocPage[]>("/api/docs/pages", { name: s.name }),
    [s.name, s.sync?.at],
  );
  const rows: Array<[string, JSX.Element | string]> = [
    ["kind", <KindTag kind={s.kind} />],
    ...(s.provider ? ([["provider", s.provider]] as Array<[string, string]>) : []),
    ...(s.title ? ([["title", s.title]] as Array<[string, string]>) : []),
    s.kind === "url"
      ? ["seeds", <Links urls={s.urls ?? []} />]
      : ["path", `${s.path}${s.glob?.length ? `  [${s.glob.join(", ")}]` : ""}`],
    ...(s.kind === "url"
      ? ([
          [
            "crawl",
            `depth ${s.crawl?.depth ?? "default"}, max ${s.crawl?.maxPages ?? "default"} pages, ttl ${s.ttlHours ?? "default"} h`,
          ],
        ] as Array<[string, string]>)
      : []),
    ...(s.tags?.length ? ([["tags", s.tags.join(", ")]] as Array<[string, string]>) : []),
    ["added", s.addedAt.slice(0, 10)],
    [
      "last sync",
      s.sync
        ? `${ago(s.sync.at)} · ${s.sync.pages} ${s.kind === "url" ? "pages" : "files"} · ${s.sync.documents} docs · ${s.sync.chunks} chunks · ${s.sync.ms} ms${s.sync.errors.length ? ` · ${s.sync.errors.length} error(s)` : ""}`
        : "never",
    ],
  ];
  return (
    <div>
      <div class="row" style={{ marginBottom: 6 }}>
        <b class="grow break">{s.name}</b>
        <button type="button" class="sm" disabled={!!busy} onClick={() => onSync(false)}>
          {busy === `sync ${s.name}` ? <Spinner /> : "sync"}
        </button>
        <button
          type="button"
          class="sm"
          disabled={!!busy}
          title="refetch ignoring the cache and drop stale pages"
          onClick={() => onSync(true)}
        >
          force
        </button>
        <button type="button" class="sm danger" disabled={!!busy} onClick={onRemove}>
          remove
        </button>
      </div>
      <KV rows={rows} />
      {s.sync?.errors.length ? (
        <pre class="log" style={{ marginTop: 8 }}>
          {s.sync.errors.join("\n")}
        </pre>
      ) : null}
      <h3 style={{ marginTop: 12 }}>
        indexed pages <span class="muted small">({s.documents})</span>
      </h3>
      {pages.error ? (
        <ErrorBox error={pages.error} />
      ) : !pages.data ? (
        <Spinner />
      ) : pages.data.length ? (
        <table>
          <thead>
            <tr>
              <th>title</th>
              <th class="num">chunks</th>
              <th>indexed</th>
            </tr>
          </thead>
          <tbody>
            {pages.data.map((p) => (
              <tr>
                <td class="break">
                  {p.uri?.startsWith("http") ? (
                    <a href={p.uri} target="_blank" rel="noreferrer">
                      {p.title}
                    </a>
                  ) : (
                    p.title
                  )}
                </td>
                <td class="num">{p.chunks}</td>
                <td class="muted nowrap">{day(p.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty>nothing indexed yet — run sync</Empty>
      )}
    </div>
  );
}

function AddForm({ onDone }: { onDone: (r: DocsAddResult) => void }): JSX.Element {
  const [name, setName] = useState("");
  const [urls, setUrls] = useState("");
  const [path, setPath] = useState("");
  const [glob, setGlob] = useState("");
  const [provider, setProvider] = useState("");
  const [depth, setDepth] = useState("");
  const [max, setMax] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const list = urls
      .split(/\s+/)
      .map((u) => u.trim())
      .filter(Boolean);
    if (!list.length && !path.trim() && !provider.trim())
      return toast("give a url, a path or a provider", true);
    setBusy(true);
    try {
      const r = await post<DocsAddResult>("/api/docs", {
        sources: [
          {
            name: name.trim() || undefined,
            urls: list.length ? list : undefined,
            path: path.trim() || undefined,
            glob: glob.trim()
              ? glob
                  .split(",")
                  .map((g) => g.trim())
                  .filter(Boolean)
              : undefined,
            provider: provider.trim() || undefined,
            crawl:
              depth || max
                ? {
                    depth: depth ? Number(depth) : undefined,
                    maxPages: max ? Number(max) : undefined,
                  }
                : undefined,
            tags: tags.trim()
              ? tags
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean)
              : undefined,
          },
        ],
        sync: true,
      });
      toast(
        r.failed.length ? r.failed[0]!.reason : `added ${[...r.added, ...r.updated].join(", ")}`,
        !!r.failed.length,
      );
      onDone(r);
      if (!r.failed.length) {
        setName("");
        setUrls("");
        setPath("");
        setGlob("");
        setProvider("");
      }
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="card">
      <h3>add a source</h3>
      <div class="grid" style={{ gridTemplateColumns: "1fr 2fr 1fr", gap: 8 }}>
        <div class="field">
          <label>name (optional)</label>
          <input
            type="text"
            placeholder="moleculer"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="field">
          <label>url(s) — one per line; same-origin pages under each are crawled</label>
          <textarea
            rows={2}
            placeholder="https://moleculer.services/docs/0.14/"
            value={urls}
            onInput={(e) => setUrls((e.target as HTMLTextAreaElement).value)}
          />
        </div>
        <div class="field">
          <label>or provider (npm:zod, pypi:fastapi, api:api.example.com)</label>
          <input
            type="text"
            value={provider}
            onInput={(e) => setProvider((e.target as HTMLInputElement).value)}
          />
        </div>
      </div>
      <div class="grid" style={{ gridTemplateColumns: "2fr 2fr 1fr 1fr 2fr", gap: 8 }}>
        <div class="field">
          <label>or local path</label>
          <input
            type="text"
            placeholder="docs/"
            value={path}
            onInput={(e) => setPath((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="field">
          <label>globs (comma separated)</label>
          <input
            type="text"
            placeholder="**/*.md"
            value={glob}
            onInput={(e) => setGlob((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="field">
          <label>crawl depth</label>
          <input
            type="number"
            min={0}
            max={3}
            value={depth}
            onInput={(e) => setDepth((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="field">
          <label>max pages</label>
          <input
            type="number"
            min={1}
            max={200}
            value={max}
            onInput={(e) => setMax((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="field">
          <label>tags</label>
          <input
            type="text"
            value={tags}
            onInput={(e) => setTags((e.target as HTMLInputElement).value)}
          />
        </div>
      </div>
      <div class="row">
        <button type="button" class="primary" disabled={busy} onClick={submit}>
          {busy ? <Spinner /> : "Add & index"}
        </button>
      </div>
    </div>
  );
}

function Sources({
  params,
  onLog,
}: {
  params: Record<string, string>;
  onLog: (s: string) => void;
}): JSX.Element {
  const q = useAsync(() => api<DocsList>("/api/docs"), []);
  const [sel, setSel] = useState<string | null>(params.name ?? null);
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (params.name) setSel(params.name);
  }, [params.name]);
  const d = q.data;
  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (d?.sources ?? []).filter(
      (s) =>
        !f ||
        s.name.includes(f) ||
        (s.provider ?? "").includes(f) ||
        (s.tags ?? []).some((t) => t.includes(f)) ||
        (s.urls ?? []).some((u) => u.includes(f)) ||
        (s.path ?? "").includes(f),
    );
  }, [d, filter]);
  const current = rows.find((s) => s.name === sel) ?? d?.sources.find((s) => s.name === sel);
  const sync = async (names: string[] | undefined, force: boolean) => {
    const label = names?.length === 1 ? `sync ${names[0]}` : "sync all";
    setBusy(label);
    try {
      const r = await post<{ text: string }>("/api/docs/sync", { names, force });
      onLog(r.text);
      toast(`${label} done`);
      q.reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  };
  const remove = async (name: string) => {
    if (!confirm(`Remove documentation source "${name}" and its indexed pages?`)) return;
    try {
      const r = await del<{ removed: boolean; documents: number }>("/api/docs", { name });
      toast(`removed ${name} (${r.documents} document(s))`);
      setSel(null);
      q.reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  if (q.error) return <ErrorBox error={q.error} />;
  return (
    <>
      <div class="row" style={{ marginBottom: 12 }}>
        <button type="button" class="primary" onClick={() => setAdding((a) => !a)}>
          {adding ? "close" : "+ Add source"}
        </button>
        <button
          type="button"
          disabled={!!busy || !d?.sources.length}
          onClick={() => sync(undefined, false)}
        >
          {busy === "sync all" ? <Spinner /> : "↻ Sync all"}
        </button>
        <input
          type="search"
          class="grow"
          placeholder="filter by name, provider, tag or url…"
          value={filter}
          onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
        />
        <span class="muted small nowrap">
          {d
            ? `${d.sources.length} sources · ${fmt(d.totals.documents)} docs · ${fmt(d.totals.chunks)} chunks · ${d.manifest}`
            : ""}
        </span>
      </div>
      {adding && (
        <AddForm
          onDone={(r) => {
            onLog(r.text);
            q.reload();
            const n = [...r.added, ...r.updated][0];
            if (n) setSel(n);
          }}
        />
      )}
      {d?.orphans.length ? (
        <div class="empty" style={{ marginBottom: 12 }}>
          indexed under docs: but missing from the manifest:{" "}
          {d.orphans.map((o) => `${o.source} (${o.documents})`).join(", ")} — re-add them or purge
          the index.
        </div>
      ) : null}
      <div
        class="grid wide"
        style={{ gridTemplateColumns: "minmax(280px,1fr) minmax(0,2fr)", alignItems: "start" }}
      >
        <div class="card flush">
          <div class="list">
            {!d ? (
              <Empty>
                <Spinner />
              </Empty>
            ) : rows.length ? (
              rows.map((s) => (
                <div class={cls("item", sel === s.name && "sel")} onClick={() => setSel(s.name)}>
                  <div class="n">{s.name}</div>
                  <div class="p">
                    <KindTag kind={s.kind} />
                    {s.provider ? <span class="muted">{s.provider}</span> : null}
                  </div>
                  <div class="p">
                    <span class="muted">
                      {s.documents} docs · {s.chunks} chunks ·{" "}
                      {s.sync ? `synced ${ago(s.sync.at)}` : "never synced"}
                      {s.sync?.errors.length ? (
                        <span class="bad"> · {s.sync.errors.length} errors</span>
                      ) : null}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <Empty>
                {d.sources.length
                  ? "no sources match"
                  : "No documentation sources yet. Use Discover, or add a url, path or provider."}
              </Empty>
            )}
          </div>
        </div>
        <div class="card">
          {current ? (
            <SourceDetail
              s={current}
              busy={busy}
              onSync={(force) => sync([current.name], force)}
              onRemove={() => remove(current.name)}
            />
          ) : (
            <Empty>Select a source to see its pages and sync state.</Empty>
          )}
        </div>
      </div>
    </>
  );
}

// --- discover -------------------------------------------------------------------------

function Discover({
  onLog,
  onAdded,
}: {
  onLog: (s: string) => void;
  onAdded: () => void;
}): JSX.Element {
  const [dev, setDev] = useState(false);
  const [ran, setRan] = useState(false);
  const q = useAsync(
    () =>
      ran
        ? api<DiscoveryUi>("/api/docs/discover", { dev: dev ? 1 : undefined })
        : Promise.resolve(undefined),
    [ran, dev],
  );
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const d = q.data;
  useEffect(() => {
    if (!d) return;
    const def = new Set<string>();
    for (const c of d.local) if (!c.registered) def.add(`local:${c.name}`);
    for (const p of d.providers)
      if (
        !p.registered &&
        (p.confidence === "probe" ||
          (p.confidence === "catalog" && p.tier !== "library" && p.tier !== "infra"))
      )
        def.add(`prov:${p.name}`);
    setPicked(def);
  }, [d]);
  const toggle = (key: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const addSelected = async () => {
    if (!d) return;
    const sources: unknown[] = [];
    for (const c of d.local)
      if (picked.has(`local:${c.name}`))
        sources.push({
          name: c.name,
          path: c.path,
          glob: c.glob,
          title: c.why,
          tags: c.project ? [c.project] : undefined,
        });
    for (const p of d.providers) {
      if (!picked.has(`prov:${p.name}`)) continue;
      const manual = urls[p.name]?.trim();
      const list = manual
        ? manual.split(/\s+/).filter(Boolean)
        : p.urls.length
          ? p.urls
          : undefined;
      if (!list && p.confidence === "unknown") continue;
      sources.push({
        name: p.name,
        provider: p.provider,
        urls: list,
        title: p.title,
        crawl: p.crawl,
      });
    }
    if (!sources.length) return toast("nothing selected", true);
    setBusy(true);
    onLog(`adding ${sources.length} source(s)…`);
    try {
      const r = await post<DocsAddResult>("/api/docs", { sources, sync: true });
      onLog(r.text);
      toast(
        `${r.added.length + r.updated.length} added${r.failed.length ? `, ${r.failed.length} failed` : ""}`,
        !!r.failed.length && !r.added.length,
      );
      onAdded();
      setRan(false);
      setTimeout(() => setRan(true), 0);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const group = (conf: string) => (d?.providers ?? []).filter((p) => p.confidence === conf);
  const Row = ({
    keyId,
    title,
    meta,
    right,
    registered,
  }: {
    keyId: string;
    title: JSX.Element | string;
    meta: JSX.Element | string;
    right?: JSX.Element | undefined;
    registered: boolean;
  }) => (
    <tr class={cls(registered && "muted")}>
      <td style={{ width: 24 }}>
        <input
          type="checkbox"
          disabled={registered}
          checked={picked.has(keyId)}
          onChange={() => toggle(keyId)}
        />
      </td>
      <td class="break">
        {title}
        {registered ? <span class="tag"> registered</span> : null}
      </td>
      <td class="break muted small">{meta}</td>
      <td>{right ?? null}</td>
    </tr>
  );
  const ProviderTable = ({ conf, note }: { conf: string; note: string }) => {
    const list = group(conf);
    if (!list.length) return null;
    return (
      <div class="card flush" style={{ marginBottom: 12 }}>
        <h3 style={{ padding: "10px 12px 0" }}>
          <span class="tag kind" style={{ color: CONF_COLORS[conf] }}>
            {conf}
          </span>{" "}
          {conf === "catalog"
            ? "libraries, services and infrastructure"
            : conf === "probe"
              ? "third-party APIs called from code"
              : conf === "registry"
                ? "packages resolved through npm / PyPI / Go"
                : "unknown env prefixes and images"}{" "}
          <span class="muted small">— {note}</span>
        </h3>
        <table>
          <tbody>
            {list.map((p) => (
              <Row
                keyId={`prov:${p.name}`}
                registered={p.registered}
                title={
                  <>
                    <b>{p.name}</b> <span class="muted small">← {p.provider}</span>
                  </>
                }
                meta={
                  <>
                    {p.title}
                    {p.usedBy.length > 1
                      ? ` · used by ${p.usedBy.length} projects`
                      : p.usedBy[0] && p.usedBy[0] !== "."
                        ? ` · ${p.usedBy[0]}`
                        : ""}
                    {p.urls.length ? (
                      <>
                        {" · "}
                        <Links urls={p.urls.slice(0, 2)} />
                      </>
                    ) : conf === "probe" || conf === "unknown" ? (
                      ` · ${p.evidence[0]}`
                    ) : (
                      ""
                    )}
                  </>
                }
                right={
                  conf === "unknown" || conf === "probe" ? (
                    <input
                      type="text"
                      placeholder={
                        conf === "probe" ? "docs url (optional; probed if empty)" : "docs url"
                      }
                      style={{ minWidth: 220 }}
                      value={urls[p.name] ?? ""}
                      onInput={(e) =>
                        setUrls({ ...urls, [p.name]: (e.target as HTMLInputElement).value })
                      }
                    />
                  ) : undefined
                }
              />
            ))}
          </tbody>
        </table>
      </div>
    );
  };
  return (
    <>
      <div class="row" style={{ marginBottom: 12 }}>
        <button
          type="button"
          class="primary"
          disabled={q.loading && ran}
          onClick={() => (ran ? q.reload() : setRan(true))}
        >
          {q.loading && ran ? <Spinner /> : ran ? "↻ Scan again" : "Scan project"}
        </button>
        <label class="small">
          <input
            type="checkbox"
            checked={dev}
            onChange={(e) => setDev((e.target as HTMLInputElement).checked)}
          />{" "}
          include devDependencies
        </label>
        <span class="spacer" />
        {d ? (
          <>
            <span class="muted small">
              {d.projects.length > 1 ? `${d.projects.length} projects · ` : ""}
              {d.local.length} local · {d.providers.length} providers · {picked.size} selected
            </span>
            <button
              type="button"
              class="primary"
              disabled={busy || !picked.size}
              onClick={addSelected}
            >
              {busy ? <Spinner /> : "Add selected & index"}
            </button>
          </>
        ) : null}
      </div>
      {q.error ? <ErrorBox error={q.error} /> : null}
      {!ran ? (
        <Empty>
          Scans the project (and one level of sub-projects) for READMEs, docs folders, ADRs, API
          specs, agent instructions and env references, plus the npm / PyPI / Go packages, env var
          prefixes, container images, infrastructure files and outbound API calls — and maps each to
          its documentation. Nothing is fetched until you add.
        </Empty>
      ) : !d ? (
        <Spinner />
      ) : (
        <>
          {d.local.length ? (
            <div class="card flush" style={{ marginBottom: 12 }}>
              <h3 style={{ padding: "10px 12px 0" }}>
                local documentation <span class="muted small">— indexed from the working tree</span>
              </h3>
              <table>
                <tbody>
                  {d.local.map((c) => (
                    <Row
                      keyId={`local:${c.name}`}
                      registered={c.registered}
                      title={
                        <>
                          <b>{c.name}</b> <span class="muted small">{c.path}</span>
                        </>
                      }
                      meta={`${c.files} file(s) · ${fmt(c.bytes)} B · ${c.why}${c.glob && c.glob.length <= 4 ? ` · ${c.glob.join(", ")}` : ""}`}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <ProviderTable conf="catalog" note="documentation URLs known offline" />
          <ProviderTable
            conf="probe"
            note="docs., developer. and /docs locations are probed when added; give a url to skip the guess"
          />
          <ProviderTable
            conf="registry"
            note="homepage and README come from the package registry when added"
          />
          <ProviderTable conf="unknown" note="needs a documentation url" />
        </>
      )}
    </>
  );
}

// --- search ---------------------------------------------------------------------------

function DocsSearch({ sources }: { sources: string[] }): JSX.Element {
  const [q, setQ] = useState("");
  const [src, setSrc] = useState("");
  const [run, setRun] = useState("");
  const r = useAsync(
    () =>
      run
        ? api<{ hits: SearchHitUi[]; corrections: Array<{ from: string; to: string }> }>(
            "/api/search",
            {
              q: run,
              source: src ? `docs:${src}` : "docs:*",
              limit: 15,
            },
          )
        : Promise.resolve(undefined),
    [run, src],
  );
  return (
    <>
      <div class="row" style={{ marginBottom: 12 }}>
        <input
          type="search"
          class="grow"
          placeholder="ask the documentation… (hybrid keyword + semantic)"
          value={q}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setRun(q.trim());
          }}
        />
        <select value={src} onChange={(e) => setSrc((e.target as HTMLSelectElement).value)}>
          <option value="">all documentation</option>
          {sources.map((s) => (
            <option value={s}>{s}</option>
          ))}
        </select>
        <button type="button" class="primary" onClick={() => setRun(q.trim())}>
          Search
        </button>
      </div>
      {r.error ? <ErrorBox error={r.error} /> : null}
      {!run ? (
        <Empty>
          Searches only the documentation sources (source docs:*). Claude uses the same index
          through em_docs lookup.
        </Empty>
      ) : !r.data ? (
        <Spinner />
      ) : r.data.hits.length ? (
        <div class="stack">
          {r.data.corrections.length ? (
            <div class="muted small">
              corrected: {r.data.corrections.map((c) => `${c.from}→${c.to}`).join(", ")}
            </div>
          ) : null}
          {r.data.hits.map((h) => (
            <div class="card hit">
              <div class="row tight">
                <b class="break">
                  {h.uri?.startsWith("http") ? (
                    <a href={h.uri} target="_blank" rel="noreferrer">
                      {h.title}
                    </a>
                  ) : (
                    h.title
                  )}
                </b>
                <span class="tag">{h.source.replace(/^docs:/, "")}</span>
                <span class="muted small">
                  doc {h.doc} · {h.score.toFixed(3)}
                </span>
              </div>
              <pre
                class="json"
                style={{
                  whiteSpace: "pre-wrap",
                  fontFamily: "inherit",
                  fontSize: 13,
                  marginTop: 4,
                }}
              >
                {h.snippet}
              </pre>
            </div>
          ))}
        </div>
      ) : (
        <Empty>no matches</Empty>
      )}
    </>
  );
}

// --- view -----------------------------------------------------------------------------

export function Docs({ params }: { params: Record<string, string> }): JSX.Element {
  const [tab, setTab] = useState<string>(params.tab ?? "sources");
  const [log, setLog] = useState<string[]>([]);
  const [tick, setTick] = useState(0);
  const list = useAsync(() => api<DocsList>("/api/docs"), [tick]);
  const onLog = (s: string) => setLog((l) => [...l, `[${new Date().toLocaleTimeString()}]\n${s}`]);
  return (
    <div class="page">
      <SubTabs
        tabs={[
          ["sources", "Sources"],
          ["discover", "Discover"],
          ["search", "Search"],
        ]}
        value={tab}
        onChange={(t) => {
          setTab(t);
          navigate("docs", { tab: t });
        }}
      />
      {tab === "sources" && <Sources params={params} onLog={onLog} key={tick} />}
      {tab === "discover" && <Discover onLog={onLog} onAdded={() => setTick((x) => x + 1)} />}
      {tab === "search" && <DocsSearch sources={(list.data?.sources ?? []).map((s) => s.name)} />}
      {log.length ? (
        <div class="card" style={{ marginTop: 12 }}>
          <h3>
            sync log{" "}
            <button type="button" class="sm right" onClick={() => setLog([])}>
              clear
            </button>
          </h3>
          <pre class="log">{log.join("\n\n")}</pre>
        </div>
      ) : null}
    </div>
  );
}
