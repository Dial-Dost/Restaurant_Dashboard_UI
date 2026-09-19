"use client"

// The KPI / stat-tile drill-down — the web `_KpiDrilldownSheet`
// (restaurant_owner_app modules.dart ~19602), rendered on the shared
// DrillSheet (bottom sheet <760px, centred dialog above): header (label + big
// value + status), the plain-English explainer, then a breakdown chart built
// from data the page already fetched, and the "View in <Module>" jump. Never
// a dead tap — with no series the sheet still explains what the number is.
//
// Chart language is single-hue copper (charts.dart): composition = a copper
// donut carrying the leading share + an HBarRow list on the sequential ramp
// with % subs; ranking = a plain copper HBarRow list (negative values keep
// label + signed value with an empty bar); chronological = vertical columns
// (or the barcode strip), tap surfacing the reading as a toast.

import * as React from "react"
import { Sigma, Lightbulb } from "lucide-react"

import { DrillSheet, DrillSheetAction } from "@/components/ui/drill-sheet"
import { Donut, HBarRow } from "@/components/ui/fork-charts"
import { SectionHeader } from "@/components/ui/section-header"
import { StatusChip } from "@/components/ui/status-chip"
import { useToast } from "@/hooks/use-toast"
import type { MetricExplainer, MetricExplainers } from "@/lib/db"
import type { AdvancedAnalyticsX } from "@/lib/api/analytics"
import { ColumnSeries } from "@/components/analytics/charts"
import { fmtNum, num0, ranked, str } from "@/components/analytics/format"
import type { SeriesPoint } from "@/components/analytics/format"
import { viewLabel } from "@/components/analytics/views"
import type { ViewId } from "@/components/analytics/views"

export type KpiChartKind = "pie" | "bar" | "columns" | "none"

export type KpiStatus = "blue" | "green" | "amber" | "red" | "grey"

/** `_kpiStatusLabel`. */
export const kpiStatusLabel = (s: string): string => {
    switch (s) {
        case "blue": return "EXCELLENT"
        case "green": return "ON TARGET"
        case "amber": return "WATCH"
        case "red": return "ACTION"
        default: return "NO DATA"
    }
}

/** `_kpiColor` — as StatusChip status names. */
export const kpiChipStatus = (s: string): "info" | "success" | "warning" | "danger" | "neutral" => {
    switch (s) {
        case "blue": return "info"
        case "green": return "success"
        case "amber": return "warning"
        case "red": return "danger"
        default: return "neutral"
    }
}

/** One-line plain-English meaning per KPI key (`_kpiMeaning`, verbatim). */
export const KPI_MEANING: Record<string, string> = {
    profit_margin: "Share of revenue left after expenses.",
    revpash: "Revenue per available seat-hour — how hard seats work.",
    discount_utilization: "Share of bills that carried a discount.",
    offer_redemption: "How often live offers/coupons are redeemed.",
    menu_bad_share: "Share of dishes flagged BAD (low popularity & value).",
    forecast_mape: "Demand-forecast error — lower is a sharper forecast.",
    labour_cost: "Staff cost as a share of revenue.",
    happiness_efficiency: "Guest happiness weighed against staff effort.",
    avg_rating: "Average guest rating from feedback.",
    nps: "Net promoter score — promoters minus detractors.",
    complaint_rate: "Share of feedback that was a complaint.",
    churn_rate: "Share of regulars who have gone quiet.",
    wait_time: "Average guest wait before being seated.",
    table_turnaround: "Average time a table is occupied per visit.",
    processing_time: "Average kitchen/order processing time.",
    booking_fill: "How full reservations run against capacity.",
    booking_no_show: "Share of reservations that never showed.",
    valet_retrieval: "Average valet car-retrieval time.",
    supplier_on_time: "Share of supplier deliveries that arrived on time.",
    supplier_score: "Blended supplier quality + reliability score.",
    low_stock: "Ingredients at or below their reorder point.",
    food_cost_pct: "Ingredient cost as a share of revenue.",
    food_cost_variance: "Gap between expected and actual food cost.",
    campaign_roi: "Return on marketing-campaign spend.",
}

/* ── the KPI → chart registry (`_data()`) ─────────────────────────────── */

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const rec = (v: unknown): Record<string, unknown> =>
    (typeof v === "object" && v !== null ? v as Record<string, unknown> : {})

