"use client";

import { Fragment, useEffect, Suspense, useState, type ReactNode, type SyntheticEvent } from 'react';
import QRCode from 'qrcode';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import type { BillPrintSettings, RestaurantProfile} from '@/lib/db';
import { getBillLogo, getBillPrintSettings, getRestaurantProfile, getRestaurantLogo, getBillByOrder, getBillForTable, getClosedBill, requestBackend } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import Image from 'next/image';
import { DEFAULT_TIMEZONE, formatDateTime } from '@/lib/tz';
import { useTimezone } from '@/lib/use-timezone';
import { billReceiptIsReprint, REPRINT_MARKER, UPDATED_BILL_MARKER, type BillPrintState } from '@/lib/bill-print-state';
import { billCustomerLines } from '@/lib/bill-customer';
import { roundOffOf } from '@/lib/bill-round-off';
import { ncPrintSettlement, type NcPrintSettlement } from '@/lib/nc-settle';
import {
    BILL_SERVICE_CHARGE_NOTE,
    DOTS_PER_COL,
    billColumns,
    billEscPosPreviewText,
    billFeedbackUrl,
    billItemLabel,
    billItemRow,
    billLogoFit,
    billLogoRaster,
    billShowsQr,
    billTextColumns,
    billTotals,
    buildBillEscPos,
} from '@/lib/bill-escpos';

interface OrderItem {
    id: string;
    name: string;
    quantity: number;
    price: number;
    orderedAt: string;
}

interface Tax {
    id: string;
    name: string;
    percentage: number;
    amount: number;
}

interface Order {
  id: string;
  /**
   * The bill this order was attached to, when one has been generated. Null on
   * every order of a table whose bill row names a DIFFERENT generating order
   * ("Bills" is linked by `b.order_id = o.id`, one row per table session), which
   * is why it can never be the only ownership test — see openBillOwnsOrder.
   */
  bill_id?: string | null;
  table: string;
  customer: string;
  items: OrderItem[];
  subtotal: number;
  // THE BROWSER-COMPUTED MONEY FIELDS THE CALLER STILL PUTS IN THE PAYLOAD, AND
  // WHICH NOTHING IN THIS FILE READS ANY MORE. `total` is the server-pinned
  // PRE-TAX SUBTOTAL despite its name, and the charge/tax fields are computed in
  // orders/page.tsx against the subtotal alone. Printing any of them is root
  // cause 4; the money on this page comes from a server bill or the page refuses.
  serviceCharge?: number;
  serviceChargePercentage?: number;
  applyServiceCharge?: boolean;
  calculatedTaxes?: Tax[];
  total: number;
  roundOff?: number;
  status: string;
  currencySymbol: string;
  /*
    "REPRINT FORMATTING: format reprint bills to clearly display the word
    'Reprint' at the top."

    THE SERVER'S `print_count` / `bill_printed_at` FOR THIS SEATING AS THEY STOOD
    BEFORE THIS PRINT WAS CLAIMED, stamped on by the orders page. Not a boolean
    and not a client-side "have I printed this already" flag: the whole reason
    those fields exist is that a per-device memory of "once" means something
    different on every device in the building (bill-print-state.ts's header).

    WHY *BEFORE*. POST /print/bill/claim increments the durable ledger and
    answers with the NEW count — its own test asserts `print_count: 1` after the
    first claim — so a page that read the count after its own claim would stamp
    REPRINT across every original bill. The question the marker asks is what
    state the bill was in when the operator pressed the button.
  */
  bill_print_state?: BillPrintState | null;
  /**
   * CLIENT ITEMS 1 AND 2 — this print REPLACES out-of-date paper: the line the
   * print claim answered with ("Replaces the bill printed 13:32"), stamped on by
   * the orders page. The paper then says "** UPDATED BILL **" in REPRINT's place.
   * Null or absent: it replaces nothing.
   */
  bill_revised_note?: string | null;
  /**
   * CLIENT ITEMS 1 AND 2 — the print claim's ledger row. "Print ESC/POS" names it
   * to POST /publish/bill (`paperJobId`), whose job is a newer counted print of
   * the same bill: the server copies the claim's record of this paper onto it,
   * or the seating's paper reads unknown from then on.
   */
  bill_paper_job_id?: string | null;
  /** The server's PRICED bill from the print claim. Preferred by the print page
   *  over its own /bill-for-table read, which C4 redacts for a waiter. */
  printable_bill?: Record<string, unknown> | null;
}

// --- Printed-bill header identity -------------------------------------------
// ONE resolver, used by both the on-screen bill and the ESC/POS encoder below,
// so the paper and the preview cannot drift apart.
//
// The rule every field obeys: it prints ONLY when the tenant actually has one.
// A restaurant with no GSTIN gets a clean receipt, never a stray "GSTN :" with
// nothing after it, and never a blank line standing in for a field it lacks.
// This mirrors escpos.ts (the backend renderer that drives the thermal agent) —
// the two must agree, because the same bill can be printed through either.
// "null" and "undefined" count as unset. A JS null that has been through a
// template literal, a form field or an older client's JSON body arrives as the
// four-letter STRING, and `GSTN : null` on a tax document reads as a filed
// registration rather than a missing one. Mirrors present() in escpos.ts.
const clean = (v: unknown): string => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined' ? '' : s;
};

