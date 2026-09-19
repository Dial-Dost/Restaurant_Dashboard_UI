// TABLES / FLOOR-PLAN MODULE — data layer + the pure floor rules.
//
// The web half of the Flutter floor module's pure logic:
//   * lib/models/floor_state.dart   — the five-state floor language
//   * lib/models/next_party.dart    — the "12 #2" next-party seat rules
//   * lib/screens/modules.dart      — the loader join (assignments, clubbed,
//     roster order), the zone comparator, allocateTableNames
//
// Fetchers call `requestBackend` (a server action in src/lib/db.ts); everything
// else here is pure so the pages and the sheet can share one set of rules.

import { getBookings, requestBackend } from '@/lib/db';
import type { BillPrintState } from '@/lib/bill-print-state';
import { billPrintStateFields, serverBillPrintState } from '@/lib/bill-print-state';
import {
    can,
    canMoveOrderToTable,
    canMoveTableParty,
    hasPermission,
    isWaiterOnly,
    PERM_MANAGE_SECTIONS,
    showsMoney,
    type ScopedSession,
} from '@/lib/session-scope';
import { dayKeyInZone } from '@/lib/tz';

/* ────────────────────────────────────────────────────────────────────────
   Raw-row readers
   ──────────────────────────────────────────────────────────────────────── */

type Row = Record<string, unknown>;

const str = (row: Row | null | undefined, key: string): string => {
    const v = row?.[key];
    if (v == null) { return ''; }
    if (typeof v === 'string') { return v.trim(); }
    if (typeof v === 'number' || typeof v === 'boolean') { return String(v); }
    return '';
};

const intOf = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) { return Math.round(v); }
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        return Number.isFinite(n) ? Math.round(n) : null;
    }
    return null;
};

const numOf = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) { return v; }
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }
    return null;
};

const strList = (v: unknown): string[] =>
    Array.isArray(v)
        ? (v as unknown[]).map((e) => (typeof e === 'string' ? e : String(e as string | number))).filter((e) => e.length > 0)
        : [];

/* ────────────────────────────────────────────────────────────────────────
   Next-party seats — lib/models/next_party.dart, word for word
   ──────────────────────────────────────────────────────────────────────── */

/** The chip on a next-party seat's tile. */
export const NEXT_PARTY_CHIP = 'Next party';

/** The sentence POST /add-table refuses a reserved name with, said client-side first. */
export const RESERVED_TABLE_NAME_ERROR =
    'Table names ending in "#" and a number (like "12 #2") are kept for the next party at a printed table. Pick another name.';

const RESERVED_TAIL = /\s#\d+$/;

/** True for a name only the server may create — "12 #2", "Patio 4 #13". */
export const isReservedPartyName = (name: string | null | undefined): boolean =>
    RESERVED_TAIL.test((name ?? '').trim());

/** The root's name when this /get-tables row is a next-party seat, else null. */
export const parentTableOf = (row: Row | null | undefined): string | null => {
    const p = str(row, 'parent_table');
    return p === '' ? null : p;
};

/** Is this row the next party's seat at another table? */
export const isNextPartyRow = (row: Row | null | undefined): boolean => parentTableOf(row) !== null;

/** What a tile prints big: the root's number for a sibling, the name otherwise. */
export const tableDisplayName = (row: Row | null | undefined): string => {
    const parent = parentTableOf(row);
    if (parent !== null) { return parent; }
    const shown = str(row, 'display_name');
    return shown !== '' ? shown : str(row, 'table_name');
};

/** "#2" — the small chip on a next-party seat. Null unless a whole number ≥ 2. */
export const nextPartyBadge = (partyNo: unknown): string | null => {
    const n = numOf(partyNo);
    if (n === null || n !== Math.round(n)) { return null; }
    return n >= 2 ? `#${String(Math.round(n))}` : null;
};

/** "12 #2" -> { root: "12", seq: 2 }; anything else -> null. */
export const parseNextPartyName = (name: string | null | undefined): { root: string; seq: number } | null => {
    const m = /^(.*\S)\s#(\d+)$/.exec((name ?? '').trim());
    if (!m) { return null; }
    const seq = Number(m[2]);
    if (!Number.isFinite(seq) || seq < 2) { return null; }
    return { root: m[1], seq };
};

/** "12" -> "12 (next party)". */
export const nextPartyLabel = (root: string): string => `${root.trim()} (next party)`;

/** What a table is called in a sentence: "12 (next party)" for a sibling. */
export const tableSentenceName = (tableName: string, parentTable?: string | null): string => {
    const parent = (parentTable ?? '').trim();
    if (parent !== '') { return nextPartyLabel(parent); }
    const parsed = parseNextPartyName(tableName);
    return parsed !== null ? nextPartyLabel(parsed.root) : tableName.trim();
};

/** The same, read off a /get-tables row. */
export const tableSentenceNameOf = (row: Row): string =>
    tableSentenceName(str(row, 'table_name'), parentTableOf(row));

/** The FAMILY a row belongs to: the root's name for a next-party seat. */
export const tableFamilyKey = (row: Row): string =>
    (parentTableOf(row) ?? str(row, 'table_name')).toLowerCase();

/** Are these two rows the SAME physical table ("12" and "12 #2")? */
export const sameTableFamily = (a: Row, b: Row): boolean => {
    const key = tableFamilyKey(a);
    return key !== '' && key === tableFamilyKey(b);
};

/** The body key the server reads for an addition to a printed bill. */
export const ADD_TO_PRINTED_BILL_KEY = 'add_to_printed_bill';

/** The orange tile's first control, and the confirm's primary action. */
export const ADD_TO_PRINTED_BILL_ACTION = 'Add to printed bill';

/** "Add to 12's printed bill". */
export const addToPrintedBillLabel = (table: string, parentTable?: string | null): string =>
    `Add to ${tableSentenceName(table, parentTable)}'s printed bill`;

/** "Use green 12" — the confirm's other action: the next party's seat.
 *  (Not `useGreenTableLabel`: a `use` prefix reads as a React hook here.) */
export const greenSeatLabel = (root: string): string => `Use green ${root.trim()}`;

