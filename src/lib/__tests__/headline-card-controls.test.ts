// "TODAY AT A GLANCE" — EVERY CONTROL IS PRESSED, NOT JUST FOUND (client item 10).
//
// glance-destinations.test.ts pins where each element leads and that the card's
// markup names every control. Neither can see a click handler that does
// nothing: `onClick={() => { void 0 }}` on every tile passed all of it. So this
// suite calls the card (HeadlineCard has no hooks) and follows each control the
// way a browser would — the element the card rendered, then the <button> or
// <a> that element renders — and requires every one of them to open a dialog
// or to be a link. A control that does neither is the dead click this item
// exists to remove.
//
// It also holds the refresh rule behind the empty-day sentence
// (readGlanceRefresh): the open-bill count is read with the figures on every
// refresh, never once and then repeated all morning.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { isValidElement, type ReactElement, type ReactNode } from 'react';

import { HeadlineCard, type GlanceSheet, type HeadlineCardProps } from '@/components/headline-stats';
import { canOpenDashboardSection, type SectionSession } from '@/lib/dashboard-sections';
import type { OverviewHeadline } from '@/lib/db';
import { GLANCE_COPY, glanceOpenBillsSentence, readGlanceRefresh } from '@/lib/glance-destinations';

// The card's module imports these; nothing here may reach a network, a cookie
// or a context provider.
jest.mock('@/lib/db', () => ({ getOverviewHeadline: jest.fn(), getOpenBills: jest.fn() }));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('@/hooks/use-currency', () => ({ useCurrency: () => ({ currencySymbol: '₹' }) }));

type Props = Record<string, unknown> & { children?: ReactNode };
type El = ReactElement<Props>;
type Render = (props: Props) => unknown;

const D = '2026-09-17';
const M0 = '2026-09-01';
const reports = (report: string, from = D): string =>
    `/dashboard/reports?report=${report}&from=${from}&to=${D}&slot=all`;
const bills = (method: string): string => `/dashboard/accounting?from=${D}&to=${D}&method=${method}#settled-bills`;

function headline(over: Partial<Record<keyof OverviewHeadline, unknown>> = {}): OverviewHeadline {
    const fig = (value: number, label: string, hint: string): { value: number; label: string; hint: string } =>
        ({ value, label, hint });
    return {
        today: D,
        month_from: M0,
        timezone: 'Asia/Kolkata',
        today_net: fig(20000, "Today's net sale", 'Net hint.'),
        today_gross: fig(22680.9, "Today's gross sale", 'Gross hint.'),
        online_net: fig(0, 'Online sale (net)', 'Online net hint.'),
        online_gross: fig(0, 'Online sale (gross)', 'Online gross hint.'),
        cash_collection: fig(8430.5, 'Cash collection', 'Cash hint.'),
        month_to_date: fig(412000, 'Month to date', 'MTD hint.'),
        today_bills: 14,
        month_bills: 301,
        today_online_bills: 0,
        today_ladder: {
            bills: 14, item_total: 21000, discount: 1000, net: 20000, service_charge: 1000,
            tax: 1680.5, round_off: 0.4, grand_total: 22680.9, refund: 120,
        },
        today_by_method: [
            { method: 'Upi', label: 'UPI', bills: 6, amount: 11000, share_pct: 48.5, refund: 0, net_amount: 11000 },
            { method: 'Cash', label: 'Cash', bills: 6, amount: 8430.5, share_pct: 37.17, refund: 120, net_amount: 8310.5 },
            { method: 'Unallocated', label: 'Unallocated', bills: 1, amount: 0, share_pct: 0, refund: 0, net_amount: 0 },
        ],
        today_split_bills: 1,
        today_unallocated: 0,
        by_method: { label: 'Collected by payment method', hint: 'By-method hint.' },
        today_nc: { label: 'Non-chargeable (NC) — not collected', hint: 'NC hint.', bills: 2, value: 1200 },
        ...over,
    } as unknown as OverviewHeadline;
}

const everywhere = (): boolean => true;
const nowhere = (): boolean => false;
const owner: SectionSession = { role: 'admin', role_all: ['admin'], actions_set: ['*'], action_names: [] };
const apcManager: SectionSession = { role: 'manager', role_all: ['manager'], actions_set: ['a1'], action_names: ['View Order APC'] };
const gate = (s: SectionSession) => (p: string): boolean => canOpenDashboardSection(s, p);

interface Mounted {
    tree: El;
    setSheet: jest.Mock<undefined, [GlanceSheet | null]>;
}

