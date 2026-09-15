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
    draftSignature,
    draftSummary,
    keyForDraftSend,
    mergeDraftLine,
    newIdempotencyKey,
    removeDraftLine,
    setDraftQuantity,
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

    it('offers "View order (n)" beside Send, and a review with Back to menu and Send to kitchen', () => {
        expect(form).toMatch(/View order \(\$\{String\(itemCount\)\}\)/);
        expect(form).toMatch(/onClick=\{\(\) => \{ setReviewing\(true\); \}\}/);
        expect(form).toMatch(/Review order · /);
        expect(form).toMatch(/Read it back to the guest, then send\./);
        expect(form).toMatch(/draftSummary\(itemsList\)/);
        expect(form).toMatch(/>\s*Back to menu\s*</);
        expect(form).toMatch(/"Send to kitchen"/);
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

    it('add, remove and the review\'s steppers go through the shared draft rules', () => {
        expect(form).toMatch(/mergeDraftLine\(prev, \{/);
        expect(form).toMatch(/removeDraftLine\(itemsList, key\)/);
        expect(form).toMatch(/setDraftQuantity\(itemsList, key, quantity\)/);
        expect(form).toMatch(/const items = toOrderItems\(itemsList\)/);
        // The hold-blind remove is gone.
        expect(form).not.toMatch(/const removeItem = \(name: string, note\?: string \| null, variationId\?: string\)/);
    });

    it('C4 — the review prices lines and total only through the gated helpers', () => {
        const review = form.slice(form.indexOf('Review order · '));
        expect(review).toMatch(/visibleLineAmount\(user, it\.price, it\.quantity\)/);
        expect(review).toMatch(/subtotal === null \? "" :/);
        expect(review).not.toMatch(/it\.price \* it\.quantity/);
    });

    it('the draft\'s key travels from the form to POST /orders as an Idempotency-Key', () => {
        expect(form).toMatch(/keyForDraftSend\(sendKeyRef\.current, draftSignature\(tableIdNum, covers, itemsList\), newIdempotencyKey\)/);
        expect(form).toMatch(/onSubmit\(\{ tableId: tableIdNum, items, covers, idempotencyKey: sendKey\.key \}\)/);
        expect(page).toMatch(/await addOrder\(user\.restaurantUsername, newOrder, \{ idempotencyKey: newOrderData\.idempotencyKey \}\)/);

        const db = code(readSource('src/lib/db.ts'));
        const add = db.slice(db.indexOf('export const addOrder'), db.indexOf('export const deleteOrder'));
        expect(add).toMatch(/opts\?: \{ idempotencyKey\?: string \}/);
        expect(add).toMatch(/headers: \{[^}]*\.\.\.\(opts\?\.idempotencyKey \? \{ 'Idempotency-Key': opts\.idempotencyKey \}/);
    });
});
