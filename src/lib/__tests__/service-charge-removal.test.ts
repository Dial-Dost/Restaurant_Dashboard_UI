// "REMOVE SERVICE CHARGE & PRINT" ON THE WEB DASHBOARD — what these protect.
//
// Client item 6: "reprint without service charge and waive service charge
// should be merged as one option instead of being 2 separate steps." The server
// half is one route, POST /bills/service-charge-waiver/print, pinned in the
// backend's money suite. What the dashboard adds is easy to get quietly wrong:
//
//   * OFFERING IT AT ALL. The dialog used to decide there was no charge with
//     `(bill.service_charge ?? 0) <= 0`. `service_charge` is only the percent
//     leg, and it is 0 on every tenant carrying the charge as a tax line — seven
//     of the nine in production that charge one — so most of the fleet was told
//     "This bill carries no service charge".
//   * THE SENTENCE AFTER IT. The till's snackbar and the dashboard's toast must
//     say the same thing about the same answer, and neither may call a removal
//     done when the paper did not come out.
//   * THE POPUP BLOCKER. The print tab must be opened in the click, BEFORE the
//     request is awaited, or the waiver lands and no paper appears.
//   * ONE CLAIM PER PIECE OF PAPER. The route has already claimed the print; the
//     page's print flow must not claim it again.
//   * "NOT RECORDED" ONLY WHEN IT IS TRUE. A 4xx is a refusal made before the
//     route writes. No answer and a 5xx are not — a reset or a proxy's 504 can
//     land after the waiver committed — and a print flow that fails after a 200
//     has already been told the charge is off. The dialog used to title all of
//     them "Not recorded" and leave the removal form on screen.
//   * "REPRINT" ONLY FOR A BILL THAT HAS BEEN PRINTED. The paper says REPRINT
//     only when the server's ledger counts a print; the control must not promise
//     one on a waiver nobody has printed yet.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    billCarriesServiceCharge,
    formatAmount,
    serviceChargeOnBill,
    serviceChargeRemovalSentence,
    serviceChargeRemovalTrouble,
    serviceChargeWaivedPrintLabel,
} from '../mis-capture';

/** The Flutter till formats money without grouping; the words are what is shared. */
const money = (v: unknown): string => formatAmount(v, '₹');

describe('billCarriesServiceCharge — the server says whether there is a charge', () => {
    it('THE BUG: a tax-line tenant, whose `service_charge` is 0, carries one', () => {
        expect(billCarriesServiceCharge({ service_charge: 0, service_charge_basis: 'tax_line' })).toBe(true);
    });

    it('"none" from the server hides it, whatever else the payload looks like', () => {
        expect(billCarriesServiceCharge({ service_charge: 120, service_charge_basis: 'none' })).toBe(false);
    });

    it('the percent shape', () => {
        expect(billCarriesServiceCharge({ service_charge: 549.9, service_charge_basis: 'restaurant_percent' })).toBe(true);
    });

    it('an older backend with no basis: both shapes are read, tax lines matched as the server matches them', () => {
        expect(billCarriesServiceCharge({
            service_charge: 0,
            taxes: [{ name: 'CGST', amount: 137.48 }, { name: 'ServiceCharge', amount: 549.9 }],
        })).toBe(true);
        expect(billCarriesServiceCharge({ service_charge: 0, taxes: [{ name: 'CGST', amount: 137.48 }] })).toBe(false);
        expect(billCarriesServiceCharge(null)).toBe(false);
    });
});

describe('serviceChargeOnBill — the headline in both shapes, never a charged figure', () => {
    it('adds the percent leg and every tax line the server would call a service charge', () => {
        expect(serviceChargeOnBill({
            service_charge: 10.1,
            taxes: [{ name: 'Service Charge', amount: 549.9 }, { name: 'SGST', amount: 137.48 }, { name: 'service  charge', amount: 0.2 }],
        })).toBe(560.2);
        expect(serviceChargeOnBill({ service_charge: 0, taxes: [] })).toBe(0);
    });
});

