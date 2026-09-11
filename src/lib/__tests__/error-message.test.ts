// What these tests are actually protecting.
//
// A REFUSAL HAS TO REACH A HUMAN. The permission work put real sentences in the
// 403 bodies — the rupee value a table release would write off, who is allowed
// to reprint a bill, the name of the permission a settle needs — and the web
// client discarded every one of them: `readErrorMessage` answered the literal
// string "Action forbidden" for ANY 403 *before* the body was read. A waiter was
// told nothing and fetched a manager to guess. `authService.ts` carried a second
// copy of the same shortcut, so a login refused because the subscription had
// expired said "Action forbidden" too.
//
// So these tests pin four properties:
//
//   1. THE SERVER'S SENTENCE WINS. `details` is the field written for a person
//      and it is surfaced verbatim, including the digits in it.
//   2. THE OLD WORDING SURVIVES WHERE IT WAS RIGHT. A 403 with no body, an empty
//      body, an HTML error page from a proxy, or a body whose only message is
//      the word "Forbidden" still reads "Action forbidden". The fix must not
//      trade a useless-but-calm message for a frightening one.
//   3. THE BODY IS READ EXACTLY ONCE. The old helper called `.json()` and then
//      `.text()` in the catch — the second call throws "body stream already
//      read", so a plain-text error body was lost as well. A response body may
//      only be consumed once, and the test below fails if anything reads twice.
//   4. NOTHING THROWS OUT OF THE READER. A body the caller already consumed, or
//      a stream that errors, must degrade to the status wording: an exception
//      raised while explaining a refusal replaces the explanation with a crash.

import {
    FORBIDDEN_FALLBACK,
    TOO_LARGE_FALLBACK,
    isRefusedAction,
    readErrorMessage,
    refusalSentence,
    type ErrorResponseLike,
} from '../error-message';

interface FakeResponse extends ErrorResponseLike {
    /** How many times the body has been consumed. Must never exceed one. */
    reads: number;
}

/**
 * A response stand-in whose body can be consumed exactly once, like the real
 * thing. `reads` counts consumption, so a helper that tried to read twice fails
 * loudly instead of silently losing the message. A `body` of null stands for a
 * stream the caller already drained.
 */
const fakeResponse = (status: number, body: string | null): FakeResponse => {
    const state: FakeResponse = {
        reads: 0,
        status,
        text: (): Promise<string> => {
            state.reads += 1;
            if (state.reads > 1 || body === null) {
                return Promise.reject(new TypeError('body stream already read'));
            }
            return Promise.resolve(body);
        },
    };
    return state;
};

const json = (status: number, payload: unknown): FakeResponse =>
    fakeResponse(status, JSON.stringify(payload));

describe('the sentence inside a refusal', () => {
    it('prefers `details`, which is the field written for a person', () => {
        expect(refusalSentence({
            error: 'Forbidden',
            details: 'Releasing this table would write off ₹1,240.00 of unpaid orders.',
            requiredPermission: '0b3c…',
        })).toBe('Releasing this table would write off ₹1,240.00 of unpaid orders.');
    });

    it('falls back to `error` when it is saying something', () => {
        expect(refusalSentence({ error: 'You cannot grant permissions you do not hold yourself.' }))
            .toBe('You cannot grant permissions you do not hold yourself.');
    });

    it('treats the bare labels as no message at all', () => {
        // "Forbidden" is not an explanation. Surfacing it would replace a
        // familiar phrase with an unfamiliar one and tell the reader no more.
        expect(refusalSentence({ error: 'Forbidden' })).toBeNull();
        expect(refusalSentence({ error: 'Action not permitted' })).toBeNull();
        expect(refusalSentence({ error: '   ' })).toBeNull();
        expect(refusalSentence({})).toBeNull();
        expect(refusalSentence(null)).toBeNull();
        expect(refusalSentence('Forbidden')).toBeNull();
    });

    it('reads `details` past a generic `error`, which is the shape every gate sends', () => {
        expect(refusalSentence({
            error: 'Forbidden',
            details: "Settling a bill requires the 'Close Bill' permission. Ask an admin to grant it to your role.",
        })).toBe("Settling a bill requires the 'Close Bill' permission. Ask an admin to grant it to your role.");
    });
});

