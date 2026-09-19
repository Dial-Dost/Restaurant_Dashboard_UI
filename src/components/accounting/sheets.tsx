"use client"

// THE ACCOUNTING DRILL-DOWN SHEETS — web copies of `_netSalesSheet`,
// `_taxSheet`, `_expensesSheet`, `_netProfitSheet`, `_methodSheet`,
// `_taxRateSheet`, `_discountsSheet`, `_couponSheet`, `_expenseSheet`,
// `_payrollSheet` and the `_barChart` day sheet in Flutter's modules.dart
// (~22606–22880, 19407).
//
// Every sheet is assembled from the reports the page already loaded — a
// drill-down costs no round-trip — and every one states its window, because
// the range control can change while a sheet is open.
//
// One house rule runs through all of them: the SERVICE CHARGE IS NOT TAX. The
// server keeps `total_service_charge` out of `total_tax` and out of `by_rate`,
// and every sheet below keeps them on separate lines with separate wording —
// collapsing the two once booked ₹31,733.92 of owner income as GST.

import * as React from "react"

import { DrillSheet } from "@/components/ui/drill-sheet"
import { SheetHead, SheetNote, SheetRow } from "@/components/accounting/bits"
import { billsWord, intOf, numOf, shortTime, strOf } from "@/components/accounting/format"
import type { AccountingBundle } from "@/lib/api/accounting"
import { readAccountingSales } from "@/lib/gross-net"
import { formatRoundOff } from "@/lib/bill-round-off"
import { reportModeName } from "@/lib/payment-methods"
import type { DiscountsReport, ExpenseRow, GstReport, PayrollRow, SalesReport } from "@/lib/db"

export type MethodRow = SalesReport["by_method"][number]
export type RateRow = GstReport["by_rate"][number]
export type CouponRow = DiscountsReport["by_coupon"][number]

/** Which drill sheet is open. */
export type AccountingDrill =
  | { kind: "net-sales" }
  | { kind: "tax" }
  | { kind: "expenses" }
  | { kind: "net-profit" }
  | { kind: "day"; index: number }
  | { kind: "method"; method: MethodRow }
  | { kind: "rate"; rate: RateRow }
  | { kind: "discounts" }
  | { kind: "coupon"; coupon: CouponRow }
  | { kind: "expense"; expense: ExpenseRow }
  | { kind: "payroll"; row: PayrollRow }

/** Token-styled key/value line (`_kv`): letter-spaced micro key, quiet value. */
function KvLine({ k, v }: { k: string; v: string }): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="micro-label w-[148px] shrink-0 pt-0.5">{k}</span>
      <span className="min-w-0 flex-1 text-[13px] font-medium">{v}</span>
    </div>
  )
}

export interface AccountingSheetsProps {
  drill: AccountingDrill | null
  onClose: () => void
  bundle: AccountingBundle
  /** "1–15 Aug · 15 days" — restated on every sheet. */
  windowLabel: string
  payrollMonth: string
  timezone: string
  /** The 2-dp sheet voice (`_money`): "—" when unparseable. */
  money: (v: unknown) => string
  /** The whole-rupee chart voice. */
  moneyWhole: (v: unknown) => string
}

interface SheetContent {
  eyebrow: string
  title: string
  body: React.ReactNode
}

