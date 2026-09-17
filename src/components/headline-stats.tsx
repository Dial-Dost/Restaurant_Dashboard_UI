"use client"

/**
 * H1 — THE SIX FIGURES, IN ONE BOX AT THE TOP OF THE OVERVIEW.
 *
 * V3: "Combine the most important and primary statistics into a single distinct
 * box at the top of the overview section containing the following metrics:
 * Today's net sale, Today's gross sale, Online sale net, Online sale gross, Cash
 * collection, Month-to-date sales."
 *
 * ============================================================================
 * THE LABELS AND THE DEFINITIONS COME FROM THE SERVER
 * ============================================================================
 * Four of these six are ambiguous words. "Net" means post-discount-pre-tax to an
 * accountant and "after everything" to most people; "online" means aggregator
 * orders here and "paid by card" somewhere else. A card whose numbers an owner
 * cannot reconcile with their own reports is worse than no card, so the server
 * ships the `hint` next to every figure — the same sentence the MIS reports are
 * built on — and this file renders it rather than writing its own.
 *
 * That also means the definitions cannot drift: there is one place to change
 * them, and it is the place that computes them.
 *
 * ============================================================================
 * AN EMPTY DAY IS NOT A ZERO DAY
 * ============================================================================
 * A restaurant that opens at six has no settled bills at four in the afternoon.
 * Six ₹0.00 tiles read as a claim about trade; "nothing settled yet today" reads
 * as the truth. `today_bills` is what tells them apart, and it is on the payload
 * for exactly this.
 *
 * And a backend that could not be reached is a THIRD state again: it must never
 * render as ₹0.00, which is the number an owner would act on.
 *
 * ============================================================================
 * TODAY BY PAYMENT METHOD
 * ============================================================================
 * Client ask: "How much money from each payment method made in the day has to be
 * shown." Cash was the only mode this card could name, and the per-mode cut
 * lived two modules deep on a 30-day window. The rows come from the same
 * payload (`today_by_method`, the Settlement Summary's own computation over
 * today), so the Cash row and the Cash collection tile are one number and the
 * rows add up to Today's gross sale. The Flutter Overview draws the same block
 * from the same fields. An older backend sends no rows and gets no block.
 *
 * ============================================================================
 * NON-CHARGEABLE (NC), BESIDE THE MONEY
 * ============================================================================
 * Client item 5 asks for NC in the analytics. A bill settled as NC took 0.00,
 * so it has no row among the modes (the server drops ₹0 rows there), and adding
 * its value to them would put money in the drawer that never came in. So it is
 * its own line under the block — `today_nc`, server-labelled — and it is shown
 * even on a day where every bill was given away and no mode took anything.
 *
 * ============================================================================
 * EVERY ELEMENT LEADS SOMEWHERE (client item 10)
 * ============================================================================
 * "The entire 'Today at a glance' section needs to be made clickable; each
 * option in it must be clickable." Each figure, mode row, note, chip and line is
 * a keyboard-reachable control that opens a dialog built from THIS payload — no
 * extra read — footed by a "View in <Module>" link pinned to the server's day;
 * a pure count links straight to its report, and the header carries "Today's
 * report". The destinations, the fallbacks and the words are
 * lib/glance-destinations.ts, shared with the Flutter app, and a link is only
 * offered when the nav's own rule (lib/dashboard-sections.ts) says this session
 * may open that page — never one the layout would bounce. With nowhere to go the
 * dialog still opens, so no element is a dead click. No card-wide click: nested
 * controls would fight for the same pixel.
 */

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { ArrowUpRight, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { useAuth } from "@/context/AuthContext"
import { useCurrency } from "@/hooks/use-currency"
import { getOpenBills, getOverviewHeadline, type OverviewHeadline, type HeadlineFigure } from "@/lib/db"
import { canOpenDashboardSection } from "@/lib/dashboard-sections"
import {
  GLANCE_COPY, GLANCE_FIGURE_KEYS, GLANCE_LADDER, glanceDaySentence, glanceDrillOf, glanceMonthSentence,
  glanceOpenBillsSentence, glanceZoneCaption, resolveGlanceLink, resolveGlanceSecondary,
  type GlanceDrill, type GlanceFigureKey, type GlanceHeadline, type GlanceLink,
} from "@/lib/glance-destinations"
import {
  hasSettlements, modeSharePct, readHeadlineByMethod, unallocatedWarning, UNALLOCATED_METHOD,
  type SettlementMode,
} from "@/lib/settlement-breakdown"
import { timezoneCaption, timezoneOffsetMinutes } from "@/lib/tz"
import { ncBesideLine, readHeadlineNc } from "@/lib/nc-settle"
import { AFTER_REFUNDS } from "@/lib/gross-net"
import { cn } from "@/lib/utils"

/** The order the requirement lists them in, which is also the order they read in. */
const ORDER: readonly GlanceFigureKey[] = GLANCE_FIGURE_KEYS

/** Refreshed on the same cadence as the rest of the overview. */
const REFRESH_MS = 60_000

/** One dialog: a heading, label/value rows, sentences, and where it leads. */
interface GlanceSheet {
  eyebrow: string
  title: string
  rows: { label: string; value: string; trailing?: string }[]
  notes: { text: string; tone?: "warn" | "strong" }[]
  drill: GlanceDrill | null
}

const TAP = "block w-full min-w-0 cursor-pointer rounded-md text-left transition-colors hover:bg-muted/60 "
  + "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

/** A glance element as a control: one button, named for what it opens. */
function GlanceTap({ label, onClick, glance, className, children }: {
  label: string
  onClick: () => void
  glance: string
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button type="button" aria-label={label} data-glance={glance} onClick={onClick} className={cn(TAP, className)}>
      {children}
    </button>
  )
}

/**
 * An element that IS its destination: a link when this session may open one,
 * the explanation dialog when it may not — never a click that goes nowhere.
 */
function GlanceGo({ link, label, glance, onFallback, className, children }: {
  link: GlanceLink | null
  label: string
  glance: string
  onFallback: () => void
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  if (link) {
    return (
      <Link href={link.href} aria-label={label} data-glance={glance} className={cn(TAP, className)}>
        {children}
      </Link>
    )
  }
  return <GlanceTap label={label} glance={glance} onClick={onFallback} className={className}>{children}</GlanceTap>
}

export function HeadlineStats({ rid }: { rid: string }) {
  const { currencySymbol } = useCurrency()
  const { user } = useAuth()
  const money = (n: number) =>
    `${currencySymbol}${Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const [data, setData] = useState<OverviewHeadline | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [sheet, setSheet] = useState<GlanceSheet | null>(null)
  const [openBills, setOpenBills] = useState<number | null>(null)

  // The nav's own rule, over a page path: a link here never lands on a redirect.
  const canOpen = useCallback((path: string) => canOpenDashboardSection(user, path), [user])
  const floorOpen = canOpen("/dashboard/tables") || canOpen("/dashboard/orders")

  const load = useCallback(async () => {
    if (!rid) { return }
    const h = await getOverviewHeadline(rid)
    // A failed refresh keeps the LAST GOOD FIGURES on screen rather than
    // blanking them: a momentary network blip must not make a restaurant think
    // its takings vanished. The banner below says the numbers are stale.
    setFailed(h === null)
    if (h) { setData(h) }
    setLoading(false)
  }, [rid])

  useEffect(() => {
    void load()
    const id = setInterval(() => { void load() }, REFRESH_MS)
    return () => { clearInterval(id) }
  }, [load])

  // The empty-day sentence names the bills still on the floor — one row of
  // /bills/open, whose total counts every open bill. Asked only on an empty day
  // and only of a session that could go to the floor to settle them (the app's
  // rule too); a failed read simply leaves the count out.
  const emptyDay = data?.today_bills === 0
  const wantsOpenBills = Boolean(rid) && emptyDay && floorOpen
  useEffect(() => {
    if (!wantsOpenBills) { return }
    let active = true
    void getOpenBills(rid, { limit: 1 }).then((page) => { if (active) { setOpenBills(page ? page.total : null) } })
    return () => { active = false }
  }, [rid, wantsOpenBills])

  const drillOf = (h: OverviewHeadline, key: string, row?: string): GlanceDrill | null =>
    glanceDrillOf(h as unknown as GlanceHeadline, key, row)
  const linkOf = (h: OverviewHeadline, key: string, row?: string): GlanceLink | null => resolveGlanceLink(drillOf(h, key, row), canOpen)
  const eyebrow = (h: OverviewHeadline, label = "Today at a glance"): string => (h.today ? `${label} · ${h.today}` : label)

  // ---- the dialogs, built from the payload alone ----------------------------

  const modeSheet = (
    h: OverviewHeadline, m: SettlementMode, label: string, hint: string, share: number | null,
    drill: GlanceDrill | null, extra: GlanceSheet["notes"] = [],
  ): GlanceSheet => {
    const b = readHeadlineByMethod(h)
    const toBills = resolveGlanceLink(drill, canOpen)?.module === "Accounting"
      || resolveGlanceSecondary(drill, canOpen)?.module === "Accounting"
    return {
      eyebrow: eyebrow(h, label),
      title: `${m.label} · ${money(m.amount)}`,
      rows: [
        { label: "Collected", value: money(m.amount), trailing: `${String(m.bills)} bill(s)` },
        { label: "Share of today's gross", value: share === null ? "–" : `${share.toFixed(1)}%` },
        { label: "Refunds", value: m.refund > 0 ? `− ${money(m.refund)}` : money(0) },
        { label: AFTER_REFUNDS, value: money(m.net_amount) },
      ],
      notes: [
        ...(m.method === UNALLOCATED_METHOD
          ? [{
            text: "Money whose split-payment parts do not add up to the bill total. Short on one bill and over on "
              + `another can net to ${money(0)}, so every bill counted here needs looking at, whatever the amount.`,
            tone: "warn" as const,
          }]
          : []),
        ...(b && b.split_bills > 0
          ? [{ text: `${String(b.split_bills)} bill(s) today were paid across more than one method; each part counts under its own method.` }]
          : []),
        ...(hint ? [{ text: hint }] : []),
        ...extra,
        ...(toBills ? [{ text: GLANCE_COPY.billListNote }] : []),
      ],
      drill,
    }
  }

  const figureSheet = (h: OverviewHeadline, key: GlanceFigureKey, via?: string): GlanceSheet => {
    const f: HeadlineFigure = h[key]
    const drill = drillOf(h, via ?? key)
    const base = { eyebrow: eyebrow(h), title: `${f.label} · ${money(f.value)}`, drill }
    if (key === "cash_collection") {
      const b = readHeadlineByMethod(h)
      const cash = b?.modes.find((m) => m.method.trim().toLowerCase() === "cash")
      const extra = [...(f.hint ? [{ text: f.hint }] : []), { text: GLANCE_COPY.drawerNote }]
      if (b && cash) { return modeSheet(h, cash, b.label, b.hint, modeSharePct(cash, b.total_amount), drill, extra) }
      return { ...base, rows: [], notes: [{ text: GLANCE_COPY.noCash, tone: "strong" }, ...extra] }
    }
    if (key === "today_net" || key === "today_gross") {
      const ladder = h.today_ladder
      return {
        ...base,
        rows: [
          { label: "Bills settled today", value: String(h.today_bills) },
          // An older backend sends no ladder, and a missing ladder is not a
          // ladder of zeros — it is left out.
          ...(ladder
            ? GLANCE_LADDER.map(([rung, name]) => {
              // Read defensively: the ladder is a server payload, not a promise.
              const raw: unknown = ladder[rung]
              const v = typeof raw === "number" ? raw : 0
              return {
                label: name,
                value: (rung === "discount" || rung === "refund") && v > 0 ? `− ${money(v)}` : money(v),
                trailing: (rung === "net" && key === "today_net") || (rung === "grand_total" && key === "today_gross")
                  ? "this figure" : undefined,
              }
            })
            : []),
        ],
        notes: [
          ...(f.hint ? [{ text: f.hint }] : []),
          ...(key === "today_gross" ? [{ text: GLANCE_COPY.grossAddsUp }] : []),
        ],
      }
    }
    if (key === "online_net" || key === "online_gross") {
      const bills = h.today_online_bills
      const zero = h.online_gross.value === 0 && (bills ?? 0) === 0
      return {
        ...base,
        rows: [
          ...(typeof bills === "number" ? [{ label: "Online bills today", value: String(bills) }] : []),
          ...(["online_net", "online_gross"] as const).map((k) => ({ label: h[k].label, value: money(h[k].value) })),
        ],
        notes: [
          { text: GLANCE_COPY.onlineRule },
          // The likeliest reading of ₹0 here is "Zomato is missing". It is not:
          // at the table it is a payment mode, counted in the block below.
          ...(zero ? [{ text: GLANCE_COPY.onlineNone, tone: "strong" as const }] : []),
          ...(f.hint ? [{ text: f.hint }] : []),
        ],
      }
    }
    // month_to_date
    return {
      ...base,
      rows: [{ label: "Bills settled this month", value: String(h.month_bills) }],
      notes: [
        ...(h.month_from && h.today ? [{ text: glanceMonthSentence(h.month_from, h.today) }] : []),
        { text: GLANCE_COPY.settledClock },
        ...(f.hint ? [{ text: f.hint }] : []),
      ],
    }
  }

  const zoneOf = (h: OverviewHeadline): string =>
    h.timezone ? glanceZoneCaption(h.timezone, timezoneOffsetMinutes(h.timezone)) : ""

  // The header, the day chip and the zone chip. The zone chip leads to
  // Settings (where the zone is set, admin only); anyone else to the day.
  const daySheet = (h: OverviewHeadline, key: "header" | "day" | "zone"): GlanceSheet => {
    const zoneDrill = key === "zone" ? drillOf(h, "zone") : null
    const drill = key === "zone" && !resolveGlanceLink(zoneDrill, canOpen) ? drillOf(h, "day") : drillOf(h, key)
    return {
      eyebrow: "Today at a glance",
      title: GLANCE_COPY.dayTitle,
      rows: [
        ...(h.today ? [{ label: "Today", value: h.today }] : []),
        ...(h.timezone ? [{ label: "Time zone", value: zoneOf(h) }] : []),
        ...(h.month_from ? [{ label: "Month from", value: h.month_from }] : []),
        { label: "Bills settled today", value: String(h.today_bills) },
      ],
      notes: [
        ...(h.today ? [{ text: glanceDaySentence(h.today, zoneOf(h)) }] : []),
        { text: GLANCE_COPY.settledClock },
      ],
      drill,
    }
  }

  const splitSheet = (h: OverviewHeadline, n: number, key: "split" | "unallocated"): GlanceSheet => ({
    eyebrow: eyebrow(h),
    title: `${String(n)} bill(s) paid across more than one method`,
    rows: [],
    notes: [{ text: GLANCE_COPY.splitRule }, { text: GLANCE_COPY.billListNote }],
    drill: drillOf(h, key),
  })

  // ---- the box ---------------------------------------------------------------

  const tiles = (h: OverviewHeadline) => (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
      {ORDER.map((key) => {
        const f: HeadlineFigure = h[key]
        return (
          <GlanceTap key={key} glance={key} label={`${f.label} ${money(f.value)}, opens details`}
            onClick={() => { setSheet(figureSheet(h, key)) }} className="-m-1 p-1">
            <span className="flex items-start gap-0.5">
              <span className="truncate text-xs font-medium text-muted-foreground" title={f.label}>{f.label}</span>
              <ChevronRight aria-hidden className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
            </span>
            {/* `break-words` and not `truncate`: a six-figure total that is cut
                off is the one thing on this card nobody can work around. */}
            <span className="mt-1 block break-words text-xl font-bold tabular-nums sm:text-2xl" title={f.hint}>
              {money(f.value)}
            </span>
            <span className="mt-1 line-clamp-2 block text-[11px] leading-snug text-muted-foreground" title={f.hint}>
              {f.hint}
            </span>
          </GlanceTap>
        )
      })}
    </div>
  )

  const byMethod = (h: OverviewHeadline) => {
    const b = readHeadlineByMethod(h)
    // Nothing settled is already said above the tiles; no rows is not a block.
    if (!b || !hasSettlements(b)) { return null }
    const warning = unallocatedWarning(b, money)
    const unallocatedRow = b.modes.find((m) => m.method === UNALLOCATED_METHOD)
    const openRow = (m: SettlementMode, drill?: GlanceDrill | null): void => {
      setSheet(modeSheet(h, m, b.label, b.hint, modeSharePct(m, b.total_amount), drill ?? drillOf(h, "by_method_row", m.method)))
    }
    return (
      <section className="border-t border-border/60 pt-4" aria-label={b.label}>
        {/* The label IS the Settlement Summary for today; without it, a list. */}
        <GlanceGo glance="by_method" link={linkOf(h, "by_method")} label={`${b.label}, opens the Settlement Summary`}
          className="-m-1 p-1"
          onFallback={() => {
            setSheet({
              eyebrow: eyebrow(h, b.label),
              title: GLANCE_COPY.byMethodTitle,
              rows: b.modes.map((m) => ({ label: m.label, value: money(m.amount), trailing: `${String(m.bills)} bill(s)` })),
              notes: b.hint ? [{ text: b.hint }] : [],
              drill: drillOf(h, "by_method"),
            })
          }}>
          <span className="block text-xs font-medium text-muted-foreground">{b.label}</span>
          {b.hint && (
            <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">{b.hint}</span>
          )}
        </GlanceGo>
        <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {b.modes.map((m) => {
            const share = modeSharePct(m, b.total_amount)
            const unallocated = m.method === UNALLOCATED_METHOD
            // The bar is the mode's SHARE of today, not its size against the
            // largest mode: a till that took ₹200 by card and ₹20,000 in cash
            // must not draw a card bar that looks half full.
            const width = b.total_amount > 0 ? Math.max(0, Math.min(100, (m.amount / b.total_amount) * 100)) : 0
            return (
              <li key={m.method} className="min-w-0">
                {/* The whole row — name, figure, bar and its count line — is one
                    control (item 10): the counts are that row's detail. */}
                <GlanceTap glance={`mode:${m.method}`} label={`${m.label}, ${money(m.amount)}, opens details`}
                  onClick={() => { openRow(m) }} className="-m-1 p-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className={`truncate text-sm font-medium ${unallocated ? "text-amber-600 dark:text-amber-400" : ""}`}
                      title={m.label}>
                      {/* The owner's name for the mode (Settings > Payments); rows
                          still key and match Unallocated on the stored id. */}
                      {m.label}
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">{money(m.amount)}</span>
                  </span>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted">
                    <span className={`block h-full rounded-full ${unallocated ? "bg-amber-500" : "bg-primary"}`}
                      style={{ width: `${width}%` }} />
                  </span>
                  <span className="mt-1 block text-[11px] text-muted-foreground tabular-nums">
                    {m.bills} bill{m.bills === 1 ? "" : "s"}
                    {/* A missing share is a dash, never 0% — see modeSharePct. */}
                    {` · ${share === null ? "–" : `${share.toFixed(1)}%`}`}
                    {m.refund > 0 ? ` · −${money(m.refund)} refunded` : ""}
                  </span>
                </GlanceTap>
              </li>
            )
          })}
        </ul>
        {(b.split_bills > 0 || warning) && (
          <div className="mt-3 space-y-1 text-[11px] text-muted-foreground">
            {b.split_bills > 0 && (
              // Says only what is always true. The counts do NOT reliably add up
              // to more than "N bills settled": that tag counts a released ₹0
              // table, which has no row here.
              <GlanceTap glance="split" label={`${String(b.split_bills)} bills paid across more than one method, opens details`}
                onClick={() => { setSheet(splitSheet(h, b.split_bills, "split")) }}>
                {b.split_bills} bill{b.split_bills === 1 ? " was" : "s were"} paid across more than one
                method; each part counts under its own method.
              </GlanceTap>
            )}
            {warning && (
              // LOUD: the one row that means something is wrong. Keyed off the
              // Unallocated row as well as its sum, which can net to ₹0.00. It
              // opens that row's own dialog, whose link is the Split bills.
              <GlanceTap glance="unallocated" label="Unallocated money, opens details"
                className="text-amber-600 dark:text-amber-400"
                onClick={() => {
                  if (unallocatedRow) { openRow(unallocatedRow, drillOf(h, "unallocated")) }
                  else { setSheet(splitSheet(h, b.split_bills, "unallocated")) }
                }}>
                {warning}
              </GlanceTap>
            )}
          </div>
        )}
      </section>
    )
  }

  const ncBeside = (h: OverviewHeadline) => {
    const nc = readHeadlineNc(h)
    if (!nc) { return null }
    return (
      <section data-testid="headline-nc" className="border-t border-border/60 pt-3" aria-label={nc.label}>
        <GlanceTap glance="nc" label={`${nc.label}, ${ncBesideLine(nc, money)}, opens details`} className="-m-1 p-1"
          onClick={() => {
            setSheet({
              eyebrow: eyebrow(h),
              title: nc.label,
              rows: [
                { label: "NC bills", value: String(nc.bills) },
                { label: "Given away", value: money(nc.value) },
              ],
              notes: nc.hint ? [{ text: nc.hint }] : [],
              drill: drillOf(h, "nc"),
            })
          }}>
          <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-xs font-medium text-muted-foreground">{nc.label}</span>
            <span className="text-sm font-semibold tabular-nums">{ncBesideLine(nc, money)}</span>
          </span>
          {nc.hint && (
            <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">{nc.hint}</span>
          )}
        </GlanceTap>
      </section>
    )
  }

  const primary = sheet ? resolveGlanceLink(sheet.drill, canOpen) : null
  const secondary = sheet ? resolveGlanceSecondary(sheet.drill, canOpen) : null
  const report = data ? linkOf(data, "header") : null

  return (
    <Card className="border-primary/30 bg-muted/30">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">
            {data ? (
              <GlanceTap glance="header" label="Today at a glance, how today is cut" className="px-1"
                onClick={() => { setSheet(daySheet(data, "header")) }}>
                Today at a glance
              </GlanceTap>
            ) : "Today at a glance"}
          </CardTitle>
          {report && (
            <Button asChild size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs">
              <Link href={report.href} data-glance="report">
                {GLANCE_COPY.reportButton}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          )}
        </div>
        {data && (
          // The day, the zone and the month these figures were cut on, and how
          // many bills are behind them — one control each, as the app's chips.
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-muted-foreground">
            <GlanceTap glance="day" label={`${data.today}, how today is cut`} className="w-auto px-1"
              onClick={() => { setSheet(daySheet(data, "day")) }}>
              {data.today}
            </GlanceTap>
            <span aria-hidden>·</span>
            <GlanceTap glance="zone" label={`${data.timezone}, how today is cut`} className="w-auto px-1"
              onClick={() => { setSheet(daySheet(data, "zone")) }}>
              {timezoneCaption(data.timezone)}
            </GlanceTap>
            {data.month_from && (
              <>
                <span aria-hidden>·</span>
                <GlanceTap glance="month" label={`Month from ${data.month_from}, opens month to date`} className="w-auto px-1"
                  onClick={() => { setSheet(figureSheet(data, "month_to_date", "month")) }}>
                  month from {data.month_from}
                </GlanceTap>
              </>
            )}
            {data.today_bills > 0 && (
              <>
                <span aria-hidden>·</span>
                <GlanceGo glance="bills" link={linkOf(data, "bills")} className="w-auto px-1"
                  label={`${String(data.today_bills)} bills settled today, opens the day's bills`}
                  onFallback={() => {
                    setSheet({
                      eyebrow: eyebrow(data),
                      title: `${String(data.today_bills)} bill(s) settled`,
                      rows: [],
                      notes: [{ text: GLANCE_COPY.settledClock }, { text: GLANCE_COPY.noDestination }],
                      drill: drillOf(data, "bills"),
                    })
                  }}>
                  {`${String(data.today_bills)} bill${data.today_bills === 1 ? "" : "s"} settled`}
                </GlanceGo>
              </>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {loading && !data ? (
          <p className="py-4 text-sm text-muted-foreground">Loading…</p>
        ) : !data ? (
          <p className="py-4 text-sm text-muted-foreground">
            Could not load today&apos;s figures. This is not a report of zero takings.
          </p>
        ) : (
          <div className="space-y-3">
            {data.today_bills === 0 && (
              // Said ABOVE the tiles, because the tiles are all zero and an owner
              // reading them first has already drawn the wrong conclusion. It
              // leads to the floor, where the day's money still is (item 10).
              <GlanceGo glance="nothing_settled" link={linkOf(data, "nothing_settled")}
                label="Nothing has been settled yet today, opens the floor"
                className="text-sm text-muted-foreground"
                onFallback={() => { setSheet(daySheet(data, "day")) }}>
                Nothing has been settled yet today. Month to date still counts every earlier day.
                {wantsOpenBills && openBills !== null ? ` ${glanceOpenBillsSentence(openBills)}` : ""}
              </GlanceGo>
            )}
            {tiles(data)}
            {byMethod(data)}
            {ncBeside(data)}
            {failed && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                These figures could not be refreshed just now, so they may be a minute or two old.
              </p>
            )}
          </div>
        )}
      </CardContent>
      <Dialog open={sheet !== null} onOpenChange={(open) => { if (!open) { setSheet(null) } }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogDescription className="text-xs uppercase tracking-wide">{sheet?.eyebrow}</DialogDescription>
            <DialogTitle>{sheet?.title}</DialogTitle>
          </DialogHeader>
          {sheet && sheet.rows.length > 0 && (
            <dl className="space-y-1.5 text-sm">
              {sheet.rows.map((r) => (
                <div key={r.label} className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <dt className="text-muted-foreground">{r.label}</dt>
                  <dd className="flex items-baseline gap-2 font-medium tabular-nums">
                    {r.trailing && <span className="text-xs font-normal text-muted-foreground">{r.trailing}</span>}
                    {r.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {sheet && sheet.notes.length > 0 && (
            <div className="space-y-2 text-xs leading-snug">
              {sheet.notes.map((n, i) => (
                <p key={`${String(i)}:${n.text}`} className={
                  n.tone === "warn" ? "text-amber-600 dark:text-amber-400"
                    : n.tone === "strong" ? "text-foreground" : "text-muted-foreground"
                }>{n.text}</p>
              ))}
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            <Button size="sm" variant="ghost" onClick={() => { setSheet(null) }}>Close</Button>
            <div className="flex flex-wrap gap-2">
              {secondary && (
                <Button asChild size="sm" variant="outline" className="gap-1" onClick={() => { setSheet(null) }}>
                  <Link href={secondary.href} data-glance-jump="secondary">
                    {secondary.label}
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>
                </Button>
              )}
              {primary && (
                <Button asChild size="sm" className="gap-1" onClick={() => { setSheet(null) }}>
                  <Link href={primary.href} data-glance-jump="primary">
                    {primary.label}
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
