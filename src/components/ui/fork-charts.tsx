"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * ── The chart language (charts.dart) ─────────────────────────────────
 * Every chart in the system is SINGLE-HUE SEQUENTIAL on the accent ramp:
 * taller/greater = lighter, baseline-anchored marks with rounded data ends,
 * gridlines never louder than 5% ink. Identity is carried by position +
 * labels, never by extra hues. All marks obey the control-honesty rule: a
 * mark with no `onSelect` and no `tooltip` never pretends to be a control —
 * no cursor, no hover lift, no hit box.
 *
 * SVG/CSS on the theme tokens, so the accent picker and Gaia's champagne
 * ramp recolour every chart with no code.
 */

/* ── shared plumbing ────────────────────────────────────────────────── */

function useMeasuredWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = React.useRef<T | null>(null)
  const [width, setWidth] = React.useState(0)
  React.useEffect(() => {
    const el = ref.current
    if (!el) { return }
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      setWidth(w)
    })
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => { ro.disconnect() }
  }, [])
  return [ref, width]
}

/** True after mount — drives the 400–700ms ease-out entrance the app's bars have. */
function useEntered(): boolean {
  const [entered, setEntered] = React.useState(false)
  React.useEffect(() => {
    const id = requestAnimationFrame(() => { setEntered(true) })
    return () => { cancelAnimationFrame(id) }
  }, [])
  return entered
}

/** Sequential ramp colour by magnitude: 0 = shadow stop, 1 = hi stop. */
function rampColor(frac: number): string {
  const t = Math.round(Math.pow(Math.min(1, Math.max(0, frac)), 1.3) * 100)
  return `color-mix(in srgb, hsl(var(--accent-hi)) ${t}%, hsl(var(--accent-shadow)))`
}

/** The hover card every mark shares: raised surface, strong hairline, 12px ink. */
function ChartTip({ leftPct, children }: { leftPct: number; children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      className="pointer-events-none absolute -top-1.5 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[10px] border border-input bg-popover px-2.5 py-1.5 text-xs text-foreground shadow-md gaia:rounded-[2px]"
      style={{ left: `min(max(${leftPct}%, 12%), 88%)` }}
      role="status"
    >
      {children}
    </div>
  )
}

interface MarkInteraction {
  /** Drill into the reading. Absent = the mark stays a plain visual. */
  onSelect?: (index: number) => void
  /** What the hover card says. Absent (with no onSelect) = no hover at all. */
  tooltip?: (index: number) => React.ReactNode
}

/* ── Sparkline ──────────────────────────────────────────────────────── */

export interface SparklineProps {
  values: number[]
  height?: number
  /** Any CSS colour; defaults to the accent's hi stop. */
  color?: string
  className?: string
}

/** 2px accent line with a soft fade fill and a ringed end dot. */
export function Sparkline({ values, height = 40, color, className }: SparklineProps): React.JSX.Element {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>()
  const c = color ?? "hsl(var(--accent-hi))"
  const gradientId = React.useId()

  let content: React.ReactNode = null
  if (values.length >= 2 && width > 0) {
    const minV = Math.min(...values)
    const maxV = Math.max(...values)
    const span = maxV - minV === 0 ? 1 : maxV - minV
    const pts = values.map((v, i) => [
      (i / (values.length - 1)) * width,
      height - ((v - minV) / span) * (height * 0.82) - height * 0.06,
    ])
    let d = `M ${pts[0][0]} ${pts[0][1]}`
    for (let i = 1; i < pts.length; i++) {
      const [px, py] = pts[i - 1]
      const [x, y] = pts[i]
      const midX = (px + x) / 2
      d += ` C ${midX} ${py}, ${midX} ${y}, ${x} ${y}`
    }
    const fill = `${d} L ${width} ${height} L 0 ${height} Z`
    const [ex, ey] = pts[pts.length - 1]
    content = (
      <svg width={width} height={height} className="block overflow-visible">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={c} stopOpacity={0.18} />
            <stop offset="1" stopColor={c} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={fill} fill={`url(#${gradientId})`} />
        <path d={d} fill="none" stroke={c} strokeWidth={2} strokeLinecap="round" />
        {/* End dot with a surface ring so it separates from the line. */}
        <circle cx={ex} cy={ey} r={4.5} fill="hsl(var(--card))" />
        <circle cx={ex} cy={ey} r={3} fill={c} />
      </svg>
    )
  }
  return (
    <div data-chart ref={ref} className={cn("w-full", className)} style={{ height }} aria-hidden>
      {content}
    </div>
  )
}

