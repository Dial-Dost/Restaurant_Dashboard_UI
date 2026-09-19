"use server";

/**
 * MENU MODULE API — the fetchers the rebuilt menu page loads through.
 *
 * Why these exist beside src/lib/db.ts rather than inside it:
 *
 *  - db.ts's menu readers silently serve a cached copy on failure, which is the
 *    opposite of what `useCachedFetch` needs (IT owns the cache and the offline
 *    story, so the fetcher must THROW when the load failed).
 *  - db.ts's `mapMenuItem` drops `modifiers`, and the Flutter editor edits them
 *    (`_MenuItemDialog`), so the module needs a mapper that carries them.
 *  - `POST /menu/upload-image` had no caller anywhere in the web app.
 *
 * Every thrown error carries the server's own sentence when there is one
 * (refusalSentence), and the "Failed to fetch" wording when the line was down so
 * `isUnreachableError` classifies it as an outage rather than a refusal.
 */

import { requestBackend } from "@/lib/db";
import type { QueueMenuConfigPayload } from "@/lib/db";
import { refusalSentence } from "@/lib/error-message";
import { parseBadgeCatalogue, type MenuBadge } from "@/lib/menu-badges";
import type { MenuVariationRecord } from "@/lib/mis-capture";
import type { MenuItem, RecipeIngredient } from "@/app/dashboard/menu/data";

/* ── Types ──────────────────────────────────────────────────────────── */

export interface MenuModifierOption {
    name: string;
    price: number;
}

export interface MenuModifierGroup {
    name: string;
    multi: boolean;
    required: boolean;
    options: MenuModifierOption[];
}

/** A menu item as the MODULE sees it: db's MenuItem plus the editor's
 *  modifiers and the costing enrichment Flutter attaches (`_cost`/`_margin_pct`). */
export interface MenuModuleItem extends MenuItem {
    modifiers: MenuModifierGroup[];
    cost: number | null;
    margin_pct: number | null;
    missing_costs: number;
}

export interface MenuModuleData {
    items: MenuModuleItem[];
    categories: string[];
    sections: string[];
    badges: MenuBadge[];
    badgePresets: MenuBadge[];
    badgeLabelMax: number;
    badgePerItemMax: number;
}

/** What the full-editor save sends — mirrors Flutter's `_MenuItemDialog._submit`. */
export interface MenuUpsertPayload {
    id?: string;
    name: string;
    price: number;
    category: string;
    /** Always sent: "" clears the guest blurb, which is what emptying the field means. */
    blurb?: string;
    image_url?: string;
    available?: boolean;
    station?: string | null;
    modifiers?: MenuModifierGroup[];
    recipe?: RecipeIngredient[];
    allergens?: string[];
}

/** The minimal projection a full-replace PUT carries so preserve-on-omit keeps
 *  every other stored field (blurb, badges, recipe, modifiers) untouched. */
export interface MenuReplaceRow {
    id: string;
    name: string;
    price: number;
    category: string;
    image_url: string;
    available: boolean;
}

export interface RecipeInventoryRow {
    id: string;
    name: string;
    stock: number;
    unit: string;
}

/* ── Internal helpers ───────────────────────────────────────────────── */

const rec = (v: unknown): Record<string, unknown> =>
    v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};

const str = (v: unknown, fallback = ""): string => {
    if (typeof v === "string") { return v; }
    if (typeof v === "number" || typeof v === "boolean") { return String(v); }
    return fallback;
};

const num = (v: unknown, fallback = 0): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

/** The line never reached the server — worded so isUnreachableError() sees an
 *  outage, not a refusal (the message must survive the server-action boundary). */
const unreachable = (): Error =>
    new Error("Failed to fetch: the restaurant server could not be reached.");

const refusal = (data: unknown, text: string, fallback: string): Error => {
    let payload: unknown = data;
    if (payload == null && text.trim().length > 0) {
        try { payload = JSON.parse(text); } catch { payload = null; }
    }
    return new Error(refusalSentence(payload) ?? fallback);
};

const mapModifiers = (raw: unknown): MenuModifierGroup[] => {
    if (!Array.isArray(raw)) { return []; }
    const out: MenuModifierGroup[] = [];
    for (const g of raw) {
        const group = rec(g);
        const options: MenuModifierOption[] = [];
        const rawOptions = Array.isArray(group.options) ? group.options : [];
        for (const o of rawOptions) {
            const opt = rec(o);
            options.push({ name: str(opt.name), price: num(opt.price) });
        }
        out.push({
            name: str(group.name),
            multi: group.multi === true,
            required: group.required === true,
            options,
        });
    }
    return out;
};

