// Pure formatting/coercion helpers for the Accounting page — web copies of the
// small helpers Flutter's modules.dart leans on (`_n`, `_int`, `_s`, `_money`,
// `_ddmm`, `_fmtTime`, `_windowLabel`, `initialsOf`).
//
// Two money voices, deliberately (audit 13.1): WHOLE rupees on stat cards and
// chart values, but 2 dp in every sheet row, GST row, expense row and payroll
// figure — the rows are what an accountant reconciles against paper.

import { rangeDays, rangeLabel } from "@/lib/date-range";
import type { DateRange } from "@/lib/date-range";

/** Loose number: numbers pass, numeric strings parse, everything else is 0. */
export const numOf = (v: unknown): number => {
  if (typeof v === "number") { return Number.isFinite(v) ? v : 0; }
  if (typeof v === "string") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

/** Rounded integer, or null when unparseable (Flutter `_int`). */
export const intOf = (v: unknown): number | null => {
  if (typeof v === "number") { return Number.isFinite(v) ? Math.round(v) : null; }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  return null;
};

/** Trimmed string, or the fallback (Flutter `_s`; default "—"). */
export const strOf = (v: unknown, fallback = "—"): string => {
  if (typeof v === "string") {
    const s = v.trim();
    return s === "" ? fallback : s;
  }
  if (typeof v === "number" || typeof v === "boolean") { return String(v); }
  return fallback;
};

/** `₹1234.56` — the sheet/row voice (Flutter `_money`); "—" when unparseable. */
export const moneyExact = (symbol: string, v: unknown): string => {
  const n =
    typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.trim()) : NaN;
  return Number.isFinite(n) ? `${symbol}${n.toFixed(2)}` : "—";
};

/** `₹1235` — the stat-card/chart voice (whole rupees). */
export const moneyWhole = (symbol: string, v: unknown): string => `${symbol}${numOf(v).toFixed(0)}`;

/** "1 bill" / "3 bills". */
export const billsWord = (n: number): string => `${n} bill${n === 1 ? "" : "s"}`;

/** "22/08" off a YYYY-MM-DD key (Flutter `_ddmm`). */
export const ddmm = (iso: string): string => {
  const pcs = iso.split("-");
  return pcs.length === 3 ? `${pcs[2]}/${pcs[1]}` : iso;
};

/**
 * "1–15 Aug · 15 days" — every sheet says which window it is describing,
 * because the range control can be changed while a sheet is open.
 */
export const windowLabelText = (range: DateRange, timezone: string): string => {
  const days = rangeDays(range);
  return `${rangeLabel(range, timezone)} · ${days} day${days === 1 ? "" : "s"}`;
};

/** "Jun 26, 14:05" in the restaurant's zone (Flutter RestaurantTime.short). */
export const shortTime = (iso: string, timezone: string): string => {
  if (!iso) { return ""; }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) { return iso; }
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("month")} ${get("day")}, ${get("hour")}:${get("minute")}`;
  } catch {
    return iso;
  }
};

/** "AV" from "Amit Verma"; single names give one letter; blank gives "?". */
export const initialsOf = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter((s) => s.length > 0);
  if (parts.length === 0) { return "?"; }
  return parts.length === 1
    ? parts[0].slice(0, 1)
    : `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`;
};
