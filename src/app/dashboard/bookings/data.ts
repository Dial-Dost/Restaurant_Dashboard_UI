
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
export type BookingDeposit = {
  amount: number;
  status: "pending" | "paid" | "refund_due" | "forfeited";
  payment_id?: string | null;
};

export type Booking = {
  id: string;
  customer: string;
  time: string;
  guests: number;
  table: string;
  source: string;
  status: string;
  notes: string;
  deposit?: BookingDeposit | null;
  // Informational minimum spend (₹) — shown to guest + staff, not enforced.
  min_spend?: number | null;
};
