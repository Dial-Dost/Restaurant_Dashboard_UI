// What these tests are actually protecting.
//
// 1.8 asks for a table's orders to be shown as "separated, distinct KOTs
// categorized by their respective KOT numbers" instead of one long list. The
// easy ways to get that subtly wrong, each pinned below:
//
//   * FOLDING TWO ORDERS INTO ONE BLOCK. A block is also where 1.3's Cancel KOT
//     sits, and the server cancels ORDERS. One block over two orders is a cancel
//     button that throws away a ticket nobody pointed at.
//   * THE WRONG TABLE, or tickets that are no longer live. Cancelled and closed
//     orders are not part of the party at the table.
//   * THE WRONG ORDER. Oldest first — the order the dockets came off the printer.
//   * A CANCEL KOT OVER SOMETHING THAT IS NOT A TICKET. Orders with no number
//     share one trailing "No KOT number" block, which has no order to cancel —
//     the same shape the owner app draws.
//   * A DROPPED DISH. Every line of every live order lands in exactly one block.
//   * A FABRICATED NUMBER. "KOT 0", "KOT NaN" and "KOTs 5, 5" are all a kitchen
//     hunting for paper that does not exist.

import { NO_KOT_NUMBER_LABEL, groupItemsByKot, kotNumbersOf, type KotGroupItem, type KotGroupOrder } from '../kot-groups';

const line = (name: string, quantity = 1): KotGroupItem => ({ id: `${name}-id`, name, quantity });

const order = (over: Partial<KotGroupOrder> & { id: string }): KotGroupOrder => ({
    table: 'T4',
    status: 'Preparing',
    created_at: '2026-09-13T09:00:00.000Z',
    kot_nos: [],
    items: [line('Masala Chai')],
    ...over,
});

describe('kotNumbersOf', () => {
    it('keeps allocation order, collapses duplicates and drops junk', () => {
        expect(kotNumbersOf([7, 5, 7, '6', 0, -2, 'NaN', null, 5.4])).toEqual([7, 5, 6]);
    });

    it('answers an empty list for anything that is not an array', () => {
        expect(kotNumbersOf(undefined)).toEqual([]);
        expect(kotNumbersOf(null)).toEqual([]);
        expect(kotNumbersOf('5')).toEqual([]);
    });
});

