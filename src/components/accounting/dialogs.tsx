"use client"

// The Accounting page's two form dialogs — web copies of Flutter's
// `_addExpense` and `_editPayrollProfile` AlertDialogs (modules.dart
// 22389–22512). Both are modal dialogs, not inline forms: the section header's
// own button opens them, and Cancel walks away without touching anything.

import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import type { PayrollRow } from "@/lib/db"

/* ── Add expense ───────────────────────────────────────────────────────── */

export interface NewExpenseForm {
  category: string
  amount: number
  vendor?: string
  note?: string
}

export function AddExpenseDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (form: NewExpenseForm) => void
}): React.JSX.Element {
  const { toast } = useToast()
  const [category, setCategory] = React.useState("General")
  const [amount, setAmount] = React.useState("")
  const [vendor, setVendor] = React.useState("")
  const [note, setNote] = React.useState("")

  // Fresh form each time it opens (the Flutter dialog builds new controllers).
  React.useEffect(() => {
    if (open) {
      setCategory("General")
      setAmount("")
      setVendor("")
      setNote("")
    }
  }, [open])

  const add = (): void => {
    const amt = Number(amount.trim())
    if (!Number.isFinite(amt) || amt <= 0) {
      toast({ title: "Enter a valid amount.", variant: "destructive" })
      return
    }
    onOpenChange(false)
    onSubmit({
      category: category.trim() === "" ? "General" : category.trim(),
      amount: amt,
      vendor: vendor.trim() === "" ? undefined : vendor.trim(),
      note: note.trim() === "" ? undefined : note.trim(),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add expense</DialogTitle>
          <DialogDescription className="sr-only">Book an operating cost.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="expense-category">Category</Label>
            <Input
              id="expense-category"
              value={category}
              onChange={(e) => { setCategory(e.target.value) }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="expense-amount">Amount</Label>
            <Input
              id="expense-amount"
              autoFocus
              type="number"
              inputMode="decimal"
              min="0"
              value={amount}
              onChange={(e) => { setAmount(e.target.value) }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="expense-vendor">Vendor (optional)</Label>
            <Input
              id="expense-vendor"
              value={vendor}
              onChange={(e) => { setVendor(e.target.value) }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="expense-note">Note (optional)</Label>
            <Input id="expense-note" value={note} onChange={(e) => { setNote(e.target.value) }} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { onOpenChange(false) }}>Cancel</Button>
          <Button onClick={add}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Salary editor ─────────────────────────────────────────────────────── */

export interface SalaryForm {
  pay_type: "monthly" | "hourly"
  base_salary: number
  hourly_rate: number
  allowances: number
  deductions: number
}

/**
 * "Salary — <name>": pay type, then base salary OR hourly rate, allowances,
 * deductions — Flutter's four fields exactly. The web-extra PF/ESI percentages
 * are no longer edited here; existing values pass through untouched (the page
 * merges them back into the PUT).
 */
export function SalaryDialog({
  row,
  onOpenChange,
  onSave,
}: {
  /** The employee being edited; null = closed. */
  row: PayrollRow | null
  onOpenChange: (open: boolean) => void
  onSave: (form: SalaryForm) => void
}): React.JSX.Element {
  const [payType, setPayType] = React.useState<"monthly" | "hourly">("monthly")
  const [base, setBase] = React.useState("")
  const [rate, setRate] = React.useState("")
  const [allowances, setAllowances] = React.useState("")
  const [deductions, setDeductions] = React.useState("")

  const open = row != null
  const empId = row?.emp_id ?? null
  React.useEffect(() => {
    if (row == null) { return }
    const prof = row.profile
    setPayType(prof?.pay_type === "hourly" ? "hourly" : "monthly")
    setBase(prof?.base_salary != null ? String(prof.base_salary) : "")
    setRate(prof?.hourly_rate != null ? String(prof.hourly_rate) : "")
    setAllowances(prof?.allowances != null ? String(prof.allowances) : "")
    setDeductions(prof?.deductions != null ? String(prof.deductions) : "")
    // Re-seed when the dialog opens (fresh controllers, like the app), not on
    // every parent render while it is up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, empId])

  const num = (s: string): number => {
    const n = Number(s.trim())
    return Number.isFinite(n) ? n : 0
  }

  const save = (): void => {
    onOpenChange(false)
    onSave({
      pay_type: payType,
      base_salary: num(base),
      hourly_rate: num(rate),
      allowances: num(allowances),
      deductions: num(deductions),
    })
  }

  return (
    <Dialog open={row != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Salary — {row?.name ?? ""}</DialogTitle>
          <DialogDescription className="sr-only">
            Set how this employee&apos;s pay is computed.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Pay type</Label>
            <Select
              value={payType}
              onValueChange={(v) => { setPayType(v === "hourly" ? "hourly" : "monthly") }}
            >
              <SelectTrigger aria-label="Pay type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly salary</SelectItem>
                <SelectItem value="hourly">Hourly (from attendance)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {payType === "monthly" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="salary-base">Base salary / month</Label>
              <Input
                id="salary-base"
                type="number"
                inputMode="decimal"
                min="0"
                value={base}
                onChange={(e) => { setBase(e.target.value) }}
              />
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="salary-rate">Rate / hour</Label>
              <Input
                id="salary-rate"
                type="number"
                inputMode="decimal"
                min="0"
                value={rate}
                onChange={(e) => { setRate(e.target.value) }}
              />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="salary-allowances">Allowances / month</Label>
            <Input
              id="salary-allowances"
              type="number"
              inputMode="decimal"
              min="0"
              value={allowances}
              onChange={(e) => { setAllowances(e.target.value) }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="salary-deductions">Deductions / month</Label>
            <Input
              id="salary-deductions"
              type="number"
              inputMode="decimal"
              min="0"
              value={deductions}
              onChange={(e) => { setDeductions(e.target.value) }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { onOpenChange(false) }}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
