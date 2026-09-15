// What these tests are actually protecting.
//
// The Reports workspace makes three promises that are expensive to break:
//   1. THE EXPORT IS THE SCREEN. Same columns, same order, same sort, same
//      rows. A filed sheet that differs from the grid it was taken from is the
//      failure mode that costs an auditor's trust in all fifteen reports at once.
//   2. A BLANK IS NOT A ZERO. These reports show gaps where the schema holds
//      nothing (no void authorizer, no recoverable KOT number, no resolvable
//      seating). Those must never render, sort or export as 0.
//   3. NOTHING IS INVENTED. No client-side subtotal, no computed difference,
//      and no total for a column the backend does not total.
//
// Everything below is pure: fixed rows in, strings out. No DOM, no fetch, no
// clock — the storage helpers are exercised against a stubbed localStorage.

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
    COLUMN_PREFS_VERSION,
    MIS_REPORTS,
    RUNGS_NOW_ON_BY_DEFAULT,
    buildExportMatrix,
    clockFromBasis,
    columnPrefsKey,
    compareCells,
    csvEscape,
    defaultHidden,
    drillTarget,
    exportBaseName,
    exportMoneyColumnIndex,
    exportSummaryLine,
    formatCell,
    formatMatrix,
    formatMoney,
    formatPercent,
    loadColumnPrefs,
    nextSort,
    pageCaption,
    reportDef,
    rowsOf,
    saveColumnPrefs,
    sheetColumnWidths,
    sortRows,
    toCsv,
    totalsLabelFor,
    visibleColumns,
    type MisColumn,
    type MisPage,
    type MisReportMeta,
    type MisRow,
} from '../mis-reports';
import { formatSheetDateTime } from '../tz';

const FMT = { timezone: 'Asia/Kolkata', currencySymbol: '₹' };

// A cut-down Order Summary: one of every column type, including a `total: true`
// column the backend does NOT total (`item_count`), which is the real shape.
const COLUMNS: MisColumn[] = [
    { key: 'bill_no', label: 'Bill No.', type: 'text' },
    { key: 'table_name', label: 'Table', type: 'text' },
    { key: 'covers', label: 'Covers', type: 'int' },
    { key: 'item_count', label: 'Items', type: 'int', total: true },
    { key: 'net', label: 'Net', type: 'money', total: true },
    { key: 'grand_total', label: 'Grand total', type: 'money', total: true },
    { key: 'share_pct', label: '% of sales', type: 'percent' },
    { key: 'refund', label: 'Refund', type: 'money', total: true, default_on: false },
];

const ROWS: MisRow[] = [
    { bill_no: '1002', table_name: 'T2', covers: 4, item_count: 6, net: 1200, grand_total: 1416, share_pct: 40.5, refund: 0 },
    { bill_no: '1001', table_name: 'T1', covers: 2, item_count: 3, net: 800.5, grand_total: 944.59, share_pct: 27.1, refund: null },
    { bill_no: '1003', table_name: null, covers: null, item_count: 4, net: 1150, grand_total: 1357, share_pct: 32.4, refund: 100 },
];

// Note the ABSENCE of item_count — the backend's ladder does not carry it.
const TOTALS: Record<string, unknown> = { net: 3150.5, grand_total: 3717.59, refund: 100, bills: 3 };

const META: MisReportMeta = {
    report: 'order_summary',
    title: 'Order Summary',
    window: { from: '2026-08-01', to: '2026-08-31', days: 31 },
    timezone: 'Asia/Kolkata',
    outlet_scope: 'outlet',
    outlet_id: 'o-1',
    outlet_name: 'Gaia Test / Indiranagar',
    generated_at: '2026-09-01T10:00:00.000Z',
    notes: ['Bills are counted on the day they were SETTLED.'],
};

describe('the catalogue', () => {
    it('carries exactly the fifteen reports this system can source, in the backend\'s own order', () => {
        // The order matters as well as the set: the screen merges the server's
        // catalogue over this one BY KEY and renders the server's order, so a
        // fallback that listed them differently would reshuffle the tab strip the
        // moment the catalogue request failed.
        expect(MIS_REPORTS).toHaveLength(15);
        expect(MIS_REPORTS.map((r) => r.key)).toEqual([
            'item_wise', 'discount', 'void_kot', 'bill_edit', 'sales_summary',
            'order_summary', 'executive_summary', 'cover_size_summary', 'settlement_summary',
            'nc_summary', 'service_charge_deny', 'group_summary', 'variation_summary',
            'tip_summary', 'counter_summary',
        ]);
    });

    it('states a clock for every report, and never guesses one', () => {
        // A report's clock is what its date range MEANS. Two reports over the same
        // fortnight on different clocks are not expected to reconcile, and a
        // toolbar that says "1–15 Aug" over both without saying which is how a
        // manager concludes the reports disagree with each other.
        for (const r of MIS_REPORTS) {
            expect(['settlement', 'order_placement', 'act_time']).toContain(r.clock);
        }
        // The three item-level reports share ONE clock, because they are the same
        // order lines re-cut and their totals are asserted equal server-side.
        expect(reportDef('item_wise')?.clock).toBe('order_placement');
        expect(reportDef('group_summary')?.clock).toBe('order_placement');
        expect(reportDef('variation_summary')?.clock).toBe('order_placement');
        // Counter Summary composes the same bill set as the Sales Summary, so it
        // must be on the same clock or the two could not agree.
        expect(reportDef('counter_summary')?.clock).toBe('settlement');
        expect(reportDef('sales_summary')?.clock).toBe('settlement');
        // A comp, a waiver and a tip are dated by the ACT, not by the settlement.
        expect(reportDef('nc_summary')?.clock).toBe('act_time');
        expect(reportDef('service_charge_deny')?.clock).toBe('act_time');
        expect(reportDef('tip_summary')?.clock).toBe('act_time');
    });

    it('takes the clock from the server\'s basis map, and keeps its own when the map is silent', () => {
        const basis = {
            settlement: ['sales_summary', 'counter_summary'],
            order_placement: ['item_wise'],
            act_time: ['nc_summary'],
        };
        expect(clockFromBasis(basis, 'counter_summary')).toBe('settlement');
        expect(clockFromBasis(basis, 'item_wise')).toBe('order_placement');
        expect(clockFromBasis(basis, 'nc_summary')).toBe('act_time');
        // NULL, not a default. A report the map does not name keeps the value this
        // build shipped with rather than being relabelled with the commonest clock
        // — which would mislabel precisely the one report that is different.
        expect(clockFromBasis(basis, 'tip_summary')).toBeNull();
        expect(clockFromBasis(undefined, 'tip_summary')).toBeNull();
        expect(clockFromBasis(null, 'tip_summary')).toBeNull();
        expect(clockFromBasis({ settlement: 'not-an-array' }, 'settlement')).toBeNull();
    });

    it('offers a drill-down wherever a row names one record, and nowhere else', () => {
        // A summary row is many bills; opening "one" of them would be a lie. The
        // six new reports split cleanly: the three ledgers name a record, the
        // three rollups do not.
        expect(reportDef('nc_summary')?.drill).toBe('bill_or_kot');
        expect(reportDef('service_charge_deny')?.drill).toBe('bill');
        expect(reportDef('tip_summary')?.drill).toBe('bill');
        expect(reportDef('group_summary')?.drill).toBe('none');
        expect(reportDef('variation_summary')?.drill).toBe('none');
        expect(reportDef('counter_summary')?.drill).toBe('none');
    });

    it('has no stub for a report the backend does not serve', () => {
        // The rule that kept the last six out of this list until their data
        // existed still applies to anything else: a tab that opens onto nothing
        // is a promise the numbers cannot keep. These are keys the backend has
        // never served, and the catalogue must not sprout one speculatively.
        for (const absent of ['tax_report', 'kot_report', 'hourly_sales', 'waiter_wise', 'nc_kot', 'modifier_wise']) {
            expect(reportDef(absent)).toBeUndefined();
        }
    });

    it('points every report at a real /reports/mis path and names its row array', () => {
        for (const r of MIS_REPORTS) {
            expect(r.path.startsWith('/reports/mis/')).toBe(true);
            expect(['rows', 'series', 'by_outlet']).toContain(r.rowsKey);
        }
    });

    it('reads the row array each report actually returns', () => {
        const sales = reportDef('sales_summary');
        const exec = reportDef('executive_summary');
        if (!sales || !exec) {throw new Error('catalogue is missing a report');}
        expect(rowsOf({ meta: META, columns: [], series: [{ bucket: '2026-08-01' }] }, sales)).toHaveLength(1);
        expect(rowsOf({ meta: META, columns: [], by_outlet: [{ outlet_id: 'a' }, { outlet_id: 'b' }] }, exec)).toHaveLength(2);
        // A payload missing its array is an empty table, never a crash.
        expect(rowsOf({ meta: META, columns: [] }, sales)).toEqual([]);
        expect(rowsOf(null, sales)).toEqual([]);
    });
});

