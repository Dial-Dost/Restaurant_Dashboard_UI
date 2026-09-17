"use client"

// SETTLE AS NC — "Non-chargeable (NC)…" in the Confirm Payment menu.
//
// Client item 5: "NC has to come up as an option for payment mode when settling
// a bill." It sits where the payment modes sit, and it is NOT one of them: one
// POST to /bills/order/:orderId/settle-nc comps every remaining dish into the NC
// ledger and closes the bill at 0.00 as 'NC'. There is no approve or close step
// after it — nothing was taken, so there is nothing to approve.
//
// THE SAME FORM AS "Non-chargeable item…" (capture-actions.tsx): a kind from
// the ledger's vocabulary, a reason, and the second name. The reason stays
// REQUIRED here, whatever the service-charge waiver does with its own: giving a
// whole table away is a different act, and its reason is the NC Summary's row.
//
// THE ARITHMETIC IS THE SERVER'S. The figure on the form is the open bill's own
// chargeable subtotal, and it is sent back as `expected_value`: a bill that
// changed while the manager was deciding is refused, not given away at a size
// nobody saw. The words are lib/nc-settle.ts's, which the app's settle sheet
// shares.

import { useCallback, useEffect, useState } from "react"
import { Gift, Info, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useCurrency } from "@/hooks/use-currency"
import { useToast } from "@/hooks/use-toast"
import { getBillForTable, getBillTenderState, settleBillAsNonChargeable } from "@/lib/db"
import { NON_CHARGEABLE_KINDS, formatAmount } from "@/lib/mis-capture"
import {
    NC_SETTLE_BUTTON,
    NC_SETTLE_LABEL,
    NC_WHOLE_BILL_ONLY,
    ncQuote,
    ncSettleBlocker,
    ncSettleBody,
    ncSettleDoneSentence,
    ncSettleFormReady,
    ncSettleHeadline,
    ncSettleTrouble,
    type NcOpenBill,
    type NcQuote,
} from "@/lib/nc-settle"
import { cn } from "@/lib/utils"
import { AuthoriserField, KindPicker } from "./capture-actions"

export function NcSettleDialog({ restaurantId, order, onClose, onSettled }: {
    restaurantId: string
    order: { id: string; table: string }
    onClose: () => void
    /** The bill is closed — refresh the grid. */
    onSettled: () => void
}) {
    const { currencySymbol } = useCurrency()
    const { toast } = useToast()
    const money = useCallback((n: number) => formatAmount(n, currencySymbol), [currencySymbol])

    const [loading, setLoading] = useState(true)
    const [quote, setQuote] = useState<NcQuote | null>(null)
    const [blocker, setBlocker] = useState<string | null>(null)
    const [kind, setKind] = useState("")
    const [reason, setReason] = useState("")
    const [authorisedBy, setAuthorisedBy] = useState("")
    const [busy, setBusy] = useState(false)

    // The server's open bill and its tenders, read fresh each time the form
    // opens (and again after a refusal), never carried from the grid.
    const load = useCallback(async () => {
        setLoading(true)
        try {
            const [bill, tenders] = await Promise.all([
                getBillForTable(restaurantId, order.table).catch(() => null) as Promise<NcOpenBill | null>,
                getBillTenderState(restaurantId, { order_id: order.id }).catch(() => null),
            ])
            setQuote(ncQuote(bill))
            setBlocker(ncSettleBlocker(bill, tenders, money))
        } finally {
            setLoading(false)
        }
    }, [restaurantId, order.id, order.table, money])
    useEffect(() => { void load() }, [load])

    const ready = quote !== null && blocker === null && ncSettleFormReady({ kind, reason, authorisedBy })

    const submit = async (): Promise<void> => {
        if (!ready || !quote) {return}
        setBusy(true)
        try {
            const answer = await settleBillAsNonChargeable(restaurantId, order.id, ncSettleBody({
                kind, reason, authorisedBy, expectedValue: quote.value,
            }))
            if (answer.ok) {
                toast({ title: "Settled as NC", description: ncSettleDoneSentence(answer.result, money) })
                onSettled()
                onClose()
                return
            }
            // The server's own sentence, verbatim (a moved quote, a payment already
            // taken, an authoriser who may not approve this) — RETURNED by the
            // action, because a thrown one is redacted in production. The bill is
            // read again so the form shows what the refusal was about; an outcome
            // nobody knows refreshes the grid too, since the bill may have closed.
            const trouble = ncSettleTrouble(answer)
            toast({ title: trouble.title, description: trouble.message, variant: "destructive" })
            if (!answer.refused) { onSettled() }
            void load()
        } catch {
            // The action itself did not answer (the dashboard's own server was
            // unreachable): nothing is known about the bill.
            const trouble = ncSettleTrouble({ refused: false, message: "" })
            toast({ title: trouble.title, description: trouble.message, variant: "destructive" })
            onSettled()
            void load()
        } finally {
            setBusy(false)
        }
    }

    const givenAway = quote ? quote.value + quote.alreadyComped : 0

    return (
        <Dialog open onOpenChange={(v) => { if (!v && !busy) {onClose()} }}>
            <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{NC_SETTLE_LABEL} · Table {order.table}</DialogTitle>
                    <DialogDescription>
                        Close this bill without taking money. Every dish still on it is recorded as given away,
                        with the reason and the name below, and the bill is settled at 0.00.
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Reading the bill…
                    </p>
                ) : blocker !== null || quote === null ? (
                    <>
                        <Note tone="warn">{blocker ?? "The bill could not be read. Nothing was changed."}</Note>
                        <DialogFooter>
                            <Button variant="ghost" onClick={onClose}>Close</Button>
                        </DialogFooter>
                    </>
                ) : (
                    <div className="space-y-3">
                        <div data-testid="nc-settle-headline" className="rounded-md border border-amber-500/40 bg-amber-500/[0.05] px-3 py-2">
                            <div className="text-sm font-semibold tracking-wide">{ncSettleHeadline(givenAway, money)}</div>
                            <div className="text-[11px] leading-snug text-muted-foreground">
                                Before tax, at the prices on the bill{quote.alreadyComped > 0 ? `, including ${money(quote.alreadyComped)} already comped dish by dish` : ""}.
                                {quote.wouldHaveCharged > 0 ? ` The guest would have paid ${money(quote.wouldHaveCharged)} with service charge and tax — information only; it is in no report.` : ""}
                            </div>
                        </div>
                        <Note>{NC_WHOLE_BILL_ONLY}</Note>

                        <KindPicker label="Why is it going free?" options={NON_CHARGEABLE_KINDS} value={kind} onChange={setKind} />
                        <div className="space-y-1.5">
                            <Label htmlFor="nc-settle-reason">Reason</Label>
                            <Textarea
                                id="nc-settle-reason"
                                value={reason}
                                onChange={(e) => { setReason(e.target.value) }}
                                placeholder="e.g. Owner's guests — table on the house"
                                rows={2}
                                maxLength={400}
                            />
                        </div>
                        <AuthoriserField value={authorisedBy} onChange={setAuthorisedBy} act="giving this bill away" />

                        <DialogFooter>
                            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
                            <Button onClick={() => void submit()} disabled={busy || !ready}>
                                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Gift className="mr-2 h-4 w-4" />}
                                {NC_SETTLE_BUTTON}
                            </Button>
                        </DialogFooter>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}

function Note({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" }) {
    return (
        <div className={cn(
            "flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-snug",
            tone === "warn"
                ? "border-amber-500/40 bg-amber-500/[0.05]"
                : "border-border bg-muted/40 text-muted-foreground",
        )}>
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>{children}</div>
        </div>
    )
}
