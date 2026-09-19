"use client"

import * as React from "react"
import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Base surface of the design system (fork_card.dart): subtle vertical
 * gradient, hairline border, 14px radius, soft ambient shadow. With `onClick`
 * (or `interactive`) the card lifts -2px on hover (140ms ease-out), brightens
 * its border to the strong hairline, deepens its shadow, shows the click
 * cursor and carries a quiet corner chevron — the drill-down affordance every
 * tappable tile in the app wears.
 *
 * Under Gaia the tokens collapse the voice on their own: card-top = card-bottom
 * (flat), --shadow-card: none, --radius 2px; the Gaia-specific hover (ground
 * brightens to raised, hairline to line-2, no lift) is applied here.
 */
export interface ForkCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Force the interactive affordance without an onClick (e.g. asChild-ish
   *  wrappers). Defaults to `onClick != null`. */
  interactive?: boolean
  /** Copper selection outline + 24px glow (the highlighted card). */
  selected?: boolean
  /** Recessed panel: darker inset fill, no gradient, no shadow. */
  inset?: boolean
  /** The corner chevron. Defaults to the interactive state. */
  chevron?: boolean
}

const ForkCard = React.forwardRef<HTMLDivElement, ForkCardProps>(
  ({ className, interactive, selected = false, inset = false, chevron, onClick, onKeyDown, children, ...props }, ref) => {
    const isInteractive = interactive ?? onClick != null
    const showChevron = chevron ?? isInteractive
    return (
      <div
        ref={ref}
        data-selected={selected || undefined}
        role={isInteractive ? "button" : undefined}
        tabIndex={isInteractive ? 0 : undefined}
        onClick={onClick}
        onKeyDown={
          onKeyDown ??
          (isInteractive && onClick
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  ;(e.currentTarget).click()
                }
              }
            : undefined)
        }
        className={cn(
          "relative rounded-lg border border-border p-[18px] text-card-foreground",
          "transition-all duration-fast ease-out",
          inset
            ? "bg-inset"
            : "bg-card bg-gradient-to-b from-card-top to-card-bottom shadow-card",
          isInteractive && [
            "cursor-pointer outline-none",
            "hover:-translate-y-0.5 hover:border-input",
            !inset && "hover:shadow-card-hover",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background",
            // Gaia hover: no lift — the ground steps up to raised, the
            // hairline to line-2. The `background` shorthand clears the
            // (flat) gradient image in one declaration.
            "gaia:hover:translate-y-0 gaia:hover:[background:hsl(var(--popover))]",
          ],
          selected && [
            "border-[hsl(var(--primary)/0.55)]",
            "shadow-[var(--shadow-card),0_0_24px_hsl(var(--primary)/0.10)]",
            "gaia:border-accent-mid gaia:shadow-none",
          ],
          className
        )}
        {...props}
      >
        {children}
        {showChevron && (
          <ChevronRight
            aria-hidden
            className="absolute right-3 top-3 h-3.5 w-3.5 text-tertiary"
          />
        )}
      </div>
    )
  }
)
ForkCard.displayName = "ForkCard"

export { ForkCard }