describe('formatting — a blank is not a zero', () => {
    it('renders every empty value as an em-dash, never as 0', () => {
        for (const type of ['text', 'int', 'money', 'percent', 'datetime', 'date'] as const) {
            expect(formatCell(null, type, FMT)).toBe('—');
            expect(formatCell(undefined, type, FMT)).toBe('—');
            expect(formatCell('', type, FMT)).toBe('—');
        }
    });

    it('keeps a real zero distinguishable from a blank', () => {
        expect(formatCell(0, 'money', FMT)).toBe('₹0.00');
        expect(formatCell(0, 'int', FMT)).toBe('0');
        expect(formatCell(null, 'money', FMT)).toBe('—');
    });

    it('formats money to two decimals with the tenant currency symbol', () => {
        expect(formatMoney(1416, '₹')).toBe('₹1,416.00');
        expect(formatMoney(944.59, '₹')).toBe('₹944.59');
        // The minus goes OUTSIDE the symbol: "-₹100.00", never "₹-100.00".
        expect(formatMoney(-100, '₹')).toBe('-₹100.00');
        expect(formatMoney(null, '₹')).toBe('—');
    });

    it('signs a growth percentage so a fall cannot read as a rise', () => {
        expect(formatPercent(8.24, { signed: true })).toBe('+8.2%');
        expect(formatPercent(-8.24, { signed: true })).toBe('-8.2%');
        expect(formatPercent(8.24)).toBe('8.2%');
        expect(formatPercent(null)).toBe('—');
    });
});

describe('sorting', () => {
    it('sorts nulls LAST in both directions', () => {
        // A null here means "not captured". Floating it to the top of a
        // descending sort would bury the rows the reader came for.
        const asc = sortRows(ROWS, { key: 'covers', dir: 'asc' }, COLUMNS);
        const desc = sortRows(ROWS, { key: 'covers', dir: 'desc' }, COLUMNS);
        expect(asc[asc.length - 1]?.covers).toBeNull();
        expect(desc[desc.length - 1]?.covers).toBeNull();
    });

    it('sorts money numerically, not lexically', () => {
        const sorted = sortRows(ROWS, { key: 'net', dir: 'desc' }, COLUMNS);
        expect(sorted.map((r) => r.net)).toEqual([1200, 1150, 800.5]);
    });

    it('is stable for equal values', () => {
        const rows: MisRow[] = [
            { bill_no: 'a', net: 10 }, { bill_no: 'b', net: 10 }, { bill_no: 'c', net: 10 },
        ];
        expect(sortRows(rows, { key: 'net', dir: 'desc' }, COLUMNS).map((r) => r.bill_no)).toEqual(['a', 'b', 'c']);
    });

    it('never mutates the rows it was given', () => {
        const before = ROWS.map((r) => r.bill_no);
        sortRows(ROWS, { key: 'net', dir: 'asc' }, COLUMNS);
        expect(ROWS.map((r) => r.bill_no)).toEqual(before);
    });

    it('ignores a sort on a column that is not there', () => {
        expect(sortRows(ROWS, { key: 'nope', dir: 'asc' }, COLUMNS)).toHaveLength(3);
    });

    it('opens money columns descending and text columns ascending', () => {
        expect(nextSort(null, 'net', 'money').dir).toBe('desc');
        expect(nextSort(null, 'bill_no', 'text').dir).toBe('asc');
        // Clicking the same header flips it.
        expect(nextSort({ key: 'net', dir: 'desc' }, 'net', 'money').dir).toBe('asc');
    });

    it('does not let a junk value in a numeric column poison the order', () => {
        expect(compareCells('not-a-number', 5, 'money', 'asc')).toBe(1);
        expect(compareCells(5, 'not-a-number', 'money', 'asc')).toBe(-1);
    });
});

