// CLIENT ITEM 6 — the next party at a printed table, on the dashboard.
//
// What these tests hold, in the order of what it would cost to get wrong:
//
//   1. AN ORDER FOR THE NEXT GUESTS NEVER LANDS ON THE PRINTED BILL. The tile
//      and the picker say "12", but everything that is SENT names "12 #2". And
//      the server's refusal (423) comes back to the page as a value it can act
//      on — not as the local "acknowledged" addOrder answers every other
//      failure with, which would tell a waiter the kitchen had an order it
//      never saw. "Take it on 12 (next party)" sends ONE order however often it
//      is clicked, and a manager's addition to a printed bill is told to
//      reprint it.
//   2. THE ROOM HAS NO "12 #2" IN IT: not in the floor plan, not in the stored
//      layout, not in a zone's table count.
//   3. ONE VOCABULARY with the server and the till: read here off the
//      backend's own source when the checkout is beside this one.
//   4. THE WIRING, from the source, so none of it is built and never called.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
    BILL_PRINTED_CODE,
    BILL_PRINTED_STATUS,
    billPrintedOf,
    countRoomsInUse,
    NEXT_PARTY_CHIP,
    RESERVED_TABLE_NAME_ERROR,
    isNextPartyTable,
    isReservedPartyName,
    nextPartyAfterPrint,
    nextPartyAfterPrintMessage,
    nextPartyLabel,
    nextPartyRetryKey,
    nextPartyRowFields,
    parseNextPartyName,
    readBillPrintedRefusal,
    readReprintNeeded,
    reprintAnchorOrder,
    reprintNeededMessage,
    roomTables,
    singleFlight,
    tableDisplayName,
    tableOptionLabel,
    tableSentenceName,
    takeItOnLabel,
    withNextPartySeats,
} from '../next-party';
import { serviceChargeRemovalSentence } from '../mis-capture';

const money = (v: unknown): string => `₹${Number(v).toFixed(2)}`;

interface Row { name: string; parent_table?: string | null; party_no?: number | null; display_name?: string }
const t = (name: string, over: Partial<Row> = {}): Row => ({ name, ...over });
const seat = (root: string, n: number): Row => t(`${root} #${String(n)}`, { parent_table: root, party_no: n, display_name: root });

describe('the name and its reserved shape', () => {
    test('" #<digits>" at the end, and nothing else', () => {
        for (const n of ['12 #2', 'Patio 4 #13', ' 7 #2 ']) { expect(isReservedPartyName(n)).toBe(true); }
        for (const n of ['12', '12#2', '12-2', '31A', 'T #', '#2', '12 #2a', '', null, undefined]) {
            expect(isReservedPartyName(n)).toBe(false);
        }
    });

    test('parse is the inverse, and the root is party 1', () => {
        expect(parseNextPartyName('Patio 4 #13')).toEqual({ root: 'Patio 4', seq: 13 });
        expect(parseNextPartyName('12 #1')).toBeNull();
        expect(parseNextPartyName('12')).toBeNull();
    });
});

describe('what a table is called', () => {
    test('the tile reads the root; a picker or a sentence says "(next party)"; the handle is untouched', () => {
        const s = seat('12', 2);
        expect(isNextPartyTable(s)).toBe(true);
        expect(tableDisplayName(s)).toBe('12');
        // The parent decides even when the row carries no display name of its own.
        expect(tableDisplayName({ name: '12 #2', parent_table: '12' })).toBe('12');
        expect(tableDisplayName({ name: '12 #2', parent_table: '12', display_name: '12 #2' })).toBe('12');
        expect(tableOptionLabel(s)).toBe('12 (next party)');
        expect(s.name).toBe('12 #2');
        expect(isNextPartyTable(t('12'))).toBe(false);
        expect(tableDisplayName(t('12'))).toBe('12');
        expect(tableOptionLabel(t('12'))).toBe('12');
        expect(tableSentenceName('12 #3')).toBe('12 (next party)');
        expect(nextPartyLabel(' 12 ')).toBe('12 (next party)');
        expect(takeItOnLabel('12 #2')).toBe('Take it on 12 (next party)');
    });

    test('mapTable\'s fields: carried when well-formed, a room table when absent (a pre-053 backend)', () => {
        expect(nextPartyRowFields({ parent_table: '12', party_no: 2, display_name: '12' }, '12 #2'))
            .toEqual({ parent_table: '12', party_no: 2, display_name: '12' });
        expect(nextPartyRowFields({ table_name: '12' }, '12')).toEqual({ parent_table: null, party_no: null, display_name: '12' });
        expect(nextPartyRowFields(null, 'T1')).toEqual({ parent_table: null, party_no: null, display_name: 'T1' });
        // Junk is not a seat.
        expect(nextPartyRowFields({ parent_table: '  ', party_no: 2 }, 'T1')).toEqual({ parent_table: null, party_no: null, display_name: 'T1' });
        expect(nextPartyRowFields({ parent_table: '12', party_no: 1.5 }, '12 #2').party_no).toBeNull();
        expect(nextPartyRowFields({ parent_table: '12', party_no: '2' }, '12 #2').party_no).toBeNull();
    });
});

