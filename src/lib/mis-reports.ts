// THE REPORTS WORKSPACE — its types, its column memory, its sorting, and the
// one selection every export is cut from.
//
// WHAT THIS MODULE IS NOT
// -----------------------
// It does not do money. Not one figure on any of the fifteen reports is computed
// here: Gross → Discount → Net → Tax → Service Charge → Round Off → Grand Total
// is pinned ONCE, server-side, in the backend's `mis_report_math.ts`, and every
// number this file touches has already been through it. The client's job is to
// show those numbers and to hand back exactly what it showed — nothing else.
// A "helpful" client-side subtotal is precisely how two screens end up
// disagreeing about net sales, and these are the documents an auditor reads.
//
// The one arithmetic that IS here is `contentTotal` — a count of visible rows,
// which is a fact about the screen, not about the restaurant.
//
// PURE — no React, no fetch, no `document`, no `window` outside the two storage
// helpers (which degrade to no-ops when it is absent, because Next renders these
// pages on the server first). That is what lets the jest suite in
// `src/lib/__tests__/mis-reports.test.ts` pin the export against fixed data
// instead of driving a browser.
//
// WHY IT IS A PLAIN MODULE AND NOT IN db.ts: db.ts carries "use server" and may
// export ONLY async functions. A `export const MIS_REPORTS = [...]` there is a
// build error that tsc and jest both wave through while every page 500s at
// runtime. `src/lib/table-assignment.ts` set that precedent; this follows it.

import { formatDate, formatDateTime, formatSheetDateTime, wallClockToUtcInZone } from './tz';

// --- The wire shapes ---------------------------------------------------------
// Mirrors of the backend's `MisColumn` / `MisReportMeta` / `MisPage` and the
// fifteen payloads. Kept structural (`MisRow` is an index signature) on purpose:
// the column list is SERVER-DRIVEN, so the grid renders whatever columns the
// backend declares, and adding a column to a report needs no client release.

/** How a value is rendered, totalled and sorted. Straight from the backend. */
export type MisColumnType = 'text' | 'int' | 'money' | 'percent' | 'datetime' | 'date';

export interface MisColumn {
    key: string;
    label: string;
    type: MisColumnType;
    /** True when the backend carries this column in its TOTALS object. */
    total?: boolean;
    /** False for columns that start hidden until the user turns them on. */
    default_on?: boolean;
}

/** The window the SERVER used, with any clamp named. Never the one we asked for. */
export interface MisResolvedWindow {
    from: string;
    to: string;
    days: number;
    source?: string;
    clamped?: boolean;
}

export interface MisReportMeta {
    report: string;
    title: string;
    window: MisResolvedWindow;
    timezone: string;
    outlet_scope: 'outlet' | 'all';
    outlet_id: string | null;
    outlet_name: string | null;
    generated_at: string;
    /** Every caveat that applies to the numbers, in the backend's own words. */
    notes: string[];
}

export interface MisPage {
    limit: number;
    offset: number;
    total: number;
    has_more: boolean;
}

/** A cell as it arrives. `null` is a real value — "not captured" — never 0. */
export type MisCell = string | number | boolean | null | undefined;

/** One row, structurally. The column descriptor says how to read each key. */
export type MisRow = Record<string, unknown>;

/**
 * The envelope all fifteen share. `rows` is named per report (`rows`, `series`,
 * `by_outlet`) — `rowsKey` in the catalogue below says which, exactly as the
 * backend's own `/reports/mis` catalogue does.
 */
export interface MisReportPayload {
    meta: MisReportMeta;
    columns: MisColumn[];
    totals?: Record<string, unknown> | null;
    page?: MisPage;
    [extra: string]: unknown;
}

// --- The catalogue -----------------------------------------------------------

export type MisReportKey =
    | 'item_wise'
    | 'discount'
    | 'void_kot'
    | 'bill_edit'
    | 'sales_summary'
    | 'order_summary'
    | 'executive_summary'
    | 'cover_size_summary'
    | 'settlement_summary'
    | 'nc_summary'
    | 'service_charge_deny'
    | 'group_summary'
    | 'variation_summary'
    | 'tip_summary'
    | 'counter_summary';

