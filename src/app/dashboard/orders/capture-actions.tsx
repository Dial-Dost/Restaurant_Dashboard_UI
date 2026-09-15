"use client"

// THE FIVE CONTROL ACTS, ON THE FLOOR.
//
// Migrations 034-039 gave the backend somewhere to record a comp, a void reason,
// a service-charge waiver, a split tender with a tip and the till a bill was
// rung on. Until this file existed there was no way to reach any of them from a
// screen, which meant the six control reports built on top of them could only
// ever be empty. This is the door.
//
// SELF-CONTAINED ON PURPOSE. It takes a table, an order and a refresh callback
// and owns everything else — the same shape `bill-actions.tsx` uses — so it can
// be dropped into the orders grid without touching that page's state. The orders
// page is 4,000 lines; threading five dialogs' worth of state through it is how
// a live floor screen acquires a regression.
//
// ===========================================================================
// THE THREE RULES THIS FILE EXISTS TO OBEY
// ===========================================================================
//
// 1. NO CONTROL THAT 403s ON TAP. The three control acts are manager-only by
//    default (each has its own grantable Action; a restaurant that lets a floor
//    manager comp a dessert does not necessarily let them waive 10% off a
//    ₹40,000 bill). A waiter without one sees the item DISABLED and is told
//    which permission it needs — never a button that fails after the tap, in
//    front of a guest, with no explanation.
//
// 2. THE ARITHMETIC IS THE SERVER'S. Every money figure shown after an act is
//    the one the server sent back: the comp's `value` is computed by Postgres,
//    the waiver's reduction is measured by running the real charge computation
//    twice and differencing the totals before round-off (it differs between the
//    two tax shapes this fleet runs — GST rides on the charge in one and not the
//    other), and the
//    outstanding on a part-paid bill is the server's `outstanding`. The only
//    number this file computes is what the tender FORM currently adds up to,
//    and that is labelled as a fact about the form.
//
// 3. THE ACTOR IS NEVER IN A FORM. Who comped, who voided, who waived, who took
//    the payment — all taken from the verified session server-side. What IS
//    asked for is the SECOND name: `authorised_by`, resolved against the staff
//    list and checked for the same permission that gates the route. A staff
//    member comping their own friend's table is the commonest till fraud there
//    is, and a second name against every giveaway is the only defence that
//    survives a busy Saturday.

