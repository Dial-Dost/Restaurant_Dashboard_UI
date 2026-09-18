// What these tests are actually protecting.
//
// A production tenant ended up with a waiter who could see the day's takings,
// because the waiter scoping was decided in the CLIENT by testing whether every
// role string was literally "waiter". A custom role is stored as a UUID, so a
// waiter holding one carried `["waiter", "<uuid>"]`, the test failed, and every
// restriction lifted at once — money included.
//
// The rule now lives once, on the server, and ships in the `scope` block — and
// so does the per-control answer to "may this identity DO x". These tests pin
// the three properties that keep it that way:
//
//   1. THE CLIENT OBEYS AND DOES NOT INFER. `isWaiterOnly` and `can` must answer
//      from the server's block and from nothing else when the server has
//      answered. Feed them the exact role shapes that broke the old rule — a
//      waiter carrying a custom role's uuid, a waiter carrying the "employee"
//      placeholder — and the answer must track the server's field, not the
//      strings. A `false` from the server is obeyed even when the action list
//      says otherwise, and so is a `true`.
//   2. A STALE SESSION IS NOT A LOCKED-OUT ONE. A browser holding a localStorage
//      session from before the flags shipped carries none of them; the fallback
//      reads the server's own resolved `actions_set` rather than blanking every
//      control on the screen until the owner signs out and in again.
//   3. AN ADMIN LOSES NOTHING. The `"*"` wildcard is every permission on both
//      paths. The failure mode to fear is not "a waiter saw a figure", it is
//      "the fix took the till away from the person who runs the restaurant".
//
// And the fallback uuids, because a fresh uuid for an existing capability is how
// migration 025's rule gets broken: it strips the capability from every role
// that holds it today. These are quoted from the backend routes.

import {
    PERM_ASSIGN_ROLE,
    PERM_CLOSE_BILL,
    PERM_DELETE_ROLES,
    PERM_EDIT_ROLES,
    PERM_MANAGE_SECTIONS,
    PERM_ORDER_ADD,
    PERM_ORDER_DELETE,
    PERM_REMOVE_ROLE,
    PERM_TABLE_DELETE,
    PERM_TABLE_LAYOUT,
    PERM_TABLE_SERVICE,
    PERM_VIEW_ACTIONS,
    PERM_VIEW_ROLES,
    PERM_VOID_ORDER,
    can,
    canMoveOrderToTable,
    canMoveTableParty,
    canOpenEmployeesPage,
    canOpenFloorPlan,
    canOpenRoles,
    hasPermission,
    isWaiterOnly,
    showsMoney,
    type ScopedSession,
} from '../session-scope';

/** A session whose `scope` block the server filled in. */
const answered = (scope: Partial<ScopedSession['scope']> & object, actions: string[] = []): ScopedSession =>
    ({ scope: { waiter_only: false, ...scope }, actions_set: actions });

/** A session from before the capability flags shipped: actions only. */
const stale = (actions: string[]): ScopedSession => ({ actions_set: actions });

describe('isWaiterOnly — the client obeys, it does not infer', () => {
    it('answers true only when the server said so', () => {
        expect(isWaiterOnly({ scope: { waiter_only: true } })).toBe(true);
        expect(isWaiterOnly({ scope: { waiter_only: false } })).toBe(false);
    });

    it('ignores the role strings entirely — including the two shapes that broke the old rule', () => {
        // A waiter who also holds a custom role (stored as a uuid). The old
        // client rule `roles.every(r => r === 'waiter')` answered false here and
        // lifted every restriction. The server answers true; so must this.
        const withCustomRole = {
            scope: { waiter_only: true },
            role: 'waiter',
            role_all: ['waiter', 'd2b1f0c4-1e62-4b0a-9f77-2a3c5e8d90ab'],
        } as unknown as ScopedSession;
        expect(isWaiterOnly(withCustomRole)).toBe(true);

        // A waiter whose primary was never set, so it defaulted to the
        // "employee" placeholder. Same story.
        const withPlaceholder = {
            scope: { waiter_only: true },
            role: 'employee',
            role_all: ['employee', 'waiter'],
        } as unknown as ScopedSession;
        expect(isWaiterOnly(withPlaceholder)).toBe(true);
    });

    it('does not scope somebody the server left unscoped, however "waiter" their roles look', () => {
        // A waiter who is also the manager on shift. The server says not scoped;
        // the client must not second-guess that from the word "waiter".
        const managerOnShift = {
            scope: { waiter_only: false },
            role: 'waiter',
            role_all: ['waiter', 'manager'],
        } as unknown as ScopedSession;
        expect(isWaiterOnly(managerOnShift)).toBe(false);
    });

    it('fails OPEN on a session that carries no scope block at all', () => {
        // Every restriction this flag drives is ALSO a server gate, so an
        // unscoped stale session sees a control that refuses; the converse would
        // blank the floor screen for every owner.
        expect(isWaiterOnly({})).toBe(false);
        expect(isWaiterOnly({ scope: null })).toBe(false);
        expect(isWaiterOnly(null)).toBe(false);
        expect(isWaiterOnly(undefined)).toBe(false);
    });
});

