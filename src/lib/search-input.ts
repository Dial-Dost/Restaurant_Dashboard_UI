// CLIENT ITEM 6 (app 2.0.2) — "pressing the 'x' does not clear the search … in
// tables and every other section with a search, clicking the 'x' at the
// rightmost end after typing must clear the search."
//
// The dashboard had eighteen search boxes and no shared one. Four had a
// hand-rolled x (a 14–24px target that unmounted under the click and took the
// focus with it); the other fourteen — including "Search tables..." in Add New
// Order — had none. So there is one now, `components/ui/search-input.tsx`, and
// the cmdk `CommandInput` got the same x. Everything the two decide lives here,
// as plain functions, so it is tested without a DOM (the jest setup is
// node-only on purpose, and no DOM library is added for this):
//
//   * the x is drawn whenever the BOX holds anything, whatever a debounce is
//     doing;
//   * a screen hears the query through one path: debounced while typing, AT
//     ONCE when the box is emptied, trimmed, and only when it changes — so an x
//     pressed inside the debounce window can never be followed by the old word;
//   * Escape clears a box that has text; on an empty box it is left alone, so
//     a dialog, sheet or popover around the box still closes on it. Radix hears
//     Escape first (a capture listener on the document), so the containers ask
//     `escapeBelongsToSearch` before they close.

/** The words on the x, for a screen reader and the hover title. */
export const SEARCH_CLEAR_LABEL = 'Clear search';

/**
 * Marks a search box in the DOM. Dialog, Sheet and Popover read it to let
 * Escape clear the box instead of closing them.
 */
export const SEARCH_INPUT_ATTR = 'data-search-input';

/**
 * The x: a 40px-wide button as tall as the box it sits in (36–44px across the
 * dashboard's inputs). The box keeps `pr-10` clear for it.
 */
export const SEARCH_CLEAR_BUTTON_CLASS =
    'inline-flex h-full min-h-9 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** What a screen filters on: the box's text, trimmed. */
export function searchQueryOf(value: string): string {
    return value.trim();
}

/** Whether the x is drawn: anything in the box at all, spaces included. */
export function showSearchClear(value: string): boolean {
    return value !== '';
}

/**
 * What a change of the box's text means for the screen's query.
 *
 * `null` — nothing to tell it (the query is the one it already has). Otherwise
 * the query and how long to wait before telling it: never for an empty box,
 * `debounceMs` for anything else.
 */
export function planSearchQuery(
    value: string,
    lastSent: string,
    debounceMs: number,
): { query: string; delayMs: number } | null {
    const query = searchQueryOf(value);
    if (query === lastSent) {return null;}
    if (query === '' || debounceMs <= 0) {return { query, delayMs: 0 };}
    return { query, delayMs: debounceMs };
}

export interface SearchTimers {
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
}

const realTimers: SearchTimers = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => { clearTimeout(handle as ReturnType<typeof setTimeout>); },
};

/**
 * The body of the box's effect on `[value, debounceMs]`, returning its cleanup.
 *
 * React runs the previous cleanup before the next body, so a pending query is
 * cancelled by every later change of the text — and an emptied box sends its
 * '' in the same pass, with nothing left pending to follow it.
 */
export function scheduleSearchQuery(
    value: string,
    debounceMs: number,
    lastSent: { current: string },
    send: (query: string) => void,
    timers: SearchTimers = realTimers,
): (() => void) | undefined {
    const plan = planSearchQuery(value, lastSent.current, debounceMs);
    if (plan === null) {return undefined;}
    const fire = (): void => {
        lastSent.current = plan.query;
        send(plan.query);
    };
    if (plan.delayMs === 0) {
        fire();
        return undefined;
    }
    const handle = timers.setTimeout(fire, plan.delayMs);
    return () => { timers.clearTimeout(handle); };
}

/**
 * What a key in the box does. `'clear'` for Escape on a box with text, unless
 * the screen's own key handler already took the key or an IME is composing.
 */
export function searchKeyAction(key: {
    key: string;
    value: string;
    handledByScreen: boolean;
    composing: boolean;
}): 'clear' | 'pass' {
    if (key.key !== 'Escape' || key.handledByScreen || key.composing) {return 'pass';}
    return key.value === '' ? 'pass' : 'clear';
}

interface EscapeTargetLike {
    tagName?: unknown;
    value?: unknown;
    getAttribute?: (name: string) => string | null;
}

/**
 * Whether an Escape aimed at `target` is the search box's to handle (it holds
 * text, so Escape clears it) rather than the dialog's (close). Duck-typed so it
 * can be tested without a DOM.
 */
export function escapeBelongsToSearch(target: unknown): boolean {
    if (target === null || typeof target !== 'object') {return false;}
    const el = target as EscapeTargetLike;
    if (el.tagName !== 'INPUT' || typeof el.getAttribute !== 'function') {return false;}
    if (el.getAttribute(SEARCH_INPUT_ATTR) === null) {return false;}
    return typeof el.value === 'string' && el.value !== '';
}

/**
 * The Escape handler Dialog, Sheet and Popover pass to Radix: keep the layer
 * open while the key belongs to a search box, then whatever the caller asked.
 */
export function keepOpenForSearchEscape<E extends { target: unknown; preventDefault: () => void }>(
    callerHandler?: (event: E) => void,
): (event: E) => void {
    return (event) => {
        if (escapeBelongsToSearch(event.target)) {event.preventDefault();}
        callerHandler?.(event);
    };
}

/**
 * For a page whose list request already waits a moment to gather filter
 * changes into one (the audit trail, closed bills): how long to wait for this
 * change. The search boxes debounce themselves, so a change to one of those
 * keys alone goes at once — which is what makes an emptied box re-query
 * immediately. Anything else (a date, a category) still waits.
 */
export function filterFetchDelayMs<T extends Record<string, unknown>>(
    previous: T | null,
    next: T,
    selfDebounced: readonly (keyof T)[],
    gatherMs: number,
): number {
    if (previous === null) {return gatherMs;}
    const changed = (Object.keys(next) as (keyof T)[]).filter((k) => !Object.is(previous[k], next[k]));
    if (changed.length === 0) {return gatherMs;}
    return changed.every((k) => selfDebounced.includes(k)) ? 0 : gatherMs;
}
