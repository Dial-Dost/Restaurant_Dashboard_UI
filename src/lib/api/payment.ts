// SETTLE / PAYMENT FLOW — data layer + the pure rules of the money screen.
//
// The web half of Flutter's `screens/mis_capture.dart` payment sheet
// (`_PaymentSheet`), `models/nc_settle.dart` (Settle as NC), the merged
// "Remove service charge & print" (client item 6) and the session till memory.
// Fetchers call `requestBackend` (src/lib/db.ts); everything else is pure so
// the sheet, the table sheet and the orders grid share one set of rules.

import { getBillingCounters, requestBackend } from '@/lib/db';
import { serverBillPrintState } from '@/lib/bill-print-state';
import { nextPartyAfterPrint } from '@/lib/api/tables-floor';
import type {
    BillTenderState,
    BillingCounterRecord,
    NonChargeableRecord,
    ServiceChargeWaiverRecord,
    VocabularyOption,
} from '@/lib/mis-capture';

type Row = Record<string, unknown>;

const numOf = (v: unknown): number => {
    if (typeof v === 'number' && Number.isFinite(v)) { return v; }
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
};
const r2 = (v: number): number => Math.round(v * 100) / 100;
const s = (row: Row | null | undefined, key: string): string => {
    const v = row?.[key];
    if (typeof v === 'string') { return v.trim(); }
    if (typeof v === 'number' || typeof v === 'boolean') { return String(v); }
    return '';
};

/* ── Errors ─────────────────────────────────────────────────────────── */

/** A refusal with the server's own sentence and the status it came with (0 = no answer). */
export class PaymentError extends Error {
    constructor(message: string, readonly status: number, readonly bodyMissing: boolean) {
        super(message);
        this.name = 'PaymentError';
    }
    /** The SERVER answered (vs. an outage that recorded nothing). */
    get answered(): boolean { return this.status > 0; }
}

const errorOf = (res: { status: number; data: unknown; text: string }, fallback: string): PaymentError => {
    let msg = '';
    if (typeof res.data === 'object' && res.data !== null) {
        const d = res.data as Row;
        msg = s(d, 'error') || s(d, 'message') || s(d, 'details');
    }
    if (msg === '' && res.status === 0) { msg = 'No connection — nothing was recorded. Reconnect and try again.'; }
    if (msg === '' && res.text.trim() !== '' && !res.text.trim().startsWith('<')) { msg = res.text.trim().slice(0, 300); }
    return new PaymentError(msg || fallback, res.status, res.data === null);
};

const call = async <T = unknown>(
    restaurantId: string,
    path: string,
    method: 'GET' | 'POST',
    fallback: string,
    body?: unknown,
): Promise<T> => {
    const res = await requestBackend<T>({ path, method, restaurantId, body: method === 'POST' ? (body ?? {}) : undefined });
    if (!res.ok) { throw errorOf(res, fallback); }
    return (res.data ?? ({} as T));
};

/** What a caught error says, verbatim when the server said something. */
export const paymentErrorText = (e: unknown): string =>
    e instanceof Error ? e.message : String(e);

/* ── Vocabularies (Flutter order and labels — _ncKinds / _voidKinds / _tipModes) ── */

export const NC_KINDS: readonly VocabularyOption[] = [
    { value: 'complimentary', label: 'Complimentary', hint: 'On the house — a gesture to this guest.' },
    { value: 'guest_complaint', label: 'Guest complaint', hint: 'Taken off after something went wrong.' },
    { value: 'staff_meal', label: 'Staff meal', hint: 'Eaten by staff, not sold.' },
    { value: 'spoilage', label: 'Spoilage', hint: 'Made and not servable — dropped, burnt, sent back.' },
    { value: 'tasting', label: 'Tasting', hint: 'A sample given to the guest or to the trade.' },
    { value: 'promo', label: 'Promotion', hint: 'Part of a running offer or a marketing giveaway.' },
];

