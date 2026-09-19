// R2 ITEM 1 (name + GSTIN on a live table and a past bill) AND THE WEB HALF OF
// ITEM 4 (REPRINT on the preview), pinned.
//
// The pure half is exercised directly. The page components have no DOM harness
// in this repo (jest runs in node over src/lib), so where the requirement is
// about WHERE something is drawn they are pinned by reading the source, the way
// floorplan-and-bill-template.test.ts pins 5.1.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    GSTIN_FORMAT_ERROR,
    OUTDATED_SERVER_MESSAGE,
    billCustomerLines,
    billCustomerPayload,
    billCustomerSaveOutcome,
    billCustomerSeed,
    canEditSettledBillCustomer,
    gstinAsTyped,
    gstinError,
    gstinToSend,
    isPlaceholderCustomer,
    normalizeGstin,
} from '../bill-customer';
import { buildBillEscPos } from '../bill-escpos';
import { REPRINT_MARKER } from '../bill-print-state';
import { escposLines } from './escpos-text';

function readSource(relative: string): string {
    for (const base of [process.cwd(), path.join(__dirname, '..', '..', '..')]) {
        const full = path.join(base, relative);
        // A fixed list of this repo's own source files, not user input.
         
        if (fs.existsSync(full)) { return fs.readFileSync(full, 'utf8'); }
    }
    throw new Error(`readSource could not find ${relative} from ${process.cwd()}`);
}

/** Source with comments removed, so a pin reads the CODE rather than the prose beside it. */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('GSTIN — normalised and validated exactly as the server does', () => {
    it('uppercases and strips spaces as they type', () => {
        expect(gstinAsTyped('29abcde1234f1z5')).toBe('29ABCDE1234F1Z5');
        expect(gstinAsTyped('29 abcde 1234 f1z5')).toBe('29ABCDE1234F1Z5');
        expect(gstinAsTyped(' 29\tABCDE1234F1Z5 ')).toBe('29ABCDE1234F1Z5');
    });

    it('sends the normalised value, and null for an empty box — which clears it', () => {
        expect(normalizeGstin('  29abcde1234f1z5 ')).toBe('29ABCDE1234F1Z5');
        expect(normalizeGstin('')).toBeNull();
        expect(normalizeGstin('   ')).toBeNull();
        expect(normalizeGstin(null)).toBeNull();
        expect(normalizeGstin(undefined)).toBeNull();
    });

    it('accepts a well-formed GSTIN and an empty box', () => {
        expect(gstinError('29ABCDE1234F1Z5')).toBeNull();
        expect(gstinError('07aaacb2230m1zv')).toBeNull();
        expect(gstinError('27AAPFU0939F1ZV')).toBeNull();
        expect(gstinError('')).toBeNull();
        expect(gstinError('   ')).toBeNull();
    });

    it('refuses anything else with the server\'s own sentence', () => {
        for (const bad of [
            '29ABCDE1234F1Z',     // 14 chars
            '29ABCDE1234F1Z55',   // 16 chars
            'AB29CDE1234F1Z5',    // letters where the state code goes
            '29ABCDE1234F0Z5',    // 13th char may not be 0
            '29ABCDE1234F1X5',    // 14th char must be Z
            '29ABCD11234F1Z5',    // digit inside the PAN letters
            '29ABCDE1234F1Z-',    // punctuation
        ]) {
            expect(gstinError(bad)).toBe(GSTIN_FORMAT_ERROR);
        }
        expect(GSTIN_FORMAT_ERROR).toBe('GSTIN must be 15 characters, e.g. 29ABCDE1234F1Z5');
    });
});

