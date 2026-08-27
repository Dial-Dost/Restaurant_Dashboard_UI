// The reporting window contract.
//
// Four things are pinned here because getting any of them wrong is invisible
// until an owner is looking at a wrong number and does not know it:
//
//  1. PRESETS ARE COUNTED ON THE RESTAURANT'S CALENDAR. Not the browser's. The
//     clock is frozen at an instant that is a DIFFERENT DAY in IST and in UTC,
//     so a preset that quietly used the viewer's zone fails these tests instead
//     of shipping.
//  2. BOTH ENDS ARE INCLUSIVE. "Last 7 days" is seven days including today, and
//     1–15 Aug is fifteen days. An off-by-one here drops a whole day's takings
//     from every export.
//  3. THE LABEL SAYS WHAT WAS ACTUALLY CUT. The chip is the only thing standing
//     between a filtered figure and being read as the all-time number.
//  4. THE EXPORT CARRIES THE SAME RANGE AS THE SCREEN. An export that silently
//     disagrees with what is on screen is worse than no export.

import {
    addDays,
    dayKeyOfPickedDate,
    defaultRange,
    endOfMonth,
    loadRange,
    normalizeRange,
    pickedDateOfDayKey,
    presetLabel,
    rangeDays,
    rangeFromParams,
    rangeLabel,
    rangeTooltip,
    resolvePreset,
    saveRange,
    startOfMonth,
    toQuery,
    toQueryString,
    type DateRange,
} from '../date-range';

const IST = 'Asia/Kolkata';
const NY = 'America/New_York';

// 2026-08-27T20:30:00Z. In IST that is 02:00 on the 28th; in New York it is
// 16:30 on the 27th. Any preset that reads the wrong zone lands on the wrong day.
const NOW = new Date('2026-08-27T20:30:00.000Z');

beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
});
afterAll(() => { jest.useRealTimers(); });

describe('day-key arithmetic', () => {
    it('crosses month and year boundaries', () => {
        expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
        expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
        expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    });

    it('knows how long a month is, leap years included', () => {
        expect(startOfMonth('2026-08-27')).toBe('2026-08-01');
        expect(endOfMonth('2026-08-27')).toBe('2026-08-31');
        expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
        expect(endOfMonth('2024-02-10')).toBe('2024-02-29');
    });

    it('counts both ends: 1-15 Aug is fifteen days, not fourteen', () => {
        expect(rangeDays({ from: '2026-08-01', to: '2026-08-15' })).toBe(15);
        expect(rangeDays({ from: '2026-08-15', to: '2026-08-15' })).toBe(1);
        expect(rangeDays({ from: '2026-01-01', to: '2026-12-31' })).toBe(365);
    });
});

describe('presets map to the right window', () => {
    it('counts today on the RESTAURANT calendar, not the viewer browser', () => {
        // Same instant, two tenants: IST has already rolled over to the 28th.
        expect(resolvePreset('today', IST)).toEqual({ from: '2026-08-28', to: '2026-08-28', preset: 'today' });
        expect(resolvePreset('today', NY)).toEqual({ from: '2026-08-27', to: '2026-08-27', preset: 'today' });
    });

    it('yesterday is a single day, the one before the restaurant today', () => {
        expect(resolvePreset('yesterday', IST)).toEqual({ from: '2026-08-27', to: '2026-08-27', preset: 'yesterday' });
        expect(rangeDays(resolvePreset('yesterday', IST))).toBe(1);
    });

    it('last 7 / last 30 include today and are exactly that many days', () => {
        const seven = resolvePreset('last7', IST);
        expect(seven).toEqual({ from: '2026-08-22', to: '2026-08-28', preset: 'last7' });
        expect(rangeDays(seven)).toBe(7);

        const thirty = resolvePreset('last30', IST);
        expect(thirty).toEqual({ from: '2026-07-30', to: '2026-08-28', preset: 'last30' });
        expect(rangeDays(thirty)).toBe(30);
    });

    it('this month runs to TODAY, never into the future', () => {
        // A window ending 31 Aug would come back as zeros for the 29th-31st,
        // which reads to an owner as data loss rather than as "not yet".
        expect(resolvePreset('this_month', IST)).toEqual({ from: '2026-08-01', to: '2026-08-28', preset: 'this_month' });
    });

    it('last month is the whole previous calendar month', () => {
        expect(resolvePreset('last_month', IST)).toEqual({ from: '2026-07-01', to: '2026-07-31', preset: 'last_month' });
        expect(rangeDays(resolvePreset('last_month', IST))).toBe(31);
    });

    it('last month crosses the year boundary correctly', () => {
        jest.setSystemTime(new Date('2026-01-10T06:00:00.000Z'));
        expect(resolvePreset('last_month', IST)).toEqual({ from: '2025-12-01', to: '2025-12-31', preset: 'last_month' });
        expect(resolvePreset('this_month', IST)).toEqual({ from: '2026-01-01', to: '2026-01-10', preset: 'this_month' });
        jest.setSystemTime(NOW);
    });

    it('defaults to the last 30 days', () => {
        expect(defaultRange(IST)).toEqual(resolvePreset('last30', IST));
    });
});

