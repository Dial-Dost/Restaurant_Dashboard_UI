// 1.8 — SEPARATE KOT DISPLAY IN THE TABLE PREVIEW.
//
// Requirement, verbatim: "When multiple KOTs are present for the same table,
// they currently display as one long list. This must be changed so they are
// displayed as separated, distinct KOTs categorized by their respective KOT
// numbers within the selected table's preview in the Tables section."
//
// ============================================================================
// THE UNIT OF A BLOCK IS THE ORDER, AND THE KOT NUMBER IS ITS NAME
// ============================================================================
// Every staff-placed order is ticketed on its own (kot_print.ts:
// autoPrintOrderKot, bill_id = 'order-<id>'), so one order IS one kitchen
// docket, and migration 043 hands back the number printed on it as `kot_nos`.
// Grouping lines by the ORDER they arrived in is therefore grouping them by KOT
// — without inventing a per-line KOT number the server does not have.
//
// It is also the unit the server can CANCEL (1.3): POST /orders/:id/void takes
// an order, prints the cancellation slip for that order's KOT (1.1) and demands
// a reason (1.2). A block that merged two orders because they happened to share
// a number would put one "Cancel KOT" over two tickets and cancel both. So two
// orders are never folded into one block, even in the (table-scoped reprint)
// case where they carry the same number.
//
// `kot_nos` can hold more than one number for one order — a correction docket
// after a D4 move, or an order re-ticketed after items were appended — and the
// block then reads "KOTs 1, 2", which is exactly what is on the pass.
//
// ORDERS WITH NO NUMBER SHARE ONE TRAILING "No KOT number" BLOCK. Not sent to
// the kitchen yet, printed before migration 043, or a backend that does not send
// the field: none of those is a placed ticket, so none gets a block of its own
// or a Cancel KOT (those orders are still cancellable from the Orders grid). On a
// tenant where 043 is unapplied every order lands here, and the preview simply
// does not split. The owner app draws the identical shape
// (restaurant_owner_app `lib/screens/table_kots.dart`), because the website and
// the app must read the same table the same way.
//
// ============================================================================
// ORDER: OLDEST FIRST
// ============================================================================
// A table preview is read top to bottom as the story of the sitting — starters,
// then the mains, then the round of drinks — and that is also the order the
// dockets came off the printer. Ordered by the placed instant; a row the server
// could not date falls back to its lowest KOT number (numbers are allocated in
// sequence per outlet-day), and anything still tied keeps the feed's own order.
//
// WHAT IS LEFT OUT: cancelled orders (terminal — nothing to cook, nothing left
// to cancel) and closed ones (they belong to a settled bill, not to the party at
// the table). Same rule as the D4 move picker on the Tables page.
//
// PURE — no React, no fetch — so `__tests__/kot-groups.test.ts` pins it.

import { kotTicketLabel } from './table-move';

/** The fields of an order line this grouping carries through untouched. */
export interface KotGroupItem {
    id?: string | null;
    name: string;
    quantity: number;
}

/** The slice of an order the grouping reads. Everything else is ignored. */
export interface KotGroupOrder<I extends KotGroupItem = KotGroupItem> {
    id: string;
    table?: string | null;
    status?: string | null;
    created_at?: string | null;
    kot_nos?: unknown;
    items?: I[] | null;
    items_flattened?: I[] | null;
}

/** The trailing block's heading — the same words the owner app uses. */
export const NO_KOT_NUMBER_LABEL = 'No KOT number';

/** One KOT block in the table preview. */
export interface KotBlock<O extends KotGroupOrder = KotGroupOrder> {
    /** Stable React key: the order id, or a fixed key for the trailing block. */
    key: string;
    /**
     * The order this block is — what Cancel KOT addresses. NULL for the trailing
     * "No KOT number" block, which gathers several orders and is not one ticket.
     */
    order: O | null;
    /** True for a ticket with at least one known KOT number. */
    numbered: boolean;
    /** Distinct, positive KOT numbers in allocation order; empty on the trailing block. */
    kotNos: number[];
    /** "KOT 5" / "KOTs 1, 2", or "No KOT number" on the trailing block. */
    label: string;
    /** The instant the order was placed; null on the trailing block or an undated row. */
    placedAt: string | null;
    /** The lines on this ticket, in the order the server sent them. */
    items: NonNullable<O['items']>;
}

