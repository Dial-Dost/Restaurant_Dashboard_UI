// CLIENT ITEM 1 — "if we try deleting 1 item, the whole KOT (all items in the
// KOT) gets deleted. That's if we use the Remove from bill option (before bill
// printing)."
//
// The web half of it. The control (named "Remove from KOT" since round 4
// item 2; see kot-line-actions.tsx) is drawn per line inside a KOT block
// (table-sheet.tsx, groupItemsByKot), but the request carried only the dish's
// NAME and its price — and POST /bills/remove-item answers a name with every
// line on the table that has it, across every ticket, because one order is one
// KOT. A table holding Tandoori Roti on two KOTs lost both for one tap, and
// where the other ticket held nothing else it was emptied and cancelled: the
// whole KOT, off every screen.
//
// So the line's own identity travels with the request. What is pinned here is
// exactly that: the body carries the ticket and the line whenever the block
// knows them, and carries no empty ones when it does not — an `item_id: ""` on
// the wire would make the server look for a line that cannot exist and refuse
// a removal that used to work.

import { removeBillItem } from "@/lib/api/bill-print";

interface Sent { path: string; method: string; body: Record<string, unknown> }
const sent: Sent[] = [];
let answer: { ok: boolean; status: number; data: unknown; text: string } = {
  ok: true, status: 200, data: { success: true, kot_cancelled: true, kot_no: 3 }, text: "",
};

jest.mock("@/lib/db", () => ({
  requestBackend: (opts: { path: string; method: string; body?: unknown }) => {
    sent.push({ path: opts.path, method: opts.method, body: (opts.body ?? {}) as Record<string, unknown> });
    return Promise.resolve(answer);
  },
}));

beforeEach(() => {
  sent.length = 0;
  answer = { ok: true, status: 200, data: { success: true, kot_cancelled: true, kot_no: 3 }, text: "" };
});

const LINE = { name: "Tandoori Roti", price: 130 };

describe("removeBillItem names the line, not just the dish", () => {
  it("sends the ticket and the line id the KOT block knows", async () => {
    await removeBillItem("csrorganics", "T7", { ...LINE, id: "r2", orderId: "kot-3" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ path: "/bills/remove-item", method: "POST" });
    expect(sent[0]!.body).toEqual({
      table_name: "T7", item_name: "Tandoori Roti", price: 130, order_id: "kot-3", item_id: "r2",
    });
  });

  it("omits what it does not know rather than sending a blank", async () => {
    // The trailing "No KOT number" block gathers several orders, so it has no
    // single ticket to name; a line written by an old client has no id. Sending
    // "" for either would ask the server for a line that cannot exist.
    await removeBillItem("csrorganics", "T7", { ...LINE, id: "r2", orderId: null });
    expect(sent[0]!.body).toEqual({ table_name: "T7", item_name: "Tandoori Roti", price: 130, item_id: "r2" });

    await removeBillItem("csrorganics", "T7", { ...LINE, id: "", orderId: "kot-3" });
    expect(sent[1]!.body).toEqual({ table_name: "T7", item_name: "Tandoori Roti", price: 130, order_id: "kot-3" });

    await removeBillItem("csrorganics", "T7", LINE);
    expect(sent[2]!.body).toEqual({ table_name: "T7", item_name: "Tandoori Roti", price: 130 });
  });

  it("hands the answer back, so the toast can name the CANCELLED docket (client item 2)", async () => {
    const res = await removeBillItem("csrorganics", "T7", { ...LINE, id: "r2", orderId: "kot-3" });
    expect(res).toMatchObject({ kot_cancelled: true, kot_no: 3 });
  });

  it("a refusal is raised in the server's own words", async () => {
    answer = { ok: false, status: 400, data: { error: "Item not found on this table's bill" }, text: "" };
    await expect(removeBillItem("csrorganics", "T7", { ...LINE, id: "gone", orderId: "kot-3" }))
      .rejects.toThrow("Item not found on this table's bill");
  });
});
