"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Plus, Trash2, PackageCheck, Send, X, RefreshCw } from "lucide-react"
import { useAuth } from "@/context/AuthContext"
import { useCurrency } from "@/hooks/use-currency"
import { useToast } from "@/hooks/use-toast"
import {
  getPurchaseOrders, createPurchaseOrder, setPurchaseOrderStatus, receivePurchaseOrder, deletePurchaseOrder,
  getVendors, getInventory,
  type PurchaseOrder, type Vendor,
} from "@/lib/db"
import { type InventoryItem } from "@/app/dashboard/inventory/page"

interface DraftLine { inventory_id: string; name: string; qty_ordered: number; unit_cost: number }

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  ordered: "bg-blue-100 text-blue-800",
  received: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-700",
}

export default function PurchaseOrdersPage() {
  const { user } = useAuth()
  const { currency } = useCurrency()
  const { toast } = useToast()
  const rid = user?.restaurantUsername ?? ""

  const [loading, setLoading] = useState(true)
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [statusFilter, setStatusFilter] = useState<string>("")

  // New-PO form
  const [vendorId, setVendorId] = useState("")
  const [expected, setExpected] = useState("")
  const [notes, setNotes] = useState("")
  const [lines, setLines] = useState<DraftLine[]>([])
  const [pickItem, setPickItem] = useState("")
  const [pickQty, setPickQty] = useState("")
  const [pickCost, setPickCost] = useState("")
  const [saving, setSaving] = useState(false)

  // Receiving
  const [receivingId, setReceivingId] = useState<string | null>(null)
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({})
  const [receiveRating, setReceiveRating] = useState<string>("")
  const [busyId, setBusyId] = useState<string | null>(null)

  const money = (n: number | null | undefined) => `${currency}${Number(n ?? 0).toFixed(2)}`

  const load = useCallback(async () => {
    if (!rid) {return}
    setLoading(true)
    try {
      const [pos, vs, inv] = await Promise.all([
        getPurchaseOrders(rid, statusFilter ? { status: statusFilter } : undefined),
        getVendors(rid).catch(() => [] as Vendor[]),
        getInventory(rid).catch(() => [] as InventoryItem[]),
      ])
      setOrders(pos)
      setVendors(vs)
      setInventory(inv)
    } finally {
      setLoading(false)
    }
  }, [rid, statusFilter])

  useEffect(() => { void load() }, [load])

  const draftTotal = useMemo(() => lines.reduce((s, l) => s + l.qty_ordered * l.unit_cost, 0), [lines])

  const addLine = () => {
    const item = inventory.find((i) => i.id === pickItem)
    const qty = Number(pickQty)
    const cost = Number(pickCost || 0)
    if (!item) { toast({ title: "Pick an item", variant: "destructive" }); return }
    if (!(qty > 0)) { toast({ title: "Enter a quantity", variant: "destructive" }); return }
    setLines((prev) => {
      const existing = prev.find((l) => l.inventory_id === item.id)
      if (existing) {return prev.map((l) => l.inventory_id === item.id ? { ...l, qty_ordered: qty, unit_cost: cost } : l)}
      return [...prev, { inventory_id: item.id, name: item.name, qty_ordered: qty, unit_cost: cost }]
    })
    setPickItem(""); setPickQty(""); setPickCost("")
  }

  const submit = async (status: "draft" | "ordered") => {
    if (lines.length === 0) { toast({ title: "Add at least one item", variant: "destructive" }); return }
    setSaving(true)
    try {
      const vendor = vendors.find((v) => v.id === vendorId)
      await createPurchaseOrder(rid, {
        vendor_id: vendorId || undefined,
        vendor_name: vendor?.name,
        items: lines,
        notes: notes.trim() || undefined,
        expected_date: expected || undefined,
        status,
      })
      setLines([]); setNotes(""); setExpected(""); setVendorId("")
      toast({ title: status === "ordered" ? "Purchase order placed" : "Draft saved" })
      await load()
    } catch (e: any) {
      toast({ title: "Could not save", description: String(e?.message ?? e), variant: "destructive" })
    } finally { setSaving(false) }
  }

  const changeStatus = async (po: PurchaseOrder, status: "ordered" | "cancelled") => {
    setBusyId(po.id)
    try {
      await setPurchaseOrderStatus(rid, po.id, status)
      toast({ title: `Marked ${status}` })
      await load()
    } catch (e: any) {
      toast({ title: "Could not update", description: String(e?.message ?? e), variant: "destructive" })
    } finally { setBusyId(null) }
  }

  const removePo = async (po: PurchaseOrder) => {
    setBusyId(po.id)
    try {
      await deletePurchaseOrder(rid, po.id)
      toast({ title: "Purchase order deleted" })
      await load()
    } catch (e: any) {
      toast({ title: "Could not delete", description: String(e?.message ?? e), variant: "destructive" })
    } finally { setBusyId(null) }
  }

  const startReceiving = (po: PurchaseOrder) => {
    setReceivingId(po.id)
    const seed: Record<string, string> = {}
    for (const it of po.items) {
      const remaining = Math.max(0, it.qty_ordered - it.qty_received)
      seed[it.inventory_id] = remaining > 0 ? String(remaining) : ""
    }
    setReceiveQty(seed)
  }

  const submitReceive = async (po: PurchaseOrder) => {
    const linesToReceive = Object.entries(receiveQty)
      .map(([inventory_id, v]) => ({ inventory_id, qty_received: Number(v || 0) || 0 }))
      .filter((l) => l.qty_received > 0)
    if (linesToReceive.length === 0) { toast({ title: "Enter quantities to receive", variant: "destructive" }); return }
    setBusyId(po.id)
    try {
      const rating = Number(receiveRating)
      await receivePurchaseOrder(rid, po.id, linesToReceive, rating >= 1 && rating <= 5 ? rating : null)
      toast({ title: "Stock received", description: "Inventory updated." })
      setReceivingId(null); setReceiveQty({}); setReceiveRating("")
      await load()
    } catch (e: any) {
      toast({ title: "Could not receive", description: String(e?.message ?? e), variant: "destructive" })
    } finally { setBusyId(null) }
  }

  return (
    <div className="space-y-6 p-1">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Purchase orders</h1>
          <p className="text-sm text-muted-foreground">Order stock from vendors, then receive against the PO to update inventory.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* New PO */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5" /> New purchase order</CardTitle>
          <CardDescription>Pick a vendor, add the items you&apos;re ordering, then save a draft or place the order.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>Vendor</Label>
              <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={vendorId} onChange={(e) => { setVendorId(e.target.value); }}>
                <option value="">— Select vendor —</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="expected">Expected date</Label>
              <Input id="expected" type="date" value={expected} onChange={(e) => { setExpected(e.target.value); }} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ponotes">Notes</Label>
              <Input id="ponotes" placeholder="Optional" value={notes} onChange={(e) => { setNotes(e.target.value); }} />
            </div>
          </div>

          {/* Add line */}
          <div className="grid items-end gap-2 sm:grid-cols-[1fr_120px_140px_auto]">
            <div className="space-y-1">
              <Label>Item</Label>
              <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={pickItem} onChange={(e) => { setPickItem(e.target.value); }}>
                <option value="">— Select item —</option>
                {inventory.map((i) => <option key={i.id} value={i.id}>{i.name}{i.unit ? ` (${i.unit})` : ""}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Qty</Label>
              <Input type="number" inputMode="decimal" placeholder="0" value={pickQty} onChange={(e) => { setPickQty(e.target.value); }} />
            </div>
            <div className="space-y-1">
              <Label>Unit cost ({currency})</Label>
              <Input type="number" inputMode="decimal" placeholder="0.00" value={pickCost} onChange={(e) => { setPickCost(e.target.value); }} />
            </div>
            <Button type="button" variant="secondary" onClick={addLine}><Plus className="mr-1 h-4 w-4" /> Add</Button>
          </div>

          {lines.length > 0 && (
            <div className="rounded-md border">
              {lines.map((l) => (
                <div key={l.inventory_id} className="flex items-center justify-between gap-3 border-b px-3 py-2 text-sm last:border-0">
                  <span className="flex-1">{l.name}</span>
                  <span className="text-muted-foreground">{l.qty_ordered} × {money(l.unit_cost)}</span>
                  <span className="w-24 text-right font-medium">{money(l.qty_ordered * l.unit_cost)}</span>
                  <button className="text-muted-foreground hover:text-destructive" onClick={() => { setLines((p) => p.filter((x) => x.inventory_id !== l.inventory_id)); }}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <div className="flex items-center justify-between px-3 py-2 text-sm font-bold">
                <span>Total</span><span>{money(draftTotal)}</span>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" disabled={saving || lines.length === 0} onClick={() => submit("draft")}>Save draft</Button>
            <Button disabled={saving || lines.length === 0} onClick={() => submit("ordered")}><Send className="mr-2 h-4 w-4" /> Place order</Button>
          </div>
        </CardContent>
      </Card>

      {/* List */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Orders</CardTitle>
            <CardDescription>Receiving against an order adds the items to inventory.</CardDescription>
          </div>
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); }}>
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="ordered">Ordered</option>
            <option value="received">Received</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </CardHeader>
        <CardContent className="space-y-3">
          {orders.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{loading ? "Loading…" : "No purchase orders yet."}</p>
          ) : orders.map((po) => {
            const received = po.items.reduce((s, it) => s + it.qty_received, 0)
            const ordered = po.items.reduce((s, it) => s + it.qty_ordered, 0)
            const canReceive = po.status === "ordered" || po.status === "draft"
            return (
              <div key={po.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{po.vendor_name || "Unassigned vendor"}</span>
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[po.status] ?? ""}`}>{po.status}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {po.items.length} item(s) · {money(po.total_cost)} · {received}/{ordered} received
                      {po.expected_date ? ` · expected ${po.expected_date}` : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {po.status === "draft" && <Button size="sm" variant="outline" disabled={busyId === po.id} onClick={() => changeStatus(po, "ordered")}><Send className="mr-1 h-4 w-4" /> Place</Button>}
                    {canReceive && <Button size="sm" disabled={busyId === po.id} onClick={() => { receivingId === po.id ? setReceivingId(null) : startReceiving(po); }}><PackageCheck className="mr-1 h-4 w-4" /> Receive</Button>}
                    {po.status !== "received" && po.status !== "cancelled" && <Button size="sm" variant="ghost" disabled={busyId === po.id} onClick={() => changeStatus(po, "cancelled")}><X className="mr-1 h-4 w-4" /> Cancel</Button>}
                    {po.status !== "received" && <Button size="sm" variant="ghost" className="text-destructive" disabled={busyId === po.id} onClick={() => removePo(po)}><Trash2 className="h-4 w-4" /></Button>}
                  </div>
                </div>

                {receivingId === po.id && (
                  <div className="mt-3 space-y-2 rounded-md bg-muted/40 p-3">
                    <p className="text-sm font-medium">Receive stock</p>
                    {po.items.map((it) => {
                      const remaining = Math.max(0, it.qty_ordered - it.qty_received)
                      return (
                        <div key={it.inventory_id} className="flex items-center gap-3 text-sm">
                          <span className="flex-1">{it.name}</span>
                          <span className="text-xs text-muted-foreground">{it.qty_received}/{it.qty_ordered} · {remaining} left</span>
                          <Input type="number" inputMode="decimal" className="h-8 w-24" placeholder="0"
                            value={receiveQty[it.inventory_id] ?? ""}
                            onChange={(e) => { setReceiveQty((p) => ({ ...p, [it.inventory_id]: e.target.value })); }} />
                        </div>
                      )
                    })}
                    <div className="flex items-center gap-3 border-t pt-2 text-sm">
                      <span className="text-muted-foreground">Delivery quality</span>
                      <select
                        value={receiveRating}
                        onChange={(e) => { setReceiveRating(e.target.value); }}
                        className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-ring"
                      >
                        <option value="">Not rated</option>
                        <option value="5">★★★★★ Excellent</option>
                        <option value="4">★★★★ Good</option>
                        <option value="3">★★★ OK</option>
                        <option value="2">★★ Poor</option>
                        <option value="1">★ Bad</option>
                      </select>
                      <span className="text-xs text-muted-foreground">Feeds the supplier score in Analytics.</span>
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <Button size="sm" variant="ghost" onClick={() => { setReceivingId(null); }}>Cancel</Button>
                      <Button size="sm" disabled={busyId === po.id} onClick={() => submitReceive(po)}><PackageCheck className="mr-1 h-4 w-4" /> Confirm receipt</Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
