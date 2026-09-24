// THE UNSENT ORDER SURVIVES THE PAD BEING CLOSED.
//
// Client, verbatim: "there should be like a view previously added items if ppl
// havent been seated or if the waiter closed the thing by mistake coz rn if the
// add order thing is closed all the items they added goes away".
//
// ============================================================================
// WHY THE CART USED TO VANISH
// ============================================================================
// The pad's cart is React state inside `OrderPad`, and the surface is mounted by
// whatever opened it. Closing it — the X, the Escape key, a mis-aimed tap on the
// scrim, or the party simply not being seated yet — unmounted the component, and
// twenty minutes of a table's order went with it. There is no server-side draft:
// an order exists only once it is SENT, which is correct (an unsent order must
// never reach the kitchen or a bill), so the only place a draft can live is this
// device.
//
// ============================================================================
// WHAT IS KEPT, AND FOR HOW LONG
// ============================================================================
// The whole draft: the lines, their notes, their held flags, their chosen sizes,
// the kitchen note, and — for takeaway/delivery — the customer fields, because a
// phone number re-typed from memory is as much work as the cart.
//
// PER TARGET, NOT PER SCREEN. One key per table (and one each for takeaway and
// delivery), so two tables being taken at once keep two separate carts and
// neither can pick up the other's lines.
//
// TWELVE HOURS. Longer than any single service, shorter than "yesterday's lunch
// re-appears on tonight's table". A stale draft is dropped on read and deleted,
// never shown — restoring an order nobody remembers placing is worse than
// restoring nothing.
//
// A SENT ORDER CLEARS ITS DRAFT — including the honest "queued in the outbox"
// send, because that cart IS going to the kitchen and re-offering it would have
// somebody send it twice.
//
// ============================================================================
// FAILURE IS SILENT, ALWAYS
// ============================================================================
// Private mode, a full quota, a browser with storage blocked: every read answers
// null and every write is dropped. A draft that cannot be saved must never stop
// an order being taken — the feature is a safety net, and a safety net that can
// throw is a hazard.
//
// PURE + STORAGE-INJECTABLE so `__tests__/order-draft-store.test.ts` can pin the
// rules without a browser.

import type { DraftState } from '@/lib/api/order-entry';

/** What the pad was opened for — the identity a draft is filed under. */
export type PadTarget =
    | { kind: 'dine'; table: string }
    | { kind: 'takeaway' }
    | { kind: 'delivery' };

/** Everything the pad would lose if it closed. */
export interface PadDraftSnapshot {
    draft: DraftState;
    kitchenNote: string;
    customer: string;
    phone: string;
    address: string;
    /** Epoch ms of the last edit — what the age test and the notice both read. */
    savedAt: number;
}

/** A draft older than this is somebody else's service. */
export const DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const PREFIX = 'order-pad-draft:';

/**
 * One key per restaurant and target. The table name is lower-cased for the same
 * reason every other table lookup in this app is: "t4" and "T4" are one table to
 * everyone except a string comparison.
 */
export const draftStoreKey = (restaurantId: string, target: PadTarget): string => {
    const who = restaurantId.trim().toLowerCase();
    const what = target.kind === 'dine' ? `dine:${target.table.trim().toLowerCase()}` : target.kind;
    return `${PREFIX}${who}:${what}`;
};

/** How many items are in a cart — the number the restore notice says. */
export const draftCartCount = (draft: DraftState | null | undefined): number => {
    if (!draft || typeof draft.cart !== 'object') { return 0; }
    let total = 0;
    for (const qty of Object.values(draft.cart)) {
        if (typeof qty === 'number' && Number.isFinite(qty) && qty > 0) { total += Math.round(qty); }
    }
    return total;
};

/**
 * Is there anything here worth keeping? A cart with lines, or — for a takeaway
 * whose customer was typed before the food was chosen — any filled field.
 */
export const draftWorthKeeping = (snapshot: Pick<PadDraftSnapshot, 'draft' | 'kitchenNote' | 'customer' | 'phone' | 'address'>): boolean =>
    draftCartCount(snapshot.draft) > 0
    || snapshot.kitchenNote.trim() !== ''
    || snapshot.customer.trim() !== ''
    || snapshot.phone.trim() !== ''
    || snapshot.address.trim() !== '';

