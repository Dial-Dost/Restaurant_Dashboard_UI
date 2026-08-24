"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useAuth } from "@/context/AuthContext";
import { useCurrency } from "@/hooks/use-currency";
import { useToast } from "@/hooks/use-toast";
import {
  getSimulationBaseline,
  runWhatIfSimulation,
  type SimulationBaseline,
  type SimulationLine,
  type SimulationResult,
  type SimulationRunParams,
} from "@/lib/db";
import { Info, Play, RotateCcw } from "lucide-react";

// ---------------------------------------------------------------------------
// Finite-number guard. The backend contract already promises finite numbers,
// but the reference implementation of this feature rendered ₹NaN in every
// delta cell — so the UI defends independently: anything non-finite becomes 0
// before it can reach a cell.
const finite = (n: unknown): number => {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
};

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

// 0.1 precision for covers / TAT — the backend rounds to the same grid.
const tenth = (n: number): number => Math.round(n * 10) / 10;

// Every slider the model exposes, in the order the reference shows them.
// min/max/step mirror PARAM_RANGES in the backend's simulation_math.ts (the
// server clamps too, so the two can never disagree about legality).
type ParamKey = keyof SimulationRunParams;
interface SliderDef {
  key: ParamKey;
  label: string;
  min: number;
  max: number;
  step: number;
  explainer: string;
  fmt: (v: number, money: (n: number) => string) => string;
}

const SLIDERS: SliderDef[] = [
  {
    key: "price_adjust_pct", label: "Price adjustment", min: -20, max: 30, step: 1,
    explainer: "Across-the-board menu price change. APC moves with it; demand responds via elasticity.",
    fmt: (v) => `${v > 0 ? "+" : ""}${v}%`,
  },
  {
    key: "elasticity", label: "Price elasticity", min: -2, max: -0.5, step: 0.1,
    explainer: "How strongly demand reacts to price: −1.3 means a 10% price rise loses 13% of covers.",
    fmt: (v) => v.toFixed(1),
  },
  {
    key: "staff_count", label: "Staff count", min: 1, max: 60, step: 1,
    explainer: "Rostered staff per day — drives the daily wage bill.",
    fmt: (v) => `${v} staff`,
  },
  {
    key: "avg_wage_per_shift", label: "Average wage per shift", min: 100, max: 2000, step: 10,
    explainer: "What one staff member costs per shift (one shift per day in this model).",
    fmt: (v, money) => `${money(v)}/shift`,
  },
  {
    key: "tat_target_min", label: "Turnaround time target", min: 10, max: 60, step: 1,
    explainer: "Target seat-to-settle time. Faster turns seat more covers — but only as fast as staffing can actually achieve.",
    fmt: (v) => `${v} min`,
  },
  {
    key: "extra_expediters", label: "Extra expediters", min: 0, max: 5, step: 1,
    explainer: "Each expediter cuts achievable turnaround by 3 min (floor 10 min) and costs ₹2100/shift.",
    fmt: (v) => `${v}`,
  },
  {
    key: "marketing_spend", label: "Marketing spend (one-time)", min: 0, max: 100000, step: 500,
    explainer: "One-off campaign with diminishing returns. Not amortised into daily profit — payback shows as breakeven days.",
    fmt: (v, money) => money(v),
  },
  {
    key: "food_cost_pct", label: "Food cost", min: 20, max: 60, step: 0.5,
    explainer: "Ingredient cost as a share of revenue.",
    fmt: (v) => `${v}%`,
  },
];

// Results-table rows, in render order. `lowerIsBetter` inverts the delta
// colouring for cost rows and TAT, where a negative delta is the good news.
interface ResultRowDef {
  key: keyof SimulationLine;
  label: string;
  unit: "money" | "count" | "min";
  lowerIsBetter: boolean;
}
const RESULT_ROWS: ResultRowDef[] = [
  { key: "covers", label: "Covers / day", unit: "count", lowerIsBetter: false },
  { key: "apc", label: "APC (pre-tax)", unit: "money", lowerIsBetter: false },
  { key: "revenue", label: "Revenue / day", unit: "money", lowerIsBetter: false },
  { key: "labour_cost", label: "Labour cost / day", unit: "money", lowerIsBetter: true },
  { key: "food_cost", label: "Food cost / day", unit: "money", lowerIsBetter: true },
  { key: "marketing_per_day", label: "Marketing / day", unit: "money", lowerIsBetter: true },
  { key: "net_profit", label: "Net profit / day", unit: "money", lowerIsBetter: false },
  { key: "tat_min", label: "Turnaround time", unit: "min", lowerIsBetter: true },
];

