// THE SERVICE CLOCK, AS THE SERVER ANSWERED IT — D1 AND D2 STOP BEING A
// BROWSER SUBTRACTION.
//
// WHAT THIS REPLACES, AND WHY IT HAD TO BE REPLACED.
//
// `src/lib/order-clock.ts` computed both figures here, in the browser, as
// `Date.now() - created_at`. The owner app computed its own. Neither was wrong
// in isolation and that is exactly the problem: they are two implementations of
// one rule, and two implementations of one rule drift. The backend added
// `service_clock.ts` and wired it into three reads — the order feed, the running
// table bill and a closed bill — specifically so the two screens could not
// disagree about the same table in front of the same manager. A field nobody
// reads is not a feature; it is a claim. This module is how this app reads it.
//
// THE OTHER HALF, AND IT IS THE HALF THAT ACTUALLY BITES ON A FLOOR. A TILL'S
// WALL CLOCK IS NOT EVIDENCE. A Windows till or an Android tablet that is ten
// minutes fast turns `Date.now() - created_at` into "this table has been waiting
// ten minutes" the instant the order lands, and turns a table that really has
// been waiting ten minutes into twenty. The server therefore ships a NUMBER OF
// MILLISECONDS measured against its own clock, together with `as_of`, the server
// instant it was measured at.
//
// SO NOTHING BELOW EVER COMPARES A SERVER INSTANT TO `Date.now()`. Every figure
// is built out of one of exactly two things:
//
//   * a DIFFERENCE BETWEEN TWO SERVER INSTANTS (`as_of - started_at`,
//     `ended_at - started_at`), which carries no device clock at all; or
//   * a DELTA ON THIS DEVICE SINCE THE RESPONSE ARRIVED (`tickedMs`), which is
//     a difference between two readings of the same local timer and is therefore
//     unaffected by that timer being wrong.
//
// A browser an hour out of true renders the same duration as one that is right.
// That property is what the tests in `__tests__/service-clock.test.ts` pin, and
// it is the property that fails the moment somebody goes back to subtracting
// timestamps against the local clock.
//
// ABSENT IS NOT ZERO — the server's own rule, kept here. An order with no placed
// instant (a row written before the timestamp columns existed) arrives as a
// clock with `started_at: null`, and `readServiceClock` answers NULL for it, not
// a zero. Every caller then draws NOTHING. "0m" on a table that has been open
// two hours is worse than no clock at all, and it is the failure mode a NaN
// clock produces silently.
//
// PURE — no React, no fetch, no `window`, so the tests can pin it without
// driving a browser. Same precedent as `session-scope.ts`, `mis-capture.ts` and
// `table-assignment.ts`: `db.ts` carries "use server" and may export ONLY async
// functions, so a plain `export const` there is a build error that tsc and jest
// both wave through while every page 500s at runtime.

// The kitchen board's formatter, which is what D2's "identical to the kitchen
// section display" means literally. IMPORTED, NOT COPIED: a second `formatDuration`
// is the same drift this file exists to end, one layer down.
export { formatDuration, waitTone, type WaitTone } from './order-clock';

/**
 * The block the backend's `service_clock.ts` puts on an order, on the running
 * table bill and on a closed bill. Field for field the server's `ServiceClock`.
 */
export interface ServiceClock {
    /** ISO instant the service began, or null when the row carries no placed-at. */
    started_at: string | null;
    /** ISO instant the bill settled, or null while the table is still in service. */
    ended_at: string | null;
    /** SERVER-computed duration, measured at `as_of`. Frozen once `running` is false. */
    elapsed_ms: number;
    /** True while the clock is still moving — the only reason to tick locally. */
    running: boolean;
    /** The SERVER instant `elapsed_ms` was measured at. */
    as_of: string;
}

/** Anything that might carry one. Every payload field is optional; see `readServiceClock`. */
export interface ServiceClockCarrier {
    service?: unknown;
}

/** Parse a server timestamp to epoch ms, or null — never NaN. */
const instantMs = (value: unknown): number | null => {
    if (typeof value !== 'string' || value.trim().length === 0) { return null; }
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
};

const isoOf = (ms: number): string => new Date(ms).toISOString();

