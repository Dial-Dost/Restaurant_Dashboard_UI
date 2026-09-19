// THE OFFLINE OUTBOX — the web port of the Flutter app's `services/outbox.dart`
// (surfaced by widgets/outbox_chip.dart).
//
// A queued action is NOT an action the kitchen has seen, and nothing on screen
// may imply otherwise. This store is the single durable list of writes the
// server has not been told about: modules `enqueue` a failed-offline write, the
// header chip counts it, the sheet names it, and a drain replays the queue in
// order when the line comes back.
//
// STATE MODEL (Flutter's, kept):
//   * pending — saved on this device, will be retried by the heartbeat/drain.
//   * failed  — the SERVER rejected it (4xx). It never auto-retries; the human
//     chooses "Try again" (back to pending) or "Discard" (the one way work
//     leaves this queue unsent). Pending entries queued BEHIND a failed one are
//     "held" — the drain stops at the first failure so writes stay ordered.
//
// SCOPED restaurant|outlet exactly like the read cache: switching branches
// switches queues, because a count about the wrong restaurant is worse than no
// count. The shell calls `setOutboxScope` whenever auth/outlet changes.
//
// Persistence is localStorage (per device, survives restart, wrapped in
// try/catch throughout). Module-scope singleton + subscribe(), consumed via
// useSyncExternalStore.

export interface OutboxEntry {
    id: string;
    /** The human sentence — "Order for Table 4 (2× Paneer Tikka)". */
    what: string;
    method: string;
    path: string;
    /** JSON-serialisable request body, replayed verbatim on drain. */
    body?: unknown;
    /** Per-subject grouping key, e.g. `table:T4` — feeds OutboxTagBadge. */
    tag?: string;
    /** ISO instant the action was saved. */
    queuedAt: string;
    failed: boolean;
    failureStatus?: number | null;
    failureMessage?: string | null;
}

export type OutboxDrainOutcome = 'drained' | 'offline' | 'blocked' | 'retryLater' | 'signedOut' | 'idle';

export interface OutboxDrainResult {
    outcome: OutboxDrainOutcome;
    /** How many entries actually went through on this drain. */
    sent: number;
}

/**
 * How a module sends one queued entry. Resolve = delivered (the entry leaves
 * the queue). Throw `OutboxSendError` to say what went wrong precisely;
 * anything else thrown is treated as "unreachable".
 */
export type OutboxSender = (entry: OutboxEntry) => Promise<void>;

/** A typed failure a sender throws so the drain can file it correctly. */
export class OutboxSendError extends Error {
    readonly status: number | null;
    constructor(message: string, status: number | null = null) {
        super(message);
        this.name = 'OutboxSendError';
        this.status = status;
    }
}

const STORAGE_PREFIX = 'cuisineflow-outbox:';

type Listener = () => void;

let scopeKey: string | null = null;
let entries: OutboxEntry[] = [];
const listeners = new Set<Listener>();
let sender: OutboxSender | null = null;
let draining = false;

const storageKey = (): string | null => (scopeKey ? `${STORAGE_PREFIX}${scopeKey}` : null);

const persist = (): void => {
    const key = storageKey();
    if (!key || typeof window === 'undefined') { return; }
    try {
        if (entries.length === 0) {
            window.localStorage.removeItem(key);
        } else {
            window.localStorage.setItem(key, JSON.stringify(entries));
        }
    } catch { /* private mode / quota — the in-memory queue still drives the UI */ }
};

const restore = (): void => {
    const key = storageKey();
    entries = [];
    if (!key || typeof window === 'undefined') { return; }
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) { return; }
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            entries = parsed.filter((e): e is OutboxEntry =>
                !!e && typeof e === 'object' &&
                typeof (e as OutboxEntry).id === 'string' &&
                typeof (e as OutboxEntry).what === 'string' &&
                typeof (e as OutboxEntry).method === 'string' &&
                typeof (e as OutboxEntry).path === 'string');
        }
    } catch { /* corrupted — start empty rather than crash the chrome */ }
};

const notify = (): void => {
    // A fresh array reference per change — useSyncExternalStore compares by
    // identity, and mutating in place would render stale counts.
    entries = [...entries];
    persist();
    for (const l of listeners) { l(); }
};

/**
 * Point the queue at one restaurant|outlet. Loads that scope's saved entries;
 * a null scope (signed out) empties the visible queue without deleting any
 * scope's saved work.
 */
