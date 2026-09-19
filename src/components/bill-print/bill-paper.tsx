"use client";

/**
 * THE BILL AS PAPER — one renderer for the in-place preview dialog (Flutter
 * `_BillPreviewDialog`) and the browser-print page (`/dashboard/orders/print`).
 *
 * Drawn to the thermal roll's geometry: 80mm = 48 columns with 2 of margin
 * either side (44 of text: Item 20 / Qty 4 / Price 9 / Amount 10), 58mm = 32
 * columns, no margin (Item 11 / Qty 4 / Price 8 / Amount 9) — `bill_paper_width`
 * decides which. Black ink on white whatever the theme.
 *
 * What the paper carries, in escpos.ts order: the UPDATED BILL (+ "Replaces the
 * bill printed HH:MM") or REPRINT box, logo, name, header lines, the customer
 * slot (Name / Customer GSTIN / Address lines), Date + table, Cashier + Bill No.,
 * the item table (a comped line reads "<dish> (NC)" at 0.00), the ladder (no
 * "0%" suffix when a percentage is unknown), round off, Grand Total, the
 * "NC value (not charged)" disclosure, the service-charge sentence, the QR.
 */

import * as React from "react";
import { QrCode } from "lucide-react";
import {
    BILL_SERVICE_CHARGE_NOTE,
    billColumns,
    billItemRow,
    billMarginCols,
    billTextColumns,
    billTotals,
    type BillTotalsSource,
} from "@/lib/bill-escpos";

export interface PaperItem {
    key: string;
    /** The dish with its price point, e.g. "Paneer Tikka (Half)". */
    name: string;
    quantity: number;
    price: number;
    /** A comped (non-chargeable) line. */
    nc: boolean;
}

export type PaperBanner = { kind: "updated"; replacesLine: string } | { kind: "reprint" } | null;

export interface BillPaperProps {
    narrow: boolean;
    banner: PaperBanner;
    logoSrc: string | null;
    restaurantName: string;
    headerLines: readonly string[];
    customerLines: readonly string[];
    dateText: string;
    tableName: string;
    cashier: string;
    billNo: string;
    items: readonly PaperItem[];
    totals: Omit<BillTotalsSource, "items">;
    grandTotalText: string;
    chargesForService: boolean;
    /** Null = the owner's QR switch is off. `src` null draws Flutter's non-scannable stand-in. */
    qr: { note: string; src: string | null } | null;
    className?: string;
}

/** "Replaces the bill printed 13:32" — floor_state.dart `replacesBillLine`. */
export const replacesBillLine = (clock: string): string =>
    clock.trim() === "" ? "Replaces an earlier printed bill" : `Replaces the bill printed ${clock.trim()}`;

/** A comped line's label, as escpos.ts / NcSettle.lineLabel print it. */
export const ncLabel = (name: string, nc: boolean): string => (nc ? `${name} (NC)` : name);

/** What the comped lines were worth (NcSettle.paperNcValue), or null with no comp. */
export const paperNcValue = (items: readonly PaperItem[]): number | null => {
    let v = 0;
    for (const it of items) {
        if (!it.nc) { continue; }
        v += it.price * Math.max(1, Math.round(it.quantity || 1));
    }
    return Math.round(v * 100) > 0 ? v : null;
};

/** A solid black rule; thick around the item table. */
function Rule({ thick = false }: { thick?: boolean }): React.JSX.Element {
    return <div aria-hidden className={`col-span-full my-1.5 border-black ${thick ? "border-t-2" : "border-t"}`} />;
}

function Rung({ label, value, className = "" }: { label: React.ReactNode; value: string; className?: string }): React.JSX.Element {
    return (
        <>
            <span className={`min-w-0 break-words text-right ${className}`}>{label}</span>
            <span className={`self-end whitespace-nowrap pl-2 text-right ${className}`}>{value}</span>
        </>
    );
}

const fmtPct = (n: number): string => String(Math.round(n * 100) / 100);

