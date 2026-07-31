
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
}
