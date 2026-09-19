"use client"

// THE STAT-CARD DRILL SHEETS — web copies of the Overview's `openRevenue` /
// `openDay` / `openApc` / `openTables` / `openRating` / `openScore` and the
// Account popup in Flutter's modules.dart. Every sheet reads only what the
// page already fetched (no extra round-trips when a card is opened), and its
// "View in <Module>" jump is hidden outright when that module is not reachable
// for this user, never disabled.

import * as React from "react"

import { DrillSheet, DrillSheetAction } from "@/components/ui/drill-sheet"
import { Barcode, Donut, HBarRow, WeekdayBars } from "@/components/ui/fork-charts"
import { ForkCard } from "@/components/ui/fork-card"
import { MicroStat, DeltaText } from "@/components/ui/micro-stat"
import { SectionHeader } from "@/components/ui/section-header"
import { DetailRow, KvRow } from "@/components/overview/detail-bits"
import { intOf, numOf, scoreOf, strOf, tableOtp } from "@/components/overview/overview-utils"
import type { ModuleNav } from "@/components/overview/use-module-nav"
import { fmtGlanceDay } from "@/lib/glance-destinations"
import type {
  ApcMonth,
  DailyRevenuePoint,
  FeedbackSummary,
  FloorTableRow,
  MyScorecard,
  ScorecardComponent,
} from "@/lib/api/overview"

/** Which stat-card sheet is open. */
export type OverviewDrill =
  | { kind: "revenue" }
  | { kind: "day"; index: number }
  | { kind: "apc" }
  | { kind: "tables" }
  | { kind: "rating" }
  | { kind: "score" }
  | { kind: "account" }

const BODY = "text-[13px] leading-snug text-foreground"

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"]

/** 0 = Monday … 6 = Sunday, off a day key; null when unparseable. */
const weekdayIdx = (iso: string): number | null => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) { return null }
  return (d.getUTCDay() + 6) % 7
}

/** "Sat, Sep 19" — a single letter is enough on an axis but not in a title. */
const dayTitleOf = (point: DailyRevenuePoint): string => {
  const iso = point.date ?? ""
  const short = fmtGlanceDay(iso)
  const wd = weekdayIdx(iso)
  if (wd == null) { return short.length === 0 ? "That day" : short }
  return `${DAY_NAMES[wd]}, ${short}`
}

export interface OverviewDrillsProps {
  drill: OverviewDrill | null
  onClose: () => void
  /** Swap to one day's sheet (the revenue sheet's charts drill into days). */
  onOpenDay: (index: number) => void
  money: (v: unknown) => string
  nav: ModuleNav
  apc: ApcMonth
  daily: DailyRevenuePoint[]
  feedback: FeedbackSummary
  floor: {
    occupied: number
    totalTables: number
    occupancyRead: string
    occupiedRows: FloorTableRow[]
  }
  /** May per-table running totals be priced on this session's screen? */
  billValue: boolean
  weekDeltaPct: number | null
  scorecard: MyScorecard
  account: { restaurantName: string; roles: string; limits: string | null }
}

interface SheetContent {
  eyebrow: string
  title: string
  jumpTo?: string
  body: React.ReactNode
}

