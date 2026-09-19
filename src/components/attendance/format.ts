// Attendance formatting — the web copies of Flutter `_hm`, `_shiftMinutes`
// and `RestaurantTime.day / clock / stamp / zoneLabel`.

import { formatTime, timezoneOffsetMinutes, toDate } from "@/lib/tz";

/** `_hm`: always `Xh Ym` ("0h 45m"), negatives clamp to zero. */
export const hm = (minutes: number): string => {
  const m = Math.max(0, Math.round(Number.isFinite(minutes) ? minutes : 0));
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

/** Open shifts measured to now from raw instants; null when clock-in is unreadable. */
export const shiftMinutes = (clockIn: string | null | undefined, clockOut: string | null | undefined): number | null => {
  const a = toDate(clockIn);
  if (!a) { return null; }
  const b = toDate(clockOut) ?? new Date();
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 60_000));
};

/** `UTC+05:30`. */
export const offsetLabel = (timeZone: string, at: Date = new Date()): string => {
  const off = timezoneOffsetMinutes(timeZone, at);
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
};

const parts = (d: Date, timeZone: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-GB", {
    timeZone, day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(d)) {
    out[p.type] = p.value;
  }
  return out;
};

/** `RestaurantTime.day`: `Jun 26`. Accepts an ISO day key or an instant. */
export const dayLabel = (value: string | Date, timeZone: string): string => {
  const d = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00Z`)
    : toDate(value);
  if (!d) { return String(value); }
  const zone = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? "UTC" : timeZone;
  const p = parts(d, zone);
  return `${p.month} ${p.day}`;
};

/** `RestaurantTime.clock`: `14:05`. */
export const clock = (value: string | null | undefined, timeZone: string): string => formatTime(value, timeZone, "");

/** `RestaurantTime.stamp`: `26 Jun 2026, 14:05:07 UTC+05:30`. */
export const stamp = (value: string | null | undefined, timeZone: string): string => {
  const d = toDate(value);
  if (!d) { return value ?? "—"; }
  const p = parts(d, timeZone);
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}:${p.second} ${offsetLabel(timeZone, d)}`;
};

/** `RestaurantTime.zoneLabel`: `Asia/Kolkata · UTC+05:30`. */
export const zoneLabel = (timeZone: string): string => `${timeZone} · ${offsetLabel(timeZone)}`;

/** Flutter `_fmtDay(_from) – _fmtDay(_to)`; '' when the server sent no window. */
export const windowLabel = (from: string, to: string, timeZone: string): string =>
  from ? `${dayLabel(from, timeZone)} – ${dayLabel(to || from, timeZone)}` : "";

export const initialsOf = (name: string): string =>
  name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
