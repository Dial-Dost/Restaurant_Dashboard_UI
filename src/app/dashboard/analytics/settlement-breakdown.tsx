"use client"

/**
 * WHERE THE MONEY CAME IN — the payment-mode row on the analytics page.
 *
 * V3: "In the analytics section, add a dedicated row showing the breakdown of
 * the total amount paid by all available payment methods (Cash, UPI, cards,
 * etc.)."
 *
 * The arithmetic is NOT here. It comes from the Settlement Summary report, which
 * already knows how to split a tender across the modes it touched and how to
 * carry a refund back to the mode that took the money — see
 * src/lib/settlement-breakdown.ts for why a second, simpler version of that sum
 * would be worse than no card at all.
 *
 * This file is the rendering and the failure states, and the failure states are
 * the part worth reading: an empty window, an unreachable backend and a window
 * with money in it are three different things and must look like three different
 * things. A restaurant that has not settled a bill yet today must not be shown a
 * table of zeroes, and one whose backend is down must not be told it took
 * nothing.
 */

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getMisReport } from "@/lib/db"
import { useCurrency } from "@/hooks/use-currency"
import {
  readSettlementBreakdown, modeSharePct, hasSettlements,
  UNALLOCATED_METHOD, type SettlementBreakdown,
} from "@/lib/settlement-breakdown"
import type { RangeQuery } from "@/lib/date-range"

/** The colours the bar uses, in the order the modes are ranked. */
const BAR_TONES = [
  "bg-emerald-500", "bg-sky-500", "bg-violet-500",
  "bg-amber-500", "bg-rose-500", "bg-teal-500",
]
const UNALLOCATED_TONE = "bg-muted-foreground/40"

const toneFor = (method: string, index: number): string =>
  method === UNALLOCATED_METHOD ? UNALLOCATED_TONE : BAR_TONES[index % BAR_TONES.length]

export function SettlementBreakdownCard({ rid, range }: { rid: string; range: RangeQuery }) {
  const { currencySymbol } = useCurrency()
  // Two decimals, always. This is a cash-up figure that gets reconciled against
  // a till by hand, and a rounded rupee is the difference between "it balances"
  // and twenty minutes of somebody's evening.
  const money = (n: number) => `${currencySymbol}${Number(n ?? 0).toFixed(2)}`
  const [data, setData] = useState<SettlementBreakdown | null>(null)
  const [loading, setLoading] = useState(true)
  // DISTINCT from "no money": see the header. `failed` means we could not ask.
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    if (!rid) { return }
    setLoading(true)
    const payload = await getMisReport(rid, "/reports/mis/settlement-summary", {
      from: range.from, to: range.to, days: range.days,
    })
    const shaped = readSettlementBreakdown(payload)
    setFailed(payload === null)
    setData(shaped)
    setLoading(false)
  }, [rid, range.from, range.to, range.days])

  useEffect(() => { void load() }, [load])

  const body = () => {
    if (loading) {
      return <p className="text-sm text-muted-foreground">Loading…</p>
    }
    if (failed) {
      return (
        <p className="text-sm text-muted-foreground">
          Could not load the payment breakdown. This is not a report of zero takings —
          the figures could not be fetched.
        </p>
      )
    }
    if (!hasSettlements(data)) {
      return (
        <p className="text-sm text-muted-foreground">
          Nothing has been settled in this period yet.
        </p>
      )
    }
    const b = data!
    return (
      <div className="space-y-4">
        {/* One bar, proportioned by mode. The point of the card at a glance. */}
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img"
          aria-label={`Payment modes: ${b.modes.map((m) => `${m.method} ${money(m.amount)}`).join(", ")}`}>
          {b.modes.map((m, i) => {
            const pct = b.total_amount > 0 ? (m.amount / b.total_amount) * 100 : 0
            return pct > 0
              ? <div key={m.method} className={toneFor(m.method, i)} style={{ width: `${pct}%` }} />
              : null
          })}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-1 pr-3 font-medium">Method</th>
                <th className="py-1 pr-3 text-right font-medium">Collected</th>
                <th className="py-1 pr-3 text-right font-medium">Share</th>
                <th className="py-1 pr-3 text-right font-medium">Bills</th>
                <th className="py-1 text-right font-medium">Net of refunds</th>
              </tr>
            </thead>
            <tbody>
              {b.modes.map((m, i) => {
                const share = modeSharePct(m, b.total_amount)
                return (
                  <tr key={m.method} className="border-t border-border/60">
                    <td className="py-1.5 pr-3">
                      <span className="inline-flex items-center gap-2">
                        <span className={`inline-block h-2.5 w-2.5 rounded-sm ${toneFor(m.method, i)}`} />
                        {m.method}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{money(m.amount)}</td>
                    {/* A missing share renders as a dash, never as 0% — see modeSharePct. */}
                    <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                      {share === null ? "–" : `${share.toFixed(1)}%`}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">{m.bills}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {money(m.net_amount)}
                      {m.refund > 0 && (
                        <span className="ml-1 text-xs text-muted-foreground">(−{money(m.refund)})</span>
                      )}
                    </td>
                  </tr>
                )
              })}
              <tr className="border-t-2 border-border font-semibold">
                <td className="py-1.5 pr-3">Total</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{money(b.total_amount)}</td>
                <td className="py-1.5 pr-3" />
                <td className="py-1.5 pr-3" />
                <td className="py-1.5 text-right tabular-nums">{money(b.total_net)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="space-y-1 text-xs text-muted-foreground">
          {b.split_bills > 0 && (
            <p>
              {b.split_bills} bill{b.split_bills === 1 ? " was" : "s were"} paid across more than one
              method, so the bill counts above add up to more than the number of bills.
            </p>
          )}
          {b.unallocated > 0 && (
            // LOUD, because it is the one row that means something is wrong: the
            // split-tender parts did not add back to the bill total. It should
            // always be zero.
            <p className="text-amber-600 dark:text-amber-400">
              {money(b.unallocated)} could not be attributed to any payment method — those bills&apos;
              split amounts do not add up to their totals and need looking at.
            </p>
          )}
          <p>
            Collected is what was taken at the till; Net is what survived refunds. A refund has no
            method of its own, so it is charged back to the method(s) its bill was paid with.
          </p>
        </div>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment methods</CardTitle>
        <CardDescription>
          How this period&apos;s settled takings were actually paid. Split bills count under every
          method they touched.
        </CardDescription>
      </CardHeader>
      <CardContent>{body()}</CardContent>
    </Card>
  )
}
