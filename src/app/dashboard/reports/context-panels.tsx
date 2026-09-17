"use client"

// WHAT THE TABLE ALONE DOES NOT SAY.
//
// Most of the fifteen reports are a grid and a totals row. Several are not, and
// more carry a figure that lives beside the grid rather than in it — the money
// given away as BILL-level discount on a report whose rows are items, the growth
// against last period on the Executive Summary, the unallocated remainder on the
// Settlement Summary, the two DIFFERENT gap buckets on the Group Summary. Those
// figures are the reason someone opened the document; leaving them in a payload
// the screen never renders would be the same as not computing them.
//
// The six panels at the bottom carry a second job the first nine did not need:
// each of their reports counts money that is deliberately NOT revenue (a comp, a
// denied service charge, a tip), and the caveat beside it is what stops an owner
// adding it to their takings.
//
// EVERY NUMBER HERE COMES OFF THE PAYLOAD. Nothing on this page is derived,
// summed or re-scaled client-side. The exceptions are presentational — picking
// the colour of a growth chip from the sign of a number the server sent, and the
// Sales Summary's one tile that puts service charge, tax and round off (the three
// rungs between Net and Gross) together, via chargesAboveNet in lib/gross-net.ts.
//
// THE WORDS ARE lib/gross-net.ts's. Gross is the grand total, Net is after
// discount and before service charge, tax and round off, Item total is before
// the discount — the same three the server's column labels use.

import { AlertTriangle, Info, TrendingDown, TrendingUp } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { AFTER_REFUNDS, GROSS, ITEM_TOTAL, NET, chargesAboveNet, discountPctOf, itemTotalOf } from "@/lib/gross-net"
import {
    formatInt,
    formatMoney,
    formatPercent,
    type MisReportPayload,
    type MisReportKey,
} from "@/lib/mis-reports"
import { NC_SETTLE_LABEL, ncBesideLine, ncSummaryByScope, salesSummaryNc, settlementSummaryNc } from "@/lib/nc-settle"

interface Ctx {
    payload: MisReportPayload
    currencySymbol: string
}

const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") {return null}
    const n = Number(v)
    return Number.isNaN(n) ? null : n
}

/** One headline figure. `tone` only ever reflects a value the server sent. */
function Tile({ label, value, hint, tone }: {
    label: string
    value: string
    hint?: string
    tone?: "default" | "warn" | "good" | "bad"
}) {
    return (
        <Card className={cn(
            "shadow-none",
            tone === "warn" && "border-amber-500/40 bg-amber-500/[0.04]",
            tone === "bad" && "border-destructive/40 bg-destructive/[0.04]",
        )}>
            <CardContent className="p-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
                <div className={cn(
                    "mt-0.5 font-mono text-xl tabular-nums",
                    tone === "good" && "text-emerald-600 dark:text-emerald-400",
                    tone === "bad" && "text-destructive",
                )}>
                    {value}
                </div>
                {hint ? <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</div> : null}
            </CardContent>
        </Card>
    )
}

const Tiles = ({ children }: { children: React.ReactNode }) => (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">{children}</div>
)

