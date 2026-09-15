"use client"

// EXPORTING A CONTROL REPORT.
//
// THE RULE: an export is cut from the SAME selection the grid just rendered —
// the same window, outlet, search and sort, and the same columns the user
// configured. `buildExportMatrix` in @/lib/mis-reports produces that selection
// once, and all three writers below consume it. There is no second query and no
// server-side re-derivation, so a sheet cannot quietly disagree with the screen
// it was taken from. That is not a nicety: the exported file is the version that
// gets filed, and a filed number that differs from the one on screen is how fifteen
// reports lose an auditor at once.
//
// WHY THE CLIENT AND NOT THE `.csv` ROUTES: the backend serves
// /reports/mis/*.csv, and those are correct — but they are cut from the SERVER's
// default column set and the server's row order, and they know nothing about
// the columns this user turned off or the header they just sorted by. Using
// them would reintroduce exactly the drift this rule exists to prevent.
//
// NO NEW DEPENDENCY. `xlsx` was already in package.json (the Menu screen reads
// workbooks with it), so Excel is a dynamic import of a module that already
// ships. PDF is the browser's own print pipeline driven through a hidden
// iframe — a PDF library would be ~300KB on every dashboard load to reproduce
// something Chrome, Edge and Safari all do natively and better.

import {
    exportBaseName,
    formatMoney,
    sheetColumnWidths,
    toCsv,
    type ExportMatrix,
    type FormatOptions,
    type MisReportDef,
    type MisReportMeta,
} from '@/lib/mis-reports';
import { buildPrintDocument } from '@/lib/mis-print';
import { formatFullDateTime } from '@/lib/tz';

export type ExportFormat = 'csv' | 'excel' | 'pdf';

export interface ExportContext {
    matrix: ExportMatrix;
    meta: MisReportMeta | null;
    def: MisReportDef;
    format: FormatOptions;
    /** What the user typed in the search box, so the file records its own filter. */
    search: string;
    /** Which column the grid was sorted by, in words. */
    sortLabel: string;
    /** True when the body is every row in range, not just the visible page. */
    wholeRange: boolean;
}

/** Hand the browser a file. */
const download = (blob: Blob, filename: string): void => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked on the next tick, not synchronously: Safari has historically
    // cancelled the download when the object URL disappears in the same frame.
    setTimeout(() => { URL.revokeObjectURL(url); }, 2000);
};

/**
 * The provenance block — what this file is, cut when, over what, filtered how.
 *
 * On a document someone files, "Sales Summary.csv" with no window on it is
 * nearly useless six months later, and actively dangerous if it gets compared
 * against a different month's figures. Every writer below carries this; CSV
 * carries it in the filename, the other two carry it on the page.
 */
const provenance = (ctx: ExportContext): [string, string][] => {
    const m = ctx.meta;
    const rows: [string, string][] = [
        ['Report', m?.title ?? ctx.def.title],
        ['Outlet', m?.outlet_scope === 'all' ? 'All outlets (combined)' : (m?.outlet_name ?? '—')],
        ['Date range', m ? `${m.window.from} to ${m.window.to} (${String(m.window.days)} day${m.window.days === 1 ? '' : 's'}, both inclusive)` : '—'],
        ['Timezone', m ? `${m.timezone} — every date and total is bucketed on the restaurant's own calendar day` : '—'],
        ['Generated', m ? formatFullDateTime(m.generated_at, m.timezone) : '—'],
        ['Rows', ctx.wholeRange ? `${String(ctx.matrix.body.length)} (every row in range)` : `${String(ctx.matrix.body.length)} (the page on screen)`],
        ['Search filter', ctx.search.trim() || '(none)'],
        ['Sorted by', ctx.sortLabel || '(report default)'],
        ['Columns', ctx.matrix.header.join(', ')],
    ];
    if (m?.window.clamped) {
        rows.push(['Note', 'The requested range was longer than this system reports on and was shortened — the dates above are the range actually measured.']);
    }
    return rows;
};

// --- CSV ---------------------------------------------------------------------

/**
 * Pure table: header, body, totals. Nothing else.
 *
 * Deliberately NO provenance rows in the file — a CSV's whole value is that it
 * parses, and leading metadata lines break every naive importer that will ever
 * be pointed at it. The window and the outlet ride in the FILENAME instead.
 */
export const exportCsv = (ctx: ExportContext): void => {
    download(
        new Blob([toCsv(ctx.matrix)], { type: 'text/csv;charset=utf-8' }),
        `${exportBaseName(ctx.meta, ctx.def)}.csv`,
    );
};

// --- Excel -------------------------------------------------------------------

/**
 * Two sheets: the table, and where it came from.
 *
 * The table sheet stays a clean rectangle so `=SUM(...)` works on the first
 * try, and the provenance that a CSV cannot carry without breaking goes on its
 * own sheet where it can be read but never parsed by accident.
 */
