"use client"

// Month-by-month business summary, up to 3 years back — the web
// `_HistoryModule` (restaurant_owner_app/lib/screens/modules.dart
// 16652–17092). Every card on this screen opens the record behind it: the
// three headline totals break down month by month, each chart mark opens its
// month's reading, and each month card opens the month's own detail sheet —
// the metric breakdown AND the settled bills that made it, every one of which
// opens the bill itself, Reprint and all (client item 8).

import { useCallback, useMemo, useState, type ReactElement } from "react"
import { Calendar, ChevronRight, Hourglass, Receipt, Star, Utensils, Equal } from "lucide-react"

import { ForkCard } from "@/components/ui/fork-card"
import { StatCard } from "@/components/ui/stat-card"
import { SectionHeader } from "@/components/ui/section-header"
import { EmptyState } from "@/components/ui/empty-state"
import { LoadErrorState } from "@/components/ui/load-error-state"
import { SkeletonRows, SkeletonStats } from "@/components/ui/fork-skeleton"
import { CacheStalePill } from "@/components/ui/stale-pill"
import { InfoChip } from "@/components/ui/status-chip"
import { DrillSheet } from "@/components/ui/drill-sheet"
import { Columns, HBarRow } from "@/components/ui/fork-charts"
import { useAuth } from "@/context/AuthContext"
import { useCurrency } from "@/hooks/use-currency"
import { todayInZone } from "@/lib/tz"
import { useTimezone } from "@/lib/use-timezone"
import { useCachedFetch } from "@/hooks/use-cached-fetch"
import { fetchMonthlyHistory } from "@/lib/api/history"
import { ClosedBillsSection } from "@/components/closed-bills"
import { MonthDetailSheet } from "@/components/history/month-detail-sheet"
import { DateRangePicker } from "@/components/date-range-picker"
import { useDateRange } from "@/hooks/use-date-range"
import { addDays, rangeLabel, type DateRange } from "@/lib/date-range"
import type { MonthlyHistoryRow } from "@/lib/db"

// History exists to show YEARS, so it opens on the last twelve months rather
// than the 30-day default every other reporting screen uses — a month-by-month
// table cut to one month is a single row, which looks like a broken page.
// Applied only on a first visit; a window the owner picked wins.
const historyDefault = (timezone: string): DateRange => {
  const today = todayInZone(timezone)
  return { from: addDays(today, -364), to: today, preset: "custom" }
}

// The backend's month series is "the last N months", so a range is served by
// asking for enough months to reach `from` and keeping the ones inside the
// window. 36 is the endpoint's own ceiling.
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

const hasActivity = (r: MonthlyHistoryRow): boolean =>
  r.revenue > 0 || r.orders > 0 || r.feedback_count > 0 || r.new_customers > 0

/** Quiet label / value / trailing-qualifier line inside a drill-down sheet —
 *  the app's `_detailRow`. Wraps rather than rows, so the figure is never the
 *  thing that gets truncated on a phone. */
function DetailRow({ label, value, trailing }: { label: string; value: string; trailing?: string }): ReactElement {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 py-[5px]">
      <span className="text-sm">{label}</span>
      <span className="flex items-center gap-3">
        {trailing != null && <span className="text-xs text-muted-foreground">{trailing}</span>}
        <span className="text-sm font-semibold tabular-nums">{value}</span>
      </span>
    </div>
  )
}

/** The copper "DETAILS ›" footer that makes a stat tile read as expandable. */
function DetailsFooter(): ReactElement {
  return (
    <span className="flex items-center text-[10px] font-semibold uppercase tracking-[0.11em] text-accent-foreground">
      Details
      <ChevronRight aria-hidden className="ml-0.5 h-3.5 w-3.5" />
    </span>
  )
}

type TileDrill = "revenue" | "bills" | "customers"

