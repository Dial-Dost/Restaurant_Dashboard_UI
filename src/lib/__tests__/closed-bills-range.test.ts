// "In Accounting in settled bills the date frame is not selectable." — the web
// half, pinned.
//
// Accounting's Closed bills card had no date control and did not say which days
// it listed; the only picker was the page toolbar, a long scroll above. The card
// now carries the SAME DateRangePicker bound to the SAME page window. What must
// never happen is the obvious "fix" of giving the card a private window: then the
// list and the Sales/GST/P&L figures above it describe different days, and the
// Tally/CSV exports (cut on the page window) disagree with the list.
//
// The components have no DOM harness in this repo (jest runs in node over
// src/lib), so WHERE the control is drawn and WHAT it is bound to are pinned by
// reading the source, the way bill-customer.test.ts pins its dialogs.

import * as fs from 'node:fs';
import * as path from 'node:path';

function readSource(relative: string): string {
    for (const base of [process.cwd(), path.join(__dirname, '..', '..', '..')]) {
        const full = path.join(base, relative);
        // A fixed list of this repo's own source files, not user input.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        if (fs.existsSync(full)) { return fs.readFileSync(full, 'utf8'); }
    }
    throw new Error(`readSource could not find ${relative} from ${process.cwd()}`);
}

/** Source with comments removed, so a pin reads the CODE rather than the prose beside it. */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\s*\}/g, '');

/** The JSX props of the first `<Tag ... />` element, whitespace-collapsed. */
function elementProps(src: string, tag: string): string {
    const at = src.indexOf(`<${tag}`);
    if (at < 0) { return ''; }
    const end = src.indexOf('/>', at);
    return src.slice(at, end).replace(/\s+/g, ' ');
}

describe('Closed bills card — the date frame is selectable where the bills are', () => {
    const closed = code(readSource('src/components/closed-bills.tsx'));

    it('renders the shared DateRangePicker in the header when the host owns the window', () => {
        expect(closed).toMatch(/import \{ DateRangePicker, RangeNote \} from "@\/components\/date-range-picker"/);
        // The picker is the branch AFTER History's own inputs, bound to the host's
        // range and callback — not to a useState of the card's own.
        expect(closed).toMatch(
            /ownDateFilter \? \([\s\S]*?aria-label="Settled to"[\s\S]*?\) : range && onRangeChange \? \(\s*<DateRangePicker value=\{range\} onChange=\{onRangeChange\} timezone=\{timezone\}/,
        );
        // A host that hands only the range still gets the days stated.
        expect(closed).toMatch(/\) : range \? \(\s*<RangeNote range=\{range\} timezone=\{timezone\} \/>/);
    });

    it('keeps no private window: the list is still fetched on the host from/to', () => {
        expect(closed).toMatch(/const effFrom = ownDateFilter \? ownFrom : from/);
        expect(closed).toMatch(/const effTo = ownDateFilter \? ownTo : to/);
        expect(closed).not.toMatch(/useState<DateRange>/);
    });
});

describe('Accounting wires the card to the ONE page window', () => {
    const page = code(readSource('src/app/dashboard/accounting/page.tsx'));
    const props = elementProps(page, 'ClosedBillsSection');

    it('passes the page range and its setter, and the same from/to', () => {
        expect(props).toMatch(/range=\{range\}/);
        expect(props).toMatch(/onRangeChange=\{setRange\}/);
        expect(props).toMatch(/from=\{from\}/);
        expect(props).toMatch(/to=\{to\}/);
        expect(props).not.toMatch(/ownDateFilter/);
    });

    it('that setter is the page window the toolbar picker and every report use', () => {
        expect(page).toMatch(/const \{ range, setRange \} = useDateRange\("accounting", \{ params: search \}\)/);
        expect(page).toMatch(/const \{ from, to \} = range/);
        expect(page).toMatch(/<DateRangePicker value=\{range\} onChange=\{setRange\} timezone=\{timezone\} \/>/);
        expect(page).toMatch(/getSalesReport\(rid, from, to\)/);
    });
});

describe('History is unchanged', () => {
    it('keeps its own two date inputs and hands no page setter to the card', () => {
        const props = elementProps(code(readSource('src/app/dashboard/history/page.tsx')), 'ClosedBillsSection');
        expect(props).toMatch(/ownDateFilter/);
        expect(props).not.toMatch(/onRangeChange/);
    });
});
