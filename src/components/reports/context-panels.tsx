"use client"

// The headline tiles, breakdown cards, money ladder and flags above each report
// — the web copy of the app's `_misSummary` / `_misLadderCard` / `_misNcBeside`
// / `_misBreakdownCard` / `_misFlags` (screens/reports.dart). The money words
// are the app's (Item total / Net / Gross / After refunds — lib/gross-net.ts).
//
// EVERY NUMBER COMES OFF THE PAYLOAD. Nothing is summed or derived here; the
// server's `meta.notes` stay behind "How it is counted".

import * as React from "react"
import { ArrowLeftRight } from "lucide-react"

import { ForkCard } from "@/components/ui/fork-card"
import { SectionHeader } from "@/components/ui/section-header"
import { InfoChip, StatusChip } from "@/components/ui/status-chip"
import { discountPctOf, itemTotalOf, kAfterRefunds, kGross, kItemTotal, kNet } from "@/lib/gross-net"
import { formatInt, formatMoney, formatPercent, type MisReportKey, type MisReportPayload } from "@/lib/mis-reports"
import { cn } from "@/lib/utils"

type Json = Record<string, unknown>

const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") { return null }
    const n = Number(v)
    return Number.isFinite(n) ? n : null
}
const list = (v: unknown): Json[] => (Array.isArray(v) ? v.filter((x): x is Json => Boolean(x) && typeof x === "object") : [])
const s = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "")

type Tint = "copper" | "warning" | "danger" | "success"
const TINT: Record<Tint, string> = {
    copper: "text-accent-foreground",
    warning: "text-warning",
    danger: "text-destructive",
    success: "text-success",
}

/** `_misStat`: micro label, 18px figure, one-line sub. */
function Stat({ label, value, sub, tint }: { label: string; value: string; sub?: string | null; tint?: Tint | null }): React.JSX.Element {
    return (
        <ForkCard className="w-[168px] shrink-0 px-3.5 pb-3 pt-[11px] max-[759px]:w-[calc(50%-6px)]">
            <div className="micro-label truncate">{label}</div>
            <div className={cn("mt-1.5 truncate text-lg font-semibold tabular-nums", tint ? TINT[tint] : "text-foreground")}>{value}</div>
            {sub ? <div className="mt-[3px] truncate text-xs text-muted-foreground">{sub}</div> : null}
        </ForkCard>
    )
}

const Tiles = ({ children }: { children: React.ReactNode }): React.JSX.Element => <div className="flex flex-wrap gap-3">{children}</div>

/** `_misLadderCard`: the pinned composition, verbatim. */
function LadderCard({ ladder, money }: { ladder: Json; money: (v: unknown) => string }): React.JSX.Element {
    const roundOff = num(ladder.round_off) ?? 0
    const refund = num(ladder.refund) ?? 0
    const Line = ({ label, v, prefix = "", strong = false, rule = false }: { label: string; v: unknown; prefix?: string; strong?: boolean; rule?: boolean }): React.JSX.Element => (
        <div className="py-1">
            {rule && <div className="mb-2 h-px bg-divider" />}
            <div className="flex items-center">
                <span className="w-4 text-xs text-muted-foreground">{prefix}</span>
                <span className={cn("flex-1", strong ? "text-sm font-semibold" : "text-sm")}>{label}</span>
                <span className={cn("tabular-nums", strong ? "text-sm font-semibold text-accent-foreground" : "text-[13px] font-medium")}>{money(v)}</span>
            </div>
        </div>
    )
    return (
        <ForkCard className="max-w-xl">
            <SectionHeader title="Money ladder" className="mb-1" />
            <p className="mb-2 text-xs text-muted-foreground">Every report in this pack derives from this one composition.</p>
            <Line label={kItemTotal} v={itemTotalOf(ladder)} />
            <Line label="Discount" v={ladder.discount} prefix="−" />
            <Line label={kNet} v={ladder.net} prefix="=" strong rule />
            <Line label="Service charge" v={ladder.service_charge} prefix="+" />
            <Line label="Tax" v={ladder.tax} prefix="+" />
            <Line label="Round off" v={Math.abs(roundOff)} prefix={roundOff < 0 ? "−" : "+"} />
            <Line label={kGross} v={ladder.grand_total} prefix="=" strong rule />
            {refund > 0 && <Line label="Refunds" v={ladder.refund} prefix="−" />}
        </ForkCard>
    )
}

