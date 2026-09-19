"use client"

// WEB-EXTRA ACCOUNTING SECTIONS — Open bills, Balance sheet, Reconciliation.
//
// None of these exist in Flutter's Accounting view (parity audit area 12);
// they are kept pending a product decision, moved BELOW the Flutter-parity
// sections so the source-of-truth page order (stats → charts → discounts →
// settled bills → expenses → payroll) holds above them. Their data loading is
// rebuilt on useCachedFetch so an outage can never read as an empty ledger.

import * as React from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SkeletonRows } from "@/components/ui/fork-skeleton"
import { Input } from "@/components/ui/input"
import { LoadErrorState } from "@/components/ui/load-error-state"
import { CacheStalePill } from "@/components/ui/stale-pill"
import { StatusChip } from "@/components/ui/status-chip"
import { useCachedFetch } from "@/hooks/use-cached-fetch"
import { useCurrency } from "@/hooks/use-currency"
import { useToast } from "@/hooks/use-toast"
import {
  fetchBalanceSheet,
  fetchOpenBillsPage,
  fetchReconciliation,
} from "@/lib/api/accounting"
import { saveReconciliation } from "@/lib/db"
import type { OpenBillSummary, ReconciliationRow } from "@/lib/db"
import { reportModeName } from "@/lib/payment-methods"
import { timezoneCaption, todayInZone } from "@/lib/tz"
import { useTimezone } from "@/lib/use-timezone"

// Open bills are bounded by table count, so one page almost always covers them all.
const PAGE_SIZE = 25

/* ── Open bills — "money on the floor" ─────────────────────────────────── */

