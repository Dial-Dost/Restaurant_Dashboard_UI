// THE ROUND-OFF RUNG AND THE REMOVED SERVICE CHARGE, ON EVERY WEB BILL SURFACE.
//
// Two client items that meet on the same ladder:
//
//   "Round off the final amount always in final bill." The backend rounds each
//   bill to the rupee (migration 048) and sends `round_off` beside
//   `grand_total`. Every surface that shows the ladder shows that rung when it
//   is not zero — or the lines a guest can add up stop short of the total they
//   are asked for. Nothing on the web rounds.
//
//   "Don't show service charge opted out when removed ... this too in the
//   bill." A removed charge shows no row anywhere: the thermal bill, the
//   browser-printed bill, the orders page dialogs.
//
// The pure reader is exercised directly. The pages have no DOM harness here
// (jest runs in node over src/lib), so where the requirement is about WHERE a
// rung is drawn they are pinned by reading the source, as bill-customer.test.ts
// and floorplan-and-bill-template.test.ts do.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { formatRoundOff, roundOffOf } from '../bill-round-off';

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
const code = (src: string): string => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('roundOffOf — the server\'s round-off, or nothing to show', () => {
    it('reads the round-off off a bill document', () => {
        expect(roundOffOf({ grand_total: 4982, round_off: -0.26 })).toBe(-0.26);
        expect(roundOffOf({ round_off: 0.5 })).toBe(0.5);
        // numeric(12,2) can arrive as a string through a JSON layer.
        expect(roundOffOf({ round_off: '-0.26' })).toBe(-0.26);
    });

    it('a whole bill, a bill settled before rounding, and an older backend show nothing', () => {
        expect(roundOffOf({ round_off: 0 })).toBeNull();
        expect(roundOffOf({ round_off: null })).toBeNull();
        expect(roundOffOf({ grand_total: 1050.5 })).toBeNull();
        expect(roundOffOf(null)).toBeNull();
        expect(roundOffOf(undefined)).toBeNull();
    });

    it('junk and float noise below a paisa are nothing, never a guess', () => {
        expect(roundOffOf({ round_off: 'abc' })).toBeNull();
        expect(roundOffOf({ round_off: '' })).toBeNull();
        expect(roundOffOf({ round_off: Number.NaN })).toBeNull();
        expect(roundOffOf({ round_off: 0.004 })).toBeNull();
        expect(roundOffOf({ round_off: 0.1 + 0.2 - 0.3 })).toBeNull();
    });

    it('formats with a sign always, so a round-off can never be read as a charge or a discount', () => {
        const money = (n: number) => `₹${n.toFixed(2)}`;
        expect(formatRoundOff(-0.26, money)).toBe('−₹0.26');
        expect(formatRoundOff(0.5, money)).toBe('+₹0.50');
    });
});

