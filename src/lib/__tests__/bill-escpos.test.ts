// THE WEB'S THERMAL BILL IN THE CLIENT'S LAYOUT, PINNED.
//
// The client sent a photo of their real bill ("Gaia - Global Vegetarian") and
// said: this is how the bill should look — the margins, the lines, everything.
// escpos.ts (the backend's renderer) now prints that layout, and the dashboard's
// "Print ESC/POS" button posts bytes from lib/bill-escpos.ts to the SAME thermal
// agent. These tests read those bytes back and hold them to that layout:
//
//   * margins on 80mm (GS L 24 dots, GS W 528 dots) and none on 58mm;
//   * solid raster rules — thin between blocks, thick around the item table —
//     and never a row of hyphens;
//   * the name bold at body size, the "Name:" slot, Date / bold Dine In,
//     Cashier left / Bill No. right;
//   * Item | Qty. | Price | Amount in billColumns' widths;
//   * the right-hand ladder, a bold double-height "Grand Total" with no colon;
//   * the disclaimer bold and before the QR, and no "Thanks".
//
// Each line is read through escposLines, which steps over every raster by its
// header length (a thin rule's header carries a newline byte).
//
// The page itself has no DOM harness here (jest runs in node over src/lib), so
// where the requirement is about the on-screen slip it is pinned by reading the
// source, the way floorplan-and-bill-template.test.ts pins 5.1.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    BILL_SERVICE_CHARGE_NOTE,
    DOTS_PER_COL,
    billColumns,
    billEscPosPreviewText,
    billFeedbackUrl,
    billItemRow,
    billLogoFit,
    billLogoRaster,
    billMarginCols,
    billRule,
    billShowsQr,
    billTextColumns,
    billTotals,
    buildBillEscPos,
    type BillEscPosInput,
} from '../bill-escpos';
import { billCustomerLines } from '../bill-customer';
import { REPRINT_MARKER } from '../bill-print-state';
import { escposLines, latin1 } from './escpos-text';

function readSource(relative: string): string {
    for (const base of [process.cwd(), path.join(__dirname, '..', '..', '..')]) {
        const full = path.join(base, relative);
        // A fixed list of this repo's own source files, not user input.
         
        if (fs.existsSync(full)) { return fs.readFileSync(full, 'utf8'); }
    }
    throw new Error(`readSource could not find ${relative} from ${process.cwd()}`);
}

/** Source with comments removed, so a pin reads the CODE rather than the prose beside it. */
const code = (src: string): string => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const QR_URL = 'https://dash.example.com/feedback?restaurantId=r1&employeeId=e1&outletId=o1';

/** A bill shaped like the client's: 19 covers of food, service charge, CGST/SGST. */
function gaia(over: Partial<BillEscPosInput> = {}): BillEscPosInput {
    return {
        width: 48,
        reprint: false,
        logo: null,
        restaurantName: 'Gaia - Global Vegetarian',
        headerLines: ['Gaia Hospitality Pvt Ltd', '12 Mantri Square', '2nd Floor, Malleshwaram, Bengaluru 560003', 'Ph : 080-4123 4567', 'GSTN : 29ABCDE1234F1Z5'],
        customerLines: billCustomerLines('Guest', null),
        printedAt: '14/09/26 20:15',
        table: 'T12',
        cashier: 'Biller One',
        billNo: '4521',
        currency: '₹',
        items: [
            { name: 'Paneer Tikka Masala (Half)', quantity: 2, price: 325 },
            { name: 'Gaia Special Wood-fired Margherita Pizza with extra basil', quantity: 1, price: 545.5 },
            { name: 'Masala Chaas', quantity: 16, price: 225 },
        ],
        subtotal: 4795.5,
        discount: null,
        serviceCharge: { percent: 10, amount: 479.55 },
        taxes: [
            { id: 's', name: 'SGST', percentage: 2.5, amount: 131.88 },
            { id: 'c', name: 'CGST', percentage: 2.5, amount: 131.88 },
        ],
        roundOff: null,
        grandTotal: 5538.81,
        serviceChargeNote: BILL_SERVICE_CHARGE_NOTE,
        feedbackUrl: QR_URL,
        qrNote: 'For calling Valet kindly scan the below QR code',
        ...over,
    };
}

const MARKERS = new Set(['<RULE>', '<RULE:THICK>', '<IMAGE>', '<QR>']);
const textLines = (lines: string[]): string[] => lines.filter((l) => !MARKERS.has(l));

