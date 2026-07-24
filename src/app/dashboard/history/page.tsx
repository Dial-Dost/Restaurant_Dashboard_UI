"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ChevronDown } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { useAuth } from "@/context/AuthContext"
import { useCurrency } from "@/hooks/use-currency"
import { getMonthlyHistory, type MonthlyHistoryRow } from "@/lib/db"

const chartConfig = {
  revenue: { label: "Revenue", color: "hsl(var(--primary))" },
}

const RANGES = [
  { months: 12, label: "1 year" },
  { months: 24, label: "2 years" },
  { months: 36, label: "3 years" },
]

// "2026-06" → "Jun 2026"
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
function prettyMonth(ym: string): string {
  const [y, m] = ym.split("-")
  const idx = Number(m) - 1
  return idx >= 0 && idx < 12 ? `${MONTH_NAMES[idx]} ${y}` : ym
}

// Drill-down: "2026-06" → the accounting page filtered to that whole month.
// (Computes the month's real last day — not a blind "-31".)
function monthDrilldownHref(ym: string): string {
  const [y, m] = ym.split("-").map(Number)
  if (!y || !m) {return "/dashboard/accounting"}
  const lastDay = new Date(y, m, 0).getDate() // day 0 of next month = last of this one
  const mm = String(m).padStart(2, "0")
  return `/dashboard/accounting?from=${y}-${mm}-01&to=${y}-${mm}-${String(lastDay).padStart(2, "0")}`
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
  const [months, setMonths] = useState(36)
  const [rows, setRows] = useState<MonthlyHistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [hideEmpty, setHideEmpty] = useState(true)
  const [openMonth, setOpenMonth] = useState<string | null>(null)
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
  const visible = hideEmpty ? rows.filter(hasActivity) : rows
  const chartData = [...rows].reverse().map((r) => ({ month: prettyMonth(r.month), revenue: r.revenue }))
  const totals = rows.reduce(
    (acc, r) => ({ revenue: acc.revenue + r.revenue, bills: acc.bills + r.bills, orders: acc.orders + r.orders, customers: acc.customers + r.new_customers }),
    { revenue: 0, bills: 0, orders: 0, customers: 0 },
  )

  return (
    <div className="grid gap-4 md:gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold md:text-2xl">History</h1>
          <p className="text-sm text-muted-foreground">Month-by-month summary of the whole business, up to 3 years back.</p>
        </div>
        <div className="flex gap-1 rounded-lg border p-1">
          {RANGES.map((r) => (
            <button
              key={r.months}
              onClick={() => { setMonths(r.months); }}
              className={`rounded-md px-3 py-1 text-sm font-medium transition ${months === r.months ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardDescription>Total revenue</CardDescription><CardTitle className="text-xl">{money(totals.revenue)}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Bills</CardDescription><CardTitle className="text-xl">{totals.bills}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Orders</CardDescription><CardTitle className="text-xl">{totals.orders}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>New customers</CardDescription><CardTitle className="text-xl">{totals.customers}</CardTitle></CardHeader></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Revenue by month</CardTitle>
          <CardDescription>Last {months} months.</CardDescription>
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
              <CardDescription>Revenue, volume, guests and service quality per month.</CardDescription>
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
                        <div className="mt-4">
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
    </div>
  )
}
