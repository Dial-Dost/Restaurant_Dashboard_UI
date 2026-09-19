// Bookings module fetchers — the web half of the Flutter `_BookingsView`
// (restaurant_owner_app/lib/screens/modules.dart ~17094).
//
// These deliberately bypass db.ts's silent local-storage fallback for
// /get-bookings: `useCachedFetch` owns caching and staleness on this page, so
// a failure must THROW (offline throws a TypeError, a refusal throws the
// server's own sentence) instead of quietly answering yesterday's rows.

import { requestBackend } from "@/lib/db";
import { refusalSentence } from "@/lib/error-message";
import type { BookingDeposit } from "@/app/dashboard/bookings/data";

export type BookingWindow = "upcoming" | "past" | "all";

/**
 * One /get-bookings row, in the backend's own vocabulary — the same fields the
 * Flutter module reads (`booking_id`, `customer_name`, `booking_date_time`,
 * `table_names`, …) rather than the renamed shape db.ts invents.
 */
export interface BookingRow {
  booking_id: string;
  customer_id: string | null;
  customer_name: string;
  /** Straight off the row when the backend supplies it (the Flutter app's
   *  source); older backends omit it and the page joins /get-customers. */
  customer_phone: string;
  booking_date_time: string | null;
  duration_mins: number | null;
  number_of_people: number | null;
  table_name: string;
  /** Every table the booking holds, primary first. Longer than 1 = clubbed. */
  table_names: string[];
  source: string;
  status: string;
  notes: string;
  /** Surface the booking was taken on ("qr", "dashboard", …) — web-extra. */
  booked_from: string | null;
  deposit: BookingDeposit | null;
  min_spend: number | null;
}

/** A /get-tables row as the plain assign picker needs it (occupancy only). */
export interface RoomTable {
  table_name: string;
  occupied: boolean;
}

const asInt = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number.parseFloat(typeof v === "string" ? v : "");
  return Number.isFinite(n) ? Math.round(n) : null;
};

const asStr = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((e: unknown) => asStr(e)).filter((e) => e.length > 0) : [];

/**
 * Turn a failed `requestBackend` result into the throw `useCachedFetch`
 * expects: status 0 (fetch never reached the server) throws a TypeError so
 * `isUnreachableError` reads it as an outage; anything else throws the
 * server's sentence (`details` first) as a refusal.
 */
const throwBackendError = (status: number, text: string, fallback: string): never => {
  if (status === 0) {
    throw new TypeError("Failed to fetch");
  }
  let message = "";
  try {
    message = refusalSentence(JSON.parse(text)) ?? "";
  } catch {
    /* not JSON — the raw body is the best we have */
  }
  if (!message) {
    message = text.trim() || fallback;
  }
  throw Object.assign(new Error(message), { status });
};

const mapBookingRow = (item: Record<string, unknown>): BookingRow => ({
  booking_id: asStr(item.booking_id ?? item.id),
  customer_id: asStr(item.customer_id) || null,
  customer_name: asStr(item.customer_name) || "Guest",
  customer_phone: asStr(item.customer_phone),
  booking_date_time: asStr(item.booking_date_time) || null,
  duration_mins: (asInt(item.duration_mins) ?? 0) > 0 ? asInt(item.duration_mins) : null,
  number_of_people: asInt(item.number_of_people),
  table_name: asStr(item.table_name),
  table_names: strList(item.table_names).length > 0
    ? strList(item.table_names)
    : (asStr(item.table_name) ? [asStr(item.table_name)] : []),
  source: asStr(item.source),
  status: asStr(item.status),
  notes: asStr(item.notes ?? item.additional_information),
  booked_from: asStr(item.from) || null,
  deposit: item.deposit && typeof item.deposit === "object" ? (item.deposit as BookingDeposit) : null,
  min_spend: (asInt(item.min_spend) ?? 0) > 0 ? asInt(item.min_spend) : null,
});