export function OverviewDrills({
  drill,
  onClose,
  onOpenDay,
  money,
  nav,
  apc,
  daily,
  feedback,
  floor,
  billValue,
  weekDeltaPct,
  scorecard,
  account,
}: OverviewDrillsProps): React.JSX.Element | null {
  if (!drill) { return null }

  const dailyValues = daily.map((d) => numOf(d.revenue))

  /** What a revenue mark says on hover, indexed into `daily`. */
  const dayRead = (i: number): string => {
    if (i < 0 || i >= daily.length) { return "" }
    const d = daily[i]
    return `${dayTitleOf(d)} · ${money(d.revenue)} · ${intOf(d.orders) ?? 0} order(s)`
  }

  const content = ((): SheetContent => {
    switch (drill.kind) {
      case "revenue": {
        const last7 = daily.length <= 7 ? daily : daily.slice(daily.length - 7)
        // last7 is a TAIL slice of `daily`, so a bar index has to be shifted
        // back by everything the slice dropped before it can name a day.
        const tailFrom = daily.length - last7.length
        return {
          eyebrow: "Revenue",
          title: `Last ${daily.length} days`,
          jumpTo: "Analytics",
          body: (
            <div>
              <div className="flex flex-wrap items-center gap-x-8 gap-y-3.5">
                <MicroStat value={money(apc.total_revenue)} label="MTD revenue" />
                <MicroStat value={`${apc.orders?.length ?? 0}`} label="bills this month" />
                {weekDeltaPct != null && <DeltaText pct={weekDeltaPct} suffix=" vs prior week" />}
              </div>
              {dailyValues.length >= 2 && (
                <div className="mt-5">
                  <Barcode
                    values={dailyValues}
                    height={54}
                    onSelect={onOpenDay}
                    tooltip={dayRead}
                  />
                </div>
              )}
              {last7.length > 0 && (
                <div className="mt-5">
                  <WeekdayBars
                    values={last7.map((d) => numOf(d.revenue))}
                    labels={last7.map((d) => DAY_LETTERS[weekdayIdx(d.date ?? "") ?? 0])}
                    highlight={last7.length - 1}
                    onSelect={(i) => { onOpenDay(tailFrom + i) }}
                    tooltip={(i) => dayRead(tailFrom + i)}
                  />
                </div>
              )}
              <SectionHeader title="By day" className="mt-5" />
              {daily.length === 0 ? (
                <p className={BODY}>No revenue recorded in this window.</p>
              ) : (
                [...daily].reverse().map((d, i) => (
                  <DetailRow
                    key={d.date ?? String(i)}
                    label={fmtGlanceDay(d.date ?? "")}
                    value={money(d.revenue)}
                    trailing={`${d.orders ?? 0} order(s)`}
                  />
                ))
              )}
            </div>
          ),
        }
      }

      case "day": {
        const i = drill.index
        const d = i >= 0 && i < daily.length ? daily[i] : undefined
        if (!d) { return { eyebrow: "Revenue · one day", title: "That day", body: null } }
        const rev = numOf(d.revenue)
        const orders = intOf(d.orders) ?? 0
        const windowTotal = dailyValues.reduce((a, b) => a + b, 0)
        const best = dailyValues.reduce((a, b) => (b > a ? b : a), 0)
        const prev = i > 0 ? numOf(daily[i - 1].revenue) : null
        return {
          eyebrow: "Revenue · one day",
          title: dayTitleOf(d),
          jumpTo: "Analytics",
          body: (
            <div>
              <div className="flex flex-wrap items-center gap-x-8 gap-y-3.5">
                <MicroStat value={money(rev)} label="settled" />
                <MicroStat value={`${orders}`} label="order(s)" />
                {/* A day only means something against the window it sits in. */}
                <Donut
                  fraction={best <= 0 ? 0 : Math.max(0, Math.min(1, rev / best))}
                  size={46}
                  tooltip={best <= 0
                    ? "Nothing was settled in this window"
                    : `Best day in the window was ${money(best)}`}
                />
              </div>
              <div className="mt-5">
                <DetailRow label="Average per order" value={orders === 0 ? "—" : money(rev / orders)} />
                <DetailRow
                  label={`Share of the last ${daily.length} days`}
                  value={windowTotal <= 0 ? "—" : `${(rev / windowTotal * 100).toFixed(1)}%`}
                />
                {prev != null && (
                  <DetailRow
                    label="The day before"
                    value={money(prev)}
                    trailing={prev <= 0
                      ? undefined
                      : `${rev >= prev ? "+" : ""}${((rev - prev) / prev * 100).toFixed(1)}%`}
                  />
                )}
              </div>
            </div>
          ),
        }
      }

      case "apc": {
        const covers = numOf(apc.total_covers)
        const basis = numOf(apc.total_revenue)
        const band = apc.yellow_band_percent
        return {
          eyebrow: "Average per cover",
          title: "How APC is calculated",
          jumpTo: "Analytics",
          body: (
            <div>
              <div className="flex flex-wrap items-center gap-x-8 gap-y-3.5">
                <MicroStat value={money(apc.monthly_apc)} label="APC (pre-tax)" />
                <MicroStat value={covers.toFixed(0)} label="covers" />
              </div>
              <ForkCard inset className="mt-5 px-4 py-3">
                <p className="text-[13px] font-semibold text-foreground tabular-nums">
                  {money(basis)}  ÷  {covers.toFixed(0)} covers  =  {money(apc.monthly_apc)}
                </p>
              </ForkCard>
              <SectionHeader title="Basis" className="mt-5" />
              <DetailRow label="Bill basis (pre-tax)" value={money(basis)} />
              <DetailRow label="Covers (counted once per table)" value={covers.toFixed(0)} />
              <DetailRow label="Bills counted" value={`${apc.orders?.length ?? 0}`} />
              <DetailRow label="Period" value={apc.month || "—"} />
              {band != null && <DetailRow label="Target band" value={`±${numOf(band).toFixed(0)}%`} />}
            </div>
          ),
        }
      }

      case "tables": {
        const { occupied, totalTables, occupancyRead, occupiedRows } = floor
        /** Null, never '': an empty trailing still costs the row a gap. */
        const tableAside = (t: FloorTableRow): string | undefined => {
          const otp = tableOtp(t)
          const parts = [
            ...(billValue ? [`${t.covers ?? 1} cover(s)`] : []),
            ...(otp.length > 0 ? [`OTP ${otp}`] : []),
            ...(t.payment_pending === true ? ["payment pending"] : []),
          ].join(" · ")
          return parts.length === 0 ? undefined : parts
        }
        return {
          eyebrow: "Floor",
          title: "Occupied right now",
          jumpTo: "Tables",
          body: (
            <div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3.5">
                {/* The floor plan is where an occupancy figure is acted on. The
                    sheet's own "View in Tables" goes to the same place, so the
                    gauge is a shortcut to it and not a second, different answer. */}
                <Donut
                  fraction={totalTables === 0 ? 0 : occupied / totalTables}
                  size={54}
                  tooltip={occupancyRead}
                  onSelect={nav.canOpen("Tables")
                    ? () => { onClose(); nav.openModule("Tables") }
                    : undefined}
                />
                <MicroStat value={`${occupied} of ${totalTables}`} label="tables occupied" />
              </div>
              <SectionHeader title="Tables" className="mt-5" />
              {occupiedRows.length === 0 ? (
                <p className={BODY}>No table is occupied at the moment.</p>
              ) : (
                occupiedRows.map((t, i) => (
                  <DetailRow
                    key={String(t.table_name ?? i)}
                    label={strOf(t, "table_name")}
                    // The row's headline figure is what the table is WORTH; for
                    // a session that may not price the floor, the covers move up
                    // into the value slot rather than the row being dropped.
                    value={billValue ? money(t.table_total) : `${t.covers ?? 1} cover(s)`}
                    trailing={tableAside(t)}
                  />
                ))
              )}
            </div>
          ),
        }
      }

      case "rating": {
        const cats = feedback.categoryAverages ?? {}
        const entries = Object.entries(cats)
        // Every category bar leads to the same place — Feedback owns the
        // responses behind all of them, and a category is not a record there.
        const openFeedback = nav.canOpen("Feedback")
          ? (): void => { onClose(); nav.openModule("Feedback") }
          : undefined
        return {
          eyebrow: "Guest feedback",
          title: "Rating summary",
          jumpTo: "Feedback",
          body: (
            <div>
              <div className="flex flex-wrap items-center gap-x-8 gap-y-3.5">
                <MicroStat value={`${feedback.averageRating ?? 0} / 5`} label="average rating" />
                <MicroStat value={`${feedback.totalResponses ?? 0}`} label="responses" />
                <MicroStat value={`${feedback.last30DaysResponses ?? 0}`} label="last 30 days" />
              </div>
              <SectionHeader title="By category" className="mt-5" />
              {entries.length === 0 ? (
                <p className={BODY}>No category ratings collected yet.</p>
              ) : (
                entries.map(([key, c]) => {
                  const label = c.label || key
                  const n = intOf(c.count ?? c.responses)
                  return (
                    <HBarRow
                      key={key}
                      label={label}
                      fraction={numOf(c.average) / 5}
                      value={`${c.average ?? "—"}`}
                      tooltip={`${label} — ${scoreOf(c.average)} / 5${n == null ? "" : ` from ${n} response(s)`}`}
                      onSelect={openFeedback}
                    />
                  )
                })
              )}
            </div>
          ),
        }
      }

      case "score": {
        // What the composite was actually built from — the same four
        // components, each with the share it carried and the server's own
        // sentence about it. Turnaround appears HERE even though it is not one
        // of the four tiles: it is part of the number, so it has to be part of
        // the explanation.
        const names: Record<string, string> = {
          apc: "Average per cover",
          rating: "Guest rating",
          attendance: "Attendance",
          tat: "Table turnaround",
        }
        const comps: Record<string, ScorecardComponent | undefined> = scorecard.components ?? {}
        const weights = scorecard.effective_weights ?? {}
        const windowDays = intOf(scorecard.window_days) ?? 30
        const hasScore = scorecard.score != null
        const score = numOf(scorecard.score)
        return {
          eyebrow: `Your score · last ${windowDays} days`,
          title: hasScore ? `${score.toFixed(0)} out of 100` : "Not enough to score yet",
          body: (
            <div>
              <p className={BODY}>
                Built only from the measures below that could be taken. A measure with no data is left
                out of the score, never counted as a zero.
              </p>
              <div className="mt-5">
                {(["apc", "rating", "attendance", "tat"] as const).map((k) => {
                  const c = comps[k] ?? {}
                  const available = c.available === true && c.score != null
                  const share = numOf(weights[k])
                  const note = (c.note ?? "").trim()
                  return (
                    <div key={k} className="mb-3">
                      <DetailRow
                        label={names[k]}
                        value={available ? `${numOf(c.score).toFixed(0)} / 100` : "not measured"}
                        trailing={available && share > 0 ? `counts for ${(share * 100).toFixed(0)}%` : undefined}
                      />
                      {note.length > 0 && <p className="text-[11px] leading-[1.3] text-tertiary">{note}</p>}
                    </div>
                  )
                })}
              </div>
            </div>
          ),
        }
      }

      case "account":
        // The same facts the Account card shows, for a user who cannot open
        // Settings — the card's tap goes straight there when they can.
        return {
          eyebrow: "Account",
          title: account.restaurantName,
          body: (
            <div>
              <KvRow k="Roles" v={account.roles} />
              {account.limits != null && <KvRow k="Plan limits" v={account.limits} />}
            </div>
          ),
        }
    }
  })()

  const canJump = content.jumpTo != null && nav.canOpen(content.jumpTo)
  const jumpTo = content.jumpTo

  return (
    <DrillSheet
      open
      onOpenChange={(open) => { if (!open) { onClose() } }}
      eyebrow={content.eyebrow}
      title={content.title}
      action={
        canJump && jumpTo != null ? (
          <DrillSheetAction
            module={jumpTo}
            className="text-accent-foreground"
            onClick={() => { onClose(); nav.openModule(jumpTo) }}
          />
        ) : undefined
      }
    >
      {content.body}
    </DrillSheet>
  )
}
