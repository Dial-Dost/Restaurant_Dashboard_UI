// D3 / D4 — MOVING A LIVE PARTY, AND MOVING ONE MIS-KEYED TICKET.
//
// V3, verbatim:
//   D3 "Table Transfers: Add functionality allowing staff to move a session from
//       one table to another."
//   D4 "KOT Reassignment: Allow staff to move a specific KOT or order to the
//       correct table if it was initially assigned to the wrong one."
//
// ============================================================================
// THE SERVER ALREADY DOES BOTH. THIS IS THE HALF THAT WAS MISSING.
// ============================================================================
// POST /tables/move and POST /tables/move-order are shipped, atomic,
// permission-gated and tested (routes/tables.ts, MoveTableParty /
// MoveOrderToTable). The dashboard simply had no way to reach them — which is
// the same pattern that has now bitten this project several times: a field or a
// route is added, deployed, and consumed by nobody. A route nobody can reach is
// not a feature; it is a claim.
//
// ============================================================================
// WHAT LIVES HERE, AND WHY IT IS NOT IN THE PAGE
// ============================================================================
// The two decisions that are easy to get subtly wrong and impossible to notice:
// WHICH TABLES MAY BE OFFERED, and WHAT THE RESULT SAYS HAPPENED. Both are pure,
// both are pinned by `__tests__/table-move.test.ts`, and neither needs a browser.
//
// THE DESTINATION LIST IS NOT DECORATION — IT IS THE INTERACTION DESIGN. The
// Flutter app offers a party move only FREE tables that SEAT THE COVERS, and its
// comment says why: the server enforces both (an occupied destination answers
// 400 naming Merge, and assertCoversFitTable is the same rule seating uses), but
// offering a destination and then explaining the refusal is a worse way to teach
// capacity than not offering it. An ORDER move, by contrast, offers EVERY other
// table including occupied ones — moving a mis-keyed ticket onto a table that
// already has guests is the commonest case there is, because that is usually
// where the food was actually meant to go.
//
// PURE — no React, no fetch — for the reason `session-scope.ts` gives at length.

/** The fields of a table these rules read. Everything else is ignored. */
export interface MoveCandidateTable {
    name: string;
    /** The laid-up cover count. */
    capacity: number;
    /** The most it takes with chairs pulled up; the server's own capacity test. */
    max_capacity: number;
}

/**
 * Where may this party go?
 *
 * FREE TABLES THAT FIT, and nothing else — see the header. `isSeated` is passed
 * in rather than derived from a field on the row because the two screens that
 * ask this already hold the occupancy map (`useFloorTables`), and re-deriving
 * "occupied" from a second source is how one screen ends up offering a table the
 * other shows as full.
 *
 * CAPACITY IS `max_capacity`, NOT `capacity`. That is the server's own test
 * (assertCoversFitTable, the same one seating uses), and using the laid-up count
 * here would hide every table that a party fits into with an extra chair — the
 * ordinary way a busy floor absorbs a move.
 *
 * The source table can never be its own destination, and the comparison is
 * case-insensitive because table names arrive from a free-text field and
 * "t4"/"T4" are one table to everyone except a string equality test.
 */
export const partyMoveDestinations = (
    tables: readonly MoveCandidateTable[],
    isSeated: (tableName: string) => boolean,
    fromTable: string,
    covers: number,
): MoveCandidateTable[] => {
    const source = (fromTable || '').trim().toLowerCase();
    const needed = Number.isFinite(covers) && covers > 0 ? Math.ceil(covers) : 1;
    return tables.filter((table) => {
        const name = (table.name || '').trim();
        if (name === '' || name.toLowerCase() === source) { return false; }
        if (isSeated(name)) { return false; }
        const seats = Math.max(table.max_capacity || 0, table.capacity || 0);
        return seats >= needed;
    });
};

