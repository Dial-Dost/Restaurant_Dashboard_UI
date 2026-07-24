"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Lock, Unlock, RefreshCw } from "lucide-react"
import { useAuth } from "@/context/AuthContext"
import { useCurrency } from "@/hooks/use-currency"
import { useToast } from "@/hooks/use-toast"
import {
  getCurrentCashSession, getCashSessions, openCashSession, closeCashSession,
  type CashSession, type CurrentCashSession,
} from "@/lib/db"

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function fmtTime(iso: string | null): string {
  if (!iso) {return "—"}
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString()
}

export default function CashPage() {
  const { user } = useAuth()
  const { currency } = useCurrency()
  const { toast } = useToast()
  const rid = user?.restaurantUsername ?? ""

  const [loading, setLoading] = useState(true)
  const [current, setCurrent] = useState<CurrentCashSession | null>(null)
  const [history, setHistory] = useState<CashSession[]>([])
  const [from, setFrom] = useState(() => isoDaysAgo(29))
  const [to, setTo] = useState(() => isoDaysAgo(0))

  // Forms
  const [openingFloat, setOpeningFloat] = useState("")
  const [countedCash, setCountedCash] = useState("")
  const [payouts, setPayouts] = useState("")
  const [notes, setNotes] = useState("")
  const [busy, setBusy] = useState(false)

  const money = (n: number | null | undefined) => `${currency}${Number(n ?? 0).toFixed(2)}`

  const load = useCallback(async () => {
    if (!rid) {return}
    setLoading(true)
    try {
      const [cur, hist] = await Promise.all([
        getCurrentCashSession(rid),
        getCashSessions(rid, from, to),
      ])
      setCurrent(cur?.session ?? null)
      setHistory(hist?.sessions ?? [])
    } finally {
      setLoading(false)
    }
  }, [rid, from, to])

  useEffect(() => { void load() }, [load])

  const onOpen = async () => {
    const f = Number(openingFloat || 0)
    if (!(f >= 0)) { toast({ title: "Enter a valid opening float", variant: "destructive" }); return }
    setBusy(true)
    try {
      await openCashSession(rid, f)
      setOpeningFloat("")
      toast({ title: "Register opened", description: `Opening float ${money(f)}` })
      await load()
    } catch (e: any) {
      toast({ title: "Could not open register", description: String(e?.message ?? e), variant: "destructive" })
    } finally { setBusy(false) }
  }

  const onClose = async () => {
    const counted = Number(countedCash)
    if (!Number.isFinite(counted) || counted < 0) { toast({ title: "Enter the counted cash", variant: "destructive" }); return }
    setBusy(true)
    try {
      const closed = await closeCashSession(rid, {
        counted_cash: counted,
        cash_payouts: Number(payouts || 0) || 0,
        notes: notes.trim() || undefined,
      })
      setCountedCash(""); setPayouts(""); setNotes("")
      const v = closed.variance ?? 0
      toast({
        title: "Register closed",
        description: v === 0 ? "Drawer balanced exactly 🎯" : `Variance ${money(v)} (${v > 0 ? "over" : "short"})`,
        variant: v === 0 ? undefined : "destructive",
      })
      await load()
    } catch (e: any) {
      toast({ title: "Could not close register", description: String(e?.message ?? e), variant: "destructive" })
    } finally { setBusy(false) }
  }

  const expectedNow = current?.live_expected ?? 0
  const countedPreview = Number(countedCash || 0) - Number(payouts || 0)
  const variancePreview = countedCash === "" ? null : Number((Number(countedCash || 0) - (expectedNow - (Number(payouts || 0)))).toFixed(2))

  return (
    <div className="space-y-6 p-1">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cash register</h1>
          <p className="text-sm text-muted-foreground">Open a drawer with a float, then count down at end of shift to see the variance.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {!current ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Unlock className="h-5 w-5" /> Open register</CardTitle>
            <CardDescription>No register is currently open for this outlet. Enter the starting cash float to begin a session.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="float">Opening float ({currency})</Label>
              <Input id="float" type="number" inputMode="decimal" className="w-48" placeholder="0.00"
                value={openingFloat} onChange={(e) => { setOpeningFloat(e.target.value); }} />
            </div>
            <Button onClick={onOpen} disabled={busy}><Unlock className="mr-2 h-4 w-4" /> Open register</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Unlock className="h-5 w-5 text-green-600" /> Open since {fmtTime(current.opened_at)}</CardTitle>
              <CardDescription>Live drawer position{current.opened_by ? ` · opened by ${current.opened_by}` : ""}.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Opening float" value={money(current.opening_float)} />
              <Row label="Cash sales (settled)" value={money(current.live_cash_sales)} />
              <Row label="Cash refunds" value={`- ${money(current.live_cash_refunds)}`} />
              <div className="my-2 border-t" />
              <Row label="Expected in drawer" value={money(expectedNow)} strong />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Lock className="h-5 w-5" /> Close & count down</CardTitle>
              <CardDescription>Count the physical cash, record any cash paid out, then close to lock the Z-report.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="counted">Counted cash ({currency})</Label>
                  <Input id="counted" type="number" inputMode="decimal" placeholder="0.00"
                    value={countedCash} onChange={(e) => { setCountedCash(e.target.value); }} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="payouts">Cash paid out ({currency})</Label>
                  <Input id="payouts" type="number" inputMode="decimal" placeholder="0.00"
                    value={payouts} onChange={(e) => { setPayouts(e.target.value); }} />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="notes">Notes (optional)</Label>
                <Input id="notes" placeholder="e.g. ₹200 short, gave change from till" value={notes} onChange={(e) => { setNotes(e.target.value); }} />
              </div>
              {variancePreview !== null && (
                <div className={`rounded-md px-3 py-2 text-sm font-medium ${variancePreview === 0 ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-900"}`}>
                  Projected variance: {money(variancePreview)} {variancePreview === 0 ? "(balanced)" : variancePreview > 0 ? "(over)" : "(short)"}
                </div>
              )}
              <Button onClick={onClose} disabled={busy} className="w-full"><Lock className="mr-2 h-4 w-4" /> Close register</Button>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Past sessions</CardTitle>
            <CardDescription>Closed registers with their cash variance (Z-reports).</CardDescription>
          </div>
          <div className="flex items-end gap-2">
            <Input type="date" className="w-36" value={from} onChange={(e) => { setFrom(e.target.value); }} />
            <Input type="date" className="w-36" value={to} onChange={(e) => { setTo(e.target.value); }} />
          </div>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{loading ? "Loading…" : "No closed sessions in this range."}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 pr-3">Opened</th>
                    <th className="py-2 pr-3">Closed</th>
                    <th className="py-2 pr-3 text-right">Float</th>
                    <th className="py-2 pr-3 text-right">Cash sales</th>
                    <th className="py-2 pr-3 text-right">Expected</th>
                    <th className="py-2 pr-3 text-right">Counted</th>
                    <th className="py-2 pr-3 text-right">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {history.filter((s) => s.status === "closed").map((s) => {
                    const v = s.variance ?? 0
                    return (
                      <tr key={s.id} className="border-b last:border-0">
                        <td className="py-2 pr-3 whitespace-nowrap">{fmtTime(s.opened_at)}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{fmtTime(s.closed_at)}</td>
                        <td className="py-2 pr-3 text-right">{money(s.opening_float)}</td>
                        <td className="py-2 pr-3 text-right">{money(s.cash_sales)}</td>
                        <td className="py-2 pr-3 text-right">{money(s.expected_cash)}</td>
                        <td className="py-2 pr-3 text-right">{money(s.counted_cash)}</td>
                        <td className={`py-2 pr-3 text-right font-medium ${v === 0 ? "text-green-600" : "text-amber-700"}`}>{money(v)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "text-base font-bold" : ""}>{value}</span>
    </div>
  )
}
