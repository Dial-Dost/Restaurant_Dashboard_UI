// What-if simulator fetchers — the web half of Flutter `simulation.dart`.
//
// GET /simulation/baseline + POST /simulation/run. All ₹ figures are PRE-TAX
// (bill subtotal), per day, over the backend's fixed window. These THROW on
// failure (status 0 -> TypeError so `isUnreachableError` reads an outage; any
// other status -> the server's own sentence) so `useCachedFetch` and the run
// error card can tell offline from refusal. The legacy `db.ts` helpers return
// null on failure and lose that distinction.

import { requestBackend } from "@/lib/db";
import { refusalSentence } from "@/lib/error-message";
import { simFinite, type RunBody } from "@/lib/simulation-params";

export type SimulationSource = "measured" | "default";

export interface SimulationBaseline {
  window_days: number;
  covers_per_day: number;
  apc: number;
  revenue_per_day: number;
  food_cost_pct: number;
  labour_cost_per_day: number;
  staff_count: number;
  avg_tat_min: number;
  table_count: number;
  fixed_costs_per_day: number;
  net_profit_per_day: number;
  sources: Record<string, SimulationSource>;
}

/** One column of the results table (current / simulated / delta). */
export interface SimulationLine {
  covers: number;
  apc: number;
  revenue: number;
  service_charge: number;
  revenue_deductions: number;
  labour_cost: number;
  food_cost: number;
  fixed_cost: number;
  marketing_per_day: number;
  net_profit: number;
  tat_min: number;
  tax_collected: number;
}

export interface SimulationResult {
  current: SimulationLine;
  simulated: SimulationLine;
  delta: SimulationLine;
  notes: string[];
  warnings: string[];
  /** Days for the one-time marketing spend to pay back; null = no uplift. */
  breakeven_days: number | null;
}

const LINE_KEYS: (keyof SimulationLine)[] = [
  "covers", "apc", "revenue", "service_charge", "revenue_deductions", "labour_cost",
  "food_cost", "fixed_cost", "marketing_per_day", "net_profit", "tat_min", "tax_collected",
];

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

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

const safeLine = (raw: unknown): SimulationLine => {
  const r = asRecord(raw);
  const out = {} as SimulationLine;
  for (const k of LINE_KEYS) {out[k] = simFinite(r[k]);}
  return out;
};

const strings = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : [];

export async function fetchSimulationBaseline(restaurantId: string): Promise<SimulationBaseline> {
  const res = await requestBackend<Record<string, unknown>>({
    path: `/simulation/baseline?restaurantId=${encodeURIComponent(restaurantId)}`,
    method: "GET",
    restaurantId,
  });
  if (!res.ok) {
    throwBackendError(res.status, res.text, "Couldn't load the live baseline.");
  }
  const b = asRecord(res.data);
  const sources: Record<string, SimulationSource> = {};
  for (const [k, v] of Object.entries(asRecord(b.sources))) {
    sources[k] = v === "default" ? "default" : "measured";
  }
  return {
    window_days: simFinite(b.window_days, 30),
    covers_per_day: simFinite(b.covers_per_day),
    apc: simFinite(b.apc),
    revenue_per_day: simFinite(b.revenue_per_day),
    food_cost_pct: simFinite(b.food_cost_pct),
    labour_cost_per_day: simFinite(b.labour_cost_per_day),
    staff_count: simFinite(b.staff_count),
    avg_tat_min: simFinite(b.avg_tat_min),
    table_count: simFinite(b.table_count),
    fixed_costs_per_day: simFinite(b.fixed_costs_per_day),
    net_profit_per_day: simFinite(b.net_profit_per_day),
    sources,
  };
}

export async function runSimulation(restaurantId: string, body: RunBody): Promise<SimulationResult> {
  const res = await requestBackend<Record<string, unknown>>({
    path: `/simulation/run?restaurantId=${encodeURIComponent(restaurantId)}`,
    method: "POST",
    restaurantId,
    body,
  });
  if (!res.ok) {
    throwBackendError(res.status, res.text, "The backend could not run this simulation.");
  }
  const r = asRecord(res.data);
  const be = r.breakeven_days;
  return {
    current: safeLine(r.current),
    simulated: safeLine(r.simulated),
    delta: safeLine(r.delta),
    notes: strings(r.notes),
    warnings: strings(r.warnings),
    breakeven_days: typeof be === "number" && Number.isFinite(be) && be > 0 ? be : null,
  };
}
