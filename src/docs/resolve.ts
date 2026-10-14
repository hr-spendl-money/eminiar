import { type CatalogEntry, catalogForProvider } from "./catalog.js";

export interface Resolved {
  provider: string;
  title: string;
  urls: string[];
  via: "catalog" | "npm" | "pypi" | "go" | "probe" | "none";
  crawl?: { depth?: number | undefined; maxPages?: number | undefined } | undefined;
  notes?: string | undefined;
}

export interface ResolveOptions {
  catalog?: CatalogEntry[] | undefined;
  timeoutMs?: number | undefined;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch | undefined;
}

async function getJson(
  url: string,
  opts: ResolveOptions,
): Promise<Record<string, unknown> | undefined> {
  const f = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await f(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json", "user-agent": "eminiar/0.3 (+local docs indexer)" },
    });
    if (!res.ok) return undefined;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** `git+ssh://git@github.com/o/r.git` → `https://github.com/o/r`; undefined when not a GitHub repo. */
export function githubRepo(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const m = /github\.com[/:]([^/\s#]+)\/([^/\s#]+?)(?:\.git)?(?:[/#].*)?$/i.exec(raw);
  return m ? `https://github.com/${m[1]}/${m[2]}` : undefined;
}

function readmeOf(repo: string): string {
  return `${repo.replace("https://github.com/", "https://raw.githubusercontent.com/")}/HEAD/README.md`;
}

function uniq(urls: Array<string | undefined>): string[] {
  const out: string[] = [];
  for (const u of urls) {
    if (!u) continue;
    const t = u.trim();
    if (!/^https?:\/\//i.test(t) || out.includes(t)) continue;
    out.push(t);
  }
  return out;
}

async function fromNpm(name: string, opts: ResolveOptions): Promise<Resolved> {
  const provider = `npm:${name}`;
  const meta = await getJson(
    `https://registry.npmjs.org/${encodeURIComponent(name).replace("%40", "@")}/latest`,
    opts,
  );
  if (!meta)
    return { provider, title: name, urls: [], via: "none", notes: "npm registry lookup failed" };
  const repoRaw =
    typeof meta.repository === "string"
      ? meta.repository
      : (meta.repository as { url?: string } | undefined)?.url;
  const repo =
    githubRepo(repoRaw) ??
    githubRepo(typeof meta.homepage === "string" ? meta.homepage : undefined);
  const homepage =
    typeof meta.homepage === "string" ? meta.homepage.replace(/#readme$/, "") : undefined;
  const urls = uniq([
    homepage && !/github\.com/.test(homepage) ? homepage : undefined,
    repo ? readmeOf(repo) : undefined,
    repo,
    !homepage && !repo ? `https://www.npmjs.com/package/${name}` : undefined,
  ]);
  return {
    provider,
    title:
      typeof meta.description === "string" && meta.description
        ? `${name} — ${meta.description}`
        : name,
    urls,
    via: "npm",
    crawl: { depth: homepage && !/github\.com/.test(homepage) ? 1 : 0, maxPages: 15 },
  };
}

async function fromPypi(name: string, opts: ResolveOptions): Promise<Resolved> {
  const provider = `pypi:${name}`;
  const meta = await getJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, opts);
  const info = meta?.info as Record<string, unknown> | undefined;
  if (!info) return { provider, title: name, urls: [], via: "none", notes: "PyPI lookup failed" };
  const links = (info.project_urls ?? {}) as Record<string, string>;
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const hit = Object.entries(links).find(([n]) => n.toLowerCase() === k.toLowerCase());
      if (hit) return hit[1];
    }
    return undefined;
  };
  const docs = pick("Documentation", "Docs", "documentation");
  const home =
    pick("Homepage", "Home") ?? (typeof info.home_page === "string" ? info.home_page : undefined);
  const repo = githubRepo(pick("Repository", "Source", "Source Code", "Code", "GitHub") ?? home);
  const urls = uniq([
    docs,
    home && !/github\.com/.test(home) ? home : undefined,
    repo ? readmeOf(repo) : undefined,
    repo,
  ]);
  return {
    provider,
    title: typeof info.summary === "string" && info.summary ? `${name} — ${info.summary}` : name,
    urls: urls.length ? urls : [`https://pypi.org/project/${name}/`],
    via: "pypi",
    crawl: { depth: docs ? 1 : 0, maxPages: 15 },
  };
}

const TWO_LEVEL_TLDS = new Set([
  "co.uk",
  "co.za",
  "com.au",
  "com.br",
  "co.jp",
  "co.in",
  "co.nz",
  "org.uk",
  "net.au",
  "ac.uk",
  "gov.uk",
  "co.ke",
  "com.ng",
  "com.mx",
  "com.ar",
  "co.id",
  "com.sg",
  "com.hk",
  "com.tr",
]);

function rootOf(host: string): string {
  const parts = host.toLowerCase().split(".");
  if (parts.length <= 2) return host.toLowerCase();
  const last2 = parts.slice(-2).join(".");
  return TWO_LEVEL_TLDS.has(last2) ? parts.slice(-3).join(".") : last2;
}

/** Where API documentation usually lives for a host, most specific first. */
export function docGuesses(host: string): string[] {
  const h = host.toLowerCase();
  const root = rootOf(h);
  const list = [
    `https://docs.${root}/`,
    `https://developer.${root}/`,
    `https://developers.${root}/`,
    `https://${root}/docs`,
    `https://${root}/docs/`,
    `https://www.${root}/docs`,
    `https://${root}/developers`,
    `https://${root}/developer`,
    `https://${root}/api`,
    `https://${root}/api-docs`,
    `https://api.${root}/docs`,
    `https://${h}/docs`,
    `https://${h}/swagger`,
    `https://${h}/api-docs`,
    `https://${h}/openapi.json`,
    `https://${h}/swagger.json`,
  ];
  return [...new Set(list)];
}

async function probe(
  url: string,
  opts: ResolveOptions,
): Promise<{ ok: boolean; kind: "html" | "json" | "other" }> {
  const f = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.min(opts.timeoutMs ?? 8_000, 8_000));
  try {
    const res = await f(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        accept: "text/html,application/json;q=0.9,*/*;q=0.5",
        "user-agent": "eminiar/0.3 (+local docs indexer)",
      },
    });
    if (!res.ok) return { ok: false, kind: "other" };
    const type = res.headers.get("content-type") ?? "";
    // read a little so a soft-404 single page app still counts as html, but do not download everything
    const reader = res.body?.getReader();
    if (reader) {
      await reader.read().catch(() => undefined);
      await reader.cancel().catch(() => undefined);
    }
    return {
      ok: true,
      kind: /json/i.test(type) ? "json" : /html|text/i.test(type) ? "html" : "other",
    };
  } catch {
    return { ok: false, kind: "other" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * An API host the catalogue does not know: try the conventional documentation locations
 * and keep the first two that answer. OpenAPI documents count — the crawler indexes JSON.
 */
async function fromApiHost(host: string, opts: ResolveOptions): Promise<Resolved> {
  const provider = `api:${host}`;
  const root = rootOf(host);
  const found: string[] = [];
  const guesses = docGuesses(host);
  const batch = 4;
  for (let i = 0; i < guesses.length && found.length < 2; i += batch) {
    const slice = guesses.slice(i, i + batch);
    const results = await Promise.all(slice.map((u) => probe(u, opts)));
    for (let k = 0; k < slice.length; k++) {
      const r = results[k]!;
      if (r.ok && r.kind !== "other") found.push(slice[k]!);
    }
  }
  if (!found.length)
    return {
      provider,
      title: `${root} API`,
      urls: [],
      via: "none",
      notes: `no documentation site answered for ${host} (tried docs./developer./…/docs); pass urls`,
    };
  return {
    provider,
    title: `${root} API`,
    urls: found.slice(0, 2),
    via: "probe",
    crawl: { depth: 1, maxPages: 20 },
  };
}

function fromGo(module: string): Resolved {
  const repo = githubRepo(`https://${module}`);
  return {
    provider: `go:${module}`,
    title: module,
    urls: uniq([`https://pkg.go.dev/${module}`, repo ? readmeOf(repo) : undefined]),
    via: "go",
    crawl: { depth: 0 },
  };
}

/**
 * Where a provider's documentation lives: the catalogue first (offline), then the npm,
 * PyPI or Go registries, then a probe of the conventional documentation locations for an
 * API host. Env-prefix and image providers that the catalogue does not know come back with
 * `via: "none"` — the caller supplies a URL.
 */
export async function resolveProvider(
  provider: string,
  opts: ResolveOptions = {},
): Promise<Resolved> {
  const entry = catalogForProvider(provider, opts.catalog);
  if (entry)
    return { provider, title: entry.title, urls: entry.urls, via: "catalog", crawl: entry.crawl };
  const i = provider.indexOf(":");
  const kind = i === -1 ? "" : provider.slice(0, i);
  const key = i === -1 ? provider : provider.slice(i + 1);
  if (kind === "npm") return fromNpm(key, opts);
  if (kind === "pypi") return fromPypi(key, opts);
  if (kind === "go") return fromGo(key);
  if (kind === "api") return fromApiHost(key, opts);
  return {
    provider,
    title: key,
    urls: [],
    via: "none",
    notes: `no catalogue entry for ${provider}; pass urls or add it to docs.catalog in eminiar.config.json`,
  };
}
