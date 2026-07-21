"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, Line, LineChart, Pie, PieChart, Cell, Tooltip, ResponsiveContainer, LabelList } from "recharts"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import { useAuth } from "@/context/AuthContext"
import { useCurrency } from "@/hooks/use-currency"
import { getMenuInsights, type MenuInsights, type PriceSuggestion, applyMenuItemPrice, getOperationsAnalytics, type OperationsAnalytics, getApcTrends, type ApcTrendPoint, getAdvancedAnalytics, type AdvancedAnalytics, getOutletsComparison, type OutletComparison, createCampaign, deleteCampaign } from "@/lib/db"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { ArrowDown, ArrowUp, Check, ChevronDown, Flame, Trophy, Lightbulb, Snail } from "lucide-react"

const ordersChartConfig = {
  orders: {
    label: "Orders",
    color: "hsl(var(--primary))",
  },
}

const trendsChartConfig = {
  total_revenue: { label: "Revenue", color: "hsl(var(--primary))" },
  monthly_apc: { label: "APC", color: "hsl(var(--primary))" },
}

const KPI_COLORS: Record<string, string> = {
  blue: "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200",
  green: "border-green-300 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200",
  amber: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
  red: "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
  grey: "border-border bg-muted text-muted-foreground",
}
const KPI_STATUS_LABEL: Record<string, string> = { blue: "Excellent", green: "On target", amber: "Watch", red: "Action", grey: "No data" }

// Drill-down targets: clicking a KPI tile jumps to the page holding its source
// records. Data-driven by KPI key — keys without an entry render unlinked
// (e.g. churn/campaign, whose detail already lives on this page).
const KPI_LINKS: Record<string, string> = {
  food_cost_pct: "/dashboard/inventory",
  food_cost_variance: "/dashboard/inventory",
  low_stock: "/dashboard/inventory",
  complaint_rate: "/dashboard/feedback",
  nps: "/dashboard/feedback",
  avg_rating: "/dashboard/feedback",
  discount_utilization: "/dashboard/orders",
  labour_cost: "/dashboard/attendance",
  table_turnaround: "/dashboard/tables",
  revpash: "/dashboard/tables",
  supplier_on_time: "/dashboard/purchase-orders",
  supplier_score: "/dashboard/purchase-orders",
  booking_fill: "/dashboard/bookings",
  booking_no_show: "/dashboard/bookings",
  valet_retrieval: "/dashboard/valet",
  profit_margin: "/dashboard/accounting",
}

// ---------------------------------------------------------------------------
// View filter ("show only this slice") + KPI sort — pure presentation. Every
// section and KPI key is tagged into exactly ONE detail view; Overview is a
// curated headline cut and Everything shows it all, so nothing is unreachable.
type ViewId = "overview" | "sales" | "discounts" | "menu" | "staff" | "customers" | "operations" | "supply" | "marketing" | "everything"

const VIEWS: { id: ViewId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "sales", label: "Sales & Revenue" },
  { id: "discounts", label: "Discounts & Offers" },
  { id: "menu", label: "Menu" },
  { id: "staff", label: "Staff" },
  { id: "customers", label: "Customers" },
  { id: "operations", label: "Operations" },
  { id: "supply", label: "Suppliers & Inventory" },
  { id: "marketing", label: "Marketing" },
  { id: "everything", label: "Everything" },
]

// Home view per KPI key (exactly one each).
const KPI_VIEW: Record<string, ViewId> = {
  revpash: "sales",
  profit_margin: "sales",
  discount_utilization: "discounts",
  offer_redemption: "discounts",
  menu_bad_share: "menu",
  forecast_mape: "menu",
  labour_cost: "staff",
  happiness_efficiency: "staff",
  avg_rating: "customers",
  nps: "customers",
  complaint_rate: "customers",
  churn_rate: "customers",
  wait_time: "operations",
  table_turnaround: "operations",
  processing_time: "operations",
  booking_fill: "operations",
  booking_no_show: "operations",
  valet_retrieval: "operations",
  supplier_on_time: "supply",
  supplier_score: "supply",
  low_stock: "supply",
  food_cost_pct: "supply",
  food_cost_variance: "supply",
  campaign_roi: "marketing",
}

// Headline KPIs shown on the Overview view.
const OVERVIEW_KPIS = new Set([
  "profit_margin", "revpash", "food_cost_pct", "labour_cost",
  "avg_rating", "nps", "table_turnaround", "churn_rate", "low_stock",
])

// New backend KPIs without a mapping surface on Overview (and Everything)
// rather than silently disappearing.
const kpiInView = (key: string, view: ViewId) =>
  view === "everything" ? true
  : view === "overview" ? OVERVIEW_KPIS.has(key) || !(key in KPI_VIEW)
  : KPI_VIEW[key] === view

const inView = (view: ViewId, home: ViewId, onOverview = false) =>
  view === "everything" || view === home || (view === "overview" && onOverview)

// Permission helpers — same shape the dashboard layout uses to gate modules:
// the role may be the primary one or any in role_all, and an employee passes an
// action gate when one of their granted action names contains a keyword.
// (An empty action list means "unrestricted", matching the layout.)
type PermUser = { role?: string; role_all?: string[]; actions_set?: string[]; action_names?: string[] } | null | undefined

const hasRole = (user: PermUser, role: string) => {
  if (!user) return false
  if (user.role === role) return true
  return Array.isArray(user.role_all) ? user.role_all.includes(role) : false
}

const canAccessByAction = (user: PermUser, keywords: string[]) => {
  if (!user) return false
  if (Array.isArray(user.actions_set) && user.actions_set.includes("*")) return true
  const names = (user.action_names ?? []).map((n) => n.trim().toLowerCase()).filter((n) => n.length > 0)
  if (names.length === 0) return true
  return names.some((name) => keywords.some((k) => name.includes(k.toLowerCase())))
}

type KpiSort = "severity" | "name" | "value"
const KPI_SORTS: { id: KpiSort; label: string }[] = [
  { id: "severity", label: "Severity" },
  { id: "name", label: "Name" },
  { id: "value", label: "Value" },
]
// Worst band first; "no data" (grey) sinks to the end. Sort is stable, so
// ties keep the server's order.
const SEVERITY_RANK: Record<string, number> = { red: 0, amber: 1, green: 2, blue: 3, grey: 4 }

type Kpi = AdvancedAnalytics["kpis"][number]
function sortKpis(kpis: Kpi[], sort: KpiSort): Kpi[] {
  const arr = [...kpis]
  if (sort === "severity") arr.sort((a, b) => (SEVERITY_RANK[a.status] ?? 5) - (SEVERITY_RANK[b.status] ?? 5))
  else if (sort === "name") arr.sort((a, b) => a.label.localeCompare(b.label))
  else arr.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity))
  return arr
}

// ---------------------------------------------------------------------------
// Reusable per-section sort control. Each list declares a set of sortable
// fields; a field maps a row to a comparable primitive (number | string).
// Sorting is client-side on the already-fetched array — never a refetch.
type SortDir = "asc" | "desc"
type SortField<T> = {
  id: string
  label: string
  // string => localeCompare; number-ish => numeric (nulls sink to the bottom
  // regardless of direction, so "no data" never crowds out real rows).
  get: (row: T) => number | string | null | undefined
  type: "num" | "text"
}

// A section's sort choice: which field + which direction, plus its default.
type SortState = { field: string; dir: SortDir }

// Order an array by the chosen field+direction. Stable within ties (keeps the
// server's order). Nullish numeric/text values always sort last.
function sortRows<T>(rows: T[], fields: SortField<T>[], state: SortState): T[] {
  const f = fields.find((x) => x.id === state.field) ?? fields[0]
  if (!f) return rows
  const dir = state.dir === "asc" ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = f.get(a), bv = f.get(b)
    const aNull = av == null || av === "", bNull = bv == null || bv === ""
    if (aNull && bNull) return 0
    if (aNull) return 1 // nulls always last, ignoring dir
    if (bNull) return -1
    if (f.type === "text") return String(av).localeCompare(String(bv)) * dir
    return (Number(av) - Number(bv)) * dir
  })
}

// Small hook: holds a section's sort state, seeded from its default field/dir.
function useSectionSort(defField: string, defDir: SortDir = "desc") {
  return useState<SortState>({ field: defField, dir: defDir })
}

