
export const initialBookings = [
  {
    id: "1",
    customer: "Liam Johnson",
    time: "19:00",
    guests: 2,
    table: "T2",
    source: "Dineout",
    status: "Confirmed",
  },
  {
    id: "2",
    customer: "Olivia Smith",
    time: "19:15",
    guests: 4,
    table: "T6",
    source: "Call",
    status: "Arrived",
  },
  {
    id: "3",
    customer: "Noah Williams",
    time: "20:00",
    guests: 2,
    table: "T8",
    source: "Easydiner",
    status: "Confirmed",
  },
  {
    id: "4",
    customer: "Emma Brown",
    time: "20:30",
    guests: 3,
    table: "T4",
    source: "Walk-in",
    status: "Seated",
  },
  {
    id: "5",
    customer: "James Jones",
    time: "21:00",
    guests: 5,
    table: "T9",
    source: "Call",
    status: "Pending",
  },
];

export type Booking = (typeof initialBookings)[0];