const EXCLUDED_STATUSES = new Set(['cancelled', 'closed']);

/**
 * The KOT numbers on one order, cleaned the way `kotTicketLabel` cleans them:
 * duplicates collapsed (one docket fanned out to several stations is several
 * print jobs under ONE number), non-positive and unparseable values dropped.
 */
export const kotNumbersOf = (raw: unknown): number[] => {
    if (!Array.isArray(raw)) { return []; }
    const seen = new Set<number>();
    const out: number[] = [];
    for (const entry of raw as unknown[]) {
        const parsed = Number(entry);
        if (!Number.isFinite(parsed) || parsed <= 0) { continue; }
        const value = Math.round(parsed);
        if (seen.has(value)) { continue; }
        seen.add(value);
        out.push(value);
    }
    return out;
};

const placedMs = (iso: string | null | undefined): number | null => {
    if (typeof iso !== 'string' || iso.trim() === '') { return null; }
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : null;
};

/**
 * A table's live orders as distinct KOT blocks, oldest first, with every line
 * whose order carries no KOT number in one trailing "No KOT number" block.
 *
 * `tableName` is matched case-insensitively (the floor's own lookup rule); pass
 * nothing to group every order handed in. Orders with no lines are dropped — a
 * block with a header over nothing is a docket the kitchen never received.
 * Every line of every other live order lands in exactly one block.
 */
export const groupItemsByKot = <O extends KotGroupOrder>(
    orders: readonly O[],
    tableName?: string | null,
): KotBlock<O>[] => {
    const wanted = typeof tableName === 'string' ? tableName.trim().toLowerCase() : null;
    const blocks: { block: KotBlock<O>; index: number; ms: number | null; firstKot: number }[] = [];
    const unnumbered: { items: NonNullable<O['items']>; index: number; ms: number | null }[] = [];

    orders.forEach((order, index) => {
        if (wanted !== null && (order.table ?? '').trim().toLowerCase() !== wanted) { return; }
        if (EXCLUDED_STATUSES.has((order.status ?? '').trim().toLowerCase())) { return; }
        const items = (order.items_flattened?.length ? order.items_flattened : order.items) ?? [];
        if (items.length === 0) { return; }
        const kotNos = kotNumbersOf(order.kot_nos);
        const placedAt = typeof order.created_at === 'string' && order.created_at.trim() !== '' ? order.created_at : null;
        if (kotNos.length === 0) {
            unnumbered.push({ items, index, ms: placedMs(placedAt) });
            return;
        }
        blocks.push({
            block: { key: order.id, order, numbered: true, kotNos, label: kotTicketLabel(kotNos), placedAt, items },
            index,
            ms: placedMs(placedAt),
            firstKot: Math.min(...kotNos),
        });
    });

    blocks.sort((a, b) => {
        if (a.ms !== null && b.ms !== null && a.ms !== b.ms) { return a.ms - b.ms; }
        if (a.firstKot !== b.firstKot) { return a.firstKot - b.firstKot; }
        return a.index - b.index;
    });

    const result = blocks.map((entry) => entry.block);
    if (unnumbered.length > 0) {
        // Same oldest-first rule inside the trailing block, so its lines still
        // read in the order they were rung in.
        unnumbered.sort((a, b) => (a.ms !== null && b.ms !== null && a.ms !== b.ms ? a.ms - b.ms : a.index - b.index));
        result.push({
            key: '__no_kot_number__',
            order: null,
            numbered: false,
            kotNos: [],
            label: NO_KOT_NUMBER_LABEL,
            placedAt: null,
            items: unnumbered.flatMap((entry) => entry.items),
        });
    }
    return result;
};