// A stored address is one text field owners fill in with real line breaks.
// Honour those as hard breaks and drop blank ones, so a trailing newline never
// prints as a gap.
function addressLines(address: unknown): string[] {
    return clean(address).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

// The header lines under the restaurant name, in reference-receipt order:
// legal entity, address, phone, GST registration. Absent fields contribute
// nothing. The phone is the line that lets a guest ring the restaurant about the
// bill in their hand; every outlet already stores one ("Outlets".outlet_main_ph)
// and neither print path used to carry it.
function billHeaderLines(profile: RestaurantProfile | null, billPrint: BillPrintSettings | null): string[] {
    const lines: string[] = [];
    const legalName = clean(billPrint?.legalName);
    if (legalName) {lines.push(legalName);}
    lines.push(...addressLines(profile?.outlet_add));
    const phone = clean(profile?.outlet_phone);
    if (phone) {lines.push(`Ph : ${phone}`);}
    const gstin = clean(billPrint?.gstin);
    if (gstin) {lines.push(`GSTN : ${gstin}`);}
    return lines;
}

// --- What the guest is actually charged ---------------------------------------
// THE SERVER'S LADDER, OR NOTHING THIS PAGE INVENTED.
//
// THE FAILURE THIS CLOSES (F2, and it was the worst of that bug's four causes).
// The Grand Total printed here was `Math.round(order.total)` — and `order.total`
// is the server-pinned PRE-TAX SUBTOTAL. AddOrder writes `total: pricedSubtotal`,
// the very same figure it writes to `subtotal`; the service charge and the tax
// lines fed only the display rows above the total and never entered it. Two
// consequences, both of them live on EVERY tenant in EVERY tax shape:
//
//   * a web-printed bill WITH a service charge and one WITHOUT showed the SAME
//     Grand Total — the client's report, reproduced in the browser; and
//   * both of them were also short by the whole of the GST.
//
// The `bill.grand_total` preference that used to sit here could not save it:
// `bill` comes from GET /bills/order/:orderId, whose projection (GetBillByOrder)
// returns total_amt and tax_breakdown and carries NO grand_total key at all. So
// `Number.isFinite(Number(undefined))` was always false and the Math.round
// fallback was the only branch that ever ran.
//
// This page therefore no longer computes a total. It asks the server for the
// bill and prints what comes back — the SETTLED bill when the order has been
// paid, the open table bill otherwise. Both are built by the same
// computeBillCharges ladder that /print/bill puts on thermal paper, which is
// what makes a bill printed from the dashboard and a bill printed from the till
// the same document rather than two documents carrying two totals.
//
// AND WHEN NEITHER SERVER DOCUMENT CAN BE PROVEN TO BE THIS ORDER'S, THIS PAGE
// PRINTS NOTHING. There used to be a third branch that re-derived the ladder in
// the browser; it printed `Math.round(order.total)` — the PRE-TAX SUBTOTAL —
// as the Grand Total, so it was short by the whole of the GST and unmoved by
// the service charge, on a receipt that looked exactly like a correct one. A
// refusal an operator can read and act on is strictly better than a number no
// one can tell is wrong.

/**
 * One line as this page prints it, whichever source supplied it. `nc` is the
 * server's comp flag (backend migration 034): the line prints "<name> (NC)" at
 * 0.00, on the screen and on the roll alike (bill-escpos.ts billItemLabel).
 */
interface PrintedLine { id: string; name: string; quantity: number; price: number; nc?: boolean }

/** One printed bill, normalised — the ONLY thing either renderer below reads. */
interface PrintedBill {
    items: PrintedLine[];
    subtotal: number;
    totalQty: number;
    discount: { label: string; amount: number } | null;
    /** Only a charge that was actually charged; a removed one is null and prints nothing. */
    serviceCharge: { percent: number; amount: number } | null;
    taxes: { id: string; name: string; percentage: number; amount: number }[];
    /**
     * The round-off the SERVER applied to reach `grandTotal` (backend migration
     * 048), read off the same document — null when there is none. Disclosed,
     * never derived: this page rounding for itself would be a second rule, and a
     * printed total disagreeing with the settled one is the defect escpos.ts's
     * grandTotal note describes.
     */
    roundOff: number | null;
    grandTotal: number;
    /** The bill number this document belongs to. '' when no bill row backs it. */
    billNo: string;
    /**
     * Where the money came from. BOTH MEMBERS ARE SERVER LADDERS — the 'order'
     * member is deliberately gone, because the browser-derived ladder it stood
     * for printed the pre-tax subtotal as the Grand Total (root cause 4).
     */
    source: 'settled' | 'open';
    /**
     * R2 item 1 — the name and GSTIN off the SAME server document as the money,
     * so a name corrected after the order was placed is the name on the paper.
     * `undefined` when that document carries no such key (an older backend), in
     * which case the renderers fall back to the order's own `customer`.
     */
    customer: string | null | undefined;
    customerGstin: string | null | undefined;
    /**
     * A bill SETTLED AS NON-CHARGEABLE (backend migration 052): the block printed
     * under its 0.00 total — the kind and the authoriser, off the settled bill,
     * exactly what the backend's settled reprint prints. null on every other bill.
     */
    settlement: NcPrintSettlement | null;
}

/** A field off a server document: the value when the key is there, `undefined` when it is not. */
const docField = (doc: Record<string, unknown> | null | undefined, key: string): string | null | undefined => {
    if (!doc || !(key in doc)) {return undefined;}
    const v = doc[key];
    return typeof v === 'string' ? v : null;
};

/**
 * The customer slot for this receipt — `Name: …` (a bare `Name:` for a walk-in)
 * and, when set, `Customer GSTIN: …` — shared by the on-screen bill and the
 * ESC/POS twin so they cannot drift. See billCustomerLines for why it sits under
 * the header and why a walk-in's slot is left blank.
 */
function receiptCustomerLines(printed: PrintedBill, order: { customer?: unknown }): string[] {
    return billCustomerLines(printed.customer === undefined ? order.customer : printed.customer, printed.customerGstin);
}

/**
 * Does this bill charge the guest for service — in EITHER shape?
 *
 * The mandatory disclaimer (G2) hangs off this, and asking only about the
 * Service Charge ROW would repeat F2's root cause 3 in the browser: a tenant
 * carrying the charge as a line in Outlets.default_tax has no such row, the
 * charge arrives among the tax lines, and the sentence would never print on the
 * bill that is actually collecting it. The name test mirrors
 * SERVICE_CHARGE_NAME in billing_math.ts — the one matcher the server bills by.
 */
function billChargesForService(printed: PrintedBill): boolean {
    if (printed.serviceCharge && printed.serviceCharge.amount > 0) {return true;}
    return printed.taxes.some((t) => /service\s*charge/i.test(t.name) && t.amount > 0);
}

const lineQty = (it: { quantity: unknown }) => Math.max(1, Math.round(Number(it.quantity) || 1));

/**
 * What goes on the paper for one line: the dish, and the price point when there
 * is one. Mirrors itemLabel() in escpos.ts, whose header states the reason — a
 * docket that says "Half" beside a bill that says only "Paneer Tikka" is how a
 * ₹150 line gets queried at the till. A line with no variation is unchanged.
 */
const lineLabel = (name: unknown, variation: unknown): string => {
    const base = String(name ?? '');
    const v = String(variation ?? '').trim();
    return v ? `${base} (${v})` : base;
};
const sumQty = (items: readonly { quantity: unknown }[]) => items.reduce((s, it) => s + lineQty(it), 0);

/**
 * The Service Charge row, or none.
 *
 * A positive amount prints the charge; anything else prints NO row. A charge
 * that was removed — a live waiver, a settled bill charged none — used to print
 * "Opted-out" here; the client asked for a removed charge not to be shown on the
 * bill at all. Mirrors the serviceCharge branch in routes/bills.ts and the `sc`
 * guard in escpos.ts; all three must agree or the same bill reads differently on
 * paper.
 */
function serviceChargeRow(amount: number, percent: number): PrintedBill['serviceCharge'] {
    return amount > 0 ? { percent, amount } : null;
}

/** Tax lines from any of the three sources, normalised and keyed for React. */
function taxRows(raw: unknown): PrintedBill['taxes'] {
    if (!Array.isArray(raw)) {return [];}
    return raw
        .map((t: any, i: number) => ({
            id: String(t?.id ?? `t${i}`),
            name: String(t?.name ?? ''),
            percentage: Number(t?.percentage) || 0,
            amount: Number(t?.amount) || 0,
        }))
        .filter((t) => t.name !== '');
}

/**
 * Why a print refused, in words the person at the till can act on.
 *
 * REFUSING IS THE FEATURE, not the failure. An operator told "this order has no
 * bill yet" reprints from the right place; an operator handed the NEXT party's
 * running total has no way to tell — it is someone else's food and someone
 * else's money on a document that looks entirely legitimate.
 */
interface PrintRefusal { headline: string; detail: string }

type PrintResolution =
    | { ok: true; printed: PrintedBill }
    | { ok: false; refusal: PrintRefusal };

/**
 * IS THE TABLE'S OPEN BILL THE BILL THIS PRINT WAS ASKED FOR?
 *
 * THE FAILURE THIS CLOSES. There is ONE open "Bills" row per table at a time
 * (GetBillForTable: `where table_id = $1 and status != 3 and closed_at is null
 * ... limit 1`), and /bill-for-table is addressed by TABLE NAME, not by bill.
 * So the moment the previous sitting is settled and the next party is seated,
 * that same URL starts answering with the NEW party's running bill. A reprint
 * of the previous party's order would then have been handed the next table
 * sitting's items and the next table sitting's total. Nothing on the paper
 * would have said so.
 *
 * The proof required is that the open bill DEMONSTRABLY CONTAINS THIS ORDER:
 *
 *   * `order_ids` is the list of active orders this bill is the sum of — the
 *     very rows its grand total was computed from. Containment therefore says
 *     the printed total includes this order's items, which is the exact claim
 *     the receipt makes. It is also the only test that works before a bill row
 *     exists: "Bills" is linked to ONE generating order (`b.order_id = o.id`),
 *     so the other orders on a shared table legitimately carry bill_id null.
 *     A previous party's orders are closed or cancelled by settle and by
 *     release-table (status 4/5/7), so they drop out of this list — which is
 *     what makes the next-party case refuse rather than print.
 *
 *   * matching bill ids are proof of the same thing where both are known, and
 *     DIFFERING ones are proof of the opposite: the order names one bill, the
 *     table is running another. That contradiction refuses outright, ahead of
 *     any containment test, because it is precisely the next-sitting shape.
 */
function openBillOwnsOrder(order: Order, openBill: any): boolean {
    const asId = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
    const orderId = asId(order.id);
    const orderBillId = asId(order.bill_id);
    const openBillId = asId(openBill?.bill_id);

    if (orderBillId && openBillId) {return orderBillId === openBillId;}

    const rawOrderIds: unknown = openBill?.order_ids;
    const contributing: string[] = Array.isArray(rawOrderIds) ? rawOrderIds.map(asId) : [];
    return orderId !== '' && contributing.includes(orderId);
}

/**
 * The bill to print, or the reason there is none.
 *
 * PRIORITY IS "WHICHEVER SERVER DOCUMENT PROVABLY DESCRIBES THIS ORDER", and the
 * items are taken from the SAME document as the total. They have to be: a
 * table's bill is the sum of its orders, so pinning a table-scoped grand total
 * onto one order's item list would print a receipt that does not add up — a
 * different way of handing the guest a wrong number, not a fix for this one.
 *
 * There is no third branch. See the header block above: the browser-derived
 * ladder that used to live here printed the pre-tax subtotal as the Grand Total.
 */
function resolvePrintedBill(order: Order, settled: any | null, openBill: any | null): PrintResolution {
    const settledGrand = Number(settled?.grand_total);
    // `closed_at` IS THE GUARD, AND IT IS LOAD-BEARING. GetClosedBill selects a
    // bill by id with NO settled-ness filter, and an order on a running table
    // carries the id of its OPEN bill — on which `total_amt` still holds the
    // PRE-TAX SUBTOTAL (settle is what overwrites it with the grand total). So an
    // unguarded read here would hand back a "grand_total" that is the subtotal
    // and reinstate the exact defect this function exists to close. Only a bill
    // that has actually been closed has a grand total to reprint.
    // No table-name lookup is involved here: the settled read is addressed by
    // the order's OWN bill id, so the document it returns is this order's bill
    // by construction. That is why it needs no ownership test and the open read
    // below does.
    if (settled && settled.closed_at && Number.isFinite(settledGrand) && Array.isArray(settled.items)) {
        const items: PrintedLine[] = settled.items.map((it: any, i: number) => ({
            id: `s${i}`, name: lineLabel(it?.name, it?.variation), quantity: Number(it?.quantity) || 1, price: Number(it?.price) || 0,
            ...(it?.nc === true ? { nc: true } : {}),
        }));
        const discountAmt = Number(settled.discount_amount) || 0;
        const printed: PrintedBill = {
            items,
            subtotal: Number(settled.items_subtotal) || 0,
            totalQty: sumQty(items),
            discount: discountAmt > 0
                ? { label: settled.coupon_code ? `Coupon ${settled.coupon_code}` : 'Discount', amount: discountAmt }
                : null,
            // GetClosedBill lifts a "Service Charge" tax line out of the stored
            // breakdown into service_charge, so this one field is the charge in
            // BOTH tax shapes and `taxes` below never double-counts it.
            serviceCharge: serviceChargeRow(
                Number(settled.service_charge) || 0,
                Number(settled.service_charge_percent) || 0,
            ),
            taxes: taxRows(settled.taxes),
            // The round-off RECORDED at settle ("Bills".round_off) — the settled
            // reprint on the backend prints the same one.
            roundOff: roundOffOf(settled),
            grandTotal: settledGrand,
            billNo: String(settled.bill_no ?? ''),
            source: 'settled',
            customer: docField(settled as Record<string, unknown>, 'customer'),
            customerGstin: docField(settled as Record<string, unknown>, 'customer_gstin'),
            settlement: ncPrintSettlement(settled),
        };
        return { ok: true, printed };
    }

    const openGrand = Number(openBill?.grand_total);
    // ONE condition, tested once: the ownership gate and the branch that prints
    // are the same `if`, so no later edit can widen one without the other and
    // re-open a path to the paper that skips the check.
    if (openBill && Number.isFinite(openGrand) && Array.isArray(openBill.items)) {
        if (!openBillOwnsOrder(order, openBill)) {
            // The table is running a bill that does not contain this order. See
            // openBillOwnsOrder: on a table that has turned over this is the NEXT
            // party's bill, and printing it is the worst outcome in this file.
            return {
                ok: false,
                refusal: {
                    headline: 'This table is running a different bill.',
                    detail: `The open bill on ${order.table || 'this table'} does not include this order, so it belongs to a different table sitting. `
                        + 'Printing it would hand this guest another party\'s items and another party\'s total. '
                        + 'Reprint this order from its own bill — settle it first, or print from the bill the order actually belongs to.',
                },
            };
        }
        const items: PrintedLine[] = openBill.items.map((it: any, i: number) => ({
            id: `o${i}`, name: lineLabel(it?.name, it?.variation), quantity: Number(it?.quantity) || 1, price: Number(it?.price) || 0,
            ...(it?.nc === true ? { nc: true } : {}),
        }));
        const discountAmt = Number(openBill.discount) || 0;
        // A live waiver (migration 036) has already been taken out of
        // service_charge AND of the tax lines by openBillChargeConfig, so a
        // waived bill arrives with no charge in either place and prints no
        // service-charge line at all.
        const printed: PrintedBill = {
            items,
            subtotal: Number(openBill.subtotal) || 0,
            totalQty: sumQty(items),
            discount: discountAmt > 0
                ? { label: openBill.coupon_code ? `Coupon ${openBill.coupon_code}` : 'Discount', amount: discountAmt }
                : null,
            serviceCharge: serviceChargeRow(
                Number(openBill.service_charge) || 0,
                Number(openBill.service_charge_percent) || 0,
            ),
            // On a tax-line tenant the service charge IS one of these rows, which
            // is what the thermal bill prints for the same table. The two
            // renderers show the tenant's own shape rather than a normalised one.
            taxes: taxRows(openBill.taxes),
            // The round-off computeBillCharges applied to THIS grand total — the
            // same one /print/bill hands the thermal renderer.
            roundOff: roundOffOf(openBill),
            grandTotal: openGrand,
            billNo: String(openBill.bill_no ?? ''),
            source: 'open',
            customer: docField(openBill as Record<string, unknown>, 'customer'),
            customerGstin: docField(openBill as Record<string, unknown>, 'customer_gstin'),
            // An open bill is never settled, as NC or otherwise.
            settlement: null,
        };
        return { ok: true, printed };
    }

    // ROOT CAUSE 4, closed: no browser-derived ladder, and therefore no receipt.
    //
    // The branch that stood here printed `Math.round(order.total)` as the Grand
    // Total, and `order.total` is the server-pinned PRE-TAX SUBTOTAL (AddOrder
    // writes `total: pricedSubtotal`). So it was short by the whole of the GST,
    // and identical whether or not the service charge applied — the F2 report,
    // printed on a receipt indistinguishable from a correct one. There is no way
    // to rebuild the server's ladder here: the tax shape, a live service-charge
    // WAIVER (migration 036) and any discount all live server-side, and guessing
    // at them is how this file came to disagree with the drawer in the first
    // place. So it refuses, and says which of the two reads it needed.
    return {
        ok: false,
        refusal: {
            headline: 'No bill is available for this order yet.',
            detail: 'The dashboard prints only the bill the server computed, and neither the settled bill nor this '
                + 'table\'s open bill could be loaded for this order. Usually the order simply has no bill yet — place '
                + 'or generate the bill, then print. Otherwise check that you have the View Bill permission and that '
                + 'the backend is reachable, and print again.',
        },
    };
}

// The sentence above the feedback/valet QR: the tenant's own when they have set
// one, otherwise the built-in line the backend hands us. `qrNoteDefault` is
// deliberately not hardcoded here — the backend owns that string (escpos.ts
// DEFAULT_BILL_QR_NOTE) and is the single place it is written down.
function billQrNote(billPrint: BillPrintSettings | null): string {
    const own = clean(billPrint?.qrNote);
    if (own) {return billPrint?.qrNoteMax ? own.slice(0, billPrint.qrNoteMax) : own;}
    return clean(billPrint?.qrNoteDefault);
}

// --- The on-screen slip, drawn to the paper's proportions ---------------------
//
// THE CLIENT'S OWN BILL IS THE SPEC (their photographed "Gaia - Global
// Vegetarian" slip): a logo with white either side, the name bold at body size,
// solid black rules — thicker around the item table — inside visible margins,
// and the money in a right-hand column. escpos.ts prints exactly that on 80mm
// paper, and this card is a picture of that paper, so its measurements are
// taken from the same numbers rather than eyeballed:
//
//   * the MARGINS are the thermal bill's two columns of 48 either side, as a
//     percentage of the card (px-[4.1667%] = 2/48), so every rule and the Amount
//     column stop exactly as far short of the edge as they do on the roll;
//   * the ITEM TABLE's columns are billColumns() of the 44-column text area —
//     Item 20, Qty. 5, Price 9, Amount 10 — as shares of the width;
//   * the LADDER's figures sit in a column as wide as Amount, right-aligned, so
//     they line up under the line amounts exactly as the printed ladder does.

/** Dots across the thermal bill's text area on 80mm paper: 44 columns x 12. */
const BILL_PRINT_AREA_DOTS = billTextColumns(48) * DOTS_PER_COL;

/** The thermal bill's 80mm text area — 44 columns — which this card is a picture of. */
const RECEIPT_TEXT_COLUMNS = billTextColumns(48);

/** Item / Qty. / Price / Amount, as percentages of the table's width. */
const RECEIPT_COLUMN_SHARES: readonly number[] = (() => {
    const text = billTextColumns(48);
    const { COL_ITEM, COL_QTY, COL_PRICE, COL_TOTAL } = billColumns(text);
    return [COL_ITEM, COL_QTY, COL_PRICE, COL_TOTAL].map((cols) => (cols / text) * 100);
})();

/** The Amount column's share — the width of every ladder figure's cell. */
const RECEIPT_AMOUNT_SHARE = `${(RECEIPT_COLUMN_SHARES[3] ?? 0).toFixed(2)}%`;

/**
 * A SOLID RULE, as on the paper: a black stroke with a little white above and
 * below. Thin between blocks; thick around the item table, where the client's
 * bill (and billRule's 4-row stroke) thickens it. Black whatever the dashboard
 * theme, because a browser prints no background and a themed border is grey.
 */
function ReceiptRule({ thick = false }: { thick?: boolean }) {
    // `col-span-full`: inside the totals ladder's grid a rule spans both the label
    // and the amount column; everywhere else it is a plain block and the class
    // does nothing.
    return <div aria-hidden className={`col-span-full my-1.5 border-black ${thick ? 'border-t-2' : 'border-t'}`} />;
}

/**
 * The totals ladder's grid — ONE amount column for every rung, as wide as the
 * item table's Amount column or the widest figure on the ladder, whichever is
 * wider. Every label therefore ends on the same edge, which is escpos.ts's
 * shared `labelW`: a row sized on its own figure put "Grand Total" left of the
 * rungs above it on every bill of Rs 1000 or more.
 */
const RECEIPT_LADDER_GRID = { gridTemplateColumns: `minmax(0, 1fr) minmax(${RECEIPT_AMOUNT_SHARE}, max-content)` };

/**
 * One rung of the totals ladder, as two cells of RECEIPT_LADDER_GRID: the label
 * right-aligned against the shared edge, the figure right-aligned in the amount
 * column and never broken. A label too long for its side wraps, right-aligned,
 * and the figure sits on its LAST line — the thermal bill's rule, so a long tax
 * name keeps its rate rather than losing it to a cut.
 */
function ReceiptLadderRow({ label, value, className = '' }: { label: ReactNode; value: string; className?: string }) {
    return (
        <>
            <span className={`min-w-0 break-words text-right ${className}`}>{label}</span>
            <span className={`self-end whitespace-nowrap pl-2 text-right ${className}`}>{value}</span>
        </>
    );
}

function PrintPageContents() {
    // A bill handed to a guest must carry the restaurant's clock, not the
    // clock of whatever machine happens to be driving the printer.
    const { timezone } = useTimezone();
    const searchParams = useSearchParams();
    const orderKey = searchParams.get('orderKey');
    const legacyOrderData = searchParams.get('order');
    const { user } = useAuth();
    const [logoBase64, setLogoBase64] = useState<string | null>(null);
    // The size the logo PRINTS at, once the image has loaded and its pixels are
    // known (billLogoFit) — which is what the slip below sizes it from.
    const [logoFit, setLogoFit] = useState<{ width: number; height: number } | null>(null);
    const [bill, setBill] = useState<any | null>(null);
    // THE SERVER'S OWN BILL — the settled one if this order has been paid, the
    // open table bill otherwise. Both carry a grand_total the billing layer
    // computed; `bill` above does NOT (GetBillByOrder has no such key), which is
    // how this page came to print a pre-tax subtotal as the Grand Total.
    const [settledBill, setSettledBill] = useState<any | null>(null);
    const [openBill, setOpenBill] = useState<any | null>(null);
    // Have the two money reads finished (either way)? Until they have, BOTH are
    // null and resolvePrintedBill would answer "no bill available" — the right
    // answer to the wrong question. Without this the page would flash its
    // refusal on every print while the fetches were still in flight.
    const [billsResolved, setBillsResolved] = useState(false);
    const [profile, setProfile] = useState<RestaurantProfile | null>(null);
    const [billPrint, setBillPrint] = useState<BillPrintSettings | null>(null);
    const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
    const [previewText, setPreviewText] = useState<string | null>(null);
    const [order, setOrder] = useState<Order | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    useEffect(() => {
        const resolveOrder = () => {
            const payload = legacyOrderData ?? (orderKey ? localStorage.getItem(orderKey) : null);
            if (!payload) {
                setLoadError('No order data provided.');
                return null;
            }

            try {
                const parsed = JSON.parse(decodeURIComponent(payload));
                setOrder(parsed);
                return parsed;
            } catch {
                setLoadError('Unable to load order data.');
                return null;
            }
        };

        const parsed = resolveOrder();
        if (!parsed) {return;}

        // fetch restaurant profile, logo and bill info
        (async () => {
            try {
                const restaurantId = user?.restaurantUsername ?? parsed.res_id ?? null;
                if (restaurantId) {
                        const prof = await getRestaurantProfile(restaurantId, user?.employeeId ?? '').catch(() => null);
                        setProfile(prof ?? null);
                        // 5.1 — the logo the roll prints (bill SVG first, fitted to
                        // the paper), falling back to the branding logo on a
                        // backend that has no /restaurant/logo/bill yet.
                        const logo = (await getBillLogo(restaurantId).catch(() => null))
                            ?? (await getRestaurantLogo(restaurantId).catch(() => null));
                        setLogoBase64(logo ?? null);
                        // Legal entity / GSTIN / the tenant's QR sentence. A
                        // failure here must not stop the bill printing — the
                        // header simply falls back to name + address, which is
                        // what every bill carried before these fields existed.
                        const printSettings = await getBillPrintSettings(restaurantId).catch(() => null);
                        setBillPrint(printSettings ?? null);
                        const billResp = await getBillByOrder(restaurantId, parsed.id).catch(() => null);
                        setBill(billResp ?? null);

                        // THE MONEY. Both reads swallow their errors, but a
                        // failure is no longer survivable by inventing a total:
                        // when neither comes back the page REFUSES and says so
                        // (resolvePrintedBill's last branch). An operator without
                        // the View Bill permission, or on an unreachable backend,
                        // gets a sentence he can act on rather than a receipt
                        // carrying a pre-tax subtotal as the amount due.
                        //
                        // SETTLED FIRST. Once a bill is closed its grand_total is
                        // the figure money actually moved against, and a reprint
                        // must reproduce it rather than re-derive a new one from
                        // a menu that may have been repriced since.
                        const settledResp = parsed.bill_id
                            ? await getClosedBill(restaurantId, String(parsed.bill_id)).catch(() => null)
                            : null;
                        setSettledBill(settledResp ?? null);
                        // Otherwise the OPEN table bill — literally the object
                        // POST /print/bill renders to thermal paper for this
                        // table, so the two printers put out the same document.
                        //
                        // ADDRESSED BY TABLE NAME, WHICH IS WHY IT IS NOT TRUSTED
                        // ON ARRIVAL. The same table name answers with whatever
                        // party is sitting there NOW, so resolvePrintedBill makes
                        // this response prove it contains this order before a
                        // single figure off it reaches the paper (openBillOwnsOrder).
                        // Fetching it here is safe precisely because that gate is
                        // the only door into the renderers.
                        //
                        // `closed_at`, not merely a non-null response: that read
                        // resolves an OPEN bill by id too (see resolvePrintedBill),
                        // and treating one as settled here would skip this fetch
                        // and leave the page with nothing to print.
                        // THE CLAIM'S PRICED BILL FIRST, then this page's own read.
                        //
                        // Found clicking through as a waiter: that read goes out AS
                        // THE SIGNED-IN USER, and C4 redacts it for a waiter — every
                        // amount removed. `grand_total` then fails the Number.isFinite
                        // gate in resolvePrintedBill and the page refuses with "No bill
                        // is available", so no waiter could ever print, having already
                        // spent their one attempt on the claim that brought them here.
                        //
                        // The claim returns the server's unredacted bill for exactly
                        // this purpose. It is NOT trusted any more than the fetch was:
                        // it goes through the same resolvePrintedBill, so it still has
                        // to prove it contains this order (openBillOwnsOrder) before a
                        // single figure off it reaches the paper. Same door, better key.
                        //
                        // Falls back to the read when absent — a backend older than
                        // this change, or a senior's print, both of which the read
                        // already served correctly.
                        const claimed = parsed.printable_bill;
                        const claimedBill = claimed && typeof claimed === 'object' && !Array.isArray(claimed)
                            ? claimed
                            : null;
                        const openResp = !settledResp?.closed_at && parsed.table
                            ? (claimedBill ?? await getBillForTable(restaurantId, String(parsed.table)).catch(() => null))
                            : null;
                        setOpenBill(openResp ?? null);

                        // Build feedback URL like settings and generate QR data URL client-side
                        // (the form lives inside this app at /feedback; env still overrides).
                        try {
                            const fallbackBase = typeof window !== 'undefined' ? `${window.location.origin}/feedback` : '';
                            // `||`, not `??`: the Dockerfile declares ARG NEXT_PUBLIC_FEEDBACK_FORM_URL
                            // with no default, so ENV bakes it as "" — and "" is not null, so `??`
                            // never reached the fallback. baseUrl became "", the guard below went
                            // falsy, and the feedback QR was silently dropped from every printed
                            // bill while the line telling the guest to scan it still printed.
                            //
                            // The owner's QR switch (bill_show_qr) is applied here too: a bill
                            // with the QR off has no code to draw, so none is built.
                            const feedbackUrl = billFeedbackUrl(process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL || fallbackBase, user, printSettings);
                            if (feedbackUrl) {
                                const dataUrl = await QRCode.toDataURL(feedbackUrl, { width: 260, margin: 1 });
                                setQrDataUrl(dataUrl);
                            }
                        } catch (err) {
                            // ignore QR generation errors
                        }
                }
            } catch (err) {
                // ignore
            } finally {
                // Both money reads are done (or were never possible, e.g. no
                // restaurant id). Either way the page may now show the bill or
                // its refusal; before this point it shows neither.
                setBillsResolved(true);
            }
            // Do not auto-print. Let the user manually click Print.
        })();
    }, [legacyOrderData, orderKey, user]);

    if (loadError) {
        return (
            <div className="flex items-center justify-center h-screen">
                <p>{loadError}</p>
            </div>
        );
    }

    if (!order) {
        return (
            <div className="flex items-center justify-center h-screen">
                <p>Loading order data...</p>
            </div>
        );
    }
    
    if (!billsResolved) {
        return (
            <div className="flex items-center justify-center h-screen">
                <p>Loading bill...</p>
            </div>
        );
    }

    // The server's bill, not one derived here — see resolvePrintedBill.
    const resolution = resolvePrintedBill(order, settledBill, openBill);

    // NO BILL, NO PAPER. This is the whole of the refusal: no item lines, no
    // ladder, no Print button — nothing that could be mistaken for a receipt or
    // photographed as one. The operator is told which bill was wanted and what
    // to do instead, which is the thing that makes refusing safe.
    if (!resolution.ok) {
        return (
            <div className="p-4">
                <Card className="mx-auto w-[420px] max-w-full">
                    <CardHeader>
                        <CardTitle className="text-lg">Bill not printed</CardTitle>
                        <CardDescription>{resolution.refusal.headline}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 text-sm">
                        <p>{resolution.refusal.detail}</p>
                        <p className="text-xs text-muted-foreground">
                            Order {order.id} &middot; Table {order.table || '-'}
                        </p>
                        <button
                            onClick={() => { window.close(); }}
                            className="px-3 py-1 border rounded text-sm"
                        >Close</button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    const printed = resolution.printed;
    /*
      IS THIS PIECE OF PAPER A REPRINT?

      TWO CONDITIONS, AND BOTH ARE THE SERVER'S.

      1. The stamp says this seating's bill had ALREADY been printed when the
         operator pressed Print — `print_count` / `bill_printed_at` off
         /bill-for-table, read before the claim incremented them.

      2. The document this page actually resolved is that same OPEN table bill.
         `/bill-for-table` is addressed by TABLE NAME, so the moment a sitting is
         settled and the next party is seated that URL starts answering about
         somebody else's bill — the exact hazard `openBillOwnsOrder` exists for.
         `source === 'open'` means the resolver PROVED the open bill contains
         this order, so the stamp and the paper describe one bill rather than two.

      A SETTLED BILL IS DELIBERATELY NOT MARKED, and this is a known gap rather
      than an oversight. GetClosedBill's projection carries no print state at
      all, so there is no server fact here to answer the question with — and the
      alternative, "a closed bill is always a reprint", is a guess made in the
      browser, which is the one thing this file is not allowed to do. It should
      become a marker the moment the backend ships `print_count` on the closed-
      bill payload the way it did on /get-tables.

      THE FAILURE DIRECTION. No answer means no banner. An unmarked reprint is a
      bookkeeping annoyance; a REPRINT banner across a genuine first bill is a
      document the guest is entitled to query, on the slip that is the record of
      what they owe.
    */
    const isReprint = billReceiptIsReprint(printed.source, order.bill_print_state);
    // An UPDATED bill is marked for the same reason and on the same document
    // only: the claim that said so was made against this open table's bill.
    const revisedNote = printed.source === 'open' ? (order.bill_revised_note ?? '').trim() || null : null;
    // The claim's paper record belongs to the same open bill, and to nothing else.
    const paperJobId = printed.source === 'open' ? (order.bill_paper_job_id ?? '').trim() || null : null;
    const currencySymbol = order.currencySymbol || '₹';
    const cashierName = `${user?.emp_Fname ?? ''}${user?.emp_Lname ? ` ${user.emp_Lname}` : ''}`.trim() || '';
    const billId = bill?.id ?? settledBill?.id ?? openBill?.bill_id ?? '';
    // The bill number off the SAME document the totals came from, so the header
    // and the money on one receipt cannot name two different bills.
    const billNo = printed.billNo || bill?.bill_no || '';
    // Each of these prints only when its value is known — escpos.ts's rule. A
    // tenant with no bill series and no named cashier got two bare labels.
    const shownBillNo = clean(String(billNo));
    const shownCashier = clean(cashierName);
    // THE LADDER'S OWN STRINGS — the very labels and figures the thermal bill
    // prints ("Sub Total", "SGST 2.5%", "-500.00"), so the two slips cannot word
    // the same money differently. See billTotals.
    const totals = billTotals(printed);
    const chargesForService = billChargesForService(printed);
    const qrNote = billQrNote(billPrint);
    const showQr = billShowsQr(billPrint);
    /**
     * The logo at the width the roll prints it, as a share of the text area:
     * bill_logo.ts fits it inside two thirds of the paper and never enlarges it,
     * and the printer centres that raster between the margins. A 200-dot
     * wordmark therefore spans 200 of the 528 dots between the margins here too,
     * not stretched to fill them.
     */
    const onLogoLoad = (e: SyntheticEvent<HTMLImageElement>) => {
        setLogoFit(billLogoFit(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight));
    };
    const logoWidth = logoFit ? `${((logoFit.width / BILL_PRINT_AREA_DOTS) * 100).toFixed(2)}%` : undefined;

    return (
        <div className="p-4 bg-white text-black">
            <style>{`
                @media print {
                    .no-print, header, footer, nav, .app-header, .app-footer, .dashboard-buttons, .bottom-buttons, .site-footer, .page-footer, .dock, .dock-panel, .dock-container, .dock-wrapper, .dockbar, .site-dock, .app-dock, .bottom-dock, [data-dock], [data-no-print], [class*="dock"] {
                        display: none !important;
                    }
                    /* Ensure the receipt card and its contents print clearly */
                    .receipt-card {
                        display: block !important;
                        visibility: visible !important;
                        /* The card's outline is the paper's edge on screen; on
                           paper the roll IS the edge, and the client's bill has
                           no box drawn round it. */
                        border-color: transparent !important;
                        box-shadow: none !important;
                    }
                }
            `}</style>

            {/* 5.1 — PAPER, WHATEVER THE DASHBOARD THEME. The Card primitive paints
                bg-card / text-card-foreground, which under the default dark theme is
                a near-black card with near-white ink — and a browser prints no
                background, so the name came out white-on-white and the address and
                GSTIN in pale grey. The receipt is forced to black ink on white. */}
            <Card className="mx-auto w-[420px] max-w-full shadow-none border-black receipt-card bg-white text-black">
                <div className="mb-1 px-3 pt-3 no-print">
                    <p className="mb-2 text-left text-xs text-gray-500">Bill preview — review the receipt below, then click Print when you&apos;re ready. Nothing prints automatically.</p>
                    <div className="flex gap-2 justify-end">
                        <button
                            onClick={() => { window.print(); }}
                            className="px-3 py-1 border rounded text-sm"
                        >Print</button>
                        <button
                            onClick={() => { window.close(); }}
                            className="px-3 py-1 border rounded text-sm"
                        >Close</button>
                        <button
                                onClick={async () => {
                                    // Passed logoBase64 to the encoder
                                    const esc = await generateEscPos(user, profile, cashierName, bill, order, logoBase64, timezone, billPrint, printed, isReprint, revisedNote);
                                    // Never silent: an encoder that returned null
                                    // printed nothing, and an operator who thinks
                                    // he has sent a bill to the thermal printer
                                    // will hand the guest a blank hand instead of
                                    // reprinting.
                                    if (!esc) {
                                        alert('Could not build the bill for the thermal printer. Nothing was sent.');
                                        return;
                                    }

                                    // Convert ESC/POS > readable text preview. Not a
                                    // plain TextDecoder: the rules and the logo are
                                    // rasters, and a thin rule's header carries a
                                    // newline byte — see billEscPosPreviewText.
                                    setPreviewText(billEscPosPreviewText(esc));

                                    // Convert to base64 and send to backend to publish to subscribed printing apps
                                    const toBase64 = (bytes: Uint8Array) => {
                                        if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
                                            let binary = '';
                                            const len = bytes.byteLength;
                                            for (let i = 0; i < len; i++) {binary += String.fromCharCode(bytes[i]);}
                                            return window.btoa(binary);
                                        }
                                        // fallback (node)
                                        return Buffer.from(bytes).toString('base64');
                                    };

                                    const b64 = toBase64(esc);
                                    // No baseUrl: requestBackend is a Server Action (lib/db.ts is
                                    // "use server"), so this fetch runs in the Next container and
                                    // resolves the internal backend address itself. The old line
                                    // read the env var with `??`, which does not fall back on an
                                    // empty string, so a production build sent the server a bare
                                    // path — and its window-derived fallback pointed at port 3000,
                                    // the dashboard's own port rather than the backend's 3001.

                                    try {
                                        const resp = await requestBackend({
                                            path: '/publish/bill',
                                            method: 'POST',
                                            body: { restaurantId: user?.res_id, outletId: user?.outlet_id, billId: billId || String(Date.now()), escBase64: b64, ...(paperJobId ? { paperJobId } : {}) },
                                        });

                                        if (!resp.ok) {
                                            alert('Failed to publish bill: ' + resp.text);
                                            return;
                                        }

                                        alert('Bill published to backend for printing');
                                    } catch (err) {
                                        console.error(err);
                                        alert('Unable to send bill to backend');
                                    }
                                }}
                            className="px-3 py-1 border rounded text-sm"
                        >
                            Print ESC/POS
                        </button>
                    </div>
                </div>
                {/*
                    THE PAPER. Inside the card's edge, the thermal bill's margins
                    (px-[4.1667%] is its 2 columns of 48 either side), body type at
                    the size of the address, figures in tabular numerals so the
                    money columns line up the way monospaced print lines them up.
                */}
                <div data-testid="receipt-paper" className="bg-white px-[4.1667%] pb-8 pt-3 font-sans text-[13px] leading-snug text-black tabular-nums">
                {/*
                    THE FIRST THING ON A REPRINTED SLIP IS THAT IT IS A REPRINT.

                    ABOVE THE LOGO, NOT UNDER IT — the same placement escpos.ts
                    chose and for the same reason it gives: a bill carrying a tall
                    logo would otherwise put the word several centimetres down a
                    slip that gets glanced at and dropped in a till drawer. The
                    text is `REPRINT_MARKER`, which is the backend's own constant,
                    because the SAME bill can be printed through either path and
                    two spellings would mean a guest comparing two slips has no
                    way to tell they are the same document.
                */}
                {revisedNote ? (
                    <div data-testid="receipt-updated" className="py-2 text-center">
                        <div className="text-2xl font-extrabold tracking-widest">{UPDATED_BILL_MARKER}</div>
                        <div className="text-[13px]">{revisedNote}</div>
                    </div>
                ) : isReprint ? (
                    <div className="py-2 text-center text-2xl font-extrabold tracking-widest">
                        {REPRINT_MARKER}
                    </div>
                ) : null}
                <div data-testid="receipt-header" className="pt-1 text-center">
                    {/* 5.1 — THE LOGO, AT THE SIZE THE ROLL PRINTS IT. It was a 64px
                        box, then 80% of the slip; the client's own bill carries its
                        wordmark at about two thirds of the paper with white either
                        side, which is what bill_logo.ts now rasterises. So it is
                        sized from that raster (billLogoFit, via onLogoLoad) — never
                        wider than two thirds of the paper, never enlarged past its
                        own pixels — and capped at the same share before it loads.
                        A tenant with no logo gets no logo line: the old "Loading
                        Logo ..." placeholder never went away for them, and printed. */}
                    {logoBase64 ? (
                        <Image src={`data:image/png;base64,${logoBase64}`} alt="Restaurant logo" onLoad={onLogoLoad} style={{ width: logoWidth }} className="mx-auto mb-3 block h-auto w-auto max-w-[72.73%]" width={576} height={240} unoptimized />
                    ) : null}
                    {/* BOLD, AT BODY SIZE — the client's bill, and escpos.ts's. At
                        double size "Gaia - Global Vegetarian" broke in two and
                        shouted over the logo that already names the restaurant. */}
                    <p className="font-bold">{profile?.outlet_name ?? 'Not found'}</p>
                    {/* Legal entity, address lines, Ph, GSTIN — each rendered only
                        when the tenant has one, so a restaurant without them
                        gets a clean receipt instead of empty labels. Black ink,
                        not the muted description grey (5.1: clearly visible). */}
                    <CardDescription className="text-[13px] leading-snug text-black">
                        {billHeaderLines(profile, billPrint).map((l, i) => (
                            <span key={i} className="block">{l}</span>
                        ))}
                    </CardDescription>
                </div>
                <ReceiptRule />
                {/* R2 item 1 — the customer's own slot, directly under the
                    restaurant header and above the Date / Bill No. block, as on
                    the client's printed bill: "Name:" (left blank for a walk-in)
                    and, for a corporate party, "Customer GSTIN:". The thermal
                    bill prints the same lines in the same place. */}
                <div className="w-full" data-testid="receipt-customer-slot">
                    {receiptCustomerLines(printed, order).map((l) => (
                        <p key={l}>{l}</p>
                    ))}
                </div>
                <ReceiptRule />
                {/* Date left, the table right and BOLD — what a server matches
                    the slip to. Then Cashier left and Bill No. right, each only
                    when known: the client's order, and escpos.ts's. */}
                {/* NEVER CUT A VALUE TO MAKE A ROW FIT — the thermal bill's rule.
                    Side by side when both fit; otherwise the right-hand run
                    wraps onto its own line (flex-wrap) rather than squeezing the
                    date or the cashier, and a single over-long value breaks
                    inside its own line instead of running off the slip. */}
                <div data-testid="receipt-date-row" className="flex flex-wrap justify-between gap-x-3">
                    <span className="min-w-0 break-words">Date: {formatDateTime(Date.now(), timezone)}</span>
                    <span className="min-w-0 break-words font-bold">Dine In: {order.table || 'N/A'}</span>
                </div>
                {shownCashier || shownBillNo ? (
                    <div data-testid="receipt-cashier-row" className="flex flex-wrap justify-between gap-x-3">
                        {shownCashier ? <span className="min-w-0 break-words">Cashier: {shownCashier}</span> : null}
                        {shownBillNo ? <span className="min-w-0 break-words">Bill No.: {shownBillNo}</span> : null}
                    </div>
                ) : null}
                <ReceiptRule thick />
                {/* Item | Qty. | Price | Amount — the client's headings, in the
                    thermal bill's column proportions, with the heading's thick
                    rule under it and another after the last line. */}
                <table data-testid="receipt-items" className="w-full table-fixed border-collapse">
                    <colgroup>
                        {RECEIPT_COLUMN_SHARES.map((share, i) => (
                            <col key={i} style={{ width: `${share.toFixed(2)}%` }} />
                        ))}
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
                        {/* The lines of the bill the totals below belong to —
                            the server's merged list when it supplied the
                            money, this order's own list otherwise. Items and
                            total always come from the same document. */}
                        {printed.items.map((item, i) => {
                            // The paper's figures and the paper's "do they fit"
                            // (billItemRow, on the 44-column text area this card
                            // draws). A figure that fills its column — 150000.00
                            // as a price, 1000000.00 as an amount — would run into
                            // its neighbour, so, as on the thermal bill, the dish
                            // takes the whole width and "qty x price  amount"
                            // goes on its own right-aligned line under it.
                            // A comped line reads "<name> (NC)" at 0.00, so the
                            // Amount column adds up to the Sub Total under it.
                            const row = billItemRow(item.quantity, item.price, RECEIPT_TEXT_COLUMNS, item.nc === true);
                            const label = billItemLabel(item.name, item.nc);
                            const top = i === 0 ? 'pt-1.5' : 'pt-0.5';
                            if (!row.fits) {
                                return (
                                    <Fragment key={item.id}>
                                        <tr className="align-top">
                                            <td colSpan={4} className={`break-words ${top}`}>{label}</td>
                                        </tr>
                                        <tr data-testid="receipt-item-figures">
                                            <td colSpan={4} className="whitespace-pre-wrap text-right">{`${row.qtyText} x ${row.priceText}  ${row.amountText}`}</td>
                                        </tr>
                                    </Fragment>
                                );
                            }
                            return (
                                <tr key={item.id} className="align-top">
                                    <td className={`break-words pr-2 ${top}`}>{label}</td>
                                    <td className={`text-right ${top}`}>{row.qtyText}</td>
                                    <td className={`text-right ${top}`}>{row.priceText}</td>
                                    <td className={`text-right ${top}`}>{row.amountText}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                <ReceiptRule thick />
                {/* THE LADDER, IN THE RIGHT-HAND BLOCK — escpos.ts's rungs in its
                    order: "Total Qty: n   Sub Total", discount, service charge,
                    taxes; a rule; the round-off when one is disclosed; the Grand
                    Total larger and bold; a rule. Labels right-aligned against
                    ONE shared amount column, so every label ends on one edge. */}
                <div data-testid="receipt-totals" className="grid" style={RECEIPT_LADDER_GRID}>
                    <ReceiptLadderRow
                        label={<>Total Qty: {totals.totalQty}<span aria-hidden className="inline-block w-6" />Sub Total</>}
                        value={totals.subtotal}
                    />
                    {totals.rungs.map((r) => (
                        <ReceiptLadderRow key={r.key} label={r.label} value={r.value} />
                    ))}
                    <ReceiptRule />
                    {/* Round off is DISCLOSED, never created: only a non-zero one
                        the billing layer supplied with the grand total, exactly
                        as escpos.ts prints it above "Grand Total". */}
                    {totals.roundOff !== null && (
                        <ReceiptLadderRow label="Round off" value={totals.roundOff} />
                    )}
                    <ReceiptLadderRow
                        className="py-0.5 text-[17px] font-bold leading-tight"
                        label="Grand Total"
                        value={`${currencySymbol}${printed.grandTotal.toFixed(2)}`}
                    />
                    <ReceiptRule />
                    {/* BESIDE THE LADDER, NEVER IN IT — escpos.ts's order: what
                        was given away, then an NC settlement's own block. */}
                    {totals.ncValue !== null && (
                        <ReceiptLadderRow label="NC value (not charged)" value={totals.ncValue} />
                    )}
                    {printed.settlement ? (
                        <div data-testid="receipt-nc-settlement" className="col-span-full">
                            <p className="font-bold">
                                Settled: Non-chargeable{printed.settlement.kind ? ` — ${printed.settlement.kind}` : ''}
                            </p>
                            {printed.settlement.authorisedBy ? <p>Authorised by: {printed.settlement.authorisedBy}</p> : null}
                        </div>
                    ) : null}
                    {printed.settlement && printed.settlement.wouldHaveCharged !== null && Math.round(printed.settlement.wouldHaveCharged * 100) > 0 ? (
                        <ReceiptLadderRow label="Would have been (incl. tax)" value={printed.settlement.wouldHaveCharged.toFixed(2)} />
                    ) : null}
                    {totals.ncValue !== null || printed.settlement ? <ReceiptRule /> : null}
                </div>

                {/* G2's mandatory sentence, on the browser-printed bill as
                    well as the ESC/POS one — the two are the same document.
                    FIRST in the footer and BOLD, straight under the total it
                    qualifies, as on the client's bill. Printed only when the
                    guest is actually being charged for service; see
                    billChargesForService for why the row alone is not the right
                    question. The old "Thanks" line is gone: the client's bill
                    has none. */}
                {chargesForService ? (
                    <p data-testid="receipt-service-charge-note" className="text-center font-bold">
                        {BILL_SERVICE_CHARGE_NOTE}
                    </p>
                ) : null}

                {/* The valet/feedback QR, when there is one to print — and
                    nothing in its place when there is not. The QR is built in
                    the same effect that resolves the bill, so by the time this
                    renders a missing one is missing for good; the "Loading QR..."
                    that used to stand here never went away, and printed. */}
                {/* THE OWNER'S QR SWITCH (bill_show_qr): off hides the sentence
                    AND the code, as the thermal bill does. No settings or no key
                    keeps them — billShowsQr. */}
                {showQr && qrDataUrl ? (
                    <>
                        {chargesForService ? <ReceiptRule /> : null}
                        <div className="text-center">
                            {/* The tenant's own sentence when they have set one;
                                otherwise the built-in line the backend supplies.
                                Omitted rather than rendered blank if neither is
                                available (i.e. the settings fetch failed). */}
                            {qrNote ? <p>{qrNote}</p> : null}
                            <Image src={qrDataUrl} alt="valet-qr" className="mx-auto mt-2 w-[150px] h-[150px]" width={150} height={150} />
                        </div>
                    </>
                ) : null}
                </div>
            </Card>
            {previewText && (
                <div className="mt-6 p-4 border bg-gray-100 text-xs whitespace-pre overflow-x-auto">
                    <h3 className="font-bold mb-2">ESC/POS Preview:</h3>
                    <pre className="font-mono min-w-max">{previewText}</pre>
                </div>
            )}
        </div>
    );
}

export default function PrintPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <PrintPageContents />
        </Suspense>
    );
}

/**
 * The logo as the thermal printer takes it: a GS v 0 raster of the image at the
 * size bill_logo.ts prints it — inside two thirds of the roll and 240 dots tall,
 * never enlarged — thresholded to one bit. Browser-only (it needs a canvas), so
 * it lives here rather than in the pure encoder.
 *
 * The logo this page holds is normally /restaurant/logo/bill's PNG, which IS
 * that raster already: the fit is then a no-op, the canvas copies it pixel for
 * pixel, and the bytes match the ones the till's bill carries. A branding-PNG
 * fallback (a backend without that route) goes through the same fit and
 * threshold here instead.
 *
 * A failure costs the bill its logo, never the bill.
 */
async function billLogoRasterFromBase64(logoBase64: string): Promise<Uint8Array | null> {
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const i = document.createElement('img');
            i.onload = () => { resolve(i); };
            i.onerror = reject;
            i.src = `data:image/png;base64,${logoBase64}`;
        });
        const fit = billLogoFit(img.naturalWidth, img.naturalHeight);
        if (!fit) {return null;}
        const canvas = document.createElement('canvas');
        canvas.width = fit.width;
        canvas.height = fit.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {return null;}
        // White first: a transparent PNG would otherwise threshold its empty
        // background to black and print a solid slab.
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, fit.width, fit.height);
        ctx.drawImage(img, 0, 0, fit.width, fit.height);
        return billLogoRaster(ctx.getImageData(0, 0, fit.width, fit.height).data, fit.width, fit.height);
    } catch (err) {
        console.error('Failed to render logo to ESC/POS', err);
        return null;
    }
}

