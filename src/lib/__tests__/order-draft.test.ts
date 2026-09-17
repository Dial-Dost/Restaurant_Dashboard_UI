// Client item 5 — "View order" beside "Send order", the web half.
//
// The Add New Order dialog's draft is a list of lines, and three things read it:
// the pending list under the form, the new review, and the send. These pin the
// rules they share — what makes two picks the same line, what remove takes out,
// what the send posts — and the key that stops one draft becoming two orders.
//
// The components have no DOM harness in this repo (jest runs in node over
// src/lib), so the WIRING in the orders page is pinned by reading its source,
// the way closed-bills-range.test.ts pins its card.

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
    draftItemCount,
    draftLineKey,
    draftReviewTable,
    draftReviewTitle,
    draftSignature,
    draftSummary,
    keyForDraftSend,
    mergeDraftLine,
    newIdempotencyKey,
    removeDraftLine,
    setDraftQuantity,
    stepDraftLine,
    toOrderItems,
    type DraftLine,
} from '../order-draft';

const paneer = (over: Partial<DraftLine> = {}): DraftLine => ({
    name: 'Paneer Tikka', price: 320, quantity: 1, note: null, course_hold: false, ...over,
});

describe('mergeDraftLine — what makes two picks the same line', () => {
    it('the same dish, note, hold and size bumps the quantity (and ignores the case of the name)', () => {
        const lines = mergeDraftLine([paneer({ quantity: 2 })], paneer({ name: 'paneer tikka', quantity: 3 }));
        expect(lines).toHaveLength(1);
        expect(lines[0]?.quantity).toBe(5);
        expect(lines[0]?.name).toBe('Paneer Tikka');
    });

    it('a different size, hold or note is a separate line, appended in the order it was added', () => {
        let lines: DraftLine[] = [paneer()];
        lines = mergeDraftLine(lines, paneer({ variation_id: 'v-half', variation_label: 'Half', price: 180 }));
        lines = mergeDraftLine(lines, paneer({ course_hold: true }));
        lines = mergeDraftLine(lines, paneer({ note: 'no onions' }));
        expect(lines).toHaveLength(4);
        expect(lines.map((l) => [l.variation_id ?? '', Boolean(l.course_hold), l.note ?? ''])).toEqual([
            ['', false, ''],
            ['v-half', false, ''],
            ['', true, ''],
            ['', false, 'no onions'],
        ]);
    });

    it('does not mutate the list it was given', () => {
        const before = [paneer()];
        mergeDraftLine(before, paneer());
        expect(before[0]?.quantity).toBe(1);
    });

    it('a note containing the key\'s own punctuation cannot collide two different lines', () => {
        const a = draftLineKey({ name: 'a|b', note: '' });
        const b = draftLineKey({ name: 'a', note: 'b|' });
        expect(a).not.toBe(b);
    });
});

describe('removeDraftLine — takes out exactly one line', () => {
    it('the X on a HELD line leaves the un-held line of the same dish alone (the old removeItem took both)', () => {
        const fired = paneer({ quantity: 2 });
        const held = paneer({ course_hold: true });
        const lines = removeDraftLine([fired, held], draftLineKey(held));
        expect(lines).toEqual([fired]);
    });

    it('and a differently-cased name still finds its line, as the merge does', () => {
        const lines = [paneer()];
        expect(removeDraftLine(lines, draftLineKey({ name: 'PANEER TIKKA', note: null }))).toEqual([]);
    });
});