describe('column configuration', () => {
    it('starts from the backend layout — default_on:false columns are hidden', () => {
        expect(defaultHidden(COLUMNS)).toEqual(['refund']);
        expect(visibleColumns(COLUMNS, defaultHidden(COLUMNS)).map((c) => c.key)).not.toContain('refund');
    });

    it('keeps the server column ORDER regardless of what is hidden', () => {
        const shown = visibleColumns(COLUMNS, ['table_name', 'net']);
        expect(shown.map((c) => c.key)).toEqual(['bill_no', 'covers', 'item_count', 'grand_total', 'share_pct', 'refund']);
    });

    it('never renders a headerless grid', () => {
        // A stale pref (or a user determined to hide everything) must not produce
        // a blank rectangle the reader then has to work out how to escape.
        const shown = visibleColumns(COLUMNS, COLUMNS.map((c) => c.key));
        expect(shown.length).toBeGreaterThan(0);
    });

    it('ignores stored keys the backend no longer serves', () => {
        expect(visibleColumns(COLUMNS, ['gone_away']).map((c) => c.key)).toEqual(COLUMNS.map((c) => c.key));
    });

    it('is meaningless across reports — which is why the screen waits for matching columns', () => {
        // REGRESSION. The tab strip changes the active report before the new
        // payload lands, so for one render `columns` still belongs to the
        // PREVIOUS report. Deriving the default layout there hides the wrong
        // keys — silently, because unknown keys are ignored — and the new
        // report opens with every column on instead of the backend's layout.
        // The screen therefore applies preferences only once
        // `payload.meta.report` matches the active report.
        const otherReport: MisColumn[] = [
            { key: 'method', label: 'Payment mode', type: 'text' },
            { key: 'amount', label: 'Collected', type: 'money', total: true },
            { key: 'share_pct', label: '% of takings', type: 'percent', default_on: false },
        ];
        const wrongHidden = defaultHidden(COLUMNS); // ['refund'] — not a column of `otherReport`
        expect(visibleColumns(otherReport, wrongHidden).map((c) => c.key))
            .toEqual(['method', 'amount', 'share_pct']); // share_pct should have been hidden
        expect(visibleColumns(otherReport, defaultHidden(otherReport)).map((c) => c.key))
            .toEqual(['method', 'amount']);
    });

    it('scopes the stored layout per user AND per report', () => {
        expect(columnPrefsKey('emp-1', 'discount')).not.toBe(columnPrefsKey('emp-2', 'discount'));
        expect(columnPrefsKey('emp-1', 'discount')).not.toBe(columnPrefsKey('emp-1', 'void_kot'));
    });

    it('round-trips through storage and survives junk', () => {
        const store = new Map<string, string>();
        const stub = {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => { store.set(k, v); },
            removeItem: (k: string) => { store.delete(k); },
        };
        (globalThis as unknown as { window?: unknown }).window = { localStorage: stub };
        try {
            saveColumnPrefs('emp-1', 'discount', { hidden: ['reason'] });
            expect(loadColumnPrefs('emp-1', 'discount')).toEqual({ hidden: ['reason'] });
            // A value from an older build must fall back, not throw.
            store.set(columnPrefsKey('emp-1', 'discount'), '{not json');
            expect(loadColumnPrefs('emp-1', 'discount')).toBeNull();
            store.set(columnPrefsKey('emp-1', 'discount'), '{"hidden":"nope"}');
            expect(loadColumnPrefs('emp-1', 'discount')).toBeNull();
        } finally {
            delete (globalThis as unknown as { window?: unknown }).window;
        }
    });

    it('is a no-op on the server rather than throwing', () => {
        expect(loadColumnPrefs('emp-1', 'discount')).toBeNull();
        expect(() => { saveColumnPrefs('emp-1', 'discount', { hidden: [] }); }).not.toThrow();
    });

    // Client item 1 turned Round off (Sales), Service charge (Order, Counter) and
    // Tax (Counter) ON by default, so the visible rungs add up to Gross. A layout
    // saved before that still lists them as hidden — not because anyone chose to,
    // but because toggling ANY column saved the old default along with it — and
    // the grid, CSV, XLSX and PDF would keep printing Net + SC + Tax ≠ Gross.
    describe('a layout saved before the ladder rungs were turned on', () => {
        const withStore = (run: (store: Map<string, string>) => void): void => {
            const store = new Map<string, string>();
            (globalThis as unknown as { window?: unknown }).window = {
                localStorage: {
                    getItem: (k: string) => store.get(k) ?? null,
                    setItem: (k: string, v: string) => { store.set(k, v); },
                    removeItem: (k: string) => { store.delete(k); },
                },
            };
            try { run(store); } finally { delete (globalThis as unknown as { window?: unknown }).window; }
        };

        it('loads without the rung, keeps every column the user did hide, and is re-saved stamped', () => {
            withStore((store) => {
                // Exactly what origin/main's toggleColumn left behind: the old
                // default hidden list (round_off, nc_value) plus the user's own pick.
                store.set(columnPrefsKey('emp-1', 'sales_summary'), JSON.stringify({ hidden: ['round_off', 'nc_value', 'covers'] }));
                expect(loadColumnPrefs('emp-1', 'sales_summary')).toEqual({ hidden: ['nc_value', 'covers'] });
                expect(JSON.parse(store.get(columnPrefsKey('emp-1', 'sales_summary')) ?? '{}'))
                    .toEqual({ hidden: ['nc_value', 'covers'], v: COLUMN_PREFS_VERSION });

                store.set(columnPrefsKey('emp-1', 'order_summary'), JSON.stringify({ hidden: ['service_charge', 'refund', 'waiter'] }));
                expect(loadColumnPrefs('emp-1', 'order_summary')).toEqual({ hidden: ['refund', 'waiter'] });

                store.set(columnPrefsKey('emp-1', 'counter_summary'), JSON.stringify({ hidden: ['covers', 'service_charge', 'tax', 'refund'] }));
                expect(loadColumnPrefs('emp-1', 'counter_summary')).toEqual({ hidden: ['covers', 'refund'] });
            });
        });

        it('and the visible rungs then add up to Gross', () => {
            withStore((store) => {
                const ladder: MisColumn[] = [
                    { key: 'net', label: 'Net', type: 'money', total: true },
                    { key: 'service_charge', label: 'Service charge', type: 'money', total: true },
                    { key: 'tax', label: 'Tax', type: 'money', total: true },
                    { key: 'round_off', label: 'Round off', type: 'money', total: true },
                    { key: 'grand_total', label: 'Gross', type: 'money', total: true },
                ];
                const totals: Record<string, number> = { net: 5835, service_charge: 10, tax: 292.26, round_off: -0.26, grand_total: 6137 };
                store.set(columnPrefsKey('emp-1', 'sales_summary'), JSON.stringify({ hidden: ['round_off'] }));
                const shown = visibleColumns(ladder, loadColumnPrefs('emp-1', 'sales_summary')?.hidden ?? []);
                const rungs = shown.filter((c) => c.key !== 'grand_total').reduce((s, c) => s + (totals[c.key] ?? 0), 0);
                expect(Math.round(rungs * 100) / 100).toBe(totals.grand_total);
            });
        });

        it('runs ONCE: a rung hidden again on this build stays hidden', () => {
            withStore(() => {
                saveColumnPrefs('emp-1', 'sales_summary', { hidden: ['round_off'] });
                expect(loadColumnPrefs('emp-1', 'sales_summary')).toEqual({ hidden: ['round_off'] });
                expect(loadColumnPrefs('emp-1', 'sales_summary')).toEqual({ hidden: ['round_off'] });
            });
        });

        it('leaves every other report, and a key that merely looks like a rung, alone', () => {
            withStore((store) => {
                store.set(columnPrefsKey('emp-1', 'discount'), JSON.stringify({ hidden: ['round_off', 'tax'] }));
                expect(loadColumnPrefs('emp-1', 'discount')).toEqual({ hidden: ['round_off', 'tax'] });
                // Tax was always ON on the Order Summary; a hidden tax there is a choice.
                store.set(columnPrefsKey('emp-1', 'order_summary'), JSON.stringify({ hidden: ['tax'] }));
                expect(loadColumnPrefs('emp-1', 'order_summary')).toEqual({ hidden: ['tax'] });
                expect(RUNGS_NOW_ON_BY_DEFAULT).toEqual({
                    sales_summary: ['round_off'],
                    order_summary: ['service_charge'],
                    counter_summary: ['service_charge', 'tax'],
                });
            });
        });
    });
});

