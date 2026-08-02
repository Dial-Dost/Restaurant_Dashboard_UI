"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, Line, LineChart, Pie, PieChart, Cell, Tooltip, ResponsiveContainer, LabelList } from "recharts"
import { InteractiveChart, type IvPoint } from "./interactive-chart"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { useAuth } from "@/context/AuthContext"
import { useCurrency } from "@/hooks/use-currency"
import { getMenuInsights, type MenuInsights, type PriceSuggestion, type SuppressedSuggestion, applyMenuItemPrice, getOperationsAnalytics, type OperationsAnalytics, getApcTrends, type ApcTrendPoint, getAdvancedAnalytics, type AdvancedAnalytics, getOutletsComparison, type OutletComparison, createCampaign, deleteCampaign, getKitchenAnalytics, type KitchenAnalytics, type KitchenDishStat, type KitchenSectionStat, getMetricExplainers, type MetricExplainer, type MetricExplainers, getOverviewInsights, type OverviewInsights, type OverviewMetric, type AttentionItem, type AttentionRow } from "@/lib/db"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { formatLongDate, formatMonth, timezoneCaption, todayInZone } from "@/lib/tz"
import { useTimezone } from "@/lib/use-timezone"
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Download, Filter, Flame, HelpCircle, Info, Maximize2, Trophy, Lightbulb, Snail, TriangleAlert, X } from "lucide-react"

// Series colour for every InteractiveChart on the page — one accent, so the
// tooltip swatch, the bars and the line always agree.
const SERIES_COLOR = "hsl(var(--primary))"

const KPI_COLORS: Record<string, string> = {
  blue: "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200",
  green: "border-green-300 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200",
  amber: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
  red: "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
  grey: "border-border bg-muted text-muted-foreground",
}
const KPI_STATUS_LABEL: Record<string, string> = { blue: "Excellent", green: "On target", amber: "Watch", red: "Action", grey: "No data" }

// Drill-down targets: clicking a KPI tile jumps to the page holding its source
// records. Data-driven by KPI key. Every key the backend can emit is listed —
// a KPI whose detail genuinely lives on THIS page (churn cohorts, campaign ROI,
// menu classes) still gets a destination via KPI_VIEW, so no drill-down is ever
// a dead end. Audited against the KPI_VIEW map so the two stay in step.
const KPI_LINKS: Record<string, string> = {
  food_cost_pct: "/dashboard/inventory",
  food_cost_variance: "/dashboard/inventory",
  low_stock: "/dashboard/inventory",
  complaint_rate: "/dashboard/feedback",
  nps: "/dashboard/feedback",
  avg_rating: "/dashboard/feedback",
  happiness_efficiency: "/dashboard/feedback",
  discount_utilization: "/dashboard/orders",
  offer_redemption: "/dashboard/coupons",
  processing_time: "/dashboard/orders",
  labour_cost: "/dashboard/attendance",
  table_turnaround: "/dashboard/tables",
  revpash: "/dashboard/tables",
  wait_time: "/dashboard/waitlist",
  supplier_on_time: "/dashboard/purchase-orders",
  supplier_score: "/dashboard/purchase-orders",
  booking_fill: "/dashboard/bookings",
  booking_no_show: "/dashboard/bookings",
  valet_retrieval: "/dashboard/valet",
  profit_margin: "/dashboard/accounting",
  churn_rate: "/dashboard/customers",
  menu_bad_share: "/dashboard/menu",
  forecast_mape: "/dashboard/menu",
}

// ---------------------------------------------------------------------------
// View filter ("show only this slice") + KPI sort — pure presentation. Every
// section and KPI key is tagged into exactly ONE detail view; Overview is a
// curated headline cut and Everything shows it all, so nothing is unreachable.
type ViewId = "overview" | "sales" | "discounts" | "menu" | "staff" | "customers" | "operations" | "kitchen" | "supply" | "marketing" | "everything"

const VIEWS: { id: ViewId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "sales", label: "Sales & Revenue" },
  { id: "discounts", label: "Discounts & Offers" },
  { id: "menu", label: "Menu" },
  { id: "staff", label: "Staff" },
  { id: "customers", label: "Customers" },
  { id: "operations", label: "Operations" },
  // Kitchen prep timings are their own section (they also show on Operations,
  // Everything and — compactly — on Overview, so they can't be missed).
  { id: "kitchen", label: "Kitchen" },
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

/** Human label for a view id — used by every "See more in <View>" affordance. */
const viewLabel = (id: ViewId): string => VIEWS.find((v) => v.id === id)?.label ?? "Everything"

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
  if (!user) {return false}
  if (user.role === role) {return true}
  return Array.isArray(user.role_all) ? user.role_all.includes(role) : false
}

const canAccessByAction = (user: PermUser, keywords: string[]) => {
  if (!user) {return false}
  if (Array.isArray(user.actions_set) && user.actions_set.includes("*")) {return true}
  const names = (user.action_names ?? []).map((n) => n.trim().toLowerCase()).filter((n) => n.length > 0)
  if (names.length === 0) {return true}
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
  if (sort === "severity") {arr.sort((a, b) => (SEVERITY_RANK[a.status] ?? 5) - (SEVERITY_RANK[b.status] ?? 5))}
  else if (sort === "name") {arr.sort((a, b) => a.label.localeCompare(b.label))}
  else {arr.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity))}
  return arr
}

// ---------------------------------------------------------------------------
// Reusable per-section sort control. Each list declares a set of sortable
// fields; a field maps a row to a comparable primitive (number | string).
// Sorting is client-side on the already-fetched array — never a refetch.
type SortDir = "asc" | "desc"
interface SortField<T> {
  id: string
  label: string
  // string => localeCompare; number-ish => numeric (nulls sink to the bottom
  // regardless of direction, so "no data" never crowds out real rows).
  get: (row: T) => number | string | null | undefined
  type: "num" | "text"
}

// A section's sort choice: which field + which direction, plus its default.
interface SortState { field: string; dir: SortDir }

