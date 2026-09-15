// GROSS, NET AND ITEM TOTAL on the web — the words, the keys behind them, and
// the screens that must say them.
//
// Backend jest (test/money/gross_net_vocabulary.test.ts) pins the server's side:
// every MIS column labelled Gross is keyed grand_total, every Net is keyed net,
// and the accounting Sales report's total_net is the MIS Net. What can still go
// wrong HERE is the hard-coded furniture beside the grid — a tile, a card, a
// table header — and each case below is one way it could put the client's word
// on the wrong number:
//
//   * a Sales tile reading the deprecated `gross` key (the item total) under the
//     word "Gross", which is exactly the complaint;
//   * the Accounting card showing net_sales (Gross less refunds, tax and all)
//     under "Net sales" again;
//   * "Net" reappearing on the Settlement Summary's after-refunds figure;
//   * a helper that exists and a screen that never calls it.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    AFTER_REFUNDS, GROSS, ITEM_TOTAL, NET,
    chargesAboveNet, discountPctOf, itemTotalOf, readAccountingSales,
} from '../gross-net';

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
const code = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * The Sales Summary totals the server sends today, for Gaia's receipt plus a
 * discounted bill: item total 5985 − 150 = net 5835 + SC 10 + tax 292.26 + round
 * off −0.26 = Gross 6137. `gross` is the deprecated alias of item_total.
 */
const ladder = {
    item_total: 5985, gross: 5985, discount: 150, net: 5835,
    service_charge: 10, tax: 292.26, round_off: -0.26, grand_total: 6137,
};

describe('the three words', () => {
    it('are the words the server labels its columns with', () => {
        expect([GROSS, NET, ITEM_TOTAL, AFTER_REFUNDS]).toEqual(['Gross', 'Net', 'Item total', 'After refunds']);
    });
});

describe('itemTotalOf', () => {
    it('reads item_total, and never the grand total', () => {
        expect(itemTotalOf(ladder)).toBe(5985);
        expect(itemTotalOf({ ...ladder, gross: 1 })).toBe(5985);
    });

    it('falls back to the deprecated gross alias on a backend that does not send item_total', () => {
        const { item_total: _omit, ...older } = ladder;
        expect(itemTotalOf(older)).toBe(5985);
    });
});

describe('discountPctOf', () => {
    it('reads the item-total share, falling back to the old key', () => {
        expect(discountPctOf({ discount_pct_of_item_total: 2.51, discount_pct_of_gross: 2.51 })).toBe(2.51);
        expect(discountPctOf({ discount_pct_of_gross: 2.51 })).toBe(2.51);
    });
});

describe('chargesAboveNet', () => {
    it('is service charge + tax + round off, so Net + it === Gross to the paisa', () => {
        expect(chargesAboveNet(ladder)).toBe(302);
        expect(Math.round((ladder.net + (chargesAboveNet(ladder) ?? Number.NaN)) * 100) / 100).toBe(ladder.grand_total);
    });

    it('includes the round off the old "Tax + service charge" tile left out', () => {
        expect(chargesAboveNet(ladder)).not.toBe(ladder.tax + ladder.service_charge);
    });

    it('is null, not zero, when the payload carries no ladder at all', () => {
        expect(chargesAboveNet({})).toBeNull();
    });
});

describe('readAccountingSales', () => {
    const sales = { total_sales: 6137, total_net: 5835, total_refund: 60, net_sales: 6077 };

    it('headlines Net as total_net — never net_sales, which is Gross less refunds with the tax still in', () => {
        const s = readAccountingSales(sales);
        expect(s.headline).toEqual({ label: 'Net sales', value: 5835 });
        expect(s.grossSales).toBe(6137);
        expect(s.grossAfterRefunds).toBe(6077);
        expect(s.headline.value).not.toBe(sales.net_sales);
    });

    it('on a backend without total_net, the card names the figure it can show instead of borrowing "Net"', () => {
        const s = readAccountingSales({ total_sales: 6137, total_refund: 60, net_sales: 6077 });
        expect(s.netSales).toBeNull();
        expect(s.headline).toEqual({ label: 'Gross after refunds', value: 6077 });
    });

    it('a missing report is nulls, not zeroes', () => {
        expect(readAccountingSales(null)).toEqual({
            grossSales: null, netSales: null, refunds: null, grossAfterRefunds: null,
            headline: { label: 'Gross after refunds', value: null },
        });
    });
});

