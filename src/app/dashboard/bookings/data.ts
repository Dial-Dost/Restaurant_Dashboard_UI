
export const initialBookings = [
  {
    id: "1",
    customer: "Liam Johnson",
    time: "19:00",
    guests: 2,
    table: "T2",
    source: "Dineout",
    status: "Confirmed",
    notes: "Birthday - vegan preference",
  },
  {
    id: "2",
    customer: "Olivia Smith",
    time: "19:15",
    guests: 4,
    table: "T6",
    source: "Call",
    status: "Arrived",
    notes: "Window seat",
  },
  {
    id: "3",
    customer: "Noah Williams",
    time: "20:00",
    guests: 2,
    table: "T8",
    source: "Easydiner",
    status: "Confirmed",
    notes: "Allergic to peanuts",
  },
  {
    id: "4",
    customer: "Emma Brown",
    time: "20:30",
    guests: 3,
    table: "T4",
    source: "Walk-in",
    status: "Seated",
    notes: "Anniversary",
  },
  {
    id: "5",
    customer: "James Jones",
    time: "21:00",
    guests: 5,
    table: "T9",
    source: "Call",
    status: "Pending",
    notes: "",
  },
];

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
