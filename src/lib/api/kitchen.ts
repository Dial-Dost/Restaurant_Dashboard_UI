"use client";

/**
 * KITCHEN (KDS) DATA LAYER — the module's own fetchers and write actions.
 *
 * WHY NOT db.ts's `getOrders`: its mapper serves the Orders grid and drops the
 * fields the kitchen board reads at the pass — the order-level `note` (the
 * allergy box), `customer_phone` and `delivery_address` (who a delivery ticket
 * is for). GET /orders carries all of them; this mapper keeps them.
 *
 * Every reader here THROWS on failure (with the offline-vs-refusal split
 * `useCachedFetch` expects), and every writer surfaces the server's own words.
 * Mirrors restaurant_owner_app/lib/screens/modules.dart (`_KdsHome`,
 * `_KdsCard`, `_barkOrder`, `_reprintKot`).
 */

import { requestBackend } from "@/lib/db";
import type { BackendRequestResult } from "@/lib/db";
import { refusalSentence } from "@/lib/error-message";
import type { OrderTiming } from "@/lib/order-clock";

/* ── Errors ─────────────────────────────────────────────────────────── */

/**
 * A failed kitchen request. `status === null` means the line was down (the
 * request never reached the server) — which is exactly what
 * `isUnreachableError` in use-cached-fetch reads off the `status` field.
 */
export class KitchenRequestError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "KitchenRequestError";
    this.status = status;
  }
}

const failureMessage = (res: BackendRequestResult, fallback: string): string => {
  const refusal = refusalSentence(res.data);
  if (refusal) { return refusal; }
  if (res.data && typeof res.data === "object") {
    const rec = res.data as Record<string, unknown>;
    for (const key of ["error", "message", "detail"]) {
      const v = rec[key];
      if (typeof v === "string" && v.trim()) { return v; }
    }
  }
  const text = res.text.trim();
  // Never surface a whole HTML error page as a toast.
  if (text && !text.startsWith("<")) { return text.slice(0, 300); }
  return fallback;
};

const unwrap = <T>(res: BackendRequestResult<T>, fallback: string): T | null => {
  if (res.status === 0) {
    throw new KitchenRequestError("Could not reach the server.", null);
  }
  if (!res.ok) {
    throw new KitchenRequestError(failureMessage(res, fallback), res.status);
  }
  return res.data;
};

/* ── Wire readers ───────────────────────────────────────────────────── */

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/* ── Shapes ─────────────────────────────────────────────────────────── */

export interface KitchenOrderItem {
  id: string;
  name: string;
  quantity: number;
  note: string | null;
  /** KOT station routing (enriched from the menu by the backend). */
  station: string | null;
  /** Course hold-and-fire: held items wait (no prep ageing) until fired. */
  course_hold: boolean;
  fired_at: string | null;
  /** The price point's label, snapshotted at order time (for the KOT copy). */
  variation: string | null;
}

export interface KitchenOrder {
  id: string;
  table: string;
  status: string;
  /** dine_in (default) / takeaway / delivery / swiggy / zomato. */
  order_type: string | null;
  customer: string;
  customer_phone: string;
  delivery_address: string;
  /** The order-level instruction — the "** NOTE **" block on the docket. */
  note: string;
  created_at: string | null;
  /**
   * "Barked" step: `undefined` = an older backend never sent the field (assume
   * barked); `null` = waiting to be barked (greyed, idle timers).
   */
  barked_at?: string | null;
  /** Absent = this backend cannot number KOTs — draw nothing. */
  kot_nos?: number[];
  timing: OrderTiming | null;
  items: KitchenOrderItem[];
}

export interface KitchenExpoItem {
  name: string;
  qty: number;
  station: string | null;
  status: "served" | "preparing" | "held" | "unbarked";
}

export interface KitchenExpoTable {
  table: string;
  items: KitchenExpoItem[];
  ready_count: number;
  pending_count: number;
}

const mapKitchenItem = (raw: unknown): KitchenOrderItem => {
  const row = asRecord(raw) ?? {};
  const qty = Number(row.quantity ?? 1);
  return {
    id: str(row.id, `${Date.now()}`),
    name: str(row.name, "Unnamed"),
    quantity: Number.isFinite(qty) ? Math.max(1, qty) : 1,
    note: strOrNull(row.note),
    station: strOrNull(row.station),
    course_hold: row.course_hold === true,
    fired_at: strOrNull(row.fired_at),
    variation: strOrNull(row.variation),
  };
};

