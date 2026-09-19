// THE STAFF ORDER PAD's data + draft rules — the web twin of Flutter's
// `screens/order_entry.dart` send path, `models/order_draft.dart` and the
// printed-bill half of `models/next_party.dart` (docs/parity/order-entry.md).
//
// PURE parts (draft lines, payload, block sentence, refusal parse) carry no
// React; the fetchers go through `requestBackend`, which answers status 0 for
// "never reached the server" — the one case the outbox may queue.

import { requestBackend } from '@/lib/db';
import { OutboxSendError, enqueueOutbox, registerOutboxSender, type OutboxEntry } from '@/lib/outbox';
import { tableSentenceName } from '@/lib/api/tables-floor';
import type { MenuVariationRecord } from '@/lib/mis-capture';

/* ── Errors ────────────────────────────────────────────────────────────── */

export class OrderEntryError extends Error {
    /** null = the server was never reached (offline / unreachable). */
    status: number | null;
    body: unknown;
    constructor(message: string, status: number | null, body: unknown = null) {
        super(message);
        this.name = 'OrderEntryError';
        this.status = status;
        this.body = body;
    }
}

const parseJson = (text: string): unknown => {
    try { return JSON.parse(text) as unknown; } catch { return null; }
};

const said = (body: unknown): string => {
    if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>;
        for (const k of ['details', 'error', 'message']) {
            const v = b[k];
            if (typeof v === 'string' && v.trim() !== '') { return v; }
        }
    }
    return '';
};

const failure = (status: number, text: string, fallback: string): OrderEntryError => {
    const body = parseJson(text);
    if (status === 0) {
        return new OrderEntryError('Could not reach the server.', null, body);
    }
    return new OrderEntryError(said(body) || fallback, status, body);
};

/* ── Menu ──────────────────────────────────────────────────────────────── */

/** A /menu row as the pad needs it — the RAW name/price ride untouched into
 *  the payload (orderDraftPayload sends the menu row's own values). */
export interface PadMenuItem {
    id: string;
    name: string;
    price: number;
    category: string;
    rawName: unknown;
    rawPrice: unknown;
}

export interface PadMenu {
    items: PadMenuItem[];
    variations: MenuVariationRecord[];
}

export const fetchPadMenu = async (restaurantId: string): Promise<PadMenu> => {
    const q = `restaurantId=${encodeURIComponent(restaurantId)}`;
    const [menuRes, varRes] = await Promise.all([
        requestBackend({ path: `/menu?${q}`, method: 'GET', restaurantId }),
        requestBackend<{ variations?: MenuVariationRecord[] }>({ path: `/menu-variations?${q}`, method: 'GET', restaurantId }),
    ]);
    if (!menuRes.ok) { throw failure(menuRes.status, menuRes.text, 'Unable to load the menu.'); }
    const rows = Array.isArray(menuRes.data)
        ? (menuRes.data as unknown[]).filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
        : [];
    const items: PadMenuItem[] = [];
    for (const r of rows) {
        const rawId = r.id;
        if (typeof rawId !== 'string' && typeof rawId !== 'number') { continue; }
        const id = String(rawId);
        const price = Number(r.price);
        items.push({
            id,
            name: typeof r.name === 'string' && r.name !== '' ? r.name : id,
            price: Number.isFinite(price) ? price : 0,
            category: typeof r.category === 'string' && r.category.trim() !== '' ? r.category : 'Menu',
            rawName: r.name,
            rawPrice: r.price,
        });
    }
    // Sizes are a web-extra (finding 34) — a failed read only hides the picker.
    const variations = varRes.ok && Array.isArray(varRes.data?.variations)
        ? varRes.data.variations.filter((v) => v.active)
        : [];
    variations.sort((a, b) => a.sort_order - b.sort_order || a.price - b.price);
    return { items, variations };
};

/* ── The table's running bill (never cache-primed in Flutter) ──────────── */

export type TableBill = Record<string, unknown>;

/** GET /bill-for-table — null when the table has no open bill yet (404). */
export const fetchTableBill = async (restaurantId: string, table: string): Promise<TableBill | null> => {
    const res = await requestBackend<TableBill>({
        path: `/bill-for-table?table_name=${encodeURIComponent(table)}`,
        method: 'GET',
        restaurantId,
    });
    if (res.status === 404) { return null; }
    if (!res.ok) { throw failure(res.status, res.text, 'Unable to load the table bill.'); }
    return res.data && typeof res.data === 'object' ? res.data : null;
};

export const billNum = (bill: TableBill | null | undefined, key: string): number => {
    const n = Number(bill?.[key]);
    return Number.isFinite(n) ? n : 0;
};

export const billStr = (bill: TableBill | null | undefined, key: string): string => {
    const v = bill?.[key];
    return typeof v === 'string' ? v : '';
};

