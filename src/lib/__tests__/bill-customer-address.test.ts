// CLIENT ITEMS 7 AND 8 ON THE WEB, pinned.
//
//   7 — "An option in the tables section to add the ADDRESS of a guest to the
//       bill, like name and GSTIN, especially for corporate parties."
//   8 — "Reprint bill should show up in History; old bills should be
//       reprintable from the history section."
//
// The pure half (normalising, limits, what is sent, what came back, the paper's
// lines) is exercised directly. The components have no DOM harness here, so
// where the requirement is about WHAT a screen draws or WHICH route a button
// reaches, it is pinned by reading the source — the house pattern.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    ADDRESS_HELP,
    ADDRESS_LIMIT_ERROR,
    ADDRESS_MAX_CHARS,
    ADDRESS_MAX_LINES,
    ADDRESS_NOT_SAVED_MESSAGE,
    OUTDATED_SERVER_MESSAGE,
    addressError,
    addressToSend,
    addressUsage,
    billAddressLines,
    billCustomerLines,
    billCustomerPayload,
    billCustomerSaveOutcome,
    billCustomerSeed,
    canEditSettledBillCustomer,
    canReprintSettledBill,
    normalizeAddress,
} from '../bill-customer';
import { buildBillEscPos, type BillEscPosInput } from '../bill-escpos';
import { escposLines } from './escpos-text';

function readSource(relative: string): string {
    for (const base of [process.cwd(), path.join(__dirname, '..', '..', '..')]) {
        const full = path.join(base, relative);
        // A fixed list of this repo's own source files, not user input.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        if (fs.existsSync(full)) { return fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n'); }
    }
    throw new Error(`readSource could not find ${relative} from ${process.cwd()}`);
}

/** A sibling repo's file, or '' when it is not checked out beside this one. */
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

const ADDRESS = '4th Floor, Prestige Tower\n12 Residency Road\nBengaluru 560025';
const ACCOUNTING = 'df75119b-e5f1-4f38-aba5-78a1cf182f56';
const LS = String.fromCharCode(0x2028);
const NUL = String.fromCharCode(0);
const ESC = String.fromCharCode(0x1b);

describe('the address rule — the server\'s, mirrored', () => {
    it('keeps the line breaks and tidies everything else', () => {
        expect(normalizeAddress(ADDRESS)).toBe(ADDRESS);
        expect(normalizeAddress('  4th  Floor,\t\tPrestige Tower  \r\n\r\n   \r\n12   Residency Road\r\n')).toBe('4th Floor, Prestige Tower\n12 Residency Road');
        expect(normalizeAddress(`A\rB${LS}C`)).toBe('A\nB\nC');
        expect(normalizeAddress(`12 MG${NUL} Road${ESC}`)).toBe('12 MG Road');
        expect(normalizeAddress('12\tMG Road')).toBe('12 MG Road');
    });

    it('nothing left is null — which clears it', () => {
        for (const empty of ['', '   ', '\n\n', ' \t ', null, undefined, 42, {}]) {
            expect(normalizeAddress(empty)).toBeNull();
        }
    });

    it('five lines and 250 characters are fine; one more of either is the server\'s sentence — never a cut', () => {
        const five = ['L1', 'L2', 'L3', 'L4', 'L5'].join('\n');
        expect(addressError(five)).toBeNull();
        expect(addressError(`${five}\nL6`)).toBe(ADDRESS_LIMIT_ERROR);
        const line = 'x'.repeat(49);
        const at = [line, line, line, line, `${line}x`].join('\n');
        expect(at.length).toBe(ADDRESS_MAX_CHARS);
        expect(addressError(at)).toBeNull();
        expect(addressError(`${at}y`)).toBe(ADDRESS_LIMIT_ERROR);
        // Measured after tidying, as the server measures it.
        expect(addressError(`L1\n\n\nL2\n\nL3\nL4\n\nL5\n\n`)).toBeNull();
        expect(addressError(`   ${'z'.repeat(250)}   `)).toBeNull();
        // Over the limit is REPORTED, and the value is left exactly as typed.
        expect(normalizeAddress('y'.repeat(300))).toBe('y'.repeat(300));
        expect(addressUsage(`${five}\nL6`)).toEqual({ lines: 6, chars: 17 });
        expect(addressUsage('')).toEqual({ lines: 0, chars: 0 });
    });

    it('the numbers and the sentences are the contract\'s', () => {
        expect(ADDRESS_MAX_LINES).toBe(5);
        expect(ADDRESS_MAX_CHARS).toBe(250);
        expect(ADDRESS_LIMIT_ERROR).toBe('Address can be at most 5 lines and 250 characters');
        expect(ADDRESS_HELP).toBe('Up to 5 lines. Leave it empty for none. Letters outside English print as "?".');
        expect(OUTDATED_SERVER_MESSAGE).toMatch(/name, GSTIN and address/);
        expect(ADDRESS_NOT_SAVED_MESSAGE).toMatch(/^The address was not saved: this server has not finished updating/);
    });

    it('is the backend\'s rule, word for word (customer_address.ts, when checked out beside this repo)', () => {
        const backend = sibling('Restaurant_Backend', 'customer_address.ts');
        if (!backend) { return; }
        expect(backend).toContain('export const CUSTOMER_ADDRESS_MAX_LINES = 5;');
        expect(backend).toContain('export const CUSTOMER_ADDRESS_MAX_CHARS = 250;');
        expect(backend).toContain(`export const CUSTOMER_ADDRESS_ERROR = "${ADDRESS_LIMIT_ERROR}";`);
        expect(backend).toContain('export const CUSTOMER_ADDRESS_LABEL = "Address:";');
    });
});

