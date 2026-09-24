"use client";

/**
 * The tap-a-table sheet — the web `_TableSheet` (screens/modules.dart).
 *
 * A full mini-overview of one table: state chip, seats, elapsed chips, printed
 * banner, guest name/GSTIN header, Add order / Seat guests / Print bill hero
 * buttons, QR,
 * waiter row, per-KOT order blocks, bill card, APC insight, bill ops, payment
 * review, settle / move / release actions. Bottom sheet below 760px, centred
 * dialog above (DrillSheet), with "View in Orders" as the footer jump.
 *
 * "Add order", "Add to printed bill", "Use green …" and "Seat guests & take
 * order" open the staff order pad in place (`onOpenPad` — the page mounts
 * `OrderPad`); a reader with no seating control on a FREE table gets the
 * "occupancy follows the order" pad (covers asked on Send).
 *
 * "Settle bill" opens the unified payment sheet (components/payment), "Comp a
 * dish" the table-wide comp sheet, and the bill block carries the merged
 * "Remove service charge & print" control (docs/parity/mis-capture.md).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import {
    ArrowLeftRight,
    BadgeCheck,
    CircleCheck,
    Lightbulb,
    Lock,
    LogOut,
    Merge,
    Percent,
    Plus,
    Printer,
    Receipt,
    Split,
    StickyNote,
    Tag,
    TrendingDown,
    UserRound,
    Users,
} from "lucide-react";

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
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DrillSheet, DrillSheetAction } from "@/components/ui/drill-sheet";
import { ForkCard } from "@/components/ui/fork-card";
import { InfoChip } from "@/components/ui/status-chip";
import { SectionHeader } from "@/components/ui/section-header";
import { MicroStat } from "@/components/ui/micro-stat";
import { SkeletonRows } from "@/components/ui/fork-skeleton";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { BillCustomerDialog } from "@/components/bill-customer-dialog";
import { BillPreviewDialog } from "@/components/bill-print/bill-preview-dialog";
import { KotLineActions } from "@/components/bill-print/kot-line-actions";
import { useToast } from "@/hooks/use-toast";
import { useCachedFetch } from "@/hooks/use-cached-fetch";
import { useCurrency } from "@/hooks/use-currency";
import { useTimezone } from "@/lib/use-timezone";
import { cn } from "@/lib/utils";
import type { FloorInkSet } from "@/lib/floor-state";
import type { AuthUser } from "@/context/AuthContext";
import type { OrderPadRequest } from "@/components/order-pad/order-pad";
import { occupyTable, releaseTable, requestBackend, updateTableCovers } from "@/lib/db";
import { isRefusedAction } from "@/lib/error-message";
import { seatingLeftTableUnattended } from "@/lib/table-assignment";
import { announceReprintNeeded, readReprintNeeded } from "@/lib/reprint-needed";
import { groupItemsByKot, type KotGroupOrder } from "@/lib/kot-groups";
import { draftCartCount, draftStoreKey, readPadDraft } from "@/lib/order-draft-store";
import {
    elapsedSincePlaced,
    elapsedToSettlement,
    formatDuration,
    monotonicNow,
    readServiceClock,
    type ServiceClockCarrier,
} from "@/lib/service-clock";
import { elapsedTone, type ElapsedTone } from "@/lib/api/orders";
import { visibleAmount, visibleMoneyText } from "@/lib/order-prices";
import {
    ADD_TO_PRINTED_BILL_ACTION,
    PRINT_BILL_LABEL,
    PRINT_UPDATED_BILL_LABEL,
    SETTLE_ANYWAY_LABEL,
    addToPrintedBillConfirm,
    addToPrintedBillLabel,
    applyBillCoupon,
    approvePaymentAndClose,
    fetchAssignableWaiters,
    floorScopeOf,
    greenSeatFor,
    isNextPartyRow,
    mergeTableBills,
    paperStaleOf,
    parentTableOf,
    printedAsOf,
    printedClockOf,
    printedInstantOf,
    printedTileChips,
    printedTotalOf,
    printTableBill,
    seatsLabel,
    setBillDiscount,
    splitBillEvenly,
    stalePaperSettleWarning,
    tableOrderUrl,
    tableSeated,
    tableSentenceNameOf,
    greenSeatLabel,
    movedDishesOf,
    movedOrderDishesSentence,
    orderDishLines,
    type AssignableWaiter,
    type FloorRow,
} from "@/lib/api/tables-floor";
import { assignTableToEmployee, moveOrderToTable, unassignTableEmployee } from "@/lib/db";
import { FloorChip } from "./floor-chips";
import { PaymentSheet } from "@/components/payment/payment-sheet";
import { CompSheet } from "@/components/payment/comp-sheet";
import { ServiceChargeBlock } from "@/components/payment/service-charge-block";
import { can, isWaiterOnly } from "@/lib/session-scope";
import { FLOOR_STATE_WORDS } from "@/lib/api/tables-floor";

const LATEST_ORDER_TONE: Record<ElapsedTone, string> = {
    neutral: "",
    warning: "border-warning/60 text-warning",
    danger: "border-destructive/60 text-destructive",
};

/** The slice of an order the sheet reads: KOT groups + the two clocks. */
export interface SheetOrder extends KotGroupOrder, ServiceClockCarrier {
    status: string;
    total?: unknown;
}

type BillDoc = Record<string, unknown>;

/** The table a ticket was moved from (order_moves.dart movedFromLabel), or "". */
const movedFromOf = (order: unknown): string => {
    const v = order !== null && typeof order === "object" ? (order as { moved_from?: unknown }).moved_from : null;
    return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
};

const bstr = (bill: BillDoc | null, key: string): string => {
    const v = bill?.[key];
    if (typeof v === "string") { return v.trim(); }
    if (typeof v === "number") { return String(v); }
    return "";
};

const bnum = (bill: BillDoc | null, key: string): number => {
    const v = bill?.[key];
    if (typeof v === "number" && Number.isFinite(v)) { return v; }
    if (typeof v === "string" && v.trim() !== "") {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
};

export interface TableSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    row: FloorRow | null;
    /** Every table on the floor — for the green-seat lookup. */
    allRows: FloorRow[];
    inks: FloorInkSet;
    user: AuthUser;
    /** The live orders feed (already loaded by the page) for the KOT blocks. */
    orders: SheetOrder[];
    onReload: () => void;
    /** Opens the page's move dialog (party + order halves) for this table. */
    onOpenMove: (tableName: string) => void;
    /** Opens the staff order pad in place (docs/parity/order-entry.md). */
    onOpenPad?: (request: OrderPadRequest) => void;
}