// Item Wise, Group Summary and Variation Summary lost their always-equal Net
// (net_amount) column in client item 1. The toast's money pick looked only for
// grand_total / net_amount / amount, so their "N rows · ₹X" quietly became "N rows".
describe('the export confirmation quotes the money', () => {
    const itemWise: MisColumn[] = [
        { key: 'item_name', label: 'Item', type: 'text' },
        { key: 'qty', label: 'Qty', type: 'int', total: true },
        { key: 'gross_amount', label: 'Item total', type: 'money', total: true },
    ];

    it('an Item Wise-shaped export (Item total, no Net) still carries its ₹ figure', () => {
        const m = buildExportMatrix(itemWise, [{ item_name: 'Dal', qty: 3, gross_amount: 450 }], { qty: 3, gross_amount: 450 });
        expect(exportMoneyColumnIndex(m.columns)).toBe(2);
        expect(exportSummaryLine(m, '₹')).toBe(`1 rows · ${formatMoney(450, '₹')}`);
    });

    it('the bill-level reports keep their pick — gross_amount is only the fallback', () => {
        const both: MisColumn[] = [
            ...itemWise,
            { key: 'grand_total', label: 'Gross', type: 'money', total: true },
        ];
        expect(exportMoneyColumnIndex(both)).toBe(3);
        const settlement: MisColumn[] = [
            { key: 'method', label: 'Method', type: 'text' },
            { key: 'amount', label: 'Collected', type: 'money', total: true },
            { key: 'net_amount', label: 'After refunds', type: 'money', total: true },
        ];
        expect(exportMoneyColumnIndex(settlement)).toBe(1);
        expect(exportMoneyColumnIndex(COLUMNS)).toBe(5);
    });

    it('no money column, or no totals row, is just the row count', () => {
        const m = buildExportMatrix([{ key: 'reason', label: 'Reason', type: 'text' }], [{ reason: 'x' }], null);
        expect(exportSummaryLine(m, '₹')).toBe('1 rows');
    });
    // export.ts delegating to exportSummaryLine is pinned in gross-net.test.ts,
    // beside the other source guards.
});

describe('the export is the screen', () => {
    const shown = visibleColumns(COLUMNS, defaultHidden(COLUMNS));
    const sorted = sortRows(ROWS, { key: 'net', dir: 'desc' }, COLUMNS);

    it('exports the visible columns, in the order shown, and no others', () => {
        const m = buildExportMatrix(shown, sorted, TOTALS);
        expect(m.header).toEqual(['Bill No.', 'Table', 'Covers', 'Items', 'Net', 'Grand total', '% of sales']);
        expect(m.header).not.toContain('Refund');
    });

    it('exports the rows in the order the grid sorted them', () => {
        const m = buildExportMatrix(shown, sorted, TOTALS);
        expect(m.body.map((r) => r[0])).toEqual(['1002', '1003', '1001']);
    });

    it('reflects a re-configured column set', () => {
        const custom = visibleColumns(COLUMNS, ['table_name', 'covers', 'share_pct']);
        const m = buildExportMatrix(custom, sorted, TOTALS);
        expect(m.header).toEqual(['Bill No.', 'Items', 'Net', 'Grand total', 'Refund']);
        expect(m.body[0]).toHaveLength(5);
    });

    it('keeps numbers NUMERIC so a spreadsheet can sum them', () => {
        const m = buildExportMatrix(shown, sorted, TOTALS);
        const netIndex = m.header.indexOf('Net');
        expect(m.body.map((r) => r[netIndex])).toEqual([1200, 1150, 800.5]);
        expect(typeof m.body[0]?.[netIndex]).toBe('number');
    });

    it('exports a blank as empty, never as 0', () => {
        const m = buildExportMatrix(shown, sorted, TOTALS);
        const coversIndex = m.header.indexOf('Covers');
        // Row "1003" has null covers.
        const row1003 = m.body.find((r) => r[0] === '1003');
        expect(row1003?.[coversIndex]).toBeNull();
    });

    it('totals ONLY the columns the backend totals — it invents nothing', () => {
        const m = buildExportMatrix(shown, sorted, TOTALS);
        expect(m.totals).not.toBeNull();
        const at = (label: string) => m.totals?.[m.header.indexOf(label)];
        expect(at('Net')).toBe(3150.5);
        expect(at('Grand total')).toBe(3717.59);
        // `item_count` is marked total:true but the ladder carries no value for
        // it. It must stay EMPTY — summing the visible rows would be a page
        // subtotal wearing a window total's clothes.
        expect(at('Items')).toBeNull();
        // A column that is not a total column is empty too.
        expect(at('Covers')).toBeNull();
    });

    it('labels the totals row, in the first column', () => {
        const m = buildExportMatrix(shown, sorted, TOTALS, 'Total · all 2,431 rows in range');
        expect(m.totals?.[0]).toBe('Total · all 2,431 rows in range');
    });

    it('omits the totals row entirely when the report totals nothing', () => {
        // Bill Edit is all text: there is nothing to add up.
        const textOnly: MisColumn[] = [{ key: 'at', label: 'Date & time', type: 'datetime' }];
        expect(buildExportMatrix(textOnly, [{ at: '2026-08-01T10:00:00Z' }], { edits: 4 }).totals).toBeNull();
        expect(buildExportMatrix(shown, sorted, null).totals).toBeNull();
    });
});

