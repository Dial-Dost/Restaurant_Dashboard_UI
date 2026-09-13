"use client";

import { useEffect, Suspense, useState } from 'react';
import QRCode from 'qrcode';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import type { BillPrintSettings, RestaurantProfile} from '@/lib/db';
import { getBillPrintSettings, getRestaurantProfile, getRestaurantLogo, getBillByOrder, getBillForTable, getClosedBill, requestBackend } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import Image from 'next/image';
import { DEFAULT_TIMEZONE, formatDateTime } from '@/lib/tz';
import { useTimezone } from '@/lib/use-timezone';
import { isReprintOfPrintedBill, REPRINT_MARKER, type BillPrintState } from '@/lib/bill-print-state';

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

/** One line as this page prints it, whichever source supplied it. */
interface PrintedLine { id: string; name: string; quantity: number; price: number }

/** One printed bill, normalised — the ONLY thing either renderer below reads. */
interface PrintedBill {
    items: PrintedLine[];
    subtotal: number;
    totalQty: number;
    discount: { label: string; amount: number } | null;
    /** optedOut prints "Opted-out" in place of an amount, exactly as escpos.ts does. */
    serviceCharge: { percent: number; amount: number; optedOut: boolean } | null;
    taxes: { id: string; name: string; percentage: number; amount: number }[];
    /**
     * Null when the SERVER supplied the grand total. escpos.ts omits its round-off
     * line in that case for the same reason: the billing layer has already decided
     * the figure, so there is no rounding left for a renderer to disclose, and a
     * round-off line here would be this page claiming an adjustment it never made.
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
    if (printed.serviceCharge && !printed.serviceCharge.optedOut && printed.serviceCharge.amount > 0) {return true;}
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
 * A positive amount prints the charge; a zero amount against a non-zero percent
 * prints "Opted-out", so the guest can see the charge was REMOVED rather than
 * never applied. `waived` forces that reading where the percent handed in is the
 * one a live waiver was priced at rather than a live config value — which is the
 * only percent that is non-zero on a tenant carrying its service charge as a tax
 * line. Mirrors the serviceCharge branch in routes/bills.ts and the `sc` guard in
 * escpos.ts; all three must agree or the same bill reads differently on paper.
 */
function serviceChargeRow(amount: number, percent: number, waived: boolean): PrintedBill['serviceCharge'] {
    if (amount > 0) {return { percent, amount, optedOut: false };}
    if (waived || percent > 0) {return { percent, amount: 0, optedOut: true };}
    return null;
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
                false,
            ),
            taxes: taxRows(settled.taxes),
            roundOff: null,
            grandTotal: settledGrand,
            billNo: String(settled.bill_no ?? ''),
            source: 'settled',
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
        }));
        const discountAmt = Number(openBill.discount) || 0;
        // A live waiver (migration 036) has already been taken out of
        // service_charge AND of the tax lines by openBillChargeConfig, so the
        // percent to show beside "Opted-out" is the one the waiver was priced at.
        // Reading a config value here instead would print 0% on exactly the
        // tenant whose charge lives in the tax config.
        const waived = openBill.service_charge_waived === true;
        const waivedPercent = Number(openBill.service_charge_waiver?.basis_percent) || 0;
        const printed: PrintedBill = {
            items,
            subtotal: Number(openBill.subtotal) || 0,
            totalQty: sumQty(items),
            discount: discountAmt > 0
                ? { label: openBill.coupon_code ? `Coupon ${openBill.coupon_code}` : 'Discount', amount: discountAmt }
                : null,
            serviceCharge: serviceChargeRow(
                Number(openBill.service_charge) || 0,
                waived ? waivedPercent : (Number(openBill.service_charge_percent) || 0),
                waived,
            ),
            // On a tax-line tenant the service charge IS one of these rows, which
            // is what the thermal bill prints for the same table. The two
            // renderers show the tenant's own shape rather than a normalised one.
            taxes: taxRows(openBill.taxes),
            roundOff: null,
            grandTotal: openGrand,
            billNo: String(openBill.bill_no ?? ''),
            source: 'open',
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

function PrintPageContents() {
    // A bill handed to a guest must carry the restaurant's clock, not the
    // clock of whatever machine happens to be driving the printer.
    const { timezone } = useTimezone();
    const searchParams = useSearchParams();
    const orderKey = searchParams.get('orderKey');
    const legacyOrderData = searchParams.get('order');
    const { user } = useAuth();
    const [logoBase64, setLogoBase64] = useState<string | null>(null);
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
                        const logo = await getRestaurantLogo(restaurantId).catch(() => null);
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
            const baseUrl = (process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL || fallbackBase).replace(/\/$/, '');
                            if (baseUrl && user?.res_id && user?.employeeId && user?.outlet_id) {
                                const params = new URLSearchParams({ restaurantId: user.res_id, employeeId: user.employeeId, outletId: user.outlet_id });
                                const feedbackUrl = `${baseUrl}?${params.toString()}`;
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
    const isReprint = printed.source === 'open' && isReprintOfPrintedBill(order.bill_print_state);
    const currencySymbol = order.currencySymbol || '₹';
    const cashierName = `${user?.emp_Fname ?? ''}${user?.emp_Lname ? ` ${user.emp_Lname}` : ''}`.trim() || '';
    const billId = bill?.id ?? settledBill?.id ?? openBill?.bill_id ?? '';
    // The bill number off the SAME document the totals came from, so the header
    // and the money on one receipt cannot name two different bills.
    const billNo = printed.billNo || bill?.bill_no || '';

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
                    }
                }
            `}</style>
            
            <Card className="mx-auto w-[420px] max-w-full shadow-none border-black receipt-card">
                <div className="mb-3 no-print">
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
                                    const esc = await generateEscPos(user, profile, cashierName, bill, order, logoBase64, timezone, billPrint, printed, isReprint);
                                    // Never silent: an encoder that returned null
                                    // printed nothing, and an operator who thinks
                                    // he has sent a bill to the thermal printer
                                    // will hand the guest a blank hand instead of
                                    // reprinting.
                                    if (!esc) {
                                        alert('Could not build the bill for the thermal printer. Nothing was sent.');
                                        return;
                                    }

                                    // Convert ESC/POS > readable text preview
                                    const decoded = new TextDecoder().decode(esc);
                                    setPreviewText(decoded);

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
                                            body: { restaurantId: user?.res_id, outletId: user?.outlet_id, billId: billId || String(Date.now()), escBase64: b64 },
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
                {isReprint ? (
                    <div className="border-b-2 border-black py-2 text-center text-2xl font-extrabold tracking-widest">
                        {REPRINT_MARKER}
                    </div>
                ) : null}
                <CardHeader className="text-center border-b border-black pb-4">
                    {logoBase64 ? (
                        <Image src={`data:image/png;base64,${logoBase64}`} alt="logo" className="mx-auto h-16 object-contain" width={64} height={64} />
                    ) : (
                        <p> Loading Logo ... </p>
                    )}
                    <CardTitle className="text-2xl font-bold">{profile?.outlet_name ?? 'Not found'}</CardTitle>
                    {/* Legal entity, address lines, GSTIN — each rendered only
                        when the tenant has one, so a restaurant without them
                        gets a clean receipt instead of empty labels. */}
                    <CardDescription className="text-sm">
                        {billHeaderLines(profile, billPrint).map((l, i) => (
                            <span key={i} className="block">{l}</span>
                        ))}
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-6">
                    <div className="mb-4 text-sm" > 
                        <div className="w-full">
                            <p><strong>Customer Name:</strong> {order.customer}</p>
                        </div>
                        <div className="border-t border-black pt-2 w-full text-center flex justify-between">
                            <p><strong>Date:</strong> {formatDateTime(Date.now(), timezone)}</p>
                            <p><strong>Dine In:</strong> {order.table}</p>
                           
                        </div>
                        <div className="w-full flex justify-between">
                             <p><strong>Bill No.:</strong> {billNo}</p>
                            <p><strong>Cashier:</strong> {cashierName}</p>
                        </div>
                    </div>
                    <Table className="border-t border-black">
                        <TableHeader>
                            <TableRow className="border-b border-black">
                                <TableHead className="text-black">Item</TableHead>
                                <TableHead className="text-black text-center">Qty</TableHead>
                                <TableHead className="text-black text-right">Price</TableHead>
                                <TableHead className="text-black text-right">Total</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {/* The lines of the bill the totals below belong to —
                                the server's merged list when it supplied the
                                money, this order's own list otherwise. Items and
                                total always come from the same document. */}
                            {printed.items.map(item => (
                                <TableRow key={item.id}>
                                    <TableCell className="font-medium">{item.name}</TableCell>
                                    <TableCell className="text-center">{item.quantity}</TableCell>
                                    <TableCell className="text-right">{item.price.toFixed(2)}</TableCell>
                                    <TableCell className="text-right">{(item.price * item.quantity).toFixed(2)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    <div className="mt-6 space-y-2 text-sm ml-auto max-w-xs ">
                        {/* The rungs in escpos.ts's order: Subtotal, Total Qty,
                            Discount, Service Charge, taxes, Grand Total. Same
                            ladder, same source, so the paper from either printer
                            reads the same. */}
                        <div className="flex justify-between border-t border-black pt-2">
                            <span>Subtotal</span>
                            <span>{printed.subtotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span>Total Qty</span>
                            <span>{printed.totalQty}</span>
                        </div>
                        {printed.discount && (
                            <div className="flex justify-between">
                                <span>{printed.discount.label}</span>
                                <span>- {printed.discount.amount.toFixed(2)}</span>
                            </div>
                        )}
                        {printed.serviceCharge && (
                            <div className="flex justify-between">
                                <span>Service Charge ({printed.serviceCharge.percent}%)</span>
                                <span>{printed.serviceCharge.optedOut ? 'Opted-out' : printed.serviceCharge.amount.toFixed(2)}</span>
                            </div>
                        )}
                        {printed.taxes.map(tax => (
                             <div key={tax.id} className="flex justify-between">
                                <span>{tax.name} ({tax.percentage}%)</span>
                                <span>{tax.amount.toFixed(2)}</span>
                            </div>
                        ))}

                        <hr className="border-t border-black my-2" />

                        {/* Round off is disclosed ONLY when this page did the
                            rounding. A server-supplied grand total has none left
                            to disclose — escpos.ts omits the line for the same
                            reason. */}
                        {printed.roundOff !== null && (
                            <div className="flex justify-between text-sm mt-1">
                                <span>Round off</span>
                                <span>{(printed.roundOff > 0 ? '+' : '') + printed.roundOff.toFixed(2)}</span>
                            </div>
                        )}

                        <div className="flex justify-between font-bold text-lg pt-2 mt-2">
                            <span>Grand Total:</span>
                            <span>{currencySymbol}{printed.grandTotal.toFixed(2)}</span>
                        </div>
                    </div>
                    <hr className="border-t border-black my-4" />
                     <div className="text-center mt-2 text-xs text-gray-600">
                        <p>Thanks</p>
                    </div>

                    {/* G2's mandatory sentence, on the browser-printed bill as
                        well as the ESC/POS one — the two are the same document.
                        Printed only when the guest is actually being charged for
                        service; see billChargesForService for why the row alone
                        is not the right question. */}
                    {billChargesForService(printed) ? (
                        <p className="text-center mt-2 text-xs text-gray-600">
                            A Voluntary Service Charge is included to support our staff. If you prefer not to contribute, please inform your server before payment and it will be removed.
                        </p>
                    ) : null}

                    <div className="text-center mt-4 text-xs text-gray-600">
                        {/* The tenant's own sentence when they have set one;
                            otherwise the built-in line the backend supplies.
                            Omitted rather than rendered blank if neither is
                            available (i.e. the settings fetch failed). */}
                        {billQrNote(billPrint) ? <p>{billQrNote(billPrint)}</p> : null}
                                                {qrDataUrl ? (
                                                    <Image src={qrDataUrl} alt="valet-qr" className="mx-auto mt-2 w-[150px] h-[150px]" width={150} height={150} />
                                                ) : (
                          <p className="text-xs text-muted-foreground">Loading QR...</p>
                        )}
                    </div>
                </CardContent>
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
 * The four encoder calls the REPRINT banner makes, named.
 *
 * `@point-of-sale/receipt-printer-encoder` is loaded through a dynamic import
 * and resolves to `any` here, so every call on it is unchecked. Giving the
 * banner's own four methods a shape means a typo in this block is a build error
 * rather than a silently missing marker on a bill — which is exactly the kind of
 * failure a reprint banner cannot afford, because nobody notices the word that
 * did not print.
 */
interface BannerEncoder {
    bold: (on: boolean) => BannerEncoder;
    width: (multiplier: number) => BannerEncoder;
    height: (multiplier: number) => BannerEncoder;
    line: (text: string) => BannerEncoder;
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
 */
export async function generateEscPos(user: any, profile: any, cashierName: string, bill: any, orderArg?: any, logoBase64?: string | null, timeZone: string = DEFAULT_TIMEZONE, billPrint: BillPrintSettings | null = null, printedArg: PrintedBill | null = null, reprint = false): Promise<Uint8Array | null> {
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

        const pkg = await import('@point-of-sale/receipt-printer-encoder');
        const EncoderClass = pkg?.default ?? pkg?.ReceiptPrinterEncoder ?? pkg;
        if (typeof EncoderClass !== 'function') {
            console.error('ReceiptPrinterEncoder is not a constructor', EncoderClass);
            return null;
        }

        const encoder = new EncoderClass({ 
            language: 'esc-pos', 
            width: 48, 
            columns: 48,
            feedBeforeCut: 4, 
        });
        
        if (typeof (encoder).initialize === 'function') {(encoder).initialize();}

        // ----------------------------------------------------
        // Layout Config & Helpers
        // ----------------------------------------------------
        const MAX_CHARS = 48; // Standard width for 80mm printers
        const lineSeparator = '-'.repeat(MAX_CHARS);

        const leftRight = (left: string, right: string, width = MAX_CHARS) => {
            const l = left.toString();
            const r = right.toString();
            if (l.length + r.length >= width) {
                const availableForLeft = width - r.length - 1;
                return l.substring(0, availableForLeft > 0 ? availableForLeft : 0) + ' ' + r;
            }
            return l + ' '.repeat(width - l.length - r.length) + r;
        };

        const wrapText = (text: string, maxLen: number): string[] => {
            const words = (text || '').split(' ');
            const lines: string[] = [];
            let currentLine = '';

            words.forEach(word => {
                if ((currentLine + word).length > maxLen) {
                    if (currentLine) {lines.push(currentLine.trim());}
                    currentLine = word + ' ';
                } else {
                    currentLine += word + ' ';
                }
            });
            if (currentLine) {lines.push(currentLine.trim());}

            return lines.length > 0 ? lines : [''];
        };

        const currencySymbol = 'Rs. '; //order.currencySymbol || '₹';

        // ----------------------------------------------------
        // Receipt Generation
        // ----------------------------------------------------
        encoder.align('center');

        /*
          ** REPRINT **, FIRST AND BIGGEST — the ESC/POS twin of the banner the
          preview draws, in the same place for the same reason.

          ABOVE THE LOGO. escpos.ts puts it there rather than under it because a
          tenant with a tall raster logo would otherwise push the one word that
          has to be unmissable several centimetres down a slip that gets glanced
          at and filed. This encoder must agree with it: the same bill can be
          printed through either path, and a reprint marked one way off the till
          and another way off the dashboard is two documents as far as anyone
          holding both is concerned.

          THE TEXT IS THE BACKEND'S CONSTANT, NOT A STRING TYPED HERE. Thirteen
          characters is also load-bearing there — it survives double width on
          58mm paper (26 of 32 cells) instead of wrapping mid-word — so the
          length is not ours to tidy either.

          Double width AND height plus bold is the largest type the printer has,
          which is what escpos.ts's `big()` emits (ESC ! 0x30 + ESC E 1).
        */
        if (reprint) {
            const banner = encoder as BannerEncoder;
            banner.bold(true).width(2).height(2).line(REPRINT_MARKER).width(1).height(1).bold(false);
        }

        // Dynamically process and insert the Logo if available
        if (logoBase64 && typeof window !== 'undefined') {
            try {
                // 1. Load image asynchronously to get true dimensions
                const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                    const i = document.createElement('img');
                    i.onload = () => { resolve(i); };
                    i.onerror = reject;
                    i.src = `data:image/png;base64,${logoBase64}`;
                });

                // 2. Calculate aspect ratio boundaries
                // Full 80mm printer width is 512 dots. We use 384 for a clean centered logo.
                const MAX_LOGO_WIDTH = 384; 
                let targetWidth = Math.min(img.width, MAX_LOGO_WIDTH);
                
                // 3. Round down to nearest multiple of 8 (Mandatory for ESC/POS bit-image processing)
                targetWidth = Math.floor(targetWidth / 8) * 8;
                
                // 4. Calculate height maintaining aspect ratio
                const targetHeight = Math.round((img.height / img.width) * targetWidth);

                // 5. Draw to off-screen canvas to flatten transparencies
                const canvas = document.createElement('canvas');
                canvas.width = targetWidth;
                canvas.height = targetHeight;
                const ctx = canvas.getContext('2d');
                
                if (ctx) {
                    // Fill white background first (prevent transparent PNGs printing black)
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillRect(0, 0, targetWidth, targetHeight);
                    // Draw resized logo
                    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

                    // 6. Push canvas to encoder using threshold (best for vector logos)
                    encoder.image(canvas, targetWidth, targetHeight, 'threshold');
                    encoder.newline();
                }
            } catch (err) {
                console.error("Failed to render logo to ESC/POS", err);
            }
        }

        // Header Text — name, then legal entity / address lines / GSTIN.
        // Each of those prints ONLY when the tenant has one (billHeaderLines
        // drops the rest), so a restaurant with no GSTIN or no registered
        // entity gets a clean receipt rather than orphan labels.
        encoder
            .bold(true)
            .line(profile?.outlet_name ?? 'CSR Organics Main Outlet')
            .bold(false);

        for (const headerLine of billHeaderLines(profile, billPrint)) {
            encoder.line(headerLine);
        }

        encoder
            .newline()
            .line(lineSeparator)
            .align('left');

        // Meta info
        encoder.line(`Customer Name: ${order.customer || 'Guest'}`);

        encoder.line(lineSeparator);

        const orderDate = formatDateTime(Date.now(), timeZone); 
        encoder.line(leftRight(`Date: ${orderDate}`, `Dine In: ${order.table || 'N/A'}`, MAX_CHARS));
        
        // Resolved once, by the caller, so every figure below comes from one
        // server-computed document. The refusal that guarantees it is at the top
        // of this function, before a single byte is encoded.
        const doc: PrintedBill = printedArg;
        const displayId = doc.billNo || bill?.bill_no || '';
        // if (displayId.length > 18) {
        //     const parts = displayId.split('-');
        //     displayId = parts.length > 1 ? `${parts[0]}-${parts[1].substring(0, 1)}` : displayId.substring(0, 10);
        // }

        encoder.line(leftRight(`Bill No.: ${displayId}`, `Cashier: ${cashierName}`, MAX_CHARS));
        encoder.line(lineSeparator);

        // Items Header 
        const COL_ITEM = 20;
        const COL_QTY = 6;
        const COL_PRICE = 10;
        const COL_TOTAL = 12;

        encoder.line('Item'.padEnd(COL_ITEM) + 'Qty'.padStart(COL_QTY) + 'Price'.padStart(COL_PRICE) + 'Total'.padStart(COL_TOTAL));
        encoder.line(lineSeparator);

        // Items List — the document's lines, which are the lines the totals
        // below are built from. Never `order.items` independently of them.
        doc.items.forEach((it: any) => {
            const itemNameLines = wrapText(it.name, COL_ITEM - 1);
            const qtyStr = String(it.quantity).padStart(COL_QTY);
            const priceStr = Number(it.price).toFixed(2).padStart(COL_PRICE);
            const totalStr = (Number(it.price) * Number(it.quantity)).toFixed(2).padStart(COL_TOTAL);

            encoder.line(itemNameLines[0].padEnd(COL_ITEM) + qtyStr + priceStr + totalStr);

            for (let i = 1; i < itemNameLines.length; i++) {
                encoder.line(itemNameLines[i]);
            }
            
            encoder.newline();
        });

        encoder.line(lineSeparator);

        // Totals — the rungs in escpos.ts's order, off the resolved document.
        encoder.line(leftRight('Subtotal', doc.subtotal.toFixed(2)));
        encoder.line(leftRight('Total Qty', String(doc.totalQty)));

        if (doc.discount) {
            encoder.line(leftRight(doc.discount.label, `- ${doc.discount.amount.toFixed(2)}`));
        }

        if (doc.serviceCharge) {
            encoder.line(leftRight(
                `Service Charge (${doc.serviceCharge.percent}%)`,
                doc.serviceCharge.optedOut ? 'Opted-out' : doc.serviceCharge.amount.toFixed(2),
            ));
        }

        doc.taxes.forEach((t) => {
            encoder.line(leftRight(`${t.name} (${t.percentage}%)`, t.amount.toFixed(2)));
        });

        encoder.line(lineSeparator);
        // Round off is disclosed only when this page did the rounding. A
        // server-supplied grand total has none left to disclose, and escpos.ts
        // drops the line in exactly that case for exactly that reason.
        if (doc.roundOff !== null) {
            encoder.line(leftRight('Round off', (doc.roundOff > 0 ? '+' : '') + doc.roundOff.toFixed(2)));
        }

        // Grand Total LAST
        encoder
            .bold(true)
            .line(leftRight('Grand Total:', currencySymbol + doc.grandTotal.toFixed(2)))
            .bold(false);
            
        encoder.line(lineSeparator);

        // Footer
        encoder
            .align('center')
            .line('Thanks')
            .line(lineSeparator);

        // The tenant's own sentence above the QR when they have set one,
        // otherwise the built-in valet line. Wrapped to the paper width so a
        // long message stays inside the column instead of being clipped.
        //
        // Guarded on non-empty: wrapText('') yields [''], which would feed the
        // encoder a blank line where the sentence should be. That only happens
        // if the settings fetch failed AND the tenant set no note of their own.
        const qrNoteText = billQrNote(billPrint);
        if (qrNoteText) {
            for (const noteLine of wrapText(qrNoteText, MAX_CHARS)) {
                encoder.line(noteLine);
            }
        }
        encoder.newline();

        // QR (feedback form lives inside this app at /feedback; env still overrides)
        const fallbackBase = typeof window !== 'undefined' ? `${window.location.origin}/feedback` : '';
        // `||`, not `??` — see the same guard above: the env bakes as "" and `??`
        // never fires on it, which dropped the feedback QR from the printed bill.
        const baseUrl = (process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL || fallbackBase).replace(/\/$/, '');
        if (baseUrl && user?.res_id && user?.employeeId && user?.outlet_id) {
            const params = new URLSearchParams({ restaurantId: user.res_id, employeeId: user.employeeId, outletId: user.outlet_id });
            const feedbackUrl = `${baseUrl}?${params.toString()}`;
            
            encoder.qrcode(feedbackUrl, 2, 6, 'l');
        }

        // G2's sentence, and only when the guest is actually being charged for
        // service. It used to print unconditionally, so a bill with the charge
        // waived still told the guest a voluntary service charge was included —
        // the paper contradicting its own Opted-out line. Same predicate as the
        // on-screen bill and as routes/bills.ts's serviceChargeNote.
        if (billChargesForService(doc)) {
            encoder.align('center').line('A Voluntary Service Charge is included to support our staff. If you prefer not to contribute, please inform your server before payment and it will be removed.');
        }
        encoder.cut();

        return encoder.encode();

    } catch (err) {
        console.error("Error generating ESC/POS sequence:", err);
        return null;
    }
}