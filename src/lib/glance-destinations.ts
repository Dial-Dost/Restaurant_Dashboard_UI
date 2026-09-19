// TODAY AT A GLANCE — WHERE EVERY ELEMENT OF THE OVERVIEW'S HEADLINE BOX LEADS.
//
// Client item 10: "The entire 'Today at a glance' section needs to be made
// clickable; each option in it must be clickable."
//
// Each element opens an explanation built from the payload the Overview already
// holds, footed by a "View in <Module>" jump pinned to the server's day; a pure
// count jumps straight there. The destination is the SERVER's answer when it
// sent one (`drill` on each figure, the `drills` block for everything else —
// Restaurant_Backend/glance_drill.ts), and this file's mirror of the same table
// when it did not (a backend older than item 10). The Flutter app carries the
// same mirror in lib/models/glance_drill.dart, and THE SHEET COPY LIVES HERE
// word for word with that file, so an owner reading the till and the browser
// reads the same sentences.
//
// NOTHING HERE FETCHES OR WRITES. A jump is local navigation plus session
// memory (the destination's reporting window), exactly the Flutter
// `_primeGlanceJump`: Reports/Accounting parse `?report=`/`?from=&to=` off the
// URL already, History and Analytics read only their per-screen stored window,
// so `primeGlanceTarget` seeds that storage before the router moves.
//
// PURE apart from `primeGlanceTarget` (sessionStorage via date-range.ts).

import {
    isDayKey,
    normalizeRange,
    resolvePreset,
    saveRange,
    startOfMonth,
    type DateRange,
} from './date-range';
import { todayInZone } from './tz';

/** How a destination's window is cut. */
export type GlanceWindow = 'day' | 'month' | 'none';

/**
 * The query a jump carries. ONLY the parameters the web dashboard actually
 * parses may appear: an invented one would look like a working filter and be
 * silently ignored.
 */
export interface GlanceParams {
    report?: string;
    from?: string;
    to?: string;
    slot?: 'all';
    method?: string;
}

/** One destination, fully resolved. */
export interface GlanceTarget {
    /** The shell's module label, verbatim. */
    module: string;
    params: GlanceParams;
    /** Web path, query and (for the bill list) anchor included. */
    href: string;
    /** True when the destination should scroll to its settled-bill list. */
    bills?: boolean;
}

/** What one element leads to. */
export interface GlanceDrill extends GlanceTarget {
    /** Tried in order when the primary's module is not open to this user. */
    fallbacks: GlanceTarget[];
    /**
     * A second destination with a different question behind it — the drawer
     * behind Cash collection, a mode's own bills behind its row.
     */
    secondary?: GlanceTarget;
}

/** The query parameters the web dashboard parses on the pages drills reach. */
export const GLANCE_WEB_PARAMS = ['report', 'from', 'to', 'slot', 'method'] as const;

/**
 * Every module a drill may name, spelled as the shell registers it, with the
 * web page it maps to — the backend's GLANCE_APP_MODULES, mirrored.
 */
export const GLANCE_APP_MODULES: Readonly<Record<string, string>> = {
    Reports: '/dashboard/reports',
    Accounting: '/dashboard/accounting',
    'Cash register': '/dashboard/cash',
    Analytics: '/dashboard/analytics',
    History: '/dashboard/history',
    Tables: '/dashboard/tables',
    Orders: '/dashboard/orders',
    Settings: '/dashboard/settings',
};

/** One row of the table: a destination, before it is given a day. */
export interface GlanceRoute {
    module: string;
    report?: string;
    window: GlanceWindow;
    /** Accounting's bill-list filter. 'row' = the tapped mode's own filter. */
    method?: string;
    bills?: true;
    fallbacks: string[];
    secondary?: Omit<GlanceRoute, 'fallbacks' | 'secondary'>;
}

