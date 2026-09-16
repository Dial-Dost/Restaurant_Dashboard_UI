// CLIENT ITEM 6 — THE NEXT PARTY AT A PRINTED TABLE.
//
// "Table where bill is printed is disappearing from the waiter app. There
// should be a duplicate table showing same number for order taking for the
// next round of guests."
//
// ============================================================================
// WHAT THE SERVER DOES, AND WHAT THIS MODULE READS
// ============================================================================
// The disappearing is C3 and it stays: once a waiter prints a table's bill,
// that PARTY leaves their view and a manager settles it. What was missing is
// the NUMBER. The backend (Restaurant_Backend/next_party.ts, migration 053) now
// opens a second seat for it when any bill is printed — a real table row
// called "12 #2" — and retires it once it is idle. /get-tables sends it with
// three extra fields:
//
//   table_name    "12 #2"   the handle every route addresses it by
//   parent_table  "12"      null on every other table
//   party_no      2         null on every other table
//   display_name  "12"      what a tile prints big
//
// WHY THE TILE SAYS "12" AND THE PAPER SAYS "12 #2". The client asked for the
// same number, so a tile shows the root's number with a "Next party" chip. But
// two open bills for 12 must stay distinguishable at the till, so the KOT, the
// bill and every cashier list print the handle, and every request sends it.
// Nothing here ever sends the display name.
//
// THE ONE RULE FOR EVERY READER: a next-party seat is a SEPARATE TABLE for
// money. Labels may fold into the root ("12" in a table-wise report); a bill,
// a settle, a count of covers never does.
//
// ============================================================================
// THE WORDS ARE THE SERVER'S
// ============================================================================
// "Next party", "12 (next party)", "Take it on 12 (next party)", "Seat the next
// party at 12 (next party)." — the same words the Windows and Android till say
// (restaurant_owner_app/lib/models/next_party.dart). The test beside this file
// reads the backend's own source, so the three clients cannot drift into
// different words for one thing.

/** The chip on a next-party seat's tile. */
export const NEXT_PARTY_CHIP = 'Next party';

/** The machine-readable code on the server's 409 for an order added to a printed bill. */
export const BILL_PRINTED_CODE = 'bill_printed';

/** Between the root's name and the party number: never "-" (the print ledger's prefix). */
export const NEXT_PARTY_SEPARATOR = ' #';

/** POST /add-table's sentence for a reserved name, verbatim — shown before the request. */
export const RESERVED_TABLE_NAME_ERROR =
    'Table names ending in "#" and a number (like "12 #2") are kept for the next party at a printed table. Pick another name.';

const RESERVED_TAIL = /\s#\d+$/;

/** True for a name only the server may create — "12 #2", "Patio 4 #13". */
export const isReservedPartyName = (name: unknown): boolean =>
    typeof name === 'string' && RESERVED_TAIL.test(name.trim());

/** "12 #2" -> { root: "12", seq: 2 }; anything else -> null. */
export const parseNextPartyName = (name: unknown): { root: string; seq: number } | null => {
    if (typeof name !== 'string') { return null; }
    const m = /^(.*\S)\s#(\d+)$/.exec(name.trim());
    if (!m) { return null; }
    const seq = Number(m[2]);
    if (!Number.isSafeInteger(seq) || seq < 2) { return null; }
    return { root: m[1], seq };
};

/** "12" -> "12 (next party)". */
export const nextPartyLabel = (root: string): string => `${root.trim()} (next party)`;

/**
 * What a table is CALLED in a sentence or a picker: "12 (next party)" for a
 * next-party seat, its own name otherwise. The root is taken from the row when
 * it is known and from the handle's shape when it is not.
 */
export const tableSentenceName = (tableName: string, parentTable?: string | null): string => {
    const parent = (parentTable ?? '').trim();
    if (parent) { return nextPartyLabel(parent); }
    const parsed = parseNextPartyName(tableName);
    return parsed ? nextPartyLabel(parsed.root) : tableName.trim();
};

/** The shape every table-carrying screen here uses. */
export interface NextPartyAware {
    name: string;
    parent_table?: string | null;
    display_name?: string | null;
}

/** Is this table the next party's seat at another table? */
export const isNextPartyTable = (table: Pick<NextPartyAware, 'parent_table'> | null | undefined): boolean =>
    (table?.parent_table ?? '').trim().length > 0;

/**
 * The three /get-tables fields, read off a raw row for `mapTable`. Only a
 * well-formed value is carried: a row without them (a backend older than
 * migration 053) is a room table whose display name is its own.
 */
export const nextPartyRowFields = (
    row: unknown,
    name: string,
): { parent_table: string | null; party_no: number | null; display_name: string } => {
    const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
    const parent = typeof r.parent_table === 'string' ? r.parent_table.trim() : '';
    const partyNo = typeof r.party_no === 'number' && Number.isInteger(r.party_no) && r.party_no >= 2 ? r.party_no : null;
    const shown = typeof r.display_name === 'string' ? r.display_name.trim() : '';
    return {
        parent_table: parent || null,
        party_no: parent ? partyNo : null,
        display_name: shown || name,
    };
};

