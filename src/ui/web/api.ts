/** Fetch wrapper for the dashboard API: every call carries the selected project root. */

let root = new URLSearchParams(location.search).get("root") ?? "";

export const getRoot = (): string => root;
export function setRoot(r: string): void {
  root = r;
  const u = new URL(location.href);
  u.searchParams.set("root", r);
  history.replaceState(null, "", u.toString());
}

export type Params = Record<string, string | number | boolean | undefined | null>;

function url(path: string, params?: Params): string {
  const u = new URL(path, location.origin);
  if (root) u.searchParams.set("root", root);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === null || v === "") continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, params?: Params, init?: RequestInit): Promise<T> {
  const r = await fetch(url(path, params), init);
  const body = (await r.json().catch(() => ({ error: "bad response" }))) as T & { error?: string };
  if (!r.ok) throw new ApiError(body.error ?? `HTTP ${r.status}`, r.status);
  if (body && typeof body === "object" && "error" in body && body.error)
    throw new ApiError(String(body.error), r.status);
  return body;
}

export function post<T>(path: string, body: unknown, method = "POST", params?: Params): Promise<T> {
  return api<T>(path, params, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function del<T>(path: string, params?: Params): Promise<T> {
  return api<T>(path, params, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
  });
}

// --- shared shapes ------------------------------------------------------------------

export interface VisNode {
  id: string;
  label: string;
  kind: string;
  path: string | null;
  line: number | null;
  root?: boolean;
  score?: number;
  exported?: boolean;
}
export interface VisEdge {
  src: string;
  dst: string;
  kind: string;
  weight: number;
  confidence?: number;
  count?: number;
  lines?: number[];
}
export interface GraphResult {
  root?: string;
  rootLabel?: string;
  truncated?: boolean;
  total?: number;
  nodes: VisNode[];
  edges: VisEdge[];
}
export interface Status {
  version: string;
  root: string;
  id: string;
  state: "fresh" | "stale" | "empty";
  freshness: {
    head?: string;
    indexedHead?: string;
    headMatches: boolean;
    queued: number;
    dirty: string[];
    lastRun: number | null;
  };
  files: {
    byStatus: Record<string, number>;
    reasons: Array<{ reason: string; n: number }>;
    lastIndexedAt: number | null;
  };
  graph: { nodes: number; edges: number; metrics: number; metricsAt: number | null };
  runs: IndexRun[];
}
export interface IndexRun {
  id: number;
  scope: string;
  started_at: number;
  finished_at: number | null;
  scanned: number;
  indexed: number;
  unchanged: number;
  skipped: number;
  removed: number;
  errors: number;
  head_sha: string | null;
  detail: string | null;
}
export interface TreeFile {
  path: string;
  status: string;
  reason: string | null;
  language: string | null;
  symbols: number;
  size: number;
  score: number;
  fanIn: number;
  loc: number;
  cluster: number | null;
}
export interface FileSymbol {
  id: string;
  name: string;
  kind: string;
  start_line: number | null;
  end_line: number | null;
  exported: boolean;
}
export interface FileData {
  path: string;
  size?: number;
  language?: string | null;
  status?: string | null;
  reason?: string | null;
  lines?: number;
  content?: string;
  tooLarge?: boolean;
  symbols: FileSymbol[];
}
export interface Hit {
  id: string;
  label: string;
  kind: string;
  path: string | null;
  score: number;
  hops: number;
  reasons: string[];
}
export interface FileImpact {
  path: string;
  directDependents: number;
  affected: number;
  tests: number;
  coChanged: Array<{ path: string; reason: string }>;
  memories: string[];
  hits: Hit[];
  graph: GraphResult;
}
export interface EdgeWithNode extends VisEdge {
  node: VisNode;
}
export interface SymbolDetail {
  node: VisNode;
  meta: Record<string, unknown>;
  metrics: {
    fan_in: number;
    fan_out: number;
    loc: number;
    complexity: number;
    commits_90d: number;
    score: number;
    cluster: number | null;
  } | null;
  callers: EdgeWithNode[];
  callees: EdgeWithNode[];
  members: VisNode[];
  routes: VisNode[];
  memories: Array<{ name: string; kind: string }>;
  coChanged: Array<{ path: string; weight: number }>;
}
export interface Hotspot {
  id: string;
  path: string;
  kind: string;
  commits_90d: number;
  commits: number;
  last_touched: string;
  fan_in: number;
  fan_out: number;
  complexity: number;
  loc: number;
  score: number;
}
export interface RouteRow {
  id: string;
  method: string;
  path: string;
  framework: string;
  file: string;
  line: number | null;
  handlers: Array<{ id: string; name: string; path: string | null }>;
}
export interface ClusterSummary {
  id: number;
  size: number;
  label: string;
  files: string[];
  links: Record<string, number>;
}
export interface Architecture {
  project: { name?: string; version?: string; description?: string; root: string };
  overview: {
    files: number;
    symbols: number;
    edges: number;
    languages: Record<string, number>;
    coverage: Record<string, number>;
    indexedHead?: string;
    metricsAt?: number;
  };
  folders: Array<{
    path: string;
    files: number;
    loc: number;
    score: number;
    languages: Record<string, number>;
  }>;
  entryPoints: Array<{ kind: string; name: string; path: string }>;
  routes: RouteRow[];
  hotspots: Hotspot[];
  clusters: ClusterSummary[];
  cycles: string[][];
  decisions: Array<{ name: string; title: string; status: string; updated: number }>;
}
export interface MemoryRowUi {
  id: number;
  name: string;
  topic: string;
  kind: string;
  status: string | null;
  supersedes: string | null;
  content: string;
  tags: string[];
  related: string[];
  path: string | null;
  size: number | null;
  created_at: number;
  updated_at: number;
}
export interface MemoryList {
  dir: string;
  kinds: string[];
  statuses: string[];
  topics: string[];
  skipped: string[];
  gitignored: boolean;
  memories: MemoryRowUi[];
}
export interface MemoryBody {
  name: string;
  kind: string;
  status?: string;
  supersedes?: string;
  tags: string[];
  related: string[];
  created: string;
  updated: string;
  body: string;
  path: string;
}