/**
 * Restaurant_Backend/glance_drill.ts `GLANCE_ROUTES`, mirrored for a backend
 * that sends no drills.
 */
export const GLANCE_ROUTES: Readonly<Record<string, GlanceRoute>> = {
    header: { module: 'Reports', report: 'sales_summary', window: 'day', fallbacks: ['Accounting', 'Analytics'] },
    bills: { module: 'Reports', report: 'order_summary', window: 'day', bills: true, fallbacks: ['Accounting', 'Analytics'] },
    day: { module: 'Reports', report: 'sales_summary', window: 'day', fallbacks: ['Accounting', 'Analytics'] },
    zone: { module: 'Settings', window: 'none', fallbacks: [] },
    month: { module: 'Reports', report: 'sales_summary', window: 'month', fallbacks: ['Accounting', 'History', 'Analytics'] },
    today_net: { module: 'Reports', report: 'sales_summary', window: 'day', fallbacks: ['Accounting', 'Analytics'] },
    today_gross: { module: 'Reports', report: 'sales_summary', window: 'day', fallbacks: ['Accounting', 'Analytics'] },
    // No fallback: only the Sales Summary's order-type split shows online trade.
    online_net: { module: 'Reports', report: 'sales_summary', window: 'day', fallbacks: [] },
    online_gross: { module: 'Reports', report: 'sales_summary', window: 'day', fallbacks: [] },
    cash_collection: {
        module: 'Reports', report: 'settlement_summary', window: 'day', method: 'Cash', bills: true,
        fallbacks: ['Accounting', 'Analytics'],
        secondary: { module: 'Cash register', window: 'none' },
    },
    month_to_date: { module: 'Reports', report: 'sales_summary', window: 'month', fallbacks: ['Accounting', 'History', 'Analytics'] },
    by_method: { module: 'Reports', report: 'settlement_summary', window: 'day', fallbacks: ['Accounting', 'Analytics'] },
    by_method_row: {
        module: 'Reports', report: 'settlement_summary', window: 'day', method: 'row', bills: true,
        fallbacks: ['Accounting', 'Analytics'],
        secondary: { module: 'Accounting', window: 'day', method: 'row', bills: true },
    },
    split: { module: 'Accounting', report: 'settlement_summary', window: 'day', method: 'Split', bills: true, fallbacks: ['Reports'] },
    unallocated: { module: 'Accounting', report: 'settlement_summary', window: 'day', method: 'Split', bills: true, fallbacks: ['Reports'] },
    nc: { module: 'Reports', report: 'nc_summary', window: 'day', fallbacks: [] },
    nothing_settled: { module: 'Tables', window: 'none', fallbacks: ['Orders'] },
};

/** The six figures, which carry their drill on themselves. */
export const GLANCE_FIGURE_KEYS = [
    'today_net', 'today_gross', 'online_net', 'online_gross', 'cash_collection', 'month_to_date',
] as const;

/** Unallocated is not a stored payment method; its bills are the Split bills. */
export const glanceRowMethod = (method: string): string =>
    method.trim() === 'Unallocated' ? 'Split' : method.trim();

/**
 * glance_drill.ts `glanceParamsFor`: which of the window, report and method
 * each module takes. Reports, Accounting, History and Analytics take the window
 * (Analytics so that a fallback lands on the tapped day, not on whatever it
 * last showed); anything else takes nothing.
 */
export const glanceParamsFor = (
    module: string,
    route: Pick<GlanceRoute, 'report' | 'window' | 'method'>,
    day: { today: string; month_from: string },
    rowMethod?: string,
): GlanceParams => {
    const from = route.window === 'month' ? day.month_from : day.today;
    const to = day.today;
    const windowed = route.window !== 'none';
    const method = route.method === 'row'
        ? (rowMethod?.trim() ? glanceRowMethod(rowMethod) : undefined)
        : route.method;
    switch (module) {
        case 'Reports':
            return windowed
                ? { report: route.report ?? 'sales_summary', from, to, slot: 'all' }
                : { report: route.report ?? 'sales_summary' };
        case 'Accounting':
            return { ...(windowed ? { from, to } : {}), ...(method ? { method } : {}) };
        case 'History':
        case 'Analytics':
            return windowed ? { from, to } : {};
        default:
            return {};
    }
};

