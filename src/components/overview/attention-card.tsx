"use client"

// One server-composed "needs attention" row — the web copy of Flutter's
// `_attentionCard` + `_attentionFocus` (modules.dart): how many, what it is,
// WHO the offenders are, and where to act on them.

import * as React from "react"
import { ChevronRight } from "lucide-react"

import { ForkCard } from "@/components/ui/fork-card"
import { StatusChip } from "@/components/ui/status-chip"
import { scoreOf } from "@/components/overview/overview-utils"
import type { ModuleNav } from "@/components/overview/use-module-nav"
import { moduleByLabel } from "@/lib/nav-registry"
import type { AttentionRow } from "@/lib/db"

/**
 * Focus keys each destination module actually READS — mirrors the `idOf(...)` /
 * `tableName` reads in the module pages. A module not listed here (Inventory,
 * Menu) reads no focus at all.
 *
 * 'Tables' deliberately omits `entity_id`: the two signals that land there send
 * an ORDER id (payments awaiting approval) or a Bills id (open bills), and
 * Tables resolves ids against TABLE NAMES. Only the `table` label it ships
 * alongside is meaningful there.
 */
const ATTENTION_FOCUS_KEYS: Readonly<Record<string, readonly string[]>> = {
  Orders: ["entity_id", "order_id", "table"],
  Tables: ["table", "table_name"],
  Bookings: ["entity_id", "booking_id"],
  Feedback: ["entity_id", "feedback_id"],
  Waitlist: ["entity_id", "waitlist_id"],
}

/**
 * The part of a deep link's `params` [dest] can actually resolve — null when
 * nothing survives, so the row navigates with no focus request at all.
 *
 * This filter is the whole point: a destination paints its focus banner on the
 * presence of a request alone, so forwarding a key nothing reads — `filter`,
 * `status`, `q` — lands the user on the right screen and then tells them their
 * record "isn't in this list". A silent, correct tap beats a tap that
 * navigates AND lies.
 */
export function attentionFocus(
  dest: string | null,
  signalKey: string,
  params: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const keys = dest == null ? undefined : ATTENTION_FOCUS_KEYS[dest]
  if (!keys || !params || typeof params !== "object") { return null }
  const out: Record<string, unknown> = {}
  for (const k of keys) {
    // `pending_discounts` routes to Orders but its entity_id is a
    // DiscountRequests id, which Orders compares against ORDER ids — a
    // real-looking id of the wrong entity type that can never match. The
    // approvals panel it means to point at is pinned above the grid anyway,
    // so the plain module is the honest destination.
    if (k === "entity_id" && signalKey === "pending_discounts") { continue }
    const v = params[k]
    const s = `${typeof v === "string" || typeof v === "number" ? v : ""}`.trim()
    if (s === "" || s === "null") { continue }
    out[k] = v
  }
  return Object.keys(out).length === 0 ? null : out
}

const SEVERITY_STATUS: Record<AttentionRow["severity"], "danger" | "warning" | "neutral"> = {
  high: "danger",
  medium: "warning",
  low: "neutral",
}

/**
 * The row's destination and navigation for this user, or null when unroutable
 * (the card then renders genuinely inert — no chevron, no hover).
 *
 * `deep_link` is the routing the server verified against both clients;
 * `module` is the legacy field older builds shipped and can name a screen this
 * app has no module for ('Bills'), so it is only ever the fallback. The
 * server's `href` is the only route the backend has confirmed the destination
 * page actually parses, so it wins whenever it belongs to the module chosen.
 */
function attentionTap(row: AttentionRow, nav: ModuleNav): (() => void) | null {
  const deep = (row.deep_link.module || "").trim()
  const legacy = (row.module || "").trim()
  // canOpen('') is false, so a missing label needs no separate guard.
  const dest = nav.canOpen(deep) ? deep : (nav.canOpen(legacy) ? legacy : null)
  if (dest == null) { return null }
  const served = (row.deep_link.href ?? "").trim()
  const href = dest === deep && served !== "" ? served : moduleByLabel(dest)?.href
  if (href == null) { return null }
  const focus = attentionFocus(dest, row.key, row.deep_link.params)
  return () => { nav.openHref(href, focus) }
}

export function AttentionCard({
  row,
  nav,
  money,
}: {
  row: AttentionRow
  nav: ModuleNav
  money: (v: unknown) => string
}): React.JSX.Element {
  const count = Math.round(Number.isFinite(row.count) ? row.count : 0)
  const tap = attentionTap(row, nav)

  // The server sends both `detail` (a humanised one-liner) and `items` (the
  // same offenders, structured) — rendering both prints the same names twice,
  // so the structured rows win and `detail` covers rows the server could not
  // itemise. `sub` already embeds the humanised number ("20 kg left"), and a
  // bare `value` is money OR quantity with nothing to tell them apart, so it
  // is only shown as a plain number when `sub` is missing.
  const items = Array.isArray(row.items) ? row.items : []
  const shown = items.slice(0, 4)
  const more = count - shown.length
  const detail = (row.detail || "").trim()

  return (
    <ForkCard
      inset
      onClick={tap ?? undefined}
      chevron={false}
      className="px-3.5 py-3"
    >
      <div className="flex items-center gap-2">
        <StatusChip status={SEVERITY_STATUS[row.severity]} label={`${count}`} dense />
        <span className="min-w-0 flex-1 line-clamp-2 text-[13px] font-semibold text-foreground">
          {row.label}
        </span>
        {row.amount != null && (
          <span className="shrink-0 text-[13px] font-semibold text-accent-foreground tabular-nums">
            {money(row.amount)}
          </span>
        )}
        {tap != null && <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </div>
      {shown.length > 0 ? (
        <div className="mt-2">
          {shown.map((it, i) => {
            const sub = (it.sub ?? "").trim()
            const trailing = sub !== "" ? sub : (it.value == null ? "" : scoreOf(it.value))
            return (
              <div key={it.id ?? `${it.label}-${i}`} className="flex items-center gap-2 py-0.5">
                <span className="min-w-0 flex-1 truncate text-xs text-foreground">{it.label}</span>
                {trailing !== "" && (
                  <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{trailing}</span>
                )}
              </div>
            )
          })}
          {more > 0 && <p className="pt-0.5 text-[10.5px] text-tertiary">and {more} more</p>}
        </div>
      ) : (
        detail !== "" && (
          <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{detail}</p>
        )
      )}
    </ForkCard>
  )
}
