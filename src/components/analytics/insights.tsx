"use client"

// Actionable insights — top-selling dishes, top waiters, price suggestions
// and slow movers, ported from the Flutter analytics tail (modules.dart
// ~21916–22168): ranked ForkCard rows with rank avatars and MicroStats,
// the paused-suggestions inset card (3 rows + "and N more paused"), the
// structured price-suggestion explainer rendered on the card AND inside the
// Apply confirmation dialog, and per-section CSV registration.

import * as React from "react"
import { ArrowDown, ArrowUp, CirclePause, ReceiptText, TriangleAlert } from "lucide-react"

import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { ForkCard } from "@/components/ui/fork-card"
import { InfoChip, StatusChip } from "@/components/ui/status-chip"
import { MicroStat } from "@/components/ui/micro-stat"
import { useToast } from "@/hooks/use-toast"
import { applyMenuItemPrice } from "@/lib/db"
import type { MenuInsights, PriceSuggestion, SuppressedSuggestion } from "@/lib/db"
import { formatLongDate } from "@/lib/tz"
import { Dl } from "@/components/analytics/csv"
import { IconBox, InitialsBadge, NothingToShow } from "@/components/analytics/charts"
import { money0, money2, num0, str } from "@/components/analytics/format"
import { applySort, SortHeader, useSectionSort } from "@/components/analytics/sort"
import type { SortOption } from "@/components/analytics/sort"

type DishRow = MenuInsights["top_dishes"][number]
type WaiterRow = MenuInsights["top_waiters"][number]

/* ── Top-selling dishes ──────────────────────────────────────────────── */

const TOP_DISH_SORTS: SortOption<DishRow>[] = [
    { label: "Revenue", key: (m) => num0(m.revenue) },
    { label: "Qty sold", key: (m) => num0(m.quantity) },
    { label: "Name", key: (m) => str(m.name).toLowerCase() },
]

export function TopDishesSection({ dishes, currencySymbol, dlOrder }: {
    dishes: DishRow[]
    currencySymbol: string
    dlOrder: number
}): React.JSX.Element {
    const sort = useSectionSort("topDish", true)
    const money = (v: number): string => money0(currencySymbol, v)
    const rows = applySort(dishes, TOP_DISH_SORTS, sort).slice(0, 8)
    return (
        <section>
            <Dl
                id="top-selling-dishes"
                order={dlOrder}
                headers={["Rank", "Dish", "Category", "Qty sold", "Revenue"]}
                rows={rows.map((m, i) => [i + 1, str(m.name, "Dish"), str(m.category), num0(m.quantity), money(num0(m.revenue))])}
            />
            <SortHeader title="Top-selling dishes" opts={TOP_DISH_SORTS} sort={sort} />
            <div className="space-y-2">
                {rows.map((m, i) => (
                    <ForkCard key={`${str(m.name)}-${i}`} className="px-4 py-3" chevron={false}>
                        <div className="flex items-center gap-3">
                            <InitialsBadge text={`${i + 1}`} />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-[13.5px] font-semibold text-foreground">{str(m.name, "Dish")}</div>
                                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                                    {num0(m.quantity)} sold{str(m.category) !== "" ? ` · ${str(m.category)}` : ""}
                                </div>
                            </div>
                            <MicroStat value={money(num0(m.revenue))} label="Revenue" alignEnd />
                        </div>
                    </ForkCard>
                ))}
            </div>
        </section>
    )
}

/* ── Top waiters ─────────────────────────────────────────────────────── */

const TOP_WAITER_SORTS: SortOption<WaiterRow>[] = [
    { label: "Revenue", key: (m) => num0(m.revenue) },
    { label: "Orders", key: (m) => num0(m.orders) },
    { label: "Name", key: (m) => str(m.employee_name).toLowerCase() },
]

export function TopWaitersSection({ waiters, currencySymbol, dlOrder }: {
    waiters: WaiterRow[]
    currencySymbol: string
    dlOrder: number
}): React.JSX.Element {
    const sort = useSectionSort("topWaiter", true)
    const money = (v: number): string => money0(currencySymbol, v)
    const rows = applySort(waiters, TOP_WAITER_SORTS, sort).slice(0, 8)
    return (
        <section>
            <Dl
                id="top-waiters"
                order={dlOrder}
                headers={["Rank", "Staff", "Orders", "Revenue"]}
                rows={rows.map((m, i) => [i + 1, str(m.employee_name, "Staff"), num0(m.orders), money(num0(m.revenue))])}
            />
            <SortHeader title="Top waiters by revenue" opts={TOP_WAITER_SORTS} sort={sort} />
            <div className="space-y-2">
                {rows.map((m, i) => (
                    <ForkCard key={`${str(m.employee_name)}-${i}`} className="px-4 py-3" chevron={false}>
                        <div className="flex items-center gap-3">
                            <InitialsBadge text={`${i + 1}`} />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-[13.5px] font-semibold text-foreground">{str(m.employee_name, "Staff")}</div>
                                <div className="mt-0.5 text-xs text-muted-foreground">{num0(m.orders)} orders</div>
                            </div>
                            <MicroStat value={money(num0(m.revenue))} label="Revenue" alignEnd />
                        </div>
                    </ForkCard>
                ))}
            </div>
        </section>
    )
}