/**
 * Where may this ORDER go?
 *
 * EVERY OTHER TABLE, seated or not. This is the mis-key correction: the ticket
 * was rung in on the wrong table and the right one usually has guests on it
 * already. Filtering to free tables here would hide the destination the
 * correction is nearly always for — and the party at the SOURCE table stays
 * seated either way, because only the ticket moves (MoveOrderToTable).
 *
 * Capacity is deliberately NOT tested: nobody is being seated, so there is
 * nothing for a cover count to be measured against.
 */
export const orderMoveDestinations = (
    tables: readonly MoveCandidateTable[],
    fromTable: string,
): MoveCandidateTable[] => {
    const source = (fromTable || '').trim().toLowerCase();
    return tables.filter((table) => {
        const name = (table.name || '').trim();
        return name !== '' && name.toLowerCase() !== source;
    });
};

/**
 * "KOT 214" / "KOTs 214, 218" — the handle staff quote at the pass, or "" when
 * the backend numbered nothing.
 *
 * "" IS THE SIGNAL TO DRAW NOTHING, never a placeholder: a chip reading "KOT —"
 * sends somebody looking for a docket that does not exist. Duplicates collapse
 * because one docket fanned out to several stations enqueues several print jobs
 * under ONE allocated number, and "KOTs 214, 214" would have the kitchen hunting
 * for a second ticket that was never fired. Non-positive and unparseable values
 * are dropped: KOT numbers are 1-based and gapless, so "KOT 0" can only be
 * corruption.
 *
 * Read as `unknown` on purpose — this comes off the wire from a server this app
 * may be running ahead of, and a board rendering "KOT NaN" because one tenant
 * sent strings is worse than one rendering nothing. Same rule as the orders
 * page's own `kotLabel`; it lives here so the tables page can ask it without
 * importing a 4,000-line client module to borrow twenty lines.
 */
export const kotTicketLabel = (kotNos: unknown): string => {
    if (!Array.isArray(kotNos)) { return ''; }
    const seen = new Set<number>();
    const nos: string[] = [];
    for (const entry of kotNos as unknown[]) {
        const parsed = Number(entry);
        if (!Number.isFinite(parsed) || parsed <= 0) { continue; }
        const value = Math.round(parsed);
        if (seen.has(value)) { continue; }
        seen.add(value);
        nos.push(String(value));
    }
    if (nos.length === 0) { return ''; }
    return `${nos.length === 1 ? 'KOT' : 'KOTs'} ${nos.join(', ')}`;
};

/**
 * WHAT THE PASS NEEDS TO BE TOLD after an order moved, from the server's own
 * `print` block.
 *
 * `printed: false` IS NOT A FAILURE and must not read as one. It means the
 * kitchen never had a docket for this order, so there is no paper on the pass to
 * correct and nothing printed; the ordinary trigger will print it at the right
 * table when it fires. `printed: true` means a correction carrying the SAME KOT
 * number is coming out now, and whoever pressed the button has to go and say so
 * — which is the entire reason the backend puts the outcome in the response
 * instead of leaving staff to guess.
 */
export const movedOrderSentence = (
    toTable: string,
    print: { printed?: boolean; kot_no?: number | string | null } | null | undefined,
): string => {
    const printed = print?.printed === true;
    const kotNo = print?.kot_no;
    const handle = kotNo === null || kotNo === undefined || String(kotNo).trim() === ''
        ? 'A correction docket'
        : `Correction docket KOT-${String(kotNo).trim()}`;
    return printed
        ? `Moved to ${toTable}. ${handle} is printing — tell the pass.`
        : `Moved to ${toTable}. Nothing was on the pass for it, so no docket printed.`;
};

/** "3 orders came with them" / "1 order came with them" — plural handled once. */
export const movedPartySentence = (
    fromTable: string,
    toTable: string,
    movedOrders: number,
): string => {
    const n = Number.isFinite(movedOrders) && movedOrders > 0 ? Math.round(movedOrders) : 0;
    return `Moved ${fromTable} to ${toTable} — ${String(n)} order${n === 1 ? '' : 's'} came with them.`;
};
