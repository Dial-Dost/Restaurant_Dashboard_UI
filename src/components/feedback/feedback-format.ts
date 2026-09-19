// Shared reading helpers for the Feedback + Concerns modules — the web
// spellings of the small Flutter readers these screens lean on (`_numOf`,
// `_score`, `_pctOf`, `_money`, `_ratingSpread`, `initialsOf`, and
// `_fmtTime` → RestaurantTime.short).

import type { FeedbackEntry } from "@/lib/api/feedback";

/** `_numOf`: a number off any JSON value; 0 for junk (an object is junk). */
export const numOf = (v: unknown): number => {
  if (typeof v === "number") { return Number.isFinite(v) ? v : 0; }
  if (typeof v === "string") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

/** `_int`: whole-number JSON field; null when absent/unparseable — null ≠ 0. */
export const intOf = (v: unknown): number | null => {
  if (typeof v === "number") { return Number.isFinite(v) ? Math.round(v) : null; }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  return null;
};

/** `_s`: string field with Flutter's exact fallback rule — the fallback (an
 *  em dash unless the call site says otherwise) stands in for null AND for
 *  the empty string. Mirrored verbatim so the two clients render the same
 *  text for the same payload, quirks included. */
export const sOf = (v: unknown, fallback = "—"): string => {
  if (v == null) { return fallback; }
  const s = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
  return s === "" ? fallback : s;
};

/** `_score`: 2dp ratings read "4.8"; whole scores stay clean ("5", not
 *  "5.0"); a value that never arrived reads "-", never "No score". */
export const scoreOf = (v: unknown): string => {
  if (v == null || (typeof v === "string" && v.trim() === "")) { return "-"; }
  const d = numOf(v);
  return d === Math.round(d) ? d.toFixed(0) : d.toFixed(1);
};

/** `_pctOf`: "37%" of a whole, or an em dash when the whole is nothing. */
export const pctOf = (part: number, whole: number): string =>
  whole > 0 ? `${((part / whole) * 100).toFixed(0)}%` : "—";

/** `_money`: an em dash for a value the server omitted — a figure that never
 *  arrived must not read as zero. Same en-IN 2dp voice as the Overview. */
export const moneyOf = (symbol: string, v: unknown): string => {
  let n: number;
  if (typeof v === "number") {
    n = v;
  } else if (typeof v === "string" && v.trim() !== "") {
    n = Number(v.trim());
  } else {
    return "—";
  }
  if (!Number.isFinite(n)) { return "—"; }
  return `${symbol}${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/**
 * `_ratingSpread`: how many responses landed on each whole star, 1..5.
 * `overall_rating` is the mean of the per-question scores, so it is rounded
 * to the star a guest would read off the page. Unrated rows are not counted.
 */
export const ratingSpread = (items: FeedbackEntry[]): number[] => {
  const out = [0, 0, 0, 0, 0];
  for (const m of items) {
    const raw = numOf(m.overall_rating);
    if (raw <= 0) { continue; }
    const star = Math.round(raw);
    out[Math.min(5, Math.max(1, star)) - 1] += 1;
  }
  return out;
};

/** "KR" for "Kavya Reddy", "K" for "Kavya", "?" for nothing. */
export const initialsOf = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter((s) => s.length > 0);
  if (parts.length === 0) { return "?"; }
  return parts.length === 1
    ? parts[0].slice(0, 1)
    : `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`;
};

/** `Jun 26, 14:05` in the restaurant's zone — RestaurantTime.short, the
 *  timestamp voice of every row on these screens. '' for nothing. */
export const fmtShort = (iso: string | null | undefined, timeZone: string): string => {
  if (!iso) { return ""; }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) { return iso; }
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(d);
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("month")} ${get("day")}, ${get("hour")}:${get("minute")}`;
  } catch {
    return iso;
  }
};
