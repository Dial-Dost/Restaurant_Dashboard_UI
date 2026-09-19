// THE ORDERS MODULE'S OWN DATA LAYER — Flutter parity (docs/parity/orders.md).
//
// WHY THIS FILE EXISTS. `src/lib/db.ts`'s `mapOrder` drops four server fields
// the Flutter Orders screen renders — `moved_from`, `moved_items`, `note` and
// the takeaway/delivery contact pair (`customer_phone`, `delivery_address`) —
// and its status union has no "Pending", so a guest-QR / queue pre-order could
// never form the Upcoming section (findings 8, 9, 18). db.ts is owned by the
// foundation and stays untouched; this module fetches GET /orders itself and
// maps the FULL row (a `mapOrder` equivalent, plus the dropped fields).
//
// It also holds the pure rules the Flutter page states once and this page must
// state identically: the three lifecycle sections, the 24h live window, the
// focused → pending → newest sort, the 10/15-minute escalation, the kitchen's
// duration format, the moved-items sentences (models/order_moves.dart, shared
// with src/lib/table-move.ts's move strings) and the bark toast built from the
// server's own print report (finding 28).

import { requestBackend, type OrdersScope, type PaymentMethod } from '@/lib/db';
import type { ServiceClock } from '@/lib/service-clock';
import type { OrderTiming } from '@/lib/order-clock';
import type { BillPrintState } from '@/lib/bill-print-state';

/* ── Types (the page's Order, moved here so db.ts and the components share it) ── */

export interface OrderItem {
    id: string;
    name: string;
    quantity: number;
    price: number;
    orderedAt: string;
    note?: string | null;
    station?: string | null;
    course_hold?: boolean;
    fired_at?: string | null;
    nc?: boolean;
    nc_id?: string | null;
    nc_kind?: string | null;
    menu_id?: string | null;
    variation_id?: string | null;
    variation_name?: string | null;
}

export interface OrderTax {
    id: string;
    name: string;
    percentage: number;
}

/**
 * Stage 8 — "Pending" — joins the union: a guest QR ticket or a queue
 * pre-order the owner has not accepted yet (finding 18). Everything else is
 * unchanged so `db.ts`'s `mapOrder` keeps compiling against this shape.
 */
export type OrderStatus =
    | 'Pending'
    | 'Preparing'
    | 'Served'
    | 'Bill Verification'
    | 'Payment Pending Approval'
    | 'Paid'
    | 'Closed'
    | 'Cancelled';

export interface Order {
    id: string;
    table: string;
    customer: string;
    bill_print_state?: BillPrintState | null;
    printable_bill?: Record<string, unknown> | null;
    order_type?: string | null;
    taken_by_employee_id?: string | null;
    taken_by_employee_name?: string | null;
    taken_by_employee_role?: string | null;
    items: OrderItem[];
    items_flattened?: OrderItem[];
    items_split?: [string, OrderItem[]][];
    subtotal: number;
    serviceChargePercentage?: number;
    taxes?: OrderTax[];
    applyServiceCharge: boolean;
    total: number;
    status: OrderStatus;
    payment_method?: PaymentMethod | null;
    payment_proof_screenshot_url?: string | null;
    payment_waiter_confirmed_at?: string | null;
    payment_waiter_confirmed_by?: string | null;
    payment_admin_approved_at?: string | null;
    payment_admin_approved_by?: string | null;
    bill_closed_at?: string | null;
    bill_closed_by?: string | null;
    bill_id?: string | null;
    timing?: OrderTiming | null;
    barked_at?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
    kot_nos?: number[] | null;
    service?: ServiceClock | null;
    /* The four fields db.ts's mapper drops (findings 8, 9): */
    /** The table a moved ticket came FROM ("Moved from 12"), or null. */
    moved_from?: string | null;
    /** What a dish move took OFF this ticket, grouped by destination. */
    moved_items?: MovedItem[] | null;
    /** Order-level note ("no onion on anything"). */
    note?: string | null;
    /** Takeaway/delivery contact. */
    customer_phone?: string | null;
    delivery_address?: string | null;
}

export interface MovedItem {
    to_table?: string | null;
    name?: string | null;
    item_name?: string | null;
    variation?: string | null;
    variation_name?: string | null;
    quantity?: number | string | null;
    qty?: number | string | null;
}

export interface OrdersBundle {
    orders: Order[];
    /** null on an older backend without /orders/scope — every consumer degrades. */
    scope: OrdersScope | null;
}