describe('the room, and where a seat sits on the floor', () => {
    test('roomTables drops every seat and keeps the order', () => {
        const all = [t('10'), t('12'), seat('12', 2), t('15')];
        expect(roomTables(all).map((r) => r.name)).toEqual(['10', '12', '15']);
    });

    test('each seat goes straight after its own table, in party order; a seat never lands in another zone', () => {
        const all = [t('10'), seat('12', 3), t('12'), seat('12', 2), t('15'), seat('20', 2)];
        const zone = [t('12'), t('10')];
        expect(withNextPartySeats(zone, all).map((r) => r.name)).toEqual(['12', '12 #2', '12 #3', '10']);
        // 20 is not in this zone, so neither is its seat.
        expect(withNextPartySeats([t('15')], all).map((r) => r.name)).toEqual(['15']);
        // Case- and space-insensitive, the way every table is looked up.
        expect(withNextPartySeats([t('P1')], [seat('p1', 2)]).map((r) => r.name)).toEqual(['P1', 'p1 #2']);
        expect(withNextPartySeats([t('P2 ')], [seat('p2', 2)]).map((r) => r.name)).toEqual(['P2 ', 'p2 #2']);
    });
});

describe('the room is counted once', () => {
    test('12 is in use while it, or its next party, is; the seat is never a table of its own', () => {
        const b = (row: Row, busy: boolean): Row & { busy: boolean } => ({ ...row, busy });
        const isBusy = (r: { busy: boolean }): boolean => r.busy;
        expect(countRoomsInUse([b(t('12'), true), b(seat('12', 2), false)], isBusy)).toEqual({ inUse: 1, rooms: 1 });
        expect(countRoomsInUse([b(t('12'), false), b(seat('12', 2), true)], isBusy)).toEqual({ inUse: 1, rooms: 1 });
        expect(countRoomsInUse([b(t('12'), false), b(seat('12', 2), false)], isBusy)).toEqual({ inUse: 0, rooms: 1 });
        expect(countRoomsInUse([b(t('12'), true), b(seat('12', 2), true), b(t('15'), false)], isBusy))
            .toEqual({ inUse: 1, rooms: 2 });
        // An older backend: every row is a room.
        expect(countRoomsInUse([b(t('12 #2'), true)], isBusy)).toEqual({ inUse: 1, rooms: 1 });
    });
});

