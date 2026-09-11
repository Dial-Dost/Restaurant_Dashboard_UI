// WHAT THESE TESTS ARE ACTUALLY PROTECTING.
//
// The backend built `service_clock.ts` — one duration, wired into the order
// feed, the running table bill and a closed bill — precisely so the dashboard
// and the owner app could not report two different numbers for one table. Both
// clients then carried on subtracting timestamps in-process, which is the same
// "one rule, two implementations" defect that un-scoped a waiter in production
// wearing a different hat.
//
// So the properties pinned below are the ones that FAIL THE MOMENT SOMEBODY GOES
// BACK TO DERIVING THE ANSWER LOCALLY:
//
//   1. THE DEVICE'S CLOCK IS NOT AN INPUT. `withSkewedWallClock` below runs the
//      assertions with `Date.now()` ten minutes fast — the state of a real till
//      on a real floor. Every figure must come out identical to the one a correct
//      clock produces. An implementation that computes `Date.now() - created_at`
//      passes on a correct clock and fails here, by exactly ten minutes.
//   2. THE CLOCK STOPS AND STAYS STOPPED. A settled bill's duration is a fact
//      about a finished service, not a counter.
//   3. ABSENT IS NOT ZERO. A row the server could not date draws NOTHING. "0m"
//      on a table open two hours is worse than no badge.
//   4. THE TABLE REDUCTION IS THE SERVER'S RULE, RESTATED: earliest order,
//      still running if ANY order is unsettled, stopping at the LAST settlement.
//      The fixtures are the backend's own `tableServiceClock` semantics.

import {
    elapsedSincePlaced,
    elapsedToSettlement,
    formatDuration,
    mergeServiceClocks,
    monotonicNow,
    readServiceClock,
    tableServiceClockOf,
    type ServiceClock,
} from '../service-clock';

const PLACED = '2026-09-11T12:00:00.000Z';
const AS_OF = '2026-09-11T12:12:00.000Z';   // 12 minutes after PLACED
const SETTLED = '2026-09-11T12:40:00.000Z'; // 40 minutes after PLACED

/** A live clock exactly as GET /orders ships one. */
const running = (): { service: unknown } => ({
    service: { started_at: PLACED, ended_at: null, elapsed_ms: 12 * 60_000, running: true, as_of: AS_OF },
});

/** A settled clock: frozen at the real span, measured long after the fact. */
const settled = (): { service: unknown } => ({
    service: {
        started_at: PLACED,
        ended_at: SETTLED,
        elapsed_ms: 40 * 60_000,
        running: false,
        as_of: '2026-09-11T18:00:00.000Z',
    },
});

/**
 * The fixture's clock, or a loud failure.
 *
 * Not `as ServiceClock` and not `!`: a fixture that stopped producing a clock
 * would then silently become a test of `undefined`, and this file exists to
 * catch exactly that class of quiet degradation.
 */
const clockOf = (carrier: { service: unknown }): ServiceClock => {
    const clock = readServiceClock(carrier);
    if (clock === null) { throw new Error('fixture produced no service clock'); }
    return clock;
};

/** Run `body` with the process wall clock shifted by `offsetMs`. */
const withSkewedWallClock = (offsetMs: number, body: () => void): void => {
    const realNow = Date.now;
    Date.now = () => realNow() + offsetMs;
    try { body(); } finally { Date.now = realNow; }
};

