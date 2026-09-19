"use client"

// MOVE A SETTLED BILL TO ANOTHER TILL — Flutter `misBillCounterAction` on the
// closed-bill detail (mis-capture finding 36, client item 8: Accounting only).
//
// "If this sale was rung on the wrong terminal, move it…" A cash-up will not
// balance until a mis-attributed bill is moved, so the route accepts a CLOSED
// bill: POST /bills/counter { bill_id, counter_id? }. An omitted counter clears
// the attribution back to "this outlet's single till".
//
// Gated on the SAME permission the route checks (Record Payment) and hidden,
// not greyed, when the outlet has no tills — with none configured there is
// nowhere to move a bill to, and that is the normal state.

import { useEffect, useState, type ReactElement } from "react"
import { ArrowRightLeft, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/context/AuthContext"
import { getBillingCounters, setBillCounter } from "@/lib/db"
import { hasPermission, PERM_RECORD_PAYMENT, type BillingCounterRecord } from "@/lib/mis-capture"

const NO_COUNTER = "__none__"

/** The route's own gate (`validateAction` on POST /bills/counter). */
export const canMoveBillTill = (session: { actions_set?: unknown } | null | undefined): boolean =>
  hasPermission(session?.actions_set, PERM_RECORD_PAYMENT)

export function MoveBillTillButton({
  restaurantId,
  billId,
  billLabel,
  currentCounterId,
  onMoved,
}: {
  restaurantId: string
  billId: string
  billLabel: string
  /** When the detail carries it, the till the bill is on now. */
  currentCounterId?: string | null
  onMoved: () => void
}): ReactElement | null {
  const { user } = useAuth()
  const { toast } = useToast()
  const allowed = canMoveBillTill(user)
  // null = not read yet or the read failed; [] = none configured (normal).
  const [counters, setCounters] = useState<BillingCounterRecord[] | null>(null)
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [choice, setChoice] = useState<string>(currentCounterId ?? NO_COUNTER)

  useEffect(() => {
    if (!allowed || restaurantId === "") {return}
    let live = true
    // Every till, retired ones marked — a bill may belong on one that has since
    // been retired, and the cash-up it balances is from before that.
    void getBillingCounters(restaurantId, true).then((rows) => { if (live) {setCounters(rows)} })
    return () => { live = false }
  }, [allowed, restaurantId])

  useEffect(() => { setChoice(currentCounterId ?? NO_COUNTER) }, [billId, currentCounterId])

  if (!allowed || counters === null || counters.length === 0) {return null}

  const chosen = counters.find((c) => c.id === choice)
  const chosenLabel = chosen ? `${chosen.code} — ${chosen.name}` : "this outlet's single till"

  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await setBillCounter(restaurantId, { bill_id: billId }, choice === NO_COUNTER ? null : choice)
      toast({
        title: r.counter_id ? `Moved to ${chosenLabel}` : "Attribution cleared",
        description: r.counter_id
          ? "This bill now counts towards that till on the Counter Summary."
          : "This bill counts as this outlet's single till.",
      })
      setConfirming(false)
      setOpen(false)
      onMoved()
    } catch (e) {
      toast({ title: "Not moved", description: e instanceof Error ? e.message : String(e), variant: "destructive" })
    } finally { setBusy(false) }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { setOpen(true) }}>
        <ArrowRightLeft className="mr-2 h-4 w-4" />
        Move to another till
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (!busy) {setOpen(v)} }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Move {billLabel} to another till</DialogTitle>
            <DialogDescription>
              If this sale was rung on the wrong terminal, move it — the cash-up it belongs to will not
              balance until it is.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Till</Label>
            <Select value={choice} onValueChange={setChoice}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_COUNTER}>This outlet&apos;s single till (no counter)</SelectItem>
                {counters.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.code} — {c.name}{c.active ? "" : " (retired)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setOpen(false) }} disabled={busy}>Cancel</Button>
            <Button onClick={() => { setConfirming(true) }} disabled={busy}>Move bill…</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirming} onOpenChange={(v) => { if (!busy) {setConfirming(v)} }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move {billLabel} to {chosenLabel}?</AlertDialogTitle>
            <AlertDialogDescription>
              The bill&apos;s figures do not change — only which till&apos;s cash-up it counts towards. The move
              is recorded in the audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => { e.preventDefault(); void submit() }}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Move bill
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
