// ROUND 4 ITEM 2, FIRST HALF — "Remove from bill makes it sound like the item
// is going to be served but only removed from bill."
//
// ============================================================================
// WHY A LABEL IS WORTH A TEST SUITE
// ============================================================================
// The floor reads the label and nothing else. "Remove from bill" is a complete,
// coherent description of a DIFFERENT act this product also has — a comp: the
// dish is cooked, plated and carried out, and the house does not charge for it.
// Somebody reaching for that and tapping this one takes the dish off the ticket
// and off the pass, and the guest never gets it. There is no error, no refusal
// and no second chance: a CANCELLED slip is already at the kitchen.
//
// So the two acts must not be confusable, and the way they stop being
// confusable is that one of them says KOT and the other says non-chargeable.
// That is a property of the shipped strings, which is what is pinned here — the
// source is read because these strings live in a "use client" component with a
// React and lucide-react import graph that has no business being pulled into a
// node-environment unit test to assert a noun.
//
// WHAT IS *NOT* CHANGED, and is pinned so a later tidy-up does not change it:
// the route the control posts to. Every till in the field posts to
// /bills/remove-item and will for months (bill-remove-item.test.ts owns the
// body's shape). A label is not a contract.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Fixed paths under src/, named in this file — not user input.
const src = (rel: string): string => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

const ACTIONS = 'components/bill-print/kot-line-actions.tsx';

/** Everything the component renders, with the file's own prose stripped out, so
 *  a comment quoting the old label cannot make a wording test pass. */
const rendered = (): string => src(ACTIONS)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('the KOT line menu says what it does to the KOT', () => {
    it('the menu entry is "Remove from KOT"', () => {
        const ui = rendered();
        expect(ui).toContain('>Remove from KOT<');
        expect(ui).not.toContain('Remove from bill');
    });

    it('it still sits beside "Move to another table" — two kitchen acts, named as such', () => {
        const ui = rendered();
        expect(ui).toContain('Move to another table');
        expect(ui.indexOf('Remove from KOT')).toBeLessThan(ui.indexOf('Move to another table'));
    });

    it('the confirm names the dish, the ticket, and the fact that it will not be served', () => {
        const ui = rendered();
        // The question, not "Remove item?" — which said nothing about what is
        // removed from where.
        expect(ui).toContain('from this KOT?');
        expect(ui).toContain('will not be cooked or served');
        // And it points at the act somebody reaching for a comp actually wants,
        // rather than leaving them to find it.
        expect(ui).toContain('non-chargeable');
    });

    it('the toast says the dish left the KOT, whether or not paper went to the pass', () => {
        const ui = rendered();
        // With a number: the slip the pass has to be told about (client item 2).
        expect(ui).toContain('The slip is printing as CANCELLED — tell the pass.');
        // Without one: still unambiguous about the outcome.
        expect(ui).toContain('from the KOT. It will not be cooked.');
        expect(ui).not.toMatch(/Removed \$\{dish\}\.`/);
    });
});

describe('a comp is a different act, on a different surface, in different words', () => {
    // If these two ever converge, the rename above has been undone by accident.
    it('the comp control is called non-chargeable and lives in the Orders capture menu', () => {
        const capture = src('app/dashboard/orders/capture-actions.tsx');
        expect(capture).toContain('Non-chargeable item…');
        expect(capture).toContain('Make non-chargeable');
        // It is gated on its own permission, which "Remove from KOT" is not
        // (that one is admin-only, enforced by the server).
        expect(capture).toContain('comp_item');
    });

    it('neither surface borrows the other\'s words', () => {
        const capture = src('app/dashboard/orders/capture-actions.tsx');
        const detail = src('components/orders/order-detail-sheet.tsx');
        for (const [where, text] of [['capture-actions', capture], ['order-detail-sheet', detail]] as const) {
            expect([where, text.includes('Remove from KOT')]).toEqual([where, false]);
            expect([where, text.includes('Remove from bill')]).toEqual([where, false]);
        }
        expect(rendered()).not.toContain('non-chargeable item');
        expect(rendered()).not.toMatch(/\bComp\b/);
    });
});

describe('the rename did not touch the wire', () => {
    it('the control still posts to /bills/remove-item', () => {
        expect(src('lib/api/bill-print.ts')).toContain('/bills/remove-item');
        expect(rendered()).toContain('removeBillItem(');
    });
});