export const setOutboxScope = (restaurantId: string | null, outletId?: string | null): void => {
    const next = restaurantId ? `${restaurantId}|${outletId ?? ''}` : null;
    if (next === scopeKey) { return; }
    scopeKey = next;
    restore();
    entries = [...entries];
    for (const l of listeners) { l(); }
};

export const subscribeOutbox = (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

/** Stable snapshot for useSyncExternalStore. */
export const getOutboxEntries = (): OutboxEntry[] => entries;

export const outboxPendingCount = (): number => entries.filter((e) => !e.failed).length;
export const outboxFailedCount = (): number => entries.filter((e) => e.failed).length;

export const outboxCountsForTag = (tag: string): { pending: number; failed: number } => {
    let pending = 0; let failed = 0;
    for (const e of entries) {
        if (e.tag !== tag) { continue; }
        if (e.failed) { failed += 1; } else { pending += 1; }
    }
    return { pending, failed };
};

/** Save one unsent action. Returns the stored entry (with its id). */
export const enqueueOutbox = (input: {
    what: string;
    method: string;
    path: string;
    body?: unknown;
    tag?: string;
}): OutboxEntry => {
    const entry: OutboxEntry = {
        id: `ob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        what: input.what,
        method: input.method,
        path: input.path,
        body: input.body,
        tag: input.tag,
        queuedAt: new Date().toISOString(),
        failed: false,
    };
    entries.push(entry);
    notify();
    return entry;
};

/** "Try again" on a rejected entry — back to pending; the next drain sends it. */
export const retryOutboxEntry = (id: string): void => {
    const entry = entries.find((e) => e.id === id);
    if (!entry?.failed) { return; }
    entry.failed = false;
    entry.failureStatus = null;
    entry.failureMessage = null;
    notify();
};

/**
 * Throw one entry away unsent. Always a deliberate human act behind a
 * confirmation — never a timeout, an eviction, or a silent drop.
 */
export const discardOutboxEntry = (id: string): void => {
    const before = entries.length;
    entries = entries.filter((e) => e.id !== id);
    if (entries.length !== before) { notify(); }
};

/**
 * How the queue reaches the server. Modules (or a shared transport) register
 * one sender; until then a drain reports `retryLater` and loses nothing.
 */
export const registerOutboxSender = (fn: OutboxSender | null): void => { sender = fn; };

export const isOutboxDraining = (): boolean => draining;

/**
 * Replay the queue in order. Stops at the first server rejection (writes stay
 * ordered — the rest are "held"), files the failure with the server's own
 * words, and reports honestly what happened.
 */
export const drainOutbox = async (): Promise<OutboxDrainResult> => {
    if (draining) { return { outcome: 'idle', sent: 0 }; }
    if (entries.every((e) => e.failed)) {
        return { outcome: entries.length === 0 ? 'idle' : 'blocked', sent: 0 };
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return { outcome: 'offline', sent: 0 };
    }
    if (!sender) { return { outcome: 'retryLater', sent: 0 }; }

    draining = true;
    for (const l of listeners) { l(); }
    let sent = 0;
    try {
        // Snapshot ids: the list mutates as entries are delivered.
        for (const id of entries.map((e) => e.id)) {
            const entry = entries.find((e) => e.id === id);
            if (!entry) { continue; }
            // A failed entry blocks everything queued behind it.
            if (entry.failed) { return { outcome: 'blocked', sent }; }
            try {
                await sender(entry);
                entries = entries.filter((e) => e.id !== id);
                sent += 1;
                notify();
            } catch (err) {
                const status = err instanceof OutboxSendError ? err.status : null;
                if (status === 401) { return { outcome: 'signedOut', sent }; }
                if (status != null && status >= 400 && status < 500) {
                    // The server's own words, verbatim — a parked action that cannot
                    // say why it is parked is barely better than one that vanished.
                    entry.failed = true;
                    entry.failureStatus = status;
                    entry.failureMessage = err instanceof Error ? err.message : 'The server rejected this.';
                    notify();
                    return { outcome: 'blocked', sent };
                }
                if (status != null) { return { outcome: 'retryLater', sent }; }
                return { outcome: 'offline', sent };
            }
        }
        return { outcome: 'drained', sent };
    } finally {
        draining = false;
        for (const l of listeners) { l(); }
    }
};