/** `_misNcBeside`: NC bills and what was given away — never a tile. */
function NcBeside({ bills, value, note, money }: { bills: number; value: number; note: string; money: (v: unknown) => string }): React.JSX.Element {
    return (
        <ForkCard inset className="max-w-xl px-4 py-3">
            <div className="micro-label">NON-CHARGEABLE (NC) — NOT COLLECTED</div>
            <div className="mt-1 text-sm font-semibold">{`${bills} NC bill${bills === 1 ? "" : "s"} · ${money(value)} given away`}</div>
            <p className="mt-1 text-xs text-muted-foreground">{note}</p>
        </ForkCard>
    )
}

/** `_misBreakdownCard`: label · count× · value, in the server's order. */
function Breakdown({ title, rows }: { title: string; rows: { label: string; count: string; value: string }[] }): React.JSX.Element {
    return (
        <ForkCard inset className="max-w-xl px-4 py-3">
            <SectionHeader title={title} count={rows.length} className="mb-1.5" />
            {rows.map((r, i) => (
                <div key={`${r.label}:${i}`} className="flex items-center gap-2 py-[3px]">
                    <span className="min-w-0 flex-1 truncate text-sm">{r.label}</span>
                    <span className="text-xs text-muted-foreground">{r.count}×</span>
                    <span className="w-24 text-right text-sm font-semibold tabular-nums">{r.value}</span>
                </div>
            ))}
        </ForkCard>
    )
}

const growthTint = (pct: unknown): Tint | null => {
    const n = num(pct)
    if (n === null || n === 0) { return null }
    return n > 0 ? "success" : "danger"
}