describe('the margins, the columns and the rule — the numbers everything else is laid out against', () => {
    it('80mm keeps two columns of white either side (44 to write in); 58mm keeps none', () => {
        expect(billMarginCols(48)).toBe(2);
        expect(billTextColumns(48)).toBe(44);
        expect(billMarginCols(32)).toBe(0);
        expect(billTextColumns(32)).toBe(32);
        expect(DOTS_PER_COL).toBe(12);
    });

    it('Item / Qty. / Price / Amount sum exactly to the text area on both rolls', () => {
        expect(billColumns(44)).toEqual({ COL_ITEM: 20, COL_QTY: 5, COL_PRICE: 9, COL_TOTAL: 10 });
        expect(billColumns(32)).toEqual({ COL_ITEM: 11, COL_QTY: 4, COL_PRICE: 8, COL_TOTAL: 9 });
        for (const w of [44, 32]) {
            const c = billColumns(w);
            expect(c.COL_ITEM + c.COL_QTY + c.COL_PRICE + c.COL_TOTAL).toBe(w);
        }
    });

    it('a rule is a GS v 0 raster: 4 white rows, 2 (thin) or 4 (thick) solid rows, 4 white rows', () => {
        const thin = billRule(528);
        expect(Array.from(thin.subarray(0, 8))).toEqual([0x1d, 0x76, 0x30, 0x00, 66, 0, 10, 0]);
        // yL of a thin rule IS the newline byte — the trap escposLines exists for.
        expect(thin[6]).toBe(0x0a);
        expect(thin.length).toBe(8 + 66 * 10);
        const row = (r: Uint8Array, y: number): number[] => Array.from(r.subarray(8 + y * 66, 8 + (y + 1) * 66));
        for (const y of [0, 1, 2, 3, 6, 7, 8, 9]) { expect(row(thin, y).every((b) => b === 0)).toBe(true); }
        for (const y of [4, 5]) { expect(row(thin, y).every((b) => b === 0xff)).toBe(true); }

        const thick = billRule(528, true);
        expect(thick[6]).toBe(12);
        for (const y of [4, 5, 6, 7]) { expect(row(thick, y).every((b) => b === 0xff)).toBe(true); }
        for (const y of [0, 3, 8, 11]) { expect(row(thick, y).every((b) => b === 0)).toBe(true); }
    });

    it('never inks past the width it was asked for', () => {
        const r = billRule(530); // 66 whole bytes + 2 dots
        expect(r[4]).toBe(67);
        expect(r[8 + 4 * 67 + 66]).toBe(0xc0);
        expect(r[8 + 4 * 67 + 65]).toBe(0xff);
    });
});

describe('the 80mm bill, line by line, in the client\'s order', () => {
    // A 16 x 4 checkerboard logo: a raster that is not a rule.
    const checker = Array.from({ length: 16 * 4 }, (_, i) => (((i % 16) + Math.floor(i / 16)) % 2 ? 255 : 0)).flatMap((v) => [v, v, v, 255]);
    const bytes = buildBillEscPos(gaia({ reprint: true, logo: billLogoRaster(checker, 16, 4) }));
    const lines = escposLines(bytes);

    it('sets the margins straight after ESC @, before a single character', () => {
        expect(Array.from(bytes.subarray(0, 10))).toEqual([0x1b, 0x40, 0x1d, 0x4c, 24, 0, 0x1d, 0x57, 0x10, 0x02]);
    });

    it('prints the whole document in this order', () => {
        const W = 44;
        const pad = (s: string, n: number): string => s.padEnd(n);
        const padL = (s: string, n: number): string => s.padStart(n);
        expect(lines).toEqual([
            REPRINT_MARKER,
            '<IMAGE>',
            '',
            'Gaia - Global Vegetarian',
            'Gaia Hospitality Pvt Ltd',
            '12 Mantri Square',
            '2nd Floor, Malleshwaram, Bengaluru 560003',
            'Ph : 080-4123 4567',
            'GSTN : 29ABCDE1234F1Z5',
            '<RULE>',
            'Name:',
            '<RULE>',
            'Date: 14/09/26 20:15' + ' '.repeat(W - 20 - 12) + 'Dine In: T12',
            'Cashier: Biller One' + ' '.repeat(W - 19 - 14) + 'Bill No.: 4521',
            '<RULE:THICK>',
            pad('Item', 20) + padL('Qty.', 5) + padL('Price', 9) + padL('Amount', 10),
            '<RULE:THICK>',
            pad('Paneer Tikka Masala', 20) + padL('2', 5) + padL('325.00', 9) + padL('650.00', 10),
            '(Half)',
            pad('Gaia Special', 20) + padL('1', 5) + padL('545.50', 9) + padL('545.50', 10),
            'Wood-fired',
            'Margherita Pizza',
            'with extra basil',
            pad('Masala Chaas', 20) + padL('16', 5) + padL('225.00', 9) + padL('3600.00', 10),
            '<RULE:THICK>',
            // ONE LABEL EDGE: the widest figure on the ladder is "Rs 5538.81"
            // (10), so the amount column is 11 wide and every label ends at 33 —
            // the rungs above the Grand Total included.
            padL('Total Qty: 19   Sub Total', 33) + padL('4795.50', 11),
            padL('Service Charge 10%', 33) + padL('479.55', 11),
            padL('SGST 2.5%', 33) + padL('131.88', 11),
            padL('CGST 2.5%', 33) + padL('131.88', 11),
            '<RULE>',
            padL('Grand Total', 33) + padL('Rs 5538.81', 11),
            '<RULE>',
            'A Voluntary Service Charge is included to',
            'support our staff. If you prefer not to',
            'contribute, please inform your server before',
            'payment and it will be removed.',
            '<RULE>',
            'For calling Valet kindly scan the below QR',
            'code',
            '',
            '<QR>',
            '',
            '',
            '',
            '',
        ]);
    });

    it('no text line is wider than the 44 columns between the margins', () => {
        for (const l of textLines(lines)) { expect(l.length).toBeLessThanOrEqual(44); }
    });

    it('has no dashed separator, no "Thanks", no "Customer Name:" and no "Grand Total:"', () => {
        const all = lines.join('\n');
        expect(all).not.toMatch(/-{8,}/);
        expect(all).not.toMatch(/Thanks/);
        expect(all).not.toMatch(/Customer Name:/);
        expect(all).not.toMatch(/Grand Total:/);
        // No parenthesised percentages: "SGST 2.5%", not "SGST (2.5%)".
        expect(all).not.toMatch(/\(\d[\d.]*%\)/);
    });

    it('the restaurant name is bold at body size — never the old double width and height', () => {
        const raw = latin1(bytes);
        expect(raw).toContain('\x1bE\x01Gaia - Global Vegetarian\n\x1bE\x00');
        expect(raw).not.toContain('\x1b!\x30');
    });

    it('only the Dine In run of the date row is bold', () => {
        expect(latin1(bytes)).toContain('Date: 14/09/26 20:15            \x1bE\x01Dine In: T12\x1bE\x00\n');
    });

    it('the grand total is bold and double height, laid out as a ladder row', () => {
        expect(latin1(bytes)).toContain(`\x1bE\x01\x1b!\x18${' '.repeat(22)}Grand Total Rs 5538.81\n\x1b!\x00\x1bE\x00`);
    });

    it('the disclaimer is bold, straight under the total, before the QR sentence', () => {
        const raw = latin1(bytes);
        expect(raw).toContain('\x1bE\x01A Voluntary Service Charge is included to\n');
        expect(raw.indexOf('Grand Total')).toBeLessThan(raw.indexOf('A Voluntary'));
        expect(raw.indexOf('A Voluntary')).toBeLessThan(raw.indexOf('For calling Valet'));
    });

    it('prints the grand total it was handed, to the paisa — nothing re-added or rounded', () => {
        const bill = gaia({ grandTotal: 5538.8 });
        expect(escposLines(buildBillEscPos(bill)).join('\n')).toContain('Grand Total Rs 5538.80');
    });
});

