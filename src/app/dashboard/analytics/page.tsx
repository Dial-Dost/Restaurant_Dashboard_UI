"use client"

/**
 * ANALYTICS — the web `_analyticsBody` (restaurant_owner_app
 * lib/screens/modules.dart ~20391–22168), section for section and in the same
 * top-to-bottom order:
 *
 *   Date-range chip → view tabs → "Download <view>" → Performance stat tiles
 *   → KPI health → Discounts & offers → Low-stock alerts → Menu engineering
 *   → Demand forecast → At-risk customers → Table turnaround → Kitchen
 *   → Campaign ROI → Customer demographics → Revenue — last 14 days
 *   → Performance over time → Revenue by table → Average per cover by staff
 *   → Staff performance (APC) → Attendance → Actionable insights
 *   (Top-selling dishes → Top waiters → Price suggestions → Slow movers).
 *
 * ONE load performs all nine requests together (single skeleton, one error
 * surface with retry); the optional routes degrade to empty so the rest of
 * the page still renders. Every window-aware read is cut on the SAME window;
 * the Kitchen / Attendance / Actionable-insights headers carry their own copy
 * of the date chip, and picking a window from one of those scrolls that
 * section back into view once the refetched body has painted.
 *
 * Every stat tile drills down into the shared DrillSheet (single-hue copper
 * charts) with the "View in <Module>" jump, and every exportable section
 * registers its rows for the one "Download <view>" CSV — values exactly as
 * rendered, one labelled block per section.
 */

import * as React from "react"
import { Cake, Calendar, Download, MapPin, MoveRight, TrendingDown, TrendingUp, User } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DateRangePicker } from "@/components/date-range-picker"
import { ForkCard } from "@/components/ui/fork-card"
import { InfoChip, StatusChip } from "@/components/ui/status-chip"
import { LoadErrorState } from "@/components/ui/load-error-state"
import { MicroStat } from "@/components/ui/micro-stat"
import { SectionHeader } from "@/components/ui/section-header"
import { SkeletonBox, SkeletonRows, SkeletonStats } from "@/components/ui/fork-skeleton"
import { CacheStalePill } from "@/components/ui/stale-pill"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAuth } from "@/context/AuthContext"
import { useCachedFetch } from "@/hooks/use-cached-fetch"
import { useCurrency } from "@/hooks/use-currency"
import { useDateRange } from "@/hooks/use-date-range"
import { getSelectedOutletId } from "@/lib/outlet"
import { todayInZone } from "@/lib/tz"
import type { DateRange } from "@/lib/date-range"
import type { KpiCard, OrderApcInsight } from "@/lib/db"
import { loadAnalyticsBundle } from "@/lib/api/analytics"
import { showsMoney as sessionShowsMoney } from "@/lib/session-scope"
import type { AnalyticsBundle } from "@/lib/api/analytics"

import { AttendanceSection } from "@/components/analytics/attendance"
import { CampaignRoiCard } from "@/components/analytics/campaigns"
import { ChartCard, KV, InitialsBadge, RankedOrSeriesChart, StatTile } from "@/components/analytics/charts"
import { CsvRegistryContext, Dl, downloadRegisteredCsv, useCsvRegistry } from "@/components/analytics/csv"
import { ddmm, fmtDur, money0, money2, monthsSpanned, num0, ranked, str, ym } from "@/components/analytics/format"
import type { SeriesPoint } from "@/components/analytics/format"
import { PriceSuggestionsSection, SlowMoversSection, TopDishesSection, TopWaitersSection } from "@/components/analytics/insights"
import { KitchenSection } from "@/components/analytics/kitchen"
import { LiveItemPerformance } from "@/components/analytics/live-items"
import { kpiStatusLabel, kpiChipStatus, MetricDrillSheet } from "@/components/analytics/metric-sheet"
import type { MetricDrillRequest } from "@/components/analytics/metric-sheet"
import { applySort, SortHeader, useSectionSort } from "@/components/analytics/sort"
import type { SortOption } from "@/components/analytics/sort"
import { ANALYTICS_VIEWS, KPI_HOME_VIEW, OVERVIEW_KPIS, viewLabel } from "@/components/analytics/views"
import type { ViewId } from "@/components/analytics/views"

// Module-level so the choice survives reloads and module switches within a
// session (the Flutter `_analyticsView` top-level string). Deliberately NOT
// localStorage: the app persists it in-session only.
let savedView: ViewId = "overview"

// Permission helpers — same shape the dashboard layout uses to gate modules.
type PermUser = { role?: string; role_all?: string[]; actions_set?: string[]; action_names?: string[] } | null | undefined

const hasRole = (user: PermUser, role: string): boolean => {
    if (!user) { return false }
    if (user.role === role) { return true }
    return Array.isArray(user.role_all) ? user.role_all.includes(role) : false
}

const canAccessByAction = (user: PermUser, keywords: string[]): boolean => {
    if (!user) { return false }
    if (Array.isArray(user.actions_set) && user.actions_set.includes("*")) { return true }
    const names = (user.action_names ?? []).map((n) => n.trim().toLowerCase()).filter((n) => n.length > 0)
    if (names.length === 0) { return true }
    return names.some((name) => keywords.some((k) => name.includes(k.toLowerCase())))
}

// Worst band first; "no data" (grey) ranks BETWEEN amber and green, exactly
// as the app sorts it.
const SEVERITY_RANK: Record<string, number> = { red: 0, amber: 1, grey: 2, green: 3, blue: 4 }

