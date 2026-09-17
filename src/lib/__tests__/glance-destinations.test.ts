// "TODAY AT A GLANCE" — every element leads somewhere (client item 10).
//
// What the card does is a matter of three pure answers and one wiring:
//
//   * WHERE: glance-destinations.ts, which mirrors the backend's table
//     (Restaurant_Backend/glance_drill.ts) for a backend that sends no drills —
//     pinned to that source text here, and to the app's copy of the words;
//   * WHO: dashboard-sections.ts, the nav's own gate, so a link is never one the
//     layout would bounce — pinned to the keyword lists the layout carried;
//   * WHAT THE PAGES PARSE: every href carries only report/from/to/slot/method,
//     and the pages that receive them read them (Accounting ?method=, History
//     ?from=&to=);
//   * and the card calls all of it — the project's most repeated defect is a
//     correct helper nothing calls.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    GLANCE_APP_MODULES, GLANCE_COPY, GLANCE_FIGURE_KEYS, GLANCE_LADDER, GLANCE_ROUTES, GLANCE_WEB_PARAMS,
    glanceDaySentence, glanceDrillOf, glanceFallbackDrill, glanceHref, glanceMonthSentence,
    glanceOpenBillsSentence, glancePath, glanceRowMethod, glanceZoneCaption, parseGlanceDrill,
    resolveGlanceDrill, resolveGlanceLink, resolveGlanceSecondary, safeGlanceHref,
    type GlanceDrill, type GlanceHeadline,
} from '../glance-destinations';
import {
    ADMIN_ONLY_SECTIONS, SECTION_KEYWORDS, canAccessByKeywords, canOpenDashboardSection, sectionKeywords,
    type SectionSession,
} from '../dashboard-sections';

function readSource(relative: string): string {
    for (const base of [process.cwd(), path.join(__dirname, '..', '..', '..')]) {
        const full = path.join(base, relative);
        // A fixed list of this repo's own source files, not user input.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        if (fs.existsSync(full)) { return fs.readFileSync(full, 'utf8'); }
    }
    throw new Error(`readSource could not find ${relative} from ${process.cwd()}`);
}

/** A sibling checkout's file, or null when this repo is checked out alone. */
function sibling(repo: string, relative: string): string | null {
    for (const base of [path.join(process.cwd(), '..'), path.join(__dirname, '..', '..', '..', '..')]) {
        const full = path.join(base, repo, relative);
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        if (fs.existsSync(full)) { return fs.readFileSync(full, 'utf8'); }
    }
    return null;
}

/**
 * Source with comments removed, so a pin reads the CODE rather than the prose
 * beside it. Line comments go FIRST: the layout's own prose mentions
 * "/reports/mis/*", and a block-comment pass would read that as an opener.
 */
