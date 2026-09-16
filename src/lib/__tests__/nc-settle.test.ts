// SETTLE AS NC ON THE DASHBOARD (client item 5), PINNED.
//
//   * the pure rules the dialog, the print page, the overview and the report
//     panels share (lib/nc-settle.ts);
//   * the web bill renderer: a comped line prints "<name> (NC)" at 0.00, so the
//     Amount column adds up to the Sub Total, and an NC-settled bill prints its
//     settlement under a 0.00 total (the backend's escpos.ts, byte for byte —
//     the byte comparison itself runs across both repos, see the lane notes);
//   * the wiring: the menu item exists, is gated on BOTH capabilities, opens a
//     dialog that posts once to settle-nc and never approves or closes; the
//     print page, the closed bill, the overview and the reports read the new
//     figures. Built-but-never-called is this project's most repeated defect.
//   * the same words as the backend and the app, read from the sibling
//     checkouts when they are there.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    NC_SETTLE_BUTTON,
    NC_SETTLE_LABEL,
    NC_SETTLE_MENU_LABEL,
    NC_SETTLE_METHOD,
    NC_SPLIT_NOTE,
    NC_WHOLE_BILL_ONLY,
    isNcSettleMethod,
    mayOfferNcSettle,
    ncBesideLine,
    ncPrintSettlement,
    ncQuote,
    ncSettleBlocker,
    ncSettleBody,
    ncSettleDoneSentence,
    ncSettleFormReady,
    ncSettleHeadline,
    ncSummaryByScope,
    readHeadlineNc,
    salesSummaryNc,
    settlementSummaryNc,
} from '../nc-settle';
import { BILL_SERVICE_CHARGE_NOTE, billItemLabel, billItemRow, billTotals, buildBillEscPos, type BillEscPosInput } from '../bill-escpos';
import { billCustomerLines } from '../bill-customer';
import { escposLines, latin1 } from './escpos-text';

const money = (n: number): string => `₹${n.toFixed(2)}`;

function readSource(relative: string): string {
    for (const base of [process.cwd(), path.join(__dirname, '..', '..', '..')]) {
        const full = path.join(base, relative);
        // A fixed list of this repo's own source files, not user input.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        if (fs.existsSync(full)) { return fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n'); }
    }
    throw new Error(`readSource could not find ${relative} from ${process.cwd()}`);
}

