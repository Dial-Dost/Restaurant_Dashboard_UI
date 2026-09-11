// C6 — A ROLE THAT OPENS TO A COLUMN OF RAW UUIDs.
//
// THE SYMPTOM. Click a core role in Employees → Role Access Control and you got
// a list like
//
//     4ad474d4-5230-449c-874f-6a238b833bca
//     090ea8d4-e348-4e1b-9723-11131a73a085
//     98b10bde-802d-4a5b-a726-53a826424f79
//
// which is "viewing" a role in the same sense that a hex dump is reading a
// photograph. The reviewer cannot tell whether the waiter role settles bills.
//
// THE CAUSE, AND WHY FIXING IT IN THE CLIENT DID NOT WORK. GET /core-roles and
// GET /roles returned ids. To render a name the screen had to fetch GET /actions
// and join — and /actions is gated on a DIFFERENT permission (2b6f7948…) from
// the one that opens the roles screen (17ba6407…). The stock core `manager`
// holds both today, but a tenant's custom "shift lead" granted View Roles and
// not View Actions holds one, and that identity opens a role and is shown
// uuids. A join across two differently-permissioned reads is not a rendering
// strategy; it is a coin flip on the tenant's role configuration.
//
// THE FIX IS ON THE SERVER AND IT IS ALREADY SHIPPED. Both routes now return a
// `permissions` array beside the existing ids: same order, same length, with
// `action_name`, `action_desc` and `group` already attached, plus an `editable`
// flag saying whether the role can be written at all. One call renders a
// readable role, for anybody the roles screen lets in. This module is how this
// app READS that projection — because the projection was added, deployed, and
// then consumed by nobody, which is the pattern that has now bitten this project
// three times. A field nobody reads is not a feature; it is a claim.
//
// THE RULE THAT MATTERS MOST HERE: NOTHING IS EVER DROPPED.
//
// An id the server could not name arrives with `action_name: null`. It is still
// a permission the role GRANTS. Hiding it — or shortening the list to the ones
// that resolved — would let a reviewer open a role, count the lines, and
// conclude it grants less than it does. That is the failure worth fearing on an
// access-control screen: not an ugly row, a *safe-looking* one. So the list this
// module returns is ALWAYS exactly as long as the id list the server sent, every
// unnamed entry is marked `resolved: false` and keeps its id for the screen to
// print, and `unresolvedCount` exists so the screen can say so out loud.
//
// PURE — no React, no fetch, no `window`, so `__tests__/role-permissions.test.ts`
// can pin it without driving a browser. `db.ts` carries "use server" and may
// export ONLY async functions, which is why the shared types live here and are
// imported there rather than the other way round.

/** One permission exactly as /core-roles and /roles project it. */
export interface RolePermission {
    id: string;
    /** null when the server has no "Actions" row for this id. NEVER a reason to drop it. */
    action_name: string | null;
    action_desc: string | null;
    group: string | null;
}

/** A role row from either endpoint, in the shape this module needs from it. */
export interface RoleLike {
    /** /core-roles — the id list, unchanged and still first. */
    actions?: unknown;
    /** /roles — the same thing under the name a custom role has always used. */
    actions_performable?: unknown;
    /** The C6 projection. ABSENT on a backend older than it — see `renderRolePermissions`. */
    permissions?: unknown;
    /** Whether this role can be written at all. Core roles are defined in code: false. */
    editable?: unknown;
}

/** One line as the roles screen draws it. */
export interface RenderedPermission {
    /** Always present — it is what the screen falls back to printing. */
    id: string;
    /** What to show. Never empty: an unresolved id gets `UNKNOWN_PERMISSION_LABEL`. */
    name: string;
    desc: string | null;
    group: string | null;
    /**
     * False when nothing could name this id. The row is still SHOWN; this flag is
     * how the screen marks it as "granted, but we cannot say what it is" instead
     * of quietly leaving it out.
     */
    resolved: boolean;
}

/** What a row says when the id could not be named. Stated once so the tests can pin it. */
export const UNKNOWN_PERMISSION_LABEL = 'Unknown permission';

/**
 * The admin wildcard. It is NOT an "Actions" row and never will be — it is the
 * absence of a check — so the server names it explicitly and so does the
 * fallback path below. Without this the admin core role renders as one
 * unresolved uuid, which is the least useful possible answer to "what does admin
 * grant".
 */
export const WILDCARD_ACTION = '*';
const WILDCARD_NAME = 'All actions';
const WILDCARD_DESC = 'Every permission in the system, including any added later';

const asStringArray = (value: unknown): string[] | null => {
    if (!Array.isArray(value)) { return null; }
    return value.map((entry) => (typeof entry === 'string' ? entry : String(entry)));
};

const text = (value: unknown): string | null => {
    if (typeof value !== 'string') { return null; }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};

/**
 * The server's projection, validated — or NULL when the server did not send one.
 *
 * NULL and an EMPTY ARRAY mean different things and the difference is
 * load-bearing: null is "this backend predates C6, fall back to the catalogue",
 * `[]` is "this role grants nothing", and treating the first as the second would
 * render every role on an older server as empty.
 */
