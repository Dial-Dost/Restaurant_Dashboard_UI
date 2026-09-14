// THE ROUND-OFF RUNG, AS EVERY WEB SURFACE READS IT (backend migration 048).
//
// "Round off the final amount always in final bill." The backend now rounds
// every bill's grand total to the rupee, once, in its billing layer, and hands
// the adjustment back as `round_off` beside `grand_total` — on the open bill
// (/bill-for-table), the guest's bill (/qr/:slug/bill), the settled bill
// (/bills/closed/:id) and the open-bills list. The client's receipt is the
// specification: "Round off -0.26" directly above "Grand Total 4982.00".
//
// NOTHING HERE ROUNDS. Rounding in a browser is how a printed total comes to
// disagree with the settled one (the backend's escpos.ts header tells that
// story). These helpers only READ the adjustment the server made and say
// whether there is one to show. A screen that showed a round-off it worked out
// for itself would be a second rule, and the first time the two disagreed the
// guest would be looking at one number and the till at another.
//
// SHOWN ONLY WHEN IT IS NOT ZERO, like every other optional rung: a bill that
// was already whole rupees, or was settled before rounding existed (round_off
// NULL, or the key absent on an older backend), shows exactly what it did.

/** The server's round-off on a bill document, or null when there is none to show. */
export function roundOffOf(doc: unknown): number | null {
    if (!doc || typeof doc !== 'object' || !('round_off' in doc)) {return null;}
    const raw = (doc as { round_off?: unknown }).round_off;
    if (raw === null || raw === undefined || raw === '') {return null;}
    const value = Number(raw);
    if (!Number.isFinite(value)) {return null;}
    // Compared in whole paisa: a float that is not quite zero is zero.
    const paisa = Math.round(value * 100);
    return paisa === 0 ? null : paisa / 100;
}

/**
 * A round-off as a screen shows it: always signed, so "-₹0.26" can never be read
 * as a charge and "+₹0.50" can never be read as a discount. `money` is the
 * surface's own currency formatter, applied to the magnitude.
 */
export function formatRoundOff(value: number, money: (n: number) => string): string {
    return `${value < 0 ? '−' : '+'}${money(Math.abs(value))}`;
}
