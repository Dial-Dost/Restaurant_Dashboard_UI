// What these tests are actually protecting.
//
// C3 is "a waiter may execute Print Bill ONCE; the button then disappears and
// the table clears from their view; reprints are somebody senior's." Every
// client has now tried to implement that, and the FIRST TWO GOT IT WRONG IN THE
// SAME WAY: they remembered the press in the DEVICE. A device memory survives a
// back-navigation and an app restart and survives nothing else — not a
// reinstall, not a second tablet, not the browser on the pass — so the rule
// meant something different on every screen in the building. The backend now
// publishes the answer (`print_count` / `bill_printed_at` / `printed_at`, on
// /bill-for-table AND on every /get-tables row) and this module is how the web
// obeys it.
//
// So these tests pin four properties, each of which is a defect that has
// actually shipped somewhere in this project:
//
//   1. THE SERVER DECIDES, AND "NOBODY ASKED" IS ITS OWN ANSWER. `print_count:
//      0` is the server SAYING not-printed, which is the ordinary case on every
//      unprinted table. Only a payload carrying none of the keys is silence.
//      Folding the two together is the `||` that handed the Flutter floor grid's
//      answer back to a tablet's memory.
//   2. THE BUTTON TRACKS THE LEDGER. Hidden when the server says printed, shown
//      when it says otherwise, and shown when it says nothing at all — because a
//      waiter standing at a table with a guest waiting and no way to produce a
//      bill is a worse outage than a second copy of one.
//   3. NOBODY SENIOR LOSES ANYTHING. A manager, cashier, captain or admin
//      reprints as many times as they ever could. "Super Admin" in the
//      requirement names who a WAITER escalates to, not a new ceiling on the
//      people who run the floor.
//   4. THE REPRINT MARKER IS THE BACKEND'S, BYTE FOR BYTE. The same bill can be
//      printed through the thermal path or the dashboard's, and two spellings
//      would mean a guest holding both slips cannot tell they are one document.

import {
    BILL_PRINT_STATE_KEYS,
    NO_BILL_PRINTS,
    PRINT_BILL_LABEL,
    PRINT_UPDATED_BILL_LABEL,
    REPRINT_MARKER,
    SETTLE_ANYWAY_LABEL,
    UPDATED_BILL_MARKER,
    billPrintRefusal,
    billPrintScope,
    billPrintStateFields,
    billPaperJobIdOf,
    billReceiptIsReprint,
    billRevisedNoteOf,
    isReprintOfPrintedBill,
    paperStaleOf,
    serverBillPrintState,
    serverSaysBillPrinted,
    stalePaperSettleWarning,
} from '../bill-print-state';
import type { ScopedSession } from '../session-scope';

/** The identity C3 narrows, as the server scopes it. */
const WAITER: ScopedSession = { scope: { waiter_only: true } };
/** Everyone who runs the floor. C3 must not touch any of them. */
const MANAGER: ScopedSession = { scope: { waiter_only: false } };
/** A browser holding a session from before the scope block shipped. */
const STALE: ScopedSession = {};

/** A /get-tables row or a /bill-for-table body, as the server sends it. */
const payload = (printCount: number): { print_count: number; bill_printed_at: string | null; printed_at: string | null } => ({
    print_count: printCount,
    bill_printed_at: printCount > 0 ? '2026-09-11T13:40:00.000Z' : null,
    printed_at: printCount > 0 ? '2026-09-11T13:40:00.000Z' : null,
});