/**
 * A LOCAL MONOTONIC READING, in milliseconds, used ONLY to measure the time
 * since a response arrived.
 *
 * `performance.now()` where it exists — it counts from page load and is immune
 * to the user (or NTP, or a dual-boot) moving the wall clock mid-service, which
 * on a till left running all night is not hypothetical. `Date.now()` is the
 * fallback, and even that is safe here because only the DIFFERENCE between two
 * readings is ever used.
 *
 * Never call this to ask what time it is. It is not a time; on most browsers it
 * is a few seconds past zero.
 */
export const monotonicNow = (): number =>
    (typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now()
        : Date.now();

/**
 * READ THE SERVER'S CLOCK OFF A PAYLOAD, or answer NULL for "there is no clock".
 *
 * NULL, specifically, for all of:
 *   * a backend that has never heard of `service` (the field is absent);
 *   * a row the server could not date (`started_at: null` — "absent is not zero");
 *   * anything whose shape is not the contract.
 *
 * A caller that gets null draws nothing. That is the whole point: a clock is a
 * claim about how long a named waiter's table has been waiting, and a fabricated
 * one is worse than a missing one.
 *
 * `as_of` is repaired rather than rejected when it is missing or unparseable:
 * `started_at + elapsed_ms` is what the server measured, so the D1 figure stays
 * exactly right and only the (unused) absolute instant is synthesised. A server
 * that sends a clock without an `as_of` is still telling the truth about the
 * duration.
 */
export const readServiceClock = (carrier: ServiceClockCarrier | null | undefined): ServiceClock | null => {
    const raw: unknown = carrier?.service;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) { return null; }
    const obj = raw as Record<string, unknown>;

    const started = instantMs(obj.started_at);
    // ABSENT IS NOT ZERO. The server sends `{ started_at: null, elapsed_ms: 0,
    // running: false }` for a row it cannot date, and rendering that as "0s" is
    // the exact lie this rule exists to prevent.
    if (started === null) { return null; }

    const elapsedRaw = obj.elapsed_ms;
    const elapsed = typeof elapsedRaw === 'number' && Number.isFinite(elapsedRaw) ? Math.max(0, elapsedRaw) : 0;
    const running = obj.running === true;
    const ended = running ? null : instantMs(obj.ended_at);
    const asOf = instantMs(obj.as_of) ?? started + elapsed;

    return {
        started_at: isoOf(started),
        ended_at: ended === null ? null : isoOf(ended),
        elapsed_ms: elapsed,
        running,
        as_of: isoOf(asOf),
    };
};

/**
 * D1 — TIME SINCE THE ORDER WAS PLACED. What a waiter reads to answer "is this
 * table waiting too long".
 *
 * Keeps counting past settlement on purpose: "how long ago was this ordered"
 * does not stop being a fact when the bill is paid. The figure that FREEZES is
 * D2; see `elapsedToSettlement`.
 *
 * `as_of - started_at` is a difference between two SERVER instants, so the
 * device's clock never enters it. `tickedMs` is how long this device has been
 * holding the response — a delta on one local timer, immune to that timer being
 * wrong. Pass 0 for the figure exactly as the server measured it.
 */
export const elapsedSincePlaced = (clock: ServiceClock, tickedMs = 0): number => {
    const started = instantMs(clock.started_at);
    const asOf = instantMs(clock.as_of);
    if (started === null || asOf === null) { return 0; }
    return Math.max(0, asOf - started) + Math.max(0, tickedMs);
};

/** The answer `elapsedToSettlement` gives, so a caller can label it honestly. */
export interface SettlementSpan {
    /** Order → settlement, in ms. */
    ms: number;
    /** True once the bill has closed: the figure is final and no longer counting. */
    settled: boolean;
}

/**
 * D2 — THE SPAN FROM THE ORDER BEING PLACED TO THE BILL BEING SETTLED.
 *
 * THE CLOCK STOPS AND STAYS STOPPED. Once the server says `running: false` the
 * duration is a FACT about a completed service, not a counter, and `tickedMs` is
 * ignored entirely. A client that keeps ticking a stopped clock is reporting a
 * table that is not there.
 */
export const elapsedToSettlement = (clock: ServiceClock, tickedMs = 0): SettlementSpan =>
    clock.running
        ? { ms: Math.max(0, clock.elapsed_ms) + Math.max(0, tickedMs), settled: false }
        : { ms: Math.max(0, clock.elapsed_ms), settled: true };

