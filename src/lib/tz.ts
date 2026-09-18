// Restaurant-timezone formatting — the ONE place an instant becomes text.
//
// Every instant the system records is stored UTC (timestamptz) and arrives here
// as an ISO string. Rendering it with a bare `new Date(iso).toLocaleString()`
// formats it in the VIEWER's browser zone, which is wrong twice over for a POS:
// an owner checking the books from another country would read different clock
// times than the till printed, and — worse for tally — a "day" would end at the
// viewer's midnight rather than the restaurant's. Both bugs are silent; the
// numbers still add up, they just belong to the wrong day.
//
// So display formatting takes the tenant's IANA zone (see useTimezone) and hands
// it to Intl.DateTimeFormat. No new dependency: Intl already carries the ICU
// zone database the backend seeds its picker from.
//
// This module is deliberately NOT "use server" (db.ts is, and that file may only
// export async functions) and holds no React — it is pure, so the same helpers
// serve components, table cells, CSV exports and day-bucket keys alike.

/** Matches the backend's own default (`sanitizeTimezone`) for a tenant that never set one. */
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/** An instant, however it reached us. `null`/`undefined`/junk render as the fallback. */
export type Instant = string | number | Date | null | undefined;

// Intl.DateTimeFormat construction is the expensive part (ICU lookup), and these
// helpers run per table row — memoise per zone+shape.
const formatterCache = new Map<string, Intl.DateTimeFormat>();

const getFormatter = (timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat => {
    const key = `${timeZone}|${JSON.stringify(options)}`;
    const cached = formatterCache.get(key);
    if (cached) {return cached;}
    let fmt: Intl.DateTimeFormat;
    try {
        fmt = new Intl.DateTimeFormat('en-GB', { ...options, timeZone });
    } catch {
        // Unknown zone (a value saved before validation existed, or an ICU build
        // without it). Fall back to the default zone rather than throwing inside
        // a render and blanking the whole page.
        fmt = new Intl.DateTimeFormat('en-GB', { ...options, timeZone: DEFAULT_TIMEZONE });
    }
    formatterCache.set(key, fmt);
    return fmt;
};

/** Parse anything into a valid Date, or null. Never throws. */
export const toDate = (value: Instant): Date | null => {
    if (value === null || value === undefined || value === '') {return null;}
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
};

/** True when Intl here will accept this zone id (same check the backend makes). */
export const isValidTimezone = (timeZone: string): boolean => {
    try {
        new Intl.DateTimeFormat(undefined, { timeZone });
        return true;
    } catch {
        return false;
    }
};

/** Coerce to a usable zone. Mirrors the backend's `sanitizeTimezone`. */
export const sanitizeTimezone = (timeZone: string | null | undefined): string => {
    const tz = typeof timeZone === 'string' ? timeZone.trim() : '';
    return tz && isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
};

// --- Part extraction --------------------------------------------------------
// Assembling from formatToParts rather than reading a locale-formatted string
// keeps the output stable no matter what the runtime locale is.

const partsIn = (value: Date, timeZone: string, options: Intl.DateTimeFormatOptions): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const part of getFormatter(timeZone, options).formatToParts(value)) {
        out[part.type] = part.value;
    }
    return out;
};

const NUMERIC_PARTS: Intl.DateTimeFormatOptions = {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
};

// --- Display formatters -----------------------------------------------------

/** `20:06` — a compact clock, for dense rows where the date is implied. */
export const formatTime = (value: Instant, timeZone: string, fallback = '—'): string => {
    const d = toDate(value);
    if (!d) {return fallback;}
    const p = partsIn(d, timeZone, NUMERIC_PARTS);
    return `${p.hour}:${p.minute}`;
};

/** `28/07/26` — the short date this codebase already prints on order rows. */
export const formatDate = (value: Instant, timeZone: string, fallback = '—'): string => {
    const d = toDate(value);
    if (!d) {return fallback;}
    const p = partsIn(d, timeZone, NUMERIC_PARTS);
    return `${p.day}/${p.month}/${p.year.slice(-2)}`;
};