const mapModuleItem = (raw: unknown): MenuModuleItem => {
    const r = rec(raw);
    const allergens = Array.isArray(r.allergens)
        ? r.allergens.filter((a): a is string => typeof a === "string" && a.length > 0)
        : [];
    const badges = Array.isArray(r.badges)
        ? r.badges.filter((b): b is string => typeof b === "string" && b.length > 0)
        : [];
    const recipe: RecipeIngredient[] = Array.isArray(r.recipe)
        ? r.recipe.map((row) => {
            const m = rec(row);
            const note = str(m.note);
            return { inventory_id: str(m.inventory_id), qty: num(m.qty), ...(note ? { note } : {}) };
        })
        : [];
    const blurb = str(r.blurb).trim();
    return {
        id: str(r.id, `${Date.now()}`),
        name: str(r.name, "Unnamed Item"),
        price: num(r.price),
        category: str(r.category, "Uncategorized"),
        image_url: typeof r.image_url === "string" && r.image_url ? r.image_url : null,
        available: r.available !== false,
        station: typeof r.station === "string" && r.station ? r.station : null,
        allergens,
        ...(badges.length > 0 ? { badges } : {}),
        ...(blurb ? { blurb } : {}),
        recipe,
        modifiers: mapModifiers(r.modifiers),
        cost: null,
        margin_pct: null,
        missing_costs: 0,
    };
};

/* ── Reads ──────────────────────────────────────────────────────────── */

/**
 * The module's one load — mirrors Flutter's `_MenuModule` AsyncView loader:
 * `/menu` is required, while costing / kitchen sections / badges are optional
 * decoration that must never fail the menu screen.
 */
export const fetchMenuModule = async (restaurantId: string): Promise<MenuModuleData> => {
    const res = await requestBackend<unknown[]>({
        path: `/menu?restaurantId=${encodeURIComponent(restaurantId)}`,
        method: "GET",
    });
    if (res.status === 0) { throw unreachable(); }
    if (!res.ok || !Array.isArray(res.data)) {
        throw refusal(res.data, res.text, "Unable to load the menu.");
    }
    const items = res.data.map(mapModuleItem);

    // Theoretical cost + margin per dish. Optional decoration (Flutter: "never
    // fail the menu screen over it").
    try {
        const costing = await requestBackend<{ items?: unknown[] }>({ path: "/menu/costing", method: "GET" });
        if (costing.ok && Array.isArray(costing.data?.items)) {
            const byId = new Map<string, Record<string, unknown>>();
            for (const c of costing.data.items) {
                const m = rec(c);
                byId.set(str(m.id), m);
            }
            for (const item of items) {
                const c = byId.get(item.id);
                if (c) {
                    item.cost = c.cost == null ? null : num(c.cost);
                    item.margin_pct = c.margin_pct == null ? null : num(c.margin_pct);
                    item.missing_costs = num(c.missing_costs);
                }
            }
        }
    } catch (e) {
        console.warn("menu costing unavailable", e);
    }

    // Managed kitchen sections. Optional — items still render without them.
    let sections: string[] = [];
    try {
        const settings = await requestBackend<{ kitchen_sections?: unknown[] }>({ path: "/restaurant/settings", method: "GET" });
        if (settings.ok && Array.isArray(settings.data?.kitchen_sections)) {
            sections = settings.data.kitchen_sections.map((s) => str(s).trim()).filter((s) => s.length > 0);
        }
    } catch (e) {
        console.warn("kitchen sections unavailable", e);
    }

    // Categories: the ordered list the tenant manages (a category can exist with
    // no items yet). Optional — fall back to the categories seen on the items.
    let categories: string[] = [];
    try {
        const cats = await requestBackend<unknown[]>({
            path: `/menu/categories?restaurantId=${encodeURIComponent(restaurantId)}`,
            method: "GET",
        });
        if (cats.ok && Array.isArray(cats.data)) {
            categories = cats.data.map((c) => str(c).trim()).filter((c) => c.length > 0);
        }
    } catch (e) {
        console.warn("menu categories unavailable", e);
    }

    // The tenant's badge catalogue + the starter set the server offers.
    let badges: MenuBadge[] = [];
    let badgePresets: MenuBadge[] = [];
    let badgeLabelMax = 24;
    let badgePerItemMax = 8;
    try {
        const b = await requestBackend<{ badges?: unknown; presets?: unknown; label_max?: unknown; per_item_max?: unknown }>({
            path: "/menu/badges",
            method: "GET",
        });
        if (b.ok && b.data) {
            badges = parseBadgeCatalogue(b.data.badges);
            badgePresets = parseBadgeCatalogue(b.data.presets);
            badgeLabelMax = num(b.data.label_max, 24) > 0 ? num(b.data.label_max, 24) : 24;
            badgePerItemMax = num(b.data.per_item_max, 8) > 0 ? num(b.data.per_item_max, 8) : 8;
        }
    } catch (e) {
        console.warn("menu badges unavailable", e);
    }

    return { items, categories, sections, badges, badgePresets, badgeLabelMax, badgePerItemMax };
};

