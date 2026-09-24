"use client"

/*
  SECTION-WISE ITEM PERFORMANCE, LIVE.

  Client: "Add section-wise item performance and live tracking, showing metrics
  like items sold, quantity, revenue, and top/low-performing items. Data should
  update in real time without requiring a page refresh."

  WHERE THE NUMBERS COME FROM, AND WHY NOT FROM ANALYTICS
  -------------------------------------------------------
  lib/item-performance.ts argues it in full: /analytics/menu-insights ranks ten
  dishes over thirty days and cannot describe six sections or move during
  service. This reads the live order feed instead — the same GET /orders three
  other screens already run — and groups it by the menu's own category.

  HOW "LIVE" IS DONE
  ------------------
  The socket first: `order:updated` and `bill:updated` are what the Orders and
  KDS boards already listen to, and they arrive the instant the kitchen is sent
  something. A 60-second poll sits behind them as the belt-and-braces, because a
  dropped socket must degrade to "a minute behind", never to "wrong until
  somebody reloads". Both paths refresh SILENTLY: this block never throws a
  spinner over numbers a manager is reading.

  The menu is read once and kept — categories do not change during a service,
  and re-reading it on every ticket would turn one live block into the busiest
  reader on the page.
*/

import * as React from "react"
import { Activity, TrendingDown, TrendingUp } from "lucide-react"

import { ForkCard } from "@/components/ui/fork-card"
import { MicroStat } from "@/components/ui/micro-stat"
import { SectionHeader } from "@/components/ui/section-header"
import { StatusChip } from "@/components/ui/status-chip"
import { getMenuItems, getOrders } from "@/lib/db"
import {
    itemPerformance,
    sectionCaption,
    sectionShare,
    type ItemPerformance,
    type PerfMenuItem,
    type PerfOrder,
} from "@/lib/item-performance"
import { NothingToShow } from "@/components/analytics/charts"
import { money0, money2 } from "@/components/analytics/format"

/** The socket events that mean a dish was sold, changed or comped. */
const LIVE_EVENTS = new Set(["order:updated", "bill:updated"])
const POLL_MS = 60_000

export interface LiveItemPerformanceProps {
    restaurantId: string
    currencySymbol: string
    /** Hidden entirely for a session that may not see money (waiter-only). */
    showsMoney: boolean
}

