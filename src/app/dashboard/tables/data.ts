
import type { BillPrintState } from '@/lib/bill-print-state';

export interface Table {
  id: number;
  name: string;
  capacity: number;
  // The most this table can seat with extra chairs pulled up. Defaults to
  // `capacity` when the owner has not set a separate maximum.
  max_capacity: number;
  status: "Available" | "Reserved" | "Booked" | "Occupied";
  // Floor zone this table sits in (`Tables.section`), null/absent = unassigned.
  // The SERVER owns which section a table is in; the browser only remembers the
  // order the cards are shown in. Merged in from the raw /get-tables row.
  section?: string | null;
  // Signed QR token from /get-tables — builds customer-facing URLs (/order, /cfd).
  qr_token?: string | null;
  // Per-table 4-digit order OTP (present only while occupied + gate enabled) —
  // staff read it out to the guest so they can enter it on the QR order page.
  order_otp?: string | null;
  // Whether the restaurant's per-table OTP gate is ON (`require_table_otp`).
  // Clients KEY ON THIS to decide whether to render an OTP chip at all — with
  // the gate off the backend also nulls `order_otp`, so a stale code from an
  // earlier ON period can never leak back into the grid.
  otp_required?: boolean;
  // C3 — HAS THIS SEATING'S BILL BEEN PRINTED? The server's own answer, off the
  // /get-tables row: `bill_print_state.ts` ships `print_count`,
  // `bill_printed_at` and `printed_at` on the TABLE LIST as well as on
  // /bill-for-table, in the same three spellings, precisely so a client needs no
  // second code path and no per-device memory.
  //
  // `undefined`/null means the payload carried NONE of those keys — a backend
  // older than the fields, not "not printed". The distinction is load-bearing
  // and is why this is one nullable object rather than three loose fields that
  // would each have to default to something; see `serverBillPrintState`.
  bill_print?: BillPrintState | null;
  // CLIENT ITEM 6 — the next party at a printed table (src/lib/next-party.ts).
  // `parent_table` is the root's name when this row is the SEAT the server
  // opened beside a printed table ("12 #2" -> "12"), null on every room table;
  // `party_no` is its party number; `display_name` is what a tile prints big.
  // A separate table for money, always: only labels ever fold into the root.
  // Absent on a backend older than migration 053, which is "a room table".
  parent_table?: string | null;
  party_no?: number | null;
  display_name?: string;
  // CLIENT ITEMS 1 AND 2 — has anything been ORDERED here yet? Seated-but-not-
  // ordered and running are different colours on the floor (src/lib/floor-state.ts).
  // Absent on a backend older than the field.
  has_order?: boolean;
}
