// THE HISTORY MODULE'S OWN DATA LAYER — Flutter parity (docs/parity/history.md).
//
// WHY THIS FILE EXISTS. db.ts's readers swallow failures into empty payloads
// (`getMonthlyHistory` → `[]`, `getClosedBills` → `null`), which is exactly the
// bug history.md finding 1 names: an outage rendered as "no activity". These
// fetchers THROW instead — status 0 (never reached the server) throws a
// TypeError so `isUnreachableError` reads it as an outage, anything else throws
// the server's own sentence — which is the contract `useCachedFetch` +
// `LoadErrorState` are built on.
//
// It also carries the fields db.ts's types do not declare (db.ts is owned by
// the foundation and stays untouched): the LIST rows' `customer` /
// `customer_gstin` (findings 31–32 — the backend has always sent them; Flutter
// reads them off list rows), the detail's `customer_address` (finding 49),
// `nc_total` / `nc_settlement` (finding 41) and `discount_applied_at`
// (finding 44) — and the settled-bill customer write WITH the address, which
// db.ts's `setSettledBillCustomerDetails` cannot send.

import { requestBackend, type ClosedBillDetail, type ClosedBillSummary, type MonthlyHistoryRow } from '@/lib/db';
import { billCustomerSaveOutcome, type BillCustomerSaveOutcome } from '@/lib/bill-customer';
import { refusalSentence } from '@/lib/error-message';

/* ── Types the backend sends and db.ts does not declare ────────────────── */

/** One `GET /bills/closed` row as the backend really sends it. */
export interface HistoryBillSummary extends ClosedBillSummary {
    /** Who the bill was for — rendered as a row chip (finding 31). */
    customer?: string | null;
    /** The corporate party's GSTIN, when one is on the bill (finding 31). */
    customer_gstin?: string | null;
    /** When the discount was applied — the "Handled by" trail reads it. */
    discount_applied_at?: string | null;
}

/**
 * A closed bill's `nc_settlement` payload — why an NC-settled bill took
 * nothing, and on whose say-so (backend migration 052).
 */
export interface NcSettlementWire {
    kind_label?: string | null;
    authorised_by?: string | null;
    reason?: string | null;
    value?: number | string | null;
    would_have_charged?: number | string | null;
}

/** One line item, with the NC comp marker the shared type leaves out. */
export interface HistoryBillItem {
    name: string;
    price: number;
    quantity: number;
    note: string | null;
    line_total: number;
    /** True on a comped line — printed "<name> (NC)" at 0.00 (finding 41a). */
    nc?: boolean;
}

/** `GET /bills/closed/:id`, with everything the Flutter sheet renders. */
export interface HistoryBillDetail extends ClosedBillDetail {
    /** Client item 7 — the billing address, printed as "Address:" lines. */
    customer_address?: string | null;
    /** What the comped lines were worth — "NC value (not charged)". */
    nc_total?: number;
    /** Present only on a bill settled as non-chargeable. */
    nc_settlement?: NcSettlementWire | null;
    discount_applied_at?: string | null;
    items: HistoryBillItem[];
}

export interface HistoryBillsPage {
    bills: HistoryBillSummary[];
    total: number;
    has_more: boolean;
}

export interface HistoryBillsFilter {
    from?: string;
    to?: string;
    search?: string;
    payment_method?: string;
    table?: string;
    limit: number;
    offset: number;
}

/* ── The throw useCachedFetch expects ──────────────────────────────────── */

const throwBackendError = (status: number, text: string, fallback: string): never => {
    if (status === 0) {
        throw new TypeError('Failed to fetch');
    }
    let message = '';
    try {
        message = refusalSentence(JSON.parse(text)) ?? '';
    } catch {
        /* not JSON — the raw body is the best we have */
    }
    if (!message) {
        message = text.trim() || fallback;
    }
    throw Object.assign(new Error(message), { status });
};

/* ── Reads ─────────────────────────────────────────────────────────────── */

/**
 * GET /analytics/history — the month series. Throws on failure (finding 1:
 * a failed read must show an error with Retry, never fake zeros).
 */
