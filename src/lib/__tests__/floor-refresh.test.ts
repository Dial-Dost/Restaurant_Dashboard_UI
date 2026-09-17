// CLIENT ITEMS 1 AND 2 — INTEGRATION FINDING: THE FLOOR WAS NEVER RE-READ.
//
// A waiter who confirmed "Add to printed bill" on the Orders page kept seeing
// "Bill printed — a reprint has to be made by a senior" instead of "Print
// updated bill", and a bill printed on another device never turned a tile
// orange: the Orders page re-read the floor only on table:* events, the Tables
// page only after a move and on a `tables:changed` event dispatched from a
// "use server" module (where `window` does not exist), and a print claim emits
// no event at all.
//
// Pinned here: the pure half (src/lib/floor-refresh.ts) by behaviour, and the
// two pages' use of it by reading their source — jest runs in node over
// src/lib, with no DOM harness for the pages (see waiter-floor-wiring.test.ts).

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    FLOOR_POLL_MS,
    FLOOR_REFRESH_EVENTS,
    coalesceReloads,
    floorSignature,
    isFloorRefreshEvent,
    whenFloorChanged,
} from '../floor-refresh';
import { isTableMoveEvent } from '../table-move';

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

/** A /get-tables row as db.ts maps it. */
const row = (name: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: name.length,
    name,
    capacity: 4,
    status: 'Occupied',
    bill_print: { print_count: 1, bill_printed_at: '2026-09-17T08:02:00.000Z', printed_at: '2026-09-17T08:02:00.000Z', paper_stale: false },
    has_order: true,
    ...over,
});

/** A promise and the function that settles it. */
const gate = (): { promise: Promise<void>; open: () => void } => {
    let open = (): void => undefined;
    const promise = new Promise<void>((resolve) => { open = resolve; });
    return { promise, open };
};
const tick = async (): Promise<void> => { for (let i = 0; i < 5; i += 1) { await Promise.resolve(); } };

describe('which realtime events re-read the floor', () => {
    it('an order, a bill or a table changed', () => {
        for (const event of ['order:updated', 'bill:updated', 'table:added', 'table:deleted', 'table:updated']) {
            expect([event, isFloorRefreshEvent(event)]).toEqual([event, true]);
        }
        expect(FLOOR_REFRESH_EVENTS).toHaveLength(5);
    });

    it('not the move events (table-move.ts reloads the orders with them), nor anything else', () => {
        for (const event of ['table:moved', 'table:order_moved']) {
            expect(isFloorRefreshEvent(event)).toBe(false);
            expect(isTableMoveEvent(event)).toBe(true);
        }
        for (const other of ['valet:created', 'feedback:created', 'booking:created', '', undefined, null, 7]) {
            expect(isFloorRefreshEvent(other)).toBe(false);
        }
    });

    it('the poll is the 20s beat the Tables page already polls its orders on', () => {
        expect(FLOOR_POLL_MS).toBe(20_000);
    });
});

describe('floorSignature — equal exactly when the floor is', () => {
    it('the same rows in any order are the same floor', () => {
        expect(floorSignature([row('12'), row('15')])).toBe(floorSignature([row('15'), row('12')]));
        expect(floorSignature([])).toBe(floorSignature([]));
    });

    it('the stale paper, a print, an order or a new seat each change it', () => {
        const before = floorSignature([row('12'), row('15')]);
        const stale = [row('12', { bill_print: { print_count: 1, bill_printed_at: '2026-09-17T08:02:00.000Z', printed_at: '2026-09-17T08:02:00.000Z', paper_stale: true } }), row('15')];
        const printedAgain = [row('12', { bill_print: { print_count: 2, bill_printed_at: '2026-09-17T08:02:00.000Z', printed_at: '2026-09-17T08:40:00.000Z', paper_stale: false } }), row('15')];
        const noOrder = [row('12'), row('15', { has_order: false })];
        const seat = [row('12'), row('15'), row('12 #2', { parent_table: '12', party_no: 2, status: 'Available' })];
        for (const floor of [stale, printedAgain, noOrder, seat]) {
            expect(floorSignature(floor)).not.toBe(before);
        }
    });

    it('a read that is not a list never matches a floor, empty or not', () => {
        for (const junk of [null, undefined, {}, 'tables']) {
            expect(floorSignature(junk)).not.toBe(floorSignature([]));
            expect(floorSignature(junk)).not.toBe(floorSignature([row('12')]));
        }
    });
});