export const billList = (bill: TableBill | null | undefined, key: string): Record<string, unknown>[] => {
    const v = bill?.[key];
    return Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]) : [];
};

export const apcLabel = (status: string): string =>
    status === 'green' ? 'APC on target' : status === 'yellow' ? 'APC close' : 'APC below target';

export const apcTone = (status: string): 'success' | 'warning' | 'danger' =>
    status === 'green' ? 'success' : status === 'yellow' ? 'warning' : 'danger';

/* ── The draft (models/order_draft.dart) ───────────────────────────────── */

export interface DraftState {
    /** menuId → quantity. One line per dish (finding 13). */
    cart: Partial<Record<string, number>>;
    notes: Partial<Record<string, string>>;
    held: Partial<Record<string, boolean>>;
    /** menuId → chosen size (web-extra 34). */
    sizes: Partial<Record<string, string>>;
    /** Last-seen names, so a dish that leaves the menu keeps its label. */
    knownNames: Partial<Record<string, string>>;
}

export const EMPTY_DRAFT: DraftState = { cart: {}, notes: {}, held: {}, sizes: {}, knownNames: {} };

export interface DraftLine {
    menuId: string;
    name: string;
    quantity: number;
    unitPrice: number | null;
    note: string;
    held: boolean;
    onMenu: boolean;
    variationId: string | null;
    variationName: string | null;
    menuName: unknown;
    menuPrice: unknown;
}

export const draftLines = (
    draft: DraftState,
    itemsById: ReadonlyMap<string, PadMenuItem>,
    variationsById: ReadonlyMap<string, MenuVariationRecord>,
): DraftLine[] => {
    const lines: DraftLine[] = [];
    for (const [id, qty] of Object.entries(draft.cart)) {
        if (qty === undefined || qty <= 0) { continue; }
        const m = itemsById.get(id);
        const size = draft.sizes[id];
        const v = size !== undefined ? variationsById.get(size) : undefined;
        const variation = v?.menu_id === id ? v : undefined;
        lines.push({
            menuId: id,
            name: m ? m.name : (draft.knownNames[id] ?? id),
            quantity: qty,
            unitPrice: m ? (variation ? variation.price : m.price) : null,
            note: (draft.notes[id] ?? '').trim(),
            held: draft.held[id] === true,
            onMenu: m !== undefined,
            variationId: variation ? variation.id : null,
            variationName: variation ? variation.name : null,
            menuName: m?.rawName,
            menuPrice: m?.rawPrice,
        });
    }
    return lines;
};

export const draftPayload = (lines: readonly DraftLine[]): Record<string, unknown>[] => lines.map((l) => ({
    id: l.menuId,
    name: l.menuName,
    price: l.menuPrice,
    quantity: l.quantity,
    ...(l.note !== '' ? { note: l.note } : {}),
    ...(l.held ? { course_hold: true } : {}),
    // MIGRATION 039 — only the id travels; the server floors the price.
    ...(l.variationId ? { variation_id: l.variationId } : {}),
}));

export const draftItemCount = (lines: readonly DraftLine[]): number => lines.reduce((s, l) => s + l.quantity, 0);

export const draftTotal = (lines: readonly DraftLine[]): number =>
    lines.reduce((s, l) => s + (l.unitPrice === null ? 0 : l.unitPrice * l.quantity), 0);

export const draftSummary = (lines: readonly DraftLine[]): string => {
    const items = draftItemCount(lines);
    const dishes = lines.length;
    return `${items} item${items === 1 ? '' : 's'} · ${dishes} dish${dishes === 1 ? '' : 'es'}`;
};

export const draftBlock = (lines: readonly DraftLine[], phoneError: string | null = null): string | null => {
    if (lines.length === 0) { return 'Add a dish to send an order.'; }
    if (phoneError !== null) { return phoneError; }
    for (const l of lines) {
        if (!l.onMenu) { return `${l.name} is no longer on the menu — remove it to send`; }
    }
    return null;
};

/* ── The printed-bill refusal (next_party.dart BillPrintedRefusal) ─────── */

export const BILL_PRINTED_CODE = 'bill_printed';

export interface BillPrintedRefusal {
    message: string;
    table: string;
    nextPartyTable: string | null;
    actionLabel: string | null;
    addToPrintedLabel: string | null;
}

export const takeItOnLabel = (nextPartyTable: string): string => `Take it on ${tableSentenceName(nextPartyTable)}`;

export const addingToPrintedBillStrip = (table: string, parentTable?: string | null): string =>
    `Adding to ${tableSentenceName(table, parentTable)}'s printed bill`;

