// What these tests are actually protecting.
//
// D3 ("move a session from one table to another") and D4 ("move a specific KOT
// or order to the correct table") are both fully implemented, atomic and tested
// on the server. What the dashboard adds is the INTERACTION — which destinations
// are offered, and what staff are told happened — and both of those are quietly
// easy to get wrong:
//
//   * OFFERING THE WRONG DESTINATIONS. A party move must offer only FREE tables
//     that SEAT THE COVERS: the server refuses an occupied destination by name
//     (it answers 400 and the message says use Merge) and refuses one too small,
//     and teaching capacity through a refusal is worse than not offering the
//     table. An ORDER move is the opposite — it must offer EVERY other table,
//     occupied included, because a mis-keyed ticket nearly always belongs to a
//     table that already has guests on it.
//
//   * REPORTING A PRINT THAT DID NOT HAPPEN, or failing to report one that did.
//     `printed: false` is NOT a failure — it means the kitchen never had a
//     docket for this order, so there is nothing on the pass to correct. Telling
//     staff "KOT-26 is printing" when nothing printed sends somebody to look for
//     paper that does not exist; saying nothing when a correction IS coming out
//     leaves the pass holding two tickets for two tables.
//
// The permission gating lives in `session-scope.ts` and is covered by its own
// suite; the calls themselves are `db.ts`'s, and the server's transactions are
// pinned in the backend's tests. This is the half in between.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    TABLE_MOVE_EVENTS,
    isTableMoveEvent,
    kotTicketLabel,
    movedOrderSentence,
    movedPartySentence,
    orderMoveDestinations,
    partyMoveDestinations,
    refreshAfterTableMove,
    type MoveCandidateTable,
} from '../table-move';

const table = (name: string, capacity: number, maxCapacity = capacity): MoveCandidateTable =>
    ({ name, capacity, max_capacity: maxCapacity });

const FLOOR: MoveCandidateTable[] = [
    table('T1', 2, 2),
    table('T2', 4, 6),
    table('T3', 4, 4),
    table('T4', 8, 8),
];

/** T3 has guests on it. */
const seated = (name: string): boolean => name === 'T3';

describe('partyMoveDestinations — free tables that fit, and nothing else', () => {
    it('offers the free tables big enough for the covers', () => {
        expect(partyMoveDestinations(FLOOR, seated, 'T1', 4).map((t) => t.name)).toEqual(['T2', 'T4']);
    });

    it('never offers the table the party is already on', () => {
        expect(partyMoveDestinations(FLOOR, seated, 'T2', 2).map((t) => t.name)).not.toContain('T2');
    });

    it('matches the source table case-insensitively — names come from a free-text field', () => {
        expect(partyMoveDestinations(FLOOR, seated, 't2', 2).map((t) => t.name)).not.toContain('T2');
    });

    it('never offers an OCCUPIED table — that is what Merge is for, and the server says so', () => {
        // A move keeps one party on one bill; a merge puts two parties on one.
        // The difference is money, so the two acts are not interchangeable and
        // the destination list must not blur them.
        expect(partyMoveDestinations(FLOOR, seated, 'T1', 4).map((t) => t.name)).not.toContain('T3');
    });

    it('measures against max_capacity, which is the SERVER\'s own capacity test', () => {
        // T2 is laid up for 4 and takes 6 with chairs pulled up. Filtering on
        // `capacity` would hide the ordinary way a busy floor absorbs a move,
        // and would disagree with assertCoversFitTable on the route.
        expect(partyMoveDestinations(FLOOR, seated, 'T1', 6).map((t) => t.name)).toEqual(['T2', 'T4']);
        expect(partyMoveDestinations(FLOOR, seated, 'T1', 7).map((t) => t.name)).toEqual(['T4']);
    });

    it('offers nothing when nothing fits, rather than offering a table that would be refused', () => {
        expect(partyMoveDestinations(FLOOR, seated, 'T1', 12)).toEqual([]);
    });

    it('treats a missing or nonsense cover count as one guest', () => {
        // A party of "0" is not a reason to hide the whole floor from the person
        // trying to move them.
        expect(partyMoveDestinations(FLOOR, seated, 'T1', 0).map((t) => t.name)).toEqual(['T2', 'T4']);
        expect(partyMoveDestinations(FLOOR, seated, 'T1', Number.NaN).map((t) => t.name)).toEqual(['T2', 'T4']);
    });
});

describe('orderMoveDestinations — every other table, seated included', () => {
    it('offers occupied tables, because that is usually where the food was meant to go', () => {
        expect(orderMoveDestinations(FLOOR, 'T1').map((t) => t.name)).toEqual(['T2', 'T3', 'T4']);
    });

    it('does not test capacity — nobody is being seated, only a ticket moves', () => {
        const tiny = [table('T1', 2), table('T9', 1)];
        expect(orderMoveDestinations(tiny, 'T1').map((t) => t.name)).toEqual(['T9']);
    });

    it('still never offers the source table', () => {
        expect(orderMoveDestinations(FLOOR, 'T4').map((t) => t.name)).not.toContain('T4');
    });
});