/** An HTTP refusal keeps its status so `isUnreachableError` reads it as a
 *  refusal, never as an outage; a dead line carries `status: null`. */
export class OrdersApiError extends Error {
    status: number | null;
    constructor(message: string, status: number | null) {
        super(message);
        this.name = 'OrdersApiError';
        this.status = status;
    }
}

/* ── Small readers ─────────────────────────────────────────────────────── */

const str = (v: unknown, fallback = ''): string => {
    if (typeof v === 'string') { return v; }
    if (typeof v === 'number' && Number.isFinite(v)) { return String(v); }
    return fallback;
};

const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

const numOf = (v: unknown, fallback = 0): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

const qtyOf = (v: unknown): number => {
    const n = Math.round(numOf(v, 1));
    return n < 1 ? 1 : n;
};

/* ── The mapper (mapOrder equivalent + the dropped fields) ─────────────── */

const mapItem = (raw: unknown): OrderItem => {
    const it = (raw ?? {}) as Record<string, unknown>;
    return {
        id: str(it.id, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        name: str(it.name, str(it.item_name, 'Item')),
        quantity: qtyOf(it.quantity ?? it.qty),
        price: numOf(it.price),
        orderedAt: str(it.orderedAt),
        note: strOrNull(it.note),
        station: strOrNull(it.station),
        course_hold: it.course_hold === true,
        fired_at: strOrNull(it.fired_at),
        nc: it.nc === true,
        nc_id: strOrNull(it.nc_id),
        nc_kind: strOrNull(it.nc_kind),
        menu_id: strOrNull(it.menu_id),
        variation_id: strOrNull(it.variation_id),
        variation_name: strOrNull(it.variation_name),
    };
};

const mapItems = (raw: unknown): OrderItem[] => (Array.isArray(raw) ? raw.map(mapItem) : []);

const wireNumbers = (raw: unknown): number[] | undefined => {
    if (!Array.isArray(raw)) { return undefined; }
    const out: number[] = [];
    for (const v of raw) {
        const n = Number(v);
        if (Number.isFinite(n)) { out.push(n); }
    }
    return out;
};

const mapMovedItems = (raw: unknown): MovedItem[] | null => {
    if (!Array.isArray(raw)) { return null; }
    const out: MovedItem[] = [];
    for (const entry of raw) {
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
            out.push(entry as MovedItem);
        }
    }
    return out.length > 0 ? out : null;
};

/**
 * One order row, wire → screen. Field-for-field what db.ts's `mapOrder` does,
 * PLUS `moved_from` / `moved_items` / `note` / `customer_phone` /
 * `delivery_address`, and a status union that admits "Pending".
 */
export const mapLiveOrder = (raw: unknown): Order => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const flattened = Array.isArray(item.items_flattened) ? mapItems(item.items_flattened) : mapItems(item.items);
    const status = (str(item.status, 'Preparing') as OrderStatus);
    return {
        id: str(item.id, `${Date.now()}`),
        table: str(item.table),
        customer: str(item.customer, 'Guest'),
        order_type: strOrNull(item.order_type),
        taken_by_employee_id: strOrNull(item.taken_by_employee_id),
        taken_by_employee_name: strOrNull(item.taken_by_employee_name),
        taken_by_employee_role: strOrNull(item.taken_by_employee_role),
        items: flattened,
        items_flattened: flattened,
        items_split: (() => {
            if (Array.isArray(item.items_split)) {
                return (item.items_split as unknown[]).map((t) => {
                    const tuple = Array.isArray(t) ? t : [];
                    return [str(tuple[0]), mapItems(tuple[1])] as [string, OrderItem[]];
                });
            }
            if (status === 'Preparing') { return [['Served', []], ['Preparing', flattened]] as [string, OrderItem[]][]; }
            return [['Served', flattened], ['Preparing', []]] as [string, OrderItem[]][];
        })(),
        subtotal: numOf(item.subtotal),
        serviceChargePercentage: item.serviceChargePercentage === undefined ? undefined : numOf(item.serviceChargePercentage),
        taxes: Array.isArray(item.taxes)
            ? (item.taxes as unknown[]).map((t) => {
                const tax = (t ?? {}) as Record<string, unknown>;
                return { id: str(tax.id, `${Date.now()}`), name: str(tax.name, 'Tax'), percentage: numOf(tax.percentage) };
            })
            : undefined,
        applyServiceCharge: Boolean(item.applyServiceCharge),
        total: numOf(item.total),
        status,
        payment_method: strOrNull(item.payment_method),
        payment_proof_screenshot_url: strOrNull(item.payment_proof_screenshot_url),
        payment_waiter_confirmed_at: strOrNull(item.payment_waiter_confirmed_at),
        payment_waiter_confirmed_by: strOrNull(item.payment_waiter_confirmed_by),
        payment_admin_approved_at: strOrNull(item.payment_admin_approved_at),
        payment_admin_approved_by: strOrNull(item.payment_admin_approved_by),
        bill_closed_at: strOrNull(item.bill_closed_at),
        bill_closed_by: strOrNull(item.bill_closed_by),
        bill_id: strOrNull(item.bill_id),
        timing: item.timing && typeof item.timing === 'object' ? item.timing : null,
        created_at: strOrNull(item.created_at),
        updated_at: strOrNull(item.updated_at),
        // ABSENT stays absent (older backend): `undefined` means "cannot tell",
        // which isOrderBarked reads as barked and kotLabel reads as "no chip".
        barked_at: 'barked_at' in item ? strOrNull(item.barked_at) : undefined,
        kot_nos: wireNumbers(item.kot_nos),
        // Interpreted only by src/lib/service-clock.ts; carried verbatim.
        service: (item.service && typeof item.service === 'object' ? item.service : null) as ServiceClock | null,
        moved_from: strOrNull(item.moved_from),
        moved_items: mapMovedItems(item.moved_items),
        note: strOrNull(item.note),
        customer_phone: strOrNull(item.customer_phone),
        delivery_address: strOrNull(item.delivery_address),
    };
};