describe('serverBillPrintState — three answers, and the third one is the point', () => {
    it('says PRINTED when the count moved', () => {
        expect(serverBillPrintState(payload(1))).toBe(true);
        expect(serverBillPrintState(payload(5))).toBe(true);
    });

    it('says NOT PRINTED for a server that answered zero — that is an answer, not silence', () => {
        // THE REGRESSION THIS PINS. Reading `print_count: 0` as "no answer" is
        // what let a stale per-device record become the authority in the one case
        // that matters: the table has turned over, the server is describing the
        // CURRENT bill, and the device remembers the last one.
        expect(serverBillPrintState(payload(0))).toBe(false);
        expect(serverBillPrintState({ bill_printed_at: null })).toBe(false);
        expect(serverBillPrintState({ printed_at: null, print_count: 0 })).toBe(false);
    });

    it('says NOBODY ASKED when the payload carries none of the keys', () => {
        expect(serverBillPrintState({})).toBe(null);
        expect(serverBillPrintState({ table_name: 'T4', occupied: true })).toBe(null);
        expect(serverBillPrintState(null)).toBe(null);
        expect(serverBillPrintState(undefined)).toBe(null);
        expect(serverBillPrintState('not an object')).toBe(null);
    });

    it('accepts every spelling the backend lane was allowed to use', () => {
        // The backend was deliberately not forced into one name. A reader that
        // knows only one of them silently stops working the day the other ships.
        expect(serverBillPrintState({ bill_printed_at: '2026-09-11T13:40:00.000Z' })).toBe(true);
        expect(serverBillPrintState({ printed_at: '2026-09-11T13:40:00.000Z' })).toBe(true);
        expect(serverBillPrintState({ last_printed_at: '2026-09-11T13:40:00.000Z' })).toBe(true);
        expect(BILL_PRINT_STATE_KEYS).toEqual(['bill_printed_at', 'printed_at', 'last_printed_at', 'print_count']);
    });

    it('does not read a JSON round-trip\'s "null" string as an instant', () => {
        // `${null}` through a template literal, a form field or an older client's
        // body arrives as the four-letter STRING. Treating it as a timestamp
        // would retire a table nobody has printed.
        expect(serverBillPrintState({ bill_printed_at: 'null' })).toBe(false);
        expect(serverBillPrintState({ printed_at: '   ' })).toBe(false);
        expect(serverBillPrintState({ print_count: 'nonsense' })).toBe(false);
    });

    it('serverSaysBillPrinted collapses silence to NO, in the backend\'s own direction', () => {
        expect(serverSaysBillPrinted(payload(2))).toBe(true);
        expect(serverSaysBillPrinted(payload(0))).toBe(false);
        expect(serverSaysBillPrinted({})).toBe(false);
        expect(serverSaysBillPrinted(null)).toBe(false);
    });
});

describe('billPrintStateFields — the server\'s numbers, carried not re-derived', () => {
    it('lifts the three fields off a payload that has them', () => {
        expect(billPrintStateFields(payload(3))).toEqual({
            print_count: 3,
            bill_printed_at: '2026-09-11T13:40:00.000Z',
            printed_at: '2026-09-11T13:40:00.000Z',
        });
    });

    it('answers null — NOT a zeroed record — when the payload carried none of them', () => {
        // The distinction the whole module rests on. A zeroed record would say
        // "the server told us it is unprinted"; null says "nobody asked".
        expect(billPrintStateFields({ table_name: 'T4' })).toBe(null);
        expect(billPrintStateFields(null)).toBe(null);
    });

    it('falls back to last_printed_at for the latest print', () => {
        expect(billPrintStateFields({ print_count: 1, last_printed_at: '2026-09-11T19:42:00.000Z' })).toEqual({
            print_count: 1,
            bill_printed_at: null,
            printed_at: '2026-09-11T19:42:00.000Z',
        });
    });

    it('NO_BILL_PRINTS is the backend\'s own never-printed record, field for field', () => {
        expect(NO_BILL_PRINTS).toEqual({ print_count: 0, bill_printed_at: null, printed_at: null });
    });

    it('client items 1-2: carries paper_stale, printed_as and printed_total only when the server sent them', () => {
        expect(billPrintStateFields({ ...payload(1), paper_stale: true, printed_as: '12', printed_total: 2100 })).toEqual({
            ...payload(1), paper_stale: true, printed_as: '12', printed_total: 2100,
        });
        expect(billPrintStateFields({ ...payload(1), paper_stale: null })).toEqual({ ...payload(1), paper_stale: null });
        // A pre-055 server's row is field-for-field what it was.
        expect(billPrintStateFields(payload(1))).toEqual(payload(1));
        // Junk is not carried.
        expect(billPrintStateFields({ ...payload(1), paper_stale: 'yes', printed_as: '  ', printed_total: 'x' })).toEqual(payload(1));
    });

    it('paperStaleOf: only a boolean the server sent', () => {
        expect(paperStaleOf({ paper_stale: true })).toBe(true);
        expect(paperStaleOf({ paper_stale: false })).toBe(false);
        for (const junk of [{ paper_stale: null }, { paper_stale: 'true' }, {}, null, undefined, 'x']) {
            expect(paperStaleOf(junk)).toBeNull();
        }
    });
});