describe('setDraftQuantity — the review\'s − and +', () => {
    const lines = [paneer({ quantity: 2 }), paneer({ name: 'Dal Makhani', price: 285 })];
    const keyOf = (i: number): string => draftLineKey(lines[i] ?? paneer({ name: 'missing' }));

    it('sets the one line', () => {
        const next = setDraftQuantity(lines, keyOf(0), 3);
        expect(next.map((l) => l.quantity)).toEqual([3, 1]);
    });

    it('to zero (or below) removes the line rather than leaving "0 ×" on a ticket', () => {
        expect(setDraftQuantity(lines, keyOf(1), 0).map((l) => l.name)).toEqual(['Paneer Tikka']);
        expect(setDraftQuantity(lines, keyOf(1), -4).map((l) => l.name)).toEqual(['Paneer Tikka']);
    });

    it('a quantity that is not a number changes nothing', () => {
        expect(setDraftQuantity(lines, keyOf(0), Number.NaN)).toEqual(lines);
    });
});

describe('stepDraftLine — what the review\'s − and + actually do', () => {
    const fired = paneer({ quantity: 2 });
    const held = paneer({ course_hold: true });
    const dal = paneer({ name: 'Dal Makhani', price: 285, quantity: 3 });
    const lines = [fired, held, dal];

    it('+ adds exactly one to that line, − takes exactly one, from the quantity the LIST holds', () => {
        expect(stepDraftLine(lines, draftLineKey(dal), 1).map((l) => l.quantity)).toEqual([2, 1, 4]);
        expect(stepDraftLine(lines, draftLineKey(dal), -1).map((l) => l.quantity)).toEqual([2, 1, 2]);
        // Twice in a row is two, not one: each step reads the list it is given.
        const twice = stepDraftLine(stepDraftLine(lines, draftLineKey(fired), 1), draftLineKey(fired), 1);
        expect(twice.map((l) => l.quantity)).toEqual([4, 1, 3]);
    });

    it('steps the HELD line alone, not the un-held line of the same dish beside it', () => {
        expect(stepDraftLine(lines, draftLineKey(held), 1).map((l) => [l.quantity, Boolean(l.course_hold)]))
            .toEqual([[2, false], [2, true], [3, false]]);
    });

    it('− on a single plate takes the line out rather than leaving "0 ×" on the ticket', () => {
        expect(stepDraftLine(lines, draftLineKey(held), -1)).toEqual([fired, dal]);
    });

    it('a line that is already gone stays gone — a late click does not bring it back', () => {
        const gone = draftLineKey(paneer({ note: 'removed a moment ago' }));
        expect(stepDraftLine(lines, gone, 1)).toEqual(lines);
        expect(stepDraftLine(lines, gone, -1)).toEqual(lines);
    });

    it('does not mutate the draft it was given', () => {
        stepDraftLine(lines, draftLineKey(dal), 1);
        expect(dal.quantity).toBe(3);
    });
});

describe('the review\'s heading — the table the order is going to', () => {
    const tables = [{ id: 3, name: 'T3' }, { id: 4, name: 'T4' }];

    it('a table picked in the dialog is named, although the page passed "" for the URL\'s table', () => {
        // The page opened from "Add Order" passes `selectedTable?.name ?? ""`. The
        // old `"" ?? picked` never reached the pick and read "Review order · ".
        expect(draftReviewTable(tables, '4', '')).toBe('T4');
        expect(draftReviewTitle(draftReviewTable(tables, '4', ''))).toBe('Review order · T4');
    });

    it('names the table the send POSTS to, over the spelling the URL arrived with', () => {
        expect(draftReviewTable(tables, '3', 't3')).toBe('T3');
    });

    it('falls back to the URL\'s table only while there is no picked table to name', () => {
        expect(draftReviewTable([], '', 'Patio 2')).toBe('Patio 2');
        expect(draftReviewTable(tables, '99', ' Patio 2 ')).toBe('Patio 2');
        expect(draftReviewTable([], '', undefined)).toBe('');
    });

    it('"Review order · T4", and plain "Review order" with no table rather than a dangling "·"', () => {
        expect(draftReviewTitle('T4')).toBe('Review order · T4');
        expect(draftReviewTitle('')).toBe('Review order');
        expect(draftReviewTitle('   ')).toBe('Review order');
        expect(draftReviewTitle(null)).toBe('Review order');
    });
});

