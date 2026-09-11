"use client"

/**
 * H5 — WHAT IS ON THE FLOOR RIGHT NOW.
 *
 * V3: "Prominently display the gross sales specifically for currently running
 * tables. This can be a high-priority dashboard widget or a dedicated summary
 * box positioned above the orders in the table section."
 *
 * ============================================================================
 * THIS IS MONEY NOT YET TAKEN, AND THE CARD HAS TO SAY SO
 * ============================================================================
 * The single way this widget could mislead is by reading as revenue. It is not:
 * every rupee here is on a table that has not paid, and some of it will be
 * discounted, comped or written off before it reaches the till. An owner who
 * adds it to today's takings has double-counted the evening — so the label is
 * "on the floor now", never "sales", and the caption says outright that it is
 * unpaid.
 *
 * ============================================================================
 * THE FIGURE IS THE SERVER'S, AND IT IS TAX-INCLUSIVE
 * ============================================================================
 * `outstanding_total` is the sum of every open bill's `grand_total` across the
 * WHOLE floor — not just the page the list happens to be showing — computed by
 * the same pricing the bill screen uses. Summing the visible rows here would
 * quietly under-report a busy night, which is precisely the night somebody looks
 * at this.
 *
 * An unreachable backend renders as "unavailable", never as ₹0.00: zero is a
 * number an owner would act on, and "the floor is clear" is the most
 * consequential thing this could wrongly say.
 */

import { useCallback, useEffect, useState } from "react"
import { useCurrency } from "@/hooks/use-currency"
import { getOpenBills } from "@/lib/db"

const REFRESH_MS = 30_000

export function LiveGrossBar({ rid }: { rid: string }) {
  const { currencySymbol } = useCurrency()
  const money = (n: number) =>
    `${currencySymbol}${Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const [total, setTotal] = useState<number | null>(null)
  const [tables, setTables] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!rid) { return }
    // limit: 1 — only the TOTALS are wanted, and outstanding_total already spans
    // every open bill regardless of the page size. Asking for 200 rows to read
    // one number is the kind of thing that makes a floor screen slow.
    const page = await getOpenBills(rid, { limit: 1 })
    if (page) {
      setTotal(page.outstanding_total)
      setTables(page.total)
    } else {
      setTotal(null)
    }
    setLoading(false)
  }, [rid])

  useEffect(() => {
    void load()
    const id = setInterval(() => { void load() }, REFRESH_MS)
    return () => { clearInterval(id) }
  }, [load])

  return (
    <div className="rounded-lg border border-primary/30 bg-muted/40 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">On the floor now</p>
          <p className="mt-0.5 break-words text-2xl font-bold tabular-nums">
            {loading && total === null
              ? "…"
              : total === null
                // Never ₹0.00 on a failure: "the floor is clear" is the most
                // consequential thing this could wrongly say.
                ? <span className="text-base font-medium text-muted-foreground">Unavailable just now</span>
                : money(total)}
          </p>
        </div>
        {total !== null && (
          <p className="text-xs text-muted-foreground">
            {tables === 0
              ? "No tables are running."
              : `Across ${tables} running table${tables === 1 ? "" : "s"} · not yet paid, and before any discount at settlement.`}
          </p>
        )}
      </div>
    </div>
  )
}