/** What a row of this report can be opened as, if anything. */
export type MisDrillKind = 'bill' | 'kot' | 'bill_or_kot' | 'none';

/**
 * WHICH CLOCK A REPORT BUCKETS ON.
 *
 * Three different questions get asked of the same fortnight: what was SETTLED in
 * it, what was ORDERED in it, and when an ACT (a comp, a waiver, a tip) was
 * recorded in it. Two reports over the same dates on different clocks are not
 * expected to reconcile, and a toolbar that says "1–15 Aug" over both without
 * saying which is how a manager concludes the reports disagree.
 *
 * The backend serves this per report at GET /reports/mis (`shell.basis`); these
 * values mirror it and the screen merges the server's over them.
 */
export type MisClock = 'settlement' | 'order_placement' | 'act_time';

/** What the date range means on a report, in the toolbar, in one phrase. */
export const CLOCK_LABELS: Readonly<Record<MisClock, { short: string; long: string }>> = {
    settlement: {
        short: 'by settlement',
        long: 'Dated by when each bill was SETTLED — the clock the sales ladder runs on.',
    },
    order_placement: {
        short: 'by order time',
        long: 'Dated by when the ORDER WAS PLACED, not when the bill settled — so its totals are not expected to match a settlement-clock report over the same days.',
    },
    act_time: {
        short: 'by act time',
        long: 'Dated by when the ACT was recorded — the comp, the waiver, the tender — not by when the bill settled.',
    },
};

export interface MisReportDef {
    key: MisReportKey;
    title: string;
    /** Path on the backend, JSON. `${path}.csv` is the same table as a sheet. */
    path: string;
    /** Which array of the payload is the table. */
    rowsKey: string;
    /** True when the backend pages this report and honours limit/offset. */
    paged: boolean;
    /** True when ?bucket=day|hour changes what comes back. */
    timeWise: boolean;
    /** What the date range means here. Merged from the catalogue's `shell.basis`. */
    clock: MisClock;
    /** What a row opens. `none` means there is no single record behind a row. */
    drill: MisDrillKind;
    /** Row field holding the bill id, when `drill` can open a bill. */
    billIdKey?: string;
    /** Row field holding the order/KOT id, when `drill` can open a ticket. */
    orderIdKey?: string;
    /** One line under the title: what this document is FOR. */
    blurb: string;
}

/**
 * The fifteen, in the order the tab strip shows them: the four control documents
 * an auditor opens first, then the five rollups, then the six the capture
 * migrations (034-039) made possible.
 *
 * The backend serves this same list at GET /reports/mis and that copy is
 * authoritative for `path`/`rowsKey`/`paged` — the screen fetches it and merges.
 * This constant is the FALLBACK, so a catalogue request that fails leaves the
 * owner with fifteen working reports rather than an empty workspace.
 *
 * WHY THE LAST SIX WERE ABSENT UNTIL NOW, said once here because it is the whole
 * story of this release: an empty tab is a promise the numbers cannot keep, and
 * until migrations 034-039 nothing in this system recorded a comp, a void
 * reason, a service-charge waiver, a tip, a till or a menu group. They earned
 * their place when those became things a restaurant can actually do from a
 * screen — which is the other half of this same release.
 */
