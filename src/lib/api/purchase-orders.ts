// Purchase Orders module fetchers — the web half of Flutter's
// `_PurchaseOrdersView` (restaurant_owner_app/lib/screens/modules.dart
// 26671–27193).
//
// The GET side deliberately bypasses db.ts's silent fallbacks:
//  - the orders read must THROW on failure (parity finding 23 — a failed load
//    must never masquerade as an empty outlet), where db.ts's
//    `getPurchaseOrders` quietly answers `[]`;
//  - the inventory read's failure is captured SEPARATELY as a string (finding
//    11 — "New PO" tells a failed read apart from a genuinely empty stock
//    list), mirroring Flutter `_fetch`'s `_inventoryError`;
//  - vendors stay best-effort (both clients degrade them to an empty list).
//
// Writes post the same minimal bodies the Flutter app does — creation sends
// only `{vendor_id?, items, status}` (finding 29: no client-resolved
// vendor_name, no notes/expected_date).

import { getVendors, requestBackend } from "@/lib/db";
import { refusalSentence } from "@/lib/error-message";

/** One PO line as GET /purchase-orders returns it. */
export interface PurchaseOrderLine {
  inventory_id: string;
  name: string;
  qty_ordered: number;
  unit_cost: number;
  qty_received: number;
}

/**
 * One /purchase-orders record, numbers coerced. `GET /purchase-orders` already
 * returns the same record `GET /purchase-orders/:id` does, so the detail sheet
 * reads the row in hand rather than fetching again (Flutter `_openPo`).
 */
export interface PurchaseOrderRecord {
  id: string;
  vendor_id: string | null;
  vendor_name: string | null;
  /** 'draft' | 'ordered' | 'received' | 'cancelled' — rendered as given. */
  status: string;
  items: PurchaseOrderLine[];
  total_cost: number | null;
  notes: string;
  expected_date: string;
  created_at: string;
  created_by: string;
  ordered_at: string;
  received_at: string;
  quality_rating: number | null;
}

export interface PoVendor {
  id: string;
  name: string;
}

/** The slice of an inventory row a PO line needs (id + name — Flutter's
 *  create dialog shows plain item names, finding 13). */
export interface PoInventoryItem {
  id: string;
  name: string;
}

/** A line being drafted in the New-PO dialog (the POST body's `items[]`). */
export interface NewPoLine {
  inventory_id: string;
  name: string;
  qty_ordered: number;
  unit_cost: number;
}

/**
 * The screen's whole GET composition, side-effect free and JSON-serialisable —
 * `useCachedFetch` replays it from the persisted cache at boot exactly like
 * Flutter's `CachePrimedScreen` replays `_fetch`.
 */
export interface PurchaseOrdersPayload {
  orders: PurchaseOrderRecord[];
  vendors: PoVendor[];
  inventory: PoInventoryItem[];
  /** Why the inventory read came back empty-handed when it FAILED rather than
   *  genuinely holding nothing. "New PO" needs the difference. */
  inventoryError: string | null;
}

const asStr = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";

const asNum = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number.parseFloat(typeof v === "string" ? v : "");
  return Number.isFinite(n) ? n : 0;
};

const asNumOrNull = (v: unknown): number | null => {
  if (v == null || v === "") { return null; }
  const n = typeof v === "number" ? v : Number.parseFloat(typeof v === "string" ? v : "");
  return Number.isFinite(n) ? n : null;
};

/**
 * Turn a failed `requestBackend` result into the throw `useCachedFetch`
 * expects: status 0 (fetch never reached the server) throws a TypeError so
 * `isUnreachableError` reads it as an outage; anything else throws the
 * server's own sentence as a refusal.
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

const mapLine = (raw: Record<string, unknown>): PurchaseOrderLine => ({
  inventory_id: asStr(raw.inventory_id),
  name: asStr(raw.name) || "Item",
  qty_ordered: asNum(raw.qty_ordered),
  unit_cost: asNum(raw.unit_cost),
  qty_received: asNum(raw.qty_received),
});

const mapOrder = (raw: Record<string, unknown>): PurchaseOrderRecord => ({
  id: asStr(raw.id),
  vendor_id: asStr(raw.vendor_id) || null,
  vendor_name: asStr(raw.vendor_name) || null,
  status: asStr(raw.status) || "draft",
  items: (Array.isArray(raw.items) ? raw.items : [])
    .map((item: unknown) => mapLine((item ?? {}) as Record<string, unknown>)),
  total_cost: asNumOrNull(raw.total_cost),
  notes: asStr(raw.notes),
  expected_date: asStr(raw.expected_date),
  created_at: asStr(raw.created_at),
  created_by: asStr(raw.created_by),
  ordered_at: asStr(raw.ordered_at),
  received_at: asStr(raw.received_at),
  quality_rating: asNumOrNull(raw.quality_rating),
});

/** GET /purchase-orders — always the full list (Flutter has no status filter). Throws. */
const fetchOrders = async (restaurantId: string): Promise<PurchaseOrderRecord[]> => {
  const response = await requestBackend<{ orders?: unknown[] }>({
    path: `/purchase-orders?restaurantId=${encodeURIComponent(restaurantId)}`,
    method: "GET",
    restaurantId,
  });
  if (!response.ok) {
    throwBackendError(response.status, response.text, "Could not load purchase orders");
  }
  const rows = Array.isArray(response.data?.orders) ? response.data.orders : [];
  return rows.map((row: unknown) => mapOrder((row ?? {}) as Record<string, unknown>));
};

