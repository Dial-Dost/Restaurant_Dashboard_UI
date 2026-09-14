// TODAY BY PAYMENT METHOD on the Overview's "Today at a glance" card.
//
// Client ask: "How much money from each payment method made in the day has to be
// shown." The arithmetic is the backend's — GetOverviewHeadline hands the
// Settlement Summary's own cut over today as `today_by_method`, and backend jest
// proves Σ amount === today_gross and Cash row === cash_collection. What is
// pinned here is the SHAPING and the WIRING, and each case is a way the block
// could tell an owner something false about today's till:
//
//   * an older backend that never sent the rows being drawn as "no money by any
//     method" instead of drawing nothing;
//   * split_bills / unallocated read off the wrong place, so the one warning
//     that says "these bills need looking at" can never appear;
//   * a helper that exists and a card that never calls it.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    UNALLOCATED_METHOD, hasSettlements, modeSharePct, readHeadlineByMethod,
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
        expect(b.modes[1]).toEqual({ method: 'Cash', bills: 6, amount: 8430.5, share_pct: 37.17, refund: 120, net_amount: 8310.5 });
        expect(modeSharePct(b.modes[0], b.total_amount)).toBe(48.5);
    });

    it("the total is the server's Today's gross sale — the figure the rows add up to", () => {
        const h = headline();
        const b = readHeadlineByMethod(h)!;
        expect(b.total_amount).toBe(22680.9);
        const summed = Math.round(b.modes.reduce((s, m) => s + m.amount, 0) * 100) / 100;
        expect(summed).toBe(h.today_gross.value);
    });

    it('the Cash row is the Cash collection tile', () => {
        const h = headline();
        const b = readHeadlineByMethod(h)!;
        expect(b.modes.find((m) => m.method === 'Cash')?.amount).toBe(h.cash_collection.value);
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

    it('falls back to the Unallocated row when the field is missing, rather than reporting zero', () => {
        const b = readHeadlineByMethod(headline({
            today_by_method: [{ method: UNALLOCATED_METHOD, bills: 1, amount: 99, share_pct: 100, refund: 0, net_amount: 99 }],
            today_unallocated: undefined,
        }))!;
        expect(b.unallocated).toBe(99);
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

    it('renders it inside the loaded card, under the tiles', () => {
        expect(src).toMatch(/\{tiles\(data\)\}\s*\{byMethod\(data\)\}/);
    });

    it('does not draw an empty block', () => {
        expect(src).toMatch(/if \(!b \|\| !hasSettlements\(b\)\) \{ return null \}/);
    });

    it('warns when money could not be put under a mode, in either direction', () => {
        expect(src).toMatch(/b\.unallocated !== 0/);
    });
});
