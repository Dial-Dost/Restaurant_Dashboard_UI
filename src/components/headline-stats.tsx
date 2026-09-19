"use client"

/**
 * H1 — THE SIX FIGURES, IN ONE BOX AT THE TOP OF THE OVERVIEW.
 *
 * V3: "Combine the most important and primary statistics into a single distinct
 * box at the top of the overview section containing the following metrics:
 * Today's net sale, Today's gross sale, Online sale net, Online sale gross, Cash
 * collection, Month-to-date sales."
 *
 * THE LABELS AND THE DEFINITIONS COME FROM THE SERVER. Four of these six are
 * ambiguous words, so the server ships `label` and `hint` beside every `value`
 * — the same sentences the MIS reports are computed from — and this file
 * renders them rather than writing its own.
 *
 * AN EMPTY DAY IS NOT A ZERO DAY: `today_bills == 0` adds the sentence above
 * the grid. A backend that could not be reached is a THIRD state again — the
 * page gates this component on `scope.money`, so the failure card here is only
 * ever shown to someone entitled to the figures (a waiter's landing page must
 * not even reveal the box exists).
 *
 * EVERY ELEMENT LEADS SOMEWHERE — client item 10: each figure, chip, count,
 * note and line opens a sheet built from THIS payload (no extra read), footed
 * by a jump pinned to the server's day (src/lib/glance-destinations.ts); a
 * pure count jumps straight there, and the header carries a "Today's report"
 * link. A destination this user cannot open is dropped (the next fallback is
 * tried); the sheet still opens, so no element is ever a dead tap. The Flutter
 * `_overviewHeadline` draws the same box from the same fields.
 */

import { useState } from "react"
import { ArrowRight, CalendarDays, CalendarRange, ChevronRight, Globe } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ForkCard } from "@/components/ui/fork-card"
import { HBarRow } from "@/components/ui/fork-charts"
import { SkeletonStats } from "@/components/ui/fork-skeleton"
import { InfoChip } from "@/components/ui/status-chip"
import { CacheStalePill } from "@/components/ui/stale-pill"
import { TickTag } from "@/components/ui/tick-tag"
import { LoadErrorState } from "@/components/ui/load-error-state"
import { GlanceTap } from "@/components/overview/detail-bits"
import { GlanceSheet, type GlanceSheetSpec } from "@/components/overview/glance-sheets"
import { useModuleNav } from "@/components/overview/use-module-nav"
import { intOf, moneyOf, numOf, zoneOffsetLabel } from "@/components/overview/overview-utils"
import { useCachedFetch } from "@/hooks/use-cached-fetch"
import { useCurrency } from "@/hooks/use-currency"
import { getGlanceHeadline, type GlanceHeadline } from "@/lib/api/overview"
import {
  fmtGlanceDay,
  GLANCE_FIGURE_KEYS,
  GLANCE_REPORT_BUTTON,
  glanceDrillOf,
  glanceOpenBillsSentence,
  resolveGlance,
} from "@/lib/glance-destinations"
import { hasSettlements, modeSharePct, readHeadlineByMethod, UNALLOCATED_METHOD, unallocatedWarning } from "@/lib/settlement-breakdown"

/** Refreshed on the same cadence the box always had (deliberate web-extra). */
const REFRESH_MS = 60_000