describe('the 58mm bill', () => {
    const bytes = buildBillEscPos(gaia({ width: 32, customerLines: billCustomerLines('Acme Pvt Ltd', '29ABCDE1234F1Z5') }));
    const lines = escposLines(bytes);

    it('emits no GS L / GS W — the narrow roll has no columns to spare', () => {
        expect(Array.from(bytes.subarray(0, 5))).toEqual([0x1b, 0x40, 0x1b, 0x61, 0x01]);
        expect(latin1(bytes)).not.toContain('\x1dL');
        expect(latin1(bytes)).not.toContain('\x1dW');
    });

    it('rules span the 32 columns (384 dots)', () => {
        const at = latin1(bytes).indexOf('\x1dv0\x00');
        expect(Array.from(bytes.subarray(at + 4, at + 8))).toEqual([48, 0, 10, 0]);
    });

    it('lays the table and ladder out in 32 columns, splitting Total Qty from Sub Total', () => {
        expect(lines).toContain('Item       Qty.   Price   Amount');
        // The amount column is sized to "Rs 5538.81" plus a space (11), so labels
        // end at 21. A rung with no figure prints its label and nothing after it.
        expect(lines).toContain('        Total Qty: 19');
        expect(lines).toContain('            Sub Total    4795.50');
        expect(lines).toContain('Name: Acme Pvt Ltd');
        expect(lines).toContain('Customer GSTIN: 29ABCDE1234F1Z5');
        for (const l of textLines(lines)) { expect(l.length).toBeLessThanOrEqual(32); }
    });
});

describe('what prints only when it is there', () => {
    it('Cashier alone and Bill No. alone print alone, at the left', () => {
        expect(escposLines(buildBillEscPos(gaia({ billNo: '' })))).toContain('Cashier: Biller One');
        expect(escposLines(buildBillEscPos(gaia({ cashier: '' })))).toContain('Bill No.: 4521');
        const neither = escposLines(buildBillEscPos(gaia({ cashier: '', billNo: 'null' })));
        expect(neither.join('\n')).not.toMatch(/Cashier:|Bill No\.:/);
    });

    it('no disclaimer: no rule above the QR sentence; no feedback URL: no sentence and no QR', () => {
        const noNote = escposLines(buildBillEscPos(gaia({ serviceChargeNote: null })));
        const grand = noNote.findIndex((l) => l.includes('Grand Total'));
        expect(noNote.slice(grand + 1, grand + 3)).toEqual(['<RULE>', 'For calling Valet kindly scan the below QR']);

        const noQr = escposLines(buildBillEscPos(gaia({ feedbackUrl: null })));
        expect(noQr).not.toContain('<QR>');
        expect(noQr.join('\n')).not.toContain('For calling Valet');
        // Header, Name slot, above and below the grand total — and none added for a QR that is not there.
        expect(noQr.filter((l) => l === '<RULE>').length).toBe(4);
        const last = noQr.indexOf('payment and it will be removed.');
        expect(last).toBeGreaterThan(-1);
        expect(noQr.slice(last + 1).every((l) => l === '')).toBe(true);
    });

    it('a supplied non-zero round-off is disclosed above the grand total, a zero one is not', () => {
        const withRound = escposLines(buildBillEscPos(gaia({ roundOff: -0.26 })));
        const at = withRound.indexOf(`${' '.repeat(24)}Round off${' '.repeat(6)}-0.26`);
        expect(at).toBeGreaterThan(-1);
        expect(withRound[at - 1]).toBe('<RULE>');
        expect(withRound[at + 1]).toContain('Grand Total');
        expect(escposLines(buildBillEscPos(gaia({ roundOff: 0 }))).join('\n')).not.toContain('Round off');
    });

    it('comped lines disclose their worth as "NC value (not charged)" under the Grand Total, ruled off; none prints nothing', () => {
        const padL = (t: string, n: number): string => t.padStart(n);
        const lines = escposLines(buildBillEscPos(gaia({ ncValue: 250 })));
        const grand = lines.findIndex((l) => l.includes('Grand Total'));
        expect(lines[grand + 1]).toBe('<RULE>');
        expect(lines[grand + 2]).toBe(padL('NC value (not charged)', 33) + padL('250.00', 11));
        expect(lines[grand + 3]).toBe('<RULE>');
        for (const none of [null, 0, undefined]) {
            expect(escposLines(buildBillEscPos(gaia({ ncValue: none }))).join('\n')).not.toContain('NC value');
        }
    });
});

