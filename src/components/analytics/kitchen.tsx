"use client"

// Kitchen analytics — the Flutter kitchen block (modules.dart ~21247–21561):
// summary tiles (Avg prep / P90 / Avg bark → served) with drill-downs, the
// "N orders timed · median … · max …" caption, per-station averages (the four
// worst on Overview with a station-count pill, all of them + p90/slowest-dish
// detail on the full views), item-wise prep grouped by station under ONE
// shared sort, and the per-dish list (5 slowest on Overview with a
// "View all N dishes" jump, every dish on the full views).

import * as React from "react"
import { CookingPot, Flame, List, Utensils } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ForkCard } from "@/components/ui/fork-card"
import { HBarRow } from "@/components/ui/fork-charts"
import { InfoChip } from "@/components/ui/status-chip"
import { MicroStat } from "@/components/ui/micro-stat"
import { SectionHeader } from "@/components/ui/section-header"
import type { KitchenAnalyticsX, KitchenSectionDish } from "@/lib/api/analytics"
import { Dl } from "@/components/analytics/csv"
import { IconBox, NothingToShow, StatTile } from "@/components/analytics/charts"
import { fmtDur, num0, ranked, str } from "@/components/analytics/format"
import type { SeriesPoint } from "@/components/analytics/format"
import type { MetricDrillRequest } from "@/components/analytics/metric-sheet"
import { applySort, SortHeader, useSectionSort } from "@/components/analytics/sort"
import type { SortOption } from "@/components/analytics/sort"

// One shared key for every station's dish list, so picking a field re-orders
// all the stations the same way (they are one logical table, just grouped).
const KITCHEN_ITEM_SORTS: SortOption<KitchenSectionDish>[] = [
    { label: "Avg prep", key: (m) => num0(m.avg_prep_ms) },
    { label: "P90 prep", key: (m) => num0(m.p90_prep_ms) },
    { label: "Times timed", key: (m) => num0(m.count) },
    { label: "Dish", key: (m) => str(m.name).toLowerCase() },
]