/** A sibling checkout's file, or '' when that repo is not beside this one. */
function sibling(repo: string, relative: string): string {
    for (const base of [path.join(process.cwd(), '..'), path.join(__dirname, '..', '..', '..', '..')]) {
        const full = path.join(base, repo, relative);
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        if (fs.existsSync(full)) { return fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n'); }
    }
    return '';
}

/** Source with comments removed, so a pin reads the CODE rather than the prose beside it. */
const code = (src: string): string => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const openBill = (over: Record<string, unknown> = {}) => ({
    subtotal: 1200,
    grand_total: 1386,
    discount: 0,
    discount_value: 0,
    coupon_code: null,
    nc_total: 0,
    payment_status: null,
    items: [
        { name: 'Paneer Tikka', price: 350, quantity: 2 },
        { name: 'Dal Makhani', price: 500, quantity: 1 },
        { name: 'Water', price: 0, quantity: 1 },
    ],
    ...over,
});

describe('who is offered it: the comp permission AND Close Bill', () => {
    it('a manager holding both, and nobody else', () => {
        expect(mayOfferNcSettle({ compItem: true, settleBill: true })).toBe(true);
        // A cashier or captain: Close Bill only.
        expect(mayOfferNcSettle({ compItem: false, settleBill: true })).toBe(false);
        // A comp-only grant cannot settle.
        expect(mayOfferNcSettle({ compItem: true, settleBill: false })).toBe(false);
        // A waiter holds neither.
        expect(mayOfferNcSettle({ compItem: false, settleBill: false })).toBe(false);
    });
});

describe('the quote and the refusals before the form opens', () => {
    it('the quote is the server\'s chargeable subtotal — what expected_value carries', () => {
        expect(ncQuote(openBill())).toEqual({ value: 1200, wouldHaveCharged: 1386, alreadyComped: 0, lines: 2 });
        expect(ncQuote(openBill({ items: [{ name: 'A', price: 100, nc: true }, { name: 'B', price: 100 }], nc_total: 100, subtotal: 100 })))
            .toEqual({ value: 100, wouldHaveCharged: 1386, alreadyComped: 100, lines: 1 });
        expect(ncQuote(null)).toBeNull();
    });

    it('nothing to refuse on an ordinary running bill', () => {
        expect(ncSettleBlocker(openBill(), { tendered: 0, tenders: [] }, money)).toBeNull();
        expect(ncSettleBlocker(openBill(), null, money)).toBeNull();
    });

    it('each refusal, in the server\'s order and words', () => {
        expect(ncSettleBlocker(null, null, money)).toBe('There is no open bill on this table to settle.');
        // A payment awaiting approval wins over everything after it.
        expect(ncSettleBlocker(openBill({ payment_status: 'pending_approval', discount: 50 }), { tendered: 10 }, money))
            .toMatch(/^A payment for this bill is already waiting for approval\./);
        expect(ncSettleBlocker(openBill({ discount: 50 }), { tendered: 400 }, money))
            .toBe('₹400.00 is already recorded as paid on this bill. Void that payment first, or comp dishes individually and take the rest.');
        expect(ncSettleBlocker(openBill({ discount: 50 }), null, money))
            .toBe('This bill carries a discount or a coupon. Remove it first — a comped bill has nothing to discount.');
        expect(ncSettleBlocker(openBill({ coupon_code: 'WELCOME' }), null, money)).toMatch(/discount or a coupon/);
        expect(ncSettleBlocker(openBill({ discount_value: 10 }), null, money)).toMatch(/discount or a coupon/);
        expect(ncSettleBlocker(openBill({ subtotal: 0, items: [] }), null, money)).toBe('There is nothing on this table to settle.');
    });

    it('a table whose every dish was comped one by one still settles here, at 0.00', () => {
        expect(ncSettleBlocker(openBill({ subtotal: 0, nc_total: 1200 }), null, money)).toBeNull();
    });
});

describe('the form and what it sends', () => {
    it('kind, reason and authoriser are all required — the reason stays required for a whole bill', () => {
        expect(ncSettleFormReady({ kind: 'complimentary', reason: 'Owner guests', authorisedBy: 'asha' })).toBe(true);
        expect(ncSettleFormReady({ kind: '', reason: 'x', authorisedBy: 'asha' })).toBe(false);
        expect(ncSettleFormReady({ kind: 'promo', reason: '   ', authorisedBy: 'asha' })).toBe(false);
        expect(ncSettleFormReady({ kind: 'promo', reason: 'x', authorisedBy: ' ' })).toBe(false);
    });

    it('the body: trimmed, the quote to the paisa, printing on — and never an amount', () => {
        const body = ncSettleBody({ kind: ' staff_meal ', reason: ' Team dinner ', authorisedBy: ' asha ', expectedValue: 1200.004 });
        expect(body).toEqual({ nc_kind: 'staff_meal', reason: 'Team dinner', authorised_by: 'asha', expected_value: 1200, print: true });
        expect(Object.keys(body)).not.toEqual(expect.arrayContaining(['amount']));
        for (const partial of ['amount', 'tenders', 'splits', 'payment_method']) {
            expect(body).not.toHaveProperty(partial);
        }
        expect(ncSettleBody({ kind: 'promo', reason: 'x', authorisedBy: 'y', expectedValue: 1, print: false }).print).toBe(false);
    });

    it('the words on the form and in the toast', () => {
        expect(ncSettleHeadline(1200, money)).toBe('NOTHING TO PAY · ₹1200.00 given away');
        expect(ncSettleDoneSentence({ bill_no: '4521', nc_value: 1200, printed: true }, money))
            .toBe('Bill 4521 was settled as non-chargeable — ₹1200.00 given away, nothing collected. The NC bill is printing.');
        expect(ncSettleDoneSentence({ bill_no: null, nc_value: 5, printed: false, print_error: 'No printer online' }, money))
            .toBe('The bill was settled as non-chargeable — ₹5.00 given away, nothing collected. The NC bill did not print: No printer online');
        expect(ncSettleDoneSentence({ bill_no: '7', already: true }, money)).toBe('Bill 7 was already settled as non-chargeable.');
    });
});

describe('reading the NC figures back', () => {
    it('the marker, however it was stored', () => {
        expect(NC_SETTLE_METHOD).toBe('NC');
        expect(isNcSettleMethod('NC')).toBe(true);
        expect(isNcSettleMethod(' nc ')).toBe(true);
        expect(isNcSettleMethod('Cash')).toBe(false);
        expect(isNcSettleMethod(null)).toBe(false);
    });

    it('the settled NC bill\'s paper block — only for an NC bill that carries one', () => {
        const settled = { payment_method: 'NC', nc_settlement: { kind_label: 'Staff meal', authorised_by: 'asha', would_have_charged: 1386 } };
        expect(ncPrintSettlement(settled)).toEqual({ kind: 'Staff meal', authorisedBy: 'asha', wouldHaveCharged: 1386 });
        expect(ncPrintSettlement({ ...settled, nc_settlement: { ...settled.nc_settlement, would_have_charged: null } })?.wouldHaveCharged).toBeNull();
        expect(ncPrintSettlement({ payment_method: 'Cash', nc_settlement: settled.nc_settlement })).toBeNull();
        expect(ncPrintSettlement({ payment_method: 'NC' })).toBeNull();
        expect(ncPrintSettlement(null)).toBeNull();
    });

    it('the overview line: labelled, and absent when there is nothing or no label', () => {
        const h = { today_nc: { label: 'Non-chargeable (NC) — not collected', hint: 'Given away today…', bills: 2, value: 1450.5 } };
        expect(readHeadlineNc(h)).toEqual({ label: 'Non-chargeable (NC) — not collected', hint: 'Given away today…', bills: 2, value: 1450.5 });
        expect(ncBesideLine(readHeadlineNc(h)!, money)).toBe('2 NC bills · ₹1450.50 given away');
        expect(ncBesideLine({ bills: 1, value: 0 }, money)).toBe('1 NC bill · ₹0.00 given away');
        // Item comps alone still show: something was given away today.
        expect(readHeadlineNc({ today_nc: { ...h.today_nc, bills: 0, value: 80 } })?.value).toBe(80);
        expect(readHeadlineNc({ today_nc: { ...h.today_nc, bills: 0, value: 0 } })).toBeNull();
        expect(readHeadlineNc({ today_nc: { ...h.today_nc, label: '  ' } })).toBeNull();
        expect(readHeadlineNc({})).toBeNull();
        expect(readHeadlineNc(null)).toBeNull();
    });

    it('the report figures beside the ladders', () => {
        expect(salesSummaryNc({ nc_bills: 1, nc_value: 1200 })).toEqual({ bills: 1, value: 1200 });
        expect(salesSummaryNc({ nc_bills: 0, nc_value: 0 })).toBeNull();
        expect(salesSummaryNc({})).toBeNull();
        expect(settlementSummaryNc({ nc: { bills: 1, value: 1200 } })).toEqual({ bills: 1, value: 1200 });
        expect(settlementSummaryNc({ nc: { bills: 0, value: 0 } })).toBeNull();
        expect(settlementSummaryNc({})).toBeNull();
        expect(ncSummaryByScope({
            by_scope: [
                { scope: 'item', label: 'Item comped', entries: 0, quantity: 0, loss: 0 },
                { scope: 'bill', label: 'Bill settled as NC', entries: 3, quantity: 4, loss: 1200 },
            ],
        })).toEqual([{ scope: 'bill', label: 'Bill settled as NC', entries: 3, loss: 1200 }]);
        expect(ncSummaryByScope({})).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// The paper
// ---------------------------------------------------------------------------

function bill(over: Partial<BillEscPosInput> = {}): BillEscPosInput {
    return {
        width: 48,
        reprint: false,
        logo: null,
        restaurantName: 'Gaia - Global Vegetarian',
        headerLines: ['Gaia Hospitality Pvt Ltd', 'GSTN : 29ABCDE1234F1Z5'],
        customerLines: billCustomerLines('Guest', null),
        printedAt: '16/09/26 20:15',
        table: 'T12',
        cashier: 'Biller One',
        billNo: '4521',
        currency: '₹',
        items: [
            { name: 'Paneer Tikka', quantity: 1, price: 350 },
            { name: 'Gulab Jamun', quantity: 2, price: 120, nc: true },
        ],
        subtotal: 350,
        discount: null,
        serviceCharge: null,
        taxes: [
            { name: 'SGST', percentage: 2.5, amount: 8.75 },
            { name: 'CGST', percentage: 2.5, amount: 8.75 },
        ],
        roundOff: 0.5,
        grandTotal: 368,
        serviceChargeNote: null,
        feedbackUrl: null,
        qrNote: '',
        ...over,
    };
}

describe('an NC line on the web bill: "(NC)" and 0.00, so the Amount column adds up to the Sub Total', () => {
    it('80mm and 58mm', () => {
        for (const width of [48, 32]) {
            const lines = escposLines(buildBillEscPos(bill({ width })));
            const jamun = lines.find((l) => /\s2\s+120\.00\s+0\.00$/.test(l));
            const paneer = lines.find((l) => /\s1\s+350\.00\s+350\.00$/.test(l));
            expect(jamun).toBeDefined();
            // The name wraps on 58mm; the marker is on the dish's own lines.
            const at = lines.indexOf(jamun!);
            expect(width === 48 ? jamun : `${jamun!.split(/\s{2,}/)[0]} ${lines[at + 1]}`).toMatch(/^Gulab Jamun \(NC\)/);
            expect(paneer).toBeDefined();
            expect(lines.some((l) => /Sub Total\s+350\.00$/.test(l))).toBe(true);
            // Given away, disclosed UNDER the total and never in it.
            const nc = lines.findIndex((l) => /NC value \(not charged\)\s+240\.00$/.test(l));
            const grand = lines.findIndex((l) => /Grand Total\s+Rs 368\.00$/.test(l));
            expect(grand).toBeGreaterThan(-1);
            expect(nc).toBeGreaterThan(grand);
        }
    });

    it('a bill with no comped line prints exactly what it did before the flag', () => {
        const plain = bill({ items: [{ name: 'Paneer Tikka', quantity: 1, price: 350 }] });
        const flagged = bill({ items: [{ name: 'Paneer Tikka', quantity: 1, price: 350, nc: false }] });
        expect(Buffer.from(buildBillEscPos(flagged)).equals(Buffer.from(buildBillEscPos(plain)))).toBe(true);
        expect(escposLines(buildBillEscPos(plain)).join('\n')).not.toContain('NC value');
        expect(billTotals(plain).ncValue).toBeNull();
    });

    it('the row and the label are the ones the on-screen slip uses', () => {
        expect(billItemRow(2, 120, 44, true)).toEqual({ qtyText: '2', priceText: '120.00', amountText: '0.00', fits: true });
        expect(billItemRow(2, 120, 44)).toEqual({ qtyText: '2', priceText: '120.00', amountText: '240.00', fits: true });
        expect(billItemLabel('Gulab Jamun', true)).toBe('Gulab Jamun (NC)');
        expect(billItemLabel('Gulab Jamun', false)).toBe('Gulab Jamun');
        expect(billItemLabel('Gulab Jamun')).toBe('Gulab Jamun');
        // A figure too wide for its column still reads 0.00 on the line under it.
        const wide = escposLines(buildBillEscPos(bill({ items: [{ name: 'Private Dining', quantity: 1, price: 150000, nc: true }], subtotal: 0 })));
        expect(wide.some((l) => /1 x 150000\.00\s+0\.00$/.test(l))).toBe(true);
    });
});

describe('a bill SETTLED AS NC prints its settlement under a 0.00 total', () => {
    const nc = bill({
        items: [
            { name: 'Paneer Tikka', quantity: 1, price: 350, nc: true },
            { name: 'Gulab Jamun', quantity: 2, price: 120, nc: true },
        ],
        subtotal: 0,
        taxes: [],
        roundOff: 0,
        grandTotal: 0,
        reprint: true,
        settlement: { kind: 'Staff meal', authorisedBy: 'asha', wouldHaveCharged: 624.75 },
    });

    it('Grand Total 0.00, the NC value, and who said so, in escpos.ts\'s order', () => {
        const lines = escposLines(buildBillEscPos(nc));
        const at = (re: RegExp): number => lines.findIndex((l) => re.test(l));
        const grand = at(/Grand Total\s+Rs 0\.00$/);
        const value = at(/NC value \(not charged\)\s+590\.00$/);
        const settled = at(/^Settled: Non-chargeable - Staff meal$/);
        const by = at(/^Authorised by: asha$/);
        const would = at(/Would have been \(incl\. tax\)\s+624\.75$/);
        expect(grand).toBeGreaterThan(-1);
        expect(value).toBeGreaterThan(grand);
        expect(settled).toBeGreaterThan(value);
        expect(by).toBe(settled + 1);
        expect(would).toBe(by + 1);
        expect(lines[would + 1]).toBe('<RULE>');
        expect(lines.some((l) => /SGST|Service Charge|Round off/.test(l))).toBe(false);
        // The settlement words are bold.
        expect(latin1(buildBillEscPos(nc))).toContain('\x1bE\x01Settled: Non-chargeable - Staff meal\n\x1bE\x00');
    });

    it('the would-have-been line is left out when it is not known', () => {
        const lines = escposLines(buildBillEscPos({ ...nc, settlement: { kind: 'Staff meal', authorisedBy: 'asha', wouldHaveCharged: null } }));
        expect(lines.join('\n')).not.toContain('Would have been');
        expect(lines.join('\n')).toContain('Authorised by: asha');
    });

    it('the service-charge sentence never prints on a bill that charged nothing', () => {
        expect(latin1(buildBillEscPos(nc))).not.toContain(BILL_SERVICE_CHARGE_NOTE.slice(0, 20));
    });
});

// ---------------------------------------------------------------------------
// The wiring
// ---------------------------------------------------------------------------

describe('the dashboard reaches the route', () => {
    const orders = code(readSource('src/app/dashboard/orders/page.tsx'));
    const dialog = code(readSource('src/app/dashboard/orders/nc-settle-dialog.tsx'));
    const db = readSource('src/lib/db.ts');

    it('db.ts posts to /bills/order/:orderId/settle-nc', () => {
        expect(db).toMatch(/export const settleBillAsNonChargeable = async \(/);
        expect(db).toContain('`/bills/order/${encodeURIComponent(orderId)}/settle-nc`');
    });

    it('the Confirm Payment submenu offers it, below Split payment, only to a session holding both gates', () => {
        expect(orders).toContain('const canNcSettle = mayOfferNcSettle({ compItem: can(user, "comp_item"), settleBill: canSettleBill });');
        const split = orders.indexOf('Split payment…');
        const item = orders.indexOf('{NC_SETTLE_MENU_LABEL}');
        expect(split).toBeGreaterThan(-1);
        expect(item).toBeGreaterThan(split);
        expect(orders.slice(split, item)).toContain('{canNcSettle ? (');
        expect(orders.slice(split, item)).toContain('setNcSettleOrder(order)');
        // …and before the submenu closes.
        expect(item).toBeLessThan(orders.indexOf('</DropdownMenuSubContent>', split));
        expect(orders).toMatch(/\{ncSettleOrder && canNcSettle && user\?\.restaurantUsername \? \(\s*<NcSettleDialog/);
    });

    it('the split form never offers NC, and says where it lives', () => {
        const splitDialog = orders.slice(orders.indexOf('Split payment · Table'), orders.indexOf('Record split payment'));
        expect(splitDialog).toContain('{NC_SPLIT_NOTE}');
        expect(splitDialog).toContain('tillOptions.map(');
        expect(splitDialog).not.toContain('NC_SETTLE');
    });

    it('the dialog posts ONCE, with the server\'s quote, and never approves or closes', () => {
        expect(dialog).toContain('settleBillAsNonChargeable(restaurantId, order.id, ncSettleBody({');
        expect(dialog).toContain('kind, reason, authorisedBy, expectedValue: quote.value,');
        expect(dialog).not.toMatch(/approveBillPaymentByAdmin|closeBillByOrder|confirmBillPaymentByWaiter/);
        expect(dialog).toContain('ncSettleBlocker(bill, tenders, money)');
        expect(dialog).toContain('{NC_SETTLE_BUTTON}');
        expect(dialog).toContain('{NC_WHOLE_BILL_ONLY}');
        expect(dialog).toContain('disabled={busy || !ready}');
        // The reason box is required here — no optional label.
        expect(dialog).toMatch(/<Label htmlFor="nc-settle-reason">Reason<\/Label>/);
    });

    it('the paper, the closed bill, the overview and the reports read the new figures', () => {
        const print = code(readSource('src/app/dashboard/orders/print/page.tsx'));
        expect(print.match(/\.\.\.\(it\?\.nc === true \? \{ nc: true \} : \{\}\)/g)).toHaveLength(2);
        expect(print).toContain('settlement: ncPrintSettlement(settled),');
        expect(print).toContain('settlement: doc.settlement,');
        expect(print).toContain('label="NC value (not charged)"');
        const closed = code(readSource('src/components/closed-bills.tsx'));
        expect(closed).toContain('billItemLabel(it.name, it.nc)');
        expect(closed).toContain('d.nc_settlement ? (');
        const headline = code(readSource('src/components/headline-stats.tsx'));
        // BESIDE the by-method block: its own section, after it.
        expect(headline.indexOf('{ncBeside(data)}')).toBeGreaterThan(headline.indexOf('{byMethod(data)}'));
        expect(headline).toContain('const nc = readHeadlineNc(h)');
        const panels = code(readSource('src/app/dashboard/reports/context-panels.tsx'));
        expect(panels).toContain('salesSummaryNc(totals)');
        expect(panels).toContain('settlementSummaryNc(totals)');
        expect(panels).toContain('ncSummaryByScope(payload)');
    });
});

describe('the same words as the backend and the app', () => {
    it('the labels', () => {
        expect(NC_SETTLE_LABEL).toBe('Non-chargeable (NC)');
        expect(NC_SETTLE_MENU_LABEL).toBe('Non-chargeable (NC)…');
        expect(NC_SETTLE_BUTTON).toBe('Settle as NC');
        expect(NC_SPLIT_NOTE).toContain('comp those dishes first');
    });

    it('the backend (when its checkout is beside this one)', () => {
        const methods = sibling('Restaurant_Backend', 'payment_methods.ts');
        const rules = sibling('Restaurant_Backend', 'nc_settle.ts');
        if (!methods || !rules) { return; }
        expect(methods).toContain(`export const NC_SETTLE_LABEL = "${NC_SETTLE_LABEL}";`);
        expect(methods).toContain(`export const NC_SETTLE_METHOD = "${NC_SETTLE_METHOD}";`);
        expect(rules).toContain(`"${NC_WHOLE_BILL_ONLY}"`);
    });

    it('the app (when its checkout is beside this one)', () => {
        const app = sibling('restaurant_owner_app', path.join('lib', 'models', 'nc_settle.dart'));
        if (!app) { return; }
        expect(app).toContain(`'${NC_SETTLE_LABEL}'`);
        expect(app).toContain(`'${NC_SETTLE_BUTTON}'`);
        expect(app).toContain(`'${NC_WHOLE_BILL_ONLY}'`);
    });
});
