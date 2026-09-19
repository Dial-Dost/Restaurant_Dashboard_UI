"use client"

// ACCOUNTING — web copy of Flutter's `_AccountingView` (modules.dart
// 22169–23510), the source of truth for this page.
//
// The page order is the app's: range chip + exports → four stat cards →
// Sales–daily → By payment method → GST breakdown → Discounts & offers →
// Settled bills → Expenses → Payroll — then the three web-extra sections the
// audit kept pending a product decision (Open bills, Balance sheet,
// Reconciliation), and last the scheduled-reports pointer card.
//
// Every headline figure and nearly every row is a drill-down control opening
// the arithmetic behind it (src/components/accounting/sheets.tsx), assembled
// from the reports already loaded — a drill-down costs no round-trip. The
// whole batch loads through useCachedFetch: cache-primed paint, skeleton
// while empty, LoadErrorState on failure (an outage must never read as an
// empty ledger), stale pill when offline.

import { Fragment, Suspense, useCallback, useEffect, useMemo, useState } from "react"
import type { JSX } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Download, FileCode, FileText, Plus, Trash2 } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { ForkCard } from "@/components/ui/fork-card"
import { Columns, HBarRow } from "@/components/ui/fork-charts"
import { SkeletonRows } from "@/components/ui/fork-skeleton"
import { LoadErrorState } from "@/components/ui/load-error-state"
import { SectionHeader } from "@/components/ui/section-header"
import { CacheStalePill } from "@/components/ui/stale-pill"
import { StatCard } from "@/components/ui/stat-card"
import { ClosedBillsSection } from "@/components/closed-bills"
import { DateRangePicker } from "@/components/date-range-picker"
import { DetailsFooter, Hairline, MoneyRow, TapHint } from "@/components/accounting/bits"
import { AddExpenseDialog } from "@/components/accounting/dialogs"
import type { NewExpenseForm } from "@/components/accounting/dialogs"
import { buildFinancialReportHtml, printFinancialReport } from "@/components/accounting/financial-report"
import { ddmm, moneyExact, moneyWhole, numOf, strOf, windowLabelText } from "@/components/accounting/format"
import { PayrollSection } from "@/components/accounting/payroll-section"
import { ScheduledReportsMovedCard } from "@/components/accounting/scheduled-reports-moved"
import { AccountingSheets } from "@/components/accounting/sheets"
import type { AccountingDrill } from "@/components/accounting/sheets"
import {
  BalanceSheetSection,
  OpenBillsSection,
  ReconciliationSection,
} from "@/components/accounting/web-extra-sections"
import { useAuth } from "@/context/AuthContext"
import { useCachedFetch } from "@/hooks/use-cached-fetch"
import { useCurrency } from "@/hooks/use-currency"
import { useDateRange } from "@/hooks/use-date-range"
import { useToast } from "@/hooks/use-toast"
import { fetchAccountingBundle } from "@/lib/api/accounting"
import { addExpense, deleteExpense, getSalesCsv, getTallyXml } from "@/lib/db"
import type { ExpenseRow } from "@/lib/db"
import { readAccountingSales } from "@/lib/gross-net"
import { reportModeName } from "@/lib/payment-methods"
import { monthKeyInZone } from "@/lib/tz"
import { useTimezone } from "@/lib/use-timezone"