describe('normalizeRange', () => {
    it('swaps a range dragged right-to-left instead of returning nothing', () => {
        expect(normalizeRange({ from: '2026-08-15', to: '2026-08-01' }, IST))
            .toEqual({ from: '2026-08-01', to: '2026-08-15', preset: 'custom' });
    });

    it('clamps a future end back to the restaurant today', () => {
        expect(normalizeRange({ from: '2026-08-01', to: '2027-01-01' }, IST))
            .toEqual({ from: '2026-08-01', to: '2026-08-28', preset: 'custom' });
    });

    it('treats one supplied end as a single day', () => {
        expect(normalizeRange({ from: '2026-08-05', to: null }, IST))
            .toEqual({ from: '2026-08-05', to: '2026-08-05', preset: 'custom' });
    });

    it('falls back to the default when both ends are junk', () => {
        expect(normalizeRange({ from: 'yesterday', to: '' }, IST)).toEqual(defaultRange(IST));
        expect(normalizeRange({ from: '15/08/2026', to: null }, IST)).toEqual(defaultRange(IST));
    });
});

describe('rangeLabel renders the selected range', () => {
    it('collapses a same-month span to the form the owner asked for', () => {
        expect(rangeLabel({ from: '2026-08-01', to: '2026-08-15' }, IST)).toBe('1–15 Aug');
    });

    it('names one day once', () => {
        expect(rangeLabel({ from: '2026-08-15', to: '2026-08-15' }, IST)).toBe('15 Aug');
    });

    it('names both months when the span crosses one', () => {
        expect(rangeLabel({ from: '2026-07-28', to: '2026-09-03' }, IST)).toBe('28 Jul – 3 Sep');
    });

    it('adds the year only when it is not the current one', () => {
        expect(rangeLabel({ from: '2025-08-01', to: '2025-08-15' }, IST)).toBe('1–15 Aug 2025');
        expect(rangeLabel({ from: '2025-12-28', to: '2026-01-03' }, IST)).toBe('28 Dec 2025 – 3 Jan 2026');
    });

    it('never renders a half-built range as a number', () => {
        expect(rangeLabel({ from: '', to: '2026-08-15' }, IST)).toBe('—');
    });

    it('names the preset and the zone in the tooltip, for reconciling on paper', () => {
        const tip = rangeTooltip({ from: '2026-08-01', to: '2026-08-15', preset: 'custom' }, IST);
        expect(tip).toContain('2026-08-01 to 2026-08-15');
        expect(tip).toContain('15 days');
        expect(tip).toContain(IST);
        expect(presetLabel('last7')).toBe('Last 7 days');
    });

    it('says "1 day" rather than "1 days"', () => {
        expect(rangeTooltip({ from: '2026-08-15', to: '2026-08-15', preset: 'today' }, IST)).toContain('(1 day)');
    });
});

