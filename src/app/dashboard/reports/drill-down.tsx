"use client"

// ROW → THE RECORD BEHIND IT.
//
// A control report exists to make someone ask "what actually happened on that
// line", so every row that HAS a record behind it opens it: a Discount or an
// Order Summary row opens the bill, a Void KOT row opens the ticket, and a Bill
// Edit row opens whichever of the two the change touched.
//
// The bill comes from `GetClosedBill` — the SAME reader the History screen and
// the bill-detail screen use. That is deliberate and worth stating: a drill-down
// that reconstructed the bill itself could show a different bill from the rest
// of the product, and in a fraud-control document that is the worst bug
// available. Reusing the reader makes the disagreement impossible rather than
// unlikely.
//
// The four summary reports (Sales, Executive, Cover Size, Settlement) have NO
// drill-down and their rows are not clickable, because a row there is an
// aggregate over many bills — there is no single record to open, and a control
// that looks clickable and does nothing is worse than one that is plainly inert.

import { useEffect, useState } from "react"
import { AlertTriangle, ExternalLink, Loader2, Receipt, UtensilsCrossed } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { formatRoundOff, roundOffOf } from "@/lib/bill-round-off"
import { getMisBillDetail, getMisKotDetail, type ClosedBillDetail, type MisOrderDetail } from "@/lib/db"
import { ITEM_TOTAL } from "@/lib/gross-net"
import { formatMoney } from "@/lib/mis-reports"
import { formatFullDateTime } from "@/lib/tz"

export interface DrillRequest {
    kind: "bill" | "kot"
    id: string
}

interface Props {
    request: DrillRequest | null
    onClose: () => void
    restaurantId: string
    outletId?: string
    timezone: string
    currencySymbol: string
}

const Line = ({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) => (
    <div className={`flex items-baseline justify-between gap-6 py-1 ${strong ? "font-semibold" : ""}`}>
        <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
        <span className="font-mono tabular-nums">{value}</span>
    </div>
)

const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="truncate text-sm">{value ?? "—"}</div>
    </div>
)