import { useCallback, useEffect, useMemo, useState } from "react"
import {
    AlertTriangle,
    Ban,
    Check,
    Gift,
    Info,
    Loader2,
    Lock,
    Monitor,
    Plus,
    Printer,
    Receipt,
    RotateCcw,
    ShieldCheck,
    Trash2,
    Wallet,
    X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/context/AuthContext"
import { useCurrency } from "@/hooks/use-currency"
import { useToast } from "@/hooks/use-toast"
import {
    getBillForTable,
    getBillTenderState,
    getBillingCounters,
    getOrderNonChargeables,
    markOrderItemNonChargeable,
    recordBillTenders,
    removeServiceChargeAndPrint,
    reverseNonChargeable,
    reverseServiceChargeWaiver,
    setBillCounter,
    voidBillTender,
    cancelOrderWithReason,
    voidOrderWithReason,
} from "@/lib/db"
import { usePaymentMethods } from "@/hooks/use-payment-methods"
import { paymentMethodLabel, tenderPaymentOptions } from "@/lib/payment-methods"
import {
    MAX_BILL_TENDERS,
    NON_CHARGEABLE_KINDS,
    PERM_RECORD_PAYMENT,
    SERVICE_CHARGE_WAIVER_KINDS,
    TIP_MODES,
    VOID_KINDS,
    VOID_STAGE_LABELS,
    billCarriesServiceCharge,
    canPartiallyComp,
    compPreviewValue,
    draftTenderTotal,
    draftTipTotal,
    emptyTenderDraft,
    formatAmount,
    hasPermission,
    humaniseToken,
    isUnsplittableMethod,
    parseMoney,
    remainderForRow,
    serviceChargeOnBill,
    serviceChargeRemovalSentence,
    tenderFormRefusal,
    tendersForWire,
    type BillTenderState,
    type BillingCounterRecord,
    type CompCandidate,
    type NonChargeableRecord,
    type OrderVoidRecord,
    type ServiceChargeWaiverRecord,
    type TenderDraft,
    type VocabularyOption,
} from "@/lib/mis-capture"
import { cancelKotRoute } from "@/lib/orders-grid"
import { can } from "@/lib/session-scope"
import { cn } from "@/lib/utils"

/** The order this panel acts on, in the only shape it needs. */
export interface CaptureOrder {
    id: string
    table: string
    status: string
    items: CompCandidate[]
}

type Which = null | "comp" | "void" | "waiver" | "tenders" | "counter"

/**
 * What "Remove service charge & print" hands the page's print flow: the tab it
 * opened inside its own click (a popup blocker would kill one opened later), and
 * the bill the server has ALREADY claimed the print of — so the page renders it
 * without claiming a second time.
 */
export interface PrintBillHandoff {
    printWindow: Window | null
    printableBill: Record<string, unknown> | null
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

/**
 * A vocabulary picker.
 *
 * A SELECT, NEVER A FREE-TEXT BOX. Each of these mirrors a CHECK constraint;
 * anything not on the list comes back as a 400 in front of a guest, and a reason
 * absorbed into the wrong bucket is a fabricated entry in a fraud-control
 * document. The hint under it is what stops "Complimentary" and "Promotion"
 * being picked at random.
 */
function KindPicker({ label, options, value, onChange, disabled }: {
    label: string
    options: readonly VocabularyOption[]
    value: string
    onChange: (v: string) => void
    disabled?: boolean
}) {
    const hint = options.find((o) => o.value === value)?.hint
    return (
        <div className="space-y-1.5">
            <Label>{label}</Label>
            <Select value={value} onValueChange={onChange} disabled={disabled}>
                <SelectTrigger><SelectValue placeholder="Choose one…" /></SelectTrigger>
                <SelectContent>
                    {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
            </Select>
            <p className="min-h-[1rem] text-xs text-muted-foreground">{hint ?? " "}</p>
        </div>
    )
}

/**
 * The second name.
 *
 * NOT A DEFAULT OF THE ACTING USER, ever — the backend's CaptureActor contract
 * is explicit that the route must not do that, because it would make the one
 * field that matters the one field that is always a copy of its neighbour. A
 * manager acting alone types their own username and the row then honestly says
 * so.
 */
function AuthoriserField({ value, onChange, act }: {
    value: string
    onChange: (v: string) => void
    act: string
}) {
    return (
        <div className="space-y-1.5">
            <Label htmlFor="authorised-by">Authorised by</Label>
            <Input
                id="authorised-by"
                value={value}
                onChange={(e) => { onChange(e.target.value) }}
                placeholder="Manager's username"
                autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
                The username of whoever approved {act}. It is checked against your staff list and against
                the same permission this action needs — if you approved it yourself, type your own username
                and the record will say so.
            </p>
        </div>
    )
}

/** A reason box. Required everywhere; the server refuses an empty one. */
function ReasonField({ value, onChange, placeholder }: {
    value: string
    onChange: (v: string) => void
    placeholder: string
}) {
    return (
        <div className="space-y-1.5">
            <Label htmlFor="capture-reason">Reason</Label>
            <Textarea
                id="capture-reason"
                value={value}
                onChange={(e) => { onChange(e.target.value) }}
                placeholder={placeholder}
                rows={2}
                maxLength={300}
            />
        </div>
    )
}

/** A figure the SERVER sent, rendered so it cannot be mistaken for a form value. */
function ServerFigure({ label, value, tone, hint }: {
    label: string
    value: string
    tone?: "default" | "warn" | "good"
    hint?: string
}) {
    return (
        <div className={cn(
            "rounded-md border px-3 py-2",
            tone === "warn" && "border-amber-500/40 bg-amber-500/[0.05]",
            tone === "good" && "border-emerald-500/40 bg-emerald-500/[0.05]",
        )}>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="font-mono text-lg tabular-nums">{value}</div>
            {hint ? <div className="text-[11px] leading-snug text-muted-foreground">{hint}</div> : null}
        </div>
    )
}

function Note({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" }) {
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

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

export function CaptureActions({ restaurantId, order, onChanged, printBill }: {
    restaurantId: string
    order: CaptureOrder
    onChanged: () => void
    /** The page's own print flow (triggerPrint), given the handed-over tab and claimed bill. */
    printBill?: (handoff: PrintBillHandoff) => Promise<void>
}) {
    const { user } = useAuth()
    const { currencySymbol } = useCurrency()
    const { toast } = useToast()
    const [dialog, setDialog] = useState<Which>(null)
    const [busy, setBusy] = useState(false)

    /*
      THE SERVER'S ANSWER FOR THE THREE CONTROL ACTS, NOT A LOCAL UUID TEST.

      Comp, void and waive each now have a flag in the session's `scope` block
      (the backend's `sessionCapabilities`), for the reason that block exists:
      the uuid that backs a control must be written down ONCE, beside the guard
      on the route, or Dart and TypeScript drift from it independently. `can()`
      reads the flag and only falls back to the action list for a session too old
      to carry one.

      Record Payment has no flag yet, so it still reads the SERVER's resolved
      action list directly — the same list, one hop less direct. It should move
      into the block when the backend publishes an answer for it.
    */
    const actions = user?.actions_set
    const canComp = can(user, "comp_item")
    const canVoid = can(user, "void_order")
    const canWaive = can(user, "waive_service_charge")
    const canTender = hasPermission(actions, PERM_RECORD_PAYMENT)
    const anyLocked = !canComp || !canVoid || !canWaive || !canTender

    const money = useCallback((v: unknown) => formatAmount(v, currencySymbol), [currencySymbol])
    const fail = useCallback((e: unknown) => {
        // The server's own sentence, verbatim. These are written to be read by the
        // person at the till ("That item is already non-chargeable. Reverse it
        // first if the reason was wrong.") and rewriting them here would replace
        // an actionable refusal with a generic one.
        toast({ title: "Not recorded", description: String((e as Error)?.message ?? e), variant: "destructive" })
    }, [toast])

    const close = useCallback(() => { setDialog(null) }, [])

    /**
     * One menu item, which NAMES THE PERMISSION IT WANTS when it is locked.
     *
     * Not "manager only" — that would be a guess. Two of these five ride on
     * Record Payment, which a cashier holds and a manager might not, and telling
     * a cashier that taking a payment is "manager only" sends them to find
     * somebody who cannot help. The item says which grant is missing, so the
     * person reading it can ask their admin for the right thing.
     */
    const item = (
        key: Exclude<Which, null>,
        icon: React.ReactNode,
        label: string,
        allowed: boolean,
        needs: string,
    ) => (
        <DropdownMenuItem
            key={key}
            disabled={!allowed}
            onClick={() => { if (allowed) {setDialog(key)} }}
            className={cn("gap-2", !allowed && "flex-col items-start gap-0.5")}
        >
            <span className="flex w-full items-center gap-2">
                {icon}
                <span>{label}</span>
                {allowed ? null : <Lock className="ml-auto h-3 w-3 shrink-0" />}
            </span>
            {allowed ? null : (
                <span className="pl-6 text-[10px] leading-snug text-muted-foreground">
                    Needs the &ldquo;{needs}&rdquo; permission
                </span>
            )}
        </DropdownMenuItem>
    )

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 gap-1 px-2" title="Comps, voids, waivers, payments and tills">
                        <ShieldCheck className="h-3.5 w-3.5" /> Controls
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                        Recorded acts — every one names a reason and an authoriser.
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {item("comp", <Gift className="h-4 w-4" />, "Non-chargeable item…", canComp, "Mark Items Non-Chargeable")}
                    {item("void", <Ban className="h-4 w-4" />, "Void this order…", canVoid, "Void Orders With Reason")}
                    {item("waiver", <Receipt className="h-4 w-4" />, "Remove service charge & print…", canWaive, "Waive Service Charge")}
                    <DropdownMenuSeparator />
                    {item("tenders", <Wallet className="h-4 w-4" />, "Payments & tip…", canTender, "Record Payment")}
                    {item("counter", <Monitor className="h-4 w-4" />, "Billing counter…", canTender, "Record Payment")}
                    {anyLocked ? (
                        <>
                            <DropdownMenuSeparator />
                            {/* Said out loud rather than left as a grey row nobody can
                                explain. A control that is simply inert teaches the user
                                that the buttons on this screen do not work. */}
                            <div className="px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
                                Each greyed action names the permission it needs. The first three reduce what a
                                guest pays, so each is a separate grant held by managers rather than by everyone
                                who can take an order. Ask your admin to grant the one you need.
                            </div>
                        </>
                    ) : null}
                </DropdownMenuContent>
            </DropdownMenu>

            {dialog === "comp" && canComp ? (
                <CompDialog
                    restaurantId={restaurantId} order={order} money={money}
                    busy={busy} setBusy={setBusy} onClose={close} onChanged={onChanged}
                    toast={toast} fail={fail}
                />
            ) : null}

            {dialog === "void" && canVoid ? (
                <VoidDialog
                    restaurantId={restaurantId} order={order} money={money}
                    busy={busy} setBusy={setBusy} onClose={close} onChanged={onChanged} fail={fail}
                />
            ) : null}

            {dialog === "waiver" && canWaive ? (
                <WaiverDialog
                    restaurantId={restaurantId} tableName={order.table} money={money}
                    busy={busy} setBusy={setBusy} onClose={close} onChanged={onChanged} fail={fail}
                    toast={toast} printBill={printBill}
                />
            ) : null}

            {dialog === "tenders" && canTender ? (
                <TenderDialog
                    restaurantId={restaurantId} order={order} money={money}
                    busy={busy} setBusy={setBusy} onClose={close} onChanged={onChanged}
                    toast={toast} fail={fail}
                />
            ) : null}

            {dialog === "counter" && canTender ? (
                <CounterDialog
                    restaurantId={restaurantId} order={order}
                    busy={busy} setBusy={setBusy} onClose={close} onChanged={onChanged}
                    toast={toast} fail={fail}
                />
            ) : null}
        </>
    )
}

type Toast = ReturnType<typeof useToast>["toast"]

interface DialogShell {
    restaurantId: string
    busy: boolean
    setBusy: (v: boolean) => void
    onClose: () => void
    onChanged: () => void
    fail: (e: unknown) => void
}

// ---------------------------------------------------------------------------
// 034 — NON-CHARGEABLE
// ---------------------------------------------------------------------------

function CompDialog({
    restaurantId, order, money, busy, setBusy, onClose, onChanged, toast, fail,
}: DialogShell & {
    order: CaptureOrder
    money: (v: unknown) => string
    toast: Toast
}) {
    const [ledger, setLedger] = useState<NonChargeableRecord[]>([])
    // "Not read yet" and "read, and this comp is not in it" are different, and
    // rendering the second as a permanent "Loading…" is how a screen lies about
    // an outage. The control data (reason, authoriser, the id needed to reverse)
    // is the whole reason this ledger is read, so its absence has to be said.
    const [ledgerLoaded, setLedgerLoaded] = useState(false)
    const [selected, setSelected] = useState<string | null>(null)
    const [kind, setKind] = useState("")
    const [reason, setReason] = useState("")
    const [authorisedBy, setAuthorisedBy] = useState("")
    const [qty, setQty] = useState("")
    const [result, setResult] = useState<{ value: number; subtotal: number; tableSubtotal: number } | null>(null)

    const refreshLedger = useCallback(() => {
        void getOrderNonChargeables(restaurantId, order.id)
            .then(setLedger)
            .finally(() => { setLedgerLoaded(true) })
    }, [restaurantId, order.id])
    useEffect(() => { refreshLedger() }, [refreshLedger])

    // Lines still chargeable, and lines already comped, told apart by the
    // SERVER's flag on the line — never by matching names against the ledger.
    const chargeable = order.items.filter((i) => !i.nc)
    const comped = order.items.filter((i) => i.nc)
    const line = chargeable.find((i) => i.id === selected) ?? null
    const wanted = parseMoney(qty)
    const preview = line ? compPreviewValue(line, wanted) : 0

    const ledgerFor = (ncId: string | null): NonChargeableRecord | null =>
        ncId ? ledger.find((r) => r.id === ncId) ?? null : null

    const submit = async (): Promise<void> => {
        if (!line || !kind || !reason.trim() || !authorisedBy.trim()) {return}
        setBusy(true)
        try {
            const r = await markOrderItemNonChargeable(restaurantId, order.id, line.id, {
                nc_kind: kind,
                reason: reason.trim(),
                authorised_by: authorisedBy.trim(),
                // Omitted = the WHOLE line. The data layer splits the line for a
                // partial comp and leaves the ORIGINAL id on the chargeable
                // remainder, because prep timers key on that id.
                ...(wanted !== null && wanted > 0 && wanted < line.quantity ? { quantity: wanted } : {}),
            })
            setResult({
                value: r.non_chargeable.value,
                subtotal: r.order_subtotal,
                tableSubtotal: r.table_subtotal,
            })
            setSelected(null); setKind(""); setReason(""); setQty("")
            refreshLedger()
            onChanged()
        } catch (e) { fail(e) } finally { setBusy(false) }
    }

    const reverse = async (rec: NonChargeableRecord): Promise<void> => {
        const why = window.prompt(
            `Put "${rec.item_name}" back on the bill?\n\nThe comp is not deleted — it stays in the record, marked reversed, so the NC report still shows it. Say why:`,
            "",
        )
        if (why === null || why.trim().length === 0) {return}
        setBusy(true)
        try {
            await reverseNonChargeable(restaurantId, rec.id, why.trim())
            toast({
                title: "Back on the bill",
                description: `${rec.item_name} is chargeable again. The original comp stays in the record, marked reversed.`,
            })
            refreshLedger()
            onChanged()
        } catch (e) { fail(e) } finally { setBusy(false) }
    }

    return (
        <Dialog open onOpenChange={(v) => { if (!v && !busy) {onClose()} }}>
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Non-chargeable · Table {order.table}</DialogTitle>
                    <DialogDescription>
                        Take a dish off what the guest pays. It stays on the ticket and stays in the sales
                        record as revenue given away — both facts, because they are both true.
                    </DialogDescription>
                </DialogHeader>

                {result ? (
                    <div className="space-y-3">
                        <div className="grid grid-cols-3 gap-2">
                            <ServerFigure label="Given away" value={money(result.value)} tone="warn" hint="Recorded as a loss" />
                            <ServerFigure label="This order now" value={money(result.subtotal)} hint="Chargeable subtotal" />
                            <ServerFigure label="This table now" value={money(result.tableSubtotal)} hint="Chargeable subtotal" />
                        </div>
                        <Note>
                            Every figure above is the server&apos;s, recomputed inside the same transaction that
                            recorded the comp — not a subtraction done in this browser.
                        </Note>
                        <Button variant="outline" onClick={() => { setResult(null) }}>Comp another item</Button>
                    </div>
                ) : null}

                {comped.length > 0 ? (
                    <div className="space-y-1.5">
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">Already non-chargeable</Label>
                        {comped.map((c) => {
                            const rec = ledgerFor(c.nc_id)
                            return (
                                <div key={c.id} className="flex items-start justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/[0.04] px-3 py-2">
                                    <div className="min-w-0">
                                        <div className="text-sm font-medium">
                                            {c.quantity}× {c.name}
                                            <Badge variant="outline" className="ml-2 border-amber-500/50 text-[10px] uppercase">
                                                {humaniseToken(c.nc_kind, NON_CHARGEABLE_KINDS)}
                                            </Badge>
                                        </div>
                                        {rec ? (
                                            <p className="text-xs text-muted-foreground">
                                                {money(rec.value)} · {rec.reason} · authorised by {rec.authorised_by_username}, marked by {rec.marked_by_username}
                                            </p>
                                        ) : ledgerLoaded ? (
                                            <p className="text-xs text-muted-foreground">
                                                The reason and the authoriser could not be read, so this comp cannot be
                                                reversed from here. It is still recorded — reload and try again.
                                            </p>
                                        ) : (
                                            <p className="text-xs text-muted-foreground">Loading the reason and the authoriser…</p>
                                        )}
                                    </div>
                                    {rec ? (
                                        <Button variant="ghost" size="sm" className="shrink-0 gap-1" disabled={busy} onClick={() => void reverse(rec)}>
                                            <RotateCcw className="h-3.5 w-3.5" /> Put back
                                        </Button>
                                    ) : null}
                                </div>
                            )
                        })}
                    </div>
                ) : null}

                {chargeable.length === 0 ? (
                    <Note tone="warn">Every line on this order is already non-chargeable.</Note>
                ) : (
                    <>
                        <div className="space-y-1.5">
                            <Label>Which line</Label>
                            <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-1">
                                {chargeable.map((i) => (
                                    <button
                                        key={i.id}
                                        type="button"
                                        onClick={() => { setSelected(i.id); setQty("") }}
                                        className={cn(
                                            "flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm",
                                            selected === i.id ? "bg-primary/10 ring-1 ring-primary" : "hover:bg-muted",
                                        )}
                                    >
                                        <span>{i.quantity}× {i.name}</span>
                                        <span className="font-mono tabular-nums text-muted-foreground">
                                            {money(i.price * i.quantity)}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {line && canPartiallyComp(line) ? (
                            <div className="space-y-1.5">
                                <Label htmlFor="comp-qty">How many of the {line.quantity}</Label>
                                <Input
                                    id="comp-qty" type="number" min={1} max={line.quantity}
                                    value={qty} onChange={(e) => { setQty(e.target.value) }}
                                    placeholder={`Leave blank for all ${String(line.quantity)}`}
                                />
                                <p className="text-xs text-muted-foreground">
                                    Comping part of a line splits it. The chargeable remainder keeps the original
                                    line id, so the kitchen&apos;s prep timers are not disturbed.
                                </p>
                            </div>
                        ) : null}

                        <KindPicker label="Why is it going free?" options={NON_CHARGEABLE_KINDS} value={kind} onChange={setKind} />
                        <ReasonField value={reason} onChange={setReason} placeholder="e.g. Sent back — the paneer was cold" />
                        <AuthoriserField value={authorisedBy} onChange={setAuthorisedBy} act="this giveaway" />

                        {line ? (
                            <Note tone="warn">
                                This gives away <b>{money(preview)}</b>{" "}— {wanted !== null && wanted > 0 && wanted < line.quantity
                                    ? `${String(wanted)} of ${String(line.quantity)}`
                                    : `all ${String(line.quantity)}`} × {line.name} at {money(line.price)}.
                                The exact figure recorded is the server&apos;s, computed from the line as stored.
                            </Note>
                        ) : null}

                        <DialogFooter>
                            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
                            <Button
                                onClick={() => void submit()}
                                disabled={busy || !line || !kind || reason.trim().length === 0 || authorisedBy.trim().length === 0}
                            >
                                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Gift className="mr-2 h-4 w-4" />}
                                Make non-chargeable
                            </Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    )
}

// ---------------------------------------------------------------------------
// 035 — VOID WITH REASON
// ---------------------------------------------------------------------------

function VoidDialog({
    restaurantId, order, money, busy, setBusy, onClose, onChanged, fail, kotLabel,
}: DialogShell & {
    order: CaptureOrder
    money: (v: unknown) => string
    /**
     * 1.3 — set when this dialog was opened as "Cancel KOT" from a KOT block or
     * a kitchen ticket. It changes the WORDS and nothing else: the same kind,
     * reason and authoriser are demanded (1.2) and the same route prints the
     * CANCELLED slip (1.1). "" when the server sent no KOT number.
     */
    kotLabel?: string
}) {
    const [kind, setKind] = useState("")
    const [reason, setReason] = useState("")
    const [authorisedBy, setAuthorisedBy] = useState("")
    const [done, setDone] = useState<OrderVoidRecord | null>(null)

    const submit = async (): Promise<void> => {
        setBusy(true)
        try {
            const r = await voidOrderWithReason(restaurantId, order.id, {
                void_kind: kind,
                reason: reason.trim(),
                authorised_by: authorisedBy.trim(),
            })
            setDone(r.void)
            onChanged()
        } catch (e) { fail(e) } finally { setBusy(false) }
    }

    const stage = done ? VOID_STAGE_LABELS[done.stage] : null

    return (
        <Dialog open onOpenChange={(v) => { if (!v && !busy) {onClose()} }}>
            <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>
                        {kotLabel === undefined
                            ? <>Void order · Table {order.table}</>
                            : <>Cancel {kotLabel || "KOT"} · Table {order.table}</>}
                    </DialogTitle>
                    <DialogDescription>
                        Cancel this ticket and record why, in one step. The reason is what turns a cancelled
                        order from a number into something an owner can act on.
                    </DialogDescription>
                </DialogHeader>

                {done ? (
                    <div className="space-y-3">
                        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/[0.05] px-3 py-2 text-sm">
                            <Check className="mr-1.5 inline h-4 w-4 text-emerald-600" />
                            Voided — {money(done.value_voided)} came off, recorded as {humaniseToken(done.void_kind, VOID_KINDS)}.
                        </div>
                        {/* THE STAGE, SHOWN AND NEVER ASKED. */}
                        <div className="rounded-md border px-3 py-2">
                            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                Stage — decided by the server
                            </div>
                            <div className="text-base font-semibold">{stage?.label ?? humaniseToken(done.stage)}</div>
                            <p className="mt-0.5 text-xs text-muted-foreground">{stage?.hint ?? ""}</p>
                            {Object.keys(done.stage_evidence).length > 0 ? (
                                <ul className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                                    {Object.entries(done.stage_evidence).map(([k, v]) => (
                                        <li key={k}><span className="font-mono">{k}</span>: {String(v)}</li>
                                    ))}
                                </ul>
                            ) : null}
                        </div>
                        <Note>
                            You were not asked which stage this was, and you never will be: it is worked out from
                            whether a bill existed, whether the order was barked and whether a KOT went to a
                            printer — facts this screen cannot see, and which the person voiding has an obvious
                            interest in.
                        </Note>
                        <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
                    </div>
                ) : (
                    <>
                        <Note tone="warn">
                            This cancels the whole ticket. A ticket already cancelled cannot have a reason
                            attached afterwards — the stage would then be worked out from the table&apos;s state
                            NOW about a void that happened THEN, which is a fabricated signal pointing at a
                            named employee.
                        </Note>
                        <KindPicker label="Why is it being voided?" options={VOID_KINDS} value={kind} onChange={setKind} />
                        <ReasonField value={reason} onChange={setReason} placeholder="e.g. Rang up on T4 instead of T14" />
                        <AuthoriserField value={authorisedBy} onChange={setAuthorisedBy} act="this void" />
                        <DialogFooter>
                            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
                            <Button
                                variant="destructive"
                                onClick={() => void submit()}
                                disabled={busy || !kind || reason.trim().length === 0 || authorisedBy.trim().length === 0}
                            >
                                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ban className="mr-2 h-4 w-4" />}
                                {kotLabel === undefined ? "Void this order" : `Cancel ${kotLabel || "KOT"}`}
                            </Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    )
}

/**
 * 1.2 — the reason prompt in front of the everyday cancel. The Cancel button
 * stays disabled until a reason is typed; closing the dialog cancels nothing.
 */
function CancelKotReasonDialog({
    restaurantId, order, kotLabel, busy, setBusy, onClose, onChanged, fail, toast,
}: DialogShell & { order: CaptureOrder; kotLabel: string; toast: Toast }): React.ReactElement {
    const [reason, setReason] = useState("")

    const submit = async (): Promise<void> => {
        const trimmed = reason.trim()
        if (!trimmed) {return}
        setBusy(true)
        try {
            const r = await cancelOrderWithReason(restaurantId, order.id, trimmed)
            // Say what reached the kitchen: the slip is the half of a cancel the
            // pass acts on, and "nothing printed" sends someone to tell them.
            toast({
                title: `${kotLabel} cancelled`,
                description: r.cancel_kot_printed === false
                    ? `Table ${order.table}. No cancellation slip printed — tell the kitchen.`
                    : `Table ${order.table}. A CANCELLED slip is going to the kitchen.`,
            })
            onChanged()
            onClose()
        } catch (e) { fail(e) } finally { setBusy(false) }
    }

    return (
        <Dialog open onOpenChange={(v) => { if (!v && !busy) {onClose()} }}>
            <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Cancel {kotLabel} · Table {order.table}</DialogTitle>
                    <DialogDescription>
                        The kitchen gets a CANCELLED slip for this ticket, and the reason is recorded against it.
                    </DialogDescription>
                </DialogHeader>
                <Note tone="warn">
                    This cancels the whole ticket — every line on {kotLabel}. Cancelled orders are final; only the Audit Log can reverse one.
                </Note>
                <ReasonField value={reason} onChange={setReason} placeholder="e.g. Guest left before it was served" />
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose} disabled={busy}>Keep the KOT</Button>
                    <Button
                        variant="destructive"
                        onClick={() => void submit()}
                        disabled={busy || reason.trim().length === 0}
                    >
                        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ban className="mr-2 h-4 w-4" />}
                        Cancel {kotLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

/*
  1.3 — CANCEL KOT, WHERE THE KOT IS.

  "Add a dedicated option to cancel a KOT for an order that has already been
  placed, and ensure this functionality is accessible directly within the KOT
  section."

  NOT A NEW PATH. A KOT on this system is an order's kitchen docket, and the
  server already has two ways to cancel an order, both of which print the
  CANCELLED slip carrying the KOT number and table (1.1):

    * a session that may VOID gets the recorded void — this file's VoidDialog,
      POST /orders/:id/void, which refuses to run without a controlled kind, a
      reason and an authoriser;
    * anybody else holding "Add Orders" (the stock waiter) gets the everyday
      cancel — PATCH /orders/:id/status — behind a reason prompt that will not
      submit empty (1.2), because that route records a reason but, for the sake
      of shipped tills, does not refuse a missing one.

  `cancelKotRoute` makes that choice, and it is the same two-route rule the owner
  app's table sheet uses, so a waiter is offered the same control on both. A
  session that can take neither route is shown nothing. DELETE /orders/:id is
  never used: it records no reason.

  ONLY ON A NUMBERED TICKET. With no KOT number there is no placed ticket to
  cancel from the KOT section (the trailing "No KOT number" block gathers several
  orders); those orders are still cancellable from the Orders grid.
*/
export function CancelKotButton({ restaurantId, order, kotLabel, onChanged, className }: {
    restaurantId: string
    order: CaptureOrder
    /** "KOT 5" / "KOTs 1, 2". An empty label draws nothing. */
    kotLabel: string
    onChanged: () => void
    className?: string
}): React.ReactElement | null {
    const { user } = useAuth()
    const { currencySymbol } = useCurrency()
    const { toast } = useToast()
    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    const money = useCallback((v: unknown) => formatAmount(v, currencySymbol), [currencySymbol])
    const fail = useCallback((e: unknown) => {
        toast({ title: "KOT not cancelled", description: e instanceof Error ? e.message : String(e), variant: "destructive" })
    }, [toast])
    const close = useCallback(() => { setOpen(false) }, [])

    const route = cancelKotRoute(user, order.status)
    if (route === null || kotLabel.trim() === "") {return null}

    return (
        <>
            <Button
                variant="outline"
                size="sm"
                className={cn("h-8 gap-1 border-destructive/50 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive", className)}
                title={`Cancel ${kotLabel} — asks for a reason and prints a CANCELLED slip for the kitchen`}
                onClick={(e) => { e.stopPropagation(); setOpen(true) }}
            >
                <Ban className="h-3.5 w-3.5" /> Cancel KOT
            </Button>
            {open && route === "void" ? (
                <VoidDialog
                    restaurantId={restaurantId} order={order} money={money} kotLabel={kotLabel}
                    busy={busy} setBusy={setBusy} onClose={close} onChanged={onChanged} fail={fail}
                />
            ) : null}
            {open && route === "status" ? (
                <CancelKotReasonDialog
                    restaurantId={restaurantId} order={order} kotLabel={kotLabel}
                    busy={busy} setBusy={setBusy} onClose={close} onChanged={onChanged} fail={fail}
                    toast={toast}
                />
            ) : null}
        </>
    )
}

// ---------------------------------------------------------------------------
// 036 — SERVICE CHARGE WAIVER: remove it and print, as one act
// ---------------------------------------------------------------------------

interface OpenBillShape {
    service_charge?: number
    service_charge_percent?: number
    /** The server's own "which shape carries the charge" — "none" = nothing to remove. */
    service_charge_basis?: string
    service_charge_waived?: boolean
    service_charge_waiver?: ServiceChargeWaiverRecord | null
    taxes?: { name?: string; amount?: number }[]
    grand_total?: number
}

/**
 * Take the print tab NOW, inside the click that asked for it.
 *
 * Every browser blocks a `window.open()` that is not in the same task as the
 * user's gesture, and the request below is an `await`. Opening the tab after it
 * would mean "Remove service charge & print" recorded the waiver and then
 * silently produced no paper on a default Chrome — the waiter would press it
 * again, and get a REPRINT. So the tab is opened here, left empty until the
 * server has answered, closed on a refusal, and handed to the page's print flow
 * (triggerPrint) on success. Same rule, same reason as triggerPrint's own open.
 */
const openPrintTab = (): Window | null => {
    const tab = typeof window !== "undefined" ? window.open("", "_blank") : null
    if (tab) {
        try {
            tab.document.title = "Preparing the bill…"
            const note = tab.document.createElement("p")
            note.textContent = "Preparing the bill…"
            tab.document.body.appendChild(note)
        } catch { /* the tab stays blank until it navigates, which is harmless */ }
    }
    return tab
}

function WaiverDialog({
    restaurantId, tableName, money, busy, setBusy, onClose, onChanged, fail, toast, printBill,
}: DialogShell & {
    tableName: string
    money: (v: unknown) => string
    toast: Toast
    printBill?: (handoff: PrintBillHandoff) => Promise<void>
}) {
    const [bill, setBill] = useState<OpenBillShape | null>(null)
    const [loading, setLoading] = useState(true)
    // "Guest asked" leads the list and is chosen already: nine of the first
    // eleven waivers recorded in production were exactly that. The Windows and
    // Android till preselect it too.
    const [kind, setKind] = useState("guest_request")
    const [reason, setReason] = useState("")
    const [authorisedBy, setAuthorisedBy] = useState("")

    const load = useCallback(() => {
        setLoading(true)
        void getBillForTable(restaurantId, tableName)
            .then((b) => { setBill((b ?? null) as OpenBillShape | null) })
            .finally(() => { setLoading(false) })
    }, [restaurantId, tableName])
    useEffect(() => { load() }, [load])

    const live = bill?.service_charge_waiver && !bill.service_charge_waiver.reversed_at
        ? bill.service_charge_waiver
        : null

    /*
      ONE REQUEST FOR BOTH HALVES. POST /bills/service-charge-waiver/print
      answers every refusal before it writes anything, records the waiver the
      way the waiver route does, and claims the print the way
      /print/bill/claim does — so the dialog never has to stitch a waiver and a
      print together, and a waiter the tenant granted the waiver can never
      record one and then have the print refused (the drawer would drop while
      the guest held the old, higher paper).

      `form` is absent for the live-waiver reprint: the server reprints the
      existing waiver and records nothing new.
    */
    const removeAndPrint = (form?: { waiver_kind: string; reason: string; authorised_by: string }): void => {
        // Synchronously, before anything is awaited — see openPrintTab.
        const tab = openPrintTab()
        setBusy(true)
        void (async () => {
            try {
                const answer = await removeServiceChargeAndPrint(restaurantId, { table_name: tableName, ...form })
                if (!answer.ok) {
                    // Nothing was ever drawn in it. The server's sentence, verbatim.
                    tab?.close()
                    fail(new Error(answer.message))
                    return
                }
                const said = serviceChargeRemovalSentence(answer.result, money)
                if (answer.result.printed && printBill) {
                    await printBill({ printWindow: tab, printableBill: answer.result.printable_bill ?? null })
                } else {
                    tab?.close()
                }
                toast({
                    title: said.tone === "warn" ? "Check the bill" : "Service charge",
                    description: said.message,
                    variant: said.tone === "warn" ? "destructive" : undefined,
                })
                onChanged()
                onClose()
            } catch (e) {
                tab?.close()
                fail(e)
                // The waiver may have landed before whatever went wrong; the
                // bill on screen is re-read either way.
                load()
                onChanged()
            } finally {
                setBusy(false)
            }
        })()
    }

    const reverse = async (): Promise<void> => {
        if (!live) {return}
        const why = window.prompt("Put the service charge back on this bill? Say why:", "")
        if (why === null || why.trim().length === 0) {return}
        setBusy(true)
        try {
            await reverseServiceChargeWaiver(restaurantId, live.id, why.trim())
            load()
            onChanged()
        } catch (e) { fail(e) } finally { setBusy(false) }
    }

    return (
        <Dialog open onOpenChange={(v) => { if (!v && !busy) {onClose()} }}>
            <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Service charge · Table {tableName}</DialogTitle>
                    <DialogDescription>
                        Take the service charge off this table&apos;s open bill, record on whose say-so, and print the
                        bill without it.
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Reading this table&apos;s bill…
                    </div>
                ) : null}

                {!loading && live ? (
                    <div className="space-y-3">
                        <div className="rounded-md border border-amber-500/40 bg-amber-500/[0.05] px-3 py-2 text-sm">
                            The service charge on this bill is already waived — {money(live.amount_waived)} off
                            (charge and tax {money(live.grand_total_reduction)}, before round-off), recorded as{" "}
                            {humaniseToken(live.waiver_kind, SERVICE_CHARGE_WAIVER_KINDS)}.
                            <div className="mt-1 text-xs text-muted-foreground">
                                {live.reason} · authorised by {live.authorised_by_username}
                            </div>
                        </div>
                        <Note>
                            One live waiver per bill. Reprinting prints it again without the charge and records
                            nothing new. Reversing it puts the charge back on and leaves the original in the record,
                            marked reversed — so the report shows a waiver a manager overturned rather than showing
                            nothing.
                        </Note>
                        <DialogFooter>
                            <Button variant="ghost" onClick={onClose} disabled={busy}>Close</Button>
                            <Button variant="outline" onClick={() => void reverse()} disabled={busy} className="gap-1">
                                <RotateCcw className="h-4 w-4" /> Put the charge back
                            </Button>
                            <Button onClick={() => { removeAndPrint() }} disabled={busy} className="gap-1">
                                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                                Reprint without the charge
                            </Button>
                        </DialogFooter>
                    </div>
                ) : null}

                {!loading && !live ? (
                    bill === null ? (
                        <>
                            {/* The bill could not be read, so this screen does not know
                                whether there is a service charge to take off. Offering
                                the form anyway would ask a manager to authorise a
                                reduction whose size nobody can see. */}
                            <Note tone="warn">
                                This table&apos;s bill could not be read, so there is nothing to show you here yet —
                                and a waiver is a reduction whose size you should see before you approve it. Check
                                your connection and reopen this.
                            </Note>
                            <DialogFooter><Button onClick={onClose}>Close</Button></DialogFooter>
                        </>
                    ) : !billCarriesServiceCharge(bill) ? (
                        <>
                            <Note tone="warn">
                                This bill carries no service charge, so there is nothing to remove. If you expected
                                one, check the restaurant&apos;s service-charge percentage or its default tax lines.
                            </Note>
                            <DialogFooter><Button onClick={onClose}>Close</Button></DialogFooter>
                        </>
                    ) : (
                        <>
                            <div className="grid grid-cols-2 gap-2">
                                {/* BOTH SHAPES. `service_charge` alone is the percent leg and is
                                    0 on a tenant whose charge is a tax line — which is most of
                                    them — so this figure adds the tax-line leg the server names. */}
                                <ServerFigure
                                    label="Service charge now"
                                    value={money(serviceChargeOnBill(bill))}
                                    hint={bill.service_charge_percent ? `${String(bill.service_charge_percent)}% as configured` : undefined}
                                />
                                <ServerFigure label="Grand total now" value={money(bill.grand_total)} hint="Tax-inclusive" />
                            </div>
                            <Note>
                                The reduction is not simply the charge: on one of the two tax shapes this system
                                supports, GST rides on the service charge, so the grand total falls by more. The
                                server measures it when you confirm, and you are told both totals as the bill prints.
                            </Note>
                            <KindPicker label="Why is it coming off?" options={SERVICE_CHARGE_WAIVER_KINDS} value={kind} onChange={setKind} />
                            <ReasonField value={reason} onChange={setReason} placeholder="e.g. Guest asked — long wait for the mains" />
                            <AuthoriserField value={authorisedBy} onChange={setAuthorisedBy} act="this waiver" />
                            <DialogFooter>
                                <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
                                <Button
                                    onClick={() => {
                                        removeAndPrint({
                                            waiver_kind: kind,
                                            reason: reason.trim(),
                                            authorised_by: authorisedBy.trim(),
                                        })
                                    }}
                                    disabled={busy || !kind || reason.trim().length === 0 || authorisedBy.trim().length === 0}
                                >
                                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
                                    Remove service charge &amp; print
                                </Button>
                            </DialogFooter>
                        </>
                    )
                ) : null}
            </DialogContent>
        </Dialog>
    )
}

// ---------------------------------------------------------------------------
// 037 — TENDERS AND TIPS
// ---------------------------------------------------------------------------

function TenderDialog({
    restaurantId, order, money, busy, setBusy, onClose, onChanged, toast, fail,
}: DialogShell & { order: CaptureOrder; money: (v: unknown) => string; toast: Toast }) {
    const [state, setState] = useState<BillTenderState | null>(null)
    const [loading, setLoading] = useState(true)
    // The restaurant's own modes that are on (Settings > Payment modes). The id
    // is what is recorded; the label is what the cashier reads.
    const { methods: paymentMethods } = usePaymentMethods(restaurantId)
    const tenderOptions = useMemo(() => tenderPaymentOptions(paymentMethods), [paymentMethods])
    const [rows, setRows] = useState<TenderDraft[]>([emptyTenderDraft()])

    const load = useCallback(() => {
        setLoading(true)
        void getBillTenderState(restaurantId, { order_id: order.id })
            .then(setState)
            .finally(() => { setLoading(false) })
    }, [restaurantId, order.id])
    useEffect(() => { load() }, [load])

    const live = useMemo(() => (state?.tenders ?? []).filter((t) => t.voided_at === null), [state])
    // THE SERVER'S FIGURE. Never a browser-side re-derivation of the bill — and
    // never a zero standing in for one that could not be read: `outstanding: 0`
    // renders as "Fully covered", which would tell a cashier to stop collecting
    // money on the strength of a request that never came back.
    const unread = !loading && state === null
    const outstanding = state?.outstanding ?? 0
    const refusal = tenderFormRefusal(rows, live.length)
    const formTotal = draftTenderTotal(rows)
    const formTips = draftTipTotal(rows)
    const canAddRow = live.length + rows.length < MAX_BILL_TENDERS

    const patch = (i: number, p: Partial<TenderDraft>): void => {
        setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...p } : r)))
    }

    const submit = async (): Promise<void> => {
        setBusy(true)
        try {
            const next = await recordBillTenders(restaurantId, {
                order_id: order.id,
                tenders: tendersForWire(rows),
            })
            setState(next)
            setRows([emptyTenderDraft()])
            toast({
                title: next.outstanding > 0 ? "Part payment recorded" : "Bill fully covered",
                description: next.outstanding > 0
                    ? `${money(next.outstanding)} still outstanding on this bill.`
                    : "Every rupee of this bill is now accounted for. Settle it from the Actions menu.",
            })
            onChanged()
        } catch (e) { fail(e) } finally { setBusy(false) }
    }

    const voidTender = async (id: string, label: string): Promise<void> => {
        const why = window.prompt(`Void the ${label} payment?\n\nThe row is not deleted — it stays, marked voided, so a payment keyed twice leaves the evidence behind. Say why:`, "")
        if (why === null || why.trim().length === 0) {return}
        setBusy(true)
        try {
            setState(await voidBillTender(restaurantId, id, why.trim()))
            onChanged()
        } catch (e) { fail(e) } finally { setBusy(false) }
    }

    return (
        <Dialog open onOpenChange={(v) => { if (!v && !busy) {onClose()} }}>
            <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Payments &amp; tip · Table {order.table}</DialogTitle>
                    <DialogDescription>
                        Take one bill across several payments, each with its own reference, and record the tip
                        beside them.
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Reading this bill…
                    </div>
                ) : (
                    <>
                        {/* EVERY ONE OF THESE FOUR IS THE SERVER'S. */}
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <ServerFigure label="Bill total" value={money(state?.grand_total)} hint="Tax-inclusive" />
                            <ServerFigure label="Paid so far" value={money(state?.tendered)} />
                            <ServerFigure
                                label="Outstanding"
                                value={unread ? "—" : money(outstanding)}
                                tone={unread || outstanding > 0 ? "warn" : "good"}
                                hint={unread ? "Not read" : outstanding > 0 ? "Still owed" : "Fully covered"}
                            />
                            <ServerFigure label="Tips held" value={money(state?.tips_total)} hint="Not revenue" />
                        </div>
                        {unread ? (
                            <Note tone="warn">
                                This bill could not be read, so none of the four figures above is known — and an
                                unknown outstanding is shown as a dash rather than as zero, because zero here would
                                read as &ldquo;fully covered&rdquo; and tell you to stop collecting. Check your
                                connection and reopen this before taking a payment.
                            </Note>
                        ) : (
                            <Note>
                                These four are the server&apos;s figures, read back from the bill. What you type below is
                                not counted into them until it is recorded — and a tip is never added to what settles
                                the bill, on this screen or in any report.
                            </Note>
                        )}

                        {live.length > 0 ? (
                            <div className="space-y-1.5">
                                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                                    Already recorded on this bill
                                </Label>
                                {live.map((t) => (
                                    <div key={t.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                                        <div className="min-w-0">
                                            <span className="font-medium">{paymentMethodLabel(t.method, paymentMethods)}</span>
                                            <span className="ml-2 font-mono tabular-nums">{money(t.amount)}</span>
                                            {t.tip_amount > 0 ? (
                                                <Badge variant="outline" className="ml-2 text-[10px]">
                                                    tip {money(t.tip_amount)}
                                                    {t.tip_mode ? ` · ${humaniseToken(t.tip_mode, TIP_MODES)}` : ""}
                                                    {t.tip_credited_to_username ? ` → ${t.tip_credited_to_username}` : ""}
                                                </Badge>
                                            ) : null}
                                            {t.txn_ref ? <div className="text-xs text-muted-foreground">ref {t.txn_ref}</div> : null}
                                        </div>
                                        <Button variant="ghost" size="sm" className="shrink-0 gap-1" disabled={busy}
                                            onClick={() => void voidTender(t.id, t.method)}>
                                            <Trash2 className="h-3.5 w-3.5" /> Void
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        ) : null}

                        <div className="space-y-2">
                            <Label className="text-xs uppercase tracking-wide text-muted-foreground">New payments</Label>
                            {rows.map((r, i) => (
                                <div key={i} className="space-y-2 rounded-md border p-2.5">
                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                                        <div className="sm:col-span-3">
                                            <Label className="text-[11px]">Method</Label>
                                            <Select value={r.method} onValueChange={(v) => { patch(i, { method: v }) }}>
                                                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    {tenderOptions.map((m) => (
                                                        <SelectItem
                                                            key={m.value}
                                                            value={m.value}
                                                            // Refused before it can be typed rather than after it is
                                                            // sent: this method settles a bill on its own, and a
                                                            // mixed set records fine and then cannot be settled.
                                                            disabled={isUnsplittableMethod(m.value) && (live.length + rows.length) > 1}
                                                        >
                                                            {m.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="sm:col-span-3">
                                            <Label className="text-[11px]">Amount</Label>
                                            <div className="flex gap-1">
                                                <Input
                                                    className="h-9" inputMode="decimal" value={r.amount}
                                                    onChange={(e) => { patch(i, { amount: e.target.value }) }}
                                                    placeholder="0.00"
                                                />
                                                <Button
                                                    type="button" variant="outline" size="sm" className="h-9 shrink-0 px-2 text-[11px]"
                                                    title="Fill this row with what the server says is still owed, less the other rows on this form"
                                                    disabled={remainderForRow(rows, i, outstanding) === null}
                                                    onClick={() => {
                                                        const rest = remainderForRow(rows, i, outstanding)
                                                        if (rest !== null) {patch(i, { amount: rest.toFixed(2) })}
                                                    }}
                                                >
                                                    Rest
                                                </Button>
                                            </div>
                                        </div>
                                        <div className="sm:col-span-3">
                                            <Label className="text-[11px]">Transaction ref</Label>
                                            <Input
                                                className="h-9" value={r.txn_ref}
                                                onChange={(e) => { patch(i, { txn_ref: e.target.value }) }}
                                                placeholder="Approval code / UTR"
                                            />
                                        </div>
                                        <div className="sm:col-span-2">
                                            <Label className="text-[11px]">Tip</Label>
                                            <Input
                                                className="h-9" inputMode="decimal" value={r.tip_amount}
                                                onChange={(e) => { patch(i, { tip_amount: e.target.value }) }}
                                                placeholder="0.00"
                                            />
                                        </div>
                                        <div className="flex items-end sm:col-span-1">
                                            <Button
                                                type="button" variant="ghost" size="icon" className="h-9 w-9"
                                                aria-label="Remove this payment row"
                                                disabled={rows.length === 1}
                                                onClick={() => { setRows((p) => p.filter((_, idx) => idx !== i)) }}
                                            >
                                                <X className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                    {(parseMoney(r.tip_amount) ?? 0) > 0 ? (
                                        <div className="grid grid-cols-1 gap-2 border-t pt-2 sm:grid-cols-12">
                                            <div className="sm:col-span-3">
                                                <Label className="text-[11px]">Tip arrived as</Label>
                                                <Select value={r.tip_mode} onValueChange={(v) => { patch(i, { tip_mode: v }) }}>
                                                    <SelectTrigger className="h-9"><SelectValue placeholder="Choose…" /></SelectTrigger>
                                                    <SelectContent>
                                                        {TIP_MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="sm:col-span-4">
                                                <Label className="text-[11px]">Credited to</Label>
                                                <Input
                                                    className="h-9" value={r.tip_credited_to}
                                                    onChange={(e) => { patch(i, { tip_credited_to: e.target.value }) }}
                                                    placeholder="username, or pool"
                                                />
                                            </div>
                                            <div className="flex items-end text-[11px] leading-snug text-muted-foreground sm:col-span-5">
                                                {/* Deliberately not resolved against the staff list: tips are
                                                    routinely owed to the kitchen or to a pool, i.e. to people who
                                                    hold no POS permission at all. */}
                                                A tip can be owed to someone who does not use this system at all — the
                                                kitchen, or a pool. Type a username, or the word <b>pool</b>.
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            ))}

                            <div className="flex flex-wrap items-center gap-2">
                                <Button
                                    type="button" variant="outline" size="sm" className="gap-1"
                                    disabled={!canAddRow}
                                    onClick={() => { setRows((p) => [...p, emptyTenderDraft("Card")]) }}
                                >
                                    <Plus className="h-3.5 w-3.5" /> Another payment
                                </Button>
                                {!canAddRow ? (
                                    <span className="text-xs text-muted-foreground">
                                        A bill can be settled across at most {MAX_BILL_TENDERS} payments.
                                    </span>
                                ) : null}
                                {/* A FACT ABOUT THE FORM, labelled as one. The bill's own
                                    outstanding is the server's figure above and this never
                                    replaces it. */}
                                <span className="ml-auto text-xs text-muted-foreground">
                                    On this form: <span className="font-mono tabular-nums">{money(formTotal)}</span>
                                    {formTips > 0 ? <> plus <span className="font-mono tabular-nums">{money(formTips)}</span> in tips</> : null}
                                </span>
                            </div>
                        </div>

                        {refusal ? <Note tone="warn">{refusal}</Note> : null}
                        <Note>
                            Recording payments does not close the bill — it records what has been taken, and the
                            bill stays open with the outstanding above. When nothing is outstanding, settle it
                            from the Actions menu; the settle reads this ledger rather than asking again.
                        </Note>

                        <DialogFooter>
                            <Button variant="ghost" onClick={onClose} disabled={busy}>Close</Button>
                            <Button onClick={() => void submit()} disabled={busy || refusal !== null}>
                                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wallet className="mr-2 h-4 w-4" />}
                                Record {tendersForWire(rows).length || ""} payment{tendersForWire(rows).length === 1 ? "" : "s"}
                            </Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    )
}

// ---------------------------------------------------------------------------
// 038 — BILLING COUNTER
// ---------------------------------------------------------------------------

const NO_COUNTER = "__none__"

function CounterDialog({
    restaurantId, order, busy, setBusy, onClose, onChanged, toast, fail,
}: DialogShell & { order: CaptureOrder; toast: Toast }) {
    const [counters, setCounters] = useState<BillingCounterRecord[]>([])
    // Told apart on purpose: an empty list is a correctly-configured single-till
    // outlet, a null is a read that did not come back. Offering "this outlet's
    // single till" as the only option during an outage would attribute a bill on
    // the strength of a failed request.
    const [failed, setFailed] = useState(false)
    const [loading, setLoading] = useState(true)
    const [choice, setChoice] = useState<string>(NO_COUNTER)

    useEffect(() => {
        setLoading(true)
        void getBillingCounters(restaurantId)
            .then((rows) => { setFailed(rows === null); setCounters(rows ?? []) })
            .finally(() => { setLoading(false) })
    }, [restaurantId])

    const submit = async (): Promise<void> => {
        setBusy(true)
        try {
            const r = await setBillCounter(
                restaurantId,
                { order_id: order.id },
                choice === NO_COUNTER ? null : choice,
            )
            toast({
                title: r.counter_id ? "Bill attributed" : "Attribution cleared",
                description: r.counter_id
                    ? "This bill now counts towards that till on the Counter Summary."
                    : "This bill counts as this outlet's single till.",
            })
            onChanged()
            onClose()
        } catch (e) { fail(e) } finally { setBusy(false) }
    }

    return (
        <Dialog open onOpenChange={(v) => { if (!v && !busy) {onClose()} }}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Billing counter · Table {order.table}</DialogTitle>
                    <DialogDescription>
                        Which till rang this bill. It is what lets the Counter Summary explain a cash-up.
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Reading this outlet&apos;s tills…
                    </div>
                ) : failed ? (
                    <>
                        <Note tone="warn">
                            This outlet&apos;s tills could not be read — which is not the same as &ldquo;none
                            configured&rdquo;. Close this, check your connection and try again, rather than
                            attributing a bill on the strength of a request that did not come back.
                        </Note>
                        <DialogFooter><Button onClick={onClose}>Close</Button></DialogFooter>
                    </>
                ) : counters.length === 0 ? (
                    <>
                        <Note>
                            This outlet has no tills configured, which is the normal state for a restaurant with
                            one billing point — every bill counts as that one till. Add tills in
                            <b> Settings → Billing counters</b>{" "}if you run more than one.
                        </Note>
                        <DialogFooter><Button onClick={onClose}>Close</Button></DialogFooter>
                    </>
                ) : (
                    <>
                        <div className="space-y-1.5">
                            <Label>Till</Label>
                            <Select value={choice} onValueChange={setChoice}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={NO_COUNTER}>This outlet&apos;s single till (no counter)</SelectItem>
                                    {counters.map((c) => (
                                        <SelectItem key={c.id} value={c.id}>
                                            {c.code} — {c.name}{c.active ? "" : " (retired)"}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <Note>
                            A bill with no counter is not lost — it lands in the Counter Summary&apos;s explicit
                            &ldquo;unassigned&rdquo; row, which is why that report&apos;s total still equals the Sales
                            Summary&apos;s.
                        </Note>
                        <DialogFooter>
                            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
                            <Button onClick={() => void submit()} disabled={busy}>
                                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Monitor className="mr-2 h-4 w-4" />}
                                Attribute this bill
                            </Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    )
}