/** GET /inventory, throwing — the caller captures the error as a string. */
const fetchInventoryItems = async (restaurantId: string): Promise<PoInventoryItem[]> => {
  const response = await requestBackend<unknown[]>({
    path: `/inventory?restaurantId=${encodeURIComponent(restaurantId)}`,
    method: "GET",
    restaurantId,
  });
  if (!response.ok) {
    throwBackendError(response.status, response.text, "Could not load inventory");
  }
  return (Array.isArray(response.data) ? response.data : [])
    .map((item: unknown) => {
      const raw = (item ?? {}) as Record<string, unknown>;
      return { id: asStr(raw.id), name: asStr(raw.name) || "Unnamed Item" };
    })
    .filter((item) => item.id.length > 0);
};

/** The Flutter `_fetch` composition: orders (throws), vendors (best effort),
 *  inventory (failure captured separately). */
export const fetchPurchaseOrdersModule = async (
  restaurantId: string,
): Promise<PurchaseOrdersPayload> => {
  const orders = await fetchOrders(restaurantId);
  let vendors: PoVendor[] = [];
  try {
    const raw = await getVendors(restaurantId);
    vendors = raw
      .map((vendor) => ({ id: asStr(vendor.id), name: asStr(vendor.name) }))
      .filter((vendor) => vendor.id.length > 0);
  } catch {
    /* vendors are optional — Flutter swallows this identically */
  }
  let inventory: PoInventoryItem[] = [];
  let inventoryError: string | null = null;
  try {
    inventory = await fetchInventoryItems(restaurantId);
  } catch (error) {
    inventoryError = error instanceof Error ? error.message : String(error);
  }
  return { orders, vendors, inventory, inventoryError };
};

/** POST /purchase-orders — the Flutter body exactly: `{vendor_id?, items, status}`. */
export const createPo = async (
  restaurantId: string,
  input: { vendorId?: string | null; items: NewPoLine[]; status: "draft" | "ordered" },
): Promise<void> => {
  const body: Record<string, unknown> = { items: input.items, status: input.status };
  if (input.vendorId) { body.vendor_id = input.vendorId; }
  const response = await requestBackend({
    path: "/purchase-orders",
    method: "POST",
    restaurantId,
    body,
  });
  if (!response.ok) {
    throwBackendError(response.status, response.text, "Unable to create purchase order");
  }
};

/** POST /purchase-orders/:id/status. Throws with the server's words. */
export const setPoStatus = async (
  restaurantId: string,
  id: string,
  status: "ordered" | "cancelled",
): Promise<void> => {
  const response = await requestBackend({
    path: `/purchase-orders/${encodeURIComponent(id)}/status`,
    method: "POST",
    restaurantId,
    body: { status },
  });
  if (!response.ok) {
    throwBackendError(response.status, response.text, "Unable to update purchase order");
  }
};

/** POST /purchase-orders/:id/receive — `quality_rating` only when 1–5. */
export const receivePo = async (
  restaurantId: string,
  id: string,
  lines: { inventory_id: string; qty_received: number }[],
  qualityRating: number,
): Promise<void> => {
  const body: Record<string, unknown> = { lines };
  if (qualityRating >= 1 && qualityRating <= 5) { body.quality_rating = qualityRating; }
  const response = await requestBackend({
    path: `/purchase-orders/${encodeURIComponent(id)}/receive`,
    method: "POST",
    restaurantId,
    body,
  });
  if (!response.ok) {
    throwBackendError(response.status, response.text, "Unable to receive purchase order");
  }
};

/** DELETE /purchase-orders/:id. Throws with the server's words. */
export const deletePo = async (restaurantId: string, id: string): Promise<void> => {
  const response = await requestBackend({
    path: `/purchase-orders/${encodeURIComponent(id)}`,
    method: "DELETE",
    restaurantId,
  });
  if (!response.ok) {
    throwBackendError(response.status, response.text, "Unable to delete purchase order");
  }
};
