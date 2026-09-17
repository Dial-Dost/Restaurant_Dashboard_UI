// WHAT THE ORDERS SCREEN DRAWS FOR WHOM — the decisions behind three defects a
// live test found while logged in as a stock waiter, and behind 1.3's Cancel KOT.
//
// ============================================================================
// 1. THE "TOTAL" COLUMN READ ₹0.00 ON EVERY ROW (C4)
// ============================================================================
// The backend redacts prices out of the order payload for a waiter-only session
// (V3 C4), so `total` arrives null and the order mapper coerces it to 0. The
// Current Orders grid then printed "₹0.00" beside every ticket — a confident
// figure where a hidden one belongs, which is precisely the failure
// `order-prices.ts` exists to prevent. The APC Zone column beside it is the
// same money said another way ("BELOW (₹1,200 target)").
//
// C4's rule, as already applied to the order cart: THE ELEMENT GOES, IT IS NOT
// BLANKED. A column headed "Total" full of dashes is still a money column. So
// both columns leave the grid for exactly the sessions `showsMoney` says no to.
//
// ============================================================================
// 2. THE "TABLE APC SUMMARY" PANEL
// ============================================================================
// Per-table APC, bill count and revenue for the month. Its three sibling cards
// (Monthly APC, Total Revenue, Total Covers) were already hidden from a
// waiter-only session; this panel was simply missed. Its feed (GET /orders/apc)
// rides on the accounting permission the stock waiter does not hold, so a waiter
// saw an empty money panel at best. Same gate as the siblings.
//
// ============================================================================
// 3. "BARK TO KITCHEN" ON THE KITCHEN BOARD
// ============================================================================
// NOT A TYPO. "Bark" is this product's name for the expo announcing a ticket to
// the kitchen — it stamps `barked_at` and starts the prep timers (POST
// /orders/:id/bark, "Not barked" badges, the Bark Order permission). The label
// stays. What was wrong is WHO saw it: the Current Orders row already hides Bark
// from a scoped waiter, but the kitchen board drew it for everyone, and the
// route refuses a waiter who has not been granted "Bark Order". So the board
// now asks the same question the row does, and additionally honours a tenant
// that HAS granted the permission to its waiters — the server's grant outranks
// the role, as it does for the Controls menu.
//
// PURE — no React, no fetch — so `__tests__/orders-grid.test.ts` pins it.

import { PERM_ORDER_ADD, answered, can, hasPermission, isWaiterOnly, showsMoney, type ScopedSession } from './session-scope';

/**
 * "Bark Order" — POST /orders/:id/bark's `validateAction` argument, quoted from
 * routes/orders.ts. Never mint a new id for an existing capability.
 */
export const PERM_BARK = '3f6a9c1e-8d24-4b7a-b5c9-2e1f7d4a8b63';

/** The Current Orders grid's columns, in display order. */
export type OrdersGridColumn = 'table' | 'placed' | 'details' | 'total' | 'apc_zone' | 'status' | 'actions';

const MONEY_COLUMNS: ReadonlySet<OrdersGridColumn> = new Set<OrdersGridColumn>(['total', 'apc_zone']);
const ALL_COLUMNS: readonly OrdersGridColumn[] = ['table', 'placed', 'details', 'total', 'apc_zone', 'status', 'actions'];

/**
 * The columns this session's Current Orders grid carries. A scoped waiter gets
 * no money column at all — not a column of dashes, and never one of ₹0.00.
 */
export const ordersGridColumns = (session: ScopedSession | null | undefined): OrdersGridColumn[] =>
    showsMoney(session) ? [...ALL_COLUMNS] : ALL_COLUMNS.filter((column) => !MONEY_COLUMNS.has(column));

/** Does this session see the per-table APC / revenue panel? Same gate as its sibling cards. */
export const showsTableApcSummary = (session: ScopedSession | null | undefined): boolean => showsMoney(session);

/**
 * May this session be offered "Bark to kitchen" on the kitchen board?
 *
 * Everyone who is not a scoped waiter keeps it exactly as before (the row's own
 * rule). A scoped waiter gets it only when the tenant has granted "Bark Order".
 */
export const canBarkFromBoard = (session: ScopedSession | null | undefined): boolean =>
    !isWaiterOnly(session) || hasPermission(session?.actions_set, PERM_BARK);

/**
 * 1.3 — WHICH CANCEL ROUTE, IF ANY, CANCEL KOT TAKES FOR THIS SESSION.
 *
 * Cancel KOT is not a new path; it is one of the server's two existing ways to
 * cancel an order, and BOTH demand nothing the client can skip: the reason
 * prompt is mandatory before either call (1.2), and both print the CANCELLED
 * slip carrying the KOT number and table (1.1).
 *
 *   'void'   — POST /orders/:id/void, gated on "Void Orders With Reason". Takes
 *              a controlled kind, the reason and an authoriser.
 *   'status' — PATCH /orders/:id/status {status: Cancelled, reason}, gated on
 *              "Add Orders" — the everyday cancel a waiter already holds, which
 *              records the reason self-authorised in the same void ledger.
 *   null     — neither: the control is not drawn.
 *
 * The void route wins whenever it is held, because it is the stricter record.
 * The same rule as the owner app's `_mayCancelKot`, so one person is offered
 * the same button on the phone and on the laptop. Never offered on a ticket
 * that is already cancelled (terminal) or closed (settled — a refund, not a
 * cancel).
 *
 * CLIENT ITEM 3 (2026-09-17) — "On the waiter dashboard, Cancel KOT option
 * should be removed." A waiter-only session is offered NEITHER route, even
 * when the tenant granted it Void Orders: every route that can cancel a
 * ticketed order now refuses that login (`cancel_needs_senior`). The role
 * outranks the grant here, and only here — the client named the waiter, not a
 * permission. The server's `cancel_kot` is obeyed when it said no; its absence
 * (a session stored before the flag) falls through to the rule below.
 */
export type CancelKotRoute = 'void' | 'status';

export const cancelKotRoute = (
    session: ScopedSession | null | undefined,
    status: string | null | undefined,
): CancelKotRoute | null => {
    const normalized = (status ?? '').trim().toLowerCase();
    if (normalized === 'cancelled' || normalized === 'closed') { return null; }
    if (isWaiterOnly(session) || answered(session, 'cancel_kot') === false) { return null; }
    if (can(session, 'void_order')) { return 'void'; }
    if (hasPermission(session?.actions_set, PERM_ORDER_ADD)) { return 'status'; }
    return null;
};
