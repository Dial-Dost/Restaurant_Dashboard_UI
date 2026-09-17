// CLIENT ITEMS 1 AND 2 — WHAT COLOUR IS A TABLE?
//
// "Different colour codings: e.g. the fresh table 12 in green, and the table 12
// whose bill has been printed but not settled in orange."
//
// ============================================================================
// FIVE STATES, ONE MEANING EACH
// ============================================================================
//   free      nobody seated, nothing owed            GREEN   (every free table,
//                                                            the next party's
//                                                            "12 #2" included)
//   seated    a party sat down, nothing ordered yet  AMBER
//   running   food ordered, bill not printed         RED
//   printed   the bill has been printed, not settled ORANGE  — Gaia settles at
//                                                            night, so this is
//                                                            the pending-bill
//                                                            backlog
//   reserved  a booking holds it                     BLUE
//
// PRINTED WINS over running and seated: the paper is out, and the waiter adding a
// dessert must see that before anything else. A table is never green while
// anybody is at it.
//
// ============================================================================
// FIXED INKS, NOT THE ACCENT
// ============================================================================
// The floor used to paint "occupied" in the red of the old stock theme on the
// web and in the owner's ACCENT on the app — and an owner who picks the Sage
// accent would then have "occupied" and "free" in two greens. So the five inks
// are fixed per scheme and the accent never touches them. The values are the
// app's (restaurant_owner_app lib/ui/theme/app_colors.dart AppShellScheme
// floor*), transcribed; globals.css carries them as CSS variables and the test
// beside this file holds the two to each other, and holds every ink to a 4.5:1
// contrast on its cards and a CIEDE2000 distance of 12 from every other ink.
//
// PURE — no React, no DOM — for the reason session-scope.ts gives.

/** The five states a table tile can be in. */
export type FloorState = 'free' | 'seated' | 'running' | 'printed' | 'reserved';

/** The legend's order: the busiest first, then the free floor. */
export const FLOOR_STATES: readonly FloorState[] = ['running', 'printed', 'seated', 'reserved', 'free'];

/** The words. The app says the same. */
export const FLOOR_STATE_WORDS: Readonly<Record<FloorState, string>> = {
    free: 'Free',
    seated: 'Seated',
    running: 'Running',
    printed: 'Bill printed',
    reserved: 'Reserved',
};

/** The chip on a printed tile whose paper is out of date. */
export const PAPER_STALE_CHIP = 'Updated — print again';

/**
 * THE INKS — chip text and border; the tile wash is the ink at 16%. Hex values
 * from the app's AppShellScheme (dark schemes), Gaia's shellBridge and the
 * light palettes. `nextParty` is the neutral "#2" chip on a next-party seat.
 */
export const FLOOR_INKS = {
    dark: { free: '#6CC070', seated: '#E2C458', running: '#E0697A', printed: '#F28C3A', reserved: '#79A7D8', nextParty: '#B9B4A8' },
    gaia: { free: '#9BC4A0', seated: '#E2C458', running: '#D9705F', printed: '#F0934A', reserved: '#8FB0D0', nextParty: '#B3AC99' },
    light: { free: '#2B6326', seated: '#7A5B00', running: '#B0283C', printed: '#A84A06', reserved: '#2F5F8F', nextParty: '#5F6670' },
} as const;

/** The CSS variable each ink lives in (globals.css). */
export const floorInkVar = (key: FloorState | 'nextParty'): string =>
    `var(--floor-${key === 'nextParty' ? 'next-party' : key})`;

/**
 * `has_order` off a raw /get-tables row, carried only when the server sent a
 * boolean — a backend older than the field leaves it absent, which floorStateOf
 * reads as "not known".
 */
export const hasOrderField = (row: unknown): { has_order?: boolean } => {
    const value = row && typeof row === 'object' ? (row as { has_order?: unknown }).has_order : undefined;
    return typeof value === 'boolean' ? { has_order: value } : {};
};

/** What decides a tile's state. `hasOrder` absent (an older server) reads a seated table as running, as the floor always did. */
export interface FloorStateInput {
    occupied: boolean;
    hasOrder?: boolean | null;
    /** The server said this seating's bill has been printed (serverSaysBillPrinted). */
    printed: boolean;
    reserved: boolean;
}