/** The add-to-printed confirm body, exactly as the app says it. */
export const addToPrintedBillConfirm = (opts: {
    table: string;
    parentTable?: string | null;
    printedClock?: string | null;
    hasGreen: boolean;
}): string => {
    const named = tableSentenceName(opts.table, opts.parentTable);
    const parent = (opts.parentTable ?? '').trim();
    const root = parent !== '' ? parent : (parseNextPartyName(opts.table)?.root ?? opts.table.trim());
    const when = (opts.printedClock ?? '').trim();
    const printed = when !== '' ? `${named}'s bill was printed at ${when}.` : `${named}'s bill has been printed.`;
    const green = opts.hasGreen ? ` New guests? Use the green ${root}.` : '';
    return `${printed} These items go on that bill and it must be printed again.${green}`;
};

/**
 * The green seat beside a printed table: the family's free member other than
 * `printedRow` — the root when it is free, else the lowest-numbered free
 * next-party seat. Null when the whole family is busy.
 */
export const greenSeatFor = (
    printedRow: Row,
    rows: readonly Row[],
    isFree: (row: Row) => boolean,
): Row | null => {
    const self = str(printedRow, 'table_name').toLowerCase();
    const free = rows.filter((r) =>
        sameTableFamily(printedRow, r)
        && str(r, 'table_name').toLowerCase() !== self
        && isFree(r));
    for (const r of free) {
        if (!isNextPartyRow(r)) { return r; }
    }
    const seq = (r: Row): number => numOf(r.party_no) ?? Number.MAX_SAFE_INTEGER;
    const sorted = [...free].sort((a, b) => seq(a) - seq(b));
    return sorted.length > 0 ? sorted[0] : null;
};

/** A print's response, read for the next party's seat. */
export const nextPartyAfterPrint = (
    response: unknown,
): { table: string | null; message: string | null } => {
    if (typeof response !== 'object' || response === null) { return { table: null, message: null }; }
    const body = response as Row;
    const table = str(body, 'next_party_table');
    if (table === '') { return { table: null, message: null }; }
    const said = str(body, 'next_party_message');
    return { table, message: said !== '' ? said : `Seat the next party at ${tableSentenceName(table)}.` };
};

/** What a party move says before it runs, when the party's bill was printed. */
export const printedPartyMoveNote = (from: string, to: string): string =>
    `The printed bill moves with them. The guest's paper still says ${from.trim()}; `
    + `the bill will show as ${to.trim()} (printed as ${from.trim()}).`;

/** A move is not queued: the offline sentence, verbatim from the app. */
export const MOVE_TABLE_NEEDS_CONNECTION =
    'Moving a table needs a connection — nothing was moved. Reconnect and try again.';

/* ────────────────────────────────────────────────────────────────────────
   Floor state — lib/models/floor_state.dart
   ──────────────────────────────────────────────────────────────────────── */

/** The five states a tile can be in, in the legend's order: busiest first. */
export const FLOOR_STATES = ['running', 'printed', 'seated', 'reserved', 'free'] as const;
export type FloorTileState = (typeof FLOOR_STATES)[number];

/** What the chip and the legend say. */
export const FLOOR_STATE_WORDS: Readonly<Record<FloorTileState, string>> = {
    running: 'Running',
    printed: 'Bill printed',
    seated: 'Seated',
    reserved: 'Reserved',
    free: 'Free',
};

/** The chip on a printed tile whose paper no longer matches the bill. */
export const PAPER_STALE_CHIP = 'Updated — print again';

/** Is a party physically at this table? (`is_occupied`, either spelling.) */
export const tableSeated = (row: Row): boolean => row.seated === true || row.occupied === true;

/** Has anything been ordered yet? Missing key = true (older backend). */
export const tableHasOrder = (row: Row): boolean =>
    Object.prototype.hasOwnProperty.call(row, 'has_order') ? row.has_order === true : true;

/** What decides a tile's state — floorStateOf, line for line. */
export const floorStateOf = (opts: {
    seated: boolean;
    hasOrder: boolean | null;
    printed: boolean;
    reserved: boolean;
}): FloorTileState => {
    const inUse = opts.seated || opts.hasOrder === true;
    if (opts.printed && inUse) { return 'printed'; }
    if (inUse) { return opts.hasOrder === false ? 'seated' : 'running'; }
    if (opts.reserved) { return 'reserved'; }
    return 'free';
};

/** The five-state floor status of one raw /get-tables row. */
export const floorStateForRow = (row: Row): FloorTileState => floorStateOf({
    seated: tableSeated(row),
    hasOrder: Object.prototype.hasOwnProperty.call(row, 'has_order') ? row.has_order === true : null,
    printed: serverBillPrintState(row) ?? false,
    reserved: row.reserved === true || row.booked === true,
});

/** How strongly a tile is washed with its state's ink over the card. */
export const floorWash = (state: FloorTileState): number => {
    switch (state) {
        case 'running':
        case 'printed': return 0.18;
        case 'seated': return 0.16;
        case 'reserved': return 0.13;
        case 'free': return 0.10;
    }
};

/** Border strength per state (the app's border alpha). */
export const floorBorderAlpha = (state: FloorTileState): number => {
    switch (state) {
        case 'running':
        case 'printed': return 0.85;
        case 'seated': return 0.60;
        case 'reserved': return 0.50;
        case 'free': return 0.45;
    }
};

/**
 * The legend. Counted for a senior ("3 Running · 8 Bill printed"), count-free
 * for a waiter's colour key. Counted rows with no table are left out.
 */
export const floorLegend = (
    states: readonly FloorTileState[],
    withCounts: boolean,
): { state: FloorTileState; label: string; count: number }[] => {
    const counts = new Map<FloorTileState, number>();
    for (const s of states) { counts.set(s, (counts.get(s) ?? 0) + 1); }
    const rows: { state: FloorTileState; label: string; count: number }[] = [];
    for (const state of FLOOR_STATES) {
        const count = counts.get(state) ?? 0;
        if (withCounts && count === 0) { continue; }
        rows.push({
            state,
            label: withCounts ? `${count} ${FLOOR_STATE_WORDS[state]}` : FLOOR_STATE_WORDS[state],
            count,
        });
    }
    return rows;
};

