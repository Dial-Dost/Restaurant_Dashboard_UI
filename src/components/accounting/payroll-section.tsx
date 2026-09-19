"use client"

// PAYROLL — web copy of the Flutter accounting page's payroll block
// (modules.dart 23262–23346): chevron month control in the section header, a
// one-line caption with Due/Paid, a single card of hairline-separated
// employee rows (avatar · "Name · Role" · one sub-line), and every row a tap
// target opening the pay-computation sheet. Editing and paying stay on their
// own buttons; paying is confirmed in a styled dialog, never window.confirm.
//
// Web-extra kept (audit 10.6): the per-month payroll CSV download.

import * as React from "react"
import { ChevronLeft, ChevronRight, Download, Pencil, Wallet } from "lucide-react"

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
import { SectionHeader } from "@/components/ui/section-header"
import { StatusChip } from "@/components/ui/status-chip"
import { useToast } from "@/hooks/use-toast"
import { Hairline, InitialsAvatar } from "@/components/accounting/bits"
import { SalaryDialog } from "@/components/accounting/dialogs"
import type { SalaryForm } from "@/components/accounting/dialogs"
import { initialsOf, strOf } from "@/components/accounting/format"
import { getPayrollCsv, payPayroll, setPayrollProfile } from "@/lib/db"
import type { PayrollData, PayrollRow } from "@/lib/db"

export function PayrollSection({
  rid,
  month,
  payroll,
  money,
  onShiftMonth,
  onOpenSheet,
  onChanged,
}: {
  rid: string
  month: string
  /** Null when /payroll failed — the caption still stands, the card hides. */
  payroll: PayrollData | null
  /** The 2-dp sheet voice. */
  money: (v: unknown) => string
  onShiftMonth: (delta: number) => void
  onOpenSheet: (row: PayrollRow) => void
  /** A write landed — the page refreshes the whole bundle (expenses/P&L move too). */
  onChanged: () => void
}): React.JSX.Element {
  const { toast } = useToast()
  const [editing, setEditing] = React.useState<PayrollRow | null>(null)
  const [paying, setPaying] = React.useState<PayrollRow | null>(null)
  const [busy, setBusy] = React.useState(false)

  const rows = payroll?.rows ?? []

  const failToast = (error: unknown): void => {
    toast({ title: String(error instanceof Error ? error.message : error), variant: "destructive" })
  }

  const saveProfile = async (row: PayrollRow, form: SalaryForm): Promise<void> => {
    setBusy(true)
    try {
      await setPayrollProfile(rid, {
        emp_id: row.emp_id,
        pay_type: form.pay_type,
        base_salary: form.base_salary,
        hourly_rate: form.hourly_rate,
        allowances: form.allowances,
        deductions: form.deductions,
        // Web-extra statutory percentages pass through untouched — the dialog
        // no longer edits them (Flutter has no such fields), but saving a
        // salary must not silently wipe a configured PF/ESI.
        pf_pct: row.profile?.pf_pct ?? 0,
        esi_pct: row.profile?.esi_pct ?? 0,
      })
      onChanged()
    } catch (error) {
      failToast(error)
    } finally {
      setBusy(false)
    }
  }

  const reallyPay = async (row: PayrollRow): Promise<void> => {
    if (row.computed_pay == null) { return }
    setBusy(true)
    try {
      await payPayroll(rid, { emp_id: row.emp_id, period: month, amount: row.computed_pay })
      toast({ title: "Salary recorded + Payroll expense booked." })
      onChanged()
    } catch (error) {
      failToast(error)
    } finally {
      setBusy(false)
    }
  }

  const exportCsv = async (): Promise<void> => {
    try {
      const csv = await getPayrollCsv(rid, month)
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
      const a = document.createElement("a")
      a.href = url
      a.download = `payroll_${month}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      failToast(error)
    }
  }

  return (
    <section>
      <SectionHeader
        title="Payroll"
        className="mb-1.5"
        trailing={
          <span className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Previous month"
              aria-label="Previous month"
              onClick={() => { onShiftMonth(-1) }}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-1 text-sm font-semibold tabular-nums">{month}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Next month"
              aria-label="Next month"
              onClick={() => { onShiftMonth(1) }}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { void exportCsv() }}
              disabled={rows.length === 0}
            >
              <Download /> CSV
            </Button>
          </span>
        }
      />
      <p className="text-xs text-muted-foreground">
        Due {money(payroll?.total_due)} · Paid {money(payroll?.total_paid)} — paying books a
        &quot;Payroll&quot; expense. Tap anyone for how their pay was worked out.
      </p>
      {rows.length > 0 && (
        <ForkCard className="mt-3.5 py-1.5">
          {rows.map((r, i) => {
            const prof = r.profile
            const hourly = prof?.pay_type === "hourly"
            const pay = r.computed_pay
            return (
              <React.Fragment key={r.emp_id}>
                {i > 0 && <Hairline />}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => { onOpenSheet(r) }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      onOpenSheet(r)
                    }
                  }}
                  className="flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 rounded-[6px] py-2 text-left transition-colors duration-fast hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <InitialsAvatar initials={initialsOf(r.name)} />
                  <span className="min-w-0 flex-1 basis-40">
                    <span className="block truncate text-[13.5px] font-semibold text-foreground">
                      {strOf(r.name)} · {strOf(r.role)}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {prof == null
                        ? "No salary set"
                        : hourly
                          ? `${money(prof.hourly_rate)}/h · ${r.hours_worked}h worked`
                          : `Monthly ${money(prof.base_salary)}`}
                    </span>
                  </span>
                  <span
                    className="flex flex-wrap items-center justify-end gap-2"
                    onClick={(e) => { e.stopPropagation() }}
                    onKeyDown={(e) => { e.stopPropagation() }}
                  >
                    {r.paid ? (
                      <StatusChip status="success" label={`Paid ${money(r.paid_amount)}`} dense />
                    ) : (
                      <>
                        <span className="text-[13.5px] font-semibold tabular-nums">
                          {pay != null ? money(pay) : "—"}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Set salary"
                          aria-label="Set salary"
                          onClick={() => { setEditing(r) }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {pay != null && pay > 0 && (
                          <Button size="sm" disabled={busy} onClick={() => { setPaying(r) }}>
                            <Wallet /> Pay
                          </Button>
                        )}
                      </>
                    )}
                  </span>
                </div>
              </React.Fragment>
            )
          })}
        </ForkCard>
      )}

      <SalaryDialog
        row={editing}
        onOpenChange={(open) => { if (!open) { setEditing(null) } }}
        onSave={(form) => {
          const target = editing
          setEditing(null)
          if (target) { void saveProfile(target, form) }
        }}
      />

      {/* "Record salary payment" — the styled confirm (Flutter `_payEmployee`). */}
      <AlertDialog open={paying != null} onOpenChange={(open) => { if (!open) { setPaying(null) } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Record salary payment</AlertDialogTitle>
            <AlertDialogDescription>
              Pay {money(paying?.computed_pay)} to {strOf(paying?.name)} for {month}?
              <br />
              <br />
              This also books a &quot;Payroll&quot; expense.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = paying
                setPaying(null)
                if (target) { void reallyPay(target) }
              }}
            >
              Pay
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