describe('groupItemsByKot — 1.8', () => {
    it('gives every order on the table its own block, labelled by its KOT number', () => {
        const blocks = groupItemsByKot([
            order({ id: 'a', kot_nos: [5], items: [line('Gin & Tonic'), line('Tandoori Roti', 2)] }),
            order({ id: 'b', kot_nos: [6], created_at: '2026-09-13T09:10:00.000Z', items: [line('Subz Tehri')] }),
        ], 'T4');

        expect(blocks.map((b) => b.label)).toEqual(['KOT 5', 'KOT 6']);
        expect(blocks[0].items.map((i) => i.name)).toEqual(['Gin & Tonic', 'Tandoori Roti']);
        expect(blocks[1].items.map((i) => i.name)).toEqual(['Subz Tehri']);
        expect(blocks[0].order?.id).toBe('a');
        expect(blocks[0].placedAt).toBe('2026-09-13T09:00:00.000Z');
    });

    it('orders blocks oldest first, whatever order the feed sent them in', () => {
        const blocks = groupItemsByKot([
            order({ id: 'late', kot_nos: [9], created_at: '2026-09-13T10:30:00.000Z' }),
            order({ id: 'early', kot_nos: [3], created_at: '2026-09-13T08:15:00.000Z' }),
            order({ id: 'middle', kot_nos: [4], created_at: '2026-09-13T09:45:00.000Z' }),
        ]);
        expect(blocks.map((b) => b.key)).toEqual(['early', 'middle', 'late']);
    });

    it('falls back to the lowest KOT number when a row could not be dated, then to feed order', () => {
        const blocks = groupItemsByKot([
            order({ id: 'undated-12', kot_nos: [12], created_at: null }),
            order({ id: 'undated-2', kot_nos: [2], created_at: '' }),
            order({ id: 'undated-2-again', kot_nos: [2], created_at: null }),
        ]);
        expect(blocks.map((b) => b.key)).toEqual(['undated-2', 'undated-2-again', 'undated-12']);
    });

    it('gathers every unnumbered order into ONE trailing "No KOT number" block, with no order to cancel', () => {
        const blocks = groupItemsByKot([
            order({ id: 'later-unsent', kot_nos: [], created_at: '2026-09-13T09:30:00.000Z', items: [line('Jackfruit Biryani')] }),
            order({ id: 'kot-5', kot_nos: [5], created_at: '2026-09-13T09:05:00.000Z', items: [line('Subz Tehri')] }),
            order({ id: 'older-unsent', kot_nos: undefined, created_at: '2026-09-13T09:00:00.000Z', items: [line('Gin & Tonic'), line('Tandoori Roti')] }),
            order({ id: 'kots-7-9', kot_nos: [7, 9], created_at: '2026-09-13T09:10:00.000Z', items: [line('Hara Dhaniya Pulao')] }),
        ]);
        expect(blocks.map((b) => b.label)).toEqual(['KOT 5', 'KOTs 7, 9', NO_KOT_NUMBER_LABEL]);
        const trailing = blocks[2];
        expect(trailing.numbered).toBe(false);
        expect(trailing.order).toBeNull();
        expect(trailing.placedAt).toBeNull();
        expect(trailing.items.map((i) => i.name)).toEqual(['Gin & Tonic', 'Tandoori Roti', 'Jackfruit Biryani']);
        expect(blocks.slice(0, 2).every((b) => b.numbered && b.order !== null)).toBe(true);
    });

    it('does not split at all on a tenant that sends no numbers — one trailing block', () => {
        const blocks = groupItemsByKot([order({ id: 'a' }), order({ id: 'b', kot_nos: null })]);
        expect(blocks.map((b) => b.label)).toEqual([NO_KOT_NUMBER_LABEL]);
        expect(blocks[0].items).toHaveLength(2);
    });

    it('never drops a dish: every line of every live order is in exactly one block', () => {
        const feed = [
            order({ id: 'a', kot_nos: [1], items: [line('A1'), line('A2')] }),
            order({ id: 'b', kot_nos: [], items: [line('B1')] }),
            order({ id: 'c', kot_nos: [1], items: [line('C1')] }),
            order({ id: 'd', kot_nos: ['x'], items: [line('D1'), line('D2')] }),
        ];
        const names = groupItemsByKot(feed).flatMap((b) => b.items.map((i) => i.name)).sort();
        expect(names).toEqual(['A1', 'A2', 'B1', 'C1', 'D1', 'D2']);
    });

    it('never folds two orders into one block, even when they carry the same number', () => {
        const blocks = groupItemsByKot([
            order({ id: 'first', kot_nos: [8] }),
            order({ id: 'second', kot_nos: [8] }),
        ]);
        expect(blocks).toHaveLength(2);
        expect(blocks.map((b) => b.key)).toEqual(['first', 'second']);
    });

    it('names an order that was re-ticketed by every number on the pass', () => {
        const [block] = groupItemsByKot([order({ id: 'moved', kot_nos: [2, 1, 2] })]);
        expect(block.kotNos).toEqual([2, 1]);
        expect(block.label).toBe('KOTs 2, 1');
    });

    it('keeps only the selected table, matched case-insensitively', () => {
        const blocks = groupItemsByKot([
            order({ id: 'here', table: 't4', kot_nos: [3] }),
            order({ id: 'elsewhere', table: 'T14' }),
        ], ' T4 ');
        expect(blocks.map((b) => b.key)).toEqual(['here']);
    });

    it('leaves out cancelled and closed tickets, and tickets with no lines', () => {
        const blocks = groupItemsByKot([
            order({ id: 'live', kot_nos: [1] }),
            order({ id: 'served', status: 'Served', kot_nos: [2] }),
            order({ id: 'cancelled', status: 'Cancelled' }),
            order({ id: 'closed', status: 'Closed' }),
            order({ id: 'empty', items: [] }),
        ], 'T4');
        expect(blocks.map((b) => b.key)).toEqual(['live', 'served']);
    });

    it('prefers the flattened lines when the server sent them', () => {
        const [block] = groupItemsByKot([
            order({ id: 'flat', kot_nos: [4], items: [line('Stale')], items_flattened: [line('Paneer Tikka', 2), line('Masala Chai', 2)] }),
        ]);
        expect(block.items.map((i) => `${String(i.quantity)} × ${i.name}`)).toEqual(['2 × Paneer Tikka', '2 × Masala Chai']);
    });
});