/** Is the printed-only filter narrowing the floor right now? */
export const printedBacklogFilterOn = (
    requested: boolean,
    states: readonly FloorTileState[],
): boolean => requested && states.includes('printed');

const two = (v: number): string => String(v).padStart(2, '0');

/**
 * The print's clock as the restaurant reads it: "13:32", or "16/09 13:32" when
 * it was another day. '' when there is no print time.
 */
export const printedClockOf = (iso: string | null | undefined, timeZone: string): string => {
    if (typeof iso !== 'string' || iso.trim() === '') { return ''; }
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) { return ''; }
    const when = new Date(ms);
    let clock = '';
    try {
        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
        }).formatToParts(when);
        const h = parts.find((p) => p.type === 'hour')?.value ?? '';
        const m = parts.find((p) => p.type === 'minute')?.value ?? '';
        if (h === '' || m === '') { return ''; }
        clock = `${h}:${m}`;
    } catch {
        return '';
    }
    const printedDay = dayKeyInZone(when, timeZone);
    const today = dayKeyInZone(new Date(), timeZone);
    if (printedDay === today || printedDay === '' ) { return clock; }
    const dayPart = printedDay.slice(8, 10);
    const monthPart = printedDay.slice(5, 7);
    return `${two(Number(dayPart))}/${two(Number(monthPart))} ${clock}`;
};

/** The LAST print instant a row/bill names, in the app's preference order. */
export const printedInstantOf = (row: Row | null | undefined): string | null => {
    for (const key of ['printed_at', 'last_printed_at', 'bill_printed_at']) {
        const v = str(row, key);
        if (v !== '') { return v; }
    }
    return null;
};

/** Three answers, as for the print: stale / not stale / nobody knows. */
export const paperStaleOf = (row: Row | null | undefined): boolean | null => {
    const v = row?.paper_stale;
    return typeof v === 'boolean' ? v : null;
};

/** "12" when the paper was printed under another table's name, else null. */
export const printedAsOf = (row: Row | null | undefined): string | null => {
    const v = str(row, 'printed_as');
    return v === '' ? null : v;
};

/** The small chips on a printed tile, in order. */
export const printedTileChips = (opts: {
    printedClock?: string | null;
    paperStale?: boolean | null;
    printedAs?: string | null;
}): string[] => {
    const clock = (opts.printedClock ?? '').trim();
    const as = (opts.printedAs ?? '').trim();
    const chips = [clock === '' ? 'Printed' : `Printed ${clock}`];
    if (opts.paperStale === true) { chips.push(PAPER_STALE_CHIP); }
    if (as !== '') { chips.push(`Printed as ${as}`); }
    return chips;
};

/** What the printed paper said the guest owes, or null. */
export const printedTotalOf = (bill: Row | null | undefined): number | null =>
    numOf(bill?.printed_total);

/**
 * The warning before a settle against out-of-date paper. Null unless the paper
 * is KNOWN to be stale. Amounts are named only when they genuinely differ.
 */
export const stalePaperSettleWarning = (opts: {
    paperStale: boolean | null;
    printedClock?: string | null;
    printedTotal: number | null;
    grandTotal: number | null;
    money: (amount: number) => string;
}): string | null => {
    if (opts.paperStale !== true) { return null; }
    const when = (opts.printedClock ?? '').trim();
    const paper = when === '' ? 'The printed bill' : `The printed bill (${when})`;
    const printed = opts.printedTotal === null ? null : opts.money(opts.printedTotal);
    const now = opts.grandTotal === null ? null : opts.money(opts.grandTotal);
    const differ = opts.printedTotal !== null
        && opts.grandTotal !== null
        && Math.round(opts.printedTotal * 100) !== Math.round(opts.grandTotal * 100)
        && printed !== now;
    const amounts = differ && printed !== null && now !== null
        ? `${paper} shows ${printed}; the bill is now ${now}.`
        : `${paper} no longer matches the bill.`;
    return `${amounts} Print the updated bill before taking payment.`;
};

/** "Settle anyway" — the override on the stale-paper warning. */
export const SETTLE_ANYWAY_LABEL = 'Settle anyway';

/** The print control's two words. */
export const PRINT_BILL_LABEL = 'Print bill';
export const PRINT_UPDATED_BILL_LABEL = 'Print updated bill';

/* ────────────────────────────────────────────────────────────────────────
   Seats / OTP / money read-outs
   ──────────────────────────────────────────────────────────────────────── */

/** "4 seats", or "4 seats · max 6" when extra chairs push it further. */
export const seatsLabel = (row: Row | null | undefined): string => {
    const cap = intOf(row?.capacity);
    const max = intOf(row?.max_capacity) ?? cap;
    if (cap === null) { return max === null ? '' : `max ${max}`; }
    return max !== null && max > cap ? `${cap} seats · max ${max}` : `${cap} seats`;
};

/** The per-table ordering OTP as it should be SHOWN — '' when it must not be. */
export const tableOtp = (row: Row | null | undefined): string =>
    row?.otp_required === false ? '' : str(row, 'order_otp');

/* ────────────────────────────────────────────────────────────────────────
   The floor payload — the loader join _floorModule performs
   ──────────────────────────────────────────────────────────────────────── */

/** One /get-tables row, joined with its waiter and clubbed partners. */
export interface FloorRow {
    /** The handle every request and the paper use. */
    name: string;
    raw: Row;
    capacity: number;
    max_capacity: number;
    seated: boolean;
    hasOrder: boolean | null;
    reserved: boolean;
    booked: boolean;
    covers: number | null;
    payment_pending: boolean;
    table_total: number | null;
    table_apc: number | null;
    apc_status: string;
    order_otp: string;
    qr_token: string | null;
    qr_sig: string | null;
    section: string | null;
    parent_table: string | null;
    party_no: number | null;
    /** The server's print ledger for this seating, or null when never asked. */
    bill_print: BillPrintState | null;
    printed: boolean;
    paper_stale: boolean | null;
    printed_as: string | null;
    printed_at_iso: string | null;
    waiter_name: string | null;
    waiter_id: string | null;
    clubbed_with: string[];
    state: FloorTileState;
}