export const MIS_REPORTS: readonly MisReportDef[] = [
    {
        key: 'item_wise', title: 'Item Wise', path: '/reports/mis/item-wise',
        rowsKey: 'rows', paged: true, timeWise: false, drill: 'none', clock: 'order_placement',
        blurb: 'What sold, how much of it, and what each dish contributed.',
    },
    {
        key: 'discount', title: 'Discount', path: '/reports/mis/discount',
        rowsKey: 'rows', paged: true, timeWise: false, drill: 'bill', billIdKey: 'bill_id',
        clock: 'settlement',
        blurb: 'Every discount given away — who applied it, on what, and why.',
    },
    {
        key: 'void_kot', title: 'Void KOT', path: '/reports/mis/void-kot',
        rowsKey: 'rows', paged: true, timeWise: false, drill: 'kot', orderIdKey: 'order_id',
        clock: 'order_placement',
        blurb: 'Cancelled tickets: what was voided, when, by whom, why and for how much.',
    },
    {
        key: 'bill_edit', title: 'Bill Edit', path: '/reports/mis/bill-edit',
        rowsKey: 'rows', paged: true, timeWise: false, drill: 'bill_or_kot',
        billIdKey: 'bill_id', orderIdKey: 'order_id', clock: 'act_time',
        blurb: 'Changes made to a bill after it was generated, from the audit trail.',
    },
    {
        key: 'sales_summary', title: 'Sales Summary', path: '/reports/mis/sales-summary',
        rowsKey: 'series', paged: false, timeWise: true, drill: 'none', clock: 'settlement',
        blurb: 'The whole ladder — gross to grand total — with bills, covers and ABV.',
    },
    {
        key: 'order_summary', title: 'Order Summary', path: '/reports/mis/order-summary',
        rowsKey: 'rows', paged: true, timeWise: false, drill: 'bill', billIdKey: 'bill_id',
        clock: 'settlement',
        blurb: 'One line per bill: type, table, waiter, money, payment and status.',
    },
    {
        key: 'executive_summary', title: 'Executive Summary', path: '/reports/mis/executive-summary',
        rowsKey: 'by_outlet', paged: false, timeWise: false, drill: 'none', clock: 'settlement',
        blurb: 'The leadership rollup across outlets, against the period before.',
    },
    {
        key: 'cover_size_summary', title: 'Cover Size Summary', path: '/reports/mis/cover-size-summary',
        rowsKey: 'rows', paged: false, timeWise: false, drill: 'none', clock: 'settlement',
        blurb: 'Trade grouped by party size, and what each size spends per head.',
    },
    {
        key: 'settlement_summary', title: 'Settlement Summary', path: '/reports/mis/settlement-summary',
        rowsKey: 'rows', paged: false, timeWise: false, drill: 'none', clock: 'settlement',
        blurb: 'Payment-mode reconciliation — the end-of-day cash-up document.',
    },
    {
        key: 'nc_summary', title: 'NC Summary', path: '/reports/mis/nc-summary',
        rowsKey: 'rows', paged: true, timeWise: false, drill: 'bill_or_kot',
        billIdKey: 'bill_id', orderIdKey: 'order_id', clock: 'act_time',
        blurb: 'Every dish served and not billed — the reason, the loss, and on whose say-so.',
    },
    {
        key: 'service_charge_deny', title: 'Service Charge Deny', path: '/reports/mis/service-charge-deny',
        rowsKey: 'rows', paged: true, timeWise: false, drill: 'bill', billIdKey: 'bill_id',
        clock: 'act_time',
        blurb: 'Bills whose service charge was taken off, what it cost, and who approved it.',
    },
    {
        key: 'group_summary', title: 'Group Summary', path: '/reports/mis/group-summary',
        rowsKey: 'rows', paged: false, timeWise: false, drill: 'none', clock: 'order_placement',
        blurb: 'Sales cut by revenue group — Food, Beverage, Liquor — with the gaps named.',
    },
    {
        key: 'variation_summary', title: 'Variation Summary', path: '/reports/mis/variation-summary',
        rowsKey: 'rows', paged: false, timeWise: false, drill: 'none', clock: 'order_placement',
        blurb: 'How each dish’s sales split across its sizes — is anybody buying the large one.',
    },
    {
        key: 'tip_summary', title: 'Tip Summary', path: '/reports/mis/tip-summary',
        rowsKey: 'rows', paged: true, timeWise: false, drill: 'bill', billIdKey: 'bill_id',
        clock: 'act_time',
        blurb: 'What was tipped, in what form, and who is owed it. Never revenue.',
    },
    {
        key: 'counter_summary', title: 'Counter Summary', path: '/reports/mis/counter-summary',
        rowsKey: 'rows', paged: false, timeWise: false, drill: 'none', clock: 'settlement',
        blurb: 'The same takings, cut by the till that rang them — the cash-up document.',
    },
] as const;

export const reportDef = (key: string): MisReportDef | undefined =>
    MIS_REPORTS.find((r) => r.key === key);

