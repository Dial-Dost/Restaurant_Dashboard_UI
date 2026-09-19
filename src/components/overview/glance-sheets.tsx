"use client"

// THE GLANCE DRILL-DOWN SHEETS — client item 10's other half. Every element of
// the "Today at a glance" box opens one of these, built ONLY from the payload
// the box already holds (no extra read, so it works on a cached one), footed
// by up to two "View in <Module>" jumps resolved through the nav registry and
// pinned to the server's day. Content and copy mirror Flutter's
// `_glanceFigureSheet` / `_glanceDaySheet` / `_glanceCashSheet` /
// `_headlineMethodSheet` / `_glanceByMethodSheet` / `_glanceSplitSheet` /
// `_glanceCountSheet` and the NC sheet in modules.dart, word for word.

import * as React from "react"

import { DrillSheet, DrillSheetAction } from "@/components/ui/drill-sheet"
import { DetailRow } from "@/components/overview/detail-bits"
import { useModuleNav } from "@/components/overview/use-module-nav"
import type { GlanceHeadline, GlanceModeRow } from "@/lib/api/overview"
import {
  fmtGlanceDay,
  GLANCE_BILL_LIST_NOTE,
  GLANCE_BY_METHOD_TITLE,
  GLANCE_DAY_TITLE,
  GLANCE_DRAWER_NOTE,
  GLANCE_GROSS_ADDS_UP,
  GLANCE_LADDER,
  GLANCE_NO_CASH,
  GLANCE_NO_DESTINATION,
  GLANCE_ONLINE_NONE,
  GLANCE_ONLINE_RULE,
  GLANCE_SETTLED_CLOCK,
  GLANCE_SPLIT_RULE,
  glanceDaySentence,
  glanceDrillOf,
  glanceMonthSentence,
  resolveGlance,
  resolveGlanceSecondary,
  type GlanceDrill,
} from "@/lib/glance-destinations"
import { reportModeName } from "@/lib/payment-methods"
import { intOf, numOf, zoneOffsetLabel } from "@/components/overview/overview-utils"

/** Which sheet is open. */
export type GlanceSheetSpec =
  | { kind: "figure"; key: "today_net" | "today_gross" | "online_net" | "online_gross" | "month_to_date"; via?: "month" }
  | { kind: "cash" }
  | { kind: "day"; drillKey: "header" | "day" | "zone" }
  | { kind: "count" }
  | { kind: "method"; method: string; drillKey?: "unallocated" }
  | { kind: "byMethodList" }
  | { kind: "split"; drillKey: "split" | "unallocated" }
  | { kind: "nc" }

const NOTE = "text-[11px] leading-[1.3] text-muted-foreground"
const BODY = "text-[13px] leading-snug text-foreground"

const figureOf = (h: GlanceHeadline, key: string): { value?: number | null; label?: string; hint?: string } => {
  const f = h[key]
  return f && typeof f === "object" ? f : {}
}

/** "Today at a glance · Sep 17" — every sheet says which day it is about. */
const glanceEyebrow = (h: GlanceHeadline, label: string): string => {
  const today = h.today ?? ""
  return today.length === 0 ? label : `${label} · ${fmtGlanceDay(today)}`
}

/**
 * A mode's share of today: the server's, else computed; a dash — never 0% —
 * with nothing to divide by.
 */
const shareOf = (h: GlanceHeadline, m: GlanceModeRow): string => {
  if (typeof m.share_pct === "number") { return `${m.share_pct.toFixed(1)}%` }
  const gross = figureOf(h, "today_gross").value
  const rows = Array.isArray(h.today_by_method) ? h.today_by_method : []
  const total = typeof gross === "number"
    ? gross
    : rows.reduce((a, r) => a + numOf(r.amount), 0)
  if (!(total > 0)) { return "–" }
  return `${(numOf(m.amount) / total * 100).toFixed(1)}%`
}

const modesOf = (h: GlanceHeadline): GlanceModeRow[] =>
  (Array.isArray(h.today_by_method) ? h.today_by_method : [])
    .filter((m) => m.method.trim().length > 0)

interface SheetContent {
  eyebrow: string
  title: string
  drill: GlanceDrill | null
  body: React.ReactNode
}