export function TableSheet({
    open,
    onOpenChange,
    row,
    allRows,
    inks,
    user,
    orders,
    onReload,
    onOpenMove,
    onOpenPad,
}: TableSheetProps): React.JSX.Element | null {
    const router = useRouter();
    const { toast } = useToast();
    const { currencySymbol } = useCurrency();
    const { timezone } = useTimezone();
    const scope = React.useMemo(() => floorScopeOf(user, "service"), [user]);
    const waiterOnly = isWaiterOnly(user);
    const rid = user.restaurantUsername;

    const name = row?.name ?? "";
    const occupied = row?.seated === true;
    // Flutter `_isAdmin`: the per-line Remove / Move menu (finding 20).
    const isAdmin = user.role === "admin" || (user.role_all ?? []).includes("admin");
    const otherTableNames = React.useMemo(
        () => allRows.map((r) => r.name).filter((n) => n !== "" && n !== name),
        [allRows, name],
    );

    /* ── The bill behind the sheet ─────────────────────────────────── */
    const billFetcher = React.useCallback(async (): Promise<BillDoc | null> => {
        const res = await requestBackend<BillDoc>({
            path: `/bill-for-table?table_name=${encodeURIComponent(name)}`,
            method: "GET",
            restaurantId: rid,
        });
        // 404 = no open bill (the last KOT was cancelled) — a state, not a failure.
        if (res.status === 404) { return null; }
        if (!res.ok) { throw new Error(res.text || "Could not read the bill."); }
        return res.data;
    }, [name, rid]);

    const bill = useCachedFetch<BillDoc | null>(
        `table-bill:${rid}:${name}`,
        billFetcher,
        { enabled: open && occupied && name !== "" },
    );
    const billDoc = bill.data ?? null;

    const money = React.useCallback(
        (n: number): string => `${currencySymbol}${n.toFixed(2)}`,
        [currencySymbol],
    );

    /* ── Derived state ─────────────────────────────────────────────── */
    const billPrinted = row !== null && (row.printed || (billDoc !== null && printedInstantOf(billDoc) !== null));
    const paperStale = billDoc !== null ? paperStaleOf(billDoc) : (row?.paper_stale ?? null);
    const printedSource: BillDoc | null = billDoc ?? row?.raw ?? null;
    const printedClock = printedClockOf(printedInstantOf(printedSource), timezone);
    const printLabel = billPrinted && paperStale === true ? PRINT_UPDATED_BILL_LABEL : PRINT_BILL_LABEL;
    const nextParty = row !== null && isNextPartyRow(row.raw);
    const sentenceName = row !== null ? tableSentenceNameOf(row.raw) : "";
    const seats = row !== null ? seatsLabel(row.raw) : "";

    const kotGroups = React.useMemo(
        () => (name === "" ? [] : groupItemsByKot(orders, name)),
        [orders, name],
    );

    /*
      "VIEW PREVIOUSLY ADDED ITEMS" — the client's second half of the draft ask.

      Keeping the cart (lib/order-draft-store.ts) is no use if the only way to
      discover it is to reopen the pad on the off-chance. The sheet reads the
      draft for THIS table each time it opens and says how much is waiting right
      on the button that reopens it, so a party that has not been seated — or a
      pad somebody closed by mistake — announces itself.

      Read on open only: a draft changes while the PAD is up, and the pad is
      never up at the same time as this sheet.
    */
    const [unsentItems, setUnsentItems] = React.useState(0);
    React.useEffect(() => {
        if (!open || name === "") { setUnsentItems(0); return; }
        const snapshot = readPadDraft(draftStoreKey(rid, { kind: "dine", table: name }));
        setUnsentItems(snapshot === null ? 0 : draftCartCount(snapshot.draft));
    }, [open, name, rid]);

    /* ── The clocks (server-owned; this only ticks the display) ────── */
    const [tickMs, setTickMs] = React.useState(0);
    const tickOriginRef = React.useRef(monotonicNow());
    React.useEffect(() => {
        if (!open) { return; }
        tickOriginRef.current = monotonicNow();
        setTickMs(0);
        const id = window.setInterval(() => {
            setTickMs(Math.max(0, monotonicNow() - tickOriginRef.current));
        }, 1000);
        return () => { window.clearInterval(id); };
    }, [open, billDoc]);

    const tableClock = React.useMemo(
        () => (billDoc !== null ? readServiceClock({ service: billDoc.service }) : null),
        [billDoc],
    );
    const latestOrderClock = React.useMemo(() => {
        if (billDoc === null || bstr(billDoc, "last_order_at") === bstr(billDoc, "first_order_at")) { return null; }
        let best: { at: number; clock: ReturnType<typeof readServiceClock> } | null = null;
        for (const order of orders) {
            if ((order.table ?? "").toLowerCase() !== name.toLowerCase()) { continue; }
            if (order.status === "Cancelled" || order.status === "Closed") { continue; }
            const at = Date.parse(order.created_at ?? "");
            if (!Number.isFinite(at)) { continue; }
            if (best === null || at > best.at) { best = { at, clock: readServiceClock(order) }; }
        }
        return best?.clock ?? null;
    }, [billDoc, orders, name]);

    /* ── Dialog state ──────────────────────────────────────────────── */
    type DialogKind =
        | { kind: "covers"; forSeat: boolean }
        | { kind: "print" }
        | { kind: "addToPrinted"; green: FloorRow | null }
        | { kind: "release" }
        | { kind: "merge" }
        | { kind: "discount" }
        | { kind: "coupon" }
        | { kind: "split" }
        | { kind: "splitResult"; grandTotal: number | null; parts: { label: string; total: number | null }[] }
        | { kind: "assignWaiter"; employees: AssignableWaiter[] }
        | { kind: "staleSettle"; warning: string }
        | { kind: "customer" }
        /* One whole ticket on its way to another table — see moveKot below. */
        | { kind: "moveKot"; order: SheetOrder; label: string }
        | null;
    const [dialog, setDialog] = React.useState<DialogKind>(null);
    const [busy, setBusy] = React.useState(false);
    const [coversText, setCoversText] = React.useState("2");
    const [discountType, setDiscountType] = React.useState<"percent" | "flat">("percent");
    const [fieldText, setFieldText] = React.useState("");
    const [mergeFrom, setMergeFrom] = React.useState("");
    const [payOpen, setPayOpen] = React.useState(false);
    const [compOpen, setCompOpen] = React.useState(false);
    const mayComp = can(user, "comp_item");

    React.useEffect(() => {
        // Reopening on a different table must not carry the last table's dialog.
        setDialog(null);
        setBusy(false);
    }, [name, open]);

    /* ── QR ────────────────────────────────────────────────────────── */
    const orderUrl = row !== null && typeof window !== "undefined"
        ? tableOrderUrl(window.location.origin, rid, row)
        : "";
    const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null);
    React.useEffect(() => {
        if (!open || !scope.guestQr || orderUrl === "") { setQrDataUrl(null); return; }
        let active = true;
        void (QRCode as { toDataURL: (text: string, opts: Record<string, unknown>) => Promise<string> })
            .toDataURL(orderUrl, { width: 340, margin: 1 })
            .then((url) => { if (active) { setQrDataUrl(url); } })
            .catch(() => { if (active) { setQrDataUrl(null); } });
        return () => { active = false; };
    }, [open, scope.guestQr, orderUrl]);

    if (row === null) { return null; }

    const finishAndReload = (): void => {
        onOpenChange(false);
        onReload();
    };

    const failToast = (title: string, error: unknown): void => {
        toast({
            title,
            description: error instanceof Error ? error.message : String(error),
            variant: "destructive",
        });
    };

    /* ── Actions ───────────────────────────────────────────────────── */

    const openOrders = (opts?: {
        preview?: boolean;
        addToPrinted?: boolean;
        table?: string;
        /** The pad's target was just seated (or is a free green seat to be). */
        seated?: boolean;
        occupyOnSend?: boolean;
        parentTable?: string | null;
    }): void => {
        if (opts?.preview !== true && onOpenPad) {
            onOpenChange(false);
            onOpenPad({
                kind: "dine",
                table: opts?.table ?? name,
                parentTable: opts?.table !== undefined ? (opts.parentTable ?? null) : parentTableOf(row.raw),
                /*
                  OCCUPANCY FOLLOWS THE ORDER, FOR EVERYONE.

                  ITEM 16 gave this to readers with no seating control only, so
                  an admin who tapped "Add order" on a FREE table filled a cart,
                  pressed Send and met the server's flat refusal — "Cannot add
                  order to unoccupied table. Please occupy the table first." —
                  with the whole order still on screen and nothing to do about
                  it but close the pad and start again. Client: "can we do
                  something where they can start taking orders and just put
                  number of guests after taking order".

                  Now any send onto a table that is not yet occupied asks for the
                  cover count at Send (the pad's own "Number of guests" step) and
                  seats the table a moment before the order goes in, which is the
                  same two calls in the same order the waiter path already made.
                  "Seat guests & take order" is untouched for anyone who prefers
                  to seat first — this only removes the dead end.
                */
                occupyOnSend: opts?.occupyOnSend ?? (opts?.seated !== true && !occupied),
                addToPrintedBill: opts?.addToPrinted === true,
            });
            return;
        }
        const params = new URLSearchParams();
        params.set("table", opts?.table ?? name);
        if (opts?.preview) { params.set("preview", "1"); }
        if (opts?.addToPrinted) { params.set("addToPrinted", "1"); }
        onOpenChange(false);
        router.push(`/dashboard/orders?${params.toString()}`);
    };

    const seatGuests = async (covers: number): Promise<void> => {
        setBusy(true);
        try {
            const res = await occupyTable(rid, name, covers);
            const assignment = res.assignment;
            const unattended = seatingLeftTableUnattended(assignment);
            toast({
                title: unattended ? "Seated — but no waiter assigned" : `Seated ${name}`,
                description: assignment ? assignment.message : `${name} is now occupied with ${covers} cover${covers === 1 ? "" : "s"}.`,
                variant: unattended ? "destructive" : undefined,
            });
            setDialog(null);
            onReload();
            // Mirrors the app's _seat(): seating flows straight into order entry.
            openOrders({ seated: true });
        } catch (error: unknown) {
            failToast("Unable to seat the table", error);
        } finally {
            setBusy(false);
        }
    };

    const updateCovers = async (covers: number): Promise<void> => {
        setBusy(true);
        try {
            await updateTableCovers(rid, name, covers);
            toast({ title: "Covers updated", description: `${name} now has ${covers} cover${covers === 1 ? "" : "s"}.` });
            setDialog(null);
            onReload();
        } catch (error: unknown) {
            failToast("Unable to update covers", error);
        } finally {
            setBusy(false);
        }
    };

    /*
      MOVE THE WHOLE TICKET, NOT ONE DISH AT A TIME.

      Client: "I'm only able to move each individual item to another table,
      ideally I should be able to move every KOT to another table." The per-line
      ⋮ menu moved ONE dish (PATCH the bill item); a KOT of six lines therefore
      meant six moves, six correction dockets and six chances to leave a line
      behind on the wrong table.

      The server has always had the right call for this — POST /tables/move-order
      takes the ORDER, which in this schema IS the kitchen docket (see
      lib/kot-groups.ts) — and the Tables page's own move dialog already used it.
      It just was not reachable from the place the KOT is actually read, which is
      this sheet. One call, one atomic move, one correction docket carrying the
      SAME KOT number, and the destination may be occupied: moving a mis-keyed
      ticket onto a table that already has guests is the ordinary case.
    */
    const moveKot = async (order: SheetOrder, toTable: string): Promise<void> => {
        setBusy(true);
        try {
            const result = await moveOrderToTable(rid, order.id, toTable);
            if (isRefusedAction(result)) {
                toast({ title: "KOT not moved", description: result.error, variant: "destructive" });
                return;
            }
            const served = movedDishesOf(result);
            toast({
                title: "KOT moved",
                description: movedOrderDishesSentence({
                    toTable: result.to_table,
                    printed: result.print?.printed === true,
                    kotNo: result.print?.kot_no,
                    dishes: served.length > 0 ? served : orderDishLines(order as unknown as Record<string, unknown>),
                }),
            });
            // A move between printed bills names the reprints it caused.
            const reprints = readReprintNeeded(result);
            if (reprints.length > 0) { announceReprintNeeded(reprints); }
            setDialog(null);
            bill.retry();
            onReload();
        } catch (error: unknown) {
            failToast("Unable to move that KOT", error);
        } finally {
            setBusy(false);
        }
    };

    const release = async (): Promise<void> => {
        setBusy(true);
        try {
            const result = await releaseTable(rid, name);
            if (isRefusedAction(result)) {
                toast({ title: "Table not released", description: result.error, variant: "destructive" });
                return;
            }
            toast({ title: "Table released", description: `${name} is now available.` });
            setDialog(null);
            finishAndReload();
        } catch (error: unknown) {
            failToast("Unable to release table", error);
        } finally {
            setBusy(false);
        }
    };

    // The print itself (POST /print/bill) — the server's thermal print and its
    // print ledger. Reached only from the preview's Print (or, for a waiter-only
    // session, the money-free confirm), so a cancelled preview claims nothing.
    const printBill = async (): Promise<boolean> => {
        setBusy(true);
        try {
            const { nextParty: seat } = await printTableBill(rid, name);
            toast({
                title: seat.message !== null ? `Printing bill… ${seat.message}` : "Printing bill…",
            });
            setDialog(null);
            onReload();
            bill.refresh();
            return true;
        } catch (error: unknown) {
            failToast("Unable to print the bill", error);
            return false;
        } finally {
            setBusy(false);
        }
    };

    const openAddToPrinted = (): void => {
        const green = greenSeatFor(
            row.raw,
            allRows.map((r) => r.raw),
            (r) => !tableSeated(r) && r.has_order !== true && r.reserved !== true && r.booked !== true,
        );
        const greenRow = green === null
            ? null
            : allRows.find((r) => r.raw === green) ?? null;
        setDialog({ kind: "addToPrinted", green: greenRow });
    };

    const merge = async (): Promise<void> => {
        if (mergeFrom === "") { return; }
        setBusy(true);
        try {
            const res = await mergeTableBills(rid, mergeFrom, name);
            const reprints = readReprintNeeded(res);
            toast({ title: "Tables merged", description: `Merged Table ${mergeFrom} into ${name}.` });
            if (reprints.length > 0) { announceReprintNeeded(reprints); }
            setDialog(null);
            onReload();
            bill.refresh();
        } catch (error: unknown) {
            failToast("Unable to merge", error);
        } finally {
            setBusy(false);
        }
    };

    const applyDiscount = async (remove: boolean): Promise<void> => {
        const value = remove ? 0 : Number(fieldText.trim());
        if (!remove && (!Number.isFinite(value) || value <= 0)) { return; }
        setBusy(true);
        try {
            const { pending } = await setBillDiscount(rid, name, discountType, value);
            toast({
                title: pending
                    ? "Discount sent for manager approval — it will apply once approved."
                    : value > 0 ? "Discount applied." : "Discount removed.",
            });
            setDialog(null);
            onReload();
            bill.refresh();
        } catch (error: unknown) {
            failToast("Unable to apply the discount", error);
        } finally {
            setBusy(false);
        }
    };

    const applyCoupon = async (): Promise<void> => {
        const code = fieldText.trim();
        if (code === "") { return; }
        setBusy(true);
        try {
            const discount = await applyBillCoupon(rid, name, code);
            toast({ title: discount !== null ? `Coupon applied — ${money(discount)} off.` : "Coupon applied." });
            setDialog(null);
            onReload();
            bill.refresh();
        } catch (error: unknown) {
            failToast("Unable to apply the coupon", error);
        } finally {
            setBusy(false);
        }
    };

    const split = async (): Promise<void> => {
        const parts = Number(fieldText.trim());
        if (!Number.isInteger(parts) || parts < 2) { return; }
        setBusy(true);
        try {
            const result = await splitBillEvenly(rid, name, parts);
            setDialog({ kind: "splitResult", grandTotal: result.grand_total, parts: result.parts });
        } catch (error: unknown) {
            failToast("Unable to split the bill", error);
        } finally {
            setBusy(false);
        }
    };

    const openAssignWaiter = async (): Promise<void> => {
        setBusy(true);
        try {
            const roster = await fetchAssignableWaiters(rid);
            if (roster.employees.length === 0 && roster.attendanceInUse) {
                toast({
                    title: "No staff are clocked in right now — staff must clock in before they can be assigned a table.",
                });
                return;
            }
            setDialog({ kind: "assignWaiter", employees: roster.employees });
        } catch (error: unknown) {
            failToast("Could not read the staff list", error);
        } finally {
            setBusy(false);
        }
    };

    const assignWaiter = async (employee: AssignableWaiter): Promise<void> => {
        setBusy(true);
        try {
            const ok = await assignTableToEmployee(rid, user.employeeId, user.outlet_id, name, employee.employee_id);
            if (!ok) { throw new Error("The assignment was refused."); }
            toast({ title: `Waiter assigned`, description: `${employee.emp_Fname} ${employee.emp_Lname}`.trim() + ` now covers ${name}.` });
            setDialog(null);
            onReload();
        } catch (error: unknown) {
            failToast("Unable to assign the waiter", error);
        } finally {
            setBusy(false);
        }
    };

    const removeWaiter = async (): Promise<void> => {
        setBusy(true);
        try {
            const ok = await unassignTableEmployee(rid, user.employeeId, user.outlet_id, name);
            if (!ok) { throw new Error("The unassignment was refused."); }
            toast({ title: "Waiter removed", description: `${name} has no waiter assigned.` });
            onReload();
        } catch (error: unknown) {
            failToast("Unable to remove the waiter", error);
        } finally {
            setBusy(false);
        }
    };

    const approvePayment = async (withStalePaper: boolean): Promise<void> => {
        const orderIds = Array.isArray(billDoc?.order_ids) ? (billDoc.order_ids as unknown[]) : [];
        const first = orderIds[0];
        const orderId = typeof first === "string" ? first : typeof first === "number" ? String(first) : "";
        if (orderId === "") { return; }
        setBusy(true);
        try {
            await approvePaymentAndClose(rid, orderId, withStalePaper);
            toast({ title: "Payment approved — table freed." });
            setDialog(null);
            finishAndReload();
        } catch (error: unknown) {
            failToast("Unable to approve the payment", error);
        } finally {
            setBusy(false);
        }
    };

    const startApprovePayment = (): void => {
        const warning = stalePaperSettleWarning({
            paperStale,
            printedClock,
            printedTotal: printedTotalOf(billDoc),
            grandTotal: billDoc !== null ? bnum(billDoc, "grand_total") : null,
            money,
        });
        if (warning !== null) {
            setDialog({ kind: "staleSettle", warning });
        } else {
            void approvePayment(false);
        }
    };

    const printQr = (): void => {
        if (qrDataUrl === null) { return; }
        const win = window.open("", "_blank", "width=420,height=640");
        if (!win) { return; }
        const doc = win.document;
        doc.title = `Table ${name} QR`;
        doc.body.style.cssText = "font-family:sans-serif;text-align:center;padding:24px";
        const heading = doc.createElement("h2");
        heading.textContent = `Scan to order — Table ${name}`;
        const image = doc.createElement("img");
        image.width = 260;
        image.height = 260;
        image.alt = "QR";
        const caption = doc.createElement("p");
        caption.style.cssText = "font-size:9px;word-break:break-all";
        caption.textContent = orderUrl;
        doc.body.append(heading, image, caption);
        let printed = false;
        const printOnce = (): void => {
            if (printed) { return; }
            printed = true;
            win.print();
        };
        image.addEventListener("load", printOnce, { once: true });
        image.src = qrDataUrl;
        win.setTimeout(printOnce, 400);
    };

    /* ── Pieces ────────────────────────────────────────────────────── */

    const items = occupied && billDoc !== null && Array.isArray(billDoc.items)
        ? (billDoc.items as BillDoc[])
        : [];

    const customerName = bstr(billDoc, "customer");
    const customerGstin = bstr(billDoc, "customer_gstin");
    const customerAddress = bstr(billDoc, "customer_address");
    const paymentPendingApproval = bstr(billDoc, "payment_status") === "pending_approval";

    const state = row.state;
    const nc = bnum(billDoc, "nc_total");
    const billOrderIds = billDoc !== null && Array.isArray(billDoc.order_ids)
        ? (billDoc.order_ids as unknown[]).map((id) => String(id))
        : [];
    const discount = bnum(billDoc, "discount");
    const serviceCharge = bnum(billDoc, "service_charge");
    const taxTotal = bnum(billDoc, "tax_total");
    const roundOff = bnum(billDoc, "round_off");
    const apcStatus = bstr(billDoc, "apc_status") || "neutral";
    const apcSuggestions = Array.isArray(billDoc?.apc_suggestions)
        ? (billDoc.apc_suggestions as unknown[]).filter((s): s is string => typeof s === "string")
        : [];

    const spanReading = tableClock !== null ? elapsedToSettlement(tableClock, tickMs) : null;
    // "Latest order" escalates in the KITCHEN's colours — the shared 10/15
    // rule (elapsedTone), not the floor's old 20/45 wait tone.
    const latestOrderMs = latestOrderClock !== null ? elapsedSincePlaced(latestOrderClock, tickMs) : null;

    const heroButtons = (
        <div className="space-y-2.5">
            {occupied && billPrinted && scope.addToPrinted ? (
                <Button size="lg" className="w-full" disabled={busy} onClick={openAddToPrinted}>
                    <Plus /> {ADD_TO_PRINTED_BILL_ACTION}
                </Button>
            ) : (
                <Button size="lg" className="w-full" disabled={busy} onClick={() => { openOrders(); }}>
                    <Plus /> {unsentItems > 0
                        ? `Add order · ${String(unsentItems)} unsent item${unsentItems === 1 ? "" : "s"} waiting`
                        : "Add order"}
                </Button>
            )}
            {/* An EMPTY table's seating sits directly under "Add order": the two
                things a free table is opened to do, in the order they are done.
                (The app keeps it under "Actions"; the web puts it here.) */}
            {!occupied && scope.seat ? (
                <Button size="lg" variant="outline" className="w-full" disabled={busy}
                    onClick={() => { setCoversText("2"); setDialog({ kind: "covers", forSeat: true }); }}>
                    <Users /> Seat guests &amp; take order
                </Button>
            ) : null}
            {occupied ? (
                <Button size="lg" variant="outline" className="w-full" disabled={busy} onClick={() => { setDialog({ kind: "print" }); }}>
                    <Printer /> {printLabel}
                </Button>
            ) : null}
            {occupied && scope.moveTable ? (
                <Button size="lg" variant="outline" className="w-full" disabled={busy} onClick={() => { onOpenChange(false); onOpenMove(name); }}>
                    <ArrowLeftRight /> Move table
                </Button>
            ) : null}
        </div>
    );

    return (
        <>
            <DrillSheet
                open={open}
                onOpenChange={onOpenChange}
                eyebrow={nextParty ? `Bill reads ${name}` : undefined}
                title={(
                    <span className="inline-flex max-w-full items-center gap-2">
                        <span className="min-w-0 truncate">Table {sentenceName}</span>
                        <FloorChip label={FLOOR_STATE_WORDS[state]} color={inks[state]} dense={false} />
                    </span>
                )}
                action={(
                    <DrillSheetAction
                        module="Orders"
                        onClick={() => { openOrders({ preview: occupied }); }}
                    />
                )}
            >
                <div className="space-y-4">
                    {/* Chips: seats, clubbed, the two SERVER clocks (D2 then D1). */}
                    <div className="flex flex-wrap items-center gap-1.5">
                        {seats !== "" ? <InfoChip icon={<Users />} label={seats} /> : null}
                        {occupied && row.covers !== null ? <InfoChip icon={<Users />} label={`${String(row.covers)} covers`} /> : null}
                        {row.clubbed_with.length > 0 ? (
                            <InfoChip label={`Clubbed with ${row.clubbed_with.join(" + ")}`} />
                        ) : null}
                        {spanReading !== null && tableClock !== null ? (
                            <InfoChip
                                label={`${tableClock.running ? "On table" : "Took"} ${formatDuration(spanReading.ms)}`}
                            />
                        ) : null}
                        {latestOrderMs !== null ? (
                            <InfoChip
                                label={`Latest order ${formatDuration(latestOrderMs)}`}
                                className={LATEST_ORDER_TONE[elapsedTone(latestOrderMs)]}
                            />
                        ) : null}
                    </div>

                    {/* "Printed 13:32 · Updated — print again" — the orange banner. */}
                    {occupied && billPrinted ? (
                        <ForkCard inset className="flex items-center gap-2.5 !p-3">
                            <Receipt aria-hidden className="h-4 w-4 shrink-0" style={{ color: inks.printed }} />
                            <span className="min-w-0 text-[13px] font-semibold" style={{ color: inks.printed }}>
                                {printedTileChips({
                                    printedClock,
                                    paperStale,
                                    printedAs: printedAsOf(printedSource),
                                }).join(" · ")}
                            </span>
                        </ForkCard>
                    ) : null}

                    {/* Guest name / GSTIN / address on the bill. */}
                    {occupied && billDoc !== null && (scope.billOps || customerName !== "" || customerGstin !== "" || customerAddress !== "") ? (
                        <ForkCard inset className="!p-3">
                            <div className="flex items-start gap-2.5">
                                <UserRound aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                                <div className="min-w-0 flex-1">
                                    <div className={cn("truncate", customerName === "" ? "text-xs text-muted-foreground" : "text-[13px] font-semibold text-foreground")}>
                                        {customerName === "" ? "No guest name on the bill" : customerName}
                                    </div>
                                    {customerGstin !== "" ? <div className="text-xs text-muted-foreground">GSTIN {customerGstin}</div> : null}
                                    {customerAddress !== "" ? (() => {
                                        const lines = customerAddress.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
                                        return (
                                            <div className="truncate text-xs text-muted-foreground">
                                                {lines[0]}{lines.length > 1 ? ` (+${String(lines.length - 1)} more)` : ""}
                                            </div>
                                        );
                                    })() : null}
                                </div>
                            </div>
                            {scope.billOps ? (
                                <div className="mt-2 flex justify-end">
                                    <Button variant="ghost" size="sm" onClick={() => { setDialog({ kind: "customer" }); }}>
                                        Edit name / GSTIN / address
                                    </Button>
                                </div>
                            ) : null}
                        </ForkCard>
                    ) : null}

                    {/* 6.7 — Add order and Print bill lead the sheet, hero size. */}
                    {heroButtons}

                    {/* The guest QR — never for a waiter. */}
                    {scope.guestQr && qrDataUrl !== null ? (
                        <div className="flex flex-col items-center gap-2">
                            <div className="rounded-[10px] bg-white p-2.5">
                                {/* A data-URL QR; next/image adds nothing here. */}
                                <img src={qrDataUrl} alt={`Order QR for ${name}`} width={170} height={170} />
                            </div>
                            <div className="text-xs text-muted-foreground">Customers scan to order &amp; pay</div>
                            {occupied && row.order_otp !== "" ? (
                                <>
                                    <span className="inline-flex items-center gap-1.5 rounded-[7px] border border-accent-mid/40 bg-accent-deep/15 px-3 py-1.5">
                                        <Lock aria-hidden className="h-3.5 w-3.5 text-accent-foreground" />
                                        <span className="text-[15px] font-bold tracking-[0.15em] text-accent-foreground">OTP {row.order_otp}</span>
                                    </span>
                                    <div className="text-[11px] text-tertiary">Read this out — guests enter it before they can order</div>
                                </>
                            ) : null}
                            <div className="max-w-full select-all break-all text-center text-[10.5px] text-tertiary">{orderUrl}</div>
                            <Button variant="outline" size="sm" onClick={printQr}>
                                <Printer /> Print QR
                            </Button>
                        </div>
                    ) : null}

                    {/* Waiter row — Assign / Change / Remove. */}
                    {scope.assignWaiter ? (
                        <ForkCard inset className="flex items-center gap-2.5 !p-3">
                            <BadgeCheck aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                                {row.waiter_name !== null && row.waiter_name !== "—" ? `Waiter: ${row.waiter_name}` : "No waiter assigned"}
                            </span>
                            <Button variant="ghost" size="sm" disabled={busy} onClick={() => { void openAssignWaiter(); }}>
                                {row.waiter_name !== null && row.waiter_name !== "—" ? "Change" : "Assign"}
                            </Button>
                            {row.waiter_name !== null && row.waiter_name !== "—" ? (
                                <Button variant="ghost" size="sm" disabled={busy} onClick={() => { void removeWaiter(); }}>
                                    Remove
                                </Button>
                            ) : null}
                        </ForkCard>
                    ) : null}

                    {/* Bill loading / error, then the KOT blocks and the bill card. */}
                    {occupied && bill.loading ? <SkeletonRows rows={2} title={false} /> : null}
                    {occupied && bill.error != null ? (
                        <LoadErrorState
                            whatFailed={`Couldn't load ${name}'s bill.`}
                            error={bill.error}
                            onRetry={bill.retry}
                        />
                    ) : null}

                    {occupied && billDoc !== null ? (
                        <>
                            {items.length > 0 ? (
                                <div>
                                    <SectionHeader title="Orders" count={items.length} />
                                    {kotGroups.length > 0 ? (
                                        kotGroups.map((group) => (
                                            <div key={group.key} className="mb-3">
                                                <div className="mb-1.5 flex min-h-[22px] items-center justify-between gap-2">
                                                    <div className="micro-label min-w-0 truncate">
                                                        {group.label}
                                                        {/* Finding 18 — a ticket moved here from another table. */}
                                                        {movedFromOf(group.order) !== "" ? ` · from ${movedFromOf(group.order)}` : ""}
                                                    </div>
                                                    {/* The whole docket to another table — one call, one
                                                        correction slip (moveKot). Only on a numbered ticket:
                                                        the trailing "No KOT number" block gathers several
                                                        orders and is not one thing to move. */}
                                                    {scope.moveOrder && group.order !== null && otherTableNames.length > 0 ? (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-7 shrink-0 px-2 text-[11px]"
                                                            disabled={busy}
                                                            onClick={() => {
                                                                const order = group.order;
                                                                if (order !== null) { setDialog({ kind: "moveKot", order, label: group.label }); }
                                                            }}
                                                        >
                                                            <ArrowLeftRight className="!h-3.5 !w-3.5" /> Move KOT
                                                        </Button>
                                                    ) : null}
                                                </div>
                                                {group.items.map((item, i) => {
                                                    const qty = item.quantity || 1;
                                                    const priceText = visibleMoneyText(
                                                        currencySymbol,
                                                        visibleAmount(user, (item as { price?: unknown }).price) !== null
                                                            ? (visibleAmount(user, (item as { price?: unknown }).price) ?? 0) * qty
                                                            : null,
                                                    );
                                                    const note = typeof (item as { note?: unknown }).note === "string" ? ((item as { note?: unknown }).note as string) : "";
                                                    return (
                                                        <div key={`${group.key}-${String(i)}`} className="mb-1.5 flex items-center gap-1 rounded-lg border border-border bg-inset py-1.5 pl-3 pr-1">
                                                            <div className="min-w-0 flex-1">
                                                                <div className="truncate text-[13px] font-semibold text-foreground">
                                                                    {qty} × {item.name}
                                                                </div>
                                                                {note !== "" ? (
                                                                    <div className="mt-0.5 flex items-start gap-1.5 text-[11px] italic text-muted-foreground">
                                                                        <StickyNote aria-hidden className="mt-px h-3 w-3 shrink-0" />
                                                                        <span className="min-w-0">{note}</span>
                                                                    </div>
                                                                ) : null}
                                                            </div>
                                                            {priceText !== null ? (
                                                                <span className="ml-2 text-[13px] font-semibold tabular-nums text-foreground">{priceText}</span>
                                                            ) : null}
                                                            <KotLineActions
                                                                restaurantId={rid}
                                                                tableName={name}
                                                                item={{ name: item.name, price: Number((item as { price?: unknown }).price) || 0, note }}
                                                                isAdmin={isAdmin}
                                                                otherTables={otherTableNames}
                                                                onChanged={() => { bill.retry(); onReload(); }}
                                                            />
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ))
                                    ) : null}
                                </div>
                            ) : null}

                            {scope.money ? (
                                <div>
                                    <SectionHeader title="Bill" />
                                    <ForkCard inset className="!px-4 !py-3.5">
                                        <BillRow label="Subtotal" value={money(bnum(billDoc, "subtotal") || bnum(billDoc, "total_amt"))} />
                                        {nc > 0 ? <BillRow label="Non-chargeable (given away)" value={money(nc)} /> : null}
                                        {discount > 0 ? (
                                            <BillRow
                                                label={`Discount${bstr(billDoc, "discount_type") === "percent" ? ` (${String(bnum(billDoc, "discount_value"))}%)` : ""}`}
                                                value={`− ${money(discount)}`}
                                            />
                                        ) : null}
                                        {serviceCharge > 0 ? <BillRow label="Service charge" value={money(serviceCharge)} /> : null}
                                        {taxTotal > 0 ? <BillRow label="Tax" value={money(taxTotal)} /> : null}
                                        {roundOff !== 0 ? <BillRow label="Round off" value={money(roundOff)} /> : null}
                                        <div className="my-2 border-t border-divider" />
                                        <div className="flex items-end justify-between gap-3">
                                            <span className="micro-label">Total payable</span>
                                            <span className="display-sm tabular-nums">{money(bnum(billDoc, "grand_total") || bnum(billDoc, "total_amt"))}</span>
                                        </div>
                                        <div className="mt-3.5 flex gap-6">
                                            <MicroStat value={bstr(billDoc, "covers") || "—"} label="covers" />
                                            <MicroStat value={money(bnum(billDoc, "apc"))} label="apc" />
                                            {bnum(billDoc, "target_apc") !== 0 ? (
                                                <MicroStat value={money(bnum(billDoc, "target_apc"))} label="target apc" />
                                            ) : null}
                                        </div>
                                    </ForkCard>
                                    {apcStatus !== "neutral" ? (
                                        <ApcInsight status={apcStatus} suggestions={apcSuggestions} />
                                    ) : null}
                                </div>
                            ) : null}

                            {/* The merged "Remove service charge & print" (client item 6). */}
                            <ServiceChargeBlock
                                restaurantId={rid}
                                user={user}
                                bill={billDoc}
                                tableName={name}
                                showsMoney={scope.money}
                                onChanged={() => { bill.retry(); onReload(); }}
                            />

                            {scope.billOps ? (
                                <div className="flex flex-wrap gap-2">
                                    <Button variant="outline" size="sm" disabled={busy} onClick={() => {
                                        setDiscountType(bstr(billDoc, "discount_type") === "flat" ? "flat" : "percent");
                                        setFieldText(bnum(billDoc, "discount_value") > 0 ? String(bnum(billDoc, "discount_value")) : "");
                                        setDialog({ kind: "discount" });
                                    }}>
                                        <Percent /> {discount > 0 ? "Edit discount" : "Discount"}
                                    </Button>
                                    <Button variant="outline" size="sm" disabled={busy} onClick={() => {
                                        setFieldText(bstr(billDoc, "coupon_code"));
                                        setDialog({ kind: "coupon" });
                                    }}>
                                        <Tag /> {bstr(billDoc, "coupon_code") !== "" ? `Coupon: ${bstr(billDoc, "coupon_code")}` : "Coupon"}
                                    </Button>
                                    <Button variant="outline" size="sm" disabled={busy} onClick={() => { setFieldText("2"); setDialog({ kind: "split" }); }}>
                                        <Split /> Split
                                    </Button>
                                    <Button variant="outline" size="sm" disabled={busy} onClick={() => { setMergeFrom(""); setDialog({ kind: "merge" }); }}>
                                        <Merge /> Merge
                                    </Button>
                                </div>
                            ) : null}

                            {/* The guest paid from the QR page — review & approve. */}
                            {scope.settle && paymentPendingApproval ? (
                                <ForkCard inset className="!p-3.5 border-warning/40">
                                    <div className="flex items-center gap-2.5">
                                        <BadgeCheck aria-hidden className="h-4 w-4 shrink-0 text-warning" />
                                        <span className="min-w-0 text-[13px] font-semibold text-foreground">
                                            Customer paid via {bstr(billDoc, "payment_method") || "unknown method"} — review &amp; approve
                                        </span>
                                    </div>
                                    {bstr(billDoc, "screenshot_url").startsWith("http") ? (
                                        <a
                                            href={bstr(billDoc, "screenshot_url")}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="mt-2 block text-xs text-accent-foreground underline"
                                        >
                                            View payment screenshot
                                        </a>
                                    ) : null}
                                    <div className="mt-3 flex justify-end">
                                        <Button disabled={busy} onClick={startApprovePayment}>
                                            <CircleCheck /> Approve payment &amp; close
                                        </Button>
                                    </div>
                                </ForkCard>
                            ) : null}
                        </>
                    ) : null}

                    {/* Actions. A FREE table has none left under this heading:
                        its seating moved up beside "Add order" (heroButtons),
                        which is where anyone opening an empty table looks. */}
                    {occupied ? <SectionHeader title="Actions" /> : null}
                    {occupied ? (
                        <div className="flex flex-wrap justify-center gap-2.5">
                            {scope.seat && scope.settle ? (
                                <Button
                                    disabled={busy || billDoc === null}
                                    onClick={() => {
                                        if (billOrderIds.length === 0) {
                                            toast({ title: "No orders to settle on this table." });
                                            return;
                                        }
                                        setPayOpen(true);
                                    }}
                                >
                                    <Receipt /> Settle bill
                                </Button>
                            ) : null}
                            {mayComp && scope.managerOnlyAsks && billDoc !== null ? (
                                <Button variant="outline" disabled={busy} onClick={() => { setCompOpen(true); }}>
                                    Comp a dish
                                </Button>
                            ) : null}
                            {scope.moveOrder ? (
                                <Button variant="outline" disabled={busy} onClick={() => { onOpenChange(false); onOpenMove(name); }}>
                                    Move an order
                                </Button>
                            ) : null}
                            <Button variant="outline" disabled={busy} onClick={() => { setCoversText(String(row.covers ?? row.capacity)); setDialog({ kind: "covers", forSeat: false }); }}>
                                Update covers
                            </Button>
                            {scope.release ? (
                                <Button variant="ghost" disabled={busy} onClick={() => { setDialog({ kind: "release" }); }}>
                                    <LogOut /> Release without payment
                                </Button>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            </DrillSheet>

            {/* ── Dialogs ───────────────────────────────────────────── */}

            {payOpen && billOrderIds.length > 0 ? (
                <PaymentSheet
                    open={payOpen}
                    onOpenChange={setPayOpen}
                    restaurantId={rid}
                    user={user}
                    orderId={billOrderIds[0]}
                    tableName={name}
                    fallbackTotal={billDoc !== null ? (bnum(billDoc, "grand_total") || bnum(billDoc, "total_amt")) : null}
                    paperBill={billDoc}
                    onSettled={finishAndReload}
                />
            ) : null}
            {compOpen ? (
                <CompSheet
                    open={compOpen}
                    onOpenChange={setCompOpen}
                    restaurantId={rid}
                    user={user}
                    tableName={name}
                    orderIds={billOrderIds}
                    onChanged={() => { bill.retry(); onReload(); }}
                />
            ) : null}

            {/* Where this whole docket goes. EVERY other table is offered,
                occupied ones included — the ticket was rung in on the wrong
                table and the right one usually has guests on it already
                (lib/table-move.ts orderMoveDestinations says why at length). */}
            <Dialog open={dialog?.kind === "moveKot"} onOpenChange={(o) => { if (!o && !busy) { setDialog(null); } }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Move {dialog?.kind === "moveKot" ? dialog.label : "this KOT"} to…</DialogTitle>
                        <DialogDescription>
                            The whole ticket moves in one go. A correction docket carrying the same KOT number
                            prints for the new table — tell the pass.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid max-h-[50vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                        {otherTableNames.map((t) => (
                            <Button
                                key={t}
                                variant="outline"
                                disabled={busy}
                                onClick={() => {
                                    if (dialog?.kind === "moveKot") { void moveKot(dialog.order, t); }
                                }}
                            >
                                Table {t}
                            </Button>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={dialog?.kind === "covers"} onOpenChange={(o) => { if (!o) { setDialog(null); } }}>
                <DialogContent className="sm:max-w-[360px]">
                    <DialogHeader>
                        <DialogTitle>How many people?</DialogTitle>
                        <DialogDescription className="sr-only">Number of covers</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-2">
                        <Label htmlFor="sheet-covers">Number of people</Label>
                        <Input
                            id="sheet-covers"
                            type="number"
                            min={1}
                            autoFocus
                            value={coversText}
                            onChange={(e) => { setCoversText(e.target.value); }}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setDialog(null); }}>Cancel</Button>
                        <Button
                            disabled={busy}
                            onClick={() => {
                                const covers = Math.max(1, Math.round(Number(coversText.trim()) || 1));
                                if (dialog?.kind === "covers" && dialog.forSeat) { void seatGuests(covers); } else { void updateCovers(covers); }
                            }}
                        >
                            {dialog?.kind === "covers" && dialog.forSeat ? "Seat" : "Save"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Finding 1–3: seniors get the in-place paper preview (nothing is
                claimed until Print); a waiter-only session skips the priced
                preview (item 19) and confirms without money. */}
            {!waiterOnly ? (
                <BillPreviewDialog
                    open={dialog?.kind === "print"}
                    onOpenChange={(o) => { if (!o) { setDialog(null); } }}
                    restaurantId={rid}
                    tableName={name}
                    printedFallback={billPrinted}
                    onPrint={printBill}
                />
            ) : null}
            <AlertDialog open={waiterOnly && dialog?.kind === "print"} onOpenChange={(o) => { if (!o) { setDialog(null); } }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {printLabel === PRINT_UPDATED_BILL_LABEL
                                ? `Print the updated bill for ${name}?`
                                : `Print the bill for ${name}?`}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {items.length > 0 ? `${items.length} item(s) on this table. ` : ""}
                            {printLabel === PRINT_UPDATED_BILL_LABEL
                                ? "The updated bill goes to the guest and replaces the one they have."
                                : "The printed bill goes to the guest."}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction disabled={busy} onClick={() => { void printBill(); }}>Print</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={dialog?.kind === "addToPrinted"} onOpenChange={(o) => { if (!o) { setDialog(null); } }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{addToPrintedBillLabel(name, parentTableOf(row.raw))}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {addToPrintedBillConfirm({
                                table: name,
                                parentTable: parentTableOf(row.raw),
                                printedClock,
                                hasGreen: dialog?.kind === "addToPrinted" && dialog.green !== null,
                            })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        {dialog?.kind === "addToPrinted" && dialog.green !== null ? (
                            <Button
                                variant="outline"
                                onClick={() => {
                                    const green = dialog.green;
                                    if (green !== null) { openOrders({ table: green.name, parentTable: parentTableOf(green.raw), occupyOnSend: !green.seated }); }
                                    setDialog(null);
                                }}
                            >
                                {greenSeatLabel(tableSentenceNameOf(row.raw) === name ? name : (parentTableOf(row.raw) ?? name))}
                            </Button>
                        ) : null}
                        <AlertDialogAction onClick={() => { setDialog(null); openOrders({ addToPrinted: true }); }}>
                            {ADD_TO_PRINTED_BILL_ACTION}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={dialog?.kind === "release"} onOpenChange={(o) => { if (!o) { setDialog(null); } }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Release {name} without payment?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Freeing an occupied table without taking the money is a write-off,
                            however it is labelled. The server refuses a release that would write
                            off unpaid orders and names the amount.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction disabled={busy} onClick={() => { void release(); }}>Release</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <Dialog open={dialog?.kind === "merge"} onOpenChange={(o) => { if (!o) { setDialog(null); } }}>
                <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                        <DialogTitle>Merge which table into {name}?</DialogTitle>
                        <DialogDescription>
                            The other table&apos;s orders and bill land on {name}, and it becomes free.
                        </DialogDescription>
                    </DialogHeader>
                    {allRows.filter((r) => r.seated && r.name !== name).length === 0 ? (
                        <p className="text-sm text-muted-foreground">No other occupied tables to merge.</p>
                    ) : (
                        <div className="max-h-64 space-y-1 overflow-y-auto">
                            {allRows.filter((r) => r.seated && r.name !== name).map((r) => (
                                <button
                                    key={r.name}
                                    type="button"
                                    onClick={() => { setMergeFrom(r.name); }}
                                    className={cn(
                                        "flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm",
                                        mergeFrom === r.name ? "border-ring bg-foreground/5" : "border-border hover:bg-foreground/5",
                                    )}
                                >
                                    <span>Table {tableSentenceNameOf(r.raw)}</span>
                                    <span className="text-xs text-muted-foreground">{seatsLabel(r.raw)}</span>
                                </button>
                            ))}
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setDialog(null); }}>Cancel</Button>
                        <Button disabled={busy || mergeFrom === ""} onClick={() => { void merge(); }}>
                            Merge {mergeFrom || "…"} into {name}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={dialog?.kind === "discount"} onOpenChange={(o) => { if (!o) { setDialog(null); } }}>
                <DialogContent className="sm:max-w-[360px]">
                    <DialogHeader>
                        <DialogTitle>Apply discount</DialogTitle>
                        <DialogDescription className="sr-only">Discount on the open bill</DialogDescription>
                    </DialogHeader>
                    <div className="flex gap-2">
                        <Button
                            variant={discountType === "percent" ? "default" : "outline"}
                            size="sm"
                            onClick={() => { setDiscountType("percent"); }}
                        >
                            % off
                        </Button>
                        <Button
                            variant={discountType === "flat" ? "default" : "outline"}
                            size="sm"
                            onClick={() => { setDiscountType("flat"); }}
                        >
                            Flat
                        </Button>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="sheet-discount">{discountType === "percent" ? "Percent off (0–100)" : "Amount off"}</Label>
                        <Input
                            id="sheet-discount"
                            type="number"
                            min={0}
                            autoFocus
                            value={fieldText}
                            onChange={(e) => { setFieldText(e.target.value); }}
                        />
                    </div>
                    <DialogFooter>
                        {discount > 0 ? (
                            <Button variant="ghost" className="text-destructive" disabled={busy} onClick={() => { void applyDiscount(true); }}>
                                Remove
                            </Button>
                        ) : null}
                        <Button variant="outline" onClick={() => { setDialog(null); }}>Cancel</Button>
                        <Button disabled={busy} onClick={() => { void applyDiscount(false); }}>Apply</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={dialog?.kind === "coupon"} onOpenChange={(o) => { if (!o) { setDialog(null); } }}>
                <DialogContent className="sm:max-w-[360px]">
                    <DialogHeader>
                        <DialogTitle>Apply coupon</DialogTitle>
                        <DialogDescription className="sr-only">Coupon code for the open bill</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-2">
                        <Label htmlFor="sheet-coupon">Coupon code</Label>
                        <Input
                            id="sheet-coupon"
                            placeholder="e.g. SAVE10"
                            autoFocus
                            value={fieldText}
                            onChange={(e) => { setFieldText(e.target.value.toUpperCase()); }}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setDialog(null); }}>Cancel</Button>
                        <Button disabled={busy || fieldText.trim() === ""} onClick={() => { void applyCoupon(); }}>Apply</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={dialog?.kind === "split" || dialog?.kind === "splitResult"} onOpenChange={(o) => { if (!o) { setDialog(null); } }}>
                <DialogContent className="sm:max-w-[380px]">
                    {dialog?.kind === "splitResult" ? (
                        <>
                            <DialogHeader>
                                <DialogTitle>
                                    Split{dialog.grandTotal !== null ? ` · ${money(dialog.grandTotal)}` : ""}
                                </DialogTitle>
                                <DialogDescription className="sr-only">Each share of the bill</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-1.5">
                                {dialog.parts.map((part) => (
                                    <div key={part.label} className="flex items-center justify-between text-sm">
                                        <span>{part.label}</span>
                                        <span className="font-semibold tabular-nums">{part.total !== null ? money(part.total) : "—"}</span>
                                    </div>
                                ))}
                            </div>
                            <DialogFooter>
                                <Button onClick={() => { setDialog(null); }}>Done</Button>
                            </DialogFooter>
                        </>
                    ) : (
                        <>
                            <DialogHeader>
                                <DialogTitle>Split bill evenly</DialogTitle>
                                <DialogDescription className="sr-only">Divide the total payable N ways</DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-2">
                                <Label htmlFor="sheet-split">Number of ways</Label>
                                <Input
                                    id="sheet-split"
                                    type="number"
                                    min={2}
                                    autoFocus
                                    value={fieldText}
                                    onChange={(e) => { setFieldText(e.target.value); }}
                                />
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => { setDialog(null); }}>Cancel</Button>
                                <Button disabled={busy} onClick={() => { void split(); }}>Split</Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            <Dialog open={dialog?.kind === "assignWaiter"} onOpenChange={(o) => { if (!o) { setDialog(null); } }}>
                <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                        <DialogTitle>Assign waiter</DialogTitle>
                        <DialogDescription className="sr-only">Pick the staff member covering {name}</DialogDescription>
                    </DialogHeader>
                    <div className="max-h-72 space-y-1 overflow-y-auto">
                        {(dialog?.kind === "assignWaiter" ? dialog.employees : []).map((employee) => (
                            <button
                                key={employee.employee_id}
                                type="button"
                                disabled={busy}
                                onClick={() => { void assignWaiter(employee); }}
                                className="flex w-full flex-col rounded-md border border-border px-3 py-2 text-left hover:bg-foreground/5"
                            >
                                <span className="text-sm font-semibold text-foreground">
                                    {`${employee.emp_Fname} ${employee.emp_Lname}`.trim() || employee.employee_Username}
                                </span>
                                <span className="text-xs text-muted-foreground">@{employee.employee_Username} · {employee.role}</span>
                            </button>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>

            <AlertDialog open={dialog?.kind === "staleSettle"} onOpenChange={(o) => { if (!o) { setDialog(null); } }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>The printed bill is out of date</AlertDialogTitle>
                        <AlertDialogDescription>
                            {dialog?.kind === "staleSettle" ? dialog.warning : ""}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction disabled={busy} onClick={() => { void approvePayment(true); }}>
                            {SETTLE_ANYWAY_LABEL}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <BillCustomerDialog
                open={dialog?.kind === "customer"}
                onOpenChange={(o) => { if (!o) { setDialog(null); } }}
                restaurantId={rid}
                target={{ kind: "table", tableName: name }}
                initial={billDoc !== null ? {
                    customer: customerName || null,
                    ...(Object.prototype.hasOwnProperty.call(billDoc, "customer_gstin") ? { customer_gstin: customerGstin || null } : {}),
                    ...(Object.prototype.hasOwnProperty.call(billDoc, "customer_address") ? { customer_address: customerAddress || null } : {}),
                } : null}
                onSaved={() => { bill.refresh(); onReload(); }}
            />
        </>
    );
}

function BillRow({ label, value }: { label: string; value: string }): React.JSX.Element {
    return (
        <div className="flex items-center justify-between py-[3px] text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-semibold tabular-nums text-foreground">{value}</span>
        </div>
    );
}

function ApcInsight({ status, suggestions }: { status: string; suggestions: string[] }): React.JSX.Element {
    if (status === "green") {
        return (
            <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3">
                <CircleCheck aria-hidden className="h-4 w-4 shrink-0 text-success" />
                <span className="text-[13px] font-semibold text-success">On target — great APC for this table.</span>
            </div>
        );
    }
    const red = status === "red";
    return (
        <div className={cn(
            "mt-2.5 rounded-lg border p-3.5",
            red ? "border-destructive/30 bg-destructive/10" : "border-warning/30 bg-warning/10",
        )}>
            <div className="flex items-center gap-2">
                {red
                    ? <TrendingDown aria-hidden className="h-4 w-4 shrink-0 text-destructive" />
                    : <Lightbulb aria-hidden className="h-4 w-4 shrink-0 text-warning" />}
                <span className={cn("text-[13px] font-semibold", red ? "text-destructive" : "text-warning")}>
                    {red ? "Below target — push to upsell" : "Close to target — suggest more"}
                </span>
            </div>
            <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                {suggestions.length === 0
                    ? <div>Suggest a dessert or a drink to lift the bill.</div>
                    : suggestions.map((s) => <div key={s}>• {s}</div>)}
            </div>
        </div>
    );
}