/** A signed growth chip. Green up / red down, straight off the server's sign. */
function GrowthChip({ value, label }: { value: number | null; label: string }) {
    if (value === null) {
        return (
            <Badge variant="secondary" className="font-normal" title="There was no comparable trade in the previous period, so a growth percentage would be meaningless.">
                {label} — no prior period
            </Badge>
        )
    }
    const up = value >= 0
    return (
        <Badge
            variant="outline"
            className={cn("gap-1 font-mono tabular-nums",
                up ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
                   : "border-destructive/50 text-destructive")}
        >
            {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {label} {formatPercent(value, { signed: true })}
        </Badge>
    )
}

/** A caveat the reader has to see BEFORE they read the numbers, not after. */
function Caveat({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" }) {
    const Icon = tone === "warn" ? AlertTriangle : Info
    return (
        <div className={cn(
            "flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-snug",
            tone === "warn"
                ? "border-amber-500/40 bg-amber-500/[0.05]"
                : "border-border bg-muted/40 text-muted-foreground",
        )}>
            <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", tone === "warn" && "text-amber-600 dark:text-amber-400")} />
            <div>{children}</div>
        </div>
    )
}

export function ContextPanel({ reportKey, payload, currencySymbol }: Ctx & { reportKey: MisReportKey }) {
    const money = (v: unknown) => formatMoney(v, currencySymbol)
    const totals = (payload.totals ?? {}) as Record<string, unknown>

    switch (reportKey) {
        case "item_wise": {
            const billDiscount = num(payload.bill_level_discount)
            const categoryExact = payload.category_exact === true
            return (
                <div className="space-y-2">
                    <Tiles>
                        <Tile label="Distinct items" value={formatInt(totals.items)} />
                        <Tile label="Qty sold" value={formatInt(totals.qty)} />
                        <Tile label={ITEM_TOTAL} value={money(totals.gross_amount)} hint="Menu price × qty, before any discount" />
                        <Tile
                            label="Bill-level discount"
                            value={money(billDiscount)}
                            hint="Given away in this window, not attributable to any one dish"
                            tone={billDiscount && billDiscount > 0 ? "warn" : "default"}
                        />
                    </Tiles>
                    <Caveat tone="warn">
                        This report is bucketed by when the ORDER WAS PLACED, as the chip beside its title says;
                        most of the others bucket by when the bill was SETTLED, so its totals are not expected to
                        reconcile with theirs. Group Summary and Variation Summary are the same lines re-cut on
                        this same clock, and their item total equals this one&apos;s exactly.
                        Gross and Net are bill figures: a discount, a service charge and tax are applied to the whole
                        bill, never to a line, so this report shows only the item total — the window&apos;s real
                        discount is the tile above.
                    </Caveat>
                    {!categoryExact && (
                        <Caveat tone="warn">
                            <b>Category is matched by item NAME, not by id.</b>{" "}A dish renamed on the menu since it
                            was sold will show a blank category here. Treat the category column as indicative;
                            the item, quantity and money columns are exact.
                        </Caveat>
                    )}
                </div>
            )
        }

        case "discount": {
            const estimated = num(totals.estimated_bills) ?? 0
            const pct = num(discountPctOf(totals))
            return (
                <div className="space-y-2">
                    <Tiles>
                        <Tile label="Discounted bills" value={formatInt(totals.discounted_bills)} />
                        <Tile
                            label="Discount given"
                            value={money(totals.discount_amount)}
                            tone={(num(totals.discount_amount) ?? 0) > 0 ? "warn" : "default"}
                        />
                        <Tile label="% of item total" value={formatPercent(pct)} hint="Of everything sold in the window" />
                        <Tile label={ITEM_TOTAL} value={money(itemTotalOf(totals))} hint="Discounted bills, before the discount" />
                        <Tile label={GROSS} value={money(totals.grand_total)} hint="Discounted bills, what guests paid" />
                    </Tiles>
                    {estimated > 0 && (
                        <Caveat tone="warn">
                            <b>{estimated}{" "}of these bills had a PERCENTAGE discount whose money value was never
                            snapshotted.</b>{" "}Those amounts are reconstructed from the settled total rather than read
                            from a stored figure — the &ldquo;Type&rdquo; column marks them. Every other row is exact.
                        </Caveat>
                    )}
                </div>
            )
        }

        case "void_kot":
            return (
                <div className="space-y-2">
                    <Tiles>
                        <Tile label="Voided tickets" value={formatInt(totals.voids)} />
                        <Tile label="Lines" value={formatInt(totals.item_count)} />
                        <Tile label="Qty" value={formatInt(totals.qty)} />
                        <Tile
                            label="Value voided"
                            value={money(totals.value)}
                            tone={(num(totals.value) ?? 0) > 0 ? "warn" : "default"}
                            hint="Not revenue — excluded from every sales figure"
                        />
                    </Tiles>
                    <Caveat>
                        <b>A BLANK REASON MEANS NONE WAS EVER RECORDED — it is never guessed, and the row is never
                        hidden.</b>{" "}The <b>Reason</b>{" "}and <b>Stage</b>{" "}columns come from the void ledger,
                        which only an order voided through <b>Controls → Void this order</b>{" "}writes: that path
                        captures a reason, a kind, an authoriser, and a stage the SERVER derives (before print,
                        after print, after bill) rather than one the till claims. An order cancelled by a plain
                        status change, or voided before that ledger existed, has no row there — so those cells are
                        blank. Blank is the honest answer; back-filling one would put a reason in an auditor&apos;s
                        hands that nobody typed.
                    </Caveat>
                    <Caveat>
                        A KOT number cannot be recovered for a cancelled ticket — the KOT numbering keys off a
                        content fingerprint of what was sent to the kitchen, not off the order — so the order id is
                        its identity here.
                    </Caveat>
                </div>
            )

        case "bill_edit": {
            const byKind = Array.isArray(totals.by_kind)
                ? (totals.by_kind as { kind: string; label: string; count: number }[])
                : []
            return (
                <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="font-mono">
                            {formatInt(totals.edits)} edits
                        </Badge>
                        {byKind.map((k) => (
                            <Badge key={k.kind} variant="outline" className="font-normal">
                                {k.label} <span className="ml-1 font-mono tabular-nums">{k.count}</span>
                            </Badge>
                        ))}
                    </div>
                    <Caveat>
                        Reconstructed from the audit trail. The writers of these entries do <b>not</b>{" "}record the
                        bill value before and after the change, so there is no before/after or difference column —
                        showing a computed one would be inventing a number. Open a row to see the record itself.
                    </Caveat>
                </div>
            )
        }

        case "sales_summary": {
            const byType = Array.isArray(payload.by_order_type)
                ? (payload.by_order_type as { order_type: string; bills: number; grand_total: number; share_pct: number | null }[])
                : []
            const salesNc = salesSummaryNc(totals)
            return (
                <div className="space-y-2">
                    <Tiles>
                        <Tile label={ITEM_TOTAL} value={money(itemTotalOf(totals))} hint="Menu price, before discount" />
                        <Tile label="Discount" value={`− ${money(totals.discount)}`} />
                        <Tile label={NET} value={money(totals.net)} hint="After discount, before service charge, tax and round off" />
                        <Tile label="Service charge, tax & round off" value={`+ ${money(chargesAboveNet(totals))}`} />
                        <Tile label={GROSS} value={money(totals.grand_total)} hint="Grand total — what guests paid" />
                    </Tiles>
                    <Tiles>
                        <Tile label="Bills" value={formatInt(totals.bills)} />
                        <Tile label="Covers" value={formatInt(totals.covers)} hint="Counted once per seating" />
                        <Tile label="ABV" value={money(totals.abv)} hint="Average bill value, tax-inclusive" />
                        <Tile label="APC" value={money(totals.apc)} hint="Per cover, PRE-tax" />
                        <Tile label="Refunds" value={money(totals.refund)} tone={(num(totals.refund) ?? 0) > 0 ? "warn" : "default"} />
                    </Tiles>
                    {salesNc && (
                        // BESIDE the ladder, never a tile inside it: nothing here
                        // was collected. The NC bills are already inside Bills.
                        <Caveat>
                            <b>{NC_SETTLE_LABEL} — not collected: {ncBesideLine(salesNc, money)}.</b>{" "}Bills settled as
                            NC close at 0.00 and still count as bills (and their parties as covers), like a released
                            table; the value given away is pre-tax, dishes comped one by one included.
                        </Caveat>
                    )}
                    {byType.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 pt-0.5">
                            <span className="text-xs text-muted-foreground">By order type:</span>
                            {byType.map((t) => (
                                <Badge key={t.order_type} variant="outline" className="font-normal">
                                    {t.order_type} · <span className="ml-1 font-mono tabular-nums">{money(t.grand_total)}</span>
                                    <span className="ml-1 text-muted-foreground">({formatPercent(t.share_pct)})</span>
                                </Badge>
                            ))}
                        </div>
                    )}
                    {(num(totals.bills_without_covers) ?? 0) > 0 && (
                        <Caveat>
                            {formatInt(totals.bills_without_covers)}{" "}bill(s) in this window could not be matched to a
                            seating, so they contribute their money but no covers. APC is computed only over the
                            covers that were resolvable.
                        </Caveat>
                    )}
                </div>
            )
        }

        case "order_summary":
            return (
                <div className="space-y-2">
                    <Tiles>
                        <Tile label="Bills" value={formatInt(totals.bills)} />
                        <Tile label={NET} value={money(totals.net)} />
                        <Tile label="Tax" value={money(totals.tax)} />
                        <Tile label={GROSS} value={money(totals.grand_total)} hint="Grand total — what guests paid" />
                        <Tile label="Refunds" value={money(totals.refund)} tone={(num(totals.refund) ?? 0) > 0 ? "warn" : "default"} />
                    </Tiles>
                    <Caveat>
                        The totals row covers <b>every bill in the range</b>, not just the page on screen — which is
                        why the visible rows will not add up to it. Its Gross is the same figure the Sales
                        Summary and the Settlement Summary report for this window.
                    </Caveat>
                </div>
            )

        case "executive_summary": {
            const growth = (payload.growth ?? {}) as Record<string, unknown>
            const prevWindow = payload.previous_window as { from: string; to: string; days: number; basis: string } | undefined
            const previous = (payload.previous ?? {}) as Record<string, unknown>
            return (
                <div className="space-y-2">
                    <Tiles>
                        <Tile label={GROSS} value={money(totals.grand_total)} />
                        <Tile label="Previous period (gross)" value={money(previous.grand_total)} />
                        <Tile label="Bills" value={formatInt(totals.bills)} />
                        <Tile label="Covers" value={formatInt(totals.covers)} />
                        <Tile label="APC" value={money(totals.apc)} hint="Per cover, pre-tax" />
                    </Tiles>
                    <div className="flex flex-wrap items-center gap-2">
                        <GrowthChip value={num(growth.grand_total)} label={GROSS} />
                        <GrowthChip value={num(growth.net)} label={NET} />
                        <GrowthChip value={num(growth.bills)} label="Bills" />
                        <GrowthChip value={num(growth.covers)} label="Covers" />
                        <GrowthChip value={num(growth.abv)} label="ABV" />
                        <GrowthChip value={num(growth.apc)} label="APC" />
                    </div>
                    {prevWindow && (
                        <Caveat>
                            Growth compares this range against <b>{prevWindow.from} to {prevWindow.to}</b>{" "}
                            ({prevWindow.days} day{prevWindow.days === 1 ? "" : "s"}, matched by {prevWindow.basis}).
                            Switch the outlet selector to <b>All outlets</b>{" "}for the group view — one row per branch.
                        </Caveat>
                    )}
                </div>
            )
        }

        case "cover_size_summary":
            return (
                <div className="space-y-2">
                    <Tiles>
                        <Tile label="Parties" value={formatInt(totals.parties)} />
                        <Tile label="Covers" value={formatInt(totals.covers)} />
                        <Tile label="Bills" value={formatInt(totals.bills)} />
                        <Tile label={GROSS} value={money(totals.grand_total)} />
                        <Tile label="Spend per cover" value={money(totals.apc)} hint="Pre-tax" />
                    </Tiles>
                    <Caveat>
                        Grouped by the party size recorded at seating. A bill whose seating could not be resolved
                        carries no party size and is grouped separately — its money still counts, its covers cannot.
                    </Caveat>
                </div>
            )

        case "settlement_summary": {
            const unallocated = num(totals.unallocated) ?? 0
            const splitBills = num(totals.split_bills) ?? 0
            const settleNc = settlementSummaryNc(totals)
            return (
                <div className="space-y-2">
                    <Tiles>
                        <Tile label="Bills settled" value={formatInt(totals.bills)} />
                        <Tile label="Collected" value={money(totals.amount)} />
                        <Tile label="Refunds" value={money(totals.refund)} tone={(num(totals.refund) ?? 0) > 0 ? "warn" : "default"} />
                        <Tile label={AFTER_REFUNDS} value={money(totals.net_amount)} hint="Collected less refunds — tax still in" />
                        <Tile
                            label="Unallocated"
                            value={money(unallocated)}
                            tone={unallocated !== 0 ? "bad" : "default"}
                            hint={unallocated === 0 ? "Every rupee is attributed to a mode" : "Money no payment mode accounts for"}
                        />
                    </Tiles>
                    {unallocated !== 0 && (
                        <Caveat tone="warn">
                            <b>{money(unallocated)} is not attributed to any payment mode.</b>{" "}This should always be
                            zero. Investigate before using this document to cash up.
                        </Caveat>
                    )}
                    <Caveat>
                        Collected here equals the Sales Summary&apos;s Gross and the sum of the Order Summary&apos;s
                        rows for the same window — the three are cut from one ladder and are tested against each
                        other.{splitBills > 0 ? ` ${String(splitBills)} bill(s) were settled across more than one mode.` : ""}
                    </Caveat>
                    {settleNc && (
                        <Caveat>
                            <b>{NC_SETTLE_LABEL} — not collected: {ncBesideLine(settleNc, money)}.</b>{" "}The{" "}
                            {NC_SETTLE_LABEL} row reads 0.00 and moves no total; the value beside it is what was given
                            away in this window, before tax.
                        </Caveat>
                    )}
                </div>
            )
        }

        // ------------------------------------------------------------------
        // The six that migrations 034-039 made possible.
        // ------------------------------------------------------------------

        case "nc_summary": {
            const byKind = Array.isArray(payload.by_kind)
                ? (payload.by_kind as { kind: string; label: string; entries: number; quantity: number; loss: number }[])
                : []
            const reversed = num(totals.reversed_entries) ?? 0
            const loss = num(totals.loss) ?? 0
            const categoryExact = payload.category_exact === true
            const byScope = ncSummaryByScope(payload)
            return (
                <div className="space-y-2">
                    <Tiles>
                        <Tile label="Comps" value={formatInt(totals.entries)} hint={reversed > 0 ? `${String(reversed)} of them reversed` : undefined} />
                        <Tile label="Qty given away" value={formatInt(totals.quantity)} />
                        <Tile
                            label="Revenue given away"
                            value={money(loss)}
                            tone={loss > 0 ? "warn" : "default"}
                            hint="What the guest would otherwise have paid"
                        />
                        <Tile label="% of net sales" value={formatPercent(totals.loss_pct_of_net)} hint="Against this window's net" />
                        <Tile label="Reversed" value={money(totals.reversed_loss)} hint="Put back on the bill" />
                    </Tiles>
                    {byKind.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 pt-0.5">
                            <span className="text-xs text-muted-foreground">By reason:</span>
                            {byKind.map((k) => (
                                <Badge key={k.kind} variant="outline" className="font-normal">
                                    {k.label} · <span className="ml-1 font-mono tabular-nums">{money(k.loss)}</span>
                                    <span className="ml-1 text-muted-foreground">({k.entries})</span>
                                </Badge>
                            ))}
                        </div>
                    )}
                    {byScope.length > 0 && (
                        // Item = one dish comped; Bill = a line of a bill settled as NC.
                        <div data-testid="nc-by-scope" className="flex flex-wrap items-center gap-2 pt-0.5">
                            <span className="text-xs text-muted-foreground">By scope:</span>
                            {byScope.map((k) => (
                                <Badge key={k.scope} variant="outline" className="font-normal">
                                    {k.label} · <span className="ml-1 font-mono tabular-nums">{money(k.loss)}</span>
                                    <span className="ml-1 text-muted-foreground">({k.entries})</span>
                                </Badge>
                            ))}
                        </div>
                    )}
                    <Caveat>
                        <b>A comp comes OUT of what the guest pays and is still revenue given away.</b>{" "}Both are
                        true, so both are shown: the money above never entered a sales figure — a settled bill&apos;s
                        total is already net of it — and it is not a rung of the money ladder. It is what the
                        house chose not to charge.
                    </Caveat>
                    <Caveat>
                        Three prices sit in the grid because the schema holds three. <b>Menu price</b>{" "}is the list
                        price when the comp was made; <b>NC price</b>{" "}is what the line itself carried; the loss is
                        quantity × NC price, because that is the money the guest would have handed over. An
                        off-menu or uplifted line shows the gap between them.
                        {reversed > 0 ? " A reversed comp reads 0 in the live money columns and carries its amount under Reversed, so every column still adds to its own total." : ""}
                    </Caveat>
                    {!categoryExact && (
                        <Caveat tone="warn">
                            <b>Category is matched by item NAME, not by id</b>{" "}— a dish renamed since it was comped
                            shows a blank category. Every money column is exact.
                        </Caveat>
                    )}
                </div>
            )
        }

        case "service_charge_deny": {
            const byKind = Array.isArray(payload.by_kind)
                ? (payload.by_kind as { kind: string; label: string; waivers: number; amount: number }[])
                : []
            const denied = num(totals.grand_total_reduction) ?? 0
            const tax = num(totals.tax_on_waived) ?? 0
            return (
                <div className="space-y-2">
                    <Tiles>
                        <Tile label="Waivers" value={formatInt(totals.waivers)} hint={(num(totals.reversed_waivers) ?? 0) > 0 ? `${formatInt(totals.reversed_waivers)} reversed` : undefined} />
                        <Tile label="Charge denied" value={money(totals.amount_waived)} tone={(num(totals.amount_waived) ?? 0) > 0 ? "warn" : "default"} />
                        <Tile label="Tax that rode on it" value={money(tax)} hint="Never charged either" />
                        {/* The recorded charge + tax, measured before each bill's round-off
                            (migration 048) — not the rounded totals' gap, so not "guests paid less by". */}
                        <Tile label="Charge + tax denied" value={money(denied)} hint="Before each bill's round-off" tone={denied > 0 ? "warn" : "default"} />
                        <Tile label="Service charge collected" value={money(totals.service_charge_collected)} hint="In the same window, on the settlement clock" />
                    </Tiles>
                    {byKind.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 pt-0.5">
                            <span className="text-xs text-muted-foreground">By reason:</span>
                            {byKind.map((k) => (
                                <Badge key={k.kind} variant="outline" className="font-normal">
                                    {k.label} · <span className="ml-1 font-mono tabular-nums">{money(k.amount)}</span>
                                    <span className="ml-1 text-muted-foreground">({k.waivers})</span>
                                </Badge>
                            ))}
                        </div>
                    )}
                    <Caveat>
                        <b>None of this money ever entered a sales figure</b>, so adding it to one would invent
                        revenue. On an open bill a service charge was never part of the stored total; on a settled
                        one it is simply absent from the grand total. This report says what the house chose not to
                        charge — {formatPercent(num(totals.denied_pct_of_chargeable))} of what it could have.
                    </Caveat>
                    <Caveat>
                        The reduction is <b>bigger than the charge</b>{" "}wherever tax rode on it. Both figures were
                        measured at the moment of the waiver by running the real charge computation twice and
                        differencing, then stored — so editing your tax setup today does not restate last month&apos;s
                        waivers.
                    </Caveat>
                </div>
            )
        }

        case "group_summary": {
            const billDiscount = num(payload.bill_level_discount)
            const unclassified = num(totals.unclassified_gross) ?? 0
            const unattributed = num(totals.unattributed_gross) ?? 0
            return (
                <div className="space-y-2">
                    <Tiles>
                        <Tile label="Groups" value={formatInt(totals.groups)} />
                        <Tile label="Items" value={formatInt(totals.items)} />
                        <Tile label="Qty" value={formatInt(totals.qty)} />
                        <Tile label={ITEM_TOTAL} value={money(totals.gross_amount)} hint="Equals Item Wise for this window" />
                        <Tile
                            label="Bill-level discount"
                            value={money(billDiscount)}
                            hint="Not attributable to any one group"
                            tone={billDiscount && billDiscount > 0 ? "warn" : "default"}
                        />
                    </Tiles>
                    <Caveat>
                        These are the <b>same order lines as Item Wise</b>, re-cut — same window, same
                        order-placement clock, same menu-price basis — so the item total above equals that
                        report&apos;s exactly. Two item-level reports that disagreed about what sold would be the same
                        failure as two bill-level reports disagreeing about net sales.
                    </Caveat>
                    {unclassified > 0 || unattributed > 0 ? (
                        <Caveat tone="warn">
                            <b>Two different gaps, and they are not the same problem.</b>{" "}
                            {unclassified > 0 ? <><b>Unclassified</b>{" "}({money(unclassified)}) is a dish that is on the menu and in no
                                group — a configuration gap you can close in Menu → Groups &amp; sizes and watch shrink to
                                zero. </> : null}
                            {unattributed > 0 ? <><b>Unattributed</b>{" "}({money(unattributed)}) is a line that matches no menu
                                dish at all — history, from before the dish existed or after it was renamed, and it cannot
                                be classified backwards. </> : null}
                            Both are counted, which is the only reason this report&apos;s total equals Item Wise&apos;s.
                        </Caveat>
                    ) : (
                        <Caveat>
                            Nothing is unclassified and nothing is unattributed — every line in this window resolved
                            to a dish and every dish to a group.
                        </Caveat>
                    )}
                    <Caveat>
                        The group is resolved when this report runs, never stamped onto a sale. Correcting a
                        misfiling in the menu editor therefore corrects the last six months of this report, not
                        only tomorrow&apos;s.
                    </Caveat>
                </div>
            )
        }

        case "variation_summary": {
            const none = payload.no_variations_configured === true
            const windowGross = num(payload.window_gross)
            return (
                <div className="space-y-2">
                    <Tiles>
                        <Tile label="Dishes with sizes" value={formatInt(totals.items)} />
                        <Tile label="Price points" value={formatInt(totals.variations)} />
                        <Tile label="Qty" value={formatInt(totals.qty)} />
                        <Tile label="Item total in this report" value={money(totals.gross_amount)} />
                        <Tile label="Item total, whole window" value={money(windowGross)} hint="Item Wise, same window" />
                    </Tiles>
                    {none ? (
                        <Caveat tone="warn">
                            <b>No sizes are configured on this menu</b>, so there is nothing for this report to
                            split. Add them in <b>Menu → Groups &amp; sizes</b>: a Half at ₹150 beside a Full at ₹250
                            stops one dish&apos;s sales being spread across three differently-named rows.
                        </Caveat>
                    ) : (
                        <Caveat>
                            <b>A deliberate subset, and it says so.</b>{" "}Only dishes that HAVE sizes appear — one row
                            per size, plus a base row where lines of that dish named none. Listing every dish with a
                            single &ldquo;Base&rdquo; row would bury the handful actually sold in sizes under hundreds
                            that are not. The window&apos;s whole item total sits beside it so the size of the subset is
                            visible rather than implied.
                        </Caveat>
                    )}
                    <Caveat>
                        A size is never inferred from a name. A line reports under one only because the server
                        stamped it there — &ldquo;Paneer Tikka (Half)&rdquo; typed as an off-menu line is not
                        evidence of anything and is not counted here.
                    </Caveat>
                </div>
            )
        }

        case "tip_summary": {
            const byMode = Array.isArray(payload.by_mode)
                ? (payload.by_mode as { mode: string; label: string; tips: number; tenders: number }[])
                : []
            const byWho = Array.isArray(payload.by_credited_to)
                ? (payload.by_credited_to as { credited_to: string; tips: number; tenders: number }[])
                : []
            return (
                <div className="space-y-2">
                    <Tiles>
                        <Tile label="Tips" value={money(totals.tip_amount)} hint="NOT revenue" />
                        <Tile label="Payments carrying a tip" value={formatInt(totals.tenders)} />
                        <Tile label="Bills" value={formatInt(totals.bills)} />
                    </Tiles>
                    {byMode.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 pt-0.5">
                            <span className="text-xs text-muted-foreground">How they arrived:</span>
                            {byMode.map((m) => (
                                <Badge key={m.mode} variant="outline" className="font-normal">
                                    {m.label} · <span className="ml-1 font-mono tabular-nums">{money(m.tips)}</span>
                                </Badge>
                            ))}
                        </div>
                    )}
                    {byWho.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-muted-foreground">Owed to:</span>
                            {byWho.map((w) => (
                                <Badge key={w.credited_to} variant="secondary" className="font-normal">
                                    {w.credited_to} · <span className="ml-1 font-mono tabular-nums">{money(w.tips)}</span>
                                </Badge>
                            ))}
                        </div>
                    )}
                    <Caveat tone="warn">
                        <b>A tip is not revenue and appears in no sales figure on this system</b>{" "}— not in the item
                        total, not in Net, not in Gross, not in APC or ABV, and not in any settlement bucket. It
                        rides on a payment beside the amount that settles the bill and is excluded from every sum
                        that reconciles against it. This is a payroll document, not a sales one.
                    </Caveat>
                    <Caveat>
                        The payment&apos;s own amount is deliberately <b>not</b>{" "}a column here: it would be the only
                        number on the page that IS revenue, sitting next to one that is not. Open a row to see the
                        bill behind it.
                    </Caveat>
                </div>
            )
        }

        case "counter_summary": {
            const none = payload.no_counters_configured === true
            const variance = num(totals.variance) ?? 0
            return (
                <div className="space-y-2">
                    <Tiles>
                        <Tile label="Tills" value={formatInt(totals.counters)} />
                        <Tile label="Bills" value={formatInt(totals.bills)} />
                        <Tile label={NET} value={money(totals.net)} />
                        <Tile label={GROSS} value={money(totals.grand_total)} hint="Equals the Sales Summary" />
                        <Tile
                            label="Cash variance"
                            value={money(variance)}
                            tone={variance !== 0 ? "warn" : "default"}
                            hint={`Across ${formatInt(totals.sessions)} counted session(s)`}
                        />
                    </Tiles>
                    {none ? (
                        <Caveat>
                            <b>No tills are configured for this outlet</b>, which is the normal state for a
                            restaurant with one billing point — every bill sits in the unassigned row and that row
                            is the whole outlet. Add tills in <b>Settings → Billing counters</b>{" "}only if you run
                            more than one.
                        </Caveat>
                    ) : (
                        <Caveat>
                            A bill with no till is not dropped — it lands in an explicit <b>(none)</b>{" "}row. Every
                            bill taken before tills were configured is in it, and so is every bill nobody
                            attributed. That is the only reason this report&apos;s Gross equals the Sales
                            Summary&apos;s.
                        </Caveat>
                    )}
                    <Caveat>
                        The same bills as the Sales Summary, bucketed by till: composed through the same money
                        ladder over the same bill set, so the totals row is that report&apos;s figure exactly. Covers
                        are still counted once per seating <b>across tills</b>, so a table billed on two tills is
                        not two parties.
                    </Caveat>
                </div>
            )
        }

        default:
            return null
    }
}
