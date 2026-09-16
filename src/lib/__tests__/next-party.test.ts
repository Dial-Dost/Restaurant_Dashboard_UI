// CLIENT ITEM 6 — the next party at a printed table, on the dashboard.
//
// What these tests hold, in the order of what it would cost to get wrong:
//
//   1. AN ORDER FOR THE NEXT GUESTS NEVER LANDS ON THE PRINTED BILL. The tile
//      and the picker say "12", but everything that is SENT names "12 #2". And
//      the server's 409 comes back to the page as a value it can act on — not
//      as the local "acknowledged" addOrder answers every other failure with,
//      which would tell a waiter the kitchen had an order it never saw.
//   2. THE ROOM HAS NO "12 #2" IN IT: not in the floor plan, not in the stored
//      layout, not in a zone's table count.
//   3. ONE VOCABULARY with the server and the till: read here off the
//      backend's own source when the checkout is beside this one.
//   4. THE WIRING, from the source, so none of it is built and never called.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
    BILL_PRINTED_CODE,
    countRoomsInUse,
    NEXT_PARTY_CHIP,
    RESERVED_TABLE_NAME_ERROR,
    isNextPartyTable,
    isReservedPartyName,
    nextPartyAfterPrint,
    nextPartyAfterPrintMessage,
    nextPartyLabel,
    nextPartyRowFields,
    parseNextPartyName,
    readBillPrintedRefusal,
    roomTables,
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

    test('addOrder returns the 409 as a value BEFORE its silent local fallback', () => {
        const at = db.indexOf('export const addOrder = ');
        const body = db.slice(at, db.indexOf('\n};', at));
        const refusal = body.indexOf('readBillPrintedRefusal(body)');
        expect(refusal).toBeGreaterThan(-1);
        expect(refusal).toBeLessThan(body.indexOf("addToLocalField(restaurantId, 'orders', order)"));
        expect(body).toMatch(/\{ bill_printed: refusal \}/);
    });

    test('the print claim carries the seat, and the orders page says it', () => {
        expect(db).toMatch(/nextParty: nextPartyAfterPrint\(body\),/);
        const orders = read('src/app/dashboard/orders/page.tsx');
        expect(orders).toMatch(/if \(claim\.nextParty\.message\) \{/);
        // The refusal reaches the page — returned by the send, before anything
        // else happens — and its action sends the same draft to the seat.
        expect(orders).toMatch(/const refused = \(resp as \{ bill_printed\?: BillPrintedRefusal \} \| null\)\?\.bill_printed;\s*if \(refused\) \{return refused;\}/);
        expect(orders).toMatch(/const moved: NewOrderDraft = \{ \.\.\.draft, tableId: target\.id, tableName: target\.name/);
        expect(orders).toMatch(/const refusal = await handleAddOrder\(draft\);\s*if \(refusal\) \{offer\(refusal, draft\);\}/);
        expect(orders).toMatch(/onSubmit=\{submitNewOrder\}/);
        // The picker and the table-wise report use the shared words and label.
        expect(orders).toMatch(/label: tableOptionLabel\(t\)/);
        expect(orders).toMatch(/\(item\.table_label \?\? item\.table_name\)\.trim\(\)/);
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
