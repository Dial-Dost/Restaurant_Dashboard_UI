import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Section title row (section_header.dart): a 3x14px copper tick, 9px gap,
 * 15px w600 title, an optional count in a tiny inset pill, and a
 * right-aligned trailing slot (a "View all" subtle button, a range chip). The
 * title ellipsises so the trailing stays flush right.
 *
 * Gaia: the whole header collapses to the eyebrow voice — tracked uppercase
 * champagne-dim, the count trailing in the faint ink, no tick.
 */
export interface SectionHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode
  count?: number
  /** Right-aligned slot. */
  trailing?: React.ReactNode
}

function SectionHeader({ title, count, trailing, className, ...props }: SectionHeaderProps): React.JSX.Element {
  return (
    <div className={cn("mb-3.5 flex items-center", className)} {...props}>
      <span
        aria-hidden
        className="mr-[9px] h-3.5 w-[3px] shrink-0 rounded-[2px] bg-accent-hi gaia:hidden"
      />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h3
          className={cn(
            "min-w-0 truncate text-[15px] font-semibold tracking-[-0.007em] text-foreground",
            "gaia:text-[11px] gaia:font-normal gaia:uppercase gaia:tracking-[0.18em] gaia:text-accent-mid"
          )}
        >
          {title}
        </h3>
        {count != null && (
          <span
            className={cn(
              "shrink-0 rounded-full border border-border bg-inset px-[7px] py-0.5 text-[10.5px] font-semibold text-muted-foreground tabular-nums",
              "gaia:border-0 gaia:bg-transparent gaia:px-0 gaia:font-normal gaia:tracking-[0.18em] gaia:text-tertiary"
            )}
          >
            {count}
          </span>
        )}
      </div>
      {trailing != null && <div className="ml-2 shrink-0">{trailing}</div>}
    </div>
  )
}

export { SectionHeader }
