// TODAY BY PAYMENT METHOD on the Overview's "Today at a glance" card.
//
// Client ask: "How much money from each payment method made in the day has to be
// shown." The arithmetic is the backend's — GetOverviewHeadline hands the
// Settlement Summary's own cut over today as `today_by_method`, and backend jest
// proves Σ amount === today_gross and Cash row === cash_collection. Nothing on
// this side relates those numbers, so nothing here pretends to re-prove them.
// What is pinned is the SHAPING and the WIRING, and each case is a way the block
// could tell an owner something false about today's till:
//
//   * an older backend that never sent the rows being drawn as "no money by any
//     method" instead of drawing nothing;
//   * the bars drawn against a client re-sum instead of the server's gross;
//   * split_bills / unallocated read off the wrong place, or the warning gated
//     on a sum that nets to ₹0.00, so "these bills need looking at" never shows;
//   * a split note that claims something the tag above it contradicts;
//   * a helper that exists and a card that never calls it.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    UNALLOCATED_METHOD, hasSettlements, modeSharePct, readHeadlineByMethod, unallocatedWarning,
    type HeadlineByMethod,
} from '../settlement-breakdown';

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
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const fig = (value: number, label: string) => ({ value, label, hint: `${label} hint` });

/** The live shape of GET /analytics/headline with the by-method fields. */
const headline = (over: Record<string, unknown> = {}) => ({
    today: '2026-09-14',
    month_from: '2026-09-01',
    timezone: 'Asia/Kolkata',
    today_net: fig(20000, "Today's net sale"),
    today_gross: fig(22680.9, "Today's gross sale"),
    online_net: fig(0, 'Online sale (net)'),
    online_gross: fig(0, 'Online sale (gross)'),
    cash_collection: fig(8430.5, 'Cash collection'),
    month_to_date: fig(412000, 'Month to date'),
    today_bills: 14,
    month_bills: 301,
    // Server order is amount-desc already; shuffled here to prove the ranking.
    today_by_method: [
        { method: 'Card', bills: 3, amount: 3250.4, share_pct: 14.33, refund: 0, net_amount: 3250.4 },
        { method: 'Cash', bills: 6, amount: 8430.5, share_pct: 37.17, refund: 120, net_amount: 8310.5 },
        { method: 'Upi', bills: 6, amount: 11000, share_pct: 48.5, refund: 0, net_amount: 11000 },
    ],
    today_split_bills: 1,
    today_unallocated: 0,
    by_method: { label: 'Collected by payment method', hint: "Settled today, by how it was paid; adds up to Today's gross sale." },
    ...over,
});

