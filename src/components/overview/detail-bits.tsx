"use client"

// Small presentational pieces the Overview reuses across the glance box, the
// drill sheets and the tile grids — web copies of `_TapRow`/`_glanceTap`,
// `_detailRow`, `_kv`, `_metricTile` and `_actionTile` in Flutter's
// modules.dart.

import * as React from "react"
import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { ForkCard } from "@/components/ui/fork-card"

/**
 * Makes an existing block read as a control without changing its geometry:
 * click cursor plus a faint hover wash, no padding, border or chevron of its
 * own — `_TapRow`/`_glanceTap`. One button node for a screen reader, named by
 * `label` rather than by the loose texts inside it.
 */
export function GlanceTap({
  label,
  onTap,
  className,
  children,
}: {
  label: string
  onTap: () => void
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onTap}
      className={cn(
        "block cursor-pointer rounded-[6px] text-left transition-colors duration-fast",
        // A neutral wash, not the copper tint: hover must not impersonate the
        // focus highlight.
        "hover:bg-foreground/[0.04]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    >
      {children}
    </button>
  )
}

/**
 * Quiet label / value line used inside the Overview drill-downs (`_detailRow`).
 * Wraps rather than rows, so a long figure beside its qualifier drops a line
 * instead of truncating the money.
 */
export function DetailRow({
  label,
  value,
  trailing,
}: {
  label: React.ReactNode
  value: React.ReactNode
  trailing?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 py-[5px]">
      <span className="text-[13px] text-foreground">{label}</span>
      <span className="flex flex-wrap items-center gap-x-4">
        {trailing != null && <span className="text-xs text-muted-foreground">{trailing}</span>}
        <span className="text-[13px] font-semibold text-foreground tabular-nums">{value}</span>
      </span>
    </div>
  )
}

/** Token-styled key/value row (`_kv`): letter-spaced micro key, quiet value. */
export function KvRow({ k, v }: { k: string; v: string }): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="micro-label w-[148px] shrink-0 pt-0.5">{k}</span>
      <span className="min-w-0 flex-1 text-[13px] font-medium">{v}</span>
    </div>
  )
}

export type TileTone = "accent" | "danger" | "warning" | "success" | "muted"

const TONE_TEXT: Record<TileTone, string> = {
  accent: "text-accent-foreground",
  danger: "text-destructive",
  warning: "text-warning",
  success: "text-success",
  muted: "text-muted-foreground",
}

/**
 * One dense Overview figure (`_metricTile`): label, number, one qualifying
 * line, and a chevron only when it leads somewhere. `onTap` null renders the
 * tile genuinely inert (no chevron, no hover lift, no click cursor), because a
 * dead tap in a dense grid is worse than an obviously static readout.
 */
export function OverviewMetricTile({
  label,
  value,
  sub,
  subTone = "muted",
  icon,
  accent = "accent",
  onTap,
  className,
}: {
  label: string
  value: string
  sub?: string
  subTone?: TileTone
  icon?: React.ReactNode
  accent?: TileTone
  onTap?: () => void
  className?: string
}): React.JSX.Element {
  return (
    <ForkCard
      onClick={onTap}
      chevron={false}
      className={cn("flex flex-col px-3.5 py-3", className)}
    >
      <span className="flex items-center gap-1.5">
        {icon != null && (
          <span aria-hidden className={cn("shrink-0 [&>svg]:h-[13px] [&>svg]:w-[13px]", TONE_TEXT[accent])}>
            {icon}
          </span>
        )}
        <span className="micro-label min-w-0 flex-1 truncate">{label}</span>
        {onTap != null && <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-tertiary" />}
      </span>
      <span className="mt-1.5 truncate text-[20px] font-medium tracking-[-0.01em] text-foreground tabular-nums">
        {value}
      </span>
      {sub != null && sub.length > 0 && (
        <span className={cn("mt-[3px] line-clamp-2 text-[10.5px] leading-[1.25]", TONE_TEXT[subTone])}>
          {sub}
        </span>
      )}
    </ForkCard>
  )
}

/**
 * A "needs attention" live tile (`_actionTile`): icon box, count, uppercase
 * label, chevron when tappable. A zero count stays tappable but reads quiet.
 */
export function ActionTile({
  label,
  count,
  icon,
  onTap,
}: {
  label: string
  count: number
  icon: React.ReactNode
  onTap?: () => void
}): React.JSX.Element {
  const active = count > 0
  return (
    <ForkCard onClick={onTap} chevron={false} className="flex items-center gap-3 px-4 py-3.5">
      <span
        aria-hidden
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border transition-colors duration-base gaia:rounded-[2px]",
          active
            ? "border-destructive/30 bg-destructive/10 text-destructive"
            : "border-border bg-inset text-tertiary",
          "[&>svg]:h-4 [&>svg]:w-4"
        )}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("text-[22px] font-medium leading-none tabular-nums", active ? "text-accent-foreground" : "text-foreground")}>
          {count}
        </span>
        <span className="micro-label mt-[3px] line-clamp-2">{label}</span>
      </span>
      {onTap != null && (
        <ChevronRight aria-hidden className={cn("h-[18px] w-[18px] shrink-0", active ? "text-muted-foreground" : "text-tertiary")} />
      )}
    </ForkCard>
  )
}