describe('can — the server has answered, so nothing here re-derives it', () => {
    it('returns the server\'s flag verbatim', () => {
        expect(can(answered({ settle_bill: true }), 'settle_bill')).toBe(true);
        expect(can(answered({ settle_bill: false }), 'settle_bill')).toBe(false);
    });

    it('obeys a server NO even when the action list would have said yes', () => {
        // This is the direction that matters: the gate on the route is free to
        // move, and a client that overrode the server from a hard-coded uuid
        // would keep showing a control the route now refuses.
        expect(can(answered({ settle_bill: false }, [PERM_CLOSE_BILL]), 'settle_bill')).toBe(false);
    });

    it('obeys a server YES even when the action list is empty', () => {
        expect(can(answered({ delete_table: true }, []), 'delete_table')).toBe(true);
    });

    it('falls back to the server\'s own action list when the flag was never sent', () => {
        // A browser holding a session from before the flags shipped. Treating the
        // missing flag as false would blank the settle button and the floor plan
        // for every owner who had not signed out and in again.
        expect(can(stale([PERM_CLOSE_BILL]), 'settle_bill')).toBe(true);
        expect(can(stale([PERM_TABLE_DELETE]), 'delete_table')).toBe(true);
        expect(can(stale([PERM_TABLE_LAYOUT]), 'edit_table')).toBe(true);
        expect(can(stale([PERM_MANAGE_SECTIONS]), 'manage_table_sections')).toBe(true);
        expect(can(stale([PERM_VOID_ORDER]), 'void_order')).toBe(true);
        expect(can(stale([PERM_VIEW_ROLES]), 'view_roles')).toBe(true);
        expect(can(stale([PERM_EDIT_ROLES]), 'manage_roles')).toBe(true);
    });

    it('refuses on the fallback path when the action is genuinely absent', () => {
        expect(can(stale([PERM_TABLE_SERVICE]), 'settle_bill')).toBe(false);
        expect(can(stale([]), 'delete_table')).toBe(false);
        expect(can(null, 'delete_table')).toBe(false);
    });

    it('lets the wildcard through on both paths — an admin loses nothing', () => {
        expect(can(stale(['*']), 'settle_bill')).toBe(true);
        expect(can(stale(['*']), 'delete_table')).toBe(true);
        expect(can(answered({ settle_bill: true }, ['*']), 'settle_bill')).toBe(true);
    });
});

describe('hasPermission — the wildcard, and never optimistic', () => {
    it('treats the wildcard as every permission', () => {
        expect(hasPermission(['*'], PERM_TABLE_DELETE)).toBe(true);
        expect(hasPermission(['*'], PERM_VIEW_ROLES)).toBe(true);
    });

    it('is false for an action list that has not loaded', () => {
        expect(hasPermission(undefined, PERM_TABLE_DELETE)).toBe(false);
        expect(hasPermission(null, PERM_TABLE_DELETE)).toBe(false);
        expect(hasPermission([], PERM_TABLE_DELETE)).toBe(false);
    });
});