export const readRolePermissions = (value: unknown): RolePermission[] | null => {
    if (!Array.isArray(value)) { return null; }
    const out: RolePermission[] = [];
    for (const entry of value) {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) { continue; }
        const obj = entry as Record<string, unknown>;
        const id = typeof obj.id === 'string' ? obj.id : null;
        if (id === null) { continue; }
        out.push({
            id,
            action_name: text(obj.action_name),
            action_desc: text(obj.action_desc),
            group: text(obj.group),
        });
    }
    return out;
};

/** The id list a role row carries, whichever of the two names it uses. */
export const roleActionIds = (role: RoleLike | null | undefined): string[] => {
    const fromCore = asStringArray(role?.actions);
    if (fromCore !== null) { return fromCore; }
    const fromCustom = asStringArray(role?.actions_performable);
    if (fromCustom !== null) { return fromCustom; }
    // Neither id list, but a projection: the projection IS the list.
    const projected = readRolePermissions(role?.permissions);
    return projected === null ? [] : projected.map((p) => p.id);
};

/**
 * Is this role writable? The SERVER's answer.
 *
 * `editable` exists so a client renders one list of roles with one rule for
 * which ones open an editor, instead of re-deriving "is this name a core role"
 * by matching strings — which is the same spelling-versus-authority mistake that
 * un-scoped a waiter in production. A backend that does not send it answers
 * `undefined`, and the caller keeps whatever it did before.
 */
export const roleIsEditable = (role: RoleLike | null | undefined): boolean | undefined =>
    typeof role?.editable === 'boolean' ? role.editable : undefined;

/** The name catalogue from GET /actions, when this session was allowed to read it. */
export type ActionCatalog = Readonly<Record<string, { name?: string | null; desc?: string | null; group?: string | null }>>;

/**
 * RENDER ONE ROLE'S PERMISSIONS.
 *
 * The ID LIST IS THE SPINE. Every id the role carries produces exactly one row,
 * in the order the server sent it, whatever else is or is not available — see
 * the header. The name for each row is looked for in this order:
 *
 *   1. THE SERVER'S PROJECTION AT THE SAME INDEX, when its id matches. The
 *      contract says same order and same length, and this is the cheap path.
 *   2. THE SERVER'S PROJECTION BY ID. A defensive second look, so a projection
 *      that ever arrives reordered or short still names what it can rather than
 *      silently degrading a whole role to uuids.
 *   3. THE /actions CATALOGUE, if this session was allowed to read it. This is
 *      the ONLY place the old join survives, and it is now a fallback for a
 *      backend that predates the projection — not the primary path. A session
 *      holding View Roles and not View Actions no longer depends on it.
 *   4. NOTHING — and the row is still emitted, marked `resolved: false`, holding
 *      its id.
 *
 * The wildcard is named at every step, including when neither a projection nor a
 * catalogue exists.
 */
export const renderRolePermissions = (
    role: RoleLike | null | undefined,
    catalog?: ActionCatalog | null,
): RenderedPermission[] => {
    const ids = roleActionIds(role);
    const projection = readRolePermissions(role?.permissions);
    const byId = new Map<string, RolePermission>();
    if (projection !== null) {
        for (const entry of projection) {
            if (!byId.has(entry.id)) { byId.set(entry.id, entry); }
        }
    }

    return ids.map((id, index) => {
        const positional = projection?.[index];
        const projected = positional?.id === id ? positional : byId.get(id) ?? null;
        if (projected !== null && projected.action_name !== null) {
            return {
                id,
                name: projected.action_name,
                desc: projected.action_desc,
                group: projected.group,
                resolved: true,
            };
        }

        if (id === WILDCARD_ACTION) {
            return { id, name: WILDCARD_NAME, desc: projected?.action_desc ?? WILDCARD_DESC, group: null, resolved: true };
        }

        const fallback = catalog?.[id];
        const fallbackName = text(fallback?.name);
        if (fallbackName !== null) {
            return {
                id,
                name: fallbackName,
                desc: projected?.action_desc ?? text(fallback?.desc),
                group: projected?.group ?? text(fallback?.group),
                resolved: true,
            };
        }

        // GRANTED, BUT UNNAMEABLE. Shown anyway; see the header.
        return {
            id,
            name: UNKNOWN_PERMISSION_LABEL,
            desc: projected?.action_desc ?? null,
            group: projected?.group ?? null,
            resolved: false,
        };
    });
};

/** How many rows the screen must warn about. 0 means the role rendered completely. */
export const unresolvedCount = (rendered: readonly RenderedPermission[]): number =>
    rendered.reduce((n, row) => (row.resolved ? n : n + 1), 0);

/**
 * A one-line summary for a role in a list — the names, comma separated, with the
 * unnameable ones still counted so the line never understates the grant.
 *
 * Returns "" for a role that grants nothing, which is every caller's signal to
 * print its own "No actions configured" rather than an empty comma list.
 */
export const permissionSummary = (rendered: readonly RenderedPermission[]): string =>
    rendered.map((row) => (row.resolved ? row.name : `${UNKNOWN_PERMISSION_LABEL} (${row.id})`)).join(', ');
