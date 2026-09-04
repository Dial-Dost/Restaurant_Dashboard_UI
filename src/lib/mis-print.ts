// THE PRINTABLE CONTROL REPORT — pure document construction.
//
// Split out of the export runner so it can be tested. Everything here is a
// string in, a string out: no DOM, no iframe, no `window.print()`. The app-side
// runner (`src/app/dashboard/reports/export.ts`) does the plumbing — build this
// document, drop it into a hidden same-origin iframe, and let the browser's own
// print pipeline turn it into a PDF, which is where "Save as PDF" already lives
// on every desktop platform and costs no dependency.
//
// WHY IT MATTERS THAT THIS IS TESTABLE: it renders untrusted strings. A guest
// name, a discount reason and a table label all reach this document, and a
// report that a `<script>` in a discount reason could rewrite is not a control
// document. Every interpolation below goes through `escapeHtml`, and the tests
// pin that.

/** HTML-escape a value for text and attribute contexts alike. */
export const escapeHtml = (s: string): string =>
    s.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

export interface PrintDocument {
    /** Report name, e.g. "Settlement Summary". */
    title: string;
    /** One line saying what the document is for. */
    blurb: string;
    /** Label/value pairs: window, outlet, generated-at, filters, sort, columns. */
    provenance: readonly (readonly [string, string])[];
    /** The backend's caveats, verbatim. */
    notes: readonly string[];
    /** Column headers, in the order shown. */
    header: readonly string[];
    /** Body rows, already rendered as display strings — the last is the TOTALS
     *  row when `hasTotals` is true. */
    rows: readonly (readonly string[])[];
    /** Per column: true when it is money/count/percent and should right-align. */
    numeric: readonly boolean[];
    hasTotals: boolean;
}

/**
 * A4 landscape, header repeated on every page, totals row emphasised.
 *
 * `thead { display: table-header-group }` is what repeats the headings across
 * pages — a four-page settlement report with headings only on page one is
 * unreadable on paper, which is the form these documents are most often read in.
 * `tr { page-break-inside: avoid }` stops a row being sliced in half by a page
 * boundary, because half a money row is a misreadable money row.
 */
export const buildPrintDocument = (doc: PrintDocument): string => {
    const esc = escapeHtml;
    const numAt = (i: number) => (doc.numeric[i] ? ' class="num"' : '');

    const headHtml = doc.header.map((h, i) => `<th${numAt(i)}>${esc(h)}</th>`).join('');

    const bodyHtml = doc.rows
        .map((row, rowIndex) => {
            const isTotals = doc.hasTotals && rowIndex === doc.rows.length - 1;
            const cells = row.map((cell, i) => `<td${numAt(i)}>${esc(cell)}</td>`).join('');
            return `<tr${isTotals ? ' class="totals"' : ''}>${cells}</tr>`;
        })
        .join('');

    const provHtml = doc.provenance
        .map(([k, v]) => `<div class="pv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`)
        .join('');

    const notesHtml = doc.notes.length > 0
        ? `<div class="notes"><h2>How these numbers are counted</h2><ul>${doc.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>`
        : '';

    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font: 10px/1.45 "Helvetica Neue", Arial, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 17px; margin: 0 0 2px; letter-spacing: -0.01em; }
  .sub { color: #555; font-size: 10px; margin-bottom: 10px; }
  .provenance { border: 1px solid #ddd; border-radius: 4px; padding: 7px 9px; margin-bottom: 10px; column-count: 2; column-gap: 18px; }
  .pv { display: flex; gap: 6px; font-size: 9px; padding: 1px 0; break-inside: avoid; }
  .pv span { color: #666; min-width: 74px; }
  .pv b { font-weight: 600; }
  table { border-collapse: collapse; width: 100%; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; color: #444;
       border-bottom: 1.4px solid #333; padding: 5px 6px; background: #f4f4f4; }
  td { padding: 4px 6px; border-bottom: 1px solid #eee; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.totals td { border-top: 1.4px solid #333; border-bottom: none; font-weight: 700; background: #f4f4f4; }
  .notes { margin-top: 12px; font-size: 8.5px; color: #444; page-break-inside: avoid; }
  .notes h2 { font-size: 10px; margin: 0 0 3px; }
  .notes ul { margin: 0; padding-left: 14px; }
  .notes li { margin-bottom: 2px; }
</style></head><body>
  <h1>${esc(doc.title)}</h1>
  <div class="sub">${esc(doc.blurb)}</div>
  <div class="provenance">${provHtml}</div>
  <table>
    <thead><tr>${headHtml}</tr></thead>
    <tbody>${bodyHtml}</tbody>
  </table>
  ${notesHtml}
</body></html>`;
};