/**
 * A TABLE'S CLOCK FROM ITS ORDERS' CLOCKS.
 *
 * WHY THIS IS HERE AT ALL, given the server already answers it. The running
 * table bill (GET /bill-for-table) carries its own `service` built by the
 * backend's `tableServiceClock`, and a screen that reads ONE table reads that.
 * The tables grid reads THIRTY tables from one polled order feed, and asking the
 * backend for thirty bills a poll to get a badge is not a trade a floor laptop
 * can make. So the reduction happens here — but over clocks the SERVER computed,
 * by the SERVER's rule, restated below so it is checkable rather than guessed:
 *
 *   THE START IS THE EARLIEST ORDER. The question the floor asks is "how long
 *   have these guests been sitting here", not "how long since the most recent
 *   round". Taking the latest order as the origin resets a table's clock every
 *   time a guest orders another drink, which is precisely the display D2 is
 *   replacing.
 *
 *   STILL RUNNING IF ANY ORDER IS UNSETTLED. A table with four settled orders
 *   and one open one is a table that has not paid. Reporting it as finished
 *   because most of it is finished is the same class of error as the merge-bill
 *   phantom revenue.
 *
 *   AND IT STOPS AT THE LAST SETTLEMENT, not the first.
 *
 * The arithmetic is again only server-instant differences, so the merged clock
 * carries the same guarantee every input does.
 *
 * Answers NULL for an empty list, so a table with no datable order draws no
 * badge rather than a zero.
 */
export const mergeServiceClocks = (clocks: readonly ServiceClock[]): ServiceClock | null => {
    let earliestStart: number | null = null;
    let latestEnd: number | null = null;
    let latestAsOf: number | null = null;
    let anyRunning = false;

    for (const clock of clocks) {
        const started = instantMs(clock.started_at);
        if (started === null) { continue; }
        if (earliestStart === null || started < earliestStart) { earliestStart = started; }
        const asOf = instantMs(clock.as_of);
        if (asOf !== null && (latestAsOf === null || asOf > latestAsOf)) { latestAsOf = asOf; }
        if (clock.running) { anyRunning = true; continue; }
        const ended = instantMs(clock.ended_at);
        // A stopped clock with no readable `ended_at` cannot contribute an end,
        // and must not be allowed to make the table look finished either.
        if (ended === null) { anyRunning = true; continue; }
        if (latestEnd === null || ended > latestEnd) { latestEnd = ended; }
    }

    if (earliestStart === null) { return null; }
    const asOf = latestAsOf ?? earliestStart;
    // `latestEnd === null` folded into `running` above AND re-tested here, so the
    // two branches below cannot disagree about whether there is an end — tsc
    // narrows on the local, not on the flag.
    const end = anyRunning ? null : latestEnd;
    const elapsed = Math.max(0, (end ?? asOf) - earliestStart);

    return {
        started_at: isoOf(earliestStart),
        ended_at: end === null ? null : isoOf(end),
        elapsed_ms: elapsed,
        running: end === null,
        as_of: isoOf(asOf),
    };
};

/**
 * THE NEWEST SERVER MEASUREMENT IN A PAYLOAD, in epoch ms, or 0 for none.
 *
 * WHAT IT IS FOR, and it is the one piece of bookkeeping a ticking screen needs.
 * A live figure is `elapsed_ms` (the server's) plus the time THIS DEVICE has
 * held the response. The second half has to be reset whenever the first half
 * advances, or the two are added twice.
 *
 * "Advances" means the SERVER re-measured, which is exactly `as_of` moving —
 * NOT the local state object changing identity. A screen that resets its local
 * delta every time its own optimistic edit replaces the array would make the
 * displayed duration jump BACKWARDS by however long it had been ticking, on a
 * row the user had just touched. Comparing `as_of` is a comparison of two SERVER
 * instants and so, like everything else here, carries no device clock.
 */
export const latestAsOfMs = (carriers: readonly ServiceClockCarrier[]): number => {
    let latest = 0;
    for (const carrier of carriers) {
        const clock = readServiceClock(carrier);
        if (clock === null) { continue; }
        const asOf = instantMs(clock.as_of);
        if (asOf !== null && asOf > latest) { latest = asOf; }
    }
    return latest;
};

/**
 * Read a clock off each carrier and merge them — the whole tables-grid path in
 * one call, so a caller never holds a half-reduced list.
 */
export const tableServiceClockOf = (carriers: readonly ServiceClockCarrier[]): ServiceClock | null => {
    const clocks: ServiceClock[] = [];
    for (const carrier of carriers) {
        const clock = readServiceClock(carrier);
        if (clock !== null) { clocks.push(clock); }
    }
    return mergeServiceClocks(clocks);
};