export const exportExcel = async (ctx: ExportContext): Promise<void> => {
    const XLSX = await import('xlsx');
    const aoa: (string | number | null)[][] = [ctx.matrix.header, ...ctx.matrix.body];
    if (ctx.matrix.totals) {aoa.push(ctx.matrix.totals);}

    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    // Give every column a width from its widest cell so the sheet opens readable
    // instead of as a wall of #### or a dish list cut off by the next column.
    // sheetColumnWidths says why there is no smaller cap.
    sheet['!cols'] = sheetColumnWidths(ctx.matrix).map((wch) => ({ wch }));
    // Freeze the header row: on a 500-row settlement report, scrolling past the
    // headings is the difference between reading a column and guessing at it.
    sheet['!freeze'] = { xSplit: '0', ySplit: '1', topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };

    const about = XLSX.utils.aoa_to_sheet([['About this export'], [], ...provenance(ctx)]);
    about['!cols'] = [{ wch: 16 }, { wch: 96 }];
    if (ctx.meta?.notes.length) {
        XLSX.utils.sheet_add_aoa(about, [[], ['How these numbers are counted'], ...ctx.meta.notes.map((n) => ['', n])], { origin: -1 });
    }

    const wb = XLSX.utils.book_new();
    // Excel rejects a sheet name over 31 chars or carrying []:*?/\ — the report
    // titles are all short and clean, but the cap is cheap insurance.
    XLSX.utils.book_append_sheet(wb, sheet, (ctx.meta?.title ?? ctx.def.title).replace(/[[\]:*?/\\]/g, '').slice(0, 31) || 'Report');
    XLSX.utils.book_append_sheet(wb, about, 'About');
    XLSX.writeFile(wb, `${exportBaseName(ctx.meta, ctx.def)}.xlsx`);
};

// --- PDF ---------------------------------------------------------------------

/**
 * A printable document, handed to the browser's own print dialog — where "Save
 * as PDF" is the default destination on every desktop platform.
 *
 * The document itself is built by `buildPrintDocument` in @/lib/mis-print, which
 * is pure and unit-tested; only the plumbing lives here. That split matters:
 * this document interpolates untrusted strings (a guest name, a discount reason,
 * a table label), so its escaping needs a test, and a test cannot drive an
 * iframe that opens a print dialog.
 *
 * An IFRAME rather than `window.open`: a popup is blocked by default in most
 * browsers when it is not the direct result of a click on a link, and a blocked
 * export looks to the user like a button that does nothing. The iframe is
 * same-origin, off-screen, and torn down after printing.
 */
export const exportPdf = (ctx: ExportContext, displayRows: string[][]): void => {
    const [header, ...rows] = displayRows;
    if (!header) {return;}

    const doc = buildPrintDocument({
        title: ctx.meta?.title ?? ctx.def.title,
        blurb: ctx.def.blurb,
        provenance: provenance(ctx),
        notes: ctx.meta?.notes ?? [],
        header,
        rows,
        numeric: ctx.matrix.columns.map((c) => c.type === 'money' || c.type === 'int' || c.type === 'percent'),
        hasTotals: ctx.matrix.totals !== null,
    });

    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    document.body.appendChild(frame);

    const cleanup = () => { setTimeout(() => { frame.remove(); }, 1000); };
    frame.onload = () => {
        try {
            const win = frame.contentWindow;
            if (!win) {cleanup(); return;}
            win.focus();
            win.print();
        } catch {/* print refused (headless, kiosk) — the frame is removed anyway */}
        cleanup();
    };
    // srcdoc keeps the document same-origin without a Blob URL, which some
    // browsers treat as a cross-origin frame and refuse to print from.
    frame.srcdoc = doc;
};

/** Run whichever the user picked. Returns a message for the toast. */
export const runExport = async (format: ExportFormat, ctx: ExportContext, displayRows: string[][]): Promise<string> => {
    if (format === 'csv') {exportCsv(ctx); return 'CSV downloaded';}
    if (format === 'excel') {await exportExcel(ctx); return 'Excel workbook downloaded';}
    exportPdf(ctx, displayRows);
    return 'Opening the print dialog — choose "Save as PDF"';
};

/** A one-line summary of the money on screen, for the export confirmation toast. */
export const exportSummary = (ctx: ExportContext): string => {
    const totalIndex = ctx.matrix.columns.findIndex((c) => c.key === 'grand_total' || c.key === 'net_amount' || c.key === 'amount');
    if (totalIndex < 0 || !ctx.matrix.totals) {return `${String(ctx.matrix.body.length)} rows`;}
    const value = ctx.matrix.totals[totalIndex];
    if (typeof value !== 'number') {return `${String(ctx.matrix.body.length)} rows`;}
    return `${String(ctx.matrix.body.length)} rows · ${formatMoney(value, ctx.format.currencySymbol)}`;
};
