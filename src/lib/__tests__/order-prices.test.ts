// What these tests are actually protecting.
//
// C4 is "when a waiter is taking an order at a table, remove the prices from the
// list of ordered dishes; only the dish name and quantity remain". That is two
// rules wearing one coat, and the second one is the one that gets missed:
//
//   1. THE GATE IS THE SERVER'S ONE PREDICATE. `showsMoney` is `!isWaiterOnly`,
//      which is literally what the Flutter app's `RoleScope.showsMoney` is. A
//      money gate that asked anything else here — a capability, a role string,
//      "is the order open" — would be a fourth answer to a question that already
//      has one, and it would show up as a waiter seeing on the web what the
//      phone hides. That is the csrorganics failure with a new surface.
//
//   2. THE PAYLOAD ITSELF IS BEING REDACTED, so a price can arrive ABSENT or
//      NULL — and `Number(undefined || 0).toFixed(2)` is "0.00". A confident
//      figure printed where a hidden one belongs is worse than a visible one: on
//      an order cart it reads as a dish that is free, and somebody will ring it
//      in. `null * qty === 0` in JavaScript is the same trap one multiplication
//      further down.
//
// So every case below asks for `null` — "draw nothing" — rather than for a
// number the JSX would then have to have an opinion about. A call site that is
// handed a value has to decide; a call site handed null cannot get it wrong.

import {
    parseAmount,
    visibleAmount,
    visibleLineAmount,
    visibleMoneyText,
    visibleSubtotal,
} from '../order-prices';
import type { ScopedSession } from '../session-scope';

const WAITER: ScopedSession = { scope: { waiter_only: true } };
const MANAGER: ScopedSession = { scope: { waiter_only: false } };
/** A browser holding a session from before the scope block shipped. */
const STALE: ScopedSession = { actions_set: [] };

describe('parseAmount — a figure, or the honest absence of one', () => {
    it('reads the numbers a payload actually sends', () => {
        expect(parseAmount(425)).toBe(425);
        expect(parseAmount('425.50')).toBe(425.5);
        expect(parseAmount(0)).toBe(0);
    });

    it('keeps a genuine ZERO, because a comped line is a real thing to show', () => {
        // The one value that must NOT be treated as "no answer": a zero-priced or
        // non-chargeable line is a figure a manager needs to see.
        expect(parseAmount(0)).toBe(0);
        expect(parseAmount('0')).toBe(0);
    });

    it('answers null for every shape a redacted payload can arrive in', () => {
        // Which of these the backend sends is its own implementation detail, and
        // this screen must not be sensitive to the choice.
        expect(parseAmount(undefined)).toBe(null);
        expect(parseAmount(null)).toBe(null);
        expect(parseAmount('')).toBe(null);
        expect(parseAmount('   ')).toBe(null);
        expect(parseAmount('null')).toBe(null);
        expect(parseAmount('undefined')).toBe(null);
        expect(parseAmount('hidden')).toBe(null);
        expect(parseAmount(NaN)).toBe(null);
        expect(parseAmount(Infinity)).toBe(null);
        expect(parseAmount({})).toBe(null);
        expect(parseAmount(true)).toBe(null);
    });
});

describe('visibleAmount — the waiter gate, from the server and nowhere else', () => {
    it('hides the figure from a waiter-only session', () => {
        expect(visibleAmount(WAITER, 425)).toBe(null);
        expect(visibleAmount(WAITER, 0)).toBe(null);
    });

    it('shows it to a manager', () => {
        expect(visibleAmount(MANAGER, 425)).toBe(425);
    });

    it('shows it to a session the server never scoped — the fix must not blank the owner\'s screen', () => {
        expect(visibleAmount(STALE, 425)).toBe(425);
        expect(visibleAmount(null, 425)).toBe(425);
        expect(visibleAmount(undefined, 425)).toBe(425);
    });

    it('hides it from a manager too when the PAYLOAD carried no figure', () => {
        // The second rule. Redaction can also reach a screen whose reader is
        // allowed to see money — a partial payload, an older route — and "₹0.00"
        // is the wrong way to render that.
        expect(visibleAmount(MANAGER, undefined)).toBe(null);
        expect(visibleAmount(MANAGER, null)).toBe(null);
    });

    it('ignores the role strings — a waiter carrying a custom role stays scoped', () => {
        const waiterWithCustomRole = {
            scope: { waiter_only: true },
            role: 'waiter',
            role_all: ['waiter', 'd2b1f0c4-0000-4000-8000-000000000001'],
        } as unknown as ScopedSession;
        expect(visibleAmount(waiterWithCustomRole, 425)).toBe(null);
    });
});

describe('visibleLineAmount — price times quantity, or nothing at all', () => {
    it('multiplies for a reader who may see money', () => {
        expect(visibleLineAmount(MANAGER, 425, 10)).toBe(4250);
    });

    it('defaults a missing QUANTITY to one — C4 keeps the quantity, it does not gate it', () => {
        expect(visibleLineAmount(MANAGER, 425, undefined)).toBe(425);
    });

    it('never lets a redacted price become a line total of zero', () => {
        // THE TRAP THIS PINS. `null * 3` is 0 in JavaScript, silently, so a
        // redacted cart would have added up to a confident ₹0.00 per line.
        expect(visibleLineAmount(MANAGER, null, 3)).toBe(null);
        expect(visibleLineAmount(MANAGER, undefined, 3)).toBe(null);
        expect(visibleLineAmount(WAITER, 425, 3)).toBe(null);
    });
});

describe('visibleSubtotal — all of the lines, or none of them', () => {
    const cart = [
        { name: 'Paneer Tikka', price: 425, quantity: 2 },
        { name: 'Naan', price: 60, quantity: 4 },
    ];

    it('adds up for a manager', () => {
        expect(visibleSubtotal(MANAGER, cart)).toBe(1090);
    });

    it('is hidden entirely from a waiter — the subtotal is the same money in one line', () => {
        expect(visibleSubtotal(WAITER, cart)).toBe(null);
    });

    it('is ALL-OR-NOTHING when one line came back redacted', () => {
        // A subtotal built from the lines that happened to carry a price is the
        // total of SOME of the order, and it looks exactly like the total of all
        // of it. No subtotal is strictly better than a quietly wrong one.
        const partiallyRedacted = [{ name: 'Paneer Tikka', price: 425, quantity: 2 }, { name: 'Naan', quantity: 4 }];
        expect(visibleSubtotal(MANAGER, partiallyRedacted)).toBe(null);
    });

    it('is zero, not null, for an empty cart a manager is looking at', () => {
        expect(visibleSubtotal(MANAGER, [])).toBe(0);
    });
});

describe('visibleMoneyText — formatting lives behind the gate, never in front of it', () => {
    it('formats a visible amount', () => {
        expect(visibleMoneyText('₹', 4250)).toBe('₹4250.00');
    });

    it('answers null for a hidden one, so no call site can reach .toFixed on it', () => {
        // This is what stops "₹NaN" and "₹undefined" ever being rendered: the
        // only way to a formatted string is through a value the gate approved.
        expect(visibleMoneyText('₹', null)).toBe(null);
        expect(visibleMoneyText('₹', visibleLineAmount(WAITER, 425, 2))).toBe(null);
        expect(visibleMoneyText('₹', visibleLineAmount(MANAGER, undefined, 2))).toBe(null);
    });

    it('honours the tenant\'s own currency symbol', () => {
        expect(visibleMoneyText('$', 12.5)).toBe('$12.50');
    });
});
