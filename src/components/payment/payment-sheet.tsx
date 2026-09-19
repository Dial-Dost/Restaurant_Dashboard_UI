"use client";

/**
 * THE MONEY SCREEN — the web `_PaymentSheet` (screens/mis_capture.dart).
 *
 * One sheet settles a bill: STILL TO PAY (the server's `outstanding`) as the
 * largest figure, bill / paid / composed / tips lines, the stale-paper warning,
 * the session till, the recorded tender ledger (per-tender void), composed
 * parts, the composer (method pills from the restaurant's own modes, amount +
 * "All of it", txn ref, collapsed tip block, proof, "Split — pay part this
 * way"), the NC pill, and "Record part payment" / "Settle & close" / "Settle as
 * NC" with the refusal sentence standing beside them. Bottom sheet below
 * 760px, centred dialog above (DrillSheet).
 */

import * as React from "react";
import { Camera, Gift, ImageUp, Info, Printer, Receipt, Store, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DrillSheet } from "@/components/ui/drill-sheet";
import { ForkCard } from "@/components/ui/fork-card";
import { InfoChip, StatusChip } from "@/components/ui/status-chip";
import { SkeletonRows } from "@/components/ui/fork-skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCurrency } from "@/hooks/use-currency";
import { usePaymentMethods } from "@/hooks/use-payment-methods";
import { useToast } from "@/hooks/use-toast";
import { useTimezone } from "@/lib/use-timezone";
import { cn } from "@/lib/utils";
import type { AuthUser } from "@/context/AuthContext";
import { can } from "@/lib/session-scope";
import {
    MAX_BILL_TENDERS,
    PERM_RECORD_PAYMENT,
    formatAmount,
    hasPermission,
    isUnsplittableMethod,
    type BillTenderRecord,
    type BillTenderState,
    type BillingCounterRecord,
} from "@/lib/mis-capture";
import { methodNeedsScreenshot, paymentMethodLabel, tillPaymentOptions } from "@/lib/payment-methods";
import {
    PRINT_UPDATED_BILL_LABEL,
    SETTLE_ANYWAY_LABEL,
    floorScopeOf,
    paperStaleOf,
    printedClockOf,
    printedInstantOf,
    printedTotalOf,
    stalePaperSettleWarning,
} from "@/lib/api/tables-floor";
import {
    MAX_PROOF_BYTES,
    NC_KINDS,
    NC_SETTLE_BUTTON,
    NC_SETTLE_PILL,
    NC_SETTLE_UNSUPPORTED,
    NC_WHOLE_BILL_ONLY,
    NO_MODES,
    PaymentError,
    TIP_MODE_PILLS,
    TIP_POOL,
    chooseTill,
    currentTill,
    draftToWire,
    fetchTableBill,
    fetchTenderState,
    fetchTills,
    imageTypeOf,
    ncAlreadyComped,
    ncBlocker,
    ncDoneSentence,
    ncGivenAway,
    ncHeadline,
    ncOpensAsNc,
    ncSettleBody,
    ncValue,
    ncWouldHaveCharged,
    paymentErrorText,
    printBillForTable,
    recordPartPayment,
    settleAndClose,
    settleAsNc,
    subscribeTill,
    tillLabelOf,
    uploadPaymentProof,
    vocabLabel,
    voidTender,
    type DraftTender,
} from "@/lib/api/payment";
import { CaptureReasonDialog, Pill } from "./capture-reason-dialog";

type Row = Record<string, unknown>;

const num = (v: unknown): number => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
};
const parseAmount = (raw: string): number => {
    const n = Number(raw.trim());
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
};

export interface PaymentSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    restaurantId: string;
    user: AuthUser;
    /** The order the settle routes address (the table's first order id). */
    orderId: string;
    tableName: string;
    /** Grand total to show when the ledger cannot be read. */
    fallbackTotal: number | null;
    /** The /bill-for-table payload already on screen, if any. */
    paperBill?: Row | null;
    /** The bill was settled (paid + closed, or NC). */
    onSettled: () => void;
}

/** Shrink a large photo to the 3MB ceiling (max 1600px, JPEG) — the picker's job in Flutter. */
const shrinkImage = async (file: File): Promise<Blob | null> => {
    try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return await new Promise((resolve) => { canvas.toBlob((b) => { resolve(b); }, "image/jpeg", 0.8); });
    } catch {
        return null;
    }
};

const toBase64 = (bytes: Uint8Array): string => {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
};