export function LiveItemPerformance({ restaurantId, currencySymbol, showsMoney }: LiveItemPerformanceProps): React.JSX.Element | null {
    const [perf, setPerf] = React.useState<ItemPerformance | null>(null)
    const [updatedAt, setUpdatedAt] = React.useState<number | null>(null)
    const [failed, setFailed] = React.useState(false)
    const menuRef = React.useRef<PerfMenuItem[] | null>(null)
    const seq = React.useRef(0)

    const read = React.useCallback(async (): Promise<void> => {
        if (restaurantId === "") { return }
        const mine = ++seq.current
        try {
            menuRef.current ??= (await getMenuItems(restaurantId)).map((m) => ({ name: m.name, category: m.category }))
            const orders: PerfOrder[] = await getOrders(restaurantId)
            if (mine !== seq.current) { return }
            setPerf(itemPerformance(orders, menuRef.current))
            setUpdatedAt(Date.now())
            setFailed(false)
        } catch {
            // Silent: the last good numbers stay on screen with the live chip
            // dropped, which is honest, rather than an error card over a page
            // whose every other block loaded.
            if (mine === seq.current) { setFailed(true) }
        }
    }, [restaurantId])

    React.useEffect(() => { void read() }, [read])

    React.useEffect(() => {
        const onRealtime = (e: Event): void => {
            const detail = (e as CustomEvent<{ event?: string } | undefined>).detail
            if (LIVE_EVENTS.has(detail?.event ?? "")) { void read() }
        }
        window.addEventListener("realtime:event", onRealtime)
        const id = window.setInterval(() => { void read() }, POLL_MS)
        return () => {
            window.removeEventListener("realtime:event", onRealtime)
            window.clearInterval(id)
        }
    }, [read])

    if (perf === null) { return null }

    const money = (v: number): string => money0(currencySymbol, v)
    const moneyFine = (v: number): string => money2(currencySymbol, v)
    const clock = updatedAt === null
        ? ""
        : new Date(updatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })

    return (
        <section id="analytics-section-live-items" className="scroll-mt-24">
            <SectionHeader
                title="Item performance by section — live"
                trailing={failed
                    ? <StatusChip status="neutral" label="Reconnecting" dense />
                    : <StatusChip color="hsl(var(--primary))" label={clock === "" ? "Live" : `Live · ${clock}`} dense />}
            />
            {perf.dishCount === 0 ? (
                <NothingToShow caption="Nothing has been sold on the live board yet — dishes appear here the moment an order is sent." />
            ) : (
                <>
                    <ForkCard inset className="mb-3 flex flex-wrap gap-6 !py-3">
                        <MicroStat icon={<Activity />} value={String(perf.totalQuantity)} label="items sold" />
                        <MicroStat value={String(perf.dishCount)} label="dishes" />
                        <MicroStat value={String(perf.sections.length)} label="sections" />
                        {showsMoney ? <MicroStat value={money(perf.totalRevenue)} label="revenue" /> : null}
                    </ForkCard>

                    <div className="grid gap-3">
                        {perf.sections.map((entry) => {
                            const share = sectionShare(entry, perf.totalRevenue)
                            return (
                                <ForkCard key={entry.section} className="!p-4">
                                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-semibold text-foreground">{entry.section}</div>
                                            <div className="text-xs text-muted-foreground">{sectionCaption(entry)}</div>
                                        </div>
                                        {showsMoney ? (
                                            <div className="text-right">
                                                <div className="text-sm font-semibold tabular-nums text-foreground">{money(entry.revenue)}</div>
                                                <div className="text-[11px] tabular-nums text-muted-foreground">{share.toFixed(0)}% of revenue</div>
                                            </div>
                                        ) : null}
                                    </div>

                                    {/* The share bar — one glance says which section is carrying the service. */}
                                    {showsMoney ? (
                                        <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-inset">
                                            <div className="h-full rounded-full bg-[hsl(var(--primary))]" style={{ width: `${String(Math.max(2, share))}%` }} />
                                        </div>
                                    ) : null}

                                    <div className="mt-3 grid gap-1.5">
                                        {entry.dishes.slice(0, 6).map((dish) => (
                                            <div key={dish.name} className="flex items-center gap-2 text-[13px]">
                                                <span className="min-w-0 flex-1 truncate text-foreground">{dish.name}</span>
                                                <span className="shrink-0 tabular-nums text-muted-foreground">× {dish.quantity}</span>
                                                {showsMoney ? (
                                                    <span className="w-[86px] shrink-0 text-right font-semibold tabular-nums text-foreground">
                                                        {moneyFine(dish.revenue)}
                                                    </span>
                                                ) : null}
                                            </div>
                                        ))}
                                        {entry.dishes.length > 6 ? (
                                            <div className="text-[11px] text-tertiary">
                                                +{entry.dishes.length - 6} more in this section
                                            </div>
                                        ) : null}
                                    </div>

                                    {entry.top !== null || entry.low !== null ? (
                                        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 border-t border-divider pt-2.5 text-[11px]">
                                            {entry.top !== null ? (
                                                <span className="flex items-center gap-1.5 text-success">
                                                    <TrendingUp aria-hidden className="h-3 w-3 shrink-0" />
                                                    Best: {entry.top.name} (× {entry.top.quantity})
                                                </span>
                                            ) : null}
                                            {entry.low !== null ? (
                                                <span className="flex items-center gap-1.5 text-muted-foreground">
                                                    <TrendingDown aria-hidden className="h-3 w-3 shrink-0" />
                                                    Slowest: {entry.low.name} (× {entry.low.quantity})
                                                </span>
                                            ) : null}
                                        </div>
                                    ) : null}
                                </ForkCard>
                            )
                        })}
                    </div>

                    <p className="mt-2 text-[11px] text-tertiary">
                        Counted from the live order board, which holds the current service (the server drops settled
                        orders from it after its own live window). Cancelled orders are left out; a comped dish counts
                        as sold and earns nothing. A dish that is no longer on the menu is listed under &quot;Off menu&quot;.
                    </p>
                </>
            )}
        </section>
    )
}