describe('no value is cut, and no line leaves the print area — escpos.ts\'s layout edges', () => {
    // Restaurant_Backend/jest-tests/bill_layout_edges.test.ts `hard`, as the web
    // input. The expected lines below are the BACKEND renderer's own output for
    // that fixture, read back through escposLines — so a drift between the two
    // encoders fails here as well as in a byte comparison.
    const hard = (over: Partial<BillEscPosInput> = {}): BillEscPosInput => gaia({
        headerLines: ['GSTN : 29ABCDE1234F1Z5 / 27ABCDE1234F1Z9 (MH)'],
        customerLines: billCustomerLines('Guest', null),
        printedAt: '14/09/26 13:11',
        table: 'ZOMATO-5123456789',
        cashier: 'Venkatesh Ramakrishnan',
        billNo: '123456',
        items: [
            { name: 'Private Dining', quantity: 1, price: 150000 },
            { name: 'Butter Naan ½', quantity: 2, price: 60 },
            { name: 'Chef’s Special…', quantity: 1, price: 450 },
            { name: 'Wine', quantity: 1, price: 12000.5 },
            { name: 'Wedding Thali', quantity: 100, price: 10000 },
        ],
        subtotal: 1162690.5,
        discount: { label: 'Coupon SUPERSAVER2026EXTRA', amount: 500 },
        // Charged (10% of the discounted 1162190.50), mirroring the backend
        // fixture: a removed charge prints no line, and this fixture wants every rung.
        serviceCharge: { percent: 10, amount: 116219.05 },
        taxes: [
            { name: 'Compensation Cess on Aerated Beverages', percentage: 12, amount: 1234.5 },
            { name: 'SGST', percentage: 2.5, amount: 118.63 },
        ],
        grandTotal: 1279762.68,
        feedbackUrl: 'https://example.test/f?rid=a',
        ...over,
    });
    const ROLLS = [{ width: 48, W: 44 }, { width: 32, W: 32 }] as const;
    const QR_TAIL = ['', '<QR>', '', '', '', ''];

    it('80mm: the hard fixture prints exactly the backend\'s lines', () => {
        expect(escposLines(buildBillEscPos(hard()))).toEqual([
            'Gaia - Global Vegetarian',
            'GSTN : 29ABCDE1234F1Z5 / 27ABCDE1234F1Z9',
            '(MH)',
            '<RULE>',
            'Name:',
            '<RULE>',
            'Date: 14/09/26 13:11',
            'Dine In: ZOMATO-5123456789',
            'Cashier: Venkatesh Ramakrishnan',
            'Bill No.: 123456',
            '<RULE:THICK>',
            'Item                 Qty.    Price    Amount',
            '<RULE:THICK>',
            'Private Dining',
            '                    1 x 150000.00  150000.00',
            'Butter Naan 1?2         2    60.00    120.00',
            "Chef's Special...       1   450.00    450.00",
            'Wine                    1 12000.50  12000.50',
            'Wedding Thali',
            '                  100 x 10000.00  1000000.00',
            '<RULE:THICK>',
            '    Total Qty: 105   Sub Total    1162690.50',
            '    Coupon SUPERSAVER2026EXTRA       -500.00',
            '            Service Charge 10%     116219.05',
            '  Compensation Cess on Aerated',
            '                 Beverages 12%       1234.50',
            '                     SGST 2.5%        118.63',
            '<RULE>',
            '                   Grand Total Rs 1279762.68',
            '<RULE>',
            'A Voluntary Service Charge is included to',
            'support our staff. If you prefer not to',
            'contribute, please inform your server before',
            'payment and it will be removed.',
            '<RULE>',
            'For calling Valet kindly scan the below QR',
            'code',
            ...QR_TAIL,
        ]);
    });

    it('58mm: the hard fixture prints exactly the backend\'s lines', () => {
        expect(escposLines(buildBillEscPos(hard({ width: 32 })))).toEqual([
            'Gaia - Global Vegetarian',
            'GSTN : 29ABCDE1234F1Z5 /',
            '27ABCDE1234F1Z9 (MH)',
            '<RULE>',
            'Name:',
            '<RULE>',
            'Date: 14/09/26 13:11',
            'Dine In: ZOMATO-5123456789',
            'Cashier: Venkatesh Ramakrishnan',
            'Bill No.: 123456',
            '<RULE:THICK>',
            'Item       Qty.   Price   Amount',
            '<RULE:THICK>',
            'Private Dining',
            '        1 x 150000.00  150000.00',
            'Butter        2   60.00   120.00',
            'Naan 1?2',
            "Chef's        1  450.00   450.00",
            'Special...',
            'Wine',
            '          1 x 12000.50  12000.50',
            'Wedding Thali',
            '      100 x 10000.00  1000000.00',
            '<RULE:THICK>',
            '    Total Qty: 105',
            '         Sub Total    1162690.50',
            '            Coupon',
            'SUPERSAVER2026EXTR',
            '                 A       -500.00',
            'Service Charge 10%     116219.05',
            ' Compensation Cess',
            '        on Aerated',
            '     Beverages 12%       1234.50',
            '         SGST 2.5%        118.63',
            '<RULE>',
            '       Grand Total Rs 1279762.68',
            '<RULE>',
            'A Voluntary Service Charge is',
            'included to support our staff.',
            'If you prefer not to contribute,',
            'please inform your server before',
            'payment and it will be removed.',
            '<RULE>',
            'For calling Valet kindly scan',
            'the below QR code',
            ...QR_TAIL,
        ]);
    });

    it.each(ROLLS)('every text line fits the $W-column text area ($width cols)', ({ width, W }) => {
        const over = textLines(escposLines(buildBillEscPos(hard({ width })))).filter((l) => l.length > W);
        expect(over).toEqual([]);
    });

    it.each(ROLLS)('a date and table that do not fit side by side print one under the other, whole, the table bold ($width cols)', ({ width }) => {
        const bytes = buildBillEscPos(hard({ width }));
        const lines = escposLines(bytes);
        const at = lines.indexOf('Date: 14/09/26 13:11');
        expect(at).toBeGreaterThan(-1);
        expect(lines[at + 1]).toBe('Dine In: ZOMATO-5123456789');
        // The Dine In line is its own bold run; the date is not bold.
        expect(latin1(bytes)).toContain('Date: 14/09/26 13:11\n\x1bE\x01Dine In: ZOMATO-5123456789\x1bE\x00\n');
    });

    it('a Dine In longer than the roll wraps, and every one of its lines is bold', () => {
        const bytes = buildBillEscPos(hard({ width: 32, table: 'ZOMATO ORDER 5123456789 FAMILY PACK TAKEAWAY' }));
        expect(latin1(bytes)).toContain('\x1bE\x01Dine In: ZOMATO ORDER 5123456789\x1bE\x00\n\x1bE\x01FAMILY PACK TAKEAWAY\x1bE\x00\n');
    });

    it('a short table still shares the row with the date, the table right-aligned and bold', () => {
        const bytes = buildBillEscPos(hard({ table: '15' }));
        expect(escposLines(bytes)).toContain('Date: 14/09/26 13:11' + ' '.repeat(44 - 20 - 11) + 'Dine In: 15');
        expect(latin1(bytes)).toContain(`Date: 14/09/26 13:11${' '.repeat(13)}\x1bE\x01Dine In: 15\x1bE\x00\n`);
        // Exactly one space is enough: 20 + 1 + 23 = 44.
        expect(escposLines(buildBillEscPos(hard({ table: '12345678901234' })))).toContain('Date: 14/09/26 13:11 Dine In: 12345678901234');
        const over = escposLines(buildBillEscPos(hard({ table: '123456789012345' })));
        expect(over).toContain('Date: 14/09/26 13:11');
        expect(over).toContain('Dine In: 123456789012345');
    });

    it.each(ROLLS)('cashier and bill number that do not fit print cashier first, then bill number, whole ($width cols)', ({ width }) => {
        const lines = escposLines(buildBillEscPos(hard({ width })));
        const at = lines.indexOf('Cashier: Venkatesh Ramakrishnan');
        expect(at).toBeGreaterThan(-1);
        expect(lines[at + 1]).toBe('Bill No.: 123456');
    });

    it('cashier and bill number that fit share a row, bill number right-aligned', () => {
        expect(escposLines(buildBillEscPos(hard({ cashier: 'Anu' })))).toContain('Cashier: Anu' + ' '.repeat(44 - 12 - 16) + 'Bill No.: 123456');
    });

    it.each(ROLLS)('no cashier: the bill number alone; no bill number: the cashier alone ($width cols)', ({ width }) => {
        const noCashier = escposLines(buildBillEscPos(hard({ width, cashier: '' })));
        expect(noCashier.join('\n')).not.toContain('Cashier:');
        expect(noCashier[noCashier.indexOf('Bill No.: 123456') + 1]).toBe('<RULE:THICK>');
        const noBillNo = escposLines(buildBillEscPos(hard({ width, billNo: '' })));
        expect(noBillNo.join('\n')).not.toContain('Bill No.:');
        expect(noBillNo[noBillNo.indexOf('Cashier: Venkatesh Ramakrishnan') + 1]).toBe('<RULE:THICK>');
    });

    it('a bill number alone that is longer than the roll wraps instead of running off it', () => {
        const lines = escposLines(buildBillEscPos(hard({ width: 32, cashier: '', billNo: 'GAIA/2026-27/MALLESWARAM/000123456' })));
        const at = lines.indexOf('Bill No.:');
        expect(lines.slice(at, at + 3)).toEqual(['Bill No.:', 'GAIA/2026-27/MALLESWARAM/0001234', '56']);
    });

    it.each(ROLLS)('figures never run into each other ($width cols)', ({ width }) => {
        const text = escposLines(buildBillEscPos(hard({ width }))).join('\n');
        for (const figure of ['150000.00', '12000.50', '10000.00', '1000000.00']) {
            expect(text).toMatch(new RegExp(`(^|[ ])${figure.replace('.', '\\.')}($|[ \\n])`, 'm'));
        }
        expect(text).not.toMatch(/\d\.\d\d\d/);
        expect(text).not.toContain('1150000.00');
    });

    it('figures too wide even for their own line split "qty x price" from the amount', () => {
        const amount = (1234567.89 * 12345).toFixed(2);
        const lines = escposLines(buildBillEscPos(hard({ width: 32, items: [{ name: 'Banquet', quantity: 12345, price: 1234567.89 }] })));
        const at = lines.indexOf('Banquet');
        expect(lines.slice(at, at + 3)).toEqual(['Banquet', '12345 x 1234567.89'.padStart(32), amount.padStart(32)]);
    });

    it.each(ROLLS)('a long tax label wraps right-aligned and keeps its rate, the figure on its last line ($width cols)', ({ width }) => {
        const lines = escposLines(buildBillEscPos(hard({ width })));
        const at = lines.findIndex((l) => l.endsWith('1234.50'));
        expect(at).toBeGreaterThan(0);
        const label = lines.slice(at - 2, at + 1).map((l) => l.trim()).join(' ');
        expect(label).toContain('Compensation Cess');
        expect(label).toContain('Beverages 12% ');
    });

    it.each(ROLLS)('every ladder label ends on one edge, Round off and Grand Total included ($width cols)', ({ width }) => {
        const lines = escposLines(buildBillEscPos(hard({ width, roundOff: -0.37 })));
        const ends = ['Sub Total', 'Service Charge 10%', 'SGST 2.5%', 'Beverages 12%', 'Round off', 'Grand Total'].map((label) => {
            const row = lines.find((l) => l.includes(label)) ?? '';
            return row.indexOf(label) + label.length;
        });
        expect(ends.every((e) => e > 0)).toBe(true);
        expect(new Set(ends).size).toBe(1);
    });

    it('a label that fits is not re-wrapped: "Total Qty: n   Sub Total" keeps its three spaces', () => {
        expect(escposLines(buildBillEscPos(hard())).join('\n')).toContain('Total Qty: 105   Sub Total');
    });

    it.each(ROLLS)('a two-state GSTIN wraps whole ($width cols)', ({ width }) => {
        expect(escposLines(buildBillEscPos(hard({ width }))).join(' ')).toContain('27ABCDE1234F1Z9 (MH)');
    });

    it('folds every string to ASCII BEFORE measuring it — "…" is three characters on paper', () => {
        // 31 characters before the fold, 33 after: a wrap measured on the
        // original keeps each on one line and prints it past a 32-column roll.
        const long = 'ABCDEFGHIJKLMNOPQRSTUVWXYZABCD…';
        const lines = escposLines(buildBillEscPos(hard({
            width: 32,
            restaurantName: long,
            headerLines: [long, `GSTN : ${long}`],
            customerLines: [`Name: ${long}`, `Customer GSTIN: ${long}`],
            printedAt: long,
            table: long,
            cashier: long,
            billNo: long,
            items: [{ name: long, quantity: 1, price: 10 }],
            discount: { label: long, amount: 1 },
            taxes: [{ name: long, percentage: 5, amount: 1 }],
            serviceChargeNote: long,
            qrNote: long,
        })));
        expect(textLines(lines).filter((l) => l.length > 32)).toEqual([]);
        // eslint-disable-next-line no-control-regex
        expect(lines.join('\n')).not.toMatch(/[^\x09\x0a\x0d\x20-\x7e]/);
    });
});

