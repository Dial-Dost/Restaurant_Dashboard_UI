// CLIENT ITEMS 1 AND 2 — THE FLOOR IS RE-READ, NOT REMEMBERED.
//
// Everything 2.0.2 paints about a printed table comes off the /get-tables row:
// the orange tile, "Updated — print again", "Print updated bill", the green
// next-party seat. None of it is worked out on the client, which is right, and
// it means a floor that is never re-read is simply wrong. Before this module:
//
//   - the Orders page re-read the floor only on table:added/deleted/updated, so a
//     waiter who confirmed "Add to printed bill" kept seeing "a reprint has to be
//     made by a senior" instead of "Print updated bill";
//   - the Tables page re-read it only after a move, and on a `tables:changed`
//     event that was dispatched from db.ts, a "use server" module where `window`
//     does not exist — so it never fired;
//   - a print claim emits no realtime event at all, so a bill printed on another
//     device never showed on either page.
//
// So both pages now re-read the floor on the realtime events that can change it,
// and poll it. The poll is ONE /get-tables read: the Tables page's full reload
// is a status read per table plus the sections and the bookings (a 40-table
// floor is 44 requests), so it runs only when that one read differs from the
// last (floorSignature). The same read is what a realtime event triggers, and
// the reads are coalesced (coalesceReloads), because a busy pass sends
// order:updated several times a second.
//
// PURE — no React, no DOM — so jest can hold it.

/** The polling beat: the one the Tables page's order clocks already use. */
export const FLOOR_POLL_MS = 20_000;

/**
 * The realtime events after which the floor may have changed: an order written
 * (has_order, the lines under a printed bill's paper), a bill changed (a
 * discount, a waiver, a settle), a table edited. The two move events are
 * table-move.ts's, which reload the orders behind the clocks as well.
 */
export const FLOOR_REFRESH_EVENTS: readonly string[] = [
    'order:updated',
    'bill:updated',
    'table:added',
    'table:deleted',
    'table:updated',
];

export const isFloorRefreshEvent = (event: unknown): boolean =>
    typeof event === 'string' && FLOOR_REFRESH_EVENTS.includes(event);

/**
 * A fingerprint of one /get-tables read: equal exactly when every row is equal,
 * whatever order the rows arrived in. Anything that is not a list (a failed
 * read) has its own fingerprint, so it never matches a real floor.
 */
export const floorSignature = (rows: unknown): string => {
    if (!Array.isArray(rows)) { return '<not a floor>'; }
    return JSON.stringify(rows.map((row) => JSON.stringify(row)).sort());
};

/**
 * THE LIGHT RE-READ: `read` the floor once, and `apply` it only when it differs
 * from what is painted (`painted` is asked AFTER the read, so a paint that landed
 * meanwhile counts). Answers whether it applied. A failed read throws, and
 * applies nothing.
 */
export const whenFloorChanged = async <T>(
    read: () => Promise<T>,
    painted: () => string,
    apply: (fresh: T) => void | Promise<void>,
): Promise<boolean> => {
    const fresh = await read();
    if (floorSignature(fresh) === painted()) { return false; }
    await apply(fresh);
    return true;
};

/**
 * ONE READ AT A TIME, AND NONE LOST.
 *
 * Called while a read is running, the returned function asks for ONE more
 * read after it, however many times it was called — a burst of realtime events
 * becomes at most two reads, and the second one sees everything the burst
 * wrote. Each call's promise settles when the read that covers it has finished.
 * A read that throws is swallowed: the next event or poll tick reads again.
 */
export const coalesceReloads = (read: () => Promise<void>): (() => Promise<void>) => {
    let running: Promise<void> | null = null;
    // Calls so far, and the count the read in flight started after: a call that
    // lands mid-read leaves the two apart, which is what asks for one more.
    let asked = 0;
    return () => {
        asked += 1;
        if (running) { return running; }
        running = (async () => {
            try {
                let covered: number;
                do {
                    covered = asked;
                    try { await read(); } catch { /* the next event or tick reads again */ }
                } while (asked !== covered);
            } finally {
                running = null;
            }
        })();
        return running;
    };
};
