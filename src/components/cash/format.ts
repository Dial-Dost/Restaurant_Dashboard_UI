// Pure helpers for the Cash module — web copies of the small helpers the
// Flutter `_CashView` leans on (`_money` modules.dart:141, `_fmtTime`
// modules.dart:224 / RestaurantTime.short, `_d`, and the denomination list
// with its tally arithmetic, modules.dart ~26183).

/** Flutter `_money`: `₹1234.56`, or "—" when null/unparseable. */
export const moneyOf = (symbol: string, v: unknown): string => {
    const n =
        typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.trim()) : NaN;
    return Number.isFinite(n) ? `${symbol}${n.toFixed(2)}` : '—';
};

/**
 * Flutter `_d` (`double.tryParse(s.trim()) ?? 0`): a typed amount — parse, or
 * 0. Empty means zero, and partial junk ("12abc") is junk, not 12.
 */
export const amountOf = (s: string): number => {
    const t = s.trim();
    if (t === '') { return 0; }
    const n = Number(t);
    return Number.isFinite(n) ? n : 0;
};

/** Loose number off the wire (`num.tryParse('${v ?? 0}') ?? 0`). */
export const numOf = (v: unknown): number => {
    if (typeof v === 'number') { return Number.isFinite(v) ? v : 0; }
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v.trim());
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
};

/** "Jun 26, 14:05" in the restaurant's zone (Flutter `RestaurantTime.short`). */
export const shortTime = (iso: string | null | undefined, timezone: string): string => {
    if (iso == null || iso === '') { return ''; }
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) { return iso; }
    try {
        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: timezone,
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).formatToParts(d);
        const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
        return `${get('month')} ${get('day')}, ${get('hour')}:${get('minute')}`;
    } catch {
        return iso;
    }
};

/* ── The denomination tally (COUNT THE DRAWER) ─────────────────────────── */

/**
 * Indian denominations, notes then coins, biggest first — copied from
 * modules.dart `_denominations`. ₹2000 is still legal tender, so a drawer can
 * genuinely hold one; ₹20 and ₹10 exist as BOTH a note and a coin, which is
 * why this is a list of (value, isCoin) rather than a map keyed by value.
 * The set is inherently ₹ (cash.md, notes) — it does not follow the currency
 * setting.
 */
export const DENOMINATIONS: readonly { value: number; coin: boolean }[] = [
    { value: 2000, coin: false },
    { value: 500, coin: false },
    { value: 200, coin: false },
    { value: 100, coin: false },
    { value: 50, coin: false },
    { value: 20, coin: false },
    { value: 10, coin: false },
    { value: 20, coin: true },
    { value: 10, coin: true },
    { value: 5, coin: true },
    { value: 2, coin: true },
    { value: 1, coin: true },
];

/** One count field's parsed value (`int.tryParse` — digits-only; junk reads 0). */
export const denomCountOf = (counts: readonly string[], i: number): number => {
    const t = (counts[i] ?? '').trim();
    if (!/^\d+$/.test(t)) { return 0; }
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? n : 0;
};

/** What the counts add up to — the figure that goes into `counted_cash`. */
export const denomTotal = (counts: readonly string[]): number => {
    let total = 0;
    for (let i = 0; i < DENOMINATIONS.length; i++) {
        const n = denomCountOf(counts, i);
        if (n > 0) { total += n * DENOMINATIONS[i].value; }
    }
    return total;
};

/** Whether at least one count is entered (the tally is "in charge"). */
export const denomEntered = (counts: readonly string[]): boolean => {
    for (let i = 0; i < DENOMINATIONS.length; i++) {
        if (denomCountOf(counts, i) > 0) { return true; }
    }
    return false;
};

/** A fresh, empty tally — one slot per denomination. */
export const emptyDenomCounts = (): string[] => DENOMINATIONS.map(() => '');
