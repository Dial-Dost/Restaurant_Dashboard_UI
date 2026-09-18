// C3 — HAS THIS SEATING'S BILL BEEN PRINTED, AND WHAT DOES THAT COST THE WAITER?
//
// V3, verbatim: "Waiters can only execute the 'Print Bill' action once. After
// clicking it, the button must disappear, and the table should clear/reset from
// their view. Any subsequent actions (like reprinting or overrides) must be
// restricted to Super Admins."
//
// ============================================================================
// THE DEFECT THIS EXISTS TO NOT REPEAT: A DEVICE THAT REMEMBERS
// ============================================================================
// The Flutter app implemented "once" by hiding the button and remembering the
// press IN THE TABLET (`services/printed_bills.dart`). A device memory survives
// a back-navigation and an app restart and survives NOTHING ELSE: not a
// reinstall, not a second tablet, not a bare curl — and this dashboard is the
// THIRD client on the same floor. A rule about "once" that each device answers
// privately is a rule that means something different on every device in the
// building, which is the same failure `session-scope.ts` was written to end for
// the role scoping.
//
// So the answer comes off the SERVER, on both payloads that carry it. The
// backend's `bill_print_state.ts` ships `print_count`, `bill_printed_at` and
// `printed_at` on GET /bill-for-table AND on every /get-tables row, in the same
// three spellings, precisely so a client needs no second code path. This module
// reads those fields and nothing else. There is deliberately no localStorage
// fallback here: the web has never had one, and adding one now would be
// importing the bug rather than the feature.
//
// ============================================================================
// THREE ANSWERS, NOT TWO — printed, not printed, and NOBODY ASKED
// ============================================================================
// PRESENCE OF THE KEY IS THE SIGNAL, not truthiness of its value. `print_count:
// 0` and `bill_printed_at: null` are the server SAYING "this seating's bill has
// not been printed", which is the ordinary case on every unprinted table; only a
// payload carrying NONE of the keys is a backend too old to have been asked.
// Folding those two together is what let the Flutter grid hand the answer back
// to a tablet's memory, and it is why `serverBillPrintState` returns a tri-state
// rather than a bool.
//
// IT FAILS SAFE, IN THE DIRECTION THE BACKEND ALREADY CHOSE. No answer means
// "not printed" — the waiter keeps their button. A waiter standing at a table
// with a guest waiting and no way to produce a bill is a worse outage than a
// second copy of one, and `bill_print_state.ts` says so in as many words.
//
// ============================================================================
// THE BUTTON IS THE COURTESY; THE ROUTE IS THE CONTROL
// ============================================================================
// POST /print/bill already refuses a waiter-only identity's second print with a
// 403 naming who to ask (routes/bills.ts, pinned by
// jest-tests/print_once_authority.test.ts), and POST /print/bill/claim applies
// the same rule to the DASHBOARD's print path — which until now told the server
// nothing at all and was therefore unenforced here. What this module does is
// stop drawing a control whose route would refuse; it is not itself the gate.
//
// PURE — no React, no fetch, no `window` — so `__tests__/bill-print-state.test.ts`
// can pin every branch without driving a browser. Same precedent as
// `session-scope.ts`, `service-clock.ts` and `table-assignment.ts`: `db.ts`
// carries "use server" and may export ONLY async functions, so a plain
// `export const` there is a build error that tsc and jest both wave through
// while every page 500s at runtime.

import { isWaiterOnly, type ScopedSession } from './session-scope';

/**
 * The keys that carry print state, in preference order — the same four the
 * Flutter client reads (`billPrintStateKeys` in `screens/modules.dart`), so the
 * two clients agree about what the backend owes them. `last_printed_at` is
 * accepted for the same reason it is there: the backend lane was never forced
 * into one spelling, and a reader that knows only one of them is a reader that
 * silently stops working when the other ships.
 */
export const BILL_PRINT_STATE_KEYS = [
    'bill_printed_at',
    'printed_at',
    'last_printed_at',
    'print_count',
] as const;

/**
 * The three fields as the server sends them. Kept as a record rather than a
 * bare boolean because an INSTANT can be shown to a human ("printed 18:42")
 * and a count cannot, and because the 403 body carries both.
 */
export interface BillPrintState {
    /** How many times THIS seating's bill has been printed. 0 = never. */
    print_count: number;
    /** The FIRST print — the one that used a waiter's single attempt. ISO or null. */
    bill_printed_at: string | null;
    /** The LATEST print, ISO or null, so a till can say "last printed 19:42". */
    printed_at: string | null;
}

/** A seating whose bill has never been printed. */
export const NO_BILL_PRINTS: BillPrintState = { print_count: 0, bill_printed_at: null, printed_at: null };

const asRecord = (value: unknown): Record<string, unknown> | null =>
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