describe('billPrintScope — the waiter gets one print, and the button says so', () => {
    it('SHOWS Print Bill to a waiter whose bill has not been printed', () => {
        const scope = billPrintScope(WAITER, serverSaysBillPrinted(payload(0)));
        expect(scope.print).toBe(true);
        expect(scope.printLabel).toBe(PRINT_BILL_LABEL);
        expect(scope.reprintNeedsSenior).toBe(false);
        expect(scope.retiresTable).toBe(false);
    });

    it('HIDES Print Bill once the server\'s count has moved — and the table STAYS on the waiter\'s list (client items 1-2)', () => {
        const scope = billPrintScope(WAITER, serverSaysBillPrinted(payload(1)));
        expect(scope.print).toBe(false);
        // The sentence that replaces the button. A waiter handed a blank space
        // presses it again on the next device they find.
        expect(scope.reprintNeedsSenior).toBe(true);
        // REWRITTEN ON PURPOSE (2.0.2). C3 used to take a printed table off the
        // waiter's view; "bills are settled only at night" and it vanished for
        // hours. It now stays, orange, until it is settled.
        expect(scope.retiresTable).toBe(false);
    });

    it('client items 1-2: a waiter may print ONLY an UPDATED bill — when the server says the paper is stale', () => {
        const stale = billPrintScope(WAITER, true, true);
        expect(stale).toEqual({ print: true, printLabel: PRINT_UPDATED_BILL_LABEL, updated: true, reprintNeedsSenior: false, retiresTable: false });
        // The same paper, or a paper nobody recorded: still a senior's.
        for (const paper of [false, null] as const) {
            const scope = billPrintScope(WAITER, true, paper);
            expect(scope).toEqual({ print: false, printLabel: PRINT_BILL_LABEL, updated: false, reprintNeedsSenior: true, retiresTable: false });
        }
        // Unprinted: the plain first print, whatever a stray flag says.
        expect(billPrintScope(WAITER, false, true)).toMatchObject({ print: true, printLabel: PRINT_BILL_LABEL, updated: false });
        // And the words are the app's.
        expect(PRINT_UPDATED_BILL_LABEL).toBe('Print updated bill');
    });

    it('a senior sees "Print updated bill" on stale paper too, and keeps the plain label otherwise', () => {
        expect(billPrintScope(MANAGER, true, true)).toMatchObject({ print: true, printLabel: PRINT_UPDATED_BILL_LABEL, updated: true });
        expect(billPrintScope(MANAGER, true, false)).toMatchObject({ print: true, printLabel: PRINT_BILL_LABEL, updated: false });
    });

    it('keeps the button for a waiter when the backend said nothing at all', () => {
        // Fails safe in the direction bill_print_state.ts chose: a guest waiting
        // with no way to get a bill is worse than a second copy of one.
        const scope = billPrintScope(WAITER, serverSaysBillPrinted({}));
        expect(scope.print).toBe(true);
        expect(scope.retiresTable).toBe(false);
    });

    it('leaves EVERY senior identity completely alone, however many times it has printed', () => {
        for (const printCount of [0, 1, 5]) {
            const scope = billPrintScope(MANAGER, serverSaysBillPrinted(payload(printCount)));
            expect(scope.print).toBe(true);
            expect(scope.reprintNeedsSenior).toBe(false);
            expect(scope.retiresTable).toBe(false);
        }
    });

    it('leaves a stale session alone too — the fix must not take the till away', () => {
        // `isWaiterOnly` answers false for anyone the server has not positively
        // scoped, including a session too old to carry the field. The failure
        // worth fearing is not "a waiter saw a figure", it is "the owner could
        // not print".
        const scope = billPrintScope(STALE, serverSaysBillPrinted(payload(3)));
        expect(scope.print).toBe(true);
        expect(scope.retiresTable).toBe(false);
        expect(billPrintScope(null, true).print).toBe(true);
        expect(billPrintScope(undefined, true).print).toBe(true);
    });

    it('ignores the role STRINGS entirely — the csrorganics shape must stay scoped', () => {
        // A waiter granted any custom role carries a uuid in role_all, and the
        // old client rule `roles.every(r => r === 'waiter')` lifted every
        // restriction for exactly this person. The scope block is the only input.
        const waiterWithCustomRole = {
            scope: { waiter_only: true },
            role: 'waiter',
            role_all: ['waiter', 'd2b1f0c4-0000-4000-8000-000000000001'],
        } as unknown as ScopedSession;
        expect(billPrintScope(waiterWithCustomRole, true).print).toBe(false);

        const waiterWhoIsAlsoManager = {
            scope: { waiter_only: false },
            role: 'waiter',
            role_all: ['waiter', 'manager'],
        } as unknown as ScopedSession;
        expect(billPrintScope(waiterWhoIsAlsoManager, true).print).toBe(true);
    });
});