export const fetchMonthlyHistory = async (restaurantId: string, months: number): Promise<MonthlyHistoryRow[]> => {
    const res = await requestBackend<{ series?: MonthlyHistoryRow[] }>({
        restaurantId,
        path: `/analytics/history?months=${Math.max(3, months)}`,
        method: 'GET',
    });
    if (!res.ok) {
        throwBackendError(res.status, res.text, "Couldn't load this section.");
    }
    return Array.isArray(res.data?.series) ? res.data.series : [];
};

/** GET /bills/closed — one page, newest settled first. Throws on failure. */
export const fetchClosedBillsPage = async (restaurantId: string, filter: HistoryBillsFilter): Promise<HistoryBillsPage> => {
    const qs = new URLSearchParams();
    qs.set('limit', String(Math.max(1, Math.min(filter.limit, 200))));
    qs.set('offset', String(Math.max(0, filter.offset)));
    const add = (key: string, value: string | undefined): void => {
        const v = value?.trim() ?? '';
        if (v !== '') { qs.set(key, v); }
    };
    add('from', filter.from);
    add('to', filter.to);
    add('payment_method', filter.payment_method);
    add('table', filter.table);
    add('search', filter.search);
    const res = await requestBackend<Partial<HistoryBillsPage>>({
        restaurantId,
        path: `/bills/closed?${qs.toString()}`,
        method: 'GET',
    });
    if (!res.ok || res.data === null || !Array.isArray(res.data.bills)) {
        return throwBackendError(res.status, res.text, "Couldn't load settled bills.");
    }
    const data = res.data;
    const bills = data.bills ?? [];
    return {
        bills,
        total: data.total ?? bills.length,
        has_more: data.has_more === true,
    };
};

/** GET /bills/closed/:id — the full bill. Throws on failure (finding 50). */
export const fetchClosedBillDetail = async (restaurantId: string, billId: string): Promise<HistoryBillDetail> => {
    const res = await requestBackend<HistoryBillDetail>({
        restaurantId,
        path: `/bills/closed/${encodeURIComponent(billId)}`,
        method: 'GET',
    });
    if (!res.ok || res.data === null) {
        return throwBackendError(res.status, res.text, "Couldn't load this bill.");
    }
    return res.data;
};

/* ── The settled-bill customer write, address included ─────────────────── */

/** What one save answered, `billCustomerSaveOutcome` plus the address half. */
export type SettledBillCustomerOutcome = BillCustomerSaveOutcome & {
    /**
     * The stored address the server answered with — only meaningful on ok.
     * `undefined` when the response carried no `customer_address` key at all
     * (a backend older than migration 054), which the caller reports as "the
     * address was not saved" rather than claiming it was.
     */
    customer_address?: string | null;
};

/**
 * POST /bills/:billId/customer-details — name, GSTIN AND address (client
 * item 7 / finding 49). `customer_gstin` / `customer_address` omitted leave
 * that field unchanged; `null` clears it — the omitted-means-unchanged rule,
 * so an edit can never wipe a field it could not see.
 */
export const saveSettledBillCustomer = async (
    restaurantId: string,
    billId: string,
    input: {
        customer: string;
        /** Omit when the GSTIN is unknown and untouched. `''` clears. */
        gstin?: string | null;
        /** Omit when the address must not be sent. `''` clears. */
        address?: string | null;
    },
): Promise<SettledBillCustomerOutcome> => {
    const body: Record<string, unknown> = { customer: input.customer };
    if (input.gstin !== undefined) {
        body.customer_gstin = input.gstin === null || input.gstin.trim() === '' ? null : input.gstin.trim();
    }
    if (input.address !== undefined) {
        body.customer_address = input.address === null || input.address.trim() === '' ? null : input.address;
    }
    const res = await requestBackend({
        restaurantId,
        path: `/bills/${encodeURIComponent(billId)}/customer-details`,
        method: 'POST',
        body,
    });
    const outcome = await billCustomerSaveOutcome(res.status, res.text, input.gstin !== undefined);
    if (!outcome.ok) { return outcome; }
    let address: string | null | undefined;
    try {
        const parsed: unknown = JSON.parse(res.text);
        if (parsed !== null && typeof parsed === 'object' && 'customer_address' in parsed) {
            const raw = (parsed as { customer_address?: unknown }).customer_address;
            address = typeof raw === 'string' ? raw : null;
        }
    } catch {
        /* no JSON body — the address stays unknown */
    }
    return { ...outcome, customer_address: address };
};