export const CANCEL_KINDS: readonly VocabularyOption[] = [
    { value: 'wrong_entry', label: 'Wrong entry', hint: 'Rung up in error — wrong table, wrong dish.' },
    { value: 'guest_changed_mind', label: 'Guest changed their mind', hint: 'Cancelled by the guest before it was wanted.' },
    { value: 'kitchen_error', label: 'Kitchen error', hint: 'The kitchen could not make it as ordered.' },
    { value: 'item_unavailable', label: 'Item unavailable', hint: 'Out of stock after the order was taken.' },
    { value: 'duplicate', label: 'Duplicate ticket', hint: 'The same order was already placed.' },
    { value: 'test_order', label: 'Test order', hint: 'Placed to check a printer or a screen.' },
    { value: 'other', label: 'Other', hint: 'None of the above — say what happened in the reason.' },
];

export const TIP_MODE_PILLS: readonly { value: string; label: string }[] = [
    { value: 'cash', label: 'Cash' },
    { value: 'card', label: 'On the card' },
    { value: 'upi', label: 'UPI' },
    { value: 'wallet', label: 'Wallet' },
    { value: 'other', label: 'Other' },
];

export const TIP_POOL = 'pool';

export const vocabLabel = (vocab: readonly { value: string; label: string }[], value: string): string => {
    const hit = vocab.find((k) => k.value === value);
    if (hit) { return hit.label; }
    const t = value.trim();
    if (t === '') { return '—'; }
    return t[0].toUpperCase() + t.slice(1).replace(/_/g, ' ');
};

/** Flutter `_noPermission`. */
export const noPermission = (act: string): string =>
    `Only a manager can ${act}. Ask one to sign in, or have them granted the permission.`;

export const NO_MODES =
    'No payment mode is switched on. An owner can switch one on in Settings > Payments.';

export const MAX_PROOF_BYTES = 3_000_000;

/* ── Session till memory (deliberately NOT persisted) ──────────────── */

let tillId = '';
let tillLabel = '';
const tillListeners = new Set<() => void>();

export const currentTill = (): { id: string; label: string } => ({ id: tillId, label: tillLabel });

export const chooseTill = (id: string, label: string): void => {
    tillId = id.trim();
    tillLabel = tillId === '' ? '' : label;
    tillListeners.forEach((fn) => { fn(); });
};

/** Retiring a till in Settings clears a matching session selection. */
export const forgetTillIfRetired = (id: string): void => {
    if (id !== '' && id === tillId) { chooseTill('', ''); }
};

export const subscribeTill = (fn: () => void): (() => void) => {
    tillListeners.add(fn);
    return () => { tillListeners.delete(fn); };
};

export const tillLabelOf = (c: BillingCounterRecord): string =>
    `${c.code} · ${c.name || c.code}${!c.active ? ' (retired)' : ''}`;

/* ── Reads ─────────────────────────────────────────────────────────── */

export const fetchTenderState = (restaurantId: string, orderId: string): Promise<BillTenderState> =>
    call<BillTenderState>(
        restaurantId,
        `/bills/tenders?order_id=${encodeURIComponent(orderId)}&restaurantId=${encodeURIComponent(restaurantId)}`,
        'GET',
        'Could not read the payment ledger.',
    );

/** The open bill, or null when the table has none (404). */
export const fetchTableBill = async (restaurantId: string, tableName: string): Promise<Row | null> => {
    const res = await requestBackend<Row>({
        path: `/bill-for-table?table_name=${encodeURIComponent(tableName)}`,
        method: 'GET',
        restaurantId,
    });
    if (res.status === 404) { return null; }
    if (!res.ok) { throw errorOf(res, 'Could not read the bill.'); }
    return res.data;
};

export const fetchTills = async (restaurantId: string): Promise<BillingCounterRecord[]> =>
    (await getBillingCounters(restaurantId, false)) ?? [];

/* ── Writes ────────────────────────────────────────────────────────── */

/** One composed payment, as the wire takes it (Flutter `_DraftTender.toJson`). */
export interface DraftTender {
    method: string;
    amount: number;
    txnRef: string;
    tip: number;
    tipMode: string;
    tipTo: string;
}

export const draftToWire = (t: DraftTender): Row => ({
    method: t.method,
    amount: r2(t.amount),
    ...(t.txnRef.trim() !== '' ? { txn_ref: t.txnRef.trim() } : {}),
    ...(t.tip > 0 ? { tip_amount: r2(t.tip), tip_mode: t.tipMode, tip_credited_to_username: t.tipTo.trim() } : {}),
});

