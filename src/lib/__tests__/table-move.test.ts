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
    moveDishLine,
    moveDishSummary,
    moveOrderKitchenHas,
    moveOrderKitchenSentence,
    moveOrderNotice,
    moveOrderTitle,
    moveReprints,
    movedAwayLine,
    movedDishesOf,
    movedFromLabel,
    movedOrderSentence,
    movedPartySentence,
    orderDishLines,
    orderMoveDestinations,
    partyMoveDestinations,
    printedPartyMoveNote,
    refreshAfterTableMove,
    sameTableFamily,
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

// CLIENT ITEM 4 (2026-09-17) — "no item names visible when an order is moved".
// The dialog named an order "KOT 65" or "Order 5a4099ef-…", the toast named no
// food. PARITY: every sentence below is pinned character for character in the
// owner app's test/order_moves_test.dart too.
const KOT65 = {
    kot_nos: [65],
    items: [
        { name: 'KUNAFA BIRDS NEST', price: 489, quantity: 1 },
        { name: 'STIR FRIED WATERCHESTNUT', price: 419, quantity: 1 },
        { name: 'TRUFFLE CREAM CHEESE', price: 519, quantity: 1 },
        { name: 'Dal', variation: 'Half', price: 200, quantity: 2 },
    ],
};

describe("client item 4 — the dishes, by name, in the app's words", () => {
    it('one dish: quantity × name (size), never a price', () => {
        expect(moveDishLine({ name: 'Dal', variation: 'Half', quantity: 2 })).toBe('2 × Dal (Half)');
        expect(moveDishLine({ name: 'Dal', variation_name: 'Full', quantity: '3' })).toBe('3 × Dal (Full)');
        expect(moveDishLine({ item_name: 'Lassi', qty: 2 })).toBe('2 × Lassi');
        expect(moveDishLine({ quantity: 0 })).toBe('1 × Item');
        expect(moveDishLine({ name: 'Chai', variation: null, quantity: 1.6 })).toBe('2 × Chai');
        expect(moveDishLine({ name: 'null', quantity: null })).toBe('1 × Item');
    });

    it("an order's dishes, and the summary that names three and counts the rest", () => {
        const lines = orderDishLines(KOT65);
        expect(lines).toEqual(['1 × KUNAFA BIRDS NEST', '1 × STIR FRIED WATERCHESTNUT', '1 × TRUFFLE CREAM CHEESE', '2 × Dal (Half)']);
        expect(moveDishSummary(lines)).toBe('1 × KUNAFA BIRDS NEST, 1 × STIR FRIED WATERCHESTNUT, 1 × TRUFFLE CREAM CHEESE +1 more');
        expect(moveDishSummary(lines, null)).toBe(lines.join(', '));
        expect(moveDishSummary([])).toBe('');
        expect(orderDishLines({ items: 'nope' })).toEqual([]);
        expect(orderDishLines(null)).toEqual([]);
        expect(lines.join(' ')).not.toMatch(/489|₹/);
    });

    it("the ticket's handle is its KOT, or \"No KOT number\" — never the order id", () => {
        expect(moveOrderTitle(KOT65)).toBe('KOT 65');
        expect(moveOrderTitle({ kot_nos: [65, '66', 65, 0, -2, 'x'] })).toBe('KOTs 65, 66');
        expect(moveOrderTitle({ kot_nos: null })).toBe('No KOT number');
        expect(moveOrderTitle({})).toBe('No KOT number');
    });

    it('where a ticket came from, and what a dish move took off one', () => {
        expect(movedFromLabel({ moved_from: '12' })).toBe('from 12');
        expect(movedFromLabel({ moved_from: ' ' })).toBeNull();
        expect(movedFromLabel({})).toBeNull();
        expect(movedAwayLine({})).toBeNull();
        expect(movedAwayLine({ moved_items: [] })).toBeNull();
        expect(movedAwayLine({ moved_items: [{ name: 'NOT YOUR PUCHKA', quantity: 1, to_table: '31' }] }))
            .toBe('Moved to 31: 1 × NOT YOUR PUCHKA');
        expect(movedAwayLine({
            moved_items: [
                { name: 'A', quantity: 1, to_table: '31' },
                { name: 'B', variation: 'Half', quantity: 2, to_table: '32' },
                { name: 'C', quantity: 1, to_table: '31' },
                { name: 'D', quantity: 1 },
            ],
        })).toBe('Moved to 31: 1 × A, 1 × C; to 32: 2 × B (Half); to another table: 1 × D');
    });

    // REVIEW FINDING — production barks almost no printed ticket (GGV: 79 of 80
    // in a fortnight). The same cases are pinned in the owner app's
    // test/order_moves_test.dart, so both clients say the same thing about
    // KOT-65 before it moves.
    it('the kitchen has a ticket when it carries a KOT number OR a bark — one rule on both clients', () => {
        expect(moveOrderKitchenHas({ kot_nos: [65], barked_at: null })).toBe(true);
        expect(moveOrderKitchenHas({ kot_nos: [], barked_at: '2026-09-14T10:57:16Z' })).toBe(true);
        expect(moveOrderKitchenHas({ kot_nos: [65], barked_at: '2026-09-14T10:57:16Z' })).toBe(true);
        expect(moveOrderKitchenHas({ kot_nos: [], barked_at: null })).toBe(false);
        expect(moveOrderKitchenHas({ kot_nos: [0, -1, 'x'], barked_at: null })).toBe(false);
        expect(moveOrderKitchenHas({ barked_at: null })).toBe(false);
        // A backend older than both fields: read as barked, as the orders page reads it.
        expect(moveOrderKitchenHas({})).toBe(true);
        // KOT-65 unbarked: the sentence says a correction prints, which is what the server does.
        expect(moveOrderKitchenSentence('12', '15', moveOrderKitchenHas({ kot_nos: [65], barked_at: null })))
            .toMatch(/^The kitchen already has a docket for 12, so a correction docket prints for 15/);
    });

    it('the kitchen sentence, said before the move', () => {
        expect(moveOrderKitchenSentence('12', 'the new table', true))
            .toBe('The kitchen already has a docket for 12, so a correction docket prints for the new table with the same KOT number. 12 keeps its guests and its other orders.');
        expect(moveOrderKitchenSentence('12', '15', false))
            .toBe('The kitchen has not been sent this order yet, so nothing prints now — it will print for 15 when it is sent.');
    });

    it('the result names the dishes and the correction docket', () => {
        expect(movedOrderSentence('15', { printed: true, kot_no: 65 }, orderDishLines(KOT65)))
            .toBe('Moved to 15: 1 × KUNAFA BIRDS NEST, 1 × STIR FRIED WATERCHESTNUT, 1 × TRUFFLE CREAM CHEESE +1 more. Correction docket KOT-65 is printing — tell the pass.');
        expect(movedOrderSentence('15', { printed: false }, ['2 × Dal']))
            .toBe('Moved to 15: 2 × Dal. Nothing was on the pass for it, so no docket printed.');
        expect(movedDishesOf({ items: [{ name: 'Dal', variation: 'Half', quantity: 2 }, 'junk'] })).toEqual(['2 × Dal (Half)']);
        expect(movedDishesOf({ items: 'nope' })).toEqual([]);
        expect(movedDishesOf(null)).toEqual([]);
    });

    it('ONE notice carries the move and every reprint — the toast store keeps only one toast', () => {
        const both = {
            to_table: '15',
            items: [{ name: 'KUNAFA BIRDS NEST', quantity: 1 }],
            print: { printed: true, kot_no: 65 },
            reprint_needed: true, reprint_table: '15', reprint_message: "15's bill was already printed.",
            also_reprint_needed: true, also_reprint_table: '12', also_reprint_message: "12's bill was already printed.",
        };
        expect(moveOrderNotice(both, 'ignored', ['2 × Dal'])).toEqual({
            title: 'Order moved — reprint the bill',
            sentence: 'Moved to 15: 1 × KUNAFA BIRDS NEST. Correction docket KOT-65 is printing — tell the pass.',
            reprints: [
                { table: '15', message: "15's bill was already printed." },
                { table: '12', message: "12's bill was already printed." },
            ],
        });
        // No reprint: the plain title; the page's own table name and dishes when the server sent none.
        expect(moveOrderNotice({ print: { printed: false } }, '15', ['2 × Dal'])).toEqual({
            title: 'Order moved',
            sentence: 'Moved to 15: 2 × Dal. Nothing was on the pass for it, so no docket printed.',
            reprints: [],
        });
        expect(moveOrderNotice(null, '15').sentence).toBe('Moved to 15. Nothing was on the pass for it, so no docket printed.');
    });

    it('a move can ask for two reprints — the destination first', () => {
        expect(moveReprints({
            reprint_needed: true, reprint_table: '15', reprint_message: 'fifteen',
            also_reprint_needed: true, also_reprint_table: '12', also_reprint_message: 'twelve',
        })).toEqual([{ table: '15', message: 'fifteen' }, { table: '12', message: 'twelve' }]);
        expect(moveReprints({ reprint_needed: true, reprint_table: '15', reprint_message: 'x' })).toHaveLength(1);
        expect(moveReprints({ also_reprint_needed: false })).toEqual([]);
        expect(moveReprints(null)).toEqual([]);
        expect(moveReprints([])).toEqual([]);
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

    it('client item 4 — the move dialog, its toast and both previews name the dishes (the wiring)', () => {
        const page = src('app/dashboard/tables/page.tsx');
        expect(page).not.toMatch(/`Order \$\{order\.id\}`/);
        expect(page).toMatch(/moveOrderTitle\(order\)/);
        expect(page).toMatch(/const dishes = orderDishLines\(order\);/);
        expect(page).toMatch(/const notice = moveOrderNotice\(result, toTable, orderDishLines\(moved\)\);/);
        expect(page).toMatch(/description: <MoveOrderNoticeBody notice=\{notice\} \/>/);
        expect(page).toMatch(/\{notice\.reprints\.map\(\(reprint\) => \(\s*<ToastAction/);
        // The dialog's kitchen sentence reads the shared rule, not the bark alone.
        expect(page).toMatch(/moveOrderKitchenSentence\(table\.name, destination \|\| "the new table", kitchenHas\)/);
        expect(page).toMatch(/const kitchenHas = moveOrderKitchenHas\(order\);/);
        expect(page).toMatch(/\["Cancelled", "Closed", "Paid", "Payment Pending Approval"\]\.includes\(order\.status\)/);
        const preview = src('app/dashboard/orders/table-kot-preview.tsx');
        expect(preview).toMatch(/\[block\.label, placed, order \? movedFromLabel\(order\) : null\]/);
        const orders = src('app/dashboard/orders/page.tsx');
        expect(orders).toMatch(/movedAwayLine\(order\)/);
        expect(orders).toMatch(/Moved from \{order\.moved_from\}/);
        const db = src('lib/db.ts');
        for (const key of ['moved_from', 'moved_at', 'emptied_by', 'moved_items']) {
            expect([key, db.includes(`wire.${key}`)]).toEqual([key, true]);
        }
    });

    it('the realtime bridge actually forwards the move events to the page', () => {
        const ctx = src('context/RealtimeContext.tsx');
        for (const event of TABLE_MOVE_EVENTS) {
            expect([event, ctx.includes(`"${event}"`)]).toEqual([event, true]);
        }
    });
});

// ---------------------------------------------------------------------------
// CLIENT ITEMS 1 AND 2 — a waiter moves tables, printed ones included.
// ---------------------------------------------------------------------------
describe('the family: "12" and its "12 #2" are one table', () => {
    const FAMILY: MoveCandidateTable[] = [
        { name: '12', capacity: 4, max_capacity: 4 },
        { name: '12 #2', capacity: 4, max_capacity: 4, parent_table: '12' },
        { name: '12 #3', capacity: 4, max_capacity: 4, parent_table: '12' },
        { name: '15', capacity: 4, max_capacity: 4 },
        { name: '15 #2', capacity: 4, max_capacity: 4, parent_table: '15' },
        { name: '120', capacity: 4, max_capacity: 4 },
    ];
    const nobodySeated = (): boolean => false;
    const names = (rows: MoveCandidateTable[]): string[] => rows.map((t) => t.name);

    it('moving the printed 12 never offers its own green seats', () => {
        expect(names(partyMoveDestinations(FAMILY, nobodySeated, '12', 2))).toEqual(['15', '15 #2', '120']);
    });

    it('moving the next party at "12 #2" never offers 12 or "12 #3" — the parent is read off the floor when not given', () => {
        expect(names(partyMoveDestinations(FAMILY, nobodySeated, '12 #2', 2))).toEqual(['15', '15 #2', '120']);
        expect(names(partyMoveDestinations(FAMILY, nobodySeated, '12 #2', 2, '12'))).toEqual(['15', '15 #2', '120']);
    });

    it('another family\'s free seat IS a destination, and a name that merely starts with 12 is another table', () => {
        expect(names(partyMoveDestinations(FAMILY, nobodySeated, '15', 2))).toEqual(['12', '12 #2', '12 #3', '120']);
        expect(sameTableFamily({ name: '12' }, { name: '120' })).toBe(false);
    });

    it('sameTableFamily is case-insensitive and needs a name', () => {
        expect(sameTableFamily({ name: 'Patio 4' }, { name: 'Patio 4 #2', parent_table: 'patio 4' })).toBe(true);
        expect(sameTableFamily({ name: '' }, { name: '' })).toBe(false);
    });

    it('the printed party\'s paper still names the table it left — the words the app says', () => {
        expect(printedPartyMoveNote('12', '20'))
            .toBe("The printed bill moves with them. The guest's paper still says 12; the bill will show as 20 (printed as 12).");
    });

    it('the Tables page offers only the other families, warns on a printed party, and says where the green seat is', () => {
        const page = readFileSync(join(__dirname, '..', '..', 'app', 'dashboard', 'tables', 'page.tsx'), 'utf8').replace(/\r\n/g, '\n');
        expect(page).toContain('partyMoveDestinations(allTables, isSeated, sourceName, covers, table?.parent_table ?? null)');
        expect(page).toMatch(/\{sourcePrinted \? \([\s\S]{0,200}?printedPartyMoveNote\(/);
        expect(page).toContain('result.next_party_message ?? ""');
        // Move table is offered on ANY seated tile (orange included) to whoever the server lets move.
        expect(page).toContain('{isOccupied && canMove ? (');
        expect(page).toContain('const mayMoveParty = canMoveTableParty(user);');
    });
});