describe('counting and wording — the same words as the owner app', () => {
    it('draftItemCount sums plates, not lines', () => {
        expect(draftItemCount([paneer({ quantity: 2 }), paneer({ course_hold: true })])).toBe(3);
        expect(draftItemCount([])).toBe(0);
    });

    it('"N items · M dishes", singular where it is one', () => {
        expect(draftSummary([paneer({ quantity: 2 }), paneer({ note: 'x' }), paneer({ course_hold: true })]))
            .toBe('4 items · 3 dishes');
        expect(draftSummary([paneer()])).toBe('1 item · 1 dish');
        expect(draftSummary([paneer({ quantity: 2 })])).toBe('2 items · 1 dish');
    });
});

describe('toOrderItems — what the send posts', () => {
    it('strips variation_label and keeps variation_id, course_hold and note, exactly as handleSubmit did', () => {
        const lines: DraftLine[] = [
            { name: 'Paneer Tikka', price: 180, quantity: 2, note: 'no onions', course_hold: true, variation_id: 'v-half', variation_label: 'Half' },
            { id: undefined, name: 'Dal', price: 285, quantity: 1, note: null, course_hold: false },
        ];
        // The expression handleSubmit used before this file existed.
        const legacy = lines.map(({ variation_label: _label, ...rest }) => rest);
        expect(toOrderItems(lines)).toEqual(legacy);
        expect(toOrderItems(lines)[0]).not.toHaveProperty('variation_label');
        expect(toOrderItems(lines)[0]).toMatchObject({ variation_id: 'v-half', course_hold: true, note: 'no onions' });
    });
});

describe('one idempotency key per logical send', () => {
    let n = 0;
    const mint = (): string => { n += 1; return `key-${String(n)}`; };

    it('the identical draft, sent again, carries the SAME key — the server cannot make it two orders', () => {
        const sig = draftSignature(4, 2, [paneer({ quantity: 2 })]);
        const first = keyForDraftSend(null, sig, mint);
        const again = keyForDraftSend(first, draftSignature(4, 2, [paneer({ quantity: 2 })]), mint);
        expect(again.key).toBe(first.key);
    });

    it('any change — a quantity, a hold, the table, the covers — is a different order with a fresh key', () => {
        const base = keyForDraftSend(null, draftSignature(4, 2, [paneer()]), mint);
        for (const changed of [
            draftSignature(4, 2, [paneer({ quantity: 2 })]),
            draftSignature(4, 2, [paneer({ course_hold: true })]),
            draftSignature(5, 2, [paneer()]),
            draftSignature(4, 3, [paneer()]),
            draftSignature(4, 2, [paneer(), paneer({ name: 'Dal' })]),
        ]) {
            expect(keyForDraftSend(base, changed, mint).key).not.toBe(base.key);
        }
    });

    it('the signature ignores the form-only size label, as the payload does', () => {
        expect(draftSignature(1, 1, [paneer({ variation_id: 'v', variation_label: 'Half' })]))
            .toBe(draftSignature(1, 1, [paneer({ variation_id: 'v', variation_label: 'Half (renamed)' })]));
    });

    it('newIdempotencyKey is 32 hex characters (inside the server\'s 8-200 printable rule) and unique', () => {
        const seen = new Set<string>();
        for (let i = 0; i < 200; i += 1) {
            const k = newIdempotencyKey();
            expect(k).toMatch(/^[0-9a-f]{32}$/);
            seen.add(k);
        }
        expect(seen.size).toBe(200);
    });

    it('works with no Web Crypto at all (plain-http LAN tills have no randomUUID; some runtimes nothing)', () => {
        expect(newIdempotencyKey({})).toMatch(/^[0-9a-f]{32}$/);
    });
});

// ---------------------------------------------------------------- the wiring

