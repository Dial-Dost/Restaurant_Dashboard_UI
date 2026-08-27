// The reporting window, as one value the whole dashboard agrees on.
//
// WHY THIS EXISTS
// ---------------
// Every screen that shows money used to carry its own idea of "the period":
// Accounting had two <input type="date"> boxes, Analytics had a hardcoded
// "last 30 days" baked into a dozen card captions, History had 1/2/3-year
// buttons, Cash had another pair of date boxes. So the same figure could be cut
// four different ways in four tabs, and none of them said which. This module is
// the one definition of a window; `DateRangePicker` is the one control that
// edits it, and `rangeLabel` is the one sentence that states it.
//
// PURE — no React, no fetch, no `document`. That is what lets the jest suite
// (src/lib/__tests__/date-range.test.ts) pin every preset against a fixed clock
// instead of racing midnight, and it is why the session-storage helpers at the
// bottom degrade to a no-op rather than throwing when `window` is absent
// (Next renders these pages on the server first).
//
// DAY KEYS, NOT INSTANTS
// ----------------------
// A window is a pair of INCLUSIVE `YYYY-MM-DD` calendar days in the
// RESTAURANT's timezone — the same contract `from`/`to` already had on
// /reports/*. Never a Date, never an ISO instant: a Date is a point on a
// timeline and would have to be re-anchored to a zone at every use, which is
// exactly the bug that files an IST restaurant's 01:00 covers under yesterday.

import { dayKeyInZone, daysAgoInZone, todayInZone } from './tz';

/** The windows people actually ask for, plus the escape hatch. */
export type RangePreset =
    | 'today'
    | 'yesterday'
    | 'last7'
    | 'last30'
    | 'this_month'
    | 'last_month'
    | 'custom';

export interface DateRange {
    /** Inclusive first day, `YYYY-MM-DD` in the restaurant's zone. */
    from: string;
    /** Inclusive last day. */
    to: string;
    /**
     * Which preset produced this, or `custom`. Carried WITH the dates rather
     * than re-derived, because "Last 7 days" and "21–27 Aug" are the same seven
     * days today and different windows tomorrow — only the stored intent can
     * tell a reopened screen which of the two the owner meant.
     */
    preset: RangePreset;
}

/** Ordered exactly as the control lists them: daily habits first. */
export const RANGE_PRESETS: { id: Exclude<RangePreset, 'custom'>; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: 'yesterday', label: 'Yesterday' },
    { id: 'last7', label: 'Last 7 days' },
    { id: 'last30', label: 'Last 30 days' },
    { id: 'this_month', label: 'This month' },
    { id: 'last_month', label: 'Last month' },
];

const PRESET_LABELS: Record<RangePreset, string> = {
    today: 'Today',
    yesterday: 'Yesterday',
    last7: 'Last 7 days',
    last30: 'Last 30 days',
    this_month: 'This month',
    last_month: 'Last month',
    custom: 'Custom range',
};

/** Human name for a preset — the word on the button and the chip's first half. */
export const presetLabel = (preset: RangePreset): string => PRESET_LABELS[preset] ?? PRESET_LABELS.custom;

export const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isDayKey = (value: unknown): value is string =>
    typeof value === 'string' && DAY_KEY_RE.test(value);

// --- Pure calendar arithmetic on day keys -----------------------------------
// UTC-anchored because a key already NAMES a day; no zone is involved in moving
// from one day to the next, and doing it with local Dates would let a DST night
// turn "+1 day" into "the same day again".

const partsOf = (key: string): [number, number, number] => {
    const m = DAY_KEY_RE.exec(key);
    if (!m) {return [NaN, NaN, NaN];}
    const [y, mo, d] = key.split('-').map(Number);
    return [y, mo, d];
};

const keyFrom = (y: number, m: number, d: number): string => {
    const anchor = new Date(Date.UTC(y, m - 1, d));
    return anchor.toISOString().slice(0, 10);
};

