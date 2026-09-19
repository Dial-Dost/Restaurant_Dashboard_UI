// PURE rules the settled-bill surfaces state once — the web half of the
// Flutter readers the parity report cites:
//
//   * `NcSettle` (restaurant_owner_app/lib/models/nc_settle.dart) — the NC
//     marker detection, the canonical label, the settlement payload reader and
//     the comped-line label (history.md findings 36, 41).
//   * `billCustomerLines` + the address rules
//     (lib/screens/bill_customer_name.dart) — the customer slot as the printed
//     paper words it, and the omitted-means-unchanged address send rule
//     (findings 38, 49).
//   * `_billTitle` / `_billWhen` (lib/screens/modules.dart 23394–23400) —
//     title degradation and the settled-instant fallback chain (finding 34).
//
// No React, no fetch — the same discipline as src/lib/bill-round-off.ts, so a
// test can pin every rule against the Flutter sentences.

import { isPlaceholderCustomer } from '@/lib/bill-customer';
import type { HistoryBillSummary, NcSettlementWire } from '@/lib/api/history';

const str = (v: unknown): string => {
    const s = typeof v === 'string' ? v.trim() : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
    return /^(null|undefined)$/i.test(s) ? '' : s;
};

const num = (v: unknown): number => {
    if (typeof v === 'number') { return Number.isFinite(v) ? v : 0; }
    if (typeof v !== 'string') { return 0; }
    const n = Number.parseFloat(v.trim());
    return Number.isFinite(n) ? n : 0;
};

const r2 = (v: number): number => Math.round(v * 100) / 100;

/* ── NC settle (nc_settle.dart) ────────────────────────────────────────── */

/** What every screen calls the NC marker — the backend's NC_SETTLE_LABEL. */
export const NC_SETTLE_LABEL = 'Non-chargeable (NC)';

/** Is this stored method the NC marker? Case- and space-insensitive. */
export const isNcMethod = (raw: unknown): boolean =>
    typeof raw === 'string' && raw.trim().toLowerCase() === 'nc';

/**
 * The label a stored payment method renders with: the one canonical NC label
 * for the marker (migration 052 — the marker is not a mode and has one name
 * everywhere), otherwise whatever the caller's own labelling produced.
 */
export const methodLabelWithNc = (raw: string | null | undefined, labelled: string): string =>
    isNcMethod(raw) ? NC_SETTLE_LABEL : labelled;

export interface NcSettlement {
    kind: string;
    authorisedBy: string;
    reason: string;
    value: number;
    wouldHaveCharged: number | null;
}

/** A closed bill's `nc_settlement`, or null for every bill not settled as NC. */
export const ncSettlementOf = (bill: { payment_method?: string | null; nc_settlement?: NcSettlementWire | null } | null | undefined): NcSettlement | null => {
    if (!bill || !isNcMethod(bill.payment_method)) { return null; }
    const s = bill.nc_settlement;
    if (s === null || s === undefined || typeof s !== 'object') { return null; }
    const w = s.would_have_charged;
    const parsed = w == null ? NaN : Number.parseFloat(String(w));
    return {
        kind: str(s.kind_label),
        authorisedBy: str(s.authorised_by),
        reason: str(s.reason),
        value: r2(num(s.value)),
        wouldHaveCharged: Number.isFinite(parsed) ? r2(parsed) : null,
    };
};

/** A bill line's name as the paper prints it: `"<name> (NC)"` for a comped one. */
export const ncLineLabel = (name: string, nc: unknown): string => (nc === true ? `${name} (NC)` : name);

/* ── Bill row basics (modules.dart) ────────────────────────────────────── */

/** Bill title: "Bill #57 · T1" (either half degrades on its own). */
export const billTitle = (b: { bill_no?: string | null; table_name?: string | null }): string => {
    const no = str(b.bill_no);
    const table = str(b.table_name);
    const left = no === '' ? 'Bill' : `Bill #${no}`;
    return table === '' ? left : `${left} · ${table}`;
};

/**
 * When the bill actually closed. `settled_at` is authoritative; `closed_at`
 * then `created_at` cover rows written before it existed.
 */
export const billWhen = (b: { settled_at?: string | null; closed_at?: string | null; created_at?: string | null }): string =>
    str(b.settled_at) || str(b.closed_at) || str(b.created_at);

/** The row chip's name — placeholders ("Guest", "QR Guest") are not names. */
export const billCustomerChip = (b: HistoryBillSummary): string =>
    isPlaceholderCustomer(b.customer) ? '' : str(b.customer);

/* ── The address (bill_customer_name.dart, client item 7) ──────────────── */

/** Lines an address may have once blank ones are dropped. */
export const ADDRESS_MAX_LINES = 5;
/** Characters the stored address may have, line breaks included. */
export const ADDRESS_MAX_CHARS = 250;
/** The server's 400 sentence, word for word. */
export const ADDRESS_LIMIT_MESSAGE = 'Address can be at most 5 lines and 250 characters';
/** The line under the box — the printer is sent ASCII. */
export const ADDRESS_HELP = 'Up to 5 lines. Leave it empty for none. Letters outside English print as "?".';
/** What the paper puts before the address's first line. */
export const ADDRESS_LABEL = 'Address:';
/** The sentence for a server that answered without keeping the address. */
export const ADDRESS_NOT_SAVED_MESSAGE =
    'The address was not saved: this server has not finished updating. Ask your administrator to complete the update.';