/** `28/07/26 20:06` — the default "when did this happen" stamp. */
export const formatDateTime = (value: Instant, timeZone: string, fallback = '—'): string => {
    const d = toDate(value);
    if (!d) {return fallback;}
    const p = partsIn(d, timeZone, NUMERIC_PARTS);
    return `${p.day}/${p.month}/${p.year.slice(-2)} ${p.hour}:${p.minute}`;
};

/**
 * `Tue, 28 Jul 2026, 20:06:07 IST` — the unambiguous form, with the zone named.
 * For tooltips, confirmation dialogs and anywhere an accountant has to be able
 * to reconcile the number against a paper trail.
 */
export const formatFullDateTime = (value: Instant, timeZone: string, fallback = '—'): string => {
    const d = toDate(value);
    if (!d) {return fallback;}
    const p = partsIn(d, timeZone, {
        weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false, timeZoneName: 'short',
    });
    return `${p.weekday}, ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}:${p.second} ${p.timeZoneName ?? ''}`.trim();
};

/** `28 Jul 2026` — a readable date with no clock. */
export const formatLongDate = (value: Instant, timeZone: string, fallback = '—'): string => {
    const d = toDate(value);
    if (!d) {return fallback;}
    const p = partsIn(d, timeZone, { day: '2-digit', month: 'short', year: 'numeric' });
    return `${p.day} ${p.month} ${p.year}`;
};

/** `July` / `July 2026` — month labels for grouped reports. */
export const formatMonth = (value: Instant, timeZone: string, withYear = false, fallback = '—'): string => {
    const d = toDate(value);
    if (!d) {return fallback;}
    const p = partsIn(d, timeZone, withYear ? { month: 'long', year: 'numeric' } : { month: 'long' });
    return withYear ? `${p.month} ${p.year}` : p.month;
};

// --- Day bucketing (the tally-critical part) --------------------------------

/**
 * `YYYY-MM-DD` for the RESTAURANT's calendar day containing this instant.
 *
 * This is the one that actually moves money between rows. The pattern it
 * replaces — `new Date(iso).toISOString().slice(0, 10)` — is a UTC day key, so
 * for an India-based restaurant every sale rung up between 00:00 and 05:30 IST
 * was filed under the PREVIOUS day. Nightly covers are exactly when that
 * happens, so day-end totals and the books disagreed by a real amount.
 */
export const dayKeyInZone = (value: Instant, timeZone: string): string => {
    const d = toDate(value);
    if (!d) {return '';}
    const p = partsIn(d, timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' });
    return `${p.year}-${p.month}-${p.day}`;
};

/** Today's `YYYY-MM-DD` in the restaurant's zone — the correct seed for a date input. */
export const todayInZone = (timeZone: string): string => dayKeyInZone(new Date(), timeZone);

/** `YYYY-MM` for the restaurant's current month. */
export const monthKeyInZone = (value: Instant, timeZone: string): string => dayKeyInZone(value, timeZone).slice(0, 7);

/**
 * `YYYY-MM-DD` for `days` before today in the restaurant's zone.
 * Plain-date arithmetic (UTC noon anchor), so DST transitions can't shift the
 * day across a boundary the way adding 86_400_000 ms to a wall clock would.
 */
export const daysAgoInZone = (days: number, timeZone: string): string => {
    const key = todayInZone(timeZone);
    const [y, m, d] = key.split('-').map(Number);
    const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    anchor.setUTCDate(anchor.getUTCDate() - days);
    return `${anchor.getUTCFullYear()}-${String(anchor.getUTCMonth() + 1).padStart(2, '0')}-${String(anchor.getUTCDate()).padStart(2, '0')}`;
};

/** The calendar year in the restaurant's zone. */
export const yearInZone = (timeZone: string): number => Number(dayKeyInZone(new Date(), timeZone).slice(0, 4));

/**
 * `YYYY-MM-DD` for the Monday of the week containing today, in the restaurant's
 * zone. The weekday must be read in that zone too: at 01:00 Monday IST it is
 * still Sunday in UTC, so a UTC-derived weekday would return the wrong week.
 */
export const startOfWeekInZone = (timeZone: string): string => {
    const weekday = getFormatter(timeZone, { weekday: 'short' }).format(new Date());
    const index = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday.slice(0, 3));
    // Unknown weekday label (exotic locale data) — fall back to today.
    if (index < 0) {return todayInZone(timeZone);}
    return daysAgoInZone((index + 6) % 7, timeZone);
};