describe('the owner\'s QR switch (bill_show_qr)', () => {
    const BASE = 'https://dash.example.com/feedback/';
    const user = { res_id: 'r1', employeeId: 'e1', outlet_id: 'o1' };

    it('only an explicit false turns the QR off — no settings or no key keeps it', () => {
        expect(billShowsQr({ showQr: false })).toBe(false);
        expect(billShowsQr({ showQr: true })).toBe(true);
        expect(billShowsQr({})).toBe(true);
        expect(billShowsQr({ showQr: null })).toBe(true);
        expect(billShowsQr(null)).toBe(true);
        expect(billShowsQr(undefined)).toBe(true);
    });

    it('the feedback URL is built as before when the QR is on, and is null when it is off', () => {
        expect(billFeedbackUrl(BASE, user, null)).toBe(QR_URL);
        expect(billFeedbackUrl(BASE, user, {})).toBe(QR_URL);
        expect(billFeedbackUrl(BASE, user, { showQr: true })).toBe(QR_URL);
        expect(billFeedbackUrl(BASE, user, { showQr: false })).toBeNull();
    });

    it('no base URL or a missing id still means no QR, as it always did', () => {
        expect(billFeedbackUrl('', user, null)).toBeNull();
        expect(billFeedbackUrl(BASE, { ...user, outlet_id: '' }, null)).toBeNull();
        expect(billFeedbackUrl(BASE, null, null)).toBeNull();
    });

    it('QR off: the thermal bill has no QR sentence, no QR and no rule for them — the backend\'s output', () => {
        const off = escposLines(buildBillEscPos(gaia({ feedbackUrl: billFeedbackUrl(BASE, user, { showQr: false }) })));
        expect(off).not.toContain('<QR>');
        expect(off.join('\n')).not.toContain('For calling Valet');
        const last = off.indexOf('payment and it will be removed.');
        expect(off.slice(last + 1)).toEqual(['', '', '']);

        const on = escposLines(buildBillEscPos(gaia({ feedbackUrl: billFeedbackUrl(BASE, user, null) })));
        expect(on).toContain('<QR>');
        expect(on).toContain('For calling Valet kindly scan the below QR');
    });
});