export const recordPartPayment = (restaurantId: string, orderId: string, tenders: DraftTender[]): Promise<BillTenderState> =>
    call<BillTenderState>(restaurantId, '/bills/tenders', 'POST', 'Unable to record that payment', {
        order_id: orderId,
        tenders: tenders.map(draftToWire),
    });

export const voidTender = (restaurantId: string, tenderId: string, reason: string): Promise<unknown> =>
    call(restaurantId, `/bills/tenders/${encodeURIComponent(tenderId)}/void`, 'POST', 'Unable to void that payment', { reason });

/** Settle, approve and close — one tap (Flutter `_settleAndClose`). */
export const settleAndClose = async (
    restaurantId: string,
    orderId: string,
    confirmBody: Row,
    staleOverride: boolean,
): Promise<void> => {
    const oid = encodeURIComponent(orderId);
    await call(restaurantId, `/bills/order/${oid}/waiter-confirm-payment`, 'POST', 'Unable to confirm the payment', confirmBody);
    await call(
        restaurantId,
        `/bills/order/${oid}/admin-approve-payment`,
        'POST',
        'Unable to approve the payment',
        staleOverride ? { settled_with_stale_paper: true } : {},
    );
    await call(restaurantId, `/bills/order/${oid}/close`, 'POST', 'Unable to close the bill');
};

export const settleAsNc = (restaurantId: string, orderId: string, body: Row): Promise<Row> =>
    call<Row>(restaurantId, `/bills/order/${encodeURIComponent(orderId)}/settle-nc`, 'POST', 'Unable to settle as non-chargeable', body);

export const uploadPaymentProof = async (restaurantId: string, base64: string, contentType: string): Promise<string> => {
    const data = await call<Row>(restaurantId, '/billing/upload-payment-proof', 'POST', 'Unable to upload the payment proof', {
        image_base64: base64,
        content_type: contentType,
    });
    return s(data, 'payment_proof_screenshot_url') || s(data, 'image_url');
};

export const printBillForTable = (restaurantId: string, tableName: string): Promise<unknown> =>
    call(restaurantId, '/print/bill', 'POST', 'Could not print the bill.', { table_name: tableName });

/** POST /bills/service-charge-waiver/print — record + print in one call, or reprint (table only). */
export const removeServiceChargeAndPrint = (restaurantId: string, body: Row): Promise<Row> =>
    call<Row>(restaurantId, '/bills/service-charge-waiver/print', 'POST', 'Unable to remove the service charge', body);

export const putServiceChargeBack = (restaurantId: string, waiverId: string, reason: string): Promise<unknown> =>
    call(restaurantId, `/bills/service-charge-waiver/${encodeURIComponent(waiverId)}/reverse`, 'POST', 'Unable to reverse that waiver', { reason });

export const compItem = (
    restaurantId: string,
    orderId: string,
    itemId: string,
    body: { nc_kind: string; reason: string; authorised_by: string; quantity?: number },
): Promise<unknown> =>
    call(
        restaurantId,
        `/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(itemId)}/non-chargeable`,
        'POST',
        'Unable to make that item non-chargeable',
        body,
    );

export const uncompItem = (restaurantId: string, ncId: string, reason: string): Promise<unknown> =>
    call(restaurantId, `/non-chargeables/${encodeURIComponent(ncId)}/reverse`, 'POST', 'Unable to reverse that non-chargeable', { reason });

export const fetchOrderComps = async (restaurantId: string, orderId: string): Promise<NonChargeableRecord[]> => {
    const data = await call<{ non_chargeables?: NonChargeableRecord[] }>(
        restaurantId,
        `/orders/${encodeURIComponent(orderId)}/non-chargeables?restaurantId=${encodeURIComponent(restaurantId)}`,
        'GET',
        'Could not read the comps.',
    );
    return Array.isArray(data.non_chargeables) ? data.non_chargeables : [];
};

/* ── Proof sniffing ────────────────────────────────────────────────── */

/** Content type from the bytes, not the extension (the backend checks magic bytes). */
export const imageTypeOf = (b: Uint8Array): string | null => {
    if (b.length < 12) { return null; }
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) { return 'image/jpeg'; }
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) { return 'image/png'; }
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
        && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) { return 'image/webp'; }
    return null;
};

/* ── Settle as NC (models/nc_settle.dart) ──────────────────────────── */