describe('the dialog payload — one dialog, two routes', () => {
    it('a LIVE TABLE saves through POST /bills/customer-name with {table_name, customer, customer_gstin}', () => {
        expect(billCustomerPayload({ kind: 'table', tableName: 'T4' }, 'Acme Pvt Ltd', '29abcde1234f1z5')).toEqual({
            path: '/bills/customer-name',
            body: { table_name: 'T4', customer: 'Acme Pvt Ltd', customer_gstin: '29ABCDE1234F1Z5' },
        });
    });

    it('a PAST BILL saves through POST /bills/:billId/customer-details with {customer, customer_gstin}', () => {
        expect(billCustomerPayload({ kind: 'bill', billId: 'b-1/2', billNo: '42' }, 'Acme', '29ABCDE1234F1Z5')).toEqual({
            path: '/bills/b-1%2F2/customer-details',
            body: { customer: 'Acme', customer_gstin: '29ABCDE1234F1Z5' },
        });
    });

    it('an emptied GSTIN box is sent as null, which clears it on both routes', () => {
        expect(billCustomerPayload({ kind: 'table', tableName: 'T4' }, 'Mr Rao', '').body).toEqual({
            table_name: 'T4', customer: 'Mr Rao', customer_gstin: null,
        });
        expect(billCustomerPayload({ kind: 'bill', billId: 'b1' }, '', '  ').body).toEqual({
            customer: '', customer_gstin: null,
        });
    });

    it('a GSTIN the dialog never knew and nobody touched stays OFF the wire (the route reads that as unchanged)', () => {
        const body = billCustomerPayload({ kind: 'table', tableName: 'T4' }, 'Mr Rao', undefined).body;
        expect(body).toEqual({ table_name: 'T4', customer: 'Mr Rao' });
        expect('customer_gstin' in body).toBe(false);
    });

    it('gstinToSend: known or touched sends the box; neither leaves it off', () => {
        expect(gstinToSend('29ABCDE1234F1Z5', true, false)).toBe('29ABCDE1234F1Z5');
        expect(gstinToSend('', true, false)).toBe('');
        expect(gstinToSend('', false, true)).toBe('');
        expect(gstinToSend('', false, false)).toBeUndefined();
    });

    it('db.ts sends both routes through that builder, and returns (not throws) the outcome', () => {
        const db = code(readSource('src/lib/db.ts'));
        expect(db).toMatch(/billCustomerPayload\(\{ kind: 'table', tableName \}, customer, customerGstin\)/);
        expect(db).toMatch(/billCustomerPayload\(\{ kind: 'bill', billId \}, customer, customerGstin\)/);
        expect(db).toMatch(/export const setSettledBillCustomerDetails = async/);
        expect(db).toMatch(/billCustomerSaveOutcome\(response\.status, text, 'customer_gstin' in request\.body\)/);
    });
});

describe('seeding the dialog', () => {
    it('seeds the current name and GSTIN, never the Guest placeholder', () => {
        expect(billCustomerSeed({ customer: 'Acme', customer_gstin: '29ABCDE1234F1Z5' }))
            .toEqual({ customer: 'Acme', gstin: '29ABCDE1234F1Z5', gstinKnown: true });
        expect(billCustomerSeed({ customer: 'Guest', customer_gstin: null }))
            .toEqual({ customer: '', gstin: '', gstinKnown: true });
        expect(billCustomerSeed({ customer: 'QR Guest' }).customer).toBe('');
    });

    it('a payload without the key (older backend) or no payload at all does not KNOW the GSTIN', () => {
        expect(billCustomerSeed({ customer: 'Acme' })).toEqual({ customer: 'Acme', gstin: '', gstinKnown: false });
        expect(billCustomerSeed(null)).toEqual({ customer: '', gstin: '', gstinKnown: false });
    });
});

