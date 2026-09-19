// Customers (Guest book) fetchers — the web half of the Flutter
// `_CustomersView` (restaurant_owner_app/lib/screens/modules.dart ~15784).
//
// EVERY ranking and every page comes from GET /customers/segments, which
// sorts, segments, searches and pages in SQL. Re-sorting a loaded page in the
// client would produce a "most spent" list that is really "most spent among
// the first fifty", and it would start lying the moment a restaurant has more
// guests than one page — so nothing here re-orders what the server returned.
//
// These throw on failure (offline throws a TypeError, a refusal throws the
// server's own sentence) so `useCachedFetch` can split outage from refusal —
// the same contract as src/lib/api/bookings.ts.

import { requestBackend } from "@/lib/db";
import { refusalSentence } from "@/lib/error-message";

/** Pages of 50, exactly like the app (`_pageSize`). */
export const GUEST_PAGE_SIZE = 50;
/** How many names a leaderboard card shows (`_leaderSize`). */
export const GUEST_LEADER_SIZE = 5;

/** The server's three sort keys (`_customerSorts` first column). */
export const GUEST_SORT_KEYS = ["recent", "spend", "visits"] as const;
export type GuestSortKey = (typeof GUEST_SORT_KEYS)[number];

/**
 * One /customers/segments row, in the backend's own vocabulary — the exact
 * fields the Flutter screen reads. Money fields stay `number | null` so a
 * value the server omitted renders as "—", never as zero takings.
 */
export interface GuestRow {
  customer_id: string;
  name: string;
  phone: string;
  email: string;
  visits: number;
  total_spend: number | null;
  total_service_charge: number | null;
  total_tax: number | null;
  pre_tax_spend: number | null;
  avg_spend_per_visit: number | null;
  /** `YYYY-MM-DD` (restaurant-side day) or '' when the guest never visited. */
  last_visit: string;
  days_since_last_visit: number | null;
  bills: number;
  /** Live off the Bookings table on every read — a booking made a second ago
   *  already counts. */
  bookings_made: number;
  avg_rating: number | null;
  feedbacks: number;
  /** new | regular | high-spend | dormant ('' when the server sent none). */
  segment: string;
}

/** The `?meta=1` envelope of one page. */
export interface GuestSegmentsPage {
  customers: GuestRow[];
  total: number;
  has_more: boolean;
  /** Which segment the server filtered THIS response by ('all' when none) —
   *  the guard that keeps segment_counts honest. */
  segment: string;
  /** Per-segment counts over the set AFTER the server's segment filter, so
   *  only an unsegmented response's counts describe the whole book. */
  segment_counts: Record<string, number>;
  /** The footnote sentence explaining what "spend" is computed from. */
  spend_basis: string;
}

/** The three server-ranked leaderboards. A ranking that could not be built
 *  reports WHY in `failed` — it must never fall back to an empty list, which
 *  reads identically to "no guests match" and would hide a broken endpoint. */
export interface GuestLeaders {
  out: Partial<Record<GuestSortKey, GuestRow[]>>;
  failed: Partial<Record<GuestSortKey, string>>;
}

const asStr = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";

const asNum = (v: unknown): number | null => {
  if (typeof v === "number") { return Number.isFinite(v) ? v : null; }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const asInt = (v: unknown): number | null => {
  const n = asNum(v);
  return n == null ? null : Math.round(n);
};

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

const mapGuest = (item: Record<string, unknown>): GuestRow => ({
  customer_id: asStr(item.customer_id),
  name: asStr(item.name) || "Guest",
  phone: asStr(item.phone),
  email: asStr(item.email),
  visits: asInt(item.visits) ?? 0,
  total_spend: asNum(item.total_spend),
  total_service_charge: asNum(item.total_service_charge),
  total_tax: asNum(item.total_tax),
  pre_tax_spend: asNum(item.pre_tax_spend),
  avg_spend_per_visit: asNum(item.avg_spend_per_visit),
  last_visit: asStr(item.last_visit),
  days_since_last_visit: asInt(item.days_since_last_visit),
  bills: asInt(item.bills) ?? 0,
  bookings_made: asInt(item.bookings_made) ?? 0,
  avg_rating: asNum(item.avg_rating),
  feedbacks: asInt(item.feedbacks) ?? 0,
  segment: asStr(item.segment),
});

export interface GuestQuery {
  sort: string;
  /** 'all' sends no segment param, exactly like the app (`_query4`). */
  segment: string;
  /** Already trimmed by the search field; '' sends no param. */
  search: string;
}

/** The app's `_query4`, verbatim: limit/offset/sort, then meta, segment, search. */
const segmentsPath = (
  q: GuestQuery,
  limit: number,
  offset: number,
  meta: boolean,
): string =>
  `/customers/segments?limit=${limit}&offset=${offset}&sort=${encodeURIComponent(q.sort)}` +
  (meta ? "&meta=1" : "") +
  (q.segment === "all" ? "" : `&segment=${encodeURIComponent(q.segment)}`) +
  (q.search === "" ? "" : `&search=${encodeURIComponent(q.search)}`);

/**
 * One page (50) of the guest book under the given filters, with the `meta=1`
 * envelope. Throws — the caller owns skeleton/error/offline states.
 */
export const fetchGuestPage = async (
  restaurantId: string,
  query: GuestQuery,
  offset: number,
): Promise<GuestSegmentsPage> => {
  const response = await requestBackend<Record<string, unknown>>({
    path: segmentsPath(query, GUEST_PAGE_SIZE, offset, true),
    method: "GET",
    restaurantId,
  });
  if (!response.ok) {
    throwBackendError(response.status, response.text, "Couldn't load the guest book.");
  }
  const body = response.data ?? {};
  const customers = (Array.isArray(body.customers) ? body.customers : []).map((item: unknown) =>
    mapGuest((item ?? {}) as Record<string, unknown>),
  );
  const counts: Record<string, number> = {};
  if (body.segment_counts != null && typeof body.segment_counts === "object") {
    for (const [key, value] of Object.entries(body.segment_counts as Record<string, unknown>)) {
      counts[key] = asInt(value) ?? 0;
    }
  }
  return {
    customers,
    // The app's `_applyPage`: `_total = _int(res['total']) ?? _rows.length`.
    total: asInt(body.total) ?? customers.length,
    has_more: body.has_more === true,
    segment: asStr(body.segment) || "all",
    segment_counts: counts,
    spend_basis: asStr(body.spend_basis),
  };
};

/**
 * The three server-ranked top-5 reads over the SAME segment and search as the
 * list (`_fetchLeaders`): three parallel requests, each caught on its own so
 * one failure costs one card and the card can say why. Never throws.
 */
export const fetchGuestLeaders = async (
  restaurantId: string,
  query: Omit<GuestQuery, "sort">,
): Promise<GuestLeaders> => {
  const out: GuestLeaders["out"] = {};
  const failed: GuestLeaders["failed"] = {};
  await Promise.all(
    GUEST_SORT_KEYS.map(async (sortKey) => {
      try {
        const response = await requestBackend<unknown[]>({
          path: segmentsPath({ ...query, sort: sortKey }, GUEST_LEADER_SIZE, 0, false),
          method: "GET",
          restaurantId,
        });
        if (!response.ok) {
          throwBackendError(response.status, response.text, "Couldn't rank the guest book.");
        }
        out[sortKey] = (Array.isArray(response.data) ? response.data : []).map((item: unknown) =>
          mapGuest((item ?? {}) as Record<string, unknown>),
        );
      } catch (e) {
        failed[sortKey] = e instanceof Error ? e.message : String(e);
      }
    }),
  );
  return { out, failed };
};