describe('billPrintRefusal — the server\'s sentence, never one of ours', () => {
    /** The body POST /print/bill/claim and POST /print/bill both answer with. */
    const refusalBody = {
        error: 'Forbidden',
        details: "This table's bill has already been printed. A reprint has to be made by a "
            + 'admin, manager, cashier, captain — ask one of them.',
        reprint_needs_senior: true,
        print_count: 2,
        bill_printed_at: '2026-09-11T13:40:00.000Z',
        printed_at: '2026-09-11T13:40:00.000Z',
        allowed_roles: ['admin', 'manager', 'cashier', 'captain'],
    };

    it('surfaces `details` verbatim — the roles it names are the SERVER\'s list', () => {
        const refusal = billPrintRefusal(refusalBody);
        expect(refusal?.message).toBe(refusalBody.details);
        // Not asserted as a literal sentence written here: what matters is that
        // nothing between the route and the toast rewords it. ROLES_OUTRANKING_WAITER
        // is server-side and a tenant's configuration can outlive our copy of it.
        expect(refusal?.message).toContain('manager');
    });

    it('carries the state the refusal reported, so the button can go immediately', () => {
        expect(billPrintRefusal(refusalBody)?.state).toEqual({
            print_count: 2,
            bill_printed_at: '2026-09-11T13:40:00.000Z',
            printed_at: '2026-09-11T13:40:00.000Z',
        });
    });

    it('is keyed on `reprint_needs_senior` and NOT on the status or the wording', () => {
        // A plain permission 403 from the same route — an identity that cannot
        // print at all — must not be reported as "you have already printed this".
        expect(billPrintRefusal({ error: 'Forbidden', details: 'Missing permission' })).toBe(null);
        expect(billPrintRefusal({ reprint_needs_senior: false })).toBe(null);
        expect(billPrintRefusal(null)).toBe(null);
        expect(billPrintRefusal('Forbidden')).toBe(null);
    });

    it('falls back to `error` when the route sent no sentence', () => {
        expect(billPrintRefusal({ reprint_needs_senior: true, error: 'Already printed' })?.message)
            .toBe('Already printed');
    });
});

describe('the REPRINT marker — one spelling, shared with the thermal path', () => {
    it('is byte-for-byte what escpos.ts prints', () => {
        // If this ever diverges, the same bill printed off a till and off the
        // dashboard carries two different banners and a guest holding both has no
        // way to tell they are one document. Thirteen characters is also what
        // survives double-width on 58mm paper.
        expect(REPRINT_MARKER).toBe('** REPRINT **');
        expect(REPRINT_MARKER.length).toBe(13);
    });

    it('marks a bill the SERVER says was already printed, and only that one', () => {
        expect(isReprintOfPrintedBill(payload(1))).toBe(true);
        expect(isReprintOfPrintedBill(payload(4))).toBe(true);
        expect(isReprintOfPrintedBill(payload(0))).toBe(false);
    });

    it('does NOT mark a bill when there is no server answer to mark it from', () => {
        // The safe direction. An unmarked reprint is a bookkeeping annoyance; a
        // REPRINT banner across a genuine first bill is a document the guest is
        // entitled to query.
        expect(isReprintOfPrintedBill(null)).toBe(false);
        expect(isReprintOfPrintedBill(undefined)).toBe(false);
        expect(isReprintOfPrintedBill({})).toBe(false);
    });

    it('reads the state as it stood BEFORE the claim, which is the only figure that answers the question', () => {
        // POST /print/bill/claim increments the ledger and answers with the NEW
        // count — its own test asserts `print_count: 1` after a FIRST print. A
        // page that marked off the post-claim figure would stamp REPRINT on every
        // original bill in the restaurant.
        const beforeFirstPrint = payload(0);
        const claimResponseAfterFirstPrint = { print_count: 1, bill_printed_at: '2026-09-11T14:05:00.000Z', printed_at: '2026-09-11T14:05:00.000Z' };
        expect(isReprintOfPrintedBill(beforeFirstPrint)).toBe(false);
        expect(isReprintOfPrintedBill(claimResponseAfterFirstPrint)).toBe(true);
    });
});