const mapKitchenOrder = (raw: unknown): KitchenOrder => {
  const row = asRecord(raw) ?? {};
  const itemsRaw = Array.isArray(row.items)
    ? row.items
    : Array.isArray(row.items_flattened)
      ? row.items_flattened
      : [];
  const kotNos = Array.isArray(row.kot_nos)
    ? (row.kot_nos as unknown[]).map((n) => Number(n)).filter((n) => Number.isFinite(n))
    : undefined;
  return {
    id: str(row.id, `${Date.now()}`),
    table: str(row.table),
    status: str(row.status, "Preparing"),
    order_type: strOrNull(row.order_type),
    customer: str(row.customer, "Guest"),
    customer_phone: str(row.customer_phone),
    delivery_address: str(row.delivery_address),
    note: str(row.note),
    created_at: strOrNull(row.created_at),
    // ABSENT and NULL mean different things: absent = old backend (barked),
    // null = waiting for the bark. Keep the distinction.
    ...("barked_at" in row ? { barked_at: strOrNull(row.barked_at) } : {}),
    ...(kotNos ? { kot_nos: kotNos } : {}),
    timing: asRecord(row.timing) ? (row.timing as OrderTiming) : null,
    items: itemsRaw.map(mapKitchenItem),
  };
};

/* ── Reads ──────────────────────────────────────────────────────────── */

/** Live orders with the kitchen's fields intact. Throws on failure. */
export const getKitchenOrders = async (restaurantId: string): Promise<KitchenOrder[]> => {
  const res = await requestBackend<unknown[]>({
    path: `/orders?restaurantId=${encodeURIComponent(restaurantId)}`,
    method: "GET",
    restaurantId,
  });
  const data = unwrap(res, "Couldn't load kitchen tickets.");
  return Array.isArray(data) ? data.map(mapKitchenOrder) : [];
};

/** The expo/pass consolidation (GET /kds/expo). Throws on failure. */
export const getKitchenExpo = async (restaurantId: string): Promise<KitchenExpoTable[]> => {
  const res = await requestBackend<{ tables?: unknown[] }>({
    path: "/kds/expo",
    method: "GET",
    restaurantId,
  });
  const data = unwrap(res, "Couldn't load the pass.");
  const tables = Array.isArray(data?.tables) ? data.tables : [];
  return tables.map((raw): KitchenExpoTable => {
    const row = asRecord(raw) ?? {};
    const items = Array.isArray(row.items) ? row.items : [];
    return {
      table: str(row.table),
      ready_count: Number(row.ready_count ?? 0) || 0,
      pending_count: Number(row.pending_count ?? 0) || 0,
      items: items.map((it): KitchenExpoItem => {
        const m = asRecord(it) ?? {};
        const status = str(m.status, "preparing");
        return {
          name: str(m.name),
          qty: Number(m.qty ?? 1) || 1,
          station: strOrNull(m.station),
          status:
            status === "served" || status === "held" || status === "unbarked"
              ? status
              : "preparing",
        };
      }),
    };
  });
};

/* ── Writes ─────────────────────────────────────────────────────────── */

