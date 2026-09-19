// CLIENT ITEM 6 — "THIS BILL WAS ALREADY PRINTED — REPRINT IT".
//
// The web half of restaurant_owner_app/lib/widgets/reprint_needed.dart. The
// backend answers a senior's write that put more on an already-printed bill (an
// order, a merge, an item moved onto it) with `reprint_needed: true`, the
// sentence to show (`reprint_message`) and the table whose paper is now short
// (`reprint_table`) — and, for a move that staled BOTH papers, a second
// `also_reprint_*` trio (routes/_shared.ts).
//
// Module pages call `announceReprintNeeded(readReprintNeeded(response))` after
// the affected writes; the shell-level <ReprintNeededListener> then asks
// "Print the updated bill?" and sends POST /print/bill for the named table —
// exactly what the table sheet's own Print button sends.
//
// Pure module (no React): the event bus is a DOM CustomEvent so any write path
// — a React page, a plain fetch helper — can raise it without importing the
// shell.

export interface ReprintNotice {
    /** The table whose printed paper no longer matches the bill. */
    table: string;
    /** The server's sentence, shown verbatim. */
    message: string;
}

/** The DOM event the shell listener subscribes to. */
export const REPRINT_NEEDED_EVENT = 'reprint-needed';

const readOne = (
    body: Record<string, unknown>,
    flagKey: string,
    messageKey: string,
    tableKey: string,
): ReprintNotice | null => {
    if (body[flagKey] !== true) { return null; }
    const table = typeof body[tableKey] === 'string' ? (body[tableKey]).trim() : '';
    if (!table) { return null; }
    const message = typeof body[messageKey] === 'string' && (body[messageKey]).trim().length > 0
        ? (body[messageKey])
        : `Table ${table}'s printed bill no longer matches — print the updated bill.`;
    return { table, message };
};

/**
 * The reprint notices a write response carries (0, 1 or — after a move that
 * staled both papers — 2 of them).
 */
export const readReprintNeeded = (response: unknown): ReprintNotice[] => {
    if (!response || typeof response !== 'object') { return []; }
    const body = response as Record<string, unknown>;
    const notices: ReprintNotice[] = [];
    const first = readOne(body, 'reprint_needed', 'reprint_message', 'reprint_table');
    if (first) { notices.push(first); }
    const second = readOne(body, 'also_reprint_needed', 'also_reprint_message', 'also_reprint_table');
    if (second) { notices.push(second); }
    return notices;
};

/**
 * Raise the shell's "Print the updated bill?" prompt for each notice. Safe to
 * call with an empty list (a response that carried no flag raises nothing).
 */
export const announceReprintNeeded = (notices: ReprintNotice | ReprintNotice[]): void => {
    if (typeof window === 'undefined') { return; }
    const list = Array.isArray(notices) ? notices : [notices];
    for (const notice of list) {
        try {
            window.dispatchEvent(new CustomEvent<ReprintNotice>(REPRINT_NEEDED_EVENT, { detail: notice }));
        } catch { /* non-browser environments only */ }
    }
};