describe('the UPDATED bill and the stale-paper settle (client items 1-2)', () => {
    it('the banner is the backend\'s, byte for byte', () => {
        expect(UPDATED_BILL_MARKER).toBe('** UPDATED BILL **');
    });

    it('the claim\'s revised note is read only when the claim said revised', () => {
        expect(billRevisedNoteOf({ revised: true, revised_note: 'Replaces the bill printed 13:32' })).toBe('Replaces the bill printed 13:32');
        expect(billRevisedNoteOf({ revised: true })).toBe('Replaces an earlier printed bill');
        expect(billRevisedNoteOf({ revised: false, revised_note: 'Replaces the bill printed 13:32' })).toBeNull();
        expect(billRevisedNoteOf({ revised: 'true' })).toBeNull();
        expect(billRevisedNoteOf(null)).toBeNull();
    });

    it("the claim's own job id is read for the thermal copy of the same paper, and nothing else is", () => {
        expect(billPaperJobIdOf({ success: true, recorded: true, jobId: ' 9a000000-0000-4000-8000-000000000001 ' })).toBe('9a000000-0000-4000-8000-000000000001');
        for (const other of [{ recorded: false, jobId: null }, { jobId: '' }, { jobId: 7 }, {}, null, 'job', []]) {
            expect(billPaperJobIdOf(other)).toBeNull();
        }
    });

    it('the settle warning: with amounts for a senior, without for a reader who was not sent them, and never on a guess', () => {
        expect(stalePaperSettleWarning({ paperStale: true, printedClock: '13:32', printedTotal: 2100, grandTotal: 2220 }))
            .toBe('The printed bill (13:32) shows ₹2,100.00; the bill is now ₹2,220.00. Print the updated bill before taking payment.');
        expect(stalePaperSettleWarning({ paperStale: true, printedClock: '', printedTotal: null, grandTotal: 2220 }))
            .toBe('The printed bill no longer matches the bill. Print the updated bill before taking payment.');
        for (const paperStale of [false, null, undefined]) {
            expect(stalePaperSettleWarning({ paperStale, printedTotal: 2100, grandTotal: 2220 })).toBeNull();
        }
        expect(SETTLE_ANYWAY_LABEL).toBe('Settle anyway');
    });
});

describe('billReceiptIsReprint — R2 item 4, the banner on the web preview and its paper', () => {
    it('a FIRST print shows no banner', () => {
        expect(billReceiptIsReprint('open', payload(0))).toBe(false);
        expect(billReceiptIsReprint('open', { bill_printed_at: null })).toBe(false);
    });

    it('a REPRINT shows it — the bill had been printed at least once before this press', () => {
        expect(billReceiptIsReprint('open', payload(1))).toBe(true);
        expect(billReceiptIsReprint('open', payload(3))).toBe(true);
        expect(billReceiptIsReprint('open', { print_count: 0, printed_at: '2026-09-11T13:40:00.000Z' })).toBe(true);
    });

    it('C3 claim flow: the stamp is priorPrintState, captured before the claim — the claim\'s own count is never it', () => {
        // What triggerPrint does, in order: read /bill-for-table, keep its state,
        // THEN claim. The claim answers with the incremented count.
        const priorPrintState = billPrintStateFields(payload(0));
        const claimAnswer = { print_count: 1, bill_printed_at: '2026-09-11T14:05:00.000Z', printed_at: '2026-09-11T14:05:00.000Z' };
        const printPayload = { bill_print_state: priorPrintState, printable_bill: { ...claimAnswer, grand_total: 590 } };
        expect(billReceiptIsReprint('open', printPayload.bill_print_state)).toBe(false);

        // The second press: the state before THAT claim already says printed once.
        const secondPrior = billPrintStateFields(claimAnswer);
        expect(billReceiptIsReprint('open', secondPrior)).toBe(true);
    });

    it('no stamp (a legacy ?order= link, a failed read) means no banner', () => {
        expect(billReceiptIsReprint('open', null)).toBe(false);
        expect(billReceiptIsReprint('open', undefined)).toBe(false);
    });

    it('a SETTLED document is not marked off a stamp that describes the open seating', () => {
        expect(billReceiptIsReprint('settled', payload(2))).toBe(false);
    });
});
