// THE KITCHEN'S PREP TIMERS, AND THE FORMAT EVERY DURATION ON THIS APP SHARES.
//
// WHAT USED TO BE HERE, AND WHY IT IS NOT ANY MORE.
//
// This module also computed D1 ("how long since this ticket was placed") and D2
// ("order to bill settlement") as `Date.now() - created_at`, in the browser. The
// owner app computed its own version of the same subtraction. That is ONE RULE,
// IMPLEMENTED TWICE, and two implementations of one rule drift: the same table
// read forty minutes on the laptop and thirty on the phone in the same manager's
// hand, and nobody could say which was right.
//
// It was also wrong on its own terms, because A TILL'S WALL CLOCK IS NOT
// EVIDENCE. A Windows laptop ten minutes fast painted every ticket ten minutes
// late the instant it landed; one ten minutes slow hid the table that really was.
//
// So the backend now answers both — `service_clock.ts`, measured against the
// SERVER's clock and shipped on the order feed, the running table bill and a
// closed bill — and `src/lib/service-clock.ts` is the ONE place in this app
// allowed to read that answer. THE DERIVATIONS WERE DELETED RATHER THAN LEFT
// SITTING HERE UNUSED: a helper that still computes the client's own version of
// a question the server answers is an invitation to go back to it, and the whole
// point of the exercise is that there is nothing to go back to.
//
// WHAT REMAINS IS WHAT THE SERVER DOES NOT ANSWER:
//
//   * `timerElapsedMs` — the kitchen's per-item PREP timers, stored in
//     `Orders.timing` with their own pause bookkeeping. The backend does not
//     summarise these and the pass needs them to tick between polls.
//   * `formatDuration` — the kitchen board's own format, which is what D2's
//     "identical to the kitchen section display" means literally. `service-clock.ts`
//     re-exports it rather than growing a second copy, one layer down.
//   * `waitTone` — how urgent a wait is, for colouring.
//
// NO TIMEZONE ENTERS THIS FILE, deliberately. A DURATION is a difference between
// two instants and is the same number in every zone; only the WALL-CLOCK labels
// beside it ("Placed 19:42") need the restaurant's zone, and those are rendered
// by the existing `useTimezone` helpers at the call site. Mixing the two is how
// a laptop on the wrong zone starts showing negative prep times.
//
// PURE — no React, no fetch, no `window`. Same precedent as `mis-capture.ts` and
// `table-assignment.ts`: db.ts carries "use server" and may export ONLY async
// functions, so a plain `export const` there builds clean and 500s at runtime.

/** Per-item / per-order prep timer as stored in `Orders.timing`. */
export interface OrderTimer {
    started_at: string | null;
    ended_at: string | null;
    paused: boolean;
    pause_started_at: string | null;
    paused_ms: number;
}

/** The `Orders.timing` blob. */
export interface OrderTiming {
    /** When the ticket was taken, as the timing blob records it. */
    ordered_at?: string;
    order?: OrderTimer;
    items?: Record<string, OrderTimer>;
}

/**
 * Parse a server timestamp to epoch ms, or null.
 *
 * Returns null for anything unparseable rather than NaN. NaN propagates through
 * every subtraction and comparison silently — `NaN > 0` is false, so a NaN clock
 * renders as "0s" and looks like a brand-new order — and that is exactly the
 * class of bug that made a simulation screen quietly show zeros.
 */
export const parseInstant = (value: unknown): number | null => {
    if (typeof value !== 'string' || value.trim().length === 0) { return null; }
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
};

/**
 * Live elapsed (ms) for a prep timer, mirroring the backend's own computation.
 *
 * Moved here from the kitchen display so the tables grid and the orders list
 * read the identical number the pass reads — which is literally what D2 asks
 * for. Paused time is subtracted, including the currently-running pause.
 */
export const timerElapsedMs = (timer?: OrderTimer | null, nowMs?: number): number => {
    const start = parseInstant(timer?.started_at);
    if (start === null) { return 0; }
    const now = nowMs ?? Date.now();
    const end = parseInstant(timer?.ended_at) ?? now;
    let paused = typeof timer?.paused_ms === 'number' && Number.isFinite(timer.paused_ms) ? timer.paused_ms : 0;
    const pauseStart = timer?.paused ? parseInstant(timer.pause_started_at) : null;
    if (pauseStart !== null) { paused += now - pauseStart; }
    return Math.max(0, end - start - paused);
};

/**
 * "45s" / "12m 04s" / "2h 18m" — the kitchen board's format, unchanged below an
 * hour so the two surfaces read identically, and extended above it because a
 * table open since lunch reading "163m 12s" is a number nobody parses at a
 * glance.
 */
export const formatDuration = (ms: number): string => {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    if (totalMinutes < 60) {
        return totalMinutes > 0
            ? `${String(totalMinutes)}m ${String(seconds).padStart(2, '0')}s`
            : `${String(totalSeconds)}s`;
    }
    const hours = Math.floor(totalMinutes / 60);
    return `${String(hours)}h ${String(totalMinutes % 60).padStart(2, '0')}m`;
};

/**
 * How urgent a wait is, for colouring. Thresholds in MINUTES so they read as the
 * floor reads them, and deliberately generous: a badge that turns red at five
 * minutes is a badge that is always red, which is a badge nobody looks at.
 */
export type WaitTone = 'calm' | 'watch' | 'late';

export const waitTone = (ms: number | null | undefined): WaitTone => {
    const minutes = typeof ms === 'number' && Number.isFinite(ms) ? ms / 60000 : 0;
    if (minutes >= 45) { return 'late'; }
    if (minutes >= 20) { return 'watch'; }
    return 'calm';
};