/**
 * The clock a report runs on, taken from the CATALOGUE's `shell.basis` map when
 * the server sent one.
 *
 * `shell.basis` is `{ settlement: [...keys], order_placement: [...], act_time: [...] }`
 * — the server's own statement of which question each report answers. Reading it
 * rather than trusting the local constant means a report whose basis the backend
 * changes relabels itself without a client release, which matters because the
 * label is the thing that stops two reports over the same dates being read as
 * disagreeing. Returns null when the map does not name this report, so the
 * caller keeps its own value instead of defaulting to the commonest clock and
 * mislabelling the one report that is different.
 */
export const clockFromBasis = (basis: unknown, key: string): MisClock | null => {
    if (basis === null || typeof basis !== 'object') {return null;}
    const map = basis as Record<string, unknown>;
    for (const clock of ['settlement', 'order_placement', 'act_time'] as const) {
        const list = map[clock];
        if (Array.isArray(list) && list.includes(key)) {return clock;}
    }
    return null;
};

/** The table out of a payload, whatever the report calls its array. */
export const rowsOf = (payload: MisReportPayload | null, def: MisReportDef): MisRow[] => {
    const raw = payload ? payload[def.rowsKey] : null;
    return Array.isArray(raw) ? (raw as MisRow[]) : [];
};

// --- Column configuration ----------------------------------------------------
// PER USER PER REPORT, in localStorage — not sessionStorage. A window is a
// question you ask this afternoon (the date range is rightly session-scoped);
// a column layout is how you like to read, and being handed back the default
// eighteen columns every morning is a chore, not a fresh start.

/** Which columns this user turned off on this report. Order stays server-driven. */
export interface ColumnPrefs {
    hidden: string[];
}

const COLUMN_PREFS_PREFIX = 'rd-report-columns';

/**
 * Storage key. Scoped by USER as well as report because a shared terminal is
 * normal in a restaurant — the manager's column layout must not follow the
 * cashier who signs in after them.
 */
export const columnPrefsKey = (userId: string, reportKey: string): string =>
    `${COLUMN_PREFS_PREFIX}:${userId || 'anon'}:${reportKey}`;

/** The layout the backend proposes: everything except its `default_on: false`. */
export const defaultHidden = (columns: readonly MisColumn[]): string[] =>
    columns.filter((c) => c.default_on === false).map((c) => c.key);

export const loadColumnPrefs = (userId: string, reportKey: string): ColumnPrefs | null => {
    if (typeof window === 'undefined') {return null;}
    try {
        const raw = window.localStorage.getItem(columnPrefsKey(userId, reportKey));
        if (!raw) {return null;}
        const parsed = JSON.parse(raw) as Partial<ColumnPrefs>;
        if (!Array.isArray(parsed.hidden)) {return null;}
        return { hidden: parsed.hidden.filter((k): k is string => typeof k === 'string') };
    } catch {
        // Private mode, cleared storage, or a value from an older build. The
        // backend's own default layout is a perfectly good answer.
        return null;
    }
};

export const saveColumnPrefs = (userId: string, reportKey: string, prefs: ColumnPrefs): void => {
    if (typeof window === 'undefined') {return;}
    try {
        window.localStorage.setItem(columnPrefsKey(userId, reportKey), JSON.stringify(prefs));
    } catch {/* quota or private mode — the in-memory state still holds this session */}
};

export const clearColumnPrefs = (userId: string, reportKey: string): void => {
    if (typeof window === 'undefined') {return;}
    try {
        window.localStorage.removeItem(columnPrefsKey(userId, reportKey));
    } catch {/* nothing to do — the caller resets its state either way */}
};

/**
 * The columns actually on screen, in the backend's declared order.
 *
 * A stored key that no longer exists is ignored rather than dropped from
 * storage, so a column hidden today reappears hidden after a backend release
 * that briefly renamed it — and NEVER hides a column the backend has just added,
 * because unknown keys are only ever consulted, never inferred.
 */
export const visibleColumns = (columns: readonly MisColumn[], hidden: readonly string[]): MisColumn[] => {
    const off = new Set(hidden);
    const shown = columns.filter((c) => !off.has(c.key));
    // Never render a headerless grid: if a user (or a stale pref) hides
    // everything, fall back to the backend's layout rather than a blank page.
    return shown.length > 0 ? shown : columns.filter((c) => c.default_on !== false);
};