export interface FloorPayload {
    rows: FloorRow[];
    /** Zone roster names. Empty when the roster was not asked for / failed. */
    zones: string[];
    /** Why the roster couldn't be read; '' when it was (or was not asked). */
    zoneError: string;
    /** zone key (lower-cased) -> 1-based owner-chosen position. */
    zoneOrder: Record<string, number>;
    /** zone key -> earliest evidence of the zone (ISO instant). */
    zoneBorn: Record<string, string>;
}

const mapFloorRow = (raw: Row): FloorRow => ({
    name: str(raw, 'table_name'),
    raw,
    capacity: intOf(raw.capacity) ?? 0,
    max_capacity: intOf(raw.max_capacity) ?? intOf(raw.capacity) ?? 0,
    seated: tableSeated(raw),
    hasOrder: Object.prototype.hasOwnProperty.call(raw, 'has_order') ? raw.has_order === true : null,
    reserved: raw.reserved === true,
    booked: raw.booked === true,
    covers: intOf(raw.covers),
    payment_pending: raw.payment_pending === true,
    table_total: numOf(raw.table_total),
    table_apc: numOf(raw.table_apc),
    apc_status: str(raw, 'apc_status') || 'neutral',
    order_otp: tableOtp(raw),
    qr_token: str(raw, 'qr_token') || null,
    qr_sig: str(raw, 'qr_sig') || null,
    section: str(raw, 'section') || null,
    parent_table: parentTableOf(raw),
    party_no: numOf(raw.party_no),
    bill_print: billPrintStateFields(raw),
    printed: serverBillPrintState(raw) ?? false,
    paper_stale: paperStaleOf(raw),
    printed_as: printedAsOf(raw),
    printed_at_iso: printedInstantOf(raw),
    waiter_name: str(raw, 'waiter_name') || null,
    waiter_id: str(raw, 'waiter_id') || null,
    clubbed_with: strList(raw.clubbed_with),
    state: floorStateForRow(raw),
});

/**
 * The floor, loaded the way the app's `_floorModule` loads it: the raw
 * /get-tables rows, joined (service surface only) with /table-assignments and
 * the clubbed bookings, plus the zone roster with its order/birth instants.
 * Throws when the TABLES read fails; every join is best-effort.
 */
export const fetchFloor = async (
    restaurantId: string,
    opts: { live: boolean; canReadZones: boolean },
): Promise<FloorPayload> => {
    const tablesRes = await requestBackend<Row[]>({
        path: `/get-tables?restaurantId=${encodeURIComponent(restaurantId)}`,
        method: 'GET',
        restaurantId,
    });
    if (!tablesRes.ok || !Array.isArray(tablesRes.data)) {
        throw new Error(tablesRes.text || 'Could not read the floor plan.');
    }
    const rawRows: Row[] = tablesRes.data;

    if (opts.live) {
        // Waiter assignments — optional, joined by lower-cased table name.
        try {
            const assignRes = await requestBackend<Row[]>({
                path: `/table-assignments?restaurantId=${encodeURIComponent(restaurantId)}`,
                method: 'GET',
                restaurantId,
            });
            if (assignRes.ok && Array.isArray(assignRes.data)) {
                const byName = new Map<string, Row>();
                for (const a of assignRes.data) {
                    byName.set(str(a, 'table_name').toLowerCase(), a);
                }
                for (const row of rawRows) {
                    const a = byName.get(str(row, 'table_name').toLowerCase());
                    if (a) {
                        row.waiter_name = str(a, 'employee_name');
                        row.waiter_id = str(a, 'employee_id');
                    }
                }
            }
        } catch { /* assignments are optional */ }

        // Clubbed bookings — a clubbed party lives on the BOOKING, not the table.
        try {
            const bookings = await getBookings(restaurantId);
            const clubbed = new Map<string, string[]>();
            for (const booking of Array.isArray(bookings) ? bookings : []) {
                const status = (booking.status || '').toLowerCase();
                if (status.includes('cancel') || status.includes('no')) { continue; }
                const names = Array.isArray(booking.table_names) ? booking.table_names : [];
                if (names.length < 2) { continue; }
                for (const n of names) { clubbed.set(n.toLowerCase(), names); }
            }
            for (const row of rawRows) {
                const key = str(row, 'table_name').toLowerCase();
                const set = clubbed.get(key);
                if (set) { row.clubbed_with = set.filter((n) => n.toLowerCase() !== key); }
            }
        } catch { /* bookings are optional here */ }
    }

    // Zone order + birth off the TABLE rows (visible to every role)…
    const zoneOrder: Record<string, number> = {};
    const zoneBorn: Record<string, string> = {};
    for (const row of rawRows) {
        const label = str(row, 'section');
        if (label === '') { continue; }
        const key = label.toLowerCase();
        const pos = intOf(row.section_position);
        if (pos !== null && !(key in zoneOrder)) { zoneOrder[key] = pos; }
        const at = str(row, 'section_created_at');
        if (at !== '' && !(key in zoneBorn)) { zoneBorn[key] = at; }
    }

    // …and the roster, which is the only place an EMPTY zone exists.
    let zones: string[] = [];
    let zoneError = '';
    if (opts.canReadZones) {
        try {
            const rosterRes = await requestBackend<{ sections?: Row[] }>({
                path: '/table-sections',
                method: 'GET',
                restaurantId,
            });
            const sections = rosterRes.data?.sections;
            if (!rosterRes.ok || !Array.isArray(sections)) {
                zoneError = rosterRes.text || `Roster request failed (${String(rosterRes.status)})`;
            } else {
                zones = sections.map((s) => str(s, 'section')).filter((s) => s !== '');
                for (const s of sections) {
                    const label = str(s, 'section');
                    if (label === '') { continue; }
                    const key = label.toLowerCase();
                    const pos = intOf(s.sort_order);
                    if (pos !== null) { zoneOrder[key] = pos; }
                    const at = str(s, 'created_at');
                    if (at !== '') { zoneBorn[key] = at; }
                }
            }
        } catch (e) {
            zoneError = e instanceof Error ? e.message : String(e);
        }
    }

    return { rows: rawRows.map(mapFloorRow), zones, zoneError, zoneOrder, zoneBorn };
};