describe('billItemRow — the paper\'s figures and its "do they fit"', () => {
    it('an ordinary line fits; a figure as wide as its column does not', () => {
        expect(billItemRow(2, 325, 44)).toEqual({ qtyText: '2', priceText: '325.00', amountText: '650.00', fits: true });
        // Price 150000.00 is 9 characters = the 80mm Price column.
        expect(billItemRow(1, 150000, 44).fits).toBe(false);
        // Amount 1000000.00 is 10 = the 80mm Amount column.
        expect(billItemRow(100, 10000, 44).fits).toBe(false);
        // 12000.50 fits the 80mm Price column (9) but fills the 58mm one (8).
        expect(billItemRow(1, 12000.5, 44).fits).toBe(true);
        expect(billItemRow(1, 12000.5, 32).fits).toBe(false);
    });

    it('rounds the quantity the way the paper does', () => {
        expect(billItemRow(0, 10, 44)).toEqual({ qtyText: '1', priceText: '10.00', amountText: '10.00', fits: true });
        expect(billItemRow('3', '2.5', 44)).toEqual({ qtyText: '3', priceText: '2.50', amountText: '7.50', fits: true });
    });
});

describe('billTotals — one wording for the paper and the screen', () => {
    it('words each rung as the client\'s bill does and drops what carries no money', () => {
        const t = billTotals({
            items: [{ quantity: 2 }, { quantity: 1.4 }, { quantity: 0 }],
            subtotal: 1000,
            discount: { label: 'Coupon WELCOME', amount: 500 },
            serviceCharge: { percent: 10, amount: 50 },
            taxes: [{ name: 'SGST', percentage: 2.5, amount: 12.5 }, { name: 'Cess', percentage: 0, amount: 0 }],
            roundOff: 0.5,
        });
        expect(t.totalQty).toBe(4);
        expect(t.subtotal).toBe('1000.00');
        expect(t.rungs.map((r) => [r.label, r.value])).toEqual([
            ['Coupon WELCOME', '-500.00'],
            ['Service Charge 10%', '50.00'],
            ['SGST 2.5%', '12.50'],
        ]);
        // The server's round-off (backend migration 048), signed as the paper signs it.
        expect(t.roundOff).toBe('+0.50');
        expect(billTotals({ items: [], subtotal: 0, discount: null, serviceCharge: null, taxes: [], roundOff: -0.26 }).roundOff).toBe('-0.26');
    });

    it('a REMOVED service charge prints no rung — no zero, no "Opted-out" — and neither does a zero discount', () => {
        // The client: "don't show service charge opted out when removed ... this
        // too in the bill". A waived bill's charge arrives at zero.
        const t = billTotals({ items: [], subtotal: 0, discount: { label: 'Discount', amount: 0 }, serviceCharge: { percent: 10, amount: 0 }, taxes: [], roundOff: 0.001 });
        expect(t.rungs).toEqual([]);
        expect(t.roundOff).toBeNull();
        const page = escposLines(buildBillEscPos(gaia({ serviceCharge: { percent: 10, amount: 0 }, serviceChargeNote: null }))).join('\n');
        expect(page).not.toContain('Service Charge');
        expect(page).not.toContain('Opted-out');
    });
});