/* ── Barcode ────────────────────────────────────────────────────────── */

export interface BarcodeProps extends MarkInteraction {
  values: number[]
  height?: number
  barWidth?: number
  gap?: number
  /** Muted variant for secondary cards. */
  dimmed?: boolean
  className?: string
}

/** How many bars fit — hit-testing derives the count the same way. */
function barcodeCount(width: number, slot: number, gap: number): number {
  return Math.max(1, Math.floor((width + gap) / slot))
}

/** The source reading a resampled bar was drawn from. */
function barcodeSource(bar: number, count: number, length: number): number {
  if (length <= 1) { return 0 }
  const t = count === 1 ? 0 : bar / (count - 1)
  return Math.min(length - 1, Math.max(0, Math.round(t * (length - 1))))
}

/**
 * Dense "barcode" strip — dozens of 2.6px bars, the most recognisable chart
 * in the design. Hover lights the whole slot (a 2.6px bar cannot carry a
 * hover state alone); tap drills into the SOURCE reading, so callers never
 * know how many bars fit.
 */
export function Barcode({
  values,
  height = 46,
  barWidth = 2.6,
  gap = 2.4,
  dimmed = false,
  onSelect,
  tooltip,
  className,
}: BarcodeProps): React.JSX.Element {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>()
  const [hover, setHover] = React.useState<number | null>(null)
  const live = onSelect != null || tooltip != null

  const slot = barWidth + gap
  const count = width > 0 ? barcodeCount(width, slot, gap) : 0
  const maxV = values.length ? Math.max(...values) : 0

  const bars: React.ReactNode[] = []
  if (count > 0 && maxV > 0) {
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1)
      const srcPos = t * (values.length - 1)
      const lo = Math.floor(srcPos)
      const hi = Math.min(lo + 1, values.length - 1)
      const v = values[lo] + (values[hi] - values[lo]) * (srcPos - lo)
      const frac = Math.min(1, Math.max(0.06, v / maxV))
      const hot = live && hover === i
      bars.push(
        <div
          key={i}
          className="absolute bottom-0 rounded-[1.4px]"
          style={{
            left: i * slot,
            width: barWidth,
            height: `${frac * 100}%`,
            background: hot ? "hsl(var(--accent-hi))" : rampColor(frac),
            opacity: !hot && dimmed ? 0.45 : 1,
          }}
        />
      )
    }
  }

  return (
    <div data-chart
      ref={ref}
      aria-hidden={!live}
      className={cn("relative w-full", className)}
      style={{ height }}
      onMouseLeave={live ? () => { setHover(null) } : undefined}
    >
      {bars}
      {/* Slot hit boxes — only when the strip is live. */}
      {live && count > 0 && values.length > 0 &&
        Array.from({ length: count }, (_, i) => {
          if (width - i * slot <= 0) { return null }
          return (
            <Hit
              key={i}
              tabIndex={-1}
              label={`Reading ${barcodeSource(i, count, values.length) + 1}`}
              className={cn(
                "absolute inset-y-0 rounded-[2px]",
                onSelect ? "cursor-pointer" : "cursor-default",
                hover === i && "bg-foreground/[0.07]"
              )}
              style={{ left: i * slot - gap / 2, width: Math.min(slot, width - i * slot) }}
              onMouseEnter={() => { setHover(i) }}
              onClick={onSelect ? () => { onSelect(barcodeSource(i, count, values.length)) } : undefined}
            />
          )
        })}
      {live && hover != null && tooltip != null && count > 0 && (
        <ChartTip leftPct={((hover + 0.5) / count) * 100}>
          {tooltip(barcodeSource(hover, count, values.length))}
        </ChartTip>
      )}
    </div>
  )
}

