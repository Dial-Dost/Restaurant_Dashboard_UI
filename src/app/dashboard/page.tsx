"use client"

/**
 * THE OVERVIEW — the web copy of Flutter's `overviewModule` (modules.dart).
 *
 * COMPOSED, NOT FILTERED, by `OverviewScope`: which blocks exist is decided
 * BEFORE any request goes out, so a section this user may not see is never
 * fetched, never renders as a 403-shaped empty card, and never paints ₹0.00
 * at a waiter. A waiter's Overview is a DIFFERENT page — their own scorecard —
 * not this one with blocks removed.
 *
 * One composed load backs the page (the web AsyncView: skeleton first, cached
 * copy + pill offline, LoadErrorState + Retry when nothing at all could load).
 * Each optional read inside it degrades to null alone — "not available to this
 * user" is NOT zero, so its tile is dropped rather than reporting a confident
 * 0 — exactly the Flutter `maybe()` table.
 */

import * as React from "react"
import {
  Armchair,
  Banknote,
  Calendar,
  CalendarDays,
  ChevronRight,
  CirclePause,
  CirclePlay,
  Clock,
  CookingPot,
  Gauge,
  History,
  Hourglass,
  Package,
  ReceiptText,
  Star,
  Timer,
  TimerOff,
  TrendingDown,
  Truck,
  UserRound,
  Users,
  Utensils,
} from "lucide-react"

import { HeadlineStats } from "@/components/headline-stats"
import { AttentionCard, attentionFocus } from "@/components/overview/attention-card"
import { ActionTile, KvRow, OverviewMetricTile } from "@/components/overview/detail-bits"
import { OverviewDrills, type OverviewDrill } from "@/components/overview/overview-drills"
import { overviewScopeOf } from "@/components/overview/overview-scope"
import {
  countRoomsInUse,
  fmtDmy,
  intOf,
  moneyOf,
  msLabel,
  numOf,
  roleLabels,
  strOf,
} from "@/components/overview/overview-utils"
import { TappableStat } from "@/components/overview/tappable-stat"
import { useModuleNav } from "@/components/overview/use-module-nav"
import { Barcode, Donut, HBarRow } from "@/components/ui/fork-charts"
import { ForkCard } from "@/components/ui/fork-card"
import { SkeletonRows, SkeletonStats } from "@/components/ui/fork-skeleton"
import { LoadErrorState } from "@/components/ui/load-error-state"
import { DeltaText } from "@/components/ui/micro-stat"
import { SectionHeader } from "@/components/ui/section-header"
import { CacheStalePill } from "@/components/ui/stale-pill"
import { StatCard } from "@/components/ui/stat-card"
import { useAuth } from "@/context/AuthContext"
import { useCachedFetch } from "@/hooks/use-cached-fetch"
import { useCurrency } from "@/hooks/use-currency"
import { usePlanFeatures } from "@/hooks/use-plan-features"
import {
  getApcMonth,
  getDailyRevenue,
  getFeedbackSummary,
  getFloorTableRows,
  getGlanceHeadline,
  getInventoryRows,
  getMyScorecard,
  getOpenBillsPeek,
  getOverviewInsightsRead,
  getPurchaseOrderRows,
  getSessionAccountFacts,
  getUpcomingBookingRows,
  getWaitlistRows,
  type ApcMonth,
  type DailyRevenuePoint,
  type FeedbackSummary,
  type FloorTableRow,
  type GlanceHeadline,
  type InventoryRow,
  type MyScorecard,
  type OpenBillsPeek,
  type OverviewInsights,
  type PurchaseOrderRow,
  type ScorecardComponent,
  type UpcomingBookingRow,
  type WaitlistRow,
} from "@/lib/api/overview"
import type { AttentionRow, OverviewMetric } from "@/lib/db"
import { useTimezone } from "@/lib/use-timezone"

/** Everything one visit's composed load carries. Optional reads keep null. */
interface OverviewData {
  apc: ApcMonth
  feedback: FeedbackSummary
  daily: DailyRevenuePoint[]
  tables: FloorTableRow[]
  insights: OverviewInsights | null
  inventory: InventoryRow[] | null
  purchaseOrders: PurchaseOrderRow[] | null
  bookings: UpcomingBookingRow[] | null
  waitlist: WaitlistRow[] | null
  openBills: OpenBillsPeek | null
  scorecard: MyScorecard | null
  /** The tenant's subscription limits (Account card); the stored session has none. */
  limits: Record<string, unknown> | null
  /** Raw null when refused or failed — the headline box then draws NOTHING. */
  headline: GlanceHeadline | null
}

const MICRO = "text-[11.5px] font-medium text-tertiary"