/* ── Fetchers ──────────────────────────────────────────────────────────── */

const errorFrom = (text: string, status: number, fallback: string): OrdersApiError => {
    let message = fallback;
    try {
        const parsed: unknown = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
            const body = parsed as Record<string, unknown>;
            const said = str(body.details, str(body.error, str(body.message)));
            if (said) { message = said; }
        }
    } catch { /* not JSON — keep the fallback */ }
    return new OrdersApiError(message, status === 0 ? null : status);
};

/** GET /orders + GET /orders/scope in one load (the Flutter module's `load`). */
export const fetchOrdersBundle = async (restaurantId: string): Promise<OrdersBundle> => {
    const res = await requestBackend<unknown[]>({
        path: `/orders?restaurantId=${encodeURIComponent(restaurantId)}`,
        method: 'GET',
        restaurantId,
    });
    if (!res.ok || !Array.isArray(res.data)) {
        throw errorFrom(res.text, res.status, "Couldn't load orders.");
    }
    const orders = res.data.map(mapLiveOrder);
    // Scope is the explanation for an empty grid, never a reason to fail it.
    let scope: OrdersScope | null = null;
    try {
        const scopeRes = await requestBackend<OrdersScope>({
            path: `/orders/scope?restaurantId=${encodeURIComponent(restaurantId)}`,
            method: 'GET',
            restaurantId,
        });
        scope = scopeRes.ok ? scopeRes.data : null;
    } catch { scope = null; }
    return { orders, scope };
};

export interface BarkResponse {
    success?: boolean;
    barked_at?: string;
    already_barked?: boolean;
    /** The server's print report — the whole reason the toast can be honest. */
    kot_no?: number | string | null;
    kot_printed?: boolean;
    kot_skipped?: string | null;
}

/** POST /orders/:id/bark — typed to keep the server's KOT print report (finding 28). */
export const barkOrderDetailed = async (restaurantId: string, orderId: string): Promise<BarkResponse> => {
    const res = await requestBackend<BarkResponse>({
        path: `/orders/${encodeURIComponent(orderId)}/bark?restaurantId=${encodeURIComponent(restaurantId)}`,
        method: 'POST',
        restaurantId,
        body: {},
    });
    if (!res.ok) { throw errorFrom(res.text, res.status, 'Unable to bark that order.'); }
    return res.data ?? {};
};

/**
 * WHAT THE PERSON WHO BARKED IS TOLD — `_barkOrder` (modules.dart 14696),
 * sentence for sentence. Null when the response carries no print report at all
 * (an older backend): the caller then keeps its plain success line.
 */
