// CLIENT ITEM 3 — "More than the covers defined on the table, the KOT won't get
// punched."
//
// The pad seats the table and THEN sends the order (order-pad.tsx `send`, and
// deliberately in that order: the TableSessions row the whole of APC hangs off
// is written on the free -> occupied transition, so an order that arrives before
// the seating is attributed to the previous party or to none). Six people at a
// two-top made step one answer
//
//     400 "T1 seats up to 2. To seat 6, raise this table's max seats …"
//
// which threw out of `occupyForOrder`, skipped `postDineInOrder` entirely and
// left the waiter looking at a KOT that would not punch. The server now seats
// them and hands back `covers_warning`; what is left for the dashboard is to
// SAY it without ever putting it in front of the order again.
//
// What these tests hold:
//   * `coversWarning` reads only a real sentence, and is null on every shape an
//     older backend or a queued write can produce — a UI that toasts "null" or
//     "undefined" at a waiter mid-service is its own bug;
//   * the pad shows it AFTER the order lands, never as an early return;
//   * the table sheet shows it on both the seating and the covers correction,
//     and neither one treats it as a failure.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { coversWarning } from '../api/order-entry';

// Fixed paths under src/, named in this file — not user input.

const src = (rel: string): string => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

describe('coversWarning — the sentence the server sends back, or nothing', () => {
    it('reads the warning off an over-capacity seating', () => {
        expect(coversWarning({ table_id: 't', num_covers: 6, covers_warning: 'T1 is set for 2, and 6 covers have been recorded.' }))
            .toBe('T1 is set for 2, and 6 covers have been recorded.');
    });

    it('is null when the party fits — the server sends covers_warning: null', () => {
        expect(coversWarning({ table_id: 't', num_covers: 2, covers_warning: null })).toBeNull();
    });

    it('is null on an older backend that has never heard of the field', () => {
        expect(coversWarning({ table_id: 't', num_covers: 2 })).toBeNull();
    });

    it('is null on the shapes a queued or failed write leaves behind', () => {
        expect(coversWarning(null)).toBeNull();
        expect(coversWarning(undefined)).toBeNull();
        expect(coversWarning({})).toBeNull();
        expect(coversWarning('T1 is full')).toBeNull();
    });

    it('is null on a blank sentence — an empty toast is worse than none', () => {
        expect(coversWarning({ covers_warning: '   ' })).toBeNull();
    });
});

describe('the order pad still sends the order, and says the rest afterwards', () => {
    const pad = src('components/order-pad/order-pad.tsx');
    const send = pad.slice(pad.indexOf('const send = async'), pad.indexOf('const takeItOnNextParty'));

    it('reads the warning off the seating instead of letting it throw the send away', () => {
        expect(send).toContain('coversWarning(occ.data)');
    });

    it('REGRESSION: the seating never returns early on covers — the order call follows it', () => {
        const occupyAt = send.indexOf('await occupyForOrder(');
        const orderAt = send.indexOf('await postDineInOrder(');
        expect(occupyAt).toBeGreaterThan(-1);
        expect(orderAt).toBeGreaterThan(occupyAt);
        // Nothing between the two may bail out on the head count.
        expect(send.slice(occupyAt, orderAt)).not.toMatch(/\breturn\b/);
    });

    it('the warning is toasted after the order outcome, not in place of it', () => {
        const toastAt = send.indexOf('coversNote !== null');
        expect(toastAt).toBeGreaterThan(send.indexOf('await postDineInOrder('));
    });
});

describe('the table sheet says it on both covers paths', () => {
    const sheet = src('components/tables/table-sheet.tsx');
    const handler = (name: string): string => {
        const start = sheet.indexOf(`const ${name} = async`);
        expect(start).toBeGreaterThan(-1);
        return sheet.slice(start, sheet.indexOf('\n    };', start));
    };

    it('an over-capacity seating is reported and STILL flows into order entry', () => {
        const body = handler('seatGuests');
        const warned = body.indexOf('res.covers_warning');
        const toOrders = body.indexOf('openOrders({ seated: true })');
        expect(warned).toBeGreaterThan(-1);
        // The warning is said on the success path and the pad opens behind it —
        // it is a note about the table, never a reason not to take the order.
        expect(toOrders).toBeGreaterThan(warned);
        expect(body.slice(warned, toOrders)).not.toContain('failToast');
    });

    it('a covers correction past the max is accepted and reported', () => {
        const body = handler('updateCovers');
        expect(body).toContain('await updateTableCovers(');
        expect(body).toContain('res.covers_warning');
    });
});

describe('the seating rules that were never the problem are untouched', () => {
    it('a party MOVE still only offers destinations that fit — see table-move.test.ts', () => {
        // Item 3 is about the kitchen. A move has another table to choose, so
        // its capacity filter stays exactly as it was; this pins that the filter
        // is still there and still reads max_capacity.
        expect(src('lib/table-move.ts')).toMatch(/max_capacity/);
    });
});