/** The dense single-figure grid — Flutter `_metricCols` 2/3/4/5/6 at 640/900/1180/1500. */
const METRIC_GRID =
  "grid grid-cols-2 gap-3.5 min-[640px]:grid-cols-3 min-[900px]:grid-cols-4 min-[1180px]:grid-cols-5 min-[1500px]:grid-cols-6"

/** The charted stat cards — 1/2/3/4 at 620/900/1100. */
const STAT_GRID =
  "grid grid-cols-1 items-stretch gap-3.5 min-[620px]:grid-cols-2 min-[900px]:grid-cols-3 min-[1100px]:grid-cols-4"

export default function Dashboard(): React.JSX.Element {
  const { user } = useAuth()
  const { featureEnabled } = usePlanFeatures()
  const { currencySymbol } = useCurrency()
  const { timezone } = useTimezone()
  const nav = useModuleNav()
  const money = moneyOf(currencySymbol)
  const [drill, setDrill] = React.useState<OverviewDrill | null>(null)

  const rid = user?.restaurantUsername ?? ""
  const scope = overviewScopeOf(user, featureEnabled)
  const canOpen = nav.canOpen

  // Open bills are settled on the floor plan but priced by the bills
  // permission. `!scope.scorecard` is the whole of the difference for a
  // waiter: not even the count of unsettled tables belongs on their page —
  // the errand itself is the floor plan, which is the tab they land on.
  const wantsBills = !scope.scorecard && (canOpen("Tables") || canOpen("Orders"))
  const wants = {
    money: scope.money,
    rating: scope.rating,
    floor: scope.floor,
    insights: scope.insights,
    scorecard: scope.scorecard,
    planLimits: scope.planLimits,
    // Gated on the registry alone, exactly as Flutter's can(): a waiter-only
    // session already has Bookings/Waitlist hidden there, while Inventory and
    // Purchase Orders legitimately survive for a role granted them.
    inventory: canOpen("Inventory"),
    po: canOpen("Purchase Orders"),
    bookings: canOpen("Bookings"),
    waitlist: canOpen("Waitlist"),
    bills: wantsBills,
  }
  // The key names every block this composition asked for, so a role change
  // (or scope rehydration) boots a fresh load instead of reusing a page cut
  // for someone else.
  const wantsSig = Object.entries(wants).filter(([, v]) => v).map(([k]) => k).join("+")

  const wantsRef = React.useRef(wants)
  wantsRef.current = wants
  const fetchOverview = React.useCallback(async (): Promise<OverviewData> => {
    const w = wantsRef.current
    let wanted = 0
    let failed = 0
    let firstError: unknown = null
    // An optional cross-tab read. `null` means "not available to this user" —
    // gated here, or refused by the server — which is NOT the same as zero,
    // so the tile is dropped rather than reporting a confident 0.
    const maybe = async <T,>(want: boolean, get: () => Promise<T>): Promise<T | null> => {
      if (!want) { return null }
      wanted += 1
      try {
        return await get()
      } catch (e) {
        failed += 1
        firstError ??= e
        return null
      }
    }
    const [
      apc, feedback, daily, tables, insights,
      inventory, purchaseOrders, bookings, waitlist, openBills,
      scorecard, limitsFacts, headline,
    ] = await Promise.all([
      maybe(w.money, () => getApcMonth(rid)),
      maybe(w.rating, () => getFeedbackSummary(rid)),
      maybe(w.money, () => getDailyRevenue(rid, 14)),
      maybe(w.floor, () => getFloorTableRows(rid)),
      // One consolidated insight read — top dishes, best staff, kitchen speed,
      // peak trade and what needs attention, composed server-side from the
      // same helpers the detail screens use, so these agree with them.
      maybe(w.insights, () => getOverviewInsightsRead(rid, 30)),
      maybe(w.inventory, () => getInventoryRows(rid)),
      maybe(w.po, () => getPurchaseOrderRows(rid)),
      maybe(w.bookings, () => getUpcomingBookingRows(rid)),
      maybe(w.waitlist, () => getWaitlistRows(rid)),
      maybe(w.bills, () => getOpenBillsPeek(rid)),
      // THE ONE READ A WAITER'S OVERVIEW MAKES — session-scoped /me/scorecard.
      maybe(w.scorecard, () => getMyScorecard(rid)),
      maybe(w.planLimits, () => getSessionAccountFacts(rid)),
      // THE SIX HEADLINE FIGURES. `scope.money`, not a gate of its own: the
      // same action ("View Order APC") gates /orders/apc above, and asking
      // one request earlier is what stops a waiter's till from ever painting
      // the house's takings. Kept raw-null so refusal draws NOTHING.
      maybe(w.money, () => getGlanceHeadline(rid)),
    ])
    // Nothing at all could load: that is the page-level failure AsyncView
    // shows loudly — offline wording or the server's own sentence, plus Retry
    // — never a page of quietly dropped tiles.
    if (wanted > 0 && failed === wanted) {
      throw firstError instanceof Error ? firstError : new Error("Could not load the overview.")
    }
    return {
      apc: apc ?? {},
      feedback: feedback ?? {},
      daily: daily ?? [],
      tables: tables ?? [],
      insights,
      inventory,
      purchaseOrders,
      bookings,
      waitlist,
      openBills,
      scorecard,
      limits: limitsFacts?.limits ?? null,
      headline,
    }
  }, [rid])

  const { data, loading, error, offline, fromCache, updatedAt, retry } = useCachedFetch<OverviewData>(
    `overview:page:${rid}:${wantsSig}`,
    fetchOverview,
    { enabled: rid.length > 0 },
  )

  const firstName = (user?.emp_Fname ?? "").trim()
  const roleLine = [user?.restaurantName ?? "", user?.role ?? ""].filter((s) => s.length > 0).join(" · ")
  const greeting = (
    <div>
      <h1 className="text-2xl font-semibold tracking-[-0.015em] text-foreground md:text-[28px]">
        Welcome{firstName.length > 0 ? `, ${firstName}` : ""}
      </h1>
      {roleLine.length > 0 && <p className="mt-1 text-sm text-muted-foreground">{roleLine}</p>}
    </div>
  )

  if (!user || (loading && !data)) {
    return (
      <div className="flex flex-col gap-7">
        {greeting}
        <ForkCard><SkeletonStats tiles={6} /></ForkCard>
        <div className={STAT_GRID}>
          {[0, 1, 2, 3].map((i) => <ForkCard key={i}><SkeletonStats tiles={1} /></ForkCard>)}
        </div>
        <SkeletonRows rows={5} />
      </div>
    )
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-7">
        {greeting}
        <ForkCard>
          <LoadErrorState whatFailed="Couldn't load the overview." error={error} onRetry={retry} />
        </ForkCard>
      </div>
    )
  }

  const { apc, feedback: fb, daily, tables, insights } = data
  const scorecard = data.scorecard ?? {}

  const tablesBelow = tables.filter((t) => t.apc_status === "red" || t.apc_status === "yellow").length
  // "N of M tables occupied" counts the ROOM (client item 6): the next
  // party's seat at a printed 12 is a second name for a table already in M,
  // and 12 is occupied while either has a party. Every party still counts in
  // the covers below.
  const roomUse = countRoomsInUse(tables, (t) => t.occupied === true)
  const occupied = roomUse.inUse
  const totalTables = roomUse.rooms
  // Covers actually seated right now, so the occupancy read-out can say how
  // many PEOPLE are in, not only how many tables are lit.
  const seatedCovers = tables.reduce((s, t) => s + (t.occupied === true ? intOf(t.covers) ?? 1 : 0), 0)
  const occupancyRead = totalTables === 0
    ? "No tables are set up yet"
    : `${occupied} of ${totalTables} tables occupied (${Math.round((occupied / totalTables) * 100)}%) · ${seatedCovers} cover(s) seated`

  // Daily revenue series feeds the stat-card chart and the week delta.
  const dailyValues = daily.map((d) => numOf(d.revenue))
  let weekDeltaPct: number | null = null
  if (dailyValues.length >= 14) {
    const prev = dailyValues.slice(dailyValues.length - 14, dailyValues.length - 7).reduce((a, b) => a + b, 0)
    const last7 = dailyValues.slice(dailyValues.length - 7).reduce((a, b) => a + b, 0)
    if (prev > 0) { weekDeltaPct = ((last7 - prev) / prev) * 100 }
  }

  /** What a revenue mark says on hover — the sheet drills; this strip only reads. */
  const dayRead = (i: number): string => {
    if (i < 0 || i >= daily.length) { return "" }
    const d = daily[i]
    return `${d.date ?? ""} · ${money(d.revenue)} · ${intOf(d.orders) ?? 0} order(s)`
  }

  /** Null when the destination is gated for this user, so the tile falls back
   *  to a plain (non-interactive) card instead of a dead control. */
  const jumpTo = (label: string, target?: Record<string, unknown> | null): (() => void) | undefined =>
    canOpen(label) ? () => { nav.openModule(label, target) } : undefined

  // ---- the headline stat cards, composed --------------------------------
  const statCards: React.JSX.Element[] = []
  if (scope.scorecard) {
    // A waiter's headline is their own score and nothing else.
    const hasScore = scorecard.score != null
    const score = numOf(scorecard.score)
    const windowDays = intOf(scorecard.window_days) ?? 30
    const measures = intOf(scorecard.components_available) ?? 0
    statCards.push(
      <TappableStat key="score" label="Your performance score, opens details" onTap={() => { setDrill({ kind: "score" }) }}>
        <StatCard
          className="h-full"
          value={hasScore ? score.toFixed(0) : "—"}
          unit={hasScore ? "/ 100" : undefined}
          caption={`Your performance score, last ${windowDays} days`}
          chart={
            <div className="flex justify-start">
              <Donut
                fraction={hasScore ? Math.max(0, Math.min(1, score / 100)) : 0}
                size={46}
                tooltip={hasScore ? `Built from ${measures} of 4 measures` : "Nothing measurable in this window yet"}
              />
            </div>
          }
          footer={
            <span className={MICRO}>
              {hasScore ? `from ${measures} of 4 measures` : "no measure could be taken yet"}
            </span>
          }
        />
      </TappableStat>,
    )
  }
  if (scope.money) {
    statCards.push(
      <TappableStat key="revenue" label="Revenue this month, opens details" onTap={() => { setDrill({ kind: "revenue" }) }}>
        <StatCard
          className="h-full"
          value={money(apc.total_revenue)}
          tag="MTD"
          caption="Revenue this month — all channels"
          // DELIBERATE: hover read-outs, but NO per-bar tap on a chart that
          // lives inside an already-tappable card — the identical strip inside
          // the sheet is the one that drills into a single day.
          chart={dailyValues.length >= 2 ? <Barcode values={dailyValues} tooltip={dayRead} /> : undefined}
          footer={weekDeltaPct != null ? <DeltaText pct={weekDeltaPct} suffix=" vs prior week" /> : undefined}
        />
      </TappableStat>,
      <TappableStat key="apc" label="Average per cover, opens details" onTap={() => { setDrill({ kind: "apc" }) }}>
        <StatCard
          className="h-full"
          value={money(apc.monthly_apc)}
          caption="Average per cover (APC), pre-tax"
          footer={<span className={MICRO}>{`${apc.total_covers ?? 0} covers this month`}</span>}
        />
      </TappableStat>,
    )
  }
  if (scope.floor) {
    statCards.push(
      <TappableStat key="tables" label="Tables occupied right now, opens details" onTap={() => { setDrill({ kind: "tables" }) }}>
        <StatCard
          className="h-full"
          value={`${occupied}/${totalTables}`}
          unit="tables"
          caption="Tables occupied right now"
          chart={
            <div className="flex justify-start">
              {/* Same rule as the revenue strip: the gauge reads, the card acts. */}
              <Donut
                fraction={totalTables === 0 ? 0 : occupied / totalTables}
                size={46}
                tooltip={occupancyRead}
              />
            </div>
          }
        />
      </TappableStat>,
    )
  }
  if (scope.rating) {
    statCards.push(
      <TappableStat key="rating" label="Average guest rating, opens details" onTap={() => { setDrill({ kind: "rating" }) }}>
        <StatCard
          className="h-full"
          value={`${fb.averageRating ?? 0}`}
          unit="/ 5"
          caption="Average guest rating"
          footer={<span className={MICRO}>{`${fb.totalResponses ?? 0} responses`}</span>}
        />
      </TappableStat>,
    )
  }

  // ---- the waiter's "Your shift" tiles ----------------------------------
  const scorecardTiles: React.JSX.Element[] = []
  if (scope.scorecard) {
    const comps: Record<string, ScorecardComponent | undefined> = scorecard.components ?? {}
    const comp = (k: string): ScorecardComponent => comps[k] ?? {}
    const has = (k: string): boolean => comp(k).value != null
    const noteOf = (k: string): string => (comp(k).note ?? "").trim()
    const openScore = (): void => { setDrill({ kind: "score" }) }
    const now = scorecard.attendance_now ?? {}
    const clockedIn = now.clocked_in === true
    const minutes = intOf(now.today_minutes) ?? 0
    const shiftLine = `today: ${Math.floor(minutes / 60)}h ${minutes % 60}m`
    scorecardTiles.push(
      <OverviewMetricTile
        key="your-apc"
        label="your apc"
        icon={<UserRound />}
        value={has("apc") ? money(comp("apc").value) : "—"}
        sub={has("apc") ? noteOf("apc") : "no settled bill of yours could be tied to a seating yet"}
        onTap={openScore}
      />,
      <OverviewMetricTile
        key="your-rating"
        label="your guest rating"
        icon={<Star />}
        value={has("rating") ? `${numOf(comp("rating").value).toFixed(2)} / 5` : "—"}
        sub={has("rating") ? noteOf("rating") : "no guest feedback names you yet"}
        onTap={openScore}
      />,
      <OverviewMetricTile
        key="your-attendance"
        label="your attendance"
        icon={<Clock />}
        value={has("attendance") ? `${numOf(comp("attendance").value).toFixed(0)}%` : "—"}
        sub={has("attendance") ? noteOf("attendance") : "no counted shift in this window"}
        onTap={openScore}
      />,
      // The live half of attendance, which a 30-day average cannot answer.
      <OverviewMetricTile
        key="on-shift"
        label="on shift now"
        icon={clockedIn ? <CirclePlay /> : <CirclePause />}
        accent={clockedIn ? "success" : "muted"}
        value={clockedIn ? "Clocked in" : "Off"}
        sub={now.pending_approval === true ? `${shiftLine} · clock-in awaiting approval` : shiftLine}
        onTap={jumpTo("Attendance")}
      />,
    )
  }

  // ---- one live figure from each of the other tabs ----------------------
  // A null read means the module is gated (or the server refused), and a
  // metric nobody can act on is left out entirely rather than shown as 0.
  const opsTiles: React.JSX.Element[] = []

  const invRows = data.inventory
  if (invRows != null) {
    // Counted off the SAME `status` string the Inventory screen tints its
    // rows by, so the two surfaces cannot report different numbers.
    const stock = (kind: string): number =>
      invRows.filter((r) => strOf(r, "status", "In Stock").toLowerCase().includes(kind)).length
    const low = stock("low")
    const gone = stock("out")
    opsTiles.push(
      <OverviewMetricTile
        key="inventory"
        label="inventory items"
        icon={<Package />}
        accent={gone > 0 ? "danger" : low > 0 ? "warning" : "accent"}
        value={`${invRows.length}`}
        sub={invRows.length === 0
          ? "nothing tracked yet"
          : low + gone === 0
            ? "all in stock"
            : [...(gone > 0 ? [`${gone} out of stock`] : []), ...(low > 0 ? [`${low} low`] : [])].join(" · ")}
        onTap={jumpTo("Inventory")}
      />,
    )
  }

  const poRows = data.purchaseOrders
  if (poRows != null) {
    // draft + ordered = money committed but not yet on the shelf; received
    // and cancelled are finished with.
    const open = poRows.filter((o) => {
      const s = strOf(o, "status", "draft")
      return s === "draft" || s === "ordered"
    })
    const committed = open.reduce((s, o) => s + numOf(o.total_cost), 0)
    opsTiles.push(
      <OverviewMetricTile
        key="po"
        label="purchase orders open"
        icon={<Truck />}
        value={`${open.length}`}
        sub={open.length === 0 ? `${poRows.length} raised in total` : `${money(committed)} on order`}
        onTap={jumpTo("Purchase Orders")}
      />,
    )
  }

  const bookingRows = data.bookings
  if (bookingRows != null) {
    const live = bookingRows.filter((b) => strOf(b, "status", "").toLowerCase() !== "cancelled")
    // The soonest by its OWN timestamp: /get-bookings orders the window for
    // display, and "next" has to actually be the next one.
    let next: UpcomingBookingRow | null = null
    let nextAt: number | null = null
    for (const b of live) {
      const at = Date.parse(b.booking_date_time ?? "")
      if (Number.isNaN(at)) { continue }
      if (nextAt == null || at < nextAt) { nextAt = at; next = b }
    }
    const party = next == null ? null : intOf(next.number_of_people)
    opsTiles.push(
      <OverviewMetricTile
        key="bookings"
        label="upcoming reservations"
        icon={<Armchair />}
        value={`${live.length}`}
        sub={next == null
          ? (live.length === 0 ? "nothing booked" : "no date on the next booking")
          : `next ${fmtDmy(next.booking_date_time ?? "", timezone)}${party == null ? "" : ` · party of ${party}`}`}
        onTap={jumpTo("Bookings")}
      />,
    )
  }

  const waitRows = data.waitlist
  if (waitRows != null) {
    // Server order is queue order — the same order the Waitlist screen
    // renders — so the head of the list IS the next party.
    const waiting = waitRows.filter((e) => strOf(e, "status", "waiting") === "waiting")
    opsTiles.push(
      <OverviewMetricTile
        key="waitlist"
        label="walk-ins waiting"
        icon={<Hourglass />}
        accent={waiting.length === 0 ? "accent" : "warning"}
        value={`${waiting.length}`}
        sub={waiting.length === 0 ? "queue is empty" : `next up ${strOf(waiting[0], "name", "guest")}`}
        onTap={jumpTo("Waitlist")}
      />,
    )
  }

  const openBills = data.openBills
  if (openBills != null) {
    const billCount = intOf(openBills.total) ?? 0
    opsTiles.push(
      <OverviewMetricTile
        key="open-bills"
        label="open bills"
        icon={<Banknote />}
        accent={billCount > 0 ? "warning" : "accent"}
        value={`${billCount}`}
        // The COUNT survives every scope: how many tables have not settled is
        // floor work. The VALUE does not — pricing it here would put the
        // day's outstanding revenue on a waiter's landing screen.
        sub={billCount === 0
          ? "nothing outstanding"
          : scope.billValue
            ? `${money(openBills.outstanding_total)} uncollected`
            : "still to settle"}
        onTap={jumpTo("Tables") ?? jumpTo("Orders")}
      />,
    )
  }

  // ---- quick insights (`GET /analytics/overview`) ------------------------
  // `scope.insights` is asked again here, not only in the load: the block
  // must be absent because this reader may not have it, not merely because a
  // request happened to come back empty.
  const ins = scope.insights && insights != null ? insights : null

  const head = ins?.headline
  const deltaTile = (
    key: string,
    label: string,
    m: OverviewMetric | undefined,
    opts: { money?: boolean; icon: React.ReactNode },
  ): React.JSX.Element => {
    const isMoney = opts.money ?? true
    const value = m?.value
    const pct = m?.pct_change
    const dir = m?.direction ?? "flat"
    const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "–"
    // Pair the arrow with a sign and the window in words — colour alone is
    // not information, and an unlabelled arrow invites the wrong reading.
    const sub = value == null
      ? "nothing recorded in this window"
      : pct == null
        ? "no prior baseline"
        : `${arrow} ${Math.abs(numOf(pct)).toFixed(1)}% ${m?.compared_to ?? ""}`.trim()
    return (
      <OverviewMetricTile
        key={key}
        label={label}
        icon={opts.icon}
        value={isMoney ? money(value) : `${Math.round(numOf(value))}`}
        sub={sub}
        subTone={pct == null ? "muted" : dir === "up" ? "success" : dir === "down" ? "danger" : "muted"}
        onTap={jumpTo("Analytics")}
      />
    )
  }

  // The server's headline can carry null for a day with nothing settled even
  // though the type says number — read them at their honest width.
  const todayRevenue: number | null | undefined = head?.today_revenue
  const yesterdayRevenue: number | null | undefined = head?.yesterday_revenue

  const attention: AttentionRow[] = ins?.needs_attention ?? []
  // "Below target" is an APC reading wearing a floor-plan hat: it rides with
  // the money, not with /get-tables, even though that is where the field
  // arrives. Routed through the same filter the server-composed rows use, so
  // this tile cannot forward a key Tables does not read.
  const liveTiles: React.JSX.Element[] = scope.money && tablesBelow > 0
    ? [
      <ActionTile
        key="below-target"
        label="Tables below target"
        count={tablesBelow}
        icon={<TrendingDown />}
        onTap={jumpTo("Tables", attentionFocus("Tables", "tables_below_target", { apc_status: "below_target" }))}
      />,
    ]
    : []

  const dishes = ins?.top_dishes_by_revenue ?? []
  const staff = ins?.top_staff ?? []
  const kitchen = ins?.kitchen
  const peak = ins?.peak

  const kitchenTiles: React.JSX.Element[] = []
  if (kitchen != null || peak != null) {
    const timed = Math.round(numOf(kitchen?.orders_timed))
    const section = kitchen?.slowest_section ?? ""
    const dish = kitchen?.slowest_dish ?? ""
    // A dash is a value that failed to arrive; nothing failed here, the
    // kitchen simply has no history yet — so the block says that once, in one
    // tile, and drops the readouts that have nothing to report.
    const hasTiming = timed > 0 || numOf(kitchen?.avg_prep_ms) > 0 || numOf(kitchen?.p90_prep_ms) > 0
    if (kitchen != null && !hasTiming) {
      kitchenTiles.push(
        <OverviewMetricTile
          key="kitchen-none"
          label="kitchen timing"
          icon={<TimerOff />}
          value="Not yet"
          sub="No timed orders yet — prep times start once tickets are bumped."
          onTap={jumpTo("Kitchen")}
        />,
      )
    }
    if (kitchen != null && hasTiming) {
      kitchenTiles.push(
        <OverviewMetricTile
          key="avg-prep"
          label="avg prep"
          icon={<Timer />}
          value={msLabel(kitchen.avg_prep_ms)}
          sub={timed > 0 ? `across ${timed} timed order(s)` : "mean ticket time"}
          onTap={jumpTo("Kitchen")}
        />,
        <OverviewMetricTile
          key="p90"
          label="slowest 10%"
          icon={<Gauge />}
          value={msLabel(kitchen.p90_prep_ms)}
          sub="p90 ticket time"
          onTap={jumpTo("Kitchen")}
        />,
      )
    }
    if (peak?.hour != null) {
      kitchenTiles.push(
        <OverviewMetricTile
          key="busiest-hour"
          label="busiest hour"
          icon={<Clock />}
          value={`${String(Math.round(numOf(peak.hour))).padStart(2, "0")}:00`}
          sub={`${Math.round(numOf(peak.hour_orders))} order(s) · ${money(peak.hour_revenue)}`}
          onTap={jumpTo("Analytics")}
        />,
      )
    }
    if ((peak?.weekday ?? "").length > 0) {
      kitchenTiles.push(
        <OverviewMetricTile
          key="busiest-day"
          label="busiest day"
          icon={<Calendar />}
          value={peak?.weekday ?? ""}
          sub={`${Math.round(numOf(peak?.weekday_orders))} order(s) · ${money(peak?.weekday_revenue)}`}
          onTap={jumpTo("Analytics")}
        />,
      )
    }
    // "— average" under a named section would be the same empty tile in a
    // different shape, so an untimed section states what it is instead.
    if (section.length > 0) {
      kitchenTiles.push(
        <OverviewMetricTile
          key="slowest-section"
          label="slowest section"
          icon={<CookingPot />}
          value={section}
          sub={numOf(kitchen?.slowest_section_avg_ms) > 0 ? `${msLabel(kitchen?.slowest_section_avg_ms)} average` : "not timed yet"}
          onTap={jumpTo("Kitchen")}
        />,
      )
    }
    if (dish.length > 0) {
      kitchenTiles.push(
        <OverviewMetricTile
          key="slowest-dish"
          label="slowest dish"
          icon={<Utensils />}
          value={dish}
          sub={numOf(kitchen?.slowest_dish_avg_ms) > 0 ? `${msLabel(kitchen?.slowest_dish_avg_ms)} average` : "not timed yet"}
          onTap={jumpTo("Kitchen")}
        />,
      )
    }
  }

  // ---- the Account card ---------------------------------------------------
  const rolesList = [user.role, ...(Array.isArray(user.role_all) ? user.role_all : [])]
  const rolesLine = roleLabels(new Set(rolesList)) || "—"
  // A limit's value is a count or a flag; an object here is a payload shape
  // this build does not know, printed as data rather than '[object Object]'.
  const limitVal = (v: unknown): string => {
    if (typeof v === "string") { return v }
    if (typeof v === "number") { return String(v) }
    if (typeof v === "boolean") { return v ? "true" : "false" }
    return "—"
  }
  const limitsEntries = Object.entries(data.limits ?? {})
  const limitsLine = limitsEntries.length === 0 ? "—" : limitsEntries.map(([k, v]) => `${k}: ${limitVal(v)}`).join(", ")
  const accountJumps = canOpen("Settings")
  // The Account card jumps to Settings when that module is reachable
  // (admin-only), and otherwise shows the same facts as a small popup.
  const openAccount = (): void => {
    if (accountJumps) { nav.openModule("Settings"); return }
    setDrill({ kind: "account" })
  }

  const openBillsCount = intOf(data.openBills?.total)

  return (
    <div className="relative flex flex-col">
      {greeting}

      {/* THE SIX HEADLINE FIGURES — V3 H1: one distinct box at the TOP of the
          overview, before the stat cards. Renders nothing at all when the
          read was refused or failed — a waiter must never see the house's
          takings, and an error card would still reveal the box exists. */}
      {scope.money && rid.length > 0 && (
        <div className="mt-7">
          <HeadlineStats rid={rid} openBills={openBillsCount} />
        </div>
      )}

      {statCards.length > 0 && <div className={`${STAT_GRID} mt-7`}>{statCards}</div>}

      {/* For a waiter this grid holds their own figures, so the heading says
          whose section it is: nothing under it is a summary of anywhere else. */}
      {scorecardTiles.length > 0 && (
        <section className="mt-7">
          <SectionHeader title="Your shift" />
          <div className={METRIC_GRID}>{scorecardTiles}</div>
        </section>
      )}

      {/* ACROSS THE OTHER TABS — one figure each, from the very endpoint its
          own module reads, packed several to a row. */}
      {opsTiles.length > 0 && (
        <section className="mt-7">
          <SectionHeader title="Operations" />
          <div className={METRIC_GRID}>{opsTiles}</div>
        </section>
      )}

      {head != null && (
        <section className="mt-7">
          <SectionHeader
            title="Last 30 days"
            trailing={<span className="text-[10.5px] text-muted-foreground">incl. tax</span>}
          />
          <div className={METRIC_GRID}>
            {/* Settled bill totals — WITH tax and service charge. The APC card
                above is deliberately pre-tax, so both are labelled. */}
            {deltaTile("d-revenue", "revenue (incl. tax)", head.revenue, { icon: <Banknote /> })}
            {deltaTile("d-bills", "bills", head.bills, { money: false, icon: <ReceiptText /> })}
            {deltaTile("d-covers", "covers", head.covers, { money: false, icon: <Users /> })}
            {deltaTile("d-apc", "APC (incl. tax)", head.apc, { icon: <UserRound /> })}
            <OverviewMetricTile
              key="d-today"
              label="today"
              icon={<CalendarDays />}
              value={money(todayRevenue)}
              sub={todayRevenue == null ? "nothing settled yet" : "settled so far"}
              onTap={jumpTo("Analytics")}
            />
            <OverviewMetricTile
              key="d-yesterday"
              label="yesterday"
              icon={<History />}
              value={money(yesterdayRevenue)}
              sub={yesterdayRevenue == null ? "nothing settled" : "settled in full"}
              onTap={jumpTo("Analytics")}
            />
          </div>
        </section>
      )}

      {/* Needs attention first among the drill lists: it is the only part
          that is actionable. */}
      {(attention.length > 0 || liveTiles.length > 0) && (
        <section className="mt-7">
          <SectionHeader title="Needs attention" count={attention.length + liveTiles.length} />
          {attention.map((row) => (
            <div key={row.key} className="mb-2.5">
              <AttentionCard row={row} nav={nav} money={money} />
            </div>
          ))}
          {liveTiles.length > 0 && <div className={STAT_GRID}>{liveTiles}</div>}
        </section>
      )}

      {dishes.length > 0 && (
        <section className="mt-7">
          <SectionHeader title="Top selling dishes" />
          {dishes.map((d) => {
            const sold = Math.round(numOf(d.quantity))
            const top = numOf(dishes[0].revenue)
            const category = d.category || ""
            return (
              <HBarRow
                key={d.name}
                label={d.name}
                fraction={top > 0 ? Math.max(0, Math.min(1, numOf(d.revenue) / top)) : 0}
                value={money(d.revenue)}
                sub={`${sold} sold · ${numOf(d.share_pct).toFixed(1)}% of sales`}
                tooltip={`${d.name} — ${money(d.revenue)} from ${sold} sold${category.length === 0 ? "" : ` · ${category}`}`}
                onSelect={canOpen("Menu") ? () => { nav.openModule("Menu") } : undefined}
              />
            )
          })}
        </section>
      )}

      {staff.length > 0 && (
        <section className="mt-7">
          <SectionHeader title="Best performing staff" />
          {staff.map((s) => {
            const top = numOf(staff[0].revenue)
            const bits = [
              `${Math.round(numOf(s.orders))} orders`,
              ...(s.avg_rating != null ? [`${numOf(s.avg_rating).toFixed(1)}★`] : []),
              ...(s.hours_worked != null ? [`${numOf(s.hours_worked).toFixed(1)}h`] : []),
            ]
            return (
              <HBarRow
                key={s.employee_id || s.employee_name}
                label={s.employee_name}
                fraction={top > 0 ? Math.max(0, Math.min(1, numOf(s.revenue) / top)) : 0}
                value={money(s.revenue)}
                sub={bits.join(" · ")}
                tooltip={`${s.employee_name} — ${money(s.revenue)} · ${bits.join(" · ")}`}
                onSelect={canOpen("Employees") ? () => { nav.openModule("Employees") } : undefined}
              />
            )
          })}
          {/* Name the signal — "best" should never imply we weigh things we
              do not measure. */}
          {(staff[0].ranked_by || "").length > 0 && (
            <p className="mt-0.5 pl-1 text-[10px] text-muted-foreground">Ranked by {staff[0].ranked_by}.</p>
          )}
        </section>
      )}

      {kitchenTiles.length > 0 && (
        <section className="mt-7">
          <SectionHeader title="Kitchen & peak trade" />
          <div className={METRIC_GRID}>{kitchenTiles}</div>
        </section>
      )}

      <section className="mt-7">
        <SectionHeader title="Account" />
        <ForkCard onClick={openAccount} chevron={false}>
          <KvRow k="Roles" v={rolesLine} />
          {/* The plan is the restaurant's billing arrangement. Nothing on a
              floor shift is decided by it. */}
          {scope.planLimits && <KvRow k="Plan limits" v={limitsLine} />}
          <span className="mt-2 flex items-center gap-0.5">
            <span className={MICRO}>{accountJumps ? "Open Settings" : "View profile"}</span>
            <ChevronRight aria-hidden className="h-4 w-4 text-tertiary" />
          </span>
        </ForkCard>
      </section>

      <CacheStalePill offline={offline} fromCache={fromCache} updatedAt={updatedAt} />

      <OverviewDrills
        drill={drill}
        onClose={() => { setDrill(null) }}
        onOpenDay={(index) => { setDrill({ kind: "day", index }) }}
        money={money}
        nav={nav}
        apc={apc}
        daily={daily}
        feedback={fb}
        floor={{
          occupied,
          totalTables,
          occupancyRead,
          occupiedRows: tables.filter((t) => t.occupied === true),
        }}
        billValue={scope.billValue}
        weekDeltaPct={weekDeltaPct}
        scorecard={scorecard}
        account={{
          restaurantName: user.restaurantName,
          roles: rolesLine,
          limits: scope.planLimits ? limitsLine : null,
        }}
      />
    </div>
  )
}
