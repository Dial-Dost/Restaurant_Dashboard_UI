"use client";

import { useId, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { accentColor } from "./Widget";

/* ---------------------------------- Stat ---------------------------------- */

/** Big number that counts up once when its view enters. */
export function Stat({
  value,
  prefix = "",
  suffix = "",
  decimals = 0,
  format,
  label,
  delta,
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  /** "minsec" renders the value (in seconds) as `12m 40s` */
  format?: "minsec";
  label?: string;
  delta?: number;
}) {
  return (
    <div className="flex h-full flex-col justify-end gap-1">
      <div className="flex items-baseline gap-2 max-md:flex-wrap max-md:gap-y-1">
        <span
          className="exp-count text-[24px] font-bold leading-none tracking-tight text-ink tabular-nums sm:text-[30px]"
          data-count-to={value}
          data-count-prefix={prefix}
          data-count-suffix={suffix}
          data-count-decimals={decimals}
          data-count-format={format}
        >
          {format === "minsec" ? "0m 00s" : `${prefix}${(0).toFixed(decimals)}${suffix}`}
        </span>
        {delta !== undefined && <Delta value={delta} />}
      </div>
      {label && <span className="text-[12px] text-ink-2">{label}</span>}
    </div>
  );
}

export function Delta({ value }: { value: number }) {
  const up = value >= 0;
  return (
    <span className="flex items-center gap-0.5 text-[12px] font-semibold text-ink-2 tabular-nums">
      {up ? (
        <ArrowUpRight size={13} strokeWidth={2.5} style={{ color: "var(--emerald)" }} />
      ) : (
        <ArrowDownRight size={13} strokeWidth={2.5} style={{ color: "#C2584A" }} />
      )}
      {Math.abs(value)}%
    </span>
  );
}

/* -------------------------------- Sparkline -------------------------------- */

export function Sparkline({
  data,
  accent = "gold",
  height = 72,
  unit = "",
  labels,
}: {
  data: number[];
  accent?: string;
  height?: number;
  unit?: string;
  labels?: string[];
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const color = accentColor(accent);
  const w = 240;
  const pad = 6;
  const [tip, setTip] = useState<number | null>(null);

  const pts = useMemo(() => {
    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;
    return data.map((v, i) => ({
      x: pad + (i / (data.length - 1)) * (w - pad * 2),
      y: pad + (1 - (v - min) / span) * (height - pad * 2),
      v,
    }));
  }, [data, height]);

  // Smooth the line with Catmull-Rom → bezier segments.
  const path = useMemo(() => {
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
    }
    return d;
  }, [pts]);

  const last = pts[pts.length - 1];
  const active = tip !== null ? pts[tip] : null;

  return (
    <div className="relative h-full w-full">
      <svg
        viewBox={`0 0 ${w} ${height}`}
        className="h-full w-full overflow-visible"
        preserveAspectRatio="none"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * w;
          let best = 0;
          for (let i = 1; i < pts.length; i++)
            if (Math.abs(pts[i].x - x) < Math.abs(pts[best].x - x)) best = i;
          setTip(best);
        }}
        onPointerLeave={() => setTip(null)}
      >
        <defs>
          <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d={`${path} L ${last.x} ${height} L ${pts[0].x} ${height} Z`}
          fill={`url(#g${id})`}
          className="exp-chart-area"
        />
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          className="exp-chart-line"
          style={{ filter: tip !== null ? `drop-shadow(0 0 4px ${color})` : "none" }}
        />
        {active && (
          <line
            x1={active.x}
            y1={pad}
            x2={active.x}
            y2={height - pad}
            stroke="rgba(255,255,255,0.16)"
            strokeWidth="1"
          />
        )}
        <circle
          cx={(active ?? last).x}
          cy={(active ?? last).y}
          r="3.5"
          fill="#1B1716"
          stroke={color}
          strokeWidth="2"
        />
      </svg>
      <div
        className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-white/10 bg-[#26201e]/95 px-2 py-1 text-[11px] font-semibold text-ink shadow-lg backdrop-blur-sm transition-opacity duration-200 tabular-nums"
        style={{
          left: `${(((active ?? last).x - 0) / w) * 100}%`,
          opacity: active ? 1 : 0,
        }}
      >
        {active ? `${active.v.toLocaleString("en-US")}${unit}` : ""}
        {active && labels?.[tip!] && (
          <span className="ml-1 font-normal text-ink-2">{labels[tip!]}</span>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------- Bars ---------------------------------- */

function roundedBar(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h);
  return `M ${x} ${y + h} L ${x} ${y + rr} Q ${x} ${y} ${x + rr} ${y} L ${x + w - rr} ${y} Q ${x + w} ${y} ${x + w} ${y + rr} L ${x + w} ${y + h} Z`;
}

export function Bars({
  data,
  labels,
  accent = "azure",
  height = 84,
  highlight,
}: {
  data: number[];
  labels?: string[];
  accent?: string;
  height?: number;
  highlight?: number;
}) {
  const color = accentColor(accent);
  const w = 240;
  const chartH = labels ? height - 16 : height;
  const max = Math.max(...data) || 1;
  const gap = 2;
  // Few bars spread wide so their labels breathe; many bars stay slim.
  const bw = Math.min(data.length <= 6 ? 34 : 18, (w - gap * (data.length - 1)) / data.length);
  const totalW = bw * data.length + gap * (data.length - 1);
  const x0 = (w - totalW) / 2;
  const [hov, setHov] = useState<number | null>(null);

  return (
    <div className="relative flex h-full w-full flex-col">
      <svg viewBox={`0 0 ${w} ${chartH}`} className="min-h-0 w-full flex-1" preserveAspectRatio="none">
        {data.map((v, i) => {
          const h = Math.max(4, (v / max) * (chartH - 8));
          const x = x0 + i * (bw + gap);
          const isHi = highlight === i || hov === i;
          return (
            <path
              key={i}
              d={roundedBar(x, chartH - h, bw, h, 4)}
              fill={isHi ? color : `color-mix(in oklab, ${color} 38%, #1B1716)`}
              className="exp-chart-bar"
              style={{ transformOrigin: `${x + bw / 2}px ${chartH}px` }}
              onPointerEnter={() => setHov(i)}
              onPointerLeave={() => setHov(null)}
            />
          );
        })}
      </svg>
      {/* Labels live in HTML so the stretched SVG never distorts the glyphs. */}
      {labels && (
        <div className="relative h-4 shrink-0">
          {labels.map((l, i) => (
            <span
              key={i}
              className="absolute top-0.5 -translate-x-1/2 whitespace-nowrap text-[9px] text-ink-3"
              style={{ left: `${((x0 + i * (bw + gap) + bw / 2) / w) * 100}%` }}
            >
              {l}
            </span>
          ))}
        </div>
      )}
      {hov !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-white/10 bg-[#26201e]/95 px-2 py-1 text-[11px] font-semibold text-ink shadow-lg backdrop-blur-sm tabular-nums"
          style={{ left: `${((x0 + hov * (bw + gap) + bw / 2) / w) * 100}%` }}
        >
          {data[hov].toLocaleString("en-US")}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- Donut ---------------------------------- */

export function Donut({
  value,
  display,
  suffix = "%",
  decimals = 0,
  accent = "gold",
  label,
  size = 92,
}: {
  /** arc fill 0..100 */
  value: number;
  /** number shown in the center (defaults to `value`) */
  display?: number;
  suffix?: string;
  decimals?: number;
  accent?: string;
  label?: string;
  size?: number;
}) {
  const color = accentColor(accent);
  const shown = display ?? value;
  const r = 38;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex h-full items-center justify-center gap-4">
      <svg viewBox="0 0 100 100" style={{ width: size, height: size }} className="-rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#2A2422" strokeWidth="9" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value / 100)}
          className="exp-donut"
          data-donut-to={c * (1 - value / 100)}
          style={{ strokeDashoffset: c }}
        />
      </svg>
      <div className="flex flex-col">
        <span
          className="exp-count text-[26px] font-bold leading-none text-ink tabular-nums"
          data-count-to={shown}
          data-count-suffix={suffix}
          data-count-decimals={decimals}
        >
          {(0).toFixed(decimals)}
          {suffix}
        </span>
        {label && <span className="mt-1 text-[12px] text-ink-2">{label}</span>}
      </div>
    </div>
  );
}

/* ----------------------------------- Heat ---------------------------------- */

/** Sequential single-hue (light→dark) intensity grid. */
export function Heat({
  grid,
  rowLabels,
  colLabels,
  accentVar = "--gold-deep",
}: {
  grid: number[][];
  rowLabels?: string[];
  colLabels?: string[];
  accentVar?: string;
}) {
  const max = Math.max(...grid.flat()) || 1;
  const [hov, setHov] = useState<string | null>(null);
  return (
    <div className="flex h-full flex-col justify-center gap-1.5">
      {grid.map((row, ri) => (
        <div key={ri} className="flex items-center gap-2">
          {rowLabels && (
            <span className="w-14 shrink-0 text-right text-[9px] text-ink-3">{rowLabels[ri]}</span>
          )}
          <div className="grid flex-1 gap-1" style={{ gridTemplateColumns: `repeat(${row.length}, 1fr)` }}>
            {row.map((v, ci) => (
              <div
                key={ci}
                className="aspect-square min-h-0 rounded-[4px] transition-transform duration-200"
                onPointerEnter={() => setHov(`${v}`)}
                onPointerLeave={() => setHov(null)}
                style={{
                  background: `color-mix(in oklab, var(${accentVar}) ${Math.round((v / max) * 88)}%, #221C1A)`,
                }}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2">
        {rowLabels && <span className="w-14 shrink-0" />}
        {colLabels && (
          <div className="flex flex-1 justify-between text-[9px] text-ink-3">
            {colLabels.map((l, i) => (
              <span key={i}>{l}</span>
            ))}
          </div>
        )}
        <span className="ml-auto text-[9px] font-semibold text-ink-2 tabular-nums">
          {hov ? `${hov}%` : ""}
        </span>
      </div>
    </div>
  );
}

/* ---------------------------------- Rows ----------------------------------- */

export function Rows({
  items,
}: {
  items: { label: string; value: string; accent?: string; pct?: number }[];
}) {
  return (
    <div className="flex h-full flex-col justify-center gap-2">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-2 text-[12px]">
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: accentColor(it.accent ?? "neutral") }}
          />
          <span className="flex-1 truncate text-ink-2">{it.label}</span>
          {it.pct !== undefined && (
            <span className="h-1 w-14 overflow-hidden rounded-full bg-white/[0.08]">
              <span
                className="exp-row-bar block h-full origin-left rounded-full"
                style={{ background: accentColor(it.accent ?? "gold"), width: `${it.pct}%` }}
              />
            </span>
          )}
          <span className="font-semibold text-ink tabular-nums">{it.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------- Chips ---------------------------------- */

// 12% tints behind chips, matching the product's AppColors.tint() rule.
const CHIP_STYLE: Record<string, { bg: string; dot: string }> = {
  copper: { bg: "rgba(227,184,155,0.12)", dot: "var(--copper-hi)" },
  success: { bg: "rgba(143,178,124,0.12)", dot: "var(--rf-success)" },
  warning: { bg: "rgba(217,169,98,0.12)", dot: "var(--rf-warning)" },
  danger: { bg: "rgba(201,123,110,0.12)", dot: "var(--rf-danger)" },
  info: { bg: "rgba(143,163,184,0.12)", dot: "var(--rf-info)" },
  neutral: { bg: "rgba(255,255,255,0.06)", dot: "var(--ink-3)" },
};

export function Chips({ items }: { items: { label: string; accent?: string }[] }) {
  return (
    <div className="flex h-full flex-wrap content-center gap-1.5">
      {items.map((it) => {
        const s = CHIP_STYLE[it.accent ?? "neutral"] ?? CHIP_STYLE.neutral;
        return (
          <span
            key={it.label}
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-ink"
            style={{ background: s.bg }}
          >
            <span className="size-1.5 rounded-full" style={{ background: s.dot }} />
            {it.label}
          </span>
        );
      })}
    </div>
  );
}

/* --------------------------------- Timeline -------------------------------- */

export function Timeline({
  items,
}: {
  items: { time: string; label: string; accent?: string }[];
}) {
  return (
    <div className="flex h-full flex-col justify-center gap-2.5">
      {items.map((it, i) => (
        <div key={i} className="relative flex items-center gap-3 text-[12px]">
          <span className="w-9 shrink-0 text-[10px] text-ink-3 tabular-nums">{it.time}</span>
          <span className="relative flex size-2 shrink-0 items-center justify-center">
            <span
              className="size-2 rounded-full border-2 bg-[#1B1716]"
              style={{ borderColor: accentColor(it.accent ?? "copper") }}
            />
            {i < items.length - 1 && (
              <span className="absolute left-1/2 top-2 h-4 w-px -translate-x-1/2 bg-white/[0.08]" />
            )}
          </span>
          <span className="truncate text-ink-2">{it.label}</span>
        </div>
      ))}
    </div>
  );
}