/** Add whole days to a day key. */
export const addDays = (key: string, days: number): string => {
    const [y, m, d] = partsOf(key);
    return Number.isNaN(y) ? key : keyFrom(y, m, d + days);
};

/** First day of the month `key` falls in. */
export const startOfMonth = (key: string): string => {
    const [y, m] = partsOf(key);
    return Number.isNaN(y) ? key : keyFrom(y, m, 1);
};

/** Last day of the month `key` falls in — day 0 of the next month. */
export const endOfMonth = (key: string): string => {
    const [y, m] = partsOf(key);
    return Number.isNaN(y) ? key : keyFrom(y, m + 1, 0);
};

/**
 * INCLUSIVE day count: 1–15 Aug is 15 days, not 14. This is how an owner counts,
 * and it is the number the backend's rolling `days` parameter has to receive for
 * a custom span to cover the same ground.
 */
export const rangeDays = (range: { from: string; to: string }): number => {
    const [ay, am, ad] = partsOf(range.from);
    const [by, bm, bd] = partsOf(range.to);
    if (Number.isNaN(ay) || Number.isNaN(by)) {return 0;}
    const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
    return Math.round(ms / 86_400_000) + 1;
};

// --- Presets ----------------------------------------------------------------

/**
 * The concrete days a preset means RIGHT NOW, in the restaurant's zone.
 *
 * `today` is the restaurant's today. On a device in another country that is not
 * the same day the browser thinks it is, and the owner's books close on the
 * restaurant's midnight — so this reads the tenant zone, never the viewer's.
 */
export const resolvePreset = (preset: RangePreset, timezone: string): DateRange => {
    const today = todayInZone(timezone);
    switch (preset) {
        case 'today':
            return { from: today, to: today, preset };
        case 'yesterday': {
            const y = daysAgoInZone(1, timezone);
            return { from: y, to: y, preset };
        }
        case 'last7':
            // INCLUSIVE of today: seven days on the calendar, which is what
            // "last 7 days" means to the person asking. `daysAgoInZone(7)` would
            // be an eight-day window.
            return { from: daysAgoInZone(6, timezone), to: today, preset };
        case 'last30':
            return { from: daysAgoInZone(29, timezone), to: today, preset };
        case 'this_month':
            // Ends TODAY, not at the end of the month: a month-to-date figure is
            // the only honest one mid-month, and a window running into the future
            // renders as zeros that read like missing data.
            return { from: startOfMonth(today), to: today, preset };
        case 'last_month': {
            const lastMonthDay = addDays(startOfMonth(today), -1);
            return { from: startOfMonth(lastMonthDay), to: endOfMonth(lastMonthDay), preset };
        }
        default:
            return { from: daysAgoInZone(29, timezone), to: today, preset: 'custom' };
    }
};

/** What a screen opens on before anyone has chosen anything. */
export const defaultRange = (timezone: string): DateRange => resolvePreset('last30', timezone);

/**
 * Coerce any two day keys into a legal window: swap a reversed pair, clamp a
 * future end back to today, and fall back to the default when either key is junk.
 *
 * Swapping matters for the calendar specifically — dragging right-to-left is a
 * perfectly normal gesture and produces `from > to`. Erroring on it would be
 * pedantry; returning an empty report would look like the restaurant had no
 * trade that fortnight.
 */
export const normalizeRange = (
    range: { from?: string | null; to?: string | null; preset?: RangePreset },
    timezone: string,
): DateRange => {
    const today = todayInZone(timezone);
    let from = isDayKey(range.from) ? range.from : '';
    let to = isDayKey(range.to) ? range.to : '';
    if (!from && !to) {return defaultRange(timezone);}
    if (!to) {to = from;}
    if (!from) {from = to;}
    if (from > to) {[from, to] = [to, from];}
    // There is no trade after today; a window that runs into the future comes
    // back as zeros, which an owner reads as data loss rather than as "not yet".
    if (to > today) {to = today;}
    if (from > to) {from = to;}
    return { from, to, preset: range.preset ?? 'custom' };
};