export function GlanceSheet({
  headline,
  sheet,
  onClose,
  money,
}: {
  headline: GlanceHeadline
  sheet: GlanceSheetSpec | null
  onClose: () => void
  money: (v: unknown) => string
}): React.JSX.Element | null {
  const nav = useModuleNav()
  if (!sheet) { return null }

  const h = headline
  const section = h.by_method ?? {}
  const sectionLabel = (section.label ?? "").trim()
  const sectionHint = (section.hint ?? "").trim()
  const splitBills = intOf(h.today_split_bills) ?? 0
  const today = h.today ?? ""

  /** One mode's drill-down (`_headlineMethodSheet`). */
  const methodContent = (m: GlanceModeRow, drill: GlanceDrill | null, extra?: React.ReactNode): SheetContent => {
    const method = m.method.trim()
    const refund = numOf(m.refund)
    const canOpen = nav.canOpen
    const toBills =
      drill != null &&
      (resolveGlance(drill, canOpen)?.module === "Accounting" ||
        resolveGlanceSecondary(drill, canOpen)?.module === "Accounting")
    return {
      eyebrow: today.length === 0 ? sectionLabel : `${sectionLabel} · ${fmtGlanceDay(today)}`,
      title: `${reportModeName({ method, label: m.label })} · ${money(m.amount)}`,
      drill,
      body: (
        <div>
          <DetailRow label="Collected" value={money(m.amount)} trailing={`${intOf(m.bills) ?? 0} bill(s)`} />
          <DetailRow label="Share of today's gross" value={shareOf(h, m)} />
          <DetailRow label="Refunds" value={refund > 0 ? `− ${money(refund)}` : money(0)} />
          <DetailRow label="After refunds" value={money(m.net_amount)} />
          {method === "Unallocated" && (
            <p className="mt-2 text-[13px] leading-snug text-warning">
              Money whose split-payment parts do not add up to the bill total. Short on one bill and over on
              another can net to {money(0)}, so every bill counted here needs looking at, whatever the amount.
            </p>
          )}
          {splitBills > 0 && (
            <p className={`mt-2 ${NOTE}`}>
              {splitBills} bill(s) today were paid across more than one method; each part counts under its own method.
            </p>
          )}
          {sectionHint.length > 0 && <p className={`mt-2 ${NOTE}`}>{sectionHint}</p>}
          {extra != null && <div className="mt-2">{extra}</div>}
          {toBills && <p className={`mt-2 ${NOTE}`}>{GLANCE_BILL_LIST_NOTE}</p>}
        </div>
      ),
    }
  }

  const content = ((): SheetContent => {
    switch (sheet.kind) {
      case "figure": {
        const f = figureOf(h, sheet.key)
        const label = (f.label ?? "").trim()
        const hint = (f.hint ?? "").trim()
        const drill = glanceDrillOf(h, sheet.via ?? sheet.key)
        const value = money(f.value)
        if (sheet.key === "today_net" || sheet.key === "today_gross") {
          const ladder = (h.today_ladder && typeof h.today_ladder === "object") ? h.today_ladder : null
          return {
            eyebrow: glanceEyebrow(h, "Today at a glance"),
            title: `${label} · ${value}`,
            drill,
            body: (
              <div>
                <DetailRow label="Bills settled today" value={`${intOf(h.today_bills) ?? 0}`} />
                {/* The steps between Net and Gross, rung by rung, when the
                    server sent them. An older backend sends none, and a missing
                    ladder is not a ladder of zeros — so it is left out. */}
                {ladder != null && (
                  <div className="mt-2">
                    {GLANCE_LADDER.map(([rung, name]) => (
                      <DetailRow
                        key={rung}
                        label={name}
                        value={
                          (rung === "discount" || rung === "refund") && numOf(ladder[rung]) > 0
                            ? `− ${money(ladder[rung])}`
                            : money(ladder[rung])
                        }
                        trailing={
                          (rung === "net" && sheet.key === "today_net") ||
                          (rung === "grand_total" && sheet.key === "today_gross")
                            ? "this figure"
                            : undefined
                        }
                      />
                    ))}
                  </div>
                )}
                {hint.length > 0 && <p className={`mt-2 ${NOTE}`}>{hint}</p>}
                {sheet.key === "today_gross" && <p className={`mt-2 ${NOTE}`}>{GLANCE_GROSS_ADDS_UP}</p>}
              </div>
            ),
          }
        }
        if (sheet.key === "online_net" || sheet.key === "online_gross") {
          const bills = intOf(h.today_online_bills)
          const zero = numOf(figureOf(h, "online_gross").value) === 0 && (bills ?? 0) === 0
          return {
            eyebrow: glanceEyebrow(h, "Today at a glance"),
            title: `${label} · ${value}`,
            drill,
            body: (
              <div>
                {bills != null && <DetailRow label="Online bills today" value={`${bills}`} />}
                {(["online_net", "online_gross"] as const).map((k) => {
                  const fig = figureOf(h, k)
                  return fig.label != null
                    ? <DetailRow key={k} label={fig.label} value={money(fig.value)} />
                    : null
                })}
                <p className={`mt-2 ${NOTE}`}>{GLANCE_ONLINE_RULE}</p>
                {/* The owner's most likely reading of ₹0 here is "Zomato is
                    missing". It is not: at the table it is a payment mode. */}
                {zero && <p className={`mt-2 ${BODY}`}>{GLANCE_ONLINE_NONE}</p>}
                {hint.length > 0 && <p className={`mt-2 ${NOTE}`}>{hint}</p>}
              </div>
            ),
          }
        }
        // month_to_date
        const from = h.month_from ?? ""
        return {
          eyebrow: glanceEyebrow(h, "Today at a glance"),
          title: `${label} · ${value}`,
          drill,
          body: (
            <div>
              {intOf(h.month_bills) != null && (
                <DetailRow label="Bills settled this month" value={`${intOf(h.month_bills)}`} />
              )}
              {from.length > 0 && today.length > 0 && (
                <p className={`mt-2 ${BODY}`}>{glanceMonthSentence(fmtGlanceDay(from), fmtGlanceDay(today))}</p>
              )}
              <p className={`mt-2 ${NOTE}`}>{GLANCE_SETTLED_CLOCK}</p>
              {hint.length > 0 && <p className={`mt-2 ${NOTE}`}>{hint}</p>}
            </div>
          ),
        }
      }

      case "cash": {
        // The Cash row's own sheet when there is one (they are one number —
        // the server reads the tile off the row), a plain "no cash" sheet
        // when there is not. Its jumps are the tile's.
        const f = figureOf(h, "cash_collection")
        const hint = (f.hint ?? "").trim()
        const drill = glanceDrillOf(h, "cash_collection")
        const cash = modesOf(h).find((m) => m.method.trim().toLowerCase() === "cash")
        if (cash) {
          return methodContent(cash, drill, (
            <div>
              {hint.length > 0 && <p className={NOTE}>{hint}</p>}
              <p className={`mt-2 ${NOTE}`}>{GLANCE_DRAWER_NOTE}</p>
            </div>
          ))
        }
        return {
          eyebrow: glanceEyebrow(h, "Today at a glance"),
          title: `${(f.label ?? "").trim()} · ${money(f.value)}`,
          drill,
          body: (
            <div>
              <p className={BODY}>{GLANCE_NO_CASH}</p>
              {hint.length > 0 && <p className={`mt-2 ${NOTE}`}>{hint}</p>}
              <p className={`mt-2 ${NOTE}`}>{GLANCE_DRAWER_NOTE}</p>
            </div>
          ),
        }
      }

      case "day": {
        // "How today is cut": the day, the zone, the clock a bill counts on.
        // The zone chip's jump is Settings (admin only) and, for anyone who
        // cannot open it, the day's report.
        const zone = (h.timezone ?? "").trim()
        const offset = zone.length === 0 ? "" : zoneOffsetLabel(zone)
        const zoneCaption = zone.length === 0 ? "" : (offset.length === 0 ? zone : `${zone} (${offset})`)
        let drill = glanceDrillOf(h, sheet.drillKey)
        if (sheet.drillKey === "zone" && resolveGlance(drill, nav.canOpen) == null) {
          drill = glanceDrillOf(h, "day")
        }
        const bills = intOf(h.today_bills)
        const monthFrom = h.month_from ?? ""
        return {
          eyebrow: "Today at a glance",
          title: GLANCE_DAY_TITLE,
          drill,
          body: (
            <div>
              {today.length > 0 && (
                <p className={`mb-2 ${BODY}`}>{glanceDaySentence(fmtGlanceDay(today), zoneCaption)}</p>
              )}
              {today.length > 0 && <DetailRow label="Today" value={fmtGlanceDay(today)} />}
              {zoneCaption.length > 0 && <DetailRow label="Time zone" value={zoneCaption} />}
              {monthFrom.length > 0 && <DetailRow label="Month from" value={fmtGlanceDay(monthFrom)} />}
              {bills != null && <DetailRow label="Bills settled today" value={`${bills}`} />}
              <p className={`mt-2 ${NOTE}`}>{GLANCE_SETTLED_CLOCK}</p>
            </div>
          ),
        }
      }

      case "count":
        // Only for a user who can open none of the places the count leads, so
        // the tag is never a dead tap.
        return {
          eyebrow: glanceEyebrow(h, "Today at a glance"),
          title: `${intOf(h.today_bills) ?? 0} bill(s) settled`,
          drill: glanceDrillOf(h, "bills"),
          body: (
            <div>
              <p className={NOTE}>{GLANCE_SETTLED_CLOCK}</p>
              <p className={`mt-2 ${NOTE}`}>{GLANCE_NO_DESTINATION}</p>
            </div>
          ),
        }

      case "method": {
        const m = modesOf(h).find((r) => r.method.trim() === sheet.method)
        const drill = sheet.drillKey === "unallocated"
          ? glanceDrillOf(h, "unallocated")
          : glanceDrillOf(h, "by_method_row", sheet.method)
        if (!m) { return { eyebrow: glanceEyebrow(h, "Today at a glance"), title: sheet.method, drill, body: null } }
        return methodContent(m, drill)
      }

      case "byMethodList":
        // The by-method label's sheet, for a user who cannot open the report.
        return {
          eyebrow: glanceEyebrow(h, sectionLabel),
          title: GLANCE_BY_METHOD_TITLE,
          drill: glanceDrillOf(h, "by_method"),
          body: (
            <div>
              {modesOf(h).map((m) => (
                <DetailRow
                  key={m.method}
                  label={reportModeName({ method: m.method.trim(), label: m.label })}
                  value={money(m.amount)}
                  trailing={`${intOf(m.bills) ?? 0} bill(s)`}
                />
              ))}
              {sectionHint.length > 0 && <p className={`mt-2 ${NOTE}`}>{sectionHint}</p>}
            </div>
          ),
        }

      case "split":
        // What a bill paid in parts does to the rows, and a jump to those bills.
        return {
          eyebrow: glanceEyebrow(h, "Today at a glance"),
          title: `${splitBills} bill(s) paid across more than one method`,
          drill: glanceDrillOf(h, sheet.drillKey),
          body: (
            <div>
              <p className={BODY}>{GLANCE_SPLIT_RULE}</p>
              <p className={`mt-2 ${NOTE}`}>{GLANCE_BILL_LIST_NOTE}</p>
            </div>
          ),
        }

      case "nc": {
        const nc = (h.today_nc && typeof h.today_nc === "object") ? h.today_nc : {}
        const hint = (nc.hint ?? "").trim()
        return {
          eyebrow: glanceEyebrow(h, "Today at a glance"),
          title: (nc.label ?? "").trim(),
          drill: glanceDrillOf(h, "nc"),
          body: (
            <div>
              <DetailRow label="NC bills" value={`${intOf(nc.bills) ?? 0}`} />
              <DetailRow label="Given away" value={money(nc.value)} />
              {hint.length > 0 && <p className={`mt-2 ${NOTE}`}>{hint}</p>}
            </div>
          ),
        }
      }
    }
  })()

  // The jump and secondary jump, resolved for this user and primed on the way
  // out. Hidden outright when unreachable, never disabled.
  const jump = resolveGlance(content.drill, nav.canOpen)
  const second = resolveGlanceSecondary(content.drill, nav.canOpen)

  return (
    <DrillSheet
      open
      onOpenChange={(open) => { if (!open) { onClose() } }}
      eyebrow={content.eyebrow}
      title={content.title}
      action={
        (jump != null || second != null) ? (
          <span className="flex items-center gap-1.5">
            {second != null && (
              <DrillSheetAction
                module={second.module}
                className="text-muted-foreground"
                onClick={() => { onClose(); nav.goTarget(second) }}
              />
            )}
            {jump != null && (
              <DrillSheetAction
                module={jump.module}
                className="text-accent-foreground"
                onClick={() => { onClose(); nav.goTarget(jump) }}
              />
            )}
          </span>
        ) : undefined
      }
    >
      {content.body}
    </DrillSheet>
  )
}