/** What a tile prints big: the root's number for a seat, the name otherwise. */
export const tableDisplayName = (table: NextPartyAware): string => {
    const parent = (table.parent_table ?? '').trim();
    if (parent) { return parent; }
    const shown = (table.display_name ?? '').trim();
    return shown || table.name;
};

/** A table as a picker or a sentence names it. */
export const tableOptionLabel = (table: NextPartyAware): string => tableSentenceName(table.name, table.parent_table);

/** The ROOM: every table that is not a next-party seat. */
export const roomTables = <T extends Pick<NextPartyAware, 'parent_table'>>(tables: readonly T[]): T[] =>
    tables.filter((t) => !isNextPartyTable(t));

/**
 * How many of the ROOM's tables are in use, where a table is in use when it,
 * or the next party's seat beside it, is `busy`. The same count the Windows and
 * Android Overview makes (countRoomsInUse in lib/models/next_party.dart).
 */
export const countRoomsInUse = <T extends NextPartyAware>(
    tables: readonly T[],
    busy: (table: T) => boolean,
): { inUse: number; rooms: number } => {
    const busyNumbers = new Set(
        tables.filter(busy).map((t) => (isNextPartyTable(t) ? t.parent_table ?? '' : t.name).trim().toLowerCase()),
    );
    const rooms = roomTables(tables);
    return { inUse: rooms.filter((t) => busyNumbers.has(t.name.trim().toLowerCase())).length, rooms: rooms.length };
};

/**
 * A zone's tables in the order the floor shows them: the room's order, with
 * each next-party seat straight after its own table (party order), so 12 and
 * "12 #2" are neighbours rather than wherever the alphabet puts them. A seat
 * whose table is not in this zone's list is not shown here — it belongs beside
 * its table, wherever that is.
 */
export const withNextPartySeats = <T extends NextPartyAware & { party_no?: number | null }>(
    zoneRooms: readonly T[],
    all: readonly T[],
): T[] => {
    const seatsByRoot = new Map<string, T[]>();
    for (const t of all) {
        if (!isNextPartyTable(t)) { continue; }
        const key = (t.parent_table ?? '').trim().toLowerCase();
        const list = seatsByRoot.get(key) ?? [];
        list.push(t);
        seatsByRoot.set(key, list);
    }
    const out: T[] = [];
    for (const room of zoneRooms) {
        out.push(room);
        const seats = seatsByRoot.get(room.name.trim().toLowerCase());
        if (seats) {
            out.push(...[...seats].sort((a, z) => (Number(a.party_no) || 0) - (Number(z.party_no) || 0)));
        }
    }
    return out;
};

/** The action beside a 409: "Take it on 12 (next party)". */
export const takeItOnLabel = (nextPartyTable: string): string => `Take it on ${tableSentenceName(nextPartyTable)}`;

/** The line after a print, when the server named a seat for the next party. */
export const nextPartyAfterPrintMessage = (nextPartyTable: string | null | undefined): string | null => {
    const next = (nextPartyTable ?? '').trim();
    return next ? `Seat the next party at ${tableSentenceName(next)}.` : null;
};

/**
 * A print's answer, read for the next party's seat. The server's own sentence
 * wins; a server that named the seat without one gets the same words built
 * here. Both null when there is no seat (a takeaway, or migration 053 absent).
 */
export const nextPartyAfterPrint = (body: unknown): { table: string | null; message: string | null } => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) { return { table: null, message: null }; }
    const b = body as { next_party_table?: unknown; next_party_message?: unknown };
    const table = typeof b.next_party_table === 'string' ? b.next_party_table.trim() : '';
    if (!table) { return { table: null, message: null }; }
    const said = typeof b.next_party_message === 'string' ? b.next_party_message.trim() : '';
    return { table, message: said || nextPartyAfterPrintMessage(table) };
};

/** The server's 409 for an order added to a printed bill, read. */
export interface BillPrintedRefusal {
    /** The server's sentence, shown as it stands. */
    message: string;
    /** The printed table. */
    table: string;
    /** Where a NEW party's order goes, or null when there is nowhere else. */
    nextPartyTable: string | null;
    /** The action's label, or null when there is no action to offer. */
    actionLabel: string | null;
}

/** Null unless [body] is a `bill_printed` refusal. */
export const readBillPrintedRefusal = (body: unknown): BillPrintedRefusal | null => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) { return null; }
    const b = body as Record<string, unknown>;
    if (b.code !== BILL_PRINTED_CODE) { return null; }
    const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
    const table = str(b.table);
    const next = str(b.next_party_table);
    const elsewhere = next !== '' && next.toLowerCase() !== table.toLowerCase();
    const label = str(b.next_party_action);
    return {
        message: str(b.error) || "This table's bill has already been printed.",
        table,
        nextPartyTable: elsewhere ? next : null,
        actionLabel: elsewhere ? (label || takeItOnLabel(next)) : null,
    };
};