// --- Labels -----------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const dayOf = (key: string): number => partsOf(key)[2];
const monthOf = (key: string): string => MONTHS[partsOf(key)[1] - 1] ?? '';
const yearOf = (key: string): number => partsOf(key)[0];

/**
 * The chip: `1–15 Aug`, `15 Aug`, `28 Jul – 3 Sep`, `28 Jul 2025 – 3 Sep 2026`.
 *
 * Always CONCRETE dates, never "last 30 days". Every screen showing money renders
 * this somewhere permanent, so a filtered figure can never be mistaken for the
 * all-time number — which is the whole reason the control exists.
 *
 * The year is shown only when it is not the restaurant's current year, or when
 * the two ends straddle a year boundary. Printing "2026" on every chip would
 * cost the width that makes `1–15 Aug` fit next to a heading on a phone, and it
 * tells the owner nothing they do not already know.
 */
export const rangeLabel = (range: { from: string; to: string }, timezone: string): string => {
    if (!isDayKey(range.from) || !isDayKey(range.to)) {return '—';}
    const thisYear = yearOf(todayInZone(timezone));
    const fy = yearOf(range.from);
    const ty = yearOf(range.to);
    const showYear = fy !== thisYear || ty !== thisYear;

    if (range.from === range.to) {
        return `${dayOf(range.from)} ${monthOf(range.from)}${showYear ? ` ${fy}` : ''}`;
    }
    if (fy === ty) {
        if (monthOf(range.from) === monthOf(range.to)) {
            // Same month: name it once. "1–15 Aug" is the form the owner asked for.
            return `${dayOf(range.from)}–${dayOf(range.to)} ${monthOf(range.to)}${showYear ? ` ${ty}` : ''}`;
        }
        return `${dayOf(range.from)} ${monthOf(range.from)} – ${dayOf(range.to)} ${monthOf(range.to)}${showYear ? ` ${ty}` : ''}`;
    }
    return `${dayOf(range.from)} ${monthOf(range.from)} ${fy} – ${dayOf(range.to)} ${monthOf(range.to)} ${ty}`;
};

/**
 * The unambiguous form, for tooltips and anywhere an accountant reconciles
 * against paper: names the zone, because "1st to 15th" is meaningless without
 * knowing whose midnight closed each day.
 */
export const rangeTooltip = (range: DateRange, timezone: string): string =>
    `${presetLabel(range.preset)}: ${range.from} to ${range.to} (${rangeDays(range)} day${rangeDays(range) === 1 ? '' : 's'}), `
    + `counted on the restaurant's calendar in ${timezone}`;

// --- The wire contract ------------------------------------------------------

/**
 * The query parameters every reporting endpoint is called with.
 *
 * `days` rides along beside `from`/`to` on purpose. The accounting reports have
 * always taken `from`/`to`; the analytics routes historically took only a rolling
 * `days`. Sending all three means one control drives both families: a backend
 * that understands the range uses it, and one that does not still receives a
 * window of the RIGHT LENGTH instead of silently answering for its own default
 * 30 days. `days` is the inclusive span so the two agree on length exactly.
 */
export interface RangeQuery {
    from: string;
    to: string;
    days: number;
}

export const toQuery = (range: DateRange): RangeQuery => ({
    from: range.from,
    to: range.to,
    days: Math.max(1, rangeDays(range)),
});

/** `from=…&to=…&days=…`, ready to append to a URL that already has a `?`. */
export const toQueryString = (range: DateRange): string => {
    const q = toQuery(range);
    return `from=${encodeURIComponent(q.from)}&to=${encodeURIComponent(q.to)}&days=${q.days}`;
};

