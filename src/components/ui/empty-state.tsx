import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Elegant empty state (empty_state.dart): a centred 56x56 inset tile (radius
 * 12, strong hairline) holding a 24px accent-hi icon, a 15px w600 title, a
 * 280px-max quiet caption and an optional action row — the shared "no rows"
 * surface every module uses.
 */
export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** A lucide icon element (sized by the tile). */
  icon: React.ReactNode
  title: React.ReactNode
  caption: React.ReactNode
  /** One or two buttons. */
  action?: React.ReactNode
}

function EmptyState({ icon, title, caption, action, className, ...props }: EmptyStateProps): React.JSX.Element {
  return (
    <div className={cn("flex w-full justify-center p-10", className)} {...props}>
      <div className="flex flex-col items-center text-center">
        <div
          aria-hidden
          className="flex h-14 w-14 items-center justify-center rounded-xl border border-input bg-inset text-accent-foreground gaia:rounded-[2px] [&>svg]:h-6 [&>svg]:w-6"
        >
          {icon}
        </div>
        <div className="mt-[18px] text-[15px] font-semibold text-foreground gaia:font-serif gaia:text-[17px] gaia:font-medium">
          {title}
        </div>
        <div className="mt-1.5 max-w-[280px] text-xs leading-[1.4] text-muted-foreground">
          {caption}
        </div>
        {action != null && <div className="mt-[18px] flex items-center gap-2">{action}</div>}
      </div>
    </div>
  )
}

export { EmptyState }
