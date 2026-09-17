// CLIENT ITEM 4 — REVIEW FINDING: A MOVE'S MESSAGES REPLACED ONE ANOTHER.
//
// handleMoveOrder raised "Order moved" and then one "Reprint the bill" per
// printed table. The toast store keeps ONE toast (TOAST_LIMIT = 1), so each
// replaced the one before: the sentence naming the dishes and "Correction
// docket KOT-65 is printing — tell the pass" vanished at once, and with both
// bills printed the destination's reprint (and its "Open 15") went too. Staff
// saw only the source's prompt — paper != drawer on the other table.
//
// Pinned here: the store's limit (the premise), the ONE notice the handler now
// renders with everything in it, and the handler's single success toast.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { reducer } from '../../hooks/use-toast';
import { MoveOrderNoticeBody } from '../../app/dashboard/tables/move-order-notice';
import { moveOrderNotice } from '../table-move';

// What POST /tables/move-order answers a manager moving KOT-65 from 12 to 15
// when both tables' bills had already been printed.
const BOTH_PRINTED = {
    success: true, order_id: 'o-65', from_table: '12', to_table: '15', kot_no: 65,
    items: [
        { name: 'KUNAFA BIRDS NEST', variation: null, quantity: 1 },
        { name: 'STIR FRIED WATERCHESTNUT', variation: null, quantity: 1 },
    ],
    print: { printed: true, kot_no: 65, tickets: 1 },
    reprint_needed: true, reprint_table: '15',
    reprint_message: "15's bill was already printed, so the paper no longer shows this. Reprint the bill before the guest pays.",
    also_reprint_needed: true, also_reprint_table: '12',
    also_reprint_message: "12's bill was already printed, so the paper no longer shows this. Reprint the bill before the guest pays.",
};

describe('the premise — the toast store shows ONE toast', () => {
    it('a second toast replaces the first', () => {
        const one = reducer({ toasts: [] }, { type: 'ADD_TOAST', toast: { id: '1', title: 'Order moved' } });
        const two = reducer(one, { type: 'ADD_TOAST', toast: { id: '2', title: 'Reprint the bill' } });
        expect(two.toasts.map((t) => t.id)).toEqual(['2']);
    });
});

describe("one notice, and nothing in it is lost", () => {
    const html = renderToStaticMarkup(<MoveOrderNoticeBody notice={moveOrderNotice(BOTH_PRINTED, '15')} />);

    it('renders the move, the pass instruction and BOTH reprints', () => {
        expect(html).toContain('Moved to 15: 1 × KUNAFA BIRDS NEST, 1 × STIR FRIED WATERCHESTNUT. Correction docket KOT-65 is printing — tell the pass.');
        expect(html).toContain("15&#x27;s bill was already printed");
        expect(html).toContain("12&#x27;s bill was already printed");
        expect(html.match(/data-testid="move-order-reprint"/g)).toHaveLength(2);
        // The destination first, as the server orders them.
        expect(html.indexOf('15&#x27;s bill')).toBeLessThan(html.indexOf('12&#x27;s bill'));
    });

    it('never a price', () => {
        expect(html).not.toMatch(/₹|\bprice\b/);
    });

    it('without a reprint it is the sentence alone', () => {
        const plain = renderToStaticMarkup(<MoveOrderNoticeBody notice={moveOrderNotice({ ...BOTH_PRINTED, reprint_needed: false, also_reprint_needed: false }, '15')} />);
        expect(plain).toContain('Correction docket KOT-65 is printing');
        expect(plain).not.toContain('move-order-reprint');
    });
});

describe('the handler (the wiring)', () => {
    const page = readFileSync(join(__dirname, '..', '..', 'app', 'dashboard', 'tables', 'page.tsx'), 'utf8');
    const start = page.indexOf('const handleMoveOrder = async');
    const body = page.slice(start, page.indexOf('\n    };', start));

    it('raises ONE toast on success, with one Open action per reprint', () => {
        expect(start).toBeGreaterThan(-1);
        // Refused, succeeded, failed — one each.
        expect(body.match(/\btoast\(/g)).toHaveLength(3);
        expect(body).not.toMatch(/for \(const reprint of/);
        expect(body).toMatch(/const notice = moveOrderNotice\(result, toTable, orderDishLines\(moved\)\);/);
        expect(body).toMatch(/title: notice\.title,\s*description: <MoveOrderNoticeBody notice=\{notice\} \/>/);
        expect(body).toMatch(/\{notice\.reprints\.map\(\(reprint\) => \(\s*<ToastAction\s+key=\{reprint\.table\}/);
        expect(body).toMatch(/onClick=\{\(\) => \{ openOrdersForTable\(reprint\.table, null, true\); \}\}/);
    });
});
