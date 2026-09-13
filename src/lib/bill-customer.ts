// R2 ITEM 1 — THE NAME AND THE GSTIN ON A BILL, FOR A LIVE TABLE AND A PAST ONE.
//
// Client, verbatim: "Allow users to update or change the customer's name on the
// bill directly within the dashboard. This also includes customer GST number for
// corporate parties. This option has to come in the past bills section in
// accounting and in live tables where on top of a clicked table these details
// can be updated."
//
// ============================================================================
// ONE DIALOG, TWO ROUTES
// ============================================================================
// 6.5 already shipped a name dialog for a RUNNING table (POST /bills/customer-name,
// addressed by table name). A SETTLED bill cannot be addressed that way — the
// table name answers with whoever is sitting there now — so the past-bills
// section writes through POST /bills/:billId/customer-details instead. The two
// routes take the same two fields and the same validation, so the dialog is one
// component and the payloads are built here, where a test can read them.
//
// ============================================================================
// THE SERVER IS THE AUTHORITY; THIS FILE IS THE INSTANT FEEDBACK
// ============================================================================
// The GSTIN rule below is the backend's, quoted from the shared contract: trim,
// uppercase, strip internal spaces, empty clears, then the 15-character pattern.
// It is mirrored so a typo is caught while the person is still looking at the
// field. If the two ever disagree the server's 400 wins and its sentence is shown
// verbatim — this module never re-words a refusal.
//
// PURE — no React, no fetch, no `window` — so `__tests__/bill-customer.test.ts`
// can pin it. `db.ts` carries "use server" and may export ONLY async functions,
// which is why none of this can live there.

import { readErrorMessage, refusalSentence } from './error-message';
import { hasPermission, PERM_ACCOUNTING } from './mis-capture';

/** The backend's pattern, verbatim: 2 digits, 5 letters, 4 digits, letter, 1-9/A-Z, Z, check char. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** The backend's 400 sentence, verbatim, so the instant feedback and the refusal read the same. */
export const GSTIN_FORMAT_ERROR = 'GSTIN must be 15 characters, e.g. 29ABCDE1234F1Z5';

/**
 * What the field holds while somebody types: uppercased, with every space gone.
 * Applied on each keystroke, so a pasted "29 abcde 1234 f1z5" becomes the value
 * the server will store before the person has finished reading it.
 */
export const gstinAsTyped = (raw: string): string => raw.toUpperCase().replace(/\s+/g, '');

/** The value to SEND: normalised, and `null` when empty — which clears it. */
export const normalizeGstin = (raw: unknown): string | null => {
    if (typeof raw !== 'string') { return null; }
    const value = gstinAsTyped(raw.trim());
    return value === '' ? null : value;
};

/** The sentence to show under the field, or null when the value is acceptable (valid, or empty). */
export const gstinError = (raw: unknown): string | null => {
    const value = normalizeGstin(raw);
    if (value === null) { return null; }
    return GSTIN_PATTERN.test(value) ? null : GSTIN_FORMAT_ERROR;
};

/**
 * "Guest" and "QR Guest" are what the server writes when nobody named the bill.
 * They are placeholders, not names: never seeded back into the box, and never
 * shown on the table preview as though somebody had typed them.
 */
export const isPlaceholderCustomer = (name: unknown): boolean => {
    const value = typeof name === 'string' ? name.trim() : '';
    return value === '' || /^(guest|qr guest)$/i.test(value) || /^(null|undefined)$/i.test(value);
};

/** A string off a payload, with JSON-round-tripped "null"/"undefined" read as absent. */
const present = (value: unknown): string => {
    const s = typeof value === 'string' ? value.trim() : '';
    return /^(null|undefined)$/i.test(s) ? '' : s;
};

/**
 * THE CUSTOMER SLOT ON THE PRINTED BILL — the client's own receipt, reproduced.
 *
 * The real bill the client sent (req_images/line3088_1.jpeg) gives the name a
 * slot of its own DIRECTLY UNDER the restaurant header (logo, name, legal
 * entity, address, GSTN), between two rules and ABOVE the Date / Cashier /
 * Bill No. block. The thermal bill keeps that slot, so this does too:
 *
 *     Customer Name: <name, or Guest>   (always — the paper always has the slot)
 *     Customer GSTIN: <gstin>           (only when one is set)
 *
 * "Guest" for an empty name is what the thermal renderer prints
 * (`present(opts.customer) || "Guest"` in escpos.ts); a name the server stored
 * is printed as stored. The web preview and its ESC/POS twin both read this, so
 * a bill off the dashboard and a bill off the till are one document.
 */
export const billCustomerLines = (customer: unknown, customerGstin: unknown): string[] => {
    const lines = [`Customer Name: ${present(customer) || 'Guest'}`];
    const gstin = present(customerGstin);
    if (gstin) { lines.push(`Customer GSTIN: ${gstin}`); }
    return lines;
};

// ---------------------------------------------------------------------------
// WHAT THE DIALOG SENDS
// ---------------------------------------------------------------------------

/** Which bill the dialog is editing. */
export type BillCustomerTarget =
    | { kind: 'table'; tableName: string }
    | { kind: 'bill'; billId: string; billNo?: string | null };

/**
 * The GSTIN as the dialog holds it. `undefined` means "this dialog does not know
 * the current GSTIN and nobody touched the field" — see {@link billCustomerPayload}.
 */
export type GstinField = string | undefined;

/**
 * What the dialog puts in the GSTIN slot of the request.
 *
 * The box is SENT when the dialog knows the bill's current GSTIN (it was seeded
 * from a payload carrying the key) or when the person typed in it / pressed
 * Clear. Otherwise — a failed seeding read, or a backend that sends no such
 * field — it is left off, so a name correction cannot wipe a registration
 * nobody on this screen could see.
 */