/** Just the items, strictly (throws on failure) — the availability sheet's load. */
export const fetchMenuItemsStrict = async (restaurantId: string): Promise<MenuModuleItem[]> => {
    const res = await requestBackend<unknown[]>({
        path: `/menu?restaurantId=${encodeURIComponent(restaurantId)}`,
        method: "GET",
    });
    if (res.status === 0) { throw unreachable(); }
    if (!res.ok || !Array.isArray(res.data)) {
        throw refusal(res.data, res.text, "Unable to load the menu.");
    }
    return res.data.map(mapModuleItem);
};

/** The inventory rows the recipe editor's ingredient picker offers —
 *  `name (stock+unit)`, exactly the label Flutter shows. */
export const fetchRecipeInventory = async (): Promise<RecipeInventoryRow[]> => {
    const res = await requestBackend<unknown[]>({ path: "/inventory", method: "GET" });
    if (res.status === 0) { throw unreachable(); }
    if (!res.ok || !Array.isArray(res.data)) {
        throw refusal(res.data, res.text, "Unable to load the inventory.");
    }
    return res.data.map((raw) => {
        const r = rec(raw);
        return {
            id: str(r.id, str(r.barcode)),
            name: str(r.name, "Unnamed Item"),
            stock: num(r.stock),
            unit: str(r.unit, ""),
        };
    });
};

/** Queue pre-order config, strictly (db's reader silently serves a fallback). */
export const fetchQueueMenuConfig = async (): Promise<QueueMenuConfigPayload> => {
    const res = await requestBackend<QueueMenuConfigPayload>({ path: "/queue-menu-config", method: "GET" });
    if (res.status === 0) { throw unreachable(); }
    if (!res.ok || !res.data) {
        throw refusal(res.data, res.text, "Unable to load the queue menu settings.");
    }
    return res.data;
};

/** One dish's price points, strictly (db's reader answers [] on failure). */
export const fetchMenuVariations = async (menuId: string): Promise<MenuVariationRecord[]> => {
    const res = await requestBackend<{ variations?: MenuVariationRecord[] }>({
        path: `/menu-variations?menu_id=${encodeURIComponent(menuId)}&include_inactive=true`,
        method: "GET",
    });
    if (res.status === 0) { throw unreachable(); }
    if (!res.ok) {
        throw refusal(res.data, res.text, "Unable to load the price points.");
    }
    return Array.isArray(res.data?.variations) ? res.data.variations : [];
};

/* ── Writes ─────────────────────────────────────────────────────────── */

/**
 * The preserve-on-omit item upsert — POST /menu — throwing the server's own
 * sentence on refusal (db's addMenuItem silently queues to a local cache, which
 * hides exactly the failures this page must show).
 */
export const upsertMenuItem = async (payload: MenuUpsertPayload): Promise<void> => {
    const res = await requestBackend({ path: "/menu", method: "POST", body: payload });
    if (res.status === 0) { throw unreachable(); }
    if (!res.ok) { throw refusal(res.data, res.text, "Unable to save menu item."); }
};

/** Full-replace PUT /menu — the delete path (Flutter sends the remaining items
 *  as minimal rows so every other stored field survives). */
export const replaceMenuItems = async (items: MenuReplaceRow[]): Promise<void> => {
    const res = await requestBackend({ path: "/menu", method: "PUT", body: { items } });
    if (res.status === 0) { throw unreachable(); }
    if (!res.ok) { throw refusal(res.data, res.text, "Unable to save the menu."); }
};

