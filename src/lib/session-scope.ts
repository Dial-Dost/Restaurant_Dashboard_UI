// WHAT THIS SESSION MAY DO — TAKEN FROM THE SERVER, NEVER WORKED OUT HERE.
//
// THE BUG THIS EXISTS TO KILL, and it was live in production.
//
// The waiter scoping was decided independently in every client by asking whether
// every role string on the profile was literally the word "waiter":
//
//     roles.every((r) => r === 'waiter')       // Flutter
//     hasRole('waiter') && !hasRole('admin')   // this app, three separate copies
//
// Both are a test on SPELLING rather than on authority, and what gets spelled
// into `role_all` varies per tenant: a CUSTOM ROLE IS A UUID, so a waiter
// granted any custom role carries `["waiter", "d2b1f0c4-…"]`, the test fails,
// and every restriction evaporates — money included. Using the granular RBAC
// feature silently un-scoped the role it was most likely to be used on.
//
// The rule now lives ONCE, on the server, and ships in the `scope` block on
// /auth/employee-login and /auth/me. So does the answer to "may this identity DO
// x" for every control the V3 requirements ask a client to hide. This module is
// how this app OBEYS both. Nothing here re-derives an answer the server sent,
// and nothing else in `src/` may either: two implementations of one rule is how
// a tenant ended up with a waiter who could see the takings.
//
// WHY THE SERVER SENDS THE ANSWER AND NOT THE INPUTS. `actions_set` is on the
// payload too, so in principle every client could test for the action uuid
// itself. That is exactly what must not happen — the uuid would then be written
// out in Dart, in TypeScript and in whatever ships next, the gate on the route
// would be free to move, and the three would drift: the same failure mode with a
// different constant. There is ONE list of which uuid backs which control, in
// the backend's `sessionCapabilities`, sitting beside the guards it describes.
//
// THE OTHER HALF OF THE RULE. Hiding a control is a courtesy, not a permission.
// Every flag below is backed by a server gate on the route it names, so a control
// this module hides is a control whose route already refuses, and a deep link, a
// back-navigation or a stale cached screen gains nothing by reaching it.
//
// AND AN ADMIN MUST LOSE NOTHING. The server satisfies every flag from the `"*"`
// wildcard, `hasPermission` does the same, and `isWaiterOnly` answers false for
// anyone the server has not positively scoped — including a session too old to
// carry the field at all. The failure mode worth fearing is not "a waiter saw a
// figure", it is "the fix took the till away from the person who runs the
// restaurant".
//
// PURE — no React, no fetch, no `window`, so `src/lib/__tests__/session-scope.test.ts`
// can pin it without driving a browser. It follows the precedent set by
// `table-assignment.ts`, `mis-reports.ts` and `mis-capture.ts`: db.ts carries
// "use server" and may export ONLY async functions, so a plain `export const`
// there is a build error that tsc and jest both wave through while every page
// 500s at runtime.

// ONE implementation of the wildcard rule for the whole app. Re-exported rather
// than rewritten: `mis-capture.ts` has carried it (and its test) since the
// capture screens shipped, and a second copy is the very mistake this file is
// about. The two capture permissions come from there for the same reason.
import { hasPermission, PERM_NON_CHARGEABLE, PERM_SERVICE_CHARGE_WAIVER } from './mis-capture';

export { hasPermission };

/**
 * The `scope` block the server ships on /auth/employee-login and /auth/me.
 *
 * Flat, and it carries two kinds of answer:
 *   * `waiter_only` — is this identity a scoped floor role (the backend's
 *     `role_scope.ts`);
 *   * one boolean per CONTROL the V3 requirements ask a client to hide (the
 *     backend's `sessionCapabilities`).
 *
 * Every capability flag is OPTIONAL here and only here: a session stored by an
 * older release carries none of them. See `can()` for what happens then.
 */