/* ── Price suggestions ───────────────────────────────────────────────── */

const PRICE_SORTS: SortOption<PriceSuggestion>[] = [
    { label: "Δ price", key: (m) => num0(m.suggested_price) - num0(m.current_price) },
    { label: "Current price", key: (m) => num0(m.current_price) },
    { label: "Suggested price", key: (m) => num0(m.suggested_price) },
    { label: "Name", key: (m) => str(m.name).toLowerCase() },
]

const signed = (v: number, s: string): string => `${v < 0 ? "-" : "+"}${s}`

const deltaOf = (m: PriceSuggestion): { amt: number; pct: number } => {
    const cur = num0(m.current_price)
    const sug = num0(m.suggested_price)
    const amt = typeof m.delta_amount === "number" ? m.delta_amount : sug - cur
    const pct = typeof m.delta_percent === "number" ? m.delta_percent : (cur > 0 ? (sug - cur) / cur * 100 : 0)
    return { amt, pct }
}

/**
 * The one-sentence "why is this dish paused" line — the backend's
 * `explanation` when present, else derived from the reason code. Shared by
 * the paused row and its CSV export so both read identically.
 */
function suppressedWhy(row: SuppressedSuggestion, timezone: string): string {
    const why = str(row.explanation)
    if (why !== "") { return why }
    const until = row.retry_after ? formatLongDate(row.retry_after, timezone, "") : ""
    if (row.reason === "cooldown") {
        return until === ""
            ? "Paused while its recent price change settles."
            : `Paused until ${until}, while its recent price change settles.`
    }
    return row.reason === "margin_floor"
        ? "A further cut would fall below the food-cost margin floor."
        : "Already at its automatic drift cap."
}

/**
 * Why the backend suggested this, what it should do, how strong the evidence
 * is, and any food-cost / drift caveat — rendered on the suggestion card AND
 * inside the Apply confirm dialog, so the owner reads exactly the same
 * justification in both places (`_priceSuggestionExplainer`).
 */