export const barkOutcomeMessage = (resp: BarkResponse): string | null => {
    const kotNo = resp.kot_no;
    if (resp.kot_printed === true) {
        return kotNo === null || kotNo === undefined || String(kotNo).trim() === ''
            ? 'Sent to the kitchen.'
            : `Sent to the kitchen - KOT-${String(kotNo)}`;
    }
    if (resp.kot_skipped === 'disabled') {
        // Auto-print is deliberately off for this restaurant; nothing is wrong.
        return 'Sent to the kitchen.';
    }
    if ('kot_printed' in resp) {
        return 'Sent to the kitchen, but the docket did not print. Use Reprint.';
    }
    return null;
};

/** PATCH /orders/:id/status — the everyday stage walk (Preparing, Served…). */
export const advanceOrderStatus = async (restaurantId: string, orderId: string, status: string): Promise<void> => {
    const res = await requestBackend({
        path: `/orders/${encodeURIComponent(orderId)}/status?restaurantId=${encodeURIComponent(restaurantId)}`,
        method: 'PATCH',
        restaurantId,
        body: { status },
    });
    if (!res.ok) { throw errorFrom(res.text, res.status, 'Unable to update that order.'); }
};

/**
 * The everyday cancel with its reason AND kind — `_cancelOrder`'s weaker route.
 * `reason` and `cancel_kind` are additive on PATCH /orders/:id/status; a server
 * that does not read them behaves exactly as today.
 */
export const cancelOrderViaStatus = async (
    restaurantId: string,
    orderId: string,
    reason: string,
    cancelKind: string,
): Promise<void> => {
    const res = await requestBackend({
        path: `/orders/${encodeURIComponent(orderId)}/status?restaurantId=${encodeURIComponent(restaurantId)}`,
        method: 'PATCH',
        restaurantId,
        body: { status: 'Cancelled', reason, cancel_kind: cancelKind },
    });
    if (!res.ok) { throw errorFrom(res.text, res.status, 'Unable to cancel that order.'); }
};

export interface TakeawayOrderBody {
    order_type: 'takeaway' | 'delivery';
    items: { id?: string; name: string; price: number; quantity: number; note?: string | null; course_hold?: boolean; variation_id?: string }[];
    subtotal: number;
    total: number;
    customer?: string;
    customer_phone?: string;
    delivery_address?: string;
    note?: string;
    taken_by_employee_id?: string | null;
    taken_by_employee_name?: string | null;
    taken_by_employee_role?: string | null;
}

/**
 * POST /orders/takeaway — the channel entry point (finding 27). No table: the
 * backend provisions a hidden virtual table to carry the bill.
 */
export const createTakeawayOrder = async (
    restaurantId: string,
    body: TakeawayOrderBody,
): Promise<BarkResponse & { id?: string; table?: string }> => {
    const res = await requestBackend<BarkResponse & { id?: string; table?: string }>({
        path: `/orders/takeaway?restaurantId=${encodeURIComponent(restaurantId)}`,
        method: 'POST',
        restaurantId,
        body: {
            ...body,
            taxes: [],
            applyServiceCharge: false,
            status: 'Preparing',
        },
    });
    if (!res.ok) { throw errorFrom(res.text, res.status, 'Unable to place that order.'); }
    return res.data ?? {};
};

/* ── The three sections & the 24h live window (modules.dart 3430–3811) ── */

export const ORDER_SECTION_TITLES = ['Upcoming', 'Current', 'Paid'] as const;

/** Shown on the Paid header only while a cancelled ticket is actually in it. */
export const ORDER_PAID_CAPTION = 'Settled, closed and cancelled';

export const ORDERS_LIVE_WINDOW_HOURS = 24;

export const isCancelledStatus = (status: string): boolean => status.trim().toLowerCase() === 'cancelled';

export const orderIsPending = (status: string | null | undefined): boolean =>
    (status ?? '').trim().toLowerCase() === 'pending';

/**
 * Which section an order belongs in: 0 Upcoming (Pending), 2 Paid
 * (Paid / Closed / Cancelled), 1 Current (everything else, unrecognised
 * included).
 */
export const orderSection = (status: string): 0 | 1 | 2 => {
    const s = status.trim().toLowerCase();
    if (s === 'pending') { return 0; }
    if (s === 'paid' || s === 'closed' || isCancelledStatus(s)) { return 2; }
    return 1;
};

/** Elapsed ms since a server timestamp, or null when unparseable. Never negative. */
export const elapsedSinceIsoMs = (iso: string | null | undefined, nowMs?: number): number | null => {
    const raw = (iso ?? '').trim();
    if (!raw) { return null; }
    const at = Date.parse(raw);
    if (!Number.isFinite(at)) { return null; }
    const ms = (nowMs ?? Date.now()) - at;
    return ms < 0 ? 0 : ms;
};

