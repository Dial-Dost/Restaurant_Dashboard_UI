// ROUND-3 ITEM 4'S FOLLOW-UP — A HIDDEN CARD MUST NOT DELETE ITS TABLE.
//
// THE REPORTED SHAPE. The backend now keeps one card per table number by
// leaving rows OFF GET /get-tables (planNextPartyFloorHidden): a settled "14"
// beside a running "14 #2" draws one card, and the card it drops is the ROOT's.
// PR Restaurant_Backend#31 drops a spare free seat and a second running card on
// top of that.
//
// Every NON-SERVICE surface on this dashboard is built out of that same payload
// by dropping the rows that carry a `parent_table` — it is the one-line way to
// say "the room's tables, not the floor's cards". That assumes the root is
// always in the payload. When the hidden row IS the root, the number is in
// neither half: no "14" in the floor-plan editor, none in its delete picker,
// none in the booking picker, and "N of M tables occupied" counts a table
// short. An owner whose table has gone from the layout screen reports it as one
// we deleted.
//
// THE FIX IS A DIFFERENT READ, NOT A RECONSTRUCTION. `?include_hidden=1` answers
// every live row; the surfaces that list TABLES ask for it and the surfaces that
// draw CARDS do not. Reconstructing 14 from "14 #2" was the alternative and is
// worse: the sibling carries the root's NAME and nothing else that the editor
// writes through (the root's own capacity, and the name every layout write —
// PATCH/DELETE /table/:name — addresses), so the editor would be editing an
// invented row.
//
// What is pinned here: which read each surface makes, and that the room read
// puts the number back exactly once.

import { fetchRoomTables } from "@/lib/api/bookings";
import { getFloorTableRows } from "@/lib/api/overview";
import { fetchFloor, isNextPartyRow } from "@/lib/api/tables-floor";
import { countRoomsInUse } from "@/components/overview/overview-utils";

const asked: string[] = [];
/** Answers keyed by the path's `include_hidden` flag — the floor, or the room. */
let floorRows: Record<string, unknown>[] = [];
let roomRows: Record<string, unknown>[] = [];

jest.mock("@/lib/db", () => ({
  getBookings: () => Promise.resolve([]),
  requestBackend: (opts: { path: string; method: string }) => {
    asked.push(opts.path);
    if (!opts.path.startsWith("/get-tables")) {
      // The floor read's optional joins (assignments, zones) — never the point
      // here, and each one is best-effort in the reader anyway.
      return Promise.resolve({ ok: false, status: 403, data: null, text: "not asked for here" });
    }
    const hidden = /[?&]include_hidden=1(&|$)/.test(opts.path);
    return Promise.resolve({ ok: true, status: 200, data: hidden ? roomRows : floorRows, text: "" });
  },
}));

/** A plain table row as /get-tables sends it. */
const table = (name: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  table_name: name, parent_table: null, party_no: null, display_name: name,
  capacity: 4, max_capacity: 4, section: "Garden", occupied: false, covers: 0,
  print_count: 0, bill_printed_at: null, printed_at: null, paper_stale: null, printed_as: null,
  ...over,
});

/** "14 #2" — the next party's seat at 14. */
const seat = (root: string, over: Record<string, unknown> = {}): Record<string, unknown> =>
  table(`${root} #2`, { parent_table: root, party_no: 2, display_name: root, ...over });

// THE CLIENT'S PHOTO, as the two reads answer it. 14 was settled while its next
// party was still eating, so the floor draws "14 #2" alone and the room still
// has both rows in it. 15 is the ordinary neighbour that must never move.
beforeEach(() => {
  asked.length = 0;
  roomRows = [table("14"), seat("14", { occupied: true, covers: 2 }), table("15")];
  floorRows = [seat("14", { occupied: true, covers: 2 }), table("15")];
});

const RID = "csrorganics";

describe("the booking picker lists every real table, hidden root included", () => {
  it("THE BUG: the floor's own payload has no 14 to offer a booking", async () => {
    // What the picker used to be handed, and what it made of it.
    expect(floorRows.filter((r) => r.parent_table === null).map((r) => r.table_name)).toEqual(["15"]);
  });

  it("asks for the room and offers 14 again, exactly once", async () => {
    const tables = await fetchRoomTables(RID);
    expect(asked[0]).toContain("include_hidden=1");
    expect(tables.map((t) => t.table_name)).toEqual(["14", "15"]);
    // The seat itself is still not a bookable table — the server refuses one.
    expect(tables.map((t) => t.table_name)).not.toContain("14 #2");
  });
});

describe("'N of M tables occupied' counts the room, not the cards", () => {
  it("THE BUG: the floor payload loses the number from both halves of the count", () => {
    expect(countRoomsInUse(floorRows, (r) => r.occupied === true)).toEqual({ inUse: 0, rooms: 1 });
  });

  it("the Overview's read asks for the room, and 14 is one occupied table of two", async () => {
    const rows = await getFloorTableRows(RID);
    expect(asked[0]).toContain("include_hidden=1");
    expect(countRoomsInUse(rows, (r) => r.occupied === true)).toEqual({ inUse: 1, rooms: 2 });
  });
});

describe("the floor-plan editor draws the room; the Tables screen draws the floor", () => {
  it("the plan surface asks for the room and keeps 14 in the layout", async () => {
    const payload = await fetchFloor(RID, { live: false, canReadZones: false, includeHidden: true });
    expect(asked[0]).toContain("include_hidden=1");
    // What the page itself derives: the plan's rows, its table/seat counts, its
    // delete picker and its "name already taken" list all come off this one list.
    const planRows = payload.rows.filter((r) => !isNextPartyRow(r.raw));
    expect(planRows.map((r) => r.name)).toEqual(["14", "15"]);
    expect(planRows.reduce((n, r) => n + r.capacity, 0)).toBe(8);
  });

  it("THE BUG: without the room read the editor is short a table", async () => {
    const payload = await fetchFloor(RID, { live: false, canReadZones: false, includeHidden: false });
    expect(payload.rows.filter((r) => !isNextPartyRow(r.raw)).map((r) => r.name)).toEqual(["15"]);
  });

  it("the SERVICE surface never asks for it — one card per table number stands", async () => {
    const payload = await fetchFloor(RID, { live: true, canReadZones: false, includeHidden: false });
    expect(asked[0]).not.toContain("include_hidden");
    expect(payload.rows.map((r) => r.name)).toEqual(["14 #2", "15"]);
  });
});