function PriceExplainer({ m, currencySymbol }: { m: PriceSuggestion; currencySymbol: string }): React.JSX.Element | null {
    const up = str(m.direction) === "increase"
    const why = str(m.why)
    const effect = str(m.expected_effect)
    const conf = str(m.confidence)
    const confNote = str(m.confidence_note)
    const marginNote = str(m.margin_note)
    const caution = str(m.caution)
    const { amt, pct } = deltaOf(m)

    // Legacy backend: only the single-line reason is available.
    if (why === "" && effect === "") {
        const reason = str(m.reason)
        return reason === "" ? null : <p className="text-xs text-muted-foreground">{reason}</p>
    }

    return (
        <div>
            {why !== "" && <p className="text-[13px] text-foreground">{why}</p>}
            {effect !== "" && <p className="mt-[5px] text-xs text-muted-foreground">{effect}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {conf !== "" && (
                    <StatusChip
                        dense
                        status={conf === "high" ? "success" : conf === "medium" ? "warning" : "neutral"}
                        label={`${conf.toUpperCase()} CONFIDENCE`}
                    />
                )}
                <InfoChip
                    icon={up ? <ArrowUp /> : <ArrowDown />}
                    label={`${signed(amt, `${currencySymbol}${Math.abs(amt).toFixed(2)}`)} · ${signed(pct, `${Math.abs(pct).toFixed(1)}%`)}`}
                />
            </div>
            {confNote !== "" && <p className="mt-[7px] text-[11px] text-tertiary">{confNote}</p>}
            {marginNote !== "" && (
                <p className="mt-[7px] flex items-start gap-[7px] text-[11.5px] text-muted-foreground">
                    <ReceiptText aria-hidden className="mt-0.5 h-[13px] w-[13px] shrink-0 text-tertiary" />
                    <span>{marginNote}</span>
                </p>
            )}
            {caution !== "" && (
                <p className="mt-2 flex items-start gap-[7px] rounded-[8px] border border-warning/28 bg-warning/12 px-2.5 py-2 text-[11.5px] text-foreground gaia:rounded-[2px]">
                    <TriangleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                    <span>{caution}</span>
                </p>
            )}
        </div>
    )
}

export function PriceSuggestionsSection({ menu, restaurantId, canApplyPrice, currencySymbol, timezone, dlOrder, onReload }: {
    menu: MenuInsights
    restaurantId: string
    canApplyPrice: boolean
    currencySymbol: string
    timezone: string
    dlOrder: number
    onReload: () => void
}): React.JSX.Element {
    const { toast } = useToast()
    const sort = useSectionSort("priceSuggest", true)
    const money = (v: number): string => money0(currencySymbol, v)
    const moneyExact = (v: unknown): string => money2(currencySymbol, v)

    const suggestions = applySort(menu.price_suggestions, PRICE_SORTS, sort)
    const suppressedItems = menu.suppressed_suggestions?.items ?? []
    const suppressedCount = menu.suppressed_suggestions?.count ?? suppressedItems.length
    const pausedShown = suppressedItems.slice(0, 3)

    // Apply one suggested price via the single-item PATCH route. Confirms
    // first: this edits the LIVE menu.
    const [pending, setPending] = React.useState<PriceSuggestion | null>(null)
    const [applying, setApplying] = React.useState(false)

    const confirmApply = async (): Promise<void> => {
        const m = pending
        if (m?.id == null || m.id === "") { return }
        const price = num0(m.suggested_price)
        if (price <= 0) { return }
        setApplying(true)
        try {
            await applyMenuItemPrice(restaurantId, m.id, price)
            toast({ description: `${str(m.name, "Dish")} is now ${moneyExact(price)}.` })
            setPending(null)
            onReload() // refetches menu-insights so the applied row updates
        } catch (e) {
            toast({ description: e instanceof Error ? e.message : String(e), variant: "destructive" })
        } finally {
            setApplying(false)
        }
    }

    return (
        <section>
            <Dl
                id="price-suggestions"
                order={dlOrder}
                headers={[
                    "Item", "Category", "Status", "Current price", "Suggested price",
                    "Direction", "Change", "Confidence", "Why", "Expected effect",
                ]}
                rows={[
                    ...suggestions.map((m) => {
                        const { amt, pct } = deltaOf(m)
                        return [
                            str(m.name, "Dish"),
                            str(m.category),
                            "Suggested",
                            money(num0(m.current_price)),
                            money(num0(m.suggested_price)),
                            str(m.direction) === "increase" ? "RAISE" : "LOWER",
                            `${signed(amt, `${currencySymbol}${Math.abs(amt).toFixed(2)}`)} · ${signed(pct, `${Math.abs(pct).toFixed(1)}%`)}`,
                            str(m.confidence),
                            str(m.why) === "" ? str(m.reason) : str(m.why),
                            str(m.expected_effect),
                        ]
                    }),
                    ...suppressedItems.map((s) => {
                        // Tolerant reads: the wire may carry category/current_price
                        // (Flutter reads them the same way; the web type predates them).
                        const extra = s as SuppressedSuggestion & { category?: unknown; current_price?: unknown }
                        return [
                            str(s.name, "Dish"),
                            str(extra.category),
                            "Paused",
                            money(num0(extra.current_price)),
                            "", "", "", "",
                            suppressedWhy(s, timezone),
                            "",
                        ]
                    }),
                ]}
            />
            <SortHeader title="Price suggestions" opts={PRICE_SORTS} sort={sort} className="mb-1" />
            {/* Why an item can vanish right after you Apply. */}
            <p className="text-xs text-tertiary">
                Recently adjusted items are paused until there&apos;s a full period of sales at the new price.
            </p>
            {suppressedCount > 0 && (
                <ForkCard inset className="mt-2.5 px-3.5 py-2.5">
                    {pausedShown.map((s, i) => (
                        <div key={`${str(s.name)}-${i}`} className="flex items-start gap-2 py-[5px]">
                            <CirclePause aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tertiary" />
                            <div className="min-w-0">
                                <div className="truncate text-[12.5px] font-semibold text-foreground">{str(s.name, "Dish")}</div>
                                <div className="mt-0.5 text-[11.5px] text-muted-foreground">{suppressedWhy(s, timezone)}</div>
                            </div>
                        </div>
                    ))}
                    {suppressedCount > pausedShown.length && (
                        <p className="mt-1 text-[11px] text-tertiary">and {suppressedCount - pausedShown.length} more paused</p>
                    )}
                </ForkCard>
            )}
            <div className="mt-3 space-y-2">
                {suggestions.length === 0 && (
                    <NothingToShow caption="All price suggestions are in their quiet period — nothing new to change yet." />
                )}
                {suggestions.map((m, i) => {
                    const up = str(m.direction) === "increase"
                    const tone = up ? "hsl(var(--success))" : "hsl(var(--warning))"
                    return (
                        <ForkCard key={`${str(m.name)}-${i}`} className="px-4 py-3" chevron={false}>
                            <div className="flex items-start gap-3">
                                <IconBox tone={tone}>{up ? <ArrowUp /> : <ArrowDown />}</IconBox>
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-[13.5px] font-semibold text-foreground">{str(m.name, "Dish")}</div>
                                    {str(m.category) !== "" && (
                                        <div className="mt-0.5 text-[11px] text-muted-foreground">{str(m.category)}</div>
                                    )}
                                </div>
                                <div className="flex shrink-0 flex-col items-end">
                                    <span className="text-[11.5px] text-muted-foreground line-through tabular-nums">{money(num0(m.current_price))}</span>
                                    <span className="mt-0.5 text-[13px] font-semibold tabular-nums" style={{ color: tone }}>{money(num0(m.suggested_price))}</span>
                                    <span className="mt-[3px] micro-label">{up ? "RAISE" : "LOWER"}</span>
                                </div>
                            </div>
                            <div className="mt-2.5">
                                <PriceExplainer m={m} currencySymbol={currencySymbol} />
                            </div>
                            {canApplyPrice && str(m.id ?? "") !== "" && (
                                <div className="mt-2.5 flex justify-end">
                                    <Button size="sm" onClick={() => { setPending(m) }}>
                                        Apply {money(num0(m.suggested_price))}
                                    </Button>
                                </div>
                            )}
                        </ForkCard>
                    )
                })}
            </div>

            {/* Apply confirmation — the same explanation the card shows, so the
                decision is made against the reasoning, not just two numbers. */}
            <AlertDialog open={pending != null} onOpenChange={(o) => { if (!o) { setPending(null) } }}>
                <AlertDialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-[440px]">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Apply suggested price?</AlertDialogTitle>
                        <AlertDialogDescription className="sr-only">Confirm the live menu price change</AlertDialogDescription>
                    </AlertDialogHeader>
                    {pending != null && (
                        <div className="text-left">
                            <div className="text-[13.5px] font-semibold text-foreground">{str(pending.name, "Dish")}</div>
                            <div className="mt-2 text-[15px] font-semibold text-accent-foreground tabular-nums">
                                {moneyExact(pending.current_price)}  →  {moneyExact(num0(pending.suggested_price))}
                            </div>
                            <div className="mt-3">
                                <PriceExplainer m={pending} currencySymbol={currencySymbol} />
                            </div>
                            <p className="mt-3 text-xs text-muted-foreground">
                                This changes the live menu immediately — guests and new orders will be charged the new price.
                            </p>
                        </div>
                    )}
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <Button disabled={applying} onClick={() => { void confirmApply() }}>
                            Apply {pending == null ? "" : moneyExact(num0(pending.suggested_price))}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </section>
    )
}

/* ── Slow movers ─────────────────────────────────────────────────────── */

const SLOW_MOVER_SORTS: SortOption<DishRow>[] = [
    { label: "Qty sold", key: (m) => num0(m.quantity) },
    { label: "Price", key: (m) => num0(m.current_price) },
    { label: "Name", key: (m) => str(m.name).toLowerCase() },
]

export function SlowMoversSection({ slowMovers, currencySymbol, dlOrder }: {
    slowMovers: DishRow[]
    currencySymbol: string
    dlOrder: number
}): React.JSX.Element {
    // Default ascending by qty — the worst sellers first.
    const sort = useSectionSort("slowMover", false)
    const money = (v: number): string => money0(currencySymbol, v)
    const rows = applySort(slowMovers, SLOW_MOVER_SORTS, sort).slice(0, 6)
    return (
        <section>
            <Dl
                id="slow-movers"
                order={dlOrder}
                headers={["Dish", "Category", "Qty sold", "Price"]}
                rows={rows.map((m) => [str(m.name, "Dish"), str(m.category), num0(m.quantity), money(num0(m.current_price))])}
            />
            <SortHeader title="Slow movers" opts={SLOW_MOVER_SORTS} sort={sort} />
            <div className="space-y-2">
                {rows.map((m, i) => (
                    <ForkCard key={`${str(m.name)}-${i}`} className="px-4 py-2.5" chevron={false}>
                        <div className="flex items-center gap-3">
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-[13.5px] font-semibold text-foreground">{str(m.name, "Dish")}</div>
                                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                                    {num0(m.quantity)} sold{str(m.category) !== "" ? ` · ${str(m.category)}` : ""}
                                </div>
                            </div>
                            <MicroStat value={money(num0(m.current_price))} label="Price" alignEnd />
                        </div>
                    </ForkCard>
                ))}
            </div>
        </section>
    )
}