// Defensive copy of a response line: every cell finite, whatever arrives.
const safeLine = (line: Partial<SimulationLine> | null | undefined): SimulationLine => ({
  covers: finite(line?.covers),
  apc: finite(line?.apc),
  revenue: finite(line?.revenue),
  labour_cost: finite(line?.labour_cost),
  food_cost: finite(line?.food_cost),
  marketing_per_day: finite(line?.marketing_per_day),
  net_profit: finite(line?.net_profit),
  tat_min: finite(line?.tat_min),
});

// Slider defaults: the baseline as-is, so an untouched "Run Simulation" is a
// no-change simulation (every delta 0). Wage is backed out of the measured
// labour bill; each value is clamped into its slider's own legal range.
const defaultsFrom = (b: SimulationBaseline): Required<SimulationRunParams> => ({
  price_adjust_pct: 0,
  elasticity: -1.3,
  staff_count: clamp(Math.round(finite(b.staff_count)) || 1, 1, 60),
  avg_wage_per_shift: clamp(
    b.staff_count > 0 ? Math.round(finite(b.labour_cost_per_day) / b.staff_count / 10) * 10 : 450,
    100, 2000,
  ),
  tat_target_min: clamp(Math.round(finite(b.avg_tat_min)) || 45, 10, 60),
  extra_expediters: 0,
  marketing_spend: 0,
  food_cost_pct: clamp(Math.round(finite(b.food_cost_pct) * 2) / 2 || 32, 20, 60),
});

// Pulsing "Live" chip on the Current Performance card — the numbers under it
// come straight from the tenant's own last-30-days data, not from a canned demo.
function LiveBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-green-300 bg-green-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
      </span>
      Live
    </span>
  );
}

// Muted "estimated" tag for a baseline field the backend marked "default"
// (no measured data for this tenant yet — an industry-typical stand-in).
function EstimatedTag() {
  return (
    <span
      title="No measured data yet — an industry-typical default stands in until this tenant has its own."
      className="rounded-full border bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground"
    >
      estimated
    </span>
  );
}

// One tile on the Current Performance card. Same 2-per-row-on-phones grid the
// analytics page uses for its stat boxes.
function BaselineTile({ label, value, estimated }: { label: string; value: string; estimated: boolean }) {
  return (
    <div className="rounded-xl border p-3">
      <div className="flex items-start justify-between gap-1">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        {estimated && <EstimatedTag />}
      </div>
      <div className="mt-1 text-xl font-bold tabular-nums sm:text-2xl">{value}</div>
    </div>
  );
}