export function AccountingSheets({
  drill,
  onClose,
  bundle,
  windowLabel,
  payrollMonth,
  timezone,
  money,
  moneyWhole,
}: AccountingSheetsProps): React.JSX.Element | null {
  if (!drill) { return null }
  const { sales, gst, pnl, expenses, discounts } = bundle

  const content = ((): SheetContent => {
    switch (drill.kind) {
      case "net-sales": {
        const gross = numOf(sales.total_sales)
        const refunds = numOf(sales.total_refund)
        const bills = Math.round(numOf(sales.bill_count))
        const methods = sales.by_method
        const words = readAccountingSales(sales)
        const roundOffPaisa = words.roundOff == null ? 0 : Math.round(words.roundOff * 100)
        return {
          eyebrow: `${words.headlineLabel} · ${windowLabel}`,
          title: money(words.headlineValue),
          body: (
            <div>
              <SheetRow label="Gross sales" value={money(gross)} trailing={billsWord(bills)} />
              <SheetRow label="Refunds" value={refunds > 0 ? `− ${money(refunds)}` : money(0)} />
              <SheetRow label="Gross after refunds" value={money(sales.net_sales)} />
              <SheetRow label="Average bill" value={bills > 0 ? money(gross / bills) : "—"} />
              <SheetHead>What sits inside gross sales</SheetHead>
              <SheetRow label="Tax collected" value={money(sales.total_tax)} />
              <SheetRow label="Service charge" value={money(sales.total_service_charge)} />
              {roundOffPaisa !== 0 && (
                <SheetRow label="Round off" value={formatRoundOff(roundOffPaisa / 100, (n) => money(n))} />
              )}
              {words.netSales != null && <SheetRow label="Net sales" value={money(words.netSales)} />}
              <SheetNote>
                Gross sales is what guests actually paid, so it still carries both. The tax is
                pass-through — it is owed onward to the government. The service charge is NOT tax:
                the restaurant keeps it, and the reports count it as income.
              </SheetNote>
              <SheetNote>
                Net sales is the item total less discounts — before service charge, tax and round
                off, and before refunds — the figure the Sales Summary calls Net.
              </SheetNote>
              {methods.length > 0 && (
                <>
                  <SheetHead>By payment method</SheetHead>
                  {methods.map((m) => (
                    <SheetRow
                      key={m.method}
                      label={reportModeName(m)}
                      value={money(m.sales)}
                      trailing={billsWord(intOf(m.bills) ?? 0)}
                    />
                  ))}
                </>
              )}
            </div>
          ),
        }
      }

      case "tax": {
        const byRate = gst.by_rate
        const totalTax = numOf(gst.total_tax)
        // Only the sales report carries the refunded share. Both reports are
        // cut over the same settled bills in the same window, so the two
        // figures are describing the same money.
        const refundedTax = numOf(sales.total_refunded_tax)
        return {
          eyebrow: `Tax collected · ${windowLabel}`,
          title: money(totalTax),
          body: (
            <div>
              {byRate.length === 0 ? (
                <SheetNote>No tax was charged on any settled bill in this window.</SheetNote>
              ) : (
                byRate.map((t, i) => (
                  <SheetRow
                    key={`${t.name}-${String(t.percentage)}-${String(i)}`}
                    label={`${strOf(t.name, "Tax")} · ${numOf(t.percentage)}%`}
                    value={money(t.tax)}
                    trailing={`on ${money(t.taxable)}`}
                  />
                ))
              )}
              <SheetRow label="Total tax" value={money(totalTax)} />
              {refundedTax > 0 && (
                <>
                  <SheetRow label="Inside refunded bills" value={`− ${money(refundedTax)}`} />
                  <SheetRow label="Tax actually kept" value={money(totalTax - refundedTax)} />
                  <SheetNote>
                    A refund reverses a tax-inclusive amount, so that share of the tax was never the
                    restaurant&apos;s to remit.
                  </SheetNote>
                </>
              )}
              <SheetHead>Not tax — shown separately</SheetHead>
              <SheetRow label="Service charge" value={money(gst.total_service_charge)} />
              <SheetNote>
                The service charge is the restaurant&apos;s own income, not a levy collected for
                anyone else. It is deliberately kept out of every figure above and out of the GST
                breakdown on the page — booking it as tax would overstate what is owed and
                understate what was earned.
              </SheetNote>
              <SheetHead>Turnover</SheetHead>
              <SheetRow label="Taxable turnover (ex-tax)" value={money(gst.total_taxable)} />
            </div>
          ),
        }
      }

      case "expenses": {
        const byCat = pnl.expenses_by_category
        const total = numOf(pnl.total_expenses)
        return {
          eyebrow: `Expenses · ${windowLabel}`,
          title: money(total),
          body: (
            <div>
              {byCat.length === 0 ? (
                <SheetNote>Nothing was booked as an expense in this window.</SheetNote>
              ) : (
                byCat.map((c, i) => (
                  <SheetRow
                    key={`${c.category}-${String(i)}`}
                    label={strOf(c.category, "General")}
                    value={money(c.amount)}
                    trailing={total > 0 ? `${((numOf(c.amount) / total) * 100).toFixed(1)}%` : undefined}
                  />
                ))
              )}
              <SheetRow
                label="Total expenses"
                value={money(total)}
                trailing={`${expenses.length} entr${expenses.length === 1 ? "y" : "ies"}`}
              />
              <SheetNote>
                Salaries paid from the payroll section below are booked here automatically, under
                &quot;Payroll&quot;.
              </SheetNote>
            </div>
          ),
        }
      }

      case "net-profit": {
        const net = numOf(pnl.net_profit)
        return {
          eyebrow: `Net profit · ${windowLabel}`,
          title: money(net),
          body: (
            <div>
              <SheetRow label="Gross sales" value={money(pnl.gross_sales)} />
              <SheetRow label="Refunds" value={`− ${money(pnl.refunds)}`} />
              <SheetRow label="Tax kept out" value={`− ${money(pnl.tax_collected)}`} />
              <SheetRow label="Revenue ex-tax (after refunds)" value={money(pnl.net_revenue)} />
              <SheetRow label="Expenses" value={`− ${money(pnl.total_expenses)}`} />
              <SheetRow label="Net profit" value={money(net)} />
              <SheetHead>Read this carefully</SheetHead>
              <SheetRow label="Service charge earned" value={money(pnl.service_charge)} />
              <SheetNote>
                Tax is subtracted because it is pass-through — collected for the government, never
                revenue. The service charge is the opposite: it is NOT tax, it stays inside revenue
                above, and the line here is only telling you how much of that revenue it was.
              </SheetNote>
            </div>
          ),
        }
      }

      case "day": {
        // The `_barChart` drill: value, share, rank, total — the context a
        // bare bar cannot carry.
        const days = sales.by_day
        const d = drill.index >= 0 && drill.index < days.length ? days[drill.index] : undefined
        if (!d) { return { eyebrow: "Data point", title: "—", body: null } }
        const value = numOf(d.sales)
        const total = days.reduce((a, x) => a + numOf(x.sales), 0)
        const share = total > 0 ? (value / total) * 100 : 0
        const ranked = [...days].sort((a, b) => numOf(b.sales) - numOf(a.sales))
        const rank = ranked.findIndex((x) => x.date === d.date) + 1
        const pcs = d.date.split("-")
        const label = pcs.length === 3 ? `${pcs[2]}/${pcs[1]}` : d.date
        return {
          eyebrow: "Data point",
          title: label,
          body: (
            <div>
              <KvLine k="Value" v={moneyWhole(value)} />
              <KvLine k="Share of total" v={total > 0 ? `${share.toFixed(1)}%` : "—"} />
              <KvLine k="Rank" v={rank > 0 ? `${rank} of ${days.length}` : "—"} />
              <KvLine k="Total across all" v={moneyWhole(total)} />
            </div>
          ),
        }
      }

      case "method": {
        const m = drill.method
        const taken = numOf(m.sales)
        const bills = intOf(m.bills) ?? 0
        const total = numOf(sales.total_sales)
        return {
          eyebrow: `Payment method · ${windowLabel}`,
          title: reportModeName(m),
          body: (
            <div>
              <SheetRow label="Taken this way" value={money(taken)} />
              <SheetRow
                label="Share of gross sales"
                value={total > 0 ? `${((taken / total) * 100).toFixed(1)}%` : "—"}
              />
              <SheetRow label="Bills" value={`${bills}`} />
              <SheetRow label="Average bill" value={bills > 0 ? money(taken / bills) : "—"} />
              <SheetNote>
                The settled-bill list below can be filtered to this method to see the bills
                themselves.
              </SheetNote>
            </div>
          ),
        }
      }

      case "rate": {
        const t = drill.rate
        const tax = numOf(t.tax)
        const taxable = numOf(t.taxable)
        const totalTax = numOf(gst.total_tax)
        return {
          eyebrow: `Tax rate · ${windowLabel}`,
          title: `${strOf(t.name, "Tax")} · ${numOf(t.percentage)}%`,
          body: (
            <div>
              <SheetRow label="Taxable base" value={money(taxable)} />
              <SheetRow label="Rate" value={`${numOf(t.percentage)}%`} />
              <SheetRow label="Tax charged" value={money(tax)} />
              <SheetRow
                label="Share of all tax"
                value={totalTax > 0 ? `${((tax / totalTax) * 100).toFixed(1)}%` : "—"}
              />
              <SheetNote>
                This base excludes the service charge. That charge is the restaurant&apos;s income,
                not a taxable levy, and it is reported on its own line — never as a rate here.
              </SheetNote>
            </div>
          ),
        }
      }

      case "discounts": {
        const estimated = numOf(discounts?.estimated_bills)
        const given = numOf(discounts?.total_discount)
        const billCount = intOf(discounts?.bill_count) ?? 0
        const discounted = intOf(discounts?.discounted_bills) ?? 0
        const gift = numOf(discounts?.gift_redemption_total)
        const notes = (discounts?.notes ?? []).map((n) => strOf(n, "")).filter((n) => n !== "")
        return {
          eyebrow: `Discounts given · ${windowLabel}`,
          title: `${estimated > 0 ? "≈" : ""}${money(given)}`,
          body: (
            <div>
              <SheetRow label="Manual discounts" value={money(discounts?.manual_discount)} />
              <SheetRow label="Coupons & vouchers" value={money(discounts?.coupon_discount)} />
              <SheetRow label="Total given" value={money(given)} />
              <SheetHead>Reach</SheetHead>
              <SheetRow label="Bills discounted" value={`${discounted} of ${billCount}`} />
              <SheetRow
                label="Share of bills"
                value={billCount > 0 ? `${((discounted / billCount) * 100).toFixed(1)}%` : "—"}
              />
              <SheetRow label="Sales in the same window" value={money(discounts?.total_sales)} />
              {gift > 0 && <SheetRow label="Gift vouchers redeemed" value={money(gift)} />}
              {estimated > 0 && (
                <SheetNote>
                  {Math.round(estimated)} bill(s) stored the discount as a bare percentage, so the
                  money value is reconstructed and the totals above are approximate.
                </SheetNote>
              )}
              {/* "after", not "net of": Net is the defined word for the item
                  total less discounts (lib/gross-net.ts), and these bill totals
                  are Gross. */}
              <SheetNote>
                Bill totals are already stored after discount, so every sales, tax and profit figure
                on this page reflects these. Never subtract this again.
              </SheetNote>
              {notes.map((n, i) => (
                <SheetNote key={i}>{n}</SheetNote>
              ))}
            </div>
          ),
        }
      }

      case "coupon": {
        const c = drill.coupon
        const amount = numOf(c.amount)
        const uses = intOf(c.uses) ?? 0
        const total = numOf(discounts?.total_discount)
        return {
          eyebrow: `${c.kind === "gift" ? "Gift voucher" : "Coupon"} · ${windowLabel}`,
          title: strOf(c.code),
          body: (
            <div>
              <SheetRow label="Given away" value={money(amount)} />
              <SheetRow label="Times redeemed" value={`${uses}`} />
              <SheetRow label="Average per use" value={uses > 0 ? money(amount / uses) : "—"} />
              <SheetRow
                label="Share of all discount"
                value={total > 0 ? `${((amount / total) * 100).toFixed(1)}%` : "—"}
              />
            </div>
          ),
        }
      }

      case "expense": {
        const e = drill.expense
        const vendor = strOf(e.vendor, "")
        const note = strOf(e.note, "")
        const total = numOf(pnl.total_expenses)
        const amount = numOf(e.amount)
        const created = strOf(e.created_at, "")
        return {
          eyebrow: `Expense · ${strOf(e.category, "General")}`,
          title: money(amount),
          body: (
            <div>
              <SheetRow label="Category" value={strOf(e.category, "General")} />
              <SheetRow label="Spent on" value={strOf(e.spent_on)} />
              {vendor !== "" && <SheetRow label="Vendor" value={vendor} />}
              <SheetRow
                label="Share of expenses"
                value={total > 0 ? `${((amount / total) * 100).toFixed(1)}%` : "—"}
              />
              {created !== "" && <SheetRow label="Booked" value={shortTime(created, timezone)} />}
              {strOf((e as { created_by?: unknown }).created_by, "") !== "" && (
                <SheetRow label="Booked by" value={strOf((e as { created_by?: unknown }).created_by, "")} />
              )}
              {note !== "" && (
                <>
                  <SheetHead>Note</SheetHead>
                  <SheetNote>{note}</SheetNote>
                </>
              )}
              {/* Deleting stays on the row's own button. A sheet reached by
                  tapping a row must not put a destructive control under the
                  reading finger. */}
            </div>
          ),
        }
      }

      case "payroll": {
        const r = drill.row
        const prof = r.profile
        const hourly = prof?.pay_type === "hourly"
        const paid = r.paid
        const allowances = numOf(prof?.allowances)
        const deductions = numOf(prof?.deductions)
        const paidAt = strOf(r.paid_at, "")
        return {
          eyebrow: `Payroll · ${payrollMonth}`,
          title: strOf(r.name),
          body: (
            <div>
              <SheetRow label="Role" value={strOf(r.role)} />
              {prof == null ? (
                <SheetNote>
                  No salary is set for this employee, so nothing can be computed. Use &quot;Set
                  salary&quot; on the row to add one.
                </SheetNote>
              ) : (
                <>
                  <SheetRow label="Pay type" value={hourly ? "Hourly" : "Monthly"} />
                  {hourly ? (
                    <>
                      <SheetRow label="Rate" value={`${money(prof.hourly_rate)} / hour`} />
                      <SheetRow label="Hours worked" value={`${numOf(r.hours_worked)}`} />
                      <SheetRow label="Earned" value={money(numOf(prof.hourly_rate) * numOf(r.hours_worked))} />
                    </>
                  ) : (
                    <SheetRow label="Base salary" value={money(prof.base_salary)} />
                  )}
                  {allowances !== 0 && <SheetRow label="Allowances" value={`+ ${money(allowances)}`} />}
                  {deductions !== 0 && <SheetRow label="Deductions" value={`− ${money(deductions)}`} />}
                  <SheetRow
                    label={paid ? "Was due" : "Due now"}
                    value={r.computed_pay == null ? "—" : money(r.computed_pay)}
                  />
                </>
              )}
              <SheetHead>This month</SheetHead>
              <SheetRow label="Status" value={paid ? "Paid" : "Not paid yet"} />
              {paid && (
                <>
                  <SheetRow label="Paid" value={money(r.paid_amount)} />
                  {paidAt !== "" && <SheetRow label="Paid on" value={shortTime(paidAt, timezone)} />}
                </>
              )}
              <SheetNote>
                Recording a payment also books a &quot;Payroll&quot; expense, so it lands in the
                expense total and in net profit above.
              </SheetNote>
            </div>
          ),
        }
      }
    }
  })()

  return (
    <DrillSheet
      open
      onOpenChange={(open) => { if (!open) { onClose() } }}
      eyebrow={content.eyebrow}
      title={content.title}
    >
      {content.body}
    </DrillSheet>
  )
}
