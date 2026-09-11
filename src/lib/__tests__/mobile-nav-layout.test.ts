// WHICH FOUR DESTINATIONS A PHONE GETS.
//
// The ways this can be wrong are invisible in a screenshot, which is why it is a
// pure function with a test rather than a few lines inside the component:
//
//   * an admin getting Floor plan — a layout screen nobody opens mid-service —
//     while Menu, where you take a dish off during a rush, sits behind a tap;
//   * a waiter-only session getting two buttons and two empty slots, which reads
//     as something failing to load;
//   * a destination in NEITHER list, so it cannot be reached from a phone at all
//     — the exact failure the mobile nav exists to fix.

import { splitMobileNav, PRIMARY_ORDER, PRIMARY_SLOTS } from "../mobile-nav-layout";

const item = (href: string) => ({ href });

/** An admin's nav, in the DESKTOP order the layout builds it in. */
const adminNav = [
  "/dashboard",
  "/dashboard/orders",
  "/dashboard/tables",
  "/dashboard/floor-plan",
  "/dashboard/waitlist",
  "/dashboard/bookings",
  "/dashboard/menu",
  "/dashboard/inventory",
  "/dashboard/purchase-orders",
  "/dashboard/customers",
  "/dashboard/feedback",
  "/dashboard/employees",
  "/dashboard/attendance",
  "/dashboard/analytics",
  "/dashboard/reports",
  "/dashboard/accounting",
  "/dashboard/cash",
  "/dashboard/settings",
].map(item);

describe("an admin's phone bar", () => {
  const { primary, rest } = splitMobileNav(adminNav);

  it("takes the four a phone user wants, in that order", () => {
    expect(primary.map((i) => i.href)).toEqual([
      "/dashboard/orders",
      "/dashboard/tables",
      "/dashboard/menu",
      "/dashboard",
    ]);
  });

  it("does NOT take the nav's own first four", () => {
    // That would put Floor plan on the bar and Menu in the sheet, which is
    // backwards for somebody standing on the floor.
    const naive = adminNav.slice(0, 4).map((i) => i.href);
    expect(primary.map((i) => i.href)).not.toEqual(naive);
    expect(primary.map((i) => i.href)).not.toContain("/dashboard/floor-plan");
  });

  it("puts everything else in the sheet, in the nav's own order", () => {
    expect(rest[0].href).toBe("/dashboard/floor-plan");
    expect(rest.map((i) => i.href)).toContain("/dashboard/settings");
  });
});

describe("THE INVARIANT: nothing is dropped and nothing is duplicated", () => {
  const cases: Record<string, { href: string }[]> = {
    admin: adminNav,
    "waiter-only": ["/dashboard/tables", "/dashboard/orders"].map(item),
    valet: ["/dashboard/valet"].map(item),
    "no primaries at all": ["/dashboard/inventory", "/dashboard/cash", "/dashboard/settings"].map(item),
    "exactly four": ["/dashboard", "/dashboard/orders", "/dashboard/tables", "/dashboard/menu"].map(item),
    "exactly five": ["/dashboard", "/dashboard/orders", "/dashboard/tables", "/dashboard/menu", "/dashboard/cash"].map(item),
    empty: [],
  };

  for (const [name, nav] of Object.entries(cases)) {
    it(`${name}: primary + rest === the whole nav`, () => {
      const { primary, rest } = splitMobileNav(nav);
      const seen = [...primary, ...rest].map((i) => i.href).sort();
      expect(seen).toEqual(nav.map((i) => i.href).sort());
      // No item in both lists.
      expect(new Set(seen).size).toBe(seen.length);
    });
  }
});

describe("a short nav gets a short bar, not gaps", () => {
  it("a waiter-only session gets its two, and no More", () => {
    const { primary, rest } = splitMobileNav(["/dashboard/tables", "/dashboard/orders"].map(item));
    // Ordered by PRIMARY_ORDER: Orders leads.
    expect(primary.map((i) => i.href)).toEqual(["/dashboard/orders", "/dashboard/tables"]);
    expect(rest).toHaveLength(0);
  });

  it("a valet session gets its one, and no More", () => {
    const { primary, rest } = splitMobileNav([item("/dashboard/valet")]);
    expect(primary.map((i) => i.href)).toEqual(["/dashboard/valet"]);
    expect(rest).toHaveLength(0);
  });

  it("an empty nav produces nothing rather than throwing", () => {
    expect(splitMobileNav([])).toEqual({ primary: [], rest: [] });
  });
});

describe("topping up when the wanted four are not all there", () => {
  it("fills the remaining slots from the nav's own order", () => {
    const nav = ["/dashboard/inventory", "/dashboard/cash", "/dashboard/settings", "/dashboard/reports", "/dashboard/analytics"].map(item);
    const { primary, rest } = splitMobileNav(nav);
    expect(primary.map((i) => i.href)).toEqual([
      "/dashboard/inventory", "/dashboard/cash", "/dashboard/settings", "/dashboard/reports",
    ]);
    expect(rest.map((i) => i.href)).toEqual(["/dashboard/analytics"]);
  });

  it("mixes: the wanted ones first, then the rest in nav order", () => {
    const nav = ["/dashboard/inventory", "/dashboard/menu", "/dashboard/cash", "/dashboard/settings"].map(item);
    const { primary } = splitMobileNav(nav);
    expect(primary[0].href).toBe("/dashboard/menu");
    expect(primary.slice(1).map((i) => i.href)).toEqual(["/dashboard/inventory", "/dashboard/cash", "/dashboard/settings"]);
  });

  it("never exceeds the slot count", () => {
    expect(splitMobileNav(adminNav).primary).toHaveLength(PRIMARY_SLOTS);
  });
});

describe("the wanted order itself", () => {
  it("leads with Orders, not Dashboard", () => {
    // A phone is used to take and check orders; the overview is a desk screen.
    expect(PRIMARY_ORDER[0]).toBe("/dashboard/orders");
    expect(PRIMARY_ORDER).toHaveLength(PRIMARY_SLOTS);
  });

  it("holds no duplicates", () => {
    expect(new Set(PRIMARY_ORDER).size).toBe(PRIMARY_ORDER.length);
  });
});