describe('the wire contract', () => {
    it('sends a custom span as from/to, with days as the matching span', () => {
        const custom: DateRange = { from: '2026-08-01', to: '2026-08-15', preset: 'custom' };
        expect(toQuery(custom)).toEqual({ from: '2026-08-01', to: '2026-08-15', days: 15 });
    });

    it('sends a preset as concrete dates too, so both endpoint families agree', () => {
        // /reports/* reads from/to; the older /analytics/* routes read days. One
        // control has to satisfy both or the two halves of a screen disagree.
        expect(toQuery(resolvePreset('last7', IST))).toEqual({ from: '2026-08-22', to: '2026-08-28', days: 7 });
    });

    it('builds a query string an export URL can carry verbatim', () => {
        expect(toQueryString({ from: '2026-08-01', to: '2026-08-15', preset: 'custom' }))
            .toBe('from=2026-08-01&to=2026-08-15&days=15');
    });

    it('never emits days=0, which a backend would read as "use your default"', () => {
        expect(toQuery({ from: '2026-08-15', to: '2026-08-15', preset: 'today' }).days).toBe(1);
    });
});

describe('deep links', () => {
    it('opens on the range a shared URL names', () => {
        const params = new URLSearchParams('from=2026-07-01&to=2026-07-31');
        expect(rangeFromParams(params, IST)).toEqual({ from: '2026-07-01', to: '2026-07-31', preset: 'custom' });
    });

    it('yields null when the URL carries no usable range, so the session wins', () => {
        expect(rangeFromParams(new URLSearchParams('tab=gst'), IST)).toBeNull();
        expect(rangeFromParams(null, IST)).toBeNull();
    });
});

describe('calendar <-> day key', () => {
    it('reads the picked cell by its own local fields, not through UTC', () => {
        // A Date built at local midnight on the 1st is 31 July in UTC for any
        // viewer west of Greenwich; slicing toISOString() would name the wrong day.
        expect(dayKeyOfPickedDate(new Date(2026, 7, 1))).toBe('2026-08-01');
        expect(dayKeyOfPickedDate(new Date(2026, 0, 31))).toBe('2026-01-31');
        expect(dayKeyOfPickedDate(new Date('nope'))).toBe('');
    });

    it('round-trips', () => {
        const key = '2026-08-15';
        expect(dayKeyOfPickedDate(pickedDateOfDayKey(key)!)).toBe(key);
        expect(pickedDateOfDayKey('rubbish')).toBeUndefined();
    });
});

describe('per-screen session persistence', () => {
    const store = new Map<string, string>();
    const fakeWindow = {
        sessionStorage: {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => { store.set(k, v); },
        },
    };

    beforeEach(() => {
        store.clear();
        (globalThis as { window?: unknown }).window = fakeWindow;
    });
    afterEach(() => { delete (globalThis as { window?: unknown }).window; });

    it('keeps two screens apart, so Accounting cannot move Analytics', () => {
        saveRange('accounting', { from: '2026-08-01', to: '2026-08-15', preset: 'custom' });
        expect(loadRange('accounting', IST)).toEqual({ from: '2026-08-01', to: '2026-08-15', preset: 'custom' });
        expect(loadRange('analytics', IST)).toEqual(defaultRange(IST));
    });

    it('RE-RESOLVES a stored preset rather than replaying its old dates', () => {
        // Saved yesterday, reopened today: "Today" has to mean today, or the
        // screen shows yesterday's takings under a label that says Today.
        store.set('rd-date-range:analytics', JSON.stringify({ from: '2026-08-20', to: '2026-08-20', preset: 'today' }));
        expect(loadRange('analytics', IST)).toEqual({ from: '2026-08-28', to: '2026-08-28', preset: 'today' });
    });

    it('replays a CUSTOM range verbatim — it named days, not a rule', () => {
        store.set('rd-date-range:accounting', JSON.stringify({ from: '2026-08-01', to: '2026-08-15', preset: 'custom' }));
        expect(loadRange('accounting', IST)).toEqual({ from: '2026-08-01', to: '2026-08-15', preset: 'custom' });
    });

    it('survives corrupt storage instead of blanking the screen', () => {
        store.set('rd-date-range:accounting', '{not json');
        expect(loadRange('accounting', IST)).toEqual(defaultRange(IST));
    });
});

describe('server rendering', () => {
    it('degrades to the default with no window at all', () => {
        // These pages render on the server first; touching sessionStorage there
        // would throw during the render rather than at a call site.
        expect(typeof window).toBe('undefined');
        expect(loadRange('accounting', IST)).toEqual(defaultRange(IST));
        expect(() => { saveRange('accounting', defaultRange(IST)); }).not.toThrow();
    });
});