describe('what came back — the server\'s sentence verbatim, and old backends degrade', () => {
    it('reads the saved name and GSTIN off a success', async () => {
        await expect(billCustomerSaveOutcome(200, JSON.stringify({ success: true, customer: 'Acme', customer_gstin: '29ABCDE1234F1Z5', orders_updated: 2 }), true))
            .resolves.toEqual({ ok: true, customer: 'Acme', customer_gstin: '29ABCDE1234F1Z5', gstinSaved: true });
        await expect(billCustomerSaveOutcome(200, JSON.stringify({ success: true, bill_id: 'b1', customer: null, customer_gstin: null }), true))
            .resolves.toEqual({ ok: true, customer: null, customer_gstin: null, gstinSaved: true });
    });

    it('a success WITHOUT customer_gstin after sending one is an old backend: the GSTIN was not saved', async () => {
        const r = await billCustomerSaveOutcome(200, JSON.stringify({ success: true, customer: 'Acme', orders_updated: 1 }), true);
        expect(r).toEqual({ ok: true, customer: 'Acme', customer_gstin: null, gstinSaved: false });
        // …and nothing is wrong when no GSTIN was sent in the first place.
        const plain = await billCustomerSaveOutcome(200, JSON.stringify({ success: true, customer: 'Acme', orders_updated: 1 }), false);
        expect(plain.ok && plain.gstinSaved).toBe(true);
    });

    it('a 404 with no sentence (Express\'s "Cannot POST") is a server that has not finished updating', async () => {
        const html = '<!DOCTYPE html><html><body><pre>Cannot POST /bills/b1/customer-details</pre></body></html>';
        await expect(billCustomerSaveOutcome(404, html, true))
            .resolves.toEqual({ ok: false, outdated: true, message: OUTDATED_SERVER_MESSAGE, status: 404 });
        expect(OUTDATED_SERVER_MESSAGE).toMatch(/^This server has not finished updating/);
        await expect(billCustomerSaveOutcome(404, '', true)).resolves.toMatchObject({ outdated: true });
    });

    it('a 404 that SAYS something ("Bill not found") is a real refusal, shown verbatim', async () => {
        await expect(billCustomerSaveOutcome(404, JSON.stringify({ error: 'Bill not found' }), true))
            .resolves.toEqual({ ok: false, outdated: false, message: 'Bill not found', status: 404 });
    });

    it('the GSTIN 400, a 403 and the migration 503 all reach the person word for word', async () => {
        await expect(billCustomerSaveOutcome(400, JSON.stringify({ error: GSTIN_FORMAT_ERROR }), true))
            .resolves.toMatchObject({ ok: false, outdated: false, message: GSTIN_FORMAT_ERROR });
        await expect(billCustomerSaveOutcome(403, JSON.stringify({ error: 'Forbidden', details: 'Editing a settled bill needs the Accounting permission.' }), true))
            .resolves.toMatchObject({ ok: false, message: 'Editing a settled bill needs the Accounting permission.' });
        await expect(billCustomerSaveOutcome(503, JSON.stringify({ error: 'This server has not finished updating — try again shortly' }), true))
            .resolves.toMatchObject({ ok: false, outdated: false, message: 'This server has not finished updating — try again shortly' });
    });
});