/** The summary block (tiles + cards) for one report. */
export function ContextPanel({ reportKey, payload, currencySymbol }: { reportKey: MisReportKey; payload: MisReportPayload; currencySymbol: string }): React.JSX.Element | null {
    const money = (v: unknown): string => formatMoney(v, currencySymbol)
    const pct = (v: unknown): string => formatPercent(v)
    const t = (payload.totals ?? {}) as Json
    const d = payload as unknown as Json
    const int = (v: unknown): string => formatInt(v ?? 0)

    switch (reportKey) {
        case "item_wise":
            return (
                <Tiles>
                    <Stat label="Items" value={int(t.items)} />
                    <Stat label="Qty sold" value={int(t.qty)} />
                    <Stat label={kItemTotal} value={money(t.gross_amount)} sub="before any discount" />
                    <Stat label="Bill-level discount" value={money(d.bill_level_discount)} sub="not spread across lines" />
                </Tiles>
            )
        case "discount":
            return (
                <Tiles>
                    <Stat label="Discounted bills" value={int(t.discounted_bills)} />
                    <Stat label="Given away" value={money(t.discount_amount)} tint="warning" />
                    <Stat label="% of item total" value={pct(discountPctOf(t))} sub="of everything sold" />
                    <Stat label={kItemTotal} value={money(itemTotalOf(t))} sub="discounted bills" />
                    <Stat label={kGross} value={money(t.grand_total)} sub="discounted bills" />
                </Tiles>
            )
        case "void_kot":
            return (
                <Tiles>
                    <Stat label="Voided tickets" value={int(t.voids)} tint="danger" />
                    <Stat label="Lines" value={int(t.item_count)} />
                    <Stat label="Qty" value={int(t.qty)} />
                    <Stat label="Value not earned" value={money(t.value)} tint="danger" />
                </Tiles>
            )
        case "bill_edit":
            return (
                <Tiles>
                    <Stat label="Edits" value={int(t.edits)} />
                    {list(t.by_kind).slice(0, 4).map((k) => (
                        <Stat key={s(k.kind)} label={s(k.label) || s(k.kind)} value={int(k.count)} />
                    ))}
                </Tiles>
            )
        case "sales_summary": {
            const ncBills = Math.round(num(t.nc_bills) ?? 0)
            const ncValue = num(t.nc_value) ?? 0
            const types = list(d.by_order_type).filter((r) => s(r.order_type).trim())
            return (
                <div className="flex flex-col gap-3">
                    <Tiles>
                        <Stat label={kGross} value={money(t.grand_total)} tint="copper" sub="what guests paid" />
                        <Stat label={kNet} value={money(t.net)} sub="before SC, tax, round off" />
                        <Stat label="Bills" value={int(t.bills)} />
                        <Stat label="Covers" value={int(t.covers)} />
                        <Stat label="ABV" value={money(t.abv)} sub="tax-inclusive" />
                        <Stat label="APC" value={money(t.apc)} sub="pre-tax" />
                    </Tiles>
                    {types.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-muted-foreground">By order type:</span>
                            {types.map((r) => (
                                <InfoChip key={s(r.order_type)} wrap label={`${s(r.order_type).trim()} · ${money(r.grand_total)} (${pct(r.share_pct)})`} />
                            ))}
                        </div>
                    )}
                    <LadderCard ladder={t} money={money} />
                    {(ncBills !== 0 || ncValue !== 0) && (
                        <NcBeside
                            bills={ncBills} value={ncValue} money={money}
                            note="NC bills close at 0.00 and still count as bills (and their parties as covers), like a released table; the value given away is pre-tax, dishes comped one by one included."
                        />
                    )}
                </div>
            )
        }
        case "order_summary":
            return (
                <Tiles>
                    <Stat label="Bills" value={int(t.bills)} />
                    <Stat label="Covers" value={int(t.covers)} />
                    <Stat label={kNet} value={money(t.net)} />
                    <Stat label="Tax" value={money(t.tax)} />
                    <Stat label={kGross} value={money(t.grand_total)} tint="copper" />
                    <Stat label="ABV" value={money(t.abv)} />
                </Tiles>
            )
        case "executive_summary": {
            const g = (d.growth ?? {}) as Json
            const pw = (d.previous_window ?? {}) as Json
            const prev = (d.previous ?? {}) as Json
            return (
                <div className="flex flex-col gap-3">
                    <Tiles>
                        <Stat label={kGross} value={money(t.grand_total)} tint="copper" />
                        <Stat label="vs previous" value={pct(g.grand_total)} sub={money(prev.grand_total)} tint={growthTint(g.grand_total)} />
                        <Stat label={kNet} value={money(t.net)} sub={pct(g.net)} />
                        <Stat label="Bills" value={int(t.bills)} sub={pct(g.bills)} />
                        <Stat label="Covers" value={int(t.covers)} sub={pct(g.covers)} />
                        <Stat label="APC" value={money(t.apc)} sub={`pre-tax · ${pct(g.apc)}`} />
                    </Tiles>
                    <div>
                        <InfoChip
                            icon={<ArrowLeftRight className="h-3 w-3" />}
                            wrap
                            label={`Compared against ${s(pw.from) || "?"} to ${s(pw.to) || "?"} (${pw.basis === "months" ? "whole preceding month(s)" : "the equally-long window before"})`}
                        />
                    </div>
                </div>
            )
        }
        case "cover_size_summary":
            return (
                <Tiles>
                    <Stat label="Parties" value={int(t.parties)} />
                    <Stat label="Covers" value={int(t.covers)} />
                    <Stat label="Bills" value={int(t.bills)} />
                    <Stat label={kNet} value={money(t.net)} />
                    <Stat label={kGross} value={money(t.grand_total)} tint="copper" />
                    <Stat label="APC" value={money(t.apc)} sub="pre-tax" />
                </Tiles>
            )
        case "settlement_summary": {
            const nc = (t.nc ?? null) as Json | null
            const ncBills = Math.round(num(nc?.bills) ?? 0)
            const ncValue = num(nc?.value) ?? 0
            return (
                <div className="flex flex-col gap-3">
                    <Tiles>
                        <Stat label="Collected" value={money(t.amount)} tint="copper" />
                        <Stat label="Refunds" value={money(t.refund)} />
                        <Stat label={kAfterRefunds} value={money(t.net_amount)} sub="tax still in" />
                        <Stat label="Bills" value={int(t.bills)} />
                        <Stat label="Split-tender bills" value={int(t.split_bills)} />
                    </Tiles>
                    {nc && (ncBills !== 0 || ncValue !== 0) && (
                        <NcBeside
                            bills={ncBills} value={ncValue} money={money}
                            note="The Non-chargeable (NC) row reads 0.00 and moves no total; the value beside it is what was given away in this window, before tax."
                        />
                    )}
                </div>
            )
        }
        case "nc_summary": {
            const reversed = Math.round(num(t.reversed_entries) ?? 0)
            const kinds = list(d.by_kind)
            const scopes = list(d.by_scope).filter((x) => s(x.label).trim() && ((num(x.entries) ?? 0) > 0 || (num(x.loss) ?? 0) !== 0))
            return (
                <div className="flex flex-col gap-3">
                    <Tiles>
                        <Stat label="Comps" value={int(t.entries)} sub={reversed > 0 ? `${reversed} reversed` : null} />
                        <Stat label="Qty comped" value={int(t.quantity)} />
                        <Stat label="Given away" value={money(t.loss)} tint="danger" />
                        <Stat label="% of net sales" value={pct(t.loss_pct_of_net)} />
                        <Stat label="Net sales" value={money(t.net_sales)} sub="settlement clock" />
                        {reversed > 0 && <Stat label="Reversed" value={money(t.reversed_loss)} sub="back on the bill" />}
                    </Tiles>
                    {kinds.length > 0 && (
                        <Breakdown title="Why it was comped" rows={kinds.map((k) => ({ label: s(k.label) || s(k.kind), count: int(k.entries), value: money(k.loss) }))} />
                    )}
                    {scopes.length > 0 && (
                        <Breakdown title="Dish comps and NC bills" rows={scopes.map((k) => ({ label: s(k.label).trim(), count: int(k.entries), value: money(k.loss) }))} />
                    )}
                </div>
            )
        }
        case "service_charge_deny": {
            const reversed = Math.round(num(t.reversed_waivers) ?? 0)
            const kinds = list(d.by_kind)
            return (
                <div className="flex flex-col gap-3">
                    <Tiles>
                        <Stat label="Waivers" value={int(t.waivers)} sub={reversed > 0 ? `${reversed} reversed` : null} />
                        <Stat label="Charge denied" value={money(t.amount_waived)} tint="warning" />
                        <Stat label="Tax denied" value={money(t.tax_on_waived)} />
                        <Stat label="Total reduction" value={money(t.grand_total_reduction)} sub="charge + tax, before round-off" />
                        <Stat label="Charge collected" value={money(t.service_charge_collected)} sub="settlement clock" />
                        <Stat label="% denied" value={pct(t.denied_pct_of_chargeable)} />
                    </Tiles>
                    {kinds.length > 0 && (
                        <Breakdown title="Why it came off" rows={kinds.map((k) => ({ label: s(k.label) || s(k.kind), count: int(k.waivers), value: money(k.amount) }))} />
                    )}
                </div>
            )
        }
        case "group_summary":
            return (
                <Tiles>
                    <Stat label="Groups" value={int(t.groups)} />
                    <Stat label="Items" value={int(t.items)} />
                    <Stat label="Qty sold" value={int(t.qty)} />
                    <Stat label={kItemTotal} value={money(t.gross_amount)} />
                    <Stat label="Bill-level discount" value={money(d.bill_level_discount)} sub="not spread across lines" />
                </Tiles>
            )
        case "variation_summary":
            return (
                <Tiles>
                    <Stat label="Dishes with sizes" value={int(t.items)} />
                    <Stat label="Variations" value={int(t.variations)} />
                    <Stat label="Qty sold" value={int(t.qty)} />
                    <Stat label={kItemTotal} value={money(t.gross_amount)} />
                    <Stat label="Whole menu item total" value={money(d.window_gross)} sub="Item Wise, same window" />
                </Tiles>
            )
        case "tip_summary": {
            const people = list(d.by_credited_to)
            const modes = list(d.by_mode)
            return (
                <div className="flex flex-col gap-3">
                    <Tiles>
                        <Stat label="Tips" value={money(t.tip_amount)} tint="copper" sub="not revenue" />
                        <Stat label="Tipped tenders" value={int(t.tenders)} />
                        <Stat label="Bills" value={int(t.bills)} />
                    </Tiles>
                    {people.length > 0 && (
                        <Breakdown title="Who is owed it" rows={people.map((r) => ({ label: s(r.credited_to) || "—", count: int(r.tenders), value: money(r.tips) }))} />
                    )}
                    {modes.length > 0 && (
                        <Breakdown title="How it arrived" rows={modes.map((r) => ({ label: s(r.label) || s(r.mode), count: int(r.tenders), value: money(r.tips) }))} />
                    )}
                </div>
            )
        }
        case "counter_summary": {
            const variance = num(t.variance) ?? 0
            return (
                <div className="flex flex-col gap-3">
                    <Tiles>
                        <Stat label="Tills" value={int(t.counters)} />
                        <Stat label="Bills" value={int(t.bills)} />
                        <Stat label={kGross} value={money(t.grand_total)} tint="copper" />
                        <Stat label={kNet} value={money(t.net)} />
                        <Stat label="Cash sessions" value={int(t.sessions)} />
                        <Stat label="Cash variance" value={money(t.variance)} sub="counted − expected" tint={Math.abs(variance) >= 0.01 ? "warning" : null} />
                    </Tiles>
                    <LadderCard ladder={t} money={money} />
                </div>
            )
        }
        default:
            return null
    }
}

