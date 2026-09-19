"use client"

// Makes a StatCard read as a drill-down control — the web `_TappableStat`
// (modules.dart): click cursor, the same 2px hover lift the interactive
// ForkCard uses, and a quiet bottom-right corner chevron that brightens to the
// accent on hover — without touching the design-system widget. The page-wide
// signal for "this opens something".

import * as React from "react"
import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

export function TappableStat({
  label,
  onTap,
  className,
  children,
}: {
  /** The one button-node name a screen reader gets for the whole card. */
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
        "group relative block w-full cursor-pointer text-left transition-transform duration-fast ease-out",
        "hover:-translate-y-0.5 gaia:hover:translate-y-0",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background rounded-lg gaia:rounded-[2px]",
        className
      )}
    >
      {children}
      <ChevronRight
        aria-hidden
        className="absolute bottom-2.5 right-2.5 h-4 w-4 text-tertiary opacity-50 transition-all duration-fast group-hover:text-accent-foreground group-hover:opacity-100"
      />
    </button>
  )
}
