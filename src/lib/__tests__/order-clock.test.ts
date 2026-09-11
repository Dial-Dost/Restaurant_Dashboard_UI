// What these tests are actually protecting.
//
// WHERE D1 AND D2 WENT. This file used to pin them here, because this module
// computed them — `Date.now() - created_at`, in the browser, while the owner app
// did its own version of the same subtraction. The server answers both now
// (`service_clock.ts`, measured against the SERVER's clock and shipped on three
// reads), the derivations were DELETED rather than left sitting unused, and the
// properties that matter moved to `__tests__/service-clock.test.ts` — including
// the one this file could never state: that a till whose own clock is ten
// minutes fast reads the same duration as one that is right.
//
// WHAT IS LEFT HERE IS WHAT THE SERVER DOES NOT ANSWER: the kitchen's per-item
// PREP timers, the format every duration in this app shares, and the colour
// thresholds. Two ways those can lie, both decidable by value:
//
//   1. NEGATIVE TIME. A timer whose end instant precedes its start — two
//      servers, two clocks — clamps at zero rather than reading "-3m", because a
//      clock that can read negative is a clock staff learn to ignore.
//   2. NaN. `Date.parse` of a malformed timestamp is NaN, and NaN survives every
//      subtraction and every comparison silently — `NaN > 0` is false, so a
//      broken timer renders as the calmest possible reading.
//
// Everything below is pure: fixed instants in, values out. No DOM, no fetch, no
// dependence on the machine's own clock — `nowMs` is injected everywhere.

import {
    formatDuration,
    parseInstant,
    timerElapsedMs,
    waitTone,
    type OrderTimer,
} from '../order-clock';

const T0 = Date.parse('2026-09-11T12:00:00.000Z');
const iso = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString();
const MIN = 60_000;

describe('parseInstant', () => {
    it('parses a server timestamp to epoch ms', () => {
        expect(parseInstant('2026-09-11T12:00:00.000Z')).toBe(T0);
    });

    it('answers null — never NaN — for anything unparseable', () => {
        // NaN is the dangerous answer: it makes every downstream comparison
        // false, so a broken clock renders as the calmest possible reading.
        for (const bad of [null, undefined, '', '   ', 'not a date', 42, {}]) {
            expect(parseInstant(bad)).toBeNull();
        }
    });
});

describe('timerElapsedMs', () => {
    const timer = (over: Partial<OrderTimer> = {}): OrderTimer => ({
        started_at: iso(0), ended_at: null, paused: false, pause_started_at: null, paused_ms: 0, ...over,
    });

    it('counts to now while running', () => {
        expect(timerElapsedMs(timer(), T0 + 3 * MIN)).toBe(3 * MIN);
    });

    it('stops at ended_at', () => {
        expect(timerElapsedMs(timer({ ended_at: iso(4 * MIN) }), T0 + 30 * MIN)).toBe(4 * MIN);
    });

    it('subtracts banked pauses and the pause running right now', () => {
        const t = timer({ paused_ms: 60_000, paused: true, pause_started_at: iso(8 * MIN) });
        // 10 minutes wall, 1 minute banked, 2 minutes of the current pause.
        expect(timerElapsedMs(t, T0 + 10 * MIN)).toBe(7 * MIN);
    });

    it('is zero — not NaN — for a timer that never started', () => {
        expect(timerElapsedMs(null, T0)).toBe(0);
        expect(timerElapsedMs(timer({ started_at: null }), T0)).toBe(0);
    });
});

describe('formatDuration', () => {
    it('reads as the kitchen board reads below an hour', () => {
        expect(formatDuration(0)).toBe('0s');
        expect(formatDuration(45_000)).toBe('45s');
        expect(formatDuration(64_000)).toBe('1m 04s');
        expect(formatDuration(59 * MIN + 59_000)).toBe('59m 59s');
    });

    it('switches to hours so a lunchtime table is readable at a glance', () => {
        expect(formatDuration(60 * MIN)).toBe('1h 00m');
        expect(formatDuration(163 * MIN + 12_000)).toBe('2h 43m');
    });

    it('never renders negative time', () => {
        expect(formatDuration(-5000)).toBe('0s');
    });
});

describe('waitTone', () => {
    it('stays calm long enough that a red badge still means something', () => {
        expect(waitTone(0)).toBe('calm');
        expect(waitTone(19 * MIN)).toBe('calm');
        expect(waitTone(20 * MIN)).toBe('watch');
        expect(waitTone(44 * MIN)).toBe('watch');
        expect(waitTone(45 * MIN)).toBe('late');
    });

    it('treats an unknown wait as calm rather than alarming the floor', () => {
        expect(waitTone(null)).toBe('calm');
        expect(waitTone(undefined)).toBe('calm');
    });
});
