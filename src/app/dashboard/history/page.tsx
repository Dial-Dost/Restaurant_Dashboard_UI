"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ChevronDown } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { useAuth } from "@/context/AuthContext"
import { useCurrency } from "@/hooks/use-currency"
import { timezoneCaption, todayInZone } from "@/lib/tz"
import { useTimezone } from "@/lib/use-timezone"
import { ClosedBillsSection } from "@/components/closed-bills"
import { DateRangePicker, RangeNote } from "@/components/date-range-picker"
import { useDateRange } from "@/hooks/use-date-range"
import { addDays, rangeLabel, type DateRange } from "@/lib/date-range"
import { getMonthlyHistory, type MonthlyHistoryRow } from "@/lib/db"

const chartConfig = {
  revenue: { label: "Revenue", color: "hsl(var(--primary))" },
}

// History exists to show YEARS, so it opens on the last twelve months rather
// than the 30-day default every other reporting screen uses — a month-by-month
// table cut to one month is a single row, which looks like a broken page.
// Applied only on a first visit; a window the owner picked wins (see
// `useDateRange`'s `fallback`).
const historyDefault = (timezone: string): DateRange => {
  const today = todayInZone(timezone)
  return { from: addDays(today, -364), to: today, preset: "custom" }
}

// The backend's month series is "the last N months", so a range is served by
// asking for enough months to reach `from` and then keeping the ones inside the
// window. 36 is the endpoint's own ceiling; a longer range simply shows what
// the server retains, which the caption states rather than hides.
const MAX_HISTORY_MONTHS = 36
const monthsBack = (from: string, timezone: string): number => {
  const [fy, fm] = from.split("-").map(Number)
  const [ty, tm] = todayInZone(timezone).split("-").map(Number)
  const span = (ty - fy) * 12 + (tm - fm) + 1
  return Math.max(3, Math.min(MAX_HISTORY_MONTHS, span))
}

// "2026-06" → "Jun 2026"
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
function prettyMonth(ym: string): string {
  const [y, m] = ym.split("-")
  const idx = Number(m) - 1
  return idx >= 0 && idx < 12 ? `${MONTH_NAMES[idx]} ${y}` : ym
}

