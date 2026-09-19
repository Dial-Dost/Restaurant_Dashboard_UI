/**
 * Pure helpers that turn server documents into BillPaper props. Shared by the
 * in-place preview dialog and the browser-print page so the two cannot drift.
 */

import type { BillPrintSettings, RestaurantProfile } from "@/lib/db";
import { settledBillCustomerLines } from "@/components/history/settled-bill-lib";
import type { BillTotalsSource } from "@/lib/bill-escpos";
import type { PaperItem } from "./bill-paper";

type Doc = Record<string, unknown>;

/** Trimmed string; "null"/"undefined" count as unset (escpos.ts present()). */
export const cleanText = (v: unknown): string => {
    const s = typeof v === "string" ? v.trim() : "";
    return s.toLowerCase() === "null" || s.toLowerCase() === "undefined" ? "" : s;
};

const num = (v: unknown): number => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    return Number.isFinite(n) ? n : 0;
};

/** Legal entity, address lines, Ph, GSTN — only the ones set. */
export const paperHeaderLines = (profile: RestaurantProfile | null, billPrint: BillPrintSettings | null): string[] => {
    const lines: string[] = [];
    const legalName = cleanText(billPrint?.legalName);
    if (legalName) { lines.push(legalName); }
    lines.push(...cleanText(profile?.outlet_add).split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
    const phone = cleanText(profile?.outlet_phone);
    if (phone) { lines.push(`Ph : ${phone}`); }
    const gstin = cleanText(billPrint?.gstin);
    if (gstin) { lines.push(`GSTN : ${gstin}`); }
    return lines;
};

/** The sentence above the QR: the tenant's own, else the backend default. */
export const paperQrNote = (billPrint: BillPrintSettings | null): string => {
    const own = cleanText(billPrint?.qrNote);
    if (own) { return billPrint?.qrNoteMax ? own.slice(0, billPrint.qrNoteMax) : own; }
    return cleanText(billPrint?.qrNoteDefault);
};

/** "Name:" / "Customer GSTIN:" / "Address:" lines off a bill payload. */
export const paperCustomerLines = (doc: Doc | null, fallbackCustomer?: unknown): string[] =>
    settledBillCustomerLines({
        customer: doc !== null && "customer" in doc ? (doc.customer as string | null) : (typeof fallbackCustomer === "string" ? fallbackCustomer : null),
        customer_gstin: doc !== null && typeof doc.customer_gstin === "string" ? doc.customer_gstin : null,
        customer_address: doc !== null && typeof doc.customer_address === "string" ? doc.customer_address : null,
    });

/** A server bill's lines, with the price point and the NC flag carried through. */
export const paperItemsOf = (doc: Doc | null, prefix = "i"): PaperItem[] => {
    const raw = doc !== null && Array.isArray(doc.items) ? (doc.items as unknown[]) : [];
    return raw.map((it, i) => {
        const m = (it !== null && typeof it === "object" ? it : {}) as Doc;
        const base = typeof m.name === "string" ? m.name : "";
        const variation = cleanText(m.variation);
        return {
            key: `${prefix}${String(i)}`,
            name: variation ? `${base} (${variation})` : base,
            quantity: num(m.quantity) || 1,
            price: num(m.price),
            nc: m.nc === true,
        };
    });
};

/** Tax lines normalised, nameless ones dropped. */
export const paperTaxRows = (raw: unknown): BillTotalsSource["taxes"] => {
    if (!Array.isArray(raw)) { return []; }
    return raw
        .map((t: unknown, i: number) => {
            const m = (t !== null && typeof t === "object" ? t : {}) as Doc;
            const id = typeof m.id === "string" || typeof m.id === "number" ? String(m.id) : `t${String(i)}`;
            return { id, name: typeof m.name === "string" ? m.name : "", percentage: num(m.percentage), amount: num(m.amount) };
        })
        .filter((t) => t.name !== "");
};

/** The round-off the server disclosed (never derived here). */
const roundOffOf = (doc: Doc): number | null => {
    const v = doc.round_off;
    if (v === null || v === undefined || v === "") { return null; }
    const n = num(v);
    return Number.isFinite(n) ? n : null;
};

/** The OPEN bill's ladder (GET /bill-for-table / the claim's printable bill). */
export const openBillTotals = (doc: Doc): Omit<BillTotalsSource, "items"> => {
    const discount = num(doc.discount);
    const code = cleanText(doc.coupon_code);
    const sc = num(doc.service_charge);
    return {
        subtotal: num(doc.subtotal ?? doc.total_amt),
        discount: discount > 0 ? { label: code ? `Coupon ${code}` : "Discount", amount: discount } : null,
        serviceCharge: sc > 0 ? { percent: num(doc.service_charge_percent), amount: sc } : null,
        taxes: paperTaxRows(doc.taxes),
        roundOff: roundOffOf(doc),
    };
};

/** Does this bill charge the guest for service — as a row or as a tax line? */
export const paperChargesForService = (totals: Omit<BillTotalsSource, "items">): boolean =>
    (totals.serviceCharge !== null && totals.serviceCharge.amount > 0)
    || totals.taxes.some((t) => /service\s*charge/i.test(t.name) && t.amount > 0);
