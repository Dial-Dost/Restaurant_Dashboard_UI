/**
 * TODAY AT A GLANCE — WHERE EVERY ELEMENT OF THE OVERVIEW'S HEADLINE BOX LEADS.
 *
 * Client item 10: "The entire 'Today at a glance' section needs to be made
 * clickable; each option in it must be clickable."
 *
 * Each element opens an explanation built from the payload the card already
 * holds, footed by a "View in <Module>" link pinned to the server's day; a pure
 * count links straight there. The destination is the SERVER's answer when it
 * sent one (`drill` on each figure, the `drills` block for the rest —
 * Restaurant_Backend/glance_drill.ts) and this file's mirror of the same table
 * when it did not (a backend older than item 10). The Flutter app carries the
 * same table (lib/models/glance_drill.dart); the tests here pin all three.
 *
 * WHY REPORTS FIRST. Every figure in the box is computed by the same functions
 * as an MIS report, so the report a link lands on shows the same number — the
 * backend's headline_drill_agreement test follows every drill to prove it.
 * Accounting's by-method card is a different computation (no Unallocated row,
 * no refunds taken off), so it is a fallback and a second link for its bill
 * list, never the first place a figure leads.
 *
 * NEVER A LINK THE LAYOUT WOULD BOUNCE. A destination is offered only when
 * canOpenDashboardSection (the nav's own rule) says this session may open it;
 * otherwise the next fallback is tried, and with none left the dialog simply
 * offers no link. The server's href is used only when it points at the
 * module's own page and carries nothing but the parameters those pages parse —
 * an invented parameter would look like a working filter and be ignored.
 *
 * THE COPY IS SHARED WORD FOR WORD with the app (GLANCE_COPY), so an owner
 * reading the till and the browser reads the same sentences.
 *
 * PURE — no React, no fetch.
 */

/** The parameters the pages a drill reaches actually parse. */
export const GLANCE_WEB_PARAMS = ['report', 'from', 'to', 'slot', 'method'] as const;
export type GlanceParamKey = (typeof GLANCE_WEB_PARAMS)[number];
export type GlanceParams = Partial<Record<GlanceParamKey, string>>;

export interface GlanceTarget {
    /** The module's name, as both shells label it. */
    module: string;
    params: GlanceParams;
    href: string;
    /** True when the destination should scroll to its settled-bill list. */
    bills?: boolean;
}

export interface GlanceDrill extends GlanceTarget {
    fallbacks: GlanceTarget[];
    secondary?: GlanceTarget;
}

/** Every module a drill may name, and the page it is on here. */
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

type Window = 'day' | 'month' | 'none';

/** A module's page, or undefined for a name no drill may use. */
const pageOf = (module: string): string | undefined =>
    Object.prototype.hasOwnProperty.call(GLANCE_APP_MODULES, module) ? GLANCE_APP_MODULES[module] : undefined;

interface GlanceRoute {
    module: string;
    report?: string;
    window: Window;
    /** 'row' = the tapped mode's own filter. */
    method?: string;
    bills?: true;
    fallbacks: string[];
    secondary?: Omit<GlanceRoute, 'fallbacks' | 'secondary'>;
}

/**
 * Restaurant_Backend/glance_drill.ts `GLANCE_ROUTES`, mirrored for a backend
 * that sends no drills. Pinned to that source by glance-destinations.test.ts.
 */