describe('every web surface that shows the ladder shows the round-off rung', () => {
    it('the print page reads it off the SAME server document as the grand total — settled and open', () => {
        const src = code(readSource('src/app/dashboard/orders/print/page.tsx'));
        expect(src).toContain("import { roundOffOf } from '@/lib/bill-round-off'");
        expect(src).toContain('roundOff: roundOffOf(settled),');
        expect(src).toContain('roundOff: roundOffOf(openBill),');
        // The page used to hard-code the rung away for every server bill.
        expect(src).not.toMatch(/roundOff:\s*null/);
        // Both renderers read the document's round-off: the screen's ladder and the ESC/POS bytes.
        expect(src).toContain('<ReceiptLadderRow label="Round off" value={totals.roundOff} />');
        expect(src).toContain('roundOff: doc.roundOff,');
    });

    it('closed bills (Accounting and History)', () => {
        const src = code(readSource('src/components/closed-bills.tsx'));
        expect(src).toMatch(/roundOffOf\(d\) !== null && \(\s*<Row label="Round off" value=\{formatRoundOff\(roundOffOf\(d\)!/);
        // Between the taxes and the grand total, where the paper has it.
        expect(src.indexOf('label="Round off"')).toBeGreaterThan(src.indexOf('d.taxes.map('));
        expect(src.indexOf('label="Round off"')).toBeLessThan(src.indexOf('label="Grand total"'));
    });

    it('the guest\'s own bill — the panel AND the downloadable receipt', () => {
        const src = code(readSource('src/app/order/[restaurant]/page.tsx'));
        expect(src).toContain('round_off: roundOffOf(data),');
        expect(src).toContain('<span>{t("roundOff")}</span>');
        expect(src).toContain('<span>Round off</span><span>{formatRoundOff(bill.round_off, money)}</span>');
        expect(src).toContain('roundOff: "Round off",');
    });

    it('the MIS report bill drill-down', () => {
        const src = code(readSource('src/app/dashboard/reports/drill-down.tsx'));
        expect(src).toContain('<Line label="Round off" value={formatRoundOff(roundOffOf(bill)!, money)} />');
        expect(src.indexOf('label="Round off"')).toBeLessThan(src.indexOf('label="Grand total"'));
    });

    it('the customer-facing display', () => {
        const src = code(readSource('src/app/cfd/[restaurant]/page.tsx'));
        expect(src).toContain('round_off: roundOffOf(data),');
        expect(src).toContain('<dt>Round off</dt>');
        expect(src.indexOf('<dt>Round off</dt>')).toBeLessThan(src.indexOf('money(bill.grand_total)'));
    });

    it('the bill types carry it', () => {
        const src = readSource('src/lib/db.ts');
        const closed = src.slice(src.indexOf('export interface ClosedBillSummary'), src.indexOf('export interface ClosedBillDetail'));
        const open = src.slice(src.indexOf('export interface OpenBillSummary'), src.indexOf('export interface OpenBillPage'));
        expect(closed).toContain('round_off?: number;');
        expect(open).toContain('round_off?: number;');
    });
});

describe('a removed service charge is not shown on any web bill surface', () => {
    it('the thermal encoder has no way to say Opted-out', () => {
        const src = code(readSource('src/lib/bill-escpos.ts'));
        expect(src).not.toMatch(/optedOut|Opted-out/);
        expect(src).toContain('const sc = doc.serviceCharge && doc.serviceCharge.amount > 0 ? doc.serviceCharge : null;');
    });

    it('the print page hands the renderers a charge only when one is charged', () => {
        const src = code(readSource('src/app/dashboard/orders/print/page.tsx'));
        expect(src).not.toMatch(/optedOut|Opted-out|waivedPercent/);
        expect(src).toContain('return amount > 0 ? { percent, amount } : null;');
    });

    it('the orders page dialogs show the row only for a charge that is charged, and never a stray 0', () => {
        const src = code(readSource('src/app/dashboard/orders/page.tsx'));
        expect(src).not.toContain('Opted-out');
        // `{order.serviceChargePercentage && (` rendered "0" for a 0% tenant.
        expect(src).not.toMatch(/\{order\.serviceChargePercentage && \(/);
        expect(src.match(/\{order\.applyServiceCharge && \(order\.serviceChargePercentage \?\? 0\) > 0 && \(/g) ?? []).toHaveLength(2);
    });
});

// A waiver's recorded reduction is the charge plus its tax BEFORE round-off; the
// grand totals shown beside it are rounded. 5499 with a 10% charge and 5% GST is
// 6351 -> 5774 (577.00 less) against a recorded 577.40, so labelling the
// reduction "Guest pays less by" put two figures on one panel that disagree.
describe('a waiver\'s pre-round reduction is never labelled as what the guest pays less by', () => {
    it('the waiver panel calls it charge + tax, before round-off, and the removal toast names only the totals', () => {
        const src = code(readSource('src/app/dashboard/orders/capture-actions.tsx'));
        expect(src).not.toMatch(/less by" value=\{money\([^)]*grand_total_reduction\)\}/);
        expect(src).not.toMatch(/The guest pays <b>\{money\([^)]*grand_total_reduction\)\}<\/b>/);
        expect(src).toContain('(charge and tax {money(live.grand_total_reduction)}, before round-off)');
        expect(src).not.toContain('total reduction {money(live.grand_total_reduction)}');
        // Client item 6 replaced the after-waiver Done panel with a toast as the
        // bill prints. It carries the two PAYABLE totals, straight off the
        // server's response, and never the pre-round reduction beside them.
        expect(src).toContain('serviceChargeRemovalSentence(answer.result, money)');
        const lib = code(readSource('src/lib/mis-capture.ts'));
        const sentence = lib.slice(lib.indexOf('export const serviceChargeRemovalSentence'), lib.indexOf('export interface BillTenderRecord'));
        expect(sentence).toContain('total ${money(before)} → ${money(after)}');
        expect(sentence).not.toContain('grand_total_reduction');
    });

    it('the Service Charge Deny report tile says the same', () => {
        const src = code(readSource('src/app/dashboard/reports/context-panels.tsx'));
        expect(src).toContain('const denied = num(totals.grand_total_reduction) ?? 0');
        expect(src).not.toMatch(/label="Guests paid less by"/);
        expect(src).toContain('<Tile label="Charge + tax denied" value={money(denied)} hint="Before each bill\'s round-off"');
    });
});