export const NC_SETTLE_PILL = 'NC · Non-chargeable';
export const NC_SETTLE_BUTTON = 'Settle as NC';
export const NC_WHOLE_BILL_ONLY =
    'Settle as NC covers the whole bill. To give part of it away, comp dishes individually, then take the rest.';
export const NC_SETTLE_UNSUPPORTED =
    'This server does not offer Settle as NC yet. Settle with a payment mode instead, or ask for the server to be updated.';

export const ncValue = (bill: Row | null): number => r2(numOf(bill?.subtotal));
export const ncAlreadyComped = (bill: Row | null): number => r2(numOf(bill?.nc_total));
export const ncGivenAway = (bill: Row | null): number => r2(ncValue(bill) + ncAlreadyComped(bill));
export const ncWouldHaveCharged = (bill: Row | null): number => r2(numOf(bill?.grand_total));

export const ncOpensAsNc = (bill: Row | null): boolean =>
    bill !== null && Math.round(numOf(bill.grand_total) * 100) === 0 && Math.round(ncAlreadyComped(bill) * 100) > 0;

export const ncBlocker = (opts: {
    bill: Row | null;
    tendered: number;
    drafts: number;
    money: (v: number) => string;
}): string | null => {
    const { bill } = opts;
    if (bill === null) { return 'The bill could not be read, so it cannot be settled as non-chargeable from here.'; }
    if (s(bill, 'payment_status') === 'pending_approval') {
        return 'A payment for this bill is already waiting for approval. Approve it, or re-open the bill afterwards — settling it as non-chargeable now would erase money already taken.';
    }
    if (r2(opts.tendered) > 0) {
        return `${opts.money(r2(opts.tendered))} is already recorded as paid on this bill. Void that payment first, or comp dishes individually and take the rest.`;
    }
    if (opts.drafts > 0) { return NC_WHOLE_BILL_ONLY; }
    if (numOf(bill.discount) > 0 || numOf(bill.discount_value) > 0 || s(bill, 'coupon_code') !== '') {
        return 'This bill carries a discount or a coupon. Remove it first — a comped bill has nothing to discount.';
    }
    if (ncValue(bill) <= 0 && ncAlreadyComped(bill) <= 0) { return 'There is nothing on this table to settle.'; }
    return null;
};

export const ncSettleBody = (opts: {
    kind: string; reason: string; authorisedBy: string; expectedValue: number; counterId: string;
}): Row => ({
    nc_kind: opts.kind.trim(),
    reason: opts.reason.trim(),
    authorised_by: opts.authorisedBy.trim(),
    expected_value: r2(opts.expectedValue),
    print: true,
    ...(opts.counterId.trim() !== '' ? { counter_id: opts.counterId.trim() } : {}),
});

export const ncHeadline = (givenAway: number, money: (v: number) => string): string =>
    `NOTHING TO PAY · ${money(givenAway)} given away`;

export const ncDoneSentence = (r: Row, money: (v: number) => string): string => {
    const no = s(r, 'bill_no');
    const bill = no === '' ? 'The bill' : `Bill ${no}`;
    if (r.already === true) { return `${bill} was already settled as non-chargeable.`; }
    const head = `${bill} was settled as non-chargeable — ${money(numOf(r.nc_value))} given away, nothing collected.`;
    if (r.printed === true) { return `${head} The NC bill is printing.`; }
    const why = s(r, 'print_error');
    return why === '' ? head : `${head} The NC bill did not print: ${why}`;
};

/* ── Service charge (036 + client item 6 + 2.0.1) ──────────────────── */

const SERVICE_CHARGE_LINE = /service\s*charge/i;

/** Does this bill carry a service charge — either tax shape (Flutter `_billHasServiceCharge`). */
export const billHasServiceCharge = (bill: Row): boolean => {
    const basis = bill.service_charge_basis;
    if (typeof basis === 'string' && basis !== '') { return basis !== 'none'; }
    if (numOf(bill.service_charge) > 0) { return true; }
    const taxes = Array.isArray(bill.taxes) ? (bill.taxes as unknown[]) : [];
    return taxes.some((t) => typeof t === 'object' && t !== null
        && SERVICE_CHARGE_LINE.test(s(t as Row, 'name')) && numOf((t as Row).amount) > 0);
};