export function PaymentSheet({
    open, onOpenChange, restaurantId, user, orderId, tableName, fallbackTotal, paperBill: paperBillProp, onSettled,
}: PaymentSheetProps): React.JSX.Element {
    const { toast } = useToast();
    const { currencySymbol } = useCurrency();
    const { timezone } = useTimezone();
    const money = React.useCallback((v: number): string => formatAmount(v, currencySymbol), [currencySymbol]);
    const { methods: allModes } = usePaymentMethods(restaurantId);
    const modes = React.useMemo(() => tillPaymentOptions(allModes), [allModes]);

    const mayRecord = hasPermission(user.actions_set, PERM_RECORD_PAYMENT);
    const mayNc = can(user, "comp_item") && floorScopeOf(user, "service").settle;
    const me = user.employeeUsername ?? "";

    /* ── Loaded state ─────────────────────────────────────────────── */
    const [loading, setLoading] = React.useState(true);
    const [ledgerOk, setLedgerOk] = React.useState(false);
    const [ledger, setLedger] = React.useState<BillTenderState | null>(null);
    const [tills, setTills] = React.useState<BillingCounterRecord[]>([]);
    const [ncBill, setNcBill] = React.useState<Row | null>(null);
    const [paperBill, setPaperBill] = React.useState<Row | null>(paperBillProp ?? null);

    /* ── Composer ─────────────────────────────────────────────────── */
    const [method, setMethod] = React.useState("Upi");
    const [amount, setAmount] = React.useState("");
    const [txnRef, setTxnRef] = React.useState("");
    const [tipping, setTipping] = React.useState(false);
    const [tip, setTip] = React.useState("");
    const [tipMode, setTipMode] = React.useState("cash");
    const [tipTo, setTipTo] = React.useState("");
    const [drafts, setDrafts] = React.useState<DraftTender[]>([]);
    const [proofUrl, setProofUrl] = React.useState<string | null>(null);
    const [proofPreview, setProofPreview] = React.useState<string | null>(null);
    const [uploading, setUploading] = React.useState(false);

    /* ── NC ───────────────────────────────────────────────────────── */
    const [ncMode, setNcMode] = React.useState(false);
    const [ncUnsupported, setNcUnsupported] = React.useState(false);
    const [ncKind, setNcKind] = React.useState("");
    const [ncReason, setNcReason] = React.useState("");
    const [ncAuthorisedBy, setNcAuthorisedBy] = React.useState(me);

    const [busy, setBusy] = React.useState(false);
    const [printingUpdated, setPrintingUpdated] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [staleAsk, setStaleAsk] = React.useState<string | null>(null);
    const [voidTarget, setVoidTarget] = React.useState<BillTenderRecord | null>(null);

    const [till, setTillState] = React.useState(currentTill);
    React.useEffect(() => subscribeTill(() => { setTillState(currentTill()); }), []);

    const fileRef = React.useRef<HTMLInputElement>(null);
    const cameraRef = React.useRef<HTMLInputElement>(null);

    const clearComposer = (): void => {
        setDrafts([]);
        setTxnRef("");
        setTip("");
        setTipTo("");
        setTipping(false);
    };

    const load = React.useCallback(async (): Promise<void> => {
        setLoading(true);
        setError(null);
        setDrafts([]);
        setTxnRef("");
        setTip("");
        setTipTo("");
        setTipping(false);
        let state: BillTenderState | null = null;
        let ok = false;
        if (mayRecord) {
            try {
                state = await fetchTenderState(restaurantId, orderId);
                ok = Object.keys(state).length > 0;
            } catch { ok = false; }
        }
        let counters: BillingCounterRecord[] = [];
        if (mayRecord) {
            try { counters = await fetchTills(restaurantId); } catch { counters = []; }
        }
        let bill: Row | null = null;
        if (tableName !== "") {
            try { bill = await fetchTableBill(restaurantId, tableName); } catch { bill = null; }
        }
        const nb = mayNc ? bill : null;
        setLedger(ok ? state : null);
        setLedgerOk(ok);
        setTills(counters);
        setNcBill(nb);
        setPaperBill(bill ?? paperBillProp ?? null);
        const outstanding = ok && state ? num(state.outstanding) : 0;
        const rem = outstanding < 0.005 ? 0 : outstanding;
        const tendered = ok && state ? num(state.tendered) : 0;
        setNcMode((prev) => mayNc && !ncUnsupported
            && ncBlocker({ bill: nb, tendered, drafts: 0, money }) === null
            && (prev || ncOpensAsNc(nb)));
        setAmount(rem <= 0 ? "" : rem.toFixed(2));
        setLoading(false);
    }, [mayRecord, mayNc, ncUnsupported, restaurantId, orderId, tableName, paperBillProp, money]);

    React.useEffect(() => {
        if (!open) { return; }
        setNcMode(false);
        setNcKind("");
        setNcReason("");
        setNcAuthorisedBy(me);
        setProofUrl(null);
        setProofPreview(null);
        setBusy(false);
        void load();
        // Only on opening — `load` is re-run explicitly after writes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, orderId]);

    // Keep the cashier's pick if still offered; otherwise UPI, or the first mode.
    React.useEffect(() => {
        if (modes.length > 0 && !modes.some((m) => m.value === method)) {
            setMethod(modes.some((m) => m.value === "Upi") ? "Upi" : modes[0].value);
        }
    }, [modes, method]);

    /* ── The numbers ──────────────────────────────────────────────── */
    const grandTotal = num(ledger?.grand_total);
    const tendered = num(ledger?.tendered);
    const outstanding = num(ledger?.outstanding);
    const draftTotal = drafts.reduce((sum, t) => sum + t.amount, 0);
    const remainingRaw = outstanding - draftTotal;
    const remaining = remainingRaw < 0.005 ? 0 : Math.round(remainingRaw * 100) / 100;
    const liveTenders = (ledger?.tenders ?? []).filter((t) => !t.voided_at);
    const tenderCount = liveTenders.length + drafts.length;
    const composerAmount = parseAmount(amount);
    const composerTip = tipping ? parseAmount(tip) : 0;
    const needsProofNow = methodNeedsScreenshot(method, allModes);
    const methodLabel = paymentMethodLabel(method, allModes);
    const hasProof = (proofUrl ?? "") !== "";

    const composerRefusal = ((): string | null => {
        if (!ledgerOk) { return null; }
        if (modes.length === 0) { return NO_MODES; }
        if (composerAmount <= 0) { return "Enter how much of the bill this payment covers."; }
        if (composerAmount > remaining + 0.005) {
            return `That is more than the ${money(remaining)} still owed. A payment can never be larger than the bill — hand the change back in cash.`;
        }
        // [web-extra, kept] the server's unsplittable-method rule, said before it refuses.
        if (tenderCount > 0 && isUnsplittableMethod(method)) {
            return `${methodLabel} settles a bill on its own — it cannot be one of several payments. Take the rest another way.`;
        }
        if (composerTip > 0 && tipTo.trim() === "") {
            return "A tip has to say who it goes to — a name, or \"pool\".";
        }
        if (needsProofNow && !hasProof) { return `${methodLabel} needs a payment screenshot before it can settle.`; }
        return null;
    })();

    const composed: DraftTender | null = composerRefusal === null && composerAmount > 0
        ? { method, amount: composerAmount, txnRef, tip: composerTip, tipMode, tipTo }
        : null;
    const allDrafts = composed ? [...drafts, composed] : drafts;
    const tipsDraft = allDrafts.reduce((sum, t) => sum + t.tip, 0);

    const isSimpleSettle = liveTenders.length === 0 && drafts.length === 0 && composerTip <= 0
        && (!ledgerOk || (remaining > 0 && Math.abs(composerAmount - remaining) < 0.005));

    const settleRefusal = ((): string | null => {
        if (!ledgerOk) {
            if (modes.length === 0) { return NO_MODES; }
            return needsProofNow && !hasProof ? `Attach a payment proof photo before settling a ${methodLabel} bill.` : null;
        }
        if (remaining <= 0.005 && composerAmount <= 0) {
            return needsProofNow && !hasProof && isSimpleSettle ? `Attach a payment proof photo before settling a ${methodLabel} bill.` : null;
        }
        if (modes.length === 0) { return NO_MODES; }
        const left = remaining - (composed?.amount ?? 0);
        if (left > 0.005) {
            return `That leaves ${money(left)} unpaid. A bill settles in full — take the rest, or use “Record part payment” and leave the table open.`;
        }
        return composerRefusal;
    })();

    const ncOffered = mayNc && !ncUnsupported;
    const ncBlocked = ncBlocker({ bill: ncBill, tendered, drafts: drafts.length, money });
    const ncRefusal = ncBlocked ?? (ncKind.trim() !== "" && ncReason.trim() !== "" && ncAuthorisedBy.trim() !== ""
        ? null
        : "Choose why it is going free, give the reason, and name who authorised it.");
    const refusalNow = ncMode ? ncRefusal : settleRefusal;

    const staleWarning = stalePaperSettleWarning({
        paperStale: paperBill ? paperStaleOf(paperBill) : null,
        printedClock: printedClockOf(printedInstantOf(paperBill), timezone),
        printedTotal: printedTotalOf(paperBill),
        grandTotal: paperBill ? num(paperBill.grand_total ?? paperBill.total_amt) : null,
        money,
    });

    /* ── Proof ────────────────────────────────────────────────────── */
    const pickProof = async (file: File | undefined): Promise<void> => {
        if (!file) { return; }
        setUploading(true);
        setError(null);
        try {
            let blob: Blob = file;
            let bytes = new Uint8Array(await blob.arrayBuffer());
            let ct = imageTypeOf(bytes);
            if (ct === null) { setError("That file is not a JPEG, PNG or WebP image."); return; }
            if (bytes.length > MAX_PROOF_BYTES) {
                const smaller = await shrinkImage(file);
                if (smaller) {
                    blob = smaller;
                    bytes = new Uint8Array(await blob.arrayBuffer());
                    ct = imageTypeOf(bytes) ?? "image/jpeg";
                }
            }
            if (bytes.length > MAX_PROOF_BYTES) {
                setError("That image is too large (max 3MB) — retake it at a lower quality.");
                return;
            }
            const url = await uploadPaymentProof(restaurantId, toBase64(bytes), ct);
            if (url === "") { setError("The upload came back without an image URL — please try again."); return; }
            setProofUrl(url);
            setProofPreview(URL.createObjectURL(blob));
        } catch (e: unknown) {
            setError(paymentErrorText(e));
        } finally {
            setUploading(false);
        }
    };

    /* ── Acts ─────────────────────────────────────────────────────── */
    const addPart = (): void => {
        if (!composed || tenderCount >= MAX_BILL_TENDERS) { return; }
        const nextDrafts = [...drafts, composed];
        const left = outstanding - nextDrafts.reduce((sum, t) => sum + t.amount, 0);
        setDrafts(nextDrafts);
        setTxnRef("");
        setTip("");
        setTipTo("");
        setTipping(false);
        setAmount(left <= 0.005 ? "" : left.toFixed(2));
    };

    const doRecordPart = async (): Promise<void> => {
        if (allDrafts.length === 0) { return; }
        setBusy(true);
        setError(null);
        try {
            await recordPartPayment(restaurantId, orderId, allDrafts);
            toast({ title: "Payment recorded. The bill stays open for the rest." });
            setBusy(false);
            await load();
        } catch (e: unknown) {
            setBusy(false);
            setError(paymentErrorText(e));
        }
    };

    const doSettle = async (stale: boolean): Promise<void> => {
        setBusy(true);
        setError(null);
        const tenders = allDrafts;
        const body: Row = {
            ...(till.id !== "" ? { counter_id: till.id } : {}),
            ...(needsProofNow && hasProof ? { payment_proof_screenshot_url: proofUrl } : {}),
            ...(stale ? { settled_with_stale_paper: true } : {}),
        };
        if (isSimpleSettle) {
            body.payment_method = method;
        } else if (tenders.length === 0) {
            body.payment_method = ledger?.payment_method ?? method;
        } else {
            body.tenders = tenders.map(draftToWire);
        }
        try {
            await settleAndClose(restaurantId, orderId, body, stale);
            toast({ title: tableName !== "" ? `Table ${tableName} settled` : "Bill settled" });
            onOpenChange(false);
            onSettled();
        } catch (e: unknown) {
            const refusal = paymentErrorText(e);
            setBusy(false);
            setError(refusal);
            // THE HALF-DONE SETTLE: tenders commit in their own transaction, so a
            // refused settle may have recorded them. Re-read; keep the refusal.
            if (e instanceof PaymentError && e.answered && tenders.length > 0) {
                await load();
                setError(refusal);
            }
        }
    };

    const startSettle = (): void => {
        if (settleRefusal !== null) { setError(settleRefusal); return; }
        if (staleWarning !== null) { setStaleAsk(staleWarning); return; }
        void doSettle(false);
    };

    const doSettleNc = async (): Promise<void> => {
        if (ncRefusal !== null) { setError(ncRefusal); return; }
        setBusy(true);
        setError(null);
        try {
            const res = await settleAsNc(restaurantId, orderId, ncSettleBody({
                kind: ncKind, reason: ncReason, authorisedBy: ncAuthorisedBy,
                expectedValue: ncValue(ncBill), counterId: till.id,
            }));
            toast({ title: ncDoneSentence(res, money) });
            onOpenChange(false);
            onSettled();
        } catch (e: unknown) {
            if (e instanceof PaymentError && e.status === 404 && e.bodyMissing) {
                setBusy(false);
                setNcUnsupported(true);
                setNcMode(false);
                setError(NC_SETTLE_UNSUPPORTED);
                return;
            }
            const said = paymentErrorText(e);
            setBusy(false);
            setError(said);
            if (e instanceof PaymentError && e.answered) {
                await load();
                setError(said);
            }
        }
    };

    const printUpdated = async (): Promise<void> => {
        setPrintingUpdated(true);
        setError(null);
        try {
            await printBillForTable(restaurantId, tableName);
            toast({ title: "Printing the updated bill…" });
            const fresh = await fetchTableBill(restaurantId, tableName);
            if (fresh) { setPaperBill(fresh); }
        } catch (e: unknown) {
            setError(paymentErrorText(e));
        } finally {
            setPrintingUpdated(false);
        }
    };

    /* ── Pieces ───────────────────────────────────────────────────── */
    const locked = busy || uploading;
    const settledUp = ledgerOk && remaining <= 0;
    const canPart = !ncMode && ledgerOk && allDrafts.length > 0 && remaining > 0;
    const tableUpper = tableName.trim().toUpperCase();

    const headline = (): React.ReactNode => {
        if (ncMode) {
            const would = ncWouldHaveCharged(ncBill);
            const comped = ncAlreadyComped(ncBill);
            return (
                <div>
                    <div className="micro-label">{tableUpper === "" ? "SETTLE AS NC" : `SETTLE AS NC · TABLE ${tableUpper}`}</div>
                    <div className="display-md mt-1 tabular-nums text-destructive">{ncHeadline(ncGivenAway(ncBill), money)}</div>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                        Before tax, at the prices on the bill{comped > 0 ? `, including ${money(comped)} already comped dish by dish` : ""}.
                        {would > 0 ? ` The guest would have paid ${money(would)} with service charge and tax — information only; it is in no report.` : ""}
                    </p>
                </div>
            );
        }
        if (!ledgerOk) {
            return (
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="micro-label">{tableUpper === "" ? "SETTLE BILL" : `SETTLE BILL · TABLE ${tableUpper}`}</span>
                        <InfoChip icon={<Info className="h-3 w-3" />} label="Single payment only" />
                    </div>
                    <div className="display-lg mt-2 tabular-nums">{fallbackTotal !== null ? money(fallbackTotal) : "—"}</div>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                        This bill’s payment ledger could not be read, so split payments, tips and the till are not offered here. The bill still settles exactly as it always has.
                    </p>
                </div>
            );
        }
        return (
            <div>
                <div className={cn("micro-label", settledUp && "!text-success")}>{settledUp ? "PAID IN FULL" : "STILL TO PAY"}</div>
                <div className={cn("display-lg mt-1 tabular-nums", settledUp && "text-success")}>{money(remaining)}</div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>Bill {money(grandTotal)}</span>
                    {tendered > 0 ? <span>Paid {money(tendered)}</span> : null}
                    {draftTotal > 0 ? <span>Composed {money(draftTotal)}</span> : null}
                    {num(ledger?.tips_total) + tipsDraft > 0 ? (
                        <span className="text-accent-foreground">Tips {money(num(ledger?.tips_total) + tipsDraft)} (not part of the bill)</span>
                    ) : null}
                </div>
            </div>
        );
    };

    const tillRow = ledgerOk ? (
        <div className="flex items-center gap-2">
            <Store aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm">{till.id === "" ? "No till chosen" : `Till: ${till.label}`}</span>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" title="Which till is ringing this" disabled={locked}>
                        {till.id === "" ? "Choose till" : "Change"}
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuCheckboxItem checked={till.id === ""} onCheckedChange={() => { chooseTill("", ""); }}>
                        This outlet’s single till
                    </DropdownMenuCheckboxItem>
                    {tills.map((c) => (
                        <DropdownMenuCheckboxItem key={c.id} checked={c.id === till.id} onCheckedChange={() => { chooseTill(c.id, `${c.code} · ${c.name || c.code}`); }}>
                            {tillLabelOf(c)}
                        </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    ) : null;

    const ledgerBlock = ledgerOk && liveTenders.length > 0 ? (
        <div>
            <div className="micro-label mb-1.5">Already paid</div>
            <div className="grid gap-1.5">
                {liveTenders.map((t) => (
                    <ForkCard key={t.id} inset className="flex items-start gap-2 !px-3 !py-2">
                        <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-semibold tabular-nums">{paymentMethodLabel(t.method, allModes)} · {money(t.amount)}</div>
                            {num(t.tip_amount) > 0 ? (
                                <div className="text-xs text-accent-foreground">
                                    + {money(t.tip_amount)} tip ({vocabLabel(TIP_MODE_PILLS, t.tip_mode ?? "")}) to {t.tip_credited_to_username ?? "—"}
                                </div>
                            ) : null}
                            {t.txn_ref ? <div className="text-xs text-muted-foreground">Ref {t.txn_ref}</div> : null}
                        </div>
                        <Button variant="ghost" size="icon" title="Void this payment" aria-label="Void this payment" disabled={locked} onClick={() => { setVoidTarget(t); }}>
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </ForkCard>
                ))}
            </div>
        </div>
    ) : null;

    const draftsBlock = drafts.length > 0 ? (
        <div>
            <div className="micro-label mb-1.5">This settlement</div>
            <div className="grid gap-1.5">
                {drafts.map((d, i) => (
                    <ForkCard key={`${d.method}-${String(i)}`} inset className="flex items-start gap-2 !px-3 !py-2">
                        <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-semibold tabular-nums">{paymentMethodLabel(d.method, allModes)} · {money(d.amount)}</div>
                            {d.tip > 0 ? <div className="text-xs text-accent-foreground">+ {money(d.tip)} tip to {d.tipTo}</div> : null}
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            title="Take this part off again"
                            aria-label="Take this part off again"
                            disabled={locked}
                            onClick={() => {
                                const next = drafts.filter((_, j) => j !== i);
                                setDrafts(next);
                                const left = outstanding - next.reduce((sum, t) => sum + t.amount, 0);
                                setAmount(left <= 0.005 ? "" : left.toFixed(2));
                            }}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </ForkCard>
                ))}
            </div>
        </div>
    ) : null;

    const methodPills = (
        <div>
            <div className="micro-label mb-1.5">{ncMode ? "SETTLE AS" : drafts.length === 0 ? "PAYMENT METHOD" : "NEXT PART"}</div>
            <div className="flex flex-wrap gap-2">
                {modes.map((m) => (
                    <Pill
                        key={m.value}
                        selected={!ncMode && method === m.value}
                        disabled={locked}
                        onClick={() => { setNcMode(false); setMethod(m.value); setError(null); }}
                    >
                        {m.label}
                    </Pill>
                ))}
                {ncOffered ? (
                    <Pill danger selected={ncMode} disabled={locked || ncBlocked !== null} onClick={() => { setNcMode(true); setError(null); }}>
                        {NC_SETTLE_PILL}
                    </Pill>
                ) : null}
            </div>
            {ncOffered && ncBlocked !== null && !ncMode ? (
                <p className="mt-1.5 text-xs text-muted-foreground">NC is not available here: {ncBlocked}</p>
            ) : null}
        </div>
    );

    const proofBlock = needsProofNow && !ncMode ? (
        <div>
            <div className="micro-label mb-1.5">Payment proof</div>
            <div className="flex flex-wrap items-center gap-3">
                {proofPreview ? (
                    <img src={proofPreview} alt="Payment proof" className="h-16 w-16 rounded-md border border-border object-cover" />
                ) : null}
                <Button variant="outline" size="sm" disabled={locked} onClick={() => { cameraRef.current?.click(); }}>
                    <Camera /> {hasProof ? "Retake" : "Take photo"}
                </Button>
                <Button variant="outline" size="sm" disabled={locked} onClick={() => { fileRef.current?.click(); }}>
                    <ImageUp /> {hasProof ? "Replace image" : "Choose image"}
                </Button>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
                {uploading ? "Uploading…" : hasProof ? "Proof attached — it uploads with the settlement." : `${methodLabel} needs a screenshot of the payment.`}
            </p>
            <input ref={cameraRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden"
                onChange={(e) => { void pickProof(e.target.files?.[0]); e.target.value = ""; }} />
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                onChange={(e) => { void pickProof(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
    ) : null;

    const tipBlock = tipping ? (
        <ForkCard inset className="grid gap-2.5 !p-3">
            <div className="flex items-center">
                <span className="micro-label flex-1">Tip</span>
                <Button variant="ghost" size="icon" title="No tip after all" aria-label="No tip after all" onClick={() => { setTipping(false); setTip(""); setTipTo(""); }}>
                    <X className="h-4 w-4" />
                </Button>
            </div>
            <p className="text-xs text-muted-foreground">
                On top of the bill, never part of it. A tip appears in no sales figure, no APC and no ABV — only on the Tip Summary, as money owed to a person.
            </p>
            <div className="grid gap-1.5">
                <Label htmlFor="pay-tip">Tip amount ({currencySymbol})</Label>
                <Input id="pay-tip" inputMode="decimal" value={tip} disabled={locked} onChange={(e) => { setTip(e.target.value); }} />
            </div>
            <div>
                <div className="micro-label mb-1.5">How it arrived</div>
                <div className="flex flex-wrap gap-2">
                    {TIP_MODE_PILLS.map((m) => (
                        <Pill key={m.value} selected={tipMode === m.value} disabled={locked} onClick={() => { setTipMode(m.value); }}>{m.label}</Pill>
                    ))}
                </div>
            </div>
            <div className="flex items-end gap-2">
                <div className="grid flex-1 gap-1.5">
                    <Label htmlFor="pay-tip-to">Credited to</Label>
                    <Input id="pay-tip-to" value={tipTo} disabled={locked} autoComplete="off" onChange={(e) => { setTipTo(e.target.value); }} />
                </div>
                <Button variant="outline" disabled={locked} onClick={() => { setTipTo(TIP_POOL); }}>Pool</Button>
            </div>
            <p className="-mt-1 text-xs text-muted-foreground">A staff username, or the shared pool.</p>
        </ForkCard>
    ) : null;

    const composer = ledgerOk && !ncMode && (remaining > 0 || drafts.length > 0) ? (
        <div className="grid gap-3">
            <div className="flex items-end gap-2">
                <div className="grid flex-1 gap-1.5">
                    <Label htmlFor="pay-amount">Amount ({currencySymbol})</Label>
                    <Input id="pay-amount" inputMode="decimal" className="tabular-nums" value={amount} disabled={locked} onChange={(e) => { setAmount(e.target.value); }} />
                </div>
                <Button variant="outline" disabled={locked || remaining <= 0} onClick={() => { setAmount(remaining.toFixed(2)); }}>All of it</Button>
            </div>
            <div className="grid gap-1.5">
                <Label htmlFor="pay-ref">Reference (optional)</Label>
                <Input id="pay-ref" value={txnRef} disabled={locked} autoComplete="off" onChange={(e) => { setTxnRef(e.target.value); }} />
                <p className="text-xs text-muted-foreground">The acquirer’s reference, so a disputed card payment can be found.</p>
            </div>
            {tipBlock ?? (
                <div>
                    <Button variant="ghost" size="sm" disabled={locked} onClick={() => { setTipping(true); setTipMode("cash"); }}>
                        <Gift /> Add a tip
                    </Button>
                </div>
            )}
            {proofBlock}
            <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" disabled={locked || composed === null || tenderCount >= MAX_BILL_TENDERS || composerAmount >= remaining - 0.005}
                    onClick={addPart}>
                    Split — pay part this way
                </Button>
            </div>
            {tenderCount >= MAX_BILL_TENDERS ? (
                <p className="text-xs text-muted-foreground">
                    A bill can be settled across at most {MAX_BILL_TENDERS} payments. Void one before adding another.
                </p>
            ) : null}
            {composerRefusal !== null && composerAmount > 0 ? <p className="text-xs text-warning">{composerRefusal}</p> : null}
        </div>
    ) : null;

    const ncForm = ncMode ? (
        <div className="grid gap-3">
            <p className="text-xs text-muted-foreground">{NC_WHOLE_BILL_ONLY}</p>
            <div>
                <div className="micro-label mb-1.5">Why is it going free</div>
                <div className="flex flex-wrap gap-2">
                    {NC_KINDS.map((k) => (
                        <Pill key={k.value} selected={ncKind === k.value} disabled={locked} onClick={() => { setNcKind(k.value); }}>{k.label}</Pill>
                    ))}
                </div>
            </div>
            <div className="grid gap-1.5">
                <Label htmlFor="pay-nc-reason">Reason</Label>
                <Textarea id="pay-nc-reason" rows={2} maxLength={400} value={ncReason} disabled={locked} onChange={(e) => { setNcReason(e.target.value); }} />
                <p className="text-xs text-muted-foreground">Required. It goes on the NC Summary, verbatim.</p>
            </div>
            <div className="grid gap-1.5">
                <Label htmlFor="pay-nc-auth">Authorised by (username)</Label>
                <Input id="pay-nc-auth" value={ncAuthorisedBy} disabled={locked} autoComplete="off" onChange={(e) => { setNcAuthorisedBy(e.target.value); }} />
                <p className="text-xs text-muted-foreground">
                    The staff member who approved giving this bill away. Yours is filled in — change it if someone else said yes.
                </p>
            </div>
        </div>
    ) : null;

    const staleCard = staleWarning !== null ? (
        <ForkCard inset className="!p-3" style={{ borderColor: "hsl(var(--warning) / 0.5)" }}>
            <div className="flex items-start gap-2 text-sm text-warning">
                <Receipt aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{staleWarning}</span>
            </div>
            {tableName !== "" ? (
                <div className="mt-2 flex justify-end">
                    <Button variant="ghost" size="sm" disabled={busy || printingUpdated} onClick={() => { void printUpdated(); }}>
                        <Printer /> {PRINT_UPDATED_BILL_LABEL}
                    </Button>
                </div>
            ) : null}
        </ForkCard>
    ) : null;

    const footer = (
        <div className="grid w-full gap-2">
            {error !== null ? <p className="text-sm text-destructive">{error}</p> : null}
            {refusalNow !== null && !loading && error !== refusalNow ? (
                <p className="text-xs text-muted-foreground">{refusalNow}</p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" disabled={locked} onClick={() => { onOpenChange(false); }}>Cancel</Button>
                {canPart ? (
                    <Button variant="outline" disabled={locked} onClick={() => { void doRecordPart(); }}>Record part payment</Button>
                ) : null}
                {ncMode ? (
                    <Button variant="destructive" disabled={locked || loading || ncRefusal !== null} onClick={() => { void doSettleNc(); }}>
                        {busy ? "Processing…" : NC_SETTLE_BUTTON}
                    </Button>
                ) : (
                    <Button disabled={locked || loading || settleRefusal !== null} onClick={startSettle}>
                        {busy ? "Processing…" : "Settle & close"}
                    </Button>
                )}
            </div>
        </div>
    );

    return (
        <>
            <DrillSheet
                open={open}
                onOpenChange={(v) => { if (!locked) { onOpenChange(v); } }}
                eyebrow={tableName !== "" ? `Table ${tableName}` : "Settle"}
                title={ncMode ? "Settle as non-chargeable" : "Settle bill"}
                action={footer}
            >
                {loading ? (
                    <SkeletonRows rows={4} />
                ) : (
                    <div className="grid gap-4">
                        {headline()}
                        {staleCard}
                        {tillRow}
                        {ledgerBlock}
                        {draftsBlock}
                        {methodPills}
                        {ncForm}
                        {composer}
                        {!ledgerOk && !ncMode ? proofBlock : null}
                        {settledUp && !ncMode && drafts.length === 0 ? (
                            <StatusChip status="success" label="The payments on record cover the bill — Settle & close needs no new payment." />
                        ) : null}
                    </div>
                )}
            </DrillSheet>

            <AlertDialog open={staleAsk !== null} onOpenChange={(o) => { if (!o) { setStaleAsk(null); } }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>The printed bill is out of date</AlertDialogTitle>
                        <AlertDialogDescription>{staleAsk}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => { setStaleAsk(null); void doSettle(true); }}>{SETTLE_ANYWAY_LABEL}</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <CaptureReasonDialog
                open={voidTarget !== null}
                onOpenChange={(o) => { if (!o) { setVoidTarget(null); } }}
                title="Void this payment"
                headline={voidTarget ? money(voidTarget.amount) : null}
                danger
                subtitle={`${voidTarget ? paymentMethodLabel(voidTarget.method, allModes) : ""} · the row stays, stamped with your name and this reason, and drops out of every total. That is what makes a double-keyed card payment provable when the acquirer’s statement shows two authorisations.`}
                confirmLabel="Void it"
                onConfirm={async ({ reason }) => {
                    if (!voidTarget) { return; }
                    await voidTender(restaurantId, voidTarget.id, reason);
                    toast({ title: "Payment voided." });
                    clearComposer();
                    await load();
                }}
            />
        </>
    );
}
