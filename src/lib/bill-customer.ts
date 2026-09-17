// R2 ITEM 1 — THE NAME AND THE GSTIN ON A BILL, FOR A LIVE TABLE AND A PAST ONE.
// CLIENT ITEM 7 — AND THE GUEST'S ADDRESS: "An option in the tables section to
// add the ADDRESS of a guest to the bill, like name and GSTIN, especially for
// corporate parties." Same dialog, same two routes, same omitted-is-unchanged
// rule, one more field.
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

// ---------------------------------------------------------------------------
// CLIENT ITEM 7 — THE ADDRESS
// ---------------------------------------------------------------------------
// The backend's rule (customer_address.ts), mirrored for instant feedback: line
// breaks kept, each line trimmed with inner runs of spaces collapsed, blank
// lines dropped, empty clears. OVER THE LIMITS IS REFUSED, NEVER CUT — which is
// why the box has no `maxLength` (a browser silently truncates a paste to it)
// and shows a counter and this sentence instead.

/** Lines an address may have once blank ones are dropped (the backend's CUSTOMER_ADDRESS_MAX_LINES). */
export const ADDRESS_MAX_LINES = 5;

/** Characters the stored address may have, line breaks included (CUSTOMER_ADDRESS_MAX_CHARS). */
export const ADDRESS_MAX_CHARS = 250;

/** The backend's 400 sentence, verbatim. */
export const ADDRESS_LIMIT_ERROR = 'Address can be at most 5 lines and 250 characters';

/** The label the paper puts before the address's first line. */
export const ADDRESS_LABEL = 'Address:';

/**
 * The line under the box — the app says the same words. The printer is sent
 * ASCII (escpos.ts's asciiSafe), so an address in another script prints as
 * question marks; saying so beats a guest finding out from the paper.
 */
export const ADDRESS_HELP = 'Up to 5 lines. Leave it empty for none. Letters outside English print as "?".';

/**
 * The address as the server will store it — lines joined by LF — or null when
 * nothing is left (which clears it). Does NOT apply the limits; see addressError.
 */
export const normalizeAddress = (raw: unknown): string | null => {
    if (typeof raw !== 'string') { return null; }
    const lines = raw
        .replace(/\r\n?|[\u0085\u2028\u2029]/g, '\n')
        .replace(/\t/g, ' ')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
        .split('\n')
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .filter((l) => l.length > 0);
    return lines.length === 0 ? null : lines.join('\n');
};

/** How much of each limit the box uses, measured as the server measures it. */
export const addressUsage = (raw: unknown): { lines: number; chars: number } => {
    const value = normalizeAddress(raw);
    return value === null ? { lines: 0, chars: 0 } : { lines: value.split('\n').length, chars: value.length };
};