describe('the logo — two thirds of the roll, never enlarged', () => {
    it('fits inside 384 x 240 dots on 80mm, keeping its shape', () => {
        expect(billLogoFit(1200, 300)).toEqual({ width: 384, height: 96 });
        expect(billLogoFit(400, 600)).toEqual({ width: 160, height: 240 });
        expect(billLogoFit(384, 120)).toEqual({ width: 384, height: 120 });
    });

    it('a small logo stays its own size — the printer has no more dots to give it', () => {
        expect(billLogoFit(200, 50)).toEqual({ width: 200, height: 50 });
    });

    it('fits the 58mm roll inside 256 dots, and refuses an image with no size', () => {
        expect(billLogoFit(1024, 256, 384)).toEqual({ width: 256, height: 64 });
        expect(billLogoFit(0, 10)).toBeNull();
        expect(billLogoFit(10, Number.NaN)).toBeNull();
    });

    it('thresholds flattened pixels to one bit, packed MSB first, any width', () => {
        // 10 x 1: black, white, dark grey, light grey, then six black.
        const px = [
            [0, 0, 0], [255, 255, 255], [100, 100, 100], [200, 200, 200],
            [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
        ].flatMap((rgb) => [...rgb, 255]);
        const raster = billLogoRaster(px, 10, 1);
        expect(raster).not.toBeNull();
        expect(Array.from(raster ?? [])).toEqual([0x1d, 0x76, 0x30, 0x00, 2, 0, 1, 0, 0b10101111, 0b11000000]);
        expect(billLogoRaster([], 10, 1)).toBeNull();
    });
});

describe('the ESC/POS preview panel reads rules as rules', () => {
    it('shows no replacement characters and never breaks a line inside a raster', () => {
        const preview = billEscPosPreviewText(buildBillEscPos(gaia()));
        // A decoded 0x00 / 0xFF, or U+FFFD, is a raster read as text.
        // eslint-disable-next-line no-control-regex
        expect(preview).not.toMatch(/[�\x00-\x08\xff]/);
        expect(preview).toContain('━'.repeat(44));
        expect(preview).toContain('─'.repeat(44));
        expect(preview).toContain('Grand Total Rs 5538.81');
        expect(preview).toContain(`[QR ${QR_URL}]`);
    });
});

describe('the print page draws and encodes this bill', () => {
    const print = code(readSource('src/app/dashboard/orders/print/page.tsx'));
    const esc = print.slice(print.indexOf('export async function generateEscPos('));

    it('the thermal button encodes through buildBillEscPos with the preview\'s own header, slot, ladder and QR sentence', () => {
        expect(esc).toContain('return buildBillEscPos({');
        expect(esc).toContain('headerLines: billHeaderLines(profile, billPrint)');
        expect(esc).toContain('customerLines: receiptCustomerLines(printedArg, order');
        expect(esc).toContain('serviceChargeNote: billChargesForService(doc) ? BILL_SERVICE_CHARGE_NOTE : null');
        expect(esc).toContain('qrNote: billQrNote(billPrint)');
        expect(esc).toContain('reprint,');
        // The line composer that could not express margins or raster rules is gone.
        expect(print).not.toContain('receipt-printer-encoder');
        expect(print).not.toMatch(/'-'\.repeat\(/);
    });

    it('the logo raster is fitted by billLogoFit and thresholded by billLogoRaster', () => {
        const helper = print.slice(print.indexOf('async function billLogoRasterFromBase64('), print.indexOf('export async function generateEscPos('));
        expect(helper).toContain('billLogoFit(img.naturalWidth, img.naturalHeight)');
        expect(helper).toContain('billLogoRaster(ctx.getImageData(');
        expect(helper).toContain("ctx.fillStyle = '#FFFFFF'");
    });

    it('the on-screen slip has the client\'s headings, ladder and footer order — and no Thanks', () => {
        for (const heading of ['>Item</th>', '>Qty.</th>', '>Price</th>', '>Amount</th>']) {
            expect(print).toContain(heading);
        }
        expect(print).toContain('label="Grand Total"');
        expect(print).not.toContain('Grand Total:');
        expect(print).not.toMatch(/>Thanks</);
        expect(print).not.toContain('Loading QR');
        expect(print).toContain('totals.rungs.map(');
        const table = print.indexOf('data-testid="receipt-items"');
        expect(print.slice(print.lastIndexOf('<ReceiptRule', table), table)).toContain('<ReceiptRule thick />');
        expect(print.slice(print.indexOf('</table>'), print.indexOf('</table>') + 80)).toContain('<ReceiptRule thick />');
        const note = print.indexOf('data-testid="receipt-service-charge-note"');
        const qr = print.indexOf('alt="valet-qr"');
        expect(note).toBeGreaterThan(print.indexOf('label="Grand Total"'));
        expect(qr).toBeGreaterThan(note);
    });

    it('rules are solid black strokes, thicker for the item table', () => {
        const rule = print.slice(print.indexOf('function ReceiptRule('), print.indexOf('function ReceiptLadderRow('));
        expect(rule).toContain('border-black');
        expect(rule).toMatch(/thick \? 'border-t-2' : 'border-t'/);
    });

    it('the slip keeps the thermal bill\'s margins and column shares', () => {
        expect(print).toMatch(/data-testid="receipt-paper" className="[^"]*\bpx-\[4\.1667%\]/);
        expect(print).toContain('billColumns(text)');
    });

    it('QR off: the thermal button passes no feedback URL, the switch read off billPrint', () => {
        expect(esc).toMatch(/const feedbackUrl = billFeedbackUrl\([^;]*, user, billPrint\);/);
        expect(esc).toMatch(/\n\s*feedbackUrl,\s/);
        // No second, switch-blind URL builder left anywhere on the page.
        expect(print).not.toContain('new URLSearchParams({ restaurantId');
    });

    it('QR off: the on-screen slip hides the QR sentence and the QR image, and builds no QR', () => {
        expect(print).toContain('const showQr = billShowsQr(billPrint);');
        const open = print.indexOf('{showQr && qrDataUrl ? (');
        expect(open).toBeGreaterThan(-1);
        const block = print.slice(open, print.indexOf('alt="valet-qr"'));
        expect(block).toContain('{qrNote ? <p>{qrNote}</p> : null}');
        expect(print).toMatch(/const feedbackUrl = billFeedbackUrl\([^;]*, user, printSettings\);\s*if \(feedbackUrl\) \{\s*const dataUrl = await QRCode\.toDataURL\(feedbackUrl/);
    });

    it('the on-screen ladder is ONE grid, so every label ends on one edge and a figure sits on its label\'s last line', () => {
        expect(print).toMatch(/data-testid="receipt-totals" className="grid" style=\{narrow \? ladderGrid : RECEIPT_LADDER_GRID\}/);
        const row = print.slice(print.indexOf('function ReceiptLadderRow('), print.indexOf('function PrintPageContents('));
        // Two cells of the shared grid — no grid of its own per row.
        expect(row).not.toMatch(/className=\{`grid/);
        expect(row).toContain('self-end whitespace-nowrap');
        // A rule inside that grid spans both columns.
        expect(print.slice(print.indexOf('function ReceiptRule('), print.indexOf('function ReceiptLadderRow('))).toContain('col-span-full');
    });

    it('an item whose figures fill their columns gets the whole width, and its figures their own line', () => {
        // The page's paper geometry: RECEIPT_TEXT_COLUMNS on a full slip, fewer on a narrow one.
        expect(print).toContain('billItemRow(item.quantity, item.price, geo.textCols)');
        expect(print).toContain('textCols: RECEIPT_TEXT_COLUMNS,');
        expect(print).toMatch(/if \(!row\.fits\) \{[\s\S]*?<td colSpan=\{4\}[^>]*>\{itemName\}<\/td>[\s\S]*?<td colSpan=\{4\} className="[^"]*text-right[^"]*">\{`\$\{row\.qtyText\} x \$\{row\.priceText\} {2}\$\{amountText\}`\}<\/td>/);
    });

    it('Date / Dine In and Cashier / Bill No. wrap onto a second line rather than squeezing a value', () => {
        for (const id of ['receipt-date-row', 'receipt-cashier-row']) {
            expect(print).toMatch(new RegExp(`data-testid="${id}" className="flex flex-wrap justify-between`));
        }
        const rows = print.slice(print.indexOf('data-testid="receipt-date-row"'), print.indexOf('data-testid="receipt-items"'));
        expect(rows).not.toContain('shrink-0');
    });
});