describe('the customer slot on the paper — Name, GSTIN, then the address', () => {
    it('one entry per stored line, only the first labelled', () => {
        expect(billAddressLines(ADDRESS)).toEqual(['Address: 4th Floor, Prestige Tower', '12 Residency Road', 'Bengaluru 560025']);
        expect(billCustomerLines('Acme Pvt Ltd', '29ABCDE1234F1Z5', ADDRESS)).toEqual([
            'Name: Acme Pvt Ltd',
            'Customer GSTIN: 29ABCDE1234F1Z5',
            'Address: 4th Floor, Prestige Tower',
            '12 Residency Road',
            'Bengaluru 560025',
        ]);
        expect(billCustomerLines('Guest', null, '12 MG Road')).toEqual(['Name:', 'Address: 12 MG Road']);
    });

    it('no address is exactly the 2.0.1 slot — two arguments or three', () => {
        for (const none of [undefined, null, '', '   ', 'null', 'undefined']) {
            expect(billCustomerLines('Acme', '29ABCDE1234F1Z5', none)).toEqual(billCustomerLines('Acme', '29ABCDE1234F1Z5'));
            expect(billAddressLines(none)).toEqual([]);
        }
    });

    const HOSTILE = [
        'Flat 1204, Tower B, Brigade Metropolis Whitefield Main Road',
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz01234567',
        'Café Road – Near Old Airport',
        'Bengaluru, Karnataka 560048, India',
    ].join('\n');
    const bill = (width: number): BillEscPosInput => ({
        width,
        restaurantName: 'Gaia - Global Vegetarian',
        headerLines: ['Gaia Hospitality Pvt Ltd', 'GSTN : 29AAAAA0000A1Z5'],
        customerLines: billCustomerLines('Acme Pvt Ltd', '29ABCDE1234F1Z5', HOSTILE),
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
    });
    const slot = (width: number): string[] => {
        const lines = escposLines(buildBillEscPos(bill(width)));
        const from = lines.findIndex((l) => l.startsWith('Name:'));
        return lines.slice(from, lines.indexOf('<RULE>', from) + 1);
    };

    // THE BACKEND RENDERER'S OWN OUTPUT for this address (escpos.ts, read back
    // through escposLines by scratchpad compare_address.ts --dump). The whole
    // bill was compared byte for byte there, on both rolls, for twelve cases.
    it('80mm: the backend\'s lines exactly — wrapped whole, the 60-char token hard-split, folded to ASCII', () => {
        expect(slot(48)).toEqual([
            'Name: Acme Pvt Ltd',
            'Customer GSTIN: 29ABCDE1234F1Z5',
            'Address: Flat 1204, Tower B, Brigade',
            'Metropolis Whitefield Main Road',
            'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqr',
            'stuvwxyz01234567',
            'Cafe Road - Near Old Airport',
            'Bengaluru, Karnataka 560048, India',
            '<RULE>',
        ]);
    });

    it('58mm: the backend\'s lines exactly', () => {
        expect(slot(32)).toEqual([
            'Name: Acme Pvt Ltd',
            'Customer GSTIN: 29ABCDE1234F1Z5',
            'Address: Flat 1204, Tower B,',
            'Brigade Metropolis Whitefield',
            'Main Road',
            'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef',
            'ghijklmnopqrstuvwxyz01234567',
            'Cafe Road - Near Old Airport',
            'Bengaluru, Karnataka 560048,',
            'India',
            '<RULE>',
        ]);
    });

    it('never cut: every non-space character of the address is on the paper, in order, on both rolls', () => {
        const squash = (s: string): string => s.replace(/\s+/g, '');
        const expected = squash(`Address: ${HOSTILE.replace('é', 'e').replace('–', '-')}`);
        for (const w of [48, 32]) {
            expect(squash(slot(w).slice(2, -1).join(''))).toBe(expected);
        }
    });

    it('the escpos.ts split is the same rule (the backend source, when checked out beside this repo)', () => {
        const escpos = sibling('Restaurant_Backend', 'escpos.ts');
        if (!escpos) { return; }
        const fn = escpos.slice(escpos.indexOf('function customerAddressEntries('));
        expect(fn.slice(0, fn.indexOf('\n}\n'))).toMatch(/\.split\(\/\\r\?\\n\/\)\s*\.map\(\(l\) => l\.trim\(\)\)\s*\.filter\(Boolean\)\s*\.map\(\(l, i\) => \(i === 0 \? `Address: \$\{l\}` : l\)\)/);
    });
});

