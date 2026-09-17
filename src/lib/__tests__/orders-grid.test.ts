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
//   * CLIENT ITEM 3 (2026-09-17) — "On the waiter dashboard, Cancel KOT option
//     should be removed." Both routes now refuse a waiter-only session on a
//     ticketed order, so neither is offered to one, whatever it was granted —
//     the one place the ROLE outranks the grant.

import {
    PERM_BARK,
    canBarkFromBoard,
    cancelKotRoute,
    ordersGridColumns,
    showsTableApcSummary,
} from '../orders-grid';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
        expect(cancelKotRoute(manager([], { void_order: true, cancel_kot: true }), 'Served')).toBe('void');
        expect(cancelKotRoute({ actions_set: [PERM_VOID_ORDER] }, 'Preparing')).toBe('void');
        expect(cancelKotRoute({ actions_set: ['*'] }, 'Served')).toBe('void');
    });

    it('falls back to the plain status cancel for a floor role holding Add Orders', () => {
        expect(cancelKotRoute(manager([PERM_ORDER_ADD], { void_order: false }), 'Served')).toBe('status');
        expect(cancelKotRoute(manager([PERM_ORDER_ADD], { void_order: false, cancel_kot: true }), 'Preparing')).toBe('status');
    });

    it('CLIENT ITEM 3 — offers a waiter-only session NOTHING: not the plain cancel, not the void it was granted', () => {
        expect(cancelKotRoute(waiter([PERM_ORDER_ADD], { void_order: false }), 'Preparing')).toBe(null);
        expect(cancelKotRoute(waiter([PERM_ORDER_ADD], { void_order: true }), 'Served')).toBe(null);
        expect(cancelKotRoute(waiter([PERM_ORDER_ADD, PERM_VOID_ORDER], {}), 'Preparing')).toBe(null);
        // Even a server that (wrongly) said yes to the flag: waiter_only is asked first.
        expect(cancelKotRoute(waiter([PERM_ORDER_ADD], { cancel_kot: true }), 'Preparing')).toBe(null);
    });

    it('obeys the server\'s cancel_kot "no" for anybody, and reads its absence as "ask the old rule"', () => {
        expect(cancelKotRoute(manager([PERM_ORDER_ADD, PERM_VOID_ORDER], { void_order: true, cancel_kot: false }), 'Preparing')).toBe(null);
        expect(cancelKotRoute({ actions_set: ['*'], scope: { waiter_only: false } }, 'Preparing')).toBe('void');
    });

    it('obeys a server "no" on void even when the action list would have said yes', () => {
        expect(cancelKotRoute(manager([PERM_VOID_ORDER], { void_order: false }), 'Preparing')).toBe(null);
    });

    it('offers nothing to a session that can take neither route', () => {
        expect(cancelKotRoute(waiter([], { void_order: false }), 'Preparing')).toBe(null);
        expect(cancelKotRoute({ actions_set: [] }, 'Preparing')).toBe(null);
        expect(cancelKotRoute(null, 'Preparing')).toBe(null);
    });

    it('CLIENT ITEM 3 — every surface asks this one rule (the wiring)', () => {
        // Fixed paths under src/, named here — not user input.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        const src = (rel: string): string => readFileSync(join(__dirname, '..', '..', rel), 'utf8');
        const capture = src('app/dashboard/orders/capture-actions.tsx');
        // Cancel KOT (kitchen board + table preview) takes its route from here…
        expect(capture).toMatch(/const route = cancelKotRoute\(user, order\.status\)/);
        // …and the Controls menu's "Void this order…" is not drawn for a waiter-only session.
        expect(capture).toMatch(/const offersVoid = !isWaiterOnly\(user\) && answered\(user, "cancel_kot"\) !== false/);
        expect(capture).toMatch(/\{offersVoid \? item\("void"/);
        const page = src('app/dashboard/orders/page.tsx');
        expect(page).toMatch(/const canVoidOrder = can\(user, "void_order"\) && cancelKotRoute\(user, "Preparing"\) !== null;/);
        expect(page).toMatch(/kot && cancelKotRoute\(user, order\.status\) !== null \?/);
    });

    it('is never offered on a ticket that is already cancelled or closed', () => {
        const admin = manager(['*'], { void_order: true });
        expect(cancelKotRoute(admin, 'Cancelled')).toBe(null);
        expect(cancelKotRoute(admin, 'closed')).toBe(null);
    });
});
