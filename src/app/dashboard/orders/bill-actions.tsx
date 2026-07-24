"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Percent } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { setBillDiscount, splitBill, mergeTables, refundBill, getLoyalty, redeemLoyalty, type SplitPart, type LoyaltyAccount } from "@/lib/db"

type Which = null | "discount" | "split" | "merge" | "refund" | "loyalty"

// Per-table bill operations (discount / split / merge / refund). Self-contained so
// it can be dropped into the orders table without touching the page's state.
export function BillActions({
  restaurantId,
  tableName,
  isAdmin,
  onChanged,
}: {
  restaurantId: string
  tableName: string
  isAdmin: boolean
  onChanged: () => void
}) {
  const { toast } = useToast()
  const [dialog, setDialog] = useState<Which>(null)
  const [discountType, setDiscountType] = useState<"percent" | "flat">("percent")
  const [discountValue, setDiscountValue] = useState("")
  const [splitN, setSplitN] = useState("2")
  const [splitResult, setSplitResult] = useState<SplitPart[] | null>(null)
  const [mergeSrc, setMergeSrc] = useState("")
  const [refundReason, setRefundReason] = useState("")
  const [busy, setBusy] = useState(false)
  // Loyalty: look up a guest's balance by phone, then redeem points as a discount.
  const [loyaltyPhone, setLoyaltyPhone] = useState("")
  const [loyaltyAccount, setLoyaltyAccount] = useState<LoyaltyAccount | null>(null)
  const [loyaltyPoints, setLoyaltyPoints] = useState("")

  const close = () => { setDialog(null); setSplitResult(null); setLoyaltyAccount(null); setLoyaltyPoints("") }
  const fail = (e: unknown) => toast({ title: "Failed", description: String((e as Error)?.message ?? e), variant: "destructive" })

  const applyDiscount = async (clear: boolean) => {
    setBusy(true)
    try {
      const r = await setBillDiscount(restaurantId, tableName, discountType, clear ? 0 : Number(discountValue) || 0)
      if (r?.pending) {
        // Above the restaurant's approval threshold — parked for a manager.
        toast({ title: "Sent for approval", description: `This discount (≈${r.amount}) needs a manager's approval — it will apply once approved.` })
      } else {
        toast({ title: clear ? "Discount removed" : "Discount applied" })
      }
      onChanged(); close()
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  const doSplit = async () => {
    setBusy(true)
    try { const r = await splitBill(restaurantId, tableName, Number(splitN) || 2); setSplitResult(r.parts ?? []) }
    catch (e) { fail(e) } finally { setBusy(false) }
  }
  const doMerge = async () => {
    if (!mergeSrc.trim()) {return}
    setBusy(true)
    try { await mergeTables(restaurantId, mergeSrc.trim(), tableName); toast({ title: `Merged ${mergeSrc.trim()} into ${tableName}` }); onChanged(); close() }
    catch (e) { fail(e) } finally { setBusy(false) }
  }
  const doRefund = async () => {
    setBusy(true)
    try {
      const r = await refundBill(restaurantId, { table_name: tableName, reason: refundReason.trim() || undefined })
      toast({ title: `Refunded ${r.amount}`, description: r.gateway === "manual" ? "Process the Razorpay refund from your dashboard." : r.gateway === "failed" ? "Gateway refund failed — process it manually." : undefined })
      onChanged(); close()
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  const lookupLoyalty = async () => {
    if (!loyaltyPhone.trim()) {return}
    setBusy(true)
    try { setLoyaltyAccount(await getLoyalty(restaurantId, loyaltyPhone.trim())) }
    catch (e) { setLoyaltyAccount(null); fail(e) } finally { setBusy(false) }
  }
  const doRedeemLoyalty = async () => {
    const pts = Math.floor(Number(loyaltyPoints) || 0)
    if (!loyaltyAccount || pts <= 0) {return}
    setBusy(true)
    try {
      const r = await redeemLoyalty(restaurantId, { phone: loyaltyAccount.phone, points: pts, table_name: tableName })
      toast({ title: `Redeemed ${r.points} points`, description: `₹${r.discount} off applied to ${tableName} · ${r.balance} points left` })
      onChanged(); close()
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 gap-1 px-2">
            <Percent className="h-3.5 w-3.5" /> Bill
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => { setDialog("discount"); }}>Discount</DropdownMenuItem>
          <DropdownMenuItem onClick={() => { setDialog("loyalty"); }}>Loyalty</DropdownMenuItem>
          <DropdownMenuItem onClick={() => { setDialog("split"); }}>Split bill</DropdownMenuItem>
          <DropdownMenuItem onClick={() => { setDialog("merge"); }}>Merge a table in…</DropdownMenuItem>
          {isAdmin && <DropdownMenuItem onClick={() => { setDialog("refund"); }} className="text-red-600">Refund</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialog !== null} onOpenChange={(v) => { if (!v) {close()} }}>
        <DialogContent>
          {dialog === "discount" && (
            <>
              <DialogHeader><DialogTitle>Discount · Table {tableName}</DialogTitle></DialogHeader>
              <div className="flex gap-2">
                <Button variant={discountType === "percent" ? "default" : "outline"} size="sm" onClick={() => { setDiscountType("percent"); }}>% off</Button>
                <Button variant={discountType === "flat" ? "default" : "outline"} size="sm" onClick={() => { setDiscountType("flat"); }}>Flat</Button>
              </div>
              <Input type="number" placeholder={discountType === "percent" ? "Percent off (0–100)" : "Amount off"} value={discountValue} onChange={(e) => { setDiscountValue(e.target.value); }} />
              <DialogFooter>
                <Button variant="ghost" onClick={() => applyDiscount(true)} disabled={busy}>Remove</Button>
                <Button onClick={() => applyDiscount(false)} disabled={busy}>Apply</Button>
              </DialogFooter>
            </>
          )}
          {dialog === "split" && (
            <>
              <DialogHeader><DialogTitle>Split bill · Table {tableName}</DialogTitle></DialogHeader>
              {!splitResult ? (
                <>
                  <Label>Number of ways</Label>
                  <Input type="number" value={splitN} onChange={(e) => { setSplitN(e.target.value); }} />
                  <DialogFooter><Button onClick={doSplit} disabled={busy}>Split</Button></DialogFooter>
                </>
              ) : (
                <div className="space-y-1">
                  {splitResult.map((p, i) => (
                    <div key={i} className="flex justify-between rounded border p-2 text-sm">
                      <span>{p.label}</span><span className="font-semibold">{p.total}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {dialog === "merge" && (
            <>
              <DialogHeader><DialogTitle>Merge a table into {tableName}</DialogTitle></DialogHeader>
              <Label>Other table to merge in</Label>
              <Input value={mergeSrc} onChange={(e) => { setMergeSrc(e.target.value); }} placeholder="e.g. T2" />
              <DialogFooter><Button onClick={doMerge} disabled={busy}>Merge</Button></DialogFooter>
            </>
          )}
          {dialog === "loyalty" && (
            <>
              <DialogHeader><DialogTitle>Loyalty · Table {tableName}</DialogTitle></DialogHeader>
              <Label>Guest phone number</Label>
              <div className="flex gap-2">
                <Input value={loyaltyPhone} onChange={(e) => { setLoyaltyPhone(e.target.value); setLoyaltyAccount(null) }} placeholder="e.g. 9876543210" />
                <Button variant="outline" onClick={lookupLoyalty} disabled={busy || !loyaltyPhone.trim()}>Check</Button>
              </div>
              {loyaltyAccount && (
                <div className="space-y-2">
                  <div className="rounded border p-3 text-sm">
                    <div className="flex justify-between"><span>Points balance</span><span className="font-semibold">{loyaltyAccount.balance}</span></div>
                    <div className="flex justify-between text-muted-foreground"><span>Point value</span><span>₹{loyaltyAccount.point_value} each</span></div>
                    {loyaltyAccount.history.length > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">{loyaltyAccount.history.length} recent ledger entr{loyaltyAccount.history.length === 1 ? "y" : "ies"} · last: {loyaltyAccount.history[0].note ?? loyaltyAccount.history[0].kind}</p>
                    )}
                  </div>
                  <Label>Points to redeem</Label>
                  <Input type="number" min="0" value={loyaltyPoints} onChange={(e) => { setLoyaltyPoints(e.target.value); }} placeholder={`up to ${loyaltyAccount.balance}`} />
                  {Number(loyaltyPoints) > 0 && (
                    <p className="text-xs text-muted-foreground">= ₹{(Math.floor(Number(loyaltyPoints) || 0) * loyaltyAccount.point_value).toFixed(2)} off this bill</p>
                  )}
                  <DialogFooter>
                    <Button onClick={doRedeemLoyalty} disabled={busy || Math.floor(Number(loyaltyPoints) || 0) <= 0}>Redeem</Button>
                  </DialogFooter>
                </div>
              )}
            </>
          )}
          {dialog === "refund" && (
            <>
              <DialogHeader><DialogTitle>Refund · Table {tableName}</DialogTitle></DialogHeader>
              <p className="text-sm text-muted-foreground">Refunds the most recent settled bill for this table. This cannot be undone.</p>
              <Input value={refundReason} onChange={(e) => { setRefundReason(e.target.value); }} placeholder="Reason (optional)" />
              <DialogFooter><Button variant="destructive" onClick={doRefund} disabled={busy}>Refund</Button></DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
