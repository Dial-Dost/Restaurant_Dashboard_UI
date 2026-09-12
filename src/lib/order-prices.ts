// C4 — A WAITER TAKING AN ORDER DOES NOT SEE THE PRICES.
//
// V3, verbatim: "Hide Prices for Waiters: When a waiter is taking an order at a
// table, remove the prices from the list of ordered dishes displayed on the
// right side. Only the dish name and quantity should remain visible."
//
// ============================================================================
// TWO THINGS HAVE TO BE TRUE AT ONCE, AND ONLY ONE OF THEM IS A ROLE TEST
// ============================================================================
// 1. THE GATE. `showsMoney` — which is `!isWaiterOnly`, the SERVER's own
//    predicate, and literally what the Flutter app's `RoleScope.showsMoney` is
//    (`models/role_scope.dart:224`). Not a `can()` capability, not a role
//    string, not "is this order still open". One question, one answer, three
//    clients; a fourth rule here is how a waiter ends up seeing on the web what
//    the phone hides.
//
// 2. THE PAYLOAD MAY ALREADY BE REDACTED. The backend is making the order/menu
//    payloads themselves drop prices for a waiter-only session, which is the
//    right place for it — a control whose only defence is not being drawn is not
//    a control, and a redacted payload means a waiter cannot read the figure out
//    of the network tab either. But it means a price field can arrive ABSENT or
//    NULL, and every `Number(x || 0).toFixed(2)` in this codebase turns that
//    into a confident "₹0.00" — a FIGURE, printed where a hidden one should be,
//    on the screen a waiter is reading dish by dish. "₹NaN" at least looks
//    broken; "₹0.00" looks like the dish is free, and somebody will ring it in.
//
// So the answer to "what do I draw here" is not a number and not a role: it is
// `number | null`, where NULL MEANS DRAW NOTHING. The call site renders the
// element or it does not — it is never handed a value it has to decide about,
// which is the decision that gets made inconsistently across forty JSX
// expressions.
//
// FAILURE DIRECTION: an unknown identity KEEPS THE FIGURES. `isWaiterOnly`
// answers false for anyone the server has not positively scoped (including a
// session too old to carry the field), so a stale browser shows an owner their
// own prices rather than blanking the order screen for the person who runs the
// restaurant. The money here is DISPLAY ONLY — nothing in this module is a
// control, and the real gate is the redaction on the server.
//
// PURE — no React, no fetch, no `window` — so `__tests__/order-prices.test.ts`
// can pin every branch without rendering anything, which is how this repo
// already tests (`session-scope.ts`, `service-clock.ts`, `mis-capture.ts`).

import { showsMoney, type ScopedSession } from './session-scope';

/**
 * A money field as it actually arrives, or null when there is no number there.
 *
 * Absent, null, "", "null", NaN and Infinity are all the SAME answer — "this
 * payload did not give me a figure" — and they must be, because which of them a
 * redacted payload sends is a backend implementation detail this screen must not
 * be sensitive to. A genuine 0 is a figure and survives: a comped or zero-priced
 * line is a real thing to show a manager.
 */
export const parseAmount = (raw: unknown): number | null => {
    if (raw === null || raw === undefined) { return null; }
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed === '' || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined') { return null; }
    }
    if (typeof raw === 'boolean') { return null; }
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
};

/**
 * THE AMOUNT TO DRAW, OR NULL FOR "DRAW NOTHING AT ALL".
 *
 * Null on either of the two grounds in this file's header — the session is a
 * scoped waiter, or the payload carried no figure — and deliberately does not
 * distinguish them at the call site. A screen that told the two apart would end
 * up rendering a placeholder for one of them ("—", "hidden", "₹0.00"), and C4
 * asks for the price to be GONE, not for its absence to be announced beside
 * every dish.
 */
export const visibleAmount = (
    session: ScopedSession | null | undefined,
    raw: unknown,
): number | null => (showsMoney(session) ? parseAmount(raw) : null);

/**
 * The same answer for a LINE — unit price times quantity — with the same null.
 *
 * Computed here rather than at the call site because `price * quantity` on a
 * redacted price is exactly where `null * 3 === 0` slips through: JavaScript
 * multiplies null as zero without complaint, and the line renders "₹0.00" for a
 * dish that costs ₹425. The quantity is NOT gated — C4 says the quantity stays.
 */
export const visibleLineAmount = (
    session: ScopedSession | null | undefined,
    price: unknown,
    quantity: unknown,
): number | null => {
    const unit = visibleAmount(session, price);
    if (unit === null) { return null; }
    const qty = parseAmount(quantity);
    return unit * (qty ?? 1);
};

/**
 * A whole column of lines added up, or null when ANY of them is hidden.
 *
 * ALL-OR-NOTHING ON PURPOSE. A subtotal built from the lines that happened to
 * carry a price is a number that is quietly wrong — it is the total of some of
 * the order — and it is worse than no subtotal, because it looks like the
 * total of all of it. A waiter is shown no subtotal; anybody else is shown one
 * that adds up to the lines above it.
 */
export const visibleSubtotal = (
    session: ScopedSession | null | undefined,
    lines: readonly { price?: unknown; quantity?: unknown }[],
): number | null => {
    if (!showsMoney(session)) { return null; }
    let sum = 0;
    for (const line of lines) {
        const amount = visibleLineAmount(session, line.price, line.quantity);
        if (amount === null) { return null; }
        sum += amount;
    }
    return sum;
};

/**
 * The formatted string for a visible amount, or null to draw nothing.
 *
 * Formatting lives beside the gate so no call site can reach `.toFixed(2)` with
 * a value the gate said to hide — which is the mistake that produces "₹NaN" and
 * "₹undefined" on a receipt.
 */
export const visibleMoneyText = (
    currencySymbol: string,
    amount: number | null,
): string | null => (amount === null ? null : `${currencySymbol}${amount.toFixed(2)}`);
