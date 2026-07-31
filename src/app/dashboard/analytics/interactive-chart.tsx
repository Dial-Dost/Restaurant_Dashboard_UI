"use client"

// ---------------------------------------------------------------------------
// InteractiveChart — the one chart primitive every analytics series renders
// through, so hover and click behave identically on every card.
//
// What it adds over a bare recharts chart:
//   * a rich HOVER TOOLTIP: exact value, label, the date/time caption, share of
//     total, change vs the previous point, rank within the series and any extra
//     context lines the caller passes. It is a single persistent node whose
//     position/opacity are transitioned, so moving between points slides rather
//     than flickers.
//   * CLICK-TO-DRILL-DOWN on every element (bar / line point) via `onSelect` —
//     the caller opens the page's shared MetricDetailDialog with that point.
//   * KEYBOARD + POINTER affordances: the plot area carries one real <button>
//     per data point ("hotspots"), so a point is tabbable, shows a focus ring,
//     opens the drill-down on Enter/Space and carries an aria-label spelling out
//     the whole tooltip. Hover and focus drive the SAME `active` index, so the
//     keyboard user sees exactly what the mouse user sees.
//
// Geometry: the hotspot strip is positioned from constants that are also handed
// to recharts (margin + explicit axis sizes), so the strip lines up with the
// plot area without measuring anything inside the SVG. Category axes are evenly
// banded, so N equal flex children land on the N bands / points.
// ---------------------------------------------------------------------------

import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts"
import { useEffect, useRef, useState } from "react"
import { ArrowDown, ArrowUp, Minus, MousePointerClick } from "lucide-react"

const MARGIN = { top: 10, right: 14, left: 4, bottom: 4 }
const Y_AXIS_WIDTH = 52
const X_AXIS_HEIGHT = 26
// Plot-area insets, in px, derived from the values above.
const PLOT = {
  left: MARGIN.left + Y_AXIS_WIDTH,
  right: MARGIN.right,
  top: MARGIN.top,
  bottom: MARGIN.bottom + X_AXIS_HEIGHT,
}

/** An extra context line in the tooltip (and in the point's aria-label). */
export interface IvMeta { label: string; value: string }

/** One element of a series — a bar, or a point on a line. */
export interface IvPoint {
  /** Stable react key. */
  key: string
  /** Axis label, and the tooltip title. */
  label: string
  value: number
  /** Date / time / secondary label shown under the tooltip title. */
  caption?: string
  /** Extra "label: value" rows — revenue behind an order count, covers behind a bill, … */
  meta?: IvMeta[]
}

const ordinal = (n: number): string => {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) {return `${n}th`}
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

const pct1 = (n: number) => `${Math.round(n * 10) / 10}%`

interface Derived {
  share: number | null
  deltaPct: number | null
  deltaAbs: number | null
  prevLabel: string | null
  rank: number
}

function derive(points: IvPoint[], i: number): Derived {
  const total = points.reduce((s, p) => s + (Number.isFinite(p.value) ? p.value : 0), 0)
  const v = points[i]?.value ?? 0
  const prev = i > 0 ? points[i - 1] : null
  const deltaAbs = prev ? v - prev.value : null
  const deltaPct = prev && prev.value !== 0 ? ((v - prev.value) / Math.abs(prev.value)) * 100 : null
  const rank = 1 + points.filter((p) => p.value > v).length
  return {
    share: total > 0 ? (v / total) * 100 : null,
    deltaAbs,
    deltaPct,
    prevLabel: prev?.label ?? null,
    rank,
  }
}

/** The full sentence a screen reader hears for a point — same facts as the tooltip. */
function pointDescription(points: IvPoint[], i: number, seriesLabel: string, fmt: (n: number) => string, showShare: boolean): string {
  const p = points[i]
  if (!p) {return ""}
  const d = derive(points, i)
  const bits = [`${p.label}: ${fmt(p.value)} ${seriesLabel}`]
  if (p.caption) {bits.push(p.caption)}
  if (showShare && d.share != null) {bits.push(`${pct1(d.share)} of total`)}
  bits.push(`ranked ${ordinal(d.rank)} of ${points.length}`)
  for (const m of p.meta ?? []) {bits.push(`${m.label} ${m.value}`)}
  bits.push("press Enter for a detailed breakdown")
  return bits.join(", ")
}