const code = (src: string): string => src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** The `{ … }` (or `[ … ]`) initialiser of `export const NAME`, normalised for comparison. */
function initialiser(src: string, name: string): string {
    const s = code(src.replace(/\r\n/g, '\n'));
    const at = s.indexOf(`export const ${name}`);
    if (at < 0) { throw new Error(`${name} not found`); }
    const eq = s.indexOf('=', at);
    const open = s.slice(eq).search(/[[{]/) + eq;
    const close = s[open] === '{' ? '}' : ']';
    let depth = 0;
    let end = open;
    for (let i = open; i < s.length; i++) {
        if (s[i] === s[open]) { depth++; }
        if (s[i] === close) { depth--; if (depth === 0) { end = i; break; } }
    }
    return s.slice(open, end + 1).replace(/'/g, '"').replace(/\s+/g, '').replace(/,([}\]])/g, '$1');
}

/** The value, or a failed test naming what was missing — never a `!`. */
function must<T>(value: T | null | undefined, what = 'a value'): T {
    if (value === null || value === undefined) { throw new Error(`expected ${what}`); }
    return value;
}

const DAY = { today: '2026-09-17', month_from: '2026-09-01' };
const everywhere = (): boolean => true;

const owner: SectionSession = { role: 'admin', role_all: ['admin'], actions_set: ['*'], action_names: [] };
const apcManager: SectionSession = { role: 'manager', role_all: ['manager'], actions_set: ['a1'], action_names: ['View Order APC'] };
const cashier: SectionSession = { role: 'cashier', role_all: ['cashier'], actions_set: ['a1'], action_names: ['View Bills', 'Close Bill', 'Accounting Reports'] };
const waiter: SectionSession = { role: 'waiter', role_all: ['waiter'], actions_set: ['a1'], action_names: ['Add Orders', 'View Order APC'], scope: { waiter_only: true } };
const valet: SectionSession = { role: 'valet', role_all: ['valet'], actions_set: ['a1'], action_names: ['Valet Parking'] };
const gate = (s: SectionSession) => (p: string): boolean => canOpenDashboardSection(s, p);

describe('the table is the backend\'s, and the app\'s', () => {
    it('GLANCE_ROUTES, the module map, the web params and the figure keys match glance_drill.ts', () => {
        const backend = sibling('Restaurant_Backend', 'glance_drill.ts');
        if (backend === null) { return; }
        const web = readSource('src/lib/glance-destinations.ts');
        for (const name of ['GLANCE_ROUTES', 'GLANCE_APP_MODULES', 'GLANCE_WEB_PARAMS', 'GLANCE_FIGURE_KEYS']) {
            expect([name, initialiser(web, name)]).toEqual([name, initialiser(backend, name)]);
        }
    });

    it('every module the table names is one the app shell registers', () => {
        const shell = sibling('restaurant_owner_app', 'lib/screens/home_shell.dart');
        const modules = new Set(Object.values(GLANCE_ROUTES).flatMap((r) => [r.module, ...r.fallbacks, ...(r.secondary ? [r.secondary.module] : [])]));
        for (const m of modules) { expect(Object.keys(GLANCE_APP_MODULES)).toContain(m); }
        if (shell === null) { return; }
        const labels = [...shell.matchAll(/_Module\('([^']+)'/g)].map((x) => x[1]);
        for (const m of Object.keys(GLANCE_APP_MODULES)) { expect(labels).toContain(m); }
    });

    it('the words are the app\'s, word for word', () => {
        const dart = sibling('restaurant_owner_app', 'lib/models/glance_drill.dart');
        if (dart === null) { return; }
        const consts = new Map<string, string>();
        // Either quote; the backreference keeps the body in ONE group.
        for (const m of dart.matchAll(/const String (kGlance\w+) =\s*(['"])((?:(?!\2)[^\\]|\\.)*)\2;/g)) {
            consts.set(m[1], m[3].replace(/\\'/g, "'"));
        }
        const pairs: [keyof typeof GLANCE_COPY, string][] = [
            ['reportButton', 'kGlanceReportButton'], ['dayTitle', 'kGlanceDayTitle'],
            ['settledClock', 'kGlanceSettledClock'], ['onlineRule', 'kGlanceOnlineRule'],
            ['onlineNone', 'kGlanceOnlineNone'], ['noCash', 'kGlanceNoCash'], ['drawerNote', 'kGlanceDrawerNote'],
            ['billListNote', 'kGlanceBillListNote'], ['splitRule', 'kGlanceSplitRule'],
            ['byMethodTitle', 'kGlanceByMethodTitle'], ['grossAddsUp', 'kGlanceGrossAddsUp'],
            ['noDestination', 'kGlanceNoDestination'],
        ];
        expect(consts.size).toBe(pairs.length);
        for (const [web, app] of pairs) { expect([web, GLANCE_COPY[web]]).toEqual([web, consts.get(app)]); }
        // The ladder labels, in the app's order.
        const ladder = [...dart.slice(dart.indexOf('kGlanceLadder')).matchAll(/\('([a-z_]+)', '([^']+)'\)/g)].map((m) => [m[1], m[2]]);
        expect(ladder).toEqual(GLANCE_LADDER.map(([k, l]) => [k, l]));
    });

    it('the sentences read the same on both clients', () => {
        // The app's test asserts these same strings.
        expect(glanceOpenBillsSentence(0)).toBe('No bill is open on the floor either.');
        expect(glanceOpenBillsSentence(1)).toBe('1 bill is still open on the floor.');
        expect(glanceOpenBillsSentence(3)).toBe('3 bills are still open on the floor.');
        expect(glanceMonthSentence('2026-09-01', '2026-09-17')).toBe('Every bill settled from 2026-09-01 to 2026-09-17, today included.');
        expect(glanceDaySentence('2026-09-17', 'Asia/Kolkata (UTC+05:30)'))
            .toBe("Today is 2026-09-17 in Asia/Kolkata (UTC+05:30), midnight to midnight on the restaurant's clock, not this device's.");
        expect(glanceZoneCaption('Asia/Kolkata', 330)).toBe('Asia/Kolkata (UTC+05:30)');
        expect(glanceZoneCaption('America/St_Johns', -150)).toBe('America/St_Johns (UTC-02:30)');
        const dart = sibling('restaurant_owner_app', 'lib/models/glance_drill.dart');
        if (dart === null) { return; }
        expect(dart).toContain("'No bill is open on the floor either.'");
        expect(dart).toContain("'Every bill settled from $from to $to, today included.'");
        expect(dart).toContain("midnight to midnight on the restaurant\\'s clock, not this device\\'s.");
    });

    it('the online sheet names the modes the client records as payments, and where they are counted', () => {
        for (const mode of ['Zomato', 'EazyDiner', 'District', 'Dineout']) { expect(GLANCE_COPY.onlineNone).toContain(mode); }
        expect(GLANCE_COPY.onlineNone).toContain('Collected by payment method');
    });
});

describe('hrefs', () => {
    it('only parameters the pages parse, on the module\'s own page', () => {
        for (const key of Object.keys(GLANCE_ROUTES)) {
            const d = must(glanceFallbackDrill(key, DAY, 'Cash'));
            for (const t of [d, ...d.fallbacks, ...(d.secondary ? [d.secondary] : [])]) {
                const url = new URL(t.href, 'https://x.invalid');
                expect(url.pathname).toBe(GLANCE_APP_MODULES[t.module]);
                for (const k of url.searchParams.keys()) { expect(GLANCE_WEB_PARAMS).toContain(k); }
                expect(Object.fromEntries(url.searchParams.entries())).toEqual(t.params);
                if (t.module === 'Reports' && t.params.from) { expect(t.params.slot).toBe('all'); }
                expect(url.hash === '#settled-bills').toBe(t.bills === true);
            }
        }
    });

    it('the day, the month and all day, exactly', () => {
        expect(must(glanceFallbackDrill('today_net', DAY)).href)
            .toBe('/dashboard/reports?report=sales_summary&from=2026-09-17&to=2026-09-17&slot=all');
        expect(must(glanceFallbackDrill('month_to_date', DAY)).href)
            .toBe('/dashboard/reports?report=sales_summary&from=2026-09-01&to=2026-09-17&slot=all');
        expect(must(glanceFallbackDrill('month', DAY)).fallbacks.map((f) => f.href)).toEqual([
            '/dashboard/accounting?from=2026-09-01&to=2026-09-17',
            '/dashboard/history?from=2026-09-01&to=2026-09-17',
            '/dashboard/analytics',
        ]);
        expect(must(glanceFallbackDrill('cash_collection', DAY)).fallbacks[0].href)
            .toBe('/dashboard/accounting?from=2026-09-17&to=2026-09-17&method=Cash#settled-bills');
        expect(must(must(glanceFallbackDrill('by_method_row', DAY, 'Unallocated')).secondary).href)
            .toBe('/dashboard/accounting?from=2026-09-17&to=2026-09-17&method=Split#settled-bills');
        expect(must(glanceFallbackDrill('nothing_settled', DAY)).href).toBe('/dashboard/tables');
        expect(must(glanceFallbackDrill('zone', DAY)).href).toBe('/dashboard/settings');
        expect(glanceHref('Accounting', { method: 'Pine & Co' }, true)).toBe('/dashboard/accounting?method=Pine+%26+Co#settled-bills');
        expect(glanceRowMethod(' Unallocated ')).toBe('Split');
        expect(glancePath('/dashboard/accounting?from=x#settled-bills')).toBe('/dashboard/accounting');
    });

    it("the server's href is followed only when it is honest", () => {
        const t = { module: 'Reports', params: { report: 'nc_summary' }, href: '/dashboard/reports?report=nc_summary&from=2026-09-17' };
        expect(safeGlanceHref(t)).toBe(t.href);
        // An invented parameter looks like a filter and is not one: rebuilt from params.
        expect(safeGlanceHref({ ...t, href: '/dashboard/reports?report=nc_summary&outlet=all' })).toBe('/dashboard/reports?report=nc_summary');
        // Another page, another origin, or a stray anchor: rebuilt.
        expect(safeGlanceHref({ ...t, href: '/dashboard/accounting?report=nc_summary' })).toBe('/dashboard/reports?report=nc_summary');
        expect(safeGlanceHref({ ...t, href: 'https://evil.example/dashboard/reports' })).toBe('/dashboard/reports?report=nc_summary');
        expect(safeGlanceHref({ ...t, href: '//evil.example/dashboard/reports' })).toBe('/dashboard/reports?report=nc_summary');
        expect(safeGlanceHref({ ...t, href: '/dashboard/reports#settled-bills' })).toBe('/dashboard/reports?report=nc_summary');
        expect(safeGlanceHref({ module: 'Accounting', params: { method: 'Split' }, href: '/dashboard/accounting?method=Split#settled-bills', bills: true }))
            .toBe('/dashboard/accounting?method=Split#settled-bills');
    });
});

describe('reading the payload', () => {
    const served = (module: string, href: string): Record<string, unknown> => ({ module, params: {}, href, fallbacks: [] });
    const headline = (over: Record<string, unknown> = {}): GlanceHeadline => ({
        today: DAY.today,
        month_from: DAY.month_from,
        today_net: { value: 1, label: 'n', hint: 'h' },
        ...over,
    });

    it("the server's drill wins; the table fills in for an older backend", () => {
        const h = headline({
            today_net: { value: 1, label: 'n', hint: 'h', drill: served('History', '/dashboard/history') },
            drills: { nc: served('Analytics', '/dashboard/analytics'), by_method_rows: { Upi: served('Orders', '/dashboard/orders') } },
        });
        expect(must(glanceDrillOf(h, 'today_net')).module).toBe('History');
        expect(must(glanceDrillOf(h, 'nc')).module).toBe('Analytics');
        expect(must(glanceDrillOf(h, 'by_method_row', 'Upi')).module).toBe('Orders');
        expect(must(must(glanceDrillOf(h, 'by_method_row', 'Card')).secondary).params.method).toBe('Card');
        expect(glanceDrillOf(headline(), 'today_net')).toEqual(glanceFallbackDrill('today_net', DAY));
        expect(must(glanceDrillOf(headline(), 'header')).params.report).toBe('sales_summary');
    });

    it('a malformed drill is not a destination, and no day means no table fallback', () => {
        const h = headline({ today_net: { value: 1, drill: { params: {} } }, drills: { nc: 'Reports', by_method_rows: [] } });
        expect(must(glanceDrillOf(h, 'today_net')).module).toBe('Reports');
        expect(must(glanceDrillOf(h, 'nc')).params.report).toBe('nc_summary');
        expect(must(glanceDrillOf(h, 'by_method_row', 'Upi')).params.report).toBe('settlement_summary');
        expect(parseGlanceDrill({ module: 'Reports', params: { report: 'x', junk: 'y' }, fallbacks: [{}, 7] }))
            .toEqual({ module: 'Reports', params: { report: 'x' }, href: '', fallbacks: [] });
        expect(glanceDrillOf({ today_net: { value: 1 } }, 'today_net')).toBeNull();
        expect(glanceDrillOf(headline(), 'covers')).toBeNull();
    });
});

describe('who is offered which link', () => {
    it('the nav keyword lists moved into the library unchanged', () => {
        // The lists dashboard/layout.tsx carried inline before item 10, verbatim.
        expect(SECTION_KEYWORDS).toEqual({
            '/dashboard': [],
            '/dashboard/orders': ['order', 'bill', 'payment'],
            '/dashboard/tables': ['table'],
            '/dashboard/floor-plan': [],
            '/dashboard/waitlist': ['table', 'order', 'waitlist'],
            '/dashboard/bookings': ['booking'],
            '/dashboard/menu': ['menu'],
            '/dashboard/inventory': ['inventory', 'stock'],
            '/dashboard/purchase-orders': ['inventory', 'stock', 'purchase', 'vendor'],
            '/dashboard/customers': ['customer'],
            '/dashboard/feedback': ['feedback'],
            '/dashboard/coupons': [],
            '/dashboard/attendance': [],
            '/dashboard/valet': ['valet', 'parking'],
            '/dashboard/analytics': ['analytics', 'apc', 'report'],
            '/dashboard/simulation': ['analytics', 'apc', 'report'],
            '/dashboard/history': ['analytics', 'report'],
            '/dashboard/reports': ['report', 'accounting', 'finance'],
            '/dashboard/accounting': ['report', 'accounting', 'finance'],
            '/dashboard/cash': ['report', 'accounting', 'finance', 'cash'],
            '/dashboard/billing': [],
            '/dashboard/outlets': ['outlet', 'branch', 'setting', 'profile'],
        });
    });

    it('the layout reads every nav gate from that table, and keeps no inline list', () => {
        const layout = code(readSource('src/app/dashboard/layout.tsx'));
        expect(layout).toMatch(/import \{ hasKeywordAction, sectionKeywords \} from '@\/lib\/dashboard-sections'/);
        const items = [...layout.matchAll(/\{ href: '(\/dashboard[^']*)',[^\n]*?actionKeywords: ([^}]*?) \}/g)];
        expect(items.length).toBe(Object.keys(SECTION_KEYWORDS).length);
        for (const [, href, kw] of items) { expect([href, kw.trim()]).toEqual([href, `sectionKeywords('${href}')`]); }
        expect(layout).not.toMatch(/actionKeywords: \[/);
        // Settings is still the avatar menu's, for an admin.
        expect(layout).toMatch(/\.\.\.\(isAdmin \? \['\/dashboard\/settings'\] : \[\]\)/);
    });

    it('the gate is the layout\'s rule, in its order', () => {
        for (const href of [...Object.keys(SECTION_KEYWORDS), '/dashboard/settings']) {
            expect([href, canOpenDashboardSection(owner, href)]).toEqual([href, true]);
        }
        // The floor plan is a layout capability, not a keyword.
        expect(canOpenDashboardSection(cashier, '/dashboard/floor-plan')).toBe(false);
        expect(canOpenDashboardSection({ ...cashier, scope: { waiter_only: false, edit_table: true } }, '/dashboard/floor-plan')).toBe(true);
        expect(canOpenDashboardSection(owner, '/dashboard/nowhere')).toBe(false);
        expect(canOpenDashboardSection(null, '/dashboard')).toBe(false);
        // A valet has the valet board and nothing else.
        expect(canOpenDashboardSection(valet, '/dashboard/valet')).toBe(true);
        expect(canOpenDashboardSection(valet, '/dashboard/reports')).toBe(false);
        // A scoped waiter works from two screens — holding View Order APC changes nothing.
        expect(Object.keys(SECTION_KEYWORDS).filter((h) => canOpenDashboardSection(waiter, h))).toEqual(['/dashboard/orders', '/dashboard/tables']);
        // Admin extras are an admin's.
        for (const href of ADMIN_ONLY_SECTIONS) { expect([href, canOpenDashboardSection(cashier, href)]).toEqual([href, false]); }
        // A session from before action names were published passes the keyword gate.
        expect(canOpenDashboardSection({ role: 'manager', actions_set: ['a1'] }, '/dashboard/accounting')).toBe(true);
        expect(canAccessByKeywords(apcManager, sectionKeywords('/dashboard/analytics'))).toBe(true);
        expect(canAccessByKeywords(null, [])).toBe(false);
    });

    it('an owner lands on the report that computes each figure', () => {
        const h: GlanceHeadline = { today: DAY.today, month_from: DAY.month_from };
        for (const key of GLANCE_FIGURE_KEYS) {
            expect([key, glancePath(must(resolveGlanceDrill(key, h, gate(owner))).href)]).toEqual([key, '/dashboard/reports']);
        }
        expect(must(resolveGlanceDrill('today_net', h, gate(owner))).label).toBe('View in Reports');
        expect(must(resolveGlanceDrill('split', h, gate(owner))).label).toBe('View in Accounting');
        expect(must(resolveGlanceDrill('zone', h, gate(owner))).label).toBe('View in Settings');
        expect(must(resolveGlanceDrill('nothing_settled', h, gate(owner))).href).toBe('/dashboard/tables');
    });

    it('the headline audience whose web Reports tab is hidden falls back to Analytics, never a bounce', () => {
        // KNOWN DRIFT, carried not fixed: web Reports is keyworded on accounting
        // words, so "View Order APC" alone does not open it here (the app keys it
        // on 'apc'), and neither Accounting nor History matches it either. The
        // fallback is what keeps these links honest meanwhile.
        const h: GlanceHeadline = { today: DAY.today, month_from: DAY.month_from };
        expect(canOpenDashboardSection(apcManager, '/dashboard/reports')).toBe(false);
        expect(canOpenDashboardSection(apcManager, '/dashboard/history')).toBe(false);
        // A manager who also holds a report-named action opens the Reports tab itself.
        const withReport: SectionSession = { ...apcManager, action_names: ['View Order APC', 'Monthly Report'] };
        expect(glancePath(must(resolveGlanceDrill('month_to_date', h, gate(withReport))).href)).toBe('/dashboard/reports');
        for (const key of GLANCE_FIGURE_KEYS) {
            const link = resolveGlanceDrill(key, h, gate(apcManager));
            expect([key, link?.href]).toEqual([key, '/dashboard/analytics']);
            expect(canOpenDashboardSection(apcManager, glancePath(must(link).href))).toBe(true);
        }
        // Nowhere to go: no link, and the dialog still opens (the card's job).
        expect(resolveGlanceDrill('nc', h, gate(apcManager))).toBeNull();
        expect(resolveGlanceDrill('zone', h, gate(apcManager))).toBeNull();
        expect(resolveGlanceLink(null, everywhere)).toBeNull();
    });

    it('a second link only when it goes somewhere else the session may open', () => {
        const row: GlanceDrill = must(glanceFallbackDrill('by_method_row', DAY, 'Upi'));
        expect(must(resolveGlanceSecondary(row, gate(owner))).href).toBe('/dashboard/accounting?from=2026-09-17&to=2026-09-17&method=Upi#settled-bills');
        // Without Reports the row's first stop IS its bills: one link, not two to one page.
        const noReports = (p: string): boolean => p !== '/dashboard/reports';
        expect(must(resolveGlanceLink(row, noReports)).href).toBe(must(resolveGlanceSecondary(row, everywhere)).href);
        expect(resolveGlanceSecondary(row, noReports)).toBeNull();
        const cash = glanceFallbackDrill('cash_collection', DAY);
        expect(resolveGlanceSecondary(cash, gate(owner))).toEqual({ module: 'Cash register', href: '/dashboard/cash', label: 'View in Cash register' });
        expect(resolveGlanceSecondary(cash, gate(apcManager))).toBeNull();
        expect(resolveGlanceSecondary(null, everywhere)).toBeNull();
    });
});

describe('the card, the page and the destinations are wired', () => {
    const card = code(readSource('src/components/headline-stats.tsx'));
    const page = code(readSource('src/app/dashboard/page.tsx'));

    it('the card resolves through the shared table and the nav gate', () => {
        expect(card).toMatch(/const canOpen = useCallback\(\(path: string\) => canOpenDashboardSection\(user, path\), \[user\]\)/);
        expect(card).toMatch(/glanceDrillOf\(h as unknown as GlanceHeadline, key, row\)/);
        expect(card).toMatch(/const primary = sheet \? resolveGlanceLink\(sheet\.drill, canOpen\) : null/);
        expect(card).toMatch(/const secondary = sheet \? resolveGlanceSecondary\(sheet\.drill, canOpen\) : null/);
        expect(card).toMatch(/const ORDER: readonly GlanceFigureKey\[\] = GLANCE_FIGURE_KEYS/);
    });

    it('every figure renders through the clickable wrapper, and every other element is a control', () => {
        expect(card).toMatch(/\{ORDER\.map\(\(key\) => \{[\s\S]*?<GlanceTap key=\{key\} glance=\{key\}/);
        for (const glance of ['header', 'day', 'zone', 'month', 'bills', 'by_method', 'split', 'unallocated', 'nc', 'nothing_settled']) {
            expect([glance, card.includes(`glance="${glance}"`)]).toEqual([glance, true]);
        }
        expect(card).toContain('glance={`mode:${m.method}`}');
        expect(card).toContain('data-glance="report"');
        // The count line sits INSIDE the row's control.
        expect(card).toMatch(/<GlanceTap glance=\{`mode:\$\{m\.method\}`\}[\s\S]*?\{m\.bills\} bill[\s\S]*?<\/GlanceTap>/);
        // One dialog, footed by the resolved links.
        expect(card).toMatch(/<Link href=\{primary\.href\} data-glance-jump="primary">/);
        expect(card).toMatch(/<Link href=\{secondary\.href\} data-glance-jump="secondary">/);
        // A direct link falls back to a dialog, never to nothing.
        expect(card).toMatch(/if \(link\) \{[\s\S]*?<Link href=\{link\.href\}[\s\S]*?return <GlanceTap label=\{label\} glance=\{glance\} onClick=\{onFallback\}/);
    });

    it('the Overview shows the card to the money audience only, and links by the nav gate', () => {
        expect(page).toMatch(/const showsHeadline = showsMoney\(user\) && canAccessByKeywords\(user, sectionKeywords\('\/dashboard\/analytics'\)\)/);
        expect(page).toMatch(/\{user\?\.restaurantUsername && showsHeadline \? <HeadlineStats rid=\{user\.restaurantUsername\} \/> : null\}/);
        expect(page).toMatch(/const canOpenSection = \(href: string\) => canOpenDashboardSection\(user, href\)/);
        expect(page).not.toMatch(/hasKeywordAction/);
    });

    it('Accounting opens on a linked method and carries the anchor', () => {
        const accounting = code(readSource('src/app/dashboard/accounting/page.tsx'));
        expect(accounting).toMatch(/const linkedMethod = search\.get\("method"\)\?\.trim\(\)/);
        expect(accounting).toMatch(/<div id="settled-bills" className="scroll-mt-20">\s*<ClosedBillsSection[\s\S]*?initialMethod=\{linkedMethod\}/);
        expect(accounting).toMatch(/window\.location\.hash !== "#settled-bills"/);
        const closed = code(readSource('src/components/closed-bills.tsx'));
        expect(closed).toMatch(/const \[method, setMethod\] = useState\(initialMethod\?\.trim\(\) \?\? ""\)/);
        expect(closed).toMatch(/wanted && !options\.some\(\(o\) => o\.value === wanted\) \? \[\.\.\.options, \{ value: wanted, label: wanted \}\] : options/);
    });

    it('History opens on a linked window, inside a Suspense boundary', () => {
        const history = code(readSource('src/app/dashboard/history/page.tsx'));
        expect(history).toMatch(/const search = useSearchParams\(\)/);
        expect(history).toMatch(/useDateRange\("history", \{ params: search, fallback: historyDefault \}\)/);
        expect(history).toMatch(/export default function HistoryPage\(\): React\.JSX\.Element \{\s*return \(\s*<Suspense[\s\S]*?<HistoryInner \/>/);
    });

    it('Reports already reads report, from, to and slot=all', () => {
        const reports = code(readSource('src/app/dashboard/reports/page.tsx'));
        expect(reports).toMatch(/params\?\.get\("report"\)/);
        expect(reports).toMatch(/useDateRange\("reports", \{ params \}\)/);
        expect(reports).toMatch(/slotSelectionFromParams\(params\)/);
        const slots = code(readSource('src/lib/report-time-slots.ts'));
        expect(slots).toMatch(/get\(['"]slot['"]\)/);
    });

    it('the row labels are the app\'s', () => {
        const app = sibling('restaurant_owner_app', 'lib/screens/modules.dart');
        // An app checkout from before item 10 has none of these sheets to compare.
        if (app === null || sibling('restaurant_owner_app', 'lib/models/glance_drill.dart') === null) { return; }
        for (const label of ['Bills settled today', 'Online bills today', 'Bills settled this month', 'Time zone',
            'Month from', 'Collected', "Share of today's gross", 'NC bills', 'Given away', 'this figure']) {
            expect([label, card.includes(label)]).toEqual([label, true]);
            expect([label, app.includes(label)]).toEqual([label, true]);
        }
    });
});
