
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
}