export const gstinToSend = (box: string, known: boolean, touched: boolean): GstinField =>
    known || touched ? box : undefined;

export interface BillCustomerRequest {
    path: string;
    body: { table_name?: string; customer: string; customer_gstin?: string | null };
}

/**
 * The route and body for one save.
 *
 * AN UNKNOWN GSTIN IS OMITTED, NOT SENT AS NULL. On the live-table route an
 * absent `customer_gstin` means "leave it as it is" and `null` means "clear it".
 * A dialog whose seeding read failed — or that talked to a backend too old to
 * send the field — shows an empty box that is not the same thing as an empty
 * GSTIN, and saving a name correction from it must not silently wipe a
 * corporate party's registration. So `undefined` stays off the wire; an empty
 * string the person actually left there goes as `null`.
 */
export const billCustomerPayload = (
    target: BillCustomerTarget,
    customer: string,
    gstin: GstinField,
): BillCustomerRequest => {
    const name = typeof customer === 'string' ? customer : '';
    const gstinPart = gstin === undefined ? {} : { customer_gstin: normalizeGstin(gstin) };
    if (target.kind === 'table') {
        return {
            path: '/bills/customer-name',
            body: { table_name: target.tableName, customer: name, ...gstinPart },
        };
    }
    return {
        path: `/bills/${encodeURIComponent(target.billId)}/customer-details`,
        body: { customer: name, ...gstinPart },
    };
};

// ---------------------------------------------------------------------------
// WHAT CAME BACK
// ---------------------------------------------------------------------------

export type BillCustomerSaveOutcome =
    | {
        ok: true;
        customer: string | null;
        customer_gstin: string | null;
        /**
         * False when a GSTIN was sent and the response did not carry the field —
         * a backend older than the contract, which accepted the name and ignored
         * the rest. The dialog says so instead of claiming the GSTIN was saved.
         */
        gstinSaved: boolean;
    }
    | {
        ok: false;
        /** The route does not exist on this server yet (the web deployed first). */
        outdated: boolean;
        /** The server's sentence, verbatim, or the not-updated sentence. */
        message: string;
        status: number;
    };

/** The sentence for a server that has not got the route yet — the 6.5 wording, kept. */
export const OUTDATED_SERVER_MESSAGE =
    'This server has not finished updating, so the name and GSTIN cannot be changed from here yet. Ask your administrator to complete the update.';

/** The sentence for a request that never reached the server. */
export const UNREACHABLE_MESSAGE = 'Could not reach the server, so nothing was saved. Check the connection and try again.';

const parseJson = (text: string): unknown => {
    try { return JSON.parse(text); } catch { return null; }
};

/**
 * Turn one response into what the dialog shows.
 *
 * A 404 MEANS TWO DIFFERENT THINGS, AND THE BODY TELLS THEM APART. The new route
 * answers `404 { error: "Bill not found" }` for a bill that is not this tenant's
 * or not closed — a real refusal, shown verbatim. A server that predates the
 * route answers with Express's own HTML "Cannot POST …" page, which carries no
 * sentence at all; that is the web being a release ahead of the API, and it gets
 * the "not finished updating" wording 6.5 already uses.
 *
 * Async only because `readErrorMessage` is; it reads nothing but its arguments.
 */
export const billCustomerSaveOutcome = async (
    status: number,
    bodyText: string,
    sentGstin: boolean,
): Promise<BillCustomerSaveOutcome> => {
    const ok = status >= 200 && status < 300;
    const parsed = parseJson(bodyText);
    if (ok) {
        const row = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
        const hasGstin = 'customer_gstin' in row;
        const customer = present(row.customer);
        return {
            ok: true,
            customer: customer === '' ? null : customer,
            customer_gstin: hasGstin ? (present(row.customer_gstin) || null) : null,
            gstinSaved: !sentGstin || hasGstin,
        };
    }
    if (status === 404 && refusalSentence(parsed) === null) {
        return { ok: false, outdated: true, message: OUTDATED_SERVER_MESSAGE, status };
    }
    const message = await readErrorMessage(
        { status, text: () => Promise.resolve(bodyText) },
        'The name and GSTIN could not be saved.',
    );
    return { ok: false, outdated: false, message, status };
};

/**
 * What the dialog can seed itself with from a bill payload.
 *
 * `gstinKnown` is false when the payload carries no `customer_gstin` key at all —
 * an older backend, or a failed read — which keeps the GSTIN off the wire unless
 * somebody types in the box (see {@link billCustomerPayload}).
 */
export const billCustomerSeed = (bill: unknown): { customer: string; gstin: string; gstinKnown: boolean } => {
    const row = bill && typeof bill === 'object' ? (bill as Record<string, unknown>) : null;
    const customer = row && !isPlaceholderCustomer(row.customer) ? present(row.customer) : '';
    const gstinKnown = row !== null && 'customer_gstin' in row;
    return { customer, gstin: gstinKnown ? present(row.customer_gstin) : '', gstinKnown };
};

/**
 * May this session edit the name/GSTIN on a SETTLED bill?
 *
 * The SAME permission POST /print/bill/settled (E5, the accounting reprint) is
 * gated on — ACCOUNTING_PERM — because the contract puts the new route behind
 * exactly that gate. Quoted, not minted (migration 025's rule).
 */
export const canEditSettledBillCustomer = (session: { actions_set?: unknown } | null | undefined): boolean =>
    hasPermission(session?.actions_set, PERM_ACCOUNTING);
