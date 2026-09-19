// Shared value formatting for the Analytics module — direct ports of the
// Flutter helpers so every rendered cell (and therefore every CSV cell, which
// carries values exactly as rendered) reads byte-identically.

/** `_dnum` / `num0`: tolerant numeric read — null/junk is 0. */
export const num0 = (v: unknown): number => {
    if (typeof v === 'number') { return Number.isFinite(v) ? v : 0; }
    const n = Number(typeof v === 'string' ? v : '');
    return Number.isFinite(n) ? n : 0;
};

/** `_s`: tolerant string read with a fallback for null/empty. */
export const str = (v: unknown, fallback = ''): string => {
    if (v == null) { return fallback; }
    const s = typeof v === 'string' ? v
        : (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') ? String(v)
        : '';
    return s === '' ? fallback : s;
};

/** `_fmtDur`: "3m 20s" (seconds zero-padded) or "46s". */
export const fmtDur = (ms: number): string => {
    const s = Math.floor(Math.max(0, ms) / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${String(sec).padStart(2, '0')}s` : `${sec}s`;
};

/** `hrs`: hours with one decimal — the one attendance number that is not whole. */
export const hrs = (v: number): string => `${v.toFixed(1)}h`;

/** `_fmtNum`: whole numbers plain, fractions to one decimal (drill default). */
export const fmtNum = (v: number): string =>
    v === Math.round(v) ? v.toFixed(0) : v.toFixed(1);

/**
 * `_money`: the two-decimal rupee form ("₹464.44"), em-dash when unparseable.
 * The symbol comes from `useCurrency` (₹ unless the owner changed it).
 */
export const money2 = (symbol: string, v: unknown): string => {
    const n = typeof v === 'number' ? v : Number(typeof v === 'string' && v !== '' ? v : NaN);
    return Number.isFinite(n) ? `${symbol}${n.toFixed(2)}` : '—';
};

/** The body-local `money`: whole rupees ("₹32,975" is Flutter's `₹32975`). */
export const money0 = (symbol: string, v: number): string => `${symbol}${v.toFixed(0)}`;

/** `ddmm`: "2026-09-06" → "06/09" for the 14-day axis. */
export const ddmm = (iso: string): string => {
    const pcs = iso.split('-');
    return pcs.length === 3 ? `${pcs[2]}/${pcs[1]}` : iso;
};

/** `ym`: "2026-09" → "09/26" for the monthly axes. */
export const ym = (mo: string): string => {
    const pcs = mo.split('-');
    if (pcs.length !== 2) { return mo; }
    const y = pcs[0].length >= 4 ? pcs[0].slice(2) : pcs[0];
    return `${pcs[1]}/${y}`;
};

/** One (label, value) reading — the shape every chart and drill series uses. */
export interface SeriesPoint { label: string; value: number }

/** `ranked`: positive readings only, biggest first. */
export const ranked = (points: SeriesPoint[]): SeriesPoint[] =>
    points.filter((d) => d.value > 0).sort((a, b) => b.value - a.value);

/**
 * Whole calendar months a range touches (services/date_range.dart
 * `monthsSpanned`): floored at 3 because a single point is not a trend,
 * capped at 24, the trend endpoint's own ceiling.
 */
export const monthsSpanned = (range: { from: string; to: string }, min = 3, max = 24): number => {
    const f = range.from.split('-').map(Number);
    const t = range.to.split('-').map(Number);
    if (!f[0] || !t[0]) { return 12; }
    const n = (t[0] - f[0]) * 12 + (t[1] - f[1]) + 1;
    return n < min ? min : (n > max ? max : n);
};
