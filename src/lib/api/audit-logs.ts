// Audit trail fetchers + day-window helpers — the web half of Flutter
// `_AuditLogView` (restaurant_owner_app/lib/screens/modules.dart ~6290–6935).
//
// Unlike db.ts `getAuditLogPage` (null on any failure), `fetchAuditPage`
// THROWS, so useCachedFetch / LoadErrorState can tell an unreachable server
// from a refusal and say so.

import { requestBackend } from "@/lib/db";
import { refusalSentence } from "@/lib/error-message";
import { todayInZone, wallClockToUtcInZone } from "@/lib/tz";

export interface AuditLog {
  id: string;
  employee: string;
  action: string;
  category: string;
  details: string;
  timestamp: string;
  // Additive undo metadata from GET /audit-logs.
  undoable?: boolean;
  undo_block_reason?: string | null;
  undone?: boolean;
  undo_log_id?: string | null;
  undo_of?: string | null;
}

export const AUDIT_PAGE_SIZE = 50;
/** Largest single window the server returns (post-undo re-read cap). */
export const AUDIT_MAX_WINDOW = 500;

export interface AuditFilters {
  category: string;
  search: string;
  /** Restaurant-zone day keys, "" = open end. */
  from: string;
  to: string;
}

export interface AuditPage {
  logs: AuditLog[];
  total: number;
  hasMore: boolean;
}

const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback;
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

const mapLog = (raw: unknown): AuditLog => {
  const item = (raw ?? {}) as Record<string, unknown>;
  const ts = str(item.timestamp);
  const at = ts ? new Date(ts) : null;
  return {
    id: str(item.id),
    employee: str(item.employee),
    action: str(item.action, "Unknown"),
    category: str(item.category, "General"),
    details: str(item.details),
    timestamp: at && !Number.isNaN(at.getTime()) ? at.toISOString() : "",
    undoable: item.undoable === true,
    undo_block_reason: strOrNull(item.undo_block_reason),
    undone: item.undone === true,
    undo_log_id: strOrNull(item.undo_log_id),
    undo_of: strOrNull(item.undo_of),
  };
};

/** Flutter `_restaurantDayBoundIso`: 00:00:00.000 / 23:59:59.999 of the day in
 *  the RESTAURANT's zone (DST-safe via wallClockToUtcInZone's two passes). */
export function restaurantDayBoundIso(dayKey: string, timeZone: string, end = false): string {
  const d = wallClockToUtcInZone(`${dayKey}T${end ? "23:59:59" : "00:00:00"}`, timeZone);
  if (!d) { return ""; }
  return new Date(d.getTime() + (end ? 999 : 0)).toISOString();
}

export async function fetchAuditPage(
  restaurantId: string,
  filters: AuditFilters,
  timeZone: string,
  offset: number,
  limit = AUDIT_PAGE_SIZE,
): Promise<AuditPage> {
  const qs = new URLSearchParams({ restaurantId, meta: "1" });
  qs.set("limit", String(Math.max(1, Math.min(limit, AUDIT_MAX_WINDOW))));
  qs.set("offset", String(Math.max(0, offset)));
  const q = filters.search.trim();
  if (q) { qs.set("search", q); }
  if (filters.category && filters.category !== "All") { qs.set("category", filters.category); }
  if (filters.from) { qs.set("from", restaurantDayBoundIso(filters.from, timeZone)); }
  if (filters.to) { qs.set("to", restaurantDayBoundIso(filters.to, timeZone, true)); }

  const res = await requestBackend<{ logs?: unknown[]; total?: number; has_more?: boolean }>({
    path: `/audit-logs?${qs.toString()}`,
    method: "GET",
    restaurantId,
  });
  if (!res.ok) {
    if (res.status === 0) { throw new TypeError("Failed to fetch"); }
    let message = "";
    try { message = refusalSentence(JSON.parse(res.text)) ?? ""; } catch { /* not JSON */ }
    throw Object.assign(new Error(message || res.text.trim() || "Couldn't load the audit trail."), { status: res.status });
  }
  const data = res.data;
  if (!data || !Array.isArray(data.logs)) { throw Object.assign(new Error("Unexpected response from the server."), { status: 500 }); }
  const logs = data.logs.map(mapLog);
  return { logs, total: data.total ?? logs.length, hasMore: data.has_more === true };
}

/* ── Day keys in the restaurant's zone ─────────────────────────────────── */

const keyOf = (y: number, m: number, d: number): string =>
  `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** `days` before the restaurant's today. */
export function dayKeyBack(days: number, timeZone: string): string {
  const [y, m, d] = todayInZone(timeZone).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - days));
  return keyOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Calendar months back, clamped to the month's length (Flutter `_restaurantDayKeyMonthsBack`). */
export function dayKeyMonthsBack(months: number, timeZone: string): string {
  const [y0, m0, d0] = todayInZone(timeZone).split("-").map(Number);
  let year = y0;
  let month = m0 - months;
  while (month <= 0) { month += 12; year -= 1; }
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return keyOf(year, month, Math.min(d0, maxDay));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Aug 20" from a day key. */
export function fmtDay(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  if (!m || !d) { return key; }
  return `${MONTHS[m - 1]} ${d}`;
}

/** Flutter `_rangeLabel`. */
export function rangeLabel(from: string, to: string): string {
  if (!from && !to) { return "All time"; }
  if (from && from === to) { return fmtDay(from); }
  if (!from) { return `Up to ${fmtDay(to)}`; }
  if (!to) { return `From ${fmtDay(from)}`; }
  return `${fmtDay(from)} – ${fmtDay(to)}`;
}

/** Day key <-> a local-midnight Date for the picker (the picker's calendar
 *  is zone-free; the key is what carries the restaurant day). */
export const keyToPickerDate = (key: string): Date => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const pickerDateToKey = (d: Date): string => keyOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