/** GET /get-bookings?window= — upcoming (default) / past / all. Throws. */
export const fetchBookings = async (
  restaurantId: string,
  windowView: BookingWindow,
): Promise<BookingRow[]> => {
  const response = await requestBackend<unknown[]>({
    path: `/get-bookings?restaurantId=${encodeURIComponent(restaurantId)}&window=${encodeURIComponent(windowView)}`,
    method: "GET",
    restaurantId,
  });
  if (!response.ok) {
    throwBackendError(response.status, response.text, "Couldn't load bookings.");
  }
  return (Array.isArray(response.data) ? response.data : []).map((item) =>
    mapBookingRow((item ?? {}) as Record<string, unknown>),
  );
};

/**
 * GET /get-tables for the plain assign picker — the ROOM's tables only:
 * next-party seats ("12 #2", rows with a `parent_table`) exist while the
 * root's bill is unpaid and the server refuses a booking on one (Flutter
 * `_pickTable` + `isNextPartyRow`).
 */
export const fetchRoomTables = async (restaurantId: string): Promise<RoomTable[]> => {
  const response = await requestBackend<unknown[]>({
    path: `/get-tables?restaurantId=${encodeURIComponent(restaurantId)}`,
    method: "GET",
    restaurantId,
  });
  if (!response.ok) {
    throwBackendError(response.status, response.text, "Couldn't load tables.");
  }
  return (Array.isArray(response.data) ? response.data : [])
    .map((item) => (item ?? {}) as Record<string, unknown>)
    .filter((item) => !asStr(item.parent_table).trim())
    .map((item) => ({
      table_name: asStr(item.table_name),
      occupied: item.occupied === true,
    }))
    .filter((t) => t.table_name.length > 0);
};

/** PATCH /booking/:id/status — Confirmed / Seated / Cancelled. Throws. */
export const setBookingStatus = async (
  restaurantId: string,
  bookingId: string,
  status: string,
): Promise<void> => {
  const response = await requestBackend({
    path: `/booking/${encodeURIComponent(bookingId)}/status`,
    method: "PATCH",
    restaurantId,
    body: { status },
  });
  if (!response.ok) {
    throwBackendError(response.status, response.text, "Couldn't update the booking.");
  }
};

/** DELETE /booking/:id — the confirmed hard delete. Throws. */
export const deleteBookingById = async (
  restaurantId: string,
  bookingId: string,
): Promise<void> => {
  const response = await requestBackend({
    path: `/booking/${encodeURIComponent(bookingId)}`,
    method: "DELETE",
    restaurantId,
  });
  if (!response.ok) {
    throwBackendError(response.status, response.text, "Couldn't delete the booking.");
  }
};

export interface CreateBookingInput {
  name: string;
  /** Bare 10 digits — normalised by the form, same rule the server enforces. */
  phone: string;
  party: number;
  /** ISO instant of the reservation start. */
  atIso: string;
  /** Optional free-text channel; omitted from the POST when empty. */
  source: string;
  /** Chosen tables, primary first — a table is mandatory (suggester-driven). */
  tableNames: string[];
}

/**
 * POST /add-booking with the Flutter dialog's exact body — customer{name,
 * number} + booking{table_name, combined_table_names?, date, duration,
 * number_of_people, source?}. No forced status, no origin tag, no notes: the
 * backend defaults the status, exactly as it does for the app.
 */
export const createBooking = async (
  restaurantId: string,
  input: CreateBookingInput,
): Promise<void> => {
  const response = await requestBackend({
    path: "/add-booking",
    method: "POST",
    restaurantId,
    body: {
      customer: { name: input.name, number: input.phone },
      booking: {
        table_name: input.tableNames[0],
        ...(input.tableNames.length > 1
          ? { combined_table_names: input.tableNames.slice(1) }
          : {}),
        date: input.atIso,
        duration: "120",
        number_of_people: `${input.party}`,
        ...(input.source ? { source: input.source } : {}),
      },
    },
  });
  if (!response.ok) {
    throwBackendError(response.status, response.text, "Couldn't create the booking.");
  }
};
