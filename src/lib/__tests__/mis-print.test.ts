// The printed control report renders strings the restaurant does not control:
// a guest name, a discount reason, a table label, a coupon code. If any of them
// can close a tag, the document someone files is no longer the document the
// screen showed. These tests pin that, and the page furniture that makes a
// multi-page report readable on paper.

import { buildPrintDocument, escapeHtml, type PrintDocument } from '../mis-print';

const base: PrintDocument = {
    title: 'Settlement Summary',
    blurb: 'Payment-mode reconciliation — the end-of-day cash-up document.',
    provenance: [['Outlet', 'Gaia Test / Indiranagar'], ['Date range', '2026-08-01 to 2026-08-31']],
    notes: ['Bills are counted on the day they were SETTLED.'],
    header: ['Payment mode', 'Bills', 'Collected'],
    rows: [['UPI', '198', '₹2,51,420.60'], ['Total', '412', '₹5,16,080.40']],
    numeric: [false, true, true],
    hasTotals: true,
};

describe('escaping', () => {
    it('neutralises every character that could break out of markup', () => {
        expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(escapeHtml('a & b')).toBe('a &amp; b');
        expect(escapeHtml('say "hi"')).toBe('say &quot;hi&quot;');
        expect(escapeHtml("it's")).toBe('it&#39;s');
    });

    it('escapes the ampersand FIRST so an entity is not double-decoded', () => {
        expect(escapeHtml('&lt;')).toBe('&amp;lt;');
    });
});

describe('the printed document', () => {
    it('never emits an unescaped tag from a data cell', () => {
        // A discount reason is free text typed by staff, and a guest name can be
        // anything at all.
        const doc = buildPrintDocument({
            ...base,
            rows: [['<img src=x onerror=alert(1)>', '1', '₹0.00']],
            hasTotals: false,
        });
        expect(doc).not.toContain('<img src=x');
        expect(doc).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });

    it('escapes headers, provenance, notes, blurb and title too', () => {
        const doc = buildPrintDocument({
            ...base,
            title: 'X</title><script>bad()</script>',
            blurb: '<b>blurb</b>',
            header: ['<th>', 'Bills', 'Collected'],
            provenance: [['<k>', '<v>']],
            notes: ['<li>note</li>'],
            rows: [['a', '1', '2']],
            hasTotals: false,
        });
        expect(doc).not.toContain('<script>bad()');
        expect(doc).not.toContain('<b>blurb</b>');
        // The injected "<th>" arrives as text, and creates no extra cell: the
        // document still has exactly the three header cells it was given.
        // (`/<th[ >]/` deliberately does not match `<thead>`.)
        expect(doc).toContain('&lt;th&gt;');
        expect(doc.match(/<th[ >]/g)).toHaveLength(3);
        expect(doc).toContain('&lt;li&gt;note&lt;/li&gt;');
    });

    it('marks the last row as the totals row — but only when there is one', () => {
        expect(buildPrintDocument(base)).toContain('<tr class="totals">');
        const noTotals = buildPrintDocument({ ...base, hasTotals: false });
        expect(noTotals).not.toContain('class="totals"');
    });

    it('right-aligns exactly the numeric columns', () => {
        const doc = buildPrintDocument(base);
        // "Payment mode" is text; "Bills" and "Collected" are not.
        expect(doc).toContain('<th>Payment mode</th>');
        expect(doc).toContain('<th class="num">Bills</th>');
        expect(doc).toContain('<td class="num">198</td>');
        expect(doc).toContain('<td>UPI</td>');
    });

    it('repeats the header on every page and never splits a row', () => {
        // A four-page settlement report with headings only on page one is
        // unreadable on paper, and half a money row is a misreadable one.
        const doc = buildPrintDocument(base);
        expect(doc).toContain('thead { display: table-header-group; }');
        expect(doc).toContain('tr { page-break-inside: avoid; }');
    });

    it('carries the provenance and the caveats onto the page', () => {
        const doc = buildPrintDocument(base);
        expect(doc).toContain('Gaia Test / Indiranagar');
        expect(doc).toContain('2026-08-01 to 2026-08-31');
        expect(doc).toContain('How these numbers are counted');
        expect(doc).toContain('Bills are counted on the day they were SETTLED.');
    });

    it('omits the notes block entirely when there are none', () => {
        expect(buildPrintDocument({ ...base, notes: [] })).not.toContain('How these numbers are counted');
    });

    it('produces one row per data row and one cell per column', () => {
        const doc = buildPrintDocument(base);
        expect(doc.match(/<tr/g)).toHaveLength(3); // header row + 2 body rows
        expect(doc.match(/<td/g)).toHaveLength(6); // 2 rows × 3 columns
        // `<th[ >]` rather than `<th` — the latter also matches `<thead>`.
        expect(doc.match(/<th[ >]/g)).toHaveLength(3);
    });
});
