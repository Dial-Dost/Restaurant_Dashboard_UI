// Pure shaping helpers for the Guest book — the web copies of the customer
// readers in restaurant_owner_app/lib/screens/modules.dart (~15735–15773) and
// the `RestaurantTime.day` formatter the cards and sheet render dates with.

import type { GuestRow, GuestSortKey } from "@/lib/api/customers";

/** The three ways the guest book can be ranked — server sort key + the label
 *  the owner reads (`_customerSorts`). */
export const CUSTOMER_SORTS: readonly { key: GuestSortKey; label: string }[] = [
  { key: "recent", label: "Most recent" },
  { key: "spend", label: "Most spent" },
  { key: "visits", label: "Most visited" },
];

export type CustomerSegmentKey = "all" | "new" | "regular" | "high-spend" | "dormant";

/** The server's own segmentation (`_customerSegments`). */
export const CUSTOMER_SEGMENTS: readonly { key: CustomerSegmentKey; label: string }[] = [
  { key: "all", label: "All guests" },
  { key: "new", label: "New" },
  { key: "regular", label: "Regular" },
  { key: "high-spend", label: "High spend" },
  { key: "dormant", label: "Dormant" },
];

export const customerSortLabel = (key: string): string =>
  CUSTOMER_SORTS.find((s) => s.key === key)?.label ?? "";

export const customerSegmentLabel = (key: string): string =>
  CUSTOMER_SEGMENTS.find((s) => s.key === key)?.label ?? "";

/** `_guestInitials`: first letter of the first and last word ("?" for none). */
export const guestInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter((s) => s.length > 0);
  if (parts.length === 0) { return "?"; }
  if (parts.length === 1) { return parts[0].slice(0, 1); }
  return `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const BARE_WALL = /^(\d{4})-(\d{2})-(\d{2})[T ]\d{2}:\d{2}/;
const HAS_ZONE = /(?:[Zz]|[+-]\d{2}:?\d{2})$/;

const monthDay = (month: number, day: number): string =>
  month >= 1 && month <= 12 ? `${MONTHS[month - 1]} ${day}` : "";

/**
 * `Jun 26` — a day with no time of day (`RestaurantTime.day`), rendered in the
 * RESTAURANT's zone. Three input shapes, matching what the backend emits:
 * a bare `YYYY-MM-DD` is already a restaurant-side date (converting it would
 * slide it a day); a zoneless wall clock's fields are the answer as written;
 * only an absolute instant is converted into the restaurant zone.
 */
export const fmtGuestDay = (iso: string, timezone: string): string => {
  const s = iso.trim();
  if (s === "") { return ""; }
  const dateOnly = DATE_ONLY.exec(s);
  if (dateOnly) {
    return monthDay(Number(dateOnly[2]), Number(dateOnly[3])) || s;
  }
  if (BARE_WALL.test(s) && !HAS_ZONE.test(s)) {
    const m = BARE_WALL.exec(s);
    return m ? monthDay(Number(m[2]), Number(m[3])) || s : s;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) { return s; }
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? "");
    return monthDay(get("month"), get("day")) || s;
  } catch {
    return monthDay(d.getMonth() + 1, d.getDate()) || s;
  }
};

/**
 * `_customerRankValue`: the ONE figure a ranking is about, so a "most spent"
 * list is never headed by a number that came from a different measure.
 */
export const customerRankValue = (
  row: GuestRow,
  sort: string,
  money: (v: unknown) => string,
  timezone: string,
): string => {
  if (sort === "spend") { return money(row.total_spend); }
  if (sort === "visits") { return `${row.visits} visit${row.visits === 1 ? "" : "s"}`; }
  return row.last_visit === "" ? "never" : fmtGuestDay(row.last_visit, timezone);
};