export const GLANCE_ROUTES: Readonly<Record<string, GlanceRoute>> = {
    header: { module: 'Reports', report: 'sales_summary', window: 'day', fallbacks: ['Accounting', 'Analytics'] },
    bills: { module: 'Reports', report: 'order_summary', window: 'day', bills: true, fallbacks: ['Accounting', 'Analytics'] },
    day: { module: 'Reports', report: 'sales_summary', window: 'day', fallbacks: ['Accounting', 'Analytics'] },
    zone: { module: 'Settings', window: 'none', fallbacks: [] },
    month: { module: 'Reports', report: 'sales_summary', window: 'month', fallbacks: ['Accounting', 'History', 'Analytics'] },
    today_net: { module: 'Reports', report: 'sales_summary', window: 'day', fallbacks: ['Accounting', 'Analytics'] },
    today_gross: { module: 'Reports', report: 'sales_summary', window: 'day', fallbacks: ['Accounting', 'Analytics'] },
    online_net: { module: 'Reports', report: 'sales_summary', window: 'day', fallbacks: ['Accounting', 'Analytics'] },
    online_gross: { module: 'Reports', report: 'sales_summary', window: 'day', fallbacks: ['Accounting', 'Analytics'] },
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

export const GLANCE_FIGURE_KEYS = [
    'today_net', 'today_gross', 'online_net', 'online_gross', 'cash_collection', 'month_to_date',
] as const;
export type GlanceFigureKey = (typeof GLANCE_FIGURE_KEYS)[number];

export type GlanceKey = keyof typeof GLANCE_ROUTES;

/** Unallocated is not a stored payment method; its bills are the Split bills. */
export const glanceRowMethod = (method: string): string =>
    method.trim() === 'Unallocated' ? 'Split' : method.trim();

const isDayKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** glance_drill.ts `glanceParamsFor`: which of the window, report and method a module takes. */
export function glanceParamsFor(
    module: string,
    route: Pick<GlanceRoute, 'report' | 'window' | 'method'>,
    day: { today: string; month_from: string },
    rowMethod?: string,
): GlanceParams {
    const from = route.window === 'month' ? day.month_from : day.today;
    const to = day.today;
    const windowed = route.window !== 'none';
    const method = route.method === 'row' ? (rowMethod ? glanceRowMethod(rowMethod) : undefined) : route.method;
    switch (module) {
        case 'Reports':
            return windowed
                ? { report: route.report ?? 'sales_summary', from, to, slot: 'all' }
                : { report: route.report ?? 'sales_summary' };
        case 'Accounting':
            return { ...(windowed ? { from, to } : {}), ...(method ? { method } : {}) };
        case 'History':
            return windowed ? { from, to } : {};
        default:
            return {};
    }
}

/** The href for a module and its params. Query order is fixed; the bill-list anchor is Accounting's. */
export function glanceHref(module: string, params: GlanceParams, bills = false): string {
    const base = pageOf(module) ?? '/dashboard';
    const q = new URLSearchParams();
    for (const k of GLANCE_WEB_PARAMS) {
        const v = params[k];
        if (typeof v === 'string' && v !== '') {q.set(k, v);}
    }
    const qs = q.toString();
    const anchor = bills && module === 'Accounting' ? '#settled-bills' : '';
    return `${base}${qs ? `?${qs}` : ''}${anchor}`;
}

function targetOf(
    module: string,
    route: Pick<GlanceRoute, 'report' | 'window' | 'method' | 'bills'>,
    day: { today: string; month_from: string },
    rowMethod?: string,
): GlanceTarget {
    const params = glanceParamsFor(module, route, day, rowMethod);
    const bills = route.bills === true && module === 'Accounting';
    return { module, params, href: glanceHref(module, params, bills), ...(bills ? { bills: true } : {}) };
}

/** The table's drill for [key], cut on the headline's own day. */
export function glanceFallbackDrill(
    key: string,
    day: { today: string; month_from: string },
    rowMethod?: string,
): GlanceDrill | null {
    const route: GlanceRoute | undefined = Object.prototype.hasOwnProperty.call(GLANCE_ROUTES, key) ? GLANCE_ROUTES[key] : undefined;
    if (!route) {return null;}
    return {
        ...targetOf(route.module, route, day, rowMethod),
        fallbacks: route.fallbacks.map((m) => targetOf(m, route, day, rowMethod)),
        ...(route.secondary ? { secondary: targetOf(route.secondary.module, route.secondary, day, rowMethod) } : {}),
    };
}

const asTarget = (raw: unknown): GlanceTarget | null => {
    if (!raw || typeof raw !== 'object') {return null;}
    const r = raw as Record<string, unknown>;
    const module = typeof r.module === 'string' ? r.module.trim() : '';
    if (!module) {return null;}
    const params: GlanceParams = {};
    const p = r.params && typeof r.params === 'object' ? (r.params as Record<string, unknown>) : {};
    for (const k of GLANCE_WEB_PARAMS) {
        const v = p[k];
        if (typeof v === 'string' && v.trim() !== '') {params[k] = v.trim();}
    }
    return {
        module,
        params,
        href: typeof r.href === 'string' ? r.href : '',
        ...(r.bills === true ? { bills: true } : {}),
    };
};

/** A served drill, or null for anything that does not name a module. */
export function parseGlanceDrill(raw: unknown): GlanceDrill | null {
    const primary = asTarget(raw);
    if (!primary) {return null;}
    const r = raw as Record<string, unknown>;
    const fallbacks = Array.isArray(r.fallbacks) ? r.fallbacks.map(asTarget).filter((t): t is GlanceTarget => t !== null) : [];
    const secondary = asTarget(r.secondary);
    return { ...primary, fallbacks, ...(secondary ? { secondary } : {}) };
}

/** The headline fields the resolver reads. */
export interface GlanceHeadline {
    today?: unknown;
    month_from?: unknown;
    drills?: unknown;
    [figure: string]: unknown;
}

/**
 * Where [key] leads on this payload: the server's drill when it sent one, the
 * mirrored table otherwise. A mode's row passes its stored [rowMethod].
 */
export function glanceDrillOf(headline: GlanceHeadline, key: string, rowMethod?: string): GlanceDrill | null {
    let raw: unknown;
    if ((GLANCE_FIGURE_KEYS as readonly string[]).includes(key)) {
        const f = headline[key];
        raw = f && typeof f === 'object' ? (f as Record<string, unknown>).drill : undefined;
    } else if (headline.drills && typeof headline.drills === 'object') {
        const block = headline.drills as Record<string, unknown>;
        if (key === 'by_method_row') {
            const rows = block.by_method_rows;
            raw = rows && typeof rows === 'object' && !Array.isArray(rows) && rowMethod
                ? (rows as Record<string, unknown>)[rowMethod]
                : undefined;
        } else {
            raw = block[key];
        }
    }
    const served = parseGlanceDrill(raw);
    if (served) {return served;}
    // No day to pin a fallback to: a link would open whatever window the page
    // last had, which is the misreading this whole table exists to prevent.
    if (!isDayKey(headline.today)) {return null;}
    const monthFrom = isDayKey(headline.month_from) ? headline.month_from : `${headline.today.slice(0, 7)}-01`;
    return glanceFallbackDrill(key, { today: headline.today, month_from: monthFrom }, rowMethod);
}

/**
 * The href to follow for [t]: the server's, when it points at the module's own
 * page and carries only parsed parameters; otherwise rebuilt from the params.
 */
export function safeGlanceHref(t: GlanceTarget): string {
    const base = pageOf(t.module);
    if (!base) {return glanceHref(t.module, t.params, t.bills === true);}
    try {
        const url = new URL(t.href, 'https://glance.invalid');
        const keysOk = [...url.searchParams.keys()].every((k) => (GLANCE_WEB_PARAMS as readonly string[]).includes(k));
        const hashOk = url.hash === '' || (url.hash === '#settled-bills' && t.module === 'Accounting');
        if (url.origin === 'https://glance.invalid' && url.pathname === base && keysOk && hashOk && t.href.startsWith('/')) {
            return t.href;
        }
    } catch {
        // fall through to the rebuilt href
    }
    return glanceHref(t.module, t.params, t.bills === true);
}

/** A link a session may follow. */
export interface GlanceLink {
    module: string;
    href: string;
    /** "View in Reports" — the app's words. */
    label: string;
}

const linkOf = (t: GlanceTarget): GlanceLink => {
    const href = safeGlanceHref(t);
    return { module: t.module, href, label: `View in ${t.module}` };
};

/** The page an href lands on, without query or anchor. */
export const glancePath = (href: string): string => href.split(/[?#]/)[0];

/**
 * The first destination of [drill] this session can open, or null. [canOpen]
 * is the nav's rule (canOpenDashboardSection) over a page path.
 */
export function resolveGlanceLink(drill: GlanceDrill | null, canOpen: (path: string) => boolean): GlanceLink | null {
    if (!drill) {return null;}
    for (const t of [drill, ...drill.fallbacks]) {
        const page = pageOf(t.module);
        if (page && canOpen(page)) {return linkOf(t);}
    }
    return null;
}

/** [drill]'s second destination, when openable and not where the first one goes. */
export function resolveGlanceSecondary(drill: GlanceDrill | null, canOpen: (path: string) => boolean): GlanceLink | null {
    const s = drill?.secondary;
    if (!s) {return null;}
    const page = pageOf(s.module);
    if (!page || !canOpen(page)) {return null;}
    const first = resolveGlanceLink(drill, canOpen);
    const link = linkOf(s);
    return first?.href === link.href ? null : link;
}

/** Key -> link, for the elements that link straight through. */
export function resolveGlanceDrill(
    key: string,
    headline: GlanceHeadline,
    canOpen: (path: string) => boolean,
    rowMethod?: string,
): GlanceLink | null {
    return resolveGlanceLink(glanceDrillOf(headline, key, rowMethod), canOpen);
}

// --------------------------------------------------------------- the copy ----
// Word for word the app's lib/models/glance_drill.dart.

export const GLANCE_COPY = {
    reportButton: "Today's report",
    dayTitle: 'How today is cut',
    settledClock:
        'A bill counts on the day it was settled: when it was closed, or when it was approved if it was never closed.',
    onlineRule:
        'A bill is online when the order it was raised from came through delivery or an aggregator. A counter takeaway is a walk-in and is not counted.',
    onlineNone:
        'No delivery or aggregator order was settled today. Zomato, EazyDiner, District and Dineout taken at the table are payment modes: they are counted under Collected by payment method, not here.',
    noCash: 'No cash was taken today.',
    drawerNote: 'The Cash register counts its own session and drawer, so its figure can differ from this one.',
    billListNote:
        'Accounting lists a bill under the one payment method stored on it, so a bill paid in parts is listed under Split.',
    splitRule: 'Each part of a bill paid in parts counts under its own payment method.',
    byMethodTitle: 'Payment methods today',
    grossAddsUp: 'Collected by payment method, below, adds up to this figure.',
    noDestination: 'There is no screen here you can open for this.',
} as const;

export const glanceDaySentence = (day: string, zone: string): string => (zone === ''
    ? `Today is ${day}, midnight to midnight on the restaurant's clock.`
    : `Today is ${day} in ${zone}, midnight to midnight on the restaurant's clock, not this device's.`);

/** "Asia/Kolkata (UTC+05:30)" — the zone and its offset, as the app's day sheet prints them. */
export const glanceZoneCaption = (zone: string, offsetMinutes: number): string => {
    const sign = offsetMinutes < 0 ? '-' : '+';
    const abs = Math.abs(Math.round(offsetMinutes));
    const hh = String(Math.floor(abs / 60)).padStart(2, '0');
    const mm = String(abs % 60).padStart(2, '0');
    return `${zone} (UTC${sign}${hh}:${mm})`;
};

export const glanceMonthSentence = (from: string, to: string): string =>
    `Every bill settled from ${from} to ${to}, today included.`;

export const glanceOpenBillsSentence = (open: number): string => (open === 0
    ? 'No bill is open on the floor either.'
    : `${String(open)} bill${open === 1 ? ' is' : 's are'} still open on the floor.`);

/** The rungs the net/gross dialogs print, with the Sales Summary's labels. */
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