function AccountingInner(): JSX.Element {
  const { user } = useAuth()
  const { currencySymbol } = useCurrency()
  const { toast } = useToast()
  const { timezone } = useTimezone()
  const router = useRouter()
  const pathname = usePathname()
  const rid = user?.restaurantUsername ?? ""

  // ONE window for the whole page, from the shared control. It seeds from
  // ?from=&to= (History's month rows deep-link here), then from what this
  // screen was last set to in this session, then from the 30-day default — so
  // coming back from another module does not silently reset the period the
  // owner was reasoning about. Every boundary is a RESTAURANT day, not UTC.
  const search = useSearchParams()
  const { range, setRange } = useDateRange("accounting", { params: search })
  const { from, to } = range

  const [payrollMonth, setPayrollMonth] = useState(() => monthKeyInZone(new Date(), timezone))

  // The batched fetch, exactly Flutter's `_fetch`: sales/gst/pnl/expenses are
  // load-bearing; payroll and discounts degrade to null on their own. A month
  // or window change re-keys the cache, so old figures can never sit under a
  // new window label — the error screen is the honest outcome for that.
  const bundle = useCachedFetch(
    `accounting:${rid}:${from}:${to}:${payrollMonth}`,
    useCallback(
      () => fetchAccountingBundle(rid, from, to, payrollMonth),
      [rid, from, to, payrollMonth],
    ),
    { enabled: rid.length > 0 },
  )
  const data = bundle.data

  // Which drill-down sheet is open. All sheets read the loaded bundle only.
  const [drill, setDrill] = useState<AccountingDrill | null>(null)

  const [addExpenseOpen, setAddExpenseOpen] = useState(false)
  const [deletingExpense, setDeletingExpense] = useState<ExpenseRow | null>(null)

  // Two money voices (audit 13.1): whole rupees on cards/charts, 2 dp in rows.
  const money0 = useCallback((v: unknown): string => moneyWhole(currencySymbol, v), [currencySymbol])
  const moneyX = useCallback((v: unknown): string => moneyExact(currencySymbol, v), [currencySymbol])

  /* ── One-shot arrival (AccountingBillFilter, modules.dart 22172) ─────
   * A jump that is about particular bills may arrive with ?reveal=bills
   * (scroll to the settled bills once figures paint) and ?method= (preset the
   * list's payment-method filter). Taken once, then stripped, so a refresh
   * does not re-arm them. The method preset seeds the settled-bills filter,
   * which the page then owns (controlled), so the params can be stripped. */
  const [revealBills, setRevealBills] = useState(() => search.get("reveal") === "bills")
  const [billMethod, setBillMethod] = useState(() => search.get("method")?.trim() ?? "")

  useEffect(() => {
    if (search.get("reveal") == null && search.get("method") == null) { return }
    const next = new URLSearchParams(search.toString())
    next.delete("reveal")
    next.delete("method")
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    // One-shot, on arrival only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!revealBills || bundle.loading || data == null) { return }
    const el = document.getElementById("closed-bills")
    if (el != null) { el.scrollIntoView({ behavior: "smooth", block: "start" }) }
    setRevealBills(false)
  }, [revealBills, bundle.loading, data])

  /* ── Writes (every failure surfaces the server's words — no silence) ── */

  const failToast = (error: unknown): void => {
    toast({ title: String(error instanceof Error ? error.message : error), variant: "destructive" })
  }

  const onAddExpense = async (form: NewExpenseForm): Promise<void> => {
    try {
      await addExpense(rid, form)
      bundle.refresh()
    } catch (error) {
      failToast(error)
    }
  }

  const reallyDeleteExpense = async (expense: ExpenseRow): Promise<void> => {
    try {
      await deleteExpense(rid, expense.id)
      bundle.refresh()
    } catch (error) {
      failToast(error)
    }
  }

  const shiftPayrollMonth = (delta: number): void => {
    setPayrollMonth((m) => {
      const [y, mo] = m.split("-").map(Number)
      if (!Number.isFinite(y) || !Number.isFinite(mo)) { return m }
      const d = new Date(Date.UTC(y, mo - 1 + delta, 1))
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
    })
  }

  /* ── Exports — all cut on the SAME window the screen is showing ─────── */

  const exportTally = async (): Promise<void> => {
    try {
      const xml = await getTallyXml(rid, from, to)
      const url = URL.createObjectURL(new Blob([xml], { type: "application/xml" }))
      const a = document.createElement("a")
      a.href = url
      a.download = `tally_${from}_to_${to}.xml`
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast({ title: "Could not export Tally XML", description: String(error instanceof Error ? error.message : error), variant: "destructive" })
    }
  }

  // Downloaded from the backend, not built here — the same bytes the SCHEDULED
  // sales report delivers, because both come out of renderSalesCsv. Assembling
  // a second copy in the browser is what let the two drift. [web-extra, kept]
  const exportSalesCsv = async (): Promise<void> => {
    try {
      const csv = await getSalesCsv(rid, from, to)
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
      const a = document.createElement("a")
      a.href = url
      a.download = `sales_${data?.sales.from ?? from}_to_${data?.sales.to ?? to}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast({ title: "Could not export sales CSV", description: String(error instanceof Error ? error.message : error), variant: "destructive" })
    }
  }

  // The SELECTED window, not a default: an export that quietly disagrees with
  // the figures on screen is worse than no export — it is the copy that gets
  // filed. Which key each Sales line reads is decided in lib/gross-net.ts.
  const exportPdf = (): void => {
    if (data == null) { return }
    toast({ title: "Preparing the PDF…" })
    printFinancialReport(
      buildFinancialReportHtml({
        restaurantName: user?.restaurantName ?? rid,
        from,
        to,
        pnl: data.pnl,
        gst: data.gst,
        sales: data.sales,
      }),
    )
  }

  /* ── Derived rows ─────────────────────────────────────────────────────── */

  const byDay = useMemo(() => data?.sales.by_day ?? [], [data])
  const maxDay = byDay.reduce((a, d) => Math.max(a, numOf(d.sales)), 0)
  const byMethod = useMemo(() => {
    const rows = [...(data?.sales.by_method ?? [])]
    rows.sort((a, b) => numOf(b.sales) - numOf(a.sales))
    return rows
  }, [data])
  const maxMethod = byMethod.reduce((a, m) => Math.max(a, numOf(m.sales)), 0)
  // Flutter lists only the methods the WINDOW carries (sales.by_method),
  // labelled the report's way; an arrival value it lacks is injected by the
  // section itself so the filter in force stays visible and clearable.
  const billMethodOptions = useMemo(
    () => byMethod.map((m) => ({ value: m.method, label: reportModeName(m) })),
    [byMethod],
  )
  const byRate = data?.gst.by_rate ?? []
  const serviceCharge = numOf(data?.gst.total_service_charge)
  const discounts = data?.discounts ?? null
  const byCoupon = discounts?.by_coupon ?? []
  const hasDiscounts = numOf(discounts?.discounted_bills) > 0 || byCoupon.length > 0
  const expenses = useMemo(() => data?.expenses ?? [], [data])
  const netProfitUp = numOf(data?.pnl.net_profit) >= 0
  const words = readAccountingSales(data?.sales)
  const windowLabel = windowLabelText(range, timezone)

  /* ── Render ───────────────────────────────────────────────────────────── */

  if (bundle.loading || (data == null && bundle.error == null)) {
    return <SkeletonRows rows={6} />
  }
  if (data == null) {
    return (
      <LoadErrorState
        whatFailed="Could not load reports"
        error={bundle.error}
        onRetry={bundle.retry}
      />
    )
  }

  return (
    <div className="relative">
      <div className="grid gap-5">
        {/* The two exports drop below the period control on a phone, and wrap
            again between themselves if they still do not fit. */}
        <div className="flex flex-col gap-2.5 min-[760px]:flex-row min-[760px]:items-center min-[760px]:justify-between">
          <DateRangePicker value={range} onChange={setRange} timezone={timezone} align="start" />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => { void exportSalesCsv() }}>
              <Download /> Sales CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => { void exportTally() }}>
              <FileCode /> Tally XML
            </Button>
            <Button variant="outline" size="sm" onClick={exportPdf}>
              <FileText /> Export PDF
            </Button>
          </div>
        </div>

        {/* Each headline opens the arithmetic under it. The captions say GST
            but the tax sheet is careful to name the service charge separately —
            it is income, not a levy, and the two must never read as one bucket. */}
        <div className="grid grid-cols-1 gap-[14px] min-[760px]:grid-cols-2 min-[1100px]:grid-cols-4">
          {/* NET, in the client's word: after discount, before service charge,
              tax and round off. This card used to show net_sales — Gross less
              refunds, tax and all — under this caption; that figure is on the
              sheet behind it, named for what it is (lib/gross-net.ts). */}
          <StatCard
            value={money0(words.headlineValue ?? 0)}
            caption={words.headlineLabel.toUpperCase()}
            footer={<DetailsFooter />}
            onClick={() => { setDrill({ kind: "net-sales" }) }}
          />
          <StatCard
            value={money0(data.gst.total_tax)}
            caption="GST COLLECTED"
            footer={<DetailsFooter />}
            onClick={() => { setDrill({ kind: "tax" }) }}
          />
          <StatCard
            value={money0(data.pnl.total_expenses)}
            caption="EXPENSES"
            footer={<DetailsFooter />}
            onClick={() => { setDrill({ kind: "expenses" }) }}
          />
          <StatCard
            value={money0(data.pnl.net_profit)}
            caption="NET PROFIT"
            tag={netProfitUp ? "Up" : "Dn"}
            tagColor={netProfitUp ? "hsl(var(--success))" : "hsl(var(--destructive))"}
            footer={<DetailsFooter />}
            onClick={() => { setDrill({ kind: "net-profit" }) }}
          />
        </div>

        {/* Empty sections collapse rather than explain themselves — the app's
            arrangement. Every bar hovers a reading and clicks into a sheet. */}
        {byDay.length > 0 && (
          <ForkCard>
            <SectionHeader title="Sales — daily" className="mb-3" />
            {byDay.length >= 10 ? (
              <Columns
                values={byDay.map((d) => numOf(d.sales))}
                labels={byDay.map((d) => ddmm(d.date))}
                formatValue={money0}
                tooltip={(i) => `${ddmm(byDay[i].date)} · ${money0(byDay[i].sales)}`}
                onSelect={(i) => { setDrill({ kind: "day", index: i }) }}
              />
            ) : (
              byDay.map((d, i) => (
                <HBarRow
                  key={d.date}
                  label={ddmm(d.date)}
                  fraction={maxDay > 0 ? Math.min(1, Math.max(0, numOf(d.sales) / maxDay)) : 0}
                  value={money0(d.sales)}
                  tooltip={`${ddmm(d.date)} · ${money0(d.sales)}`}
                  onSelect={() => { setDrill({ kind: "day", index: i }) }}
                />
              ))
            )}
          </ForkCard>
        )}

        {byMethod.length > 0 && (
          <ForkCard>
            <SectionHeader title="By payment method" className="mb-3" />
            {byMethod.map((m) => (
              <HBarRow
                key={m.method}
                label={reportModeName(m)}
                sub={`${m.bills} bills`}
                fraction={maxMethod > 0 ? Math.min(1, Math.max(0, numOf(m.sales) / maxMethod)) : 0}
                value={money0(m.sales)}
                tooltip={`${reportModeName(m)} · ${moneyX(m.sales)}`}
                onSelect={() => { setDrill({ kind: "method", method: m }) }}
              />
            ))}
          </ForkCard>
        )}

        {byRate.length > 0 && (
          <ForkCard>
            <SectionHeader title="GST breakdown" className="mb-1.5" />
            <TapHint />
            {byRate.map((t, i) => (
              <Fragment key={`${t.name}-${String(t.percentage)}-${String(i)}`}>
                {i > 0 && <Hairline />}
                <MoneyRow
                  label={`${strOf(t.name, "Tax")} · ${numOf(t.percentage)}%`}
                  amount={moneyX(t.tax)}
                  sub={`Taxable ${moneyX(t.taxable)}`}
                  onClick={() => { setDrill({ kind: "rate", rate: t }) }}
                />
              </Fragment>
            ))}
            {/* Service charge is deliberately absent from the rates above: it
                is income, not tax. Named here so its absence reads as a
                decision rather than a missing row. */}
            {serviceCharge > 0 && (
              <>
                <Hairline />
                <MoneyRow
                  label="Service charge — not tax"
                  amount={moneyX(serviceCharge)}
                  sub="Kept by the restaurant, excluded from every rate above"
                  onClick={() => { setDrill({ kind: "tax" }) }}
                />
              </>
            )}
          </ForkCard>
        )}

        {hasDiscounts && discounts != null && (
          <ForkCard>
            <SectionHeader title="Discounts & offers" className="mb-1.5" />
            <p className="text-xs text-muted-foreground">
              Bill totals are stored after discount — sales above already reflect these.
            </p>
            <div className="mt-2">
              <MoneyRow
                label="Total given"
                amount={`${numOf(discounts.estimated_bills) > 0 ? "≈" : ""}${moneyX(discounts.total_discount)}`}
                sub={`${discounts.discounted_bills} of ${discounts.bill_count} bills · manual ${moneyX(discounts.manual_discount)} · coupons ${moneyX(discounts.coupon_discount)}`}
                onClick={() => { setDrill({ kind: "discounts" }) }}
              />
              {byCoupon.map((c) => (
                <Fragment key={c.code}>
                  <Hairline />
                  <MoneyRow
                    label={`${strOf(c.code)}${c.kind === "gift" ? " · Gift voucher" : ""}`}
                    amount={moneyX(c.amount)}
                    sub={`${c.uses} uses`}
                    onClick={() => { setDrill({ kind: "coupon", coupon: c }) }}
                  />
                </Fragment>
              ))}
            </div>
          </ForkCard>
        )}

        {/* ── Settled bills ─────────────────────────────────────────────
            Scoped to the same period as every other figure on this page so the
            list and the totals above can never disagree about which days they
            are describing. The card's own picker drives THIS page window
            (setRange), not a private one. */}
        <div id="closed-bills" className="scroll-mt-20">
          <ClosedBillsSection
            rid={rid}
            from={from}
            to={to}
            range={range}
            onRangeChange={setRange}
            method={billMethod}
            onMethodChange={setBillMethod}
            methodOptions={billMethodOptions}
            description="Every bill closed in this period, newest first — tap one for its items, taxes, payment and who closed it."
          />
        </div>

        {/* ── Expenses ─────────────────────────────────────────────────── */}
        <section>
          <SectionHeader
            title="Expenses"
            count={expenses.length}
            className="mb-1.5"
            trailing={
              <Button variant="outline" size="sm" onClick={() => { setAddExpenseOpen(true) }}>
                <Plus /> Add
              </Button>
            }
          />
          {expenses.length === 0 ? (
            <p className="text-xs text-muted-foreground">No expenses in this period.</p>
          ) : (
            <ForkCard className="py-2.5">
              <TapHint />
              {expenses.map((e, i) => (
                <Fragment key={e.id}>
                  {i > 0 && <Hairline />}
                  <MoneyRow
                    label={`${strOf(e.category, "General")}${strOf(e.vendor, "") !== "" ? ` · ${strOf(e.vendor, "")}` : ""}`}
                    amount={moneyX(e.amount)}
                    sub={`${strOf(e.spent_on)}${strOf(e.note, "") !== "" ? ` · ${strOf(e.note, "")}` : ""}`}
                    // Delete keeps its own button. The row tap opens the record;
                    // a destructive action is never what a row tap resolves to.
                    onClick={() => { setDrill({ kind: "expense", expense: e }) }}
                    trailing={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Delete expense"
                        aria-label="Delete expense"
                        onClick={(ev) => {
                          ev.stopPropagation()
                          setDeletingExpense(e)
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    }
                  />
                </Fragment>
              ))}
            </ForkCard>
          )}
        </section>

        {/* ── Payroll ──────────────────────────────────────────────────── */}
        <PayrollSection
          rid={rid}
          month={payrollMonth}
          payroll={data.payroll}
          money={moneyX}
          onShiftMonth={shiftPayrollMonth}
          onOpenSheet={(row) => { setDrill({ kind: "payroll", row }) }}
          onChanged={bundle.refresh}
        />

        {/* ── Web-extra sections (audit area 12 — kept, decision surfaced,
            moved below the Flutter-parity order) ───────────────────────── */}
        <OpenBillsSection rid={rid} />
        <div className="grid items-start gap-5 md:grid-cols-2">
          <BalanceSheetSection rid={rid} money={(n) => money0(n ?? 0)} />
          <ReconciliationSection rid={rid} money={(n) => money0(n ?? 0)} />
        </div>

        {/* Scheduled reports moved to Insights → Reports → Email reports
            (client item 9); the card says where, and opens it. */}
        <ScheduledReportsMovedCard />
      </div>

      <CacheStalePill offline={bundle.offline} fromCache={bundle.fromCache} updatedAt={bundle.updatedAt} />

      {/* The drill-down sheet layer — every stat tile, chart bar and money row
          above lands here. */}
      <AccountingSheets
        drill={drill}
        onClose={() => { setDrill(null) }}
        bundle={data}
        windowLabel={windowLabel}
        payrollMonth={payrollMonth}
        timezone={timezone}
        money={moneyX}
        moneyWhole={money0}
      />

      <AddExpenseDialog
        open={addExpenseOpen}
        onOpenChange={setAddExpenseOpen}
        onSubmit={(form) => { void onAddExpense(form) }}
      />

      {/* Deleting an expense is destructive and unrecoverable — always behind
          a styled confirmation, never window.confirm. */}
      <AlertDialog
        open={deletingExpense != null}
        onOpenChange={(open) => { if (!open) { setDeletingExpense(null) } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete expense</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingExpense != null
                ? `Remove ${strOf(deletingExpense.category, "General")} · ${moneyX(deletingExpense.amount)} (${strOf(deletingExpense.spent_on)})? It comes out of the expense total and net profit above.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = deletingExpense
                setDeletingExpense(null)
                if (target) { void reallyDeleteExpense(target) }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// useSearchParams requires a Suspense boundary (same pattern as the queue page).
export default function AccountingPage(): JSX.Element {
  return (
    <Suspense fallback={<SkeletonRows rows={6} />}>
      <AccountingInner />
    </Suspense>
  )
}