/** The web path for a module and its params. Query order is fixed. */
export const glanceHref = (module: string, params: GlanceParams, bills = false): string => {
    const base = GLANCE_APP_MODULES[module] ?? '/dashboard';
    const q = new URLSearchParams();
    for (const k of GLANCE_WEB_PARAMS) {
        const v = params[k];
        if (typeof v === 'string' && v !== '') { q.set(k, v); }
    }
    const qs = q.toString();
    const anchor = bills && module === 'Accounting' ? '#settled-bills' : '';
    return `${base}${qs ? `?${qs}` : ''}${anchor}`;
};

const targetOf = (
    module: string,
    route: Pick<GlanceRoute, 'report' | 'window' | 'method' | 'bills'>,
    day: { today: string; month_from: string },
    rowMethod?: string,
): GlanceTarget => {
    const params = glanceParamsFor(module, route, day, rowMethod);
    // Only a bill list is scrolled to, and only Accounting has one a jump reaches.
    const bills = route.bills === true && module === 'Accounting';
    return { module, params, href: glanceHref(module, params, bills), ...(bills ? { bills: true } : {}) };
};

/** The mirrored table's row for `key`, or undefined for an element it does not know. */
const glanceRouteOf = (key: string): GlanceRoute | undefined =>
    Object.prototype.hasOwnProperty.call(GLANCE_ROUTES, key) ? GLANCE_ROUTES[key] : undefined;

/** The table's drill for `key`, cut on the headline's own day. */
export const glanceFallbackDrill = (
    key: string,
    day: { today: string; month_from: string },
    rowMethod?: string,
): GlanceDrill | null => {
    const route = glanceRouteOf(key);
    if (!route) { return null; }
    return {
        ...targetOf(route.module, route, day, rowMethod),
        fallbacks: route.fallbacks.map((m) => targetOf(m, route, day, rowMethod)),
        ...(route.secondary
            ? { secondary: targetOf(route.secondary.module, route.secondary, day, rowMethod) }
            : {}),
    };
};

// --- reading the server's drills off the payload ----------------------------

const str = (v: unknown): string | undefined => {
    // Only a string or a finite number can honestly become a route fragment;
    // an object's '[object Object]' must never end up in a query string.
    const s = typeof v === 'string'
        ? v.trim()
        : (typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
    return s.length === 0 ? undefined : s;
};

/**
 * Null for anything that does not name a module — a destination the shell
 * cannot resolve is not a destination.
 */
const readTarget = (raw: unknown): GlanceTarget | null => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { return null; }
    const r = raw as Record<string, unknown>;
    const module = str(r.module);
    if (!module) { return null; }
    const p = (r.params && typeof r.params === 'object' && !Array.isArray(r.params))
        ? r.params as Record<string, unknown>
        : {};
    const params: GlanceParams = {
        report: str(p.report),
        from: str(p.from),
        to: str(p.to),
        slot: str(p.slot) === 'all' ? 'all' : undefined,
        method: str(p.method),
    };
    const bills = r.bills === true;
    return {
        module,
        params,
        // The backend already computes the web href; the mirror covers a drill
        // shape (the Flutter-only fields) that arrived without one.
        href: str(r.href) ?? glanceHref(module, params, bills),
        ...(bills ? { bills: true } : {}),
    };
};