describe('whenFloorChanged — one read, applied only when it differs', () => {
    it('applies a different floor and says so', async () => {
        const apply = jest.fn();
        const fresh = [row('12', { has_order: false })];
        await expect(whenFloorChanged(() => Promise.resolve(fresh), () => floorSignature([row('12')]), apply)).resolves.toBe(true);
        expect(apply).toHaveBeenCalledWith(fresh);
    });

    it('leaves the painted floor alone when the read is the same', async () => {
        const apply = jest.fn();
        await expect(whenFloorChanged(() => Promise.resolve([row('15'), row('12')]), () => floorSignature([row('12'), row('15')]), apply)).resolves.toBe(false);
        expect(apply).not.toHaveBeenCalled();
    });

    it('asks what is painted AFTER the read, and a failed read applies nothing', async () => {
        let painted = floorSignature([]);
        const fresh = [row('12')];
        const apply = jest.fn();
        await expect(whenFloorChanged(() => { painted = floorSignature(fresh); return Promise.resolve(fresh); }, () => painted, apply)).resolves.toBe(false);
        await expect(whenFloorChanged(() => Promise.reject(new Error('offline')), () => painted, apply)).rejects.toThrow('offline');
        expect(apply).not.toHaveBeenCalled();
    });
});

describe('coalesceReloads — one read at a time, and none lost', () => {
    it('a burst while a read runs is ONE more read, after it', async () => {
        const gates = [gate(), gate()];
        let calls = 0;
        const refresh = coalesceReloads(async () => { const g = gates[calls]; calls += 1; await g.promise; });
        const first = refresh();
        const burst = [refresh(), refresh(), refresh()];
        expect(calls).toBe(1);
        gates[0].open();
        await tick();
        expect(calls).toBe(2);
        let settled = false;
        void Promise.all([first, ...burst]).then(() => { settled = true; });
        await tick();
        // Every caller waits for the read that covers its event.
        expect(settled).toBe(false);
        gates[1].open();
        await Promise.all([first, ...burst]);
        expect(calls).toBe(2);
    });

    it('calls after a read finished each read again', async () => {
        const read = jest.fn(() => Promise.resolve());
        const refresh = coalesceReloads(read);
        await refresh();
        await refresh();
        expect(read).toHaveBeenCalledTimes(2);
    });

    it('a failed read is swallowed, and the next call reads again', async () => {
        const read = jest.fn()
            .mockImplementationOnce(() => Promise.reject(new Error('502')))
            .mockImplementationOnce(() => Promise.resolve());
        const refresh = coalesceReloads(read);
        await expect(refresh()).resolves.toBeUndefined();
        await expect(refresh()).resolves.toBeUndefined();
        expect(read).toHaveBeenCalledTimes(2);
    });
});