export function HeadlineStats({ rid, openBills }: { rid: string; openBills: number | null }): React.JSX.Element | null {
  const { currencySymbol } = useCurrency()
  const money = moneyOf(currencySymbol)
  const nav = useModuleNav()
  const [sheet, setSheet] = useState<GlanceSheetSpec | null>(null)

  const { data, loading, error, offline, fromCache, updatedAt, retry } = useCachedFetch<GlanceHeadline>(
    `overview:headline:${rid}`,
    () => getGlanceHeadline(rid),
    { pollMs: REFRESH_MS, enabled: rid.length > 0 },
  )

  if (loading && !data) {
    return (
      <ForkCard>
        <SkeletonStats tiles={6} />
      </ForkCard>
    )
  }
  if (!data) {
    return (
      <ForkCard>
        <LoadErrorState whatFailed="Couldn't load today's figures." error={error} onRetry={retry} />
      </ForkCard>
    )
  }
  // Fetched, and the server sent nothing renderable — same rule as Flutter:
  // a header with an empty body under it is a hollow card.
  if (Object.keys(data).length === 0) { return null }

  const h = data
  const bills = intOf(h.today_bills)
  const nothingSettled = bills === 0
  const today = h.today ?? ""
  const monthFrom = h.month_from ?? ""
  const zone = (h.timezone ?? "").trim()
  const offset = zone.length === 0 ? "" : zoneOffsetLabel(zone)
  const zoneCaption = zone.length === 0 ? "" : (offset.length === 0 ? zone : `${zone} · ${offset}`)

  // "Today's report": a link, not a sheet — it IS the destination. Absent when
  // this user can open none of the places it leads.
  const report = resolveGlance(glanceDrillOf(h, "header"), nav.canOpen)
  const reportLink = report != null && (
    <Button variant="ghost" size="sm" className="gap-1" onClick={() => { nav.goTarget(report) }}>
      {GLANCE_REPORT_BUTTON}
      <ArrowRight aria-hidden className="h-3.5 w-3.5" />
    </Button>
  )

  const billsTarget = resolveGlance(glanceDrillOf(h, "bills"), nav.canOpen)
  const nothingTarget = resolveGlance(glanceDrillOf(h, "nothing_settled"), nav.canOpen)

  /** One figure: the server's label, the money, the server's definition under
   *  it. Null when the server did not send this metric — an unnamed money
   *  figure is worse than an absent one. */
  const figure = (key: (typeof GLANCE_FIGURE_KEYS)[number]): React.JSX.Element | null => {
    const f = h[key]
    if (!f || typeof f !== "object") { return null }
    const fig = f as { value?: number | null; label?: string; hint?: string }
    const label = (fig.label ?? "").trim()
    if (label.length === 0) { return null }
    const hint = (fig.hint ?? "").trim()
    return (
      <GlanceTap
        key={key}
        label={`${label} ${money(fig.value)}, opens details`}
        onTap={() => { setSheet(key === "cash_collection" ? { kind: "cash" } : { kind: "figure", key }) }}
        className="min-w-0"
      >
        <span className="flex items-start">
          {/* The chevron is the affordance a touch screen has instead of a
              hover wash — beside the label and never in its way. */}
          <span className="micro-label line-clamp-2 min-w-0">{label}</span>
          <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-tertiary" />
        </span>
        {/* break-words, never truncate: a six-figure total cut off is the one
            thing on this card nobody can work around. */}
        <span className="mt-1 block break-words text-[22px] font-medium tracking-[-0.01em] text-foreground tabular-nums">
          {money(fig.value)}
        </span>
        {hint.length > 0 && (
          <span className="mt-[3px] line-clamp-2 block text-[10.5px] leading-[1.25] text-muted-foreground">{hint}</span>
        )}
      </GlanceTap>
    )
  }
  const figures = GLANCE_FIGURE_KEYS.map(figure).filter((f) => f != null)

  // TODAY BY PAYMENT METHOD — the Settlement Summary's own rows for today,
  // shaped once, in the shared reader, so this block and the analytics card
  // cannot cut the same rows two different ways.
  const b = readHeadlineByMethod(h)
  const warning = b ? unallocatedWarning(b, money) : null
  const byMethodTarget = resolveGlance(glanceDrillOf(h, "by_method"), nav.canOpen)
  const unallocatedRow = b?.modes.find((m) => m.method === UNALLOCATED_METHOD)

  // NON-CHARGEABLE TODAY, beside the by-method block (client item 5). A bill
  // settled as NC took 0.00, so it has no row among the modes. Null when there
  // is nothing today, or the payload is from a backend without it.
  const ncRaw = (h.today_nc && typeof h.today_nc === "object") ? h.today_nc : null
  const ncLabel = (ncRaw?.label ?? "").trim()
  const ncBills = Math.round(numOf(ncRaw?.bills))
  const ncValue = Math.round(numOf(ncRaw?.value) * 100) / 100
  const nc = ncRaw && ncLabel.length > 0 && !(ncBills === 0 && ncValue === 0)
    ? { label: ncLabel, hint: (ncRaw.hint ?? "").trim(), bills: ncBills, value: ncValue }
    : null
  const ncLine = nc ? `${nc.bills} NC bill${nc.bills === 1 ? "" : "s"} · ${money(nc.value)} given away` : ""

  const emptyDaySentence = [
    monthFrom.length === 0
      ? "Nothing has been settled yet today. Month to date still counts every earlier day."
      : `Nothing has been settled yet today. Month to date still counts every day since ${fmtGlanceDay(monthFrom)}.`,
    ...(openBills != null ? [glanceOpenBillsSentence(openBills)] : []),
  ].join(" ")

  return (
    <div className="relative">
      <ForkCard>
        {/* The title explains how the box is cut; the link beside it opens the
            day's report. Two different answers, so two different targets. */}
        <div className="mb-3.5 flex items-center gap-2">
          <GlanceTap
            label="Today at a glance, how today is cut"
            onTap={() => { setSheet({ kind: "day", drillKey: "header" }) }}
            className="min-w-0 flex-1"
          >
            <span className="flex items-center">
              <span aria-hidden className="mr-[9px] h-3.5 w-[3px] shrink-0 rounded-[2px] bg-accent-hi gaia:hidden" />
              <span className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.007em] text-foreground gaia:text-[11px] gaia:font-normal gaia:uppercase gaia:tracking-[0.18em] gaia:text-accent-mid">
                Today at a glance
              </span>
            </span>
          </GlanceTap>
          {/* Beside the title on a wide window; on a phone it joins the chips
              below instead. */}
          {reportLink !== false && <span className="hidden shrink-0 min-[760px]:block">{reportLink}</span>}
        </div>

        {/* The day, the zone and the month window these figures were cut on,
            and how many bills are behind them — each tappable (item 10). */}
        {(today.length > 0 || zoneCaption.length > 0 || monthFrom.length > 0 || (bills ?? 0) > 0 || reportLink !== false) && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {bills != null && bills > 0 && (
              <GlanceTap
                label={`${bills} bills settled today, opens the day's bills`}
                onTap={billsTarget != null ? () => { nav.goTarget(billsTarget) } : () => { setSheet({ kind: "count" }) }}
                className="py-1"
              >
                <TickTag label={`${bills} bill(s) settled`} />
              </GlanceTap>
            )}
            {today.length > 0 && (
              <GlanceTap label={`${fmtGlanceDay(today)}, how today is cut`} onTap={() => { setSheet({ kind: "day", drillKey: "day" }) }}>
                <InfoChip icon={<CalendarDays />} label={fmtGlanceDay(today)} />
              </GlanceTap>
            )}
            {zoneCaption.length > 0 && (
              <GlanceTap label={`${zoneCaption}, how today is cut`} onTap={() => { setSheet({ kind: "day", drillKey: "zone" }) }}>
                <InfoChip icon={<Globe />} label={zoneCaption} />
              </GlanceTap>
            )}
            {monthFrom.length > 0 && (
              <GlanceTap
                label={`Month from ${fmtGlanceDay(monthFrom)}, opens month to date`}
                onTap={() => { setSheet({ kind: "figure", key: "month_to_date", via: "month" }) }}
              >
                <InfoChip icon={<CalendarRange />} label={`month from ${fmtGlanceDay(monthFrom)}`} />
              </GlanceTap>
            )}
            {reportLink !== false && <span className="min-[760px]:hidden">{reportLink}</span>}
          </div>
        )}

        {nothingSettled && (
          // ABOVE the grid, and the grid still renders: the tiles are all zero
          // and an owner reading them first has already drawn the wrong
          // conclusion. It leads to the FLOOR — on an empty day the money is
          // still on the tables.
          <GlanceTap
            label="Nothing has been settled yet today, opens the floor"
            onTap={nothingTarget != null ? () => { nav.goTarget(nothingTarget) } : () => { setSheet({ kind: "day", drillKey: "day" }) }}
            className="mb-4"
          >
            <p className="text-sm text-muted-foreground">{emptyDaySentence}</p>
          </GlanceTap>
        )}

        {figures.length > 0 && (
          // 2 / 3 / 6 at 760 / 1180 — the one grid on this page whose
          // breakpoints all DIVIDE SIX, so net|gross and the online pair never
          // split and month-to-date is never an orphan.
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 min-[760px]:grid-cols-3 min-[1180px]:grid-cols-6">
            {figures}
          </div>
        )}

        {b != null && hasSettlements(b) && (
          <section className="mt-5 border-t border-divider pt-4" aria-label={b.label}>
            {/* The label is a direct jump to the report these rows are; for
                someone who cannot open it, a sheet listing the modes. */}
            <GlanceTap
              label={`${b.label}, opens the Settlement Summary`}
              onTap={byMethodTarget != null ? () => { nav.goTarget(byMethodTarget) } : () => { setSheet({ kind: "byMethodList" }) }}
            >
              <span className="micro-label line-clamp-2 block">{b.label}</span>
              {b.hint.length > 0 && (
                <span className="mt-[3px] line-clamp-3 block text-[10.5px] leading-[1.25] text-muted-foreground">{b.hint}</span>
              )}
            </GlanceTap>
            <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 min-[760px]:grid-cols-2 min-[1180px]:grid-cols-3">
              {b.modes.map((m) => {
                const share = modeSharePct(m, b.total_amount)
                const shareLabel = share === null ? "–" : `${share.toFixed(1)}%`
                const unallocated = m.method === UNALLOCATED_METHOD
                const openRow = (): void => {
                  setSheet({ kind: "method", method: m.method, ...(unallocated ? { drillKey: "unallocated" as const } : {}) })
                }
                return (
                  <li key={m.method} className="min-w-0">
                    <HBarRow
                      label={m.label}
                      // The mode's SHARE of today, not its size against the
                      // largest mode: ₹200 by card beside ₹20,000 in cash must
                      // not draw a card bar that looks half full.
                      fraction={b.total_amount > 0 ? Math.max(0, Math.min(1, m.amount / b.total_amount)) : 0}
                      value={money(m.amount)}
                      color={unallocated ? "hsl(var(--warning))" : undefined}
                      tooltip={`${m.label} · ${money(m.amount)} · ${m.bills} bill(s) · ${shareLabel} of today`}
                      onSelect={openRow}
                    />
                    {/* The counts go on their own line UNDER the bar — part of
                        the row's tap target (item 10): it is that row's detail. */}
                    <GlanceTap label={`${m.label}, ${m.bills} bills, opens details`} onTap={openRow}>
                      <p className="text-[11px] text-muted-foreground tabular-nums">
                        {m.bills} bill(s) · {shareLabel}
                        {m.refund > 0 ? ` · − ${money(m.refund)} refunded · ${money(m.net_amount)} after refunds` : ""}
                      </p>
                    </GlanceTap>
                  </li>
                )
              })}
            </ul>
            {b.split_bills > 0 && (
              // Says only what is always true: that tag counts a released ₹0
              // table, which has no row here.
              <GlanceTap
                label={`${b.split_bills} bills paid across more than one method, opens details`}
                onTap={() => { setSheet({ kind: "split", drillKey: "split" }) }}
                className="mt-3"
              >
                <p className="text-[11px] text-muted-foreground">
                  {b.split_bills} bill(s) paid across more than one method; each part counts under its own method.
                </p>
              </GlanceTap>
            )}
            {warning != null && (
              // LOUD: the one line that means something is wrong — in EITHER
              // direction, and even when the residuals cancel. It opens the
              // Unallocated row's own sheet.
              <GlanceTap
                label="Unallocated money, opens details"
                onTap={() => {
                  setSheet(unallocatedRow
                    ? { kind: "method", method: UNALLOCATED_METHOD, drillKey: "unallocated" }
                    : { kind: "split", drillKey: "unallocated" })
                }}
                className="mt-3"
              >
                <p className="text-[11px] text-warning">{warning}</p>
              </GlanceTap>
            )}
          </section>
        )}

        {nc != null && (
          // BESIDE the by-method block, never inside it (client item 5).
          <GlanceTap
            label={`${nc.label}, ${ncLine}, opens details`}
            onTap={() => { setSheet({ kind: "nc" }) }}
            className="mt-5"
          >
            <span className="micro-label line-clamp-2 block">{nc.label}</span>
            <span className="mt-1 block text-[13px] font-semibold text-foreground tabular-nums">{ncLine}</span>
            {nc.hint.length > 0 && (
              <span className="mt-[3px] line-clamp-3 block text-[10.5px] leading-[1.25] text-muted-foreground">{nc.hint}</span>
            )}
          </GlanceTap>
        )}
      </ForkCard>

      <CacheStalePill offline={offline} fromCache={fromCache} updatedAt={updatedAt} />

      <GlanceSheet headline={h} sheet={sheet} onClose={() => { setSheet(null) }} money={money} />
    </div>
  )
}