function readSource(relative: string): string {
    for (const base of [process.cwd(), path.join(__dirname, '..', '..', '..')]) {
        const full = path.join(base, relative);
        // A fixed list of this repo's own source files, not user input.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        if (fs.existsSync(full)) { return fs.readFileSync(full, 'utf8'); }
    }
    throw new Error(`readSource could not find ${relative} from ${process.cwd()}`);
}

/** Source with comments removed, so a pin reads the CODE rather than the prose beside it. */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\s*\}/g, '');

describe('the orders page is wired to all of it', () => {
    const page = code(readSource('src/app/dashboard/orders/page.tsx'));
    const formAt = page.indexOf('function OrderForm(');
    const form = page.slice(formAt, page.indexOf('const EditOrderDialog', formAt));

    it('offers "View order" beside Send, and a review with Back to menu and Send to kitchen', () => {
        // Word for word the owner app's label (order_entry.dart's `Text('View order')`):
        // no count, which is already on the Send button beside it.
        expect(form).toMatch(/onClick=\{\(\) => \{ setReviewing\(true\); \}\}[^>]*>\s*View order\s*<\/Button>/);
        expect(form).not.toMatch(/View order \(/);
        expect(form).toMatch(/Read it back to the guest, then send\./);
        expect(form).toMatch(/draftSummary\(itemsList\)/);
        expect(form).toMatch(/>\s*Back to menu\s*</);
        expect(form).toMatch(/"Send to kitchen"/);
    });

    it('a narrow dialog wraps both send bars instead of cutting the count off the button', () => {
        expect(form.match(/<div className="flex flex-wrap gap-2">/g) ?? []).toHaveLength(2);
        expect(form).not.toMatch(/"truncate"/);
    });

    it('one sending guard covers BOTH send buttons', () => {
        expect(form).toMatch(/if \(sendingRef\.current\) \{return;\}/);
        expect(form).toMatch(/finally \{\s*sendingRef\.current = false;\s*setSending\(false\);/);
        // Every button that calls handleSubmit is disabled while a send is out.
        const sends = form.match(/<Button[^>]*onClick=\{\(\) => \{ void handleSubmit\(\); \}\}[^>]*>/g) ?? [];
        expect(sends).toHaveLength(2);
        for (const b of sends) { expect(b).toMatch(/disabled=\{[^}]*sending[^}]*\}/); }
        expect(form).not.toMatch(/void onSubmit\(/);
    });

    it('the review is headed with the table the order goes to, through the tested helpers', () => {
        expect(form).toMatch(/const reviewTitle = draftReviewTitle\(draftReviewTable\(tables, selectedTableId, selectedTableName\)\);/);
        expect(form).toMatch(/<div className="text-lg font-semibold">\{reviewTitle\}<\/div>/);
        // The `"" ?? picked` that dropped a picked table's name.
        expect(form).not.toMatch(/selectedTableName \?\? tables\.find/);
        expect(form).not.toMatch(/Review order · \{/);
    });

    it('the review\'s − takes one and its + adds one — each button wired to its own direction', () => {
        expect(form).toMatch(/const stepLine = \(key: string, delta: -1 \| 1\) => \{ updateLines\(stepDraftLine\(itemsList, key, delta\)\); \};/);
        const button = (label: string): string => {
            const at = form.indexOf('aria-label={`' + label + ' ${it.name}`}');
            expect(at).toBeGreaterThan(0);
            return form.slice(at, form.indexOf('</Button>', at));
        };
        expect(button('One fewer')).toMatch(/onClick=\{\(\) => \{ stepLine\(key, -1\); \}\}/);
        expect(button('One fewer')).toContain('<Minus');
        expect(button('One more')).toMatch(/onClick=\{\(\) => \{ stepLine\(key, 1\); \}\}/);
        expect(button('One more')).toContain('<Plus');
        expect(button('Remove')).toMatch(/onClick=\{\(\) => \{ removeLine\(key\); \}\}/);
        // No stepper works its quantity out from the render's own copy of the line.
        expect(form).not.toMatch(/it\.quantity [+-] 1/);
    });

    it('while a send is out the WHOLE form is locked, so nothing is added that the send will not carry', () => {
        const open = form.indexOf('<fieldset disabled={sending} ');
        const close = form.indexOf('</fieldset>', open);
        expect(open).toBeGreaterThan(0);
        expect(close).toBeGreaterThan(open);
        const locked = form.slice(open, close);
        // Every control that changes what the send would carry sits inside it.
        for (const control of [
            'onClick={addItem}',
            'options={tableOptions}',
            'onClick={onClearSelectedTable}',
            'setCovers(',
            'options={menuOptions}',
            'id="item-note"',
            'id="item-hold"',
            'removeLine(draftLineKey(it))',
        ]) {
            expect(locked).toContain(control);
        }
        // And the main view has nothing outside it but the two send buttons,
        // each off while sending on its own account.
        const mainAt = form.indexOf('<div className="grid gap-4 py-4">', form.indexOf('{reviewTitle}'));
        expect(mainAt).toBeGreaterThan(0);
        const outside = form.slice(mainAt, open) + form.slice(close);
        for (const handler of ['addItem', 'setItemsList', 'removeLine', 'stepLine', 'setCovers', 'setSelectedTableId', 'onClearSelectedTable', '<Input', '<Switch', '<Combobox', '<Select']) {
            expect(outside).not.toContain(handler);
        }
        // An opening tag, read past the `=>` of its own onClick.
        const outsideButtons = outside.match(/<Button(?:=>|[^>])*>/g) ?? [];
        expect(outsideButtons).toHaveLength(2);
        for (const b of outsideButtons) { expect(b).toMatch(/disabled=\{[^}]*sending[^}]*\}/); }
    });

    it('add, remove and the review\'s steppers go through the shared draft rules', () => {
        expect(form).toMatch(/mergeDraftLine\(prev, \{/);
        expect(form).toMatch(/removeDraftLine\(itemsList, key\)/);
        expect(form).toMatch(/stepDraftLine\(itemsList, key, delta\)/);
        expect(form).toMatch(/const items = toOrderItems\(itemsList\)/);
        // The hold-blind remove is gone.
        expect(form).not.toMatch(/const removeItem = \(name: string, note\?: string \| null, variationId\?: string\)/);
    });

    it('C4 — the review prices lines and total only through the gated helpers', () => {
        const review = form.slice(form.indexOf('{reviewTitle}'));
        expect(review.length).toBeGreaterThan(100);
        expect(review).toMatch(/visibleLineAmount\(user, it\.price, it\.quantity\)/);
        expect(review).toMatch(/subtotal === null \? "" :/);
        expect(review).not.toMatch(/it\.price \* it\.quantity/);
    });

    it('the draft\'s key travels from the form to POST /orders as an Idempotency-Key', () => {
        expect(form).toMatch(/keyForDraftSend\(sendKeyRef\.current, draftSignature\(tableIdNum, covers, itemsList\), newIdempotencyKey\)/);
        // `coversChosen` rides along (client item 6): a seated party's covers
        // change only when the Guests box was typed in — see next-party.test.ts.
        expect(form).toMatch(/onSubmit\(\{ tableId: tableIdNum, items, covers, coversChosen, idempotencyKey: sendKey\.key \}\)/);
        expect(page).toMatch(/await addOrder\(user\.restaurantUsername, newOrder, \{ idempotencyKey: newOrderData\.idempotencyKey \}\)/);

        const db = code(readSource('src/lib/db.ts'));
        const add = db.slice(db.indexOf('export const addOrder'), db.indexOf('export const deleteOrder'));
        expect(add).toMatch(/opts\?: \{ idempotencyKey\?: string \}/);
        expect(add).toMatch(/headers: \{[^}]*\.\.\.\(opts\?\.idempotencyKey \? \{ 'Idempotency-Key': opts\.idempotencyKey \}/);
    });
});
