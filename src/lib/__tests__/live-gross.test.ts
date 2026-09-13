// 6.4 — the live-gross box above the tables.
//
// THE REPORTED BUG. With T1–T3 holding sent KOTs and no bill generated yet the
// box read "₹0 · No tables are running", because it read the open-BILL figures.
// The server now sends `running_tables` / `running_total`, which count a table
// with orders and no bill; `readLiveGross` is the single place that decides what
// the box says. Three states, and zero is never a stand-in for the other two.

import { readLiveGross } from '../live-gross';

type Source = NonNullable<Parameters<typeof readLiveGross>[0]>;

const page = (over: Partial<Source> = {}): Source => ({
    total: 0,
    outstanding_total: 0,
    running_tables: 3,
    running_total: 5890.25,
    ...over,
});

describe('readLiveGross', () => {
    it('THE BUG: no bills yet, three running tables — the running figures win', () => {
        expect(readLiveGross(page())).toEqual({ kind: 'floor', tables: 3, total: 5890.25 });
    });

    it('an unreachable backend is "unavailable", never ₹0', () => {
        expect(readLiveGross(null)).toEqual({ kind: 'unavailable' });
    });

    it('a withheld amount (waiter-only session) keeps the count and shows NO figure, not 0', () => {
        expect(readLiveGross(page({ running_total: null }))).toEqual({ kind: 'floor', tables: 3, total: null });
    });

    it('a genuinely empty floor is zero tables at ₹0', () => {
        expect(readLiveGross(page({ running_tables: 0, running_total: 0 }))).toEqual({ kind: 'floor', tables: 0, total: 0 });
    });

    it('a backend older than 6.4 falls back to the open-bill figures it always sent', () => {
        expect(readLiveGross(page({ running_tables: null, running_total: null, total: 2, outstanding_total: 2604 })))
            .toEqual({ kind: 'floor', tables: 2, total: 2604 });
    });
});