const readDrill = (raw: unknown): GlanceDrill | null => {
    const primary = readTarget(raw);
    if (!primary) { return null; }
    const r = raw as Record<string, unknown>;
    const fallbacks: GlanceTarget[] = [];
    if (Array.isArray(r.fallbacks)) {
        for (const f of r.fallbacks) {
            const t = readTarget(f);
            if (t) { fallbacks.push(t); }
        }
    }
    const secondary = readTarget(r.secondary);
    return { ...primary, fallbacks, ...(secondary ? { secondary } : {}) };
};

/**
 * Where `key` leads on this headline payload: the server's drill when it sent
 * one, the mirrored table otherwise. A mode's row passes its stored `rowMethod`.
 */
export const glanceDrillOf = (
    headline: Record<string, unknown> | null | undefined,
    key: string,
    rowMethod?: string,
): GlanceDrill | null => {
    if (!headline) { return null; }
    let raw: unknown;
    if ((GLANCE_FIGURE_KEYS as readonly string[]).includes(key)) {
        const f = headline[key];
        raw = (f && typeof f === 'object') ? (f as Record<string, unknown>).drill : undefined;
    } else {
        const block = headline.drills;
        if (block && typeof block === 'object') {
            const b = block as Record<string, unknown>;
            if (key === 'by_method_row') {
                const rows = b.by_method_rows;
                raw = (rows && typeof rows === 'object' && rowMethod)
                    ? (rows as Record<string, unknown>)[rowMethod]
                    : undefined;
            } else {
                raw = b[key];
            }
        }
    }
    const served = readDrill(raw);
    if (served) { return served; }
    const today = str(headline.today) ?? '';
    const monthFrom = str(headline.month_from) ?? '';
    // No day to pin a fallback to: a jump would land on whatever window the
    // destination last had, which is the misreading this whole table prevents.
    if (!isDayKey(today)) { return null; }
    return glanceFallbackDrill(key, {
        today,
        month_from: isDayKey(monthFrom) ? monthFrom : `${today.slice(0, 7)}-01`,
    }, rowMethod);
};

/**
 * The first destination this user can open, or null — in which case the sheet
 * still opens and simply offers no jump, never a dead one.
 */
export const resolveGlance = (
    drill: GlanceDrill | null | undefined,
    canOpen: (module: string) => boolean,
): GlanceTarget | null => {
    if (!drill) { return null; }
    if (canOpen(drill.module)) { return drill; }
    for (const f of drill.fallbacks) {
        if (canOpen(f.module)) { return f; }
    }
    return null;
};

/**
 * The secondary when this user can open it and it is not where `resolveGlance`
 * already leads — two buttons to one screen is one button too many.
 */
export const resolveGlanceSecondary = (
    drill: GlanceDrill | null | undefined,
    canOpen: (module: string) => boolean,
): GlanceTarget | null => {
    const s = drill?.secondary;
    if (!s || !canOpen(s.module)) { return null; }
    const first = resolveGlance(drill, canOpen);
    return first?.module === s.module && first.href === s.href ? null : s;
};

// --- priming the destination -------------------------------------------------

/** The per-screen date-range storage key each windowed module reads. */
const RANGE_SCREEN_BY_MODULE: Readonly<Record<string, string>> = {
    Reports: 'reports',
    Accounting: 'accounting',
    History: 'history',
    Analytics: 'analytics',
};

/**
 * The window a target lands on, as the destination's date control stores it.
 *
 * The SERVER's day, never the device's. When the two agree it is stored as the
 * matching PRESET (Today, This month), so a return visit after midnight moves
 * with the calendar like any other preset.
 */
export const glanceWindowOf = (t: GlanceTarget, timezone: string): DateRange | null => {
    const { from, to } = t.params;
    if (!isDayKey(from) || !isDayKey(to)) { return null; }
    const today = todayInZone(timezone);
    if (from === today && to === today) { return resolvePreset('today', timezone); }
    if (from === startOfMonth(today) && to === today && from !== to) {
        return resolvePreset('this_month', timezone);
    }
    return normalizeRange({ from, to, preset: 'custom' }, timezone);
};

