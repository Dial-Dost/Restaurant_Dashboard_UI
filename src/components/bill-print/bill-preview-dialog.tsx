"use client";

/**
 * THE IN-PLACE BILL PREVIEW — Flutter `_previewBill` → `_BillPreviewDialog`.
 *
 * Opened from "Print bill" on the table sheet. It only READS (/bill-for-table,
 * settings, profile, logo) to draw the paper; nothing is claimed or counted
 * until **Print** is pressed, which runs `onPrint` (POST /print/bill — the
 * server's thermal print and its print ledger). Cancel costs nothing.
 *
 * Waiter-only sessions never see this (item 19 — the preview is the whole
 * priced receipt); their host prints through a money-free confirm instead.
 */

import * as React from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { SectionHeader } from "@/components/ui/section-header";
import { SkeletonRows } from "@/components/ui/fork-skeleton";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { useCachedFetch } from "@/hooks/use-cached-fetch";
import { useAuth } from "@/context/AuthContext";
import { useTimezone } from "@/lib/use-timezone";
import { useCurrency } from "@/hooks/use-currency";
import { formatDateTime } from "@/lib/tz";
import {
    getBillLogo,
    getBillPrintSettings,
    getRestaurantLogo,
    getRestaurantProfile,
    requestBackend,
    type BillPrintSettings,
    type RestaurantProfile,
} from "@/lib/db";
import { serverBillPrintState } from "@/lib/bill-print-state";
import { billShowsQr } from "@/lib/bill-escpos";
import { paperStaleOf, printedClockOf, printedInstantOf } from "@/lib/api/tables-floor";
import { fetchBillPaperNarrow } from "@/lib/api/bill-print";
import { BillPaper, replacesBillLine } from "./bill-paper";
import {
    cleanText,
    openBillTotals,
    paperChargesForService,
    paperCustomerLines,
    paperHeaderLines,
    paperItemsOf,
    paperQrNote,
} from "./paper-model";

type Doc = Record<string, unknown>;

interface PreviewData {
    bill: Doc | null;
    profile: RestaurantProfile | null;
    billPrint: BillPrintSettings | null;
    narrow: boolean;
    logo: string | null;
}

export interface BillPreviewDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    restaurantId: string;
    tableName: string;
    /** This device's / the floor row's memory that the bill was printed — for a backend with no print state. */
    printedFallback: boolean;
    /** The print itself (POST /print/bill). Resolves true when it went out; the dialog then closes. */
    onPrint: () => Promise<boolean>;
}

export function BillPreviewDialog({
    open,
    onOpenChange,
    restaurantId,
    tableName,
    printedFallback,
    onPrint,
}: BillPreviewDialogProps): React.JSX.Element {
    const { user } = useAuth();
    const { timezone } = useTimezone();
    const { currencySymbol } = useCurrency();
    const [busy, setBusy] = React.useState(false);
    // Each opening is a FRESH read — another till may have printed or added
    // to the bill since the sheet loaded (Flutter reads the bill it previews).
    const [nonce, setNonce] = React.useState(0);
    React.useEffect(() => {
        if (open) { setNonce((n) => n + 1); }
    }, [open]);

    const fetcher = React.useCallback(async (): Promise<PreviewData> => {
        const billRes = await requestBackend<Doc>({
            path: `/bill-for-table?table_name=${encodeURIComponent(tableName)}`,
            method: "GET",
            restaurantId,
        });
        if (!billRes.ok && billRes.status !== 404) { throw new Error(billRes.text || "Could not read the bill."); }
        // The header, width and logo are best-effort: a hiccup degrades the
        // paper to a name-only header, never blocks the print.
        const [profile, billPrint, narrow, logo] = await Promise.all([
            getRestaurantProfile(restaurantId, user?.employeeId ?? "").catch(() => null),
            getBillPrintSettings(restaurantId).catch(() => null),
            fetchBillPaperNarrow(restaurantId),
            getBillLogo(restaurantId).catch(() => null)
                .then(async (l) => l ?? (await getRestaurantLogo(restaurantId).catch(() => null))),
        ]);
        return { bill: billRes.ok ? billRes.data : null, profile, billPrint, narrow, logo };
    }, [restaurantId, tableName, user?.employeeId]);

    const load = useCachedFetch<PreviewData>(
        `bill-preview:${restaurantId}:${tableName}:${String(nonce)}`,
        fetcher,
        { enabled: open && nonce > 0 && tableName !== "" },
    );

    const data = load.data;
    const bill = data?.bill ?? null;
    const items = React.useMemo(() => paperItemsOf(bill), [bill]);
    const empty = data !== null && items.length === 0;

    const print = async (): Promise<void> => {
        setBusy(true);
        try {
            const ok = await onPrint();
            if (ok) { onOpenChange(false); }
        } finally {
            setBusy(false);
        }
    };

    let body: React.ReactNode;
    if (load.loading || (data === null && load.error === null)) {
        body = <div className="rounded-[10px] bg-white p-4"><SkeletonRows rows={6} title={false} /></div>;
    } else if (data === null) {
        body = <LoadErrorState whatFailed="Couldn't load the bill." error={load.error} onRetry={load.retry} />;
    } else if (empty || bill === null) {
        body = <p className="py-6 text-center text-sm text-muted-foreground">No open bill to print for this table.</p>;
    } else {
        const printedBefore = serverBillPrintState(bill) ?? printedFallback;
        const updated = printedBefore && paperStaleOf(bill) === true;
        const totals = openBillTotals(bill);
        const grand = Number(bill.grand_total ?? bill.total_amt) || 0;
        body = (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-[10px] bg-white">
                <BillPaper
                    narrow={data.narrow}
                    banner={updated
                        ? { kind: "updated", replacesLine: replacesBillLine(printedClockOf(printedInstantOf(bill), timezone)) }
                        : printedBefore ? { kind: "reprint" } : null}
                    logoSrc={data.logo !== null ? `data:image/png;base64,${data.logo}` : null}
                    restaurantName={cleanText(data.profile?.outlet_name) || cleanText(user?.restaurantName) || "Receipt"}
                    headerLines={paperHeaderLines(data.profile, data.billPrint)}
                    customerLines={paperCustomerLines(bill)}
                    dateText={formatDateTime(Date.now(), timezone)}
                    tableName={tableName}
                    cashier={cleanText(user?.emp_Fname)}
                    billNo={typeof bill.bill_no === "number" ? String(bill.bill_no) : cleanText(bill.bill_no)}
                    items={items}
                    totals={totals}
                    grandTotalText={`${currencySymbol}${grand.toFixed(2)}`}
                    chargesForService={paperChargesForService(totals)}
                    qr={billShowsQr(data.billPrint) ? { note: paperQrNote(data.billPrint), src: null } : null}
                    className={data.narrow ? "mx-auto max-w-[300px]" : ""}
                />
            </div>
        );
    }

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!busy) { onOpenChange(o); } }}>
            <DialogContent className="flex max-h-[85vh] w-[calc(100vw-32px)] max-w-[400px] flex-col gap-3 p-4">
                <DialogTitle className="sr-only">Bill preview · {tableName}</DialogTitle>
                <DialogDescription className="sr-only">The bill as it will print. Nothing prints until you press Print.</DialogDescription>
                <SectionHeader title="Bill preview" />
                {body}
                <div className="flex justify-end gap-2 pt-1">
                    <Button variant="ghost" disabled={busy} onClick={() => { onOpenChange(false); }}>Cancel</Button>
                    <Button disabled={busy || data === null || empty || bill === null} onClick={() => { void print(); }}>
                        <Printer /> {busy ? "Printing…" : "Print"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