/** Upload a dish photo (base64) — answers the hosted `image_url`. */
export const uploadMenuImage = async (imageBase64: string, contentType: string): Promise<string> => {
    const res = await requestBackend<{ image_url?: string }>({
        path: "/menu/upload-image",
        method: "POST",
        body: { image_base64: imageBase64, content_type: contentType },
    });
    if (res.status === 0) { throw unreachable(); }
    if (!res.ok || typeof res.data?.image_url !== "string") {
        throw refusal(res.data, res.text, "Image upload failed.");
    }
    return res.data.image_url;
};

/** Replace the managed kitchen-section list. 403 is humanised the way Flutter's
 *  `_KitchenSectionsDialog._friendly` does. */
export const saveKitchenSectionList = async (sections: string[]): Promise<string[]> => {
    const res = await requestBackend<{ kitchen_sections?: unknown[] }>({
        path: "/restaurant/settings",
        method: "POST",
        body: { kitchen_sections: sections },
    });
    if (res.status === 0) { throw unreachable(); }
    if (res.status === 403) {
        throw refusal(res.data, res.text, "Only an admin can change kitchen sections.");
    }
    if (!res.ok) { throw refusal(res.data, res.text, "Unable to save kitchen sections."); }
    return Array.isArray(res.data?.kitchen_sections)
        ? res.data.kitchen_sections.map((s) => str(s).trim()).filter((s) => s.length > 0)
        : sections;
};

/** Rename a section — the backend cascades onto every item pointing at it. */
export const renameKitchenSectionChecked = async (
    from: string,
    to: string,
): Promise<{ kitchen_sections: string[] | null; updated_items: number }> => {
    const res = await requestBackend<{ kitchen_sections?: unknown[]; updated_items?: unknown }>({
        path: "/kitchen-sections/rename",
        method: "POST",
        body: { from, to },
    });
    if (res.status === 0) { throw unreachable(); }
    if (res.status === 403) {
        throw refusal(res.data, res.text, "Only an admin can change kitchen sections.");
    }
    if (!res.ok) { throw refusal(res.data, res.text, "Unable to rename that section."); }
    return {
        kitchen_sections: Array.isArray(res.data?.kitchen_sections)
            ? res.data.kitchen_sections.map((s) => str(s).trim()).filter((s) => s.length > 0)
            : null,
        updated_items: num(res.data?.updated_items),
    };
};

/** Add a category (Flutter: POST /menu/categories) — throws the refusal instead
 *  of silently caching, which is what db's addMenuCategory does. */
export const createMenuCategory = async (category: string): Promise<void> => {
    const res = await requestBackend({ path: "/menu/categories", method: "POST", body: { category } });
    if (res.status === 0) { throw unreachable(); }
    if (!res.ok) { throw refusal(res.data, res.text, "Unable to add category."); }
};

/** Delete a category and every item in it — throws refusals. */
export const deleteMenuCategoryChecked = async (category: string): Promise<void> => {
    const res = await requestBackend({
        path: `/menu/categories?category=${encodeURIComponent(category)}`,
        method: "DELETE",
    });
    if (res.status === 0) { throw unreachable(); }
    if (!res.ok) { throw refusal(res.data, res.text, "Unable to delete category."); }
};

/**
 * Replace the badge CATALOGUE — the write behind every action in the badges
 * dialog (Flutter MenuBadgesDialog `_persist`). Answers a plain object rather
 * than throwing, because the caller's whole flow keys off the STATUS: a 409 is
 * a question ("release the tagged dishes too?"), a 403 is the humanised
 * permission line, anything else rolls the list back. Custom error classes do
 * not survive the server-action boundary; a status number does.
 */
export const putMenuBadgeCatalogue = async (
    badges: MenuBadge[],
    releaseTagged: boolean,
): Promise<
    | { ok: true; badges: MenuBadge[] }
    | { ok: false; status: number; message: string }
> => {
    const res = await requestBackend<{ badges?: unknown; error?: unknown }>({
        path: "/menu/badges",
        method: "PUT",
        body: {
            badges,
            ...(releaseTagged ? { release_tagged: true } : {}),
        },
    });
    if (res.status === 0) {
        return { ok: false, status: 0, message: "The restaurant server could not be reached." };
    }
    if (!res.ok) {
        let payload: unknown = res.data;
        if (payload == null && res.text.trim().length > 0) {
            try { payload = JSON.parse(res.text); } catch { payload = null; }
        }
        const fallback = res.status === 403
            ? "Only someone who can edit the menu may change badges."
            : "Unable to save badges.";
        return { ok: false, status: res.status, message: refusalSentence(payload) ?? fallback };
    }
    return { ok: true, badges: parseBadgeCatalogue(res.data?.badges) };
};