// Compact inline sort control rendered in a card header. Shows a field picker
// only when there's more than one sortable metric, plus an asc/desc toggle.
// Styled to match the muted toolbar controls already on the page.
function SortControl<T>({ fields, state, onChange }: { fields: SortField<T>[]; state: SortState; onChange: (s: SortState) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {fields.length > 1 && (
        <div className="flex items-center rounded-lg border p-0.5">
          {fields.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onChange({ ...state, field: f.id })}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${state.field === f.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => onChange({ ...state, dir: state.dir === "asc" ? "desc" : "asc" })}
        title={state.dir === "asc" ? "Ascending — click for descending" : "Descending — click for ascending"}
        aria-label={state.dir === "asc" ? "Sorted ascending" : "Sorted descending"}
        className="flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {state.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
        <span className="hidden sm:inline">{state.dir === "asc" ? "Asc" : "Desc"}</span>
      </button>
    </div>
  )
}

// Header layout wrapper: title/description block on the left, sort control on
// the right (wraps below on narrow cards). Mirrors the existing CardHeader look.
function SectionHeaderRow({ children, control }: { children: ReactNode; control: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 flex-1">{children}</div>
      {control}
    </div>
  )
}

function ActionableInsights({ view }: { view: ViewId }) {
  const { user } = useAuth();
  const { currency } = useCurrency();
  const { toast } = useToast();
  const [data, setData] = useState<MenuInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  // Price suggestion pending confirmation + the row currently being written.
  const [pendingPrice, setPendingPrice] = useState<PriceSuggestion | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const money = (n: number | null | undefined) => `${currency}${Number(n ?? 0).toFixed(0)}`;
  const money2 = (n: number | null | undefined) => `${currency}${Number(n ?? 0).toFixed(2)}`;

  // Per-section sort state (defaults = most meaningful metric).
  const [dishSort, setDishSort] = useSectionSort("revenue");
  const [waiterSort, setWaiterSort] = useSectionSort("revenue");
  const [priceSort, setPriceSort] = useSectionSort("delta");
  const [slowSort, setSlowSort] = useSectionSort("quantity", "asc");

  // Applying a suggestion edits the live menu — same gate the Menu module uses
  // (admins always pass; otherwise the employee needs a menu-ish action).
  const canEditMenu = hasRole(user, "admin") || canAccessByAction(user, ["menu"]);

  useEffect(() => {
    if (!user?.restaurantUsername) return;
    let active = true;
    setLoading(true);
    getMenuInsights(user.restaurantUsername, 30)
      .then((d) => { if (active) setData(d); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.restaurantUsername, reload]);

  const confirmApplyPrice = async () => {
    const s = pendingPrice;
    if (!s?.id || !user?.restaurantUsername) return;
    setApplyingId(s.id);
    try {
      await applyMenuItemPrice(user.restaurantUsername, s.id, s.suggested_price);
      toast({ title: "Price updated", description: `${s.name} is now ${money2(s.suggested_price)} on the live menu.` });
      setPendingPrice(null);
      setReload((n) => n + 1); // refresh insights so the suggestion re-evaluates
    } catch (err: unknown) {
      toast({ title: "Unable to update the price", description: String((err as Error)?.message ?? err), variant: "destructive" });
    } finally {
      setApplyingId(null);
    }
  };

  // Per-view slices of this component (after hooks — hook order must not vary).
  const showStats = inView(view, "sales");
  const showDishes = inView(view, "menu", true);
  const showWaiters = inView(view, "staff");
  const showPrices = inView(view, "menu");
  const showSlow = inView(view, "menu");
  if (!showStats && !showDishes && !showWaiters && !showPrices && !showSlow) return null;

  if (loading) return <Card><CardContent className="py-10 text-center text-muted-foreground">Loading insights…</CardContent></Card>;
  if (!data) return null;

  const hasAny = data.top_dishes.length > 0 || data.price_suggestions.length > 0 || data.top_waiters.length > 0;

  // Sortable-field definitions per list.
  const dishFields: SortField<MenuInsights["top_dishes"][number]>[] = [
    { id: "revenue", label: "Revenue", type: "num", get: (d) => d.revenue },
    { id: "quantity", label: "Qty", type: "num", get: (d) => d.quantity },
    { id: "name", label: "Name", type: "text", get: (d) => d.name },
  ];
  const waiterFields: SortField<MenuInsights["top_waiters"][number]>[] = [
    { id: "revenue", label: "Revenue", type: "num", get: (w) => w.revenue },
    { id: "orders", label: "Orders", type: "num", get: (w) => w.orders },
    { id: "name", label: "Name", type: "text", get: (w) => w.employee_name },
  ];
  const priceFields: SortField<MenuInsights["price_suggestions"][number]>[] = [
    { id: "delta", label: "Change", type: "num", get: (s) => s.suggested_price - s.current_price },
    { id: "current_price", label: "Current", type: "num", get: (s) => s.current_price },
    { id: "suggested_price", label: "Suggested", type: "num", get: (s) => s.suggested_price },
    { id: "name", label: "Name", type: "text", get: (s) => s.name },
  ];
  const slowFields: SortField<MenuInsights["slow_movers"][number]>[] = [
    { id: "quantity", label: "Qty", type: "num", get: (d) => d.quantity },
    { id: "current_price", label: "Price", type: "num", get: (d) => d.current_price },
    { id: "name", label: "Name", type: "text", get: (d) => d.name },
  ];
  const topDishes = sortRows(data.top_dishes, dishFields, dishSort).slice(0, 8);
  const topWaiters = sortRows(data.top_waiters, waiterFields, waiterSort).slice(0, 8);
  const priceSuggestions = sortRows(data.price_suggestions, priceFields, priceSort);
  const slowMovers = sortRows(data.slow_movers, slowFields, slowSort);

  return (
    <div className="grid gap-4 md:gap-8">
      {showStats && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Card><CardHeader className="pb-2"><CardDescription>Revenue (30d)</CardDescription><CardTitle className="text-2xl">{money(data.total_revenue)}</CardTitle></CardHeader></Card>
          <Card><CardHeader className="pb-2"><CardDescription>Items sold (30d)</CardDescription><CardTitle className="text-2xl">{data.total_items_sold}</CardTitle></CardHeader></Card>
          <Card><CardHeader className="pb-2"><CardDescription>Distinct dishes</CardDescription><CardTitle className="text-2xl">{data.top_dishes.length}</CardTitle></CardHeader></Card>
        </div>
      )}

      {!hasAny && (showDishes || showWaiters || showPrices) && (
        <Card><CardContent className="py-8 text-center text-muted-foreground">No sales in the last 30 days yet — insights will appear as orders come in.</CardContent></Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 md:gap-8">
        {showDishes && data.top_dishes.length > 0 && (
          <Card>
            <CardHeader>
              <SectionHeaderRow control={<SortControl fields={dishFields} state={dishSort} onChange={setDishSort} />}>
                <CardTitle className="flex items-center gap-2"><Flame className="h-5 w-5 text-orange-500" /> Top-selling dishes</CardTitle>
                <CardDescription>Best performers over the last 30 days.</CardDescription>
              </SectionHeaderRow>
            </CardHeader>
            <CardContent className="space-y-2">
              {topDishes.map((d, i) => (
                <div key={d.name} className="flex items-center gap-3 rounded-lg border p-2 text-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{i + 1}</span>
                  <div className="min-w-0 flex-1"><p className="truncate font-medium">{d.name}</p><p className="text-xs text-muted-foreground">{d.quantity} sold{d.category ? ` · ${d.category}` : ""}</p></div>
                  <span className="font-semibold">{money(d.revenue)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {showWaiters && data.top_waiters.length > 0 && (
          <Card>
            <CardHeader>
              <SectionHeaderRow control={<SortControl fields={waiterFields} state={waiterSort} onChange={setWaiterSort} />}>
                <CardTitle className="flex items-center gap-2"><Trophy className="h-5 w-5 text-amber-500" /> Top waiters</CardTitle>
                <CardDescription>By revenue brought in (last 30 days).</CardDescription>
              </SectionHeaderRow>
            </CardHeader>
            <CardContent className="space-y-2">
              {topWaiters.map((w, i) => (
                <div key={w.employee_id} className="flex items-center gap-3 rounded-lg border p-2 text-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{i + 1}</span>
                  <div className="min-w-0 flex-1"><p className="truncate font-medium">{w.employee_name}</p><p className="text-xs text-muted-foreground">{w.orders} orders</p></div>
                  <span className="font-semibold">{money(w.revenue)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {showPrices && data.price_suggestions.length > 0 && (
          <Card className="md:col-span-2">
            <CardHeader>
              <SectionHeaderRow control={<SortControl fields={priceFields} state={priceSort} onChange={setPriceSort} />}>
                <CardTitle className="flex items-center gap-2"><Lightbulb className="h-5 w-5 text-yellow-500" /> Price suggestions</CardTitle>
                <CardDescription>Data-driven ideas to grow revenue. Review before applying.</CardDescription>
              </SectionHeaderRow>
            </CardHeader>
            <CardContent className="grid gap-2 md:grid-cols-2">
              {priceSuggestions.map((s) => {
                const up = s.direction === "increase";
                return (
                  <div key={`${s.name}-${s.direction}`} className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                    {up ? <ArrowUp className="mt-0.5 h-4 w-4 shrink-0 text-green-600" /> : <ArrowDown className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.reason}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-muted-foreground line-through">{money(s.current_price)}</p>
                      <p className={`font-bold ${up ? "text-green-600" : "text-orange-600"}`}>{money(s.suggested_price)}</p>
                    </div>
                    {canEditMenu && s.id && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 self-center"
                        disabled={applyingId === s.id}
                        onClick={() => setPendingPrice(s)}
                      >
                        <Check className="mr-1 h-3.5 w-3.5" />
                        {applyingId === s.id ? "Applying…" : "Apply"}
                      </Button>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {showSlow && data.slow_movers.length > 0 && (
          <Card className="md:col-span-2">
            <CardHeader>
              <SectionHeaderRow control={<SortControl fields={slowFields} state={slowSort} onChange={setSlowSort} />}>
                <CardTitle className="flex items-center gap-2"><Snail className="h-5 w-5 text-muted-foreground" /> Slow movers</CardTitle>
                <CardDescription>On the menu but rarely ordered — consider promoting, re-pricing, or removing.</CardDescription>
              </SectionHeaderRow>
            </CardHeader>
            <CardContent className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {slowMovers.map((d) => (
                <div key={d.name} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                  <div className="min-w-0"><p className="truncate font-medium">{d.name}</p><p className="text-xs text-muted-foreground">{d.quantity} sold</p></div>
                  <span className="text-muted-foreground">{money(d.current_price)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={pendingPrice != null} onOpenChange={(open) => { if (!open) setPendingPrice(null); }}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Apply this price?</DialogTitle>
          </DialogHeader>
          {pendingPrice && (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border p-3">
                <p className="font-medium">{pendingPrice.name}</p>
                {pendingPrice.category && <p className="text-xs text-muted-foreground">{pendingPrice.category}</p>}
                <p className="mt-2 flex items-center gap-2">
                  <span className="text-muted-foreground line-through">{money2(pendingPrice.current_price)}</span>
                  <span aria-hidden="true">→</span>
                  <span className={`text-lg font-bold ${pendingPrice.direction === "increase" ? "text-green-600" : "text-orange-600"}`}>
                    {money2(pendingPrice.suggested_price)}
                  </span>
                </p>
              </div>
              <p className="text-muted-foreground">{pendingPrice.reason}</p>
              <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
                This changes the <strong>live menu</strong> straight away — new orders, the guest QR menu and every bill will use the new price. Existing open bills keep the price they were placed at.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingPrice(null)} disabled={applyingId != null}>Cancel</Button>
            <Button onClick={() => { void confirmApplyPrice(); }} disabled={applyingId != null}>
              {applyingId != null ? "Applying…" : "Apply price"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Real operational charts (replaces the previous hardcoded mock data): peak order
// times by hour and order volume by day of week, computed from actual orders.
function OperationsCharts({ view }: { view: ViewId }) {
  const { user } = useAuth();
  const [data, setData] = useState<OperationsAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.restaurantUsername) return;
    let active = true;
    setLoading(true);
    getOperationsAnalytics(user.restaurantUsername, 30)
      .then((d) => { if (active) setData(d); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.restaurantUsername]);

  if (!inView(view, "operations")) return null;

  const byHour = (data?.by_hour ?? []).map((h) => ({ time: `${String(h.hour).padStart(2, "0")}:00`, orders: h.orders }));
  const byWeekday = (data?.by_weekday ?? []).map((w) => ({ day: w.label, orders: w.orders }));
  const hasData = (data?.by_hour ?? []).some((h) => h.orders > 0);

  const empty = (
    <div className="py-10 text-center text-muted-foreground">No orders in the last 30 days yet.</div>
  );
  const spinner = (
    <div className="py-10 text-center text-muted-foreground">Loading…</div>
  );

  return (
    <div className="grid gap-4 md:gap-8">
      <Card>
        <CardHeader>
          <CardTitle>Peak Order Times</CardTitle>
          <CardDescription>Order volume by hour of day (UTC), last 30 days.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? spinner : !hasData ? empty : (
            <ChartContainer config={ordersChartConfig} className="h-[260px] w-full">
              <LineChart data={byHour} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" interval={2} />
                <YAxis allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="orders" stroke="var(--color-orders)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Orders by Day of Week</CardTitle>
          <CardDescription>Which days are busiest, last 30 days.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? spinner : !hasData ? empty : (
            <ChartContainer config={ordersChartConfig} className="h-[280px] w-full">
              <BarChart data={byWeekday} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="day" />
                <YAxis allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="orders" fill="var(--color-orders)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PerformanceTrends({ view }: { view: ViewId }) {
  const { user } = useAuth();
  const { currency } = useCurrency();
  const [data, setData] = useState<ApcTrendPoint[] | null>(null);
  const [loading, setLoading] = useState(true);
  const money = (n: number | null | undefined) => `${currency}${Number(n ?? 0).toFixed(0)}`;

  useEffect(() => {
    if (!user?.restaurantUsername) return;
    let active = true;
    setLoading(true);
    getApcTrends(user.restaurantUsername, 12)
      .then((d) => { if (active) setData(d); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.restaurantUsername]);

  const showRevenue = inView(view, "sales", true); // headline chart on Overview
  const showApc = inView(view, "sales");
  if (!showRevenue && !showApc) return null;

  const series = data ?? [];
  const hasData = series.some((p) => p.total_revenue > 0 || p.bills > 0);
  const spinner = <div className="py-10 text-center text-muted-foreground">Loading…</div>;
  const empty = <div className="py-10 text-center text-muted-foreground">No revenue recorded in the last 12 months yet.</div>;

  return (
    <div className="grid gap-4 md:gap-8">
      {showRevenue && (
      <Card>
        <CardHeader>
          <CardTitle>Revenue over time</CardTitle>
          <CardDescription>Monthly revenue across the last 12 months.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? spinner : !hasData ? empty : (
            <ChartContainer config={trendsChartConfig} className="h-[280px] w-full">
              <BarChart data={series} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" />
                <YAxis />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="total_revenue" fill="var(--color-total_revenue)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
      )}
      {showApc && (
      <Card>
        <CardHeader>
          <CardTitle>APC over time</CardTitle>
          <CardDescription>Average-per-cover (revenue &divide; covers) by month, with the underlying numbers.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? spinner : !hasData ? empty : (
            <>
              <ChartContainer config={trendsChartConfig} className="h-[220px] w-full">
                <LineChart data={series} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line type="monotone" dataKey="monthly_apc" stroke="var(--color-monthly_apc)" strokeWidth={2} dot={false} />
                </LineChart>
              </ChartContainer>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-2 pr-3">Month</th>
                      <th className="py-2 pr-3 text-right">Revenue</th>
                      <th className="py-2 pr-3 text-right">Covers</th>
                      <th className="py-2 pr-3 text-right">APC</th>
                      <th className="py-2 pr-3 text-right">Bills</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...series].reverse().map((p) => (
                      <tr key={p.month} className="border-b last:border-0">
                        <td className="py-2 pr-3 whitespace-nowrap font-medium">{p.month}</td>
                        <td className="py-2 pr-3 text-right">{money(p.total_revenue)}</td>
                        <td className="py-2 pr-3 text-right">{p.total_covers}</td>
                        <td className="py-2 pr-3 text-right">{money(p.monthly_apc)}</td>
                        <td className="py-2 pr-3 text-right">{p.bills}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI drill-down: clicking a tile opens a Dialog with a chart derived from the
// SAME `AdvancedAnalytics` object already on the page (no new fetch). The chart
// per KPI is data-driven by the registry below. Categorical palette shared by
// pie slices and bar fills.
const DRILL_PALETTE = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#ea580c", "#4f46e5"]

// One-line meanings for KPIs that have no per-row breakdown (they still open the
// modal, just as a value + status + explanation). Falls back to a generic line.
const KPI_MEANINGS: Record<string, string> = {
  labour_cost: "Total staff wage cost as a share of revenue in this window.",
  happiness_efficiency: "How strongly faster service tracks with happier guests.",
  wait_time: "Average time guests waited before being seated.",
  processing_time: "Average time from order placed to served.",
  booking_fill: "Share of bookable capacity that was actually reserved.",
  booking_no_show: "Share of reservations where the guest never arrived.",
  valet_retrieval: "Average time taken to return a guest's vehicle.",
  supplier_on_time: "Share of purchase-order deliveries that arrived on time.",
  supplier_score: "Blended vendor rating: 0.6 × on-time + 0.4 × quality.",
}

type DrillUnit = "money" | "pct" | "min" | "rating" | "count"
type DrillRow = { name: string; value: number }
type DrillSpec = { type: "pie" | "bar" | "none"; rows: DrillRow[]; unit: DrillUnit }

// Maps a KPI key -> the chart + rows to show. Empty `rows` on a pie/bar renders
// a graceful "no breakdown yet"; `type: "none"` renders the value + meaning.
function kpiDrilldownSpec(kpi: Kpi, data: AdvancedAnalytics): DrillSpec {
  const num = (n: number | null | undefined) => Number(n ?? 0)
  switch (kpi.key) {
    case "profit_margin": {
      const p = data.profit
      if (!p) return { type: "none", rows: [], unit: "money" }
      return {
        type: "pie",
        unit: "money",
        rows: [
          { name: "Profit", value: Math.max(0, num(p.revenue) - num(p.expenses)) },
          { name: "Expenses", value: num(p.expenses) },
        ],
      }
    }
    case "discount_utilization":
    case "offer_redemption": {
      const offers = data.offers ?? []
      if (offers.length > 0) return { type: "pie", unit: "count", rows: offers.map((o) => ({ name: o.code, value: num(o.used) })) }
      const d = data.discounts // fallback when no coupons exist yet
      return {
        type: "bar",
        unit: "count",
        rows: [
          { name: "Bills w/ discount", value: num(d.discount_bills) },
          { name: "Total bills", value: num(d.total_bills) },
          { name: "Redemptions", value: num(d.redemptions) },
        ],
      }
    }
    case "avg_rating":
    case "nps":
      return { type: "bar", unit: "rating", rows: (data.staff ?? []).filter((s) => s.avg_rating != null).map((s) => ({ name: s.name, value: num(s.avg_rating) })) }
    case "complaint_rate":
      return { type: "bar", unit: "pct", rows: (data.staff ?? []).map((s) => ({ name: s.name, value: num(s.complaint_pct) })) }
    case "churn_rate":
      return { type: "bar", unit: "money", rows: (data.churn?.at_risk ?? []).map((c) => ({ name: c.customer, value: num(c.spend) })) }
    case "campaign_roi":
      return { type: "bar", unit: "pct", rows: (data.campaigns ?? []).filter((c) => c.roi_pct != null).map((c) => ({ name: c.name, value: num(c.roi_pct) })) }
    case "menu_bad_share": {
      const classes = data.menu_classes ?? []
      const counts: Record<string, number> = {}
      for (const m of classes) counts[m.class] = (counts[m.class] ?? 0) + 1
      const order = ["STAR", "GREAT", "MID", "BAD"]
      return { type: "pie", unit: "count", rows: order.filter((c) => counts[c] > 0).map((c) => ({ name: c, value: counts[c] })) }
    }
    case "low_stock":
      return { type: "bar", unit: "count", rows: (data.stock_alerts ?? []).map((s) => ({ name: s.name, value: num(s.qty) })) }
    case "table_turnaround":
    case "revpash":
      return { type: "bar", unit: "min", rows: (data.tat?.by_table ?? []).map((t) => ({ name: t.table_name, value: num(t.avg_min) })) }
    case "forecast_mape":
      return { type: "bar", unit: "count", rows: (data.demand_forecast ?? []).map((f) => ({ name: f.name, value: num(f.forecast_next_week) })) }
    case "food_cost_pct":
    case "food_cost_variance":
      return { type: "pie", unit: "money", rows: (data.suppliers ?? []).map((s) => ({ name: s.vendor, value: num(s.spend) })) }
    default:
      return { type: "none", rows: [], unit: "count" }
  }
}

function formatDrill(n: number, unit: DrillUnit, money: (v: number) => string): string {
  switch (unit) {
    case "money": return money(n)
    case "pct": return `${Math.round(n * 10) / 10}%`
    case "min": return `${Math.round(n * 10) / 10} min`
    case "rating": return n.toFixed(1)
    default: return `${Math.round(n)}`
  }
}

// Theme-aware tooltip (the built-in recharts one is not) — mirrors the card
// tooltip styling used elsewhere on the page.
function DrillTooltip({ active, payload, fmt }: { active?: boolean; payload?: any[]; fmt: (n: number) => string }) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  return (
    <div className="rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium text-foreground">{p?.payload?.name}</div>
      <div className="text-muted-foreground">{fmt(Number(p?.value ?? 0))}</div>
    </div>
  )
}

// Compact name / value list beneath the chart — doubles as the pie legend
// (colour swatches) and the bar's exact figures.
function DrillBreakdown({ rows, fmt, total }: { rows: DrillRow[]; fmt: (n: number) => string; total: number | null }) {
  return (
    <div className="max-h-[200px] overflow-y-auto rounded-lg border">
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b last:border-0">
              <td className="py-1.5 pl-2 pr-2">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: DRILL_PALETTE[i % DRILL_PALETTE.length] }} />
                  <span className="truncate">{r.name}</span>
                </span>
              </td>
              <td className="whitespace-nowrap py-1.5 pr-2 text-right font-medium tabular-nums">
                {fmt(r.value)}
                {total ? <span className="ml-1 text-xs text-muted-foreground">({Math.round((r.value / total) * 100)}%)</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// The drill-down dialog itself. `kpi == null` keeps it closed.
function KpiDrilldown({ kpi, data, money, onOpenChange }: {
  kpi: Kpi | null
  data: AdvancedAnalytics
  money: (n: number | null | undefined) => string
  onOpenChange: (open: boolean) => void
}) {
  const spec = kpi ? kpiDrilldownSpec(kpi, data) : null
  const link = kpi ? KPI_LINKS[kpi.key] : undefined
  const val = !kpi || kpi.value == null ? "—" : `${kpi.value}${kpi.unit}`
  const fmt = (n: number) => (spec ? formatDrill(n, spec.unit, money) : String(n))
  // Bars: worst/biggest first, capped at 8. Pies keep composition order.
  const rows = spec ? (spec.type === "bar" ? [...spec.rows].sort((a, b) => b.value - a.value).slice(0, 8) : spec.rows) : []
  const total = rows.reduce((s, r) => s + (r.value || 0), 0)

  return (
    <Dialog open={kpi != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto" aria-describedby={undefined}>
        {kpi && spec && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span>{kpi.label}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${KPI_COLORS[kpi.status] ?? KPI_COLORS.grey}`}>{KPI_STATUS_LABEL[kpi.status]}</span>
              </DialogTitle>
              <div className="text-3xl font-bold">{val}</div>
            </DialogHeader>

            {spec.type === "none" ? (
              <p className="text-sm text-muted-foreground">{KPI_MEANINGS[kpi.key] ?? `Current value for the last ${data.window_days} days.`}</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No detailed breakdown yet for this metric.</p>
            ) : spec.type === "pie" ? (
              <div className="grid gap-4 sm:grid-cols-2 sm:items-center">
                <div className="h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={rows}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={48}
                        outerRadius={86}
                        paddingAngle={2}
                        labelLine={false}
                        label={({ percent }: { percent?: number }) => ((percent ?? 0) > 0.05 ? `${Math.round((percent ?? 0) * 100)}%` : "")}
                      >
                        {rows.map((_, i) => (
                          <Cell key={i} fill={DRILL_PALETTE[i % DRILL_PALETTE.length]} stroke="hsl(var(--background))" strokeWidth={2} />
                        ))}
                      </Pie>
                      <Tooltip content={(props) => <DrillTooltip {...props} fmt={fmt} />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <DrillBreakdown rows={rows} fmt={fmt} total={total || null} />
              </div>
            ) : (
              <div className="grid gap-4">
                <div className="h-[240px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 48, left: 8, bottom: 4 }}>
                      <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis type="number" hide />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={116}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                        tickFormatter={(v: string) => (v && v.length > 16 ? `${v.slice(0, 15)}…` : v)}
                      />
                      <Tooltip cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.5 }} content={(props) => <DrillTooltip {...props} fmt={fmt} />} />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                        {rows.map((_, i) => (
                          <Cell key={i} fill={DRILL_PALETTE[i % DRILL_PALETTE.length]} />
                        ))}
                        <LabelList dataKey="value" position="right" className="fill-foreground text-[11px]" formatter={(v: any) => fmt(Number(v))} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <DrillBreakdown rows={rows} fmt={fmt} total={null} />
              </div>
            )}

            <DialogFooter className="items-center sm:justify-between">
              <span className="text-xs text-muted-foreground">Last {data.window_days} days</span>
              {link && (
                <Link href={link} className="text-sm font-medium text-primary hover:underline">
                  View full records →
                </Link>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function AdvancedAnalyticsView({ view, kpiSort }: { view: ViewId; kpiSort: KpiSort }) {
  const { user } = useAuth();
  const { currency } = useCurrency();
  const { toast } = useToast();
  const [data, setData] = useState<AdvancedAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [campForm, setCampForm] = useState({ name: "", cost: "", starts_at: "", ends_at: "" });
  const [campBusy, setCampBusy] = useState(false);
  const [activeKpi, setActiveKpi] = useState<Kpi | null>(null); // open drill-down dialog
  const money = (n: number | null | undefined) => `${currency}${Number(n ?? 0).toFixed(0)}`;

  // Per-section sort state (defaults = most meaningful metric). Low-stock and
  // TAT default ASC so the most-urgent / fastest rows lead.
  const [staffSort, setStaffSort] = useSectionSort("feedbacks");
  const [supplierSort, setSupplierSort] = useSectionSort("score");
  const [stockSort, setStockSort] = useSectionSort("qty", "asc");
  const [menuSort, setMenuSort] = useSectionSort("revenue");
  const [churnSort, setChurnSort] = useSectionSort("spend");
  const [tatSort, setTatSort] = useSectionSort("avg_min", "asc");
  const [demoGenderSort, setDemoGenderSort] = useSectionSort("n");
  const [demoAgeSort, setDemoAgeSort] = useSectionSort("n");
  const [demoPinSort, setDemoPinSort] = useSectionSort("n");
  const [campSort, setCampSort] = useSectionSort("roi_pct");
  const [forecastSort, setForecastSort] = useSectionSort("forecast_next_week");
  const [offerSort, setOfferSort] = useSectionSort("redemption_pct");

  useEffect(() => {
    if (!user?.restaurantUsername) return;
    let active = true;
    setLoading(true);
    getAdvancedAnalytics(user.restaurantUsername, 90)
      .then((d) => { if (active) setData(d); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.restaurantUsername, refresh]);

  const addCampaign = async () => {
    if (!user?.restaurantUsername) return;
    if (!campForm.name.trim() || !campForm.starts_at || !campForm.ends_at) {
      toast({ title: "Name, start and end dates are required", variant: "destructive" });
      return;
    }
    setCampBusy(true);
    try {
      await createCampaign(user.restaurantUsername, {
        name: campForm.name.trim(),
        cost: Number(campForm.cost) || 0,
        starts_at: campForm.starts_at,
        ends_at: campForm.ends_at,
      });
      setCampForm({ name: "", cost: "", starts_at: "", ends_at: "" });
      setRefresh((r) => r + 1);
      toast({ title: "Campaign added", description: "ROI updates as bills come in." });
    } catch (e: any) {
      toast({ title: "Couldn't add campaign", description: String(e?.message ?? e), variant: "destructive" });
    } finally { setCampBusy(false); }
  };

  const removeCampaign = async (id: string) => {
    if (!user?.restaurantUsername) return;
    try {
      await deleteCampaign(user.restaurantUsername, id);
      setRefresh((r) => r + 1);
    } catch (e: any) {
      toast({ title: "Couldn't delete campaign", description: String(e?.message ?? e), variant: "destructive" });
    }
  };

  if (loading) return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Loading KPIs…</CardContent></Card>;
  if (!data) return null;

  const kpiVal = (k: AdvancedAnalytics["kpis"][number]) => k.value == null ? "—" : `${k.value}${k.unit}`;

  const visibleKpis = sortKpis(data.kpis.filter((k) => kpiInView(k.key, view)), kpiSort);

  // Sortable-field definitions + client-sorted arrays per section.
  const staffFields: SortField<AdvancedAnalytics["staff"][number]>[] = [
    { id: "feedbacks", label: "Responses", type: "num", get: (s) => s.feedbacks },
    { id: "avg_rating", label: "Rating", type: "num", get: (s) => s.avg_rating },
    { id: "complaint_pct", label: "Complaints", type: "num", get: (s) => s.complaint_pct },
    { id: "name", label: "Name", type: "text", get: (s) => s.name },
  ];
  const supplierFields: SortField<AdvancedAnalytics["suppliers"][number]>[] = [
    { id: "score", label: "Score", type: "num", get: (s) => s.score },
    { id: "on_time_pct", label: "On-time", type: "num", get: (s) => s.on_time_pct },
    { id: "quality", label: "Quality", type: "num", get: (s) => s.quality },
    { id: "spend", label: "Spend", type: "num", get: (s) => s.spend },
    { id: "pos", label: "POs", type: "num", get: (s) => s.pos },
    { id: "vendor", label: "Name", type: "text", get: (s) => s.vendor },
  ];
  const stockFields: SortField<AdvancedAnalytics["stock_alerts"][number]>[] = [
    { id: "qty", label: "Qty", type: "num", get: (s) => s.qty },
    { id: "name", label: "Name", type: "text", get: (s) => s.name },
  ];
  const menuFields: SortField<AdvancedAnalytics["menu_classes"][number]>[] = [
    { id: "revenue", label: "Revenue", type: "num", get: (m) => m.revenue },
    { id: "qty", label: "Sold", type: "num", get: (m) => m.qty },
    { id: "popularity_pct", label: "Popularity", type: "num", get: (m) => m.popularity_pct },
    { id: "name", label: "Name", type: "text", get: (m) => m.name },
  ];
  const churnFields: SortField<AdvancedAnalytics["churn"]["at_risk"][number]>[] = [
    { id: "spend", label: "Spend", type: "num", get: (c) => c.spend },
    { id: "orders", label: "Orders", type: "num", get: (c) => c.orders },
    { id: "days_since_visit", label: "Quiet for", type: "num", get: (c) => c.days_since_visit },
    { id: "customer", label: "Name", type: "text", get: (c) => c.customer },
  ];
  const tatFields: SortField<AdvancedAnalytics["tat"]["by_table"][number]>[] = [
    { id: "avg_min", label: "Avg TAT", type: "num", get: (t) => t.avg_min },
    { id: "visits", label: "Visits", type: "num", get: (t) => t.visits },
    { id: "table_name", label: "Table", type: "text", get: (t) => t.table_name },
  ];
  const campFields: SortField<AdvancedAnalytics["campaigns"][number]>[] = [
    { id: "roi_pct", label: "ROI", type: "num", get: (c) => c.roi_pct },
    { id: "uplift_pct", label: "Uplift", type: "num", get: (c) => c.uplift_pct },
    { id: "sales_during", label: "During", type: "num", get: (c) => c.sales_during },
    { id: "cost", label: "Cost", type: "num", get: (c) => c.cost },
    { id: "starts_at", label: "Start", type: "text", get: (c) => c.starts_at },
    { id: "name", label: "Name", type: "text", get: (c) => c.name },
  ];
  const forecastFields: SortField<AdvancedAnalytics["demand_forecast"][number]>[] = [
    { id: "forecast_next_week", label: "Next week", type: "num", get: (f) => f.forecast_next_week },
    { id: "total_qty", label: "12-wk", type: "num", get: (f) => f.total_qty },
    { id: "name", label: "Name", type: "text", get: (f) => f.name },
  ];
  const offerFields: SortField<AdvancedAnalytics["offers"][number]>[] = [
    { id: "redemption_pct", label: "Redemption", type: "num", get: (o) => o.redemption_pct },
    { id: "used", label: "Used", type: "num", get: (o) => o.used },
    { id: "code", label: "Code", type: "text", get: (o) => o.code },
  ];
  // Shared field set for the three demographics groups (label + count).
  type DemoRow = { label: string; n: number };
  const demoFields: SortField<DemoRow>[] = [
    { id: "n", label: "Count", type: "num", get: (g) => g.n },
    { id: "label", label: "Name", type: "text", get: (g) => g.label },
  ];

  const staff = sortRows(data.staff, staffFields, staffSort);
  const suppliers = sortRows(data.suppliers, supplierFields, supplierSort);
  const stockAlerts = sortRows(data.stock_alerts, stockFields, stockSort);
  const menuClasses = sortRows(data.menu_classes ?? [], menuFields, menuSort);
  const atRisk = sortRows(data.churn?.at_risk ?? [], churnFields, churnSort);
  const tatByTable = sortRows(data.tat?.by_table ?? [], tatFields, tatSort);
  const campaigns = sortRows(data.campaigns ?? [], campFields, campSort);
  const demandForecast = sortRows(data.demand_forecast ?? [], forecastFields, forecastSort);
  const offers = sortRows(data.offers ?? [], offerFields, offerSort);
  const byGender = sortRows(data.demographics?.by_gender ?? [], demoFields, demoGenderSort);
  const byAge = sortRows(data.demographics?.by_age ?? [], demoFields, demoAgeSort);
  const topPincodes = sortRows(data.demographics?.top_pincodes ?? [], demoFields, demoPinSort);

  return (
    <div className="grid gap-4 md:gap-8">
      {visibleKpis.length > 0 && (
      <Card>
        <CardHeader>
          <CardTitle>KPI health</CardTitle>
          <CardDescription>Last {data.window_days} days, colour-coded against target bands.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {visibleKpis.map((k) => (
              <button
                key={k.key}
                type="button"
                onClick={() => setActiveKpi(k)}
                title={`View ${k.label} breakdown`}
                className={`h-full cursor-pointer rounded-xl border p-3 text-left transition-shadow hover:shadow-md hover:ring-1 hover:ring-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${KPI_COLORS[k.status] ?? KPI_COLORS.grey}`}
              >
                <div className="text-xs font-medium opacity-80">{k.label}</div>
                <div className="mt-1 text-xl font-bold">{kpiVal(k)}</div>
                {k.key === "profit_margin" && data.profit && (
                  <div className="text-[10px] opacity-70">rev {money(data.profit.revenue)} − exp {money(data.profit.expenses)}</div>
                )}
                <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">{KPI_STATUS_LABEL[k.status]} ›</div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
      )}

      <KpiDrilldown kpi={activeKpi} data={data} money={money} onOpenChange={(o) => { if (!o) setActiveKpi(null); }} />

      <div className="grid gap-4 md:grid-cols-2">
        {inView(view, "discounts") && (
        <Card>
          <CardHeader><CardTitle>Discounts &amp; offers</CardTitle><CardDescription>Utilization and redemptions, last {data.window_days} days.</CardDescription></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Discount utilization</span><span className="font-medium">{data.discounts.utilization_pct}%</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Bills with a discount</span><span className="font-medium">{data.discounts.discount_bills} / {data.discounts.total_bills}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Total discount value</span><span className="font-medium">{money(data.discounts.total_discount)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Coupon redemptions</span><span className="font-medium">{data.discounts.redemptions}</span></div>
          </CardContent>
        </Card>
        )}

        {inView(view, "staff") && (
        <Card>
          <CardHeader>
            <SectionHeaderRow control={data.staff.length > 0 ? <SortControl fields={staffFields} state={staffSort} onChange={setStaffSort} /> : null}>
              <CardTitle>Feedback health</CardTitle><CardDescription>Ratings &amp; complaints across {data.total_feedbacks} response{data.total_feedbacks === 1 ? "" : "s"}.</CardDescription>
            </SectionHeaderRow>
          </CardHeader>
          <CardContent>
            {data.staff.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No feedback in this window.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground"><tr className="border-b"><th className="py-1 pr-2">Staff</th><th className="py-1 pr-2 text-right">Responses</th><th className="py-1 pr-2 text-right">Avg</th><th className="py-1 text-right">Complaints</th></tr></thead>
                <tbody>
                  {staff.map((s, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1 pr-2 font-medium">{s.name}</td>
                      <td className="py-1 pr-2 text-right">{s.feedbacks}</td>
                      <td className="py-1 pr-2 text-right">{s.avg_rating ?? "—"}</td>
                      <td className="py-1 text-right">{s.complaint_pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
        )}

        {inView(view, "supply") && (
        <Card>
          <CardHeader>
            <SectionHeaderRow control={data.suppliers.length > 0 ? <SortControl fields={supplierFields} state={supplierSort} onChange={setSupplierSort} /> : null}>
              <CardTitle>Suppliers</CardTitle><CardDescription>On-time delivery, quality &amp; spend. Score = 0.6 × on-time + 0.4 × quality — rate deliveries when receiving a PO.</CardDescription>
            </SectionHeaderRow>
          </CardHeader>
          <CardContent>
            {data.suppliers.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No purchase orders yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground"><tr className="border-b"><th className="py-1 pr-2">Vendor</th><th className="py-1 pr-2 text-right">POs</th><th className="py-1 pr-2 text-right">On-time</th><th className="py-1 pr-2 text-right">Quality</th><th className="py-1 pr-2 text-right">Score</th><th className="py-1 text-right">Spend</th></tr></thead>
                <tbody>
                  {suppliers.map((s, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1 pr-2 font-medium">{s.vendor}</td>
                      <td className="py-1 pr-2 text-right">{s.pos}</td>
                      <td className="py-1 pr-2 text-right">{s.on_time_pct}%</td>
                      <td className="py-1 pr-2 text-right">{s.quality != null ? `${s.quality}/5` : "—"}</td>
                      <td className={`py-1 pr-2 text-right font-semibold ${s.score == null ? "" : s.score >= 0.7 ? "text-green-600 dark:text-green-400" : s.score >= 0.6 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}`}>{s.score ?? "—"}</td>
                      <td className="py-1 text-right">{money(s.spend)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
        )}

        {inView(view, "supply", true) && (
        <Card>
          <CardHeader>
            <SectionHeaderRow control={data.stock_alerts.length > 0 ? <SortControl fields={stockFields} state={stockSort} onChange={setStockSort} /> : null}>
              <CardTitle>Low-stock alerts</CardTitle><CardDescription>Inventory at or below 5 units.</CardDescription>
            </SectionHeaderRow>
          </CardHeader>
          <CardContent>
            {data.stock_alerts.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">All stock levels look healthy. ✅</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {stockAlerts.map((s, i) => (
                  <li key={i} className="flex justify-between border-b py-1 last:border-0"><span>{s.name}</span><span className="font-semibold text-red-600 dark:text-red-400">{s.qty} left</span></li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        )}

        {inView(view, "menu") && (
        <Card>
          <CardHeader>
            <SectionHeaderRow control={(data.menu_classes ?? []).length > 0 ? <SortControl fields={menuFields} state={menuSort} onChange={setMenuSort} /> : null}>
              <CardTitle>Menu engineering</CardTitle><CardDescription>STAR = popular &amp; high-value, GREAT = popular &amp; low-value, MID = niche &amp; high-value, BAD = review or remove. BAD share of sales: {data.bad_share_pct ?? "—"}%.</CardDescription>
            </SectionHeaderRow>
          </CardHeader>
          <CardContent>
            {(data.menu_classes ?? []).length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No item sales in this window.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground"><tr className="border-b"><th className="py-1 pr-2">Item</th><th className="py-1 pr-2">Class</th><th className="py-1 pr-2 text-right">Sold</th><th className="py-1 pr-2 text-right">Revenue</th><th className="py-1 text-right">Popularity</th></tr></thead>
                  <tbody>
                    {menuClasses.map((m, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-1 pr-2 font-medium">{m.name}</td>
                        <td className="py-1 pr-2">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${m.class === "STAR" ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" : m.class === "GREAT" ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300" : m.class === "MID" ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"}`}>{m.class}</span>
                        </td>
                        <td className="py-1 pr-2 text-right">{m.qty}</td>
                        <td className="py-1 pr-2 text-right">{money(m.revenue)}</td>
                        <td className="py-1 text-right">{m.popularity_pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
        )}

        {inView(view, "customers") && (
        <Card>
          <CardHeader>
            <SectionHeaderRow control={(data.churn?.at_risk ?? []).length > 0 ? <SortControl fields={churnFields} state={churnSort} onChange={setChurnSort} /> : null}>
              <CardTitle>Customer churn</CardTitle><CardDescription>Cohort of {data.churn?.cohort ?? 0} identified customers · churn rate {data.churn?.rate_pct ?? "—"}%. Quiet 30+ days, by spend:</CardDescription>
            </SectionHeaderRow>
          </CardHeader>
          <CardContent>
            {(data.churn?.at_risk ?? []).length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No at-risk customers detected — regulars are coming back. ✅</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground"><tr className="border-b"><th className="py-1 pr-2">Customer</th><th className="py-1 pr-2 text-right">Orders</th><th className="py-1 pr-2 text-right">Spend</th><th className="py-1 text-right">Quiet for</th></tr></thead>
                <tbody>
                  {atRisk.map((c, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1 pr-2 font-medium">{c.customer}</td>
                      <td className="py-1 pr-2 text-right">{c.orders}</td>
                      <td className="py-1 pr-2 text-right">{money(c.spend)}</td>
                      <td className="py-1 text-right">{c.days_since_visit}d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
        )}

        {inView(view, "operations") && (
        <Card>
          <CardHeader>
            <SectionHeaderRow control={(data.tat?.by_table ?? []).length > 0 ? <SortControl fields={tatFields} state={tatSort} onChange={setTatSort} /> : null}>
              <CardTitle>Table turnaround (TAT)</CardTitle><CardDescription>Seated → left, recorded automatically per table visit. {data.tat?.sessions ?? 0} visit{(data.tat?.sessions ?? 0) === 1 ? "" : "s"} in the window.</CardDescription>
            </SectionHeaderRow>
          </CardHeader>
          <CardContent>
            {(data.tat?.sessions ?? 0) === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No completed table visits yet — TAT starts recording from each table&apos;s next seating.</p>
            ) : (
              <>
                <div className="mb-3 flex gap-6 text-sm">
                  <div><span className="text-muted-foreground">Average</span> <span className="ml-1 text-lg font-bold">{data.tat.avg_min} min</span></div>
                  <div><span className="text-muted-foreground">Median</span> <span className="ml-1 text-lg font-bold">{data.tat.median_min} min</span></div>
                </div>
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground"><tr className="border-b"><th className="py-1 pr-2">Table</th><th className="py-1 pr-2 text-right">Visits</th><th className="py-1 text-right">Avg TAT</th></tr></thead>
                  <tbody>
                    {tatByTable.map((t, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-1 pr-2 font-medium">{t.table_name}</td>
                        <td className="py-1 pr-2 text-right">{t.visits}</td>
                        <td className="py-1 text-right">{t.avg_min} min</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </CardContent>
        </Card>
        )}

        {inView(view, "customers") && (
        <Card>
          <CardHeader><CardTitle>Customer demographics</CardTitle><CardDescription>Aggregated only — tagged {data.demographics?.tagged ?? 0} of {data.demographics?.total_customers ?? 0} customers{data.demographics?.coverage_pct != null ? ` (${data.demographics.coverage_pct}%)` : ""}. Tag guests when adding customers.</CardDescription></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {(data.demographics?.tagged ?? 0) === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No demographic tags yet — add gender / age group / pincode when creating customers.</p>
            ) : (
              <>
                {byGender.length > 0 && (
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-2"><p className="text-xs font-semibold uppercase text-muted-foreground">By gender</p><SortControl fields={demoFields} state={demoGenderSort} onChange={setDemoGenderSort} /></div>
                    <div className="flex flex-wrap gap-2">{byGender.map((g, i) => <span key={i} className="rounded-full bg-muted px-2.5 py-0.5">{g.label}: <b>{g.n}</b></span>)}</div>
                  </div>
                )}
                {byAge.length > 0 && (
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-2"><p className="text-xs font-semibold uppercase text-muted-foreground">By age group</p><SortControl fields={demoFields} state={demoAgeSort} onChange={setDemoAgeSort} /></div>
                    <div className="flex flex-wrap gap-2">{byAge.map((g, i) => <span key={i} className="rounded-full bg-muted px-2.5 py-0.5">{g.label}: <b>{g.n}</b></span>)}</div>
                  </div>
                )}
                {topPincodes.length > 0 && (
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-2"><p className="text-xs font-semibold uppercase text-muted-foreground">Top pincodes</p><SortControl fields={demoFields} state={demoPinSort} onChange={setDemoPinSort} /></div>
                    <div className="flex flex-wrap gap-2">{topPincodes.map((g, i) => <span key={i} className="rounded-full bg-muted px-2.5 py-0.5">{g.label}: <b>{g.n}</b></span>)}</div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
        )}

        {inView(view, "marketing") && (
        <Card>
          <CardHeader>
            <SectionHeaderRow control={(data.campaigns ?? []).length > 0 ? <SortControl fields={campFields} state={campSort} onChange={setCampSort} /> : null}>
              <CardTitle>Campaign ROI</CardTitle><CardDescription>Revenue in the campaign window vs the same-length window before it. ROI needs a recorded spend.</CardDescription>
            </SectionHeaderRow>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Input className="col-span-2 sm:col-span-2" placeholder="Campaign name" value={campForm.name} onChange={(e) => setCampForm((f) => ({ ...f, name: e.target.value }))} />
              <Input type="number" min="0" placeholder={`Cost (${currency})`} value={campForm.cost} onChange={(e) => setCampForm((f) => ({ ...f, cost: e.target.value }))} />
              <Input type="date" value={campForm.starts_at} onChange={(e) => setCampForm((f) => ({ ...f, starts_at: e.target.value }))} />
              <Input type="date" value={campForm.ends_at} onChange={(e) => setCampForm((f) => ({ ...f, ends_at: e.target.value }))} />
            </div>
            <Button size="sm" disabled={campBusy} onClick={() => void addCampaign()}>{campBusy ? "Adding…" : "Add campaign"}</Button>
            {(data.campaigns ?? []).length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No campaigns yet — add one to start measuring uplift &amp; ROI.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground"><tr className="border-b"><th className="py-1 pr-2">Campaign</th><th className="py-1 pr-2 text-right">During</th><th className="py-1 pr-2 text-right">Before</th><th className="py-1 pr-2 text-right">Uplift</th><th className="py-1 pr-2 text-right">ROI</th><th></th></tr></thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="py-1 pr-2"><div className="font-medium">{c.name}</div><div className="text-xs text-muted-foreground">{c.starts_at} → {c.ends_at} · cost {money(c.cost)}</div></td>
                      <td className="py-1 pr-2 text-right">{money(c.sales_during)}</td>
                      <td className="py-1 pr-2 text-right">{money(c.sales_before)}</td>
                      <td className="py-1 pr-2 text-right">{c.uplift_pct != null ? `${c.uplift_pct}%` : "—"}</td>
                      <td className={`py-1 pr-2 text-right font-semibold ${c.roi_pct == null ? "" : c.roi_pct >= 20 ? "text-green-600 dark:text-green-400" : c.roi_pct >= 0 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}`}>{c.roi_pct != null ? `${c.roi_pct}%` : "—"}</td>
                      <td className="py-1 text-right"><Button variant="ghost" size="sm" onClick={() => void removeCampaign(c.id)}>✕</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
        )}

        {inView(view, "menu") && (data.demand_forecast ?? []).length > 0 ? (
          <Card>
            <CardHeader>
              <SectionHeaderRow control={<SortControl fields={forecastFields} state={forecastSort} onChange={setForecastSort} />}>
                <CardTitle>Demand forecast</CardTitle><CardDescription>Next week&apos;s expected sales per item (weighted 4-week average){data.forecast_mape_pct != null ? ` · MAPE ${data.forecast_mape_pct}%` : ""}.</CardDescription>
              </SectionHeaderRow>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground"><tr className="border-b"><th className="py-1 pr-2">Item</th><th className="py-1 pr-2 text-right">12-wk sold</th><th className="py-1 pr-2 text-right">Next week</th><th className="py-1 text-right">Trend</th></tr></thead>
                <tbody>
                  {demandForecast.map((f, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1 pr-2 font-medium">{f.name}</td>
                      <td className="py-1 pr-2 text-right">{f.total_qty}</td>
                      <td className="py-1 pr-2 text-right font-semibold">{Math.round(f.forecast_next_week)}</td>
                      <td className="py-1 text-right">{f.trend === "up" ? <ArrowUp className="ml-auto h-4 w-4 text-green-600" /> : f.trend === "down" ? <ArrowDown className="ml-auto h-4 w-4 text-red-500" /> : <span className="text-muted-foreground">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ) : null}

        {inView(view, "discounts") && (data.offers ?? []).length > 0 ? (
          <Card>
            <CardHeader>
              <SectionHeaderRow control={<SortControl fields={offerFields} state={offerSort} onChange={setOfferSort} />}>
                <CardTitle>Offer redemption</CardTitle><CardDescription>Coupon usage vs limits.</CardDescription>
              </SectionHeaderRow>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground"><tr className="border-b"><th className="py-1 pr-2">Code</th><th className="py-1 pr-2 text-right">Used</th><th className="py-1 pr-2 text-right">Limit</th><th className="py-1 text-right">Redemption</th></tr></thead>
                <tbody>
                  {offers.map((o, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1 pr-2 font-medium">{o.code}</td>
                      <td className="py-1 pr-2 text-right">{o.used}</td>
                      <td className="py-1 pr-2 text-right">{o.limit ?? "∞"}</td>
                      <td className="py-1 text-right">{o.redemption_pct != null ? `${o.redemption_pct}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

// Side-by-side branch comparison — renders ONLY for restaurants with 2+ outlets
// (single-outlet tenants see nothing, not an empty card).
function OutletsComparisonCard({ view }: { view: ViewId }) {
  const { user } = useAuth();
  const { currency } = useCurrency();
  const [data, setData] = useState<OutletComparison | null>(null);
  const [outletSort, setOutletSort] = useSectionSort("revenue");
  const money = (n: number | null | undefined) => `${currency}${Number(n ?? 0).toFixed(0)}`;

  useEffect(() => {
    if (!user?.restaurantUsername) return;
    let active = true;
    getOutletsComparison(user.restaurantUsername, 30).then((d) => { if (active) setData(d); });
    return () => { active = false; };
  }, [user?.restaurantUsername]);

  if (!inView(view, "sales", true)) return null;
  if (!data || data.outlets.length < 2) return null;

  const outletFields: SortField<OutletComparison["outlets"][number]>[] = [
    { id: "revenue", label: "Revenue", type: "num", get: (o) => o.revenue },
    { id: "bills", label: "Bills", type: "num", get: (o) => o.bills },
    { id: "orders", label: "Orders", type: "num", get: (o) => o.orders },
    { id: "avg_rating", label: "Rating", type: "num", get: (o) => o.avg_rating },
    { id: "name", label: "Name", type: "text", get: (o) => o.name },
  ];
  const outlets = sortRows(data.outlets, outletFields, outletSort);
  const maxRev = Math.max(1, ...data.outlets.map((o) => o.revenue));
  return (
    <Card>
      <CardHeader>
        <SectionHeaderRow control={<SortControl fields={outletFields} state={outletSort} onChange={setOutletSort} />}>
          <CardTitle>Outlets comparison</CardTitle>
          <CardDescription>Revenue, bills, orders &amp; guest rating per outlet — last {data.days} days.</CardDescription>
        </SectionHeaderRow>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr className="border-b">
              <th className="py-1 pr-2">Outlet</th>
              <th className="py-1 pr-2 w-1/3">Revenue</th>
              <th className="py-1 pr-2 text-right">Bills</th>
              <th className="py-1 pr-2 text-right">Orders</th>
              <th className="py-1 text-right">Rating</th>
            </tr>
          </thead>
          <tbody>
            {outlets.map((o) => (
              <tr key={o.outlet_id} className="border-b last:border-0">
                <td className="py-2 pr-2 font-medium">{o.name}</td>
                <td className="py-2 pr-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded bg-muted">
                      <div className="h-full rounded bg-primary" style={{ width: `${Math.max(2, Math.round((o.revenue / maxRev) * 100))}%` }} />
                    </div>
                    <span className="w-20 text-right font-semibold">{money(o.revenue)}</span>
                  </div>
                </td>
                <td className="py-2 pr-2 text-right">{o.bills}</td>
                <td className="py-2 pr-2 text-right">{o.orders}</td>
                <td className="py-2 text-right">{o.avg_rating != null ? `${o.avg_rating}/5` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export default function AnalyticsPage() {
  const [view, setView] = useState<ViewId>("overview");
  const [kpiSort, setKpiSort] = useState<KpiSort>("severity");
  const [sheetOpen, setSheetOpen] = useState(false);

  // Restore persisted choices after mount (localStorage is client-only, and
  // reading it in the initial state would break hydration).
  useEffect(() => {
    try {
      const v = localStorage.getItem("analytics.view");
      if (v && VIEWS.some((x) => x.id === v)) setView(v as ViewId);
      const s = localStorage.getItem("analytics.kpiSort");
      if (s && KPI_SORTS.some((x) => x.id === s)) setKpiSort(s as KpiSort);
    } catch { /* storage unavailable (private mode) — keep defaults */ }
  }, []);

  const pickView = (v: ViewId) => {
    setView(v);
    setSheetOpen(false);
    try { localStorage.setItem("analytics.view", v); } catch { /* ignore */ }
  };
  const pickSort = (s: KpiSort) => {
    setKpiSort(s);
    try { localStorage.setItem("analytics.kpiSort", s); } catch { /* ignore */ }
  };

  const viewLabel = VIEWS.find((v) => v.id === view)?.label ?? "Overview";

  return (
    <div className="grid gap-4 md:gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl">Analytics</h1>
      </div>

      {/* Sticky toolbar: pick a view (only that slice renders) + KPI sort.
          Sits just below the app header (h-14 / lg:60px). */}
      <div className="sticky top-14 z-30 rounded-xl border bg-background/95 p-2 shadow-sm backdrop-blur lg:top-[60px]">
        <div className="flex flex-wrap items-center gap-2">
          {/* Wide screens: segmented chips */}
          <div className="hidden min-w-0 flex-1 flex-wrap items-center gap-1.5 md:flex">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => pickView(v.id)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${view === v.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"}`}
              >
                {v.label}
              </button>
            ))}
          </div>
          {/* Narrow screens: button opening a bottom-sheet view picker */}
          <Button variant="outline" size="sm" className="md:hidden" onClick={() => setSheetOpen(true)}>
            View: {viewLabel} <ChevronDown className="ml-1 h-4 w-4" />
          </Button>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="hidden text-xs text-muted-foreground sm:inline">Sort KPIs</span>
            <div className="flex items-center rounded-lg border p-0.5">
              {KPI_SORTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => pickSort(s.id)}
                  className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${kpiSort === s.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <OutletsComparisonCard view={view} />
      <AdvancedAnalyticsView view={view} kpiSort={kpiSort} />
      <ActionableInsights view={view} />
      <PerformanceTrends view={view} />
      <OperationsCharts view={view} />

      {/* Mobile bottom sheet for the view picker */}
      {sheetOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Choose analytics view">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSheetOpen(false)} aria-hidden="true" />
          <div className="absolute inset-x-0 bottom-0 max-h-[75vh] overflow-y-auto rounded-t-2xl border-t bg-background p-4 pb-8 shadow-2xl">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" />
            <p className="mb-2 text-sm font-semibold">Show</p>
            <div className="grid gap-1">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => pickView(v.id)}
                  className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm ${view === v.id ? "bg-primary/10 font-semibold text-primary" : "hover:bg-muted"}`}
                >
                  <span>{v.label}</span>
                  {view === v.id && <Check className="h-4 w-4" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
