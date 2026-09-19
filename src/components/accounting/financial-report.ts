// THE PRINTABLE FINANCIAL REPORT — web copy of Flutter's `_exportPdf`
// (modules.dart 22524–22576): restaurant name, "Financial report · from to
// to", a P&L block, a GST block per rate, and a Sales block whose lines come
// from lib/gross-net.ts — the ONE place that decides which key each word
// reads, because the PDF is the copy that gets filed.
//
// Pure document construction (string in, string out), printed through the
// browser's own dialog exactly like the Reports exports
// (src/app/dashboard/reports/export.ts): "Save as PDF" is the default
// destination on every desktop platform and costs no dependency. Same-origin
// iframe rather than window.open, because a popup not born from a direct link
// click is blocked by default and a blocked export looks like a dead button.
//
// Money is printed as "Rs 1234.56", matching the Flutter PDF glyph-for-glyph —
// the two clients' filed documents must agree line for line.

import { escapeHtml } from '@/lib/mis-print';
import { accountingSalesPdfLines } from '@/lib/gross-net';

export interface FinancialReportInput {
    restaurantName: string;
    from: string;
    to: string;
    /** The raw /reports/pnl payload. */
    pnl: object;
    /** The raw /reports/gst payload. */
    gst: object;
    /** The raw /reports/sales payload. */
    sales: object;
}

/** "Rs 1234.56", or "-" when the server sent nothing usable (Flutter `money`). */
export const financialMoney = (v: unknown): string => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.trim()) : NaN;
    return Number.isFinite(n) ? `Rs ${n.toFixed(2)}` : '-';
};

const kv = (label: string, value: unknown, bold = false): string => {
    const weight = bold ? 'font-weight:700;' : '';
    return (
        `<div class="kv" style="${weight}">` +
        `<span>${escapeHtml(label)}</span>` +
        `<span>${escapeHtml(financialMoney(value))}</span>` +
        `</div>`
    );
};

/** The whole printable document, self-contained HTML. */
export const buildFinancialReportHtml = (input: FinancialReportInput): string => {
    const { restaurantName, from, to } = input;
    const pnl = input.pnl as Record<string, unknown>;
    const gst = input.gst as Record<string, unknown>;
    const sales = input.sales as Record<string, unknown>;
    const byRate = Array.isArray(gst.by_rate) ? (gst.by_rate as Record<string, unknown>[]) : [];

    const pnlBlock = [
        kv('Gross sales', pnl.gross_sales),
        kv('Refunds', pnl.refunds),
        kv('Tax collected (pass-through)', pnl.tax_collected),
        kv('Revenue ex-tax (after refunds)', pnl.net_revenue),
        kv('Total expenses', pnl.total_expenses),
        kv('Net profit', pnl.net_profit, true),
    ].join('');

    const gstBlock =
        byRate
            .map((t) =>
                kv(
                    `${typeof t.name === 'string' ? t.name : ''} (${typeof t.percentage === 'number' || typeof t.percentage === 'string' ? String(t.percentage) : ''}%)  on ${financialMoney(t.taxable)}`,
                    t.tax,
                ),
            )
            .join('') + kv('Total tax', gst.total_tax, true);

    // Gross and Net in the client's words. The old "Net sales (after refunds)"
    // line was Gross less refunds, tax and all — it is still here, named for
    // what it is. Which key each line reads is decided in lib/gross-net.ts.
    const salesBlock = accountingSalesPdfLines(sales)
        .map((line) => kv(line.label, line.value, line.bold))
        .join('');

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Financial report</title>
<style>
  @page { size: A4 portrait; margin: 18mm; }
  * { box-sizing: border-box; }
  body { font-family: Helvetica, Arial, sans-serif; color: #000; margin: 0; }
  .center { text-align: center; }
  .name { font-size: 18px; font-weight: 700; }
  .sub { font-size: 10px; margin-top: 2px; }
  h2 { font-size: 14px; font-weight: 700; margin: 16px 0 0; }
  hr { border: 0; border-top: 1px solid #000; margin: 4px 0 2px; }
  .kv { display: flex; justify-content: space-between; font-size: 11px; padding: 2px 0; }
  .kv span:last-child { white-space: nowrap; padding-left: 12px; }
</style>
</head>
<body>
  <div class="center name">${escapeHtml(restaurantName)}</div>
  <div class="center sub">Financial report · ${escapeHtml(from)} to ${escapeHtml(to)}</div>
  <div style="height:12px"></div>
  <h2>Profit &amp; Loss</h2>
  <hr>
  ${pnlBlock}
  <h2>GST / Tax collected</h2>
  <hr>
  ${gstBlock}
  <h2>Sales</h2>
  <hr>
  ${salesBlock}
</body>
</html>`;
};

/**
 * Hand the document to the browser's print dialog through an off-screen
 * same-origin iframe, torn down after printing.
 */
export const printFinancialReport = (html: string): void => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    document.body.appendChild(frame);

    const cleanup = (): void => {
        setTimeout(() => { frame.remove(); }, 1000);
    };
    frame.onload = () => {
        try {
            const win = frame.contentWindow;
            if (!win) { cleanup(); return; }
            win.focus();
            win.print();
        } catch {
            /* print refused (headless, kiosk) — the frame is removed anyway */
        }
        cleanup();
    };
    // srcdoc keeps the document same-origin without a Blob URL, which some
    // browsers treat as a cross-origin frame and refuse to print from.
    frame.srcdoc = html;
};
