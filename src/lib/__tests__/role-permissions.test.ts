// WHAT THESE TESTS ARE ACTUALLY PROTECTING.
//
// C6 is "a role opens to a column of raw UUIDs". The server fixed it by
// projecting `permissions` (id + action_name + action_desc + group, same order
// and same length as the id list) onto /core-roles and /roles — and the screen
// went on joining the ids against GET /actions, a read gated on a DIFFERENT
// permission. So the projection shipped and nothing consumed it, and the symptom
// survived for every identity that holds View Roles without View Actions.
//
// The two properties below are the ones that FAIL THE MOMENT THE SCREEN GOES
// BACK TO DERIVING ITS OWN ANSWER:
//
//   1. NO CATALOGUE IS NEEDED. Every "uses the projection" test passes an EMPTY
//      catalogue. An implementation that joins against /actions renders uuids
//      here and fails. This is the regression test for C6 itself.
//   2. NOTHING IS EVER DROPPED. An id the server could not name is still a
//      permission the role GRANTS. The rendered list is always exactly as long
//      as the id list, and the unnameable rows are marked rather than removed —
//      because the failure worth fearing on an access-control screen is not an
//      ugly row, it is a reviewer counting the lines and concluding a role
//      grants less than it does.
//
// And the fallback, because an older backend must not render every role empty.

import {
    UNKNOWN_PERMISSION_LABEL,
    permissionSummary,
    readRolePermissions,
    renderRolePermissions,
    roleActionIds,
    roleIsEditable,
    unresolvedCount,
    type RoleLike,
} from '../role-permissions';

const CLOSE_BILL = 'a953d044-31ba-4e31-b96f-99304fe43dfa';
const TABLE_SERVICE = '090ea8d4-e348-4e1b-9723-11131a73a085';
const VIEW_BILL = '98b10bde-802d-4a5b-a726-53a826424f79';
/** An id granted by a role but with no row in "Actions" — a real possibility. */
const ORPHAN = 'deadbeef-0000-4000-8000-000000000000';

/** A core role exactly as GET /core-roles now answers. */
const coreRole = (): RoleLike & { role: string } => ({
    role: 'waiter',
    actions: [TABLE_SERVICE, VIEW_BILL],
    permissions: [
        { id: TABLE_SERVICE, action_name: 'Table Occupied', action_desc: 'Seat, release and re-cover a table', group: 'Tables' },
        { id: VIEW_BILL, action_name: 'View Bill', action_desc: "Read a table's running bill", group: 'Bills' },
    ],
    editable: false,
});

/** A custom role exactly as GET /roles now answers. */
const customRole = (): RoleLike & { id: string; role_name: string } => ({
    id: 'role-1',
    role_name: 'shift_lead',
    actions_performable: [CLOSE_BILL, ORPHAN],
    permissions: [
        { id: CLOSE_BILL, action_name: 'Close Bill', action_desc: 'Settle and close a bill', group: 'Bills' },
        { id: ORPHAN, action_name: null, action_desc: null, group: null },
    ],
    editable: true,
});

/** The session that has NOT been granted "View Actions". This is the C6 identity. */
const NO_CATALOGUE = {};

describe('the projection is used, and no catalogue is needed — C6', () => {
    it('names a core role\'s permissions with an EMPTY action catalogue', () => {
        // A join against /actions renders two uuids here. That is the defect.
        const rendered = renderRolePermissions(coreRole(), NO_CATALOGUE);
        expect(rendered.map((r) => r.name)).toEqual(['Table Occupied', 'View Bill']);
        expect(rendered.every((r) => r.resolved)).toBe(true);
    });

    it('names a custom role\'s permissions with an EMPTY action catalogue', () => {
        const rendered = renderRolePermissions(customRole(), NO_CATALOGUE);
        expect(rendered[0].name).toBe('Close Bill');
    });

    it('keeps the server\'s ORDER — the contract says same order, same length', () => {
        const rendered = renderRolePermissions(coreRole(), NO_CATALOGUE);
        expect(rendered.map((r) => r.id)).toEqual([TABLE_SERVICE, VIEW_BILL]);
    });

    it('carries the description and group through, so a row can explain itself', () => {
        const rendered = renderRolePermissions(coreRole(), NO_CATALOGUE);
        expect(rendered[0].desc).toBe('Seat, release and re-cover a table');
        expect(rendered[0].group).toBe('Tables');
    });

    it('prefers the SERVER\'s name over a catalogue that disagrees', () => {
        // If the two ever disagree the server wins: it is the same table the
        // route itself reads, and a stale client-side catalogue is not evidence.
        const rendered = renderRolePermissions(coreRole(), {
            [TABLE_SERVICE]: { name: 'Something Else' },
        });
        expect(rendered[0].name).toBe('Table Occupied');
    });
});