describe('readServiceClock — the server answered, or there is no clock', () => {
    it('reads the contract verbatim', () => {
        const clock = readServiceClock(running());
        expect(clock).toEqual({
            started_at: PLACED,
            ended_at: null,
            elapsed_ms: 12 * 60_000,
            running: true,
            as_of: AS_OF,
        });
    });

    it('answers null when the backend has never heard of `service`', () => {
        // A shipped server that predates service_clock.ts. The caller draws
        // nothing, which is what every screen did before the field existed.
        expect(readServiceClock({})).toBeNull();
        expect(readServiceClock({ service: null })).toBeNull();
        expect(readServiceClock(null)).toBeNull();
        expect(readServiceClock(undefined)).toBeNull();
    });

    it('answers null for a row the server could not date — ABSENT IS NOT ZERO', () => {
        // This is the shape service_clock.ts documents for an order written
        // before the timestamp columns existed. Rendering it as "0s" on a table
        // that has been open two hours is the lie the rule exists to prevent.
        expect(readServiceClock({
            service: { started_at: null, ended_at: null, elapsed_ms: 0, running: false, as_of: AS_OF },
        })).toBeNull();
    });

    it('refuses a shape that is not the contract rather than guessing at it', () => {
        expect(readServiceClock({ service: 'a while' })).toBeNull();
        expect(readServiceClock({ service: [] })).toBeNull();
        expect(readServiceClock({ service: { started_at: 'not a date' } })).toBeNull();
    });

    it('repairs a missing as_of from started_at + elapsed_ms rather than dropping the clock', () => {
        // The duration is still the truth the server told; only the absolute
        // instant is synthesised, and nothing reads that.
        const clock = readServiceClock({
            service: { started_at: PLACED, ended_at: null, elapsed_ms: 12 * 60_000, running: true },
        });
        expect(clock).not.toBeNull();
        expect(clock === null ? -1 : elapsedSincePlaced(clock)).toBe(12 * 60_000);
    });

    it('never lets a stopped clock keep an end it did not report, or a running one carry an end', () => {
        const stillRunning = readServiceClock({
            service: { started_at: PLACED, ended_at: SETTLED, elapsed_ms: 12 * 60_000, running: true, as_of: AS_OF },
        });
        expect(stillRunning?.ended_at).toBeNull();
    });

    it('clamps a negative or non-numeric elapsed rather than propagating NaN', () => {
        const negative = readServiceClock({
            service: { started_at: PLACED, ended_at: null, elapsed_ms: -5, running: true, as_of: AS_OF },
        });
        expect(negative?.elapsed_ms).toBe(0);
        const nonsense = readServiceClock({
            service: { started_at: PLACED, ended_at: null, elapsed_ms: 'twelve', running: true, as_of: AS_OF },
        });
        expect(nonsense?.elapsed_ms).toBe(0);
    });
});

describe('THE DEVICE CLOCK IS NOT AN INPUT — a till ten minutes fast reads the same', () => {
    /*
      The one property that catches a regression to `Date.now() - created_at`.
      Ten minutes of skew is not a hypothetical: it is what an unattended Windows
      till or an Android tablet drifts to, and the old arithmetic turned it into
      "this table has been waiting ten minutes" the instant the order landed.
    */
    const TEN_MINUTES = 10 * 60_000;

    it('reports D1 as the server measured it, however wrong the browser is', () => {
        const clock = clockOf(running());
        const correct = elapsedSincePlaced(clock, 0);
        withSkewedWallClock(TEN_MINUTES, () => {
            expect(elapsedSincePlaced(clock, 0)).toBe(correct);
        });
        withSkewedWallClock(-3 * 60 * 60_000, () => {
            expect(elapsedSincePlaced(clock, 0)).toBe(correct);
        });
        expect(correct).toBe(12 * 60_000);
    });

    it('reports D2 as the server measured it, however wrong the browser is', () => {
        const clock = clockOf(running());
        withSkewedWallClock(TEN_MINUTES, () => {
            expect(elapsedToSettlement(clock, 0)).toEqual({ ms: 12 * 60_000, settled: false });
        });
    });

    it('ticks on a LOCAL DELTA, which is a difference and therefore skew-proof', () => {
        // `tickedMs` is "how long this device has held the response" — two
        // readings of one local timer. A timer that is wrong by an hour still
        // measures 5 seconds of elapsed holding as 5 seconds.
        const clock = clockOf(running());
        expect(elapsedSincePlaced(clock, 5_000)).toBe(12 * 60_000 + 5_000);
        expect(elapsedToSettlement(clock, 5_000).ms).toBe(12 * 60_000 + 5_000);
    });

    it('never runs backwards on a negative local delta', () => {
        // A wall-clock fallback can hand back a negative delta if the machine's
        // time is corrected mid-service. "-3m since order" teaches staff to
        // ignore the clock.
        const clock = clockOf(running());
        expect(elapsedSincePlaced(clock, -60_000)).toBe(12 * 60_000);
        expect(elapsedToSettlement(clock, -60_000).ms).toBe(12 * 60_000);
    });
});

describe('a settled clock is a fact, not a counter', () => {
    it('freezes D2 at the real span and ignores the tick entirely', () => {
        const clock = clockOf(settled());
        expect(elapsedToSettlement(clock, 0)).toEqual({ ms: 40 * 60_000, settled: true });
        expect(elapsedToSettlement(clock, 6 * 60 * 60_000)).toEqual({ ms: 40 * 60_000, settled: true });
    });

    it('still reports D1 as "time since placed", which does keep running', () => {
        // D1 is "how long ago was this ordered", and that does not stop being a
        // fact when the bill is paid. The server's `as_of` is six hours after
        // PLACED on this fixture, so that is what D1 reads — again with no
        // reference to the device's clock.
        const clock = clockOf(settled());
        expect(elapsedSincePlaced(clock, 0)).toBe(6 * 60 * 60_000);
    });
});

