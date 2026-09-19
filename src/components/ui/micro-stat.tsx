import * as React from "react"
import { ArrowDown, ArrowUp } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Tiny stacked metadata (metric_tag.dart MicroStat): a 13px w600 value with
 * the letter-spaced uppercase micro label underneath — the "30,000 / CROWD
 * SIZE" pattern from the reference top bar.
 */
export interface MicroStatProps extends React.HTMLAttributes<HTMLDivElement> {
  value: React.ReactNode
  label: React.ReactNode
  icon?: React.ReactNode
  alignEnd?: boolean
}

function MicroStat({ value, label, icon, alignEnd = false, className, ...props }: MicroStatProps): React.JSX.Element {
  return (
    <div
      className={cn("flex min-w-0 flex-col gap-[3px]", alignEnd ? "items-end" : "items-start", className)}
      {...props}
    >
      <span className="flex min-w-0 items-center gap-[5px]">
        {icon != null && (
          <span aria-hidden className="shrink-0 text-muted-foreground [&>svg]:h-[13px] [&>svg]:w-[13px]">
            {icon}
          </span>
        )}
        <span className="min-w-0 truncate text-[13px] font-semibold tracking-[0.1px] text-foreground tabular-nums">
          {value}
        </span>
      </span>
      {/* The caption wraps rather than truncates — it is the only place the
          stat says WHAT it is. */}
      <span className={cn("micro-label", alignEnd && "text-right")}>{label}</span>
    </div>
  )
}

/**
 * Small up/down delta text (metric_tag.dart DeltaText) — "▲ 12.4% vs last
 * week". Colours by GOOD/BAD, not by direction: set `invert` when a rise is
 * bad (voids, refunds, wait time). Replaces the ad-hoc green/red spans.
 */
export interface DeltaTextProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Positive is good by default. */
  pct: number
  suffix?: string
  /** A rise is bad here (costs, cancellations…). */
  invert?: boolean
}

function DeltaText({ pct, suffix = "", invert = false, className, ...props }: DeltaTextProps): React.JSX.Element {
  const up = pct >= 0
  const good = invert ? !up : up
  const Arrow = up ? ArrowUp : ArrowDown
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[11.5px] font-semibold tracking-[0.2px] tabular-nums",
        good ? "text-success" : "text-destructive",
        className
      )}
      {...props}
    >
      <Arrow aria-hidden className="h-3 w-3" />
      {Math.abs(pct).toFixed(1)}%{suffix}
    </span>
  )
}

export { MicroStat, DeltaText }
