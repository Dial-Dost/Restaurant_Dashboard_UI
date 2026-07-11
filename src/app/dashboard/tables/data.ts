
export type Table = {
  id: number;
  name: string;
  capacity: number;
  status: "Available" | "Reserved" | "Booked" | "Occupied";
  // Signed QR token from /get-tables — builds customer-facing URLs (/order, /cfd).
  qr_token?: string | null;
};
