import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Bucket, FileHistoryUi, GraphCommitUi, WeekUi } from "../api.js";
import { cls, day } from "../util.js";
import { BUCKET_COLORS, BUCKET_ORDER, bucketColor } from "./colors.js";
import { type LaneRow, laneSegments } from "./lanes.js";

export { BUCKET_COLORS, BUCKET_ORDER, bucketColor };

/** Sequential single-hue ramp for history risk (light → dark blue). */
export function riskColor(r: number): string {
  const t = Math.max(0, Math.min(1, r));
  const a = [191, 219, 254]; // #bfdbfe
  const b = [30, 58, 138]; // #1e3a8a
  const c = a.map((x, i) => Math.round(x + ((b[i] ?? 0) - x) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function useWidth<T extends HTMLElement>(fallback = 800): [preact.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || fallback));
    ro.observe(el);
    setW(el.clientWidth || fallback);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// --- activity: stacked weekly bars with a brush ----------------------------------------

export function ActivityChart({
  weeks,
  range,
  onRange,
  hidden,
}: {
  weeks: WeekUi[];
  range: [number, number] | null;
  onRange: (r: [number, number] | null) => void;
  hidden: Set<Bucket>;
}): JSX.Element {
  const [box, width] = useWidth<HTMLDivElement>();
  const H = 150;
  const PAD = { l: 34, r: 8, t: 8, b: 22 };
  const plotW = Math.max(10, width - PAD.l - PAD.r);
  const plotH = H - PAD.t - PAD.b;
  const n = weeks.length;
  const bw = n ? plotW / n : plotW;
  const gap = bw >= 5 ? 1 : 0;
  const max = Math.max(
    1,
    ...weeks.map((w) => BUCKET_ORDER.reduce((a, b) => a + (hidden.has(b) ? 0 : w.byBucket[b]), 0)),
  );
  const y = (v: number) => PAD.t + plotH - (v / max) * plotH;
  const [hover, setHover] = useState<number | null>(null);
  const drag = useRef<{ x0: number; i0: number } | null>(null);
  const [sel, setSel] = useState<[number, number] | null>(null);
  const idxAt = (clientX: number, el: SVGSVGElement) => {
    const r = el.getBoundingClientRect();
    const x = clientX - r.left - PAD.l;
    return Math.max(0, Math.min(n - 1, Math.floor(x / bw)));
  };
  const ticks = useMemo(() => {
    const out: Array<{ i: number; label: string }> = [];
    let lastMonth = "";
    for (let i = 0; i < n; i++) {
      const m = weeks[i]!.week.slice(0, 7);
      if (m !== lastMonth) {
        lastMonth = m;
        const d = new Date(weeks[i]!.at);
        const label =
          d.getUTCMonth() === 0 || !out.length
            ? `${d.getUTCFullYear()}`
            : d.toLocaleString("en", { month: "short", timeZone: "UTC" });
        out.push({ i, label });
      }
    }
    const every = Math.max(1, Math.ceil(out.length / Math.max(4, plotW / 60)));
    return out.filter((_, k) => k % every === 0);
  }, [weeks, plotW]);
  const selIdx =
    sel ??
    (range
      ? [
          weeks.findIndex((w) => w.at + 7 * 864e5 > range[0]),
          weeks.findIndex((w) => w.at > range[1]) - 1,
        ]
      : null);
  const hw = hover !== null ? weeks[hover] : undefined;
  return (
    <div class="hist-chart" ref={box}>
      <svg
        width={width}
        height={H}
        onMouseMove={(e) => {
          const el = e.currentTarget as SVGSVGElement;
          const i = idxAt(e.clientX, el);
          setHover(i);
          if (drag.current) setSel([Math.min(drag.current.i0, i), Math.max(drag.current.i0, i)]);
        }}
        onMouseLeave={() => setHover(null)}
        onMouseDown={(e) => {
          const el = e.currentTarget as SVGSVGElement;
          const i = idxAt(e.clientX, el);
          drag.current = { x0: e.clientX, i0: i };
          setSel([i, i]);
          e.preventDefault();
        }}
        onMouseUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d) return;
          if (Math.abs(e.clientX - d.x0) < 3) {
            setSel(null);
            onRange(null);
            return;
          }
          const s = sel;
          setSel(null);
          if (s) onRange([weeks[s[0]]!.at, weeks[s[1]]!.at + 7 * 864e5 - 1]);
        }}
      >
        <title>commits per week by kind</title>
        {[0, 0.5, 1].map((f) => (
          <g>
            <line x1={PAD.l} x2={width - PAD.r} y1={y(max * f)} y2={y(max * f)} class="grid" />
            <text x={PAD.l - 6} y={y(max * f) + 3} class="axis" text-anchor="end">
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        {ticks.map((t) => (
          <text x={PAD.l + t.i * bw} y={H - 6} class="axis">
            {t.label}
          </text>
        ))}
        {selIdx && selIdx[0] >= 0 && selIdx[1] >= selIdx[0] ? (
          <rect
            x={PAD.l + selIdx[0] * bw}
            y={PAD.t}
            width={(selIdx[1] - selIdx[0] + 1) * bw}
            height={plotH}
            class="brush"
          />
        ) : null}
        {weeks.map((w, i) => {
          let acc = 0;
          return (
            <g opacity={selIdx && (i < selIdx[0] || i > selIdx[1]) ? 0.35 : 1}>
              {BUCKET_ORDER.map((b) => {
                if (hidden.has(b)) return null;
                const v = w.byBucket[b];
                if (!v) return null;
                const y1 = y(acc + v);
                const y0 = y(acc);
                acc += v;
                return (
                  <rect
                    x={PAD.l + i * bw + gap / 2}
                    y={y1}
                    width={Math.max(0.5, bw - gap)}
                    height={Math.max(0, y0 - y1 - (gap && y0 - y1 > 2 ? 1 : 0))}
                    fill={BUCKET_COLORS[b]}
                    rx={bw >= 6 ? 1.5 : 0}
                  />
                );
              })}
            </g>
          );
        })}
        {hover !== null ? (
          <line
            x1={PAD.l + hover * bw + bw / 2}
            x2={PAD.l + hover * bw + bw / 2}
            y1={PAD.t}
            y2={PAD.t + plotH}
            class="cross"
          />
        ) : null}
      </svg>
      {hw ? (
        <div class="tip" style={{ left: Math.min(width - 190, PAD.l + hover! * bw + 10), top: 4 }}>
          <b>week of {hw.week}</b> · {hw.total} commit{hw.total === 1 ? "" : "s"} · +{hw.added}/-
          {hw.deleted}
          <div class="row tight" style={{ marginTop: 4, flexWrap: "wrap" }}>
            {BUCKET_ORDER.filter((b) => hw.byBucket[b]).map((b) => (
              <span class="kdot-lbl">
                <i class="kdot" style={{ background: BUCKET_COLORS[b] }} />
                {b} {hw.byBucket[b]}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function KindLegend({
  counts,
  hidden,
  onToggle,
}: {
  counts: Record<string, number>;
  hidden: Set<Bucket>;
  onToggle: (b: Bucket) => void;
}): JSX.Element {
  return (
    <div class="row tight" style={{ flexWrap: "wrap" }}>
      {BUCKET_ORDER.map((b) => (
        <button
          type="button"
          class={cls("chip", !hidden.has(b) && "on")}
          onClick={() => onToggle(b)}
          title={hidden.has(b) ? `show ${b}` : `hide ${b}`}
        >
          <i
            class="kdot"
            style={{ background: BUCKET_COLORS[b], opacity: hidden.has(b) ? 0.3 : 1 }}
          />
          {b} {counts[b] ?? 0}
        </button>
      ))}
    </div>
  );
}

// --- sparkline --------------------------------------------------------------------------

export function Sparkline({
  values,
  width = 72,
  height = 16,
}: {
  values: number[];
  width?: number;
  height?: number;
}): JSX.Element {
  const max = Math.max(1, ...values);
  const n = values.length;
  const pts = values.map(
    (v, i) =>
      `${(i / Math.max(1, n - 1)) * (width - 2) + 1},${height - 1 - (v / max) * (height - 3)}`,
  );
  return (
    <svg width={width} height={height} class="spark" title={values.join(" ")}>
      <title>commits per month: {values.join(" ")}</title>
      <polyline points={pts.join(" ")} />
      {values.map((v, i) =>
        v ? (
          <circle
            cx={(i / Math.max(1, n - 1)) * (width - 2) + 1}
            cy={height - 1 - (v / max) * (height - 3)}
            r={1.4}
          />
        ) : null,
      )}
    </svg>
  );
}

// --- file scatter: churn vs fix share, sized by lines, coloured by risk -----------------

export function FileScatter({
  files,
  selected,
  onSelect,
}: {
  files: FileHistoryUi[];
  selected: string | null;
  onSelect: (p: string) => void;
}): JSX.Element {
  const [box, width] = useWidth<HTMLDivElement>();
  const H = 300;
  const PAD = { l: 42, r: 16, t: 12, b: 30 };
  const plotW = Math.max(10, width - PAD.l - PAD.r);
  const plotH = H - PAD.t - PAD.b;
  const rows = files.filter((f) => f.commits >= 2);
  const maxC = Math.max(2, ...rows.map((f) => f.commits));
  const maxL = Math.max(1, ...rows.map((f) => f.added + f.deleted));
  const x = (c: number) => PAD.l + (Math.log(c) / Math.log(maxC)) * plotW;
  const y = (r: number) => PAD.t + plotH - r * plotH;
  const rad = (f: FileHistoryUi) => 3 + Math.sqrt((f.added + f.deleted) / maxL) * 13;
  const [hover, setHover] = useState<FileHistoryUi | null>(null);
  const labelled = [...rows].sort((a, b) => b.risk - a.risk).slice(0, 5);
  const xt = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].filter((v) => v <= maxC);
  return (
    <div class="hist-chart" ref={box}>
      <svg width={width} height={H}>
        <title>files by commits and fix share, sized by lines changed</title>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g>
            <line x1={PAD.l} x2={width - PAD.r} y1={y(f)} y2={y(f)} class="grid" />
            <text x={PAD.l - 6} y={y(f) + 3} class="axis" text-anchor="end">
              {Math.round(f * 100)}%
            </text>
          </g>
        ))}
        {xt
          .filter((v) => x(v) < width - PAD.r - 70)
          .map((v) => (
            <text x={x(v)} y={H - 8} class="axis" text-anchor="middle">
              {v}
            </text>
          ))}
        <text x={width - PAD.r} y={H - 8} class="axis" text-anchor="end">
          commits (log) →
        </text>
        <text x={PAD.l + 4} y={PAD.t + 10} class="axis">
          share of commits that were fixes ↑
        </text>
        {rows.map((f) => (
          <circle
            cx={x(f.commits)}
            cy={y(f.commits ? f.fixes / f.commits : 0)}
            r={rad(f)}
            fill={riskColor(f.risk)}
            class={cls("dot", selected === f.path && "sel")}
            onMouseEnter={() => setHover(f)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onSelect(f.path)}
          />
        ))}
        {labelled.map((f) => {
          const right = x(f.commits) > width - 160;
          return (
            <text
              x={right ? x(f.commits) - rad(f) - 3 : x(f.commits) + rad(f) + 3}
              y={y(f.fixes / f.commits) + 3}
              class="lbl"
              text-anchor={right ? "end" : "start"}
            >
              {f.path.split("/").slice(-2).join("/")}
            </text>
          );
        })}
      </svg>
      {hover ? (
        <div
          class="tip"
          style={{
            left: Math.min(width - 260, x(hover.commits) + 12),
            top: Math.max(0, y(hover.fixes / hover.commits) - 60),
          }}
        >
          <b>{hover.path}</b>
          <div class="muted">
            {hover.commits} commits · {hover.fixes} fixes · +{hover.added}/-{hover.deleted} · risk{" "}
            {hover.risk.toFixed(2)}
          </div>
          {hover.reasons.length ? <div class="muted">{hover.reasons.join("; ")}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

// --- lane graph: the commit DAG with branch lanes ----------------------------------------

export const LANE_COLORS = [
  "#2563eb",
  "#d97706",
  "#16a34a",
  "#7c3aed",
  "#e11d48",
  "#0284c7",
  "#db2777",
  "#0d9488",
];
export const laneColor = (i: number): string => LANE_COLORS[i % LANE_COLORS.length]!;

export function LaneGraph({
  rows,
  lanes,
  rowH,
  selected,
}: {
  rows: LaneRow<GraphCommitUi>[];
  lanes: number;
  rowH: number;
  selected: string | null;
}): JSX.Element {
  const LW = 14;
  const width = lanes * LW + 10;
  const x = (l: number) => 7 + l * LW;
  const y = (i: number) => i * rowH + rowH / 2;
  const segs = laneSegments(rows);
  return (
    <svg class="lanes" width={width} height={rows.length * rowH}>
      <title>commit graph</title>
      {segs.map((s) =>
        s.kind === "line" ? (
          <line
            x1={x(s.lane)}
            x2={x(s.lane)}
            y1={y(s.from)}
            y2={y(s.to)}
            stroke={laneColor(s.lane)}
          />
        ) : (
          <path
            d={`M${x(s.fromLane)},${y(s.from)} C${x(s.fromLane)},${y(s.from) + rowH / 2} ${x(s.toLane)},${y(s.to) - rowH / 2} ${x(s.toLane)},${y(s.to)}`}
            stroke={laneColor(s.lane)}
          />
        ),
      )}
      {rows.map((r, i) => (
        <circle
          cx={x(r.lane)}
          cy={y(i)}
          r={r.c.merge ? 3.5 : 4}
          fill={r.c.merge ? "var(--card)" : laneColor(r.lane)}
          stroke={laneColor(r.lane)}
          stroke-width={selected === r.c.sha ? 3 : r.c.merge ? 2 : 1}
          class={cls(selected === r.c.sha && "sel", !r.c.onHead && "off")}
        />
      ))}
    </svg>
  );
}

export const dayOf = day;