/** Resolve a KPI key to a chart kind + the (label, value) rows that feed it. */
export function kpiRegistrySeries(key: string, advRaw: AdvancedAnalyticsX | null): { kind: KpiChartKind; rows: SeriesPoint[] } {
    const adv = rec(advRaw)
    const pos = (rows: SeriesPoint[]): SeriesPoint[] => rows.filter((e) => e.value > 0)
    switch (key) {
        case "profit_margin": {
            const profit = rec(adv.profit)
            const p = num0(profit.revenue) - num0(profit.expenses)
            return { kind: "pie", rows: pos([
                { label: "Profit", value: p },
                { label: "Expenses", value: num0(profit.expenses) },
            ]) }
        }
        case "discount_utilization":
        case "offer_redemption": {
            const offers = pos(list(adv.offers).map((e) => ({ label: str(rec(e).code), value: num0(rec(e).used) })))
            if (offers.length > 0) { return { kind: "pie", rows: offers } }
            const d = rec(adv.discounts)
            return { kind: "bar", rows: pos([
                { label: "Discount bills", value: num0(d.discount_bills) },
                { label: "All bills", value: num0(d.total_bills) },
                { label: "Redemptions", value: num0(d.redemptions) },
            ]) }
        }
        case "avg_rating":
        case "nps":
            return { kind: "bar", rows: pos(list(adv.staff).map((e) => ({ label: str(rec(e).name), value: num0(rec(e).avg_rating) }))) }
        case "complaint_rate":
            return { kind: "bar", rows: pos(list(adv.staff).map((e) => ({ label: str(rec(e).name), value: num0(rec(e).complaint_pct) }))) }
        case "churn_rate": {
            const atRisk = list(rec(adv.churn).at_risk)
            return { kind: "bar", rows: pos(atRisk.map((e) => ({ label: str(rec(e).customer), value: num0(rec(e).spend) }))) }
        }
        case "campaign_roi":
            // ROI can be negative, so keep every campaign (the bar builder handles it).
            return { kind: "bar", rows: list(adv.campaigns).map((e) => ({ label: str(rec(e).name), value: num0(rec(e).roi_pct) })) }
        case "menu_bad_share": {
            const counts: Record<string, number> = { STAR: 0, GREAT: 0, MID: 0, BAD: 0 }
            for (const m of list(adv.menu_classes)) {
                const c = str(rec(m).class, "MID")
                counts[c] = (counts[c] ?? 0) + 1
            }
            return { kind: "pie", rows: pos(Object.entries(counts).map(([label, value]) => ({ label, value }))) }
        }
        case "low_stock":
            return { kind: "bar", rows: pos(list(adv.stock_alerts).map((e) => ({ label: str(rec(e).name), value: num0(rec(e).qty) }))) }
        case "table_turnaround":
        case "revpash": {
            const byTable = list(rec(adv.tat).by_table)
            return { kind: "bar", rows: pos(byTable.map((e) => ({ label: str(rec(e).table_name), value: num0(rec(e).avg_min) }))) }
        }
        case "forecast_mape":
            return { kind: "bar", rows: pos(list(adv.demand_forecast).map((e) => ({ label: str(rec(e).name), value: num0(rec(e).forecast_next_week) }))) }
        case "food_cost_pct":
        case "food_cost_variance":
            return { kind: "pie", rows: pos(list(adv.suppliers).map((e) => ({ label: str(rec(e).vendor), value: num0(rec(e).spend) }))) }
        default:
            return { kind: "none", rows: [] }
    }
}

/* ── the request one tap builds ───────────────────────────────────────── */

export interface MetricDrillRequest {
    label: string
    /** Already formatted; "—" when unknown. */
    value: string
    /** KPI key: turns on the status chip, the registry chart and the meaning fallback. */
    kpiKey?: string
    status?: string
    showStatus?: boolean
    explainerKey?: string
    /** One extra line of context under the number. */
    note?: string
    /** Explicit breakdown rows — win over the registry, keep caller order. */
    series?: SeriesPoint[]
    kind?: KpiChartKind
    fmt?: (v: number) => string
    /** The analytics view holding this metric's full section. */
    jumpTo?: ViewId
}

/* ── breakdown renderers ─────────────────────────────────────────────── */

const RAMP = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"]

function PieBreakdown({ rows, fmt }: { rows: SeriesPoint[]; fmt: (v: number) => string }): React.JSX.Element {
    const total = rows.reduce((s, e) => s + e.value, 0)
    const top: SeriesPoint | undefined = rows.length > 0 ? rows[0] : undefined
    return (
        <div>
            {total > 0 && top != null && (
                <div className="mb-3.5 flex items-center gap-4">
                    <Donut fraction={top.value / total} size={64} />
                    <div className="min-w-0">
                        <div className="truncate text-[13.5px] font-semibold text-foreground">{top.label}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{Math.round(top.value / total * 100)}% of the total</div>
                    </div>
                </div>
            )}
            {rows.map((d, i) => (
                <HBarRow
                    key={`${d.label}-${i}`}
                    label={d.label}
                    fraction={total > 0 ? Math.min(1, Math.max(0, d.value / total)) : 0}
                    value={fmt(d.value)}
                    sub={total > 0 ? `${Math.round(d.value / total * 100)}%` : undefined}
                    color={RAMP[i % RAMP.length]}
                />
            ))}
        </div>
    )
}