// "2026-06" → that month's real first/last day (not a blind "-31").
function monthRange(ym: string): { from: string; to: string } | null {
  const [y, m] = ym.split("-").map(Number)
  if (!y || !m) {return null}
  const lastDay = new Date(y, m, 0).getDate() // day 0 of next month = last of this one
  const mm = String(m).padStart(2, "0")
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(lastDay).padStart(2, "0")}` }
}

// Drill-down: "2026-06" → the accounting page filtered to that whole month.
function monthDrilldownHref(ym: string): string {
  const r = monthRange(ym)
  return r ? `/dashboard/accounting?from=${r.from}&to=${r.to}` : "/dashboard/accounting"
}

// One labeled figure in the expanded month panel.
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  )
}

export default function HistoryPage() {
  const { user } = useAuth()
  const { currency } = useCurrency()
  const { timezone } = useTimezone()
  // ONE window for the page: the month table, the chart, the totals and the
  // settled-bill browser below are all cut on it, so nothing on this screen can
  // disagree with anything else on it.
  const { range, setRange } = useDateRange("history", { fallback: historyDefault })
  const months = monthsBack(range.from, timezone)
  const [rows, setRows] = useState<MonthlyHistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [hideEmpty, setHideEmpty] = useState(true)
  const [openMonth, setOpenMonth] = useState<string | null>(null)
  // Seeds the closed-bills section below; a month row can narrow it to that month.
  const [billRange, setBillRange] = useState<{ from: string; to: string } | null>(null)
  const money = (n: number | null | undefined) => `${currency}${Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`

  useEffect(() => {
    if (!user?.restaurantUsername) {return}
    let active = true
    setLoading(true)
    getMonthlyHistory(user.restaurantUsername, months)
      .then((d) => { if (active) {setRows(d)} })
      .finally(() => { if (active) {setLoading(false)} })
    return () => { active = false }
  }, [user?.restaurantUsername, months])

  const hasActivity = (r: MonthlyHistoryRow) => r.revenue > 0 || r.orders > 0 || r.feedback_count > 0 || r.new_customers > 0
  // Trim the server's month series to the SELECTED window. A month is kept when
  // it overlaps the range at all: an owner who picks 10 Aug - 20 Sep is asking
  // about both months, and dropping a partly-covered month would silently
  // subtract real trade from the totals below.
  const inRange = rows.filter((r) => r.month >= range.from.slice(0, 7) && r.month <= range.to.slice(0, 7))
  const visible = hideEmpty ? inRange.filter(hasActivity) : inRange
  const chartData = [...inRange].reverse().map((r) => ({ month: prettyMonth(r.month), revenue: r.revenue }))
  const totals = inRange.reduce(
    (acc, r) => ({ revenue: acc.revenue + r.revenue, bills: acc.bills + r.bills, orders: acc.orders + r.orders, customers: acc.customers + r.new_customers }),
    { revenue: 0, bills: 0, orders: 0, customers: 0 },
  )

  return (
    <div className="grid gap-4 md:gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold md:text-2xl">History</h1>
          <p className="text-sm text-muted-foreground">Month-by-month summary of the whole business, up to 3 years back.</p>
          <p className="text-xs text-muted-foreground">All times in restaurant time · {timezoneCaption(timezone)}</p>
        </div>
        <DateRangePicker value={range} onChange={setRange} timezone={timezone} />
      </div>

      <RangeNote range={range} timezone={timezone} prefix="Every figure on this page covers" className="text-sm" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardDescription>Total revenue</CardDescription><CardTitle className="text-xl">{money(totals.revenue)}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Bills</CardDescription><CardTitle className="text-xl">{totals.bills}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Orders</CardDescription><CardTitle className="text-xl">{totals.orders}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>New customers</CardDescription><CardTitle className="text-xl">{totals.customers}</CardTitle></CardHeader></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Revenue by month</CardTitle>
          <CardDescription>{rangeLabel(range, timezone)} · {chartData.length} month{chartData.length === 1 ? "" : "s"}.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 text-center text-muted-foreground">Loading…</div>
          ) : (
            <ChartContainer config={chartConfig} className="h-[260px] w-full">
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" interval={months > 12 ? 2 : 0} tick={{ fontSize: 11 }} />
                <YAxis />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Monthly summary</CardTitle>
              <CardDescription>
                Revenue, volume, guests and service quality per month. <RangeNote range={range} timezone={timezone} />
              </CardDescription>
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={hideEmpty} onChange={(e) => { setHideEmpty(e.target.checked); }} className="h-4 w-4 accent-current" />
              Hide empty months
            </label>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 text-center text-muted-foreground">Loading…</div>
          ) : visible.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No activity recorded in this range yet.</p>
          ) : (
            <div className="divide-y rounded-md border">
              {visible.map((r) => {
                const open = openMonth === r.month
                return (
                  <div key={r.month} className={hasActivity(r) ? "" : "text-muted-foreground"}>
                    <button
                      type="button"
                      onClick={() => { setOpenMonth(open ? null : r.month); }}
                      aria-expanded={open}
                      className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition hover:bg-muted/50"
                    >
                      <span className="font-medium">{prettyMonth(r.month)}</span>
                      <span className="flex items-center gap-3">
                        <span className="font-semibold">{money(r.revenue)}</span>
                        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
                      </span>
                    </button>
                    {open && (
                      <div className="border-t bg-muted/20 px-3 py-4">
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                          <Stat label="Revenue" value={money(r.revenue)} />
                          <Stat label="Bills" value={String(r.bills)} />
                          <Stat label="Orders" value={String(r.orders)} />
                          <Stat label="Avg bill" value={r.avg_bill != null ? money(r.avg_bill) : "—"} />
                          <Stat label="Discounts" value={r.discounts > 0 ? money(r.discounts) : "—"} />
                          <Stat label="Feedback" value={r.feedback_count > 0 ? `${r.feedback_count}× · ${r.avg_rating ?? "—"}/5` : "—"} />
                          <Stat label="New customers" value={r.new_customers ? String(r.new_customers) : "—"} />
                          <Stat label="Avg TAT" value={r.avg_tat_min != null ? `${Math.round(r.avg_tat_min)} min` : "—"} />
                        </div>
                        <div className="mt-4 flex flex-wrap items-center gap-4">
                          <button
                            type="button"
                            onClick={() => {
                              const range = monthRange(r.month)
                              if (!range) {return}
                              setBillRange(range)
                              document.getElementById("closed-bills-section")?.scrollIntoView({ behavior: "smooth" })
                            }}
                            className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                          >
                            Browse {prettyMonth(r.month)}&apos;s bills ↓
                          </button>
                          <Link
                            href={monthDrilldownHref(r.month)}
                            title={`Open ${prettyMonth(r.month)} in Accounting`}
                            className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                          >
                            Open {prettyMonth(r.month)} in Accounting →
                          </Link>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Seeded from the page window, and re-seeded when a month row asks for
          its own bills — so the bill list is never showing a different period
          from the table above it. `ownDateFilter` keeps its two inputs so a
          month drill-down can narrow it without moving the whole page. */}
      <ClosedBillsSection
        rid={user?.restaurantUsername ?? ""}
        from={billRange?.from ?? range.from}
        to={billRange?.to ?? range.to}
        ownDateFilter
        description="Every bill this business has settled, within the selected period. Open a month above to jump straight to its bills."
      />
    </div>
  )
}