describe('CSV', () => {
    it('quotes what has to be quoted and doubles inner quotes', () => {
        expect(csvEscape('plain')).toBe('plain');
        expect(csvEscape('has,comma')).toBe('"has,comma"');
        expect(csvEscape('has"quote')).toBe('"has""quote"');
        expect(csvEscape('has\nnewline')).toBe('"has\nnewline"');
        expect(csvEscape(' padded ')).toBe('" padded "');
        expect(csvEscape(null)).toBe('');
        expect(csvEscape(1416)).toBe('1416');
    });

    it('defuses spreadsheet formula injection', () => {
        // A guest-typed name or a discount reason ends up in a finance workbook.
        // "=cmd|..." must arrive as text, not as something Excel evaluates.
        expect(csvEscape('=1+1')).toBe('"\t=1+1"');
        expect(csvEscape('+SUM(A1)')).toBe('"\t+SUM(A1)"');
        expect(csvEscape('-2+3')).toBe('"\t-2+3"');
        expect(csvEscape('@import')).toBe('"\t@import"');
        // A genuine negative NUMBER is untouched — it is not a string.
        expect(csvEscape(-100)).toBe('-100');
    });

    it('writes a BOM and CRLF so Excel on Windows renders ₹ correctly', () => {
        const csv = toCsv(buildExportMatrix(COLUMNS, ROWS, TOTALS));
        expect(csv.startsWith('﻿')).toBe(true);
        expect(csv).toContain('\r\n');
    });

    it('emits header + every row + the totals row, and nothing else', () => {
        const csv = toCsv(buildExportMatrix(COLUMNS, ROWS, TOTALS, 'Total'));
        const lines = csv.replace(/^﻿/, '').trimEnd().split('\r\n');
        expect(lines).toHaveLength(1 + ROWS.length + 1);
        expect(lines[0]).toContain('Bill No.');
        expect(lines[lines.length - 1]?.startsWith('Total')).toBe(true);
    });
});

describe('the printable matrix', () => {
    it('renders every cell the way the grid renders it', () => {
        const shown = visibleColumns(COLUMNS, defaultHidden(COLUMNS));
        const m = buildExportMatrix(shown, ROWS, TOTALS);
        const display = formatMatrix(m, FMT);
        expect(display[0]).toEqual(m.header);
        const netIndex = m.header.indexOf('Net');
        expect(display[1]?.[netIndex]).toBe(formatCell(1200, 'money', FMT));
        // The totals row is the last line and carries its label.
        expect(display[display.length - 1]?.[0]).toBe('Total');
    });

    // Cover Size Summary as the backend sends it: the first column is the party
    // size, an INT the backend does not total. The PDF formatted the label as a
    // number and printed "—" where the grid, the CSV and the sheet say "Total".
    const COVER_SIZE: MisColumn[] = [
        { key: 'party_size', label: 'Party size', type: 'int' },
        { key: 'parties', label: 'Parties', type: 'int', total: true },
        { key: 'bills', label: 'Bills', type: 'int', total: true },
        { key: 'covers', label: 'Covers', type: 'int', total: true },
        { key: 'net', label: 'Net', type: 'money', total: true },
        { key: 'grand_total', label: 'Gross', type: 'money', total: true },
        { key: 'spend_per_cover', label: 'Spend per cover (pre-tax)', type: 'money' },
        { key: 'share_pct', label: '% of gross', type: 'percent' },
    ];
    const COVER_ROWS: MisRow[] = [
        { party_size: 2, parties: 13, bills: 14, covers: 26, net: 36338.55, grand_total: 41971.04, spend_per_cover: 1397.64, share_pct: 84.29 },
        { party_size: 3, parties: 2, bills: 3, covers: 6, net: 6774.36, grand_total: 7824.38, spend_per_cover: 1129.06, share_pct: 15.71 },
    ];
    const COVER_TOTALS = { parties: 15, bills: 17, covers: 32, net: 43112.91, grand_total: 49795.42, gross: 43112.91 };

    it('prints the totals label, not "—", when the first column holds numbers (Cover Size Summary)', () => {
        const m = buildExportMatrix(COVER_SIZE, COVER_ROWS, COVER_TOTALS, 'Total', FMT.timezone);
        const display = formatMatrix(m, FMT);
        const last = display.length - 1;
        expect(display[last]?.[0]).toBe('Total');
        // The totals beside it are still formatted as the grid formats them.
        expect(display[last]?.[1]).toBe(formatCell(15, 'int', FMT));
        expect(display[last]?.[5]).toBe(formatCell(49795.42, 'money', FMT));
        expect(display[last]?.[6]).toBe('');
        // The body's party sizes are still numbers, formatted as numbers.
        expect(display[1]?.[0]).toBe(formatCell(2, 'int', FMT));
    });

    it('carries a paged label into a numeric first column the reader left after hiding the text ones', () => {
        // Order Summary with Bill No. and Table hidden: Covers (an int, untotalled) leads.
        const shown = visibleColumns(COLUMNS, ['bill_no', 'table_name']);
        expect(shown[0]?.type).toBe('int');
        const label = 'Total · all 2,431 rows in range';
        const display = formatMatrix(buildExportMatrix(shown, ROWS, TOTALS, label), FMT);
        expect(display[display.length - 1]?.[0]).toBe(label);
    });

    it('only the totals label is exempt: a totalled first column and a stray body string format as before', () => {
        const cols: MisColumn[] = [{ key: 'bills', label: 'Bills', type: 'int', total: true }, { key: 'net', label: 'Net', type: 'money', total: true }];
        const m = buildExportMatrix(cols, [{ bills: 'n/a', net: 10 }], { bills: 12345, net: 10 }, 'Total');
        const display = formatMatrix(m, FMT);
        // The first column is totalled, so the number wins the cell and is formatted.
        expect(display[2]?.[0]).toBe(formatCell(12345, 'int', FMT));
        // A non-number in a BODY int cell is still the honest gap.
        expect(display[1]?.[0]).toBe('—');
    });
});

describe('the totals row says what it is a total of', () => {
    const page = (over: Partial<MisPage>): MisPage => ({ limit: 100, offset: 0, total: 100, has_more: false, ...over });

    it('names the whole range when the grid is showing one page of many', () => {
        // Without this the reader adds up the 100 visible rows, gets a different
        // number, and stops trusting the report.
        expect(totalsLabelFor(page({ total: 2431 }), 100)).toBe('Total · all 2,431 rows in range');
    });

    it('says just "Total" when every row is on screen', () => {
        expect(totalsLabelFor(page({ total: 12 }), 12)).toBe('Total');
        expect(totalsLabelFor(undefined, 12)).toBe('Total');
    });

    it('captions the page honestly', () => {
        expect(pageCaption(page({ total: 2431, offset: 100, limit: 100 }), 100)).toBe('Showing 101–200 of 2,431');
        expect(pageCaption(page({ total: 0 }), 0)).toBe('');
    });
});

