/**
 * Queue pre-order menu — the client-side half.
 *
 * The SELECTION rule (which dishes a queuing walk-in may order) lives entirely
 * on the server: GET /qr/:slug/queue-menu serves only the allowed dishes and the
 * pre-order write refuses the rest. Nothing here filters anything, on purpose.
 *
 * What IS here is the presentation rule the two surfaces have to agree on:
 *  - the queue page renders what the server sent, in the order the server sent;
 *  - the dashboard editor has to PREVIEW that same order before it is saved.
 * One copy, so the preview cannot promise an order the guest will not get.
 */

/** The queue menu's own copy and price switch. "" means "use the page's own
 *  localised line" — a restaurant that customized nothing reads as it always
 *  did, in EN and HI. */
export interface QueueMenuPresentation {
    headline: string;
    intro: string;
    showPrices: boolean;
}

export const QUEUE_MENU_PRESENTATION_DEFAULT: QueueMenuPresentation = {
    headline: "",
    intro: "",
    showPrices: true,
};

const key = (v: string): string => v.trim().toLowerCase();

/** Read the `queue_menu` block off a /qr/:slug/queue-menu payload. Anything
 *  missing or of the wrong type falls back to the shipped default, so an older
 *  backend (or a partial payload) can never blank a heading or hide prices. */
export function readQueueMenuPresentation(raw: unknown): QueueMenuPresentation {
    const o = (raw ?? {}) as { headline?: unknown; intro?: unknown; show_prices?: unknown };
    return {
        headline: typeof o.headline === "string" ? o.headline : "",
        intro: typeof o.intro === "string" ? o.intro : "",
        // Only an explicit false hides prices.
        showPrices: o.show_prices !== false,
    };
}

/**
 * Would this dish reach a queuing guest under `rule`?
 *
 * A THIRD copy of a rule the server already owns — deliberately. The editor has
 * to preview a rule that has not been saved yet, which no server call can
 * answer. It is never the authority: the saved rule is applied by the server on
 * the endpoint the queue page reads and again on the pre-order write, and the
 * editor's rows carry the server's own `queue_included` verdict for the SAVED
 * rule. Keep this in step with isQueueMenuItemAllowed in the backend's
 * queue_menu.ts — same union of id and category, same sold-out refusal.
 */
export function isOfferedToQueue(
    rule: { mode: string; items: string[]; categories: string[] },
    item: { id: string; category: string; available?: boolean },
): boolean {
    if (item.available === false) {return false;}
    if (rule.mode === "all") {return true;}
    const listed =
        rule.items.some((id) => key(id) === key(item.id)) ||
        rule.categories.some((c) => key(c) === key(item.category));
    return rule.mode === "include" ? listed : !listed;
}

/**
 * The queue page's tab order: follow the server's order for the categories this
 * browser actually has items in, then append anything it did not name.
 *
 * An empty `serverOrder` — an older payload, or a restaurant that arranged
 * nothing — falls back to the alphabetical sort the page has always used, which
 * is what keeps an un-configured tenant byte-identical.
 */
export function applyServerCategoryOrder(serverOrder: string[], own: string[]): string[] {
    if (serverOrder.length === 0) {return [...own].sort((a, b) => a.localeCompare(b));}
    const byKey = new Map(own.map((c) => [key(c), c]));
    const ordered: string[] = [];
    for (const c of serverOrder) {
        const hit = byKey.get(key(c));
        if (hit && !ordered.includes(hit)) {ordered.push(hit);}
    }
    // A category the server did not name cannot happen today, but a menu that
    // changed between two reads must not silently lose a tab.
    return [...ordered, ...own.filter((c) => !ordered.includes(c)).sort((a, b) => a.localeCompare(b))];
}

/**
 * The rule the SERVER applies (queue_menu.ts orderQueueMenuCategories), mirrored
 * so the editor can preview an unsaved arrangement: the categories the owner
 * pinned lead, in their order; everything else follows alphabetically. A pinned
 * name that no longer exists is ignored rather than rendered as an empty tab.
 */
export function orderCategoriesByPreference(order: string[], categories: string[]): string[] {
    const rest = [...categories].sort((a, b) => a.localeCompare(b));
    if (order.length === 0) {return rest;}
    const rank = new Map<string, number>();
    order.forEach((c, i) => { if (!rank.has(key(c))) {rank.set(key(c), i);} });
    const pinned: string[] = [];
    const tail: string[] = [];
    for (const c of rest) {
        if (rank.has(key(c))) {pinned.push(c);} else {tail.push(c);}
    }
    pinned.sort((a, b) => (rank.get(key(a)) ?? 0) - (rank.get(key(b)) ?? 0));
    return [...pinned, ...tail];
}