/** Within the keep-window, and not dated in the future by a wrong device clock. */
export const draftIsFresh = (savedAt: unknown, now: number = Date.now()): boolean => {
    if (typeof savedAt !== 'number' || !Number.isFinite(savedAt) || savedAt <= 0) { return false; }
    const age = now - savedAt;
    return age >= -60_000 && age <= DRAFT_MAX_AGE_MS;
};

/** "3 items from 21:14" — what the strip above the pad says it brought back. */
export const restoredDraftNote = (count: number, savedAt: number, locale?: string): string => {
    const when = new Date(savedAt);
    const time = Number.isFinite(when.getTime())
        ? when.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
        : '';
    const items = `${String(count)} item${count === 1 ? '' : 's'}`;
    return time === '' ? `Unsent ${items} from earlier` : `Unsent ${items} from ${time}`;
};

/*
  A parsed snapshot, or null for anything this module did not write.

  READ AS `unknown`, FIELD BY FIELD. What comes back is a string somebody else's
  code could have put in this browser's storage, and a draft restored from a
  half-written or hand-edited record would crash the pad on its first render
  rather than lose one order. Every branch answers null; nothing throws.
*/
export const parseDraftSnapshot = (raw: string | null, now: number = Date.now()): PadDraftSnapshot | null => {
    if (raw === null || raw === '') { return null; }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return null; }
    if (typeof parsed !== 'object' || parsed === null) { return null; }
    const record = parsed as Record<string, unknown>;
    const rawDraft = record.draft;
    if (typeof rawDraft !== 'object' || rawDraft === null) { return null; }
    const draftRecord = rawDraft as Record<string, unknown>;
    if (typeof draftRecord.cart !== 'object' || draftRecord.cart === null) { return null; }
    if (!draftIsFresh(record.savedAt, now)) { return null; }
    const text = (v: unknown): string => (typeof v === 'string' ? v : '');
    /*
      Each map is rebuilt entry by entry, keeping only the values of the type
      that map is declared to hold. A quantity that came back as the string "2"
      would survive a cast and then be multiplied, ordered and printed; dropping
      it loses one line of a restored draft, which is the smaller harm.
    */
    const mapOf = <T,>(v: unknown, kind: 'number' | 'string' | 'boolean'): Partial<Record<string, T>> => {
        const out: Partial<Record<string, T>> = {};
        if (typeof v !== 'object' || v === null) { return out; }
        for (const [key, value] of Object.entries(v)) {
            if (typeof value === kind) { out[key] = value as T; }
        }
        return out;
    };
    const snapshot: PadDraftSnapshot = {
        draft: {
            cart: mapOf<number>(draftRecord.cart, 'number'),
            notes: mapOf<string>(draftRecord.notes, 'string'),
            held: mapOf<boolean>(draftRecord.held, 'boolean'),
            sizes: mapOf<string>(draftRecord.sizes, 'string'),
            knownNames: mapOf<string>(draftRecord.knownNames, 'string'),
        },
        kitchenNote: text(record.kitchenNote),
        customer: text(record.customer),
        phone: text(record.phone),
        address: text(record.address),
        savedAt: typeof record.savedAt === 'number' ? record.savedAt : 0,
    };
    return draftWorthKeeping(snapshot) ? snapshot : null;
};

/** The browser's store, or null wherever there isn't one (SSR, blocked, private). */
const defaultStorage = (): Storage | null => {
    try {
        return typeof window === 'undefined' ? null : window.localStorage;
    } catch {
        return null;
    }
};

export const clearPadDraft = (key: string, storage: Storage | null = defaultStorage()): void => {
    if (storage === null) { return; }
    try { storage.removeItem(key); } catch { /* nothing to do about it */ }
};

export const readPadDraft = (
    key: string,
    now: number = Date.now(),
    storage: Storage | null = defaultStorage(),
): PadDraftSnapshot | null => {
    if (storage === null) { return null; }
    let raw: string | null = null;
    try { raw = storage.getItem(key); } catch { return null; }
    const snapshot = parseDraftSnapshot(raw, now);
    // A draft we refuse to restore is a draft nobody will ever want again.
    if (snapshot === null && raw !== null) { clearPadDraft(key, storage); }
    return snapshot;
};

export const writePadDraft = (
    key: string,
    snapshot: PadDraftSnapshot,
    storage: Storage | null = defaultStorage(),
): void => {
    if (storage === null) { return; }
    try {
        if (!draftWorthKeeping(snapshot)) { storage.removeItem(key); return; }
        storage.setItem(key, JSON.stringify(snapshot));
    } catch { /* private mode, quota — the order still gets taken */ }
};

