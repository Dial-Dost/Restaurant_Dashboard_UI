"use client"

// Browse and re-open SETTLED bills — the web `_ClosedBillsList` /
// `_ClosedBillSheet` (restaurant_owner_app/lib/screens/modules.dart
// 23349–24062), mounted by Accounting and History and embedded in History's
// month sheet.
//
// The money split it renders comes straight from the backend, which guarantees
//   taxable_base + service_charge + tax_total + round_off === grand_total
// and lifts a "Service Charge" entry out of the tax breakdown so it is never
// shown twice. Nothing is recomputed here — the identity is DISPLAYED rather
// than trusted (the check line under the grand total), so a bill that ever
// stopped balancing is visible instead of silent.

import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { ForkCard } from "@/components/ui/fork-card"
import { DrillSheet } from "@/components/ui/drill-sheet"
import { SectionHeader } from "@/components/ui/section-header"
import { EmptyState } from "@/components/ui/empty-state"
import { LoadErrorState } from "@/components/ui/load-error-state"
import { SkeletonBox, SkeletonRows } from "@/components/ui/fork-skeleton"
import { CacheStalePill } from "@/components/ui/stale-pill"
import { InfoChip, StatusChip } from "@/components/ui/status-chip"
import { AppSearchField } from "@/components/ui/app-search-field"
import {
  AlertCircle,
  BarChart2,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  CreditCard,
  Building2,
  Image as ImageIcon,
  Printer,
  Receipt,
  Undo2,
  UserRound,
  Users,
} from "lucide-react"
import { useCurrency } from "@/hooks/use-currency"
import { useAuth } from "@/context/AuthContext"
import { usePaymentMethods } from "@/hooks/use-payment-methods"
import { closedBillMethodFilterOptions, paymentMethodLabel } from "@/lib/payment-methods"
import { canEditSettledBillCustomer } from "@/lib/bill-customer"
import { formatRoundOff, roundOffOf } from "@/lib/bill-round-off"
import { reprintSettledBill } from "@/lib/db"
import { useCachedFetch } from "@/hooks/use-cached-fetch"
import {
  fetchClosedBillDetail,
  fetchClosedBillsPage,
  type HistoryBillDetail,
  type HistoryBillSummary,
} from "@/lib/api/history"
import {
  billBalanceIdentity,
  billCustomerChip,
  billTitle,
  billWhen,
  methodLabelWithNc,
  ncLineLabel,
  ncSettlementOf,
  settledBillCustomerLines,
} from "@/components/history/settled-bill-lib"
import {
  EditSettledBillCustomerButton,
  type SettledBillCustomerSaved,
} from "@/components/history/bill-customer-details-dialog"
import { MoveBillTillButton } from "@/components/history/move-bill-till-dialog"
import { DateRangePicker, RangeNote } from "@/components/date-range-picker"
import { rangeLabel, type DateRange } from "@/lib/date-range"
import { formatDateTime } from "@/lib/tz"
import { useTimezone } from "@/lib/use-timezone"
import { elapsedToSettlement, formatDuration, readServiceClock } from "@/lib/service-clock"

// Settlement instants are accounting evidence — they render in the restaurant's
// zone, never the viewer's, so a closed bill reads the same as the till printed.
const dateTime = (v: string | null | undefined, timeZone: string): string => formatDateTime(v, timeZone)

/** Which of the two write surfaces this list serves — History gets everything
 *  but the Accounting-only till move (client item 8); the two also word their
 *  search hint and empty captions differently. */
export type ClosedBillSurface = "accounting" | "history"

/* ────────────────────────────────────────────────────────────────────────
   The paged list — `_ClosedBillsList`. Owns its own paging (limit/offset)
   so every call site gets "Load more" without repeating the plumbing.
   ──────────────────────────────────────────────────────────────────────── */

export interface ClosedBillsFilter {
  from?: string
  to?: string
  search?: string
  payment_method?: string
}

