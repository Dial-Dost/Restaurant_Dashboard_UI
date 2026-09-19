"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { ForkCard } from "@/components/ui/fork-card"
import { DeltaText } from "@/components/ui/micro-stat"

/**
 * The compact KPI tile: a micro-label eyebrow over a display figure, with an
 * optional delta footer — the dense cousin of StatCard for header strips and
 * drill-sheet grids (the app's smaller stat tiles). Tappable like every stat
 * surface: `onClick` gives it the ForkCard drill-down affordance.
 */
export interface MetricTileProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** The uppercase micro label ("CROWD SIZE"). */
  label: React.ReactNode
  /** The figure, already formatted. */
  value: React.ReactNode
  /** Small raised unit after the value. */
  unit?: React.ReactNode
  /** Optional delta: renders a DeltaText under the figure. */
  delta?: { pct: number; suffix?: string; invert?: boolean }
  /** Free-form footer slot; wins over `delta`. */
  footer?: React.ReactNode
  /** Recessed variant, for tiles living inside a card. */
  inset?: boolean
}

const MetricTile = React.forwardRef<HTMLDivElement, MetricTileProps>(
  ({ label, value, unit, delta, footer, inset = false, className, ...props }, ref) => {
    return (
      <ForkCard
        ref={ref}
        inset={inset}
        className={cn("flex flex-col gap-2 p-3.5", className)}
        {...props}
      >
        <span className="micro-label">{label}</span>
        <span className="flex min-w-0 items-baseline gap-1 overflow-hidden whitespace-nowrap">
          <span className="display-sm">{value}</span>
          {unit != null && (
            <span className="text-[11px] font-medium text-muted-foreground gaia:uppercase gaia:tracking-[0.06em]">
              {unit}
            </span>
          )}
        </span>
        {footer ?? (delta && <DeltaText pct={delta.pct} suffix={delta.suffix} invert={delta.invert} />)}
      </ForkCard>
    )
  }
)
MetricTile.displayName = "MetricTile"

export { MetricTile }
