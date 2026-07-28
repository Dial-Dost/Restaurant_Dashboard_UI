
export interface Table {
  id: number;
  name: string;
  capacity: number;
  // The most this table can seat with extra chairs pulled up. Defaults to
  // `capacity` when the owner has not set a separate maximum.
  max_capacity: number;
  status: "Available" | "Reserved" | "Booked" | "Occupied";
  // Signed QR token from /get-tables — builds customer-facing URLs (/order, /cfd).
  qr_token?: string | null;
  // Per-table 4-digit order OTP (present only while occupied + gate enabled) —
  // staff read it out to the guest so they can enter it on the QR order page.
  order_otp?: string | null;
}