/**
 * Set the destination up to show the SAME number the owner tapped, just before
 * the router moves — the Flutter `_primeGlanceJump`. Reports and Accounting
 * also parse the href's own `?from=&to=` (and `?report=`), so for them this is
 * belt and braces; History and Analytics read only this stored window.
 */
export const primeGlanceTarget = (t: GlanceTarget, timezone: string): void => {
    const screen = RANGE_SCREEN_BY_MODULE[t.module];
    if (!screen) { return; }
    const window = glanceWindowOf(t, timezone);
    if (window) { saveRange(screen, window); }
};

// --------------------------------------------------------------- the copy ----
// Word for word the Flutter app's lib/models/glance_drill.dart.

export const GLANCE_REPORT_BUTTON = "Today's report";
export const GLANCE_DAY_TITLE = 'How today is cut';
export const GLANCE_SETTLED_CLOCK =
    'A bill counts on the day it was settled: when it was closed, or when it was approved if it was never closed.';
export const GLANCE_ONLINE_RULE =
    'A bill is online when the order it was raised from came through delivery or an aggregator. A counter takeaway is a walk-in and is not counted.';
export const GLANCE_ONLINE_NONE =
    'No delivery or aggregator order was settled today. Zomato, EazyDiner, District and Dineout taken at the table are payment modes: they are counted under Collected by payment method, not here.';
export const GLANCE_NO_CASH = 'No cash was taken today.';
export const GLANCE_DRAWER_NOTE =
    'The Cash register counts its own session and drawer, so its figure can differ from this one.';
export const GLANCE_BILL_LIST_NOTE =
    'Accounting lists a bill under the one payment method stored on it, so a bill paid in parts is listed under Split.';
export const GLANCE_SPLIT_RULE =
    'Each part of a bill paid in parts counts under its own payment method.';
export const GLANCE_BY_METHOD_TITLE = 'Payment methods today';
export const GLANCE_GROSS_ADDS_UP = 'Collected by payment method, below, adds up to this figure.';
export const GLANCE_NO_DESTINATION = 'There is no screen here you can open for this.';

/** "Today is Sep 17 in Asia/Kolkata (UTC+05:30), midnight to midnight on the restaurant's clock." */
export const glanceDaySentence = (day: string, zone: string): string => zone.length === 0
    ? `Today is ${day}, midnight to midnight on the restaurant's clock.`
    : `Today is ${day} in ${zone}, midnight to midnight on the restaurant's clock, not this device's.`;

/** "Every bill settled from Sep 1 to Sep 17, today included." */
export const glanceMonthSentence = (from: string, to: string): string =>
    `Every bill settled from ${from} to ${to}, today included.`;

/** The empty-day sentence's tail, with the open bills the Overview already counted. */
export const glanceOpenBillsSentence = (open: number): string => open === 0
    ? 'No bill is open on the floor either.'
    : `${open} bill${open === 1 ? ' is' : 's are'} still open on the floor.`;

/**
 * The ladder rungs the net/gross sheets print, in order, with their labels —
 * the Sales Summary's column labels.
 */
export const GLANCE_LADDER: readonly (readonly [string, string])[] = [
    ['item_total', 'Item total'],
    ['discount', 'Discount'],
    ['net', 'Net'],
    ['service_charge', 'Service charge'],
    ['tax', 'Tax'],
    ['round_off', 'Round off'],
    ['grand_total', 'Gross'],
    ['refund', 'Refunds'],
];

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Sep 17" — a day with no time of day, off a day key or ISO instant. The
 * Flutter RestaurantTime.day rendering, so the two clients caption the same
 * chip the same way.
 */
export const fmtGlanceDay = (iso: string): string => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
    if (!m) { return iso; }
    const month = MONTHS_SHORT[Number(m[2]) - 1];
    return month ? `${month} ${Number(m[3])}` : iso;
};