describe('mergeServiceClocks — the table, by the server\'s own rule', () => {
    const atMinutes = (startMin: number, endMin: number | null, asOfMin: number): ServiceClock => {
        const base = Date.parse(PLACED);
        const start = base + startMin * 60_000;
        const asOf = base + asOfMin * 60_000;
        const end = endMin === null ? null : base + endMin * 60_000;
        return {
            started_at: new Date(start).toISOString(),
            ended_at: end === null ? null : new Date(end).toISOString(),
            elapsed_ms: Math.max(0, (end ?? asOf) - start),
            running: end === null,
            as_of: new Date(asOf).toISOString(),
        };
    };

    it('starts at the EARLIEST order — a second round does not reset the table', () => {
        // Exactly the display D2 replaces: the guests sat down at 12:00 and
        // ordered another drink at 12:20. The table has been in service 30
        // minutes, not 10.
        const merged = mergeServiceClocks([atMinutes(0, null, 30), atMinutes(20, null, 30)]);
        expect(merged?.elapsed_ms).toBe(30 * 60_000);
        expect(merged?.started_at).toBe(PLACED);
        expect(merged?.running).toBe(true);
    });

    it('keeps running while ANY order is unsettled, however many are settled', () => {
        // Four settled and one open is a table that has not paid. Calling it
        // finished because most of it is finished is the merge-bill phantom
        // revenue in another costume.
        const merged = mergeServiceClocks([
            atMinutes(0, 15, 60), atMinutes(5, 20, 60), atMinutes(10, 25, 60), atMinutes(12, 30, 60),
            atMinutes(40, null, 60),
        ]);
        expect(merged?.running).toBe(true);
        expect(merged?.ended_at).toBeNull();
        expect(merged?.elapsed_ms).toBe(60 * 60_000);
    });

    it('stops at the LAST settlement once every order has settled', () => {
        const merged = mergeServiceClocks([atMinutes(0, 45, 90), atMinutes(20, 50, 90)]);
        expect(merged?.running).toBe(false);
        expect(merged?.elapsed_ms).toBe(50 * 60_000);
        expect(merged?.ended_at).toBe(new Date(Date.parse(PLACED) + 50 * 60_000).toISOString());
    });

    it('treats a stopped clock with no readable end as still running, not as finished', () => {
        const broken: ServiceClock = { ...atMinutes(0, 30, 60), ended_at: null, running: false };
        const merged = mergeServiceClocks([broken]);
        expect(merged?.running).toBe(true);
    });

    it('answers null for a table with nothing datable on it', () => {
        expect(mergeServiceClocks([])).toBeNull();
    });

    it('is skew-proof for the same reason its inputs are', () => {
        const rows = [atMinutes(0, null, 30), atMinutes(20, null, 30)];
        const correct = mergeServiceClocks(rows);
        withSkewedWallClock(10 * 60_000, () => {
            expect(mergeServiceClocks(rows)).toEqual(correct);
        });
    });
});

describe('tableServiceClockOf — the whole grid path in one call', () => {
    it('reduces the payloads a polled order feed actually carries', () => {
        const merged = tableServiceClockOf([running(), settled()]);
        // One order still open, so the table is still in service and its clock
        // runs from the earliest of the two (they share PLACED here).
        expect(merged?.running).toBe(true);
        expect(merged?.started_at).toBe(PLACED);
    });

    it('skips undatable rows rather than counting them as zero', () => {
        const merged = tableServiceClockOf([
            { service: { started_at: null, ended_at: null, elapsed_ms: 0, running: false, as_of: AS_OF } },
            running(),
        ]);
        expect(merged?.elapsed_ms).toBe(12 * 60_000);
    });

    it('answers null when NOTHING on the table is datable — the card draws no badge', () => {
        expect(tableServiceClockOf([{}, { service: null }])).toBeNull();
    });
});

describe('the surface the screens share', () => {
    it('re-exports the kitchen board\'s formatter rather than growing a second one', () => {
        // D2 asks for the figure to read "identical to the kitchen section
        // display". A second formatter here would make that approximately true.
        expect(formatDuration(12 * 60_000)).toBe('12m 00s');
        expect(formatDuration(40 * 60_000)).toBe('40m 00s');
        expect(formatDuration(2 * 60 * 60_000 + 18 * 60_000)).toBe('2h 18m');
    });

    it('monotonicNow returns a number that only ever moves forward within a session', () => {
        const a = monotonicNow();
        const b = monotonicNow();
        expect(typeof a).toBe('number');
        expect(Number.isFinite(a)).toBe(true);
        expect(b).toBeGreaterThanOrEqual(a);
    });
});