/** A non-empty ISO-ish string, or null. "null"/"undefined" that have been through a JSON round-trip count as absent. */
const asInstant = (value: unknown): string | null => {
    if (typeof value !== 'string') { return null; }
    const trimmed = value.trim();
    if (trimmed === '' || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined') { return null; }
    return trimmed;
};

const asCount = (value: unknown): number => {
    // A count that has been through JSON can arrive as a number or as its
    // decimal string; anything else is not a count and reads as zero.
    if (typeof value === 'number') { return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0; }
    if (typeof value !== 'string') { return 0; }
    const n = Number(value.trim());
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/**
 * HAS THE SERVER SAID THIS BILL WAS PRINTED? — true / false / "nobody asked".
 *
 * `null` means the payload carried none of {@link BILL_PRINT_STATE_KEYS} at all,
 * i.e. a backend older than the fields. It does NOT mean "not printed", and the
 * distinction is the whole point: see this file's header for the `||` that ate
 * the Flutter floor grid.
 */
export const serverBillPrintState = (payload: unknown): boolean | null => {
    const row = asRecord(payload);
    if (!row) { return null; }

    let answered = false;
    for (const key of ['bill_printed_at', 'printed_at', 'last_printed_at'] as const) {
        if (!(key in row)) { continue; }
        answered = true;
        if (asInstant(row[key]) !== null) { return true; }
    }
    if ('print_count' in row) {
        answered = true;
        if (asCount(row.print_count) > 0) { return true; }
    }
    return answered ? false : null;
};

/**
 * "Did the server say printed?" with no answer read as NO.
 *
 * Fails safe in the backend's own direction — see the header. Anything that has
 * a genuine second source must use {@link serverBillPrintState} instead, or it
 * re-introduces the `||` that demoted the server below a tablet's memory.
 */
export const serverSaysBillPrinted = (payload: unknown): boolean =>
    serverBillPrintState(payload) ?? false;

/**
 * The three fields lifted off a payload verbatim, or null when it carries none
 * of them. Used to STAMP a print payload with the state the server reported
 * BEFORE the print was claimed — which is what makes "is this a reprint"
 * answerable on the print page without it re-reading a count its own claim has
 * already incremented. See `orders/print/page.tsx`.
 */
export const billPrintStateFields = (payload: unknown): BillPrintState | null => {
    const row = asRecord(payload);
    if (!row) { return null; }
    if (!BILL_PRINT_STATE_KEYS.some((key) => key in row)) { return null; }
    return {
        print_count: asCount(row.print_count),
        bill_printed_at: asInstant(row.bill_printed_at),
        printed_at: asInstant(row.printed_at) ?? asInstant(row.last_printed_at),
    };
};

/**
 * WHAT THIS SESSION MAY DO ABOUT THIS TABLE'S BILL RIGHT NOW.
 *
 * A direct port of the Flutter app's `BillPrintScope` (`models/role_scope.dart`),
 * deliberately field-for-field: one object asked at every affordance, so the
 * button, the sentence that replaces it and the table's presence on the floor
 * cannot end up answering three slightly different questions.
 *
 * WHO IS NARROWED: waiter-only identities, decided by `isWaiterOnly` — the
 * SERVER's own predicate, the same one the route's 403 is keyed on. Never a role
 * string, never a third rule. A manager, cashier, captain or admin is COMPLETELY
 * unaffected: same control, same number of presses, same table on their floor.
 * The requirement names "Super Admins" as who a WAITER escalates to, not as a
 * new ceiling on the people who run the restaurant.
 */
export interface BillPrintScope {
    /** May the Print Bill control be drawn and pressed at all right now? */
    print: boolean;
    /**
     * This reader has used up their one print and a second one is somebody
     * else's to make. Drives the sentence shown in the button's place — a waiter
     * handed a blank space where a control was will press it again on the next
     * device they find.
     */
    reprintNeedsSenior: boolean;
    /**
     * Does this table now leave THIS reader's view?
     *
     * NEVER a release, never a settle, never a write of any kind — a row is
     * filtered out of one list, on one screen, for one identity. The table is
     * still occupied, still owes the money, and is still on every manager's
     * screen. That difference is the whole of "clear/reset from their view"
     * versus "clear the table", and it has to be that way: C2 forbids this same
     * waiter from settling, so "clear the table" could not have been what was
     * meant.
     */
    retiresTable: boolean;
}

/** Everyone senior, and every identity the server has not positively scoped. */
const UNSCOPED_PRINT_SCOPE: BillPrintScope = { print: true, reprintNeedsSenior: false, retiresTable: false };

/**
 * @param printed the SERVER's answer for this seating's bill — see
 *        {@link serverSaysBillPrinted}. Never a device memory.
 */
export const billPrintScope = (
    session: ScopedSession | null | undefined,
    printed: boolean,
): BillPrintScope => {
    if (!isWaiterOnly(session)) { return UNSCOPED_PRINT_SCOPE; }
    return { print: !printed, reprintNeedsSenior: printed, retiresTable: printed };
};

// ---------------------------------------------------------------------------
// THE REFUSAL — POST /print/bill/claim's 403, read rather than re-worded
// ---------------------------------------------------------------------------

/**
 * The 403 body POST /print/bill/claim answers a waiter's second print with,
 * quoted from the shape /print/bill already sends (routes/bills.ts):
 *
 *     { error: "Forbidden", details: "<the sentence>", reprint_needs_senior: true,
 *       print_count, bill_printed_at, printed_at, allowed_roles: [...] }
 *
 * `details` IS THE SENTENCE AND THIS APP DOES NOT WRITE ITS OWN. The backend
 * already names who may reprint instead ("...has to be made by a admin,
 * manager, cashier, captain — ask one of them"), and `ROLES_OUTRANKING_WAITER`
 * is a server-side list that a tenant's configuration can outlive. A second
 * wording here would drift from it the first time that list changes, and the
 * person being refused would be told to fetch the wrong person.
 */
export interface BillPrintRefusal {
    /** The server's own sentence, already unwrapped from `details`. */
    message: string;
    /** True when the refusal is specifically "this has been printed, ask a senior". */
    reprintNeedsSenior: boolean;
    /** The state the server reported with the refusal, when it sent any. */
    state: BillPrintState | null;
}

/**
 * Is this decoded 403 body the print-once refusal, and what did it say?
 *
 * Keyed on `reprint_needs_senior`, the flag the backend sets for exactly this
 * case and for no other — not on the status code, and not on the wording, so a
 * permission 403 from the same route (an identity lacking the print action at
 * all) is NOT mistaken for "you have already printed this".
 */
export const billPrintRefusal = (body: unknown): BillPrintRefusal | null => {
    const row = asRecord(body);
    if (row?.reprint_needs_senior !== true) { return null; }
    const details = typeof row.details === 'string' ? row.details.trim() : '';
    const error = typeof row.error === 'string' ? row.error.trim() : '';
    return {
        message: details || error,
        reprintNeedsSenior: true,
        state: billPrintStateFields(row),
    };
};

// ---------------------------------------------------------------------------
// THE REPRINT MARKER — one spelling, shared with the thermal path
// ---------------------------------------------------------------------------

/**
 * "Format reprint bills to clearly display the word 'Reprint' at the top."
 *
 * BYTE-FOR-BYTE THE BACKEND'S. `escpos.ts` prints this exact string, big and
 * first, when `opts.reprint === true`; the same bill can be printed through
 * either path, so two spellings would mean the same reprint is marked one way
 * off the till and another way off the dashboard — and a guest comparing two
 * slips has no way to know they are the same document. Thirteen characters is
 * also deliberate there: it survives double-width on 58mm paper (26 of 32
 * cells) rather than degrading to normal size, so do not "tidy" it.
 */
export const REPRINT_MARKER = '** REPRINT **';

/**
 * IS THE DOCUMENT ABOUT TO BE PRINTED A REPRINT?
 *
 * Answered off the SERVER's `print_count` / `bill_printed_at` as they stood
 * BEFORE this print was claimed, never off client state — the whole reason the
 * fields exist is that a per-device memory means something different on every
 * device.
 *
 * WHY "BEFORE". POST /print/bill/claim increments the durable ledger, so a
 * print page that re-read the count after its own claim would see 1 on a FIRST
 * print and stamp REPRINT on the original. The stamp taken at claim time is the
 * server's own figure for the state the bill was in when the operator pressed
 * the button, which is precisely the question "is this a reprint" asks.
 *
 * NO STAMP MEANS NO MARKER, and that is the safe direction: an unmarked reprint
 * is a slip that looks like an original, while a REPRINT banner on a genuine
 * first bill is a document the guest is entitled to question. The first is a
 * bookkeeping annoyance, the second undermines the bill itself.
 */
export const isReprintOfPrintedBill = (stamp: unknown): boolean => serverSaysBillPrinted(stamp);

/**
 * R2 ITEM 4 — DOES THIS RECEIPT PREVIEW CARRY THE REPRINT BANNER?
 *
 * "Reprint has to mention reprint on top once the bill has been reprinted and it
 * should show the same on the preview as well." The web print page IS the
 * preview (and, through Ctrl+P, the paper), so this is the one decision both of
 * those read.
 *
 * `stamp` is `bill_print_state` as the orders page captured it BEFORE POST
 * /print/bill/claim — `priorPrintState` in triggerPrint. Never the claim's own
 * answer and never the claimed `printable_bill`'s figures: the claim increments
 * the ledger, so anything read after it says 1 on a first print (see
 * {@link isReprintOfPrintedBill}).
 *
 * `source` is which server document the page resolved. Only the OPEN table bill
 * is marked, because the stamp was read off /bill-for-table, which is addressed
 * by table name and describes the open seating. A SETTLED bill on this page has
 * no before-the-claim print state of its own (GetClosedBill's projection carries
 * none), and "a closed bill is always a reprint" would be a guess made in the
 * browser. The accounting reprint of a settled bill goes through POST
 * /print/bill/settled, which the server always marks.
 */
export const billReceiptIsReprint = (source: 'open' | 'settled', stamp: unknown): boolean =>
    source === 'open' && isReprintOfPrintedBill(stamp);
