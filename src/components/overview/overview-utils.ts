// Pure shaping helpers the Overview shares between the page, the headline box
// and the drill sheets — the web copies of the small readers at the top of the
// Flutter modules.dart and lib/models/next_party.dart.

import { timezoneOffsetMinutes } from '@/lib/tz';

/** `_numOf`: a number off any JSON value; 0 for junk (an object is junk). */
export const numOf = (v: unknown): number => {
    if (typeof v === 'number') { return Number.isFinite(v) ? v : 0; }
    if (typeof v === 'string') {
        const n = Number(v.trim());
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
};

/** `_int`: whole-number JSON field; null when absent/unparseable — null ≠ 0. */
export const intOf = (v: unknown): number | null => {
    if (typeof v === 'number') { return Number.isFinite(v) ? Math.round(v) : null; }
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v.trim());
        return Number.isFinite(n) ? Math.round(n) : null;
    }
    return null;
};

/** `_s`: string field with an em-dash fallback ('[object Object]' is not a value). */
export const strOf = (row: Record<string, unknown> | null | undefined, key: string, fallback = '—'): string => {
    const v = row?.[key];
    const s = typeof v === 'string'
        ? v
        : typeof v === 'number' && Number.isFinite(v)
            ? String(v)
            : typeof v === 'boolean'
                ? (v ? 'true' : 'false')
                : '';
    return s.length === 0 ? fallback : s;
};

/**
 * `_money`: an em dash for a value the server omitted — a figure that never
 * arrived must not read as zero takings. Bind the restaurant's symbol once.
 */
export const moneyOf = (symbol: string) => (v: unknown): string => {
    let n: number;
    if (typeof v === 'number') {
        n = v;
    } else if (typeof v === 'string' && v.trim() !== '') {
        n = Number(v.trim());
    } else {
        return '—';
    }
    if (!Number.isFinite(n)) { return '—'; }
    return `${symbol}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/** `_score`: 2dp ratings read "4.8", whole scores stay clean ("5", not "5.0"). */
export const scoreOf = (v: unknown): string => {
    if (v == null || (typeof v === 'string' && v.trim() === '')) { return '-'; }
    const d = numOf(v);
    return d === Math.round(d) ? d.toFixed(0) : d.toFixed(1);
};

/** Kitchen prep time: "2m 30s", or an em dash when nothing was timed. */
export const msLabel = (v: unknown): string => {
    const total = Math.round(numOf(v) / 1000);
    if (total <= 0) { return '—'; }
    return `${Math.floor(total / 60)}m ${total % 60}s`;
};

/** The per-table ordering OTP as it should be SHOWN — '' when it must not be. */
export const tableOtp = (table: Record<string, unknown>): string =>
    table.otp_required === false ? '' : strOf(table, 'order_otp', '');

// --- next-party seats (client item 6) ----------------------------------------

const rowStr = (row: Record<string, unknown> | null | undefined, key: string): string => {
    const v = row?.[key];
    if (typeof v === 'string') { return v.trim(); }
    if (typeof v === 'number' && Number.isFinite(v)) { return String(v); }
    return '';
};

/** The root's name when this /get-tables row is a next-party seat, else null. */
export const parentTableOf = (row: Record<string, unknown> | null | undefined): string | null => {
    const p = rowStr(row, 'parent_table');
    return p.length === 0 ? null : p;
};

/** Is this row the next party's seat at another table? */
export const isNextPartyRow = (row: Record<string, unknown> | null | undefined): boolean =>
    parentTableOf(row) != null;

/**
 * How many of the ROOM's tables are in use, where a table is in use when it,
 * or the next party's seat beside it, is `busy`. The room is every row that is
 * not a next-party seat — a printed table with an alias counts as ONE room,
 * occupied while either has a party (Flutter countRoomsInUse, verbatim).
 */
export const countRoomsInUse = (
    rows: Record<string, unknown>[],
    busy: (row: Record<string, unknown>) => boolean,
): { inUse: number; rooms: number } => {
    const busyNumbers = new Set<string>();
    for (const r of rows) {
        if (busy(r)) {
            busyNumbers.add((parentTableOf(r) ?? rowStr(r, 'table_name')).toLowerCase());
        }
    }
    const rooms = rows.filter((r) => !isNextPartyRow(r));
    return {
        inUse: rooms.filter((r) => busyNumbers.has(rowStr(r, 'table_name').toLowerCase())).length,
        rooms: rooms.length,
    };
};

// --- timestamps ---------------------------------------------------------------

const two = (n: number): string => String(n).padStart(2, '0');

/**
 * `26/06/26 · 14:05` — reservations and other dense rows, rendered in the
 * RESTAURANT's zone (RestaurantTime.dmy).
 */
export const fmtDmy = (iso: string, timezone: string): string => {
    if (!iso) { return ''; }
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) { return iso; }
    try {
        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: timezone,
            year: '2-digit', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false,
        }).formatToParts(d);
        const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
        return `${get('day')}/${get('month')}/${get('year')} · ${get('hour')}:${get('minute')}`;
    } catch {
        return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${two(d.getFullYear() % 100)} · ${two(d.getHours())}:${two(d.getMinutes())}`;
    }
};

/**
 * `UTC+05:30` — the restaurant zone's offset (RestaurantTime.offsetLabelOf),
 * or '' for a zone this browser cannot render, in which case the caption
 * prints the zone alone rather than a wrong offset.
 */
export const zoneOffsetLabel = (zone: string): string => {
    try {
        const off = timezoneOffsetMinutes(zone);
        const sign = off < 0 ? '-' : '+';
        const abs = Math.abs(off);
        return `UTC${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}`;
    } catch {
        return '';
    }
};

/** A role as a person should read it: built-ins as-is, a custom role's uuid by kind. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const roleLabels = (roles: Iterable<string>): string =>
    [...roles]
        .map((r) => (UUID_RE.test(r.trim()) ? 'Custom role' : r.trim()))
        .filter((s) => s.length > 0)
        .join(', ');
