// What-if simulator: the parameter catalogue behind the editable lever list.
//
// Mirror of the Flutter app's `lib/models/simulation_params.dart` (itself a
// mirror of the backend's `simulation_math.ts` PARAM_CATALOG / resolveParams),
// entry for entry: keys, groups, labels, ranges, steps, neutral defaults,
// explainers and speculative flags. Two clients that disagree about a lever's
// range is a bug that only shows up in production — change all three together.
//
// NEUTRALITY. The server resolves a MISSING field to this tenant's neutral
// value, so an inactive lever is simply OMITTED from the POST body: omitting it
// and sending its default are the same simulation. Nothing may key off the mere
// PRESENCE of a field.

// ---------------------------------------------------------------------------
// Total-arithmetic helpers
// ---------------------------------------------------------------------------

/** A finite number out of whatever JSON handed over. */
export const simFinite = (value: unknown, fallback = 0): number => {
  if (typeof value === "number") {return Number.isFinite(value) ? value : fallback;}
  if (typeof value !== "string" || value.trim() === "") {return fallback;}
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** JS `${n}` with float noise cleaned: "5", "-1.3", "0.5". */
export const simNumStr = (v: number): string => {
  if (!Number.isFinite(v) || v === 0) {return "0";}
  return String(Number(v.toFixed(4)));
};

const pct = (v: number): string => `${v > 0 ? "+" : ""}${simNumStr(v)}%`;

export type MoneyFormat = (v: number) => string;

// ---------------------------------------------------------------------------
// Neutral constants — mirrored from simulation_math.ts, name for name.
// ---------------------------------------------------------------------------

export const DEFAULT_ELASTICITY = -1.3;
export const DEFAULT_WAGE_PER_SHIFT = 450;
export const DEFAULT_TAT_MIN = 45;
export const DEFAULT_FOOD_COST_PCT = 32;
export const DEFAULT_PARTY_SIZE = 3;
export const DEFAULT_CAPTAIN_SHARE_PCT = 20;
export const DEFAULT_KITCHEN_STATIONS = 3;
export const BASELINE_WASTE_PCT = 3;
export const BASELINE_NO_SHOW_PCT = 10;
export const BASELINE_RETENTION_PCT = 40;
export const DEFAULT_TAX_RATE_PCT = 5;
export const DEFAULT_ACQUISITION_PER_1000 = 2;
export const DEFAULT_AGGREGATOR_COMMISSION_PCT = 20;

export type PlanTier = "starter" | "growth" | "enterprise";

/** Subscription tiers (backend PLAN_TIERS). multi_outlet is Enterprise-only. */
export const PLAN_TIERS: Record<PlanTier, { label: string; monthlyFee: number; multiOutlet: boolean }> = {
  starter: { label: "Starter", monthlyFee: 0, multiOutlet: false },
  growth: { label: "Growth", monthlyFee: 1499, multiOutlet: false },
  enterprise: { label: "Enterprise", monthlyFee: 3999, multiOutlet: true },
};

export const PLAN_TIER_ORDER: PlanTier[] = ["starter", "growth", "enterprise"];

/** Unknown tiers resolve to Starter; "pro"/"premium" alias the top tier. */
export const toPlanTier = (value: unknown): PlanTier => {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (key === "growth") {return "growth";}
  if (key === "enterprise" || key === "pro" || key === "premium") {return "enterprise";}
  return "starter";
};

// ---------------------------------------------------------------------------
// Catalogue shapes
// ---------------------------------------------------------------------------

export const PARAM_GROUPS = [
  "Pricing & demand",
  "Staffing",
  "Operations",
  "Marketing & growth",
  "Overhead",
  "Scale",
] as const;
export type ParamGroup = (typeof PARAM_GROUPS)[number];

interface BaseParam {
  /** The POST body field name. */
  key: string;
  group: ParamGroup;
  label: string;
  /** One line under the control. */
  explainer: string;
  /** A rough sketch rather than a measured relationship. */
  speculative?: boolean;
}

export interface NumberParam extends BaseParam {
  kind: "number";
  min: number;
  max: number;
  step: number;
  /** Neutral value, or null when it is the tenant's own measured figure. */
  defaultValue: number | null;
  /** Baseline field a per-tenant default is derived from. */
  defaultFrom?: string;
  /** Overrides a measured baseline field: domain widens to include it. */
  overridesMeasured?: boolean;
  format: (v: number, money: MoneyFormat) => string;
}

export interface EnumParam extends BaseParam {
  kind: "enum";
  options: { value: string; label: string }[];
  defaultValue: string;
}

export interface ToggleParam extends BaseParam {
  kind: "toggle";
  defaultValue: boolean;
}

export type ParamSpec = NumberParam | EnumParam | ToggleParam;

export type ParamValue = number | string | boolean;
export type ParamValues = Record<string, ParamValue>;

// ---------------------------------------------------------------------------
// The catalogue — the original eight first, unchanged.
// ---------------------------------------------------------------------------

export const PARAM_CATALOG: readonly ParamSpec[] = [
  // --- The original eight ---------------------------------------------------
  {
    kind: "number", key: "price_adjust_pct", group: "Pricing & demand",
    label: "Price adjustment", min: -20, max: 30, step: 1, defaultValue: 0,
    explainer: "Across-the-board menu price change. APC moves with it; demand responds via elasticity.",
    format: (v) => pct(v),
  },
  {
    kind: "number", key: "elasticity", group: "Pricing & demand",
    label: "Price elasticity", min: -2, max: -0.5, step: 0.1, defaultValue: DEFAULT_ELASTICITY,
    explainer: "How strongly demand reacts to price: −1.3 means a 10% price rise loses 13% of covers.",
    format: (v) => v.toFixed(1),
  },
  {
    kind: "number", key: "staff_count", group: "Staffing",
    label: "Staff count", min: 1, max: 60, step: 1, defaultValue: null, defaultFrom: "staff_count",
    explainer: "Rostered staff per day — drives the daily wage bill.",
    format: (v) => `${simNumStr(v)} staff`,
  },
  {
    kind: "number", key: "avg_wage_per_shift", group: "Staffing",
    label: "Average wage per shift", min: 100, max: 2000, step: 10,
    defaultValue: null, defaultFrom: "labour_cost_per_day",
    explainer: "What one staff member costs per shift. Its default is the wage that reproduces your measured labour bill.",
    format: (v, money) => `${money(v)}/shift`,
  },
  {
    kind: "number", key: "tat_target_min", group: "Operations",
    label: "Turnaround time target", min: 10, max: 60, step: 1,
    defaultValue: null, defaultFrom: "avg_tat_min",
    explainer: "Target seat-to-settle time. Faster turns seat more covers — but only as fast as staffing can actually achieve.",
    format: (v) => `${simNumStr(v)} min`,
  },
  {
    kind: "number", key: "extra_expediters", group: "Staffing",
    label: "Extra expediters", min: 0, max: 5, step: 1, defaultValue: 0,
    explainer: "Each expediter cuts achievable turnaround by 3 min (floor 10 min) and costs ₹2100/shift.",
    format: (v) => simNumStr(v),
  },
  {
    kind: "number", key: "marketing_spend", group: "Marketing & growth",
    label: "Marketing spend (one-time)", min: 0, max: 100000, step: 500, defaultValue: 0,
    explainer: "One-off campaign with diminishing returns. Not amortised into daily profit — payback shows as breakeven days.",
    format: (v, money) => money(v),
  },
  {
    kind: "number", key: "food_cost_pct", group: "Operations",
    label: "Food cost", min: 20, max: 60, step: 0.5, defaultValue: null, defaultFrom: "food_cost_pct",
    explainer: "Ingredient cost as a share of revenue.",
    format: (v) => `${simNumStr(v)}%`,
  },

  // --- Pricing & demand -----------------------------------------------------
  {
    kind: "number", key: "discount_depth_pct", group: "Pricing & demand",
    label: "Average discount depth", min: 0, max: 30, step: 1, defaultValue: 0,
    explainer: "Average % off a discounted bill. Works with the frequency lever; ingredient cost does not fall — a discount does not make food cheaper.",
    format: (v) => `${simNumStr(v)}%`,
  },
  {
    kind: "number", key: "discount_frequency_pct", group: "Pricing & demand",
    label: "Bills discounted", min: 0, max: 100, step: 5, defaultValue: 0,
    explainer: "Share of bills carrying a discount. Revenue falls by depth × frequency.",
    format: (v) => `${simNumStr(v)}% of bills`,
  },
  {
    kind: "number", key: "coupon_redemption_pct", group: "Pricing & demand",
    label: "Coupon redemption", min: 0, max: 50, step: 5, defaultValue: 0,
    explainer: "Share of bills that redeem a coupon.",
    format: (v) => `${simNumStr(v)}% of bills`,
  },
  {
    kind: "number", key: "coupon_avg_value", group: "Pricing & demand",
    label: "Average coupon value", min: 0, max: 500, step: 25, defaultValue: 0,
    explainer: "Flat ₹ a redeemed coupon takes off the bill.",
    format: (v, money) => money(v),
  },
  {
    kind: "number", key: "service_charge_pct", group: "Pricing & demand",
    label: "Service charge", min: 0, max: 10, step: 0.5, defaultValue: 0,
    explainer: "Charged on the discounted subtotal by the same billing pipeline the POS prints. Neutral at 0 — your baseline revenue is measured before service charge.",
    format: (v) => `${simNumStr(v)}%`,
  },
  {
    kind: "number", key: "tax_rate_pct", group: "Pricing & demand",
    label: "Tax rate (display only)", min: 0, max: 28, step: 0.5, defaultValue: DEFAULT_TAX_RATE_PCT,
    explainer: "Display only. The whole model is pre-tax, so this moves the tax line and nothing else — revenue and net profit are identical at every rate.",
    format: (v) => `${simNumStr(v)}%`,
  },
  {
    kind: "number", key: "avg_party_size", group: "Pricing & demand",
    label: "Average party size", min: 1, max: 8, step: 0.5, defaultValue: DEFAULT_PARTY_SIZE,
    explainer: "Covers per table. Bigger parties lift the seating ceiling; they do not create demand on their own.",
    format: (v) => `${simNumStr(v)} covers/table`,
  },
  {
    kind: "number", key: "loyalty_redemption_pct", group: "Pricing & demand",
    label: "Loyalty redemption", min: 0, max: 30, step: 5, defaultValue: 0,
    explainer: "Share of bills redeeming loyalty. Approximation: there is no loyalty ledger to measure, so one redemption is priced at ₹100.",
    format: (v) => `${simNumStr(v)}% of bills`,
  },

  // --- Staffing -------------------------------------------------------------
  {
    kind: "number", key: "captain_share_pct", group: "Staffing",
    label: "Captains on the floor", min: 0, max: 100, step: 5, defaultValue: DEFAULT_CAPTAIN_SHARE_PCT,
    explainer: "Captains can bark an order before approval, so a captain-heavy floor gets tickets to the kitchen sooner. Approximation: a full 0→100% swing is worth 4 min of turnaround.",
    format: (v) => `${simNumStr(v)}% of staff`,
  },
  {
    kind: "number", key: "shifts_per_day", group: "Staffing",
    label: "Shifts per day", min: 1, max: 2, step: 1, defaultValue: 1,
    explainer: "A second shift doubles both the covers ceiling and the wage bill.",
    format: (v) => `${simNumStr(v)} shift${v === 1 ? "" : "s"}/day`,
  },
  {
    kind: "number", key: "overtime_premium_pct", group: "Staffing",
    label: "Overtime premium", min: 0, max: 100, step: 10, defaultValue: 0,
    explainer: "Premium paid on the hourly rate for overtime hours.",
    format: (v) => pct(v),
  },
  {
    kind: "number", key: "overtime_hours_per_shift", group: "Staffing",
    label: "Overtime per shift", min: 0, max: 4, step: 0.5, defaultValue: 0,
    explainer: "Overtime hours per staff member per shift, priced off the shift wage over an 8-hour shift.",
    format: (v) => `${simNumStr(v)} hrs`,
  },
  {
    kind: "number", key: "staff_attendance_pct", group: "Staffing",
    label: "Attendance", min: 70, max: 100, step: 5, defaultValue: 100,
    explainer: "Absence cuts the covers you can actually serve. Payroll is unchanged — rostered staff are still paid.",
    format: (v) => `${simNumStr(v)}%`,
  },

  // --- Operations -----------------------------------------------------------
  {
    kind: "number", key: "table_count", group: "Operations",
    label: "Tables", min: 20, max: 150, step: 2,
    defaultValue: null, defaultFrom: "table_count", overridesMeasured: true,
    explainer: "Overrides your measured table count and caps the covers the room can achieve.",
    format: (v) => `${simNumStr(v)} tables`,
  },
  {
    kind: "number", key: "kitchen_stations", group: "Operations",
    label: "Kitchen stations", min: 1, max: 8, step: 1, defaultValue: DEFAULT_KITCHEN_STATIONS,
    explainer: "Approximation: each station above or below 3 moves achievable turnaround by 2 min. A separate lever from expediters — stations speed up cooking, expediters speed up the pass.",
    format: (v) => `${simNumStr(v)} stations`,
  },
  {
    kind: "number", key: "waste_pct", group: "Operations",
    label: "Food wastage", min: 0, max: 15, step: 0.5, defaultValue: BASELINE_WASTE_PCT,
    explainer: "Wastage as a share of revenue. Neutral at 3% — the level already priced into a measured food cost.",
    format: (v) => `${simNumStr(v)}%`,
  },
  {
    kind: "number", key: "ingredient_inflation_pct", group: "Operations",
    label: "Ingredient inflation", min: -10, max: 30, step: 1, defaultValue: 0,
    explainer: "Multiplies your effective food cost percentage.",
    format: (v) => pct(v),
  },
  {
    kind: "number", key: "no_show_pct", group: "Operations",
    label: "Booking no-shows", min: 0, max: 40, step: 5, defaultValue: BASELINE_NO_SHOW_PCT,
    explainer: "Neutral at 10%. Approximation: only the ~25% of covers that arrive from a booking can no-show; walk-ins cannot.",
    format: (v) => `${simNumStr(v)}%`,
  },

  // --- Marketing & growth ---------------------------------------------------
  {
    kind: "number", key: "acquisition_per_1000", group: "Marketing & growth",
    label: "Guests per ₹1,000 spent", min: 0, max: 10, step: 0.5, defaultValue: DEFAULT_ACQUISITION_PER_1000,
    explainer: "How efficiently marketing spend converts to walk-ins. It scales the diminishing-returns curve rather than replacing it, so 2 is today's assumed conversion and leaves the answer unchanged. Extra covers are still capped by what the room can absorb off-peak.",
    format: (v) => `${simNumStr(v)} guests`,
  },
  {
    kind: "number", key: "retention_pct", group: "Marketing & growth",
    label: "Repeat guests", min: 0, max: 100, step: 5, defaultValue: BASELINE_RETENTION_PCT,
    explainer: "Directional only: a full 0→100% swing moves demand by ±15% of the gap from today's 40%. Not a cohort model.",
    format: (v) => `${simNumStr(v)}%`,
  },
  {
    kind: "number", key: "aggregator_mix_pct", group: "Marketing & growth",
    label: "Delivery aggregator mix", min: 0, max: 60, step: 5, defaultValue: 0,
    explainer: "Share of covers taken through delivery aggregators. This re-mixes existing demand rather than adding covers, so only the commission bites.",
    format: (v) => `${simNumStr(v)}% of covers`,
  },
  {
    kind: "number", key: "aggregator_commission_pct", group: "Marketing & growth",
    label: "Aggregator commission", min: 15, max: 30, step: 1, defaultValue: DEFAULT_AGGREGATOR_COMMISSION_PCT,
    explainer: "Commission the aggregator keeps on its share of the discounted subtotal.",
    format: (v) => `${simNumStr(v)}%`,
  },

  // --- Overhead -------------------------------------------------------------
  {
    kind: "number", key: "fixed_costs_per_day", group: "Overhead",
    label: "Fixed costs", min: 0, max: 20000, step: 500,
    defaultValue: null, defaultFrom: "fixed_costs_per_day", overridesMeasured: true,
    explainer: "Overrides the fixed costs derived from your expense categories (rent, power, upkeep — everything that is neither food nor wages).",
    format: (v, money) => `${money(v)}/day`,
  },
  {
    kind: "number", key: "utilities_per_day", group: "Overhead",
    label: "Extra utilities", min: 0, max: 5000, step: 250, defaultValue: 0,
    explainer: "Added on top of fixed costs.",
    format: (v, money) => `${money(v)}/day`,
  },
  {
    kind: "enum", key: "plan_tier", group: "Overhead",
    label: "Subscription plan", defaultValue: "starter",
    options: [
      { value: "starter", label: "Starter" },
      { value: "growth", label: "Growth" },
      { value: "enterprise", label: "Enterprise" },
    ],
    explainer: "Adds the subscription fee ÷ 30 to daily fixed costs (Starter ₹0, Growth ₹1,499/mo, Enterprise ₹3,999/mo). Only Enterprise includes multi-outlet.",
  },

  // --- Scale ----------------------------------------------------------------
  {
    kind: "toggle", key: "second_outlet", group: "Scale",
    label: "Open a second outlet", defaultValue: false, speculative: true,
    explainer: "SPECULATIVE — this model has never been validated end to end. It assumes a second site reaches 60% of this one's covers while doubling site costs and labour. Treat it as a sketch, not a forecast.",
  },
];

const CATALOG_BY_KEY = new Map(PARAM_CATALOG.map((s) => [s.key, s]));
export const paramSpec = (key: string): ParamSpec | undefined => CATALOG_BY_KEY.get(key);

/** The eight levers the screen has always shown — the starting selection. */
export const INITIAL_ACTIVE_KEYS: readonly string[] = [
  "price_adjust_pct", "elasticity", "staff_count", "avg_wage_per_shift",
  "tat_target_min", "extra_expediters", "marketing_spend", "food_cost_pct",
];

// ---------------------------------------------------------------------------
// Defaults — per-tenant neutral values, mirroring the backend's resolveParams.
// NOT rounded: an untouched run must be a clean no-change run.
// ---------------------------------------------------------------------------

export type BaselineLike = Record<string, unknown> | null | undefined;

export const resolveDefaults = (b: BaselineLike): ParamValues => {
  const staffCount = Math.max(0, simFinite(b?.staff_count));
  const labourPerDay = simFinite(b?.labour_cost_per_day);
  return {
    price_adjust_pct: 0,
    elasticity: DEFAULT_ELASTICITY,
    staff_count: Math.round(clamp(staffCount, 1, 60)),
    avg_wage_per_shift: clamp(
      staffCount > 0 ? simFinite(labourPerDay / staffCount, DEFAULT_WAGE_PER_SHIFT) : DEFAULT_WAGE_PER_SHIFT,
      100, 2000,
    ),
    tat_target_min: clamp(simFinite(b?.avg_tat_min, DEFAULT_TAT_MIN), 10, 60),
    extra_expediters: 0,
    marketing_spend: 0,
    food_cost_pct: clamp(simFinite(b?.food_cost_pct, DEFAULT_FOOD_COST_PCT), 20, 60),

    discount_depth_pct: 0,
    discount_frequency_pct: 0,
    coupon_redemption_pct: 0,
    coupon_avg_value: 0,
    // 0 — the baseline is measured PRE-service charge.
    service_charge_pct: 0,
    tax_rate_pct: DEFAULT_TAX_RATE_PCT,
    avg_party_size: DEFAULT_PARTY_SIZE,
    loyalty_redemption_pct: 0,

    captain_share_pct: DEFAULT_CAPTAIN_SHARE_PCT,
    shifts_per_day: 1,
    overtime_premium_pct: 0,
    overtime_hours_per_shift: 0,
    staff_attendance_pct: 100,

    // Overrides a measurement -> unclamped.
    table_count: Math.round(simFinite(b?.table_count, 20)),
    kitchen_stations: DEFAULT_KITCHEN_STATIONS,
    waste_pct: BASELINE_WASTE_PCT,
    ingredient_inflation_pct: 0,
    no_show_pct: BASELINE_NO_SHOW_PCT,

    acquisition_per_1000: DEFAULT_ACQUISITION_PER_1000,
    retention_pct: BASELINE_RETENTION_PCT,
    aggregator_mix_pct: 0,
    aggregator_commission_pct: DEFAULT_AGGREGATOR_COMMISSION_PCT,

    // Overrides a measurement -> unclamped.
    fixed_costs_per_day: simFinite(b?.fixed_costs_per_day),
    utilities_per_day: 0,
    plan_tier: "starter",
    second_outlet: false,
  };
};

// ---------------------------------------------------------------------------
// Typed accessors
// ---------------------------------------------------------------------------

export const numberValue = (values: ParamValues, key: string, fallback = 0): number => {
  const v = values[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
};

export const planTierValue = (values: ParamValues): PlanTier => toPlanTier(values.plan_tier);

export const toggleValue = (values: ParamValues, key: string): boolean => values[key] === true;

export interface SliderDomain { min: number; max: number }

/** Widens to include the measured default for the two override levers. */
export const sliderDomain = (spec: NumberParam, defaultValue: number): SliderDomain => {
  if (!spec.overridesMeasured) {return { min: spec.min, max: spec.max };}
  const d = simFinite(defaultValue, spec.min);
  return { min: Math.min(spec.min, d), max: Math.max(spec.max, d) };
};

/** Snap onto the step grid anchored at the domain's own minimum. */
export const snapToStep = (spec: NumberParam, domain: SliderDomain, raw: number): number => {
  const step = spec.step > 0 ? spec.step : 1;
  const k = Math.round((raw - domain.min) / step);
  const v = clamp(domain.min + k * step, domain.min, domain.max);
  return Number(v.toFixed(4));
};

/** True when a lever sits somewhere other than its per-tenant default. */
export const isChanged = (values: ParamValues, defaults: ParamValues, key: string): boolean => {
  const v = values[key];
  const d = defaults[key];
  if (typeof v === "number" && typeof d === "number") {return Math.abs(v - d) > 1e-9;}
  return v !== d;
};

export const changedCount = (values: ParamValues, defaults: ParamValues): number =>
  PARAM_CATALOG.filter((s) => isChanged(values, defaults, s.key)).length;

// ---------------------------------------------------------------------------
// Grouping / search
// ---------------------------------------------------------------------------

export interface ParamGroupBlock { group: ParamGroup; specs: ParamSpec[] }

/** Catalogue by category, each sorted by label; empty categories dropped. */
export const groupedParams = (
  query = "",
  filter?: (spec: ParamSpec) => boolean,
): ParamGroupBlock[] => {
  const needle = query.trim().toLowerCase();
  const matches = (spec: ParamSpec): boolean => {
    if (filter && !filter(spec)) {return false;}
    if (!needle) {return true;}
    return `${spec.label} ${spec.group} ${spec.explainer}`.toLowerCase().includes(needle);
  };
  const out: ParamGroupBlock[] = [];
  for (const group of PARAM_GROUPS) {
    const specs = PARAM_CATALOG.filter((s) => s.group === group && matches(s)).sort((a, b) =>
      a.label < b.label ? -1 : a.label > b.label ? 1 : 0,
    );
    if (specs.length > 0) {out.push({ group, specs });}
  }
  return out;
};

// ---------------------------------------------------------------------------
// POST body
// ---------------------------------------------------------------------------

export type RunBody = Record<string, number | string | boolean>;

/** ONLY the active levers travel; omitted = the tenant's neutral default. */
export const buildRunBody = (active: ReadonlySet<string>, values: ParamValues): RunBody => {
  const body: RunBody = {};
  for (const spec of PARAM_CATALOG) {
    if (!active.has(spec.key)) {continue;}
    switch (spec.kind) {
      case "number": {
        const v = numberValue(values, spec.key, spec.defaultValue ?? 0);
        body[spec.key] = Number(v.toFixed(4));
        break;
      }
      case "enum":
        body[spec.key] = planTierValue(values);
        break;
      case "toggle":
        body[spec.key] = toggleValue(values, spec.key);
        break;
    }
  }
  return body;
};

/** The tier the SERVER will see: an inactive plan lever resolves to starter. */
export const effectivePlanTier = (active: ReadonlySet<string>, values: ParamValues): PlanTier =>
  active.has("plan_tier") ? planTierValue(values) : "starter";

export const allowsSecondOutlet = (active: ReadonlySet<string>, values: ParamValues): boolean =>
  PLAN_TIERS[effectivePlanTier(active, values)].multiOutlet;