describe('drill-down targets', () => {
    it('opens a bill from a Discount or Order Summary row', () => {
        const d = reportDef('discount');
        if (!d) {throw new Error('missing');}
        expect(drillTarget({ bill_id: 'b-1' }, d)).toEqual({ kind: 'bill', id: 'b-1' });
    });

    it('opens a ticket from a Void KOT row', () => {
        const d = reportDef('void_kot');
        if (!d) {throw new Error('missing');}
        expect(drillTarget({ order_id: 'o-9', kot_no: null }, d)).toEqual({ kind: 'kot', id: 'o-9' });
    });

    it('opens whichever record a Bill Edit row names, preferring the bill', () => {
        const d = reportDef('bill_edit');
        if (!d) {throw new Error('missing');}
        expect(drillTarget({ bill_id: 'b-2', order_id: 'o-2' }, d)).toEqual({ kind: 'bill', id: 'b-2' });
        expect(drillTarget({ bill_id: null, order_id: 'o-2' }, d)).toEqual({ kind: 'kot', id: 'o-2' });
        expect(drillTarget({ bill_id: null, order_id: null }, d)).toBeNull();
    });

    it('never offers a drill-down on an aggregate row', () => {
        // A Sales/Executive/Cover-size/Settlement row is a roll-up over many
        // bills — there is no single record to open, and a control that looks
        // clickable and does nothing is worse than one that is plainly inert.
        for (const key of ['sales_summary', 'executive_summary', 'cover_size_summary', 'settlement_summary', 'item_wise']) {
            const d = reportDef(key);
            if (!d) {throw new Error(`missing ${key}`);}
            expect(d.drill).toBe('none');
            expect(drillTarget({ bill_id: 'b-1', order_id: 'o-1' }, d)).toBeNull();
        }
    });

    it('treats a stringified null as no target', () => {
        const d = reportDef('order_summary');
        if (!d) {throw new Error('missing');}
        expect(drillTarget({ bill_id: 'null' }, d)).toBeNull();
        expect(drillTarget({ bill_id: '  ' }, d)).toBeNull();
    });
});

