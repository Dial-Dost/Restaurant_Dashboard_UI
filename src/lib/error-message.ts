// WHAT THE SERVER ACTUALLY SAID WHEN IT REFUSED.
//
// THE BUG THIS MODULE EXISTS TO END. `readErrorMessage` in db.ts returned the
// literal string "Action forbidden" for ANY 403 *before the body was read*, and
// authService.ts carried a second copy of the same shortcut. So every carefully
// worded refusal the permission work added — "releasing this table would write
// off ₹1,240 of unpaid orders", "this bill has already been printed, ask a
// manager", "settling a bill requires the 'Close Bill' permission" — was parsed
// by nobody and thrown away before a human could read it. The person at the till
// got three generic words and walked off to find someone who could guess.
//
// A REFUSAL THAT EXPLAINS ITSELF IS THE DIFFERENCE between a waiter fetching the
// manager for the right reason and a waiter pressing the button again on the
// next device. The gate is the server's job; the SENTENCE is this file's.
//
// THE SHAPE THE BACKEND SPEAKS (routes/_shared.ts and friends):
//
//     { error: "Forbidden", details: "<the human sentence>",
//       requiredPermission?, requiredRoles?, allowed_roles?, write_off_value?, … }
//
// `error` is the machine-ish label and is very often the useless word
// "Forbidden"; `details` is the sentence written for a person. So `details`
// wins, a NON-GENERIC `error` is next, and only when the body carries neither do
// we fall back to the old wording. A 403 with no body at all still reads
// "Action forbidden", exactly as it used to.
//
// THE SECOND BUG, fixed here as well: the old helper called `response.json()`
// and, in the catch, `response.text()`. A `Response` body can only be consumed
// ONCE, so the moment the payload was not JSON the `.text()` call threw
// "body stream already read" and the plain-text body was lost too. This reads
// the body ONE time, as text, and parses that string.

/**
 * Labels that carry no information. A body whose only message is one of these
 * is treated as no message at all, so the caller's own status wording (which is
 * at least as clear, and is the wording the product has always used) wins.
 */
const GENERIC_LABELS = new Set([
    'forbidden',
    'action forbidden',
    'action not permitted',
    'not permitted',
    'not allowed',
    'unauthorized',
    'unauthorised',
    'error',
    'bad request',
    'internal server error',
]);

const cleanString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const isGeneric = (text: string): boolean => GENERIC_LABELS.has(text.toLowerCase().replace(/[.!]+$/, ''));

/** A list of role names on the body, if it names any. Ignores junk entries. */
const roleList = (value: unknown): string[] =>
    Array.isArray(value)
        ? value.map((r) => cleanString(r)).filter((r) => r.length > 0)
        : [];

/**
 * The human sentence inside a decoded error body, or null when it carries none.
 *
 * PURE on purpose — no `Response`, no fetch, no clock — so the choice between
 * "details", "error" and "nothing" is unit-testable without inventing a network.
 */
export const refusalSentence = (payload: unknown): string | null => {
    if (payload === null || typeof payload !== 'object') {return null;}
    const body = payload as Record<string, unknown>;

    // 1. `details` — written for a person, and the only field the refusals added
    //    by the permissions work put their real sentence in.
    const details = cleanString(body.details);
    if (details.length > 0 && !isGeneric(details)) {return details;}

    // 2. `error`, when it is saying something. Plenty of routes put the whole
    //    sentence here ("Your plan allows up to 3 outlet(s). Upgrade to add
    //    more.", "You cannot grant permissions you do not hold yourself.").
    const error = cleanString(body.error);
    if (error.length > 0 && !isGeneric(error)) {return error;}

    // 3. `message`, for anything that speaks the other common convention.
    const message = cleanString(body.message);
    if (message.length > 0 && !isGeneric(message)) {return message;}

    return null;
};

/**
 * The extra half-sentence a role-shaped refusal can add when it named no
 * details: "Forbidden" plus `requiredRoles: ["admin","manager"]` is still worth
 * turning into "ask an admin or a manager" rather than a dead end.
 */
