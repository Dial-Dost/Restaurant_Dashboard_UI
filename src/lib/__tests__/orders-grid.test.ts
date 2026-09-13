// What these tests are actually protecting.
//
// A live test logged in as a stock waiter found the Current Orders grid printing
// "₹0.00" in a Total column on every row (the payload's prices are redacted for
// that session, and the mapper coerces null to 0), a per-table APC / revenue
// panel, and a "Bark to kitchen" button the route refuses them. And 1.3 adds a
// Cancel KOT control that must take one of the server's two existing cancel
// routes. Each of those is one pure decision, pinned here:
//
//   * A WAITER-ONLY SESSION GETS NO MONEY COLUMN — not dashes, not zeros.
//   * EVERYBODY ELSE LOSES NOTHING, including a stale session with no scope.
//   * THE SERVER'S GRANT OUTRANKS THE ROLE for Bark, and Cancel KOT is offered
//     exactly when one of the server's two cancel routes would accept the call.

import {
    PERM_BARK,
    canBarkFromBoard,
    cancelKotRoute,
    ordersGridColumns,
    showsTableApcSummary,
} from '../orders-grid';
import { PERM_ORDER_ADD, PERM_VOID_ORDER, type ScopedSession } from '../session-scope';

const waiter = (actions: string[] = [], scope: Record<string, boolean> = {}): ScopedSession =>
    ({ scope: { waiter_only: true, ...scope }, actions_set: actions });
const manager = (actions: string[] = [], scope: Record<string, boolean> = {}): ScopedSession =>
    ({ scope: { waiter_only: false, ...scope }, actions_set: actions });

describe('ordersGridColumns — the ₹0.00 Total column', () => {
    it('drops the Total and APC Zone columns for a waiter-only session', () => {
        const columns = ordersGridColumns(waiter());
        expect(columns).not.toContain('total');
        expect(columns).not.toContain('apc_zone');
        expect(columns).toEqual(['table', 'placed', 'details', 'status', 'actions']);
    });

    it('keeps every column for anyone the server has not scoped', () => {
        const all = ['table', 'placed', 'details', 'total', 'apc_zone', 'status', 'actions'];
        expect(ordersGridColumns(manager())).toEqual(all);
        expect(ordersGridColumns({ actions_set: ['*'] })).toEqual(all);
        expect(ordersGridColumns(null)).toEqual(all);
    });
});

describe('showsTableApcSummary', () => {
    it('hides the per-table APC panel from a waiter, as its sibling cards already are', () => {
        expect(showsTableApcSummary(waiter())).toBe(false);
        expect(showsTableApcSummary(manager())).toBe(true);
        expect(showsTableApcSummary({})).toBe(true);
    });
});

describe('canBarkFromBoard — "Bark to kitchen" is a feature name, not a typo', () => {
    it('is hidden from a stock waiter, whom the route refuses', () => {
        expect(canBarkFromBoard(waiter(['4ad474d4-5230-449c-874f-6a238b833bca']))).toBe(false);
    });

    it('is offered to a waiter the tenant granted Bark Order', () => {
        expect(canBarkFromBoard(waiter([PERM_BARK]))).toBe(true);
    });

    it('is unchanged for everyone else', () => {
        expect(canBarkFromBoard(manager())).toBe(true);
        expect(canBarkFromBoard(null)).toBe(true);
    });

    it('quotes the backend route id verbatim', () => {
        expect(PERM_BARK).toBe('3f6a9c1e-8d24-4b7a-b5c9-2e1f7d4a8b63');
    });
});

describe('cancelKotRoute — 1.3 rides on the two existing cancel routes', () => {
    it('takes the recorded void whenever the server says the session may void', () => {
        expect(cancelKotRoute(manager([], { void_order: true }), 'Preparing')).toBe('void');
        expect(cancelKotRoute(waiter([PERM_ORDER_ADD], { void_order: true }), 'Served')).toBe('void');
        expect(cancelKotRoute({ actions_set: [PERM_VOID_ORDER] }, 'Preparing')).toBe('void');
        expect(cancelKotRoute({ actions_set: ['*'] }, 'Served')).toBe('void');
    });

    it('falls back to the plain status cancel for somebody holding Add Orders — the stock waiter', () => {
        expect(cancelKotRoute(waiter([PERM_ORDER_ADD], { void_order: false }), 'Preparing')).toBe('status');
        expect(cancelKotRoute(manager([PERM_ORDER_ADD], { void_order: false }), 'Served')).toBe('status');
    });

    it('obeys a server "no" on void even when the action list would have said yes', () => {
        expect(cancelKotRoute(manager([PERM_VOID_ORDER], { void_order: false }), 'Preparing')).toBe(null);
    });

    it('offers nothing to a session that can take neither route', () => {
        expect(cancelKotRoute(waiter([], { void_order: false }), 'Preparing')).toBe(null);
        expect(cancelKotRoute({ actions_set: [] }, 'Preparing')).toBe(null);
        expect(cancelKotRoute(null, 'Preparing')).toBe(null);
    });

    it('is never offered on a ticket that is already cancelled or closed', () => {
        const admin = manager(['*'], { void_order: true });
        expect(cancelKotRoute(admin, 'Cancelled')).toBe(null);
        expect(cancelKotRoute(admin, 'closed')).toBe(null);
    });
});
