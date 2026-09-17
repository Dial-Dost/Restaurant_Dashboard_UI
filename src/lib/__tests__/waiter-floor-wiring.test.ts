// CLIENT ITEMS 1 AND 2 ON THE WEB — nothing here is built and never called.
//
// The rules are pinned beside their modules (bill-print-state, floor-state,
// next-party, table-move, session-scope). This file pins that the PAGES use
// them: the printed table stays on the list, the floor paints the five
// colours, the order dialog asks before anything reaches printed paper and
// sends the flag only after that, and a settle against stale paper is warned
// and recorded. The page has no DOM harness here (jest runs over src/lib), so,
// as floorplan-and-bill-template.test.ts does, the wiring is read from source.

import * as fs from 'node:fs';
import * as path from 'node:path';

function readSource(relative: string): string {
    for (const base of [process.cwd(), path.join(__dirname, '..', '..', '..')]) {
        const full = path.join(base, relative);
        // A fixed list of this repo's own source files, not user input.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        if (fs.existsSync(full)) { return fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n'); }
    }
    throw new Error(`readSource could not find ${relative} from ${process.cwd()}`);
}

/** Source with comments removed, so a pin reads the CODE rather than the prose beside it. */
const code = (src: string): string => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const orders = code(readSource('src/app/dashboard/orders/page.tsx'));
const tables = code(readSource('src/app/dashboard/tables/page.tsx'));
// db.ts is read RAW: it carries glob-like strings that a comment stripper would misread.
const db = readSource('src/lib/db.ts');

describe('the printed table stays on the waiter\'s list (C3\'s retirement is gone)', () => {
    it('the orders list is the whole list — no print-scope filter', () => {
        expect(orders).toContain('const visibleOrders = displayOrders;');
        expect(orders).not.toMatch(/displayOrders\.filter\(\(order\) => !printScopeForTable\(order\.table\)\.retiresTable\)/);
    });

    it('the print scope reads the server\'s paper_stale, and the controls say "Print updated bill" from it', () => {
        expect(orders).toContain('return billPrintScope(user, serverSaysBillPrinted(state), paperStaleOf(state));');
        expect(orders).toContain('{printScopeForTable(order.table).printLabel}');
        expect(orders).toContain('{previewPrintScope.printLabel}');
    });

    it('a printed row carries the orange "Bill printed" chip and, when stale, "Updated — print again"', () => {
        expect(orders).toMatch(/serverSaysBillPrinted\(state\)[\s\S]{0,400}?floorChipStyle\("printed"\)[\s\S]{0,80}?FLOOR_STATE_WORDS\.printed/);
        expect(orders).toMatch(/paperStaleOf\(state\) === true[\s\S]{0,300}?PAPER_STALE_CHIP/);
    });
});

