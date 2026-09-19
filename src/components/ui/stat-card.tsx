"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { ForkCard } from "@/components/ui/fork-card"
import { TickTag } from "@/components/ui/tick-tag"

/**
 * The reference stat card (stat_card.dart): oversized light-weight figure
 * with a raised unit, a "| Hig / | Lo" tick tag in the corner, a copper chart
 * in the middle and a quiet caption at the bottom. `onClick` makes the whole
 * tile a drill-down control with the ForkCard hover affordance.
 *
 * Under Gaia the figure switches to the serif (the .display-md override) and
 * the caption reads as a tracked uppercase eyebrow beneath it, `.stats`'
 * n-over-l order.
 */
export interface StatCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** The big number, already formatted ("4,820", "₹1,77,213"). */
  value: React.ReactNode
  /** Small raised unit after the value ("%", "Clients", "hrs"). */
  unit?: React.ReactNode
  /** Bottom caption ("Average Attendance (%)" style). */
  caption: React.ReactNode
  /** Corner tick-tag text ("Hig", "Lo", "Live"). */
  tag?: React.ReactNode
  /** Tick colour; defaults to the accent's hi stop. */
  tagColor?: string
  /** Chart slot — typically <Barcode/> or <WeekdayBars/> from fork-charts. */
  chart?: React.ReactNode
  /** Optional row under the caption (a <DeltaText/>, etc.). */
  footer?: React.ReactNode
}

const StatCard = React.forwardRef<HTMLDivElement, StatCardProps>(
  ({ value, unit, caption, tag, tagColor, chart, footer, className, ...props }, ref) => {
    return (
      <ForkCard ref={ref} className={cn("flex flex-col items-stretch", className)} {...props}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-baseline gap-1.5 overflow-hidden whitespace-nowrap">
            <span className="display-md">{value}</span>
            {unit != null && (
              <span className="text-xs font-medium text-muted-foreground gaia:uppercase gaia:tracking-[0.06em] gaia:text-[11px]">
                {unit}
              </span>
            )}
          </div>
          {tag != null && <TickTag label={tag} color={tagColor} className="mt-0.5 shrink-0" />}
        </div>
        {chart != null && <div className="mt-4">{chart}</div>}
        <div className="mt-3 text-[11.5px] text-muted-foreground gaia:mt-3.5 gaia:uppercase gaia:tracking-[0.18em] gaia:text-[11px]">
          {caption}
        </div>
        {footer != null && <div className="mt-1.5 gaia:mt-2">{footer}</div>}
      </ForkCard>
    )
  }
)
StatCard.displayName = "StatCard"

export { StatCard }