// --- the wiring ---------------------------------------------------------------

describe('the report tiles say the words through the helper', () => {
    const src = code(readSource('src/app/dashboard/reports/context-panels.tsx'));

    it('no tile hard-codes Gross, Net or Grand total', () => {
        expect(src).not.toMatch(/label="Gross"/);
        expect(src).not.toMatch(/label="Net"/);
        expect(src).not.toMatch(/label="Grand total"/);
        expect(src).not.toMatch(/label="% of gross"/);
        expect(src).not.toMatch(/label="Net in drawer"/);
    });

    it('every Gross tile reads grand_total, and every Net tile reads net', () => {
        const gross = [...src.matchAll(/label=\{GROSS\} value=\{money\(([^)]*)\)\}/g)].map((m) => m[1]);
        expect(gross.length).toBeGreaterThanOrEqual(6);
        for (const expr of gross) {expect(expr).toBe('totals.grand_total');}
        const net = [...src.matchAll(/label=\{NET\} value=\{money\(([^)]*)\)\}/g)].map((m) => m[1]);
        expect(net.length).toBeGreaterThanOrEqual(3);
        for (const expr of net) {expect(expr).toBe('totals.net');}
    });

    it('the pre-discount rung is read through itemTotalOf, and the old gross key is not read directly', () => {
        expect(src).toMatch(/label=\{ITEM_TOTAL\} value=\{money\(itemTotalOf\(totals\)\)\}/);
        expect(src).not.toMatch(/totals\.gross\b(?!_)/);
        expect(src).toMatch(/discountPctOf\(totals\)/);
        expect(src).not.toMatch(/totals\.discount_pct_of_gross/);
        expect(src).toMatch(/chargesAboveNet\(totals\)/);
    });

    it('the Settlement Summary names its collected-less-refunds figure After refunds', () => {
        expect(src).toMatch(/label=\{AFTER_REFUNDS\} value=\{money\(totals\.net_amount\)\}/);
    });
});

describe('Accounting headlines Net through readAccountingSales', () => {
    const src = code(readSource('src/app/dashboard/accounting/page.tsx'));

    it('reads the sales report through the helper, and never prints net_sales raw', () => {
        expect(src).toMatch(/readAccountingSales\(sales\)/);
        expect(src).toMatch(/\{salesWords\.headline\.label\}/);
        expect(src).toMatch(/money\(salesWords\.headline\.value\)/);
        expect(src).not.toMatch(/sales\?\.net_sales/);
        expect(src).not.toMatch(/>Net sales ↗</);
    });
});

describe('the other screens', () => {
    it('the settlement breakdown header is After refunds, not "Net of refunds"', () => {
        const src = code(readSource('src/app/dashboard/analytics/settlement-breakdown.tsx'));
        expect(src).toMatch(/\{AFTER_REFUNDS\}/);
        expect(src).not.toMatch(/Net of refunds/);
        expect(src).not.toMatch(/Net is what survived/);
    });

    it('the bill drill-down calls its top rung Item total — "gross" is the bottom of the ladder', () => {
        const src = code(readSource('src/app/dashboard/reports/drill-down.tsx'));
        expect(src).toMatch(/label=\{ITEM_TOTAL\} value=\{money\(bill\.items_subtotal\)\}/);
        expect(src).not.toMatch(/subtotal \(gross\)/);
    });
});