describe('the customer slot on the printed bill — as on the client\'s own receipt', () => {
    it('prints Name, then Customer GSTIN when one is set — worded as the client\'s bill words it', () => {
        expect(billCustomerLines('Acme Pvt Ltd', '29ABCDE1234F1Z5')).toEqual([
            'Name: Acme Pvt Ltd',
            'Customer GSTIN: 29ABCDE1234F1Z5',
        ]);
    });

    it('always has the name slot: a walk-in leaves it blank ("Name:"), as the client\'s and the thermal bill do', () => {
        for (const empty of ['', '   ', null, undefined, 'null']) {
            expect(billCustomerLines(empty, null)).toEqual(['Name:']);
        }
        // The placeholders the ordering flows store are not names, so they do
        // not fill the slot either — escpos.ts's /^(qr )?guest$/i.
        for (const placeholder of ['Guest', 'guest', 'QR Guest', 'qr guest']) {
            expect(billCustomerLines(placeholder, null)).toEqual(['Name:']);
        }
        expect(billCustomerLines('', '29ABCDE1234F1Z5')).toEqual(['Name:', 'Customer GSTIN: 29ABCDE1234F1Z5']);
        // A real name that merely contains the word is still a name.
        expect(billCustomerLines('Guest House Pvt Ltd', null)).toEqual(['Name: Guest House Pvt Ltd']);
    });

    it('prints no GSTIN line when there is none', () => {
        expect(billCustomerLines('Mr Rao', null)).toEqual(['Name: Mr Rao']);
        expect(billCustomerLines('Mr Rao', '')).toEqual(['Name: Mr Rao']);
        expect(billCustomerLines('Mr Rao', 'null')).toEqual(['Name: Mr Rao']);
        expect(billCustomerLines('Mr Rao', undefined)).toEqual(['Name: Mr Rao']);
    });

    it('Guest / QR Guest are still placeholders for the dialog and the table preview', () => {
        for (const placeholder of ['Guest', 'guest', 'QR Guest', 'qr guest', '', '   ', null, undefined, 'null']) {
            expect(isPlaceholderCustomer(placeholder)).toBe(true);
        }
        expect(isPlaceholderCustomer('Mr Rao')).toBe(false);
    });

    it('the web print page draws the slot under the restaurant header and ABOVE Date / Bill No., with a rule after it', () => {
        const print = code(readSource('src/app/dashboard/orders/print/page.tsx'));
        const banner = print.indexOf('{REPRINT_MARKER}');
        const header = print.indexOf('billHeaderLines(profile, billPrint).map(');
        const slot = print.indexOf('receiptCustomerLines(printed, order).map(');
        const dateRow = print.indexOf('data-testid="receipt-date-row"');
        const cashierRow = print.indexOf('Cashier: {shownCashier}');
        const billNoRow = print.indexOf('Bill No.: {shownBillNo}');
        expect(banner).toBeGreaterThan(-1);
        expect(header).toBeGreaterThan(banner);
        expect(slot).toBeGreaterThan(header);
        expect(dateRow).toBeGreaterThan(slot);
        // Cashier on the left, then Bill No. on the right — the client's order.
        expect(cashierRow).toBeGreaterThan(dateRow);
        expect(billNoRow).toBeGreaterThan(cashierRow);
        // The rule between the customer slot and the Date row — and the rule is
        // a solid black stroke.
        expect(print.slice(slot, dateRow)).toContain('<ReceiptRule />');
        const rule = print.slice(print.indexOf('function ReceiptRule('), print.indexOf('function ReceiptLadderRow('));
        expect(rule).toMatch(/border-black/);
        expect(rule).toMatch(/border-t/);
        // Exactly one place draws it — nothing left under Bill No./Cashier.
        expect(print.split('receiptCustomerLines(printed, order)').length - 1).toBe(1);
    });

    it('its ESC/POS twin prints the same slot in the same place: after the header rule, before Date', () => {
        // WHERE: read off the bytes the thermal button actually sends. The
        // encoder is lib/bill-escpos.ts (see bill-escpos.test.ts for the whole
        // layout); here, only the slot's place in it.
        const lines = escposLines(buildBillEscPos({
            width: 48,
            reprint: true,
            restaurantName: 'Gaia - Global Vegetarian',
            headerLines: ['Gaia Hospitality Pvt Ltd', 'GSTN : 29ABCDE1234F1Z5'],
            customerLines: billCustomerLines('Acme Pvt Ltd', '29AAACA1234A1Z5'),
            printedAt: '14/09/26 20:15',
            table: 'T12',
            cashier: 'Biller One',
            billNo: '4521',
            currency: '₹',
            items: [{ name: 'Masala Chaas', quantity: 1, price: 150 }],
            subtotal: 150,
            discount: null,
            serviceCharge: null,
            taxes: [],
            roundOff: null,
            grandTotal: 150,
            serviceChargeNote: null,
            feedbackUrl: null,
            qrNote: '',
        }));
        const reprint = lines.indexOf(REPRINT_MARKER);
        const gstn = lines.indexOf('GSTN : 29ABCDE1234F1Z5');
        const name = lines.indexOf('Name: Acme Pvt Ltd');
        const date = lines.findIndex((l) => l.startsWith('Date: '));
        const billNo = lines.findIndex((l) => l.startsWith('Cashier: ') && l.endsWith('Bill No.: 4521'));
        expect(reprint).toBe(0);
        expect(gstn).toBeGreaterThan(reprint);
        expect(lines[gstn + 1]).toBe('<RULE>');
        expect(name).toBe(gstn + 2);
        expect(lines[name + 1]).toBe('Customer GSTIN: 29AAACA1234A1Z5');
        expect(lines[name + 2]).toBe('<RULE>');
        expect(date).toBe(name + 3);
        expect(billNo).toBe(date + 1);

        // WHICH: the page hands the encoder the preview's own helpers, once.
        const print = code(readSource('src/app/dashboard/orders/print/page.tsx'));
        const esc = print.slice(print.indexOf('export async function generateEscPos('));
        expect(esc).toContain('headerLines: billHeaderLines(profile, billPrint)');
        expect(esc).toContain('customerLines: receiptCustomerLines(printedArg, order');
        expect(esc).toContain('reprint,');
        expect(esc.split('receiptCustomerLines(').length - 1).toBe(1);
    });

    it('the print page takes the name and GSTIN off the server document, not the stale order payload', () => {
        const print = code(readSource('src/app/dashboard/orders/print/page.tsx'));
        expect(print).toContain("customer: docField(settled as Record<string, unknown>, 'customer')");
        expect(print).toContain("customerGstin: docField(settled as Record<string, unknown>, 'customer_gstin')");
        expect(print).toContain("customer: docField(openBill as Record<string, unknown>, 'customer')");
        expect(print).toContain("customerGstin: docField(openBill as Record<string, unknown>, 'customer_gstin')");
    });

    it('Accounting\'s bill views show the GSTIN when the server sends the field', () => {
        // The rebuilt sheet draws the paper's own customer slot (finding 38):
        // "Customer GSTIN:" whenever the server sent one, and the list row chips it.
        const closed = code(readSource('src/components/closed-bills.tsx'));
        expect(closed).toContain('const customerLines = settledBillCustomerLines(d)');
        expect(closed).toContain('{customerLines.map((l, i) => <div key={i}>{l}</div>)}');
        expect(closed).toContain('const gstin = (bill.customer_gstin ?? "").trim()');
        expect(code(readSource('src/components/history/settled-bill-lib.ts'))).toContain("...(gstin === '' ? [] : [`Customer GSTIN: ${gstin}`]),");
        expect(code(readSource('src/components/reports/drill-down.tsx'))).toMatch(/"customer_gstin" in bill \? <Field label="Customer GSTIN"/);
    });
});

