export type ContentType = "prose" | "code" | "json";

/** Well-known sources; any string is accepted so callers can namespace freely. */
export type Source =
  | "exec"
  | "batch"
  | "file"
  | "url"
  | "session"
  | "memory"
  | "code"
  | (string & {});

export interface DocumentInput {
  source: Source;
  title: string;
  uri?: string | undefined;
  contentType: ContentType;
  contentHash: string;
  sessionId?: string | undefined;
  meta?: Record<string, unknown> | undefined;
}

export interface DocumentRow {
  id: number;
  source: string;
  title: string;
  uri: string | null;
  content_type: ContentType;
  content_hash: string;
  session_id: string | null;
  meta: string | null;
  created_at: number;
}

export interface ChunkInput {
  ord: number;
  title: string;
  body: string;
  contentType: ContentType;
  startLine?: number | undefined;
  endLine?: number | undefined;
  hash: string;
  /** Graph node id (`sym:<rel>#<Qualified>`) this chunk is the body of, for code. */
  symbolId?: string | undefined;
}

export interface ChunkRow {
  id: number;
  document_id: number;
  ord: number;
  title: string;
  body: string;
  content_type: ContentType;
  start_line: number | null;
  end_line: number | null;
  hash: string;
  embedded: number;
  symbol_id: string | null;
}

export interface ChunkWithDoc extends ChunkRow {
  document: DocumentRow;
}

export interface SearchFilters {
  source?: string | string[] | undefined;
  contentType?: ContentType | undefined;
  /** Unix ms; only documents created at or after this time. */
  since?: number | undefined;
  sessionId?: string | undefined;
  documentIds?: number[] | undefined;
}

export interface FtsHit {
  chunkId: number;
  /** Higher is better (negated bm25). */
  score: number;
}

export interface VecHit {
  chunkId: number;
  distance: number;
}

export interface VocabTerm {
  term: string;
  df: number;
}

export type PurgeScope = "index" | "sessions" | "graph" | "memories" | "all";

export interface SessionRow {
  id: string;
  project_root: string | null;
  started_at: number | null;
  ended_at: number | null;
  source: string | null;
  last_prompt: string | null;
  transcript_path: string | null;
}

export interface EventInput {
  sessionId: string;
  category: string;
  priority: 1 | 2 | 3 | 4;
  tool?: string | undefined;
  payload: Record<string, unknown>;
  documentId?: number | undefined;
  ts?: number | undefined;
}

export interface EventRow {
  id: number;
  session_id: string;
  ts: number;
  category: string;
  priority: number;
  tool: string | null;
  payload: string;
  document_id: number | null;
}

export interface StatDelta {
  rawChars: number;
  returnedChars: number;
  durationMs: number;
}

export interface StatRow {
  session_id: string;
  tool: string;
  calls: number;
  raw_chars: number;
  returned_chars: number;
  duration_ms: number;
}

export interface MemoryInput {
  kind: string;
  content: string;
  tags?: string[] | undefined;
  nodeIds?: string[] | undefined;
  sessionId?: string | undefined;
  documentId?: number | undefined;
  /** `topic/slug`; the markdown file is `<memories.dir>/<name>.md`. */
  name?: string | undefined;
  /** Project-relative path of that file. */
  path?: string | undefined;
  fileHash?: string | undefined;
  fileMtime?: number | undefined;
  fileSize?: number | undefined;
  createdAt?: number | undefined;
  updatedAt?: number | undefined;
  /** ADR-style lifecycle for decisions: proposed | accepted | superseded | deprecated. */
  status?: string | undefined;
  /** Name of the memory this one replaces. */
  supersedes?: string | undefined;
}

export const MEMORY_STATUSES = ["proposed", "accepted", "superseded", "deprecated"] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export interface MemoryRow {
  id: number;
  kind: string;
  content: string;
  tags: string | null;
  node_ids: string | null;
  session_id: string | null;
  document_id: number | null;
  created_at: number;
  name: string | null;
  path: string | null;
  file_hash: string | null;
  file_mtime: number | null;
  file_size: number | null;
  updated_at: number | null;
  status: string | null;
  supersedes: string | null;
}

/** Who produced a node/edge: a parser, a person, git history, or a derived analysis pass. */
export type GraphSource = "tree-sitter" | "curated" | "git" | "analysis";

export interface GraphNode {
  id: string;
  kind: string;
  name: string;
  path?: string | null | undefined;
  startLine?: number | null | undefined;
  endLine?: number | null | undefined;
  source: GraphSource;
  confidence?: number | undefined;
  meta?: Record<string, unknown> | undefined;
}

export interface GraphNodeRow {
  id: string;
  kind: string;
  name: string;
  path: string | null;
  start_line: number | null;
  end_line: number | null;
  source: GraphSource;
  confidence: number;
  meta: string | null;
  updated_at: number;
}

export interface GraphEdge {
  src: string;
  dst: string;
  kind: string;
  source: GraphSource;
  confidence?: number | undefined;
  weight?: number | undefined;
  meta?: Record<string, unknown> | undefined;
}

export interface GraphEdgeRow {
  src: string;
  dst: string;
  kind: string;
  source: GraphSource;
  confidence: number;
  weight: number;
  meta: string | null;
  updated_at: number;
}

/** indexed: parsed into graph + search; partial: indexed with parse errors; skipped/unsupported: not in the graph. */
export type FileIndexStatus = "indexed" | "partial" | "skipped" | "unsupported";

export interface FileIndexRow {
  path: string;
  hash: string;
  mtime: number | null;
  size: number | null;
  language: string | null;
  indexed_at: number;
  document_id: number | null;
  status: FileIndexStatus;
  /** Why the file is not fully indexed (e.g. "over 1.5 MB", a parser error). */
  reason: string | null;
  /** Symbols the parser found. */
  symbols: number | null;
  errors: string | null;
}

export interface FileIndexInput {
  path: string;
  hash: string;
  mtime: number | null;
  size: number | null;
  language: string | null;
  document_id: number | null;
  status?: FileIndexStatus | undefined;
  reason?: string | null | undefined;
  symbols?: number | null | undefined;
  errors?: string | null | undefined;
}

/** Per-node structural and churn signals; `score` is a hotspot signal, not a quality grade. */
export interface GraphMetricRow {
  node_id: string;
  kind: string;
  path: string | null;
  fan_in: number;
  fan_out: number;
  loc: number;
  complexity: number;
  commits_90d: number;
  score: number;
  cluster: number | null;
  updated_at: number;
}

export type GraphMetricInput = Omit<GraphMetricRow, "updated_at">;

export interface IndexRunRow {
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

export type IndexRunSummary = Partial<
  Pick<
    IndexRunRow,
    "scanned" | "indexed" | "unchanged" | "skipped" | "removed" | "errors" | "detail"
  >
>;

export interface SnapshotRow {
  id: number;
  session_id: string | null;
  trigger: string | null;
  body: string;
  bytes: number;
  created_at: number;
  consumed_at: number | null;
}
