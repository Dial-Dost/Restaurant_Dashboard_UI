// THE PAYMENT-MODE ROW — what it reads, and the three things it must not do.
//
// The arithmetic is the backend's (GetSettlementSummaryReport). What is tested
// here is the SHAPING, and every case below is a way this card could tell a
// restaurant something false about its own till:
//
//   * reading the whole-window figures off the wrong place in the payload, so
//     `unallocated` — the one row that means "these bills need looking at" —
//     silently reads zero forever;
//   * printing 0% for a mode whose share the server did not compute, beside a
//     five-figure amount;
//   * showing a table of zeroes for a window in which nothing has been settled,
//     which reads as "we took nothing" rather than "the night has not started".

import {
  readSettlementBreakdown, modeSharePct, hasSettlements, UNALLOCATED_METHOD,
} from "../settlement-breakdown";
import type { MisReportPayload } from "../mis-reports";

const payload = (over: Record<string, unknown> = {}): MisReportPayload => (({
  meta: {} as MisReportPayload["meta"],
  columns: [],
  rows: [
    { method: "Cash", bills: 12, amount: 14500, share_pct: 58, refund: 0, net_amount: 14500 },
    { method: "UPI", bills: 9, amount: 8000, share_pct: 32, refund: 500, net_amount: 7500 },
    { method: "Card", bills: 3, amount: 2500, share_pct: 10, refund: 0, net_amount: 2500 },
  ],
  totals: { bills: 22, amount: 25000, refund: 500, net_amount: 24500, split_bills: 2, unallocated: 0 },
  ...over,
}));

describe("reading the settlement report", () => {
  it("shapes every mode and ranks the largest first", () => {
    const b = readSettlementBreakdown(payload({
      rows: [
        { method: "Card", bills: 3, amount: 2500, share_pct: 10, refund: 0, net_amount: 2500 },
        { method: "Cash", bills: 12, amount: 14500, share_pct: 58, refund: 0, net_amount: 14500 },
      ],
    }))!;
    expect(b.modes.map((m) => m.method)).toEqual(["Cash", "Card"]);
  });

  it("names each mode by the owner's label, keeping the id it groups by", () => {
    // A renamed or owner-added mode must read on this card the way the till's
    // pill reads it; a server that sent no label (older backend) shows the id.
    const b = readSettlementBreakdown(payload({
      rows: [
        { method: "Dineout", label: "Swiggy Dineout", bills: 2, amount: 900, share_pct: 90, refund: 0, net_amount: 900 },
        { method: "Cash", bills: 1, amount: 100, share_pct: 10, refund: 0, net_amount: 100 },
      ],
    }))!;
    expect(b.modes.map((m) => [m.method, m.label])).toEqual([["Dineout", "Swiggy Dineout"], ["Cash", "Cash"]]);
  });

  it("takes the whole-window figures from TOTALS, not from the payload root", () => {
    // The trap this pins: `split_bills` and `unallocated` live inside `totals`.
    // Reading them off the root yields a silent zero on both, and a permanent
    // zero on `unallocated` means the warning row can never appear.
    const b = readSettlementBreakdown(payload({
      totals: { amount: 25000, net_amount: 24500, split_bills: 4, unallocated: 250 },
    }))!;
    expect(b.split_bills).toBe(4);
    expect(b.unallocated).toBe(250);
  });

  it("prefers the server's totals over re-summing the rows", () => {
    // Re-summing drifts on rounding, and this figure is reconciled against a
    // physical till.
    const b = readSettlementBreakdown(payload({ totals: { amount: 24999.99, net_amount: 24499.99 } }))!;
    expect(b.total_amount).toBe(24999.99);
    expect(b.total_net).toBe(24499.99);
  });

  it("still renders when the payload has no totals at all", () => {
    const b = readSettlementBreakdown(payload({ totals: null }))!;
    expect(b.total_amount).toBe(25000);
    expect(b.total_net).toBe(24500);
  });

  it("refuses a payload that is not a settlement report", () => {
    expect(readSettlementBreakdown(null)).toBeNull();
    expect(readSettlementBreakdown(payload({ rows: undefined }))).toBeNull();
    expect(readSettlementBreakdown(payload({ rows: "nope" }))).toBeNull();
  });

  it("drops nameless rows rather than rendering a blank method", () => {
    const b = readSettlementBreakdown(payload({
      rows: [{ method: "", amount: 100 }, { method: "Cash", amount: 200 }],
    }))!;
    expect(b.modes.map((m) => m.method)).toEqual(["Cash"]);
  });

  it("coerces missing numbers to zero rather than NaN — a NaN renders as blank money", () => {
    const b = readSettlementBreakdown(payload({ rows: [{ method: "Cash" }] }))!;
    expect(b.modes[0]).toMatchObject({ bills: 0, amount: 0, refund: 0, net_amount: 0 });
  });
});

describe("a mode's share", () => {
  it("uses the server's figure when there is one", () => {
    expect(modeSharePct({ method: "Cash", label: "Cash", bills: 1, amount: 14500, refund: 0, net_amount: 14500, share_pct: 58 }, 25000)).toBe(58);
  });

  it("computes it when the server did not", () => {
    expect(modeSharePct({ method: "Cash", label: "Cash", bills: 1, amount: 12500, refund: 0, net_amount: 12500, share_pct: null }, 25000)).toBe(50);
  });

  it("is NULL, never zero, when there is nothing to divide by", () => {
    // A card printing "0%" beside ₹14,500 of cash is worse than printing nothing.
    expect(modeSharePct({ method: "Cash", label: "Cash", bills: 1, amount: 14500, refund: 0, net_amount: 14500, share_pct: null }, 0)).toBeNull();
  });
});

describe("an empty window is not an empty till", () => {
  it("a window with money in it renders", () => {
    expect(hasSettlements(readSettlementBreakdown(payload()))).toBe(true);
  });

  it("a window with no rows does not", () => {
    expect(hasSettlements(readSettlementBreakdown(payload({ rows: [], totals: { amount: 0 } })))).toBe(false);
  });

  it("rows that sum to nothing do not either — a table of zeroes reads as a claim", () => {
    expect(hasSettlements(readSettlementBreakdown(payload({
      rows: [{ method: "Cash", bills: 0, amount: 0, share_pct: null, refund: 0, net_amount: 0 }],
      totals: { amount: 0 },
    })))).toBe(false);
  });

  it("and a failed fetch is a third thing again", () => {
    expect(hasSettlements(readSettlementBreakdown(null))).toBe(false);
  });
});

describe("the unallocated bucket", () => {
  it("is carried through so the card can warn about it", () => {
    const b = readSettlementBreakdown(payload({
      rows: [
        { method: "Cash", bills: 5, amount: 5000, share_pct: 95, refund: 0, net_amount: 5000 },
        { method: UNALLOCATED_METHOD, bills: 1, amount: 250, share_pct: 5, refund: 0, net_amount: 250 },
      ],
      totals: { amount: 5250, net_amount: 5250, split_bills: 0, unallocated: 250 },
    }))!;
    expect(b.unallocated).toBe(250);
    expect(b.modes.some((m) => m.method === UNALLOCATED_METHOD)).toBe(true);
  });

  it("falls back to the row when the totals omit it, rather than reporting zero", () => {
    const b = readSettlementBreakdown(payload({
      rows: [{ method: UNALLOCATED_METHOD, bills: 1, amount: 99, share_pct: 100, refund: 0, net_amount: 99 }],
      totals: { amount: 99, net_amount: 99 },
    }))!;
    expect(b.unallocated).toBe(99);
  });
});