// Everything else on this page reports a CLOSED period from settled bills, so
// without this list "who owes me money right now" had no answer. Hence: no
// date range (it is live state), and the outstanding total stated up front.
//
// Every figure comes from the backend already split into taxable base /
// service charge / tax. Nothing is recomputed here.
export function OpenBillsSection({ rid }: { rid: string }): React.JSX.Element {
  const { timezone } = useTimezone()
  const { currencySymbol } = useCurrency()
  const exact = (n: number | null | undefined): string =>
    `${currencySymbol}${(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const page = useCachedFetch(
    `accounting:open-bills:${rid}`,
    React.useCallback(() => fetchOpenBillsPage(rid, { limit: PAGE_SIZE, offset: 0 }), [rid]),
    { enabled: rid.length > 0 },
  )

  // Pages past the first live outside the cache; a fresh first page drops them.
  const [extra, setExtra] = React.useState<OpenBillSummary[]>([])
  const [extraHasMore, setExtraHasMore] = React.useState<boolean | null>(null)
  const [loadingMore, setLoadingMore] = React.useState(false)
  React.useEffect(() => {
    setExtra([])
    setExtraHasMore(null)
  }, [page.data])

  const bills = React.useMemo(
    () => [...(page.data?.bills ?? []), ...extra],
    [page.data, extra],
  )
  const hasMore = extraHasMore ?? page.data?.has_more ?? false

  const loadMore = async (): Promise<void> => {
    setLoadingMore(true)
    try {
      const next = await fetchOpenBillsPage(rid, { limit: PAGE_SIZE, offset: bills.length })
      setExtra((prev) => [...prev, ...next.bills])
      setExtraHasMore(next.has_more)
    } catch {
      /* the Load more button stays; the first page is still honest */
    } finally {
      setLoadingMore(false)
    }
  }

  // Rough age, in the units a manager thinks in.
  const age = (minutes: number): string => {
    if (minutes < 60) { return `${minutes}m` }
    if (minutes < 60 * 24) { return `${Math.floor(minutes / 60)}h ${minutes % 60}m` }
    const days = Math.floor(minutes / (60 * 24))
    return `${days}d ${Math.floor((minutes % (60 * 24)) / 60)}h`
  }

  const total = page.data?.total ?? 0
  const outstanding = page.data?.outstanding_total ?? 0
  const stale = bills.filter((b) => b.age_minutes >= 60 * 24).length
  const awaiting = bills.filter((b) => b.stage !== "running").length

  return (
    <Card id="open-bills-section" className="scroll-mt-20">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Open bills — money on the floor</CardTitle>
            <CardDescription>
              Every bill that has not been settled, right now. Not filtered by the date range above —
              these are live, and none of them are counted in the sales, GST or P&amp;L figures until they close.
            </CardDescription>
          </div>
          {page.data != null && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Total outstanding</p>
              <p className={`text-2xl font-semibold ${outstanding > 0 ? "text-warning" : ""}`}>{exact(outstanding)}</p>
              <p className="text-xs text-muted-foreground">
                {total} open bill{total === 1 ? "" : "s"}
                {awaiting > 0 ? ` · ${awaiting} awaiting approval` : ""}
                {stale > 0 ? ` · ${stale} over a day old` : ""}
              </p>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {page.loading ? (
          <SkeletonRows rows={3} title={false} />
        ) : page.error != null ? (
          <LoadErrorState whatFailed="Couldn't load open bills." error={page.error} onRetry={page.retry} />
        ) : bills.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing outstanding — every bill is settled.</p>
        ) : (
          <div className="relative">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
                <thead>
                  <tr className="border-b border-divider text-left">
                    <th className="micro-label py-2 pr-3">Table</th>
                    <th className="micro-label py-2 pr-3">Opened</th>
                    <th className="micro-label py-2 pr-3">Open for</th>
                    <th className="micro-label py-2 pr-3">Covers</th>
                    <th className="micro-label py-2 pr-3">Orders</th>
                    <th className="micro-label py-2 pr-3">Opened by</th>
                    <th className="micro-label py-2 pr-3 text-right">Running total</th>
                  </tr>
                </thead>
                <tbody>
                  {bills.map((b) => (
                    <tr key={b.id} className="border-b border-divider align-top last:border-0">
                      <td className="py-2 pr-3">
                        <span className="font-medium">{b.table_name ?? "—"}</span>
                        {b.bill_no != null && b.bill_no !== "" && (
                          <span className="ml-2 text-xs text-muted-foreground">#{b.bill_no}</span>
                        )}
                        {b.stage !== "running" && (
                          <span className="ml-2 inline-flex align-middle">
                            <StatusChip
                              status="warning"
                              label={b.stage === "awaiting_approval" ? "Payment awaiting approval" : "Approved"}
                              dense
                            />
                          </span>
                        )}
                        {b.coupon_code != null && b.coupon_code !== "" && (
                          <span className="ml-2 text-xs text-muted-foreground">{b.coupon_code}</span>
                        )}
                      </td>
                      {/* The restaurant's own wall clock, computed server-side. */}
                      <td className="whitespace-nowrap py-2 pr-3 text-muted-foreground">{b.opened_at_local || "—"}</td>
                      <td className={`whitespace-nowrap py-2 pr-3 ${b.age_minutes >= 60 * 24 ? "font-medium text-warning" : "text-muted-foreground"}`}>
                        {age(b.age_minutes)}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">{b.covers ?? "—"}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{b.order_count}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{b.opened_by ?? "—"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        <span className="font-semibold">{exact(b.grand_total)}</span>
                        {/* The tax-inclusive total is what the guest owes; the
                            split below is what the owner actually keeps. */}
                        <span className="block text-xs text-muted-foreground">
                          {exact(b.taxable_base)} base
                          {b.service_charge > 0 ? ` · ${exact(b.service_charge)} svc` : ""}
                          {b.tax_total > 0 ? ` · ${exact(b.tax_total)} tax` : ""}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-3 pt-2">
              <p className="text-xs text-muted-foreground">
                Showing {bills.length} of {total} · times in {timezoneCaption(timezone)}
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => { page.refresh() }}>Refresh</Button>
                {hasMore && (
                  <Button variant="outline" size="sm" onClick={() => { void loadMore() }} disabled={loadingMore}>
                    {loadingMore ? "Loading…" : "Load more"}
                  </Button>
                )}
              </div>
            </div>
            <CacheStalePill offline={page.offline} fromCache={page.fromCache} updatedAt={page.updatedAt} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* ── Balance sheet ─────────────────────────────────────────────────────── */

export function BalanceSheetSection({
  rid,
  money,
}: {
  rid: string
  money: (n: number | null | undefined) => string
}): React.JSX.Element {
  const { timezone } = useTimezone()
  // "As of today" means the restaurant's today.
  const [asOf, setAsOf] = React.useState(() => todayInZone(timezone))
  const sheet = useCachedFetch(
    `accounting:balance:${rid}:${asOf}`,
    React.useCallback(() => fetchBalanceSheet(rid, asOf), [rid, asOf]),
    { enabled: rid.length > 0 },
  )
  const data = sheet.data

  const line = (label: string, value: number | undefined, bold = false): React.JSX.Element => (
    <div className={`flex items-center justify-between rounded-lg border border-border p-2 text-sm ${bold ? "font-semibold" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{money(value)}</span>
    </div>
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Balance sheet</CardTitle>
            <CardDescription>What the outlet owns vs owes, snapshotted from POS data.</CardDescription>
          </div>
          <Input type="date" value={asOf} onChange={(e) => { setAsOf(e.target.value) }} className="w-auto" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {sheet.loading ? (
          <SkeletonRows rows={3} title={false} />
        ) : sheet.error != null || data == null ? (
          <LoadErrorState whatFailed="Couldn't load the balance sheet." error={sheet.error} onRetry={sheet.retry} />
        ) : (
          <div className="relative space-y-4">
            <div>
              <p className="micro-label mb-1">Assets</p>
              <div className="space-y-1">
                {line("Cash in hand", data.assets.cash_in_hand)}
                {line("Receivables (open bills)", data.assets.receivables)}
                {line("Inventory value", data.assets.inventory_value)}
                {line("Total assets", data.assets.total, true)}
              </div>
            </div>
            <div>
              <p className="micro-label mb-1">Liabilities</p>
              <div className="space-y-1">
                {line("Payables (POs not received)", data.liabilities.payables)}
                {line("Unpaid payroll (as-of month)", data.liabilities.unpaid_payroll)}
                {line("Total liabilities", data.liabilities.total, true)}
              </div>
            </div>
            {line("Equity (assets − liabilities)", data.equity, true)}
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">How these numbers are derived</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {data.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </details>
            <CacheStalePill offline={sheet.offline} fromCache={sheet.fromCache} updatedAt={sheet.updatedAt} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* ── Reconciliation ────────────────────────────────────────────────────── */

export function ReconciliationSection({
  rid,
  money,
}: {
  rid: string
  money: (n: number | null | undefined) => string
}): React.JSX.Element {
  const { toast } = useToast()
  const { timezone } = useTimezone()
  const [date, setDate] = React.useState(() => todayInZone(timezone))
  const recon = useCachedFetch(
    `accounting:recon:${rid}:${date}`,
    React.useCallback(() => fetchReconciliation(rid, date), [rid, date]),
    { enabled: rid.length > 0 },
  )
  const rows = React.useMemo(() => recon.data?.rows ?? [], [recon.data])

  const [actuals, setActuals] = React.useState<Record<string, string>>({})
  const [notes, setNotes] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState<string | null>(null)
  React.useEffect(() => {
    setActuals(Object.fromEntries(rows.map((r) => [r.method, r.actual != null ? String(r.actual) : ""])))
    setNotes(Object.fromEntries(rows.map((r) => [r.method, r.note ?? ""])))
  }, [rows])

  const save = async (method: string): Promise<void> => {
    const actual = Number(actuals[method])
    if (!Number.isFinite(actual) || actual < 0) {
      toast({ title: "Enter the settled amount", variant: "destructive" })
      return
    }
    setSaving(method)
    try {
      const r = await saveReconciliation(rid, { date, method, actual, note: (notes[method] ?? "").trim() || undefined })
      const row: ReconciliationRow = rows.find((x) => x.method === method) ?? {
        method,
        expected: r.expected,
        actual: r.actual,
        status: r.status,
        note: r.note,
      }
      toast({
        title: r.status === "matched" ? "Matched" : "Variance recorded",
        description: `${reportModeName(row)} · expected ${money(r.expected)} · actual ${money(r.actual)}`,
        variant: r.status === "matched" ? undefined : "destructive",
      })
      recon.refresh()
    } catch (error) {
      toast({ title: "Couldn't save", description: String(error instanceof Error ? error.message : error), variant: "destructive" })
    } finally {
      setSaving(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Reconciliation</CardTitle>
            <CardDescription>Match each mode&apos;s POS takings against what actually settled (bank / aggregator / cash count).</CardDescription>
          </div>
          <Input type="date" value={date} onChange={(e) => { setDate(e.target.value) }} className="w-auto" />
        </div>
      </CardHeader>
      <CardContent>
        {recon.loading ? (
          <SkeletonRows rows={3} title={false} />
        ) : recon.error != null ? (
          <LoadErrorState whatFailed="Couldn't load reconciliation." error={recon.error} onRetry={recon.retry} />
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No settled bills on this day.</p>
        ) : (
          <div className="relative space-y-2">
            {rows.map((r) => (
              <div key={r.method} className="rounded-lg border border-border p-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-20 font-medium">{reportModeName(r)}</span>
                  <span className="text-muted-foreground">Expected {money(r.expected)}</span>
                  {r.status === "matched" && <StatusChip status="success" label="Matched" dense />}
                  {r.status === "variance" && (
                    <StatusChip status="danger" label={`Variance ${money((r.actual ?? 0) - r.expected)}`} dense />
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Input
                    type="number" min="0" placeholder="Actual received" className="w-36"
                    value={actuals[r.method] ?? ""}
                    onChange={(e) => { setActuals((a) => ({ ...a, [r.method]: e.target.value })) }}
                  />
                  <Input
                    placeholder="Note (optional)" className="min-w-32 flex-1"
                    value={notes[r.method] ?? ""}
                    onChange={(e) => { setNotes((n) => ({ ...n, [r.method]: e.target.value })) }}
                  />
                  <Button size="sm" disabled={saving === r.method} onClick={() => { void save(r.method) }}>
                    {saving === r.method ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
            ))}
            <CacheStalePill offline={recon.offline} fromCache={recon.fromCache} updatedAt={recon.updatedAt} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