function mount(over: Partial<HeadlineCardProps> = {}): Mounted {
    const setSheet = jest.fn<undefined, [GlanceSheet | null]>();
    const props: HeadlineCardProps = {
        data: headline(),
        loading: false,
        failed: false,
        openBills: null,
        canOpen: everywhere,
        currencySymbol: '₹',
        sheet: null,
        setSheet,
        ...over,
    };
    if (over.setSheet) { throw new Error('mount() owns setSheet'); }
    return { tree: HeadlineCard(props) as El, setSheet };
}

function walk(node: unknown, out: El[]): El[] {
    if (Array.isArray(node)) {
        for (const n of node) { walk(n, out); }
        return out;
    }
    if (!isValidElement(node)) { return out; }
    const el = node as El;
    out.push(el);
    walk(el.props.children, out);
    return out;
}

const glanceId = (el: El): string | null => {
    const id = el.props.glance ?? el.props['data-glance'];
    return typeof id === 'string' ? id : null;
};

/** Every glance control the card rendered, by id. */
function controls(tree: El): Map<string, El> {
    const out = new Map<string, El>();
    for (const el of walk(tree, [])) {
        const id = glanceId(el);
        if (id === null) { continue; }
        expect([id, out.has(id)]).toEqual([id, false]);
        out.set(id, el);
    }
    return out;
}

/** The control [id], or a failed test naming it. */
function control(found: Map<string, El>, id: string): El {
    const el = found.get(id);
    if (!el) { throw new Error(`no control "${id}"`); }
    return el;
}

/** Render one level of a local component, exactly as React would. */
function render(el: El): El {
    if (typeof el.type !== 'function') { throw new Error('not a component'); }
    const out = (el.type as Render)(el.props);
    if (!isValidElement(out)) { throw new Error('rendered nothing'); }
    return out as El;
}

type Outcome = { href: string } | { sheet: GlanceSheet } | { dead: true };

/**
 * Press [el] as a browser would: down to the DOM element it renders, then its
 * href or its onClick. Whatever the click did to the dialog is the outcome.
 */
function press(el: El, setSheet: Mounted['setSheet']): Outcome {
    let node = el;
    // GlanceGo -> (Link | GlanceTap) -> button. Next's Link and the ui Button
    // are not ours to render: an href on them is the link.
    for (let depth = 0; typeof node.type === 'function' && typeof node.props.href !== 'string'; depth += 1) {
        if (depth > 3) { throw new Error('too deep'); }
        const next = render(node);
        // Whatever a wrapper passes down is the SAME handler it was given.
        if (typeof node.props.onClick === 'function' && typeof next.props.onClick === 'function') {
            expect(next.props.onClick).toBe(node.props.onClick);
        }
        if (typeof node.props.onFallback === 'function' && typeof next.props.onClick === 'function') {
            expect(next.props.onClick).toBe(node.props.onFallback);
        }
        node = next;
    }
    if (typeof node.props.href === 'string') { return { href: node.props.href }; }
    expect(node.type).toBe('button');
    expect(node.props['data-glance']).toBe(glanceId(el));
    const click = node.props.onClick;
    if (typeof click !== 'function') { return { dead: true }; }
    setSheet.mockClear();
    (click as () => void)();
    const calls = setSheet.mock.calls;
    if (calls.length !== 1 || calls[0][0] === null) { return { dead: true }; }
    return { sheet: calls[0][0] };
}

interface Dialog {
    all: El[];
    setSheet: Mounted['setSheet'];
    primary: string | null;
    secondary: string | null;
}

/** The dialog the card draws for [sheet], and its jump links. */
function dialog(sheet: GlanceSheet, canOpen: HeadlineCardProps['canOpen'] = everywhere): Dialog {
    const { tree, setSheet } = mount({ sheet, canOpen });
    const all = walk(tree, []);
    const jump = (which: string): string | null => {
        const a = all.find((el) => el.props['data-glance-jump'] === which);
        return a ? String(a.props.href) : null;
    };
    return { all, setSheet, primary: jump('primary'), secondary: jump('secondary') };
}

const TRADING_DAY = [
    'header', 'report', 'day', 'zone', 'month', 'bills',
    'today_net', 'today_gross', 'online_net', 'online_gross', 'cash_collection', 'month_to_date',
    'by_method', 'mode:Upi', 'mode:Cash', 'mode:Unallocated', 'split', 'unallocated', 'nc',
];

