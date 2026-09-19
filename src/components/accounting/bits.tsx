"use client"

// Small presentational pieces the Accounting page reuses across its cards and
// drill sheets — web copies of `_sheetHead`, `_sheetNote`, `_detailRow`,
// `moneyRow`, `tapHint`, `detailsFooter`, `hairline` and `InitialsAvatar` in
// Flutter's modules.dart (`_AccountingView`).

import * as React from "react"
import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

/** Uppercase micro sub-header inside a drill sheet (`_sheetHead`). */
export function SheetHead({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="micro-label pb-0.5 pt-3.5">{children}</div>
}

/** Quiet explanatory paragraph inside a drill sheet (`_sheetNote`). */
export function SheetNote({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="pt-1.5 text-xs leading-[1.35] text-tertiary">{children}</p>
}

/**
 * Quiet label / value line inside a drill sheet (`_detailRow`). Wraps rather
 * than rows, so a long figure beside its qualifier drops a line instead of
 * truncating the money.
 */
export function SheetRow({
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

/**
 * Dense financial table row — label in the quiet voice, amount right
 * (Flutter's `moneyRow`). With `onClick` the row reads as a control the
 * `_TapRow` way: click cursor plus a faint hover wash, no chevron — these rows
 * already carry an unbounded money string beside an ellipsised label.
 */
export function MoneyRow({
  label,
  amount,
  sub,
  trailing,
  onClick,
}: {
  label: React.ReactNode
  amount: React.ReactNode
  sub?: React.ReactNode
  trailing?: React.ReactNode
  onClick?: () => void
}): React.JSX.Element {
  const body = (
    <div className="flex items-start gap-3 py-[7px]">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-left text-[13.5px] text-foreground">{label}</span>
        {sub != null && (
          <span className="mt-0.5 line-clamp-2 block text-left text-xs text-muted-foreground">{sub}</span>
        )}
      </span>
      <span className="shrink-0 text-[13.5px] font-semibold text-foreground tabular-nums">{amount}</span>
      {trailing != null && <span className="shrink-0">{trailing}</span>}
    </div>
  )
  if (onClick == null) { return body }
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        // Only the row itself — Enter on a nested control (the delete button)
        // must not also open the sheet.
        if (e.target !== e.currentTarget) { return }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onClick()
        }
      }}
      className="block w-full cursor-pointer rounded-[6px] text-left transition-colors duration-fast hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {body}
    </div>
  )
}

/** "Tap a row for its breakdown." — said once per card, not per row. */
export function TapHint(): React.JSX.Element {
  return <p className="pb-0.5 pt-0.5 text-left text-xs text-muted-foreground">Tap a row for its breakdown.</p>
}

/** Copper "DETAILS ›" stat-card footer (`detailsFooter`). */
export function DetailsFooter(): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-[0.11em] text-accent-foreground">
      Details
      <ChevronRight aria-hidden className="h-3.5 w-3.5" />
    </span>
  )
}

/** 1px row divider on the divider token (`hairline`). */
export function Hairline(): React.JSX.Element {
  return <div aria-hidden className="h-px bg-divider" />
}

/** 36px initials circle (the app's InitialsAvatar). */
export function InitialsAvatar({ initials, className }: { initials: string; className?: string }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-inset text-xs font-semibold text-accent-foreground",
        className
      )}
    >
      {initials}
    </span>
  )
}