// --- Wall clock <-> instant (for <input type="datetime-local">) -------------
// A datetime-local input has no zone: it is a bare wall clock. The browser's
// own conversion reads it in the VIEWER's zone, so an owner in London setting a
// coupon to expire "31 Dec 23:59" would store 05:29 on 1 Jan restaurant time.
// These two mirror the backend's `zonedWallToUtc` / `parseWallClockInZone`.

/** Offset in ms that `timeZone` is ahead of UTC at the given instant. */
const offsetMsAt = (instant: Date, timeZone: string): number => {
    const p = partsIn(instant, timeZone, NUMERIC_PARTS);
    const asIfUtc = Date.UTC(
        Number(p.year), Number(p.month) - 1, Number(p.day),
        // Intl renders midnight as "24" in some hour12:false locales; normalise.
        Number(p.hour) % 24, Number(p.minute), Number(p.second),
    );
    return asIfUtc - instant.getTime();
};

/**
 * `"2026-12-31T23:59"` in the restaurant's zone -> the UTC instant it denotes.
 * Two passes: the first offset guess is taken at the naive instant, the second
 * at the corrected one, which is what makes it right across a DST change.
 */
export const wallClockToUtcInZone = (wall: string, timeZone: string): Date | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(wall ?? '').trim());
    if (!m) {return null;}
    const naive = Date.UTC(
        Number(m[1]), Number(m[2]) - 1, Number(m[3]),
        Number(m[4]), Number(m[5]), Number(m[6] ?? 0),
    );
    let ts = naive - offsetMsAt(new Date(naive), timeZone);
    ts = naive - offsetMsAt(new Date(ts), timeZone);
    const out = new Date(ts);
    return Number.isNaN(out.getTime()) ? null : out;
};

/** An instant -> `"YYYY-MM-DDTHH:mm"` as the restaurant's wall clock reads it. */
export const utcToWallClockInZone = (value: Instant, timeZone: string): string => {
    const d = toDate(value);
    if (!d) {return '';}
    const p = partsIn(d, timeZone, NUMERIC_PARTS);
    return `${p.year}-${p.month}-${p.day}T${String(Number(p.hour) % 24).padStart(2, '0')}:${p.minute}`;
};

// --- Zone labelling ---------------------------------------------------------

/** `IST` / `GMT+5:30` — the short name, for captions that say which zone numbers are in. */
export const timezoneAbbreviation = (timeZone: string, at: Instant = new Date()): string => {
    const d = toDate(at) ?? new Date();
    return partsIn(d, timeZone, { timeZoneName: 'short' }).timeZoneName ?? '';
};

/** `Asia/Kolkata · IST · 20:06` — the one-line "which zone are we in" caption. */
export const timezoneCaption = (timeZone: string, at: Instant = new Date()): string => {
    const abbr = timezoneAbbreviation(timeZone, at);
    const clock = formatTime(at, timeZone, '');
    return [timeZone, abbr, clock].filter(Boolean).join(' · ');
};

/** `(GMT+05:30) Asia/Kolkata` — the picker's option label, sortable by offset. */
export const timezoneOptionLabel = (timeZone: string, at: Instant = new Date()): string => {
    const d = toDate(at) ?? new Date();
    const long = partsIn(d, timeZone, { timeZoneName: 'longOffset' }).timeZoneName;
    return long ? `(${long}) ${timeZone}` : timeZone;
};

/** Minutes east of UTC, for sorting a zone list the way people expect to read it. */
export const timezoneOffsetMinutes = (timeZone: string, at: Instant = new Date()): number => {
    const d = toDate(at) ?? new Date();
    const long = partsIn(d, timeZone, { timeZoneName: 'longOffset' }).timeZoneName ?? '';
    const m = /GMT([+-])(\d{2}):(\d{2})/.exec(long);
    if (!m) {return 0;}
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (Number(m[2]) * 60 + Number(m[3]));
};