export function BillPaper(props: BillPaperProps): React.JSX.Element {
    const { narrow, banner, items, totals } = props;
    const width = narrow ? 32 : 48;
    const text = billTextColumns(width);
    const cols = billColumns(text);
    const shares = [cols.COL_ITEM, cols.COL_QTY, cols.COL_PRICE, cols.COL_TOTAL].map((c) => (c / text) * 100);
    const marginShare = `${((billMarginCols(width) / width) * 100).toFixed(4)}%`;
    const amountShare = `${(shares[3] ?? 0).toFixed(2)}%`;
    const ladderGrid = { gridTemplateColumns: `minmax(0, 1fr) minmax(${amountShare}, max-content)` };

    const ladder = billTotals({ items, ...totals });
    // Finding 8 — an unknown (0) percentage prints the bare label.
    const rungs = ladder.rungs.map((r) => {
        if (r.key === "service-charge") {
            const pct = totals.serviceCharge?.percent ?? 0;
            return { ...r, label: pct > 0 ? `Service Charge ${fmtPct(pct)}%` : "Service Charge" };
        }
        const tax = totals.taxes.find((t, i) => r.key === `tax-${t.id ?? String(i)}`);
        if (tax) {
            return { ...r, label: tax.percentage > 0 ? `${tax.name} ${fmtPct(tax.percentage)}%` : tax.name };
        }
        return r;
    });
    const subText = ladder.subtotal;
    const combined = `Total Qty: ${String(ladder.totalQty)}   Sub Total`;
    const oneRung = combined.length <= text - Math.max(cols.COL_TOTAL, subText.length + 1);
    const ncValue = paperNcValue(items);

    return (
        <div
            data-testid="receipt-paper"
            className={`bg-white pb-6 pt-3 font-sans leading-snug text-black tabular-nums ${narrow ? "text-[12px]" : "text-[13px]"} ${props.className ?? ""}`}
            style={{ paddingLeft: narrow ? 8 : marginShare, paddingRight: narrow ? 8 : marginShare }}
        >
            {banner?.kind === "updated" ? (
                <div className="mb-2">
                    <div className="border-2 border-black py-1 text-center text-[22px] font-black tracking-[3px]">UPDATED BILL</div>
                    {banner.replacesLine !== "" ? <p className="mt-1 text-center">{banner.replacesLine}</p> : null}
                </div>
            ) : banner?.kind === "reprint" ? (
                <div className="mb-2 border-2 border-black py-1 text-center text-2xl font-black tracking-[4px]">REPRINT</div>
            ) : null}

            <div className="pt-1 text-center">
                {props.logoSrc !== null ? (
                    <img src={props.logoSrc} alt="Restaurant logo" className="mx-auto mb-3 block h-auto max-h-[120px] max-w-[66%]" />
                ) : null}
                <p className="font-bold">{props.restaurantName}</p>
                {props.headerLines.map((l, i) => <span key={`h${String(i)}`} className="block">{l}</span>)}
            </div>
            <Rule />
            <div data-testid="receipt-customer-slot">
                {props.customerLines.map((l, i) => <p key={`c${String(i)}`} className="break-words">{l}</p>)}
            </div>
            <Rule />
            <div className="flex flex-wrap justify-between gap-x-3">
                <span className="min-w-0 break-words">Date: {props.dateText}</span>
                <span className="min-w-0 break-words font-bold">Dine In: {props.tableName || "N/A"}</span>
            </div>
            {props.cashier !== "" || props.billNo !== "" ? (
                <div className="flex flex-wrap justify-between gap-x-3">
                    {props.cashier !== "" ? <span className="min-w-0 break-words">Cashier: {props.cashier}</span> : null}
                    {props.billNo !== "" ? <span className="min-w-0 break-words">Bill No.: {props.billNo}</span> : null}
                </div>
            ) : null}
            <Rule thick />
            <table data-testid="receipt-items" className="w-full table-fixed border-collapse">
                <colgroup>
                    {shares.map((s, i) => <col key={i} style={{ width: `${s.toFixed(2)}%` }} />)}
                </colgroup>
                <thead>
                    <tr>
                        <th scope="col" className="border-b-2 border-black pb-1.5 text-left font-normal">Item</th>
                        <th scope="col" className="border-b-2 border-black pb-1.5 text-right font-normal">Qty.</th>
                        <th scope="col" className="border-b-2 border-black pb-1.5 text-right font-normal">Price</th>
                        <th scope="col" className="border-b-2 border-black pb-1.5 text-right font-normal">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    {items.map((item, i) => {
                        const row = billItemRow(item.quantity, item.price, text);
                        const amount = item.nc ? "0.00" : row.amountText;
                        const label = ncLabel(item.name, item.nc);
                        const top = i === 0 ? "pt-1.5" : "pt-0.5";
                        if (!row.fits) {
                            return (
                                <React.Fragment key={item.key}>
                                    <tr className="align-top"><td colSpan={4} className={`break-words ${top}`}>{label}</td></tr>
                                    <tr><td colSpan={4} className="whitespace-pre-wrap text-right">{`${row.qtyText} x ${row.priceText}  ${amount}`}</td></tr>
                                </React.Fragment>
                            );
                        }
                        return (
                            <tr key={item.key} className="align-top">
                                <td className={`break-words pr-2 ${top}`}>{label}</td>
                                <td className={`text-right ${top}`}>{row.qtyText}</td>
                                <td className={`text-right ${top}`}>{row.priceText}</td>
                                <td className={`text-right ${top}`}>{amount}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <Rule thick />
            <div data-testid="receipt-totals" className="grid" style={ladderGrid}>
                {oneRung ? (
                    <Rung label={<>Total Qty: {ladder.totalQty}<span aria-hidden className="inline-block w-6" />Sub Total</>} value={subText} />
                ) : (
                    <>
                        <Rung label={`Total Qty: ${String(ladder.totalQty)}`} value="" />
                        <Rung label="Sub Total" value={subText} />
                    </>
                )}
                {rungs.map((r) => <Rung key={r.key} label={r.label} value={r.value} />)}
                <Rule />
                {ladder.roundOff !== null ? <Rung label="Round off" value={ladder.roundOff} /> : null}
                <Rung className="py-0.5 text-[17px] font-bold leading-tight" label="Grand Total" value={props.grandTotalText} />
                <Rule />
                {ncValue !== null ? (
                    <>
                        <Rung label="NC value (not charged)" value={ncValue.toFixed(2)} />
                        <Rule />
                    </>
                ) : null}
            </div>
            {props.chargesForService ? (
                <p data-testid="receipt-service-charge-note" className="text-center font-bold">{BILL_SERVICE_CHARGE_NOTE}</p>
            ) : null}
            {props.qr !== null ? (
                <>
                    {props.chargesForService ? <Rule /> : null}
                    <div className="text-center">
                        {props.qr.note !== "" ? <p>{props.qr.note}</p> : null}
                        {props.qr.src !== null ? (
                            <img src={props.qr.src} alt="Feedback QR" className="mx-auto mt-2 h-[150px] w-[150px]" />
                        ) : (
                            <div aria-hidden className="mx-auto mt-1.5 flex h-[92px] w-[92px] items-center justify-center border border-black/25">
                                <QrCode className="h-16 w-16 text-black/40" />
                            </div>
                        )}
                    </div>
                </>
            ) : null}
        </div>
    );
}