// --- Sorting -----------------------------------------------------------------
// CLIENT-SIDE, and only ever within the rows already on screen. On a paged
// report that means it sorts THIS PAGE, which the grid says out loud — sorting a
// page and calling it "the top items" would be a lie an auditor could act on.

export type SortDir = 'asc' | 'desc';
export interface SortState {
    key: string;
    dir: SortDir;
}

const isNumericType = (type: MisColumnType): boolean =>
    type === 'int' || type === 'money' || type === 'percent';

/**
 * Order two cells of a known column type.
 *
 * NULLS SORT LAST IN BOTH DIRECTIONS. A null here means "not captured" (no void
 * reason, no resolvable seating, a KOT number this schema cannot recover) — it
 * is not a small number and not an empty string, and floating those to the top
 * of a descending sort would bury the rows the reader came for.
 */
export const compareCells = (a: unknown, b: unknown, type: MisColumnType, dir: SortDir): number => {
    const aNull = a === null || a === undefined || a === '';
    const bNull = b === null || b === undefined || b === '';
    if (aNull && bNull) {return 0;}
    if (aNull) {return 1;}
    if (bNull) {return -1;}

    let cmp: number;
    if (isNumericType(type)) {
        const an = Number(a);
        const bn = Number(b);
        // A non-numeric value in a numeric column is data we do not understand;
        // treat it as null-like rather than letting NaN poison the comparator.
        if (Number.isNaN(an) && Number.isNaN(bn)) {return 0;}
        if (Number.isNaN(an)) {return 1;}
        if (Number.isNaN(bn)) {return -1;}
        cmp = an - bn;
    } else if (type === 'datetime' || type === 'date') {
        // ISO instants and `YYYY-MM-DD` day keys both sort correctly as strings,
        // and doing it lexically avoids re-anchoring every cell to a zone just
        // to order it.
        cmp = String(a).localeCompare(String(b));
    } else {
        cmp = String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
    }
    return dir === 'asc' ? cmp : -cmp;
};

/** A stable sort of `rows` by one column. Returns a new array; never mutates. */
export const sortRows = (
    rows: readonly MisRow[],
    sort: SortState | null,
    columns: readonly MisColumn[],
): MisRow[] => {
    if (!sort) {return [...rows];}
    const col = columns.find((c) => c.key === sort.key);
    if (!col) {return [...rows];}
    // Index-carrying decorate/sort/undecorate: Array#sort is only guaranteed
    // stable per spec in modern engines, and a report whose equal rows shuffle
    // between renders looks like the data changed.
    return rows
        .map((row, index) => ({ row, index }))
        .sort((x, y) => compareCells(x.row[col.key], y.row[col.key], col.type, sort.dir) || x.index - y.index)
        .map((entry) => entry.row);
};

/** Click a header: same column flips direction, a new column opens descending. */
export const nextSort = (current: SortState | null, key: string, type: MisColumnType): SortState => {
    if (current?.key === key) {return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };}
    // Money and counts are read biggest-first; names and dates read forwards.
    return { key, dir: isNumericType(type) ? 'desc' : 'asc' };
};

// --- Formatting --------------------------------------------------------------

export interface FormatOptions {
    timezone: string;
    currencySymbol: string;
}