/** Age of an order in hours, or null for a row we cannot date. */
export const orderAgeHours = (order: Order, nowMs?: number): number | null => {
    const ms = elapsedSinceIsoMs(order.created_at, nowMs);
    return ms === null ? null : ms / 3600000;
};

/**
 * The live window: SETTLED tickets (Paid/Closed/Cancelled) drop off at 24h —
 * hidden, not deleted; History keeps them. An UNPAID ticket never ages out,
 * and a notification-focused one is never hidden either.
 */
export const orderAgedOut = (order: Order, focused: boolean, nowMs?: number): boolean => {
    if (focused) { return false; }
    if (orderSection(order.status) !== 2) { return false; }
    const age = orderAgeHours(order, nowMs);
    return age !== null && age >= ORDERS_LIVE_WINDOW_HOURS;
};

/** Past the live window but still owing money — flagged, never cleared. */
export const orderStale = (order: Order, nowMs?: number): boolean =>
    orderSection(order.status) !== 2 && (orderAgeHours(order, nowMs) ?? 0) >= ORDERS_LIVE_WINDOW_HOURS;

/* ── The kitchen's escalation & format (modules.dart 3563–3580, 14151) ── */

export type ElapsedTone = 'neutral' | 'warning' | 'danger';

/**
 * The escalation the kitchen paints on an elapsed timer: quiet under ten
 * minutes, warning past ten, danger past fifteen — finding 19's 10/15 rule,
 * shared verbatim so the floor never chases a kitchen that is not late.
 * `idle` is the un-barked / settled case: nothing is cooking, nothing is late.
 */
export const elapsedTone = (ms: number, idle = false): ElapsedTone => {
    if (idle) { return 'neutral'; }
    const mins = Math.floor(ms / 60000);
    if (mins > 15) { return 'danger'; }
    if (mins > 10) { return 'warning'; }
    return 'neutral';
};

/**
 * "42m 11s" / "9s" — Flutter's `_fmtDur`, character for character (finding
 * 20). Deliberately NEVER switches to hours: a 90-minute ticket reads
 * "90m 12s" on both clients.
 */