describe('canOpenFloorPlan — D5, the layout half of the floor', () => {
    it('opens on ANY one of the three layout capabilities', () => {
        expect(canOpenFloorPlan(answered({ edit_table: true }))).toBe(true);
        expect(canOpenFloorPlan(answered({ delete_table: true }))).toBe(true);
        expect(canOpenFloorPlan(answered({ manage_table_sections: true }))).toBe(true);
    });

    it('opens for an admin', () => {
        expect(canOpenFloorPlan(stale(['*']))).toBe(true);
    });

    it('stays shut for a session that can only SERVE tables — which is D5 as permissions', () => {
        // "Table Occupied" is what a waiter holds: occupy, release, covers,
        // status. None of it changes the layout, so the floor-plan page has
        // nothing in it they may do, and every control there would refuse.
        expect(canOpenFloorPlan(stale([PERM_TABLE_SERVICE]))).toBe(false);
        expect(canOpenFloorPlan(answered({
            edit_table: false, delete_table: false, manage_table_sections: false,
        }, [PERM_TABLE_SERVICE]))).toBe(false);
    });
});

describe('canOpenRoles — C6, the server\'s answer and not the primary role', () => {
    it('opens for an admin however their primary role was recorded', () => {
        // The C6 defect: the page tested `user.role !== "admin"`, and the
        // backend rewrites a primary it cannot recognise — a custom role's uuid,
        // or a record whose primary was never set — to "employee". A genuine
        // owner therefore arrived as `role: "employee"` and was refused the whole
        // page, so could never click a core role. Neither the flag nor the
        // wildcard fallback cares what the primary says.
        expect(canOpenRoles({
            scope: { waiter_only: false, view_roles: true },
            role: 'employee',
            role_all: ['employee', 'd2b1f0c4-1e62-4b0a-9f77-2a3c5e8d90ab'],
        } as unknown as ScopedSession)).toBe(true);
        expect(canOpenRoles(stale(['*']))).toBe(true);
    });

    it('opens for a manager the tenant has granted it — C5\'s customisable half', () => {
        expect(canOpenRoles(answered({ view_roles: true }))).toBe(true);
        expect(canOpenRoles(stale([PERM_VIEW_ROLES]))).toBe(true);
    });

    it('stays shut without it', () => {
        expect(canOpenRoles(answered({ view_roles: false }))).toBe(false);
        expect(canOpenRoles(stale([PERM_TABLE_SERVICE]))).toBe(false);
    });
});

describe('canOpenEmployeesPage — either half of the screen is a reason to be there', () => {
    it('opens on the staff list alone', () => {
        expect(canOpenEmployeesPage(stale(['92cb8236-1039-4b47-a66f-6c7c8b0144ae']))).toBe(true);
    });

    it('opens on the roles half alone', () => {
        expect(canOpenEmployeesPage(answered({ view_roles: true }))).toBe(true);
    });

    it('stays shut with neither', () => {
        expect(canOpenEmployeesPage(answered({ view_roles: false }, [PERM_TABLE_SERVICE]))).toBe(false);
    });
});

describe('the fallback uuids are the backend\'s own', () => {
    // Restated as literals rather than imported: the point is to catch this
    // module drifting away from the routes, and a fresh uuid for an existing
    // capability strips that capability from every role that holds it today.
    it('match routes/roles.ts', () => {
        expect(PERM_VIEW_ROLES).toBe('17ba6407-b703-4403-ab59-13235966053f');
        expect(PERM_VIEW_ACTIONS).toBe('2b6f7948-0b27-41a9-9727-c04ccc9f4db1');
        expect(PERM_EDIT_ROLES).toBe('c0135d18-68b4-45e9-9b51-849158df6efd');
        expect(PERM_DELETE_ROLES).toBe('53d0927d-00f4-48cc-a40c-51edb09826d8');
        expect(PERM_ASSIGN_ROLE).toBe('4bf54bd9-9124-46c0-a7cc-011ea4c4e172');
        expect(PERM_REMOVE_ROLE).toBe('9acc9097-4803-4be0-bb6d-fc2c5de57cf5');
    });

    it('match routes/tables.ts', () => {
        expect(PERM_TABLE_LAYOUT).toBe('194ce6ee-b867-4be3-b5f0-48c28ce0a81b');
        expect(PERM_TABLE_DELETE).toBe('5777c4aa-29df-4ea1-9c45-c1038d25f746');
        expect(PERM_MANAGE_SECTIONS).toBe('2f7c5a94-8e13-4b60-9d27-6a0f3c8e5b41');
        expect(PERM_TABLE_SERVICE).toBe('090ea8d4-e348-4e1b-9723-11131a73a085');
    });

    it('match routes/_shared.ts', () => {
        expect(PERM_CLOSE_BILL).toBe('a953d044-31ba-4e31-b96f-99304fe43dfa');
        expect(PERM_VOID_ORDER).toBe('c1f83b26-5a97-4e40-b8d3-7e02a9c4f156');
        expect(PERM_ORDER_DELETE).toBe('8c3f5b21-0e74-4a96-b2d8-6f1a9c4e7b53');
    });
});