function BarBreakdown({ rows, fmt }: { rows: SeriesPoint[]; fmt: (v: number) => string }): React.JSX.Element {
    const maxV = rows.reduce((a, b) => (b.value > a ? b.value : a), 0)
    return (
        <div>
            {rows.map((d, i) => (
                <HBarRow
                    key={`${d.label}-${i}`}
                    label={d.label}
                    fraction={maxV > 0 ? Math.min(1, Math.max(0, d.value / maxV)) : 0}
                    value={fmt(d.value)}
                />
            ))}
        </div>
    )
}

/* ── the explainer block ─────────────────────────────────────────────── */

function ExplainerBlock({ explainer, fallback }: { explainer?: MetricExplainer; fallback?: string }): React.JSX.Element | null {
    const what = explainer?.what ?? ""
    const how = explainer?.how ?? ""
    const tip = explainer?.tip ?? ""
    if (!what && !how && !tip) {
        return fallback == null ? null : <p className="text-xs text-muted-foreground">{fallback}</p>
    }
    return (
        <div className="space-y-1.5">
            {what !== "" && <p className="text-[13px] text-foreground">{what}</p>}
            {how !== "" && (
                <p className="flex items-start gap-[7px] text-xs text-muted-foreground">
                    <Sigma aria-hidden className="mt-0.5 h-[13px] w-[13px] shrink-0 text-tertiary" />
                    <span>{how}</span>
                </p>
            )}
            {tip !== "" && (
                <p className="flex items-start gap-[7px] text-xs text-accent-foreground">
                    <Lightbulb aria-hidden className="mt-0.5 h-[13px] w-[13px] shrink-0" />
                    <span>{tip}</span>
                </p>
            )}
        </div>
    )
}

/* ── the sheet ───────────────────────────────────────────────────────── */

export function MetricDrillSheet({ req, adv, explainers, onOpenView, onClose }: {
    req: MetricDrillRequest | null
    adv: AdvancedAnalyticsX | null
    explainers: MetricExplainers
    onOpenView: (v: ViewId) => void
    onClose: () => void
}): React.JSX.Element {
    const { toast } = useToast()
    const open = req != null
    const label = req?.label ?? ""
    const kpiKey = req?.kpiKey
    const fmt = req?.fmt ?? fmtNum

    // An explicit series wins over the registry and keeps the caller's order
    // (chronological for columns); registry rows are ranked biggest-first.
    let kind: KpiChartKind = req?.kind ?? "bar"
    let rows: SeriesPoint[] = req?.series ?? []
    if (req != null && req.series == null && kpiKey != null) {
        const fromRegistry = kpiRegistrySeries(kpiKey, adv)
        kind = fromRegistry.kind
        rows = ranked(fromRegistry.rows)
    }
    const shown = rows.slice(0, kind === "columns" ? 14 : 8)
    // An all-zero series has no shape to draw, so it falls through to the
    // explainer-only body.
    const hasChart = kind !== "none" && shown.some((e) => e.value > 0)

    const explainer = req?.explainerKey != null ? explainers[req.explainerKey] : (kpiKey != null ? explainers[kpiKey] : undefined)
    const meaning = kpiKey != null ? KPI_MEANING[kpiKey] : undefined

    return (
        <DrillSheet
            open={open}
            onOpenChange={(o) => { if (!o) { onClose() } }}
            eyebrow={label.toUpperCase()}
            title={req?.value ?? "—"}
            description={req?.note}
            action={req?.jumpTo == null ? undefined : (
                <DrillSheetAction
                    module={viewLabel(req.jumpTo)}
                    onClick={() => {
                        const v = req.jumpTo
                        onClose()
                        if (v != null) { onOpenView(v) }
                    }}
                />
            )}
        >
            <div className="space-y-4">
                {(req?.showStatus ?? false) && (
                    <StatusChip
                        dense
                        status={kpiChipStatus(req?.status ?? "grey")}
                        label={kpiStatusLabel(req?.status ?? "grey")}
                    />
                )}
                <ExplainerBlock explainer={explainer} fallback={meaning} />
                {hasChart ? (
                    <div>
                        <SectionHeader title="Breakdown" className="mb-2.5" />
                        {kind === "pie" ? (
                            <PieBreakdown rows={shown} fmt={fmt} />
                        ) : kind === "columns" ? (
                            <ColumnSeries
                                data={shown}
                                fmt={fmt}
                                // Already inside the metric's own detail view, so a tap
                                // surfaces the reading rather than opening a second sheet.
                                onSelect={(i) => { toast({ description: `${shown[i].label}: ${fmt(shown[i].value)}` }) }}
                            />
                        ) : (
                            <BarBreakdown rows={shown} fmt={fmt} />
                        )}
                    </div>
                ) : (
                    <p className="text-xs text-muted-foreground">No detailed breakdown yet for this metric.</p>
                )}
            </div>
        </DrillSheet>
    )
}