/** The charge on the bill, both legs summed (Flutter `misServiceChargeOnBill`). */
export const serviceChargeOnBill = (bill: Row): number => {
    let total = numOf(bill.service_charge);
    const taxes = Array.isArray(bill.taxes) ? (bill.taxes as unknown[]) : [];
    for (const t of taxes) {
        if (typeof t === 'object' && t !== null && SERVICE_CHARGE_LINE.test(s(t as Row, 'name'))) {
            total += numOf((t as Row).amount);
        }
    }
    return r2(total);
};

/** The live waiver on a /bill-for-table payload, or null. */
export const liveWaiverOf = (bill: Row): ServiceChargeWaiverRecord | null => {
    const w = bill.service_charge_waiver;
    return bill.service_charge_waived === true && typeof w === 'object' && w !== null
        ? (w as ServiceChargeWaiverRecord)
        : null;
};

/** The body of POST /bills/service-charge-waiver/print — a blank reason is OMITTED. */
export const serviceChargeRemovalBody = (opts: {
    tableName: string; kind: string; reason: string; authorisedBy: string;
}): Row => ({
    table_name: opts.tableName,
    waiver_kind: opts.kind,
    ...(opts.reason.trim() !== '' ? { reason: opts.reason.trim() } : {}),
    authorised_by: opts.authorisedBy,
});

/** What to say after "Remove service charge & print" — only what the server reported. */
export const serviceChargeRemovalOutcome = (
    response: unknown,
    money: (v: number) => string,
): { message: string; durationMs: number } => {
    const r = typeof response === 'object' && response !== null ? (response as Row) : {};
    const base = ((): { message: string; durationMs: number } => {
        const created = r.waiver_created === true;
        const printed = r.printed === true;
        const before = r.grand_total_before;
        const after = r.grand_total_after;
        const hasTotals = before != null && after != null;
        if (printed && r.service_charge_removed === false) {
            return { message: 'Printed WITH the service charge — the waiver was put back before the bill printed.', durationMs: 8000 };
        }
        if (!printed) {
            const why = s(r, 'print_error');
            const notPrinted = `did not print${why === '' ? '' : `: ${why}`}. Press Print bill.`;
            if (created && hasTotals) {
                return { message: `Service charge removed (${money(numOf(before))} → ${money(numOf(after))}), but the bill ${notPrinted}`, durationMs: 8000 };
            }
            return {
                message: created || (typeof r.waiver === 'object' && r.waiver !== null)
                    ? `The service charge is off this bill, but the bill ${notPrinted}`
                    : `The bill ${notPrinted}`,
                durationMs: 8000,
            };
        }
        if (created && hasTotals) {
            return { message: `Service charge removed — total ${money(numOf(before))} → ${money(numOf(after))}. Printing bill…`, durationMs: 4000 };
        }
        return {
            message: after != null
                ? `Reprinting without the service charge — total ${money(numOf(after))}.`
                : 'Reprinting without the service charge…',
            durationMs: 3000,
        };
    })();
    const seat = r.printed === true ? nextPartyAfterPrint(r).message : null;
    if (seat === null) { return base; }
    return { message: `${base.message} ${seat}`, durationMs: Math.max(base.durationMs, 6000) };
};

/** The waived card's print control words — follow the server's print state. */
export const serviceChargeWaivedPrintCopy = (bill: Row): { label: string; title: string; body: string; confirm: string } =>
    serverBillPrintState(bill) === true
        ? {
            label: 'Reprint without the charge',
            title: 'Reprint without the service charge?',
            body: 'The bill prints again with the recorded waiver applied — the total the guest pays. It is marked as a reprint.',
            confirm: 'Reprint',
        }
        : {
            label: 'Print without the charge',
            title: 'Print without the service charge?',
            body: 'The bill prints with the recorded waiver applied — the total the guest pays.',
            confirm: 'Print',
        };

/** `“Long wait” — asha, authorised by manager01` (no quoted dash for a blank reason). */
export const serviceChargeWaiverAttribution = (w: ServiceChargeWaiverRecord): string => {
    const why = ((w as { reason?: string | null }).reason ?? '').trim();
    const who = `${w.waived_by_username || '—'}, authorised by ${w.authorised_by_username || '—'}`;
    return why === '' ? who : `“${why}” — ${who}`;
};

export const OPTIONAL_REASON_LABEL = 'Reason (optional)';