export interface SessionScope {
    /** The server's answer. Never compute your own; see the header. */
    waiter_only: boolean;
    /** POST /bills/order/:id/{waiter-confirm-payment,admin-approve-payment,close}, PATCH /orders/:id/status → Paid. C2. */
    settle_bill?: boolean;
    /** DELETE /table/:name — C7 / H8. */
    delete_table?: boolean;
    /** POST /add-table, PATCH /table/:name — the floor-plan writes D5 keeps out of the Tables view. */
    edit_table?: boolean;
    /** POST / PATCH / DELETE /table-sections — creating, renaming and removing zones. */
    manage_table_sections?: boolean;
    /** POST /orders/:id/items/:itemId/non-chargeable — "Comp an item" (C1: completely hidden for waiters). */
    comp_item?: boolean;
    /** POST /bills/service-charge-waiver — "Waive service charge" (C1). */
    waive_service_charge?: boolean;
    /** POST /orders/:id/void — A2's cancellation-with-a-recorded-reason. */
    void_order?: boolean;
    /** GET /roles, GET /core-roles — C5 / C6: who may open the access-control screen. */
    view_roles?: boolean;
    /** POST /roles — C5: who may create and edit a custom role. */
    manage_roles?: boolean;
    /** PATCH /menu/:id/availability — H4's "86 a dish" sidebar. */
    edit_menu?: boolean;
    /**
     * Cancel KOT — cancelling food the kitchen has been told about. FALSE for a
     * waiter-only login whatever it was granted (client item 3, 2026-09-17): the
     * server refuses every such cancel with `cancel_needs_senior`. A Pending
     * order's decline does not read it.
     */
    cancel_kot?: boolean;
}

/** One of the server's per-control answers. */
export type Capability = Exclude<keyof SessionScope, 'waiter_only'>;

/** The fields of the stored session this module reads. */
export interface ScopedSession {
    scope?: SessionScope | null;
    actions_set?: string[];
}

/**
 * Is this session a WAITER AND NOTHING SENIOR?
 *
 * Reads the server's answer and nothing else. In particular it does NOT look at
 * `role` or `role_all`: those are the inputs the server already considered, and
 * reading them here would be the second implementation all over again.
 *
 * WHICH DIRECTION IT FAILS. A session minted before the server published the
 * field (a browser holding a localStorage session from the previous release)
 * carries no `scope`, and answers false — NOT scoped. That matches the server's
 * own failure direction and is safe for one reason only: every restriction this
 * flag drives is ALSO a server gate, so an un-scoped stale session still cannot
 * settle a bill or delete a table; it merely sees a control that refuses. The
 * converse — defaulting a missing field to "scoped" — would blank the floor
 * screen for every owner whose browser had not re-logged-in yet.
 *
 * `AuthContext` re-hydrates from GET /auth/me on mount, so the missing-field
 * window is one page load wide.
 */
export const isWaiterOnly = (session: ScopedSession | null | undefined): boolean =>
    session?.scope?.waiter_only === true;

// ---------------------------------------------------------------------------
// THE PERMISSION IDS — each one the backend's own `validateAction` argument
// ---------------------------------------------------------------------------
//
// NEVER MINT A NEW ID FOR AN EXISTING CAPABILITY. These are copied from the
// backend routes verbatim; a fresh uuid here would show a control that every
// role in the fleet is refused, and a fresh uuid there would strip the
// capability from every role that holds it today (migration 025's rule).
//
// Most of them are now only the FALLBACK path — see `can()`. The handful the
// server has not published a capability flag for still read them directly, and
// each of those should move into the `scope` block the moment the backend adds
// it, for the drift reason in this file's header.

/** GET /roles and GET /core-roles — "View Roles". Backs `view_roles`. */
export const PERM_VIEW_ROLES = '17ba6407-b703-4403-ab59-13235966053f';
/** GET /actions — the grantable-actions catalogue. No capability flag yet. */
export const PERM_VIEW_ACTIONS = '2b6f7948-0b27-41a9-9727-c04ccc9f4db1';
/** POST /roles — creates a role AND rewrites an existing one. Backs `manage_roles`. */
export const PERM_EDIT_ROLES = 'c0135d18-68b4-45e9-9b51-849158df6efd';
/** DELETE /roles/:id. No capability flag yet. */
export const PERM_DELETE_ROLES = '53d0927d-00f4-48cc-a40c-51edb09826d8';
/** POST /roles/assign. No capability flag yet. */
export const PERM_ASSIGN_ROLE = '4bf54bd9-9124-46c0-a7cc-011ea4c4e172';
/** POST /roles/remove. No capability flag yet. */
export const PERM_REMOVE_ROLE = '9acc9097-4803-4be0-bb6d-fc2c5de57cf5';

