"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import QRCode from "qrcode"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Bell, Check, RefreshCw, UserX, X, Clock, Users, QrCode, Printer, Download, ChevronDown, ChevronUp } from "lucide-react"
import { useAuth } from "@/context/AuthContext"
import { useCurrency } from "@/hooks/use-currency"
import { useToast } from "@/hooks/use-toast"
import { getWaitlist, callWaitlistEntry, seatWaitlistEntry, cancelWaitlistEntry, getTables, type WaitlistEntry } from "@/lib/db"
import { getSelectedOutletId } from "@/lib/outlet"
import { type Table } from "@/app/dashboard/tables/data"

export default function WaitlistPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const { currencySymbol } = useCurrency()
  const rid = user?.restaurantUsername ?? ""

  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<WaitlistEntry[]>([])
  const [tables, setTables] = useState<Table[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [seatPick, setSeatPick] = useState<Record<string, string>>({})
  // Which queued rows have their pre-order / party-member detail expanded.
  // Kept at page level so the 8s poll re-render doesn't collapse open rows.
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({})

  const freeTables = useMemo(() => tables.filter((t) => t.status === "Available").map((t) => t.name), [tables])

  const load = useCallback(async () => {
    if (!rid) {return}
    try {
      const [w, t] = await Promise.all([getWaitlist(rid), getTables(rid).catch(() => [] as Table[])])
      setEntries(w)
      setTables(t)
    } finally {
      setLoading(false)
    }
  }, [rid])

  useEffect(() => { void load() }, [load])
  // Live-ish: poll while the page is open (also covers the realtime waitlist:updated events).
  useEffect(() => {
    const id = setInterval(() => { void load() }, 8000)
    return () => { clearInterval(id); }
  }, [load])

  // Entrance "Join the queue" QR: encodes this dashboard's own /queue/<slug> URL
  // (with the selected outlet for multi-outlet) so the restaurant can print it and
  // display it at the door. This is how a guest gets INTO the queue when tables are full.
  const [qrUrl, setQrUrl] = useState("")
  const [qrPng, setQrPng] = useState("")
  useEffect(() => {
    if (!rid || typeof window === "undefined") {return}
    const outlet = getSelectedOutletId()
    const url = `${window.location.origin}/queue/${encodeURIComponent(rid)}${outlet ? `?outlet=${encodeURIComponent(outlet)}` : ""}`
    setQrUrl(url)
    QRCode.toDataURL(url, { width: 512, margin: 2 }).then(setQrPng).catch(() => { setQrPng(""); })
  }, [rid])

  const downloadQr = () => {
    if (!qrPng) {return}
    const a = document.createElement("a")
    a.href = qrPng
    a.download = `queue-qr-${rid || "restaurant"}.png`
    a.click()
  }
  const printQr = () => {
    if (!qrPng) {return}
    const w = window.open("", "_blank", "width=520,height=680")
    if (!w) { toast({ title: "Pop-up blocked", description: "Allow pop-ups to print, or use Download.", variant: "destructive" }); return }
    const name = user?.restaurantName ?? "our restaurant"
    w.document.write(`<!doctype html><html><head><title>Join the queue</title></head>
      <body style="font-family:system-ui,sans-serif;text-align:center;padding:40px;color:#111">
        <h1 style="margin:0 0 6px;font-size:26px">Tables full? Join the queue</h1>
        <p style="margin:0 0 4px;color:#555">at ${name}</p>
        <p style="margin:0 0 20px;color:#555">Scan to add yourself to the waitlist — you'll be alerted when your table is ready.</p>
        <img src="${qrPng}" style="width:340px;height:340px"/>
        <p style="margin-top:20px;font-size:11px;color:#999;word-break:break-all">${qrUrl}</p>
      </body></html>`)
    w.document.close(); w.focus()
    setTimeout(() => { try { w.print() } catch { /* ignore */ } }, 300)
  }

  const act = async (id: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusyId(id)
    try {
      await fn()
      if (ok) {toast({ title: ok })}
      await load()
    } catch (e: any) {
      toast({ title: "Action failed", description: String(e?.message ?? e), variant: "destructive" })
    } finally {
      setBusyId(null)
    }
  }

  const seat = (entry: WaitlistEntry) => {
    const table = seatPick[entry.id] || freeTables[0]
    if (!table) { toast({ title: "No free table", description: "Free a table first, then seat the party.", variant: "destructive" }); return }
    void act(entry.id, async () => {
      const r: any = await seatWaitlistEntry(rid, entry.id, table)
      toast({ title: `Seated at ${table}`, description: r?.placed_order_id ? "Their pre-order was sent to the kitchen." : undefined })
    })
  }

  const waiting = entries.filter((e) => e.status === "waiting")
  const called = entries.filter((e) => e.status === "called")

  const money = (n: number) => `${currencySymbol}${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`

  const Row = ({ e }: { e: WaitlistEntry }) => {
    const open = !!openRows[e.id]
    const pre = e.pre_order ?? []
    const members = e.party_members ?? []
    const preTotal = pre.reduce((s, it) => s + Number(it.price || 0) * Number(it.quantity || 0), 0)
    const hasDetails = pre.length > 0 || members.length > 0
    return (
      <div className="rounded-lg border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            {e.status === "waiting"
              ? <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">#{e.position}</span>
              : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-700"><Bell className="h-4 w-4" /></span>}
            <div>
              <div className="font-medium">{e.name}</div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> {e.party_size}</span>
                <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {e.minutes_waiting}m</span>
                {e.phone ? <span>{e.phone}</span> : null}
                {pre.length ? <span className="rounded bg-green-100 px-1.5 text-green-700">{pre.length}-item pre-order</span> : null}
                {members.length ? <span className="rounded bg-blue-100 px-1.5 text-blue-700">{members.length} in party</span> : null}
                {hasDetails ? (
                  <button
                    type="button"
                    onClick={() => { setOpenRows((p) => ({ ...p, [e.id]: !open })); }}
                    className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                    aria-expanded={open}
                  >
                    {open ? <>Hide <ChevronUp className="h-3 w-3" /></> : <>Details <ChevronDown className="h-3 w-3" /></>}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {e.status === "waiting" && (
              <Button size="sm" variant="outline" disabled={busyId === e.id} onClick={() => act(e.id, () => callWaitlistEntry(rid, e.id), `Notified ${e.name}`)}>
                <Bell className="mr-1 h-4 w-4" /> Call
              </Button>
            )}
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={seatPick[e.id] ?? ""}
              onChange={(ev) => { setSeatPick((p) => ({ ...p, [e.id]: ev.target.value })); }}
            >
              <option value="">{freeTables.length ? "Table…" : "No free tables"}</option>
              {freeTables.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <Button size="sm" disabled={busyId === e.id || freeTables.length === 0} onClick={() => { seat(e); }}>
              <Check className="mr-1 h-4 w-4" /> Seat
            </Button>
            <Button size="sm" variant="ghost" disabled={busyId === e.id} onClick={() => act(e.id, () => cancelWaitlistEntry(rid, e.id, "no_show"))} title="No-show">
              <UserX className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive" disabled={busyId === e.id} onClick={() => act(e.id, () => cancelWaitlistEntry(rid, e.id, "cancelled"))} title="Remove">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {open && hasDetails && (
          <div className="mt-3 grid gap-4 border-t pt-3 sm:grid-cols-2">
            {pre.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pre-order</div>
                <ul className="space-y-1">
                  {pre.map((it) => (
                    <li key={it.id} className="flex justify-between gap-2 text-sm">
                      <span>
                        {it.name} <span className="text-muted-foreground">×{it.quantity}</span>
                        {it.note ? <span className="block text-xs italic text-muted-foreground">“{it.note}”</span> : null}
                      </span>
                      <span className="whitespace-nowrap tabular-nums text-muted-foreground">{money(Number(it.price || 0) * Number(it.quantity || 0))}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-1 flex justify-between border-t pt-1 text-sm font-medium">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{money(preTotal)}</span>
                </div>
              </div>
            )}
            {members.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Party members</div>
                <ul className="space-y-1">
                  {members.map((m, i) => (
                    <li key={`${e.id}-m${i}`} className="flex justify-between gap-2 text-sm">
                      <span>{m.name || "Guest"}</span>
                      {m.phone ? <span className="whitespace-nowrap text-muted-foreground">{m.phone}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6 p-1">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Waitlist</h1>
          <p className="text-sm text-muted-foreground">Walk-in parties waiting for a table. Call them when ready, then seat them — their pre-order is sent to the kitchen automatically.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {called.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Called — heading over</CardTitle><CardDescription>Notified; seat them when they arrive.</CardDescription></CardHeader>
          <CardContent className="space-y-2">{called.map((e) => <Row key={e.id} e={e} />)}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Waiting ({waiting.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {waiting.length === 0
            ? <p className="py-6 text-center text-sm text-muted-foreground">{loading ? "Loading…" : "No one in the queue right now."}</p>
            : waiting.map((e) => <Row key={e.id} e={e} />)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><QrCode className="h-4 w-4" /> Entrance “Join the queue” QR</CardTitle>
          <CardDescription>Print this and display it at your door. When all tables are full, guests scan it to add themselves to this waitlist (and can browse the menu + pre-order while they wait).</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          {qrPng
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={qrPng} alt="Queue QR code" className="h-44 w-44 rounded-md border bg-white p-2" />
            : <div className="flex h-44 w-44 items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">Generating…</div>}
          <div className="space-y-3 text-center sm:text-left">
            <p className="text-sm text-muted-foreground break-all">Links to <code>{qrUrl || `/queue/${rid || "your-restaurant"}`}</code></p>
            <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
              <Button size="sm" onClick={printQr} disabled={!qrPng}><Printer className="mr-1 h-4 w-4" /> Print</Button>
              <Button size="sm" variant="outline" onClick={downloadQr} disabled={!qrPng}><Download className="mr-1 h-4 w-4" /> Download PNG</Button>
            </div>
            <p className="text-xs text-muted-foreground">Multi-outlet: switch outlets in the top bar and the QR re-targets that branch’s queue.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