describe('NOTHING IS EVER DROPPED — a reviewer must not conclude a role grants less', () => {
    it('keeps an id the server could not name, in place, marked unresolved', () => {
        const rendered = renderRolePermissions(customRole(), NO_CATALOGUE);
        expect(rendered).toHaveLength(2);
        expect(rendered[1].id).toBe(ORPHAN);
        expect(rendered[1].name).toBe(UNKNOWN_PERMISSION_LABEL);
        expect(rendered[1].resolved).toBe(false);
        expect(unresolvedCount(rendered)).toBe(1);
    });

    it('renders EVERY id even when the projection is missing entries for some', () => {
        // A short or reordered projection must degrade to "named what it could",
        // never to a shorter role.
        const rendered = renderRolePermissions({
            actions: [TABLE_SERVICE, VIEW_BILL, CLOSE_BILL],
            permissions: [{ id: CLOSE_BILL, action_name: 'Close Bill', action_desc: null, group: 'Bills' }],
        }, NO_CATALOGUE);
        expect(rendered).toHaveLength(3);
        expect(rendered.map((r) => r.id)).toEqual([TABLE_SERVICE, VIEW_BILL, CLOSE_BILL]);
        expect(rendered[2].name).toBe('Close Bill');
        expect(unresolvedCount(rendered)).toBe(2);
    });

    it('finds a projection entry BY ID when the order does not line up', () => {
        const rendered = renderRolePermissions({
            actions: [VIEW_BILL, TABLE_SERVICE],
            permissions: [
                { id: TABLE_SERVICE, action_name: 'Table Occupied', action_desc: null, group: null },
                { id: VIEW_BILL, action_name: 'View Bill', action_desc: null, group: null },
            ],
        }, NO_CATALOGUE);
        expect(rendered.map((r) => r.name)).toEqual(['View Bill', 'Table Occupied']);
    });

    it('drops nothing when there is neither a projection nor a catalogue', () => {
        const rendered = renderRolePermissions({ actions: [TABLE_SERVICE, VIEW_BILL] }, null);
        expect(rendered).toHaveLength(2);
        expect(rendered.every((r) => !r.resolved)).toBe(true);
        expect(rendered.map((r) => r.id)).toEqual([TABLE_SERVICE, VIEW_BILL]);
    });

    it('summarises without understating the grant', () => {
        const summary = permissionSummary(renderRolePermissions(customRole(), NO_CATALOGUE));
        expect(summary).toBe(`Close Bill, ${UNKNOWN_PERMISSION_LABEL} (${ORPHAN})`);
    });
});

describe('the admin wildcard reads as something', () => {
    it('is named by the server\'s own projection', () => {
        const rendered = renderRolePermissions({
            actions: ['*'],
            permissions: [{ id: '*', action_name: 'All actions', action_desc: 'Every permission in the system, including any added later', group: null }],
        }, NO_CATALOGUE);
        expect(rendered[0].name).toBe('All actions');
        expect(rendered[0].resolved).toBe(true);
    });

    it('is named even with no projection and no catalogue at all', () => {
        // Otherwise the admin core role renders as one unresolved uuid, which is
        // the least useful possible answer to "what does admin grant".
        const rendered = renderRolePermissions({ actions: ['*'] }, null);
        expect(rendered[0].name).toBe('All actions');
        expect(rendered[0].resolved).toBe(true);
    });
});

describe('the catalogue fallback — an older backend must not render every role empty', () => {
    it('joins against /actions ONLY when the server sent no projection', () => {
        const rendered = renderRolePermissions({ actions: [TABLE_SERVICE] }, {
            [TABLE_SERVICE]: { name: 'Table Occupied', desc: 'Seat and release', group: 'Tables' },
        });
        expect(rendered[0]).toEqual({
            id: TABLE_SERVICE,
            name: 'Table Occupied',
            desc: 'Seat and release',
            group: 'Tables',
            resolved: true,
        });
    });

    it('tells an ABSENT projection apart from an EMPTY one', () => {
        // null = "this backend predates C6, fall back"; [] = "this role grants
        // nothing". Conflating them renders every role on an older server empty.
        expect(readRolePermissions(undefined)).toBeNull();
        expect(readRolePermissions(null)).toBeNull();
        expect(readRolePermissions('nope')).toBeNull();
        expect(readRolePermissions([])).toEqual([]);
    });

    it('ignores projection entries that are not the contract', () => {
        expect(readRolePermissions([{ id: CLOSE_BILL, action_name: 'Close Bill' }, 'junk', null, { action_name: 'no id' }]))
            .toEqual([{ id: CLOSE_BILL, action_name: 'Close Bill', action_desc: null, group: null }]);
    });
});

describe('the id list and the editable flag', () => {
    it('reads a core role\'s `actions` and a custom role\'s `actions_performable`', () => {
        expect(roleActionIds(coreRole())).toEqual([TABLE_SERVICE, VIEW_BILL]);
        expect(roleActionIds(customRole())).toEqual([CLOSE_BILL, ORPHAN]);
    });

    it('falls back to the projection when neither id list is present', () => {
        expect(roleActionIds({ permissions: [{ id: CLOSE_BILL, action_name: 'Close Bill' }] })).toEqual([CLOSE_BILL]);
        expect(roleActionIds({})).toEqual([]);
        expect(roleActionIds(null)).toEqual([]);
    });

    it('takes `editable` from the SERVER rather than matching role names', () => {
        // Re-deriving "is this a core role" by matching strings is the same
        // spelling-versus-authority mistake that un-scoped a waiter in
        // production.
        expect(roleIsEditable(coreRole())).toBe(false);
        expect(roleIsEditable(customRole())).toBe(true);
    });

    it('answers undefined on a backend that does not send it, so the caller keeps its old rule', () => {
        expect(roleIsEditable({ actions: [] })).toBeUndefined();
        expect(roleIsEditable(null)).toBeUndefined();
    });
});