/* ────────────────────────────────────────────────────────────────────────
   Section order — the server's comparator (_compareZoneKeys)
   ──────────────────────────────────────────────────────────────────────── */

/**
 * The one order the floor draws sections in:
 *   1. positioned zones first, in the owner's chosen position,
 *   2. then everything unpositioned in creation order, oldest first,
 *   3. then alphabetically on the key.
 */
export const compareZoneKeys = (
    a: string,
    b: string,
    order: Readonly<Record<string, number>>,
    born: Readonly<Record<string, string>>,
): number => {
    const ap = a in order ? order[a] : null;
    const bp = b in order ? order[b] : null;
    if ((ap === null) !== (bp === null)) { return ap === null ? 1 : -1; }
    if (ap !== null && bp !== null && ap !== bp) { return ap - bp; }
    const ab = a in born ? born[a] : null;
    const bb = b in born ? born[b] : null;
    if ((ab === null) !== (bb === null)) { return ab === null ? 1 : -1; }
    if (ab !== null && bb !== null && ab !== bb) { return ab < bb ? -1 : 1; }
    return a < b ? -1 : a > b ? 1 : 0;
};

export interface FloorSectionGroup {
    /** Lower-cased identity; '' for Unassigned. */
    key: string;
    /** The label as it should read and be written back. */
    name: string;
    rows: FloorRow[];
}

/**
 * The floor grouped by section, in the server's order, "Unassigned" LAST.
 * `pendingSections` overlays optimistic membership (tableKey -> section|null),
 * `zoneOverlay` optimistic zone renames/creates/dissolves (zoneKey -> name|null),
 * and `orderPending` an optimistic arrangement (zone keys in sequence).
 */
export const composeFloorSections = (
    rows: readonly FloorRow[],
    zones: readonly string[],
    zoneOrder: Readonly<Record<string, number>>,
    zoneBorn: Readonly<Record<string, string>>,
    opts?: {
        pendingSections?: Readonly<Record<string, string | null>>;
        zoneOverlay?: Readonly<Record<string, string | null>>;
        orderPending?: readonly string[] | null;
        includeEmptyZones?: boolean;
    },
): FloorSectionGroup[] => {
    const pending = opts?.pendingSections ?? {};
    const overlay = opts?.zoneOverlay ?? {};
    const includeEmpty = opts?.includeEmptyZones ?? true;

    const sectionOf = (row: FloorRow): string | null => {
        const key = row.name.toLowerCase();
        if (key in pending) { return pending[key]; }
        return row.section;
    };

    const groups = new Map<string, FloorRow[]>();
    const labels = new Map<string, string>();
    for (const row of rows) {
        const s = sectionOf(row);
        const key = (s ?? '').toLowerCase();
        const bucket = groups.get(key);
        if (bucket) { bucket.push(row); } else { groups.set(key, [row]); }
        if (s !== null && s !== '' && !labels.has(key)) { labels.set(key, s); }
    }

    if (includeEmpty) {
        // Roster names (with any optimistic rename/create/dissolve applied).
        const roster = new Map<string, string>();
        for (const z of zones) {
            const name = z.trim();
            if (name === '') { continue; }
            const key = name.toLowerCase();
            if (key in overlay) {
                const next = overlay[key];
                if (next !== null) { roster.set(next.toLowerCase(), next); }
                continue;
            }
            if (!roster.has(key)) { roster.set(key, name); }
        }
        for (const next of Object.values(overlay)) {
            if (next !== null && !roster.has(next.toLowerCase())) {
                roster.set(next.toLowerCase(), next);
            }
        }
        for (const [key, name] of roster) {
            if (!groups.has(key)) { groups.set(key, []); }
            if (!labels.has(key)) { labels.set(key, name); }
        }
    }

    const orderPending = opts?.orderPending ?? null;
    const positionOf = (key: string): number | null => {
        if (orderPending) {
            const i = orderPending.indexOf(key);
            return i < 0 ? null : i + 1;
        }
        return key in zoneOrder ? zoneOrder[key] : null;
    };
    const effectiveOrder: Record<string, number> = {};
    for (const key of groups.keys()) {
        const p = positionOf(key);
        if (p !== null) { effectiveOrder[key] = p; }
    }

    const named = [...groups.keys()].filter((k) => k !== '')
        .sort((a, b) => compareZoneKeys(a, b, effectiveOrder, zoneBorn));
    const ordered = [...named, ...(groups.has('') ? [''] : [])];

    return ordered.map((key) => ({
        key,
        name: key === '' ? 'Unassigned' : (labels.get(key) ?? key),
        rows: groups.get(key) ?? [],
    }));
};

/* ────────────────────────────────────────────────────────────────────────
   Bulk table runs — allocateTableNames, verbatim behaviour
   ──────────────────────────────────────────────────────────────────────── */

export interface TableNameRun {
    /** Names to create, in order. */
    names: string[];
    /** Names inside the scanned range that already exist. */
    skipped: string[];
    /** '' when the run is exactly what was asked for. */
    problem: string;
}

const tableScanWindow = (count: number): number => 500 + 100 * count;

/** A run's names as something a person can read. */
export const tableNameList = (names: readonly string[], show = 12): string =>
    names.length <= show
        ? names.join(', ')
        : `${names.slice(0, show).join(', ')} … and ${String(names.length - show)} more`;

/**
 * Splits `seed` into a prefix and its trailing number and returns the next
 * `count` FREE numbers from there, stepping over every name in `existing`.
 * Zero-padding is kept; matching is case-insensitive.
 */