/* ── WeekdayBars ────────────────────────────────────────────────────── */

export interface WeekdayBarsProps extends MarkInteraction {
  values: number[]
  labels?: string[]
  /** Index rendered in the bright stop (e.g. today). */
  highlight?: number
  height?: number
  className?: string
}

/** Seven (or n) bars with single-letter labels — the "S M T W T F S" chart. */
export function WeekdayBars({
  values,
  labels = ["S", "M", "T", "W", "T", "F", "S"],
  highlight,
  height = 56,
  onSelect,
  tooltip,
  className,
}: WeekdayBarsProps): React.JSX.Element {
  const [hover, setHover] = React.useState<number | null>(null)
  const entered = useEntered()
  const live = onSelect != null || tooltip != null
  const rawMax = values.length ? Math.max(...values) : 0
  const maxV = rawMax > 0 ? rawMax : 1
  const barArea = height - 22 // 6px gap + label line, out of the fixed box

  return (
    <div data-chart
      className={cn("relative flex w-full items-end gap-1.5", className)}
      style={{ height }}
      onMouseLeave={live ? () => { setHover(null) } : undefined}
      aria-hidden={!live}
    >
      {values.map((v, i) => {
        const frac = Math.min(1, Math.max(0.05, v / maxV))
        const hot = (live && hover === i) || i === highlight
        const bar = (
          <>
            <div
              className="w-full rounded-t-[2.5px] transition-all duration-base ease-out"
              style={{
                height: entered ? frac * barArea + (live && hover === i ? 4 : 0) : 0,
                background: hot
                  ? "linear-gradient(180deg, hsl(var(--accent-hi)), hsl(var(--accent-mid)))"
                  : "linear-gradient(180deg, hsl(var(--accent-deep)), hsl(var(--accent-shadow)/0.8))",
              }}
            />
            <div
              className={cn(
                "mt-1.5 text-center text-[8.5px] font-semibold tracking-[0.5px]",
                hot ? "text-accent-hi" : "text-tertiary"
              )}
            >
              {labels[i] ?? ""}
            </div>
          </>
        )
        return live ? (
          <Hit
            key={i}
            tabIndex={-1}
            label={labels[i] ?? String(i + 1)}
            className={cn("flex min-w-0 flex-1 flex-col justify-end self-stretch", onSelect ? "cursor-pointer" : "cursor-default")}
            onMouseEnter={() => { setHover(i) }}
            onClick={onSelect ? () => { onSelect(i) } : undefined}
          >
            {bar}
          </Hit>
        ) : (
          <div key={i} className="flex min-w-0 flex-1 flex-col justify-end self-stretch">
            {bar}
          </div>
        )
      })}
      {live && hover != null && tooltip != null && values.length > 0 && (
        <ChartTip leftPct={((hover + 0.5) / values.length) * 100}>{tooltip(hover)}</ChartTip>
      )}
    </div>
  )
}

/* ── Columns ────────────────────────────────────────────────────────── */

export interface ColumnsProps extends MarkInteraction {
  values: number[]
  labels: string[]
  height?: number
  /** The peak column always shows its value; hover reveals the others'. */
  formatValue?: (value: number) => string
  className?: string
}

