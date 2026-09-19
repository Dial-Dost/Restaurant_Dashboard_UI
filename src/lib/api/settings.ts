// Settings module fetchers — the web half of Flutter `settingsModule`
// (restaurant_owner_app/lib/screens/modules.dart ~31578). One load reads the
// settings document (GET /restaurant/settings, which carries every tenant key
// the cards below edit) plus the public branding read (theme colour, logo,
// queue_show_menu). Every write is merge-on-omit: a card sends only its keys.
//
// Failures THROW with the server's own sentence (status attached) so a card
// can show a 403's words and useCachedFetch can split offline from refusal.

import { requestBackend } from "@/lib/db";
import { refusalSentence } from "@/lib/error-message";

export type SettingsDoc = Record<string, unknown>;

export interface SettingsBundle {
  settings: SettingsDoc;
  /** GET /qr/<slug>/branding — best-effort (an empty object when it fails). */
  brand: SettingsDoc;
}

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

const send = async <T = SettingsDoc>(
  rid: string,
  path: string,
  method: "GET" | "POST" | "PUT",
  fallback: string,
  body?: unknown,
): Promise<T | null> => {
  const res = await requestBackend<T>({ path, method, restaurantId: rid, body });
  if (!res.ok) {
    throwBackendError(res.status, res.text, fallback);
  }
  return res.data;
};

export const fetchSettingsBundle = async (rid: string): Promise<SettingsBundle> => {
  const [settings, brand] = await Promise.all([
    send(rid, "/restaurant/settings", "GET", "Couldn't load settings."),
    send(rid, `/qr/${encodeURIComponent(rid)}/branding`, "GET", "Couldn't load branding.").catch(() => null),
  ]);
  return {
    settings: settings && typeof settings === "object" ? settings : {},
    brand: brand && typeof brand === "object" ? brand : {},
  };
};

/** POST /restaurant/settings with only the keys given. Returns the reply doc (or null). */
export const postSettings = (rid: string, body: SettingsDoc): Promise<SettingsDoc | null> =>
  send(rid, "/restaurant/settings", "POST", "Couldn't save the setting.", body);

/** POST /restaurant/branding (merge-on-omit). */
export const postBranding = (rid: string, body: SettingsDoc): Promise<SettingsDoc | null> =>
  send(rid, "/restaurant/branding", "POST", "Couldn't save branding.", body);

/** The Flutter profile PUT: exactly the five edited fields, trimmed. */
export interface ProfileFields {
  name: string;
  address: string;
  phone: string;
  email: string;
  hours: string;
}
export const saveRestaurantProfile = async (rid: string, p: ProfileFields): Promise<void> => {
  await send(rid, "/restaurant/profile", "PUT", "Couldn't save the profile.", {
    name: p.name.trim(),
    address: p.address.trim(),
    phone: p.phone.trim(),
    email: p.email.trim(),
    hours: p.hours.trim(),
  });
};

/** POST /print/test for the kitchen role — the KOT docket card's test slip. */
export const printTestKot = (rid: string): Promise<SettingsDoc | null> =>
  send(rid, "/print/test", "POST", "Couldn't print a test KOT.", { role: "kot" });

/* ── Readers (Flutter's `_s` + num coercions) ────────────────────────── */

/** A scalar as text; objects/arrays/null read as the fallback. */
export const scalarText = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : fallback;

export const str = (m: SettingsDoc, key: string, fallback = ""): string => scalarText(m[key], fallback);

export const num = (m: SettingsDoc, key: string, fallback: number): number => {
  const v = m[key];
  if (typeof v === "number" && Number.isFinite(v)) {return v;}
  const parsed = Number.parseFloat(scalarText(v));
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const errorText = (e: unknown, fallback = "Something went wrong."): string =>
  e instanceof Error && e.message ? e.message : fallback;

export const errorStatus = (e: unknown): number | undefined => {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : undefined;
};

/** A stable key for remounting seeded cards when the payload really changed
 *  (Flutter's KeyedSubtree on settingsPayloadKey). */
const hash = (s: string): string => {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
};

export const payloadKey = (b: SettingsBundle): string => {
  try {
    return String(JSON.stringify(b).length) + ":" + hash(JSON.stringify(b));
  } catch {
    return "x";
  }
};

/* ── KOT docket (models/kot_docket_settings.dart) ─────────────────────── */

export const KOT_PRINT_STYLE_KEY = "kot_print_style";
export const KOT_TEXT_SIZE_KEY = "kot_text_size";
export const KOT_STYLE_CLASSIC = "classic";

export const kotDocketSupported = (m: SettingsDoc): boolean =>
  KOT_PRINT_STYLE_KEY in m && KOT_TEXT_SIZE_KEY in m;

export const readKotStyle = (m: SettingsDoc): string =>
  m[KOT_PRINT_STYLE_KEY] === "classic" ? "classic" : "reference";

export const readKotSize = (m: SettingsDoc): string => {
  const v = m[KOT_TEXT_SIZE_KEY];
  return v === "small" || v === "large" || v === "standard" ? v : "standard";
};

const kotReplayNote = (reply: unknown): string => {
  const raw = reply && typeof reply === "object" ? (reply as SettingsDoc).replayMinutes : null;
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) {
    return `If nothing came out, it prints on the first kitchen device to connect within ${raw} minute${raw === 1 ? "" : "s"}, and not after that.`;
  }
  return "If nothing came out, it may still print when a kitchen device connects.";
};

export const kotTestPrintOutcome = (reply: unknown): string => {
  const raw = reply && typeof reply === "object" ? (reply as SettingsDoc).results : null;
  if (!Array.isArray(raw)) {return "Sent. Check the kitchen printer's paper.";}
  if (raw.length === 0) {return "Nothing was sent to print.";}
  const first = (raw[0] ?? {}) as SettingsDoc;
  const d = first.destination;
  const destination = typeof d === "string" && d.trim() ? d.trim() : null;
  if (first.mode === "directed") {
    return `Sent to ${destination ?? "the kitchen printer"}. Check the paper there.`;
  }
  if (first.reason === "no_device_online" && destination != null) {
    return `${destination} is not online, so every connected device with a kitchen printer was asked to print it. Check the paper. ${kotReplayNote(reply)}`;
  }
  return `Every connected device with a kitchen printer was asked to print it. Check the paper. ${kotReplayNote(reply)}`;
};