export interface InteractiveChartProps {
  kind: "bar" | "line"
  points: IvPoint[]
  /** Formats a value everywhere it appears (tooltip, aria-label, axis). */
  fmt: (n: number) => string
  /** What one value IS ("orders", "revenue") — used in the tooltip and aria-label. */
  seriesLabel: string
  /** Accessible name for the whole chart. */
  chartLabel: string
  color?: string
  height?: number
  showShare?: boolean
  showDelta?: boolean
  /** Shorter formatter for axis ticks; falls back to `fmt`. */
  tickFmt?: (n: number) => string
  /** recharts XAxis `interval` — thins crowded category labels. */
  xInterval?: number
  /** Opens the drill-down. Omit to render a hover-only chart. */
  onSelect?: (point: IvPoint, index: number) => void
}

export function InteractiveChart({
  kind,
  points,
  fmt,
  seriesLabel,
  chartLabel,
  color = "hsl(var(--primary))",
  height = 280,
  showShare = true,
  showDelta = true,
  tickFmt,
  xInterval,
  onSelect,
}: InteractiveChartProps) {
  const [active, setActive] = useState<number | null>(null)
  // Kept so the tooltip can fade OUT with its last content instead of blanking.
  const [shown, setShown] = useState(0)
  const [width, setWidth] = useState(0)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) {return}
    const measure = () => { setWidth(el.clientWidth) }
    measure()
    if (typeof ResizeObserver === "undefined") {return}
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => { ro.disconnect() }
  }, [])

  useEffect(() => { if (active != null) {setShown(active)} }, [active])

  if (points.length === 0) {return null}

  const data = points.map((p) => ({ label: p.label, value: Number.isFinite(p.value) ? p.value : 0 }))
  const axisTick = { fill: "hsl(var(--muted-foreground))", fontSize: 11 }
  const fmtTick = tickFmt ?? fmt

  // Hotspot band centre for the tooltip, clamped so it never leaves the card.
  const plotWidth = Math.max(0, width - PLOT.left - PLOT.right)
  const band = points.length > 0 ? plotWidth / points.length : 0
  const rawX = PLOT.left + band * (shown + 0.5)
  const tipX = width > 0 ? Math.min(Math.max(rawX, 104), Math.max(104, width - 104)) : 0

  const p = points[shown]
  const d = p ? derive(points, shown) : null
  const activePoint = active != null ? points[active] : null

  const renderDot = (props: { cx?: number; cy?: number; index?: number }) => {
    const { cx, cy, index } = props
    const key = `dot-${index ?? 0}`
    if (index !== active || cx == null || cy == null) {return <g key={key} />}
    return <circle key={key} cx={cx} cy={cy} r={5} fill={color} stroke="hsl(var(--background))" strokeWidth={2} />
  }

  return (
    <div ref={wrapRef} className="relative w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {kind === "bar" ? (
          <BarChart data={data} margin={MARGIN}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="label" height={X_AXIS_HEIGHT} interval={xInterval} tickLine={false} axisLine={false} tick={axisTick} />
            <YAxis width={Y_AXIS_WIDTH} tickLine={false} axisLine={false} tick={axisTick} tickFormatter={(v: number) => fmtTick(Number(v))} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive>
              {points.map((pt, i) => (
                <Cell key={pt.key} fill={color} fillOpacity={active == null ? 0.9 : active === i ? 1 : 0.3} />
              ))}
            </Bar>
          </BarChart>
        ) : (
          <LineChart data={data} margin={MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="label" height={X_AXIS_HEIGHT} interval={xInterval} tickLine={false} axisLine={false} tick={axisTick} />
            <YAxis width={Y_AXIS_WIDTH} tickLine={false} axisLine={false} tick={axisTick} tickFormatter={(v: number) => fmtTick(Number(v))} />
            {activePoint && <ReferenceLine x={activePoint.label} stroke={color} strokeDasharray="4 4" strokeOpacity={0.7} />}
            <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={renderDot} activeDot={false} isAnimationActive />
          </LineChart>
        )}
      </ResponsiveContainer>

      {/* Hover / focus / click surface: one real button per data point. */}
      <div
        className="absolute flex"
        style={{ left: PLOT.left, right: PLOT.right, top: PLOT.top, bottom: PLOT.bottom }}
        role="group"
        aria-label={chartLabel}
      >
        {points.map((pt, i) => (
          <button
            key={pt.key}
            type="button"
            className={`min-w-0 flex-1 rounded-sm p-0 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background ${onSelect ? "cursor-pointer" : "cursor-default"} ${active === i ? "bg-foreground/[0.07]" : "bg-transparent"}`}
            aria-label={pointDescription(points, i, seriesLabel, fmt, showShare)}
            onMouseEnter={() => { setActive(i) }}
            onMouseLeave={() => { setActive((a) => (a === i ? null : a)) }}
            onFocus={() => { setActive(i) }}
            onBlur={() => { setActive((a) => (a === i ? null : a)) }}
            onClick={() => { onSelect?.(pt, i) }}
          />
        ))}
      </div>

      {/* One persistent tooltip node — position and opacity are transitioned, so
          sweeping the series slides the card rather than remounting it. */}
      {p && d && (
        <div
          className="pointer-events-none absolute z-20 min-w-[190px] max-w-[250px] rounded-lg border border-border/60 bg-background/95 px-3 py-2 text-xs shadow-xl backdrop-blur"
          style={{
            left: tipX,
            top: 4,
            transform: `translateX(-50%) translateY(${active != null ? 0 : 6}px) scale(${active != null ? 1 : 0.97})`,
            opacity: active != null ? 1 : 0,
            visibility: width > 0 ? "visible" : "hidden",
            transition: "left 160ms cubic-bezier(.2,.7,.3,1), opacity 150ms ease-out, transform 150ms ease-out",
          }}
          aria-hidden="true"
        >
          <div className="truncate font-semibold text-foreground">{p.label}</div>
          {p.caption && <div className="truncate text-[10px] text-muted-foreground">{p.caption}</div>}
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: color }} />
            <span className="text-base font-bold tabular-nums text-foreground">{fmt(p.value)}</span>
            <span className="truncate text-[10px] text-muted-foreground">{seriesLabel}</span>
          </div>
          <div className="mt-1.5 space-y-0.5 border-t pt-1.5">
            {showShare && d.share != null && (
              <TipRow label="Share of total" value={pct1(d.share)} />
            )}
            {showDelta && d.deltaAbs != null && (
              <TipRow
                label={`vs ${d.prevLabel ?? "previous"}`}
                value={
                  <span className={`inline-flex items-center gap-0.5 font-medium ${d.deltaAbs > 0 ? "text-green-600 dark:text-green-400" : d.deltaAbs < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                    {d.deltaAbs > 0 ? <ArrowUp className="h-3 w-3" /> : d.deltaAbs < 0 ? <ArrowDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                    {fmt(Math.abs(d.deltaAbs))}
                    {d.deltaPct != null && ` (${pct1(Math.abs(d.deltaPct))})`}
                  </span>
                }
              />
            )}
            <TipRow label="Rank" value={`${ordinal(d.rank)} of ${points.length}`} />
            {(p.meta ?? []).map((m) => (
              <TipRow key={m.label} label={m.label} value={m.value} />
            ))}
          </div>
          {onSelect && (
            <div className="mt-1.5 flex items-center gap-1 border-t pt-1.5 text-[10px] text-muted-foreground">
              <MousePointerClick className="h-3 w-3" />
              Click for the full breakdown
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TipRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="truncate text-[10px] text-muted-foreground">{label}</span>
      <span className="shrink-0 text-[11px] tabular-nums text-foreground">{value}</span>
    </div>
  )
}