// Order an array by the chosen field+direction. Stable within ties (keeps the
// server's order). Nullish numeric/text values always sort last.
function sortRows<T>(rows: T[], fields: SortField<T>[], state: SortState): T[] {
  const f = fields.find((x) => x.id === state.field) ?? fields[0]
  if (!f) {return rows}
  const dir = state.dir === "asc" ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = f.get(a), bv = f.get(b)
    const aNull = av == null || av === "", bNull = bv == null || bv === ""
    if (aNull && bNull) {return 0}
    if (aNull) {return 1} // nulls always last, ignoring dir
    if (bNull) {return -1}
    if (f.type === "text") {return String(av).localeCompare(String(bv)) * dir}
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
              onClick={() => { onChange({ ...state, field: f.id }); }}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${state.field === f.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => { onChange({ ...state, dir: state.dir === "asc" ? "desc" : "asc" }); }}
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

// ---------------------------------------------------------------------------
// Metric drill-down primitives — shared by the KPI tiles AND by every plain
// numeric card on the page. Rule: a number is never a dead click. Clicking one
// opens a dialog with (a) the big value, (b) the metric's explainer copy from
// /analytics/metric-explainers, (c) a breakdown built from data the page has
// ALREADY fetched (no card triggers a request of its own) and (d) the old
// "jump to the source page" navigation, preserved as a link in the footer.

// Categorical palette shared by pie slices and bar fills.
const DRILL_PALETTE = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#ea580c", "#4f46e5"]

// "2nd", "3rd", … — used in the drill-down prose ("the 3rd slowest station").
function ordinalWord(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) {return `${n}th`}
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

// Prep times are stored in ms and always read as "Xm Ys".
function fmtPrepMs(ms: number | null | undefined): string {
  const total = Math.max(0, Math.round(Number(ms ?? 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${s}s`;
}

// ---------------------------------------------------------------------------
// Per-section CSV download. Every section that renders rows or numbers offers a
// small "CSV" button in its header; the file is built CLIENT-SIDE from the data
// the section already rendered (never a refetch), so the numbers in the file are
// exactly the numbers on screen — same rounding, same sort order, same slice.
//
// Convention: a numeric column carries the number as displayed and puts the unit
// in the header (e.g. "Revenue (₹)", "Complaints (%)"); durations carry the
// displayed "Xm Ys" string. Output is CRLF-delimited, BOM-free UTF-8.
type CsvCell = string | number | null | undefined
interface CsvSection {
  /** kebab-case, also the `<section>` slug in the filename. */
  id: string
  label: string
  /** Called at click time so the CSV always reflects the current sort/filter. */
  build: () => CsvCell[][]
}

const csvEscape = (v: CsvCell): string => {
  const s = v == null ? "" : String(v)
  return /["\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const toCsv = (rows: CsvCell[][]): string => rows.map((r) => r.map(csvEscape).join(",")).join("\r\n")

const csvSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
// A report filename is dated by the RESTAURANT's day — an export pulled at
// 00:30 IST belongs to that business day, not to the viewer's yesterday.
const csvToday = (timeZone: string) => todayInZone(timeZone)
const csvFilename = (restaurant: string | undefined, section: string, timeZone: string) =>
  `${csvSlug(restaurant ?? "restaurant") || "restaurant"}-${csvSlug(section) || "section"}-${csvToday(timeZone)}.csv`

function downloadCsv(filename: string, rows: CsvCell[][]) {
  // No BOM: the file is plain UTF-8 (Blob text is encoded as UTF-8).
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Give the browser a tick to start the download before dropping the blob.
  setTimeout(() => { URL.revokeObjectURL(url); }, 0)
}

// The page collects every mounted section so the toolbar can offer one combined
// file. Registration happens once per mount (the id is stable); `build` is read
// through a ref, so the combined file uses each section's CURRENT rows.
interface CsvRegistry {
  register: (s: CsvSection) => void
  unregister: (id: string) => void
  list: () => CsvSection[]
}
const CsvRegistryContext = createContext<CsvRegistry | null>(null)

/**
 * Registers a card's rows for the SECTION-level export. Renders nothing.
 *
 * Downloads are deliberately whole-section ("entire Kitchen", "entire Sales &
 * Revenue"), not per-card: a card used to carry its own CSV button, which meant
 * ~30 tiny buttons and one file per widget. Each card now only contributes its
 * rows to the single toolbar download for the view it lives in. Keeping this as
 * a component (rather than a hook) means the ~30 call sites stay untouched, and
 * a card is exported exactly when it is on screen.
 */
function SectionDownload({ id, label, build }: CsvSection & { className?: string }) {
  const registry = useContext(CsvRegistryContext)
  const latest = useRef(build)
  latest.current = build

  useEffect(() => {
    if (!registry) {return}
    registry.register({ id, label, build: () => latest.current() })
    return () => { registry.unregister(id); }
  }, [registry, id, label])

  return null
}

/** Groups a sort control and a download button in one card-header cluster. */
function HeaderControls({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 items-center gap-1.5">{children}</div>
}

type DrillUnit = "money" | "pct" | "min" | "rating" | "count" | "ms"
type DrillChartKind = "pie" | "bar" | "none"
interface DrillRow { name: string; value: number }

// Everything a clickable number hands to the shared dialog. Only `title` and
// `value` are required — a card with no breakdown still opens and still explains
// itself via `explainerKey` / `note`.
interface MetricDetail {
  title: string
  value: string
  sub?: string
  badge?: ReactNode
  // Key into /analytics/metric-explainers. Missing/unknown key => no explainer.
  explainerKey?: string
  // Extra sentence spelling out this restaurant's own numbers.
  note?: string
  chart?: DrillChartKind
  rows?: DrillRow[]
  unit?: DrillUnit
  breakdownTitle?: string
  /**
   * Bar breakdowns are normally re-sorted biggest-first and capped at 8 (a
   * ranking). Chronological drill-downs (a month, an hour) set this so the
   * breakdown keeps the order it was built in and reads as a timeline.
   */
  keepOrder?: boolean
  /**
   * The filters the clicked element implies, shown as chips at the top of the
   * dialog ("Section: pastry", "Window: last 30 days") so it is obvious which
   * slice every number below belongs to.
   */
  filters?: string[]
  /** Historical series for this data point, drawn as a small line chart. */
  history?: { title?: string; rows: DrillRow[]; unit?: DrillUnit }
  /** The underlying rows contributing to this data point. */
  records?: { title?: string; columns: string[]; rows: (string | number)[][]; note?: string }
  footnote?: string
  link?: string
  linkLabel?: string
  /**
   * The analytics view holding this metric's full section. Renders a working
   * "See more in <View>" action in the dialog footer — the affordance that used
   * to be text-only and did nothing. Every detail on this page sets it, so no
   * drill-down closes without offering somewhere to go.
   */
  view?: ViewId
}

function formatDrill(n: number, unit: DrillUnit, money: (v: number) => string): string {
  switch (unit) {
    case "money": return money(n)
    case "pct": return `${Math.round(n * 10) / 10}%`
    case "min": return `${Math.round(n * 10) / 10} min`
    case "rating": return n.toFixed(1)
    case "ms": return fmtPrepMs(n)
    default: return `${Math.round(n)}`
  }
}

// Fetch-once wrapper around the static explainer copy. Cached in db.ts, so
// every component may call this freely — only the first one hits the network.
function useMetricExplainers(): MetricExplainers {
  const { user } = useAuth();
  const [explainers, setExplainers] = useState<MetricExplainers>({});
  useEffect(() => {
    if (!user?.restaurantUsername) {return;}
    let active = true;
    getMetricExplainers(user.restaurantUsername)
      .then((e) => { if (active) {setExplainers(e);} })
      .catch(() => { /* explainer copy is decoration — never block a card */ });
    return () => { active = false; };
  }, [user?.restaurantUsername]);
  return explainers;
}

// A clickable numeric tile. Affordances: pointer cursor, hover ring + shadow,
// and an expand glyph that fades in on hover/focus.
function MetricTile({ label, value, sub, className, onOpen }: {
  label: string
  value: ReactNode
  sub?: ReactNode
  className?: string
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${label} — click for detail`}
      className={`group h-full w-full cursor-pointer rounded-xl border p-3 text-left transition-shadow hover:shadow-md hover:ring-1 hover:ring-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${className ?? ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <Maximize2 className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      </div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {sub != null && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </button>
  )
}

// The row-shaped variant, for label/value lists inside an existing card.
function MetricRow({ label, value, onOpen }: { label: string; value: ReactNode; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${label} — click for detail`}
      className="group -mx-1 flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1 font-medium">
        {value}
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      </span>
    </button>
  )
}

// Small "?" affordance for a card title whose numbers live in a table rather
// than in a tile — opens the same dialog with just the explainer.
function ExplainerHint({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`What does ${label} mean?`}
      aria-label={`What does ${label} mean?`}
      className="inline-flex shrink-0 cursor-pointer items-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <HelpCircle className="h-4 w-4" />
    </button>
  )
}

// Theme-aware tooltip (the built-in recharts one is not) — mirrors the card
// tooltip styling used elsewhere on the page. Carries the same facts as the
// InteractiveChart tooltip: exact value, share of the breakdown and rank.
function DrillTooltip({ active, payload, fmt, rows }: { active?: boolean; payload?: any[]; fmt: (n: number) => string; rows: DrillRow[] }) {
  if (!active || !payload?.length) {return null}
  const p = payload[0]
  const name = String(p?.payload?.name ?? "")
  const value = Number(p?.value ?? 0)
  const total = rows.reduce((s, r) => s + (Number.isFinite(r.value) ? r.value : 0), 0)
  const rank = 1 + rows.filter((r) => r.value > value).length
  return (
    <div className="animate-in fade-in-0 zoom-in-95 min-w-[150px] rounded-lg border border-border/60 bg-background/95 px-2.5 py-1.5 text-xs shadow-xl backdrop-blur duration-150">
      <div className="truncate font-semibold text-foreground">{name}</div>
      <div className="mt-0.5 text-sm font-bold tabular-nums text-foreground">{fmt(value)}</div>
      <div className="mt-1 space-y-0.5 border-t pt-1 text-[10px] text-muted-foreground">
        {total > 0 && <div className="flex justify-between gap-3"><span>Share</span><span className="tabular-nums text-foreground">{Math.round((value / total) * 1000) / 10}%</span></div>}
        <div className="flex justify-between gap-3"><span>Rank</span><span className="tabular-nums text-foreground">{rank} of {rows.length}</span></div>
      </div>
    </div>
  )
}

// Historical mini-series inside the drill-down: how this metric has moved over
// the periods the page already has in memory.
function DrillHistory({ rows, fmt, title }: { rows: DrillRow[]; fmt: (n: number) => string; title?: string }) {
  if (rows.length < 2) {return null}
  return (
    <div className="grid gap-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title ?? "History"}</p>
      <div className="h-[130px] w-full rounded-lg border p-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis width={44} tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickFormatter={(v: number) => fmt(Number(v))} />
            <Tooltip content={(props) => <DrillTooltip {...props} fmt={fmt} rows={rows} />} />
            <Line type="monotone" dataKey="value" stroke={SERIES_COLOR} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// The underlying records behind a clicked element — the actual rows the number
// was computed from, straight out of the payload the page already holds.
function DrillRecords({ columns, rows, title, note }: { columns: string[]; rows: (string | number)[][]; title?: string; note?: string }) {
  if (rows.length === 0) {return null}
  return (
    <div className="grid gap-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title ?? "Underlying records"}</p>
      <div className="max-h-[220px] overflow-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/70 text-left text-muted-foreground backdrop-blur">
            <tr>
              {columns.map((c, i) => (
                <th key={c} className={`whitespace-nowrap px-2 py-1.5 font-medium ${i === 0 ? "" : "text-right"}`}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} className="border-t">
                {r.map((cell, ci) => (
                  <td key={ci} className={`px-2 py-1.5 ${ci === 0 ? "max-w-[180px] truncate font-medium" : "whitespace-nowrap text-right tabular-nums"}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && <p className="text-[10px] text-muted-foreground">{note}</p>}
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

// Pie (composition) or horizontal bar (ranking) + the exact figures.
function DrillChart({ rows, kind, fmt, total }: { rows: DrillRow[]; kind: "pie" | "bar"; fmt: (n: number) => string; total: number | null }) {
  if (kind === "pie") {
    return (
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
              <Tooltip content={(props) => <DrillTooltip {...props} fmt={fmt} rows={rows} />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <DrillBreakdown rows={rows} fmt={fmt} total={total} />
      </div>
    )
  }
  return (
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
            <Tooltip cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.5 }} content={(props) => <DrillTooltip {...props} fmt={fmt} rows={rows} />} />
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
  )
}

// "What this means / How it's computed / tip" block, straight from the backend
// copy so the web dashboard and the Flutter owner app say the same thing.
function ExplainerBlock({ explainer }: { explainer: MetricExplainer | undefined }) {
  if (!explainer) {return null}
  return (
    <div className="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">What this means</p>
        <p>{explainer.what}</p>
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">How it&apos;s computed</p>
        <p className="text-muted-foreground">{explainer.how}</p>
      </div>
      {explainer.tip && (
        <div className="flex items-start gap-2 rounded-md bg-background/70 p-2">
          <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-yellow-500" />
          <p className="text-xs text-muted-foreground">{explainer.tip}</p>
        </div>
      )}
    </div>
  )
}

// Small, always-working "jump to the section that owns this" control. Switching
// the view is a real action (it re-renders the page onto that slice) — this is
// the affordance the dead "see more in Sales & Revenue" text was pretending to be.
function SeeMoreInView({ view, onOpenView, className }: { view: ViewId; onOpenView: (v: ViewId) => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => { onOpenView(view); }}
      className={`inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${className ?? ""}`}
    >
      See more in {viewLabel(view)}
      <ChevronRight className="h-4 w-4" />
    </button>
  )
}

// The one dialog every numeric card opens. `detail == null` keeps it closed.
function MetricDetailDialog({ detail, explainers, money, onOpenChange, onOpenView }: {
  detail: MetricDetail | null
  explainers: MetricExplainers
  money: (n: number | null | undefined) => string
  onOpenChange: (open: boolean) => void
  /** Switches the analytics view. Closes the dialog first so the jump is visible. */
  onOpenView?: (v: ViewId) => void
}) {
  const explainer = detail?.explainerKey ? explainers[detail.explainerKey] : undefined
  const unit = detail?.unit ?? "count"
  const fmt = (n: number) => formatDrill(n, unit, money)
  const kind: DrillChartKind = detail?.chart ?? ((detail?.rows?.length ?? 0) > 0 ? "bar" : "none")
  const raw = (detail?.rows ?? []).filter((r) => Number.isFinite(r.value))
  // Bars: biggest first, capped at 8 (a ranking). Pies keep composition order,
  // and so does an explicitly chronological breakdown (`keepOrder`).
  const rows = kind === "bar" && !detail?.keepOrder ? [...raw].sort((a, b) => b.value - a.value).slice(0, 8) : raw
  const total = rows.reduce((s, r) => s + (r.value || 0), 0)
  const historyFmt = (n: number) => formatDrill(n, detail?.history?.unit ?? unit, money)

  return (
    <Dialog open={detail != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto" aria-describedby={undefined}>
        {detail && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span>{detail.title}</span>
                {detail.badge}
              </DialogTitle>
              <div className="text-3xl font-bold">{detail.value}</div>
              {detail.sub && <p className="text-xs text-muted-foreground">{detail.sub}</p>}
            </DialogHeader>

            {/* Filters carried in from the clicked element — the slice every
                number below is scoped to. */}
            {(detail.filters?.length ?? 0) > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Filter className="h-3 w-3 shrink-0 text-muted-foreground" />
                {detail.filters?.map((f) => (
                  <span key={f} className="rounded-full border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{f}</span>
                ))}
              </div>
            )}

            <ExplainerBlock explainer={explainer} />
            {detail.note && <p className="text-sm text-muted-foreground">{detail.note}</p>}
            {/* Only when there is genuinely nothing else to show — a chart or a
                note already answers "what am I looking at?". */}
            {!explainer && !detail.note && kind === "none" && (
              <p className="text-sm text-muted-foreground">No written explainer for this metric yet.</p>
            )}

            {kind !== "none" && (
              rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No detailed breakdown yet for this metric.</p>
              ) : (
                <div className="grid gap-2">
                  {detail.breakdownTitle && (
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{detail.breakdownTitle}</p>
                  )}
                  <DrillChart rows={rows} kind={kind} fmt={fmt} total={kind === "pie" ? (total || null) : null} />
                </div>
              )
            )}

            {detail.history && (
              <DrillHistory rows={detail.history.rows} fmt={historyFmt} title={detail.history.title} />
            )}
            {detail.records && (
              <DrillRecords columns={detail.records.columns} rows={detail.records.rows} title={detail.records.title} note={detail.records.note} />
            )}

            {/* Footer actions. At least one is always present: a metric with no
                records page still offers the view that owns its full section. */}
            <DialogFooter className="items-center gap-2 sm:justify-between">
              <span className="text-xs text-muted-foreground">{detail.footnote ?? ""}</span>
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {detail.view && onOpenView && (
                  <SeeMoreInView
                    view={detail.view}
                    onOpenView={(v) => { onOpenChange(false); onOpenView(v); }}
                  />
                )}
                {detail.link && (
                  <Link href={detail.link} className="text-sm font-medium text-primary hover:underline">
                    {detail.linkLabel ?? "View full records"} →
                  </Link>
                )}
              </span>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// One muted sentence naming the items the backend is currently holding back,
// with the cooldown release date when it sent one. Names are capped so the
// line stays a single readable row.
const PAUSED_NAMES_SHOWN = 3;
function pausedSummary(items: SuppressedSuggestion[], count: number, timeZone: string): string {
  const shown = items.slice(0, PAUSED_NAMES_SHOWN).map((s) => {
    const when = s.reason === "cooldown" && s.retry_after ? formatLongDate(s.retry_after, timeZone, "") : "";
    return when ? `${s.name} (until ${when})` : s.name;
  });
  const more = Math.max(0, count - shown.length);
  return `Paused: ${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}.`;
}

// The backend now sends a written `explanation` for every withheld item. This is
// only the fallback for an older backend that sends the bare guard code — the
// code itself is still what we branch on, never rendered.
function suppressedExplanation(s: SuppressedSuggestion, timeZone: string): string {
  if (s.explanation) {return s.explanation;}
  const whenText = s.retry_after ? formatLongDate(s.retry_after, timeZone, "") : "";
  const until = whenText ? ` until ${whenText}` : "";
  switch (s.reason) {
    case "cooldown": return `Paused${until}: the price moved recently, so there isn't a full period of sales at the new price yet.`;
    case "drift_cap": return "Already as far from its original price as automatic suggestions are allowed to go.";
    default: return "A further cut would leave too little margin over the item's food cost.";
  }
}

// Confidence chip colours — same three-band language the backend uses.
const CONFIDENCE_TONE: Record<string, string> = {
  high: "border-green-300 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300",
  medium: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  low: "border-border bg-muted text-muted-foreground",
};

// The structured price-suggestion explainer: why, expected effect, confidence,
// the exact delta, and the margin / caution lines when the backend sends them.
// Falls back to the legacy one-line `reason` when the new fields are absent.
function PriceExplainer({ s, delta, deltaPct }: { s: PriceSuggestion; delta: string; deltaPct: string }) {
  const structured = Boolean(s.why ?? s.expected_effect);
  if (!structured) {
    return <p className="text-xs text-muted-foreground">{s.reason}</p>;
  }
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${s.direction === "increase" ? "border-green-300 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300" : "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-300"}`}>
          {delta} ({deltaPct})
        </span>
        {s.confidence && (
          <span
            className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${CONFIDENCE_TONE[s.confidence] ?? CONFIDENCE_TONE.low}`}
            title={s.confidence_note}
          >
            {s.confidence} confidence
          </span>
        )}
      </div>
      {s.why && <p className="text-xs text-foreground">{s.why}</p>}
      {s.expected_effect && <p className="text-xs text-muted-foreground">{s.expected_effect}</p>}
      {s.confidence_note && <p className="text-xs text-muted-foreground">{s.confidence_note}</p>}
      {s.margin_note && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{s.margin_note}</span>
        </p>
      )}
      {s.caution && (
        <p className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{s.caution}</span>
        </p>
      )}
    </div>
  );
}

function ActionableInsights({ view, onOpenView }: { view: ViewId; onOpenView: (v: ViewId) => void }) {
  const { timezone } = useTimezone();
  const { user } = useAuth();
  const { currency, currencySymbol } = useCurrency();
  const { toast } = useToast();
  const [data, setData] = useState<MenuInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  // Price suggestion pending confirmation + the row currently being written.
  const [pendingPrice, setPendingPrice] = useState<PriceSuggestion | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MetricDetail | null>(null); // expanded numeric card
  const explainers = useMetricExplainers();
  const money = (n: number | null | undefined) => `${currencySymbol}${Number(n ?? 0).toFixed(0)}`;
  const money2 = (n: number | null | undefined) => `${currencySymbol}${Number(n ?? 0).toFixed(2)}`;
  // Signed money/percent for a price delta, always rendered from the backend's
  // own delta fields (a margin-clamped cut is NOT the nominal step).
  const deltaMoney = (s: PriceSuggestion) => {
    const d = s.delta_amount ?? s.suggested_price - s.current_price;
    return `${d >= 0 ? "+" : "−"}${money2(Math.abs(d))}`;
  };
  const deltaPercent = (s: PriceSuggestion) => {
    const p = s.delta_percent ?? ((s.suggested_price - s.current_price) / (s.current_price || 1)) * 100;
    return `${p >= 0 ? "+" : "−"}${Math.abs(p).toFixed(1)}%`;
  };

  // Per-section sort state (defaults = most meaningful metric).
  const [dishSort, setDishSort] = useSectionSort("revenue");
  const [waiterSort, setWaiterSort] = useSectionSort("revenue");
  const [priceSort, setPriceSort] = useSectionSort("delta");
  const [slowSort, setSlowSort] = useSectionSort("quantity", "asc");

  // Applying a suggestion edits the live menu — same gate the Menu module uses
  // (admins always pass; otherwise the employee needs a menu-ish action).
  const canEditMenu = hasRole(user, "admin") || canAccessByAction(user, ["menu"]);

  useEffect(() => {
    if (!user?.restaurantUsername) {return;}
    let active = true;
    setLoading(true);
    getMenuInsights(user.restaurantUsername, 30)
      .then((d) => { if (active) {setData(d);} })
      .finally(() => { if (active) {setLoading(false);} });
    return () => { active = false; };
  }, [user?.restaurantUsername, reload]);

  const confirmApplyPrice = async () => {
    const s = pendingPrice;
    if (!s?.id || !user?.restaurantUsername) {return;}
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
  if (!showStats && !showDishes && !showWaiters && !showPrices && !showSlow) {return null;}

  if (loading) {return <Card><CardContent className="py-10 text-center text-muted-foreground">Loading insights…</CardContent></Card>;}
  if (!data) {return null;}

  // Items the backend withheld (recently repriced, drift-capped or floored).
  // Optional on the wire — older backends simply send nothing.
  const suppressed = data.suppressed_suggestions ?? { count: 0, items: [] };
  const hasSuppressed = suppressed.count > 0 && suppressed.items.length > 0;
  const hasAny = data.top_dishes.length > 0 || data.price_suggestions.length > 0 || data.top_waiters.length > 0 || hasSuppressed;

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

  const windowLabel = `Last ${data.period_days} days`;
  // Breakdowns for the three headline tiles — all from `data`, no extra fetch.
  const dishRevenueRows: DrillRow[] = data.top_dishes.map((d) => ({ name: d.name, value: d.revenue }));
  const dishQtyRows: DrillRow[] = data.top_dishes.map((d) => ({ name: d.name, value: d.quantity }));
  const byCategoryRows: DrillRow[] = Object.entries(
    data.top_dishes.reduce<Record<string, number>>((acc, d) => {
      const key = d.category || "Uncategorised";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  ).map(([name, value]) => ({ name, value }));

  const revenueDetail: MetricDetail = {
    title: "Revenue",
    value: money(data.total_revenue),
    sub: windowLabel.toLowerCase(),
    explainerKey: "revenue",
    note: `${data.total_items_sold} item${data.total_items_sold === 1 ? "" : "s"} sold across ${data.top_dishes.length} distinct dish${data.top_dishes.length === 1 ? "" : "es"}.`,
    chart: "bar",
    rows: dishRevenueRows,
    unit: "money",
    breakdownTitle: "Revenue by dish (top 8)",
    footnote: windowLabel,
    link: "/dashboard/orders",
    linkLabel: "View orders",
    view: "sales",
  };
  const itemsSoldDetail: MetricDetail = {
    title: "Items sold",
    value: String(data.total_items_sold),
    sub: windowLabel.toLowerCase(),
    explainerKey: "top_dish",
    note: `Every line item on every non-cancelled order in the window, quantities added up. That is ${data.top_dishes.length > 0 ? `an average of ${Math.round((data.total_items_sold / data.top_dishes.length) * 10) / 10} per dish` : "no sales yet"}.`,
    chart: "bar",
    rows: dishQtyRows,
    unit: "count",
    breakdownTitle: "Quantity by dish (top 8)",
    footnote: windowLabel,
    link: "/dashboard/orders",
    linkLabel: "View orders",
    view: "menu",
  };
  const distinctDishesDetail: MetricDetail = {
    title: "Distinct dishes",
    value: String(data.top_dishes.length),
    sub: "sold at least once",
    note: `How much of the menu is actually earning. ${data.slow_movers.length} available item${data.slow_movers.length === 1 ? "" : "s"} barely sold in this window — see Slow movers below.`,
    chart: "pie",
    rows: byCategoryRows,
    unit: "count",
    breakdownTitle: "Dishes sold, by category",
    footnote: windowLabel,
    link: "/dashboard/menu",
    linkLabel: "View menu",
    view: "menu",
  };

  return (
    <div className="grid gap-4 md:gap-8">
      {showStats && (
        <div className="grid gap-2">
          <div className="flex items-center justify-end">
            <SectionDownload
              id="menu-insights-headline"
              label="Menu insights (headline)"
              build={() => [
                ["Metric", "Value"],
                [`Revenue (${currencySymbol})`, Number(data.total_revenue ?? 0).toFixed(0)],
                ["Items sold", data.total_items_sold],
                ["Distinct dishes", data.top_dishes.length],
                ["Window (days)", data.period_days],
              ]}
            />
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <MetricTile className="bg-card shadow-sm" label={`Revenue (${data.period_days}d)`} value={money(data.total_revenue)} onOpen={() => { setDetail(revenueDetail); }} />
            <MetricTile className="bg-card shadow-sm" label={`Items sold (${data.period_days}d)`} value={data.total_items_sold} onOpen={() => { setDetail(itemsSoldDetail); }} />
            <MetricTile className="bg-card shadow-sm" label="Distinct dishes" value={data.top_dishes.length} onOpen={() => { setDetail(distinctDishesDetail); }} />
          </div>
        </div>
      )}

      {!hasAny && (showDishes || showWaiters || showPrices) && (
        <Card><CardContent className="py-8 text-center text-muted-foreground">No sales in the last 30 days yet — insights will appear as orders come in.</CardContent></Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 md:gap-8">
        {showDishes && data.top_dishes.length > 0 && (
          <Card>
            <CardHeader>
              <SectionHeaderRow control={
                <HeaderControls>
                  <SortControl fields={dishFields} state={dishSort} onChange={setDishSort} />
                  <SectionDownload
                    id="top-dishes"
                    label="Top-selling dishes"
                    build={() => [
                      ["Rank", "Dish", "Category", "Qty sold", `Revenue (${currencySymbol})`, "Orders"],
                      ...topDishes.map((d, i) => [i + 1, d.name, d.category ?? "", d.quantity, Number(d.revenue ?? 0).toFixed(0), d.orders]),
                    ]}
                  />
                </HeaderControls>
              }>
                <CardTitle className="flex items-center gap-2">
                  <Flame className="h-5 w-5 text-orange-500" /> Top-selling dishes
                  <ExplainerHint label="top dish" onOpen={() => { setDetail({ ...revenueDetail, title: "Top dish", value: data.top_dishes[0]?.name ?? "—", sub: data.top_dishes[0] ? `${money(data.top_dishes[0].revenue)} from ${data.top_dishes[0].quantity} sold` : undefined, explainerKey: "top_dish", note: undefined }); }} />
                </CardTitle>
                <CardDescription>Best performers over the last {data.period_days} days.</CardDescription>
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
              {/* Overview shows a curated cut; the Menu view holds price
                  suggestions and slow movers as well. */}
              {view === "overview" && (
                <div className="flex justify-end pt-1"><SeeMoreInView view="menu" onOpenView={onOpenView} /></div>
              )}
            </CardContent>
          </Card>
        )}

        {showWaiters && data.top_waiters.length > 0 && (
          <Card>
            <CardHeader>
              <SectionHeaderRow control={
                <HeaderControls>
                  <SortControl fields={waiterFields} state={waiterSort} onChange={setWaiterSort} />
                  <SectionDownload
                    id="top-waiters"
                    label="Top waiters"
                    build={() => [
                      ["Rank", "Waiter", "Orders", `Revenue (${currencySymbol})`],
                      ...topWaiters.map((w, i) => [i + 1, w.employee_name, w.orders, Number(w.revenue ?? 0).toFixed(0)]),
                    ]}
                  />
                </HeaderControls>
              }>
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
              <SectionHeaderRow control={
                <HeaderControls>
                  <SortControl fields={priceFields} state={priceSort} onChange={setPriceSort} />
                  <SectionDownload
                    id="price-suggestions"
                    label="Price suggestions"
                    build={() => {
                      const rows: (string | number)[][] = [
                        ["Item", "Category", `Current (${currencySymbol})`, `Suggested (${currencySymbol})`, "Direction", `Change (${currencySymbol})`, "Change (%)", "Confidence", "Why", "Expected effect"],
                        ...priceSuggestions.map((s) => [
                          s.name, s.category ?? "",
                          Number(s.current_price ?? 0).toFixed(0),
                          Number(s.suggested_price ?? 0).toFixed(0),
                          s.direction,
                          // Same figures the card shows, with an ASCII sign so a
                          // spreadsheet reads them as numbers.
                          (s.delta_amount ?? s.suggested_price - s.current_price).toFixed(2),
                          (s.delta_percent ?? ((s.suggested_price - s.current_price) / (s.current_price || 1)) * 100).toFixed(1),
                          s.confidence ?? "",
                          s.why ?? s.reason ?? "",
                          s.expected_effect ?? "",
                        ]),
                      ];
                      if (hasSuppressed) {
                        rows.push([]);
                        rows.push([`Held back for now (${suppressed.count})`]);
                        rows.push(["Item", "Why it is paused"]);
                        for (const s of suppressed.items) {rows.push([s.name, suppressedExplanation(s, timezone)]);}
                      }
                      return rows;
                    }}
                  />
                </HeaderControls>
              }>
                <CardTitle className="flex items-center gap-2"><Lightbulb className="h-5 w-5 text-yellow-500" /> Price suggestions</CardTitle>
                <CardDescription>Data-driven ideas to grow revenue. Review before applying.</CardDescription>
                <CardDescription className="mt-1 text-xs">
                  Once you apply a price, that item is paused until a full period of sales at the new price
                  exists — so a suggestion is never stacked on top of itself.
                </CardDescription>
                {hasSuppressed && (
                  <p className="mt-1 text-xs text-muted-foreground">{pausedSummary(suppressed.items, suppressed.count, timezone)}</p>
                )}
              </SectionHeaderRow>
            </CardHeader>
            <CardContent className="grid gap-2 md:grid-cols-2">
              {priceSuggestions.map((s) => {
                const up = s.direction === "increase";
                return (
                  <div key={`${s.name}-${s.direction}`} className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                    {up ? <ArrowUp className="mt-0.5 h-4 w-4 shrink-0 text-green-600" /> : <ArrowDown className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />}
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="font-medium">{s.name}{s.category ? <span className="ml-1 text-xs font-normal text-muted-foreground">{s.category}</span> : null}</p>
                      <PriceExplainer s={s} delta={deltaMoney(s)} deltaPct={deltaPercent(s)} />
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
                        onClick={() => { setPendingPrice(s); }}
                      >
                        <Check className="mr-1 h-3.5 w-3.5" />
                        {applyingId === s.id ? "Applying…" : "Apply"}
                      </Button>
                    )}
                  </div>
                );
              })}
              {hasSuppressed && (
                <div className="rounded-lg border border-dashed p-3 md:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Held back for now ({suppressed.count})</p>
                  <ul className="mt-2 space-y-1.5">
                    {suppressed.items.map((s, i) => (
                      <li key={s.id ?? `${s.name}-${i}`} className="text-xs">
                        <span className="font-medium">{s.name}</span>
                        <span className="text-muted-foreground"> — {suppressedExplanation(s, timezone)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {showPrices && data.price_suggestions.length === 0 && hasSuppressed && (
          <Card className="md:col-span-2">
            <CardHeader>
              <SectionHeaderRow control={
                <SectionDownload
                  id="price-suggestions"
                  label="Price suggestions (all paused)"
                  build={() => [
                    ["Item", "Why it is paused"],
                    ...suppressed.items.map((s) => [s.name, suppressedExplanation(s, timezone)]),
                  ]}
                />
              }>
              <CardTitle className="flex items-center gap-2"><Lightbulb className="h-5 w-5 text-yellow-500" /> Price suggestions</CardTitle>
              <CardDescription>All price suggestions are in their quiet period.</CardDescription>
              <CardDescription className="mt-1 text-xs">
                Recently-adjusted items are paused until a full period of sales at the new price exists.
              </CardDescription>
              </SectionHeaderRow>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5">
                {suppressed.items.map((s, i) => (
                  <li key={s.id ?? `${s.name}-${i}`} className="text-xs">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-muted-foreground"> — {suppressedExplanation(s, timezone)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {showSlow && data.slow_movers.length > 0 && (
          <Card className="md:col-span-2">
            <CardHeader>
              <SectionHeaderRow control={
                <HeaderControls>
                  <SortControl fields={slowFields} state={slowSort} onChange={setSlowSort} />
                  <SectionDownload
                    id="slow-movers"
                    label="Slow movers"
                    build={() => [
                      ["Dish", "Category", "Qty sold", `Price (${currencySymbol})`],
                      ...slowMovers.map((d) => [d.name, d.category ?? "", d.quantity, Number(d.current_price ?? 0).toFixed(0)]),
                    ]}
                  />
                </HeaderControls>
              }>
                <CardTitle className="flex items-center gap-2">
                  <Snail className="h-5 w-5 text-muted-foreground" /> Slow movers
                  <ExplainerHint label="slow movers" onOpen={() => { setDetail({
                    title: "Slow movers",
                    value: String(data.slow_movers.length),
                    sub: `available item${data.slow_movers.length === 1 ? "" : "s"} barely selling`,
                    explainerKey: "slow_mover",
                    chart: "bar",
                    rows: data.slow_movers.map((d) => ({ name: d.name, value: d.quantity })),
                    unit: "count",
                    breakdownTitle: "Quantity sold",
                    footnote: windowLabel,
                    link: "/dashboard/menu",
                    linkLabel: "View menu",
                    view: "menu",
                  }); }} />
                </CardTitle>
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

      <Dialog open={pendingPrice != null} onOpenChange={(open) => { if (!open) {setPendingPrice(null);} }}>
        <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto" aria-describedby={undefined}>
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
                  <span className="text-xs text-muted-foreground">{deltaMoney(pendingPrice)} ({deltaPercent(pendingPrice)})</span>
                </p>
              </div>
              {/* Same explainer the card shows, so the reasoning is in front of
                  the operator at the moment they commit. */}
              <PriceExplainer s={pendingPrice} delta={deltaMoney(pendingPrice)} deltaPct={deltaPercent(pendingPrice)} />
              <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
                This changes the <strong>live menu</strong> straight away — new orders, the guest QR menu and every bill will use the new price. Existing open bills keep the price they were placed at.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPendingPrice(null); }} disabled={applyingId != null}>Cancel</Button>
            <Button onClick={() => { void confirmApplyPrice(); }} disabled={applyingId != null}>
              {applyingId != null ? "Applying…" : "Apply price"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MetricDetailDialog detail={detail} explainers={explainers} money={money} onOpenView={onOpenView} onOpenChange={(o) => { if (!o) {setDetail(null);} }} />
    </div>
  );
}

// Real operational charts (replaces the previous hardcoded mock data): peak order
// times by hour and order volume by day of week, computed from actual orders.
function OperationsCharts({ view, onOpenView }: { view: ViewId; onOpenView: (v: ViewId) => void }) {
  const { user } = useAuth();
  const { currencySymbol } = useCurrency();
  const explainers = useMetricExplainers();
  const [data, setData] = useState<OperationsAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<MetricDetail | null>(null);
  const money = (n: number | null | undefined) => `${currencySymbol}${Number(n ?? 0).toFixed(0)}`;

  useEffect(() => {
    if (!user?.restaurantUsername) {return;}
    let active = true;
    setLoading(true);
    getOperationsAnalytics(user.restaurantUsername, 30)
      .then((d) => { if (active) {setData(d);} })
      .finally(() => { if (active) {setLoading(false);} });
    return () => { active = false; };
  }, [user?.restaurantUsername]);

  if (!inView(view, "operations")) {return null;}

  const hours = data?.by_hour ?? [];
  const weekdays = data?.by_weekday ?? [];
  const byHour = hours.map((h) => ({ time: `${String(h.hour).padStart(2, "0")}:00`, orders: h.orders }));
  const byWeekday = weekdays.map((w) => ({ day: w.label, orders: w.orders }));
  const hasData = hours.some((h) => h.orders > 0);

  const hourOrders = hours.reduce((s, h) => s + h.orders, 0);
  const weekdayOrders = weekdays.reduce((s, w) => s + w.orders, 0);
  const busiestHour = hours.reduce<typeof hours[number] | null>((m, h) => (h.orders > (m?.orders ?? -1) ? h : m), null);
  const quietestHour = hours.filter((h) => h.orders > 0).reduce<typeof hours[number] | null>((m, h) => (h.orders < (m?.orders ?? Infinity) ? h : m), null);
  const busiestDay = weekdays.reduce<typeof weekdays[number] | null>((m, w) => (w.orders > (m?.orders ?? -1) ? w : m), null);
  const avgHourOrders = hours.length > 0 ? hourOrders / hours.length : 0;
  const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

  // Hover points. Each carries the context the tooltip shows beyond the value:
  // the money behind the count, and the average ticket.
  const hourPoints: IvPoint[] = hours.map((h) => ({
    key: `h-${h.hour}`,
    label: hourLabel(h.hour),
    value: h.orders,
    caption: `${hourLabel(h.hour)}–${hourLabel((h.hour + 1) % 24)} · last 30 days`,
    meta: [
      { label: "Revenue", value: money(h.revenue) },
      { label: "Avg ticket", value: h.orders > 0 ? money(h.revenue / h.orders) : "—" },
    ],
  }));
  const weekdayPoints: IvPoint[] = weekdays.map((w) => ({
    key: `w-${w.weekday}`,
    label: w.label,
    value: w.orders,
    caption: `Every ${w.label} in the last 30 days`,
    meta: [
      { label: "Revenue", value: money(w.revenue) },
      { label: "Avg ticket", value: w.orders > 0 ? money(w.revenue / w.orders) : "—" },
    ],
  }));

  // Clicking an hour: how it compares, what it earned, and the whole day's
  // shape as history so the peak is visible in context.
  const openHour = (index: number) => {
    const h = hours[index];
    if (!h) {return;}
    const share = hourOrders > 0 ? (h.orders / hourOrders) * 100 : 0;
    const rank = 1 + hours.filter((x) => x.orders > h.orders).length;
    setDetail({
      title: `Orders at ${hourLabel(h.hour)}`,
      value: `${h.orders}`,
      sub: `${hourLabel(h.hour)}–${hourLabel((h.hour + 1) % 24)} · last 30 days`,
      filters: [`Hour: ${hourLabel(h.hour)}`, "Window: last 30 days", "Metric: orders placed"],
      note: [
        `This hour took ${h.orders} of the ${hourOrders} orders in the window (${Math.round(share * 10) / 10}%) and ${money(h.revenue)} of revenue — the ${rank === 1 ? "busiest" : `${ordinalWord(rank)} busiest`} hour of the day, against an average hour of ${Math.round(avgHourOrders * 10) / 10}.`,
        rank > 1 && busiestHour ? `Your peak is ${hourLabel(busiestHour.hour)} with ${busiestHour.orders}.` : "",
      ].filter(Boolean).join(" "),
      chart: "bar",
      keepOrder: true,
      unit: "count",
      breakdownTitle: "How this hour compares",
      rows: [
        { name: hourLabel(h.hour), value: h.orders },
        { name: busiestHour ? `Busiest (${hourLabel(busiestHour.hour)})` : "Busiest", value: busiestHour?.orders ?? 0 },
        { name: "Average hour", value: Math.round(avgHourOrders * 10) / 10 },
        { name: quietestHour ? `Quietest (${hourLabel(quietestHour.hour)})` : "Quietest", value: quietestHour?.orders ?? 0 },
      ],
      history: { title: "Orders across the whole day", rows: hours.map((x) => ({ name: hourLabel(x.hour), value: x.orders })), unit: "count" },
      records: {
        title: "Figures behind this hour",
        columns: ["Measure", "Value"],
        rows: [
          ["Orders", h.orders],
          ["Revenue", money(h.revenue)],
          ["Average ticket", h.orders > 0 ? money(h.revenue / h.orders) : "—"],
          ["Share of 30-day orders", `${Math.round(share * 10) / 10}%`],
          ["Rank among 24 hours", `${rank} of ${hours.length}`],
        ],
      },
      footnote: "Last 30 days · times are the restaurant's local time",
      link: "/dashboard/orders",
      linkLabel: "Open orders",
      view: "operations",
    });
  };

  const openWeekday = (index: number) => {
    const w = weekdays[index];
    if (!w) {return;}
    const share = weekdayOrders > 0 ? (w.orders / weekdayOrders) * 100 : 0;
    const rank = 1 + weekdays.filter((x) => x.orders > w.orders).length;
    setDetail({
      title: `${w.label} orders`,
      value: `${w.orders}`,
      sub: `Every ${w.label} in the last 30 days`,
      filters: [`Day: ${w.label}`, "Window: last 30 days", "Metric: orders placed"],
      note: `${w.label} carried ${Math.round(share * 10) / 10}% of the week's ${weekdayOrders} orders and ${money(w.revenue)} of revenue — ${rank === 1 ? "your busiest day" : `the ${ordinalWord(rank)} busiest day, behind ${busiestDay?.label ?? "—"}`}.`,
      chart: "bar",
      keepOrder: true,
      unit: "count",
      breakdownTitle: "Orders by day of week",
      rows: weekdays.map((x) => ({ name: x.label, value: x.orders })),
      history: { title: "Revenue by day of week", rows: weekdays.map((x) => ({ name: x.label.slice(0, 3), value: x.revenue })), unit: "money" },
      records: {
        title: "Figures behind this day",
        columns: ["Measure", "Value"],
        rows: [
          ["Orders", w.orders],
          ["Revenue", money(w.revenue)],
          ["Average ticket", w.orders > 0 ? money(w.revenue / w.orders) : "—"],
          ["Share of week", `${Math.round(share * 10) / 10}%`],
          ["Rank", `${rank} of ${weekdays.length}`],
        ],
      },
      footnote: "Last 30 days",
      link: "/dashboard/orders",
      linkLabel: "Open orders",
      view: "operations",
    });
  };

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
          <SectionHeaderRow control={hasData ? (
            <SectionDownload
              id="peak-order-times"
              label="Peak order times"
              build={() => [["Hour", "Orders"], ...byHour.map((h) => [h.time, h.orders])]}
            />
          ) : null}>
            <CardTitle>Peak Order Times</CardTitle>
            <CardDescription>Order volume by hour of day (restaurant local time), last 30 days. Hover any hour for its figures; click it for the full breakdown.</CardDescription>
          </SectionHeaderRow>
        </CardHeader>
        <CardContent>
          {loading ? spinner : !hasData ? empty : (
            <InteractiveChart
              kind="line"
              points={hourPoints}
              fmt={(n) => `${Math.round(n * 10) / 10}`}
              seriesLabel="orders"
              chartLabel="Orders by hour of day"
              color={SERIES_COLOR}
              height={260}
              xInterval={2}
              onSelect={(_p, i) => { openHour(i); }}
            />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <SectionHeaderRow control={hasData ? (
            <SectionDownload
              id="orders-by-weekday"
              label="Orders by day of week"
              build={() => [["Day", "Orders"], ...byWeekday.map((w) => [w.day, w.orders])]}
            />
          ) : null}>
            <CardTitle>Orders by Day of Week</CardTitle>
            <CardDescription>Which days are busiest, last 30 days. Every bar is hoverable and clickable.</CardDescription>
          </SectionHeaderRow>
        </CardHeader>
        <CardContent>
          {loading ? spinner : !hasData ? empty : (
            <InteractiveChart
              kind="bar"
              points={weekdayPoints}
              fmt={(n) => `${Math.round(n * 10) / 10}`}
              seriesLabel="orders"
              chartLabel="Orders by day of week"
              color={SERIES_COLOR}
              height={280}
              onSelect={(_p, i) => { openWeekday(i); }}
            />
          )}
        </CardContent>
      </Card>

      <MetricDetailDialog detail={detail} explainers={explainers} money={money} onOpenView={onOpenView} onOpenChange={(o) => { if (!o) {setDetail(null);} }} />
    </div>
  );
}

// Kitchen analytics: per-dish prep time, per-section (station) averages and an
// order-level prep summary — all from Orders.timing (pause-excluded, server-side).
// ms are formatted "Xm Ys" (see fmtPrepMs).
//
// This is a FIRST-CLASS section: it has its own "Kitchen" view, still appears in
// Operations/Everything, and shows a compact cut on Overview so the numbers are
// discoverable without hunting through the view picker.

// `by_section_items` — item-wise prep time grouped per kitchen section. Additive
// on the wire (an older backend simply omits it), and typed here rather than in
// db.ts because it is read by exactly one card. Each entry is the station's own
// aggregate plus the individual dishes routed to it; `dishes` is capped server
// side at 25, with `dishes_total` giving the true count.
interface KitchenSectionItems {
  section: string
  items_timed: number
  avg_prep_ms: number
  max_prep_ms: number
  p90_prep_ms?: number
  dishes_total: number
  dishes: KitchenDishStat[]
}
type KitchenAnalyticsWithItems = KitchenAnalytics & { by_section_items?: KitchenSectionItems[] }

function KitchenAnalyticsView({ view, onOpenView }: { view: ViewId; onOpenView: (v: ViewId) => void }) {
  const { user } = useAuth();
  const { currency, currencySymbol } = useCurrency();
  const explainers = useMetricExplainers();
  const [data, setData] = useState<KitchenAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [dishSort, setDishSort] = useSectionSort("avg_prep_ms");
  const [sectionSort, setSectionSort] = useSectionSort("avg_prep_ms");
  const [detail, setDetail] = useState<MetricDetail | null>(null);
  // Set by clicking a bar in the item-wise chart: the station the item table
  // below is filtered to. null = every station.
  const [itemSection, setItemSection] = useState<string | null>(null);
  const money = (n: number | null | undefined) => `${currencySymbol}${Number(n ?? 0).toFixed(0)}`;
  // Every prep-time drill-down belongs to the Kitchen view, so stamp it once
  // here rather than repeating `view: "kitchen"` on seven detail objects.
  const openDetail = (d: MetricDetail) => { setDetail({ view: "kitchen", ...d }); };

  useEffect(() => {
    if (!user?.restaurantUsername) {return;}
    let active = true;
    setLoading(true);
    getKitchenAnalytics(user.restaurantUsername, 30)
      .then((d) => { if (active) {setData(d);} })
      .finally(() => { if (active) {setLoading(false);} });
    return () => { active = false; };
  }, [user?.restaurantUsername]);

  // Dedicated Kitchen view + Operations/Everything (as before) + a compact cut
  // on Overview so the section is discoverable without opening the view picker.
  if (!(view === "kitchen" || inView(view, "operations", true))) {return null;}
  const compact = view === "overview";

  // p90 is additive on the wire; max is the honest fallback for an old backend.
  const dishP90 = (d: KitchenDishStat) => d.p90_prep_ms ?? d.max_prep_ms;
  const sectionP90 = (s: KitchenSectionStat) => s.p90_prep_ms ?? s.max_prep_ms;

  const dishFields: SortField<KitchenDishStat>[] = [
    { id: "avg_prep_ms", label: "Avg", type: "num", get: (d) => d.avg_prep_ms },
    { id: "p90_prep_ms", label: "P90", type: "num", get: dishP90 },
    { id: "max_prep_ms", label: "Max", type: "num", get: (d) => d.max_prep_ms },
    { id: "count", label: "Count", type: "num", get: (d) => d.count },
    { id: "name", label: "Name", type: "text", get: (d) => d.name },
  ];
  const sectionFields: SortField<KitchenSectionStat>[] = [
    { id: "avg_prep_ms", label: "Avg", type: "num", get: (s) => s.avg_prep_ms },
    { id: "p90_prep_ms", label: "P90", type: "num", get: sectionP90 },
    { id: "items_timed", label: "Items", type: "num", get: (s) => s.items_timed },
    { id: "dishes", label: "Dishes", type: "num", get: (s) => s.dishes },
    { id: "section", label: "Name", type: "text", get: (s) => s.section },
  ];

  const summary = data?.order_summary;
  const byDishRaw = data?.by_dish ?? [];
  const bySectionRaw = data?.by_section ?? [];
  // Item-wise prep time per kitchen section. Built from the FULL dish set server
  // side, so a fast station is never empty just because it missed the by_dish cap.
  const sectionItems: KitchenSectionItems[] = (data as KitchenAnalyticsWithItems | null)?.by_section_items ?? [];
  const hasData = (summary?.orders_timed ?? 0) > 0 || byDishRaw.length > 0 || bySectionRaw.length > 0;
  const periodDays = data?.period_days ?? 30;
  const windowLabel = `Last ${periodDays} days`;

  const byDish = sortRows(byDishRaw, dishFields, dishSort);
  const bySection = sortRows(bySectionRaw, sectionFields, sectionSort);
  // Slowest dish by average — flagged wherever it lands after re-sorting.
  const slowestDish = byDishRaw.reduce<KitchenDishStat | null>((m, d) => (d.avg_prep_ms > (m?.avg_prep_ms ?? -1) ? d : m), null);
  const maxSectionAvg = Math.max(1, ...bySectionRaw.map((s) => s.avg_prep_ms));
  // Compact (Overview) cut: the five slowest dishes by average.
  const slowestFive = [...byDishRaw].sort((a, b) => b.avg_prep_ms - a.avg_prep_ms).slice(0, 5);

  // Breakdown row sets — all from the object already in memory.
  const sectionRows: DrillRow[] = bySectionRaw.map((s) => ({ name: s.section, value: s.avg_prep_ms }));
  const dishAvgRows: DrillRow[] = byDishRaw.map((d) => ({ name: d.name, value: d.avg_prep_ms }));
  const dishP90Rows: DrillRow[] = byDishRaw.map((d) => ({ name: d.name, value: dishP90(d) }));
  const dishMaxRows: DrillRow[] = byDishRaw.map((d) => ({ name: d.name, value: d.max_prep_ms }));

  const timedOrders = summary?.orders_timed ?? 0;
  const ordersSub = `${timedOrders} order${timedOrders === 1 ? "" : "s"} timed`;

  // One clickable detail per summary tile. Every tile carries an explainer, and
  // a breakdown drawn from the sections / dishes already loaded.
  const avgDetail: MetricDetail = {
    title: "Average prep time",
    value: fmtPrepMs(summary?.avg_prep_ms),
    sub: ordersSub,
    explainerKey: "avg_prep_ms",
    note: `Half of your orders came out inside ${fmtPrepMs(summary?.median_prep_ms)} and the slowest tenth crossed ${fmtPrepMs(summary?.p90_prep_ms)} — the gap between those two is how uneven service felt.`,
    chart: "bar",
    rows: sectionRows,
    unit: "ms",
    breakdownTitle: "Average prep by kitchen section",
    footnote: windowLabel,
  };
  const p90Detail: MetricDetail = {
    title: "90th-percentile prep time",
    value: fmtPrepMs(summary?.p90_prep_ms),
    sub: "the slowest 10% of orders cross this",
    explainerKey: "p90_prep_ms",
    note: `Average prep is ${fmtPrepMs(summary?.avg_prep_ms)}, so an unlucky guest waited about ${fmtPrepMs(Math.max(0, Number(summary?.p90_prep_ms ?? 0) - Number(summary?.avg_prep_ms ?? 0)))} longer than a typical one.`,
    chart: "bar",
    rows: dishP90Rows,
    unit: "ms",
    breakdownTitle: "Dishes with the slowest 90th-percentile",
    footnote: windowLabel,
  };
  const barkDetail: MetricDetail = {
    title: "Announce to served",
    value: fmtPrepMs(summary?.avg_bark_to_served_ms),
    sub: "avg from fire to plate",
    explainerKey: "bark_to_served",
    note: `Average prep time is ${fmtPrepMs(summary?.avg_prep_ms)}. Whatever this number sits above that is time the ticket spent queuing rather than cooking.`,
    chart: "bar",
    rows: sectionRows,
    unit: "ms",
    breakdownTitle: "Average prep by kitchen section",
    footnote: windowLabel,
  };
  const maxDetail: MetricDetail = {
    title: "Slowest ticket",
    value: fmtPrepMs(summary?.max_prep_ms),
    sub: `median ${fmtPrepMs(summary?.median_prep_ms)}`,
    note: `The single slowest finished ticket in the window, against a median of ${fmtPrepMs(summary?.median_prep_ms)}. Tickets that ran over three hours are treated as abandoned and left out, so this is a real order rather than a forgotten one.`,
    chart: "bar",
    rows: dishMaxRows,
    unit: "ms",
    breakdownTitle: "Slowest single ticket per dish",
    footnote: windowLabel,
  };
  // Card-level "?" explainers for the two tables (their numbers live in rows,
  // not tiles, so they get a hint button instead of a clickable tile).
  const sectionCardDetail: MetricDetail = {
    title: "Section prep time",
    value: fmtPrepMs(summary?.avg_prep_ms),
    sub: `across ${bySectionRaw.length} station${bySectionRaw.length === 1 ? "" : "s"}`,
    explainerKey: "section_avg_prep",
    chart: "bar",
    rows: sectionRows,
    unit: "ms",
    breakdownTitle: "Average prep by kitchen section",
    footnote: windowLabel,
  };
  const dishCardDetail: MetricDetail = {
    title: "Prep time by dish",
    value: slowestDish ? fmtPrepMs(slowestDish.avg_prep_ms) : "—",
    sub: slowestDish ? `slowest dish: ${slowestDish.name}` : undefined,
    explainerKey: "avg_prep_ms",
    note: `Averages per dish across ${byDishRaw.length} timed dish${byDishRaw.length === 1 ? "" : "es"}. A dish with only one or two timings can look slow on a single bad ticket — check the count column before acting.`,
    chart: "bar",
    rows: dishAvgRows,
    unit: "ms",
    breakdownTitle: "Slowest dishes by average",
    footnote: windowLabel,
  };
  // Per-section detail, opened by clicking a section row.
  const sectionDetail = (s: KitchenSectionStat): MetricDetail => ({
    title: s.section,
    value: fmtPrepMs(s.avg_prep_ms),
    sub: `${s.dishes} dish${s.dishes === 1 ? "" : "es"} · ${s.items_timed} item${s.items_timed === 1 ? "" : "s"} timed`,
    explainerKey: "section_avg_prep",
    note: [
      `Nine in ten items from this station were out inside ${fmtPrepMs(sectionP90(s))}, and the slowest single item took ${fmtPrepMs(s.max_prep_ms)}.`,
      s.slowest_dish ? `Its slowest dish is ${s.slowest_dish.name} at ${fmtPrepMs(s.slowest_dish.avg_prep_ms)} on average.` : null,
    ].filter(Boolean).join(" "),
    chart: "bar",
    // The dishes routed to this station. `slowest_dish` comes from the full
    // aggregate, so it may not be in `by_dish` — hence the note above carries it.
    rows: byDishRaw.filter((d) => d.station === s.section).map((d) => ({ name: d.name, value: d.avg_prep_ms })),
    unit: "ms",
    breakdownTitle: "Dishes routed here",
    footnote: windowLabel,
  });

  // --- Item-wise prep time per kitchen section ------------------------------
  // The chart is the station roll-up; the tables beneath are the individual
  // dishes inside each station. Clicking a bar pre-applies that station as the
  // table's filter AND opens the station drill-down, so one click both narrows
  // the page and explains what was clicked.
  const itemSectionP90 = (s: KitchenSectionItems) => s.p90_prep_ms ?? s.max_prep_ms;
  const sectionItemsSorted = [...sectionItems].sort((a, b) => b.avg_prep_ms - a.avg_prep_ms);
  const kitchenAvg = Number(summary?.avg_prep_ms ?? 0);
  const sectionItemPoints: IvPoint[] = sectionItemsSorted.map((s) => ({
    key: `si-${s.section}`,
    label: s.section,
    value: s.avg_prep_ms,
    caption: `${s.dishes_total} dish${s.dishes_total === 1 ? "" : "es"} · ${s.items_timed} item${s.items_timed === 1 ? "" : "s"} timed · ${windowLabel.toLowerCase()}`,
    meta: [
      { label: "P90", value: fmtPrepMs(itemSectionP90(s)) },
      { label: "Slowest item", value: fmtPrepMs(s.max_prep_ms) },
      { label: "vs kitchen avg", value: kitchenAvg > 0 ? `${s.avg_prep_ms >= kitchenAvg ? "+" : "−"}${fmtPrepMs(Math.abs(s.avg_prep_ms - kitchenAvg))}` : "—" },
    ],
  }));
  const shownSectionItems = itemSection ? sectionItemsSorted.filter((s) => s.section === itemSection) : sectionItemsSorted;

  // Drill-down for a whole station in the item-wise view.
  const sectionItemsDetail = (s: KitchenSectionItems): MetricDetail => {
    const totalItems = sectionItems.reduce((n, x) => n + x.items_timed, 0);
    const share = totalItems > 0 ? (s.items_timed / totalItems) * 100 : 0;
    const rank = 1 + sectionItems.filter((x) => x.avg_prep_ms > s.avg_prep_ms).length;
    const slowest = [...s.dishes].sort((a, b) => b.avg_prep_ms - a.avg_prep_ms)[0];
    return {
      title: `${s.section} — item-wise prep`,
      value: fmtPrepMs(s.avg_prep_ms),
      sub: `${s.dishes_total} dish${s.dishes_total === 1 ? "" : "es"} · ${s.items_timed} item${s.items_timed === 1 ? "" : "s"} timed`,
      filters: [`Section: ${s.section}`, `Window: last ${periodDays} days`, "Metric: average prep time"],
      explainerKey: "section_avg_prep",
      note: [
        `${s.section} handled ${s.items_timed} of the ${totalItems} timed items (${Math.round(share * 10) / 10}%) and is the ${rank === 1 ? "slowest" : `${ordinalWord(rank)} slowest`} of ${sectionItems.length} station${sectionItems.length === 1 ? "" : "s"}.`,
        kitchenAvg > 0 ? `That is ${s.avg_prep_ms >= kitchenAvg ? "above" : "below"} the ${fmtPrepMs(kitchenAvg)} kitchen average by ${fmtPrepMs(Math.abs(s.avg_prep_ms - kitchenAvg))}.` : "",
        `Nine in ten of its items were out inside ${fmtPrepMs(itemSectionP90(s))}; the slowest single item took ${fmtPrepMs(s.max_prep_ms)}.`,
        slowest ? `Its slowest dish is ${slowest.name} at ${fmtPrepMs(slowest.avg_prep_ms)}.` : "",
      ].filter(Boolean).join(" "),
      chart: "bar",
      unit: "ms",
      breakdownTitle: "Slowest dishes in this station",
      rows: s.dishes.map((d) => ({ name: d.name, value: d.avg_prep_ms })),
      records: {
        title: `Every timed dish in ${s.section}`,
        columns: ["Dish", "Timed", "Avg", "P90", "Max"],
        rows: [...s.dishes]
          .sort((a, b) => b.avg_prep_ms - a.avg_prep_ms)
          .map((d) => [d.name, d.count, fmtPrepMs(d.avg_prep_ms), fmtPrepMs(dishP90(d)), fmtPrepMs(d.max_prep_ms)]),
        note: s.dishes.length < s.dishes_total ? `Showing the ${s.dishes.length} slowest of ${s.dishes_total} dishes routed here.` : undefined,
      },
      footnote: windowLabel,
      link: "/dashboard/menu",
      linkLabel: "Open menu",
    };
  };

  // Drill-down for a single dish inside a station.
  const sectionItemDishDetail = (s: KitchenSectionItems, d: KitchenDishStat): MetricDetail => {
    const share = s.items_timed > 0 ? (d.count / s.items_timed) * 100 : 0;
    const rank = 1 + s.dishes.filter((x) => x.avg_prep_ms > d.avg_prep_ms).length;
    const spread = d.min_prep_ms != null ? d.max_prep_ms - d.min_prep_ms : null;
    return {
      title: d.name,
      value: fmtPrepMs(d.avg_prep_ms),
      sub: `${s.section} · ${d.count} timing${d.count === 1 ? "" : "s"} recorded`,
      filters: [`Section: ${s.section}`, `Dish: ${d.name}`, `Window: last ${periodDays} days`],
      explainerKey: "avg_prep_ms",
      note: [
        `${d.name} was timed ${d.count} time${d.count === 1 ? "" : "s"}, ${Math.round(share * 10) / 10}% of everything ${s.section} sent out, and is the ${rank === 1 ? "slowest" : `${ordinalWord(rank)} slowest`} of the ${s.dishes.length} dish${s.dishes.length === 1 ? "" : "es"} shown for that station.`,
        `Its station averages ${fmtPrepMs(s.avg_prep_ms)} and the whole kitchen ${fmtPrepMs(kitchenAvg)}.`,
        spread != null ? `Fastest to slowest spans ${fmtPrepMs(spread)}, so ${spread > d.avg_prep_ms ? "the timings are very uneven — one bad ticket is moving this average" : "the timings are fairly consistent"}.` : "",
        d.count <= 2 ? "Only a couple of timings, so treat this average as indicative rather than settled." : "",
      ].filter(Boolean).join(" "),
      chart: "bar",
      keepOrder: true,
      unit: "ms",
      breakdownTitle: "This dish's own spread",
      rows: [
        ...(d.min_prep_ms != null ? [{ name: "Fastest", value: d.min_prep_ms }] : []),
        { name: "Average", value: d.avg_prep_ms },
        { name: "P90", value: dishP90(d) },
        { name: "Slowest", value: d.max_prep_ms },
      ],
      records: {
        title: `Its neighbours in ${s.section}`,
        columns: ["Dish", "Timed", "Avg", "P90", "Max"],
        rows: [...s.dishes]
          .sort((a, b) => b.avg_prep_ms - a.avg_prep_ms)
          .map((x) => [x.name === d.name ? `${x.name} ◀` : x.name, x.count, fmtPrepMs(x.avg_prep_ms), fmtPrepMs(dishP90(x)), fmtPrepMs(x.max_prep_ms)]),
        note: "◀ marks the dish you clicked.",
      },
      footnote: windowLabel,
      link: "/dashboard/menu",
      linkLabel: "Open menu",
    };
  };

  const sectionItemsCardDetail: MetricDetail = {
    title: "Item-wise prep by section",
    value: fmtPrepMs(kitchenAvg),
    sub: `${sectionItems.length} station${sectionItems.length === 1 ? "" : "s"} · ${sectionItems.reduce((n, s) => n + s.items_timed, 0)} items timed`,
    explainerKey: "section_avg_prep",
    note: "Each station's own average, and every dish routed to it. A station's number is the average of its items, not of its dishes — a single high-volume dish therefore moves it more than a rare one.",
    chart: "bar",
    unit: "ms",
    breakdownTitle: "Average prep by kitchen section",
    rows: sectionItems.map((s) => ({ name: s.section, value: s.avg_prep_ms })),
    footnote: windowLabel,
  };

  const spinner = <Card><CardContent className="py-10 text-center text-muted-foreground">Loading kitchen timings…</CardContent></Card>;

  if (loading) {return spinner;}
  if (!data) {return null;}

  return (
    <div className="grid gap-4 md:gap-8">
      <Card>
        <CardHeader>
          <SectionHeaderRow
            control={
              <HeaderControls>
                {hasData && (
                  <SectionDownload
                    id="kitchen"
                    label="Kitchen analytics"
                    build={() => [
                      ["Metric", "Value"],
                      ["Orders timed", summary?.orders_timed ?? 0],
                      ["Avg prep", fmtPrepMs(summary?.avg_prep_ms)],
                      ["Median prep", fmtPrepMs(summary?.median_prep_ms)],
                      ["P90 prep", fmtPrepMs(summary?.p90_prep_ms)],
                      ["Bark → served", fmtPrepMs(summary?.avg_bark_to_served_ms)],
                      ["Max prep", fmtPrepMs(summary?.max_prep_ms)],
                      ["Window (days)", periodDays],
                    ]}
                  />
                )}
                {compact ? (
                  <Button variant="outline" size="sm" className="shrink-0" onClick={() => { onOpenView("kitchen"); }}>
                    See more in Kitchen <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                ) : null}
              </HeaderControls>
            }
          >
            <CardTitle className="flex items-center gap-2"><Flame className="h-5 w-5 text-orange-500" /> Kitchen analytics</CardTitle>
            <CardDescription>Prep time from bark to served, last {periodDays} days. Pauses are excluded. Click any number for what it means.</CardDescription>
          </SectionHeaderRow>
        </CardHeader>
        <CardContent>
          {!hasData ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No timed orders in the last {periodDays} days yet — prep times appear once tickets are barked and served.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricTile label="Avg prep" value={fmtPrepMs(summary?.avg_prep_ms)} sub={ordersSub} onOpen={() => { openDetail(avgDetail); }} />
              <MetricTile label="P90 prep" value={fmtPrepMs(summary?.p90_prep_ms)} sub="slowest 10% cross this" onOpen={() => { openDetail(p90Detail); }} />
              <MetricTile label="Bark → served" value={fmtPrepMs(summary?.avg_bark_to_served_ms)} sub="avg from fire to plate" onOpen={() => { openDetail(barkDetail); }} />
              <MetricTile label="Max prep" value={fmtPrepMs(summary?.max_prep_ms)} sub={`median ${fmtPrepMs(summary?.median_prep_ms)}`} onOpen={() => { openDetail(maxDetail); }} />
            </div>
          )}
        </CardContent>
      </Card>

      {bySectionRaw.length > 0 && (
        <Card>
          <CardHeader>
            <SectionHeaderRow control={
              <HeaderControls>
                {compact ? null : <SortControl fields={sectionFields} state={sectionSort} onChange={setSectionSort} />}
                <SectionDownload
                  id="kitchen-by-section"
                  label="Kitchen — by section"
                  build={() => [
                    ["Section", "Dishes", "Items timed", "Avg prep", "P90 prep", "Max prep", "Slowest dish", "Slowest dish avg"],
                    ...bySection.map((s) => [
                      s.section, s.dishes, s.items_timed,
                      fmtPrepMs(s.avg_prep_ms), fmtPrepMs(sectionP90(s)), fmtPrepMs(s.max_prep_ms),
                      s.slowest_dish?.name ?? "",
                      s.slowest_dish ? fmtPrepMs(s.slowest_dish.avg_prep_ms) : "",
                    ]),
                  ]}
                />
              </HeaderControls>
            }>
              <CardTitle className="flex items-center gap-2">
                By kitchen section
                <ExplainerHint label="section prep time" onOpen={() => { openDetail(sectionCardDetail); }} />
              </CardTitle>
              <CardDescription>Average prep per station — slowest first. Click a station for its own breakdown.</CardDescription>
            </SectionHeaderRow>
          </CardHeader>
          <CardContent className="space-y-1">
            {bySection.map((s) => (
              <button
                key={s.section}
                type="button"
                onClick={() => { openDetail(sectionDetail(s)); }}
                title={`${s.section} — click for detail`}
                className="group -mx-1 flex w-full cursor-pointer items-center gap-3 rounded-md px-1 py-1 text-left text-sm transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <div className="w-28 shrink-0 truncate font-medium" title={s.section}>{s.section}</div>
                <div className="h-2 flex-1 overflow-hidden rounded bg-muted group-hover:bg-background">
                  <div className="h-full rounded bg-primary" style={{ width: `${Math.max(2, Math.round((s.avg_prep_ms / maxSectionAvg) * 100))}%` }} />
                </div>
                <span className="w-16 shrink-0 text-right font-semibold tabular-nums">{fmtPrepMs(s.avg_prep_ms)}</span>
                <span className="hidden w-28 shrink-0 text-right text-xs text-muted-foreground sm:inline">
                  {s.dishes} dish{s.dishes === 1 ? "" : "es"} · p90 {fmtPrepMs(sectionP90(s))}
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* NEW: item-wise prep time grouped per kitchen section. The chart is the
          station roll-up; the panels below are the individual dishes inside each
          station. Clicking a bar filters the panels to that station. */}
      {sectionItems.length > 0 && !compact && (
        <Card>
          <CardHeader>
            <SectionHeaderRow control={
              <HeaderControls>
                {itemSection && (
                  <Button variant="outline" size="sm" className="shrink-0" onClick={() => { setItemSection(null); }}>
                    <X className="mr-1 h-3.5 w-3.5" /> Clear filter
                  </Button>
                )}
                <SectionDownload
                  id="kitchen-section-items"
                  label="Kitchen — item-wise prep by section"
                  build={() => [
                    ["Section", "Dish", "Timed count", "Avg prep", "P90 prep", "Max prep", "Fastest", "Section avg", "Section items timed"],
                    // Exactly the rows on screen: the filter, and the same order.
                    ...shownSectionItems.flatMap((s) =>
                      [...s.dishes]
                        .sort((a, b) => b.avg_prep_ms - a.avg_prep_ms)
                        .map((d) => [
                          s.section, d.name, d.count,
                          fmtPrepMs(d.avg_prep_ms), fmtPrepMs(dishP90(d)), fmtPrepMs(d.max_prep_ms),
                          d.min_prep_ms != null ? fmtPrepMs(d.min_prep_ms) : "",
                          fmtPrepMs(s.avg_prep_ms), s.items_timed,
                        ]),
                    ),
                  ]}
                />
              </HeaderControls>
            }>
              <CardTitle className="flex items-center gap-2">
                Item-wise prep time by kitchen section
                <ExplainerHint label="item-wise prep time by section" onOpen={() => { openDetail(sectionItemsCardDetail); }} />
              </CardTitle>
              <CardDescription>
                Every station&apos;s average, and the individual dishes behind it. Hover a bar for the station&apos;s figures; click it to filter the list below to that station and open its breakdown.
              </CardDescription>
            </SectionHeaderRow>
          </CardHeader>
          <CardContent className="space-y-4">
            <InteractiveChart
              kind="bar"
              points={sectionItemPoints}
              fmt={(n) => fmtPrepMs(n)}
              tickFmt={(n) => `${Math.round(Number(n) / 60000)}m`}
              seriesLabel="average prep"
              chartLabel="Average prep time by kitchen section"
              color={SERIES_COLOR}
              height={240}
              onSelect={(p) => { setItemSection(p.label); openDetail(sectionItemsDetail(sectionItemsSorted.find((s) => s.section === p.label) ?? sectionItemsSorted[0])); }}
            />

            {itemSection && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <Filter className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">Filtered to</span>
                <span className="rounded-full border bg-primary/10 px-2 py-0.5 font-medium text-primary">{itemSection}</span>
                <button
                  type="button"
                  onClick={() => { setItemSection(null); }}
                  className="rounded-md px-1.5 py-0.5 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  Show all {sectionItemsSorted.length} stations
                </button>
              </div>
            )}

            {shownSectionItems.map((s) => (
              <div key={s.section} className="rounded-lg border">
                <button
                  type="button"
                  onClick={() => { openDetail(sectionItemsDetail(s)); }}
                  className="group flex w-full flex-wrap items-center justify-between gap-2 rounded-t-lg border-b bg-muted/40 px-3 py-2 text-left transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label={`${s.section}: average prep ${fmtPrepMs(s.avg_prep_ms)} across ${s.items_timed} timed items. Press Enter for a detailed breakdown.`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Flame className="h-4 w-4 shrink-0 text-orange-500" />
                    <span className="truncate text-sm font-semibold">{s.section}</span>
                    <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {s.dishes_total} dish{s.dishes_total === 1 ? "" : "es"} · {s.items_timed} timed
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3 text-xs">
                    <span className="tabular-nums text-muted-foreground">p90 {fmtPrepMs(itemSectionP90(s))}</span>
                    <span className="text-sm font-bold tabular-nums">{fmtPrepMs(s.avg_prep_ms)}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                  </span>
                </button>
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-background text-left text-xs text-muted-foreground">
                      <tr className="border-b">
                        <th className="py-1.5 pl-3 pr-2 font-medium">Dish</th>
                        <th className="py-1.5 pr-2 text-right font-medium">Timed</th>
                        <th className="py-1.5 pr-2 text-right font-medium">Avg</th>
                        <th className="py-1.5 pr-2 text-right font-medium">P90</th>
                        <th className="py-1.5 pr-3 text-right font-medium">Max</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...s.dishes].sort((a, b) => b.avg_prep_ms - a.avg_prep_ms).map((d, i) => (
                        <tr
                          key={`${s.section}-${d.id ?? d.name}-${i}`}
                          tabIndex={0}
                          role="button"
                          aria-label={`${d.name} in ${s.section}: average prep ${fmtPrepMs(d.avg_prep_ms)} over ${d.count} timings. Press Enter for a detailed breakdown.`}
                          onClick={() => { openDetail(sectionItemDishDetail(s, d)); }}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(sectionItemDishDetail(s, d)); } }}
                          className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                        >
                          <td className="max-w-[220px] truncate py-1.5 pl-3 pr-2 font-medium" title={d.min_prep_ms != null ? `Fastest recorded: ${fmtPrepMs(d.min_prep_ms)}` : undefined}>{d.name}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{d.count}</td>
                          <td className="py-1.5 pr-2 text-right font-semibold tabular-nums">{fmtPrepMs(d.avg_prep_ms)}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">{fmtPrepMs(dishP90(d))}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">{fmtPrepMs(d.max_prep_ms)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {s.dishes.length < s.dishes_total && (
                  <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
                    Showing the {s.dishes.length} slowest of {s.dishes_total} dishes routed to {s.section}.
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {byDishRaw.length > 0 && (
        <Card>
          <CardHeader>
            <SectionHeaderRow control={
              <HeaderControls>
                {compact ? null : <SortControl fields={dishFields} state={dishSort} onChange={setDishSort} />}
                <SectionDownload
                  id="kitchen-by-dish"
                  label={compact ? "Kitchen — slowest dishes" : "Kitchen — by dish"}
                  build={() => [
                    ["Dish", "Section", "Timed count", "Avg prep", "P90 prep", "Max prep", "Fastest"],
                    // Matches what the card shows: the five slowest on Overview,
                    // the full sorted table everywhere else.
                    ...(compact ? slowestFive : byDish).map((d) => [
                      d.name, d.station, d.count,
                      fmtPrepMs(d.avg_prep_ms), fmtPrepMs(dishP90(d)), fmtPrepMs(d.max_prep_ms),
                      d.min_prep_ms != null ? fmtPrepMs(d.min_prep_ms) : "",
                    ]),
                  ]}
                />
              </HeaderControls>
            }>
              <CardTitle className="flex items-center gap-2">
                {compact ? "Slowest dishes" : "By dish"}
                <ExplainerHint label="prep time by dish" onOpen={() => { openDetail(dishCardDetail); }} />
              </CardTitle>
              <CardDescription>
                {compact
                  ? "The five dishes with the slowest average prep time."
                  : "Per-dish prep time — the slowest dish is flagged."}
              </CardDescription>
            </SectionHeaderRow>
          </CardHeader>
          <CardContent>
            {compact ? (
              <div className="space-y-2">
                {slowestFive.map((d, i) => (
                  <div key={`${d.name}-${d.station}-${i}`} className="flex items-center gap-3 rounded-lg border p-2 text-sm">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{d.name}</p>
                      <p className="text-xs text-muted-foreground">{d.station} · {d.count} timed</p>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums">{fmtPrepMs(d.avg_prep_ms)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-1 pr-2">Dish</th>
                      <th className="py-1 pr-2">Section</th>
                      <th className="py-1 pr-2 text-right">Count</th>
                      <th className="py-1 pr-2 text-right">Avg</th>
                      <th className="py-1 pr-2 text-right">P90</th>
                      <th className="py-1 text-right">Max</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byDish.map((d, i) => {
                      const isSlowest = slowestDish != null && d.name === slowestDish.name && d.station === slowestDish.station;
                      return (
                        <tr key={`${d.name}-${d.station}-${i}`} className={`border-b last:border-0 ${isSlowest ? "bg-amber-50 dark:bg-amber-950/40" : ""}`}>
                          <td className="py-1 pr-2 font-medium">
                            <span className="flex items-center gap-1.5" title={d.min_prep_ms != null ? `Fastest recorded: ${fmtPrepMs(d.min_prep_ms)}` : undefined}>
                              {isSlowest && <Snail className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />}
                              <span className="truncate">{d.name}</span>
                            </span>
                          </td>
                          <td className="py-1 pr-2 text-muted-foreground">{d.station}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{d.count}</td>
                          <td className={`py-1 pr-2 text-right font-semibold tabular-nums ${isSlowest ? "text-amber-700 dark:text-amber-300" : ""}`}>{fmtPrepMs(d.avg_prep_ms)}</td>
                          <td className="py-1 pr-2 text-right tabular-nums text-muted-foreground">{fmtPrepMs(dishP90(d))}</td>
                          <td className="py-1 text-right tabular-nums text-muted-foreground">{fmtPrepMs(d.max_prep_ms)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <MetricDetailDialog detail={detail} explainers={explainers} money={money} onOpenView={onOpenView} onOpenChange={(o) => { if (!o) {setDetail(null);} }} />
    </div>
  );
}

function PerformanceTrends({ view, onOpenView }: { view: ViewId; onOpenView: (v: ViewId) => void }) {
  const { timezone } = useTimezone();
  const { user } = useAuth();
  const { currency, currencySymbol } = useCurrency();
  const [data, setData] = useState<ApcTrendPoint[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<MetricDetail | null>(null);
  const explainers = useMetricExplainers();
  const money = (n: number | null | undefined) => `${currencySymbol}${Number(n ?? 0).toFixed(0)}`;

  useEffect(() => {
    if (!user?.restaurantUsername) {return;}
    let active = true;
    setLoading(true);
    getApcTrends(user.restaurantUsername, 12)
      .then((d) => { if (active) {setData(d);} })
      .finally(() => { if (active) {setLoading(false);} });
    return () => { active = false; };
  }, [user?.restaurantUsername]);

  const showRevenue = inView(view, "sales", true); // headline chart on Overview
  const showApc = inView(view, "sales");
  if (!showRevenue && !showApc) {return null;}

  const series = data ?? [];
  const hasData = series.some((p) => p.total_revenue > 0 || p.bills > 0);
  const spinner = <div className="py-10 text-center text-muted-foreground">Loading…</div>;
  const empty = <div className="py-10 text-center text-muted-foreground">No revenue recorded in the last 12 months yet.</div>;

  // Compact axis money so a 6-figure month still fits the 52px gutter.
  const moneyTick = (n: number) => {
    const v = Number(n ?? 0);
    if (Math.abs(v) >= 1_000_000) {return `${currencySymbol}${(v / 1_000_000).toFixed(1)}M`;}
    if (Math.abs(v) >= 1_000) {return `${currencySymbol}${Math.round(v / 1_000)}k`;}
    return `${currencySymbol}${Math.round(v)}`;
  };
  const monthCaption = (p: ApcTrendPoint) =>
    p.period_start ? formatMonth(p.period_start, timezone, true, p.month) : p.month;
  const revenuePoints: IvPoint[] = series.map((p) => ({
    key: `rev-${p.month}`,
    label: p.month,
    value: Number(p.total_revenue ?? 0),
    caption: monthCaption(p),
    meta: [
      { label: "Bills", value: `${p.bills}` },
      { label: "Covers", value: `${p.total_covers}` },
      { label: "APC", value: money(p.monthly_apc) },
    ],
  }));
  const apcPoints: IvPoint[] = series.map((p) => ({
    key: `apc-${p.month}`,
    label: p.month,
    value: Number(p.monthly_apc ?? 0),
    caption: monthCaption(p),
    meta: [
      { label: "Revenue", value: money(p.total_revenue) },
      { label: "Covers", value: `${p.total_covers}` },
      { label: "Bills", value: `${p.bills}` },
    ],
  }));

  // One month, opened from either chart. `focus` decides which number is the
  // headline; everything else becomes supporting context for the same month.
  const openMonth = (index: number, focus: "revenue" | "apc") => {
    const p = series[index];
    if (!p) {return;}
    const prev = index > 0 ? series[index - 1] : null;
    const totalRevenue = series.reduce((s, x) => s + Number(x.total_revenue ?? 0), 0);
    const share = totalRevenue > 0 ? (Number(p.total_revenue ?? 0) / totalRevenue) * 100 : 0;
    const revRank = 1 + series.filter((x) => Number(x.total_revenue ?? 0) > Number(p.total_revenue ?? 0)).length;
    const isRevenue = focus === "revenue";
    // Deltas are always quoted for the metric you clicked, with the other one
    // trailing as context.
    const cur = isRevenue ? Number(p.total_revenue ?? 0) : Number(p.monthly_apc ?? 0);
    const was = prev ? (isRevenue ? Number(prev.total_revenue ?? 0) : Number(prev.monthly_apc ?? 0)) : null;
    const delta = was != null ? cur - was : null;
    const deltaPct = was != null && was !== 0 ? ((cur - was) / Math.abs(was)) * 100 : null;
    const otherDelta = prev
      ? (isRevenue ? Number(p.monthly_apc ?? 0) - Number(prev.monthly_apc ?? 0) : Number(p.total_revenue ?? 0) - Number(prev.total_revenue ?? 0))
      : null;
    setDetail({
      title: isRevenue ? `Revenue — ${p.month}` : `APC — ${p.month}`,
      value: isRevenue ? money(p.total_revenue) : money(p.monthly_apc),
      sub: monthCaption(p),
      filters: [`Month: ${p.month}`, `Metric: ${isRevenue ? "revenue" : "average per cover"}`, "Window: last 12 months"],
      explainerKey: isRevenue ? "revenue" : "apc",
      note: [
        isRevenue
          ? `${p.month} took ${money(p.total_revenue)} across ${p.bills} bill${p.bills === 1 ? "" : "s"} and ${p.total_covers} cover${p.total_covers === 1 ? "" : "s"} — ${Math.round(share * 10) / 10}% of the last 12 months, the ${ordinalWord(revRank)} biggest of ${series.length}.`
          : `Each cover spent ${money(p.monthly_apc)} on average in ${p.month}, from ${money(p.total_revenue)} over ${p.total_covers} cover${p.total_covers === 1 ? "" : "s"}.`,
        prev && delta != null
          ? `That is ${delta >= 0 ? "up" : "down"} ${money(Math.abs(delta))}${deltaPct != null ? ` (${Math.abs(Math.round(deltaPct * 10) / 10)}%)` : ""} on ${prev.month}${otherDelta != null ? `, with ${isRevenue ? "APC" : "revenue"} ${otherDelta >= 0 ? "up" : "down"} ${money(Math.abs(otherDelta))}` : ""}.`
          : "This is the first month in the window, so there is nothing to compare it against yet.",
      ].join(" "),
      chart: "bar",
      keepOrder: true,
      unit: "money",
      breakdownTitle: prev ? `${prev.month} vs ${p.month}` : "This month",
      rows: [
        ...(prev ? [{ name: `${prev.month} revenue`, value: Number(prev.total_revenue ?? 0) }] : []),
        { name: `${p.month} revenue`, value: Number(p.total_revenue ?? 0) },
        ...(prev ? [{ name: `${prev.month} APC`, value: Number(prev.monthly_apc ?? 0) }] : []),
        { name: `${p.month} APC`, value: Number(p.monthly_apc ?? 0) },
      ],
      history: {
        title: isRevenue ? "Revenue across the last 12 months" : "APC across the last 12 months",
        rows: series.map((x) => ({ name: x.month, value: Number(isRevenue ? x.total_revenue ?? 0 : x.monthly_apc ?? 0) })),
        unit: "money",
      },
      records: {
        title: "The months behind this trend",
        columns: ["Month", "Revenue", "Covers", "Bills", "APC"],
        // Newest first, matching the table on the card, with the clicked month
        // marked so it is findable in a 12-row list.
        rows: [...series].reverse().map((x) => [
          x.month === p.month ? `${x.month} ◀` : x.month,
          money(x.total_revenue),
          x.total_covers,
          x.bills,
          money(x.monthly_apc),
        ]),
        note: "◀ marks the month you clicked.",
      },
      footnote: "Last 12 months",
      link: "/dashboard/accounting",
      linkLabel: "Open accounting",
      view: "sales",
    });
  };

  return (
    <div className="grid gap-4 md:gap-8">
      {showRevenue && (
      <Card>
        <CardHeader>
          {/* On Overview this is the headline cut; the APC table and the outlet
              comparison live in Sales & Revenue, so offer the jump there. */}
          <SectionHeaderRow control={
            <HeaderControls>
              {hasData && (
                <SectionDownload
                  id="revenue-over-time"
                  label="Revenue over time"
                  build={() => [
                    ["Month", `Revenue (${currencySymbol})`],
                    ...series.map((p) => [p.month, Number(p.total_revenue ?? 0)]),
                  ]}
                />
              )}
              {view === "overview" ? <SeeMoreInView view="sales" onOpenView={onOpenView} /> : null}
            </HeaderControls>
          }>
            <CardTitle>Revenue over time</CardTitle>
            <CardDescription>Monthly revenue across the last 12 months. Hover a month for bills, covers and APC; click it for the month&apos;s full breakdown.</CardDescription>
          </SectionHeaderRow>
        </CardHeader>
        <CardContent>
          {loading ? spinner : !hasData ? empty : (
            <InteractiveChart
              kind="bar"
              points={revenuePoints}
              fmt={(n) => money(n)}
              tickFmt={moneyTick}
              seriesLabel="revenue"
              chartLabel="Monthly revenue, last 12 months"
              color={SERIES_COLOR}
              height={280}
              onSelect={(_p, i) => { openMonth(i, "revenue"); }}
            />
          )}
        </CardContent>
      </Card>
      )}
      {showApc && (
      <Card>
        <CardHeader>
          <SectionHeaderRow control={hasData ? (
            <SectionDownload
              id="apc-over-time"
              label="APC over time"
              build={() => [
                ["Month", `Revenue (${currencySymbol})`, "Covers", `APC (${currencySymbol})`, "Bills"],
                ...[...series].reverse().map((p) => [
                  p.month,
                  Number(p.total_revenue ?? 0).toFixed(0),
                  p.total_covers,
                  Number(p.monthly_apc ?? 0).toFixed(0),
                  p.bills,
                ]),
              ]}
            />
          ) : null}>
            <CardTitle>APC over time</CardTitle>
            <CardDescription>Average-per-cover (revenue &divide; covers) by month, with the underlying numbers. Hover or click any point — the table rows open the same detail.</CardDescription>
          </SectionHeaderRow>
        </CardHeader>
        <CardContent>
          {loading ? spinner : !hasData ? empty : (
            <>
              <InteractiveChart
                kind="line"
                points={apcPoints}
                fmt={(n) => money(n)}
                tickFmt={moneyTick}
                seriesLabel="per cover"
                chartLabel="Average per cover by month, last 12 months"
                color={SERIES_COLOR}
                height={220}
                showShare={false}
                onSelect={(_p, i) => { openMonth(i, "apc"); }}
              />
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
                    {/* Rows are the same data points as the line above, so they
                        open the same drill-down — the index maps back through
                        the un-reversed series. */}
                    {[...series].reverse().map((p, ri) => (
                      <tr
                        key={p.month}
                        tabIndex={0}
                        role="button"
                        aria-label={`${p.month}: revenue ${money(p.total_revenue)}, APC ${money(p.monthly_apc)}. Press Enter for a detailed breakdown.`}
                        onClick={() => { openMonth(series.length - 1 - ri, "apc"); }}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openMonth(series.length - 1 - ri, "apc"); } }}
                        className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
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

      <MetricDetailDialog detail={detail} explainers={explainers} money={money} onOpenView={onOpenView} onOpenChange={(o) => { if (!o) {setDetail(null);} }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI drill-down: clicking a tile opens the shared MetricDetailDialog with a
// chart derived from the SAME `AdvancedAnalytics` object already on the page (no
// new fetch). The chart per KPI is data-driven by the registry below.

// KPI key -> metric-explainer key, for the KPIs the backend has copy for. Only
// exact matches are listed — a KPI without an entry falls back to KPI_MEANINGS.
const KPI_EXPLAINER_KEY: Record<string, string> = {
  avg_rating: "avg_rating",
  nps: "nps",
  complaint_rate: "avg_rating",
  discount_utilization: "discount_total",
  offer_redemption: "discount_total",
  processing_time: "avg_prep_ms",
  menu_bad_share: "slow_mover",
}

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

interface DrillSpec { type: DrillChartKind; rows: DrillRow[]; unit: DrillUnit }

// Maps a KPI key -> the chart + rows to show. Empty `rows` on a pie/bar renders
// a graceful "no breakdown yet"; `type: "none"` renders the value + meaning.
function kpiDrilldownSpec(kpi: Kpi, data: AdvancedAnalytics): DrillSpec {
  const num = (n: number | null | undefined) => Number(n ?? 0)
  switch (kpi.key) {
    case "profit_margin": {
      const p = data.profit
      if (!p) {return { type: "none", rows: [], unit: "money" }}
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
      if (offers.length > 0) {return { type: "pie", unit: "count", rows: offers.map((o) => ({ name: o.code, value: num(o.used) })) }}
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
      for (const m of classes) {counts[m.class] = (counts[m.class] ?? 0) + 1}
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

// The KPI drill-down. Builds a MetricDetail out of the KPI + its spec and hands
// it to the shared dialog, so a KPI tile and a plain numeric card open exactly
// the same UI (explainer copy included). `kpi == null` keeps it closed.
function KpiDrilldown({ kpi, data, money, explainers, onOpenChange, onOpenView }: {
  kpi: Kpi | null
  data: AdvancedAnalytics
  money: (n: number | null | undefined) => string
  explainers: MetricExplainers
  onOpenChange: (open: boolean) => void
  onOpenView: (v: ViewId) => void
}) {
  const spec = kpi ? kpiDrilldownSpec(kpi, data) : null
  const detail: MetricDetail | null = kpi && spec ? {
    title: kpi.label,
    value: kpi.value == null ? "—" : `${kpi.value}${kpi.unit}`,
    badge: (
      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${KPI_COLORS[kpi.status] ?? KPI_COLORS.grey}`}>
        {KPI_STATUS_LABEL[kpi.status]}
      </span>
    ),
    explainerKey: KPI_EXPLAINER_KEY[kpi.key],
    note: KPI_MEANINGS[kpi.key] ?? (spec.type === "none" ? `Current value for the last ${data.window_days} days.` : undefined),
    chart: spec.type,
    rows: spec.rows,
    unit: spec.unit,
    breakdownTitle: spec.type === "none" ? undefined : "Breakdown",
    footnote: `Last ${data.window_days} days`,
    link: KPI_LINKS[kpi.key],
    // The analytics view that owns this KPI's full section. Every key in
    // KPI_VIEW resolves; anything unmapped falls back to Everything, which is
    // guaranteed to render it — so a KPI drill-down is never a dead end.
    view: KPI_VIEW[kpi.key] ?? "everything",
  } : null

  return <MetricDetailDialog detail={detail} explainers={explainers} money={money} onOpenChange={onOpenChange} onOpenView={onOpenView} />
}

function AdvancedAnalyticsView({ view, kpiSort, onOpenView }: { view: ViewId; kpiSort: KpiSort; onOpenView: (v: ViewId) => void }) {
  const { user } = useAuth();
  const { currency, currencySymbol } = useCurrency();
  const { toast } = useToast();
  const [data, setData] = useState<AdvancedAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [campForm, setCampForm] = useState({ name: "", cost: "", starts_at: "", ends_at: "" });
  const [campBusy, setCampBusy] = useState(false);
  const [activeKpi, setActiveKpi] = useState<Kpi | null>(null); // open drill-down dialog
  const [detail, setDetail] = useState<MetricDetail | null>(null); // expanded numeric card
  const explainers = useMetricExplainers();
  const money = (n: number | null | undefined) => `${currencySymbol}${Number(n ?? 0).toFixed(0)}`;

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
    if (!user?.restaurantUsername) {return;}
    let active = true;
    setLoading(true);
    getAdvancedAnalytics(user.restaurantUsername, 90)
      .then((d) => { if (active) {setData(d);} })
      .finally(() => { if (active) {setLoading(false);} });
    return () => { active = false; };
  }, [user?.restaurantUsername, refresh]);

  const addCampaign = async () => {
    if (!user?.restaurantUsername) {return;}
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
    if (!user?.restaurantUsername) {return;}
    try {
      await deleteCampaign(user.restaurantUsername, id);
      setRefresh((r) => r + 1);
    } catch (e: any) {
      toast({ title: "Couldn't delete campaign", description: String(e?.message ?? e), variant: "destructive" });
    }
  };

  if (loading) {return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Loading KPIs…</CardContent></Card>;}
  if (!data) {return null;}

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
  interface DemoRow { label: string; n: number }
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
          {/* Overview shows only the headline KPIs; Everything shows all of them. */}
          <SectionHeaderRow control={
            <HeaderControls>
              <SectionDownload
                id="kpi-health"
                label="KPI health"
                build={() => [
                  ["Metric", "Value", "Unit", "Status"],
                  ...visibleKpis.map((k) => [k.label, k.value ?? "", k.unit, KPI_STATUS_LABEL[k.status] ?? k.status]),
                ]}
              />
              {view === "overview" ? <SeeMoreInView view="everything" onOpenView={onOpenView} /> : null}
            </HeaderControls>
          }>
            <CardTitle>KPI health</CardTitle>
            <CardDescription>Last {data.window_days} days, colour-coded against target bands. Click a tile for its breakdown.</CardDescription>
          </SectionHeaderRow>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {visibleKpis.map((k) => (
              <button
                key={k.key}
                type="button"
                onClick={() => { setActiveKpi(k); }}
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

      <KpiDrilldown kpi={activeKpi} data={data} money={money} explainers={explainers} onOpenView={onOpenView} onOpenChange={(o) => { if (!o) {setActiveKpi(null);} }} />
      <MetricDetailDialog detail={detail} explainers={explainers} money={money} onOpenView={onOpenView} onOpenChange={(o) => { if (!o) {setDetail(null);} }} />

      <div className="grid gap-4 md:grid-cols-2">
        {inView(view, "discounts") && (
        <Card>
          <CardHeader>
            <SectionHeaderRow control={
              <SectionDownload
                id="discounts"
                label="Discounts & offers"
                build={() => [
                  ["Metric", "Value"],
                  ["Discount utilization (%)", data.discounts.utilization_pct],
                  ["Bills with a discount", data.discounts.discount_bills],
                  ["Total bills", data.discounts.total_bills],
                  [`Total discount value (${currencySymbol})`, Number(data.discounts.total_discount ?? 0).toFixed(0)],
                  ["Coupon redemptions", data.discounts.redemptions],
                  ["Window (days)", data.window_days],
                ]}
              />
            }>
              <CardTitle>Discounts &amp; offers</CardTitle><CardDescription>Utilization and redemptions, last {data.window_days} days.</CardDescription>
            </SectionHeaderRow>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <MetricRow
              label="Discount utilization"
              value={`${data.discounts.utilization_pct}%`}
              onOpen={() => { setDetail({
                title: "Discount utilization",
                value: `${data.discounts.utilization_pct}%`,
                sub: `${data.discounts.discount_bills} of ${data.discounts.total_bills} bills`,
                explainerKey: "discount_total",
                note: `${data.discounts.discount_bills} of ${data.discounts.total_bills} settled bills carried a discount or coupon in this window, worth ${money(data.discounts.total_discount)} in total.`,
                chart: "pie",
                rows: [
                  { name: "Discounted bills", value: data.discounts.discount_bills },
                  { name: "Full-price bills", value: Math.max(0, data.discounts.total_bills - data.discounts.discount_bills) },
                ],
                unit: "count",
                breakdownTitle: "Bills in this window",
                footnote: `Last ${data.window_days} days`,
                link: "/dashboard/orders",
                linkLabel: "View orders",
                view: "discounts",
              }); }}
            />
            <MetricRow
              label="Bills with a discount"
              value={`${data.discounts.discount_bills} / ${data.discounts.total_bills}`}
              onOpen={() => { setDetail({
                title: "Bills with a discount",
                value: `${data.discounts.discount_bills}`,
                sub: `of ${data.discounts.total_bills} settled bills`,
                explainerKey: "bills",
                note: `Average discount on a discounted bill: ${money(data.discounts.discount_bills > 0 ? data.discounts.total_discount / data.discounts.discount_bills : 0)}.`,
                chart: "pie",
                rows: [
                  { name: "Discounted bills", value: data.discounts.discount_bills },
                  { name: "Full-price bills", value: Math.max(0, data.discounts.total_bills - data.discounts.discount_bills) },
                ],
                unit: "count",
                footnote: `Last ${data.window_days} days`,
                link: "/dashboard/orders",
                linkLabel: "View orders",
                view: "discounts",
              }); }}
            />
            <MetricRow
              label="Total discount value"
              value={money(data.discounts.total_discount)}
              onOpen={() => { setDetail({
                title: "Discounts given",
                value: money(data.discounts.total_discount),
                sub: `across ${data.discounts.discount_bills} bill${data.discounts.discount_bills === 1 ? "" : "s"}`,
                explainerKey: "discount_total",
                note: `That is ${money(data.discounts.discount_bills > 0 ? data.discounts.total_discount / data.discounts.discount_bills : 0)} per discounted bill on average.`,
                chart: "none",
                footnote: `Last ${data.window_days} days`,
                link: "/dashboard/orders",
                linkLabel: "View orders",
                view: "discounts",
              }); }}
            />
            <MetricRow
              label="Coupon redemptions"
              value={data.discounts.redemptions}
              onOpen={() => { setDetail({
                title: "Coupon redemptions",
                value: String(data.discounts.redemptions),
                sub: `${(data.offers ?? []).length} coupon code${(data.offers ?? []).length === 1 ? "" : "s"} live`,
                explainerKey: "discount_total",
                note: "How many times a coupon code was actually accepted at billing. Manual and staff discounts are not coupons and are not counted here.",
                chart: "bar",
                rows: (data.offers ?? []).map((o) => ({ name: o.code, value: o.used })),
                unit: "count",
                breakdownTitle: "Uses per code",
                footnote: `Last ${data.window_days} days`,
                link: "/dashboard/coupons",
                linkLabel: "View coupons",
                view: "discounts",
              }); }}
            />
          </CardContent>
        </Card>
        )}

        {inView(view, "staff") && (
        <Card>
          <CardHeader>
            <SectionHeaderRow control={data.staff.length > 0 ? (
              <HeaderControls>
                <SortControl fields={staffFields} state={staffSort} onChange={setStaffSort} />
                <SectionDownload
                  id="staff-feedback"
                  label="Feedback health"
                  build={() => [
                    ["Staff", "Responses", "Avg rating", "Complaints (%)"],
                    ...staff.map((s) => [s.name, s.feedbacks, s.avg_rating ?? "", s.complaint_pct]),
                  ]}
                />
              </HeaderControls>
            ) : null}>
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
            <div className="mt-3 flex flex-wrap items-center justify-end gap-4">
              <Link href="/dashboard/feedback" className="text-sm font-medium text-primary hover:underline">Open Feedback &rarr;</Link>
            </div>
          </CardContent>
        </Card>
        )}

        {inView(view, "supply") && (
        <Card>
          <CardHeader>
            <SectionHeaderRow control={data.suppliers.length > 0 ? (
              <HeaderControls>
                <SortControl fields={supplierFields} state={supplierSort} onChange={setSupplierSort} />
                <SectionDownload
                  id="suppliers"
                  label="Suppliers"
                  build={() => [
                    ["Vendor", "POs", "On-time (%)", "Quality (out of 5)", "Score", `Spend (${currencySymbol})`],
                    ...suppliers.map((s) => [s.vendor, s.pos, s.on_time_pct, s.quality ?? "", s.score ?? "", Number(s.spend ?? 0).toFixed(0)]),
                  ]}
                />
              </HeaderControls>
            ) : null}>
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
            <div className="mt-3 flex flex-wrap items-center justify-end gap-4">
              <Link href="/dashboard/purchase-orders" className="text-sm font-medium text-primary hover:underline">Open Purchase orders &rarr;</Link>
            </div>
          </CardContent>
        </Card>
        )}

        {inView(view, "supply", true) && (
        <Card>
          <CardHeader>
            <SectionHeaderRow control={data.stock_alerts.length > 0 ? (
              <HeaderControls>
                <SortControl fields={stockFields} state={stockSort} onChange={setStockSort} />
                <SectionDownload
                  id="low-stock"
                  label="Low-stock alerts"
                  build={() => [["Item", "Qty left"], ...stockAlerts.map((s) => [s.name, s.qty])]}
                />
              </HeaderControls>
            ) : null}>
              <CardTitle>Low-stock alerts</CardTitle><CardDescription>Inventory at or below 5 units.</CardDescription>
            </SectionHeaderRow>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.stock_alerts.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">All stock levels look healthy. ✅</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {stockAlerts.map((s, i) => (
                  <li key={i} className="flex justify-between border-b py-1 last:border-0"><span>{s.name}</span><span className="font-semibold text-red-600 dark:text-red-400">{s.qty} left</span></li>
                ))}
              </ul>
            )}
            {/* On Overview this is the only supply card; supplier scores and
                food-cost KPIs live in Suppliers & Inventory. */}
            <div className="flex flex-wrap items-center justify-end gap-4 pt-1">
              {view === "overview" && <SeeMoreInView view="supply" onOpenView={onOpenView} />}
              <Link href="/dashboard/inventory" className="text-sm font-medium text-primary hover:underline">Open Inventory →</Link>
            </div>
          </CardContent>
        </Card>
        )}

        {inView(view, "menu") && (
        <Card>
          <CardHeader>
            <SectionHeaderRow control={(data.menu_classes ?? []).length > 0 ? (
              <HeaderControls>
                <SortControl fields={menuFields} state={menuSort} onChange={setMenuSort} />
                <SectionDownload
                  id="menu-engineering"
                  label="Menu engineering"
                  build={() => [
                    ["Item", "Class", "Sold", `Revenue (${currencySymbol})`, "Popularity (%)"],
                    ...menuClasses.map((m) => [m.name, m.class, m.qty, Number(m.revenue ?? 0).toFixed(0), m.popularity_pct]),
                  ]}
                />
              </HeaderControls>
            ) : null}>
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
            <div className="mt-3 flex flex-wrap items-center justify-end gap-4">
              <Link href="/dashboard/menu" className="text-sm font-medium text-primary hover:underline">Open Menu &rarr;</Link>
            </div>
          </CardContent>
        </Card>
        )}

        {inView(view, "customers") && (
        <Card>
          <CardHeader>
            <SectionHeaderRow control={(data.churn?.at_risk ?? []).length > 0 ? (
              <HeaderControls>
                <SortControl fields={churnFields} state={churnSort} onChange={setChurnSort} />
                <SectionDownload
                  id="customer-churn"
                  label="Customer churn"
                  build={() => [
                    ["Metric", "Value"],
                    ["Churn rate (%)", data.churn?.rate_pct ?? ""],
                    ["Cohort (identified customers)", data.churn?.cohort ?? 0],
                    [],
                    ["Customer", "Orders", `Spend (${currencySymbol})`, "Quiet for (days)"],
                    ...atRisk.map((c) => [c.customer, c.orders, Number(c.spend ?? 0).toFixed(0), c.days_since_visit]),
                  ]}
                />
              </HeaderControls>
            ) : null}>
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
            <div className="mt-3 flex flex-wrap items-center justify-end gap-4">
              <Link href="/dashboard/customers" className="text-sm font-medium text-primary hover:underline">Open Customers &rarr;</Link>
            </div>
          </CardContent>
        </Card>
        )}

        {inView(view, "operations") && (
        <Card>
          <CardHeader>
            <SectionHeaderRow control={(data.tat?.by_table ?? []).length > 0 ? (
              <HeaderControls>
                <SortControl fields={tatFields} state={tatSort} onChange={setTatSort} />
                <SectionDownload
                  id="table-turnaround"
                  label="Table turnaround (TAT)"
                  build={() => [
                    ["Metric", "Value"],
                    ["Average TAT (min)", data.tat.avg_min],
                    ["Median TAT (min)", data.tat.median_min],
                    ["Completed visits", data.tat.sessions],
                    [],
                    ["Table", "Visits", "Avg TAT (min)"],
                    ...tatByTable.map((t) => [t.table_name, t.visits, t.avg_min]),
                  ]}
                />
              </HeaderControls>
            ) : null}>
              <CardTitle>Table turnaround (TAT)</CardTitle><CardDescription>Seated → left, recorded automatically per table visit. {data.tat?.sessions ?? 0} visit{(data.tat?.sessions ?? 0) === 1 ? "" : "s"} in the window.</CardDescription>
            </SectionHeaderRow>
          </CardHeader>
          <CardContent>
            {(data.tat?.sessions ?? 0) === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No completed table visits yet — TAT starts recording from each table&apos;s next seating.</p>
            ) : (
              <>
                <div className="mb-3 grid grid-cols-2 gap-3">
                  <MetricTile
                    label="Average TAT"
                    value={`${data.tat.avg_min} min`}
                    sub={`${data.tat.sessions} completed visit${data.tat.sessions === 1 ? "" : "s"}`}
                    onOpen={() => { setDetail({
                      title: "Average table turnaround",
                      value: `${data.tat.avg_min} min`,
                      sub: `${data.tat.sessions} completed visit${data.tat.sessions === 1 ? "" : "s"}`,
                      note: `How long a table stays busy from being seated to being freed, averaged over every completed visit. The median is ${data.tat.median_min} min — when the average sits well above it, a handful of very long visits are dragging it up.`,
                      chart: "bar",
                      rows: (data.tat.by_table ?? []).map((t) => ({ name: t.table_name, value: t.avg_min })),
                      unit: "min",
                      breakdownTitle: "Slowest tables",
                      footnote: `Last ${data.window_days} days`,
                      link: "/dashboard/tables",
                      linkLabel: "View tables",
                      view: "operations",
                    }); }}
                  />
                  <MetricTile
                    label="Median TAT"
                    value={`${data.tat.median_min} min`}
                    sub="half of visits are shorter"
                    onOpen={() => { setDetail({
                      title: "Median table turnaround",
                      value: `${data.tat.median_min} min`,
                      sub: "half of visits are shorter than this",
                      note: `The middle visit once every completed visit is lined up shortest to longest — unlike the ${data.tat.avg_min} min average, one very long table cannot move it. Use this as your realistic turn time when planning covers.`,
                      chart: "bar",
                      rows: (data.tat.by_table ?? []).map((t) => ({ name: t.table_name, value: t.avg_min })),
                      unit: "min",
                      breakdownTitle: "Average per table",
                      footnote: `Last ${data.window_days} days`,
                      link: "/dashboard/tables",
                      linkLabel: "View tables",
                      view: "operations",
                    }); }}
                  />
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
          <CardHeader>
            <SectionHeaderRow control={(data.demographics?.tagged ?? 0) > 0 ? (
              <SectionDownload
                id="demographics"
                label="Customer demographics"
                build={() => [
                  ["Metric", "Value"],
                  ["Customers", data.demographics?.total_customers ?? 0],
                  ["Tagged", data.demographics?.tagged ?? 0],
                  ["Coverage (%)", data.demographics?.coverage_pct ?? ""],
                  [],
                  ["Group", "Label", "Customers"],
                  ...byGender.map((g) => ["Gender", g.label, g.n]),
                  ...byAge.map((g) => ["Age group", g.label, g.n]),
                  ...topPincodes.map((g) => ["Pincode", g.label, g.n]),
                ]}
              />
            ) : null}>
              <CardTitle>Customer demographics</CardTitle><CardDescription>Aggregated only — tagged {data.demographics?.tagged ?? 0} of {data.demographics?.total_customers ?? 0} customers{data.demographics?.coverage_pct != null ? ` (${data.demographics.coverage_pct}%)` : ""}. Tag guests when adding customers.</CardDescription>
            </SectionHeaderRow>
          </CardHeader>
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
            <SectionHeaderRow control={(data.campaigns ?? []).length > 0 ? (
              <HeaderControls>
                <SortControl fields={campFields} state={campSort} onChange={setCampSort} />
                <SectionDownload
                  id="campaigns"
                  label="Campaign ROI"
                  build={() => [
                    ["Campaign", "Starts", "Ends", `Cost (${currencySymbol})`, `Sales during (${currencySymbol})`, `Sales before (${currencySymbol})`, "Uplift (%)", "ROI (%)"],
                    ...campaigns.map((c) => [
                      c.name, c.starts_at, c.ends_at,
                      Number(c.cost ?? 0).toFixed(0),
                      Number(c.sales_during ?? 0).toFixed(0),
                      Number(c.sales_before ?? 0).toFixed(0),
                      c.uplift_pct ?? "", c.roi_pct ?? "",
                    ]),
                  ]}
                />
              </HeaderControls>
            ) : null}>
              <CardTitle>Campaign ROI</CardTitle><CardDescription>Revenue in the campaign window vs the same-length window before it. ROI needs a recorded spend.</CardDescription>
            </SectionHeaderRow>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Input className="col-span-2 sm:col-span-2" placeholder="Campaign name" value={campForm.name} onChange={(e) => { setCampForm((f) => ({ ...f, name: e.target.value })); }} />
              <Input type="number" min="0" placeholder={`Cost (${currency})`} value={campForm.cost} onChange={(e) => { setCampForm((f) => ({ ...f, cost: e.target.value })); }} />
              <Input type="date" value={campForm.starts_at} onChange={(e) => { setCampForm((f) => ({ ...f, starts_at: e.target.value })); }} />
              <Input type="date" value={campForm.ends_at} onChange={(e) => { setCampForm((f) => ({ ...f, ends_at: e.target.value })); }} />
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
              <SectionHeaderRow control={
                <HeaderControls>
                  <SortControl fields={forecastFields} state={forecastSort} onChange={setForecastSort} />
                  <SectionDownload
                    id="demand-forecast"
                    label="Demand forecast"
                    build={() => [
                      ["Item", "12-wk sold", "Next week", "Trend"],
                      ...demandForecast.map((f) => [f.name, f.total_qty, Math.round(f.forecast_next_week), f.trend ?? "flat"]),
                    ]}
                  />
                </HeaderControls>
              }>
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
              <SectionHeaderRow control={
                <HeaderControls>
                  <SortControl fields={offerFields} state={offerSort} onChange={setOfferSort} />
                  <SectionDownload
                    id="offer-redemption"
                    label="Offer redemption"
                    build={() => [
                      ["Code", "Used", "Limit", "Redemption (%)"],
                      ...offers.map((o) => [o.code, o.used, o.limit ?? "Unlimited", o.redemption_pct ?? ""]),
                    ]}
                  />
                </HeaderControls>
              }>
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
            <div className="mt-3 flex flex-wrap items-center justify-end gap-4">
              <Link href="/dashboard/coupons" className="text-sm font-medium text-primary hover:underline">Open Coupons &rarr;</Link>
            </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

// Severity has to survive greyscale, a colour-blind reader and a screen reader,
// so each level carries a WORD and an icon as well as its colour — the same rule
// the Delta arrows below follow.
const ATTENTION_SEVERITY: Record<AttentionRow["severity"], { word: string; pill: string; icon: typeof TriangleAlert }> = {
  high: { word: "Urgent", pill: "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200", icon: TriangleAlert },
  medium: { word: "Soon", pill: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100", icon: Info },
  low: { word: "Watch", pill: "border-border bg-muted text-muted-foreground", icon: Info },
}

// Side-by-side branch comparison — renders ONLY for restaurants with 2+ outlets
// (single-outlet tenants see nothing, not an empty card).
// Quick insights that LEAD the Overview tab: what sold, who sold it, how fast
// the kitchen ran, when trade peaks, and what needs acting on. One server read
// (/analytics/overview), composed from the same helpers the detail panels use,
// so a figure here can never disagree with the screen it links to.
function OverviewInsightsStrip({ view, onOpenView }: { view: ViewId; onOpenView: (v: ViewId) => void }) {
  const { user } = useAuth()
  const { currencySymbol } = useCurrency()
  const [ins, setIns] = useState<OverviewInsights | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.restaurantUsername) {return}
    let active = true
    setLoading(true)
    getOverviewInsights(user.restaurantUsername, 30)
      .then((d) => { if (active) {setIns(d)} })
      .finally(() => { if (active) {setLoading(false)} })
    return () => { active = false }
  }, [user?.restaurantUsername])

  // Overview is the point of this strip; "Everything" shows it too.
  if (!(view === "overview" || view === "everything")) {return null}

  const money = (n: number | null | undefined) => `${currencySymbol}${Number(n ?? 0).toFixed(0)}`
  const prep = (msVal: number | null | undefined) => {
    const total = Math.round(Number(msVal ?? 0) / 1000)
    if (total <= 0) {return "—"}
    return `${Math.floor(total / 60)}m ${total % 60}s`
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">Loading insights…</CardContent>
      </Card>
    )
  }
  if (!ins) {return null}

  const dishes = ins.top_dishes_by_revenue ?? []
  const staff = ins.top_staff ?? []
  const attention = ins.needs_attention ?? []
  const topDishRev = dishes[0]?.revenue ?? 0
  const topStaffRev = staff[0]?.revenue ?? 0

  // A metric with no comparison is not an insight — always show the window in
  // words, and never rely on colour alone to carry the direction.
  const Delta = ({ m }: { m: OverviewMetric }) => {
    if (m.pct_change === null) {
      return <span className="text-[11px] text-muted-foreground">no prior baseline</span>
    }
    const up = m.direction === "up"
    const flat = m.direction === "flat"
    return (
      <span className={`text-[11px] ${flat ? "text-muted-foreground" : up ? "text-green-600" : "text-orange-600"}`}>
        {flat ? "–" : up ? "▲" : "▼"} {Math.abs(m.pct_change).toFixed(1)}% <span className="text-muted-foreground">{m.compared_to}</span>
      </span>
    )
  }

  const headline: { label: string; m: OverviewMetric; money: boolean; view: ViewId }[] = [
    // These come from settled bill totals, i.e. WITH tax and service charge. The
    // Overview APC card next to them is deliberately PRE-tax, so both say which.
    { label: "Revenue (incl. tax)", m: ins.headline.revenue, money: true, view: "sales" },
    { label: "Bills", m: ins.headline.bills, money: false, view: "sales" },
    { label: "Covers", m: ins.headline.covers, money: false, view: "operations" },
    { label: "APC (incl. tax)", m: ins.headline.apc, money: true, view: "sales" },
  ]

  const moduleHref: Record<string, string> = {
    Inventory: "/dashboard/inventory",
    Bills: "/dashboard/accounting",
    Accounting: "/dashboard/accounting",
    Menu: "/dashboard/menu",
    Waitlist: "/dashboard/waitlist",
    Analytics: "/dashboard/analytics",
    Orders: "/dashboard/orders",
    Tables: "/dashboard/tables",
  }

  // deep_link.href is the only route the backend has confirmed the destination
  // page actually parses, so it wins. moduleHref is the pre-deep_link fallback
  // and is wrong for some rows — pending_discounts still reports module "Bills",
  // which lands on accounting where the request is not actionable.
  const attentionHref = (a: AttentionRow): string | undefined =>
    a.deep_link?.href ?? (a.deep_link?.module ? moduleHref[a.deep_link.module] : undefined) ?? moduleHref[a.module]

  // `sub` normally spells the same number out ("20 kg left", "20% off · 200"),
  // so printing `value` next to it just says it twice. Only surface the formatted
  // number when the sentence is missing it.
  const chipValue = (it: AttentionItem, asMoney: boolean): string | null => {
    if (typeof it.value !== "number" || !Number.isFinite(it.value)) {return null}
    const rounded = Math.round(it.value)
    const sub = it.sub ?? ""
    if (sub.includes(String(rounded)) || sub.includes(rounded.toLocaleString())) {return null}
    return asMoney ? money(it.value) : rounded.toLocaleString()
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>At a glance</CardTitle>
            <CardDescription>
              Last {ins.window_days} days · {timezoneCaption(ins.timezone)} · money shown incl. tax
            </CardDescription>
          </div>
          <SectionDownload
            id="overview-insights"
            label="At a glance"
            build={() => [
              ["Metric", "Value", "Previous", "Change %", "Compared to"],
              ...headline.map((h) => [h.label, h.m.value, h.m.previous, h.m.pct_change ?? "", h.m.compared_to]),
              [],
              ["Top dish", "Qty", "Revenue", "Share %"],
              ...dishes.map((d) => [d.name, d.quantity, d.revenue, d.share_pct]),
              [],
              ["Staff", "Orders", "Revenue"],
              ...staff.map((s) => [s.employee_name, s.orders, s.revenue]),
              [],
              ["Needs attention", "Severity", "Count", "Amount", "Summary", "Opens"],
              ...attention.map((a) => [a.label, a.severity, a.count, a.amount ?? "", a.detail, attentionHref(a) ?? ""]),
              [],
              // The named offenders are the point of the row, so they export as
              // their own rows rather than being flattened into `Summary`.
              ["Attention item", "Belongs to", "Detail", "Value", "Record id"],
              ...attention.flatMap((a) => (a.items ?? []).map((it) => [it.label, a.label, it.sub ?? "", it.value ?? "", it.id ?? ""])),
            ]}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* headline + deltas */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {headline.map((h) => (
            <button
              key={h.label}
              type="button"
              onClick={() => { onOpenView(h.view) }}
              className="rounded-lg border p-3 text-left transition-colors hover:bg-muted"
            >
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{h.label}</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums">
                {h.money ? money(h.m.value) : Math.round(h.m.value)}
              </p>
              <Delta m={h.m} />
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span>Today <span className="font-semibold text-foreground tabular-nums">{money(ins.headline.today_revenue)}</span></span>
          <span>Yesterday <span className="font-semibold text-foreground tabular-nums">{money(ins.headline.yesterday_revenue)}</span></span>
        </div>

        {/* needs attention — the only actionable part, so it comes first. Each
            row names its real offenders inline: the complaint about the old
            strip was that "3 things need attention" told you nothing until you
            clicked through to a whole module page. */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Needs attention</p>
          {attention.length === 0 ? (
            <p className="flex items-center gap-2 rounded-md border border-green-300 bg-green-50 px-2 py-1.5 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
              <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
              All clear — no low stock, unsettled bills or pending approvals right now.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {attention.map((a) => {
                const sev = ATTENTION_SEVERITY[a.severity] ?? ATTENTION_SEVERITY.low
                const SevIcon = sev.icon
                const href = attentionHref(a)
                const hasAmount = typeof a.amount === "number" && Number.isFinite(a.amount) && a.amount > 0
                // The backend caps `items` at 4 already; slicing keeps a future
                // widening of that cap from swamping this glance surface.
                const items = (a.items ?? []).slice(0, 4)
                const hidden = Math.max(0, a.count - items.length)
                const body = (
                  <>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${sev.pill}`}>
                        <SevIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
                        {sev.word}
                      </span>
                      <span className="text-sm font-medium">{a.label}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">({a.count})</span>
                      {hasAmount && (
                        <span className="ml-auto shrink-0 text-sm font-semibold tabular-nums">{money(a.amount)}</span>
                      )}
                    </div>
                    {/* `detail` is the same offenders as `items`, joined into a
                        sentence by the backend — showing both would print every
                        name twice, so the chips win when they exist and the
                        sentence covers older payloads that carry no items. */}
                    {items.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {items.map((it, i) => {
                          const val = chipValue(it, hasAmount)
                          return (
                            <span
                              key={it.id ?? `${a.key}-${String(i)}`}
                              className="inline-flex max-w-full items-baseline gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 text-[11px]"
                            >
                              <span className="min-w-0 truncate font-medium">{it.label}</span>
                              {it.sub && <span className="min-w-0 truncate text-muted-foreground">{it.sub}</span>}
                              {val && <span className="shrink-0 font-semibold tabular-nums">{val}</span>}
                            </span>
                          )
                        })}
                        {hidden > 0 && (
                          <span className="inline-flex items-center rounded-md border border-dashed px-1.5 py-0.5 text-[11px] text-muted-foreground">
                            +{hidden} more
                          </span>
                        )}
                      </div>
                    ) : a.detail ? (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{a.detail}</p>
                    ) : null}
                  </>
                )
                return (
                  <li key={a.key}>
                    {href ? (
                      <Link
                        href={href}
                        title={a.detail || a.label}
                        className="block rounded-md border border-transparent px-2 py-1.5 transition-colors hover:border-border hover:bg-muted"
                      >
                        {body}
                      </Link>
                    ) : (
                      <div className="px-2 py-1.5">{body}</div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* top sellers */}
          {dishes.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Top selling dishes</p>
              <div className="space-y-2">
                {dishes.map((d) => (
                  <button
                    key={d.name}
                    type="button"
                    onClick={() => { onOpenView("menu") }}
                    className="block w-full text-left"
                    title={`${d.name} — ${d.quantity} sold, ${d.share_pct.toFixed(1)}% of counted sales`}
                  >
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate">{d.name}</span>
                      <span className="shrink-0 font-semibold tabular-nums">{money(d.revenue)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${topDishRev > 0 ? Math.max(2, (d.revenue / topDishRev) * 100) : 0}%` }}
                      />
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {d.quantity} sold · {d.share_pct.toFixed(1)}% of sales
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* staff */}
          {staff.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Best performing staff</p>
              <div className="space-y-2">
                {staff.map((s) => (
                  <button
                    key={s.employee_id || s.employee_name}
                    type="button"
                    onClick={() => { onOpenView("staff") }}
                    className="block w-full text-left"
                  >
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate">{s.employee_name}</span>
                      <span className="shrink-0 font-semibold tabular-nums">{money(s.revenue)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary/70"
                        style={{ width: `${topStaffRev > 0 ? Math.max(2, (s.revenue / topStaffRev) * 100) : 0}%` }}
                      />
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {s.orders} orders
                      {s.avg_rating != null ? ` · ${s.avg_rating.toFixed(1)}★` : ""}
                      {s.hours_worked != null ? ` · ${s.hours_worked.toFixed(1)}h` : ""}
                    </p>
                  </button>
                ))}
              </div>
              {staff[0]?.ranked_by ? (
                <p className="mt-2 text-[11px] text-muted-foreground">Ranked by {staff[0].ranked_by}.</p>
              ) : null}
            </div>
          )}
        </div>

        {/* kitchen + peak trade */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Kitchen &amp; peak trade</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricTile label="Avg prep" value={prep(ins.kitchen.avg_prep_ms)} sub={`${ins.kitchen.orders_timed} orders timed`} onOpen={() => { onOpenView("kitchen") }} />
            <MetricTile label="Slowest 10%" value={prep(ins.kitchen.p90_prep_ms)} sub="p90 prep time" onOpen={() => { onOpenView("kitchen") }} />
            <MetricTile
              label="Busiest hour"
              value={ins.peak.hour === null ? "—" : `${String(ins.peak.hour).padStart(2, "0")}:00`}
              sub={`${ins.peak.hour_orders} orders`}
              onOpen={() => { onOpenView("operations") }}
            />
            <MetricTile
              label="Busiest day"
              value={ins.peak.weekday || "—"}
              sub={`${ins.peak.weekday_orders} orders`}
              onOpen={() => { onOpenView("operations") }}
            />
          </div>
          {ins.kitchen.slowest_section ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Slowest section <span className="font-medium text-foreground">{ins.kitchen.slowest_section}</span> ({prep(ins.kitchen.slowest_section_avg_ms)})
              {ins.kitchen.slowest_dish ? <> · slowest dish <span className="font-medium text-foreground">{ins.kitchen.slowest_dish}</span> ({prep(ins.kitchen.slowest_dish_avg_ms)})</> : null}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function OutletsComparisonCard({ view, onOpenView }: { view: ViewId; onOpenView: (v: ViewId) => void }) {
  const { user } = useAuth();
  const { currency, currencySymbol } = useCurrency();
  const [data, setData] = useState<OutletComparison | null>(null);
  const [outletSort, setOutletSort] = useSectionSort("revenue");
  const money = (n: number | null | undefined) => `${currencySymbol}${Number(n ?? 0).toFixed(0)}`;

  useEffect(() => {
    if (!user?.restaurantUsername) {return;}
    let active = true;
    getOutletsComparison(user.restaurantUsername, 30).then((d) => { if (active) {setData(d);} });
    return () => { active = false; };
  }, [user?.restaurantUsername]);

  if (!inView(view, "sales", true)) {return null;}
  if (!data || data.outlets.length < 2) {return null;}

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
        <SectionHeaderRow control={
          <HeaderControls>
            <SortControl fields={outletFields} state={outletSort} onChange={setOutletSort} />
            <SectionDownload
              id="outlets-comparison"
              label="Outlets comparison"
              build={() => [
                ["Outlet", `Revenue (${currencySymbol})`, "Bills", "Orders", "Rating (out of 5)"],
                ...outlets.map((o) => [o.name, Number(o.revenue ?? 0).toFixed(0), o.bills, o.orders, o.avg_rating ?? ""]),
              ]}
            />
          </HeaderControls>
        }>
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
        {/* Two real destinations: the fuller Sales view, and the Outlets module
            that owns these branches. */}
        <div className="flex flex-wrap items-center justify-end gap-4 pt-3">
          {view === "overview" && <SeeMoreInView view="sales" onOpenView={onOpenView} />}
          <Link href="/dashboard/outlets" className="text-sm font-medium text-primary hover:underline">Manage outlets →</Link>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AnalyticsPage() {
  const { timezone } = useTimezone();
  const { user } = useAuth();
  const [view, setView] = useState<ViewId>("overview");
  const [kpiSort, setKpiSort] = useState<KpiSort>("severity");
  const [sheetOpen, setSheetOpen] = useState(false);

  // Every mounted section registers itself here so "Download all" can emit one
  // file covering exactly the sections currently on screen. The counter only
  // moves when a section mounts/unmounts (re-registering a known id is silent),
  // so a child's registration effect can never loop the page.
  const sectionsRef = useRef<Map<string, CsvSection>>(new Map());
  const [sectionCount, setSectionCount] = useState(0);
  const registry = useMemo<CsvRegistry>(() => ({
    register: (s) => {
      const had = sectionsRef.current.has(s.id);
      sectionsRef.current.set(s.id, s);
      if (!had) {setSectionCount((n) => n + 1);}
    },
    unregister: (id) => {
      if (sectionsRef.current.delete(id)) {setSectionCount((n) => n - 1);}
    },
    list: () => Array.from(sectionsRef.current.values()),
  }), []);

  // One file, every section currently rendered: a label row, the section's own
  // rows, then a blank separator row.
  const downloadAll = () => {
    const sections = registry.list();
    if (sections.length === 0) {return;}
    const rows: CsvCell[][] = [];
    for (const s of sections) {
      const body = s.build();
      if (body.length === 0) {continue;}
      if (rows.length > 0) {rows.push([]);}
      rows.push([s.label]);
      rows.push(...body);
    }
    downloadCsv(csvFilename(user?.restaurantUsername, `analytics-${view}`, timezone), rows);
  };

  // Restore persisted choices after mount (localStorage is client-only, and
  // reading it in the initial state would break hydration).
  useEffect(() => {
    try {
      const v = localStorage.getItem("analytics.view");
      if (v && VIEWS.some((x) => x.id === v)) {setView(v as ViewId);}
      const s = localStorage.getItem("analytics.kpiSort");
      if (s && KPI_SORTS.some((x) => x.id === s)) {setKpiSort(s as KpiSort);}
    } catch { /* storage unavailable (private mode) — keep defaults */ }
  }, []);

  const pickView = (v: ViewId) => {
    setView(v);
    setSheetOpen(false);
    try { localStorage.setItem("analytics.view", v); } catch { /* ignore */ }
    // Jumping from a card halfway down the page would otherwise leave the user
    // scrolled into the middle of a completely different set of sections.
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { /* older browsers */ }
  };
  const pickSort = (s: KpiSort) => {
    setKpiSort(s);
    try { localStorage.setItem("analytics.kpiSort", s); } catch { /* ignore */ }
  };

  const viewLabel = VIEWS.find((v) => v.id === view)?.label ?? "Overview";

  return (
    <div className="grid gap-4 md:gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold md:text-2xl">Analytics</h1>
          <p className="text-xs text-muted-foreground">All times in restaurant time · {timezoneCaption(timezone)}</p>
        </div>
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
                onClick={() => { pickView(v.id); }}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${view === v.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"}`}
              >
                {v.label}
              </button>
            ))}
          </div>
          {/* Narrow screens: button opening a bottom-sheet view picker */}
          <Button variant="outline" size="sm" className="md:hidden" onClick={() => { setSheetOpen(true); }}>
            View: {viewLabel} <ChevronDown className="ml-1 h-4 w-4" />
          </Button>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={downloadAll}
              disabled={sectionCount === 0}
              title={`Download every section shown in ${viewLabel} as one CSV`}
            >
              <Download className="mr-1 h-4 w-4" />
              {/* Named after the section it actually exports ("Download Kitchen"),
                  not a generic "Download all" — the file covers every card in the
                  view you are looking at, which is how owners think about it. */}
              <span className="hidden sm:inline">
                {view === "everything" ? "Download everything" : `Download ${viewLabel}`}
              </span>
              <span className="sm:hidden">CSV</span>
            </Button>
            <span className="hidden text-xs text-muted-foreground sm:inline">Sort KPIs</span>
            <div className="flex items-center rounded-lg border p-0.5">
              {KPI_SORTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { pickSort(s.id); }}
                  className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${kpiSort === s.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* pickView is the ONE action every "See more in <View>" affordance calls,
          so switching views from a card or a drill-down behaves exactly like
          clicking the chip in the toolbar (persisted + scrolled to the top). */}
      <CsvRegistryContext.Provider value={registry}>
        <OverviewInsightsStrip view={view} onOpenView={pickView} />
        <OutletsComparisonCard view={view} onOpenView={pickView} />
        <AdvancedAnalyticsView view={view} kpiSort={kpiSort} onOpenView={pickView} />
        <ActionableInsights view={view} onOpenView={pickView} />
        <PerformanceTrends view={view} onOpenView={pickView} />
        <OperationsCharts view={view} onOpenView={pickView} />
        <KitchenAnalyticsView view={view} onOpenView={pickView} />
      </CsvRegistryContext.Provider>

      {/* Mobile bottom sheet for the view picker */}
      {sheetOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Choose analytics view">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setSheetOpen(false); }} aria-hidden="true" />
          <div className="absolute inset-x-0 bottom-0 max-h-[75vh] overflow-y-auto rounded-t-2xl border-t bg-background p-4 pb-8 shadow-2xl">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" />
            <p className="mb-2 text-sm font-semibold">Show</p>
            <div className="grid gap-1">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => { pickView(v.id); }}
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