describe('what the dialog sends, and what came back', () => {
    it('addressToSend: only a CHANGE goes out — untouched, or touched back to the seed, sends nothing', () => {
        // Untouched: never, known or not.
        expect(addressToSend(ADDRESS, ADDRESS, true, false)).toBeUndefined();
        expect(addressToSend('', '', false, false)).toBeUndefined();
        // Known: only when it now differs from what the dialog opened with,
        // compared the way the server stores it.
        expect(addressToSend(ADDRESS, ADDRESS, true, true)).toBeUndefined();
        expect(addressToSend(`  ${ADDRESS.replace(/\n/g, '\r\n')}\n\n`, ADDRESS, true, true)).toBeUndefined();
        expect(addressToSend('Tower B', ADDRESS, true, true)).toBe('Tower B');
        expect(addressToSend('', ADDRESS, true, true)).toBe('');
        expect(addressToSend('', '', true, true)).toBeUndefined();
        // Not known (an older backend's payload): typing, or Clear, is the change.
        expect(addressToSend('Tower B', '', false, true)).toBe('Tower B');
        expect(addressToSend('', '', false, true)).toBe('');
    });

    it('so a name-only save from a dialog that saw the address is not an address write (no 503 before 054)', () => {
        const box = ADDRESS;
        const payload = billCustomerPayload({ kind: 'table', tableName: 'T4' }, 'Acme', undefined, addressToSend(box, ADDRESS, true, false));
        expect('customer_address' in payload.body).toBe(false);
    });

    it('the payload: unknown stays off the wire, empty is null, a value is normalised — on both routes', () => {
        expect(billCustomerPayload({ kind: 'table', tableName: 'T4' }, 'Acme', undefined, ' 12  MG Road \r\n Bengaluru ').body)
            .toEqual({ table_name: 'T4', customer: 'Acme', customer_address: '12 MG Road\nBengaluru' });
        expect(billCustomerPayload({ kind: 'bill', billId: 'b1' }, 'Acme', '', '   ').body)
            .toEqual({ customer: 'Acme', customer_gstin: null, customer_address: null });
        const unknown = billCustomerPayload({ kind: 'bill', billId: 'b1' }, 'Acme', '29ABCDE1234F1Z5', undefined).body;
        expect('customer_address' in unknown).toBe(false);
        // The two-argument call every 6.5 / R2 caller made still sends no address.
        expect('customer_address' in billCustomerPayload({ kind: 'table', tableName: 'T4' }, 'Acme', undefined).body).toBe(false);
    });

    it('a success carries the stored address; an address sent to a server that ignores it is NOT saved', async () => {
        const saved = await billCustomerSaveOutcome(200, JSON.stringify({ success: true, customer: 'Acme', customer_gstin: null, customer_address: ADDRESS }), false, true);
        expect(saved).toEqual({ ok: true, customer: 'Acme', customer_gstin: null, gstinSaved: true, customer_address: ADDRESS, addressSaved: true });
        const ignored = await billCustomerSaveOutcome(200, JSON.stringify({ success: true, customer: 'Acme', customer_gstin: null }), false, true);
        expect(ignored).toMatchObject({ ok: true, customer_address: null, addressSaved: false });
        const notSent = await billCustomerSaveOutcome(200, JSON.stringify({ success: true, customer: 'Acme' }), false, false);
        expect(notSent).toMatchObject({ ok: true, addressSaved: true });
    });

    it('the address 400 and the 054 503 reach the person word for word', async () => {
        await expect(billCustomerSaveOutcome(400, JSON.stringify({ error: ADDRESS_LIMIT_ERROR }), false, true))
            .resolves.toMatchObject({ ok: false, outdated: false, message: ADDRESS_LIMIT_ERROR });
        await expect(billCustomerSaveOutcome(503, JSON.stringify({ error: 'This server has not finished updating — try again shortly' }), false, true))
            .resolves.toMatchObject({ ok: false, message: 'This server has not finished updating — try again shortly' });
    });

    it('seeding: the address is known only when the payload carries the key (the list never does)', () => {
        expect(billCustomerSeed({ customer: 'Acme', customer_gstin: null, customer_address: ADDRESS }))
            .toEqual({ customer: 'Acme', gstin: '', gstinKnown: true, address: ADDRESS, addressKnown: true });
        expect(billCustomerSeed({ customer: 'Acme', customer_address: null })).toMatchObject({ address: '', addressKnown: true });
        expect(billCustomerSeed({ customer: 'Acme', customer_gstin: 'X' })).toMatchObject({ address: '', addressKnown: false });
    });
});