describe('what the server answers', () => {
    test('a print names the next party\'s seat, the server\'s sentence first', () => {
        expect(nextPartyAfterPrint({ next_party_table: '12 #2', next_party_message: 'Seat them.' }))
            .toEqual({ table: '12 #2', message: 'Seat them.' });
        expect(nextPartyAfterPrint({ next_party_table: '12 #2' }))
            .toEqual({ table: '12 #2', message: 'Seat the next party at 12 (next party).' });
        expect(nextPartyAfterPrintMessage('12')).toBe('Seat the next party at 12.');
        for (const none of [null, 'x', [], {}, { next_party_table: null }, { next_party_table: '  ' }]) {
            expect(nextPartyAfterPrint(none)).toEqual({ table: null, message: null });
        }
    });

    test('the 409 is read for its sentence and its action', () => {
        const body = {
            error: "12's bill has already been printed, so nothing more can be added to it. Take a new party's order on 12 (next party). If it is for the same guests, ask a manager to add it and reprint the bill.",
            code: BILL_PRINTED_CODE,
            table: '12',
            next_party_table: '12 #2',
            next_party_action: 'Take it on 12 (next party)',
            print_count: 1,
        };
        expect(readBillPrintedRefusal(body)).toEqual({
            message: body.error,
            table: '12',
            nextPartyTable: '12 #2',
            actionLabel: 'Take it on 12 (next party)',
        });
        // Nowhere else to go, or the seat IS the table: a sentence and no action.
        expect(readBillPrintedRefusal({ ...body, next_party_table: null })).toMatchObject({ nextPartyTable: null, actionLabel: null });
        expect(readBillPrintedRefusal({ ...body, next_party_table: '12' })).toMatchObject({ nextPartyTable: null, actionLabel: null });
        // A server that named the seat without the label still gets one.
        expect(readBillPrintedRefusal({ ...body, next_party_action: null })?.actionLabel).toBe('Take it on 12 (next party)');
        // Not this refusal.
        expect(readBillPrintedRefusal({ error: 'Forbidden' })).toBeNull();
        expect(readBillPrintedRefusal({ code: 'otp_required' })).toBeNull();
        expect(readBillPrintedRefusal(null)).toBeNull();
    });

    test('what addOrder hands back is read for the refusal, and for nothing else', () => {
        const refusal = { message: 'x', table: '12', nextPartyTable: '12 #2', actionLabel: 'Take it on 12 (next party)' };
        expect(billPrintedOf({ bill_printed: refusal })).toBe(refusal);
        for (const other of [null, undefined, 'x', [], { id: 'o-1' }, { acknowledged: true }, { bill_printed: null }, { bill_printed: 'yes' }]) {
            expect(billPrintedOf(other)).toBeNull();
        }
    });

    test('a manager\'s addition to a printed bill is read for the reprint, in the server\'s words', () => {
        const said = "12's bill was already printed, so the paper no longer shows this. Reprint the bill before the guest pays.";
        expect(readReprintNeeded({ id: 'o-1', reprint_needed: true, reprint_message: said, reprint_table: '12' }, '15'))
            .toEqual({ table: '12', message: said });
        expect(reprintNeededMessage('12')).toBe(said);
        // A server that flagged it without the sentence or the table.
        expect(readReprintNeeded({ reprint_needed: true }, '12 #2')).toEqual({
            table: '12 #2',
            message: "12 (next party)'s bill was already printed, so the paper no longer shows this. Reprint the bill before the guest pays.",
        });
        for (const none of [null, 'x', [], {}, { reprint_needed: false }, { reprint_needed: 'true' }]) {
            expect(readReprintNeeded(none, '12')).toBeNull();
        }
        expect(readReprintNeeded({ reprint_needed: true })).toBeNull();
    });

    test('the Reprint is printed from the newest OPEN order on that table', () => {
        const o = (id: string, table: string, status: string, created_at: string | null) => ({ id, table, status, created_at });
        const list = [
            o('old', '12', 'Served', '2026-09-16T08:00:00Z'),
            o('new', '12', 'Preparing', '2026-09-16T08:30:00Z'),
            o('paid', '12', 'Paid', '2026-09-16T09:00:00Z'),
            o('next', '12 #2', 'Preparing', '2026-09-16T09:10:00Z'),
        ];
        expect(reprintAnchorOrder(list, '12')?.id).toBe('new');
        expect(reprintAnchorOrder(list, ' 12 #2 ')?.id).toBe('next');
        expect(reprintAnchorOrder([o('x', '12', 'Cancelled', null), o('y', '12', 'Closed', null)], '12')).toBeNull();
        expect(reprintAnchorOrder([o('a', '12', 'Served', null)], '12')?.id).toBe('a');
    });

    test('the waiver print ends by naming the seat — only when paper came out', () => {
        const printed = serviceChargeRemovalSentence({
            waiver_created: true, printed: true, service_charge_removed: true,
            grand_total_before: 1155, grand_total_after: 1050,
            next_party_table: '12 #2', next_party_message: 'Seat the next party at 12 (next party).',
        }, money);
        expect(printed).toEqual({
            message: 'Service charge removed — total ₹1155.00 → ₹1050.00. Printing bill… Seat the next party at 12 (next party).',
            tone: 'ok',
        });
        const failed = serviceChargeRemovalSentence({
            waiver_created: true, printed: false, grand_total_before: 1155, grand_total_after: 1050, next_party_table: '12 #2',
        }, money);
        expect(failed.message).not.toContain('next party');
        // No seat named: the 2.0.0 sentence, byte for byte.
        expect(serviceChargeRemovalSentence({ printed: true, grand_total_after: 1050 }, money).message)
            .toBe('Reprinting without the service charge — total ₹1050.00.');
    });
});