describe('showsMoney — C4\'s gate, and it is the SAME predicate the phone uses', () => {
    // `RoleScope.showsMoney` in the Flutter app is literally `!isWaiterOnly`.
    // Anything else here — a capability, a role string, "is the order open" —
    // would be a fourth answer to a question that already has one, and it would
    // show up as a waiter seeing prices on the web that the phone hides.
    it('hides money from a waiter the server scoped', () => {
        expect(showsMoney({ scope: { waiter_only: true } })).toBe(false);
    });

    it('shows money to everyone else', () => {
        expect(showsMoney({ scope: { waiter_only: false } })).toBe(true);
    });

    it('shows money to a session the server never scoped — the fix must not blank the owner', () => {
        // The failure worth fearing is not "a waiter saw a figure", it is "the
        // fix took the till away from the person who runs the restaurant".
        expect(showsMoney(stale([]))).toBe(true);
        expect(showsMoney({ scope: null })).toBe(true);
        expect(showsMoney(null)).toBe(true);
        expect(showsMoney(undefined)).toBe(true);
    });

    it('is exactly the inverse of isWaiterOnly for every input', () => {
        for (const session of [
            { scope: { waiter_only: true } },
            { scope: { waiter_only: false } },
            stale([PERM_CLOSE_BILL]),
            null,
            undefined,
        ] as (ScopedSession | null | undefined)[]) {
            expect(showsMoney(session)).toBe(!isWaiterOnly(session));
        }
    });

    it('ignores the role strings that broke the old client rule', () => {
        const waiterWithCustomRole = {
            scope: { waiter_only: true },
            role: 'waiter',
            role_all: ['waiter', 'd2b1f0c4-1e62-4b0a-9f77-2a3c5e8d90ab'],
        } as unknown as ScopedSession;
        expect(showsMoney(waiterWithCustomRole)).toBe(false);
    });
});

describe('D3 / D4 — the two move gates, which are genuinely two grants', () => {
    // POST /tables/move rides on "Table Occupied" (the SERVICE permission a core
    // waiter holds — the backend's own comment: "service, not administration").
    // POST /tables/move-order rides on "Add Orders", the same id that gates the
    // KOT reprint, because moving a ticket is the same class of act as
    // reprinting one. A tenant can hold either without the other, so the two
    // must be asked separately.
    it('reads the SERVER\'s resolved action list for each route\'s own uuid', () => {
        expect(canMoveTableParty(stale([PERM_TABLE_SERVICE]))).toBe(true);
        expect(canMoveTableParty(stale([PERM_ORDER_ADD]))).toBe(false);
        expect(canMoveOrderToTable(stale([PERM_ORDER_ADD]))).toBe(true);
        expect(canMoveOrderToTable(stale([PERM_TABLE_SERVICE]))).toBe(false);
    });

    it('an admin holds both, off the wildcard, with no special case anywhere', () => {
        expect(canMoveTableParty(stale(['*']))).toBe(true);
        expect(canMoveOrderToTable(stale(['*']))).toBe(true);
    });

    it('refuses a session carrying no action list at all', () => {
        expect(canMoveTableParty({})).toBe(false);
        expect(canMoveOrderToTable(null)).toBe(false);
    });

    it('does not gate either on waiter_only — a waiter moves the party they seated', () => {
        // The requirement says "staff", and the permission the backend chose is
        // the one the core waiter role holds. Adding a role test on top would
        // hide a control from exactly the person it was gated for.
        const scopedWaiter = { scope: { waiter_only: true }, actions_set: [PERM_TABLE_SERVICE, PERM_ORDER_ADD] };
        expect(canMoveTableParty(scopedWaiter)).toBe(true);
        expect(canMoveOrderToTable(scopedWaiter)).toBe(true);
    });

    it('PERM_ORDER_ADD is routes/tables.ts\'s own id, verbatim', () => {
        expect(PERM_ORDER_ADD).toBe('4ad474d4-5230-449c-874f-6a238b833bca');
    });
});