const post = async (
  restaurantId: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> => {
  const res = await requestBackend<Record<string, unknown>>({
    path,
    method: "POST",
    restaurantId,
    ...(body !== undefined ? { body } : {}),
  });
  return asRecord(unwrap(res, "Request failed")) ?? {};
};

/** What POST /orders/:id/bark reported back — read, never invented. */
export interface KitchenBarkResult {
  /** The allocated KOT number, when the server sent one. */
  kotNo: string | null;
  /** `null` = the backend never said (older server) — say nothing about paper. */
  kotPrinted: boolean | null;
  /** 'disabled' = auto-print is deliberately off; nothing is wrong. */
  kotSkipped: string | null;
}

export const barkKitchenOrder = async (
  restaurantId: string,
  orderId: string,
): Promise<KitchenBarkResult> => {
  const map = await post(restaurantId, `/orders/${encodeURIComponent(orderId)}/bark`);
  const kotNoRaw = map.kot_no;
  return {
    kotNo:
      typeof kotNoRaw === "number" || (typeof kotNoRaw === "string" && kotNoRaw)
        ? String(kotNoRaw)
        : null,
    kotPrinted: "kot_printed" in map ? map.kot_printed === true : null,
    kotSkipped: strOrNull(map.kot_skipped),
  };
};

/**
 * The bark toast, branched exactly as the app's `_barkOrder`: the KOT number
 * when there is one, and an explicit warning when the docket did not go out.
 * `null` = say nothing (a backend that reported neither).
 */
export const barkFeedbackMessage = (r: KitchenBarkResult): string | null => {
  if (r.kotPrinted === true) {
    return r.kotNo == null ? "Sent to the kitchen." : `Sent to the kitchen - KOT-${r.kotNo}`;
  }
  if (r.kotSkipped === "disabled") { return "Sent to the kitchen."; }
  if (r.kotPrinted === false) {
    return "Sent to the kitchen, but the docket did not print. Use Reprint.";
  }
  return null;
};

export interface KitchenReprintResult {
  kotNo: string | null;
  tickets: number;
}

/**
 * Ask the server for one order's kitchen docket again — a strict reprint that
 * re-resolves the same KOT number (POST /print/kot/order/:id).
 */
export const reprintKitchenDocket = async (
  restaurantId: string,
  orderId: string,
): Promise<KitchenReprintResult> => {
  const map = await post(restaurantId, `/print/kot/order/${encodeURIComponent(orderId)}`);
  const kotNoRaw = map.kot_no;
  const tickets = Number(map.tickets ?? 1);
  return {
    kotNo:
      typeof kotNoRaw === "number" || (typeof kotNoRaw === "string" && kotNoRaw)
        ? String(kotNoRaw)
        : null,
    tickets: Number.isFinite(tickets) && tickets > 0 ? Math.round(tickets) : 1,
  };
};

/** The reprint toast, word for word the app's `_reprintKot`. */
export const reprintFeedbackMessage = (r: KitchenReprintResult): string => {
  const where = r.tickets > 1 ? ` (${r.tickets} station tickets)` : "";
  return r.kotNo == null ? `Docket sent to the printer${where}` : `KOT-${r.kotNo} sent again${where}`;
};

/** PATCH /orders/:id/status — the KDS bump (Mark Served / Back to Preparing). */
export const setKitchenOrderStatus = async (
  restaurantId: string,
  orderId: string,
  status: string,
): Promise<void> => {
  const res = await requestBackend({
    path: `/orders/${encodeURIComponent(orderId)}/status`,
    method: "PATCH",
    restaurantId,
    body: { status },
  });
  unwrap(res, "Unable to update the order stage.");
};

/** Order-level Hold / Resume (POST /orders/:id/pause | /resume). */
export const setKitchenOrderPaused = async (
  restaurantId: string,
  orderId: string,
  paused: boolean,
): Promise<void> => {
  await post(restaurantId, `/orders/${encodeURIComponent(orderId)}/${paused ? "pause" : "resume"}`);
};

/** Per-item pause / resume (POST /orders/:id/items/:iid/pause | /resume). */
export const setKitchenItemPaused = async (
  restaurantId: string,
  orderId: string,
  itemId: string,
  paused: boolean,
): Promise<void> => {
  await post(
    restaurantId,
    `/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(itemId)}/${paused ? "pause" : "resume"}`,
  );
};

/**
 * Serve one item. `undo=0` states the intent instead of letting the server
 * infer it from state, so an offline-queued serve replayed later can never
 * flip into an un-serve.
 */
export const serveKitchenItem = async (
  restaurantId: string,
  orderId: string,
  itemId: string,
): Promise<void> => {
  await post(
    restaurantId,
    `/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(itemId)}/serve?undo=0`,
  );
};

/** Undo a mis-tapped serve (POST .../unserve — always explicit). */
export const unserveKitchenItem = async (
  restaurantId: string,
  orderId: string,
  itemId: string,
): Promise<void> => {
  await post(
    restaurantId,
    `/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(itemId)}/unserve`,
  );
};

/** Fire held course items: stamps fired_at and starts their prep timers. */
export const fireKitchenItems = async (
  restaurantId: string,
  orderId: string,
  itemIds: string[],
): Promise<void> => {
  await post(restaurantId, `/orders/${encodeURIComponent(orderId)}/fire`, { item_ids: itemIds });
};

/* ── Pure helpers the board shares ──────────────────────────────────── */

/** Missing field (older backend) counts as barked, exactly as the app reads it. */
export const isKitchenOrderBarked = (o: KitchenOrder): boolean =>
  !("barked_at" in o) || o.barked_at !== null;

export const isKitchenOrderCancelled = (o: KitchenOrder): boolean =>
  o.status.trim().toLowerCase() === "cancelled";

/**
 * "KOT 214" / "KOTs 214, 218" — the handle the kitchen calls a ticket by.
 * "" when the backend sent nothing: draw NOTHING rather than a placeholder.
 */
export const kitchenKotLabel = (o: KitchenOrder): string => {
  const raw = o.kot_nos;
  if (!Array.isArray(raw)) { return ""; }
  const seen = new Set<number>();
  const nos: string[] = [];
  for (const entry of raw) {
    if (!Number.isFinite(entry) || entry <= 0) { continue; }
    const v = Math.round(entry);
    if (seen.has(v)) { continue; }
    seen.add(v);
    nos.push(String(v));
  }
  if (nos.length === 0) { return ""; }
  return `${nos.length === 1 ? "KOT" : "KOTs"} ${nos.join(", ")}`;
};

/** The trimmed terminal caption a cancelled ticket carries in place of actions. */
export const CANCELLED_TICKET_CAPTION =
  "Cancelled — final. Reverse it from the Audit Log if this was a mistake.";
