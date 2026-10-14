import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { api, del, type MemoryBody, type MemoryList, type MemoryRowUi, post } from "../api.js";
import { Empty, ErrorBox, Spinner, SubTabs, Tag, toast, useAsync } from "../components.js";
import { navigate } from "../router.js";
import { cls, day, fmt } from "../util.js";

const KIND_COLORS: Record<string, string> = {
  decision: "#7c3aed",
  constraint: "#dc2626",
  fact: "#2563eb",
  preference: "#0d9488",
  todo: "#d97706",
  note: "#6b7280",
  onboarding: "#16a34a",
};

function MemTag({ m }: { m: { kind: string; status?: string | null } }): JSX.Element {
  return (
    <>
      <span class="tag kind" style={{ color: KIND_COLORS[m.kind] ?? "#6b7280" }}>
        {m.kind}
      </span>
      {m.status && m.status !== "accepted" ? (
        <span class={`tag s-${m.status}`}>{m.status}</span>
      ) : null}
    </>
  );
}

interface Form {
  kind: string;
  tags: string;
  related: string;
  body: string;
  name: string;
  status: string;
  supersedes: string;
}

function Editor({
  name,
  kinds,
  statuses,
  onSaved,
  onDeleted,
}: {
  name: string | null;
  kinds: string[];
  statuses: string[];
  onSaved: (name: string) => void;
  onDeleted: () => void;
}): JSX.Element {
  const body = useAsync(
    () => (name ? api<MemoryBody>("/api/memories", { name }) : Promise.resolve(undefined)),
    [name],
  );
  const [f, setF] = useState<Form>({
    kind: "fact",
    tags: "",
    related: "",
    body: "",
    name: "",
    status: "",
    supersedes: "",
  });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const m = body.data;
    if (name && m)
      setF({
        kind: m.kind,
        tags: m.tags.join(", "),
        related: m.related.join(", "),
        body: m.body,
        name: m.name,
        status: m.status ?? "",
        supersedes: m.supersedes ?? "",
      });
    if (!name)
      setF({ kind: "fact", tags: "", related: "", body: "", name: "", status: "", supersedes: "" });
  }, [name, body.data]);
  const set = (k: keyof Form) => (e: Event) =>
    setF({ ...f, [k]: (e.target as HTMLInputElement).value });
  const save = async () => {
    if (!f.body.trim()) return toast("body required", true);
    setBusy(true);
    try {
      const payload = {
        kind: f.kind,
        content: f.body,
        tags: f.tags,
        related: f.related,
        status: f.status || undefined,
        supersedes: f.supersedes || undefined,
      };
      const r = name
        ? await post<{ name: string; superseded?: string }>("/api/memories", payload, "PUT", {
            name,
          })
        : await post<{ name: string; superseded?: string }>("/api/memories", {
            ...payload,
            name: f.name.trim() || undefined,
          });
      toast(
        `${name ? "saved" : "created"} ${r.name}${r.superseded ? ` · ${r.superseded} marked superseded` : ""}`,
      );
      onSaved(r.name);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!name || !confirm(`Delete memory "${name}" and its file?`)) return;
    try {
      await del("/api/memories", { name });
      toast(`deleted ${name}`);
      onDeleted();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const rename = async () => {
    if (!name) return;
    const to = prompt("New name (topic/slug):", name);
    if (!to || to === name) return;
    try {
      const r = await post<{ name: string; refsUpdated: number }>(
        "/api/memories",
        { to },
        "PATCH",
        { name },
      );
      toast(`renamed → ${r.name}${r.refsUpdated ? ` (${r.refsUpdated} references updated)` : ""}`);
      onSaved(r.name);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  if (name && body.error) return <ErrorBox error={body.error} />;
  if (name && !body.data) return <Spinner />;
  const m = body.data;
  const isDecision = f.kind === "decision";
  return (
    <div>
      <div class="row" style={{ marginBottom: 6 }}>
        <b class="grow break">{name ?? "New memory"}</b>
        {name ? (
          <>
            <button type="button" class="sm" onClick={rename}>
              rename
            </button>
            <button type="button" class="sm danger" onClick={remove}>
              delete
            </button>
          </>
        ) : null}
      </div>
      {name && m ? (
        <div class="muted small" style={{ marginBottom: 8 }}>
          {m.path} · created {m.created.slice(0, 10)} · updated {m.updated.slice(0, 10)}
        </div>
      ) : (
        <div class="field">
          <label>name (topic/slug, optional — derived from kind + content)</label>
          <input
            type="text"
            placeholder="auth/session-tokens"
            value={f.name}
            onInput={set("name")}
          />
        </div>
      )}
      <div
        class="grid"
        style={{
          gridTemplateColumns: isDecision ? "1fr 1fr 2fr 2fr" : "1fr 2fr 2fr",
          gap: 8,
          marginBottom: 0,
        }}
      >
        <div class="field">
          <label>kind</label>
          <select value={f.kind} onChange={set("kind")}>
            {kinds.map((k) => (
              <option value={k}>{k}</option>
            ))}
          </select>
        </div>
        {isDecision && (
          <div class="field">
            <label>status</label>
            <select value={f.status} onChange={set("status")}>
              <option value="">accepted (default)</option>
              {statuses.map((s) => (
                <option value={s}>{s}</option>
              ))}
            </select>
          </div>
        )}
        <div class="field">
          <label>tags (comma separated)</label>
          <input type="text" value={f.tags} onInput={set("tags")} />
        </div>
        <div class="field">
          <label>related (file:path, sym:path#Name, mem:name)</label>
          <input type="text" value={f.related} onInput={set("related")} />
        </div>
      </div>
      {isDecision && (
        <div class="field">
          <label>
            supersedes (name of the decision this replaces; it is marked superseded on save)
          </label>
          <input
            type="text"
            placeholder="decision/old-approach"
            value={f.supersedes}
            onInput={set("supersedes")}
          />
        </div>
      )}
      <div class="field">
        <label>body (markdown)</label>
        <textarea value={f.body} onInput={set("body")} />
      </div>
      <div class="row">
        <button type="button" class="primary" disabled={busy} onClick={save}>
          {busy ? <Spinner /> : name ? "Save" : "Create"}
        </button>
      </div>
    </div>
  );
}

function DecisionRecord({ rows }: { rows: MemoryRowUi[] }): JSX.Element {
  const groups = new Map<string, MemoryRowUi[]>();
  for (const r of rows)
    (
      groups.get(r.topic || "(no topic)") ??
      groups.set(r.topic || "(no topic)", []).get(r.topic || "(no topic)")!
    ).push(r);
  if (!rows.length)
    return (
      <Empty>
        No accepted decisions yet. Record one with kind "decision", or ask Claude to em_remember it.
      </Empty>
    );
  return (
    <div class="stack">
      {[...groups.entries()].sort().map(([topic, list]) => (
        <div class="card">
          <h3>{topic}</h3>
          {list.map((r) => (
            <div style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
              <div class="row tight">
                <b>{r.name}</b>
                <MemTag m={r} />
                <span class="muted small">{day(r.updated_at)}</span>
                <span class="spacer" />
                <a class="small" onClick={() => navigate("memory", { name: r.name })}>
                  edit
                </a>
              </div>
              {r.supersedes ? <div class="muted small">supersedes {r.supersedes}</div> : null}
              <pre
                class="json"
                style={{
                  marginTop: 4,
                  whiteSpace: "pre-wrap",
                  fontFamily: "inherit",
                  fontSize: 13,
                }}
              >
                {r.content}
              </pre>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function Memory({ params }: { params: Record<string, string> }): JSX.Element {
  const [tab, setTab] = useState<string>(
    params.name?.startsWith("decision/") ? "decision" : (params.tab ?? "all"),
  );
  const [sel, setSel] = useState<string | null>(params.name ?? null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  const [status, setStatus] = useState("");
  const q = useAsync(() => api<MemoryList>("/api/memories"), []);
  useEffect(() => {
    if (params.name) {
      setSel(params.name);
      setCreating(false);
    }
  }, [params.name]);
  useEffect(() => {
    if (q.data?.gitignored)
      toast(`.gitignore keeps ${q.data.dir} out of git; memories stay local`, true);
    if (q.data?.skipped.length)
      toast(`skipped invalid memory files: ${q.data.skipped.join(", ")}`, true);
  }, [q.data]);
  const rows = useMemo(() => {
    const all = q.data?.memories ?? [];
    const f = filter.trim().toLowerCase();
    return all.filter(
      (m) =>
        (tab === "all" || tab === "record" || m.kind === tab) &&
        (!status || (m.status ?? "accepted") === status) &&
        (!f ||
          m.name.includes(f) ||
          m.tags.some((t) => t.includes(f)) ||
          m.content.toLowerCase().includes(f)),
    );
  }, [q.data, tab, filter, status]);
  if (q.error)
    return (
      <div class="page">
        <ErrorBox error={q.error} />
      </div>
    );
  const d = q.data;
  const tabs: Array<[string, string]> = [
    ["all", "All"],
    ...(d?.kinds ?? []).map((k) => [k, k] as [string, string]),
    ["record", "Decision record"],
  ];
  return (
    <div class="page">
      <SubTabs
        tabs={tabs}
        value={tab}
        onChange={(t) => {
          setTab(t);
          if (t !== "decision") setStatus("");
        }}
      />
      {tab === "record" ? (
        <DecisionRecord
          rows={(d?.memories ?? []).filter(
            (m) => m.kind === "decision" && (m.status ?? "accepted") === "accepted",
          )}
        />
      ) : (
        <>
          <div class="row" style={{ marginBottom: 12 }}>
            <button
              type="button"
              class="primary"
              onClick={() => {
                setCreating(true);
                setSel(null);
              }}
            >
              + New memory
            </button>
            <input
              type="search"
              class="grow"
              placeholder="filter by name, tag or text…"
              value={filter}
              onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
            />
            {tab === "decision" && (
              <select
                value={status}
                onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}
              >
                <option value="">any status</option>
                {(d?.statuses ?? []).map((s) => (
                  <option value={s}>{s}</option>
                ))}
              </select>
            )}
            <button
              type="button"
              title="re-import files edited by hand"
              onClick={async () => {
                const r = await post<{ ok: boolean; output: string }>("/api/actions", {
                  action: "reconcile",
                });
                toast(r.output, !r.ok);
                q.reload();
              }}
            >
              ↻ Reconcile
            </button>
            <span class="muted small">
              {rows.length} of {d?.memories.length ?? 0}
            </span>
          </div>
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
                  rows.map((m) => (
                    <div
                      class={cls("item", sel === m.name && "sel")}
                      onClick={() => {
                        setSel(m.name);
                        setCreating(false);
                      }}
                    >
                      <div class="n">{m.name}</div>
                      <div class="p">
                        <MemTag m={m} />
                        <span class="muted">
                          {day(m.updated_at)} · {fmt(m.size ?? 0)}B
                        </span>
                      </div>
                      <div class="p">{m.content.split("\n")[0]?.slice(0, 120)}</div>
                    </div>
                  ))
                ) : (
                  <Empty>no memories match</Empty>
                )}
              </div>
            </div>
            <div class="card">
              {creating || sel ? (
                <Editor
                  name={creating ? null : sel}
                  kinds={d?.kinds ?? []}
                  statuses={d?.statuses ?? []}
                  onSaved={(n) => {
                    setCreating(false);
                    setSel(n);
                    q.reload();
                  }}
                  onDeleted={() => {
                    setSel(null);
                    q.reload();
                  }}
                />
              ) : (
                <Empty>Select a memory, or create a new one.</Empty>
              )}
            </div>
          </div>
        </>
      )}
      <div style={{ display: "none" }}>
        <Tag>x</Tag>
      </div>
    </div>
  );
}