describe('the export filename carries its own provenance', () => {
    it('names the report, the outlet and the window', () => {
        const d = reportDef('order_summary');
        if (!d) {throw new Error('missing');}
        expect(exportBaseName(META, d)).toBe('order-summary_Gaia-Test-Indiranagar_2026-08-01_to_2026-08-31');
    });

    it('says so when the scope is every outlet', () => {
        const d = reportDef('executive_summary');
        if (!d) {throw new Error('missing');}
        const allOutlets = { ...META, outlet_scope: 'all' as const, outlet_name: null };
        expect(exportBaseName(allOutlets, d)).toContain('all-outlets');
    });

    it('never produces a path separator or a quote in a filename', () => {
        const d = reportDef('discount');
        if (!d) {throw new Error('missing');}
        const nasty = { ...META, outlet_name: 'A/B "Café" \\ 2' };
        expect(exportBaseName(nasty, d)).not.toMatch(/["/\\]/);
    });
});

// --- The Void KOT report's new columns --------------------------------------
//
// Migrations 034-039 gave the void ledger a REASON, a VOID_KIND and a
// server-derived STAGE, and the backend added `reason` and `stage` to this
// report's `columns` descriptor. The grid is driven entirely by that descriptor,
// which is the whole reason the new columns need no client release — and is
// exactly the property that breaks quietly if anyone ever hard-codes a column
// list, a column COUNT or a column ORDER for a report on this side.
//
// THIS IS THE FOURTH TIME in this project that something was built and nothing
// fed it, so these assertions are deliberately about the FEEDING: a report whose
// server columns arrive and are not rendered fails here, and so does a blank
// reason turned into a guess or used to drop the row.

const VOID_KOT_COLUMNS: MisColumn[] = [
    { key: 'placed_at', label: 'Placed', type: 'datetime' },
    { key: 'voided_at', label: 'Voided', type: 'datetime' },
    { key: 'order_id', label: 'KOT / Order', type: 'text' },
    { key: 'table_name', label: 'Table', type: 'text' },
    { key: 'items_text', label: 'Items', type: 'text' },
    { key: 'order_type', label: 'Type', type: 'text' },
    { key: 'item_count', label: 'Lines', type: 'int', total: true },
    { key: 'qty', label: 'Qty', type: 'int', total: true },
    { key: 'value', label: 'Value', type: 'money', total: true },
    { key: 'voided_by', label: 'Voided by', type: 'text' },
    { key: 'reason', label: 'Reason', type: 'text' },
    { key: 'stage', label: 'Stage', type: 'text' },
];

// Three real shapes: a void through Controls (reason, kind and stage recorded),
// a plain status-change cancel (the ledger has no row for it), and one from
// before the ledger existed (the fields are absent rather than null).
const VOID_ROWS: MisRow[] = [
    {
        placed_at: '2026-08-14T12:30:00.000Z', voided_at: '2026-08-14T12:41:00.000Z',
        order_id: 'o-1', table_name: 'T1', order_type: 'Dine In',
        items_text: 'Biryani (Half) x2; Raita x1',
        items: [{ name: 'Biryani', variation: 'Half', quantity: 2, price: 270 }, { name: 'Raita', variation: null, quantity: 1, price: 100 }],
        item_count: 2, qty: 3, value: 640, voided_by: 'Asha',
        reason: 'Guest changed their mind', void_kind: 'guest_request', stage: 'before_print',
    },
    {
        placed_at: '2026-08-14T13:00:00.000Z', voided_at: '2026-08-14T13:02:00.000Z',
        order_id: 'o-2', table_name: 'T4', order_type: 'Dine In',
        item_count: 1, qty: 1, value: 220, voided_by: 'Ravi',
        reason: null, void_kind: null, stage: null,
    },
    {
        placed_at: '2026-08-10T19:00:00.000Z', voided_at: '2026-08-10T19:05:00.000Z',
        order_id: 'o-3', table_name: 'T9', order_type: 'Takeaway',
        item_count: 4, qty: 6, value: 1180, voided_by: null,
    },
];

const VOID_TOTALS = { voids: 3, qty: 10, value: 2040, item_count: 7 };

describe('the Void KOT report renders the columns the SERVER sends', () => {
    it("renders every server column, in the server's order, with nothing added or dropped", () => {
        // No stored prefs: the layout is the backend's, verbatim. `reason` and
        // `stage` appear here purely because the payload carried them.
        const shown = visibleColumns(VOID_KOT_COLUMNS, []);
        expect(shown.map((c) => c.key)).toEqual(VOID_KOT_COLUMNS.map((c) => c.key));
        expect(shown.map((c) => c.key)).toContain('reason');
        expect(shown.map((c) => c.key)).toContain('stage');
    });

    it('never hides a column the backend has just added, even behind a stale pref', () => {
        // A pref saved BEFORE this release lists the columns that existed then.
        // Prefs store what is HIDDEN, not what is shown, so the two new columns
        // reach everyone who already had a saved layout — the opposite
        // convention would have shipped them invisible to every existing user.
        const staleHidden = ['order_type'];
        const shown = visibleColumns(VOID_KOT_COLUMNS, staleHidden).map((c) => c.key);
        expect(shown).toContain('reason');
        expect(shown).toContain('stage');
        expect(shown).not.toContain('order_type');
    });

    it('renders a missing reason as a BLANK, never as a guess and never as a zero', () => {
        expect(formatCell(VOID_ROWS[1]?.reason, 'text', FMT)).toBe('—');
        expect(formatCell(VOID_ROWS[2]?.reason, 'text', FMT)).toBe('—');
        expect(formatCell(VOID_ROWS[1]?.stage, 'text', FMT)).toBe('—');
        // The one that WAS recorded shows exactly what was typed.
        expect(formatCell(VOID_ROWS[0]?.reason, 'text', FMT)).toBe('Guest changed their mind');
        expect(formatCell(VOID_ROWS[0]?.stage, 'text', FMT)).toBe('before_print');
    });

    it('keeps a row whose reason is blank — the row is the void, not the reason', () => {
        // Dropping these rows would hide the voids with NO recorded reason,
        // which are precisely the ones an auditor opened this document to find.
        const matrix = buildExportMatrix(visibleColumns(VOID_KOT_COLUMNS, []), VOID_ROWS, VOID_TOTALS, 'Total');
        expect(matrix.body).toHaveLength(3);
        const reasonAt = matrix.columns.findIndex((c) => c.key === 'reason');
        expect(reasonAt).toBeGreaterThan(-1);
        expect(matrix.body[1]?.[reasonAt]).toBeNull();
        expect(matrix.body[2]?.[reasonAt]).toBeNull();
        expect(matrix.body[0]?.[reasonAt]).toBe('Guest changed their mind');
    });

    it('exports a blank reason as an EMPTY cell, not the word null', () => {
        const matrix = buildExportMatrix(visibleColumns(VOID_KOT_COLUMNS, []), VOID_ROWS, VOID_TOTALS, 'Total');
        const rows = toCsv(matrix).split(/\r?\n/);
        const header = rows[0] ?? '';
        expect(header).toContain('Reason');
        expect(header).toContain('Stage');
        expect(rows[2]).not.toMatch(/null|undefined|unknown/i);
        expect(rows[1]).toContain('Guest changed their mind');
    });

    it('sorts the recorded reasons together and leaves the blanks at the bottom', () => {
        // Both directions. A descending sort that floated the blanks to the top
        // would bury every void that DOES name a reason.
        const cols = visibleColumns(VOID_KOT_COLUMNS, []);
        for (const dir of ['asc', 'desc'] as const) {
            const sorted = sortRows(VOID_ROWS, { key: 'reason', dir }, cols);
            expect(sorted).toHaveLength(3);
            expect(sorted[0]?.order_id).toBe('o-1');
        }
    });

    it('totals only the columns the backend totals — the new text columns total nothing', () => {
        const matrix = buildExportMatrix(visibleColumns(VOID_KOT_COLUMNS, []), VOID_ROWS, VOID_TOTALS, 'Total');
        const at = (key: string): number => matrix.columns.findIndex((c) => c.key === key);
        expect(matrix.totals?.[at('value')]).toBe(2040);
        expect(matrix.totals?.[at('reason')]).toBeNull();
        expect(matrix.totals?.[at('stage')]).toBeNull();
    });

    it('still opens the ticket behind a row now that the row is wider', () => {
        const d = reportDef('void_kot');
        if (!d) {throw new Error('missing');}
        expect(drillTarget(VOID_ROWS[1] ?? {}, d)).toEqual({ kind: 'kot', id: 'o-2' });
    });

    // "Item names should show up properly in the void KOT reports in the Excel."
    // The row always carried an `items` ARRAY, and an array is not a cell. The
    // server now sends the names as one text column; these pin that it reaches
    // the file as the plain string, and that the array never does.
    it('exports the Items column as the plain string the server wrote, never [object Object]', () => {
        const matrix = buildExportMatrix(visibleColumns(VOID_KOT_COLUMNS, []), VOID_ROWS, VOID_TOTALS, 'Total', 'Asia/Kolkata');
        const at = matrix.header.indexOf('Items');
        expect(at).toBe(matrix.header.indexOf('Table') + 1);
        expect(matrix.body[0]?.[at]).toBe('Biryani (Half) x2; Raita x1');
        // A row the server could name nothing on is a blank, not a guess.
        expect(matrix.body[1]?.[at]).toBeNull();
        const csv = toCsv(matrix);
        expect(csv).toContain('Biryani (Half) x2; Raita x1');
        expect(csv).not.toContain('[object Object]');
        expect(matrix.totals?.[at]).toBeNull();
    });
});

describe('an exported instant reads as the restaurant clock, year first', () => {
    // CSV and Excel used to carry the server's UTC ISO text. A void rung at
    // 18:00 in Kolkata read "2026-08-14T12:30:00.000Z" in the sheet. The grid's
    // own "14/08/26 18:00" is no answer for a FILE: Excel on a month-first locale
    // reads "01/09/26" as 9 January, and neither form sorts in date order.
    const shown = visibleColumns(VOID_KOT_COLUMNS, []);

    it('writes each datetime cell as the restaurant wall clock, year first, in CSV and Excel alike', () => {
        const matrix = buildExportMatrix(shown, VOID_ROWS, VOID_TOTALS, 'Total', FMT.timezone);
        const placed = matrix.header.indexOf('Placed');
        const voided = matrix.header.indexOf('Voided');
        expect(matrix.body[0]?.[placed]).toBe('2026-08-14 18:00');
        expect(matrix.body[0]?.[voided]).toBe('2026-08-14 18:11');
        const csv = toCsv(matrix);
        expect(csv).toContain('2026-08-14 18:00,2026-08-14 18:11,');
        expect(csv).not.toContain('2026-08-14T12:30:00.000Z');
        // The grid's day-first form never reaches a file.
        expect(csv).not.toContain('14/08/26');
    });

    it('sorts in date order even as plain text, across a month and a year', () => {
        const cols: MisColumn[] = [{ key: 'at', label: 'Date & time', type: 'datetime' }];
        const instants = ['2026-09-02T04:30:00.000Z', '2026-09-14T04:30:00.000Z', '2025-09-14T04:30:00.000Z', '2026-10-01T04:30:00.000Z'];
        const cells = buildExportMatrix(cols, instants.map((at) => ({ at })), null, 'Total', FMT.timezone).body.map((r) => String(r[0]));
        const byText = [...cells].sort();
        const byInstant = [...instants].sort().map((at) => formatSheetDateTime(at, FMT.timezone));
        expect(byText).toEqual(byInstant);
    });

    it('is generic by column type: any report, any datetime column, any zone', () => {
        const cols: MisColumn[] = [{ key: 'at', label: 'Date & time', type: 'datetime' }, { key: 'note', label: 'Note', type: 'text' }];
        const rows = [{ at: '2026-08-01T20:00:00.000Z', note: '2026-08-01T20:00:00.000Z' }];
        const ny = buildExportMatrix(cols, rows, null, 'Total', 'America/New_York');
        expect(ny.body[0]?.[0]).toBe('2026-08-01 16:00');
        // Only the column TYPE decides. A text column holding ISO-looking text is
        // somebody's words and stays exactly as written.
        expect(ny.body[0]?.[1]).toBe('2026-08-01T20:00:00.000Z');
    });

    it('the web and the owner app write the same string for the same instant and zone', () => {
        // THE SAME TABLE is pinned in the app's reports_module_test.dart
        // (RestaurantTime.sheet). Change one and the other fails.
        const PARITY: [string, string, string][] = [
            ['2026-09-14T13:06:36.104Z', 'Asia/Kolkata', '2026-09-14 18:36'],
            ['2026-09-14T18:30:00.000Z', 'Asia/Kolkata', '2026-09-15 00:00'],
            ['2026-01-15T17:00:00.000Z', 'America/New_York', '2026-01-15 12:00'],
            ['2026-07-15T17:00:00.000Z', 'America/New_York', '2026-07-15 13:00'],
        ];
        const cols: MisColumn[] = [{ key: 'at', label: 'At', type: 'datetime' }];
        for (const [at, zone, want] of PARITY) {
            expect(formatSheetDateTime(at, zone)).toBe(want);
            expect(buildExportMatrix(cols, [{ at }], null, 'Total', zone).body[0]?.[0]).toBe(want);
        }
    });

    it('the PDF shows the grid format, read back in the restaurant zone rather than the viewer zone', () => {
        // 1 Feb 10:00 in Kolkata. Read back as a browser-zone date, or month-first,
        // it would print a different day or a different hour.
        const cols: MisColumn[] = [{ key: 'at', label: 'Date & time', type: 'datetime' }];
        const matrix = buildExportMatrix(cols, [{ at: '2026-02-01T04:30:00.000Z' }], null, 'Total', FMT.timezone);
        expect(matrix.body[0]?.[0]).toBe('2026-02-01 10:00');
        expect(formatMatrix(matrix, FMT)[1]?.[0]).toBe('01/02/26 10:00');
        // A zone far from any machine running this suite, either side of a DST change.
        const opts = { timezone: 'America/New_York', currencySymbol: '$' };
        for (const at of ['2026-01-15T17:00:00.000Z', '2026-07-15T17:00:00.000Z']) {
            const m = buildExportMatrix(cols, [{ at }], null, 'Total', opts.timezone);
            expect(formatMatrix(m, opts)[1]?.[0]).toBe(formatCell(at, 'datetime', opts));
        }
    });

    it('keeps a malformed stamp visible rather than blanking it', () => {
        const cols: MisColumn[] = [{ key: 'at', label: 'Date & time', type: 'datetime' }];
        const matrix = buildExportMatrix(cols, [{ at: 'not-a-date' }, { at: null }], null, 'Total', FMT.timezone);
        expect(matrix.body[0]?.[0]).toBe('not-a-date');
        expect(matrix.body[1]?.[0]).toBeNull();
        expect(formatMatrix(matrix, FMT)[1]?.[0]).toBe('not-a-date');
    });

    it('the Reports screen hands the grid zone to the export', () => {
        // Built but never fed is this project's most repeated bug: the matrix only
        // localises when the screen passes the zone it formats the grid in.
        const page = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'dashboard', 'reports', 'page.tsx'), 'utf8');
        expect(page).toMatch(/buildExportMatrix\(shownColumns, exportRows, totals, totalsLabelFor\(page, exportRows\.length\), formatOpts\.timezone\)/);
        expect(page).toMatch(/const formatOpts = useMemo\(\(\) => \(\{ timezone, currencySymbol \}\)/);
    });
});

describe('a spreadsheet column is as wide as its widest cell', () => {
    // Excel lets text spill into the next cell only when that cell is empty, and
    // the Void KOT Items column has a Type cell beside it on every row. A column
    // narrower than its text shows the text cut off when the file opens.
    const shown = visibleColumns(VOID_KOT_COLUMNS, []);
    // A real ticket from the client's own day of voids (14 Sep), 115 characters.
    const LONG = 'BOTTLE WATER x1; CRISP WRAPPED COTTAGE CHEESE x1; BAINGAN BHARTHA KULCHA x1; ENOKII TEMPURA x1; HOUSE FRIED RICE x1';

    it('the Items column fits the longest ticket, which the old 42-character cap cut off', () => {
        const rows = [{ ...VOID_ROWS[0], items_text: LONG }, ...VOID_ROWS.slice(1)];
        const matrix = buildExportMatrix(shown, rows, VOID_TOTALS, 'Total', FMT.timezone);
        const widths = sheetColumnWidths(matrix);
        const at = matrix.header.indexOf('Items');
        expect(LONG.length).toBeGreaterThan(42);
        expect(widths[at]).toBeGreaterThanOrEqual(LONG.length);
        expect(widths).toHaveLength(matrix.header.length);
    });

    it('a header, a totals label and a number count toward the width; nothing is under 10 or over 250', () => {
        const cols: MisColumn[] = [
            { key: 'a', label: 'A very long column heading', type: 'text' },
            { key: 'n', label: 'N', type: 'int', total: true },
            { key: 'x', label: 'X', type: 'text' },
        ];
        const matrix = buildExportMatrix(cols, [{ a: 'x', n: 1234567890123, x: 'y'.repeat(400) }], { n: 1 }, 'TOTAL (whole period, every outlet)');
        expect(sheetColumnWidths(matrix)).toEqual([
            'TOTAL (whole period, every outlet)'.length + 2,
            '1234567890123'.length + 2,
            250,
        ]);
        expect(sheetColumnWidths(buildExportMatrix([{ key: 'q', label: 'Q', type: 'int' }], [{ q: 1 }], null))).toEqual([10]);
    });

    it('the Excel writer uses it', () => {
        // Built but never called is this project's most repeated bug.
        const exporter = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'dashboard', 'reports', 'export.ts'), 'utf8');
        expect(exporter).toMatch(/sheet\['!cols'\] = sheetColumnWidths\(ctx\.matrix\)\.map\(\(wch\) => \(\{ wch \}\)\);/);
    });
});