// --- The staff list that shares the Roles screen ----------------------------
/** GET /restaurant/users. */
export const PERM_VIEW_EMPLOYEES = '92cb8236-1039-4b47-a66f-6c7c8b0144ae';
/** POST /restaurant/users. */
export const PERM_ADD_EMPLOYEE = '58fdfca7-7a97-439b-aeb2-00e4395a9a30';
/** DELETE /restaurant/users. */
export const PERM_REMOVE_EMPLOYEE = 'a978f15d-1043-417a-b07b-05f6bddad875';
/** POST /restaurant/users/password and GET /restaurant/password-requests. */
export const PERM_PASSWORDS = '0b4d7f92-6c81-43a5-b7e0-2f9a1c8d5e36';

// --- The floor-plan / table-service split (D5) ------------------------------
//
// The server already draws this line and has for some time; the web had merged
// the two halves back together on one card grid. Every LAYOUT act rides on
// "Table Added", "Table Deleted" or "Manage Table Sections"; every SERVICE act
// rides on "Table Occupied". A waiter holds the last one and none of the first
// three, which is D5 stated as permissions.

/** POST /add-table and PATCH /table/:name — "Table Added". Backs `edit_table`. */
export const PERM_TABLE_LAYOUT = '194ce6ee-b867-4be3-b5f0-48c28ce0a81b';
/** DELETE /table/:name — "Table Deleted". Backs `delete_table`. */
export const PERM_TABLE_DELETE = '5777c4aa-29df-4ea1-9c45-c1038d25f746';
/** /table-sections — "Manage Table Sections". Backs `manage_table_sections`. */
export const PERM_MANAGE_SECTIONS = '2f7c5a94-8e13-4b60-9d27-6a0f3c8e5b41';
/** /occupy-table, /release-table, /table-covers, /table-status, /get-tables — "Table Occupied". */
export const PERM_TABLE_SERVICE = '090ea8d4-e348-4e1b-9723-11131a73a085';

/** "Close Bill" (Bills) — C2's settle gate. Backs `settle_bill`. */
export const PERM_CLOSE_BILL = 'a953d044-31ba-4e31-b96f-99304fe43dfa';
/** POST /orders/:id/void — "Void Orders With Reason". Backs `void_order`. */
export const PERM_VOID_ORDER = 'c1f83b26-5a97-4e40-b8d3-7e02a9c4f156';
/** DELETE /orders/:id — "Delete Orders". Destroys the row; records no reason. No flag yet. */
export const PERM_ORDER_DELETE = '8c3f5b21-0e74-4a96-b2d8-6f1a9c4e7b53';
/** "Edit Menu" — PATCH /menu/:id/price and /menu/:id/availability. Backs `edit_menu`. */
export const PERM_EDIT_MENU = 'ed800655-b937-44ba-a7ca-7458295886c9';
/**
 * "Add Orders" — the everyday floor action, and the gate on POST /print/bill,
 * POST /print/kot/order/:id and D4's POST /tables/move-order. Quoted from those
 * routes; NOT a new id (migration 025's rule), and the backend deliberately put
 * the KOT move on the SAME gate as the KOT reprint because moving a ticket is
 * the same class of act as reprinting one. No capability flag yet, so the
 * helpers below read the server's resolved `actions_set` for it directly.
 */
export const PERM_ORDER_ADD = '4ad474d4-5230-449c-874f-6a238b833bca';

/**
 * The uuid each capability is gated on, used ONLY when the server did not send
 * the flag. Quoted from the routes exactly as `sessionCapabilities` quotes them;
 * if one ever disagrees with the server the server wins, because `can()` reaches
 * this map only when the server said nothing at all.
 */
const CAPABILITY_FALLBACK_ACTION: Record<Capability, string> = {
    settle_bill: PERM_CLOSE_BILL,
    delete_table: PERM_TABLE_DELETE,
    edit_table: PERM_TABLE_LAYOUT,
    manage_table_sections: PERM_MANAGE_SECTIONS,
    comp_item: PERM_NON_CHARGEABLE,
    waive_service_charge: PERM_SERVICE_CHARGE_WAIVER,
    edit_menu: PERM_EDIT_MENU,
    void_order: PERM_VOID_ORDER,
    view_roles: PERM_VIEW_ROLES,
    manage_roles: PERM_EDIT_ROLES,
    // The plain cancel's gate. Only ever reached for a session stored before the
    // flag shipped — and `cancelKotRoute` asks `waiter_only` before it asks this.
    cancel_kot: PERM_ORDER_ADD,
};