describe('serviceChargeRemovalSentence — says what the server did, in the till\'s words', () => {
    it('removed and printed: both payable totals', () => {
        expect(serviceChargeRemovalSentence({
            printed: true, waiver_created: true, service_charge_removed: true, grand_total_before: 6324, grand_total_after: 5774,
        }, money)).toEqual({ message: 'Service charge removed — total ₹6,324.00 → ₹5,774.00. Printing bill…', tone: 'ok' });
    });

    it('an existing waiver reprinted: the paper\'s total, and no claim of a new removal', () => {
        const said = serviceChargeRemovalSentence({
            printed: true, waiver_created: false, service_charge_removed: true, grand_total_before: null, grand_total_after: 5774,
        }, money);
        expect(said.message).toBe('Reprinting without the service charge — total ₹5,774.00.');
        expect(said.message).not.toContain('removed');
    });

    it('THE HALF THAT MATTERS: removed, but the print failed — both facts, what to press, and a warning tone', () => {
        expect(serviceChargeRemovalSentence({
            printed: false, print_error: 'printer routing table unreadable', waiver_created: true,
            service_charge_removed: true, grand_total_before: 6324, grand_total_after: 5774,
        }, money)).toEqual({
            message: 'Service charge removed (₹6,324.00 → ₹5,774.00), but the bill did not print: printer routing table unreadable. Press Print bill.',
            tone: 'warn',
        });
    });

    it('a failed reprint says the charge is off and the paper is not', () => {
        expect(serviceChargeRemovalSentence({
            printed: false, print_error: 'Nothing to print for this table', waiver_created: false,
            waiver: { id: 'w-live' } as never, grand_total_before: null, grand_total_after: null,
        }, money).message).toBe('The service charge is off this bill, but the bill did not print: Nothing to print for this table. Press Print bill.');
    });

    it('paper that carries the charge after all is never described as removed', () => {
        const said = serviceChargeRemovalSentence({
            printed: true, waiver_created: true, service_charge_removed: false, grand_total_before: 6324, grand_total_after: 6324,
        }, money);
        expect(said.message).toContain('WITH the service charge');
        expect(said.tone).toBe('warn');
    });

    it('an unreadable answer proves nothing about the charge, and says nothing about it', () => {
        expect(serviceChargeRemovalSentence(null, money)).toEqual({ message: 'The bill did not print. Press Print bill.', tone: 'warn' });
    });
});

describe('serviceChargeRemovalTrouble — "Not recorded" only when nothing was', () => {
    it('a 4xx is the server\'s refusal before any write: its sentence, verbatim, titled Not recorded', () => {
        expect(serviceChargeRemovalTrouble({
            status: 403, message: "'ravi' is not permitted to authorise a service-charge waiver",
        }, money)).toEqual({ title: 'Not recorded', message: "'ravi' is not permitted to authorise a service-charge waiver" });
        expect(serviceChargeRemovalTrouble({ status: 404, message: '' }, money))
            .toEqual({ title: 'Not recorded', message: 'Unable to remove the service charge (404)' });
    });

    it.each([
        [0, 'The server could not be reached, or its answer was lost on the way back.'],
        [502, 'Unable to remove the service charge (502)'],
        [504, 'Unable to remove the service charge (504)'],
        [500, "Unable to read this table's bill"],
    ])('THE BUG: status %s may hide a committed waiver, so it is never called "Not recorded"', (status, sentence) => {
        const said = serviceChargeRemovalTrouble({ status, message: sentence }, money);
        expect(said.title).toBe('Check the bill');
        expect(said.message.startsWith(sentence)).toBe(true);
        expect(said.message).toContain('the service charge may already be off this bill');
        expect(said.message).toContain('The bill has been read again');
        expect(said.message).not.toMatch(/nothing was recorded|not recorded/i);
    });

    it('a sentence without a full stop is not run into the next one', () => {
        expect(serviceChargeRemovalTrouble({ status: 502, message: 'Unable to remove the service charge (502)' }, money).message)
            .toMatch(/^Unable to remove the service charge \(502\)\. The server did not confirm/);
    });

    it('THE OTHER HALF: a 200 was read and then the print flow threw — the charge is off, the paper is not', () => {
        expect(serviceChargeRemovalTrouble({
            status: 0,
            message: 'Failed to open the print page',
            answered: {
                success: true, printed: true, waiver_created: true, service_charge_removed: true,
                grand_total_before: 6324, grand_total_after: 5774,
            },
        }, money)).toEqual({
            title: 'Check the bill',
            message: 'Service charge removed (₹6,324.00 → ₹5,774.00), but the bill did not print: Failed to open the print page. Press Print bill.',
        });
    });

    it('a live waiver reprinted and then the print flow threw says the charge is off, not that it was removed now', () => {
        const said = serviceChargeRemovalTrouble({
            status: 0,
            message: 'Popup blocked',
            answered: { printed: true, waiver_created: false, waiver: { id: 'w-live' } as never, grand_total_after: 5774 },
        }, money);
        expect(said).toEqual({
            title: 'Check the bill',
            message: 'The service charge is off this bill, but the bill did not print: Popup blocked. Press Print bill.',
        });
    });
});