const roleHint = (payload: unknown): string | null => {
    if (payload === null || typeof payload !== 'object') {return null;}
    const body = payload as Record<string, unknown>;
    const roles = roleList(body.requiredRoles).length > 0
        ? roleList(body.requiredRoles)
        : roleList(body.allowed_roles);
    if (roles.length === 0) {return null;}
    return roles.length === 1
        ? `This action is limited to the ${roles[0]} role.`
        : `This action is limited to these roles: ${roles.join(', ')}.`;
};

/** The wording a refusal falls back to when the server sent no sentence. */
export const FORBIDDEN_FALLBACK = 'Action forbidden';
/** Kept verbatim from the old helper — screenshot uploads are the only 413. */
export const TOO_LARGE_FALLBACK = 'Uploaded screenshot is too large. Please use a smaller image.';

const statusFallback = (status: number, fallback?: string): string => {
    if (status === 403) {return FORBIDDEN_FALLBACK;}
    if (status === 413) {return TOO_LARGE_FALLBACK;}
    if (fallback && fallback.trim().length > 0) {return fallback;}
    return `Request failed with status ${String(status)}`;
};

/**
 * The only two things this reader needs off a failed response. Structural
 * rather than `Response` itself so the rules above can be exercised against a
 * body that can be consumed exactly once, without standing up a fetch — a real
 * `Response` satisfies it unchanged.
 */
export interface ErrorResponseLike {
    status: number;
    text: () => Promise<string>;
}

/**
 * Turn a failed response into the sentence to put in front of a human.
 *
 * Reads the body exactly once. Never throws: a body that was already consumed
 * by the caller, an HTML error page from a proxy, or an empty 403 all land on
 * the status wording instead.
 *
 * @param fallback overrides the generic wording for statuses that have no
 *        special sentence of their own (403 and 413 keep theirs).
 */
export const readErrorMessage = async (response: ErrorResponseLike, fallback?: string): Promise<string> => {
    const generic = statusFallback(response.status, fallback);

    let text = '';
    try {
        text = await response.text();
    } catch {
        // Body already read by the caller, or the stream failed. Not an error
        // worth surfacing over the refusal itself.
        return generic;
    }

    const trimmed = text.trim();
    if (trimmed.length === 0) {return generic;}

    // An HTML error page (nginx, a tunnel, a 502 shell) is not a message; it is
    // a wall of markup, and printing it in a toast is worse than saying nothing.
    if (trimmed.startsWith('<')) {return generic;}

    let parsed: unknown = null;
    let isJson = false;
    try {
        parsed = JSON.parse(trimmed);
        isJson = true;
    } catch {
        // Not JSON — fall through to the plain-text branch below.
    }

    if (isJson) {
        const sentence = refusalSentence(parsed);
        if (sentence) {return sentence;}
        const hint = roleHint(parsed);
        if (hint) {return `${generic}. ${hint}`;}
        return generic;
    }

    // A plain-text body. Useful when it is short (many routes send one line);
    // a novel in a toast is not, so anything unreasonably long stays generic.
    return trimmed.length <= 400 ? trimmed : generic;
};

// --- Refusals that have to survive the Server-Action boundary ---------------
//
// `src/lib/db.ts` is a "use server" module, so Next REDACTS the message of any
// Error it throws once a production build is running — the exact fact that made
// `signInEmployee` return its failure rather than throw it. Reading the body is
// only half of getting a refusal in front of a person; the act that can be
// refused has to RETURN the sentence. This is the shape it returns, and it
// lives here (a plain module) rather than in db.ts because a "use server"
// module may only export async functions, and a type guard is not one.

export interface RefusedAction {
    /** Present and true only on a refusal. A transport failure still throws. */
    refused: true;
    /** The HTTP status behind it — 403 for a permission, 409 for a conflict. */
    status: number;
    /** The server's own sentence, already unwrapped from `details`. */
    error: string;
}

export const isRefusedAction = (value: unknown): value is RefusedAction =>
    typeof value === 'object'
    && value !== null
    && (value as { refused?: unknown }).refused === true
    && typeof (value as { error?: unknown }).error === 'string';