describe('a trading day, an owner', () => {
    it('draws every element as a control', () => {
        const { tree } = mount();
        expect([...controls(tree).keys()].sort()).toEqual([...TRADING_DAY].sort());
    });

    it('every control opens its dialog or is its link, and each dialog leads where the table says', () => {
        const { tree, setSheet } = mount();
        const found = controls(tree);
        const want: Record<string, { href: string } | { title: string; primary: string | null; secondary?: string | null }> = {
            header: { title: GLANCE_COPY.dayTitle, primary: reports('sales_summary') },
            report: { href: reports('sales_summary') },
            day: { title: GLANCE_COPY.dayTitle, primary: reports('sales_summary') },
            zone: { title: GLANCE_COPY.dayTitle, primary: '/dashboard/settings' },
            month: { title: 'Month to date · ₹4,12,000.00', primary: reports('sales_summary', M0) },
            bills: { href: reports('order_summary') },
            today_net: { title: "Today's net sale · ₹20,000.00", primary: reports('sales_summary') },
            today_gross: { title: "Today's gross sale · ₹22,680.90", primary: reports('sales_summary') },
            online_net: { title: 'Online sale (net) · ₹0.00', primary: reports('sales_summary') },
            online_gross: { title: 'Online sale (gross) · ₹0.00', primary: reports('sales_summary') },
            cash_collection: { title: 'Cash · ₹8,430.50', primary: reports('settlement_summary'), secondary: '/dashboard/cash' },
            month_to_date: { title: 'Month to date · ₹4,12,000.00', primary: reports('sales_summary', M0) },
            by_method: { href: reports('settlement_summary') },
            'mode:Upi': { title: 'UPI · ₹11,000.00', primary: reports('settlement_summary'), secondary: bills('Upi') },
            'mode:Cash': { title: 'Cash · ₹8,430.50', primary: reports('settlement_summary'), secondary: bills('Cash') },
            'mode:Unallocated': { title: 'Unallocated · ₹0.00', primary: reports('settlement_summary'), secondary: bills('Split') },
            split: { title: '1 bill(s) paid across more than one method', primary: bills('Split') },
            unallocated: { title: 'Unallocated · ₹0.00', primary: bills('Split') },
            nc: { title: 'Non-chargeable (NC) — not collected', primary: reports('nc_summary') },
        };
        expect(Object.keys(want).sort()).toEqual([...found.keys()].sort());
        for (const [id, el] of found) {
            const outcome = press(el, setSheet);
            const expected = want[id];
            if ('href' in expected) {
                expect([id, outcome]).toEqual([id, { href: expected.href }]);
                continue;
            }
            if (!('sheet' in outcome)) { throw new Error(`${id}: ${JSON.stringify(outcome)}`); }
            expect([id, outcome.sheet.title]).toEqual([id, expected.title]);
            const d = dialog(outcome.sheet);
            expect([id, d.primary]).toEqual([id, expected.primary]);
            expect([id, d.secondary]).toEqual([id, expected.secondary ?? null]);
        }
    });

    it('the dialogs say what the payload says', () => {
        const { tree, setSheet } = mount();
        const found = controls(tree);
        const sheetOf = (id: string): GlanceSheet => {
            const o = press(control(found, id), setSheet);
            if (!('sheet' in o)) { throw new Error(id); }
            return o.sheet;
        };
        const net = sheetOf('today_net');
        expect(net.rows.map((r) => r.label)).toEqual(['Bills settled today', 'Item total', 'Discount', 'Net', 'Service charge', 'Tax', 'Round off', 'Gross', 'Refunds']);
        expect(net.rows.find((r) => r.label === 'Net')?.trailing).toBe('this figure');
        expect(sheetOf('online_gross').notes.map((n) => n.text)).toEqual(expect.arrayContaining([GLANCE_COPY.onlineRule, GLANCE_COPY.onlineNone]));
        expect(sheetOf('cash_collection').notes.map((n) => n.text)).toContain(GLANCE_COPY.drawerNote);
        expect(sheetOf('mode:Upi').notes.map((n) => n.text)).toContain(GLANCE_COPY.billListNote);
        expect(sheetOf('nc').rows).toEqual([{ label: 'NC bills', value: '2' }, { label: 'Given away', value: '₹1,200.00' }]);
        expect(sheetOf('month').rows).toEqual([{ label: 'Bills settled this month', value: '301' }]);
    });

    it('the dialog closes from its Close button and from the overlay, and a jump closes it too', () => {
        const { tree, setSheet } = mount();
        const o = press(control(controls(tree), 'cash_collection'), setSheet);
        if (!('sheet' in o)) { throw new Error('no sheet'); }
        const d = dialog(o.sheet);
        const close = d.all.find((el) => el.props.children === 'Close');
        expect(typeof close?.props.onClick).toBe('function');
        (close?.props.onClick as () => void)();
        expect(d.setSheet).toHaveBeenLastCalledWith(null);

        const root = d.all.find((el) => typeof el.props.onOpenChange === 'function');
        d.setSheet.mockClear();
        (root?.props.onOpenChange as (open: boolean) => void)(true);
        expect(d.setSheet).not.toHaveBeenCalled();
        (root?.props.onOpenChange as (open: boolean) => void)(false);
        expect(d.setSheet).toHaveBeenLastCalledWith(null);

        // Each jump's button closes the dialog on its way out.
        for (const which of ['primary', 'secondary']) {
            const button = d.all.find((el) => walk(el.props.children, []).some((c) => c.props['data-glance-jump'] === which)
                && typeof el.props.onClick === 'function');
            d.setSheet.mockClear();
            (button?.props.onClick as () => void)();
            expect([which, d.setSheet.mock.calls]).toEqual([which, [[null]]]);
        }
    });
});