describe('a 403 in front of a person', () => {
    it('surfaces the write-off value the release gate refused over', async () => {
        const res = json(403, {
            error: 'Forbidden',
            details: 'Releasing Table 7 would write off ₹1,240.00 of unpaid orders. Settle or void them first.',
            requiredPermission: 'ff4d7b1e',
            write_off_value: 1240,
        });
        await expect(readErrorMessage(res)).resolves.toContain('₹1,240.00');
        expect(res.reads).toBe(1);
    });

    it('surfaces who may reprint instead of a blank refusal', async () => {
        const res = json(403, {
            error: 'Forbidden',
            details: "This table's bill has already been printed. A reprint has to be made by a manager, admin — ask one of them.",
            reprint_needs_senior: true,
            allowed_roles: ['manager', 'admin'],
        });
        await expect(readErrorMessage(res)).resolves.toBe(
            "This table's bill has already been printed. A reprint has to be made by a manager, admin — ask one of them.",
        );
    });

    it('names the permission when the server names it', async () => {
        await expect(readErrorMessage(json(403, {
            error: 'Forbidden',
            details: "Settling a bill requires the 'Close Bill' permission. Ask an admin to grant it to your role.",
        }))).resolves.toContain('Close Bill');
    });

    it('keeps the old wording for a 403 that carries no body', async () => {
        await expect(readErrorMessage(fakeResponse(403, ''))).resolves.toBe(FORBIDDEN_FALLBACK);
        await expect(readErrorMessage(fakeResponse(403, '   \n '))).resolves.toBe(FORBIDDEN_FALLBACK);
        await expect(readErrorMessage(json(403, { error: 'Forbidden' }))).resolves.toBe(FORBIDDEN_FALLBACK);
    });

    it('adds the roles when that is all the server said', async () => {
        // Better than a dead end: the reader learns who to ask even though the
        // route sent no sentence of its own.
        await expect(readErrorMessage(json(403, { error: 'Forbidden', requiredRoles: ['admin', 'manager'] })))
            .resolves.toBe('Action forbidden. This action is limited to these roles: admin, manager.');
        await expect(readErrorMessage(json(403, { error: 'Forbidden', requiredRoles: ['admin'] })))
            .resolves.toBe('Action forbidden. This action is limited to the admin role.');
    });

    it('never prints an HTML error page into a toast', async () => {
        const res = fakeResponse(403, '<!doctype html><html><body><h1>403 Forbidden</h1></body></html>');
        await expect(readErrorMessage(res)).resolves.toBe(FORBIDDEN_FALLBACK);
    });
});

describe('the other status branches', () => {
    it('keeps the screenshot wording for a 413', async () => {
        await expect(readErrorMessage(fakeResponse(413, ''))).resolves.toBe(TOO_LARGE_FALLBACK);
    });

    it('lets a 413 that explains itself explain itself', async () => {
        await expect(readErrorMessage(json(413, { error: 'That image is 14 MB; the limit is 5 MB.' })))
            .resolves.toBe('That image is 14 MB; the limit is 5 MB.');
    });

    it('surfaces a plain JSON error for any other status', async () => {
        await expect(readErrorMessage(json(400, { error: 'Missing restaurantId' })))
            .resolves.toBe('Missing restaurantId');
        await expect(readErrorMessage(json(409, { error: 'Conflict', details: 'This bill was already settled.' })))
            .resolves.toBe('This bill was already settled.');
    });

    it('reads a PLAIN TEXT body — the case the double-read bug swallowed', async () => {
        // The old helper called .json() first; that consumed the body, so the
        // .text() fallback threw and the message was lost. One read, so it works.
        const res = fakeResponse(500, 'upstream timed out');
        await expect(readErrorMessage(res)).resolves.toBe('upstream timed out');
        expect(res.reads).toBe(1);
    });

    it('falls back to the status when there is nothing to say', async () => {
        await expect(readErrorMessage(fakeResponse(500, ''))).resolves.toBe('Request failed with status 500');
        await expect(readErrorMessage(json(500, { ok: false }))).resolves.toBe('Request failed with status 500');
    });

    it('honours a caller-supplied fallback, but never over 403/413', async () => {
        await expect(readErrorMessage(fakeResponse(401, ''), 'Unable to sign in.')).resolves.toBe('Unable to sign in.');
        await expect(readErrorMessage(fakeResponse(403, ''), 'Unable to sign in.')).resolves.toBe(FORBIDDEN_FALLBACK);
    });

    it('does not throw when the body was already consumed by the caller', async () => {
        const res = fakeResponse(403, null);
        await expect(readErrorMessage(res)).resolves.toBe(FORBIDDEN_FALLBACK);
    });

    it('does not dump a novel into a toast', async () => {
        await expect(readErrorMessage(fakeResponse(500, 'x'.repeat(5000))))
            .resolves.toBe('Request failed with status 500');
    });
});

describe('a refusal that has to survive the Server-Action boundary', () => {
    // db.ts is "use server", and Next redacts a thrown Error's message in
    // production — so the two acts that can be refused RETURN this shape
    // instead. The guard is what the screens branch on; if it stopped
    // recognising the shape, the toast would silently go back to "Failed".
    it('recognises a returned refusal', () => {
        expect(isRefusedAction({ refused: true, status: 403, error: 'Nope.' })).toBe(true);
    });

    it('does not mistake an ordinary result for one', () => {
        expect(isRefusedAction({ acknowledged: true })).toBe(false);
        expect(isRefusedAction({ applied: true, discount_value: 10 })).toBe(false);
        expect(isRefusedAction({ refused: true })).toBe(false); // no sentence — not this shape
        expect(isRefusedAction(null)).toBe(false);
        expect(isRefusedAction(undefined)).toBe(false);
        expect(isRefusedAction('refused')).toBe(false);
    });
});