/** `_misFlags`: the short caveats that change how a number is READ, as chips. */
export function ReportFlags({ reportKey, payload, currencySymbol }: { reportKey: MisReportKey; payload: MisReportPayload; currencySymbol: string }): React.JSX.Element | null {
    const t = (payload.totals ?? {}) as Json
    const d = payload as unknown as Json
    const money = (v: unknown): string => formatMoney(v, currencySymbol)
    const chips: { label: string; status: "warning" | "info" | "danger" }[] = []

    if ((reportKey === "item_wise" || reportKey === "nc_summary") && d.category_exact === false) {
        chips.push({ label: "Category is matched by dish name — a renamed dish shows a blank category", status: "info" })
    }
    if (reportKey === "discount" && (num(t.estimated_bills) ?? 0) > 0) {
        chips.push({ label: `${formatInt(t.estimated_bills)} percentage discount(s) reconstructed from the settled total`, status: "warning" })
    }
    if (reportKey === "settlement_summary") {
        const un = num(t.unallocated) ?? 0
        if (Math.abs(un) >= 0.01) {
            chips.push({ label: `Unallocated ${money(un)} — split parts do not add back to the bill total`, status: "danger" })
        }
    }
    if (reportKey === "group_summary") {
        if ((num(t.unclassified_gross) ?? 0) > 0) { chips.push({ label: `Unclassified ${money(t.unclassified_gross)} — on the menu, in no group`, status: "warning" }) }
        if ((num(t.unattributed_gross) ?? 0) > 0) { chips.push({ label: `Unattributed ${money(t.unattributed_gross)} — matches no menu dish`, status: "info" }) }
    }
    if (reportKey === "variation_summary" && d.no_variations_configured === true) {
        chips.push({ label: "No sizes are configured on this menu", status: "info" })
    }
    if (reportKey === "counter_summary" && d.no_counters_configured === true) {
        chips.push({ label: "No tills configured — every bill is in the unassigned row", status: "info" })
    }
    if (reportKey === "tip_summary") {
        chips.push({ label: "A tip is not revenue — it is in no sales figure", status: "info" })
    }
    // Any report whose totals carry it, not only the Sales Summary.
    if ((num(t.bills_without_covers) ?? 0) > 0) {
        chips.push({ label: `${formatInt(t.bills_without_covers)} bill(s) have no covers — APC counts only resolvable covers`, status: "info" })
    }
    if (chips.length === 0) { return null }
    return (
        <div className="flex flex-wrap gap-2">
            {chips.map((c) => <StatusChip key={c.label} status={c.status} label={c.label} dense />)}
        </div>
    )
}