describe('kotTicketLabel — the handle the pass quotes, or nothing', () => {
    it('names one ticket and several', () => {
        expect(kotTicketLabel([214])).toBe('KOT 214');
        expect(kotTicketLabel([214, 218])).toBe('KOTs 214, 218');
    });

    it('collapses the duplicates a fanned-out docket produces', () => {
        // One docket sent to three stations enqueues three print jobs under ONE
        // allocated number. "KOTs 214, 214" has the kitchen hunting for a second
        // ticket that was never fired.
        expect(kotTicketLabel([214, 214, 214])).toBe('KOT 214');
    });

    it('drops values that cannot be a KOT number', () => {
        // KOT numbers are 1-based and gapless, so "KOT 0" can only be corruption.
        expect(kotTicketLabel([0, -3, 'x', null, 7])).toBe('KOT 7');
    });

    it('answers "" — the signal to draw NOTHING — when the backend numbered nothing', () => {
        // Never a placeholder. A chip reading "KOT —" sends somebody looking for
        // a docket that does not exist.
        expect(kotTicketLabel([])).toBe('');
        expect(kotTicketLabel(undefined)).toBe('');
        expect(kotTicketLabel(null)).toBe('');
        expect(kotTicketLabel('214')).toBe('');
    });

    it('survives a backend that sends its numbers as strings', () => {
        // Read as unknown on purpose: a board rendering "KOT NaN" because one
        // tenant's payload is typed differently is worse than one rendering
        // nothing.
        expect(kotTicketLabel(['214', 218])).toBe('KOTs 214, 218');
    });
});

describe('the sentences staff are given afterwards', () => {
    it('says which correction docket is coming out, so the pass can be told', () => {
        expect(movedOrderSentence('T7', { printed: true, kot_no: 26 }))
            .toBe('Moved to T7. Correction docket KOT-26 is printing — tell the pass.');
    });

    it('says plainly that NOTHING printed, which is not a failure', () => {
        // The kitchen never had a ticket for this order, so there is no paper to
        // correct; the ordinary trigger prints it at the right table later.
        expect(movedOrderSentence('T7', { printed: false, kot_no: null }))
            .toBe('Moved to T7. Nothing was on the pass for it, so no docket printed.');
        expect(movedOrderSentence('T7', null))
            .toBe('Moved to T7. Nothing was on the pass for it, so no docket printed.');
    });

    it('does not invent a KOT number it was not given', () => {
        expect(movedOrderSentence('T7', { printed: true })).toBe('Moved to T7. A correction docket is printing — tell the pass.');
    });

    it('counts the orders that travelled with the party, singular and plural', () => {
        expect(movedPartySentence('T1', 'T7', 1)).toBe('Moved T1 to T7 — 1 order came with them.');
        expect(movedPartySentence('T1', 'T7', 3)).toBe('Moved T1 to T7 — 3 orders came with them.');
        expect(movedPartySentence('T1', 'T7', 0)).toBe('Moved T1 to T7 — 0 orders came with them.');
    });
});

// THE STALE CLOCK AFTER A MOVE. The D1/D2 badges are reduced from the ORDERS
// feed grouped by each ticket's table, not from the table grid, and the move
// handlers used to re-read only the grid — so a moved party's clock stayed filed
// under the table it had left until the next poll or a reload.
describe('after a move, the clocks are re-read along with the grid', () => {
    it('reloads BOTH feeds, not the grid alone', async () => {
        const calls: string[] = [];
        await refreshAfterTableMove({
            tables: () => { calls.push('tables'); return Promise.resolve(); },
            orders: () => { calls.push('orders'); return Promise.resolve(); },
        });
        expect(calls.sort()).toEqual(['orders', 'tables']);
    });

    it('recognises the server\'s two move events and nothing else', () => {
        // The exact names routes/tables.ts emits for POST /tables/move and
        // POST /tables/move-order.
        expect([...TABLE_MOVE_EVENTS].sort()).toEqual(['table:moved', 'table:order_moved']);
        expect(isTableMoveEvent('table:moved')).toBe(true);
        expect(isTableMoveEvent('table:order_moved')).toBe(true);
        expect(isTableMoveEvent('table:updated')).toBe(false);
        expect(isTableMoveEvent(undefined)).toBe(false);
    });

    // Fixed paths under src/, named in this file — not user input.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const src = (rel: string): string => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

    it('both move handlers on the tables page use it — a grid-only reload is the bug', () => {
        const page = src('app/dashboard/tables/page.tsx');
        const handler = (name: string): string => {
            const start = page.indexOf(`const ${name} = async`);
            expect(start).toBeGreaterThan(-1);
            return page.slice(start, page.indexOf('\n    };', start));
        };
        for (const name of ['handleMoveParty', 'handleMoveOrder']) {
            const body = handler(name);
            expect([name, body.includes('refreshAfterTableMove({ tables: loadTables, orders: reloadOrders })')]).toEqual([name, true]);
            expect([name, body.includes('await loadTables();')]).toEqual([name, false]);
        }
        // …and a move made on another device reaches the same refresh.
        expect(page).toMatch(/isTableMoveEvent\(/);
    });

    it('the realtime bridge actually forwards the move events to the page', () => {
        const ctx = src('context/RealtimeContext.tsx');
        for (const event of TABLE_MOVE_EVENTS) {
            expect([event, ctx.includes(`"${event}"`)]).toEqual([event, true]);
        }
    });
});