export const allocateTableNames = (
    seed: string,
    count: number,
    existing: readonly string[],
): TableNameRun => {
    const trimmed = seed.trim();
    if (trimmed === '' || count < 1) { return { names: [], skipped: [], problem: '' }; }
    const match = /^(.*?)(\d+)$/.exec(trimmed);
    const prefix = match ? match[1] : trimmed;
    const digits = match ? match[2] : '1';
    const window = tableScanWindow(count);
    const start = Number(digits);
    if (!Number.isSafeInteger(start) || start + count + window < start) {
        return {
            names: [],
            skipped: [],
            problem: `No tables were numbered: the number at the end of "${trimmed}" is too large to `
                + 'count on from. Start the run from a smaller number.',
        };
    }
    const width = digits.length;
    const taken = new Set<string>();
    for (const n of existing) {
        const t = n.trim();
        if (t !== '') { taken.add(t.toLowerCase()); }
    }
    const names: string[] = [];
    const skipped: string[] = [];
    const limit = start + count + window;
    let n = start;
    for (; names.length < count && n < limit; n++) {
        const candidate = `${prefix}${String(n).padStart(width, '0')}`;
        const key = candidate.toLowerCase();
        if (taken.has(key)) {
            skipped.push(candidate);
            continue;
        }
        taken.add(key);
        names.push(candidate);
    }
    if (names.length === count) { return { names, skipped, problem: '' }; }
    const first = `${prefix}${String(start).padStart(width, '0')}`;
    const last = `${prefix}${String(n - 1).padStart(width, '0')}`;
    return {
        names,
        skipped,
        problem: `Only ${String(names.length)} of the ${String(count)} asked for could be numbered: every other name from `
            + `"${first}" up to "${last}" is already on the floor. Start the run from a higher number.`,
    };
};

/** The most tables one run may create. */
export const MAX_TABLE_RUN = 50;

/* ────────────────────────────────────────────────────────────────────────
   Floor scope — models/role_scope.dart FloorScope, web port
   ──────────────────────────────────────────────────────────────────────── */

export type FloorSurface = 'service' | 'plan';

export interface FloorScope {
    seat: boolean;
    settle: boolean;
    release: boolean;
    editSeating: boolean;
    deleteTable: boolean;
    addTable: boolean;
    arrangeFloor: boolean;
    billOps: boolean;
    guestQr: boolean;
    assignWaiter: boolean;
    money: boolean;
    floorSummary: boolean;
    managerOnlyAsks: boolean;
    moveTable: boolean;
    moveOrder: boolean;
    addToPrinted: boolean;
}

/** What this session may DO on a table, and whether it may see money. */
export const floorScopeOf = (
    session: ScopedSession | null | undefined,
    surface: FloorSurface = 'service',
): FloorScope => {
    const waiterOnly = isWaiterOnly(session);
    const layout = surface === 'plan';
    const mayClose = can(session, 'settle_bill');
    const mayEditTable = can(session, 'edit_table');
    const mayDeleteTable = can(session, 'delete_table');
    return {
        seat: !waiterOnly,
        settle: !waiterOnly && mayClose,
        release: !waiterOnly && mayClose,
        editSeating: !waiterOnly && layout && mayEditTable,
        deleteTable: !waiterOnly && layout && mayDeleteTable,
        addTable: !waiterOnly && layout && mayEditTable,
        arrangeFloor: !waiterOnly && layout,
        billOps: !waiterOnly,
        guestQr: !waiterOnly,
        assignWaiter: !waiterOnly,
        money: showsMoney(session),
        floorSummary: !waiterOnly,
        managerOnlyAsks: !waiterOnly,
        moveTable: canMoveTableParty(session),
        moveOrder: !waiterOnly && canMoveOrderToTable(session),
        addToPrinted: true,
    };
};

/** May this session read the zone roster (GET /table-sections)? */
export const canReadZoneRoster = (session: ScopedSession | null | undefined): boolean =>
    hasPermission(session?.actions_set, PERM_MANAGE_SECTIONS);

/* ────────────────────────────────────────────────────────────────────────
   Writes this module owns
   ──────────────────────────────────────────────────────────────────────── */

const bodyMessage = (res: { data: unknown; text: string }, fallback: string): string => {
    const data = res.data;
    if (typeof data === 'object' && data !== null) {
        const err = (data as Row).error;
        if (typeof err === 'string' && err.trim() !== '') { return err; }
        const details = (data as Row).details;
        if (typeof details === 'string' && details.trim() !== '') { return details; }
    }
    return res.text || fallback;
};

/** POST /table-sections — mint the NAME, which is what lets a zone start empty. */
export const createTableSection = async (
    restaurantId: string,
    name: string,
): Promise<void> => {
    const res = await requestBackend({
        path: '/table-sections',
        method: 'POST',
        restaurantId,
        body: { name },
    });
    if (!res.ok) { throw new Error(bodyMessage(res, 'Failed to create the section')); }
};

/** PATCH /table-sections/:name — rename the zone (empty ones included). */
export const renameTableSection = async (
    restaurantId: string,
    from: string,
    to: string,
): Promise<void> => {
    const res = await requestBackend({
        path: `/table-sections/${encodeURIComponent(from)}`,
        method: 'PATCH',
        restaurantId,
        body: { name: to },
    });
    if (!res.ok) { throw new Error(bodyMessage(res, 'Failed to rename the section')); }
};

/** DELETE /table-sections/:name — dissolve the zone; its tables become unassigned. */
export const deleteTableSection = async (
    restaurantId: string,
    name: string,
): Promise<void> => {
    const res = await requestBackend({
        path: `/table-sections/${encodeURIComponent(name)}`,
        method: 'DELETE',
        restaurantId,
    });
    if (!res.ok) { throw new Error(bodyMessage(res, 'Failed to remove the section')); }
};

/** PATCH /table/:name {section} — move ONE table between zones (null un-labels). */
export const setTableSection = async (
    restaurantId: string,
    tableName: string,
    section: string | null,
): Promise<void> => {
    const res = await requestBackend({
        path: `/table/${encodeURIComponent(tableName)}`,
        method: 'PATCH',
        restaurantId,
        body: { section },
    });
    if (!res.ok) { throw new Error(bodyMessage(res, 'Failed to move the table')); }
};

/** POST /add-table — one row of a run. Section omitted = Unassigned (null). */
export const addFloorTable = async (
    restaurantId: string,
    table: { name: string; capacity: number; max_capacity: number; section?: string },
): Promise<void> => {
    const section = table.section?.trim() ?? '';
    const res = await requestBackend({
        path: '/add-table',
        method: 'POST',
        restaurantId,
        body: {
            table: {
                name: table.name,
                capacity: table.capacity,
                max_capacity: table.max_capacity,
                ...(section !== '' ? { section } : {}),
            },
        },
    });
    if (!res.ok) { throw new Error(bodyMessage(res, 'Failed to create table')); }
};

