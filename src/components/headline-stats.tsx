"use client"

/**
 * H1 — THE SIX FIGURES, IN ONE BOX AT THE TOP OF THE OVERVIEW.
 *
 * V3: "Combine the most important and primary statistics into a single distinct
 * box at the top of the overview section containing the following metrics:
 * Today's net sale, Today's gross sale, Online sale net, Online sale gross, Cash
 * collection, Month-to-date sales."
 *
 * ============================================================================
 * THE LABELS AND THE DEFINITIONS COME FROM THE SERVER
 * ============================================================================
 * Four of these six are ambiguous words. "Net" means post-discount-pre-tax to an
 * accountant and "after everything" to most people; "online" means aggregator
 * orders here and "paid by card" somewhere else. A card whose numbers an owner
 * cannot reconcile with their own reports is worse than no card, so the server
 * ships the `hint` next to every figure — the same sentence the MIS reports are
 * built on — and this file renders it rather than writing its own.
 *
 * That also means the definitions cannot drift: there is one place to change
 * them, and it is the place that computes them.
 *
 * ============================================================================
 * AN EMPTY DAY IS NOT A ZERO DAY
 * ============================================================================
 * A restaurant that opens at six has no settled bills at four in the afternoon.
 * Six ₹0.00 tiles read as a claim about trade; "nothing settled yet today" reads
 * as the truth. `today_bills` is what tells them apart, and it is on the payload
 * for exactly this.
 *
 * And a backend that could not be reached is a THIRD state again: it must never
 * render as ₹0.00, which is the number an owner would act on.
 *
 * ============================================================================
 * TODAY BY PAYMENT METHOD
 * ============================================================================
 * Client ask: "How much money from each payment method made in the day has to be
 * shown." Cash was the only mode this card could name, and the per-mode cut
 * lived two modules deep on a 30-day window. The rows come from the same
 * payload (`today_by_method`, the Settlement Summary's own computation over
 * today), so the Cash row and the Cash collection tile are one number and the
 * rows add up to Today's gross sale. The Flutter Overview draws the same block
 * from the same fields. An older backend sends no rows and gets no block.
 */

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useCurrency } from "@/hooks/use-currency"
import { getOverviewHeadline, type OverviewHeadline, type HeadlineFigure } from "@/lib/db"
import {
  hasSettlements, modeSharePct, readHeadlineByMethod, unallocatedWarning, UNALLOCATED_METHOD,
} from "@/lib/settlement-breakdown"
import { timezoneCaption } from "@/lib/tz"

/** The order the requirement lists them in, which is also the order they read in. */
const ORDER: (keyof Pick<OverviewHeadline,
  "today_net" | "today_gross" | "online_net" | "online_gross" | "cash_collection" | "month_to_date">)[] = [
  "today_net", "today_gross", "online_net", "online_gross", "cash_collection", "month_to_date",
]

/** Refreshed on the same cadence as the rest of the overview. */
const REFRESH_MS = 60_000