export function DrillDownDialog({ request, onClose, restaurantId, outletId, timezone, currencySymbol }: Props) {
    const [bill, setBill] = useState<ClosedBillDetail | null>(null)
    const [kot, setKot] = useState<MisOrderDetail | null>(null)
    const [loading, setLoading] = useState(false)
    const [failed, setFailed] = useState(false)

    const money = (n: number | null | undefined) => formatMoney(n, currencySymbol)
    const when = (v: string | null | undefined) => (v ? formatFullDateTime(v, timezone) : "—")

    useEffect(() => {
        if (!request || !restaurantId) {return}
        let active = true
        setLoading(true)
        setFailed(false)
        setBill(null)
        setKot(null)

        const load = request.kind === "bill"
            ? getMisBillDetail(restaurantId, request.id, outletId).then((b) => { if (active) {setBill(b); setFailed(!b)} })
            : getMisKotDetail(restaurantId, request.id, outletId).then((o) => { if (active) {setKot(o); setFailed(!o)} })

        void load
            .catch(() => { if (active) {setFailed(true)} })
            .finally(() => { if (active) {setLoading(false)} })

        return () => { active = false }
    }, [request, restaurantId, outletId])

    const open = request !== null

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) {onClose()} }}>
            <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {request?.kind === "kot"
                            ? <><UtensilsCrossed className="h-4 w-4" /> KOT / order</>
                            : <><Receipt className="h-4 w-4" /> Bill{bill?.bill_no ? ` #${bill.bill_no}` : ""}</>}
                    </DialogTitle>
                    <DialogDescription>
                        The full record behind this row, read from the same source the rest of the dashboard shows.
                    </DialogDescription>
                </DialogHeader>

                {loading && (
                    <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Opening…
                    </div>
                )}

                {!loading && failed && (
                    <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                        <div>
                            <p className="font-medium">This record could not be opened.</p>
                            <p className="mt-1 text-muted-foreground">
                                It may have been removed, or it belongs to an outlet outside your current scope.
                                The figure on the report row is unaffected — it was counted when the report was built.
                            </p>
                        </div>
                    </div>
                )}

                {!loading && bill && (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <Field label="Table" value={bill.table_name ?? "—"} />
                            <Field label="Covers" value={bill.covers ?? "—"} />
                            <Field label="Settled" value={when(bill.settled_at ?? bill.closed_at)} />
                            <Field label="Payment" value={bill.payment_method ?? "—"} />
                            <Field label="Waiter / closed by" value={bill.closed_by ?? "—"} />
                            <Field label="Customer" value={bill.customer ?? "—"} />
                            {"customer_gstin" in bill ? <Field label="Customer GSTIN" value={bill.customer_gstin?.trim() ? bill.customer_gstin.trim() : "—"} /> : null}
                            <Field label="Seated" value={when(bill.seated_at)} />
                            <Field label="Opened" value={when(bill.created_at)} />
                        </div>

                        {/* The backend flags a bill whose reconstructed lines do not add
                            up to its stored total. Saying so is the point of the flag —
                            a silent mismatch on a fraud-control drill-down is the exact
                            thing the reader is looking for. */}
                        {bill.totals_reconciled === false && (
                            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                                <span>
                                    The line items below do not add up to this bill&apos;s stored total — an item was
                                    most likely edited after settlement. The stored grand total is the figure the
                                    report counted.
                                </span>
                            </div>
                        )}

                        <Separator />

                        <div>
                            <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                                Items ({bill.items.length})
                            </div>
                            <div className="rounded-md border">
                                {bill.items.map((item, i) => (
                                    <div key={`${item.name}-${String(i)}`} className="flex items-baseline justify-between gap-4 border-b px-3 py-1.5 text-sm last:border-b-0">
                                        <span className="min-w-0">
                                            <span className="text-muted-foreground">{item.quantity} ×</span> {item.name}
                                            {item.note ? <span className="ml-1 text-xs text-muted-foreground">({item.note})</span> : null}
                                        </span>
                                        <span className="shrink-0 font-mono tabular-nums">{money(item.line_total)}</span>
                                    </div>
                                ))}
                                {bill.items.length === 0 && (
                                    <div className="px-3 py-4 text-center text-sm text-muted-foreground">No line items recorded.</div>
                                )}
                            </div>
                        </div>

                        {/* The ladder, in the same order and with the same names the
                            reports use. Two screens naming the same figure two
                            different things is how an owner stops trusting both —
                            which is why the top rung is "Item total", not "gross":
                            Gross is the bill's grand total, at the bottom. */}
                        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                            <Line label={ITEM_TOTAL} value={money(bill.items_subtotal)} />
                            {bill.discount_amount ? (
                                <Line
                                    label={`Discount${bill.discount_type === "percent" ? ` (${String(bill.discount_value)}%)` : ""}${bill.coupon_code ? ` · ${bill.coupon_code}` : ""}`}
                                    value={`− ${money(bill.discount_amount)}`}
                                />
                            ) : null}
                            <Line label="Net" value={money(bill.taxable_base)} />
                            {bill.service_charge ? (
                                <Line label={`Service charge${bill.service_charge_percent ? ` (${String(bill.service_charge_percent)}%)` : ""}`} value={money(bill.service_charge)} />
                            ) : null}
                            {bill.taxes.map((tax) => (
                                <Line key={tax.name} label={`${tax.name} (${String(tax.percentage)}%)`} value={money(tax.amount)} />
                            ))}
                            {/* The ladder's round_off rung (backend migration 048), as
                                recorded at settle — the same name the Sales Summary
                                gives its column. Only when the bill carries one. */}
                            {roundOffOf(bill) !== null ? (
                                <Line label="Round off" value={formatRoundOff(roundOffOf(bill)!, money)} />
                            ) : null}
                            <Separator className="my-1.5" />
                            <Line label="Grand total" value={money(bill.grand_total)} strong />
                            {bill.refunded && (
                                <div className="mt-2 rounded border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs">
                                    <div className="flex items-baseline justify-between gap-4 font-medium text-destructive">
                                        <span>Refunded</span>
                                        <span className="font-mono tabular-nums">{money(bill.refund_amount)}</span>
                                    </div>
                                    <div className="mt-0.5 text-muted-foreground">
                                        {when(bill.refunded_at)}{bill.refunded_by ? ` · ${bill.refunded_by}` : ""}
                                        {bill.refund_reason ? ` · ${bill.refund_reason}` : ""}
                                    </div>
                                </div>
                            )}
                        </div>

                        {bill.reason ? (
                            <div className="text-xs text-muted-foreground">Reason on file: {bill.reason}</div>
                        ) : null}

                        <Button asChild variant="outline" size="sm">
                            <a href={`/dashboard/history?from=${bill.settled_at?.slice(0, 10) ?? ""}&to=${bill.settled_at?.slice(0, 10) ?? ""}`}>
                                <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open the day in History
                            </a>
                        </Button>
                    </div>
                )}

                {!loading && kot && (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <Field label="Table" value={kot.table_name ?? "—"} />
                            <Field label="Type" value={kot.order_type} />
                            <Field label="Placed" value={when(kot.created_at)} />
                            <Field label="Taken by" value={kot.taken_by ?? "—"} />
                            <Field label="Customer" value={kot.customer ?? "—"} />
                            <Field label="Bill" value={kot.bill_no ? `#${kot.bill_no}` : "—"} />
                            <Field label="Last change" value={when(kot.updated_at)} />
                            <Field label="Order id" value={<span className="font-mono text-xs">{kot.id}</span>} />
                        </div>

                        <Separator />

                        <div>
                            <div className="mb-1.5 flex items-baseline justify-between">
                                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                    Items ({kot.item_count}) · {kot.qty} qty
                                </span>
                                <span className="font-mono text-sm tabular-nums">{money(kot.value)}</span>
                            </div>
                            <div className="rounded-md border">
                                {kot.items.map((item, i) => (
                                    <div key={`${item.name}-${String(i)}`} className="flex items-baseline justify-between gap-4 border-b px-3 py-1.5 text-sm last:border-b-0">
                                        <span className="min-w-0">
                                            <span className="text-muted-foreground">{item.quantity} ×</span> {item.name}
                                            {item.station ? <Badge variant="secondary" className="ml-1.5 text-[10px]">{item.station}</Badge> : null}
                                            {item.note ? <span className="ml-1 text-xs text-muted-foreground">({item.note})</span> : null}
                                        </span>
                                        <span className="shrink-0 font-mono tabular-nums">{money(item.line_total)}</span>
                                    </div>
                                ))}
                                {kot.items.length === 0 && (
                                    <div className="px-3 py-4 text-center text-sm text-muted-foreground">This ticket has no recorded lines.</div>
                                )}
                            </div>
                            {/* A void's VALUE is what was cancelled, and it is not sales.
                                Saying so on the drill-down stops it being read back as
                                money the restaurant lost or money it took. */}
                            <p className="mt-1.5 text-xs text-muted-foreground">
                                A cancelled ticket&apos;s value is what was voided — it is excluded from every revenue figure on every report.
                            </p>
                        </div>

                        <div>
                            <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">Audit trail</div>
                            <div className="rounded-md border">
                                {kot.trail.map((entry, i) => (
                                    <div key={`${entry.at}-${String(i)}`} className="border-b px-3 py-1.5 text-sm last:border-b-0">
                                        <div className="flex items-baseline justify-between gap-3">
                                            <span className="font-medium">{entry.action}</span>
                                            <span className="shrink-0 text-xs text-muted-foreground">{when(entry.at)}</span>
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {entry.by ? `by ${entry.by}` : "actor not recorded"}
                                            {entry.description ? ` · ${entry.description}` : ""}
                                        </div>
                                    </div>
                                ))}
                                {kot.trail.length === 0 && (
                                    <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                                        No audit entries were recorded against this ticket.
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
