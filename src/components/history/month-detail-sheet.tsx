"use client"

// What a History month card opens — Flutter's `_MonthDetailSheet`
// (restaurant_owner_app/lib/screens/modules.dart 17024–17092): the month's own
// metrics as kv rows, then the settled bills that produced them — each of
// which opens the bill in full, with Reprint and the name / GSTIN / address
// edit for whoever holds their permission (client item 8; history.md
// finding 15). "Open in Accounting" rides along as the sheet's quiet footer
// jump (finding 21), never replacing the in-place bills list.

import { useMemo, type ReactElement } from "react"
import { useRouter } from "next/navigation"

import { DrillSheet, DrillSheetAction } from "@/components/ui/drill-sheet"
import { ForkCard } from "@/components/ui/fork-card"
import { SectionHeader } from "@/components/ui/section-header"
import { useCurrency } from "@/hooks/use-currency"
import type { MonthlyHistoryRow } from "@/lib/db"
import { ClosedBillsList, KvRow } from "@/components/closed-bills"

/** First and last calendar day of a "YYYY-MM" bucket, as the `from`/`to` the
 *  bills endpoint expects. Null when the bucket isn't a month. */
export function monthRange(ym: string): { from: string; to: string } | null {
  const parts = ym.split("-")
  if (parts.length !== 2) { return null }
  const y = Number.parseInt(parts[0], 10)
  const m = Number.parseInt(parts[1], 10)
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) { return null }
  // Day 0 of the NEXT month is the last day of this one (leap years included).
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, "0")
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` }
}

export function MonthDetailSheet({
  rid,
  month,
  title,
  onClose,
}: {
  rid: string
  /** The month row the sheet describes, or null while closed. */
  month: MonthlyHistoryRow | null
  /** "Jun 2026" — the pretty month name. */
  title: string
  onClose: () => void
}): ReactElement {
  const router = useRouter()
  const { currencySymbol } = useCurrency()
  const money = useMemo(() => (n: number | null | undefined): string =>
    n == null
      ? "—"
      : `${currencySymbol}${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  [currencySymbol])

  const ym = month?.month ?? ""
  const range = ym === "" ? null : monthRange(ym)
  const feedback = month?.feedback_count ?? 0
  const tat = month?.avg_tat_min

  return (
    <DrillSheet
      open={month !== null}
      onOpenChange={(o) => { if (!o) { onClose() } }}
      eyebrow="Month"
      title={(
        <span className="flex w-full items-baseline justify-between gap-3">
          <span className="min-w-0 truncate">{title}</span>
          <span className="shrink-0 text-[21px] font-light tracking-[-0.02em] tabular-nums">{money(month?.revenue ?? 0)}</span>
        </span>
      )}
      action={range === null ? undefined : (
        <DrillSheetAction
          module="Accounting"
          onClick={() => {
            onClose()
            router.push(`/dashboard/accounting?from=${range.from}&to=${range.to}`)
          }}
        />
      )}
    >
      {month === null ? null : (
        <div className="space-y-4">
          <ForkCard className="p-4">
            <SectionHeader title="Month totals" className="mb-1.5" />
            <KvRow k="Revenue" v={money(month.revenue)} />
            <KvRow k="Bills" v={String(month.bills)} />
            <KvRow k="Orders" v={String(month.orders)} />
            <KvRow k="Avg bill" v={money(month.avg_bill)} />
            {/* Discounts always as money — a month with none reads ₹0.00, not "—". */}
            <KvRow k="Discounts" v={money(month.discounts)} />
            <KvRow k="Feedback" v={feedback > 0 ? `${month.feedback_count} (avg ${month.avg_rating ?? "—"}/5)` : "0"} />
            <KvRow k="New customers" v={String(month.new_customers)} />
            <KvRow k="Avg TAT" v={tat != null ? `${Math.round(tat)} min` : "—"} />
          </ForkCard>

          <div>
            <SectionHeader title="Settled bills" className="mb-1.5" />
            <p className="text-xs text-muted-foreground">
              Every bill closed in {title} — tap one for its items, taxes, payment and who closed it, or to reprint it.
            </p>
          </div>
          {range === null ? (
            <p className="text-xs text-muted-foreground">No date range for &quot;{ym}&quot;.</p>
          ) : (
            <ClosedBillsList
              rid={rid}
              pageSize={10}
              filter={{ from: range.from, to: range.to }}
              emptyCaption={`No bills were closed in ${title}.`}
            />
          )}
        </div>
      )}
    </DrillSheet>
  )
}