// Built via the constructor because U+2028/U+2029 are line terminators and a
// literal would not survive every toolchain; the parts are compile-time fixed.
// eslint-disable-next-line security/detect-non-literal-regexp
const ADDRESS_BREAKS = new RegExp("\\r\\n?|[" + String.fromCharCode(0x85, 0x2028, 0x2029) + "]", "g");
// eslint-disable-next-line no-control-regex
const ADDRESS_CONTROLS = /[\x00-\x08\x0B-\x1F\x7F-\x9F]/g;

/**
 * The address as the server will store it — lines joined by `\n` — or '' when
 * nothing is left (which clears it). Does NOT apply the limits.
 */
export const normalizeBillAddress = (raw: string): string => raw
    .replace(ADDRESS_BREAKS, '\n')
    .replace(/\t/g, ' ')
    .replace(ADDRESS_CONTROLS, '')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '')
    .join('\n');

/** How much of each limit `raw` uses, measured as the server measures it. */
export const billAddressUsage = (raw: string): { lines: number; chars: number } => {
    const value = normalizeBillAddress(raw);
    return value === '' ? { lines: 0, chars: 0 } : { lines: value.split('\n').length, chars: value.length };
};

/** Null when `raw` is within the limits (or empty), else the server's sentence. */
export const billAddressError = (raw: string): string | null => {
    const u = billAddressUsage(raw);
    return u.lines > ADDRESS_MAX_LINES || u.chars > ADDRESS_MAX_CHARS ? ADDRESS_LIMIT_MESSAGE : null;
};

/**
 * DOES THIS SAVE SEND THE ADDRESS — the Flutter `billCustomerAddressToSend`,
 * rule for rule: untouched → no; touched with the current address KNOWN → only
 * a real change; touched without knowing it → only when something is in the
 * box (an empty box there is not "clear it" — nobody on this screen saw an
 * address to clear).
 */
export const billAddressToSend = (input: { address: string; seed: string; known: boolean; touched: boolean }): boolean => {
    if (!input.touched) { return false; }
    const now = normalizeBillAddress(input.address);
    return input.known ? now !== normalizeBillAddress(input.seed) : now !== '';
};

/** What the address box opens with, given a payload's `customer_address`. */
export const billAddressSeed = (address: unknown): string => {
    const value = str(address);
    return value === '' ? '' : normalizeBillAddress(value);
};

/**
 * THE ADDRESS AS THE PAPER PRINTS IT — one entry per stored line, only the
 * first labelled. Empty for none; a stored "null"/"undefined" is none.
 */
export const billAddressLines = (address: unknown): string[] => {
    const value = str(address);
    if (value === '') { return []; }
    const lines = value.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
    return lines.map((l, i) => (i === 0 ? `${ADDRESS_LABEL} ${l}` : l));
};

/**
 * THE CUSTOMER SLOT — the lines the printed bill carries directly under the
 * restaurant header: `Name:` always (a walk-in leaves it blank, as the paper
 * does), `Customer GSTIN:` only when set, then the `Address:` lines. The
 * settled-bill sheet draws exactly these, in this order (finding 38).
 */
export const settledBillCustomerLines = (bill: {
    customer?: string | null;
    customer_gstin?: string | null;
    customer_address?: string | null;
}): string[] => {
    const name = isPlaceholderCustomer(bill.customer) ? '' : str(bill.customer);
    const gstin = str(bill.customer_gstin);
    return [
        name === '' ? 'Name:' : `Name: ${name}`,
        ...(gstin === '' ? [] : [`Customer GSTIN: ${gstin}`]),
        ...billAddressLines(bill.customer_address),
    ];
};

/* ── The displayed balance identity (finding 40) ───────────────────────── */

export interface BillBalanceIdentity {
    balances: boolean;
    taxable: number;
    service: number;
    taxTotal: number;
    roundOff: number | null;
    grand: number;
}

/**
 * The contract's invariant — `taxable_base + service_charge + tax_total
 * (+ round_off) === grand_total` — shown rather than trusted, so a bill that
 * ever stopped balancing is visible instead of silent. Tolerance 0.05.
 */
export const billBalanceIdentity = (bill: {
    taxable_base?: number | null;
    service_charge?: number | null;
    tax_total?: number | null;
    grand_total?: number | null;
}, roundOff: number | null): BillBalanceIdentity => {
    const taxable = num(bill.taxable_base);
    const service = num(bill.service_charge);
    const taxTotal = num(bill.tax_total);
    const grand = num(bill.grand_total);
    return {
        balances: Math.abs(taxable + service + taxTotal + (roundOff ?? 0) - grand) < 0.05,
        taxable,
        service,
        taxTotal,
        roundOff,
        grand,
    };
};
