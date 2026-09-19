// Inventory module reads — the web copy of Flutter `inventoryModule` /
// `_ItemMovements` / `_VendorsSheet` (modules.dart). Unlike the legacy db.ts
// getters (which fall back to local data or [] on failure), these THROW, so
// useCachedFetch / the sheets can tell a failure from an empty set.

import { getInventoryCategories, requestBackend, type StockMovement, type Vendor } from "@/lib/db";
import { refusalSentence } from "@/lib/error-message";
import type { InventoryItem } from "@/app/dashboard/inventory/page";

const throwBackendError = (status: number, text: string, fallback: string): never => {
  if (status === 0) {
    throw new TypeError("Failed to fetch");
  }
  let message = "";
  try {
    message = refusalSentence(JSON.parse(text)) ?? "";
  } catch {
    /* not JSON */
  }
  if (!message) {
    message = text.trim() || fallback;
  }
  throw Object.assign(new Error(message), { status });
};

const num = (v: unknown): number | null => {
  if (v == null || v === "") {return null;}
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

const mapItem = (raw: Record<string, unknown>): InventoryItem => ({
  id: str(raw.id) || str(raw.barcode),
  name: str(raw.name) || "Unnamed Item",
  category: typeof raw.category === "string" ? raw.category : "",
  stock: Math.max(0, num(raw.stock) ?? 0),
  unit: typeof raw.unit === "string" ? raw.unit : "",
  status: (typeof raw.status === "string" ? raw.status : "In Stock") as InventoryItem["status"],
  expiry_date: typeof raw.expiry_date === "string" ? raw.expiry_date : null,
  reorder_level: num(raw.reorder_level),
  reorder_unit: typeof raw.reorder_unit === "string" ? raw.reorder_unit : null,
  reorder_applied: num(raw.reorder_applied),
  reorder_basis: typeof raw.reorder_basis === "string" ? (raw.reorder_basis as InventoryItem["reorder_basis"]) : null,
});

export interface InventoryBoard {
  items: InventoryItem[];
  /** The tenant's managed roster (`inventory_categories`). Best-effort. */
  categories: string[];
}

/** GET /inventory (must succeed) + the managed category roster (best-effort). */
export const fetchInventoryBoard = async (restaurantId: string): Promise<InventoryBoard> => {
  const [res, categories] = await Promise.all([
    requestBackend({
      path: `/inventory?restaurantId=${encodeURIComponent(restaurantId)}`,
      method: "GET",
      restaurantId,
    }),
    getInventoryCategories(restaurantId).catch(() => [] as string[]),
  ]);
  if (!res.ok) {
    throwBackendError(res.status, res.text, "Couldn't load inventory.");
  }
  const rows = Array.isArray(res.data) ? res.data : [];
  return {
    items: rows.map((r) => mapItem((r ?? {}) as Record<string, unknown>)),
    categories,
  };
};

/** The ledger for ONE item since `fromDay` (YYYY-MM-DD), first `max` rows. */
export const fetchItemMovements = async (
  restaurantId: string,
  inventoryId: string,
  fromDay: string,
  max = 6,
): Promise<StockMovement[]> => {
  const res = await requestBackend<{ movements?: unknown }>({
    path: `/inventory/movements?from=${encodeURIComponent(fromDay)}`,
    method: "GET",
    restaurantId,
  });
  if (!res.ok) {
    throwBackendError(res.status, res.text, "Movement history is unavailable right now.");
  }
  const all = Array.isArray(res.data?.movements) ? (res.data.movements as StockMovement[]) : [];
  return all.filter((m) => m.inventory_id === inventoryId || str(m.inventory_id as unknown) === inventoryId).slice(0, max);
};

/** GET /vendors — throws so the sheet can tell failure from "no vendors". */
export const fetchVendors = async (restaurantId: string): Promise<Vendor[]> => {
  const res = await requestBackend<{ vendors?: unknown }>({ path: "/vendors", method: "GET", restaurantId });
  if (!res.ok) {
    throwBackendError(res.status, res.text, "Couldn't load vendors.");
  }
  return Array.isArray(res.data?.vendors) ? (res.data.vendors as Vendor[]) : [];
};

const post = async <T = unknown>(restaurantId: string, path: string, body: unknown, fallback: string): Promise<T | null> => {
  const res = await requestBackend<T>({ path, method: "POST", restaurantId, body: JSON.stringify(body) });
  if (!res.ok) {
    throwBackendError(res.status, res.text, fallback);
  }
  return res.data;
};

/** POST /inventory — throws on refusal (the legacy db.ts adder queues locally). */
export const createInventoryItem = async (
  restaurantId: string,
  item: { name: string; category: string; stock: number; unit: string; reorder_level: number | null },
): Promise<void> => {
  await post(restaurantId, "/inventory", item, "Couldn't add the item.");
};

/** Replace the managed roster. A 403 surfaces with `status` for the inline note. */
export const saveCategoryRoster = async (restaurantId: string, categories: string[]): Promise<void> => {
  await post(restaurantId, "/restaurant/settings", { inventory_categories: categories }, "Couldn't save categories.");
};

/** Rename cascades onto every item carrying the old label (server side). */
export const renameCategory = async (restaurantId: string, from: string, to: string): Promise<void> => {
  await post(restaurantId, "/inventory-categories/rename", { from, to }, "Couldn't rename the category.");
};

/** The HTTP status an api error carries, if any. */
export const errorStatus = (e: unknown): number | null =>
  e != null && typeof e === "object" && typeof (e as { status?: unknown }).status === "number"
    ? (e as { status: number }).status
    : null;
