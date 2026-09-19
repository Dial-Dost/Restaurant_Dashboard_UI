// Types shared with src/lib/db.ts (`getBookings`) and the bookings components.
// The demo `initialBookings` seed rows died with the table layout — every row
// on the page now comes from GET /get-bookings.

// Reservation deposit as returned inside /get-bookings rows (lives in the
// booking's slot JSON server-side). refund_due/forfeited are set on cancel.
export interface BookingDeposit {
  amount: number;
  status: "pending" | "paid" | "refund_due" | "forfeited";
  payment_id?: string | null;
}

export interface Booking {
  id: string;
  customer: string;
  /**
   * Customers row this booking belongs to. /get-bookings carries no phone
   * number, so the contact is joined in from /get-customers on this id.
   */
  customer_id?: string | null;
  /** Localized display string. */
  time: string;
  /** Raw ISO start of the booking window, when the backend supplied one. */
  date_time?: string | null;
  /** Length of the reserved window in minutes (backend default: 120). */
  duration_mins?: number | null;
  guests: number;
  /** Primary table only — kept for existing call sites. */
  table: string;
  /** Every table the booking holds, primary first. Longer than 1 = clubbed. */
  table_names?: string[];
  source: string;
  /** Surface the booking was taken on ("qr", "dashboard", …). */
  booked_from?: string | null;
  status: string;
  notes: string;
  deposit?: BookingDeposit | null;
  // Informational minimum spend (₹) — shown to guest + staff, not enforced.
  min_spend?: number | null;
}