describe('serviceChargeWaivedPrintLabel — "Reprint" only for a bill the server says was printed', () => {
    it('printed before: the paper will say REPRINT, and so does the control', () => {
        expect(serviceChargeWaivedPrintLabel(true)).toBe('Reprint without the charge');
    });

    it('THE BUG: a waiver recorded without a print (a 1.9.9 till, or a failed print) is a first print', () => {
        expect(serviceChargeWaivedPrintLabel(false)).toBe('Print without the charge');
    });

    it('no print state in the payload promises nothing about the banner', () => {
        expect(serviceChargeWaivedPrintLabel(null)).toBe('Print without the charge');
    });
});

// ---------------------------------------------------------------------------
// WIRING — the dashboard reaches the route the way the page's print flow needs
// ---------------------------------------------------------------------------

describe('wiring', () => {
    const src = (rel: string): string => readFileSync(join(__dirname, '..', '..', rel), 'utf8').replace(/\r\n/g, '\n');

    it('db.ts posts ONE request to the composite route, rendering in the browser', () => {
        const db = src('lib/db.ts');
        const fn = db.slice(db.indexOf('export const removeServiceChargeAndPrint'), db.indexOf('// --- 037: TENDERS AND TIPS'));
        expect(fn).toContain("backendCall('/bills/service-charge-waiver/print'");
        expect(fn).toContain("render: 'client'");
        // Returned, not thrown: a "use server" Error loses its sentence in production.
        expect(fn).not.toMatch(/\bthrow new Error\(/);
    });

    it('the dialog opens the print tab BEFORE it awaits the route, and closes it on a refusal', () => {
        const ui = src('app/dashboard/orders/capture-actions.tsx');
        const start = ui.indexOf('const removeAndPrint = ');
        expect(start).toBeGreaterThan(-1);
        const body = ui.slice(start, ui.indexOf('const reverse = async', start));
        const open = body.indexOf('const tab = openPrintTab()');
        const call = body.indexOf('await removeServiceChargeAndPrint(');
        expect(open).toBeGreaterThan(-1);
        expect(call).toBeGreaterThan(open);
        // The open itself is synchronous: nothing awaited ahead of it in the handler.
        expect(body.slice(0, open)).not.toContain('await ');
        const refusal = body.slice(body.indexOf('if (!answer.ok)'), body.indexOf('const said ='));
        expect(refusal).toContain('tab?.close()');
        // ...and hands the tab and the already-claimed bill to the page's print flow.
        expect(body).toContain('await printBill({ printWindow: tab, printableBill: answer.result.printable_bill ?? null })');
    });

    it('both the removal form and the live-waiver reprint go through it; the old two-step is gone', () => {
        const ui = src('app/dashboard/orders/capture-actions.tsx');
        expect(ui).toContain('Remove service charge &amp; print');
        expect(ui).toContain('{serviceChargeWaivedPrintLabel(printedBefore)}');
        expect(ui).toContain('"Remove service charge & print…"');
        expect(ui).not.toContain('Waive service charge…');
        expect(ui).not.toMatch(/\bwaiveServiceCharge\b/);
        expect(ui.match(/removeAndPrint\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    });

    it('a failure that is not a clean refusal is told as one, and the bill is re-read in every outcome', () => {
        const ui = src('app/dashboard/orders/capture-actions.tsx');
        const start = ui.indexOf('const removeAndPrint = ');
        const body = ui.slice(start, ui.indexOf('const reverse = async', start));
        // No answer / not 2xx: the status decides the title, and the dialog
        // re-reads instead of leaving a removal form over a charge that is off.
        const refusal = body.slice(body.indexOf('if (!answer.ok)'), body.indexOf('answered = answer.result'));
        expect(refusal).toContain('serviceChargeRemovalTrouble({ status: answer.status, message: answer.message }, money)');
        expect(refusal).toMatch(/load\(\)\s+onChanged\(\)\s+return/);
        expect(refusal).not.toContain('fail(');
        // The 200 is remembered BEFORE the print flow runs, so a throw from it
        // is reported as "the charge is off, the paper is not".
        expect(body.indexOf('answered = answer.result')).toBeGreaterThan(-1);
        expect(body.indexOf('answered = answer.result')).toBeLessThan(body.indexOf('await printBill('));
        const caught = body.slice(body.indexOf('} catch (e) {'), body.indexOf('} finally {'));
        expect(caught).toMatch(/serviceChargeRemovalTrouble\(\s*\{ status: 0, message: String\(\(e as Error\)\?\.message \?\? e\), answered \}/);
        expect(caught).toContain('load()');
        expect(caught).toContain('onChanged()');
        expect(caught).not.toContain('fail(');
    });

    it('db.ts does not say "nothing was recorded" when it has no answer to say it from', () => {
        const db = src('lib/db.ts');
        const fn = db.slice(db.indexOf('export const removeServiceChargeAndPrint'), db.indexOf('// --- 037: TENDERS AND TIPS'));
        expect(fn).toContain("status: 0, message: 'The server could not be reached, or its answer was lost on the way back.'");
        // In a sentence the dialog shows, that is; the comment explaining why may say it.
        expect(fn).not.toMatch(/'[^'\n]*nothing was recorded[^'\n]*'/i);
    });

    it('the live-waiver panel names its print from the server\'s print ledger', () => {
        const ui = src('app/dashboard/orders/capture-actions.tsx');
        expect(ui).toContain('const printedBefore = serverBillPrintState(bill)');
        expect(ui).not.toMatch(/>\s*Reprint without the charge\s*</);
    });

    it('THE GATING BUG: the dialog asks billCarriesServiceCharge, not the percent leg', () => {
        const ui = src('app/dashboard/orders/capture-actions.tsx');
        expect(ui).toContain('!billCarriesServiceCharge(bill)');
        expect(ui).not.toMatch(/service_charge \?\? 0\) <= 0/);
    });

    it('the orders page wires the handoff, and a handed-off print is not claimed twice', () => {
        const page = src('app/dashboard/orders/page.tsx');
        expect(page).toContain('printBill={(handoff) => triggerPrint(order, handoff)}');
        const flow = page.slice(page.indexOf('const triggerPrint = async (order: Order, handoff?: PrintBillHandoff)'), page.indexOf('const handleAddOrder = async'));
        const handedOff = flow.slice(flow.indexOf('if (restaurantId && tableName && handoff) {'), flow.indexOf('} else if (restaurantId && tableName) {'));
        expect(handedOff.length).toBeGreaterThan(0);
        expect(handedOff).not.toContain('claimBillPrint(');
        expect(handedOff).toContain('printableBill = handoff.printableBill;');
        // The tab the dialog opened is the one used; no second open outside the gesture.
        expect(flow).toContain('? handoff.printWindow');
    });
});

// ---------------------------------------------------------------------------
// PARITY — the till and the dashboard say the same words
// ---------------------------------------------------------------------------

describe('the Windows/Android till says the same sentences', () => {
    const dart = join(__dirname, '..', '..', '..', '..', 'restaurant_owner_app', 'lib', 'screens', 'mis_capture.dart');

    // The two repos are siblings on a developer machine and in this workspace;
    // CI checks out one repo, where there is nothing to compare against.
    (existsSync(dart) ? it : it.skip)('every fixed fragment of the sentence appears in both clients', () => {
        const flutter = readFileSync(dart, 'utf8');
        const web = readFileSync(join(__dirname, '..', 'mis-capture.ts'), 'utf8');
        for (const fragment of [
            'Printed WITH the service charge — the waiver was put back before the bill printed.',
            'did not print',
            '. Press Print bill.',
            'Service charge removed (',
            '), but the bill ',
            'The service charge is off this bill, but the bill ',
            'Service charge removed — total ',
            '. Printing bill…',
            'Reprinting without the service charge — total ',
            'Reprinting without the service charge…',
            'Reprint without the charge',
            'Print without the charge',
        ]) {
            expect([fragment, flutter.includes(fragment), web.includes(fragment)]).toEqual([fragment, true, true]);
        }
    });
});
