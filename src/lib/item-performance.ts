// SECTION-WISE ITEM PERFORMANCE, OFF THE LIVE ORDER FEED.
//
// Client: "Add section-wise item performance and live tracking, showing metrics
// like items sold, quantity, revenue, and top/low-performing items. Data should
// update in real time without requiring a page refresh."
//
// ============================================================================
// WHY THIS IS BUILT FROM ORDERS AND NOT FROM THE ANALYTICS ENDPOINT
// ============================================================================
// /analytics/menu-insights already ranks dishes — but it returns the TOP TEN and
// the BOTTOM EIGHT of the whole menu, over a 30-day window, computed when the
// page was loaded. None of those three things is what was asked for:
//
//   • "Section-wise" needs EVERY dish that sold, grouped by its menu section.
//     Ten dishes cannot describe six sections.
//   • "Live" means the number moves when the kitchen is sent an order. The
//     analytics window is days wide and the read is expensive.
//
// The live order feed (GET /orders) carries every line of every order in the
// current service — name, quantity, price — and is ALREADY polled and already
// nudged by the `order:updated` socket event on three other screens. Grouping it
// by the menu's own category is the whole feature, and it costs one extra read
// (the menu) that is cached anyway.
//
// WHAT "THE CURRENT SERVICE" MEANS HERE: whatever the orders feed is holding.
// The backend drops settled orders from it after `live_window_days`, so this is
// the live board's own scope and the UI names it rather than implying "today".
//
// ============================================================================
// THE RULES
// ============================================================================
// • CANCELLED ORDERS DO NOT COUNT. Nothing was cooked and nothing was charged.
// • A DISH IS MATCHED TO ITS SECTION BY NAME, case-insensitively — the same join
//   the backend's own menu analytics uses (`menuByName`), because an order line
//   stores the name it was rung in under, not a menu id we can rely on.
// • A DISH THE MENU NO LONGER HAS still counts, under "Off menu". It sold;
//   hiding it would make the revenue column disagree with the till.
// • REVENUE IS price × quantity FROM THE ORDER LINE, never from today's menu
//   price: a line rung in at last week's price is worth what it was rung in at.
//   A NON-CHARGEABLE line (migration 034) earns nothing but still counts as
//   sold — that is exactly what a comp is, and a top-seller list that hides
//   comped dishes hides the ones being given away.
// • THE LOW PERFORMER OF A SECTION IS THE WORST THING THAT ACTUALLY SOLD, and
//   it is only offered when the section has more than one dish — "best and worst
//   of one dish" is noise dressed as insight.
//
// PURE — no React, no fetch — pinned by `__tests__/item-performance.test.ts`.

/** A menu row as this module needs it. */
export interface PerfMenuItem {
    name: string;
    category?: string | null;
}

/** One line of an order, as the live feed sends it. */
export interface PerfOrderItem {
    name?: string | null;
    quantity?: unknown;
    price?: unknown;
    /** Migration 034 — a comped line. It was cooked; it was not charged for. */
    nc?: unknown;
}

/** One order of the live feed. */
export interface PerfOrder {
    status?: string | null;
    items?: PerfOrderItem[] | null;
}

/** What one dish did in this service. */
export interface DishPerformance {
    name: string;
    section: string;
    quantity: number;
    revenue: number;
    /** How many separate order lines it appeared on — "ordered N times". */
    lines: number;
}

/** One menu section's slice of the service. */
export interface SectionPerformance {
    section: string;
    quantity: number;
    revenue: number;
    dishes: DishPerformance[];
    /** Most revenue in the section. */
    top: DishPerformance | null;
    /** Least sold in the section, only when there is something to compare to. */
    low: DishPerformance | null;
}

export interface ItemPerformance {
    sections: SectionPerformance[];
    /** Every dish that sold, best revenue first. */
    dishes: DishPerformance[];
    totalQuantity: number;
    totalRevenue: number;
    /** Distinct dishes that sold at all. */
    dishCount: number;
}

/** The section a dish with no menu row is filed under. */
export const OFF_MENU_SECTION = 'Off menu';
/** The section a menu row with no category of its own is filed under. */
export const UNSECTIONED = 'Uncategorised';

const CANCELLED = new Set(['cancelled', 'canceled', 'void', 'voided']);

const num = (v: unknown): number => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
};

/** name (lower-cased) → section, from the menu. */
export const sectionIndex = (menu: readonly PerfMenuItem[]): Map<string, string> => {
    const index = new Map<string, string>();
    for (const item of menu) {
        const name = (item.name || '').trim().toLowerCase();
        if (name === '') { continue; }
        const category = (item.category ?? '').trim();
        index.set(name, category === '' ? UNSECTIONED : category);
    }
    return index;
};

export const itemPerformance = (
    orders: readonly PerfOrder[],
    menu: readonly PerfMenuItem[],
): ItemPerformance => {
    const sections = sectionIndex(menu);
    const byDish = new Map<string, DishPerformance>();
    let totalQuantity = 0;
    let totalRevenue = 0;

    for (const order of orders) {
        const status = (order.status ?? '').trim().toLowerCase();
        if (CANCELLED.has(status)) { continue; }
        for (const line of order.items ?? []) {
            const name = (line.name ?? '').trim();
            if (name === '') { continue; }
            const quantity = Math.max(0, Math.round(num(line.quantity) || 1));
            if (quantity === 0) { continue; }
            // A comped line counts as sold and earns nothing: putting its menu
            // price into revenue would make this block disagree with the till.
            const revenue = line.nc === true ? 0 : num(line.price) * quantity;
            const key = name.toLowerCase();
            const section = sections.get(key) ?? OFF_MENU_SECTION;
            const row = byDish.get(key) ?? { name, section, quantity: 0, revenue: 0, lines: 0 };
            row.quantity += quantity;
            row.revenue += revenue;
            row.lines += 1;
            byDish.set(key, row);
            totalQuantity += quantity;
            totalRevenue += revenue;
        }
    }

    const dishes = [...byDish.values()].sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity || a.name.localeCompare(b.name));

    const bySection = new Map<string, SectionPerformance>();
    for (const dish of dishes) {
        const entry = bySection.get(dish.section) ?? { section: dish.section, quantity: 0, revenue: 0, dishes: [], top: null, low: null };
        entry.quantity += dish.quantity;
        entry.revenue += dish.revenue;
        entry.dishes.push(dish);
        bySection.set(dish.section, entry);
    }
    for (const entry of bySection.values()) {
        entry.top = entry.dishes[0] ?? null;
        entry.low = entry.dishes.length > 1
            ? [...entry.dishes].sort((a, b) => a.quantity - b.quantity || a.revenue - b.revenue || a.name.localeCompare(b.name))[0]
            : null;
    }

    return {
        sections: [...bySection.values()].sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity || a.section.localeCompare(b.section)),
        dishes,
        totalQuantity,
        totalRevenue,
        dishCount: dishes.length,
    };
};

/** "4 dishes · 11 sold" — the sub-line under a section's name. */
export const sectionCaption = (entry: SectionPerformance): string =>
    `${String(entry.dishes.length)} dish${entry.dishes.length === 1 ? '' : 'es'} · ${String(entry.quantity)} sold`;

/** A section's share of the service's revenue, 0–100, or 0 when nothing sold. */
export const sectionShare = (entry: SectionPerformance, totalRevenue: number): number =>
    totalRevenue > 0 ? Math.max(0, Math.min(100, (entry.revenue / totalRevenue) * 100)) : 0;