/** Vertical bars with value + axis labels — Reports' monthly revenue, peak hours. */
export function Columns({
  values,
  labels,
  height = 140,
  formatValue,
  onSelect,
  tooltip,
  className,
}: ColumnsProps): React.JSX.Element {
  const [hover, setHover] = React.useState<number | null>(null)
  const entered = useEntered()
  const live = onSelect != null || tooltip != null
  const rawMax = values.length ? Math.max(...values) : 0
  const maxV = rawMax > 0 ? rawMax : 1
  const peak = rawMax > 0 ? values.indexOf(rawMax) : -1
  const barArea = height - 40

  return (
    <div data-chart
      className={cn("relative flex w-full items-end gap-2", className)}
      style={{ height }}
      onMouseLeave={live ? () => { setHover(null) } : undefined}
      aria-hidden={!live}
    >
      {values.map((v, i) => {
        const frac = Math.min(1, Math.max(0.04, v / maxV))
        const hot = i === peak || (live && hover === i)
        const showValue = (i === peak || (live && hover === i)) && formatValue != null
        const col = (
          <>
            {showValue && (
              <div
                className={cn(
                  "mb-[5px] text-center text-[10px] font-semibold tracking-[0.3px] tabular-nums",
                  live && hover === i ? "text-foreground" : "text-accent-hi"
                )}
              >
                {formatValue(v)}
              </div>
            )}
            <div
              className="w-full rounded-t-[3px] transition-all ease-out"
              style={{
                transitionDuration: "400ms",
                transitionDelay: entered ? "0ms" : `${i * 40}ms`,
                height: entered ? frac * barArea + (live && hover === i ? 5 : 0) : 0,
                background: hot
                  ? "linear-gradient(180deg, hsl(var(--accent-hi)), hsl(var(--accent-mid)))"
                  : `linear-gradient(180deg, ${rampColor((v / maxV) * 0.4)}, hsl(var(--accent-shadow)))`,
              }}
            />
            <div
              className={cn(
                "mt-[7px] truncate text-center text-[9.5px] font-medium tracking-[0.4px]",
                live && hover === i ? "text-accent-hi" : "text-tertiary"
              )}
            >
              {labels[i] ?? ""}
            </div>
          </>
        )
        return live ? (
          <Hit
            key={i}
            tabIndex={-1}
            label={labels[i] ?? String(i + 1)}
            className={cn("flex min-w-0 flex-1 flex-col justify-end self-stretch", onSelect ? "cursor-pointer" : "cursor-default")}
            onMouseEnter={() => { setHover(i) }}
            onClick={onSelect ? () => { onSelect(i) } : undefined}
          >
            {col}
          </Hit>
        ) : (
          <div key={i} className="flex min-w-0 flex-1 flex-col justify-end self-stretch">
            {col}
          </div>
        )
      })}
      {live && hover != null && tooltip != null && values.length > 0 && (
        <ChartTip leftPct={((hover + 0.5) / values.length) * 100}>{tooltip(hover)}</ChartTip>
      )}
    </div>
  )
}

/* ── Donut ──────────────────────────────────────────────────────────── */

export interface DonutProps {
  /** 0..1 */
  fraction: number
  size?: number
  stroke?: number
  /** Ring colour; defaults to the accent's hi stop. */
  color?: string
  /** Centre content; defaults to the percentage. */
  center?: React.ReactNode
  /** Micro label under the gauge. */
  label?: React.ReactNode
  /** One figure = one target; no per-mark index. */
  onSelect?: () => void
  tooltip?: React.ReactNode
  className?: string
}

/** Thin ring gauge with the value in the centre. */
export function Donut({
  fraction,
  size = 52,
  stroke = 4,
  color,
  center,
  label,
  onSelect,
  tooltip,
  className,
}: DonutProps): React.JSX.Element {
  const [hover, setHover] = React.useState(false)
  const entered = useEntered()
  const live = onSelect != null || tooltip != null
  const c = color ?? "hsl(var(--accent-hi))"
  const clamped = Math.min(1, Math.max(0, fraction))
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const shown = entered ? clamped : 0
  const gradientId = React.useId()

  const ring = (
    <div data-chart
      className={cn("relative transition-transform duration-fast ease-out", live && hover && "scale-[1.06]")}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={`color-mix(in srgb, ${c} 45%, hsl(var(--accent-deep)))`} />
            <stop offset="1" stopColor={c} />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`hsl(var(--foreground)/${live && hover ? 0.14 : 0.07})`}
          strokeWidth={stroke}
        />
        {shown > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - shown)}
            className="transition-all duration-slow ease-out"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {center ?? (
          <span
            className="font-medium tabular-nums text-foreground"
            style={{ fontSize: size * 0.24, letterSpacing: "-0.2px" }}
          >
            {Math.round(clamped * 100)}%
          </span>
        )}
      </div>
    </div>
  )

  const content = label != null ? (
    <div className="flex flex-col items-center gap-1.5">
      {ring}
      <span className="micro-label text-center">{label}</span>
    </div>
  ) : (
    ring
  )

  if (!live) { return <div className={className}>{content}</div> }
  return (
    <div className={cn("relative inline-block", className)}>
      <Hit
        label={typeof tooltip === "string" ? tooltip : "Details"}
        className={cn(onSelect ? "cursor-pointer" : "cursor-default")}
        onMouseEnter={() => { setHover(true) }}
        onMouseLeave={() => { setHover(false) }}
        onClick={onSelect}
      >
        {content}
      </Hit>
      {hover && tooltip != null && <ChartTip leftPct={50}>{tooltip}</ChartTip>}
    </div>
  )
}