export const fmtDur = (ms: number): string => {
    const s = Math.floor(Math.max(0, ms) / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${String(m)}m ${String(sec).padStart(2, '0')}s` : `${String(sec)}s`;
};

/* ── Bark / KOT helpers ───────────────────────────────────────────────── */

/** Missing field (older backend) counts as barked, as everywhere else. */
export const isOrderBarked = (order: Order): boolean =>
    order.barked_at === undefined ? true : order.barked_at !== null;

export const isOrderCancelled = (order: Order): boolean => isCancelledStatus(order.status);

/**
 * "KOT 214" / "KOTs 214, 218" — deduped, positive-only; "" when the backend
 * sent nothing, which is the signal to draw no chip at all.
 */
export const kotLabelOf = (order: Order): string => {
    const raw: unknown = order.kot_nos;
    if (!Array.isArray(raw)) { return ''; }
    const seen = new Set<number>();
    const nos: string[] = [];
    for (const entry of raw as unknown[]) {
        const parsed = Number(entry);
        if (!Number.isFinite(parsed) || parsed <= 0) { continue; }
        const v = Math.round(parsed);
        if (seen.has(v)) { continue; }
        seen.add(v);
        nos.push(String(v));
    }
    if (nos.length === 0) { return ''; }
    return `${nos.length === 1 ? 'KOT' : 'KOTs'} ${nos.join(', ')}`;
};

/* ── Moved-order sentences (models/order_moves.dart, ported verbatim) ──── */

const textOf = (v: unknown): string => {
    if (typeof v !== 'string' && typeof v !== 'number') { return ''; }
    const s = String(v).trim();
    return s === 'null' ? '' : s;
};

/** "2 × Dal (Half)" — one dish as the table sheet already prints it. */
export const moveDishLine = (line: MovedItem): string => {
    const name = textOf(line.name) || textOf(line.item_name);
    const size = textOf(line.variation) || textOf(line.variation_name);
    const label = size === '' ? (name === '' ? 'Item' : name) : `${name === '' ? 'Item' : name} (${size})`;
    return `${String(qtyOf(line.quantity ?? line.qty))} × ${label}`;
};

/**
 * "Moved to 31: 1 × NOT YOUR PUCHKA" — what a dish move took OFF this ticket,
 * grouped by where it went ("…; to 32: 2 × Dal"). Null when nothing left it.
 */
export const movedAwayLine = (order: Order): string | null => {
    const raw = order.moved_items;
    if (!Array.isArray(raw) || raw.length === 0) { return null; }
    const byTable = new Map<string, string[]>();
    for (const it of raw) {
        const to = textOf(it.to_table);
        const list = byTable.get(to);
        if (list) { list.push(moveDishLine(it)); } else { byTable.set(to, [moveDishLine(it)]); }
    }
    if (byTable.size === 0) { return null; }
    const parts: string[] = [];
    let first = true;
    for (const [to, dishes] of byTable) {
        const where = to === '' ? 'another table' : to;
        parts.push(`${first ? 'Moved to' : 'to'} ${where}: ${dishes.join(', ')}`);
        first = false;
    }
    return parts.join('; ');
};

/* ── Stage colour semantics (modules.dart `_stageColor`, finding 12) ───── */

export type StageChipTone =
    | { status: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }
    | { color: string };

/**
 * App-wide order-stage colour map: Cancelled = danger, Closed = neutral,
 * Paid/Served = success, Barked = copper ("Not barked" = neutral),
 * Preparing = info, Pending / Bill Verification / Payment Pending Approval =
 * warning. Always paired with the label via StatusChip — never colour alone.
 */
export const stageChipTone = (status: string): StageChipTone => {
    const s = status.toLowerCase();
    if (s.includes('cancel')) { return { status: 'danger' }; }
    if (s.includes('closed')) { return { status: 'neutral' }; }
    if (s.includes('paid') || s.includes('served')) { return { status: 'success' }; }
    if (s.includes('bark')) { return s.startsWith('not') ? { status: 'neutral' } : { color: 'hsl(var(--primary))' }; }
    if (s.includes('prepar')) { return { status: 'info' }; }
    if (s.includes('pending') || s.includes('verif')) { return { status: 'warning' }; }
    return { status: 'neutral' };
};

/* ── Terminal-stage copy (modules.dart 13618–13634) ───────────────────── */

export const CANCELLED_NOTE =
    'This order was cancelled. Cancelled orders are final — reverse it from the Audit Log if this was a mistake.';

export const CANCELLED_CAPTION = 'Cancelled — final. Reverse it from the Audit Log if this was a mistake.';

export const SETTLED_LOCKED_NOTE = 'This bill is settled and locked — its status cannot be changed.';

/** One-line caption for each pickable stage in the change-stage dialog. */
export const stageHint = (stage: string): string => {
    switch (stage) {
        case 'Barked': return 'Announce the order to the kitchen';
        case 'Preparing': return 'Kitchen is cooking this order';
        case 'Served': return 'All items delivered to the table';
        case 'Cancelled': return 'Void this order';
        default: return '';
    }
};

/**
 * "KOT-65 has gone to the kitchen. Only a manager, cashier, captain or admin
 * can cancel it — ask one of them." — the server's own refusal, said the same
 * way when the app declines before sending (models/cancel_kot.dart).
 */
export const cancelNeedsSeniorSentence = (kotNos: readonly number[]): string => {
    const nos: number[] = [];
    for (const n of kotNos) {
        if (n > 0 && !nos.includes(n)) { nos.push(n); }
    }
    const ticket = nos.length === 0 ? 'This order' : nos.map((n) => `KOT-${String(n)}`).join(', ');
    const verb = nos.length > 1 ? 'have' : 'has';
    return `${ticket} ${verb} gone to the kitchen. Only a manager, cashier, captain or admin can cancel it — ask one of them.`;
};

/* ── The sort (modules.dart 3853–3868) ────────────────────────────────── */

/**
 * Focused first, then Pending (awaiting approval), then strictly NEWEST
 * created_at first — the explicit tiebreaker that stops an unstable sort
 * scrambling the list.
 */
export const sortLiveOrders = (orders: readonly Order[], isFocused: (o: Order) => boolean): Order[] => {
    const placedAt = (o: Order): number => {
        const ms = Date.parse(o.created_at ?? '');
        return Number.isFinite(ms) ? ms : 0;
    };
    return [...orders].sort((a, b) => {
        const fa = isFocused(a) ? 0 : 1;
        const fb = isFocused(b) ? 0 : 1;
        if (fa !== fb) { return fa - fb; }
        const pa = orderIsPending(a.status) ? 0 : 1;
        const pb = orderIsPending(b.status) ? 0 : 1;
        if (pa !== pb) { return pa - pb; }
        return placedAt(b) - placedAt(a);
    });
};