/**
 * MAY THIS SESSION DO `capability`? — the server's answer, taken as given.
 *
 * This is the function every gate in this app should call. It does not reason
 * about roles, and it does not test an action uuid when the server has answered:
 * one list of which uuid backs which control, on the server, beside the guards.
 *
 * THE ONE FALLBACK, AND WHY IT IS NOT A SECOND RULE. A browser holding a
 * localStorage session from before the capability flags shipped carries none of
 * them. Treating a missing flag as `false` would blank the settle button, the
 * floor plan and the roles screen for every owner who had not signed out and in
 * again — the exact failure this whole exercise exists not to cause. So an
 * ABSENT flag falls back to reading the server's own resolved `actions_set` for
 * the uuid the route is gated on: the same list, one hop less direct, and
 * load-bearing for exactly one page load, because `AuthContext` re-hydrates the
 * block from GET /auth/me on mount. A flag the server DID send is never
 * second-guessed, in either direction.
 */
/**
 * The server's answer, or `undefined` when it did not send one.
 *
 * Separate from `can()` because the two questions are genuinely different:
 * `can()` asks "is this session allowed to", and falls back to the action set so
 * a session stored by an older release still works. This asks "did the CURRENT
 * backend tell us about this capability at all", which is the question you want
 * when the control would 404 against a backend that predates it.
 */
export const answered = (
    session: ScopedSession | null | undefined,
    capability: Capability,
): boolean | undefined => {
    const value = session?.scope?.[capability];
    return typeof value === 'boolean' ? value : undefined;
};

export const can = (session: ScopedSession | null | undefined, capability: Capability): boolean => {
    const answered = session?.scope?.[capability];
    if (typeof answered === 'boolean') { return answered; }
    return hasPermission(session?.actions_set, CAPABILITY_FALLBACK_ACTION[capability]);
};

/**
 * May this session reach the FLOOR PLAN at all?
 *
 * Any one of the three layout capabilities is enough to have something to do
 * there; holding none of them means every control on the page would refuse, so
 * the page itself is not offered. This is the nav gate only — each control on
 * the page still asks its own question, because "can open the page" and "may
 * delete a table" are different ones.
 */
export const canOpenFloorPlan = (session: ScopedSession | null | undefined): boolean =>
    can(session, 'edit_table') || can(session, 'delete_table') || can(session, 'manage_table_sections');

/**
 * May this session reach the ROLES screen?
 *
 * Reading the roles is the floor of the screen — without it there is nothing to
 * show — so that one answer decides, and the edit / delete / assign controls
 * inside ask their own.
 *
 * THIS REPLACES `user.role !== "admin"`, WHICH WAS THE C6 DEFECT. `role` is the
 * PRIMARY role, and the backend's `parseEmployeeRoles` rewrites a primary it
 * cannot recognise — a custom role's uuid, or a record whose primary was never
 * set — to the literal string "employee". A genuine owner who also held one
 * custom role therefore arrived with `role: "employee"`, was refused the whole
 * page, and so could not click a core role to see what it granted. The server's
 * answer has no such failure: it is satisfied by the `"*"` wildcard however the
 * primary was mangled, and by a grant for a manager the tenant has set up —
 * which is also what makes C5's "customisable" half real.
 */
export const canOpenRoles = (session: ScopedSession | null | undefined): boolean =>
    can(session, 'view_roles');

/**
 * May this session take a dish off the menu? (H4)
 *
 * The SERVER's answer, obeyed — `PATCH /menu/:id/availability` is gated on the
 * same "Edit Menu" permission, so a session that cannot do it does not get a
 * button that 403s. A control whose only defence is being undrawn is not a
 * control; this is the courtesy, the route is the gate.
 */
export const canEditDishAvailability = (session: ScopedSession | null | undefined): boolean =>
    // NO FALLBACK, and that is the whole point of using `answered` here.
    //
    // THE SITUATION THIS IS FOR. The dashboard and the backend deploy on
    // separate pipelines, and the backend's can be held back: its deploy gate
    // refuses to ship any commit while a migration is pending, which is correct
    // (code must never land ahead of its migration) but means the WEB can be a
    // release ahead of the API. It happened on the release this shipped in.
    //
    // `can()` would paper over that. Its fallback asks the ACTION SET, and an
    // admin carries "*", so the button would appear on a backend that has never
    // heard of PATCH /menu/:id/availability — and every tap would 404 in a live
    // restaurant during service.
    //
    // `edit_menu` exists in `scope` only when the backend that serves the route
    // is running, so asking for the flag EXPLICITLY makes the control appear at
    // exactly the moment the route does, and vanish again if the backend is
    // rolled back. Self-healing in both directions, with no version number to
    // maintain anywhere.
    answered(session, 'edit_menu') === true;