/** The house money format: `₹1,23,456.78`. Two decimals — paise reconcile. */
export const formatMoney = (value: unknown, currencySymbol: string): string => {
    const n = Number(value);
    if (value === null || value === undefined || value === '' || Number.isNaN(n)) {return '—';}
    const sign = n < 0 ? '-' : '';
    return `${sign}${currencySymbol}${Math.abs(n).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
};

export const formatInt = (value: unknown): string => {
    const n = Number(value);
    if (value === null || value === undefined || value === '' || Number.isNaN(n)) {return '—';}
    return n.toLocaleString('en-IN');
};

/**
 * A percent, already a percentage on the wire (the backend sends 12.5 for
 * 12.5%). Signed, because a growth column reading "8.2" when trade FELL would
 * be the single most expensive misread on the Executive Summary.
 */
export const formatPercent = (value: unknown, { signed = false } = {}): string => {
    const n = Number(value);
    if (value === null || value === undefined || value === '' || Number.isNaN(n)) {return '—';}
    const sign = signed && n > 0 ? '+' : '';
    return `${sign}${n.toFixed(1)}%`;
};

/**
 * One cell, as the reader sees it.
 *
 * `—` for null throughout, and that em-dash is load-bearing: these reports show
 * blanks where the schema genuinely holds nothing (a void has no authorizer, a
 * KOT number cannot be recovered), and rendering those as `0` or an empty cell
 * would read as a captured zero instead of an honest gap.
 */
export const formatCell = (value: unknown, type: MisColumnType, opts: FormatOptions): string => {
    if (value === null || value === undefined || value === '') {return '—';}
    switch (type) {
        case 'money':
            return formatMoney(value, opts.currencySymbol);
        case 'int':
            return formatInt(value);
        case 'percent':
            return formatPercent(value);
        case 'datetime':
            return formatDateTime(String(value), opts.timezone);
        case 'date':
            return formatDate(String(value), opts.timezone);
        default:
            return String(value);
    }
};

// --- The export selection ----------------------------------------------------
//
// ONE selection, THREE files. CSV, Excel and PDF are all cut from
// `buildExportMatrix` below, which takes the rows the grid is rendering — after
// the current window, outlet and search, in the current sort order, with the
// current columns — and nothing else. NOT after paging: an export is of the
// whole filtered range, because a report someone files with an auditor that
// silently stopped at page 1 is worse than no export. There is no second query
// and no
// server-side re-derivation, so an export cannot quietly disagree with the
// screen it came from. That disagreement is a support ticket at best and, on a
// document someone files with an auditor, considerably worse.

export type ExportCell = string | number | null;

export interface ExportMatrix {
    /** Column headers, in the order shown. */
    header: string[];
    /** Body rows — numbers stay numbers so a spreadsheet can sum them. */
    body: ExportCell[][];
    /** The TOTALS row, or null when the report totals nothing. */
    totals: ExportCell[] | null;
    /** The column descriptors backing each position, for display formatting. */
    columns: MisColumn[];
    /**
     * The restaurant zone every `datetime` cell in `body` was already written in
     * (as formatSheetDateTime's `2026-09-14 18:36`), or null when those cells are
     * still the server's raw instants.
     */
    timezone: string | null;
}

const rawCell = (value: unknown, type: MisColumnType, timezone: string | null): ExportCell => {
    if (value === null || value === undefined || value === '') {return null;}
    if (isNumericType(type)) {
        const n = Number(value);
        // Keep it NUMERIC for the spreadsheet — a money column exported as
        // "₹1,234.00" is a string Excel cannot add, which is the first thing an
        // accountant tries to do with it.
        return Number.isNaN(n) ? String(value) : n;
    }
    // AN INSTANT IS WRITTEN AS THE RESTAURANT'S WALL CLOCK, YEAR FIRST. The
    // server sends UTC ISO text, and a sheet that carries it verbatim puts a
    // 18:36 void at "2026-09-14T13:06:36.104Z", which reads as 1 pm to anyone
    // who opens it. Not the grid's "14/09/26 18:36" either: see
    // formatSheetDateTime for why a file needs "2026-09-14 18:36". A value that
    // is not an instant is kept as it came rather than blanked, so a malformed
    // stamp is still visible in the file.
    if (type === 'datetime' && timezone) {return formatSheetDateTime(String(value), timezone, String(value));}
    return String(value);
};

/**
 * Turn what is on screen into a matrix.
 *
 * `totalsLabel` goes in the first cell. On a PAGED report the totals come from
 * the whole window while the body is one page, so the caller passes a label that
 * says so — an export whose rows do not add up to its own total, with nothing
 * explaining why, is exactly the document that destroys confidence in the other
 * eight.
 *
 * `timezone` is the zone the grid formats in. With it, every `datetime` cell is
 * written as that zone's wall clock, `2026-09-14 18:36`, the same string the
 * owner app writes, and the PDF shows the grid's own `14/09/26 18:36`. Without
 * it those cells stay raw instants.
 */
export const buildExportMatrix = (
    columns: readonly MisColumn[],
    rows: readonly MisRow[],
    totals: Record<string, unknown> | null | undefined,
    totalsLabel = 'Total',
    timezone?: string,
): ExportMatrix => {
    const cols = [...columns];
    const zone = timezone ?? null;
    const header = cols.map((c) => c.label);
    const body = rows.map((row) => cols.map((c) => rawCell(row[c.key], c.type, zone)));

    let totalsRow: ExportCell[] | null = null;
    if (totals) {
        const anyTotalled = cols.some((c) => c.total && totals[c.key] !== undefined);
        if (anyTotalled) {
            totalsRow = cols.map((c, i) => {
                if (c.total && totals[c.key] !== undefined) {return rawCell(totals[c.key], c.type, zone);}
                // The label rides in the first column, which is always the
                // report's identifying column (item, bill no., period, outlet).
                return i === 0 ? totalsLabel : null;
            });
        }
    }
    return { header, body, totals: totalsRow, columns: cols, timezone: zone };
};

/** The same matrix, every cell rendered as the reader sees it — for PDF. */
export const formatMatrix = (matrix: ExportMatrix, opts: FormatOptions): string[][] => {
    const render = (row: ExportCell[]): string[] =>
        row.map((cell, i) => {
            if (cell === null) {return '';}
            // Every row is built column-by-column from `matrix.columns`, so a
            // missing descriptor cannot happen; if it ever did, showing the raw
            // value beats throwing away the reader's document.
            const col = matrix.columns[i] as MisColumn | undefined;
            // Already the restaurant's wall clock, written for a sheet. The PDF
            // shows the grid's format, so the wall clock is read back IN THE
            // RESTAURANT ZONE and formatted the way the grid formats it. Handing
            // the text to `new Date` instead would read it in the viewer's
            // browser zone. A stamp that was kept as it came stays as it came.
            if (col?.type === 'datetime' && matrix.timezone) {
                const at = wallClockToUtcInZone(String(cell), matrix.timezone);
                return at ? formatDateTime(at, matrix.timezone) : String(cell);
            }
            return col ? formatCell(cell, col.type, opts) : String(cell);
        });
    const out = matrix.body.map(render);
    if (matrix.totals) {out.push(render(matrix.totals));}
    return [matrix.header, ...out];
};

/**
 * RFC 4180 CSV.
 *
 * Quoted whenever the value carries a comma, a quote, a newline or leading /
 * trailing space, with `"` doubled. A leading `=`, `+`, `-` or `@` is prefixed
 * with a tab: those are FORMULA INJECTION in Excel and Sheets, and a restaurant
 * that lets guests type a name or a discount reason has an untrusted string
 * heading straight into a finance workbook. The tab keeps the text readable and
 * makes the cell inert.
 */
export const csvEscape = (value: ExportCell | undefined): string => {
    if (value === null || value === undefined) {return '';}
    // A non-finite number (NaN, Infinity) is written as EMPTY, not as the word
    // "NaN": a money column reading NaN in a filed sheet is worse than a gap,
    // because it silently poisons any SUM over the column.
    if (typeof value === 'number') {return Number.isFinite(value) ? String(value) : '';}
    let s = value;
    if (/^[=+\-@\t\r]/.test(s)) {s = `\t${s}`;}
    if (/[",\r\n]/.test(s) || s !== s.trim()) {return `"${s.replace(/"/g, '""')}"`;}
    return s;
};

/**
 * The CSV text. CRLF line endings and a UTF-8 BOM, because the overwhelmingly
 * likely first thing that happens to this file is a double-click into Excel on
 * Windows — which renders `₹` as mojibake without the BOM.
 */
export const toCsv = (matrix: ExportMatrix): string => {
    const lines = [matrix.header.map((h) => csvEscape(h)).join(',')];
    for (const row of matrix.body) {lines.push(row.map((c) => csvEscape(c)).join(','));}
    if (matrix.totals) {lines.push(matrix.totals.map((c) => csvEscape(c)).join(','));}
    return `﻿${lines.join('\r\n')}\r\n`;
};

/**
 * THE WIDTH OF EACH SPREADSHEET COLUMN, in characters: its widest cell plus two,
 * never under 10.
 *
 * WHY THERE IS NO SMALLER CAP. Excel lets text spill into the next cell only when
 * that cell is empty, and every report has a filled column to the right of its
 * text. The Void KOT Items cell ("HARA DHANIYA PULAO x1; SUBZ TEHRI x1; …") sat
 * in a column capped at 42 beside a Type cell that is never blank, so a ticket
 * with three dishes opened cut off mid-name. The dashboard's spreadsheet library
 * (the SheetJS community build) cannot write wrap-text, so the only way a long
 * cell reads whole when the file opens is a column as wide as it. The ceiling is
 * Excel's own: it refuses a column wider than 255 characters, and 250 leaves
 * room for the padding the writer adds on top.
 *
 * The owner app sizes its sheet by the same rule (misSheetColumnWidths), so a
 * file from either client opens the same.
 */
export const SHEET_MIN_WIDTH = 10;
export const SHEET_MAX_WIDTH = 250;

export const sheetColumnWidths = (matrix: ExportMatrix): number[] => {
    const rows: readonly (readonly ExportCell[])[] = [matrix.header, ...matrix.body, ...(matrix.totals ? [matrix.totals] : [])];
    return matrix.header.map((_, i) => {
        const widest = rows.reduce((w, row) => Math.max(w, String(row[i] ?? '').length), 0);
        return Math.min(Math.max(widest + 2, SHEET_MIN_WIDTH), SHEET_MAX_WIDTH);
    });
};

/** `order-summary_gaia-test_2026-08-01_to_2026-08-31` — no extension. */
export const exportBaseName = (meta: MisReportMeta | null, def: MisReportDef): string => {
    const scope = !meta
        ? 'outlet'
        : meta.outlet_scope === 'all'
            ? 'all-outlets'
            : (meta.outlet_name ?? 'outlet');
    const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'report';
    const from = meta?.window.from ?? '';
    const to = meta?.window.to ?? '';
    return `${safe(def.key.replace(/_/g, '-'))}_${safe(scope)}_${from}_to_${to}`;
};

// --- Small screen-level facts ------------------------------------------------

/**
 * What the TOTALS row is a total OF.
 *
 * On a paged report the backend totals the WHOLE WINDOW while the grid shows one
 * page; saying "Total" over both would invite the reader to add up the visible
 * rows, find a different number, and stop trusting the report. So the label
 * names its scope whenever the two differ.
 */
export const totalsLabelFor = (page: MisPage | undefined, shown: number): string => {
    if (!page) {return 'Total';}
    if (page.total > shown) {return `Total · all ${page.total.toLocaleString('en-IN')} rows in range`;}
    return 'Total';
};

/** `Showing 1–100 of 2,431`. Empty string when there is nothing to page. */
export const pageCaption = (page: MisPage | undefined, shown: number): string => {
    if (!page || page.total === 0) {return '';}
    const first = page.offset + 1;
    const last = page.offset + shown;
    return `Showing ${first.toLocaleString('en-IN')}–${last.toLocaleString('en-IN')} of ${page.total.toLocaleString('en-IN')}`;
};

/** The id a row drills into, and what kind of record it is. Null when neither. */
export const drillTarget = (
    row: MisRow,
    def: MisReportDef,
): { kind: 'bill' | 'kot'; id: string } | null => {
    if (def.drill === 'none') {return null;}
    const read = (key?: string): string | null => {
        if (!key) {return null;}
        const v = row[key];
        if (v === null || v === undefined) {return null;}
        const s = String(v).trim();
        return s.length > 0 && s !== 'null' ? s : null;
    };
    const billId = read(def.billIdKey);
    const orderId = read(def.orderIdKey);
    if (def.drill === 'bill') {return billId ? { kind: 'bill', id: billId } : null;}
    if (def.drill === 'kot') {return orderId ? { kind: 'kot', id: orderId } : null;}
    // bill_or_kot — a Bill Edit row names whichever record the change touched,
    // and the bill is the more useful of the two when it names both.
    if (billId) {return { kind: 'bill', id: billId };}
    return orderId ? { kind: 'kot', id: orderId } : null;
};