describe('"Take it on 12 (next party)" sends ONE order', () => {
    test('the retry\'s key: the same for the same draft and seat, another for another seat, and a key the server accepts', () => {
        const draft = '0123456789abcdef0123456789abcdef';
        const k = nextPartyRetryKey(draft, '12 #2');
        expect(nextPartyRetryKey(draft, '12 #2')).toBe(k);
        expect(nextPartyRetryKey(draft, ' 12 #2 ')).toBe(k);
        expect(nextPartyRetryKey(draft, '12 #3')).not.toBe(k);
        expect(nextPartyRetryKey('fedcba9876543210fedcba9876543210', '12 #2')).not.toBe(k);
        // Not the draft's own key: the refused send and the retry are two writes.
        expect(k).not.toBe(draft);
        // idempotency.ts: 8-200 printable ASCII, no space.
        for (const seat of ['12 #2', 'Patio 4 #13', 'बाग़ #2']) {
            expect(nextPartyRetryKey(draft, seat)).toMatch(/^[\x21-\x7e]{8,200}$/);
        }
    });

    test('one run at a time: a second call while the first is running is dropped, and the guard frees itself', async () => {
        let release: () => void = () => undefined;
        const run = jest.fn(async (n: number) => {
            await new Promise<void>((r) => { release = r; });
            return n * 2;
        });
        const guard = singleFlight(run);
        const first = guard.run(1);
        expect(guard.busy()).toBe(true);
        await expect(guard.run(2)).resolves.toBeNull();
        release();
        await expect(first).resolves.toBe(2);
        expect(guard.busy()).toBe(false);
        expect(run).toHaveBeenCalledTimes(1);
        // …and a failure frees it too.
        const failing = singleFlight(async () => { throw new Error('offline'); });
        await expect(failing.run()).rejects.toThrow('offline');
        expect(failing.busy()).toBe(false);
    });

    test('TWO CLICKS, ONE POST, ONE KEY — the page\'s retry composed from its two parts', async () => {
        const posts: string[] = [];
        let landed: () => void = () => undefined;
        // What takeOrderOnNextParty does, reduced to what reaches the server.
        const retry = singleFlight(async (seat: string, draftKey: string) => {
            await new Promise<void>((r) => { landed = r; });
            posts.push(nextPartyRetryKey(draftKey, seat));
            return null;
        });
        const draftKey = '0123456789abcdef0123456789abcdef';
        const click1 = retry.run('12 #2', draftKey);
        const click2 = retry.run('12 #2', draftKey); // the double click
        landed();
        await Promise.all([click1, click2]);
        expect(posts).toHaveLength(1);
        // A later click (a second toast's action) reaches the server under the
        // SAME key, which the server answers with the stored order.
        const click3 = retry.run('12 #2', draftKey);
        landed();
        await click3;
        expect(posts).toHaveLength(2);
        expect(new Set(posts).size).toBe(1);
    });
});