export function ClosedBillsList({
  rid,
  filter,
  pageSize = 15,
  emptyCaption,
  surface = "history",
}: {
  rid: string
  filter: ClosedBillsFilter
  /** Accounting also gets the till move (client item 8); History does not. */
  surface?: ClosedBillSurface
  /** 15 on the pages, 10 inside History's month sheet. */
  pageSize?: number
  /** Window-specific: "No bills were closed in 1–15 Aug." */
  emptyCaption: string
}): ReactElement {
  const { user } = useAuth()
  /*
    R2 ITEM 1 — the same permission the Reprint button's route (E5, POST
    /print/bill/settled) is gated on, which is also the customer-details
    route's gate. Hidden, not greyed, for everyone else: the route would
    refuse them.
  */
  const canEditCustomer = canEditSettledBillCustomer(user)
  const { currencySymbol } = useCurrency()
  const { timezone } = useTimezone()
  const { methods: paymentMethods } = usePaymentMethods(rid)
  const money = useCallback((n: number | null | undefined) =>
    `${currencySymbol}${(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  [currencySymbol])

  const filterKey = JSON.stringify([filter.from ?? "", filter.to ?? "", filter.search ?? "", filter.payment_method ?? ""])
  // Cache-primed first page: instant paint from the saved copy, silent refresh,
  // and a failed refresh keeps the rows on screen under the stale pill
  // (finding 28) instead of blanking them into the failed state.
  const first = useCachedFetch(
    `closed-bills:${rid}:${pageSize}:${filterKey}`,
    useCallback(() => fetchClosedBillsPage(rid, {
      from: filter.from,
      to: filter.to,
      search: filter.search,
      payment_method: filter.payment_method,
      limit: pageSize,
      offset: 0,
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [rid, pageSize, filterKey]),
    { enabled: rid !== "" },
  )

  // Pages 2+ are appended locally and reset whenever the first page's identity
  // changes (a new filter or window starts the list over).
  const [extra, setExtra] = useState<HistoryBillSummary[]>([])
  const [extraMeta, setExtraMeta] = useState<{ total: number; hasMore: boolean } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  useEffect(() => { setExtra([]); setExtraMeta(null) }, [rid, pageSize, filterKey])

  // Server-truth patches from the per-row customer edit, so a correction is
  // visible on the row it was made from without a full reload (finding 32).
  const [patches, setPatches] = useState<Record<string, SettledBillCustomerSaved>>({})
  const patchRow = useCallback((id: string, saved: SettledBillCustomerSaved) => {
    setPatches((prev) => ({ ...prev, [id]: { ...prev[id], ...saved } }))
  }, [])

  const rows = useMemo(() => {
    const base = first.data?.bills ?? []
    const seen = new Set(base.map((b) => b.id))
    // Ordering is (settled_at desc, id desc) — a total order — but de-dupe by
    // id anyway so a bill settled mid-scroll can never appear twice.
    const all = [...base, ...extra.filter((b) => !seen.has(b.id))]
    return all.map((b) => (b.id in patches ? { ...b, ...patches[b.id] } : b))
  }, [first.data, extra, patches])

  const total = extraMeta?.total ?? first.data?.total ?? 0
  const hasMore = extra.length > 0 ? (extraMeta?.hasMore ?? false) : (first.data?.has_more ?? false)

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) { return }
    setLoadingMore(true)
    try {
      const page = await fetchClosedBillsPage(rid, {
        from: filter.from,
        to: filter.to,
        search: filter.search,
        payment_method: filter.payment_method,
        limit: pageSize,
        offset: rows.length,
      })
      const seen = new Set(rows.map((b) => b.id))
      const fresh = page.bills.filter((b) => !seen.has(b.id))
      // Nothing new means the offset can never advance — stop instead of looping.
      setExtraMeta({ total: page.total, hasMore: fresh.length === 0 ? false : page.has_more })
      if (fresh.length > 0) { setExtra((prev) => [...prev, ...fresh]) }
    } catch {
      // Rows already on screen stay; the button remains for another try.
    } finally {
      setLoadingMore(false)
    }
  }, [rid, filter.from, filter.to, filter.search, filter.payment_method, pageSize, rows, hasMore, loadingMore])

  /** The bill sheet currently open (the row's title carries it while it loads). */
  const [openBill, setOpenBill] = useState<{ id: string; title: string } | null>(null)

  if (first.loading) {
    // Three quiet card placeholders — never a bare "Loading…" line (finding 52).
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => <SkeletonBox key={i} height={60} className="rounded-lg" />)}
      </div>
    )
  }
  if (first.error != null) {
    return (
      <LoadErrorState
        whatFailed="Couldn't load settled bills"
        error={first.error}
        onRetry={first.retry}
      />
    )
  }

  return (
    <div className="relative">
      {rows.length === 0 ? (
        <EmptyState icon={<Receipt />} title="No settled bills" caption={emptyCaption} />
      ) : (
        <div className="space-y-2">
          {rows.map((b) => (
            <BillRow
              key={b.id}
              bill={b}
              money={money}
              timezone={timezone}
              methodLabel={(m) => methodLabelWithNc(m, paymentMethodLabel(m, paymentMethods))}
              onOpen={() => { setOpenBill({ id: b.id, title: billTitle(b) }) }}
              edit={canEditCustomer ? (
                <EditSettledBillCustomerButton
                  restaurantId={rid}
                  bill={b}
                  compact
                  onSaved={(saved) => { patchRow(b.id, saved) }}
                />
              ) : null}
            />
          ))}
          {hasMore ? (
            <div className="flex justify-center pt-1">
              <Button variant="ghost" size="sm" disabled={loadingMore} onClick={() => { void loadMore() }}>
                <ChevronDown className="mr-1.5 h-4 w-4" />
                {loadingMore ? "Loading…" : `Load more (${rows.length} of ${total})`}
              </Button>
            </div>
          ) : total > 0 ? (
            <p className="pt-1 text-center text-xs text-muted-foreground">All {total} shown</p>
          ) : null}
        </div>
      )}
      <CacheStalePill offline={first.offline} fromCache={first.fromCache} updatedAt={first.updatedAt} />

      <SettledBillSheet
        rid={rid}
        open={openBill}
        onClose={() => { setOpenBill(null) }}
        onCustomerSaved={(id, saved) => { patchRow(id, saved) }}
        allowTillMove={surface === "accounting"}
      />
    </div>
  )
}

/* ── One row — `_closedBillRow`: its own hoverable card control ─────────── */

function BillRow({
  bill,
  money,
  timezone,
  methodLabel,
  onOpen,
  edit,
}: {
  bill: HistoryBillSummary
  money: (n: number | null | undefined) => string
  timezone: string
  methodLabel: (method: string) => string
  onOpen: () => void
  edit: ReactNode
}): ReactElement {
  const method = (bill.payment_method ?? "").trim()
  const when = billWhen(bill)
  const covers = bill.covers
  const customer = billCustomerChip(bill)
  const gstin = (bill.customer_gstin ?? "").trim()
  return (
    <ForkCard onClick={onOpen} chevron={false} className="px-4 py-3">
      <div className="flex items-center gap-3">
        <div
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-border bg-inset text-accent-foreground gaia:rounded-[2px]"
        >
          <Receipt className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{billTitle(bill)}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {when !== "" && <InfoChip icon={<Clock />} label={dateTime(when, timezone)} />}
            {covers != null && covers > 0 && <InfoChip icon={<Users />} label={`${covers} covers`} />}
            {method !== "" && method !== "—" && <InfoChip icon={<CreditCard />} label={methodLabel(method)} />}
            {bill.refunded && <InfoChip icon={<Undo2 />} label="Refunded" />}
            {/* ROUND 2 ITEM 1 — who the bill was for, so a correction is
                visible on the row it was made from. */}
            {customer !== "" && <InfoChip icon={<UserRound />} label={customer} />}
            {gstin !== "" && <InfoChip icon={<Building2 />} label={`GSTIN ${gstin}`} />}
          </div>
        </div>
        {edit}
        <span className="shrink-0 text-sm font-semibold tabular-nums">{money(bill.grand_total)}</span>
        <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-tertiary" />
      </div>
    </ForkCard>
  )
}

/* ────────────────────────────────────────────────────────────────────────
   The bill sheet — `_ClosedBillSheet` + `_closedBillBody`: bottom sheet
   below 760px, centred dialog above, with Reprint and the customer edit
   under the body for whoever holds their permission.
   ──────────────────────────────────────────────────────────────────────── */

// The till move ("Move to another till") is Accounting's own control — client
// item 8: a cash-up correction is reconciled in Accounting. This sheet serves
// History too, so the move shows only when the Accounting list mounts it
// (`allowTillMove`), behind the route's own Record Payment gate.
function SettledBillSheet({
  rid,
  open,
  onClose,
  onCustomerSaved,
  allowTillMove = false,
}: {
  rid: string
  open: { id: string; title: string } | null
  onClose: () => void
  onCustomerSaved: (billId: string, saved: SettledBillCustomerSaved) => void
  allowTillMove?: boolean
}): ReactElement {
  const { toast } = useToast()
  const { user } = useAuth()
  const { currencySymbol } = useCurrency()
  const { timezone } = useTimezone()
  const { methods: paymentMethods } = usePaymentMethods(rid)
  const canWrite = canEditSettledBillCustomer(user)
  const money = useCallback((n: number | null | undefined) =>
    `${currencySymbol}${(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  [currencySymbol])

  const id = open?.id ?? ""
  const detail = useCachedFetch(
    `closed-bill:${rid}:${id}`,
    useCallback(() => fetchClosedBillDetail(rid, id), [rid, id]),
    { enabled: id !== "" },
  )
  // The sheet repaints from the server's ANSWER at once; the silent re-read
  // below is the truth that replaces it.
  const [savedPatch, setSavedPatch] = useState<SettledBillCustomerSaved | null>(null)
  useEffect(() => { setSavedPatch(null) }, [id])
  const bill = useMemo(
    () => (detail.data === null ? null : savedPatch === null ? detail.data : { ...detail.data, ...savedPatch }),
    [detail.data, savedPatch],
  )

  const [reprinting, setReprinting] = useState(false)

  // While a DIFFERENT bill loads, the hook still holds the previous one — the
  // header must not wear the old bill's number or status for a beat.
  const shown = detail.loading ? null : bill
  const refunded = shown?.refunded === true
  const method = (shown?.payment_method ?? "").trim()
  const methodShown = methodLabelWithNc(method, paymentMethodLabel(method, paymentMethods))
  const title = shown !== null && (shown.bill_no ?? "").trim() !== "" ? billTitle(shown) : (open?.title ?? "Bill")

  return (
    <DrillSheet
      open={open !== null}
      onOpenChange={(o) => { if (!o) { onClose() } }}
      eyebrow="Settled bill"
      title={(
        <span className="inline-flex max-w-full items-center gap-2">
          <span className="min-w-0 truncate">{title}</span>
          {shown !== null && (refunded ? (
            <StatusChip status="danger" dense label={`Refunded ${money(shown.refund_amount)}`} />
          ) : (
            <StatusChip status="success" dense label={method === "" ? "Closed" : methodShown} />
          ))}
        </span>
      )}
    >
      {detail.loading ? (
        <SkeletonRows rows={3} title={false} />
      ) : detail.error != null || bill === null ? (
        <LoadErrorState whatFailed="Couldn't load this bill." error={detail.error ?? new Error("Couldn't load this bill.")} onRetry={detail.retry} />
      ) : (
        <div className="space-y-4">
          <BillDetailBody bill={bill} money={money} timezone={timezone} methodShown={methodShown} />

          {allowTillMove && (
            <MoveBillTillButton
              restaurantId={rid}
              billId={bill.id}
              billLabel={title}
              currentCounterId={(bill as { counter_id?: string | null }).counter_id ?? null}
              onMoved={() => { detail.refresh() }}
            />
          )}

          {canWrite && (
            <div className="space-y-3 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={reprinting}
                  onClick={() => {
                    setReprinting(true)
                    void reprintSettledBill(rid, bill.id)
                      .then((r) => {
                        // The server does the work, including saying "REPRINT";
                        // failures are ITS sentence, verbatim.
                        toast(r.ok
                          ? { title: r.destination ? `Reprinting at ${r.destination}.` : "Reprint sent to the printer." }
                          : { title: r.message, variant: "destructive" })
                      })
                      .finally(() => { setReprinting(false) })
                  }}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  {reprinting ? "Sending…" : "Reprint bill"}
                </Button>
                {/* ROUND 2 ITEM 1 — beside the reprint, behind the same gate:
                    correct who the bill was for, then reprint it. */}
                <EditSettledBillCustomerButton
                  restaurantId={rid}
                  bill={bill}
                  onSaved={(saved) => {
                    setSavedPatch((prev) => ({ ...prev, ...saved }))
                    onCustomerSaved(bill.id, saved)
                    detail.refresh()
                  }}
                />
              </div>
              {/* SAID BEFORE IT IS PRESSED: the paper carries a REPRINT banner
                  in the largest type the printer has, because a second copy
                  that looks like an original gets paid twice. */}
              <p className="text-xs text-muted-foreground">
                Prints a second copy, marked <span className="font-semibold">REPRINT</span>, with the
                figures exactly as this bill was settled.
              </p>
            </div>
          )}
        </div>
      )}
    </DrillSheet>
  )
}

/* ── The sheet body — `_closedBillBody`, the receipt's words ────────────── */

function RuleLine(): ReactElement {
  return <div aria-hidden className="h-px bg-divider" />
}

function MoneyRow({
  label,
  value,
  sub,
  strong = false,
  tint,
}: {
  label: string
  value: string
  sub?: string | null
  strong?: boolean
  tint?: "success" | "warning" | "danger" | "copper"
}): ReactElement {
  const tintClass =
    tint === "success" ? "text-success" :
    tint === "warning" ? "text-warning" :
    tint === "danger" ? "text-destructive" :
    tint === "copper" ? "text-accent-foreground" : ""
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <div className={strong ? "text-sm font-semibold" : "text-sm"}>{label}</div>
        {sub != null && sub !== "" && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </div>
      <span className={`shrink-0 tabular-nums ${strong ? `text-[19px] font-normal tracking-[-0.02em] ${tintClass === "" ? "text-foreground" : tintClass}` : `text-sm font-medium ${tintClass}`}`}>
        {value}
      </span>
    </div>
  )
}

function DetailCard({ heading, children }: { heading: string; children: ReactNode }): ReactElement {
  return (
    <ForkCard className="p-4">
      <SectionHeader title={heading} className="mb-1.5" />
      {children}
    </ForkCard>
  )
}

/** Token-styled key/value row — the app's `_kv`: letter-spaced micro key,
 *  quiet value. */
export function KvRow({ k, v }: { k: string; v: string }): ReactElement {
  return (
    <div className="flex items-start gap-4 py-1.5">
      <span className="micro-label w-[148px] shrink-0 pt-0.5">{k}</span>
      <span className="min-w-0 text-[13px] font-medium">{v}</span>
    </div>
  )
}

function BillDetailBody({
  bill,
  money,
  timezone,
  methodShown,
}: {
  bill: HistoryBillDetail
  money: (n: number | null | undefined) => string
  timezone: string
  methodShown: string
}): ReactElement {
  const d = bill
  const items = d.items
  // `taxes[]` carries the per-rate lines ONLY — the service charge has its own
  // field and its own row below, never a line in here.
  const taxes = d.taxes
  // The wire rows can carry a per-part reference the shared type leaves out.
  const splits = d.payment_splits as { method?: string; payment_method?: string; amount?: number; value?: number; reference?: string }[]
  const orders = d.orders

  const subtotal = d.items_subtotal
  const discount = d.discount_amount
  const service = d.service_charge
  const taxTotal = d.tax_total
  const servicePct = d.service_charge_percent
  const coupon = (d.coupon_code ?? "").trim()
  const method = (d.payment_method ?? "").trim()
  const ncSettled = ncSettlementOf(d)
  const ncTotal = d.nc_total ?? 0
  // What rounded the settled total to the rupee (backend migration 048), as
  // recorded at settle. Null on a bill that needed none.
  const roundOff = roundOffOf(d)
  // The contract's invariant, shown rather than trusted — with the round-off as
  // its fourth rung, or every rounded bill would read as not adding up.
  const identity = billBalanceIdentity(d, roundOff)

  // The customer slot, worded as the printed paper words it — Name:, the
  // GSTIN line, then one Address: line per stored line (finding 38).
  const customerLines = settledBillCustomerLines(d)

  const when = billWhen(d)
  const apc = d.apc ?? 0
  const targetApc = d.target_apc
  // The service duration AS THE SERVER MEASURED IT — a settled bill's clock is
  // a fact about a finished service, so no ticking and no local delta. Absent
  // is not zero: no clock, no chip.
  const closedClock = readServiceClock(d)
  const serviceSpan = closedClock === null ? null : formatDuration(elapsedToSettlement(closedClock).ms)

  // "Handled by" — combined "who · when" rows, omitting anything absent.
  const handled = (label: string, by: string | null | undefined, at: string | null | undefined): { k: string; v: string } | null => {
    const who = (by ?? "").trim()
    const inst = (at ?? "").trim()
    if (who === "" && inst === "") { return null }
    const whenStr = inst === "" ? "" : dateTime(inst, timezone)
    return { k: label, v: who === "" ? whenStr : whenStr === "" ? who : `${who} · ${whenStr}` }
  }
  const at = (label: string, iso: string | null | undefined): { k: string; v: string } | null => {
    const inst = (iso ?? "").trim()
    return inst === "" ? null : { k: label, v: dateTime(inst, timezone) }
  }
  const trail = [
    handled("Opened", d.created_by, d.created_at),
    at("Seated", d.seated_at),
    handled("Waiter confirmed", d.waiter_confirmed_by, d.waiter_confirmed_at),
    handled("Admin approved", d.admin_approved_by, d.admin_approved_at),
    handled("Closed", d.closed_by, d.closed_at),
    at("Settled", d.settled_at),
    at("Discount applied", d.discount_applied_at),
    at("Table released", d.left_at),
    handled("Refunded", d.refunded_by, d.refunded_at),
  ].filter((r): r is { k: string; v: string } => r !== null)

  return (
    <div className="space-y-4">
      {customerLines.length > 0 && (
        <div className="space-y-0.5 text-sm">
          {customerLines.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {when !== "" && <InfoChip icon={<Clock />} label={dateTime(when, timezone)} />}
        {d.covers != null && d.covers > 0 && <InfoChip icon={<Users />} label={`${d.covers} covers`} />}
        {apc > 0 && <InfoChip icon={<BarChart2 />} label={`APC ${money(apc)}`} />}
        {(d.payment_proof_screenshot_url ?? "").trim() !== "" && <InfoChip icon={<ImageIcon />} label="Payment proof attached" />}
        {/* Web-extra facts kept (finding 45): real backend data, chip-quiet. */}
        {targetApc > 0 && <InfoChip icon={<BarChart2 />} label={`Target APC ${money(targetApc)}`} />}
        {serviceSpan !== null && <InfoChip icon={<CalendarClock />} label={`Service time ${serviceSpan}`} />}
      </div>

      {!d.totals_reconciled && (
        <p className="rounded-[10px] border border-warning/28 bg-warning/12 p-2.5 text-xs text-warning">
          The line items below no longer add up to the amount that was charged — the order was edited after the bill was settled.
          The stored total ({money(d.grand_total)}) is what the guest actually paid.
        </p>
      )}

      {items.length > 0 && (
        <DetailCard heading="Items">
          {items.map((it, i) => (
            <div key={`${it.name}-${i}`}>
              {i > 0 && <RuleLine />}
              <MoneyRow
                // A comped line is its own line at 0.00 — the paper's words.
                label={ncLineLabel(it.name, it.nc)}
                value={money(it.line_total)}
                sub={`${it.quantity || 1} × ${money(it.price)}${(it.note ?? "").trim() === "" ? "" : ` · ${(it.note ?? "").trim()}`}`}
              />
            </div>
          ))}
        </DetailCard>
      )}

      <DetailCard heading="Money">
        {subtotal > 0 && <MoneyRow label="Items subtotal" value={money(subtotal)} />}
        {discount > 0 && (
          <MoneyRow
            label="Discount"
            value={`− ${money(discount)}`}
            sub={coupon === "" ? (d.discount_type ?? "Manual") : `Coupon ${coupon} · ${d.discount_type ?? "coupon"}`}
            tint="success"
          />
        )}
        <RuleLine />
        <MoneyRow label="Taxable base" value={money(identity.taxable)} />
        {service !== 0 && (
          <MoneyRow
            label="Service charge"
            value={money(service)}
            sub={servicePct > 0 ? `${servicePct % 1 === 0 ? servicePct.toFixed(0) : servicePct.toFixed(2)}% of the taxable base` : null}
          />
        )}
        {/* Taxes rate by rate. The service charge above is deliberately NOT
            one of them. */}
        {taxes.map((t, i) => (
          <MoneyRow key={`${t.name}-${i}`} label={`${t.name || "Tax"} ${t.percentage}%`} value={money(t.amount)} />
        ))}
        {(taxes.length > 0 || taxTotal !== 0) && <MoneyRow label="Tax total" value={money(taxTotal)} />}
        {roundOff !== null && <MoneyRow label="Round off" value={formatRoundOff(roundOff, (n) => money(n))} />}
        <RuleLine />
        <MoneyRow label="Grand total" value={money(identity.grand)} strong tint="copper" />
        {/* Beside the ladder, never in it: what the comped lines were worth. */}
        {ncTotal > 0 && <MoneyRow label="NC value (not charged)" value={money(ncTotal)} />}
        <div className="mt-1.5 flex items-start gap-1.5">
          {identity.balances
            ? <CheckCircle2 aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
            : <AlertCircle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />}
          <p className={`text-xs ${identity.balances ? "text-tertiary" : "text-destructive"}`}>
            {money(identity.taxable)} base + {money(identity.service)} service + {money(identity.taxTotal)} tax
            {roundOff === null ? "" : ` ${roundOff < 0 ? "−" : "+"} ${money(Math.abs(roundOff))} round off`} = {money(identity.grand)}
          </p>
        </div>
      </DetailCard>

      <DetailCard heading="Payment">
        <MoneyRow label={method === "" ? "Method not recorded" : methodShown} value={money(identity.grand)} />
        {/* A BILL SETTLED AS NC says why it took nothing, and on whose say-so. */}
        {ncSettled !== null && (
          <>
            <RuleLine />
            <MoneyRow
              label="Settled as non-chargeable"
              value={money(ncSettled.value)}
              sub={`${ncSettled.kind === "" ? "" : `${ncSettled.kind} · `}authorised by ${ncSettled.authorisedBy}${ncSettled.reason === "" ? "" : ` · ${ncSettled.reason}`} · given away, before tax`}
              tint="warning"
            />
            {(ncSettled.wouldHaveCharged ?? 0) > 0 && (
              <MoneyRow label="Would have been (incl. tax)" value={money(ncSettled.wouldHaveCharged)} sub="Information only — in no report" />
            )}
          </>
        )}
        {/* Split payments: each part is its own tender, named individually. */}
        {splits.map((s, i) => (
          <div key={i}>
            <RuleLine />
            <MoneyRow
              label={(s.method ?? s.payment_method ?? "Split part") || "Split part"}
              value={money(s.amount ?? s.value)}
              sub={(s.reference ?? "").trim() === "" ? "Split part" : `Ref ${(s.reference ?? "").trim()}`}
            />
          </div>
        ))}
        {d.refunded && (
          <>
            <RuleLine />
            <MoneyRow
              label="Refunded"
              value={`− ${money(d.refund_amount)}`}
              sub={(d.refund_reason ?? "").trim() !== "" ? (d.refund_reason ?? "").trim() : ((d.refund_ref ?? "").trim() !== "" ? (d.refund_ref ?? "").trim() : "No reason recorded")}
              tint="danger"
            />
          </>
        )}
        {(d.payment_proof_screenshot_url ?? "").trim() !== "" && (
          <a
            href={d.payment_proof_screenshot_url ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-accent-foreground underline-offset-2 hover:underline"
          >
            View payment proof →
          </a>
        )}
      </DetailCard>

      {orders.length > 0 && (
        <DetailCard heading="Orders on this bill">
          {orders.map((o, i) => (
            <div key={o.id}>
              {i > 0 && <RuleLine />}
              <MoneyRow
                label={`${o.status || "Order"} · ${o.item_count || 0} items`}
                value={money(o.subtotal)}
                sub={dateTime(o.created_at, timezone)}
              />
            </div>
          ))}
        </DetailCard>
      )}

      {trail.length > 0 && (
        <DetailCard heading="Handled by">
          {trail.map((r) => <KvRow key={r.k} k={r.k} v={r.v} />)}
          {(d.reason ?? "").trim() !== "" && (
            <p className="mt-1 text-xs text-muted-foreground">Note: {(d.reason ?? "").trim()}</p>
          )}
        </DetailCard>
      )}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────
   The page-level section: header, search (+ Accounting's method filter),
   and the list. History renders it plainly (SectionHeader + caption, no
   card box, search only); Accounting keeps its card with the shared range
   control in the header.
   ──────────────────────────────────────────────────────────────────────── */

interface Props {
  rid: string
  /** The HOST's window — the page range. The section keeps no dates of its
   *  own: one window per screen, so the list and the totals above it can
   *  never describe different days. */
  from?: string
  to?: string
  /** With `onRangeChange`, the header carries the SAME live picker bound to
   *  the SAME window; `range` alone renders a read-only note. */
  range?: DateRange
  onRangeChange?: (range: DateRange) => void
  /** The caption under the title. */
  description?: string
  /** Card title (Accounting surface). */
  title?: string
  /** Which surface mounted it — decides chrome, filters and wording. */
  surface?: ClosedBillSurface
  /** 15 on the pages (Flutter's default), 10 inside the month sheet. */
  pageSize?: number
  /** An arrival preset for the method filter (a deep link's `?method=`). */
  initialMethod?: string
  /** Controlled method filter — lets the host re-aim the list after mount
   *  (e.g. "Filter settled bills to this method" from a method sheet). */
  method?: string
  onMethodChange?: (method: string) => void
  /** The methods present in the WINDOW (`sales.by_method`), already labelled.
   *  When given, the dropdown lists only these (Flutter); otherwise every
   *  configured mode. */
  methodOptions?: { value: string; label: string }[]
  /** @deprecated The section no longer keeps dates of its own; ignored. */
  ownDateFilter?: boolean
}

export function ClosedBillsSection({
  rid,
  from,
  to,
  range,
  onRangeChange,
  description,
  title,
  surface = "accounting",
  pageSize = 15,
  initialMethod,
  method: methodProp,
  onMethodChange,
  methodOptions: windowMethods,
}: Props): ReactElement {
  const { timezone } = useTimezone()
  const { methods: paymentMethods } = usePaymentMethods(rid)
  const methodOptions = useMemo(
    () => windowMethods ?? closedBillMethodFilterOptions(paymentMethods),
    [windowMethods, paymentMethods],
  )
  const [search, setSearch] = useState("")
  const [ownMethod, setOwnMethod] = useState(initialMethod ?? "")
  const method = methodProp ?? ownMethod
  const setMethod = (m: string): void => {
    setOwnMethod(m)
    onMethodChange?.(m)
  }

  const effFrom = range?.from ?? from
  const effTo = range?.to ?? to
  const windowLabel = effFrom && effTo ? rangeLabel({ from: effFrom, to: effTo }, timezone) : "this period"

  // Window-specific empty captions, worded per surface (finding 54).
  const emptyCaption = surface === "history"
    ? (search === ""
      ? `No bills were closed in ${windowLabel}.`
      : `No settled bill in ${windowLabel} matches "${search}".`)
    : (search === "" && method === ""
      ? `No bills were closed in ${windowLabel}.`
      : `No settled bill in ${windowLabel} matches that filter.`)

  const filter: ClosedBillsFilter = {
    from: effFrom || undefined,
    to: effTo || undefined,
    search: search.trim() || undefined,
    payment_method: method || undefined,
  }

  const searchField = (
    <AppSearchField
      placeholder={surface === "history" ? "Search bill no, table, cashier…" : "Search bill no, table, customer…"}
      debounceMs={350}
      onQuery={setSearch}
      aria-label="Search settled bills"
    />
  )

  const methodSelect = surface === "history" ? null : (
    <select
      value={method}
      onChange={(e) => { setMethod(e.target.value) }}
      aria-label="Payment method"
      className="h-10 w-full rounded-md border border-input bg-inset px-3 text-sm outline-none focus:border-ring min-[760px]:w-[180px] min-[760px]:shrink-0"
    >
      <option value="">All methods</option>
      {methodOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
      {/* An arrival filter the configured modes do not list stays visible and
          clearable rather than silently in force. */}
      {method !== "" && !methodOptions.some((m) => m.value === method) && (
        <option value={method}>{method}</option>
      )}
    </select>
  )

  if (surface === "history") {
    // Flutter's History surface: a plain page section — SectionHeader, the
    // window-naming sentence, the shared search box, then the cards.
    return (
      <section id="closed-bills-section" className="scroll-mt-20">
        <SectionHeader title={title ?? "Settled bills"} className="mb-1.5" />
        <p className="text-xs text-muted-foreground">
          {description ?? `Every bill closed in ${windowLabel}, newest first — tap one to see it in full or reprint it.`}
        </p>
        <div className="mt-3">{searchField}</div>
        <div className="mt-3">
          <ClosedBillsList rid={rid} filter={filter} pageSize={pageSize} emptyCaption={emptyCaption} surface={surface} />
        </div>
      </section>
    )
  }

  // Accounting surface (accounting.md 8.4): a page-level section too — header
  // with the SAME live window control, caption, search beside a 180px method
  // dropdown, then the bill cards on the page background.
  return (
    <section id="closed-bills-section" className="scroll-mt-20">
      <SectionHeader
        title={title ?? "Settled bills"}
        className="mb-1.5"
        trailing={range && onRangeChange ? (
          <DateRangePicker value={range} onChange={onRangeChange} timezone={timezone} align="end" />
        ) : range ? (
          <RangeNote range={range} timezone={timezone} />
        ) : undefined}
      />
      <p className="text-xs text-muted-foreground">
        {description ?? "Every bill closed in this period, newest first — tap one for its items, taxes, payment and who closed it."}
      </p>
      <div className="mt-3 flex flex-col gap-2 min-[760px]:flex-row min-[760px]:items-center">
        <div className="min-w-0 flex-1">{searchField}</div>
        {methodSelect}
      </div>
      <div className="mt-3">
        <ClosedBillsList rid={rid} filter={filter} pageSize={pageSize} emptyCaption={emptyCaption} surface={surface} />
      </div>
    </section>
  )
}