/**
 * The ESC/POS twin of the bill rendered above.
 *
 * `printedArg` is the resolved document — items, ladder and grand total — and it
 * is what this encoder prints. It is optional only so the exported signature
 * stays callable as it was; WITHOUT IT THIS FUNCTION REFUSES. It used to resolve
 * the document from the order alone, which was the browser-derived ladder that
 * printed the pre-tax subtotal as the Grand Total (root cause 4), and it cannot
 * do the server reads itself — it has no restaurant id, and no way to tell
 * whether a table's open bill belongs to this order or to the next party sitting
 * there. Callers inside this page always pass it; they have both.
 *
 * `reprint` is decided by the caller for the same reason, and off the SERVER's
 * print state — see `isReprint` in PrintPageContents. It defaults to false so
 * the exported signature stays callable as it was, and because an unmarked
 * reprint is a smaller failure than a REPRINT banner across an original bill.
 *
 * THE BYTES THEMSELVES ARE buildBillEscPos's (lib/bill-escpos.ts), which builds
 * the client's layout command for command the way escpos.ts does — margins,
 * solid rules, the "Name:" slot, Cashier / Bill No., the right-hand ladder, the
 * double-height Grand Total, the disclaimer before the QR. This function only
 * gathers what that needs from the page: the same header, customer slot, ladder
 * and QR sentence the on-screen bill draws, the logo raster and the feedback URL.
 */