describe('an empty day', () => {
    const empty = headline({ today_bills: 0, today_by_method: [], today_nc: null });
    const textOf = (el: El): string => walk(el, []).flatMap((e) => {
        const c = e.props.children;
        return (Array.isArray(c) ? c : [c]).filter((x): x is string => typeof x === 'string');
    }).join('');

    it('names the open bills it was given, and leads to the floor', () => {
        const { tree, setSheet } = mount({ data: empty, openBills: 3 });
        const found = controls(tree);
        expect([...found.keys()].sort()).toEqual(['day', 'header', 'month', 'month_to_date', 'nothing_settled', 'online_gross',
            'online_net', 'report', 'today_gross', 'today_net', 'zone', 'cash_collection'].sort());
        const sentence = control(found, 'nothing_settled');
        expect(textOf(sentence)).toContain(glanceOpenBillsSentence(3));
        expect(press(sentence, setSheet)).toEqual({ href: '/dashboard/tables' });
    });

    it('says nothing about the floor when it has no count', () => {
        const { tree } = mount({ data: empty, openBills: null });
        const sentence = control(controls(tree), 'nothing_settled');
        expect(textOf(sentence)).toContain('Nothing has been settled yet today.');
        expect(textOf(sentence)).not.toContain('open on the floor');
        const zero = control(controls(mount({ data: empty, openBills: 0 }).tree), 'nothing_settled');
        expect(textOf(zero)).toContain('No bill is open on the floor either.');
    });

    it('with no floor to go to, the sentence explains the day instead', () => {
        const { tree, setSheet } = mount({ data: empty, canOpen: (p) => p !== '/dashboard/tables' && p !== '/dashboard/orders' });
        const o = press(control(controls(tree), 'nothing_settled'), setSheet);
        expect('sheet' in o && o.sheet.title).toBe(GLANCE_COPY.dayTitle);
    });
});

describe('who can go where', () => {
    it('a session that can open nothing still gets a dialog from every control, and no link', () => {
        const { tree, setSheet } = mount({ canOpen: nowhere });
        const found = controls(tree);
        expect(found.has('report')).toBe(false);
        expect([...found.keys()].sort()).toEqual(TRADING_DAY.filter((k) => k !== 'report').sort());
        for (const [id, el] of found) {
            const o = press(el, setSheet);
            expect([id, 'sheet' in o]).toEqual([id, true]);
            if ('sheet' in o) {
                const d = dialog(o.sheet, nowhere);
                expect([id, d.primary, d.secondary]).toEqual([id, null, null]);
            }
        }
    });

    it("the headline audience without web Reports lands on Analytics ON TODAY, and online has nowhere to go", () => {
        const canOpen = gate(apcManager);
        expect(canOpen('/dashboard/reports')).toBe(false);
        const { tree, setSheet } = mount({ canOpen });
        const found = controls(tree);
        const primaryOf = (id: string): string | null => {
            const o = press(control(found, id), setSheet);
            if (!('sheet' in o)) { throw new Error(id); }
            return dialog(o.sheet, canOpen).primary;
        };
        for (const id of ['today_net', 'today_gross', 'cash_collection', 'header', 'day']) {
            expect([id, primaryOf(id)]).toEqual([id, `/dashboard/analytics?from=${D}&to=${D}`]);
        }
        for (const id of ['month_to_date', 'month']) {
            expect([id, primaryOf(id)]).toEqual([id, `/dashboard/analytics?from=${M0}&to=${D}`]);
        }
        // Neither Accounting nor Analytics cuts trade by order type.
        for (const id of ['online_net', 'online_gross']) { expect([id, primaryOf(id)]).toEqual([id, null]); }
        // The counts link through to the same day.
        expect(press(control(found, 'bills'), setSheet)).toEqual({ href: `/dashboard/analytics?from=${D}&to=${D}` });
        expect(press(control(found, 'report'), setSheet)).toEqual({ href: `/dashboard/analytics?from=${D}&to=${D}` });
        expect(gate(owner)('/dashboard/reports')).toBe(true);
    });
});

