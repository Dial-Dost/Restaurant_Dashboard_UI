// Printer module fetchers — the web half of Flutter `printerModule`
// (restaurant_owner_app/lib/screens/modules.dart ~30981–31556).
//
// A browser cannot reach a Windows spooler or open a raw socket to port 9100,
// so the device-local half of the app's screen (network printers, default
// printer, queue, log) cannot exist here. What CAN exist is the server's view:
// the registered print devices, the outlet's destinations, the server-side
// routing rules and their health, and a test slip pushed down the real routing
// path. Every call below is that server surface (Restaurant_Backend
// routes/printing.ts).
//
// Failures THROW with the server's own sentence (status attached) so
// useCachedFetch can split offline from refusal.

import { requestBackend } from "@/lib/db";
import { refusalSentence } from "@/lib/error-message";

export interface PrintDevice {
  id: string;
  device_key: string;
  label: string | null;
  platform: string | null;
  agent_version: string | null;
  default_target: string | null;
  last_seen_at: string | null;
  retired_at: string | null;
  /** null = presence unknown (never "offline"). */
  online: boolean | null;
}

export interface PrintDestination {
  id: string;
  name: string;
  sort_order: number;
  active: boolean;
}

export interface PrintRoute {
  id?: string;
  role: string;
  destination_id: string;
  destination_name?: string | null;
  destination_active?: boolean;
}

export type DestinationHealthStatus = "ok" | "degraded" | "offline" | "unbound" | "unknown";

export interface DestinationHealth {
  id: string;
  name: string;
  active: boolean;
  roles: string[];
  status: DestinationHealthStatus;
  devices: {
    device_id: string;
    label: string;
    platform: string | null;
    target: string | null;
    active: boolean;
    retired: boolean;
    serving: boolean | null;
  }[];
}

export interface PrintHealth {
  routing_enabled: boolean;
  presence: "ok" | "unknown";
  destinations: DestinationHealth[];
  unbound_roles: string[];
  legacy_agents: number | null;
  legacy_agents_note?: string;
}

export interface PrintingBundle {
  devices: PrintDevice[];
  presence: "ok" | "unknown";
  destinations: PrintDestination[];
  routes: PrintRoute[];
  routingEnabled: boolean;
  health: PrintHealth | null;
  /** Kitchen sections from /restaurant/settings — suggestions only. */
  stations: string[];
}

export interface TestSlipResult {
  role: string;
  mode: string | null;
  reason: string | null;
  destination: string | null;
  device: string | null;
}

export interface TestSlipResponse {
  results: TestSlipResult[];
  skipped: number;
  replayMinutes: number | null;
}

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
  throw Object.assign(new Error(message || text.trim() || fallback), { status });
};

const send = async <T>(
  rid: string,
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  fallback: string,
  body?: unknown,
): Promise<T> => {
  const res = await requestBackend<T>({ path, method, restaurantId: rid, body });
  if (!res.ok) {
    throwBackendError(res.status, res.text, fallback);
  }
  return (res.data ?? {}) as T;
};

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** The app's station list: trimmed, non-empty, case-insensitively unique, menu order. */
const stationsOf = (settings: Record<string, unknown> | null): string[] => {
  const out: string[] = [];
  for (const s of arr<unknown>(settings?.kitchen_sections)) {
    const t = typeof s === "string" || typeof s === "number" ? String(s).trim() : "";
    if (t && !out.some((e) => e.toLowerCase() === t.toLowerCase())) {out.push(t);}
  }
  return out;
};

export const fetchPrintingBundle = async (rid: string): Promise<PrintingBundle> => {
  const [devices, routes, health, settings] = await Promise.all([
    send<{ devices?: unknown; presence?: string }>(rid, "/print/devices", "GET", "Couldn't load print devices."),
    send<{ routes?: unknown; destinations?: unknown; routing_enabled?: boolean }>(
      rid, "/print/routes", "GET", "Couldn't load print routing.",
    ),
    // Health is a nice-to-have on top of the two reads above.
    send<PrintHealth>(rid, "/print/health", "GET", "Couldn't read print health.").catch(() => null),
    send<Record<string, unknown>>(rid, "/restaurant/settings", "GET", "Couldn't load settings.").catch(() => null),
  ]);
  return {
    devices: arr<PrintDevice>(devices.devices),
    presence: devices.presence === "ok" ? "ok" : "unknown",
    destinations: arr<PrintDestination>(routes.destinations),
    routes: arr<PrintRoute>(routes.routes),
    routingEnabled: routes.routing_enabled !== false,
    health: health && typeof health === "object" ? { ...health, destinations: arr(health.destinations) } : null,
    stations: stationsOf(settings),
  };
};

/** Whole-set replace — an empty list turns routing off (everything broadcasts). */
export const savePrintRoutes = (rid: string, routes: { role: string; destination_id: string }[]): Promise<unknown> =>
  send(rid, "/print/routes", "PUT", "Couldn't save the printing rules.", { routes });

export const upsertPrintDestination = (
  rid: string,
  input: { id?: string; name: string; active?: boolean },
): Promise<unknown> => send(rid, "/print/destinations", "POST", "Couldn't save this printer.", input);

export const deletePrintDestination = (rid: string, id: string): Promise<unknown> =>
  send(rid, `/print/destinations/${encodeURIComponent(id)}`, "DELETE", "Couldn't remove this printer.");

export const sendTestSlip = async (rid: string, role?: string): Promise<TestSlipResponse> => {
  const res = await send<{ results?: unknown; skipped?: number; replayMinutes?: number }>(
    rid, "/print/test", "POST", "Couldn't send a test slip.", role ? { role } : {},
  );
  return {
    results: arr<TestSlipResult>(res.results),
    skipped: typeof res.skipped === "number" && Number.isFinite(res.skipped) ? res.skipped : 0,
    replayMinutes: typeof res.replayMinutes === "number" ? res.replayMinutes : null,
  };
};

/* ── Roles — the wire vocabulary: bill | kot | kot:<STATION UPPERCASED> ── */

export const ROLE_BILL = "bill";
export const ROLE_ANY_KOT = "kot";
export const stationRole = (station: string): string => `kot:${station.trim().toUpperCase()}`;

export const roleLabel = (role: string, stations: string[] = []): string => {
  if (role === ROLE_BILL) {return "Bills";}
  if (role === ROLE_ANY_KOT) {return "Kitchen dockets (any station)";}
  if (role.startsWith("kot:")) {
    const key = role.slice(4);
    const named = stations.find((s) => s.toUpperCase() === key);
    return `Kitchen: ${named ?? key}`;
  }
  return role;
};
