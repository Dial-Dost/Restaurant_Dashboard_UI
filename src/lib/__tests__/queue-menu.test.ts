// The client-side half of the queue pre-order menu: how the queue page orders
// its category tabs and reads the restaurant's copy, and how the dashboard
// editor previews an arrangement before it is saved.
//
// WHY THIS SUITE EXISTS — two failure modes that only show up on a live page:
//
//  1. A restaurant that never touched this feature must be byte-identical. The
//     queue page has always sorted its tabs alphabetically; if an absent
//     configuration stopped doing that, every queue page in the estate would
//     silently reshuffle.
//  2. The editor's PREVIEW and the guest's PAGE must order categories the same
//     way, or the owner arranges tabs, saves, and gets something else. Both call
//     the functions tested here, and orderCategoriesByPreference mirrors the
//     server's orderQueueMenuCategories exactly.

import {
  applyServerCategoryOrder,
  isOfferedToQueue,
  orderCategoriesByPreference,
  readQueueMenuPresentation,
  QUEUE_MENU_PRESENTATION_DEFAULT,
} from "../queue-menu";

describe("applyServerCategoryOrder (the queue page's tabs)", () => {
  const own = ["Starters", "Mains", "Drinks"];

  it("falls back to alphabetical when the server named no order", () => {
    // An un-configured tenant, or an older backend that has no queue-menu
    // endpoint at all. This IS the shipped behaviour.
    expect(applyServerCategoryOrder([], own)).toEqual(["Drinks", "Mains", "Starters"]);
  });

  it("follows the server's arrangement", () => {
    expect(applyServerCategoryOrder(["Drinks", "Starters", "Mains"], own)).toEqual(["Drinks", "Starters", "Mains"]);
  });

  it("ignores a category the server named that this page has no items for", () => {
    // The excluded-dish case: the server still lists a category name the guest
    // payload has no items in. An empty tab is worse than no tab.
    expect(applyServerCategoryOrder(["Desserts", "Mains"], own)).toEqual(["Mains", "Drinks", "Starters"]);
  });

  it("keeps a category the server did not name rather than dropping the tab", () => {
    // Defensive: the menu changed between the two reads. Losing a tab would
    // hide dishes the guest was actually served.
    expect(applyServerCategoryOrder(["Mains"], own)).toEqual(["Mains", "Drinks", "Starters"]);
  });

  it("matches names case- and whitespace-insensitively", () => {
    expect(applyServerCategoryOrder([" drinks ", "MAINS"], own)).toEqual(["Drinks", "Mains", "Starters"]);
  });
});

describe("orderCategoriesByPreference (the editor's preview)", () => {
  const all = ["Starters", "Mains", "Drinks"];

  it("reproduces the alphabetical default for an empty arrangement", () => {
    expect(orderCategoriesByPreference([], all)).toEqual(["Drinks", "Mains", "Starters"]);
  });

  it("pins the arranged ones and leaves the rest alphabetical", () => {
    expect(orderCategoriesByPreference(["Starters"], all)).toEqual(["Starters", "Drinks", "Mains"]);
  });

  it("drops an arrangement entry for a category that no longer exists", () => {
    expect(orderCategoriesByPreference(["Desserts", "Drinks"], all)).toEqual(["Drinks", "Mains", "Starters"]);
  });

  it("agrees with the page for a fully-specified order — the preview cannot lie", () => {
    const arranged = ["Drinks", "Starters", "Mains"];
    expect(orderCategoriesByPreference(arranged, all)).toEqual(applyServerCategoryOrder(arranged, all));
  });
});

describe("readQueueMenuPresentation", () => {
  it("an absent block is the shipped default — the page's own localised copy, prices on", () => {
    expect(readQueueMenuPresentation(undefined)).toEqual(QUEUE_MENU_PRESENTATION_DEFAULT);
    expect(readQueueMenuPresentation(null)).toEqual(QUEUE_MENU_PRESENTATION_DEFAULT);
    expect(readQueueMenuPresentation({})).toEqual(QUEUE_MENU_PRESENTATION_DEFAULT);
  });

  it("reads the restaurant's own words", () => {
    expect(readQueueMenuPresentation({ headline: "Order while you wait", intro: "Drinks first.", show_prices: false }))
      .toEqual({ headline: "Order while you wait", intro: "Drinks first.", showPrices: false });
  });

  it("only an explicit false hides prices", () => {
    // A truthy-but-wrong value from an odd payload must not blank the prices on
    // a live menu.
    for (const v of [undefined, null, "false", 0, "no"]) {
      expect(readQueueMenuPresentation({ show_prices: v }).showPrices).toBe(true);
    }
    expect(readQueueMenuPresentation({ show_prices: false }).showPrices).toBe(false);
  });

  it("a non-string heading is ignored rather than rendered", () => {
    expect(readQueueMenuPresentation({ headline: 42, intro: ["a"] })).toEqual(QUEUE_MENU_PRESENTATION_DEFAULT);
  });
});

describe("isOfferedToQueue (the editor's unsaved-rule preview)", () => {
  const biryani = { id: "m-biryani", category: "Mains" };
  const lassi = { id: "m-lassi", category: "Drinks" };

  it("offers everything under the default rule", () => {
    const all = { mode: "all", items: [], categories: [] };
    expect(isOfferedToQueue(all, biryani)).toBe(true);
    expect(isOfferedToQueue(all, lassi)).toBe(true);
  });

  it("exclude removes a named dish and leaves the rest", () => {
    const rule = { mode: "exclude", items: ["m-biryani"], categories: [] };
    expect(isOfferedToQueue(rule, biryani)).toBe(false);
    expect(isOfferedToQueue(rule, lassi)).toBe(true);
  });

  it("a category rule and an item rule are UNIONED, not layered", () => {
    // The owner ticks "Starters" and also names one dish elsewhere; both apply.
    const rule = { mode: "exclude", items: ["m-lassi"], categories: ["Mains"] };
    expect(isOfferedToQueue(rule, biryani)).toBe(false); // by category
    expect(isOfferedToQueue(rule, lassi)).toBe(false); // by id
  });

  it("include is the mirror image — nothing is offered unless it is listed", () => {
    const rule = { mode: "include", items: [], categories: ["Drinks"] };
    expect(isOfferedToQueue(rule, lassi)).toBe(true);
    expect(isOfferedToQueue(rule, biryani)).toBe(false);
  });

  it("a sold-out dish is never offered, whatever the rule says", () => {
    // The preview has to agree with the server here or an owner ticks a dish,
    // sees it in the preview, and it never appears for a guest.
    const sold = { id: "m-fish", category: "Mains", available: false };
    for (const rule of [
      { mode: "all", items: [], categories: [] },
      { mode: "include", items: ["m-fish"], categories: [] },
      { mode: "exclude", items: [], categories: [] },
    ]) {
      expect(isOfferedToQueue(rule, sold)).toBe(false);
    }
  });

  it("matches ids and categories case-insensitively", () => {
    expect(isOfferedToQueue({ mode: "exclude", items: [], categories: [" mains "] }, biryani)).toBe(false);
  });
});