describe('the refresh behind the empty-day sentence', () => {
    type Page = { total: number } | null;
    const page = (total: number): { total: number } => ({ total });
    interface Reader {
        read: { headline: () => Promise<OverviewHeadline | null>; openBills: jest.Mock<Promise<Page>, [string, { limit: number }]> };
        openBills: jest.Mock<Promise<Page>, [string, { limit: number }]>;
    }
    /** Hands out [heads] and [counts] in order; an Error in [counts] is a failed read. */
    const reader = (heads: (OverviewHeadline | null)[], counts: (Page | Error)[]): Reader => {
        const headlineRead = (): Promise<OverviewHeadline | null> => Promise.resolve(heads.shift() ?? null);
        const openBills = jest.fn<Promise<Page>, [string, { limit: number }]>(() => {
            const next = counts.shift();
            return next instanceof Error ? Promise.reject(next) : Promise.resolve(next ?? null);
        });
        return { read: { headline: headlineRead, openBills }, openBills };
    };
    const empty = headline({ today_bills: 0 });

    it('reads the count on EVERY refresh of an empty day, so it moves as tables open', async () => {
        const r = reader([empty, empty, empty], [page(0), page(3), page(1)]);
        expect(await readGlanceRefresh('rid', true, r.read)).toEqual({ headline: empty, openBills: 0 });
        expect(await readGlanceRefresh('rid', true, r.read)).toEqual({ headline: empty, openBills: 3 });
        expect(await readGlanceRefresh('rid', true, r.read)).toEqual({ headline: empty, openBills: 1 });
        expect(r.openBills).toHaveBeenCalledTimes(3);
        expect(r.openBills).toHaveBeenLastCalledWith('rid', { limit: 1 });
    });

    it('asks nothing on a trading day or of a session that cannot reach the floor', async () => {
        const trading = headline();
        const r = reader([trading, empty], [page(9), page(9)]);
        expect(await readGlanceRefresh('rid', true, r.read)).toEqual({ headline: trading, openBills: null });
        expect(await readGlanceRefresh('rid', false, r.read)).toEqual({ headline: empty, openBills: null });
        expect(r.openBills).not.toHaveBeenCalled();
    });

    it('a failed refresh clears the count; a failed or senseless count is left out', async () => {
        const r = reader([null, empty, empty, empty, empty], [null, new Error('offline'), page(Number.NaN), page(-1)]);
        expect(await readGlanceRefresh('rid', true, r.read)).toEqual({ headline: null, openBills: null });
        expect(r.openBills).not.toHaveBeenCalled();
        for (let i = 0; i < 4; i += 1) {
            expect(await readGlanceRefresh('rid', true, r.read)).toEqual({ headline: empty, openBills: null });
        }
    });

    it('the card refreshes through it, and keeps no one-shot read of its own', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', '..', 'components', 'headline-stats.tsx'), 'utf8')
            .replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        expect(src).toMatch(/const load = useCallback\(async \(\) => \{[\s\S]*?await readGlanceRefresh\(rid, floorOpen, \{ headline: getOverviewHeadline, openBills: getOpenBills \}\)[\s\S]*?setOpenBills\(next\.openBills\)[\s\S]*?\}, \[rid, floorOpen\]\)/);
        expect(src).toMatch(/setInterval\(\(\) => \{ void load\(\) \}, REFRESH_MS\)/);
        expect(src.match(/getOpenBills/g)).toHaveLength(2); // the import and the refresh
        expect(src.match(/getOverviewHeadline/g)).toHaveLength(2);
        // The card is drawn from that state, whole.
        expect(src).toMatch(/<HeadlineCard data=\{data\} loading=\{loading\} failed=\{failed\} openBills=\{openBills\}\s+canOpen=\{canOpen\} currencySymbol=\{currencySymbol\} sheet=\{sheet\} setSheet=\{setSheet\} \/>/);
        // HeadlineCard is hook-free, which is what lets this suite press it.
        const card = src.slice(src.indexOf('export function HeadlineCard('), src.indexOf('export function HeadlineStats('));
        expect(card.length).toBeGreaterThan(1000);
        expect(card).not.toMatch(/\buse[A-Z]\w*\(/);
    });
});