/* ── Hit target ─────────────────────────────────────────────────────── */

interface HitProps {
  label?: string
  className?: string
  style?: React.CSSProperties
  tabIndex?: number
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  onClick?: () => void
  children?: React.ReactNode
}

/**
 * A mark's hover target. It is a real <button> only when a click does
 * something: a tooltip-only mark usually sits inside a tappable card that is
 * itself a <button>, and nested buttons are invalid HTML (a hydration error).
 */
function Hit({ label, className, style, tabIndex, onMouseEnter, onMouseLeave, onClick, children }: HitProps): React.JSX.Element {
  if (onClick) {
    return (
      <button
        type="button"
        aria-label={label}
        tabIndex={tabIndex}
        className={className}
        style={style}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={onClick}
      >
        {children}
      </button>
    )
  }
  return (
    <div
      role={label ? "img" : undefined}
      aria-label={label}
      className={className}
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </div>
  )
}

/* ── HBarRow ────────────────────────────────────────────────────────── */

export interface HBarRowProps {
  label: React.ReactNode
  /** 0..1 share of the widest row. */
  fraction: number
  /** The figure at the end of the row, already formatted. */
  value: React.ReactNode
  /** Quiet sub-figure before the value ("31%"). */
  sub?: React.ReactNode
  /** Bar colour; defaults to the accent base. */
  color?: string
  onSelect?: () => void
  tooltip?: React.ReactNode
  className?: string
}

/** Labelled horizontal magnitude bar — "Butter Chicken ───────── 214". */
export function HBarRow({
  label,
  fraction,
  value,
  sub,
  color,
  onSelect,
  tooltip,
  className,
}: HBarRowProps): React.JSX.Element {
  const [hover, setHover] = React.useState(false)
  const entered = useEntered()
  const live = onSelect != null || tooltip != null
  const c = color ?? "hsl(var(--accent-base))"
  const clamped = Math.min(1, Math.max(0, fraction))

  const row = (
    <div data-chart className="w-full py-[7px]">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-left text-[12.5px] font-medium text-foreground">
          {label}
        </span>
        {sub != null && <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{sub}</span>}
        <span className="shrink-0 text-[12.5px] font-semibold text-foreground tabular-nums">{value}</span>
      </div>
      <div className="mt-1.5 h-[5px] overflow-hidden rounded-[3px] bg-foreground/5">
        <div
          className="h-full rounded-[3px] transition-all ease-out"
          style={{
            transitionDuration: "600ms",
            width: `${(entered ? clamped : 0) * 100}%`,
            background: `linear-gradient(90deg, color-mix(in srgb, ${c} 55%, hsl(var(--accent-shadow))), ${c})`,
          }}
        />
      </div>
    </div>
  )

  if (!live) { return <div className={className}>{row}</div> }
  return (
    <div className={cn("relative", className)}>
      <Hit
        className={cn("block w-full", onSelect ? "cursor-pointer" : "cursor-default", hover && "bg-foreground/[0.03]")}
        onMouseEnter={() => { setHover(true) }}
        onMouseLeave={() => { setHover(false) }}
        onClick={onSelect}
      >
        {row}
      </Hit>
      {hover && tooltip != null && <ChartTip leftPct={50}>{tooltip}</ChartTip>}
    </div>
  )
}
