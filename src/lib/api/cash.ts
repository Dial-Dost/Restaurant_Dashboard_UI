// THE CASH MODULE'S OWN DATA LAYER — Flutter parity (docs/parity/cash.md).
//
// WHY THIS FILE EXISTS. db.ts's `backendJson` readers swallow failures into
// null payloads, which is exactly what cash.md finding 18 names: a failed
// load rendered as "no register open". This fetcher THROWS instead — status 0
// (never reached the server) throws a TypeError so `isUnreachableError` reads
// it as an outage, anything else throws the server's own sentence — the
// contract `useCachedFetch` + `LoadErrorState` are built on.
//
// The composition mirrors Flutter `_CashViewState._fetch` (modules.dart
// ~26268): the OPEN drawer is "right now" and must succeed; the history call
// carries the report window and a failure there is deliberately swallowed
// into an empty list (`.catchError((_) => {})`) so the drawer card is never
// held hostage by the Z-report window.

import { requestBackend } from '@/lib/db';
import type { CashSession, CurrentCashSession } from '@/lib/db';
import { refusalSentence } from '@/lib/error-message';

/** What one full load of the cash screen paints. */
export interface CashBoard {
    current: CurrentCashSession | null;
    history: CashSession[];
}

/** The throw `useCachedFetch` expects: outage as TypeError, refusal verbatim. */
const throwBackendError = (status: number, text: string, fallback: string): never => {
    if (status === 0) {
        throw new TypeError('Failed to fetch');
    }
    let message = '';
    try {
        message = refusalSentence(JSON.parse(text)) ?? '';
    } catch {
        /* not JSON — the raw body is the best we have */
    }
    if (!message) {
        message = text.trim() || fallback;
    }
    throw Object.assign(new Error(message), { status });
};

/**
 * GET /cash/current + GET /cash/sessions?from&to — one replayable read, the
 * shape the persisted cache stores. Throws only when the CURRENT read fails.
 */
export const fetchCashBoard = async (
    restaurantId: string,
    from: string,
    to: string,
): Promise<CashBoard> => {
    const cur = await requestBackend<{ session?: CurrentCashSession | null }>({
        restaurantId,
        path: '/cash/current',
        method: 'GET',
    });
    if (!cur.ok) {
        throwBackendError(cur.status, cur.text, 'Could not load cash sessions');
    }

    // Flutter swallows a history failure into an empty list (modules.dart
    // `_fetch`): the range-scoped list degrades, the live drawer does not.
    let history: CashSession[] = [];
    try {
        const qs = new URLSearchParams();
        if (from) { qs.set('from', from); }
        if (to) { qs.set('to', to); }
        const hist = await requestBackend<{ sessions?: CashSession[] }>({
            restaurantId,
            path: `/cash/sessions?${qs.toString()}`,
            method: 'GET',
        });
        if (hist.ok && Array.isArray(hist.data?.sessions)) {
            history = hist.data.sessions;
        }
    } catch {
        /* keep [] — same degradation as the app */
    }

    const session = cur.data?.session;
    return { current: session ?? null, history };
};
