"use client"

import { Suspense, useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Trash2, Download, Plus } from "lucide-react"
import { useAuth } from "@/context/AuthContext"
import { useCurrency } from "@/hooks/use-currency"
import { useToast } from "@/hooks/use-toast"
import { ClosedBillsSection } from "@/components/closed-bills"
import { DateRangePicker, RangeNote } from "@/components/date-range-picker"
import { useDateRange } from "@/hooks/use-date-range"
import { ScheduledReportsSection } from "./scheduled-reports"
import {
  getSalesReport, getGstReport, getProfitAndLoss, getExpenses, addExpense, deleteExpense, getSalesCsv, getTallyXml,
  getPayroll, setPayrollProfile, payPayroll, getPayrollCsv,
  getBalanceSheet, getReconciliation, saveReconciliation, getDiscountsReport, getOpenBills,
  type SalesReport, type GstReport, type ProfitAndLoss, type ExpenseRow, type PayrollData, type PayrollRow,
  type BalanceSheet, type ReconciliationRow, type DiscountsReport, type OpenBillSummary,
} from "@/lib/db"
import { reportModeName } from "@/lib/payment-methods"
import { readAccountingSales } from "@/lib/gross-net"
import { formatDate, formatFullDateTime, monthKeyInZone, timezoneCaption, todayInZone } from "@/lib/tz"
import { useTimezone } from "@/lib/use-timezone"

const salesChartConfig = { sales: { label: "Gross sales", color: "hsl(var(--primary))" } }

// Open bills are bounded by table count, so one page almost always covers them all.
const PAGE_SIZE = 25