/** DELETE /table/:name — the one delete in the product (C7/H8). */
export const removeFloorTable = async (
    restaurantId: string,
    tableName: string,
): Promise<void> => {
    const res = await requestBackend({
        path: `/table/${encodeURIComponent(tableName)}`,
        method: 'DELETE',
        restaurantId,
    });
    if (!res.ok && res.status !== 204) { throw new Error(bodyMessage(res, 'Failed to delete the table.')); }
};

/** PUT /table-sections/order — the WHOLE list, in the new order. */
export const saveSectionOrder = async (
    restaurantId: string,
    sectionNames: readonly string[],
): Promise<void> => {
    const res = await requestBackend({
        path: '/table-sections/order',
        method: 'PUT',
        restaurantId,
        body: { sections: sectionNames },
    });
    if (!res.ok) { throw new Error(bodyMessage(res, 'Could not save the section order.')); }
};

/** POST /print/bill — the server-side thermal print, with the next-party read. */
export const printTableBill = async (
    restaurantId: string,
    tableName: string,
): Promise<{ nextParty: { table: string | null; message: string | null }; response: unknown }> => {
    const res = await requestBackend({
        path: '/print/bill',
        method: 'POST',
        restaurantId,
        body: { table_name: tableName },
    });
    if (!res.ok) { throw new Error(bodyMessage(res, 'Could not print the bill.')); }
    return { nextParty: nextPartyAfterPrint(res.data), response: res.data };
};

/** POST /bills/merge — merge another occupied table's orders into this one. */
export const mergeTableBills = async (
    restaurantId: string,
    fromTable: string,
    toTable: string,
): Promise<unknown> => {
    const res = await requestBackend({
        path: '/bills/merge',
        method: 'POST',
        restaurantId,
        body: { from_table: fromTable, to_table: toTable },
    });
    if (!res.ok) { throw new Error(bodyMessage(res, 'Could not merge the tables.')); }
    return res.data;
};

/** POST /bills/discount — apply/clear a discount on the open bill. */
export const setBillDiscount = async (
    restaurantId: string,
    tableName: string,
    type: 'percent' | 'flat',
    value: number,
): Promise<{ pending: boolean }> => {
    const res = await requestBackend({
        path: '/bills/discount',
        method: 'POST',
        restaurantId,
        body: { table_name: tableName, type, value },
    });
    if (!res.ok) { throw new Error(bodyMessage(res, 'Could not apply the discount.')); }
    const pending = typeof res.data === 'object' && res.data !== null && (res.data as Row).pending === true;
    return { pending };
};

/** POST /bills/apply-coupon. Returns the discount figure when the server names one. */
export const applyBillCoupon = async (
    restaurantId: string,
    tableName: string,
    code: string,
): Promise<number | null> => {
    const res = await requestBackend({
        path: '/bills/apply-coupon',
        method: 'POST',
        restaurantId,
        body: { table_name: tableName, code },
    });
    if (!res.ok) { throw new Error(bodyMessage(res, 'Could not apply the coupon.')); }
    return typeof res.data === 'object' && res.data !== null ? numOf((res.data as Row).discount) : null;
};

/** POST /bills/split — even split, N ways. */
export const splitBillEvenly = async (
    restaurantId: string,
    tableName: string,
    parts: number,
): Promise<{ grand_total: number | null; parts: { label: string; total: number | null }[] }> => {
    const res = await requestBackend({
        path: '/bills/split',
        method: 'POST',
        restaurantId,
        body: { table_name: tableName, mode: 'even', parts },
    });
    if (!res.ok) { throw new Error(bodyMessage(res, 'Could not split the bill.')); }
    const body = typeof res.data === 'object' && res.data !== null ? (res.data as Row) : {};
    const rawParts = Array.isArray(body.parts) ? (body.parts as unknown[]) : [];
    return {
        grand_total: numOf(body.grand_total),
        parts: rawParts
            .filter((p): p is Row => typeof p === 'object' && p !== null)
            .map((p) => ({ label: str(p, 'label'), total: numOf(p.total) })),
    };
};

/** POST /bills/order/:id/admin-approve-payment (+ the stale-paper record) then /close. */
export const approvePaymentAndClose = async (
    restaurantId: string,
    orderId: string,
    settledWithStalePaper: boolean,
): Promise<void> => {
    const approve = await requestBackend({
        path: `/bills/order/${encodeURIComponent(orderId)}/admin-approve-payment`,
        method: 'POST',
        restaurantId,
        body: settledWithStalePaper ? { settled_with_stale_paper: true } : {},
    });
    if (!approve.ok) { throw new Error(bodyMessage(approve, 'Could not approve the payment.')); }
    const close = await requestBackend({
        path: `/bills/order/${encodeURIComponent(orderId)}/close`,
        method: 'POST',
        restaurantId,
        body: {},
    });
    if (!close.ok) { throw new Error(bodyMessage(close, 'Could not close the bill.')); }
};

export interface AssignableWaiter {
    employee_id: string;
    employee_Username: string;
    emp_Fname: string;
    emp_Lname: string;
    role: string;
}

/**
 * The attendance-aware assignable roster (GET /table-assignments/assignable),
 * falling back to the full staff list on an older backend.
 */
export const fetchAssignableWaiters = async (
    restaurantId: string,
): Promise<{ employees: AssignableWaiter[]; attendanceInUse: boolean }> => {
    const readUsers = (list: unknown): AssignableWaiter[] =>
        (Array.isArray(list) ? list : [])
            .filter((u): u is Row => typeof u === 'object' && u !== null)
            .map((u) => ({
                employee_id: str(u, 'employee_id') || str(u, 'id'),
                employee_Username: str(u, 'employee_Username'),
                emp_Fname: str(u, 'emp_Fname'),
                emp_Lname: str(u, 'emp_Lname'),
                role: str(u, 'role') || 'staff',
            }))
            .filter((u) => u.employee_id !== '');
    const roster = await requestBackend<{ employees?: unknown; attendance_in_use?: unknown }>({
        path: '/table-assignments/assignable',
        method: 'GET',
        restaurantId,
    });
    if (roster.ok && roster.data) {
        return {
            employees: readUsers(roster.data.employees),
            attendanceInUse: roster.data.attendance_in_use === true,
        };
    }
    const users = await requestBackend<{ users?: unknown }>({
        path: '/restaurant/users',
        method: 'GET',
        restaurantId,
    });
    if (!users.ok) { throw new Error(bodyMessage(users, 'Could not read the staff list.')); }
    return { employees: readUsers(users.data?.users), attendanceInUse: false };
};