export const floorStateOf = (t: FloorStateInput): FloorState => {
    const inUse = t.occupied || t.hasOrder === true;
    if (t.printed && inUse) { return 'printed'; }
    if (inUse) { return t.hasOrder === false ? 'seated' : 'running'; }
    if (t.reserved) { return 'reserved'; }
    return 'free';
};

/** Inline style for a tile: ink border, a 16% wash. Works in both themes (the variables change). */
export const floorTileStyle = (state: FloorState): { borderColor: string; backgroundColor: string } => ({
    borderColor: floorInkVar(state),
    backgroundColor: `color-mix(in srgb, ${floorInkVar(state)} 16%, transparent)`,
});

/**
 * Inline style for a state chip: ink text and border on an OPAQUE card-coloured
 * pill. Not a wash of the ink: a tinted chip on a tinted tile drops the text
 * to about 3:1 (measured for every scheme), while ink on the card itself is at
 * least 4.99:1 — which is the pairing floor-state.test.ts pins.
 */
export const floorChipStyle = (state: FloorState | 'nextParty'): { color: string; borderColor: string; backgroundColor: string } => ({
    color: floorInkVar(state),
    borderColor: floorInkVar(state),
    backgroundColor: 'hsl(var(--card))',
});

/**
 * THE LEGEND. A senior reads counts — "3 Running · 8 Bill printed · …", the
 * printed count being the night-settle backlog; a waiter reads the key alone.
 * States with no table are left out of the counted legend.
 */
export const floorLegend = (
    states: readonly FloorState[],
    withCounts: boolean,
): { state: FloorState; label: string; count: number }[] => {
    const counts = new Map<FloorState, number>();
    for (const s of states) { counts.set(s, (counts.get(s) ?? 0) + 1); }
    return FLOOR_STATES
        .map((state) => ({ state, count: counts.get(state) ?? 0 }))
        .filter((row) => !withCounts || row.count > 0)
        .map((row) => ({
            ...row,
            label: withCounts ? `${String(row.count)} ${FLOOR_STATE_WORDS[row.state]}` : FLOOR_STATE_WORDS[row.state],
        }));
};

/** "#2" — the small chip on a next-party seat, whose tile reads its root's number. */
export const nextPartyBadge = (partyNo: number | null | undefined): string | null =>
    typeof partyNo === 'number' && Number.isInteger(partyNo) && partyNo >= 2 ? `#${String(partyNo)}` : null;

/**
 * The print's clock in the restaurant's zone: "13:32", or "16/09 13:32" when it
 * was another day — the backend's billPrintedClock, so the tile, the confirm and
 * the paper name the same instant the same way.
 */
export const printedClockLabel = (printedAt: string | null | undefined, tz: string, now: Date = new Date()): string => {
    if (!printedAt) { return ''; }
    const at = new Date(printedAt);
    if (Number.isNaN(at.getTime())) { return ''; }
    const parts = (d: Date, zone: string): Partial<Record<string, string>> => {
        const out: Partial<Record<string, string>> = {};
        for (const p of new Intl.DateTimeFormat('en-GB', {
            timeZone: zone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
        }).formatToParts(d)) { out[p.type] = p.value; }
        return out;
    };
    let a: Partial<Record<string, string>>;
    let b: Partial<Record<string, string>>;
    try {
        a = parts(at, tz.trim() || 'Asia/Kolkata');
        b = parts(now, tz.trim() || 'Asia/Kolkata');
    } catch {
        a = parts(at, 'Asia/Kolkata');
        b = parts(now, 'Asia/Kolkata');
    }
    const clock = `${a.hour ?? ''}:${a.minute ?? ''}`;
    return a.day === b.day && a.month === b.month && a.year === b.year ? clock : `${a.day ?? ''}/${a.month ?? ''} ${clock}`;
};

/**
 * The small chips on a printed tile, in order: "Printed 13:32", "Updated —
 * print again" when the paper is out of date, "Printed as 12" after a move.
 */
export const printedTileChips = (input: {
    printedClock?: string | null;
    paperStale?: boolean | null;
    printedAs?: string | null;
}): string[] => {
    const out: string[] = [];
    const clock = (input.printedClock ?? '').trim();
    out.push(clock ? `Printed ${clock}` : 'Printed');
    if (input.paperStale === true) { out.push(PAPER_STALE_CHIP); }
    const as = (input.printedAs ?? '').trim();
    if (as) { out.push(`Printed as ${as}`); }
    return out;
};
