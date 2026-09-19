import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The reference design's "| Hig" / "| Lo" corner tag (metric_tag.dart
 * TickTag) — a short 2.5x11px accent tick followed by a tiny label. Gaia
 * marks a tagged item with a 9px hairline SQUARE outline instead: same job,
 * opposite weight.
 */
export interface TickTagProps extends React.HTMLAttributes<HTMLSpanElement> {
  label: React.ReactNode
  /** Any CSS colour; defaults to the accent's hi stop. */
  color?: string
}

function TickTag({ label, color, className, style, ...props }: TickTagProps): React.JSX.Element {
  const c = color ?? "hsl(var(--accent-hi))"
  return (
    <span
      style={{ "--tick-color": c, ...style } as React.CSSProperties}
      className={cn("inline-flex min-w-0 items-center gap-[5px]", className)}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "h-[11px] w-[2.5px] shrink-0 rounded-[2px] bg-[color:var(--tick-color)]",
          "gaia:h-[9px] gaia:w-[9px] gaia:rounded-none gaia:border gaia:border-[color:var(--tick-color)] gaia:bg-transparent"
        )}
      />
      <span
        className={cn(
          "min-w-0 truncate text-[10.5px] font-medium tracking-[0.4px] text-muted-foreground",
          "gaia:font-normal gaia:uppercase gaia:tracking-[0.14em]"
        )}
      >
        {label}
      </span>
    </span>
  )
}

export { TickTag }
