// Shared reading helpers for the Bookings module — the web spellings of the
// Flutter helpers the module leans on (`_fmtDmy`, `bookingColor`,
// `_seatsLabel`, `initialsOf`, `_strList` joins).

import { formatDate, formatTime } from "@/lib/tz";
import type { StatusChipStatus } from "@/components/ui/status-chip";
import type { BookingRow } from "@/lib/api/bookings";

/** `dd/mm/yy · HH:mm` in the restaurant's zone — the reservation stamp. */
export const fmtDmy = (iso: string | null | undefined, timeZone: string): string => {
  if (!iso) { return ""; }
  const day = formatDate(iso, timeZone, "");
  const clock = formatTime(iso, timeZone, "");
  return day && clock ? `${day} · ${clock}` : day || clock;
};

/** A booking's status word, with the Flutter read-site fallback. */
export const statusOf = (booking: BookingRow): string => booking.status || "Requested";

/**
 * Booking-stage ink (Flutter `bookingColor`) — always paired with the
 * labelled StatusChip, never colour alone. `color` (the copper accent for
 * seated) wins over `status` at the chip, mirroring StatusChip's own API.
 */
export const bookingStatusChip = (
  status: string,
): { status?: StatusChipStatus; color?: string } => {
  const l = status.toLowerCase();
  if (l.includes("confirm")) { return { status: "success" }; }
  if (l.includes("seat")) { return { color: "hsl(var(--primary))" }; }
  if (l.includes("cancel") || l.includes("no")) { return { status: "danger" }; }
  if (l.includes("request") || l.includes("pend")) { return { status: "warning" }; }
  return { status: "neutral" };
};

/** Every table the booking holds, primary first, read as "T1 + T2". */
export const tableLabelOf = (booking: BookingRow): string =>
  booking.table_names.length > 0 ? booking.table_names.join(" + ") : booking.table_name;

export const isClubbed = (booking: BookingRow): boolean => booking.table_names.length > 1;

export const isOnline = (booking: BookingRow): boolean =>
  booking.source.toLowerCase() === "online";

export const isRequested = (booking: BookingRow): boolean =>
  statusOf(booking).toLowerCase() === "requested";

/** "LJ" for "Liam Johnson", "L" for "Liam", "?" for nothing. */
export const initialsOf = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter((s) => s.length > 0);
  if (parts.length === 0) { return "?"; }
  return parts.length === 1
    ? parts[0].slice(0, 1)
    : `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`;
};

/**
 * Seat read-out for a table row: "4 seats", or "4 seats · max 6" when extra
 * chairs push it further (Flutter `_seatsLabel`).
 */
export const seatsLabel = (table: { capacity?: number | null; max_capacity?: number | null }): string => {
  const cap = typeof table.capacity === "number" && Number.isFinite(table.capacity) ? table.capacity : null;
  const max = typeof table.max_capacity === "number" && Number.isFinite(table.max_capacity) ? table.max_capacity : cap;
  if (cap == null) { return max == null ? "" : `max ${max}`; }
  return max != null && max > cap ? `${cap} seats · max ${max}` : `${cap} seats`;
};