const KPI_SORTS: SortOption<KpiCard>[] = [
    { label: "Severity", key: (m) => SEVERITY_RANK[str(m.status, "grey")] ?? 2 },
    { label: "Name", key: (m) => str(m.label).toLowerCase() },
    { label: "Value", key: (m) => num0(m.value) },
]

const STOCK_SORTS: SortOption<{ name: string; qty: number }>[] = [
    { label: "Qty", key: (m) => num0(m.qty) },
    { label: "Name", key: (m) => str(m.name).toLowerCase() },
]

interface MenuClassRow { name: string; qty: number; revenue: number; popularity_pct: number; class: string }
const MENU_CLASS_SORTS: SortOption<MenuClassRow>[] = [
    { label: "Revenue", key: (m) => num0(m.revenue) },
    { label: "Qty", key: (m) => num0(m.qty) },
    { label: "Popularity", key: (m) => num0(m.popularity_pct) },
    { label: "Name", key: (m) => str(m.name).toLowerCase() },
]

interface ForecastRow { name: string; total_qty: number; forecast_next_week: number; trend: string }
const FORECAST_SORTS: SortOption<ForecastRow>[] = [
    { label: "Next week", key: (m) => num0(m.forecast_next_week) },
    { label: "12-wk sold", key: (m) => num0(m.total_qty) },
    { label: "Name", key: (m) => str(m.name).toLowerCase() },
]

interface ChurnRow { customer: string; orders: number; spend: number; days_since_visit: number | null }
const CHURN_SORTS: SortOption<ChurnRow>[] = [
    { label: "Spend", key: (m) => num0(m.spend) },
    { label: "Orders", key: (m) => num0(m.orders) },
    { label: "Days since visit", key: (m) => num0(m.days_since_visit) },
    { label: "Name", key: (m) => str(m.customer).toLowerCase() },
]

interface TatRow { table_name: string; visits: number; avg_min: number }
const TAT_SORTS: SortOption<TatRow>[] = [
    { label: "Avg min", key: (m) => num0(m.avg_min) },
    { label: "Visits", key: (m) => num0(m.visits) },
    { label: "Table", key: (m) => str(m.table_name).toLowerCase() },
]

interface IncentiveRow { employee_name: string; orders_count: number; covers_count: number; mean_apc: number }
const STAFF_APC_SORTS: SortOption<IncentiveRow>[] = [
    { label: "APC", key: (m) => num0(m.mean_apc) },
    { label: "Orders", key: (m) => num0(m.orders_count) },
    { label: "Covers", key: (m) => num0(m.covers_count) },
    { label: "Name", key: (m) => str(m.employee_name).toLowerCase() },
]

interface DemoRow { label: string; n: number }
const DEMO_SORTS: SortOption<DemoRow>[] = [
    { label: "Count", key: (m) => num0(m.n) },
    { label: "Label", key: (m) => str(m.label).toLowerCase() },
]

/**
 * Revenue by table (next_party.dart `revenueByTable`): each seating's `total`
 * added in under its table label (`table_label ?? table_name`), largest
 * first. Seatings with nothing to show are left out.
 */
function revenueByTable(rows: OrderApcInsight[]): SeriesPoint[] {
    const byLabel = new Map<string, number>()
    for (const r of rows) {
        const withLabel = r as OrderApcInsight & { table_label?: unknown }
        const label = str(withLabel.table_label) !== "" ? str(withLabel.table_label) : str(r.table_name)
        const key = label === "" ? "—" : label
        byLabel.set(key, (byLabel.get(key) ?? 0) + num0(r.total))
    }
    return [...byLabel.entries()]
        .filter(([, v]) => v > 0)
        .map(([k, v]) => ({ label: `Table ${k}`, value: v }))
        .sort((a, b) => b.value - a.value)
}