/** The sentence to show under the box, or null when the value is acceptable (within limits, or empty). */
export const addressError = (raw: unknown): string | null => {
    const { lines, chars } = addressUsage(raw);
    return lines > ADDRESS_MAX_LINES || chars > ADDRESS_MAX_CHARS ? ADDRESS_LIMIT_ERROR : null;
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
 * THE ADDRESS AS THE BILL PRINTS IT: one entry per stored line, the first one
 * labelled — escpos.ts's customerAddressEntries, entry for entry. Each entry is
 * wrapped on its own by the renderer, so the guest's line breaks survive
 * (bill-escpos.ts's wrapText splits on any whitespace, and would otherwise fold
 * them into one paragraph).
 */
export const billAddressLines = (address: unknown): string[] => {
    const value = present(address);
    if (!value) { return []; }
    return value
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .map((l, i) => (i === 0 ? `${ADDRESS_LABEL} ${l}` : l));
};

/**
 * THE CUSTOMER SLOT ON THE PRINTED BILL — the client's own receipt, reproduced.
 *
 * The real bill the client sent (req_images/line3088_1.jpeg) gives the name a
 * slot of its own DIRECTLY UNDER the restaurant header (logo, name, legal
 * entity, address, GSTN), between two rules and ABOVE the Date / Cashier /
 * Bill No. block, worded "Name:" as it is there. The thermal bill keeps that
 * slot, so this does too:
 *
 *     Name: <name>               (always — the paper always has the slot)
 *     Customer GSTIN: <gstin>    (only when one is set)
 *     Address: <line 1>          (client item 7 — only when one is set,
 *     <line 2> …                  one entry per stored line)
 *
 * A WALK-IN LEAVES THE SLOT BLANK — a bare "Name:", as the client's bill does.
 * "Guest" / "QR Guest" are the placeholders the ordering flows store for
 * "nobody gave a name" (isPlaceholderCustomer above); printed, they read as a
 * name somebody wrote down. That is escpos.ts's rule (`/^(qr )?guest$/i` prints
 * "Name:" alone); a name the server stored is printed as stored. The web
 * preview and its ESC/POS twin both read this, so a bill off the dashboard and a
 * bill off the till are one document.
 */
export const billCustomerLines = (customer: unknown, customerGstin: unknown, customerAddress?: unknown): string[] => {
    const name = isPlaceholderCustomer(customer) ? '' : present(customer);
    const lines = [name ? `Name: ${name}` : 'Name:'];
    const gstin = present(customerGstin);
    if (gstin) { lines.push(`Customer GSTIN: ${gstin}`); }
    lines.push(...billAddressLines(customerAddress));
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

/** The address as the dialog holds it — `undefined` is "not known and not touched", as for the GSTIN. */
export type AddressField = string | undefined;

/**
 * What the dialog puts in the address slot. SENT ONLY WHEN IT CHANGED:
 *
 *   * untouched — nothing. A dialog seeded from a payload WITHOUT
 *     `customer_address` (an older backend) must not wipe an address it could
 *     not see, and one that DID see it has nothing new to say;
 *   * touched, and the address was known — sent only if it now differs from
 *     the seed (typing and undoing is not a change);
 *   * touched, and it was NOT known — sent only if something is in the box. An
 *     empty box there is not "clear it": nobody on this screen saw an address
 *     to clear, so Clear, or a line typed and deleted again, must not take one
 *     off the bill.
 *
 * Stricter than the GSTIN's rule on purpose. Every address WRITE — an unchanged
 * one, or an empty one — is answered 503 by a database whose migration 054
 * column is not there yet, which would make a plain name correction fail for
 * want of a field nobody meant to touch. The owner app's
 * billCustomerAddressToSend is this rule, case for case.
 */
export const addressToSend = (box: string, seed: string, known: boolean, touched: boolean): AddressField => {
    if (!touched) { return undefined; }
    if (known) { return normalizeAddress(box) === normalizeAddress(seed) ? undefined : box; }
    return normalizeAddress(box) === null ? undefined : box;
};

export interface BillCustomerRequest {
    path: string;
    body: { table_name?: string; customer: string; customer_gstin?: string | null; customer_address?: string | null };
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
    address?: AddressField,
): BillCustomerRequest => {
    const name = typeof customer === 'string' ? customer : '';
    const gstinPart = gstin === undefined ? {} : { customer_gstin: normalizeGstin(gstin) };
    // Client item 7 — the same rule: unknown stays off the wire, empty is null.
    const addressPart = address === undefined ? {} : { customer_address: normalizeAddress(address) };
    if (target.kind === 'table') {
        return {
            path: '/bills/customer-name',
            body: { table_name: target.tableName, customer: name, ...gstinPart, ...addressPart },
        };
    }
    return {
        path: `/bills/${encodeURIComponent(target.billId)}/customer-details`,
        body: { customer: name, ...gstinPart, ...addressPart },
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
        /** Client item 7 — the address the server now holds (null when none). */
        customer_address: string | null;
        /** False when an address was sent and the answer has no such field (a backend before item 7). */
        addressSaved: boolean;
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
    'This server has not finished updating, so the name, GSTIN and address cannot be changed from here yet. Ask your administrator to complete the update.';

/**
 * The sentence for an address the server did not keep — the owner app's
 * billCustomerAddressNotSaved is these words exactly, and
 * bill-customer-address.test.ts compares the two.
 */
export const ADDRESS_NOT_SAVED_MESSAGE =
    'The address was not saved: this server has not finished updating. Ask your administrator to complete the update.';

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
    sentAddress = false,
): Promise<BillCustomerSaveOutcome> => {
    const ok = status >= 200 && status < 300;
    const parsed = parseJson(bodyText);
    if (ok) {
        const row = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
        const hasGstin = 'customer_gstin' in row;
        const hasAddress = 'customer_address' in row;
        const customer = present(row.customer);
        return {
            ok: true,
            customer: customer === '' ? null : customer,
            customer_gstin: hasGstin ? (present(row.customer_gstin) || null) : null,
            gstinSaved: !sentGstin || hasGstin,
            customer_address: hasAddress ? normalizeAddress(row.customer_address) : null,
            addressSaved: !sentAddress || hasAddress,
        };
    }
    if (status === 404 && refusalSentence(parsed) === null) {
        return { ok: false, outdated: true, message: OUTDATED_SERVER_MESSAGE, status };
    }
    const message = await readErrorMessage(
        { status, text: () => Promise.resolve(bodyText) },
        'The name, GSTIN and address could not be saved.',
    );
    return { ok: false, outdated: false, message, status };
};

/**
 * What the dialog can seed itself with from a bill payload.
 *
 * `gstinKnown` is false when the payload carries no `customer_gstin` key at all —
 * an older backend, or a failed read — which keeps the GSTIN off the wire unless
 * somebody types in the box (see {@link billCustomerPayload}). `addressKnown` is
 * the same for `customer_address` (client item 7), which the settled-bill LIST
 * never carries.
 */
export const billCustomerSeed = (bill: unknown): {
    customer: string; gstin: string; gstinKnown: boolean; address: string; addressKnown: boolean;
} => {
    const row = bill && typeof bill === 'object' ? (bill as Record<string, unknown>) : null;
    const customer = row && !isPlaceholderCustomer(row.customer) ? present(row.customer) : '';
    const gstinKnown = row !== null && 'customer_gstin' in row;
    const addressKnown = row !== null && 'customer_address' in row;
    return {
        customer,
        gstin: gstinKnown ? present(row.customer_gstin) : '',
        gstinKnown,
        address: addressKnown ? (normalizeAddress(row.customer_address) ?? '') : '',
        addressKnown,
    };
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

/**
 * CLIENT ITEM 8 — may this session REPRINT a settled bill (POST
 * /print/bill/settled)? The route's own gate, quoted. Accounting and History
 * both mount the settled-bills section, and History is also open to a login
 * that holds only an analytics / report action: without this, that login saw a
 * "Reprint bill" button whose every press came back 403. Hidden, not greyed,
 * like the edit beside it.
 */
export const canReprintSettledBill = (session: { actions_set?: unknown } | null | undefined): boolean =>
    hasPermission(session?.actions_set, PERM_ACCOUNTING);
