"use client"

// Browse and re-open SETTLED bills.
//
// `/bill-for-table` only ever returns the bill still on the floor, so before this
// there was no way anywhere in the app to look at a bill once it was paid. This
// section wraps GET /bills/closed (paged list) + GET /bills/closed/:id (the full
// bill), and is mounted by both Accounting and History.
//
// The money split it renders comes straight from the backend, which guarantees
//   taxable_base + service_charge + tax_total === grand_total
// and lifts a "Service Charge" entry out of the tax breakdown so it is never
// shown twice. Nothing is recomputed here.

import { useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Pencil, Printer, Receipt } from "lucide-react"
import { useCurrency } from "@/hooks/use-currency"
import { useAuth } from "@/context/AuthContext"
import { usePaymentMethods } from "@/hooks/use-payment-methods"
import { closedBillMethodFilterOptions, paymentMethodLabel } from "@/lib/payment-methods"
import { BillCustomerDialog } from "@/components/bill-customer-dialog"
import { canEditSettledBillCustomer } from "@/lib/bill-customer"
import { getClosedBills, getClosedBill, reprintSettledBill, type ClosedBillSummary, type ClosedBillDetail } from "@/lib/db"
import { formatDateTime } from "@/lib/tz"
import { useTimezone } from "@/lib/use-timezone"
import { elapsedToSettlement, formatDuration, readServiceClock } from "@/lib/service-clock"

const PAGE_SIZE = 25

// The method filter is the restaurant's own modes — every one it has configured,
// switched off or not, because old bills keep their mode — plus "Split", whose
// bills carry their real modes in payment_splits (listed in the detail view).
// The value is the stored id, which is what GET /bills/closed filters on.

// Settlement instants are accounting evidence — they render in the restaurant's
// zone, never the viewer's, so a closed bill reads the same as the till printed.
const dateTime = (v: string | null | undefined, timeZone: string) => formatDateTime(v, timeZone)

interface Props {
  rid: string
  /**
   * Date range. With `ownDateFilter` off (Accounting) it is the page's range and
   * the section has no date inputs of its own. With it on (History) these SEED
   * the section's own inputs — a month drill-down re-seeds them — and the user
   * can then edit them freely.
   */
  from?: string
  to?: string
  ownDateFilter?: boolean
  description?: string
}