export default function AnalyticsPage(): React.JSX.Element {
    const { user } = useAuth()
    const { currencySymbol } = useCurrency()
    const { range, setRange, query, label: rangeText, timezone } = useDateRange("analytics")
    const restaurantId = user?.restaurantUsername ?? ""
    // A session with no money on its screens gets the live block's counts
    // without its takings — the same rule every other priced surface follows.
    const showsMoney = sessionShowsMoney(user)
    // Reads are outlet-scoped server-side, so the cache key must be too; the
    // shell remounts this page on an outlet switch.
    const [outletKey] = React.useState(() => getSelectedOutletId() ?? "")

    const [view, setViewState] = React.useState<ViewId>(savedView)
    // A view switch keeps the scroll position (the app's tabs do).
    const pickView = React.useCallback((v: ViewId) => {
        savedView = v
        setViewState(v)
    }, [])

    /* ── the one load ─────────────────────────────────────────────────── */

    const trendMonths = monthsSpanned(range)
    const bundle = useCachedFetch<AnalyticsBundle>(
        `analytics:${restaurantId}:${outletKey}:${range.from}:${range.to}`,
        React.useCallback(
            () => loadAnalyticsBundle(restaurantId, query, trendMonths),
            [restaurantId, query, trendMonths],
        ),
        { enabled: restaurantId !== "" },
    )
    const { data, loading, error, offline, fromCache, updatedAt, retry, refresh } = bundle

    /* ── section reveal (Flutter `_SectionReveal`) ────────────────────── */
    // A section header's chip picked a new window: the refetched body should
    // bring that header back into view instead of dumping the owner wherever
    // the reflowed page leaves them.

    const revealRef = React.useRef<{ section: string; scrollY: number } | null>(null)
    const pickRange = React.useCallback((next: DateRange, revealSection?: string) => {
        if (revealSection != null) {
            revealRef.current = { section: revealSection, scrollY: window.scrollY }
        }
        setRange(next)
    }, [setRange])

    React.useEffect(() => {
        if (loading || data == null) { return }
        const pending = revealRef.current
        if (pending == null) { return }
        revealRef.current = null
        // First back to where the owner was (so layout settles around the
        // right offset), then ease the asking section's header into view.
        window.scrollTo({ top: pending.scrollY })
        requestAnimationFrame(() => {
            document.getElementById(`analytics-section-${pending.section}`)
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
        })
    }, [loading, data])

    /** A section header's live date chip, on THIS module's window. */
    const sectionRange = (section: string): React.ReactNode => (
        <DateRangePicker
            value={range}
            onChange={(r) => { pickRange(r, section) }}
            timezone={timezone}
            className="h-7 max-w-[240px] gap-1.5 px-2 text-[11px]"
        />
    )

    /* ── shared drill-down sheet ──────────────────────────────────────── */

    const [drill, setDrill] = React.useState<MetricDrillRequest | null>(null)
    const openMetric = React.useCallback((req: MetricDrillRequest) => { setDrill(req) }, [])

    /* ── CSV registry + sort states (hooks before the early returns) ──── */

    const registry = useCsvRegistry()
    const kpiSort = useSectionSort("kpis", false)
    const stockSort = useSectionSort("stock", false)
    const menuClassSort = useSectionSort("menuClass", true)
    const forecastSort = useSectionSort("forecast", true)
    const churnSort = useSectionSort("churn", true)
    const tatSort = useSectionSort("tat", true)
    const demoSort = useSectionSort("demo", true)
    const staffApcSort = useSectionSort("staffApc", true)

    const canApplyPrice = hasRole(user, "admin") || canAccessByAction(user, ["menu"])

    /* ── loading / error (one AsyncView for the whole module) ─────────── */

    if (loading || data == null) {
        if (!loading && error != null) {
            return <LoadErrorState whatFailed="Couldn't load analytics." error={error} onRetry={retry} />
        }
        return (
            <div className="grid gap-5" aria-busy="true">
                <SkeletonBox height={36} className="max-w-[420px] rounded-[10px]" />
                <SkeletonStats tiles={5} />
                <SkeletonRows rows={6} title={false} />
            </div>
        )
    }

    /* ── the payload, cut exactly as the Flutter body cuts it ─────────── */

    const money = (v: number): string => money0(currencySymbol, v)
    const moneyExact = (v: unknown): string => money2(currencySymbol, v)
    const dur = (v: number): string => fmtDur(Math.round(v))

    const apc = data.apc
    const fb = data.feedback
    const timing = data.timing
    const incentives = apc.employee_incentives
    const orders = apc.orders
    const menu = data.menu
    const topDishes = menu?.top_dishes ?? []
    const priceSuggestions = menu?.price_suggestions ?? []
    const suppressedCount = menu?.suppressed_suggestions?.count ?? menu?.suppressed_suggestions?.items.length ?? 0
    const topWaiters = menu?.top_waiters ?? []
    const slowMovers = menu?.slow_movers ?? []

    const tableRevenue = revenueByTable(orders)
    const staffApc: SeriesPoint[] = incentives
        .map((e) => ({ label: str(e.employee_name, "Staff"), value: num0(e.mean_apc) }))
        .filter((d) => d.value > 0)
        .sort((a, b) => b.value - a.value)
    const dailySeries: SeriesPoint[] = data.daily.map((d) => ({ label: ddmm(str(d.date)), value: num0(d.revenue) }))

    const trends = data.trends
    const revByMonth: SeriesPoint[] = trends.map((t) => ({ label: ym(str(t.month)), value: num0(t.total_revenue) }))
    const apcByMonth: SeriesPoint[] = trends.map((t) => ({ label: ym(str(t.month)), value: num0(t.monthly_apc) }))
    const coversByMonth: SeriesPoint[] = trends.map((t) => ({ label: ym(str(t.month)), value: num0(t.total_covers) }))
    const trendsHasData = trends.some((t) => num0(t.total_revenue) > 0 || num0(t.bills) > 0)

    const adv = data.adv
    const kpis = adv?.kpis ?? []
    const advDisc = adv?.discounts
    const advStock = adv?.stock_alerts ?? []
    const menuClasses = adv?.menu_classes ?? []
    const churn = adv?.churn
    const atRisk = churn?.at_risk ?? []
    const attendance = adv?.staff_attendance ?? []
    const attSummary = adv?.attendance_summary ?? {}
    const forecast = adv?.demand_forecast ?? []
    const demo = adv?.demographics
    const campaigns = adv?.campaigns ?? []
    const tat = adv?.tat
    const tatByTable = tat?.by_table ?? []

    const kitchen = data.kitchen
    const kOrdersTimed = kitchen?.order_summary.orders_timed ?? 0

    const advStaff = adv?.staff ?? []
    const staffRating = ranked(advStaff.map((e) => ({ label: str(e.name, "Staff"), value: num0(e.avg_rating) })))
    const kSectionAvg = ranked((kitchen?.by_section ?? []).map((e) => ({ label: str(e.section, "Unassigned"), value: num0(e.avg_prep_ms) })))

    /* ── view slices ──────────────────────────────────────────────────── */

    const vis = (home: ViewId, onOverview = false): boolean =>
        view === "everything" || view === home || (view === "overview" && onOverview)

    const kitchenFull = view === "kitchen" || view === "operations" || view === "everything"
    const kitchenVisible = kitchenFull || view === "overview"

    const visibleKpis = kpis.filter((k) => {
        const key = str(k.key)
        if (view === "everything") { return true }
        // Unmapped (new) KPI keys surface on Overview instead of vanishing.
        if (view === "overview") { return OVERVIEW_KPIS.has(key) || !(key in KPI_HOME_VIEW) }
        return KPI_HOME_VIEW[key] === view
    })
    const sortedKpis = applySort(visibleKpis, KPI_SORTS, kpiSort)

    const openKpi = (k: KpiCard): void => {
        const key = str(k.key)
        openMetric({
            label: str(k.label),
            value: k.value == null ? "—" : `${k.value}${str(k.unit)}`,
            kpiKey: key,
            status: str(k.status, "grey"),
            showStatus: true,
            jumpTo: KPI_HOME_VIEW[key],
        })
    }

    const downloadView = (): void => {
        downloadRegisteredCsv(
            registry,
            restaurantId,
            view === "everything" ? "analytics-everything" : `analytics-${view}`,
            todayInZone(timezone),
        )
    }

    const sortedStock = applySort(advStock.map((m) => ({ name: str(m.name), qty: num0(m.qty) })), STOCK_SORTS, stockSort)
    const sortedMenuClasses = applySort<MenuClassRow>(menuClasses, MENU_CLASS_SORTS, menuClassSort).slice(0, 12)
    const sortedForecast = applySort<ForecastRow>(forecast, FORECAST_SORTS, forecastSort)
    const sortedChurn = applySort<ChurnRow>(atRisk, CHURN_SORTS, churnSort)
    const sortedTat = applySort<TatRow>(tatByTable, TAT_SORTS, tatSort)
    const sortedIncentives = applySort<IncentiveRow>(incentives, STAFF_APC_SORTS, staffApcSort)

    const demoGroups: { group: string; icon: React.ReactNode; rows: DemoRow[] }[] = demo == null ? [] : [
        { group: "Gender", icon: <User />, rows: applySort<DemoRow>(demo.by_gender, DEMO_SORTS, demoSort) },
        { group: "Age", icon: <Cake />, rows: applySort<DemoRow>(demo.by_age, DEMO_SORTS, demoSort) },
        { group: "Pincode", icon: <MapPin />, rows: applySort<DemoRow>(demo.top_pincodes, DEMO_SORTS, demoSort) },
    ]

    return (
        <CsvRegistryContext.Provider value={registry}>
            <div className="relative grid gap-5">
                {/* The window, first thing on the screen and above the view tabs:
                    every figure below is cut on it. */}
                <DateRangePicker
                    value={range}
                    onChange={(r) => { pickRange(r) }}
                    timezone={timezone}
                    align="start"
                    className="w-full justify-start"
                />
                <Tabs value={view} onValueChange={(v) => { pickView(v as ViewId) }}>
                    <TabsList className="w-full">
                        {ANALYTICS_VIEWS.map((v) => (
                            <TabsTrigger key={v.id} value={v.id}>{v.label}</TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
                {/* One download for the whole section the user is looking at. */}
                <div className="-mt-1 flex justify-end">
                    <Button variant="outline" size="sm" onClick={downloadView}>
                        <Download className="h-3.5 w-3.5" />
                        {view === "everything" ? "Download everything" : `Download ${viewLabel(view)}`}
                    </Button>
                </div>

                {/* ── Performance ─────────────────────────────────────────── */}
                {vis("sales", true) && (
                    <section>
                        <Dl
                            id="performance"
                            order={10}
                            headers={["Metric", "Value", "Note"]}
                            rows={[
                                ["Monthly APC", moneyExact(apc.monthly_apc), `${num0(apc.total_covers)} covers this month`],
                                ["Revenue", moneyExact(apc.total_revenue), `${str(apc.month)} to date`],
                                ["Covers", `${num0(apc.total_covers)}`, ""],
                                ["Avg prep", dur(num0(timing.avg_prep_ms)), kOrdersTimed === 0 ? "" : `${kOrdersTimed} tickets timed in ${rangeText}`],
                                ["Avg rating", `${fb.averageRating ?? 0}`, `${fb.totalResponses ?? 0} responses`],
                            ]}
                        />
                        <SectionHeader
                            title="Performance"
                            trailing={<InfoChip icon={<Calendar />} label={str(apc.month)} />}
                        />
                        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
                            <StatTile
                                label="Monthly APC"
                                value={moneyExact(apc.monthly_apc)}
                                onClick={() => {
                                    openMetric({
                                        label: "Monthly APC",
                                        value: moneyExact(apc.monthly_apc),
                                        explainerKey: "apc",
                                        note: `${num0(apc.total_covers)} covers this month`,
                                        series: apcByMonth.length > 0 ? apcByMonth : staffApc,
                                        kind: apcByMonth.length > 0 ? "columns" : "bar",
                                        fmt: money,
                                        jumpTo: "sales",
                                    })
                                }}
                            />
                            <StatTile
                                label="Revenue"
                                value={moneyExact(apc.total_revenue)}
                                onClick={() => {
                                    openMetric({
                                        label: "Revenue",
                                        value: moneyExact(apc.total_revenue),
                                        explainerKey: "revenue",
                                        note: `Last 14 days below · ${str(apc.month)} to date above`,
                                        series: dailySeries,
                                        kind: "columns",
                                        fmt: money,
                                        jumpTo: "sales",
                                    })
                                }}
                            />
                            <StatTile
                                label="Covers"
                                value={`${num0(apc.total_covers)}`}
                                onClick={() => {
                                    openMetric({
                                        label: "Covers",
                                        value: `${num0(apc.total_covers)}`,
                                        explainerKey: "covers",
                                        note: coversByMonth.length === 0 ? undefined : "By month, last 12 months",
                                        series: coversByMonth,
                                        kind: "columns",
                                        fmt: (v) => v.toFixed(0),
                                        jumpTo: "sales",
                                    })
                                }}
                            />
                            <StatTile
                                label="Avg prep"
                                value={dur(num0(timing.avg_prep_ms))}
                                onClick={() => {
                                    openMetric({
                                        label: "Avg prep",
                                        value: dur(num0(timing.avg_prep_ms)),
                                        explainerKey: "avg_prep_ms",
                                        note: kOrdersTimed === 0 ? undefined : `${kOrdersTimed} tickets timed in ${rangeText}`,
                                        series: kSectionAvg,
                                        kind: "bar",
                                        fmt: dur,
                                        jumpTo: "kitchen",
                                    })
                                }}
                            />
                            <StatTile
                                label="Avg rating"
                                value={`${fb.averageRating ?? 0}`}
                                onClick={() => {
                                    openMetric({
                                        label: "Avg rating",
                                        value: `${fb.averageRating ?? 0}`,
                                        explainerKey: "avg_rating",
                                        note: `${fb.totalResponses ?? 0} responses`,
                                        series: staffRating,
                                        kind: "bar",
                                        fmt: (v) => v.toFixed(1),
                                        jumpTo: "customers",
                                    })
                                }}
                            />
                        </div>
                    </section>
                )}

                {/* ── KPI health ──────────────────────────────────────────── */}
                {visibleKpis.length > 0 && (
                    <section>
                        <Dl
                            id="kpi-health"
                            order={20}
                            headers={["KPI", "Value", "Unit", "Status"]}
                            rows={sortedKpis.map((k) => [str(k.label), k.value ?? "", str(k.unit), kpiStatusLabel(str(k.status, "grey"))])}
                        />
                        <SortHeader title="KPI health — last 90 days" opts={KPI_SORTS} sort={kpiSort} />
                        <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(160px,1fr))]">
                            {sortedKpis.map((k) => (
                                <ForkCard key={str(k.key)} className="p-3" onClick={() => { openKpi(k) }}>
                                    <div className="micro-label line-clamp-2 pr-4">{str(k.label)}</div>
                                    <div className="mt-2 truncate text-[21px] font-light tracking-[-0.02em] text-foreground tabular-nums gaia:font-serif">
                                        {k.value == null ? "—" : `${k.value}${str(k.unit)}`}
                                    </div>
                                    <div className="mt-2">
                                        <StatusChip dense status={kpiChipStatus(str(k.status, "grey"))} label={kpiStatusLabel(str(k.status, "grey"))} />
                                    </div>
                                </ForkCard>
                            ))}
                        </div>
                    </section>
                )}

                {/* ── Discounts & offers ──────────────────────────────────── */}
                {vis("discounts") && (
                    <ForkCard
                        onClick={() => {
                            // The whole numbers block expands: which offers were
                            // actually redeemed, or the discounted-vs-plain split.
                            const offers = adv?.offers ?? []
                            const byOffer = ranked(offers.map((e) => ({ label: str(e.code, "Offer"), value: num0(e.used) })))
                            const without = num0(advDisc?.total_bills) - num0(advDisc?.discount_bills)
                            openMetric({
                                label: "Total discount value",
                                value: money(num0(advDisc?.total_discount)),
                                explainerKey: "discount_total",
                                note: `${num0(advDisc?.discount_bills)} of ${num0(advDisc?.total_bills)} bills carried a discount · ${num0(advDisc?.redemptions)} coupon redemptions`,
                                series: byOffer.length > 0 ? byOffer : [
                                    { label: "Bills with a discount", value: num0(advDisc?.discount_bills) },
                                    { label: "Bills without", value: without > 0 ? without : 0 },
                                ],
                                kind: byOffer.length > 0 ? "bar" : "pie",
                                fmt: (v) => v.toFixed(0),
                            })
                        }}
                    >
                        <Dl
                            id="discounts"
                            order={30}
                            headers={["Metric", "Value"]}
                            rows={[
                                ["Discount utilization", `${num0(advDisc?.utilization_pct).toFixed(0)}%`],
                                ["Bills with a discount", `${num0(advDisc?.discount_bills)} / ${num0(advDisc?.total_bills)}`],
                                ["Total discount value", money(num0(advDisc?.total_discount))],
                                ["Coupon redemptions", `${num0(advDisc?.redemptions)}`],
                            ]}
                        />
                        <SectionHeader title="Discounts & offers" className="mb-2" />
                        <KV k="Discount utilization" v={`${num0(advDisc?.utilization_pct).toFixed(0)}%`} />
                        <KV k="Bills with a discount" v={`${num0(advDisc?.discount_bills)} / ${num0(advDisc?.total_bills)}`} />
                        <KV k="Total discount value" v={money(num0(advDisc?.total_discount))} />
                        <KV k="Coupon redemptions" v={`${num0(advDisc?.redemptions)}`} />
                    </ForkCard>
                )}

                {/* ── Low-stock alerts (hidden entirely when healthy) ─────── */}
                {vis("supply", true) && advStock.length > 0 && (
                    <ForkCard>
                        <Dl
                            id="low-stock-alerts"
                            order={40}
                            headers={["Item", "Qty left"]}
                            rows={sortedStock.map((m) => [m.name, m.qty])}
                        />
                        <SortHeader title="Low-stock alerts" opts={STOCK_SORTS} sort={stockSort} className="mb-2" />
                        {sortedStock.map((m, i) => (
                            <div key={`${m.name}-${i}`} className="flex items-center gap-2 py-1">
                                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{m.name}</span>
                                <StatusChip dense status="danger" label={`${m.qty} left`} />
                            </div>
                        ))}
                    </ForkCard>
                )}

                {/* ── Menu engineering ────────────────────────────────────── */}
                {vis("menu") && menuClasses.length > 0 && (
                    <ForkCard>
                        <Dl
                            id="menu-engineering"
                            order={50}
                            headers={["Class", "Item", "Qty sold", "Revenue"]}
                            rows={sortedMenuClasses.map((m) => [str(m.class, "MID"), str(m.name), num0(m.qty).toFixed(0), money(num0(m.revenue))])}
                        />
                        <SortHeader
                            title={`Menu engineering — BAD share ${num0(adv?.bad_share_pct).toFixed(0)}%`}
                            opts={MENU_CLASS_SORTS}
                            sort={menuClassSort}
                            className="mb-1.5"
                        />
                        <p className="text-[11px] text-muted-foreground">
                            STAR = popular &amp; high-value · GREAT = popular, low-value · MID = niche, high-value · BAD = review
                        </p>
                        <div className="mt-2">
                            {sortedMenuClasses.map((m, i) => {
                                const cls = str(m.class, "MID")
                                const clsStatus = cls === "STAR" ? "success" as const : cls === "GREAT" ? "info" as const : cls === "MID" ? "warning" as const : "danger" as const
                                return (
                                    <div key={`${str(m.name)}-${i}`} className="flex items-center gap-2 py-1">
                                        <StatusChip dense status={clsStatus} label={cls} />
                                        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{str(m.name)}</span>
                                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                            {num0(m.qty).toFixed(0)} sold · {money(num0(m.revenue))}
                                        </span>
                                    </div>
                                )
                            })}
                        </div>
                    </ForkCard>
                )}

                {/* ── Demand forecast ─────────────────────────────────────── */}
                {vis("menu") && forecast.length > 0 && (
                    <ForkCard>
                        <Dl
                            id="demand-forecast"
                            order={60}
                            headers={["Item", "Trend", "Forecast next week"]}
                            rows={sortedForecast.map((m) => [str(m.name), str(m.trend, "flat"), `~${Math.round(num0(m.forecast_next_week))}`])}
                        />
                        <SortHeader title="Demand forecast — next week" opts={FORECAST_SORTS} sort={forecastSort} className="mb-1.5" />
                        <p className="text-[11px] text-muted-foreground">
                            {adv?.forecast_mape_pct != null
                                ? `Weighted 4-week average · accuracy MAPE ${num0(adv.forecast_mape_pct).toFixed(0)}%`
                                : "Weighted 4-week average (accuracy builds up with more history)"}
                        </p>
                        <div className="mt-2">
                            {sortedForecast.map((m, i) => {
                                const trend = str(m.trend, "flat")
                                return (
                                    <div key={`${str(m.name)}-${i}`} className="flex items-center gap-2 py-1">
                                        {trend === "up"
                                            ? <TrendingUp aria-label="Trending up" className="h-4 w-4 shrink-0 text-success" />
                                            : trend === "down"
                                                ? <TrendingDown aria-label="Trending down" className="h-4 w-4 shrink-0 text-destructive" />
                                                : <MoveRight aria-label="Flat trend" className="h-4 w-4 shrink-0 text-muted-foreground" />}
                                        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{str(m.name)}</span>
                                        <MicroStat value={`~${Math.round(num0(m.forecast_next_week))}`} label="Next wk" alignEnd />
                                    </div>
                                )
                            })}
                        </div>
                    </ForkCard>
                )}

                {/* ── At-risk customers ───────────────────────────────────── */}
                {vis("customers") && atRisk.length > 0 && (
                    <ForkCard>
                        <Dl
                            id="at-risk-customers"
                            order={70}
                            headers={["Customer", "Orders", "Spend", "Days since visit"]}
                            rows={sortedChurn.map((m) => [str(m.customer), num0(m.orders), money(num0(m.spend)), m.days_since_visit ?? "?"])}
                        />
                        <SortHeader
                            title={`At-risk customers — churn ${churn?.rate_pct ?? "—"}%`}
                            opts={CHURN_SORTS}
                            sort={churnSort}
                            className="mb-1.5"
                        />
                        <p className="text-[11px] text-muted-foreground">Quiet for 30+ days — worth a win-back offer.</p>
                        <div className="mt-2">
                            {sortedChurn.map((m, i) => (
                                <div key={`${str(m.customer)}-${i}`} className="flex items-center gap-2 py-1">
                                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{str(m.customer)}</span>
                                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                        {num0(m.orders)} orders · {money(num0(m.spend))} · {m.days_since_visit ?? "?"}d ago
                                    </span>
                                </div>
                            ))}
                        </div>
                    </ForkCard>
                )}

                {/* ── Table turnaround ────────────────────────────────────── */}
                {vis("operations") && num0(tat?.sessions) !== 0 && (
                    <ForkCard>
                        <Dl
                            id="table-turnaround"
                            order={80}
                            headers={["Table", "Visits", "Avg minutes"]}
                            rows={sortedTat.map((m) => [str(m.table_name), num0(m.visits), num0(m.avg_min).toFixed(0)])}
                        />
                        <SortHeader
                            title={`Table turnaround (TAT) — avg ${num0(tat?.avg_min).toFixed(0)} min · median ${num0(tat?.median_min).toFixed(0)} min`}
                            opts={TAT_SORTS}
                            sort={tatSort}
                            className="mb-1.5"
                        />
                        <p className="text-[11px] text-muted-foreground">Seated → left, recorded per visit · {num0(tat?.sessions)} visits</p>
                        <div className="mt-2">
                            {sortedTat.map((m, i) => (
                                <div key={`${str(m.table_name)}-${i}`} className="flex items-center gap-2 py-1">
                                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{str(m.table_name)}</span>
                                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                        {num0(m.visits)} visits · {num0(m.avg_min).toFixed(0)} min avg
                                    </span>
                                </div>
                            ))}
                        </div>
                    </ForkCard>
                )}

                {/* ── Kitchen ─────────────────────────────────────────────── */}
                {kitchenVisible && (
                    <KitchenSection
                        kitchen={kitchen}
                        kitchenFull={kitchenFull}
                        range={range}
                        sectionRange={sectionRange("kitchen")}
                        dlOrder={90}
                        openMetric={openMetric}
                        onOpenView={pickView}
                    />
                )}

                {/* ── Campaign ROI ────────────────────────────────────────── */}
                {vis("marketing") && (
                    <CampaignRoiCard
                        campaigns={campaigns}
                        restaurantId={restaurantId}
                        currencySymbol={currencySymbol}
                        dlOrder={100}
                        onReload={refresh}
                    />
                )}

                {/* ── Customer demographics ───────────────────────────────── */}
                {vis("customers") && demo != null && num0(demo.tagged) !== 0 && (
                    <ForkCard>
                        <Dl
                            id="customer-demographics"
                            order={110}
                            headers={["Group", "Label", "Customers"]}
                            rows={demoGroups.flatMap((g) => g.rows.map((r) => [g.group, str(r.label), num0(r.n)]))}
                        />
                        <SortHeader
                            title={`Customer demographics — ${demo.tagged}/${demo.total_customers} tagged`}
                            opts={DEMO_SORTS}
                            sort={demoSort}
                            className="mb-1.5"
                        />
                        <p className="text-[11px] text-muted-foreground">
                            Aggregated only. Tag guests (gender / age / pincode) when adding customers.
                        </p>
                        <div className="mt-2.5 flex flex-wrap gap-2">
                            {demoGroups.flatMap((g) =>
                                g.rows.map((r, i) => (
                                    <InfoChip key={`${g.group}-${str(r.label)}-${i}`} icon={g.icon} label={`${str(r.label)}: ${num0(r.n)}`} />
                                )))}
                        </div>
                    </ForkCard>
                )}

                {/* ── Revenue — last 14 days ──────────────────────────────── */}
                {vis("sales", true) && (
                    <ChartCard
                        title="Revenue — last 14 days"
                        trailing={
                            <Dl
                                id="revenue-last-14-days"
                                order={120}
                                headers={["Date", "Revenue"]}
                                rows={dailySeries.map((d) => [d.label, money(d.value)])}
                            />
                        }
                    >
                        <RankedOrSeriesChart data={dailySeries} fmt={money} />
                    </ChartCard>
                )}

                {/* ── Performance over time ───────────────────────────────── */}
                {vis("sales") && trendsHasData && (
                    <section className="grid gap-3.5">
                        <Dl
                            id="monthly-trends"
                            order={130}
                            headers={["Month", "Revenue", "Avg per cover", "Covers"]}
                            rows={trends.map((t) => [str(t.month), money(num0(t.total_revenue)), money(num0(t.monthly_apc)), num0(t.total_covers).toFixed(0)])}
                        />
                        <SectionHeader
                            title="Performance over time"
                            className="mb-0"
                            trailing={<InfoChip icon={<Calendar />} label={`Last ${trendMonths} months`} />}
                        />
                        <ChartCard
                            title="Revenue by month"
                            trailing={<Dl id="revenue-by-month" order={131} headers={["Month", "Revenue"]} rows={revByMonth.map((d) => [d.label, money(d.value)])} />}
                        >
                            <RankedOrSeriesChart data={revByMonth} fmt={money} />
                        </ChartCard>
                        <ChartCard
                            title="Average per cover by month"
                            trailing={<Dl id="apc-by-month" order={132} headers={["Month", "Avg per cover"]} rows={apcByMonth.map((d) => [d.label, money(d.value)])} />}
                        >
                            <RankedOrSeriesChart data={apcByMonth} fmt={money} />
                        </ChartCard>
                        <ChartCard
                            title="Covers by month"
                            trailing={<Dl id="covers-by-month" order={133} headers={["Month", "Covers"]} rows={coversByMonth.map((d) => [d.label, d.value.toFixed(0)])} />}
                        >
                            <RankedOrSeriesChart data={coversByMonth} fmt={(v) => v.toFixed(0)} />
                        </ChartCard>
                    </section>
                )}

                {/* ── Revenue by table ────────────────────────────────────── */}
                {vis("sales") && (
                    <ChartCard
                        title="Revenue by table"
                        trailing={
                            <Dl
                                id="revenue-by-table"
                                order={140}
                                headers={["Table", "Revenue"]}
                                rows={tableRevenue.slice(0, 8).map((d) => [d.label, money(d.value)])}
                            />
                        }
                    >
                        <RankedOrSeriesChart data={tableRevenue.slice(0, 8)} fmt={money} />
                    </ChartCard>
                )}

                {/* ── Average per cover by staff ──────────────────────────── */}
                {vis("staff") && (
                    <ChartCard
                        title="Average per cover by staff"
                        trailing={
                            <Dl
                                id="apc-by-staff"
                                order={150}
                                headers={["Staff", "Avg per cover"]}
                                rows={staffApc.slice(0, 8).map((d) => [d.label, money(d.value)])}
                            />
                        }
                    >
                        <RankedOrSeriesChart data={staffApc.slice(0, 8)} fmt={money} />
                    </ChartCard>
                )}

                {/* ── Staff performance (APC) ─────────────────────────────── */}
                {vis("staff") && incentives.length > 0 && (
                    <section>
                        <Dl
                            id="staff-performance"
                            order={160}
                            headers={["Employee", "Orders", "Covers", "APC"]}
                            rows={sortedIncentives.map((m) => [str(m.employee_name, "Employee"), num0(m.orders_count), num0(m.covers_count), moneyExact(m.mean_apc)])}
                        />
                        <SortHeader title="Staff performance (APC)" opts={STAFF_APC_SORTS} sort={staffApcSort} />
                        <div className="space-y-2">
                            {sortedIncentives.map((m, i) => {
                                const name = str(m.employee_name, "Employee")
                                return (
                                    <ForkCard key={`${name}-${i}`} className="px-4 py-3" chevron={false}>
                                        <div className="flex items-center gap-3">
                                            <InitialsBadge text={name === "" ? "?" : name.slice(0, 1)} />
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-[13.5px] font-semibold text-foreground">{name}</div>
                                                <div className="mt-0.5 text-xs text-muted-foreground">
                                                    {num0(m.orders_count)} orders · {num0(m.covers_count)} covers
                                                </div>
                                            </div>
                                            <MicroStat value={moneyExact(m.mean_apc)} label="APC" alignEnd />
                                        </div>
                                    </ForkCard>
                                )
                            })}
                        </div>
                    </section>
                )}

                {/* ── Attendance ──────────────────────────────────────────── */}
                {vis("staff") && (attendance.length > 0 || Object.keys(attSummary).length > 0) && (
                    <AttendanceSection
                        attendance={attendance}
                        summary={attSummary}
                        range={range}
                        sectionRange={sectionRange("attendance")}
                        dlOrder={170}
                        openMetric={openMetric}
                    />
                )}

                {/* ── Actionable insights ─────────────────────────────────── */}
                {(vis("menu", true) || vis("staff")) && (
                    <SectionHeader
                        id="analytics-section-insights"
                        className="mb-0 mt-1 scroll-mt-24"
                        title="Actionable insights"
                        trailing={sectionRange("insights")}
                    />
                )}
                {/* The live block leads the menu slice: it is the only one that
                    moves during service (components/analytics/live-items.tsx). */}
                {vis("menu", true) && (
                    <LiveItemPerformance
                        restaurantId={restaurantId}
                        currencySymbol={currencySymbol}
                        showsMoney={showsMoney}
                    />
                )}
                {vis("menu", true) && topDishes.length > 0 && (
                    <TopDishesSection dishes={topDishes} currencySymbol={currencySymbol} dlOrder={180} />
                )}
                {vis("staff") && topWaiters.length > 0 && (
                    <TopWaitersSection waiters={topWaiters} currencySymbol={currencySymbol} dlOrder={190} />
                )}
                {vis("menu") && menu != null && (priceSuggestions.length > 0 || suppressedCount > 0) && (
                    <PriceSuggestionsSection
                        menu={menu}
                        restaurantId={restaurantId}
                        canApplyPrice={canApplyPrice}
                        currencySymbol={currencySymbol}
                        timezone={timezone}
                        dlOrder={200}
                        onReload={refresh}
                    />
                )}
                {vis("menu") && slowMovers.length > 0 && (
                    <SlowMoversSection slowMovers={slowMovers} currencySymbol={currencySymbol} dlOrder={210} />
                )}

                {/* The stat-tile / KPI drill-down sheet. */}
                <MetricDrillSheet
                    req={drill}
                    adv={adv}
                    explainers={data.explainers}
                    onOpenView={pickView}
                    onClose={() => { setDrill(null) }}
                />

                <CacheStalePill offline={offline} fromCache={fromCache} updatedAt={updatedAt} />
            </div>
        </CsvRegistryContext.Provider>
    )
}