describe('the Orders page re-reads the floor after every order write, on events, and on a poll', () => {
    // Sliced BEFORE the comment stripper runs: the page's `input.accept = "image/*"`
    // would otherwise open a "comment" that swallows the component's start.
    const raw = readSource('src/app/dashboard/orders/page.tsx');
    const dashboard = code(raw.slice(raw.indexOf('function OrdersDashboard()'), raw.indexOf('function KitchenDisplay(')));

    it('the slice is the dashboard component', () => {
        expect(dashboard.length).toBeGreaterThan(50_000);
        expect(dashboard).toContain('const handleAddOrder = async');
    });
    /** A handler's body, from its declaration to the next one at the same depth. */
    const handler = (start: string): string => {
        const at = dashboard.indexOf(start);
        expect([start, at > -1]).toEqual([start, true]);
        const end = dashboard.indexOf('\n  const ', at + start.length);
        return dashboard.slice(at, end > -1 ? end : undefined);
    };

    it('refreshFloor is one coalesced /get-tables read, applied only when it differs from what is painted', () => {
        expect(dashboard).toMatch(/const refreshFloor = useMemo\(\(\) => coalesceReloads\(async \(\) => \{[\s\S]{0,200}?await whenFloorChanged\(\s*async \(\) => \{ const refreshed = await getTables\(restaurantId\); return Array\.isArray\(refreshed\) \? refreshed : \[\]; \},\s*\(\) => paintedFloorRef\.current,\s*\(next\) => \{ setTables\(next\); \},\s*\);/);
        expect(dashboard).toContain('useEffect(() => { paintedFloorRef.current = floorSignature(tables); }, [tables]);');
        // One definition: the old uncoalesced one is gone.
        expect(dashboard.match(/const refreshFloor = /g)).toHaveLength(1);
    });

    it('polls it, because a print claim emits no event', () => {
        expect(dashboard).toMatch(/const id = setInterval\(\(\) => \{ void refreshFloor\(\); \}, FLOOR_POLL_MS\);\s*return \(\) => \{ clearInterval\(id\); \};\s*\}, \[user\?\.restaurantUsername, refreshFloor\]\);/);
    });

    it('re-reads it on every realtime event that can change it, moves included', () => {
        const effect = dashboard.slice(dashboard.indexOf('const detail = e?.detail'), dashboard.indexOf("window.addEventListener('realtime:event'"));
        expect(effect.length).toBeGreaterThan(0);
        expect(effect).toContain('const moved = isTableMoveEvent(detail.event);');
        expect(effect).toContain('if (moved || isFloorRefreshEvent(detail.event)) {void refreshFloor();}');
        expect(effect).toContain("if (moved || detail.event === 'order:updated' || detail.event === 'bill:updated') {");
        // No second, uncoalesced floor read in the handler.
        expect(effect).not.toContain('getTables(');
        expect(dashboard).toContain('}, [user, refreshFloor]);');
    });

    it('THE FINDING: adding to a printed bill re-reads the floor with the orders, and a refusal re-reads it too', () => {
        const add = handler('const handleAddOrder = async');
        const post = add.indexOf('await addOrder(user.restaurantUsername, newOrder,');
        expect(post).toBeGreaterThan(-1);
        expect(add).toMatch(/const refused = billPrintedOf\(resp\);\s*if \(refused\) \{\s*(?:\/\/[^\n]*\s*)*void refreshFloor\(\);\s*return refused;/);
        expect(add).toMatch(/await Promise\.all\(\[\s*getOrders\(user\.restaurantUsername\),\s*getMonthlyApcInsight\(user\.restaurantUsername\),\s*(?:\/\/[^\n]*\s*)*refreshFloor\(\),\s*\]\);/);
        expect(add.indexOf('refreshFloor(),')).toBeGreaterThan(post);
    });

    it('every other order upsert on the page is followed by a floor re-read', () => {
        const upserts = [...dashboard.matchAll(/await addOrder\(user\.restaurantUsername, updatedOrder\);/g)];
        expect(upserts).toHaveLength(3);
        for (const m of upserts) {
            const at = m.index;
            // From the write to the handler's error path: the re-read is in between.
            const after = dashboard.slice(at, dashboard.indexOf('} catch (', at));
            expect([at, after.includes('void refreshFloor();')]).toEqual([at, true]);
        }
    });

    it('every settle, reopen, delete, replace and discount decision re-reads it', () => {
        const writes: [string, string][] = [
            ['const handleWaiterConfirmPayment = async', 'await confirmBillPaymentByWaiter('],
            ['const handleAdminApprovePayment = async', 'await approveBillPaymentByAdmin('],
            ['const handleCloseBill = async', 'await closeBillByOrder('],
            ['const submitSplitPayment = async', 'await confirmBillPaymentByWaiter('],
            ['const handleReopenBill = async', 'await reopenBill('],
            ['const handleDeleteOrder = async', 'await deleteOrder('],
            ['const handleReplaceBill = async', 'await replaceBill('],
            ['const handleDecideDiscount = async', 'await decideDiscountRequest('],
        ];
        for (const [start, write] of writes) {
            const body = handler(start);
            const at = body.indexOf(write);
            const reread = body.indexOf('refreshFloor()', at);
            expect([start, at > -1, reread > at, reread < body.indexOf('} catch', at)]).toEqual([start, true, true, true]);
        }
    });

    it('every panel that writes an order or a bill re-reads it when it says it changed something', () => {
        const callbacks = dashboard.match(/on(?:Changed|Settled)=\{\(\) => \{[^}]*\}\}/g) ?? [];
        expect(callbacks.length).toBe(4);
        for (const cb of callbacks) {
            expect(cb).toBe(cb.startsWith('onSettled') ? 'onSettled={() => { void refreshOrders(); void refreshFloor(); }}' : 'onChanged={() => { void refreshOrders(); void refreshFloor(); }}');
        }
    });

    it('the "the poll will catch up" comments are true now: there is a poll', () => {
        expect(dashboard).toContain('FLOOR_POLL_MS');
    });
});

describe('the Tables page follows the same events, and polls with one read', () => {
    const tables = code(readSource('src/app/dashboard/tables/page.tsx'));
    const hook = code(readSource('src/hooks/use-floor-tables.ts'));

    it('the hook\'s refresh is one coalesced read; the full reload only when it differs from the read the last reload painted', () => {
        expect(hook).toMatch(/const refresh = useMemo\(\(\) => coalesceReloads\(async \(\) => \{\s*if \(!restaurantId\) \{ return; \}\s*await whenFloorChanged\(\(\) => getTables\(restaurantId\), \(\) => paintedReadRef\.current, reload\);\s*\}\), \[restaurantId, reload\]\);/);
        expect(hook).toMatch(/const data = await getTables\(restaurantId\);\s*paintedReadRef\.current = floorSignature\(data\);/);
        expect(hook).toMatch(/setTables,\s*reload,\s*refresh,/);
    });

    it('the page re-reads the floor on order, bill and table events, and polls it', () => {
        expect(tables).toContain('reload: loadTables, refresh: refreshFloor } = floor;');
        const effect = tables.slice(tables.indexOf('const onRealtime = (event: Event): void => {'), tables.indexOf('}, [user?.restaurantUsername, reloadOrders, loadTables, refreshFloor]);'));
        expect(effect.length).toBeGreaterThan(0);
        expect(effect).toMatch(/if \(isTableMoveEvent\(name\)\) \{\s*void refreshAfterTableMove\(\{ tables: loadTables, orders: reloadOrders \}\);\s*return;\s*\}/);
        expect(effect).toContain('if (isFloorRefreshEvent(name)) { void refreshFloor(); }');
        expect(effect).toContain('const floorId = setInterval(() => { void refreshFloor(); }, FLOOR_POLL_MS);');
        expect(effect).toContain('clearInterval(floorId);');
        expect(effect).toContain('window.addEventListener("realtime:event", onRealtime);');
    });

    it('the floor plan editor is left alone: no poll re-lays tables under a drag', () => {
        const floorPlan = code(readSource('src/app/dashboard/floor-plan/page.tsx'));
        expect(floorPlan).not.toContain('refresh: ');
        expect(floorPlan).not.toContain('FLOOR_POLL_MS');
    });
});

describe('no event is dispatched where it cannot fire, or listened for when nobody sends it', () => {
    it('db.ts ("use server") dispatches no DOM event', () => {
        const db = readSource('src/lib/db.ts');
        expect(db.startsWith('"use server"')).toBe(true);
        expect(db).not.toContain('dispatchEvent(');
    });

    it('nobody listens for tables:changed', () => {
        for (const file of ['src/hooks/use-floor-tables.ts', 'src/app/dashboard/tables/page.tsx', 'src/app/dashboard/orders/page.tsx']) {
            expect([file, code(readSource(file)).includes('"tables:changed"') || code(readSource(file)).includes("'tables:changed'")]).toEqual([file, false]);
        }
    });
});
