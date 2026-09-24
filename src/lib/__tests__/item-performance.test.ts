// Section-wise item performance: what sold, where it belongs, and what the
// headline figures are allowed to claim.

import {
  OFF_MENU_SECTION,
  UNSECTIONED,
  itemPerformance,
  sectionCaption,
  sectionIndex,
  sectionShare,
  type PerfMenuItem,
  type PerfOrder,
} from "@/lib/item-performance";

const menu: PerfMenuItem[] = [
  { name: "Hara Dhaniya Pulao", category: "Biranj" },
  { name: "Subz Tehri", category: "Biranj" },
  { name: "Tandoori Roti", category: "Breads" },
  { name: "Bottle Water", category: "" },
];

const orders: PerfOrder[] = [
  { status: "Preparing", items: [
    { name: "Hara Dhaniya Pulao", quantity: 2, price: 579 },
    { name: "Tandoori Roti", quantity: 2, price: 130 },
  ] },
  { status: "Served", items: [
    { name: "Subz Tehri", quantity: 1, price: 549 },
    { name: "Hara Dhaniya Pulao", quantity: 1, price: 579 },
  ] },
  { status: "Cancelled", items: [{ name: "Subz Tehri", quantity: 9, price: 549 }] },
];

describe("which section a dish belongs to", () => {
  it("indexes the menu by name, case-insensitively", () => {
    const index = sectionIndex(menu);
    expect(index.get("hara dhaniya pulao")).toBe("Biranj");
    expect(index.get("bottle water")).toBe(UNSECTIONED);
    expect(index.get("")).toBeUndefined();
  });

  it("files a dish the menu no longer has under its own section", () => {
    const perf = itemPerformance([{ status: "Served", items: [{ name: "Retired Special", quantity: 1, price: 100 }] }], menu);
    expect(perf.sections[0]?.section).toBe(OFF_MENU_SECTION);
  });
});

describe("what the service adds up to", () => {
  const perf = itemPerformance(orders, menu);

  it("counts quantity and revenue off the order lines", () => {
    expect(perf.totalQuantity).toBe(6);
    expect(perf.totalRevenue).toBe(2 * 579 + 2 * 130 + 549 + 579);
    expect(perf.dishCount).toBe(3);
  });

  it("leaves a cancelled order out entirely", () => {
    const tehri = perf.dishes.find((d) => d.name === "Subz Tehri");
    expect(tehri?.quantity).toBe(1);
  });

  it("groups by section, richest first, and names the best and the slowest", () => {
    expect(perf.sections.map((s) => s.section)).toEqual(["Biranj", "Breads"]);
    const biranj = perf.sections[0];
    expect(biranj.quantity).toBe(4);
    expect(biranj.top?.name).toBe("Hara Dhaniya Pulao");
    expect(biranj.low?.name).toBe("Subz Tehri");
    expect(sectionCaption(biranj)).toBe("2 dishes · 4 sold");
  });

  it("offers no 'slowest' in a section holding one dish", () => {
    const breads = perf.sections.find((s) => s.section === "Breads");
    expect(breads?.top?.name).toBe("Tandoori Roti");
    expect(breads?.low).toBeNull();
  });

  it("adds a line's appearances up separately from its quantity", () => {
    const pulao = perf.dishes.find((d) => d.name === "Hara Dhaniya Pulao");
    expect(pulao?.quantity).toBe(3);
    expect(pulao?.lines).toBe(2);
  });
});

describe("the awkward rows", () => {
  it("counts a comped line as sold and as nothing earned", () => {
    const perf = itemPerformance(
      [{ status: "Served", items: [{ name: "Tandoori Roti", quantity: 2, price: 130, nc: true }] }],
      menu,
    );
    expect(perf.totalQuantity).toBe(2);
    expect(perf.totalRevenue).toBe(0);
  });

  it("survives a feed with no items, no names and no numbers", () => {
    const perf = itemPerformance(
      [{ status: "Served", items: null }, { items: [{ name: "  ", quantity: 1 }] }, { items: [{ name: "Tandoori Roti" }] }],
      menu,
    );
    expect(perf.totalQuantity).toBe(1);
    expect(perf.totalRevenue).toBe(0);
    expect(perf.dishes[0]?.name).toBe("Tandoori Roti");
  });

  it("answers zero share rather than dividing by nothing", () => {
    const perf = itemPerformance([], menu);
    expect(perf.sections).toEqual([]);
    expect(sectionShare({ section: "x", quantity: 0, revenue: 0, dishes: [], top: null, low: null }, 0)).toBe(0);
  });
});