export function ClosedBillsSection({ rid, from, to, ownDateFilter = false, description }: Props) {
  const { toast } = useToast()
  const { methods: paymentMethods } = usePaymentMethods(rid)
  const methodOptions = useMemo(() => closedBillMethodFilterOptions(paymentMethods), [paymentMethods])
  const { timezone } = useTimezone()
  /** The bill currently being sent to a printer, so the button can say so. */
  const [reprinting, setReprinting] = useState<string | null>(null)
  const { currencySymbol } = useCurrency()
  const { user } = useAuth()
  /*
    R2 ITEM 1 — "This option has to come in the past bills section in accounting."
    Gated on the permission the Reprint button's route (E5, POST
    /print/bill/settled) is gated on, which is also the new route's gate. Hidden,
    not greyed, for everyone else: the route would refuse them.
  */
  const canEditCustomer = canEditSettledBillCustomer(user)
  const [customerOpen, setCustomerOpen] = useState(false)
  const money = (n: number | null | undefined) =>
    `${currencySymbol}${Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const [ownFrom, setOwnFrom] = useState(from ?? "")
  const [ownTo, setOwnTo] = useState(to ?? "")
  // Re-seed the section's own inputs whenever the host hands down a new range
  // (History's "browse this month's bills"). No-op while the host owns the dates.
  useEffect(() => {
    if (!ownDateFilter) {return}
    setOwnFrom(from ?? "")
    setOwnTo(to ?? "")
  }, [from, to, ownDateFilter])
  const effFrom = ownDateFilter ? ownFrom : from
  const effTo = ownDateFilter ? ownTo : to

  const [search, setSearch] = useState("")
  const [method, setMethod] = useState("")
  const [table, setTable] = useState("")

  const [bills, setBills] = useState<ClosedBillSummary[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [failed, setFailed] = useState(false)

  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ClosedBillDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // Debounced first page — reruns on every filter change.
  useEffect(() => {
    if (!rid) {return}
    let active = true
    setLoading(true)
    const t = setTimeout(() => {
      void getClosedBills(rid, {
        limit: PAGE_SIZE,
        offset: 0,
        from: effFrom || undefined,
        to: effTo || undefined,
        search: search.trim() || undefined,
        payment_method: method || undefined,
        table: table.trim() || undefined,
      })
        .then((page) => {
          if (!active) {return}
          // null = the request failed. An empty page is a real "no bills", so the
          // two render differently.
          setFailed(page === null)
          setBills(page?.bills ?? [])
          setTotal(page?.total ?? 0)
          setHasMore(page?.has_more ?? false)
        })
        .catch(() => {
          if (active) {setFailed(true); setBills([]); setTotal(0); setHasMore(false)}
        })
        .finally(() => { if (active) {setLoading(false)} })
    }, 300)
    return () => { active = false; clearTimeout(t) }
  }, [rid, effFrom, effTo, search, method, table])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) {return}
    setLoadingMore(true)
    try {
      const page = await getClosedBills(rid, {
        limit: PAGE_SIZE,
        offset: bills.length,
        from: effFrom || undefined,
        to: effTo || undefined,
        search: search.trim() || undefined,
        payment_method: method || undefined,
        table: table.trim() || undefined,
      })
      if (!page) {setHasMore(false); return}
      // Ordering is (settled_at desc, id desc) — a total order — but de-dupe by id
      // anyway so a bill settled mid-scroll can never appear twice.
      const seen = new Set(bills.map((b) => b.id))
      const fresh = page.bills.filter((b) => !seen.has(b.id))
      setTotal(page.total)
      // Nothing new means the offset can never advance — stop instead of looping.
      if (fresh.length === 0) {setHasMore(false); return}
      setBills((prev) => [...prev, ...fresh])
      setHasMore(page.has_more)
    } finally {
      setLoadingMore(false)
    }
  }, [rid, bills, effFrom, effTo, search, method, table, hasMore, loadingMore])

  const openBill = useCallback(async (id: string) => {
    setOpenId(id)
    setDetail(null)
    setDetailLoading(true)
    try {
      setDetail(await getClosedBill(rid, id))
    } finally {
      setDetailLoading(false)
    }
  }, [rid])

  const clearFilters = () => { setSearch(""); setMethod(""); setTable(""); setOwnFrom(""); setOwnTo("") }
  const hasFilters = Boolean(search || method || table || (ownDateFilter && (ownFrom || ownTo)))

  return (
    <Card id="closed-bills-section" className="scroll-mt-20">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Closed bills</CardTitle>
            <CardDescription>
              {description ?? "Every settled bill — open one to see its line items, taxes, service charge, discount, payment and who settled it."}
            </CardDescription>
          </div>
          {ownDateFilter && (
            <div className="flex items-center gap-2">
              <Input type="date" value={ownFrom} onChange={(e) => { setOwnFrom(e.target.value) }} className="w-auto" aria-label="Settled from" />
              <span className="text-muted-foreground">→</span>
              <Input type="date" value={ownTo} onChange={(e) => { setOwnTo(e.target.value) }} className="w-auto" aria-label="Settled to" />
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Input
            placeholder="Bill no, table, method, coupon, cashier…"
            value={search}
            onChange={(e) => { setSearch(e.target.value) }}
          />
          <Input placeholder="Table (exact, e.g. T2)" value={table} onChange={(e) => { setTable(e.target.value) }} />
          <select
            value={method}
            onChange={(e) => { setMethod(e.target.value) }}
            aria-label="Payment method"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring"
          >
            <option value="">All payment methods</option>
            {methodOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>{loading ? "Loading…" : `Showing ${bills.length} of ${total} settled bill${total === 1 ? "" : "s"}`}</span>
          {hasFilters && <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>}
        </div>

        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : failed ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Couldn&apos;t load closed bills — the server is unreachable, or your role doesn&apos;t include the &quot;View Bill&quot; permission.
          </p>
        ) : bills.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No settled bills match these filters.</p>
        ) : (
          <>
            <div className="divide-y overflow-hidden rounded-md border">
              {bills.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => void openBill(b.id)}
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left text-sm transition hover:bg-muted/50"
                >
                  <Receipt className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium">#{b.bill_no ?? "—"}</span>
                  <span className="text-muted-foreground">{b.table_name ?? "No table"}</span>
                  <span className="text-muted-foreground">{dateTime(b.settled_at ?? b.closed_at, timezone)}</span>
                  <span className="ml-auto flex items-center gap-2">
                    {b.refunded && <Badge variant="destructive">Refunded</Badge>}
                    {b.coupon_code && <Badge variant="outline">{b.coupon_code}</Badge>}
                    {b.payment_method && <Badge variant="secondary">{paymentMethodLabel(b.payment_method, paymentMethods)}</Badge>}
                    <span className="font-semibold">{money(b.grand_total)}</span>
                  </span>
                </button>
              ))}
            </div>
            {hasMore && (
              <div className="flex justify-center">
                <Button variant="outline" size="sm" disabled={loadingMore} onClick={() => void loadMore()}>
                  {loadingMore ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={openId !== null} onOpenChange={(o) => { if (!o) { setOpenId(null); setDetail(null) } }}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Bill #{detail?.bill_no ?? "—"}
              {detail?.table_name ? <span className="text-muted-foreground"> · {detail.table_name}</span> : null}
            </DialogTitle>
            <DialogDescription>
              {detail ? `Settled ${dateTime(detail.settled_at ?? detail.closed_at, timezone)}` : "Loading this bill…"}
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
          ) : !detail ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Couldn&apos;t load this bill.</p>
          ) : (
            <BillDetailBody detail={detail} money={money} />
          )}

          {detail && (
            <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
              {/* SAID BEFORE IT IS PRESSED, not after. The paper carries a
                  REPRINT banner in the largest type the printer has, because a
                  second copy that looks like an original gets paid twice or
                  filed as a second sale — and somebody about to hand it to a
                  guest should know that is what comes out. */}
              <p className="text-xs text-muted-foreground">
                Prints a second copy, marked <span className="font-semibold">REPRINT</span>, with the
                figures exactly as this bill was settled.
              </p>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              {canEditCustomer ? (
                <Button size="sm" variant="outline" onClick={() => { setCustomerOpen(true) }}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit name / GSTIN
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                disabled={reprinting === detail.id}
                onClick={() => {
                  const id = detail.id
                  setReprinting(id)
                  void reprintSettledBill(rid, id)
                    .then((r) => {
                      toast(r.ok
                        ? {
                          title: "Sent to the printer",
                          description: r.destination ? `Printing at ${r.destination}.` : "The reprint is on its way.",
                        }
                        // The SERVER'S sentence, verbatim. "Couldn't reprint"
                        // sends an owner hunting; "no printer is online for
                        // bills" tells them what to do.
                        : { title: "Could not reprint", description: r.message, variant: "destructive" })
                    })
                    .finally(() => { setReprinting((cur) => (cur === id ? null : cur)) })
                }}
              >
                <Printer className="mr-2 h-4 w-4" />
                {reprinting === detail.id ? "Sending…" : "Reprint bill"}
              </Button>
              </div>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {detail && canEditCustomer ? (
        <BillCustomerDialog
          open={customerOpen}
          onOpenChange={setCustomerOpen}
          restaurantId={rid}
          target={{ kind: "bill", billId: detail.id, billNo: detail.bill_no }}
          initial={detail}
          onSaved={(saved) => {
            const id = detail.id
            // THE ROW REFRESHES FROM THE SERVER'S ANSWER at once, then from a
            // fresh read — the read is the truth, and the answer is what keeps
            // the old name from sitting on screen while it is in flight.
            setDetail((cur) => (cur?.id === id ? { ...cur, customer: saved.customer, customer_gstin: saved.customer_gstin } : cur))
            void getClosedBill(rid, id)
              .then((fresh) => { if (fresh) { setDetail((cur) => (cur?.id === id ? fresh : cur)) } })
              .catch(() => { /* the answer above already stands */ })
          }}
        />
      ) : null}
    </Card>
  )
}

function Row({ label, value, bold, muted }: { label: string; value: string; bold?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 text-sm ${bold ? "font-semibold" : ""} ${muted ? "text-muted-foreground" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  )
}

function BillDetailBody({ detail, money }: { detail: ClosedBillDetail; money: (n: number | null | undefined) => string }) {
  const { timezone } = useTimezone()
  const d = detail
  const discountLabel = d.discount_type === "percent" ? `Discount (${d.discount_value}%)` : "Discount"
  /*
    THE SERVICE DURATION, AS THE SERVER MEASURED IT.

    A settled bill's clock is a FACT about a finished service, not a counter, so
    there is no ticking here and no local delta — `elapsedToSettlement` on a
    stopped clock ignores one. Null when the backend sent no clock at all, and
    the Fact below is then not drawn: ABSENT IS NOT ZERO, and "0m" beside a real
    waiter's name is a worse answer than nothing.
  */
  const closedClock = readServiceClock(d)
  const serviceSpan = closedClock === null ? null : formatDuration(elapsedToSettlement(closedClock).ms)

  return (
    <div className="space-y-5">
      {!d.totals_reconciled && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          The line items below no longer add up to the amount that was charged — the order was edited after the bill was settled.
          The stored total ({money(d.grand_total)}) is what the guest actually paid.
        </p>
      )}

      <div>
        <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Items</p>
        <div className="divide-y rounded-md border">
          {d.items.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No line items recorded for this bill.</p>
          ) : d.items.map((it, i) => (
            <div key={`${it.name}-${i}`} className="flex items-start gap-3 p-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{it.name}</p>
                <p className="text-xs text-muted-foreground">
                  {it.quantity} × {money(it.price)}{it.note ? ` · ${it.note}` : ""}
                </p>
              </div>
              <span className="tabular-nums font-medium">{money(it.line_total)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-1 rounded-md border p-3">
        <Row label="Items subtotal" value={money(d.items_subtotal)} />
        {d.discount_amount > 0 && (
          <Row label={`${discountLabel}${d.coupon_code ? ` · ${d.coupon_code}` : ""}`} value={`− ${money(d.discount_amount)}`} muted />
        )}
        {d.discount_amount > 0 && <Row label="After discount" value={money(d.discounted_subtotal)} />}
        {d.service_charge > 0 && (
          <Row label={`Service charge${d.service_charge_percent ? ` (${d.service_charge_percent}%)` : ""}`} value={money(d.service_charge)} />
        )}
        {d.taxes.map((t, i) => (
          <Row key={`${t.name}-${i}`} label={`${t.name}${t.percentage ? ` (${t.percentage}%)` : ""}`} value={money(t.amount)} />
        ))}
        <div className="border-t pt-1">
          <Row label="Grand total" value={money(d.grand_total)} bold />
        </div>
        {d.refunded && <Row label="Refunded" value={`− ${money(d.refund_amount)}`} muted />}
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Payment</p>
        <div className="space-y-1 rounded-md border p-3">
          <Row label="Method" value={d.payment_method ?? "—"} />
          {d.payment_splits.map((s, i) => (
            <Row key={`${s.method}-${i}`} label={`↳ ${s.method}`} value={money(s.amount)} muted />
          ))}
          {d.payment_proof_screenshot_url && (
            <a
              href={d.payment_proof_screenshot_url}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-primary underline-offset-2 hover:underline"
            >
              View payment proof →
            </a>
          )}
          {d.refunded && (
            <p className="text-xs text-muted-foreground">
              Refunded {dateTime(d.refunded_at, timezone)}{d.refunded_by ? ` by ${d.refunded_by}` : ""}
              {d.refund_reason ? ` · ${d.refund_reason}` : ""}{d.refund_ref ? ` · ref ${d.refund_ref}` : ""}
            </p>
          )}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Table &amp; guests</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Fact label="Table" value={d.table_name ?? "—"} />
          <Fact label="Covers" value={d.covers != null ? String(d.covers) : "—"} />
          <Fact label="APC" value={d.apc != null ? money(d.apc) : "—"} />
          <Fact label="Target APC" value={d.target_apc ? money(d.target_apc) : "—"} />
          <Fact label="Seated" value={dateTime(d.seated_at, timezone)} />
          <Fact label="Left" value={dateTime(d.left_at, timezone)} />
          {/*
            D2 ON A FINISHED SERVICE — how long this table was in service, from
            the first order to the settle.

            THE SERVER'S FIGURE, not a subtraction done here. The same clock the
            live floor screen showed while the table was open, frozen at the
            settle, which is the whole point of the backend owning it: History
            and the floor cannot report two different durations for one table,
            and a laptop whose own clock is wrong cannot invent a third.

            Drawn only when the backend actually sent a clock. An older server,
            or a bill whose orders the server could not date, gets no Fact at all
            rather than a fabricated "0m" against a real waiter's table.
          */}
          {serviceSpan ? <Fact label="Service time" value={serviceSpan} /> : null}
          <Fact label="Customer" value={d.customer ?? "—"} />
          {/* R2 item 1 — drawn only when the server sends the field at all; an
              older backend's silence is not "no GSTIN". */}
          {"customer_gstin" in d ? <Fact label="Customer GSTIN" value={d.customer_gstin?.trim() ? d.customer_gstin.trim() : "—"} /> : null}
          <Fact label="Orders" value={String(d.orders.length)} />
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Settlement trail</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Fact label="Opened by" value={d.created_by ?? "—"} />
          <Fact label="Opened at" value={dateTime(d.created_at, timezone)} />
          <Fact label="Confirmed by (waiter)" value={d.waiter_confirmed_by ?? "—"} />
          <Fact label="Confirmed at" value={dateTime(d.waiter_confirmed_at, timezone)} />
          <Fact label="Approved by (admin)" value={d.admin_approved_by ?? "—"} />
          <Fact label="Approved at" value={dateTime(d.admin_approved_at, timezone)} />
          <Fact label="Closed by" value={d.closed_by ?? "—"} />
          <Fact label="Closed at" value={dateTime(d.closed_at, timezone)} />
        </div>
        {d.reason ? <p className="mt-2 text-xs text-muted-foreground">Note: {d.reason}</p> : null}
      </div>

      {d.orders.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Orders on this bill</p>
          <div className="divide-y rounded-md border">
            {d.orders.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2 text-sm">
                <span className="font-mono text-xs text-muted-foreground">{o.id.slice(0, 8)}</span>
                <span className="text-muted-foreground">{dateTime(o.created_at, timezone)}</span>
                <Badge variant="outline">{o.status}</Badge>
                <span className="ml-auto text-muted-foreground">{o.item_count} item{o.item_count === 1 ? "" : "s"}</span>
                <span className="tabular-nums font-medium">{money(o.subtotal)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