export default function HistoryPage(): ReactElement {
  const { user } = useAuth()
  const { currencySymbol } = useCurrency()
  const { timezone } = useTimezone()
  const rid = user?.restaurantUsername ?? ""
  // ONE window for the page: the tiles, the chart, the month list and the
  // settled-bill browser below are all cut on it, so nothing on this screen
  // can disagree with anything else on it.
  const { range, setRange } = useDateRange("history", { fallback: historyDefault })
  const months = monthsBack(range.from, timezone)

  const history = useCachedFetch(
    `history:${rid}:${months}`,
    useCallback(() => fetchMonthlyHistory(rid, months), [rid, months]),
    { enabled: rid !== "" },
  )

  // History figures render as the app renders them: whole rupees.
  const money = useCallback((v: number | null | undefined): string => `${currencySymbol}${Math.round(v ?? 0)}`, [currencySymbol])

  // Trim the server's month series to the SELECTED window. A month is kept
  // when it overlaps the range at all: an owner who picks 10 Aug – 20 Sep is
  // asking about both months, and dropping a partly-covered one would silently
  // subtract real trade from the totals below.
  const rows = useMemo(() => history.data ?? [], [history.data])
  const inRange = useMemo(() => {
    const fromMonth = range.from.slice(0, 7)
    const toMonth = range.to.slice(0, 7)
    return rows.filter((r) => r.month >= fromMonth && r.month <= toMonth)
  }, [rows, range.from, range.to])
  const withData = useMemo(() => inRange.filter(hasActivity), [inRange])
  const totals = useMemo(() => inRange.reduce(
    (acc, r) => ({
      revenue: acc.revenue + (r.revenue || 0),
      bills: acc.bills + (r.bills || 0),
      customers: acc.customers + (r.new_customers || 0),
    }),
    { revenue: 0, bills: 0, customers: 0 },
  ), [inRange])
  // Chart the most recent 12 months with any activity, chronological — a long
  // window still reads as one clean year, and dead months are skipped.
  const chart = useMemo(
    () => withData.slice(0, 12).map((r) => ({ label: prettyMonth(r.month), value: r.revenue || 0 })).reverse(),
    [withData],
  )
  const chartTotal = useMemo(() => chart.reduce((a, d) => a + d.value, 0), [chart])
  const chartMax = useMemo(() => chart.reduce((a, d) => (d.value > a ? d.value : a), 0), [chart])

  const [tileDrill, setTileDrill] = useState<TileDrill | null>(null)
  const [chartDrill, setChartDrill] = useState<number | null>(null)
  const [openMonth, setOpenMonth] = useState<MonthlyHistoryRow | null>(null)

  const chartPoint = chartDrill === null ? null : chart[chartDrill] ?? null
  const chartRank = useMemo(() => {
    if (chartPoint === null) { return 0 }
    const ranked = [...chart].sort((a, b) => b.value - a.value)
    return ranked.findIndex((e) => e.label === chartPoint.label) + 1
  }, [chart, chartPoint])

  const tileTitle: Record<TileDrill, string> = {
    revenue: "Revenue by month",
    bills: "Bills by month",
    customers: "New customers by month",
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <SectionHeader
          title="History"
          className="mb-0"
          // The window is spelled out by the date control directly under this
          // header; on a phone this chip is wider than the room beside the
          // title, so it is left out there.
          trailing={<InfoChip icon={<Calendar />} label={rangeLabel(range, timezone)} className="max-[419px]:hidden" />}
        />
        {/* Every figure below is cut on this window, so it sits above them. */}
        <DateRangePicker value={range} onChange={setRange} timezone={timezone} align="start" className="w-full justify-start" />
      </div>

      {history.loading ? (
        <div className="grid gap-6">
          <SkeletonStats tiles={3} />
          <SkeletonRows rows={4} title={false} />
        </div>
      ) : history.error != null ? (
        <LoadErrorState whatFailed="Couldn't load this section." error={history.error} onRetry={history.retry} />
      ) : (
        <div className="relative grid gap-6">
          <div className="flex flex-wrap gap-3">
            <StatCard
              value={money(totals.revenue)}
              caption="TOTAL REVENUE"
              footer={<DetailsFooter />}
              onClick={() => { setTileDrill("revenue") }}
              className="w-[200px] min-w-[140px] max-[479px]:w-[calc(50%-6px)]"
            />
            <StatCard
              value={String(Math.round(totals.bills))}
              caption="BILLS"
              footer={<DetailsFooter />}
              onClick={() => { setTileDrill("bills") }}
              className="w-[200px] min-w-[140px] max-[479px]:w-[calc(50%-6px)]"
            />
            <StatCard
              value={String(Math.round(totals.customers))}
              caption="NEW CUSTOMERS"
              footer={<DetailsFooter />}
              onClick={() => { setTileDrill("customers") }}
              className="w-[200px] min-w-[140px] max-[479px]:w-[calc(50%-6px)]"
            />
          </div>

          {/* The chart card is omitted outright when no month has activity. */}
          {chart.length > 0 && (
            <ForkCard className="p-4">
              <SectionHeader title="Revenue by month" className="mb-3" />
              {chart.length >= 10 ? (
                <Columns
                  values={chart.map((d) => d.value)}
                  labels={chart.map((d) => d.label)}
                  formatValue={money}
                  tooltip={(i) => `${chart[i].label} · ${money(chart[i].value)}`}
                  onSelect={(i) => { setChartDrill(i) }}
                />
              ) : (
                <div>
                  {chart.map((d, i) => (
                    <HBarRow
                      key={d.label}
                      label={d.label}
                      fraction={chartMax > 0 ? Math.min(1, d.value / chartMax) : 0}
                      value={money(d.value)}
                      tooltip={`${d.label} · ${money(d.value)}`}
                      onSelect={() => { setChartDrill(i) }}
                    />
                  ))}
                </div>
              )}
            </ForkCard>
          )}

          {withData.length === 0 ? (
            <EmptyState
              icon={<Hourglass />}
              title="No activity yet"
              caption="Month-by-month history builds up as bills close."
            />
          ) : (
            <div>
              <SectionHeader title="Month by month" count={withData.length} />
              <div className="space-y-2">
                {withData.map((r) => {
                  const fb = r.feedback_count || 0
                  // The card is a control, not a summary: it opens the month's
                  // own detail — the metric breakdown AND the settled bills
                  // that made it.
                  return (
                    <ForkCard key={r.month} onClick={() => { setOpenMonth(r) }} chevron={false} className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold">{prettyMonth(r.month)}</div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <InfoChip icon={<Receipt />} label={`${r.bills} bills`} />
                            <InfoChip icon={<Utensils />} label={`${r.orders} orders`} />
                            <InfoChip icon={<Equal />} label={`avg ${money(r.avg_bill ?? 0)}`} />
                            {fb > 0 && <InfoChip icon={<Star />} label={`${fb} feedback · ${r.avg_rating ?? "—"}/5`} />}
                          </div>
                        </div>
                        <span className="shrink-0 text-[20px] font-light tracking-[-0.02em] tabular-nums">{money(r.revenue)}</span>
                        <ChevronRight aria-hidden className="h-[18px] w-[18px] shrink-0 text-tertiary" />
                      </div>
                    </ForkCard>
                  )
                })}
              </div>
            </div>
          )}

          <CacheStalePill offline={history.offline} fromCache={history.fromCache} updatedAt={history.updatedAt} />
        </div>
      )}

      {/* CLIENT ITEM 8 — the window's settled bills, on the page itself, with
          a search: an old bill is found by its number, table or cashier rather
          than three taps down a month. Hard-bound to the page window — one
          window on the screen, by design. */}
      <ClosedBillsSection
        rid={rid}
        from={range.from}
        to={range.to}
        surface="history"
        pageSize={15}
      />

      {/* The headline tiles' drill-downs — per-month rows with the qualifier
          Flutter puts beside each figure. */}
      <DrillSheet
        open={tileDrill !== null}
        onOpenChange={(o) => { if (!o) { setTileDrill(null) } }}
        eyebrow="History"
        title={tileDrill === null ? "" : tileTitle[tileDrill]}
      >
        {tileDrill === "revenue" && (
          <div>
            {withData.map((r) => (
              <DetailRow key={r.month} label={prettyMonth(r.month)} value={money(r.revenue)} trailing={`${r.bills} bills`} />
            ))}
            {withData.length === 0 && <p className="text-sm text-muted-foreground">No months with revenue yet.</p>}
          </div>
        )}
        {tileDrill === "bills" && (
          <div>
            {withData.map((r) => (
              <DetailRow key={r.month} label={prettyMonth(r.month)} value={String(r.bills)} trailing={`avg ${money(r.avg_bill ?? 0)}`} />
            ))}
            {withData.length === 0 && <p className="text-sm text-muted-foreground">No bills closed yet.</p>}
          </div>
        )}
        {tileDrill === "customers" && (
          <div>
            {withData.map((r) => (
              <DetailRow key={r.month} label={prettyMonth(r.month)} value={String(r.new_customers)} trailing={`${r.orders} orders`} />
            ))}
            {withData.length === 0 && <p className="text-sm text-muted-foreground">No customers recorded yet.</p>}
          </div>
        )}
      </DrillSheet>

      {/* A tapped chart mark: the same figure with the context a bare bar
          cannot carry — share of total, rank. */}
      <DrillSheet
        open={chartPoint !== null}
        onOpenChange={(o) => { if (!o) { setChartDrill(null) } }}
        eyebrow="Data point"
        title={chartPoint?.label ?? ""}
      >
        {chartPoint !== null && (
          <div>
            <KvLine k="Value" v={money(chartPoint.value)} />
            <KvLine k="Share of total" v={chartTotal > 0 ? `${((chartPoint.value / chartTotal) * 100).toFixed(1)}%` : "—"} />
            <KvLine k="Rank" v={chartRank > 0 ? `${chartRank} of ${chart.length}` : "—"} />
            <KvLine k="Total across all" v={money(chartTotal)} />
          </div>
        )}
      </DrillSheet>

      <MonthDetailSheet
        rid={rid}
        month={openMonth}
        title={openMonth === null ? "" : prettyMonth(openMonth.month)}
        onClose={() => { setOpenMonth(null) }}
      />
    </div>
  )
}

/** Token-styled key/value line — the app's `_kv` inside a drill sheet. */
function KvLine({ k, v }: { k: string; v: string }): ReactElement {
  return (
    <div className="flex items-start gap-4 py-1.5">
      <span className="micro-label w-[148px] shrink-0 pt-0.5">{k}</span>
      <span className="min-w-0 text-[13px] font-medium">{v}</span>
    </div>
  )
}