function AccountingInner() {
  const { user } = useAuth()
  const { currency } = useCurrency()
  const { toast } = useToast()
  const { timezone } = useTimezone()
  const rid = user?.restaurantUsername ?? ""

  // Every date boundary on this page is a RESTAURANT day, not a UTC one. A UTC
  // day key filed every sale rung up before the rollover under the previous
  // day — precisely the late-night covers, and precisely the numbers an
  // accountant reconciles against the till. The page range comes from
  // `useDateRange`; the two single-date controls below seed off `todayInZone`.
  // ONE window for the whole page, from the shared control. It seeds from
  // ?from=&to= (History's month rows deep-link here), then from what this screen
  // was last set to in this session, then from the 30-day default — so coming
  // back from another module does not silently reset the period the owner was
  // reasoning about.
  const search = useSearchParams()
  const { range, setRange } = useDateRange("accounting", { params: search })
  const { from, to } = range
  // A link that is about particular bills (item 10: a payment mode's own bills,
  // the Split bills) names the filter and anchors #settled-bills.
  const linkedMethod = search.get("method")?.trim()
  const [loading, setLoading] = useState(true)
  const [sales, setSales] = useState<SalesReport | null>(null)
  const [gst, setGst] = useState<GstReport | null>(null)
  const [pnl, setPnl] = useState<ProfitAndLoss | null>(null)
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [discounts, setDiscounts] = useState<DiscountsReport | null>(null)
  // Lifted out of OpenBillsSection so the summary tile can show it up front.
  const [outstanding, setOutstanding] = useState(0)

  // New-expense form
  const [exCategory, setExCategory] = useState("General")
  const [exAmount, setExAmount] = useState("")
  const [exVendor, setExVendor] = useState("")
  const [exNote, setExNote] = useState("")
  const [adding, setAdding] = useState(false)

  const money = (n: number | null | undefined) => `${currency}${Number(n ?? 0).toFixed(0)}`

  const load = useCallback(async () => {
    if (!rid) {return}
    setLoading(true)
    try {
      const [s, g, p, e, d] = await Promise.all([
        getSalesReport(rid, from, to),
        getGstReport(rid, from, to),
        getProfitAndLoss(rid, from, to),
        getExpenses(rid, from, to),
        getDiscountsReport(rid, from, to),
      ])
      setSales(s)
      setGst(g)
      setPnl(p)
      setExpenses(e?.expenses ?? [])
      setDiscounts(d)
    } finally {
      setLoading(false)
    }
  }, [rid, from, to])

  useEffect(() => { void load() }, [load])

  // The anchor is only there once the figures above it have painted, which is
  // after the browser gave up looking for it — so it is brought into view once,
  // when the first load lands.
  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    if (loading || revealed || typeof window === "undefined" || window.location.hash !== "#settled-bills") {return}
    const el = document.getElementById("settled-bills")
    if (!el) {return}
    el.scrollIntoView({ block: "start" })
    queueMicrotask(() => { setRevealed(true) })
  }, [loading, revealed])

  const onAddExpense = async () => {
    const amount = Number(exAmount)
    if (!(amount > 0)) {
      toast({ title: "Enter a valid amount", variant: "destructive" })
      return
    }
    setAdding(true)
    try {
      await addExpense(rid, {
        amount,
        category: exCategory.trim() || "General",
        vendor: exVendor.trim() || undefined,
        note: exNote.trim() || undefined,
      })
      setExAmount(""); setExVendor(""); setExNote("")
      await load()
    } catch (err) {
      toast({ title: "Could not add expense", description: String((err as Error)?.message ?? err), variant: "destructive" })
    } finally {
      setAdding(false)
    }
  }

  const onDeleteExpense = async (id: string) => {
    try {
      await deleteExpense(rid, id)
      await load()
    } catch {
      toast({ title: "Could not delete expense", variant: "destructive" })
    }
  }

  const exportTally = async () => {
    try {
      const xml = await getTallyXml(rid, from, to)
      const url = URL.createObjectURL(new Blob([xml], { type: "application/xml" }))
      const a = document.createElement("a")
      a.href = url
      a.download = `tally_${from}_to_${to}.xml`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast({ title: "Could not export Tally XML", description: String((e as Error)?.message ?? e), variant: "destructive" })
    }
  }

  // Downloaded from the backend, not built here — the same bytes the SCHEDULED
  // sales report delivers, because both come out of renderSalesCsv. Assembling a
  // second copy in the browser is what let the two drift: this one joined on ","
  // with no escaping and had no Service Charge column, so the owner clicking
  // "Sales CSV" and the owner opening their 8am scheduled file got two different
  // sheets for the same range. Shaped exactly like exportTally below.
  const exportSalesCsv = async () => {
    try {
      const csv = await getSalesCsv(rid, from, to)
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
      const a = document.createElement("a")
      a.href = url
      // The backend's own Content-Disposition name for this range.
      a.download = `sales_${sales?.from ?? from}_to_${sales?.to ?? to}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast({ title: "Could not export sales CSV", description: String((e as Error)?.message ?? e), variant: "destructive" })
    }
  }

  const byDay = (sales?.by_day ?? []).map((d) => ({ date: d.date.slice(5), sales: d.sales }))
  const salesWords = readAccountingSales(sales)

  return (
    <div className="grid gap-4 md:gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold md:text-2xl">Accounting</h1>
          {/* Which zone these numbers are in. Without it a date range is
              ambiguous — an accountant reading "1st to 31st" has no way to know
              whose midnight closed the month. */}
          <p className="text-xs text-muted-foreground" title={`All dates and totals on this page are bucketed by the restaurant's calendar day in ${timezone}. Now: ${formatFullDateTime(Date.now(), timezone)}`}>
            All dates in restaurant time · {timezoneCaption(timezone)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker value={range} onChange={setRange} timezone={timezone} />
          {/* Both exports are cut on the SAME `range` the screen is showing. An
              export that quietly disagrees with the figures above it is worse
              than no export — it is the version that gets filed. */}
          <Button variant="outline" size="sm" onClick={exportSalesCsv} disabled={!sales}>
            <Download className="mr-1 h-4 w-4" /> Sales CSV
          </Button>
          <Button variant="outline" size="sm" onClick={exportTally} disabled={!sales}>
            <Download className="mr-1 h-4 w-4" /> Tally XML
          </Button>
        </div>
      </div>

      {/* The five headline figures are the ones most likely to be misread as
          all-time numbers, so the window is stated directly above them rather
          than only on the toolbar, which scrolls away. */}
      <div className="flex items-center justify-between gap-2">
        <RangeNote range={range} timezone={timezone} prefix="All figures below cover" className="text-sm" />
      </div>
      {/* Summary cards drill down to the section holding their source records. */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {/* NET, in the client's word: after discount, before service charge, tax
            and round off. The old card showed net_sales — the grand total less
            refunds, tax and all — under this name; that figure is still here, as
            what it is. Gross is the grand total. See lib/gross-net.ts. */}
        <a href="#sales-section" className="block" title="Jump to daily sales">
          <Card className="h-full transition-shadow hover:shadow-md">
            <CardHeader className="pb-2">
              <CardDescription>{salesWords.headline.label} ↗</CardDescription>
              <CardTitle className="text-2xl">{money(salesWords.headline.value)}</CardTitle>
              <div className="text-xs text-muted-foreground">
                Gross sales {money(salesWords.grossSales)}
                {salesWords.netSales !== null ? <> · Gross after refunds {money(salesWords.grossAfterRefunds)}</> : null}
              </div>
            </CardHeader>
          </Card>
        </a>
        <a href="#gst-section" className="block" title="Jump to GST breakdown">
          <Card className="h-full transition-shadow hover:shadow-md"><CardHeader className="pb-2"><CardDescription>GST collected ↗</CardDescription><CardTitle className="text-2xl">{money(gst?.total_tax)}</CardTitle></CardHeader></Card>
        </a>
        <a href="#expenses-section" className="block" title="Jump to expenses">
          <Card className="h-full transition-shadow hover:shadow-md"><CardHeader className="pb-2"><CardDescription>Expenses ↗</CardDescription><CardTitle className="text-2xl">{money(pnl?.total_expenses)}</CardTitle></CardHeader></Card>
        </a>
        <Card><CardHeader className="pb-2"><CardDescription>Net profit</CardDescription><CardTitle className="text-2xl">{money(pnl?.net_profit)}</CardTitle></CardHeader></Card>
        {/* Not a range figure like its four neighbours — it is the money sitting
            uncollected RIGHT NOW, which is why it says "now" on the tile. */}
        <a href="#open-bills-section" className="block" title="Jump to open bills">
          <Card className="h-full transition-shadow hover:shadow-md">
            <CardHeader className="pb-2">
              <CardDescription>Outstanding now ↗</CardDescription>
              <CardTitle className={`text-2xl ${outstanding > 0 ? "text-amber-600 dark:text-amber-400" : ""}`}>{money(outstanding)}</CardTitle>
            </CardHeader>
          </Card>
        </a>
      </div>

      <Card id="sales-section" className="scroll-mt-20">
        <CardHeader>
          <CardTitle>Sales — daily</CardTitle>
          <CardDescription>Settled bills per day in the selected range.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 text-center text-muted-foreground">Loading…</div>
          ) : byDay.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">No settled bills in this range.</div>
          ) : (
            <ChartContainer config={salesChartConfig} className="h-[260px] w-full">
              <BarChart data={byDay} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="date" />
                <YAxis />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="sales" fill="var(--color-sales)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 md:gap-8">
        <Card>
          <CardHeader><CardTitle>By payment method</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(sales?.by_method ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No data.</p>
            ) : (
              sales!.by_method.map((m) => (
                <div key={m.method} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                  <span className="font-medium">{reportModeName(m)}</span>
                  <span className="text-muted-foreground">{m.bills} bills</span>
                  <span className="font-semibold">{money(m.sales)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card id="gst-section" className="scroll-mt-20">
          <CardHeader><CardTitle>GST breakdown</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(gst?.by_rate ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No tax collected in this range.</p>
            ) : (
              gst!.by_rate.map((t) => (
                <div key={`${t.name}-${t.percentage}`} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                  <span className="font-medium">{t.name} · {t.percentage}%</span>
                  <span className="text-muted-foreground">on {money(t.taxable)}</span>
                  <span className="font-semibold">{money(t.tax)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Money still on the floor. Deliberately ABOVE the settled bills and
          outside the date range: everything else on this page reports a closed
          period, this one is the present tense. */}
      <OpenBillsSection rid={rid} onTotal={setOutstanding} />

      {/* The source records behind every figure above — same date range. The
          card's own picker drives THIS page window (setRange), not a private
          one, so changing the days from down here moves the totals too. */}
      <div id="settled-bills" className="scroll-mt-20">
        <ClosedBillsSection
          rid={rid}
          from={from}
          to={to}
          range={range}
          onRangeChange={setRange}
          initialMethod={linkedMethod}
          description="The individual settled bills behind the sales, GST and discount figures above. Open one for its line items, taxes, service charge, payment and settlement trail."
        />
      </div>

      <Card id="discounts-section" className="scroll-mt-20">
        <CardHeader>
          <CardTitle>Discounts &amp; offers</CardTitle>
          <CardDescription>
            Money given away on settled bills in this range. Bill totals are stored after discount,
            so the sales and P&amp;L figures above already reflect these — nothing here is double-counted.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading || !discounts ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : discounts.discounted_bills === 0 && discounts.by_coupon.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No discounts or coupon redemptions in this range.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <div className="rounded-lg border p-2 text-sm">
                  <p className="text-xs text-muted-foreground">Total discounts</p>
                  <p className="font-semibold">{discounts.estimated_bills > 0 ? "≈" : ""}{money(discounts.total_discount)}</p>
                </div>
                <div className="rounded-lg border p-2 text-sm">
                  <p className="text-xs text-muted-foreground">Discounted bills</p>
                  <p className="font-semibold">{discounts.discounted_bills} <span className="text-xs font-normal text-muted-foreground">of {discounts.bill_count}</span></p>
                </div>
                <div className="rounded-lg border p-2 text-sm">
                  <p className="text-xs text-muted-foreground">Manual discounts</p>
                  <p className="font-semibold">{money(discounts.manual_discount)}</p>
                </div>
                <div className="rounded-lg border p-2 text-sm">
                  <p className="text-xs text-muted-foreground">Coupons &amp; vouchers</p>
                  <p className="font-semibold">
                    {money(discounts.coupon_discount)}
                    {discounts.gift_redemption_total > 0 && (
                      <span className="text-xs font-normal text-muted-foreground"> · gift {money(discounts.gift_redemption_total)}</span>
                    )}
                  </p>
                </div>
              </div>

              {discounts.by_coupon.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">By coupon code</p>
                  {discounts.by_coupon.map((c) => (
                    <div key={c.code} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                      <span className="font-medium">
                        {c.code}
                        {c.kind === "gift" && (
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">Gift voucher</span>
                        )}
                      </span>
                      <span className="text-muted-foreground">{c.uses} use{c.uses === 1 ? "" : "s"}</span>
                      <span className="font-semibold">{money(c.amount)}</span>
                    </div>
                  ))}
                </div>
              )}

              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">How these numbers are derived</summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {discounts.notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              </details>
            </>
          )}
        </CardContent>
      </Card>

      <Card id="expenses-section" className="scroll-mt-20">
        <CardHeader>
          <CardTitle>Expenses</CardTitle>
          <CardDescription>Track operating costs — they feed the Profit &amp; Loss above.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Input placeholder="Category" value={exCategory} onChange={(e) => { setExCategory(e.target.value); }} />
            <Input placeholder="Amount" type="number" value={exAmount} onChange={(e) => { setExAmount(e.target.value); }} />
            <Input placeholder="Vendor (optional)" value={exVendor} onChange={(e) => { setExVendor(e.target.value); }} />
            <Input placeholder="Note (optional)" value={exNote} onChange={(e) => { setExNote(e.target.value); }} />
            <Button onClick={onAddExpense} disabled={adding}>
              <Plus className="mr-1 h-4 w-4" /> {adding ? "Adding…" : "Add"}
            </Button>
          </div>

          {expenses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No expenses in this range yet.</p>
          ) : (
            <div className="space-y-2">
              {expenses.map((e) => (
                <div key={e.id} className="flex items-center gap-3 rounded-lg border p-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{e.category}{e.vendor ? ` · ${e.vendor}` : ""}</p>
                    <p className="text-xs text-muted-foreground">{e.spent_on}{e.note ? ` · ${e.note}` : ""}</p>
                  </div>
                  <span className="font-semibold">{money(e.amount)}</span>
                  <Button variant="ghost" size="icon" onClick={() => onDeleteExpense(e.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid items-start gap-4 md:grid-cols-2 md:gap-8">
        <BalanceSheetSection rid={rid} money={money} />
        <ReconciliationSection rid={rid} money={money} />
      </div>

      <PayrollSection rid={rid} money={money} onPaid={() => void load()} />

      {/* Configuration rather than a report, so it sits last: the same sales,
          GST and P&L numbers above, built on a schedule instead of on demand. */}
      <ScheduledReportsSection rid={rid} />
    </div>
  )
}

// useSearchParams requires a Suspense boundary (same pattern as the queue page).
export default function AccountingPage() {
  return (
    <Suspense fallback={<div className="py-10 text-center text-muted-foreground">Loading…</div>}>
      <AccountingInner />
    </Suspense>
  )
}

// Open (unsettled) bills — the only list of them anywhere in the product.
//
// Everything else on this page reports a CLOSED period from settled bills, so
// until now "who owes me money right now" had no answer and the Overview's
// unsettled-bills alert had nowhere to link but the floor plan. Hence: no date
// range (it is live state), and the outstanding total stated before the rows.
//
// Every figure comes from the backend already split into taxable base / service
// charge / tax. Nothing is recomputed here — a bill the waiter hasn't confirmed
// yet stores its PRE-TAX subtotal in the database, and only the server knows to
// re-price it.
function OpenBillsSection({ rid, onTotal }: { rid: string; onTotal: (n: number) => void }) {
  const { timezone } = useTimezone()
  const { currencySymbol } = useCurrency()
  const exact = (n: number | null | undefined) =>
    `${currencySymbol}${Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const [bills, setBills] = useState<OpenBillSummary[]>([])
  const [outstanding, setOutstanding] = useState(0)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  // An empty floor and an unreachable backend must not render the same, or an
  // outage reads as "nobody owes you anything".
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    if (!rid) {return}
    setLoading(true)
    const page = await getOpenBills(rid, { limit: PAGE_SIZE, offset: 0 })
    if (!page) {
      setFailed(true)
      setBills([])
      setLoading(false)
      return
    }
    setFailed(false)
    setBills(page.bills)
    setTotal(page.total)
    setHasMore(page.has_more)
    setOutstanding(page.outstanding_total)
    onTotal(page.outstanding_total)
    setLoading(false)
  }, [rid, onTotal])

  useEffect(() => { void load() }, [load])

  const loadMore = async () => {
    setLoadingMore(true)
    const page = await getOpenBills(rid, { limit: PAGE_SIZE, offset: bills.length })
    if (page) {
      setBills((prev) => [...prev, ...page.bills])
      setHasMore(page.has_more)
    }
    setLoadingMore(false)
  }

  // Rough age, in the units a manager thinks in.
  const age = (minutes: number) => {
    if (minutes < 60) {return `${minutes}m`}
    if (minutes < 60 * 24) {return `${Math.floor(minutes / 60)}h ${minutes % 60}m`}
    const days = Math.floor(minutes / (60 * 24))
    return `${days}d ${Math.floor((minutes % (60 * 24)) / 60)}h`
  }

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
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total outstanding</p>
            <p className={`text-2xl font-semibold ${outstanding > 0 ? "text-amber-600 dark:text-amber-400" : ""}`}>{exact(outstanding)}</p>
            <p className="text-xs text-muted-foreground">
              {total} open bill{total === 1 ? "" : "s"}
              {awaiting > 0 ? ` · ${awaiting} awaiting approval` : ""}
              {stale > 0 ? ` · ${stale} over a day old` : ""}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : failed ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            <p>Couldn&apos;t load open bills.</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void load()}>Retry</Button>
          </div>
        ) : bills.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing outstanding — every bill is settled.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Table</th>
                    <th className="py-2 pr-3 font-medium">Opened</th>
                    <th className="py-2 pr-3 font-medium">Open for</th>
                    <th className="py-2 pr-3 font-medium">Covers</th>
                    <th className="py-2 pr-3 font-medium">Orders</th>
                    <th className="py-2 pr-3 font-medium">Opened by</th>
                    <th className="py-2 pr-3 text-right font-medium">Running total</th>
                  </tr>
                </thead>
                <tbody>
                  {bills.map((b) => (
                    <tr key={b.id} className="border-b last:border-0 align-top">
                      <td className="py-2 pr-3">
                        <span className="font-medium">{b.table_name ?? "—"}</span>
                        {b.bill_no && <span className="ml-2 text-xs text-muted-foreground">#{b.bill_no}</span>}
                        {b.stage !== "running" && (
                          <Badge variant="outline" className="ml-2 border-amber-500 text-amber-600 dark:text-amber-400">
                            {b.stage === "awaiting_approval" ? "Payment awaiting approval" : "Approved"}
                          </Badge>
                        )}
                        {b.coupon_code && <span className="ml-2 text-xs text-muted-foreground">{b.coupon_code}</span>}
                      </td>
                      {/* The restaurant's own wall clock, computed server-side —
                          an accountant reads the same time the till printed. */}
                      <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">{b.opened_at_local || "—"}</td>
                      <td className={`py-2 pr-3 whitespace-nowrap ${b.age_minutes >= 60 * 24 ? "font-medium text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                        {age(b.age_minutes)}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">{b.covers ?? "—"}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{b.order_count}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{b.opened_by ?? "—"}</td>
                      <td className="py-2 pr-3 text-right">
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
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Showing {bills.length} of {total} · times in {timezoneCaption(timezone)}
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => void load()}>Refresh</Button>
                {hasMore && (
                  <Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
                    {loadingMore ? "Loading…" : "Load more"}
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function BalanceSheetSection({ rid, money }: { rid: string; money: (n: number | null | undefined) => string }) {
  const { timezone } = useTimezone()
  // "As of today" means the restaurant's today.
  const [asOf, setAsOf] = useState(() => todayInZone(timezone))
  const [data, setData] = useState<BalanceSheet | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!rid) {return}
    setLoading(true)
    try { setData(await getBalanceSheet(rid, asOf)) } finally { setLoading(false) }
  }, [rid, asOf])

  useEffect(() => { void load() }, [load])

  const line = (label: string, value: number | undefined, bold = false) => (
    <div className={`flex items-center justify-between rounded-lg border p-2 text-sm ${bold ? "font-semibold" : ""}`}>
      <span>{label}</span>
      <span>{money(value)}</span>
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
          <Input type="date" value={asOf} onChange={(e) => { setAsOf(e.target.value); }} className="w-auto" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading || !data ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Assets</p>
              <div className="space-y-1">
                {line("Cash in hand", data.assets.cash_in_hand)}
                {line("Receivables (open bills)", data.assets.receivables)}
                {line("Inventory value", data.assets.inventory_value)}
                {line("Total assets", data.assets.total, true)}
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Liabilities</p>
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
          </>
        )}
      </CardContent>
    </Card>
  )
}

function ReconciliationSection({ rid, money }: { rid: string; money: (n: number | null | undefined) => string }) {
  const { toast } = useToast()
  const { timezone } = useTimezone()
  const [date, setDate] = useState(() => todayInZone(timezone))
  const [rows, setRows] = useState<ReconciliationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [actuals, setActuals] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!rid) {return}
    setLoading(true)
    try {
      const d = await getReconciliation(rid, date)
      const rs = d?.rows ?? []
      setRows(rs)
      setActuals(Object.fromEntries(rs.map((r) => [r.method, r.actual != null ? String(r.actual) : ""])))
      setNotes(Object.fromEntries(rs.map((r) => [r.method, r.note ?? ""])))
    } finally { setLoading(false) }
  }, [rid, date])

  useEffect(() => { void load() }, [load])

  const save = async (method: string) => {
    const actual = Number(actuals[method])
    if (!Number.isFinite(actual) || actual < 0) {
      toast({ title: "Enter the settled amount", variant: "destructive" })
      return
    }
    setSaving(method)
    try {
      const r = await saveReconciliation(rid, { date, method, actual, note: (notes[method] ?? "").trim() || undefined })
      toast({
        title: r.status === "matched" ? "Matched" : "Variance recorded",
        description: `${reportModeName(rows.find((x) => x.method === method) ?? { method })} · expected ${money(r.expected)} · actual ${money(r.actual)}`,
        variant: r.status === "matched" ? undefined : "destructive",
      })
      await load()
    } catch (e: any) {
      toast({ title: "Couldn't save", description: String(e?.message ?? e), variant: "destructive" })
    } finally { setSaving(null) }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Reconciliation</CardTitle>
            <CardDescription>Match each mode&apos;s POS takings against what actually settled (bank / aggregator / cash count).</CardDescription>
          </div>
          <Input type="date" value={date} onChange={(e) => { setDate(e.target.value); }} className="w-auto" />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No settled bills on this day.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.method} className="rounded-lg border p-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-20 font-medium">{reportModeName(r)}</span>
                  <span className="text-muted-foreground">Expected {money(r.expected)}</span>
                  {r.status === "matched" && (
                    <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-950 dark:text-green-300">Matched</span>
                  )}
                  {r.status === "variance" && (
                    <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-950 dark:text-red-300">
                      Variance {money((r.actual ?? 0) - r.expected)}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Input
                    type="number" min="0" placeholder="Actual received" className="w-36"
                    value={actuals[r.method] ?? ""}
                    onChange={(e) => { setActuals((a) => ({ ...a, [r.method]: e.target.value })); }}
                  />
                  <Input
                    placeholder="Note (optional)" className="min-w-32 flex-1"
                    value={notes[r.method] ?? ""}
                    onChange={(e) => { setNotes((n) => ({ ...n, [r.method]: e.target.value })); }}
                  />
                  <Button size="sm" disabled={saving === r.method} onClick={() => void save(r.method)}>
                    {saving === r.method ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function PayrollSection({ rid, money, onPaid }: { rid: string; money: (n: number | null | undefined) => string; onPaid: () => void }) {
  const { toast } = useToast()
  const { timezone } = useTimezone()
  const [month, setMonth] = useState(() => monthKeyInZone(new Date(), timezone))
  const [data, setData] = useState<PayrollData | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState({ pay_type: "monthly", base_salary: "", hourly_rate: "", allowances: "", deductions: "", pf_pct: "", esi_pct: "" })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!rid) {return}
    setLoading(true)
    try { setData(await getPayroll(rid, month)) } finally { setLoading(false) }
  }, [rid, month])

  useEffect(() => { void load() }, [load])

  const startEdit = (r: PayrollRow) => {
    setEditing(r.emp_id)
    setForm({
      pay_type: r.profile?.pay_type ?? "monthly",
      base_salary: String(r.profile?.base_salary ?? ""),
      hourly_rate: String(r.profile?.hourly_rate ?? ""),
      allowances: String(r.profile?.allowances ?? ""),
      deductions: String(r.profile?.deductions ?? ""),
      pf_pct: String(r.profile?.pf_pct ?? ""),
      esi_pct: String(r.profile?.esi_pct ?? ""),
    })
  }

  const saveProfile = async (empId: string) => {
    setBusy(true)
    try {
      await setPayrollProfile(rid, {
        emp_id: empId,
        pay_type: form.pay_type,
        base_salary: Number(form.base_salary) || 0,
        hourly_rate: Number(form.hourly_rate) || 0,
        allowances: Number(form.allowances) || 0,
        deductions: Number(form.deductions) || 0,
        pf_pct: Number(form.pf_pct) || 0,
        esi_pct: Number(form.esi_pct) || 0,
      })
      setEditing(null)
      await load()
      toast({ title: "Salary profile saved" })
    } catch (e: any) {
      toast({ title: "Couldn't save", description: String(e?.message ?? e), variant: "destructive" })
    } finally { setBusy(false) }
  }

  const pay = async (r: PayrollRow) => {
    if (r.computed_pay == null) {return}
    if (!window.confirm(`Record salary of ${money(r.computed_pay)} for ${r.name} (${month})? This also books a Payroll expense.`)) {return}
    setBusy(true)
    try {
      await payPayroll(rid, { emp_id: r.emp_id, period: month, amount: r.computed_pay })
      await load()
      onPaid() // refresh expenses/P&L above
      toast({ title: "Salary recorded", description: `${r.name} · ${money(r.computed_pay)} · booked as a Payroll expense.` })
    } catch (e: any) {
      toast({ title: "Couldn't record payment", description: String(e?.message ?? e), variant: "destructive" })
    } finally { setBusy(false) }
  }

  const exportCsv = async () => {
    try {
      const csv = await getPayrollCsv(rid, month)
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
      const a = document.createElement("a")
      a.href = url
      a.download = `payroll_${month}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      toast({ title: "Couldn't export payroll", description: String(e?.message ?? e), variant: "destructive" })
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Payroll</CardTitle>
            <CardDescription>
              Set each employee&apos;s salary, then record the month&apos;s payment — it books a &quot;Payroll&quot; expense automatically.
              {data ? <> Due: <b>{money(data.total_due)}</b> · Paid: <b>{money(data.total_paid)}</b></> : null}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Input type="month" value={month} onChange={(e) => { setMonth(e.target.value); }} className="w-44" />
            <Button variant="outline" size="sm" onClick={() => void exportCsv()} disabled={!data || data.rows.length === 0}>
              <Download className="mr-1 h-4 w-4" /> CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : !data || data.rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No employees found.</p>
        ) : (
          <div className="space-y-2">
            {data.rows.map((r) => (
              <div key={r.emp_id} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{r.name} <span className="text-xs text-muted-foreground">· {r.role}</span></p>
                    <p className="text-xs text-muted-foreground">
                      {r.profile
                        ? r.profile.pay_type === "hourly"
                          ? `Hourly ${money(r.profile.hourly_rate)}/h · ${r.hours_worked}h worked`
                          : `Monthly ${money(r.profile.base_salary)}`
                        : "No salary set"}
                      {r.profile && (r.profile.allowances > 0 || r.profile.deductions > 0)
                        ? ` · +${money(r.profile.allowances)} / −${money(r.profile.deductions)}` : ""}
                      {(r.pf_amount ?? 0) > 0 || (r.esi_amount ?? 0) > 0
                        ? ` · PF −${money(r.pf_amount)} · ESI −${money(r.esi_amount)}` : ""}
                    </p>
                  </div>
                  {r.paid ? (
                    <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-950 dark:text-green-300">
                      Paid {money(r.paid_amount)}{r.paid_at ? ` · ${formatDate(r.paid_at, timezone)}` : ""}
                    </span>
                  ) : (
                    <>
                      <span className="font-semibold">{r.computed_pay != null ? money(r.computed_pay) : "—"}</span>
                      <Button size="sm" variant="outline" onClick={() => { editing === r.emp_id ? setEditing(null) : startEdit(r); }}>
                        {r.profile ? "Edit salary" : "Set salary"}
                      </Button>
                      {r.computed_pay != null && r.computed_pay > 0 && (
                        <Button size="sm" disabled={busy} onClick={() => void pay(r)}>Mark paid</Button>
                      )}
                    </>
                  )}
                </div>

                {editing === r.emp_id && (
                  <div className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-4 lg:grid-cols-8">
                    <select
                      value={form.pay_type}
                      onChange={(e) => { setForm((f) => ({ ...f, pay_type: e.target.value })); }}
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-ring"
                    >
                      <option value="monthly">Monthly</option>
                      <option value="hourly">Hourly</option>
                    </select>
                    {form.pay_type === "monthly" ? (
                      <Input type="number" min="0" placeholder="Base salary / month" value={form.base_salary} onChange={(e) => { setForm((f) => ({ ...f, base_salary: e.target.value })); }} />
                    ) : (
                      <Input type="number" min="0" placeholder="Rate / hour" value={form.hourly_rate} onChange={(e) => { setForm((f) => ({ ...f, hourly_rate: e.target.value })); }} />
                    )}
                    <Input type="number" min="0" placeholder="Allowances" value={form.allowances} onChange={(e) => { setForm((f) => ({ ...f, allowances: e.target.value })); }} />
                    <Input type="number" min="0" placeholder="Deductions" value={form.deductions} onChange={(e) => { setForm((f) => ({ ...f, deductions: e.target.value })); }} />
                    <Input type="number" min="0" max="100" placeholder="PF %" title="Provident fund % of gross" value={form.pf_pct} onChange={(e) => { setForm((f) => ({ ...f, pf_pct: e.target.value })); }} />
                    <Input type="number" min="0" max="100" placeholder="ESI %" title="ESI % of gross" value={form.esi_pct} onChange={(e) => { setForm((f) => ({ ...f, esi_pct: e.target.value })); }} />
                    <Button size="sm" disabled={busy} onClick={() => void saveProfile(r.emp_id)}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(null); }}>Cancel</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