describe("reading today's modes off the headline", () => {
    it('shapes every mode, largest first, keeping the server share and refund', () => {
        const b = readHeadlineByMethod(headline())!;
        expect(b.modes.map((m) => m.method)).toEqual(['Upi', 'Cash', 'Card']);
        // A server label wins over the id (the Overview shows what Accounting shows).
        {
            const h = headline();
            const rows = (h.today_by_method as { method: string; label?: string }[]);
            const i = rows.findIndex((r) => r.method === 'Upi');
            rows[i] = { ...rows[i], label: 'UPI' };
            expect(readHeadlineByMethod(h)!.modes.find((m) => m.method === 'Upi')?.label).toBe('UPI');
        }
        // No label from the server: the id stands in for it (settlement-breakdown.ts).
        expect(b.modes[1]).toEqual({ method: 'Cash', label: 'Cash', bills: 6, amount: 8430.5, share_pct: 37.17, refund: 120, net_amount: 8310.5 });
        expect(modeSharePct(b.modes[0], b.total_amount)).toBe(48.5);
    });

    it("the total is the server's Today's gross sale, not a re-sum of the rows", () => {
        // The rows add to 22680.90; the server's gross is set a paisa away so a
        // helper that re-summed instead of reading today_gross fails here. (The
        // server guarantees the two agree — backend jest — so the paisa is only
        // ever a test's way of telling them apart.)
        const b = readHeadlineByMethod(headline({ today_gross: fig(22680.91, "Today's gross sale") }))!;
        expect(b.total_amount).toBe(22680.91);
    });

    it('re-sums the rows only when the payload carries no gross at all', () => {
        const b = readHeadlineByMethod(headline({ today_gross: undefined }))!;
        expect(b.total_amount).toBe(22680.9);
    });

    it('prints the label and definition the server wrote', () => {
        const b = readHeadlineByMethod(headline())!;
        expect(b.label).toBe('Collected by payment method');
        expect(b.hint).toMatch(/gross sale/);
    });

    it('takes split_bills and unallocated from the TOP-LEVEL headline fields', () => {
        // Not `totals` — the headline has none. Reading the report's shape here
        // would zero the warning forever.
        const b = readHeadlineByMethod(headline({
            today_by_method: [
                { method: 'Cash', bills: 2, amount: 1000, share_pct: 80, refund: 0, net_amount: 1000 },
                { method: UNALLOCATED_METHOD, bills: 1, amount: 250, share_pct: 20, refund: 0, net_amount: 250 },
            ],
            today_gross: fig(1250, "Today's gross sale"),
            today_split_bills: 3,
            today_unallocated: 250,
        }))!;
        expect(b.split_bills).toBe(3);
        expect(b.unallocated).toBe(250);
    });

    it('a one-tender split with a residual is NOT a split-note bill — the server count is taken as sent', () => {
        // ₹100 UPI on a ₹300 'Split' bill: two parts, one real mode. The server's
        // today_split_bills leaves it out (multi_method_bills), so the card must
        // not re-derive a count from the rows — Upi + Unallocated each carrying
        // that bill would read as "paid across more than one method", which is
        // false. The warning is the true sentence about it.
        const b = readHeadlineByMethod(headline({
            today_by_method: [
                { method: UNALLOCATED_METHOD, bills: 1, amount: 200, share_pct: 66.67, refund: 0, net_amount: 200 },
                { method: 'Upi', bills: 1, amount: 100, share_pct: 33.33, refund: 0, net_amount: 100 },
            ],
            today_gross: fig(300, "Today's gross sale"),
            today_split_bills: 0,
            today_unallocated: 200,
        }))!;
        expect(b.split_bills).toBe(0);
        expect(unallocatedWarning(b, (n) => `₹${n.toFixed(2)}`)).toMatch(/^₹200\.00 could not be put under a payment method/);
    });

    it("counts the Unallocated row's bills, and 0 without one", () => {
        expect(readHeadlineByMethod(headline())!.unallocated_bills).toBe(0);
        const b = readHeadlineByMethod(headline({
            today_by_method: [
                { method: 'Cash', bills: 2, amount: 1250, share_pct: 62.5, refund: 0, net_amount: 1250 },
                { method: 'Upi', bills: 2, amount: 750, share_pct: 37.5, refund: 0, net_amount: 750 },
                { method: UNALLOCATED_METHOD, bills: 2, amount: 0, share_pct: 0, refund: 0, net_amount: 0 },
            ],
            today_gross: fig(2000, "Today's gross sale"),
            today_unallocated: 0,
        }))!;
        expect(b.unallocated).toBe(0);
        expect(b.unallocated_bills).toBe(2);
    });

    it('falls back to the Unallocated row when the field is missing, rather than reporting zero', () => {
        const b = readHeadlineByMethod(headline({
            today_by_method: [{ method: UNALLOCATED_METHOD, bills: 1, amount: 99, share_pct: 100, refund: 0, net_amount: 99 }],
            today_unallocated: undefined,
        }))!;
        expect(b.unallocated).toBe(99);
    });
});