/* ────────────────────────────────────────────────────────────────────────
   Move-an-order wording — lib/models/order_moves.dart, word for word
   ──────────────────────────────────────────────────────────────────────── */

const textOf = (v: unknown): string => {
    if (v == null) { return ''; }
    const s = typeof v === 'string'
        ? v.trim()
        : (typeof v === 'number' || typeof v === 'boolean') ? String(v) : '';
    return s === 'null' ? '' : s;
};

const qtyOf = (v: unknown): number => {
    const n = Number(v ?? 1);
    const q = Number.isFinite(n) ? Math.round(n) : 1;
    return q < 1 ? 1 : q;
};

/** "2 × Dal (Half)" — one dish as the table sheet already prints it. */
export const moveDishLine = (line: Row): string => {
    const name = textOf(line.name) || textOf(line.item_name);
    const size = textOf(line.variation) || textOf(line.variation_name);
    const label = size === '' ? (name === '' ? 'Item' : name) : `${name === '' ? 'Item' : name} (${size})`;
    return `${String(qtyOf(line.quantity ?? line.qty))} × ${label}`;
};

/** Every dish on an order row of GET /orders, in the ticket's order. */
export const orderDishLines = (order: Row): string[] => {
    const food = order.food;
    const raw = Array.isArray(order.items)
        ? (order.items as unknown[])
        : (typeof food === 'object' && food !== null && Array.isArray((food as Row).items)
            ? ((food as Row).items as unknown[])
            : []);
    return raw
        .filter((it): it is Row => typeof it === 'object' && it !== null)
        .map(moveDishLine);
};

/** "1 × A, 1 × B, 1 × C +2 more" — the dishes in one line; null max names all. */
export const moveDishSummary = (lines: readonly string[], max: number | null = 3): string => {
    if (lines.length === 0) { return ''; }
    if (max === null || lines.length <= max) { return lines.join(', '); }
    return `${lines.slice(0, max).join(', ')} +${String(lines.length - max)} more`;
};

/** The KOT numbers on an order row, cleaned: positive, whole, de-duplicated. */
export const moveKotNos = (order: Row): number[] => {
    const raw = order.kot_nos;
    if (!Array.isArray(raw)) { return []; }
    const out: number[] = [];
    for (const v of raw as unknown[]) {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) { continue; }
        const i = Math.round(n);
        if (!out.includes(i)) { out.push(i); }
    }
    return out;
};

/** "KOT 65" / "KOTs 65, 66" — or "No KOT number", the sheet's own words. */
export const moveOrderTitle = (order: Row): string => {
    const nos = moveKotNos(order);
    if (nos.length === 0) { return 'No KOT number'; }
    return `${nos.length === 1 ? 'KOT' : 'KOTs'} ${nos.join(', ')}`;
};

/**
 * DOES THE KITCHEN HAVE THIS TICKET? A KOT number means a docket printed, a
 * bark means the pass announced it, and either is enough. A row with no
 * `barked_at` key (a backend older than the field) reads as barked.
 */
export const moveOrderKitchenHas = (order: Row): boolean =>
    moveKotNos(order).length > 0
    || !Object.prototype.hasOwnProperty.call(order, 'barked_at')
    || order.barked_at !== null;

/** What the kitchen will see when an order moves — said before the move. */
export const moveOrderKitchenSentence = (opts: { fromTable: string; toTable: string; barked: boolean }): string =>
    opts.barked
        ? `The kitchen already has a docket for ${opts.fromTable}, so a correction docket `
        + `prints for ${opts.toTable} with the same KOT number. ${opts.fromTable} keeps its guests `
        + 'and its other orders.'
        : 'The kitchen has not been sent this order yet, so nothing prints now — '
        + `it will print for ${opts.toTable} when it is sent.`;

/**
 * What the person who moved an order is told, from the server's answer:
 * "Moved to 15: 2 × Dal. Correction docket KOT-65 is printing — tell the pass."
 */
export const movedOrderDishesSentence = (opts: {
    toTable: string;
    printed: boolean;
    kotNo?: unknown;
    dishes?: readonly string[];
}): string => {
    const summary = moveDishSummary(opts.dishes ?? []);
    const head = summary === '' ? `Moved to ${opts.toTable}.` : `Moved to ${opts.toTable}: ${summary}.`;
    const no = textOf(opts.kotNo);
    const handle = no === '' ? 'A correction docket' : `Correction docket KOT-${no}`;
    return opts.printed
        ? `${head} ${handle} is printing — tell the pass.`
        : `${head} Nothing was on the pass for it, so no docket printed.`;
};

/** The dishes the server named in a move's answer, as lines. */
export const movedDishesOf = (response: unknown): string[] => {
    if (typeof response !== 'object' || response === null || !Array.isArray((response as Row).items)) { return []; }
    return ((response as Row).items as unknown[])
        .filter((it): it is Row => typeof it === 'object' && it !== null)
        .map(moveDishLine);
};

/** The guest order URL for a table — the same scheme the printed QR uses. */
export const tableOrderUrl = (
    origin: string,
    restaurantUsername: string,
    row: Pick<FloorRow, 'name' | 'qr_token' | 'qr_sig'>,
): string => {
    const root = `${origin}/order/${encodeURIComponent(restaurantUsername)}`;
    if (row.qr_token) { return `${root}?t=${encodeURIComponent(row.qr_token)}`; }
    const base = `${root}?table=${encodeURIComponent(row.name)}`;
    return row.qr_sig ? `${base}&sig=${encodeURIComponent(row.qr_sig)}` : base;
};