// --- Per-screen session persistence -----------------------------------------
// Session, not local: the window an owner reasoned about this afternoon should
// survive a hop to Menu and back, but tomorrow's first look should start from a
// fresh, honest default rather than a stale fortnight they have forgotten
// choosing. Per SCREEN, because Accounting and Analytics are genuinely separate
// questions and forcing them to share one window would make each tab change the
// other behind the user's back.

const storageKey = (screen: string) => `rd-date-range:${screen}`;

/**
 * Has this screen been given a window in this session? Distinct from
 * `loadRange`, which cannot tell "nothing stored" from "stored, and it happens
 * to equal the default" — a screen whose opening window is not the 30-day
 * default needs that difference, or it would overrule a choice the owner made.
 */
export const hasStored = (screen: string): boolean => {
    if (typeof window === 'undefined') {return false;}
    try {
        return window.sessionStorage.getItem(storageKey(screen)) !== null;
    } catch {
        return false;
    }
};

/** Restore this screen's window, or the default when there is nothing to restore. */
export const loadRange = (screen: string, timezone: string): DateRange => {
    if (typeof window === 'undefined') {return defaultRange(timezone);}
    try {
        const raw = window.sessionStorage.getItem(storageKey(screen));
        if (!raw) {return defaultRange(timezone);}
        const parsed = JSON.parse(raw) as Partial<DateRange>;
        // A stored PRESET is re-resolved rather than replayed: reopening the tab
        // after midnight must move "Today" to the new today, or the screen would
        // quietly show yesterday's takings under a label that says Today.
        if (parsed.preset && parsed.preset !== 'custom') {
            return resolvePreset(parsed.preset, timezone);
        }
        return normalizeRange({ from: parsed.from, to: parsed.to, preset: 'custom' }, timezone);
    } catch {
        // Private mode, disabled storage, or a value from an older build.
        return defaultRange(timezone);
    }
};

/** Remember this screen's window for the rest of the session. */
export const saveRange = (screen: string, range: DateRange): void => {
    if (typeof window === 'undefined') {return;}
    try {
        window.sessionStorage.setItem(storageKey(screen), JSON.stringify(range));
    } catch {/* quota or private mode — the in-memory state still holds */}
};

/**
 * Seed a window from `?from=&to=` on the URL. History deep-links into Accounting
 * this way ("open August in Accounting"), and a shared link has to open on the
 * window it names rather than on whatever the recipient's session remembered.
 * Returns null when the URL carries no usable range, so the caller falls back to
 * the stored one.
 */
export const rangeFromParams = (
    params: { get(name: string): string | null } | null | undefined,
    timezone: string,
): DateRange | null => {
    const from = params?.get('from');
    const to = params?.get('to');
    if (!isDayKey(from) && !isDayKey(to)) {return null;}
    return normalizeRange({ from, to, preset: 'custom' }, timezone);
};

/**
 * Day key for a JS `Date` the calendar handed back.
 *
 * react-day-picker builds its days in the BROWSER's zone, so the Date it returns
 * for the cell labelled "1" is local midnight on the 1st. Reading that with
 * `toISOString().slice(0,10)` would name 31 July for any viewer west of
 * Greenwich. The calendar grid is a picture of a calendar, not an instant — so
 * the day is read off its own local fields.
 */
export const dayKeyOfPickedDate = (date: Date): string => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {return '';}
    return keyFrom(date.getFullYear(), date.getMonth() + 1, date.getDate());
};

/** The inverse: a day key as the local-midnight Date the calendar wants back. */
export const pickedDateOfDayKey = (key: string): Date | undefined => {
    if (!isDayKey(key)) {return undefined;}
    const [y, m, d] = partsOf(key);
    return new Date(y, m - 1, d);
};

/** Today as the calendar's own Date, so "today" is highlighted on the right cell. */
export const pickerToday = (timezone: string): Date | undefined =>
    pickedDateOfDayKey(dayKeyInZone(new Date(), timezone));