export const parseBillPrintedRefusal = (body: unknown): BillPrintedRefusal | null => {
    if (!body || typeof body !== 'object') { return null; }
    const b = body as Record<string, unknown>;
    const s = (k: string): string => (typeof b[k] === 'string' ? (b[k]).trim() : '');
    if (s('code') !== BILL_PRINTED_CODE) { return null; }
    const table = s('table');
    const next = s('next_party_table');
    const elsewhere = next !== '' && next.toLowerCase() !== table.toLowerCase();
    const label = s('next_party_action');
    const addLabel = s('add_to_printed_action');
    const addMessage = addLabel !== '' ? s('add_to_printed_message') : '';
    const message = addMessage !== '' ? addMessage : s('error');
    return {
        message: message !== '' ? message : "This table's bill has already been printed.",
        table,
        nextPartyTable: elsewhere ? next : null,
        actionLabel: elsewhere ? (label !== '' ? label : takeItOnLabel(next)) : null,
        addToPrintedLabel: addLabel !== '' ? addLabel : null,
    };
};

/* ── Outbox replay transport ───────────────────────────────────────────── */

let senderInstalled = false;

/**
 * The replay transport for queued writes: the saved method/path/body, verbatim.
 * The restaurant rides in the path's `restaurantId` query, so one sender serves
 * every tenant scope the outbox holds.
 */
export const ensureOrderOutboxSender = (): void => {
    if (senderInstalled) { return; }
    senderInstalled = true;
    registerOutboxSender(async (entry: OutboxEntry) => {
        const q = entry.path.includes('?') ? entry.path.slice(entry.path.indexOf('?') + 1) : '';
        const restaurantId = new URLSearchParams(q).get('restaurantId') ?? '';
        const res = await requestBackend({
            path: entry.path,
            method: entry.method.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
            restaurantId,
            ...(entry.body !== undefined ? { body: entry.body } : {}),
        });
        if (res.ok) { return; }
        if (res.status === 0) { throw new OutboxSendError('Could not reach the server.', null); }
        throw new OutboxSendError(said(parseJson(res.text)) || `The server refused this (${String(res.status)}).`, res.status);
    });
};

/* ── Writes ────────────────────────────────────────────────────────────── */

export type WriteOutcome =
    | { kind: 'sent'; data: Record<string, unknown> }
    | { kind: 'queued'; what: string };

const unreachable = (status: number): boolean =>
    status === 0 || (typeof navigator !== 'undefined' && !navigator.onLine);

/**
 * One write: sent, or — only when the server was never reached — saved in the
 * outbox (honestly reported as `queued`). Any server answer that is not OK
 * throws OrderEntryError carrying the parsed body (the 423 lives there).
 */
const writeOrQueue = async (
    restaurantId: string,
    path: string,
    body: Record<string, unknown>,
    what: string,
    tag: string | undefined,
    fallback: string,
    forceQueue = false,
): Promise<WriteOutcome> => {
    // A write queued behind an unsent seating must replay AFTER it, never
    // overtake it (occupy first, order second).
    if (forceQueue) {
        ensureOrderOutboxSender();
        enqueueOutbox({ what, method: 'POST', path, body, tag });
        return { kind: 'queued', what };
    }
    const res = await requestBackend<Record<string, unknown>>({ path, method: 'POST', restaurantId, body });
    if (res.ok) { return { kind: 'sent', data: res.data ?? {} }; }
    if (unreachable(res.status)) {
        ensureOrderOutboxSender();
        enqueueOutbox({ what, method: 'POST', path, body, tag });
        return { kind: 'queued', what };
    }
    throw failure(res.status, res.text, fallback);
};

const withRid = (path: string, restaurantId: string): string =>
    `${path}${path.includes('?') ? '&' : '?'}restaurantId=${encodeURIComponent(restaurantId)}`;

export const occupyForOrder = (restaurantId: string, table: string, covers: number): Promise<WriteOutcome> =>
    writeOrQueue(
        restaurantId,
        withRid('/occupy-table', restaurantId),
        { table_name: table, num_covers: covers },
        `Seat ${table} (${String(covers)} guest${covers === 1 ? '' : 's'})`,
        `table:${table}`,
        'Unable to occupy the table.',
    );

export const postDineInOrder = (
    restaurantId: string,
    body: Record<string, unknown>,
    what: string,
    table: string,
    forceQueue = false,
): Promise<WriteOutcome> =>
    writeOrQueue(restaurantId, withRid('/orders', restaurantId), body, what, `table:${table}`, 'Unable to send the order.', forceQueue);

export const postTakeawayOrder = (
    restaurantId: string,
    body: Record<string, unknown>,
    what: string,
): Promise<WriteOutcome> =>
    writeOrQueue(restaurantId, withRid('/orders/takeaway', restaurantId), body, what, undefined, 'Unable to place that order.');

/** Web-extra 35: link the created order to the table — never carries covers. */
export const linkOrderToTable = async (restaurantId: string, table: string, orderId: string): Promise<void> => {
    await requestBackend({
        path: withRid('/occupy-table', restaurantId),
        method: 'POST',
        restaurantId,
        body: { table_name: table, order_id: orderId },
    });
};