describe('the Unallocated warning', () => {
    const money = (n: number): string => `₹${n.toFixed(2)}`;
    const withUnallocated = (amount: number, bills: number, today_unallocated: number = amount): HeadlineByMethod => readHeadlineByMethod(headline({
        today_by_method: [
            { method: 'Cash', bills: 2, amount: 1000, share_pct: 100, refund: 0, net_amount: 1000 },
            { method: UNALLOCATED_METHOD, bills, amount, share_pct: 0, refund: 0, net_amount: amount },
        ],
        today_gross: fig(1000 + amount, "Today's gross sale"),
        today_unallocated,
    }))!;

    it('is silent on a clean day', () => {
        expect(unallocatedWarning(readHeadlineByMethod(headline())!, money)).toBeNull();
    });

    it('names the money, in either direction', () => {
        expect(unallocatedWarning(withUnallocated(250, 1), money))
            .toBe("₹250.00 could not be put under a payment method — 1 bill's split amounts do not add up to their totals and need looking at.");
        expect(unallocatedWarning(withUnallocated(-200, 3), money))
            .toMatch(/^₹200\.00 could not be put under a payment method — 3 bills' split amounts/);
    });

    it('STILL WARNS when residuals cancel to ₹0.00 across bills', () => {
        // ₹50 short on one split and ₹50 over on another: the sum says nothing is
        // wrong, the row's two bills say otherwise.
        expect(unallocatedWarning(withUnallocated(0, 2, 0), money))
            .toBe("2 bills' split amounts do not add up to their totals and need looking at (the differences cancel out to ₹0.00 today).");
    });
});

describe('what renders nothing', () => {
    it('an OLDER backend that never sent the rows — not "no money by any method"', () => {
        const h = headline();
        delete (h as Record<string, unknown>).today_by_method;
        expect(readHeadlineByMethod(h)).toBeNull();
    });

    it('no headline at all', () => {
        expect(readHeadlineByMethod(null)).toBeNull();
    });

    it('an unlabelled block — a nameless list of money is worse than none', () => {
        expect(readHeadlineByMethod(headline({ by_method: undefined }))).toBeNull();
        expect(readHeadlineByMethod(headline({ by_method: { label: '  ', hint: 'x' } }))).toBeNull();
    });

    it('nothing settled today: an empty list is a breakdown hasSettlements refuses', () => {
        const b = readHeadlineByMethod(headline({ today_by_method: [], today_gross: fig(0, "Today's gross sale"), today_bills: 0 }));
        expect(b).not.toBeNull();
        expect(hasSettlements(b)).toBe(false);
    });
});

describe('the Overview card draws it', () => {
    const src = code(readSource('src/components/headline-stats.tsx'));

    it('reads the block through the shared helper, not off the raw payload', () => {
        expect(src).toMatch(/readHeadlineByMethod\(h\)/);
        expect(src).not.toMatch(/\.today_by_method/);
    });

    it('names each mode by the owner label, keyed and matched on the stored id', () => {
        expect(src).toMatch(/title=\{m\.label\}/);
        expect(src).toMatch(/\{m\.label\}/);
        expect(src).not.toMatch(/title=\{m\.method\}/);
        expect(src).not.toMatch(/^\s*\{m\.method\}\s*$/m);
        expect(src).toMatch(/key=\{m\.method\}/);
        expect(src).toMatch(/m\.method === UNALLOCATED_METHOD/);
    });

    it('renders it inside the loaded card, under the tiles', () => {
        expect(src).toMatch(/\{tiles\(data\)\}\s*\{byMethod\(data\)\}/);
    });

    it('does not draw an empty block', () => {
        expect(src).toMatch(/if \(!b \|\| !hasSettlements\(b\)\) \{ return null \}/);
    });

    it('warns through unallocatedWarning, never off the netted sum alone', () => {
        expect(src).toMatch(/const warning = unallocatedWarning\(b, money\)/);
        expect(src).toMatch(/\(b\.split_bills > 0 \|\| warning\)/);
        expect(src).toMatch(/\{warning && \(/);
        expect(src).not.toMatch(/b\.unallocated !== 0/);
    });

    it('the split note claims nothing the "N bills settled" tag can contradict', () => {
        // That tag counts released ₹0 tables, which have no row, so the per-mode
        // counts can add up to LESS than it even with a split bill.
        expect(src).toMatch(/paid across more than one\s+method; each part counts under its own method\./);
        expect(src).not.toMatch(/add up to more than/);
    });
});