// ============================================================================
// ONE VOCABULARY — the server's own source, when it is beside this checkout.
// ============================================================================
describe('the same words as the server (Restaurant_Backend/next_party.ts)', () => {
    const file = join(__dirname, '..', '..', '..', '..', 'Restaurant_Backend', 'next_party.ts');
    const src = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
    // One exported string constant, unescaped: `export const NAME =\n\t"…";`.
    const tsString = (name: string): string | null => {
        const at = (src ?? '').indexOf(`export const ${name} =`);
        if (at < 0) { return null; }
        const m = /^[^"]*"((?:[^"\\]|\\.)*)";/.exec((src ?? '').slice(at));
        return m ? m[1].replace(/\\"/g, '"') : null;
    };
    const maybe = src ? test : test.skip;

    maybe('chip, code, refusal sentence and the reserved shape', () => {
        expect(tsString('NEXT_PARTY_CHIP')).toBe(NEXT_PARTY_CHIP);
        expect(tsString('BILL_PRINTED_CODE')).toBe(BILL_PRINTED_CODE);
        expect(tsString('RESERVED_TABLE_NAME_ERROR')).toBe(RESERVED_TABLE_NAME_ERROR);
        expect(src).toContain('const RESERVED_TAIL = /\\s#\\d+$/;');
    });

    maybe('the sentences this dashboard builds for itself are the server\'s', () => {
        expect(src).toContain('return `${String(root ?? "").trim()} (next party)`;');
        expect(src).toContain('return `Take it on ${tableSentenceName(next, parent)}`;');
        expect(src).toContain('return `Seat the next party at ${');
        expect(src).toContain("was already printed, so the paper no longer shows this. Reprint the bill before the guest pays.`;");
        expect(reprintNeededMessage('12')).toMatch(/was already printed, so the paper no longer shows this\. Reprint the bill before the guest pays\.$/);
    });

    maybe('the refusal\'s status is the server\'s — and never 409', () => {
        expect(src).toContain(`export const BILL_PRINTED_STATUS = ${String(BILL_PRINTED_STATUS)};`);
        expect(BILL_PRINTED_STATUS).not.toBe(409);
    });
});

// ============================================================================
// THE WIRING
// ============================================================================
describe('the wiring — nothing here is built and never called', () => {
    const ROOT = join(__dirname, '..', '..', '..');
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
    const db = read('src/lib/db.ts');

    test('mapTable carries the three fields', () => {
        const at = db.indexOf('const mapTable = ');
        const body = db.slice(at, db.indexOf('\n};', at));
        expect(body).toContain('...nextPartyRowFields(item, String(name))');
    });

    test('addOrder returns the refusal as a value BEFORE its silent local fallback — for any 4xx, not only 409', () => {
        const at = db.indexOf('export const addOrder = ');
        const body = db.slice(at, db.indexOf('\n};', at));
        const refusal = body.indexOf('readBillPrintedRefusal(body)');
        expect(refusal).toBeGreaterThan(-1);
        expect(refusal).toBeLessThan(body.indexOf("addToLocalField(restaurantId, 'orders', order)"));
        expect(body).toMatch(/\{ bill_printed: refusal \}/);
        expect(body).toContain('if (response && !response.ok && response.status >= 400 && response.status < 500) {');
        expect(body).not.toMatch(/status === 409/);
    });

    test('the print claim carries the seat, and the orders page says it', () => {
        expect(db).toMatch(/nextParty: nextPartyAfterPrint\(body\),/);
        const orders = read('src/app/dashboard/orders/page.tsx');
        expect(orders).toMatch(/if \(claim\.nextParty\.message\) \{/);
        // The refusal reaches the page — returned by the send, before anything
        // else happens — and its action sends the same draft to the seat.
        expect(orders).toMatch(/const refused = billPrintedOf\(resp\);\s*if \(refused\) \{return refused;\}/);
        expect(orders).toMatch(/const moved: NewOrderDraft = \{\s*\.\.\.draft,\s*tableId: target\.id,\s*tableName: target\.name,\s*idempotencyKey: draft\.idempotencyKey \? nextPartyRetryKey\(draft\.idempotencyKey, target\.name\) : newIdempotencyKey\(\),/);
        expect(orders).toMatch(/const refusal = await handleAddOrder\(draft\);\s*if \(refusal\) \{offer\(refusal, draft\);\}/);
        expect(orders).toMatch(/onSubmit=\{submitNewOrder\}/);
        // The picker and the table-wise report use the shared words and label.
        expect(orders).toMatch(/label: tableOptionLabel\(t\)/);
        expect(orders).toMatch(/\(item\.table_label \?\? item\.table_name\)\.trim\(\)/);
    });

    test('the retry is single-flight, the form\'s Send is held while it runs, and the toast goes through the guard', () => {
        const orders = read('src/app/dashboard/orders/page.tsx');
        expect(orders).toMatch(/const \[nextPartyRetry\] = useState\(\(\) => singleFlight\(async \(seat: string, draft: NewOrderDraft\) => \{\s*setNextPartyBusy\(true\);/);
        expect(orders).toMatch(/return await takeOrderOnNextPartyRef\.current\(seat, draft\);\s*\} finally \{\s*setNextPartyBusy\(false\);/);
        expect(orders).toMatch(/void nextPartyRetry\.run\(seat, sent\)\.then/);
        expect(orders).not.toMatch(/void takeOrderOnNextParty\(/);
        expect(orders).toMatch(/const submitNewOrder = async \(draft: NewOrderDraft\): Promise<void> => \{\s*\/\/[^\n]*\n\s*if \(nextPartyRetry\.busy\(\)\) \{return;\}/);
        expect(orders).toMatch(/onSubmit=\{submitNewOrder\}\s*busy=\{nextPartyBusy\}/);
        expect(orders).toMatch(/if \(sendingRef\.current\) \{return;\}\s*\/\/[^\n]*\n\s*if \(busy\) \{return;\}/);
        expect(orders.match(/disabled=\{!canSend \|\| sending \|\| busy\}/g)).toHaveLength(2);
    });

    test('every upsert says a refusal, and a senior role\'s addition offers the reprint', () => {
        const orders = read('src/app/dashboard/orders/page.tsx');
        // The status change, Bill Verification, and the details dialog.
        expect(orders.match(/const saved: unknown = await addOrder\(user\.restaurantUsername, updatedOrder\);\s*(?:\/\/[^\n]*\s*)*const refused = billPrintedOf\(saved\);/g)).toHaveLength(3);
        // The dialog stays open on a refusal.
        expect(orders).toMatch(/if \(refused\) \{\s*keepOpen = true;/);
        expect(orders).toMatch(/finally \{\s*if \(!keepOpen\) \{\s*setSelectedOrder\(null\);\s*setIsDetailsOpen\(false\);/);
        // The reprint: after the add and after the edit, through one helper.
        expect(orders).toContain('offerReprint(resp, orderTableName, fresh);');
        expect(orders).toContain('offerReprint(saved, updatedOrder.table, fresh);');
        expect(orders).toMatch(/const notice = readReprintNeeded\(resp, fallbackTable\);/);
        expect(orders).toMatch(/<ToastAction altText="Reprint" onClick=\{\(\) => \{ void triggerPrint\(anchor\); \}\}>/);
    });

    test('the Tables screen draws the Next party badge exactly on a next-party seat', () => {
        const tablesPage = read('src/app/dashboard/tables/page.tsx');
        expect(tablesPage).toContain('const nextParty = isNextPartyTable(table);');
        expect(tablesPage).toMatch(/\{nextParty \? \(\s*<Badge[\s\S]{0,400}?\{NEXT_PARTY_CHIP\}\s*<\/Badge>\s*\) : null\}/);
        expect(tablesPage).toMatch(/nextParty \? `\$\{spoken\} — its bill reads \$\{table\.name\}`/);
    });

    test('the floor plan is the room; the Tables screen puts each seat beside its table', () => {
        expect(read('src/app/dashboard/floor-plan/page.tsx')).toMatch(/useFloorTables\(user, \{ roomOnly: true \}\)/);
        expect(read('src/app/dashboard/floor-plan/page.tsx')).toMatch(/isReservedPartyName\(trimmedName\)/);
        const hook = read('src/hooks/use-floor-tables.ts');
        expect(hook).toMatch(/applyServerSections\(layoutRef\.current, roomTables\(tables\), serverZones\)/);
        const tablesPage = read('src/app/dashboard/tables/page.tsx');
        expect(tablesPage).toMatch(/applyServerSections\(layout, rooms, serverZones\)/);
        expect(tablesPage).toMatch(/tables: withNextPartySeats\(zoneRooms, tablesData\)/);
        expect(tablesPage).toMatch(/\{tableDisplayName\(table\)\}/);
        expect(tablesPage).toMatch(/\{NEXT_PARTY_CHIP\}/);
    });
});