export default function SimulationPage() {
  const { user } = useAuth();
  const { currencySymbol } = useCurrency();
  const { toast } = useToast();

  const [baseline, setBaseline] = useState<SimulationBaseline | null>(null);
  const [baselineLoading, setBaselineLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [params, setParams] = useState<Required<SimulationRunParams> | null>(null);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [running, setRunning] = useState(false);

  // Whole rupees, minus sign BEFORE the symbol ("−₹500", never "₹-500").
  const money = (n: number): string => {
    const v = Math.round(finite(n));
    return `${v < 0 ? "−" : ""}${currencySymbol}${Math.abs(v)}`;
  };
  // Signed variant for the DELTA column: an explicit "+" on gains, so the
  // column always reads as a change, not a level.
  const signedMoney = (n: number): string => (n > 0 ? `+${money(n)}` : money(n));

  const fmtCell = (unit: ResultRowDef["unit"], n: number): string => {
    switch (unit) {
      case "money": return money(n);
      case "min": return `${tenth(finite(n))} min`;
      default: return `${tenth(finite(n))}`;
    }
  };
  const fmtDelta = (unit: ResultRowDef["unit"], n: number): string => {
    if (unit === "money") {return signedMoney(n);}
    const v = tenth(finite(n));
    const body = unit === "min" ? `${Math.abs(v)} min` : `${Math.abs(v)}`;
    return v > 0 ? `+${body}` : v < 0 ? `−${body}` : body;
  };

  useEffect(() => {
    if (!user?.restaurantUsername) {return;}
    let active = true;
    setBaselineLoading(true);
    getSimulationBaseline(user.restaurantUsername)
      .then((b) => {
        if (!active) {return;}
        setBaseline(b);
        // Seed the sliders from the live baseline so "Run Simulation" with
        // nothing moved is a clean no-change run. Re-seeding on refresh is
        // deliberate: fresher baseline, fresher defaults.
        if (b) {setParams(defaultsFrom(b));}
      })
      .finally(() => { if (active) {setBaselineLoading(false);} });
    return () => { active = false; };
  }, [user?.restaurantUsername, reload]);

  const run = async () => {
    if (!user?.restaurantUsername || !params) {return;}
    setRunning(true);
    try {
      const res = await runWhatIfSimulation(user.restaurantUsername, params);
      if (!res) {
        toast({ title: "Simulation failed", description: "The backend could not run this simulation. Please try again.", variant: "destructive" });
        return;
      }
      // Re-guard every number on the way in (see `finite` above).
      setResult({
        current: safeLine(res.current),
        simulated: safeLine(res.simulated),
        delta: safeLine(res.delta),
        notes: Array.isArray(res.notes) ? res.notes.filter((n): n is string => typeof n === "string") : [],
        breakeven_days: Number.isFinite(Number(res.breakeven_days)) ? Number(res.breakeven_days) : null,
      });
    } finally {
      setRunning(false);
    }
  };

  const reset = () => {
    if (baseline) {setParams(defaultsFrom(baseline));}
    setResult(null);
  };

  const sources = baseline?.sources ?? {};
  const isEstimated = (field: string): boolean => sources[field] === "default";
  const windowDays = baseline ? finite(baseline.window_days) || 30 : 30;

  // Colour for a delta cell: green when the move helps profit, red when it
  // hurts — INVERTED for cost rows and TAT, where down is good. Zero is muted.
  const deltaTone = (row: ResultRowDef, d: number): string => {
    if (d === 0) {return "text-muted-foreground";}
    const good = row.lowerIsBetter ? d < 0 : d > 0;
    return good ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400";
  };

  return (
    <div className="grid gap-4 md:gap-8">
      <div>
        <h1 className="text-lg font-semibold md:text-2xl">Simulation</h1>
        <p className="text-xs text-muted-foreground">
          What-if simulator · all {currencySymbol} figures are pre-tax (bill subtotal), per day, from your last {windowDays} days
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* ------------------------------------------------ What-If Simulator */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>What-If Simulator</CardTitle>
            <CardDescription>Adjust the levers, then run to see the projected impact on the numbers that matter.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            {params ? (
              <>
                {SLIDERS.map((def) => (
                  <div key={def.key} className="grid gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor={`sim-${def.key}`} className="text-sm font-medium">{def.label}</label>
                      <span className="rounded-md border bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">
                        {def.fmt(params[def.key], money)}
                      </span>
                    </div>
                    <Slider
                      id={`sim-${def.key}`}
                      value={[params[def.key]]}
                      min={def.min}
                      max={def.max}
                      step={def.step}
                      aria-label={def.label}
                      onValueChange={([v]) => {
                        setParams((p) => (p && v != null ? { ...p, [def.key]: v } : p));
                      }}
                    />
                    <p className="text-xs text-muted-foreground">{def.explainer}</p>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button onClick={() => { void run(); }} disabled={running}>
                    <Play className="mr-1.5 h-4 w-4" />
                    {running ? "Running…" : "Run Simulation"}
                  </Button>
                  <Button variant="outline" onClick={reset} title="Back to the live baseline settings">
                    <RotateCcw className="mr-1.5 h-4 w-4" />
                    Reset
                  </Button>
                </div>
              </>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {baselineLoading ? "Loading the live baseline…" : "The baseline could not be loaded, so the sliders have nothing to start from."}
              </p>
            )}
          </CardContent>
        </Card>

        {/* --------------------------------------------- Current Performance */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Current Performance</CardTitle>
              <LiveBadge />
            </div>
            <CardDescription>Your real last-{windowDays}-day averages — the baseline every simulation starts from.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {baselineLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading live performance…</p>
            ) : baseline ? (
              <>
                {/* 2 boxes per row on phones — same behaviour as the analytics stat grids. */}
                <div className="grid grid-cols-2 gap-3">
                  <BaselineTile label="Covers / day" value={`${tenth(finite(baseline.covers_per_day))}`} estimated={isEstimated("covers_per_day")} />
                  <BaselineTile label="APC (pre-tax)" value={money(baseline.apc)} estimated={isEstimated("apc")} />
                  <BaselineTile label="Revenue / day" value={money(baseline.revenue_per_day)} estimated={isEstimated("revenue_per_day")} />
                  <BaselineTile label="Net profit / day" value={money(baseline.net_profit_per_day)} estimated={isEstimated("net_profit_per_day")} />
                  <BaselineTile label="Food cost" value={`${tenth(finite(baseline.food_cost_pct))}%`} estimated={isEstimated("food_cost_pct")} />
                  <BaselineTile label="Labour / day" value={money(baseline.labour_cost_per_day)} estimated={isEstimated("labour_cost_per_day")} />
                  <BaselineTile label="Avg turnaround" value={`${tenth(finite(baseline.avg_tat_min))} min`} estimated={isEstimated("avg_tat_min")} />
                  <BaselineTile label="Fixed costs / day" value={money(baseline.fixed_costs_per_day)} estimated={isEstimated("fixed_costs_per_day")} />
                </div>
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {Math.round(finite(baseline.staff_count))} staff · {Math.round(finite(baseline.table_count))} tables ·{" "}
                    {currencySymbol} figures are pre-tax (bill subtotal). Fields tagged &ldquo;estimated&rdquo; have no measured data yet.
                  </span>
                </p>
              </>
            ) : (
              <div className="grid justify-items-center gap-2 py-8 text-center">
                <p className="text-sm text-muted-foreground">Could not load the live baseline.</p>
                <Button variant="outline" size="sm" onClick={() => { setReload((n) => n + 1); }}>Retry</Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ------------------------------------------------------------ Results */}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
            <CardDescription>
              Current vs simulated, per day. Green deltas help profit, red ones hurt — for costs and turnaround, lower is better.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="bg-muted/70 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Metric</th>
                    <th className="px-3 py-2 text-right font-medium">Current</th>
                    <th className="px-3 py-2 text-right font-medium">Simulated</th>
                    <th className="px-3 py-2 text-right font-medium">Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {RESULT_ROWS.map((row) => {
                    const d = finite(result.delta[row.key]);
                    return (
                      <tr key={row.key} className="border-t">
                        <td className="px-3 py-2 font-medium">{row.label}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtCell(row.unit, result.current[row.key])}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">{fmtCell(row.unit, result.simulated[row.key])}</td>
                        <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums ${deltaTone(row, d)}`}>
                          {fmtDelta(row.unit, d)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* One-time marketing payback, kept out of the daily net (the table
                above only carries its per-day allocation as information). */}
            {finite(params?.marketing_spend ?? 0) > 0 && (
              <p className="text-sm">
                {result.breakeven_days != null ? (
                  <>
                    <span className="font-medium">Marketing payback:</span>{" "}
                    the one-time {money(params?.marketing_spend ?? 0)} spend breaks even in{" "}
                    <span className="font-semibold text-green-600 dark:text-green-400">{Math.round(result.breakeven_days)} day{Math.round(result.breakeven_days) === 1 ? "" : "s"}</span>{" "}
                    of the simulated profit uplift.
                  </>
                ) : (
                  <span className="text-muted-foreground">
                    <span className="font-medium text-foreground">Marketing payback:</span>{" "}
                    no daily profit uplift versus current, so the one-time spend never breaks even under these settings.
                  </span>
                )}
              </p>
            )}

            {result.notes.length > 0 && (
              <div className="grid gap-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Simulation notes</p>
                <ul className="grid gap-1">
                  {result.notes.map((note, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