describe('adding to a printed bill is a choice, and the flag follows only the choice', () => {
    it('the send stops at a printed table and asks — unless the draft was confirmed', () => {
        expect(orders).toMatch(/if \(draft\.addToPrintedBill !== true\) \{[\s\S]{0,400}?serverSaysBillPrinted\(target\.bill_print \?\? null\)[\s\S]{0,80}?askAddToPrinted\(draft, target\.name, null\);\s*return;/);
    });

    it('a 2.0.2 refusal opens the same question instead of a dead-end toast', () => {
        expect(orders).toMatch(/if \(refusal\.addToPrintedLabel && sent\.addToPrintedBill !== true\) \{\s*askAddToPrinted\(sent, refusal\.table, refusal\.nextPartyTable\);/);
    });

    it('"Add to printed bill" sends the SAME draft with the flag; "Use green 12" sends it to the green seat', () => {
        expect(orders).toMatch(/const sent: NewOrderDraft = \{ \.\.\.pending\.draft, addToPrintedBill: true \};\s*const refusal = await handleAddOrder\(sent\);/);
        expect(orders).toMatch(/void nextPartyRetry\.run\(pending\.green, pending\.draft\)/);
        expect(orders).toMatch(/onClick=\{useGreenInstead\}/);
        expect(orders).toMatch(/onClick=\{\(\) => \{ void confirmAddToPrinted\(\); \}\}/);
        expect(orders).toContain('addToPrintedBillConfirm({');
        expect(orders).toContain('{ADD_TO_PRINTED_BILL_ACTION}');
    });

    it('handleAddOrder passes the flag through, and addOrder puts it on the body only when it is true', () => {
        expect(orders).toContain('addToPrintedBill: newOrderData.addToPrintedBill === true,');
        expect(db).toContain('body: JSON.stringify(opts?.addToPrintedBill === true ? { ...order, [ADD_TO_PRINTED_BILL_KEY]: true } : order),');
    });

    it('the order form shows the orange strip for a printed table, on both of its send bars', () => {
        expect(orders).toContain('addingToPrintedBillStrip(selectedRow.name, selectedRow.parent_table ?? null)');
        expect(orders.match(/\{printedStripBar\}|printedStripBar \? <div className="basis-full">\{printedStripBar\}<\/div> : null/g)?.length).toBe(2);
    });
});

describe('settling against out-of-date paper warns, never blocks, and is recorded', () => {
    it('both settle steps read the paper, put the warning first, and send the flag when it was shown', () => {
        expect(orders).toContain('settleConfirmText(view, `Confirm payment by ${methodName}? This sends the bill for admin approval.`)');
        expect(orders).toContain('{ settledWithStalePaper: view.staleWarning !== null },');
        expect(orders).toContain('settleConfirmText(view, "Approve this waiter-confirmed payment?")');
        expect(orders).toContain('approveBillPaymentByAdmin(user.restaurantUsername, user.employeeId, order.id, { settledWithStalePaper: view.staleWarning !== null })');
        expect(orders).toMatch(/stalePaperSettleWarning\(\{\s*paperStale: paperStaleOf\(bill\),/);
    });

    it('EVERY settle door asks: each waiter-confirm and admin-approve call on the page carries the flag', () => {
        const calls = (name: string): string[] => {
            const out: string[] = [];
            const re = new RegExp(`await ${name}\\(`, 'g');
            for (let m = re.exec(orders); m; m = re.exec(orders)) {
                // The call's own argument list, to its closing paren at depth 0.
                let depth = 0;
                let end = m.index + m[0].length - 1;
                for (; end < orders.length; end += 1) {
                    if (orders[end] === '(') { depth += 1; }
                    if (orders[end] === ')') { depth -= 1; if (depth === 0) { break; } }
                }
                out.push(orders.slice(m.index, end + 1));
            }
            return out;
        };
        const confirms = calls('confirmBillPaymentByWaiter');
        const approves = calls('approveBillPaymentByAdmin');
        // The single-mode confirm and the split confirm; the approval.
        expect(confirms).toHaveLength(2);
        expect(approves).toHaveLength(1);
        for (const call of [...confirms, ...approves]) {
            expect(call).toContain('settledWithStalePaper: view.staleWarning !== null');
        }
        // The split door reads the paper for the table it is settling, and asks
        // only when it is out of date (the dialog is its own confirm).
        expect(orders).toContain('const view = await fetchSettleView(splitPayOrder.table);');
        expect(orders).toContain('if (view.staleWarning && !window.confirm(settleConfirmText(view, "Record this split payment? This sends the bill for admin approval."))) {return;}');
        // No other page settles.
        for (const other of ['src/app/dashboard/tables/page.tsx', 'src/app/dashboard/orders/capture-actions.tsx', 'src/app/dashboard/orders/print/page.tsx']) {
            expect(readSource(other)).not.toMatch(/confirmBillPaymentByWaiter|approveBillPaymentByAdmin|waiter-confirm-payment|admin-approve-payment/);
        }
    });

    it('db.ts sends settled_with_stale_paper only when told to', () => {
        expect(db).toContain("...(opts?.settledWithStalePaper === true ? { settled_with_stale_paper: true } : {}),");
        expect(db).toContain("...(opts?.settledWithStalePaper === true ? { body: JSON.stringify({ settled_with_stale_paper: true }) } : {}),");
    });
});

describe('the Tables floor paints the five states', () => {
    it('each tile is one state, from the server\'s print ledger and its order flag', () => {
        expect(tables).toContain('const state: FloorState = floorStateOf({ occupied: isOccupied, hasOrder: table.has_order ?? null, printed, reserved: isReserved });');
        expect(tables).toContain('style={floorTileStyle(state)}');
        expect(tables).toContain('{FLOOR_STATE_WORDS[state]}');
        // The old three colours are gone.
        expect(tables).not.toContain('bg-red-950/40 border-red-900');
    });

    it('a printed tile carries its time, "Updated — print again" and "Printed as"', () => {
        expect(tables).toMatch(/printedTileChips\(\{\s*printedClock: printedClockLabel\(table\.bill_print\?\.printed_at \?\? null, timezone\),\s*paperStale: paperStaleOf\(table\.bill_print \?\? null\),\s*printedAs: table\.bill_print\?\.printed_as \?\? null,/);
    });

    it('the legend counts for a senior, keys for a waiter, and the printed count filters the floor', () => {
        expect(tables).toContain('const legendWithCounts = !isWaiterOnly(user);');
        expect(tables).toContain('const legend = floorLegend(floorStates, legendWithCounts);');
        expect(tables).toMatch(/row\.state === "printed" && legendWithCounts \?[\s\S]{0,700}?setOnlyPrinted\(\(v\) => !v\)/);
        expect(tables).toContain('section.tables.filter((table) => !onlyPrinted || stateOfTable(table) === "printed")');
    });

    it('the printed filter ends with the last printed bill — never a blank floor with no chip to clear it', () => {
        // The grid filters on the EFFECTIVE filter, not the request...
        expect(tables).toContain('const onlyPrinted = legendWithCounts && printedBacklogFilterOn(printedRequested, floorStates);');
        expect(tables).toContain('const anyPrinted = floorStates.includes("printed");');
        // ...and the request is dropped once nothing is printed.
        expect(tables).toMatch(/useEffect\(\(\) => \{\s*if \(printedRequested && !anyPrinted\) \{ setOnlyPrinted\(false\); \}\s*\}, \[printedRequested, anyPrinted\]\);/);
        expect(tables).not.toMatch(/const \[onlyPrinted, setOnlyPrinted\] = useState/);
    });

    it('db.ts carries has_order onto the table row', () => {
        expect(db).toContain('...hasOrderField(item),');
    });
});

describe('the ESC/POS copy of a claimed paper files the claim\'s record (POST /publish/bill paperJobId)', () => {
    const print = code(readSource('src/app/dashboard/orders/print/page.tsx'));
    const capture = code(readSource('src/app/dashboard/orders/capture-actions.tsx'));

    it('the claim answers its job id, and both print doors carry it to the page', () => {
        expect(db).toContain('paperJobId: billPaperJobIdOf(body),');
        expect(orders).toContain('if (claim.outcome === "claimed") { revisedNote = claim.revisedNote; paperJobId = claim.paperJobId; }');
        expect(capture).toContain('await printBill(printBillHandoffOf(answer.result, tab))');
        expect(orders).toContain('paperJobId = handed.paperJobId;');
        expect(orders).toContain('revisedNote = handed.revisedNote;');
        expect(orders).toContain('bill_paper_job_id: paperJobId,');
    });

    it('the page names it on the publish, for the open bill only', () => {
        expect(print).toContain("const paperJobId = printed.source === 'open' ? (order.bill_paper_job_id ?? '').trim() || null : null;");
        expect(print).toMatch(/path: '\/publish\/bill',[\s\S]{0,400}?escBase64: b64, \.\.\.\(paperJobId \? \{ paperJobId \} : \{\}\) \}/);
    });
});