export function HeadlineStats({ rid }: { rid: string }) {
  const { currencySymbol } = useCurrency()
  const money = (n: number) =>
    `${currencySymbol}${Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const [data, setData] = useState<OverviewHeadline | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    if (!rid) { return }
    const h = await getOverviewHeadline(rid)
    // A failed refresh keeps the LAST GOOD FIGURES on screen rather than
    // blanking them: a momentary network blip must not make a restaurant think
    // its takings vanished. The banner below says the numbers are stale.
    setFailed(h === null)
    if (h) { setData(h) }
    setLoading(false)
  }, [rid])

  useEffect(() => {
    void load()
    const id = setInterval(() => { void load() }, REFRESH_MS)
    return () => { clearInterval(id) }
  }, [load])

  const tiles = (h: OverviewHeadline) => (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
      {ORDER.map((key) => {
        const f: HeadlineFigure = h[key]
        return (
          <div key={key} className="min-w-0">
            <p className="truncate text-xs font-medium text-muted-foreground" title={f.label}>{f.label}</p>
            {/* `break-words` and not `truncate`: a six-figure total that is cut
                off is the one thing on this card nobody can work around. */}
            <p className="mt-1 break-words text-xl font-bold tabular-nums sm:text-2xl" title={f.hint}>
              {money(f.value)}
            </p>
            <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground" title={f.hint}>
              {f.hint}
            </p>
          </div>
        )
      })}
    </div>
  )

  const byMethod = (h: OverviewHeadline) => {
    const b = readHeadlineByMethod(h)
    // Nothing settled is already said above the tiles; no rows is not a block.
    if (!b || !hasSettlements(b)) { return null }
    const warning = unallocatedWarning(b, money)
    return (
      <section className="border-t border-border/60 pt-4" aria-label={b.label}>
        <p className="text-xs font-medium text-muted-foreground">{b.label}</p>
        {b.hint && (
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{b.hint}</p>
        )}
        <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {b.modes.map((m) => {
            const share = modeSharePct(m, b.total_amount)
            const unallocated = m.method === UNALLOCATED_METHOD
            // The bar is the mode's SHARE of today, not its size against the
            // largest mode: a till that took ₹200 by card and ₹20,000 in cash
            // must not draw a card bar that looks half full.
            const width = b.total_amount > 0 ? Math.max(0, Math.min(100, (m.amount / b.total_amount) * 100)) : 0
            return (
              <li key={m.method} className="min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className={`truncate text-sm font-medium ${unallocated ? "text-amber-600 dark:text-amber-400" : ""}`}
                    title={m.label}>
                    {/* The owner's name for the mode (Settings > Payments); rows
                        still key and match Unallocated on the stored id. */}
                    {m.label}
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{money(m.amount)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className={`h-full rounded-full ${unallocated ? "bg-amber-500" : "bg-primary"}`}
                    style={{ width: `${width}%` }} />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                  {m.bills} bill{m.bills === 1 ? "" : "s"}
                  {/* A missing share is a dash, never 0% — see modeSharePct. */}
                  {` · ${share === null ? "–" : `${share.toFixed(1)}%`}`}
                  {m.refund > 0 ? ` · −${money(m.refund)} refunded` : ""}
                </p>
              </li>
            )
          })}
        </ul>
        {(b.split_bills > 0 || warning) && (
          <div className="mt-3 space-y-1 text-[11px] text-muted-foreground">
            {b.split_bills > 0 && (
              // Says only what is always true. The counts do NOT reliably add up
              // to more than "N bills settled": that tag counts a released ₹0
              // table, which has no row here.
              <p>
                {b.split_bills} bill{b.split_bills === 1 ? " was" : "s were"} paid across more than one
                method; each part counts under its own method.
              </p>
            )}
            {warning && (
              // LOUD: the one row that means something is wrong. Keyed off the
              // Unallocated row as well as its sum, which can net to ₹0.00.
              <p className="text-amber-600 dark:text-amber-400">{warning}</p>
            )}
          </div>
        )}
      </section>
    )
  }

  return (
    <Card className="border-primary/30 bg-muted/30">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle className="text-base">Today at a glance</CardTitle>
          {data && (
            <CardDescription className="text-xs">
              {data.today} · {timezoneCaption(data.timezone)}
              {data.today_bills > 0
                ? ` · ${data.today_bills} bill${data.today_bills === 1 ? "" : "s"} settled`
                : ""}
            </CardDescription>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading && !data ? (
          <p className="py-4 text-sm text-muted-foreground">Loading…</p>
        ) : !data ? (
          <p className="py-4 text-sm text-muted-foreground">
            Could not load today&apos;s figures. This is not a report of zero takings.
          </p>
        ) : (
          <div className="space-y-3">
            {data.today_bills === 0 && (
              // Said ABOVE the tiles, because the tiles are all zero and an owner
              // reading them first has already drawn the wrong conclusion.
              <p className="text-sm text-muted-foreground">
                Nothing has been settled yet today. Month to date still counts every earlier day.
              </p>
            )}
            {tiles(data)}
            {byMethod(data)}
            {failed && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                These figures could not be refreshed just now, so they may be a minute or two old.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