export async function generateEscPos(user: any, profile: any, cashierName: string, bill: any, orderArg?: any, logoBase64?: string | null, timeZone: string = DEFAULT_TIMEZONE, billPrint: BillPrintSettings | null = null, printedArg: PrintedBill | null = null, reprint = false, revisedNote: string | null = null): Promise<Uint8Array | null> {
    try {
        // NO SERVER-RESOLVED BILL, NO PAPER — checked before anything is encoded
        // or fetched. This is root cause 4's other half: the fallback that used
        // to stand in for a missing document rebuilt the ladder in the browser
        // and printed the PRE-TAX SUBTOTAL as the Grand Total. This function
        // cannot do the server reads itself (no restaurant id, and no way to
        // tell whether a table's open bill is this order's or the next party's),
        // so it declines instead of inventing one. The caller alerts.
        if (!printedArg) {
            console.error('generateEscPos: refusing to encode — no server-resolved bill was supplied for this order.');
            return null;
        }

        let order = orderArg ?? null;

        if (!order) {
            const searchParams = new URLSearchParams(window.location.search);
            const orderData = searchParams.get('order');
            const orderKey = searchParams.get('orderKey');

            if (orderData) {
                try {
                    order = JSON.parse(decodeURIComponent(orderData));
                } catch (e) {
                    console.error('Failed to parse order from query param', e);
                    order = null;
                }
            }

            if (!order && orderKey && typeof window !== 'undefined') {
                try {
                    const payload = window.localStorage.getItem(orderKey);
                    if (payload) {
                        order = JSON.parse(decodeURIComponent(payload));
                    }
                } catch (e) {
                    console.error('Failed to parse order from localStorage', e);
                    order = null;
                }
            }

            if (!order) {return null;}
        }

        // Resolved once, by the caller, so every figure below comes from one
        // server-computed document. The refusal that guarantees it is at the top
        // of this function, before a single byte is encoded.
        const doc: PrintedBill = printedArg;
        const displayId = doc.billNo || bill?.bill_no || '';

        // The logo, fitted and thresholded the way the till's bill fits it.
        const logo = logoBase64 && typeof window !== 'undefined'
            ? await billLogoRasterFromBase64(logoBase64)
            : null;

        // QR (feedback form lives inside this app at /feedback; env still overrides)
        const fallbackBase = typeof window !== 'undefined' ? `${window.location.origin}/feedback` : '';
        // `||`, not `??` — see the same guard above: the env bakes as "" and `??`
        // never fires on it, which dropped the feedback QR from the printed bill.
        //
        // THE OWNER'S QR SWITCH. With bill_show_qr off there is NO feedback URL,
        // and buildBillEscPos then prints no QR sentence and no QR — exactly what
        // escpos.ts prints for the same tenant from the till. No settings, or
        // settings from a backend without the key, keep the QR (billShowsQr).
        const feedbackUrl = billFeedbackUrl(process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL || fallbackBase, user, billPrint);

        return buildBillEscPos({
            // The dashboard prints for the 80mm roll: 48 columns, 44 of them
            // between the bill's margins.
            width: 48,
            // ** REPRINT **, FIRST AND BIGGEST, above the logo — the backend's
            // own constant, in the backend's own place (see buildBillEscPos).
            reprint,
            // ...or ** UPDATED BILL ** with the replaced print's clock, when this
            // print replaces out-of-date paper (client items 1 and 2).
            revisedNote,
            logo,
            restaurantName: clean(profile?.outlet_name) || 'Receipt',
            // Name, then legal entity / address lines / Ph / GSTIN. Each of
            // those prints ONLY when the tenant has one (billHeaderLines drops
            // the rest), so a restaurant with no GSTIN or no registered entity
            // gets a clean receipt rather than orphan labels.
            headerLines: billHeaderLines(profile, billPrint),
            // R2 item 1 — the customer slot, between the header's rule and the
            // next one, above Date / Bill No., exactly where the client's paper
            // and the thermal bill have it. Same helper as the preview above.
            customerLines: receiptCustomerLines(printedArg, order as { customer?: unknown }),
            printedAt: formatDateTime(Date.now(), timeZone),
            table: String(order.table || ''),
            cashier: cashierName,
            billNo: String(displayId),
            currency: String(order.currencySymbol || '₹'),
            // The document's lines, which are the lines the totals below are
            // built from. Never `order.items` independently of them.
            items: doc.items,
            subtotal: doc.subtotal,
            discount: doc.discount,
            serviceCharge: doc.serviceCharge,
            taxes: doc.taxes,
            roundOff: doc.roundOff,
            grandTotal: doc.grandTotal,
            // An NC-settled bill's block under its 0.00 total — the backend's
            // settled reprint prints the same one.
            settlement: doc.settlement,
            // G2's sentence, and only when the guest is actually being charged
            // for service. It used to print unconditionally, so a bill with the
            // charge waived still told the guest a voluntary service charge was
            // included — on a bill that charged none. Same predicate as the
            // on-screen bill and as routes/bills.ts's serviceChargeNote.
            serviceChargeNote: billChargesForService(doc) ? BILL_SERVICE_CHARGE_NOTE : null,
            feedbackUrl,
            // The tenant's own sentence above the QR when they have set one,
            // otherwise the built-in valet line; '' (the settings fetch failed
            // AND no note of their own) prints no sentence rather than a blank.
            qrNote: billQrNote(billPrint),
        });

    } catch (err) {
        console.error("Error generating ESC/POS sequence:", err);
        return null;
    }
}