describe('where the edit is offered, and to whom', () => {
    it('a past bill: only with the permission the E5 settled reprint route requires', () => {
        const ACCOUNTING = 'df75119b-e5f1-4f38-aba5-78a1cf182f56';
        expect(canEditSettledBillCustomer({ actions_set: [ACCOUNTING] })).toBe(true);
        expect(canEditSettledBillCustomer({ actions_set: ['*'] })).toBe(true);
        expect(canEditSettledBillCustomer({ actions_set: ['4ad474d4-5230-449c-874f-6a238b833bca'] })).toBe(false);
        expect(canEditSettledBillCustomer({ actions_set: [] })).toBe(false);
        expect(canEditSettledBillCustomer(null)).toBe(false);

        const closed = code(readSource('src/components/closed-bills.tsx'));
        expect(closed).toContain('const canEditCustomer = canEditSettledBillCustomer(user)');
        // The list row offers the shared settled-bill editor only behind the gate…
        expect(closed).toMatch(/edit=\{canEditCustomer \? \(\s*<EditSettledBillCustomerButton/);
        // …and the detail sheet offers it beside Reprint, behind the same permission.
        expect(closed).toContain('const canWrite = canEditSettledBillCustomer(user)');
        const gated = closed.slice(closed.indexOf('{canWrite && ('));
        expect(gated.indexOf('<EditSettledBillCustomerButton')).toBeGreaterThan(-1);
    });

    it('a live table: the line at the top of the preview card for everyone with orders; Edit only as the 6.5 Bill menu', () => {
        const preview = code(readSource('src/app/dashboard/orders/table-kot-preview.tsx'));
        // Read-only for a waiter, as in the owner app: neither field is money.
        expect(preview).toContain('const showCustomer = blocks.length > 0;');
        expect(preview).toMatch(/\{canEditCustomer \? \(\s*<>\s*<Button[\s\S]{0,200}Edit name \/ GSTIN \/ address[\s\S]*?<BillCustomerDialog/);
        const strip = preview.indexOf('data-testid="table-bill-customer"');
        const controls = preview.indexOf('<PlusCircle /> Add Order');
        expect(strip).toBeGreaterThan(-1);
        expect(controls).toBeGreaterThan(strip);
        expect(preview).toMatch(/target=\{\{ kind: "table", tableName \}\}/);
        expect(preview).toContain('Edit name / GSTIN / address');

        const page = code(readSource('src/app/dashboard/orders/page.tsx'));
        expect(page).toContain('canEditCustomer={!isWaiterOnly}');
    });

    it('the grid\'s 6.5 Bill menu opens the SAME dialog — there is no second copy', () => {
        const actions = code(readSource('src/app/dashboard/orders/bill-actions.tsx'));
        expect(actions).toContain('<BillCustomerDialog');
        expect(actions).not.toContain('setBillCustomerName');
        expect(actions).not.toContain('bill-customer-name');
        const dialog = code(readSource('src/components/bill-customer-dialog.tsx'));
        expect(dialog).toContain('id="bill-customer-name"');
        expect(dialog).toContain('id="bill-customer-gstin"');
        expect(dialog).toContain('setGstin(gstinAsTyped(e.target.value))');
        expect(dialog).toContain('gstinToSend(gstin, gstinKnown, gstinTouched)');
        expect(dialog).toContain('setServerError(r.message)');
    });
});

describe('item 4 — the REPRINT banner on the web preview', () => {
    const print = code(readSource('src/app/dashboard/orders/print/page.tsx'));

    it('is decided by billReceiptIsReprint off the stamp taken before the claim', () => {
        expect(print).toContain('const isReprint = billReceiptIsReprint(printed.source, order.bill_print_state);');
    });

    it('sits at the very top of the receipt — above the logo and header — and is not screen-only', () => {
        const card = print.indexOf('receipt-card');
        const banner = print.indexOf('{REPRINT_MARKER}');
        const header = print.indexOf('data-testid="receipt-header"');
        expect(card).toBeGreaterThan(-1);
        expect(banner).toBeGreaterThan(card);
        expect(header).toBeGreaterThan(banner);
        const bannerDiv = print.slice(print.lastIndexOf('<div', banner), banner);
        expect(bannerDiv).not.toContain('no-print');
        expect(bannerDiv).toMatch(/font-extrabold/);
        expect(bannerDiv).toMatch(/text-2xl|text-3xl/);
    });

    it('the orders page previews in place and claims nothing until Print (bill-preview.md 1-3)', () => {
        const page = code(readSource('src/app/dashboard/orders/page.tsx'));
        // No claim before the paper: the old tab-first claimBillPrint flow is gone.
        expect(page).not.toContain('claimBillPrint(');
        const trigger = page.slice(page.indexOf('const triggerPrint = ('), page.indexOf('const requestBillVerification'));
        expect(trigger).toContain('setPrintPreviewTable(tableName);');
        expect(trigger).not.toContain('printTableBill(');
        // The dialog reads the server's print state itself; the print runs only from its Print.
        expect(page).toMatch(/<BillPreviewDialog[\s\S]*?onPrint=\{\(\) => \(printPreviewTable === null \? Promise\.resolve\(false\) : printTableBillNow\(printPreviewTable\)\)\}/);
        // A waiter confirms without a priced preview (item 19).
        expect(trigger).toMatch(/if \(isWaiterOnly\) \{\s*setConfirmAction\(/);
        const dialog = code(readSource('src/components/bill-print/bill-preview-dialog.tsx'));
        expect(dialog).toContain('const printedBefore = serverBillPrintState(bill) ?? printedFallback;');
    });
});