/**
 * May this session reach the EMPLOYEES page?
 *
 * That page carries two things — the staff list and the role editor — each with
 * its own permission, and either one alone is a reason to be there. The page
 * renders only the halves the session actually holds.
 *
 * The staff half has no capability flag of its own yet, so it reads the action
 * its route is gated on directly. That is still the SERVER's resolved action
 * list, not a rule of this app's own; it should move into the `scope` block the
 * moment the backend publishes it.
 */
export const canOpenEmployeesPage = (session: ScopedSession | null | undefined): boolean =>
    hasPermission(session?.actions_set, PERM_VIEW_EMPLOYEES) || canOpenRoles(session);

/**
 * MAY THIS SESSION SEE MONEY? (C4)
 *
 * V3: "When a waiter is taking an order at a table, remove the prices from the
 * list of ordered dishes displayed on the right side. Only the dish name and
 * quantity should remain visible."
 *
 * ONE PREDICATE, THREE CLIENTS. This is `!isWaiterOnly` and nothing else —
 * literally what the Flutter app's `RoleScope.showsMoney` is
 * (`models/role_scope.dart`), and what the backend's own redaction keys off. A
 * money gate that asked a different question here (a `can()` capability, a role
 * name, "is the order still open") would be a fourth answer to a question that
 * already has one, and the drift would show up as a waiter seeing prices on the
 * web that the phone hides — which is the csrorganics failure with a new
 * surface.
 *
 * NAMED FOR WHAT IT DECIDES, not for who it excludes, so a reader at the call
 * site does not have to hold "not waiter-only" in their head while reading a
 * JSX condition. The inversion lives here once.
 *
 * AN UNKNOWN IDENTITY KEEPS THE FIGURES. `isWaiterOnly` answers false for
 * anyone the server has not positively scoped, including a session too old to
 * carry the field, so the failure direction is "an owner whose browser has not
 * re-logged-in still sees the till" rather than "the screen silently loses half
 * of itself". The money it guards is DISPLAY only — nothing here is a control.
 */
export const showsMoney = (session: ScopedSession | null | undefined): boolean =>
    !isWaiterOnly(session);

// --- D3 / D4: moving a live party, and moving one mis-keyed ticket ----------
//
// Both are fully implemented, atomic and tested server-side; the dashboard
// simply had no UI. Neither has a capability flag in the `scope` block yet, so
// both read the server's own resolved `actions_set` for the uuid its route is
// gated on — the same list `can()` falls back to, one hop less direct. They
// should move into `scope` the moment the backend publishes them, for the drift
// reason in this file's header.
//
// NO FALLBACK TO A ROLE, AND NO WILDCARD OF OUR OWN: `hasPermission` already
// satisfies `"*"`, so an admin holds both without a special case.

/**
 * May this session move a whole party from one table to another?
 *
 * POST /tables/move, gated on "Table Occupied" — the SERVICE permission the
 * core waiter role holds. That is the backend's judgement and this app obeys
 * it: moving a live party is service, not administration, and the person who
 * sat them down is the person who moves them (routes/tables.ts says so in as
 * many words above the route).
 */
export const canMoveTableParty = (session: ScopedSession | null | undefined): boolean =>
    hasPermission(session?.actions_set, PERM_TABLE_SERVICE);

/**
 * May this session move ONE order/KOT to the table it should have been rung in
 * on?
 *
 * POST /tables/move-order, gated on "Add Orders" — the same id that gates the
 * KOT reprint, because the route PRINTS: it reissues a correction docket
 * carrying the same KOT number so the pass can pair it with the paper it
 * replaces. Reusing that gate is the backend's decision, quoted, not a
 * judgement made here.
 */
export const canMoveOrderToTable = (session: ScopedSession | null | undefined): boolean =>
    hasPermission(session?.actions_set, PERM_ORDER_ADD);