describe('the dialog, the table strip and the menus (source)', () => {
    const dialog = code(readSource('src/components/bill-customer-dialog.tsx'));

    it('the dialog has the address box, with no maxLength (a paste must not be cut) and no Enter-to-save', () => {
        expect(dialog).toContain('<Textarea');
        expect(dialog).toContain('id="bill-customer-address"');
        const box = dialog.slice(dialog.indexOf('<Textarea'), dialog.indexOf('/>', dialog.indexOf('<Textarea')));
        expect(box).not.toMatch(/maxLength/);
        expect(box).not.toMatch(/onKeyDown/);
        expect(box).toContain('setAddressTouched(true)');
        expect(dialog).toContain('addressToSend(address, addressSeed, addressKnown, addressTouched)');
        expect(dialog).toContain('setAddressSeed(seed.address)');
        expect(dialog).toContain('setBillCustomerName(restaurantId, target.tableName, customerName, sendGstin, sendAddress)');
        expect(dialog).toContain('setSettledBillCustomerDetails(restaurantId, target.billId, customerName, sendGstin, sendAddress)');
        // Over the limit: Save is off and the sentence is shown.
        expect(dialog).toMatch(/disabled=\{busy \|\| !loaded \|\| invalid\}/);
        expect(dialog).toContain('const addressLimitError = addressError(address)');
        expect(dialog).toContain('{ADDRESS_HELP}');
        // Clear clears all three and marks them touched, so "clear" is sent.
        expect(dialog).toMatch(/setCustomerName\(""\); setGstin\(""\); setAddress\(""\)\s*setGstinTouched\(true\); setAddressTouched\(true\)/);
        expect(dialog).toContain('!r.addressSaved');
        expect(dialog).toContain('Name / GSTIN / address on bill');
    });

    it('every button that opens it says "Edit name / GSTIN / address" — the app\'s words', () => {
        expect(code(readSource('src/components/closed-bills.tsx'))).toContain('Edit name / GSTIN / address');
        expect(code(readSource('src/app/dashboard/orders/table-kot-preview.tsx'))).toContain('Edit name / GSTIN / address');
        expect(code(readSource('src/app/dashboard/orders/bill-actions.tsx'))).toContain('Edit name / GSTIN / address…');
        for (const src of ['src/components/closed-bills.tsx', 'src/app/dashboard/orders/table-kot-preview.tsx', 'src/app/dashboard/orders/bill-actions.tsx']) {
            expect(code(readSource(src))).not.toMatch(/Edit name \/ GSTIN(?! \/ address)/);
        }
    });

    it('the live-table strip shows the address (first line, the rest on hover) only when the server sent the key', () => {
        const preview = code(readSource('src/app/dashboard/orders/table-kot-preview.tsx'));
        expect(preview).toContain('"customer_address" in row ? { customer_address:');
        expect(preview).toContain('const addressSupported = billCustomer !== null && "customer_address" in billCustomer;');
        expect(preview).toContain('data-testid="table-bill-customer-address"');
        expect(preview).toContain('title={addressFull}');
    });

    it('the print page takes the address off the server document and keys the slot by position', () => {
        const print = code(readSource('src/app/dashboard/orders/print/page.tsx'));
        expect(print).toContain("customerAddress: docField(settled as Record<string, unknown>, 'customer_address')");
        expect(print).toContain("customerAddress: docField(openBill as Record<string, unknown>, 'customer_address')");
        expect(print).toMatch(/printed\.customerGstin,\s*printed\.customerAddress,/);
        expect(print).toMatch(/receiptCustomerLines\(printed, order\)\.map\(\(l, i\) => \(\s*<p key=\{i\}/);
    });

    it('the settled bill and the report drill-down show it, read-only, only when the server sends the field', () => {
        expect(code(readSource('src/components/closed-bills.tsx'))).toMatch(/"customer_address" in d \? \(\s*<Fact label="Customer address"/);
        expect(code(readSource('src/app/dashboard/reports/drill-down.tsx'))).toMatch(/"customer_address" in bill \? \(\s*<div[^>]*>\s*<Field\s+label="Customer address"/);
    });
});

describe('client item 8 — Reprint in History (the web)', () => {
    it('History mounts the same settled-bills section, so its Reprint is Accounting\'s', () => {
        const history = code(readSource('src/app/dashboard/history/page.tsx'));
        expect(history).toContain('import { ClosedBillsSection } from "@/components/closed-bills"');
        expect(history).toMatch(/<ClosedBillsSection\s/);
        const closed = code(readSource('src/components/closed-bills.tsx'));
        expect(closed).toContain('void reprintSettledBill(rid, id)');
    });

    it('the Reprint button is behind its route\'s own permission, hidden rather than a button that 403s', () => {
        expect(canReprintSettledBill({ actions_set: [ACCOUNTING] })).toBe(true);
        expect(canReprintSettledBill({ actions_set: ['*'] })).toBe(true);
        expect(canReprintSettledBill({ actions_set: ['98b10bde-802d-4a5b-a726-53a826424f79'] })).toBe(false);
        expect(canReprintSettledBill(null)).toBe(false);
        // The same gate as the edit beside it.
        for (const s of [{ actions_set: [ACCOUNTING] }, { actions_set: [] }, null]) {
            expect(canReprintSettledBill(s)).toBe(canEditSettledBillCustomer(s));
        }
        const closed = code(readSource('src/components/closed-bills.tsx'));
        expect(closed).toContain('const canReprint = canReprintSettledBill(user)');
        const button = closed.indexOf('void reprintSettledBill(rid, id)');
        const gate = closed.lastIndexOf('{canReprint ? (', button);
        expect(gate).toBeGreaterThan(-1);
        expect(closed.slice(gate, button)).toContain('<Button');
    });

    it('THE BUTTON NOW WORKS: a JSON body labelled as JSON, and the server\'s refusal verbatim', () => {
        // It went through backendJson, which sets no Content-Type; fetch() labels
        // a string body text/plain, express.json() skips it, and the route
        // answered 400 "bill_id is required" to every press — with only the
        // generic sentence on screen, because backendJson drops the body.
        const db = code(readSource('src/lib/db.ts'));
        const at = db.indexOf('export const reprintSettledBill = async (');
        expect(at).toBeGreaterThan(-1);
        const fn = db.slice(at, db.indexOf('\n};\n', at));
        expect(fn).toContain('backendCall(');
        expect(fn).not.toContain('backendJson');
        expect(fn).toMatch(/method: 'POST',\s*headers: \{ 'Content-Type': 'application\/json' \},\s*body: JSON\.stringify\(\{ bill_id: billId \}\)/);
        expect(fn).toContain('readErrorMessage(response, fallback)');
        expect(fn).toContain('/print/bill/settled?restaurantId=');
    });

    it('no other POST with a body goes out through backendJson without a Content-Type', () => {
        // The same trap, anywhere else in db.ts.
        const db = code(readSource('src/lib/db.ts'));
        const calls = db.split('backendJson<').slice(1);
        for (const call of calls) {
            const head = call.slice(0, call.indexOf(');'));
            if (head.includes('body:')) {
                expect(head).toMatch(/Content-Type/);
            }
        }
    });

    it('the list row says whose bill it was, and an edit updates the row too', () => {
        const closed = code(readSource('src/components/closed-bills.tsx'));
        expect(closed).toContain('data-testid="closed-bill-row-customer"');
        expect(closed).toContain('setBills((rows) => rows.map((row) => (row.id === id ? { ...row, customer: saved.customer } : row)))');
    });
});

describe('cross-client parity with the owner app (when checked out beside this repo)', () => {
    const app = sibling('restaurant_owner_app', path.join('lib', 'screens', 'bill_customer_name.dart'));
    const modules = sibling('restaurant_owner_app', path.join('lib', 'screens', 'modules.dart'));

    it('the same limits, the same sentences, the same button words', () => {
        if (!app || !modules) { return; }
        expect(app).toContain(`const String billCustomerAddressLimitMessage = '${ADDRESS_LIMIT_ERROR}';`);
        expect(app).toContain(`const String billCustomerAddressHelp = '${ADDRESS_HELP}';`);
        expect(app).toContain('const int billCustomerAddressMaxLines = 5;');
        expect(app).toContain('const int billCustomerAddressMaxChars = 250;');
        expect(app).toContain("const String billCustomerEditLabel = 'Edit name / GSTIN / address';");
        // The table header's button and both settled-bill controls use that one constant.
        expect(modules).toContain('label: billCustomerEditLabel');
        expect(app).toContain('tooltip: billCustomerEditLabel');
        expect(app).toContain("Text(_sending ? 'Saving…' : billCustomerEditLabel)");
    });
});