export function KitchenSection({ kitchen, kitchenFull, range, sectionRange, dlOrder, openMetric, onOpenView }: {
    kitchen: KitchenAnalyticsX | null
    /** Kitchen / Operations / Everything list every station and dish. */
    kitchenFull: boolean
    range: { from: string; to: string }
    /** The section header's own copy of the date chip. */
    sectionRange: React.ReactNode
    dlOrder: number
    openMetric: (req: MetricDrillRequest) => void
    onOpenView: (v: "kitchen") => void
}): React.JSX.Element {
    const itemSort = useSectionSort("kitchenItems", true)

    const summary = kitchen?.order_summary
    const byDish = kitchen?.by_dish ?? []
    const bySection = kitchen?.by_section ?? []
    const sectionItems = kitchen?.by_section_items ?? []
    const ordersTimed = summary?.orders_timed ?? 0
    const kitchenDays = kitchen?.period_days ?? 30
    const dur = (v: number): string => fmtDur(Math.round(v))

    // Breakdown series for the tile drill-downs — same already-fetched payload.
    const sectionAvg: SeriesPoint[] = ranked(bySection.map((e) => ({ label: str(e.section, "Unassigned"), value: num0(e.avg_prep_ms) })))
    const sectionP90: SeriesPoint[] = ranked(bySection.map((e) => ({ label: str(e.section, "Unassigned"), value: num0(e.p90_prep_ms) })))
    const dishP90: SeriesPoint[] = ranked(byDish.map((e) => ({ label: str(e.name, "Dish"), value: num0(e.p90_prep_ms) })))

    const empty = ordersTimed === 0 && byDish.length === 0 && bySection.length === 0
    const shownSections = kitchenFull ? bySection : bySection.slice(0, 4)
    const maxSectionAvg = bySection.reduce((a, e) => (num0(e.avg_prep_ms) > a ? num0(e.avg_prep_ms) : a), 0)
    const shownDishes = kitchenFull ? byDish : byDish.slice(0, 5)

    return (
        <section id="analytics-section-kitchen" className="scroll-mt-24">
            <Dl
                id="kitchen-summary"
                order={dlOrder}
                headers={["Metric", "Value"]}
                rows={[
                    ["Avg prep time", dur(num0(summary?.avg_prep_ms))],
                    ["Median prep time", dur(num0(summary?.median_prep_ms))],
                    ["P90 prep", dur(num0(summary?.p90_prep_ms))],
                    ["Slowest ticket", dur(num0(summary?.max_prep_ms))],
                    ["Avg bark → served", dur(num0(summary?.avg_bark_to_served_ms))],
                    ["Orders timed", ordersTimed],
                    ["Period", `${range.from} to ${range.to}`],
                    ["Period (days)", kitchenDays],
                ]}
            />
            <SectionHeader title="Kitchen" trailing={sectionRange} />
            {empty ? (
                <NothingToShow caption="No kitchen timings yet — bark and serve some orders to see prep times." />
            ) : (
                <div>
                    {/* Order-level prep summary — each tile expands into the
                        explainer + a per-station breakdown. */}
                    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
                        <StatTile
                            label="Avg prep time"
                            value={dur(num0(summary?.avg_prep_ms))}
                            onClick={() => {
                                openMetric({
                                    label: "Avg prep time",
                                    value: dur(num0(summary?.avg_prep_ms)),
                                    explainerKey: "avg_prep_ms",
                                    note: `${ordersTimed} tickets timed · median ${dur(num0(summary?.median_prep_ms))}`,
                                    series: sectionAvg,
                                    kind: "bar",
                                    fmt: dur,
                                    jumpTo: kitchenFull ? undefined : "kitchen",
                                })
                            }}
                        />
                        <StatTile
                            label="P90 prep"
                            value={dur(num0(summary?.p90_prep_ms))}
                            onClick={() => {
                                openMetric({
                                    label: "P90 prep",
                                    value: dur(num0(summary?.p90_prep_ms)),
                                    explainerKey: "p90_prep_ms",
                                    note: `Slowest ticket ${dur(num0(summary?.max_prep_ms))}`,
                                    series: dishP90.length > 0 ? dishP90.slice(0, 8) : sectionP90,
                                    kind: "bar",
                                    fmt: dur,
                                    jumpTo: kitchenFull ? undefined : "kitchen",
                                })
                            }}
                        />
                        <StatTile
                            label="Avg bark → served"
                            value={dur(num0(summary?.avg_bark_to_served_ms))}
                            onClick={() => {
                                openMetric({
                                    label: "Avg bark → served",
                                    value: dur(num0(summary?.avg_bark_to_served_ms)),
                                    explainerKey: "bark_to_served",
                                    note: `${ordersTimed} tickets timed`,
                                    series: sectionAvg,
                                    kind: "bar",
                                    fmt: dur,
                                    jumpTo: kitchenFull ? undefined : "kitchen",
                                })
                            }}
                        />
                    </div>
                    <p className="mt-3 text-[11px] text-muted-foreground">
                        {ordersTimed} orders timed · median {dur(num0(summary?.median_prep_ms))} · max {dur(num0(summary?.max_prep_ms))}
                    </p>

                    {/* Per kitchen section (station) — slowest average first. */}
                    {bySection.length > 0 && (
                        <ForkCard className="mt-4">
                            <Dl
                                id="kitchen-by-section"
                                order={dlOrder + 1}
                                headers={["Section", "Items timed", "Dishes", "Avg prep", "P90 prep", "Slowest dish", "Slowest dish avg"]}
                                rows={shownSections.map((e) => [
                                    str(e.section, "Unassigned"),
                                    e.items_timed,
                                    e.dishes,
                                    dur(num0(e.avg_prep_ms)),
                                    dur(num0(e.p90_prep_ms)),
                                    str(e.slowest_dish?.name),
                                    dur(num0(e.slowest_dish?.avg_prep_ms)),
                                ])}
                            />
                            <SectionHeader
                                title="Average time per section"
                                className="mb-2"
                                trailing={kitchenFull ? undefined : <InfoChip label={`${bySection.length} stations`} />}
                            />
                            {shownSections.map((e, i) => (
                                <HBarRow
                                    key={`${str(e.section)}-${i}`}
                                    label={str(e.section, "Unassigned")}
                                    fraction={maxSectionAvg > 0 ? num0(e.avg_prep_ms) / maxSectionAvg : 0}
                                    value={dur(num0(e.avg_prep_ms))}
                                    sub={`${e.items_timed} items`}
                                />
                            ))}
                            {/* Station detail: the p90 (the bad nights) and the dish
                                dragging that station's average up. */}
                            {kitchenFull && (
                                <div className="mt-2 border-t border-divider pt-2">
                                    {bySection.map((e, i) => {
                                        const slowName = str(e.slowest_dish?.name)
                                        return (
                                            <div key={`${str(e.section)}-detail-${i}`} className="flex items-center gap-2 py-[3px]">
                                                <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">
                                                    {slowName === ""
                                                        ? `${str(e.section, "Unassigned")} · ${e.dishes} dishes`
                                                        : `${str(e.section, "Unassigned")} · slowest dish ${slowName} (${dur(num0(e.slowest_dish?.avg_prep_ms))})`}
                                                </span>
                                                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                                                    p90 {dur(num0(e.p90_prep_ms))}
                                                </span>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </ForkCard>
                    )}

                    {/* Item-wise prep time GROUPED BY SECTION — detail cut only. */}
                    {kitchenFull && sectionItems.length > 0 && (
                        <div className="mt-4">
                            <Dl
                                id="kitchen-items-by-section"
                                order={dlOrder + 2}
                                headers={["Section", "Dish", "Times timed", "Avg prep", "P90 prep", "Fastest", "Slowest"]}
                                rows={sectionItems.flatMap((s) =>
                                    applySort(s.dishes ?? [], KITCHEN_ITEM_SORTS, itemSort).map((d) => [
                                        str(s.section, "Unassigned"),
                                        str(d.name, "Dish"),
                                        d.count,
                                        dur(num0(d.avg_prep_ms)),
                                        dur(num0(d.p90_prep_ms)),
                                        dur(num0(d.min_prep_ms)),
                                        dur(num0(d.max_prep_ms)),
                                    ]))}
                            />
                            <SortHeader title="Item-wise prep time per section" opts={KITCHEN_ITEM_SORTS} sort={itemSort} />
                            <div className="space-y-2">
                                {sectionItems.map((s, si) => {
                                    const dishes = applySort(s.dishes ?? [], KITCHEN_ITEM_SORTS, itemSort)
                                    const total = s.dishes_total ?? dishes.length
                                    // Bars are scaled inside the station: the question
                                    // this card answers is "which of MY items is slow".
                                    const maxAvg = dishes.reduce((a, d) => (num0(d.avg_prep_ms) > a ? num0(d.avg_prep_ms) : a), 0)
                                    return (
                                        <ForkCard key={`${str(s.section)}-${si}`} chevron={false}>
                                            <div className="flex items-center gap-3">
                                                <IconBox><CookingPot /></IconBox>
                                                <div className="min-w-0 flex-1">
                                                    <div className="truncate text-[13.5px] font-semibold text-foreground">{str(s.section, "Unassigned")}</div>
                                                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                                        {s.items_timed ?? 0} items timed · {total} {total === 1 ? "dish" : "dishes"}
                                                        {" "}· p90 {dur(num0(s.p90_prep_ms))} · slowest {dur(num0(s.max_prep_ms))}
                                                    </div>
                                                </div>
                                                <MicroStat value={dur(num0(s.avg_prep_ms))} label="Section avg" alignEnd />
                                            </div>
                                            <div className="mt-2 border-t border-divider pt-2">
                                                {dishes.length === 0 ? (
                                                    <p className="text-xs text-muted-foreground">No individual dish timings in this section yet.</p>
                                                ) : (
                                                    dishes.map((d, di) => (
                                                        <HBarRow
                                                            key={`${str(d.name)}-${di}`}
                                                            label={str(d.name, "Dish")}
                                                            fraction={maxAvg > 0 ? num0(d.avg_prep_ms) / maxAvg : 0}
                                                            value={dur(num0(d.avg_prep_ms))}
                                                            sub={`${d.count} timed · p90 ${dur(num0(d.p90_prep_ms))}`}
                                                        />
                                                    ))
                                                )}
                                                {total > dishes.length && (
                                                    <p className="mt-1 text-[11px] text-muted-foreground">
                                                        Showing the {dishes.length} slowest of {total} dishes in this section.
                                                    </p>
                                                )}
                                            </div>
                                        </ForkCard>
                                    )
                                })}
                            </div>
                        </div>
                    )}

                    {/* Per dish — slowest average first; the slowest gets a
                        warning tint. Overview shows the five worst. */}
                    {byDish.length > 0 && (
                        <div className="mt-4">
                            <Dl
                                id={kitchenFull ? "kitchen-by-dish" : "kitchen-slowest-dishes"}
                                order={dlOrder + 3}
                                headers={["Dish", "Section", "Timed", "Avg prep", "P90 prep", "Fastest"]}
                                rows={shownDishes.map((e) => [
                                    str(e.name, "Dish"),
                                    str(e.station, "Unassigned"),
                                    e.count,
                                    dur(num0(e.avg_prep_ms)),
                                    dur(num0(e.p90_prep_ms)),
                                    dur(num0(e.min_prep_ms)),
                                ])}
                            />
                            <SectionHeader
                                title={kitchenFull ? "Prep time per dish" : "Slowest dishes"}
                                className="mb-2"
                                trailing={kitchenFull ? undefined : <InfoChip label={`${byDish.length} timed`} />}
                            />
                            <div className="space-y-2">
                                {shownDishes.map((m, i) => {
                                    const slowest = i === 0
                                    const p90 = num0(m.p90_prep_ms)
                                    const fastest = num0(m.min_prep_ms)
                                    return (
                                        <ForkCard key={`${str(m.name)}-${i}`} className="px-4 py-3" chevron={false}>
                                            <div className="flex items-center gap-3">
                                                <IconBox tone={slowest ? "hsl(var(--warning))" : undefined}>
                                                    {slowest ? <Flame /> : <Utensils />}
                                                </IconBox>
                                                <div className="min-w-0 flex-1">
                                                    <div className="truncate text-[13.5px] font-semibold text-foreground">{str(m.name, "Dish")}</div>
                                                    <div className="mt-1 flex min-w-0 items-center gap-2">
                                                        <InfoChip icon={<CookingPot />} label={str(m.station, "Unassigned")} />
                                                        <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                                                            {m.count} timed
                                                            {p90 > 0 ? ` · p90 ${dur(p90)}` : ""}
                                                            {fastest > 0 ? ` · fastest ${dur(fastest)}` : ""}
                                                        </span>
                                                    </div>
                                                </div>
                                                <MicroStat value={dur(num0(m.avg_prep_ms))} label="Avg prep" alignEnd />
                                            </div>
                                        </ForkCard>
                                    )
                                })}
                            </div>
                            {/* Overview is a teaser — the full per-dish table lives in Kitchen. */}
                            {!kitchenFull && byDish.length > 5 && (
                                <div className="mt-2">
                                    <Button variant="outline" size="sm" onClick={() => { onOpenView("kitchen") }}>
                                        <List className="h-3.5 w-3.5" />
                                        View all {byDish.length} dishes
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </section>
    )
}
