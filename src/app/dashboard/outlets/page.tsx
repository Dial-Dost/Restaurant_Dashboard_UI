"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Plus, Trash2, Pencil, Store, ExternalLink } from "lucide-react"
import { useAuth } from "@/context/AuthContext"
import { useCurrency } from "@/hooks/use-currency"
import { useToast } from "@/hooks/use-toast"
import { SELECTED_OUTLET_KEY } from "@/lib/outlet"
import {
  getOutlets, getOutletsRollup, addOutlet, updateOutlet, setOutletActive, deleteOutlet,
  type OutletRow, type OutletsRollup,
} from "@/lib/db"

type EditState = { open: boolean; id: string | null; name: string; address: string; phone: string; hours: string }
const EMPTY_EDIT: EditState = { open: false, id: null, name: "", address: "", phone: "", hours: "" }

export default function OutletsPage() {
  const { user } = useAuth()
  const { currency } = useCurrency()
  const { toast } = useToast()
  const rid = user?.restaurantUsername ?? ""

  const [loading, setLoading] = useState(true)
  const [outlets, setOutlets] = useState<OutletRow[]>([])
  const [rollup, setRollup] = useState<OutletsRollup | null>(null)
  const [edit, setEdit] = useState<EditState>(EMPTY_EDIT)
  const [saving, setSaving] = useState(false)
  // The outlet the dashboard is currently scoped to (same localStorage key the
  // top-bar OutletSwitcher uses). Read on mount so we can highlight it below.
  const [activeOutletId, setActiveOutletId] = useState<string | null>(null)

  // Admins/managers can use an outlet card as a launchpad: switching the whole
  // dashboard into that outlet. Everyone else just manages outlet records.
  const roles = [user?.role, ...(Array.isArray(user?.role_all) ? user!.role_all : [])]
  const canSwitch = roles.includes("admin") || roles.includes("manager")

  const money = (n: number | null | undefined) => `${currency}${Number(n ?? 0).toFixed(0)}`

  const load = useCallback(async () => {
    if (!rid) return
    setLoading(true)
    try {
      const [o, r] = await Promise.all([getOutlets(rid), getOutletsRollup(rid, 30)])
      setOutlets(o?.outlets ?? [])
      setRollup(r)
    } finally {
      setLoading(false)
    }
  }, [rid])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    try { setActiveOutletId(window.localStorage.getItem(SELECTED_OUTLET_KEY)) } catch { /* ignore */ }
  }, [])

  // Switch the whole dashboard into this outlet — identical mechanism to the
  // top-bar OutletSwitcher: persist the choice, then navigate to /dashboard with
  // a full page load so every screen refetches under the new outlet scope.
  const openOutlet = (o: OutletRow) => {
    if (!canSwitch) return
    try { window.localStorage.setItem(SELECTED_OUTLET_KEY, o.id) } catch { /* ignore */ }
    window.location.href = "/dashboard"
  }

  // Effective scope for the highlight: an explicit stored outlet wins; otherwise
  // the dashboard defaults to the Main/first outlet (mirrors the switcher).
  const defaultOutletId = outlets.find((o) => o.is_default)?.id ?? outlets[0]?.id ?? null
  const effectiveOutletId = activeOutletId && activeOutletId !== "all" ? activeOutletId : (activeOutletId === "all" ? "all" : defaultOutletId)

  const save = async () => {
    if (!edit.name.trim()) {
      toast({ title: "Outlet name is required", variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      const body = { name: edit.name.trim(), address: edit.address.trim(), phone: edit.phone.trim(), hours: edit.hours.trim() }
      if (edit.id) await updateOutlet(rid, edit.id, body)
      else await addOutlet(rid, body)
      setEdit(EMPTY_EDIT)
      await load()
    } catch (err) {
      toast({ title: "Could not save outlet", description: String((err as Error)?.message ?? err), variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (o: OutletRow) => {
    try {
      await setOutletActive(rid, o.id, !o.is_active)
      await load()
    } catch (err) {
      toast({ title: "Could not update outlet", description: String((err as Error)?.message ?? err), variant: "destructive" })
    }
  }

  const remove = async (o: OutletRow) => {
    if (!confirm(`Delete "${o.outlet_name}"? Only possible if it has no orders/bills.`)) return
    try {
      await deleteOutlet(rid, o.id)
      await load()
    } catch (err) {
      toast({ title: "Could not delete outlet", description: String((err as Error)?.message ?? err), variant: "destructive" })
    }
  }

  const revByOutlet = new Map((rollup?.outlets ?? []).map((o) => [o.outlet_id, o]))
  const maxRev = Math.max(1, ...(rollup?.outlets ?? []).map((o) => o.revenue))

  return (
    <div className="grid gap-4 md:gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold md:text-2xl">Outlets</h1>
        <Dialog open={edit.open} onOpenChange={(v) => setEdit(v ? { ...EMPTY_EDIT, open: true } : EMPTY_EDIT)}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="mr-1 h-4 w-4" /> Add outlet</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{edit.id ? "Edit outlet" : "Add outlet"}</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1"><Label>Name</Label><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
              <div className="grid gap-1"><Label>Address</Label><Input value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></div>
              <div className="grid gap-1"><Label>Phone</Label><Input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></div>
              <div className="grid gap-1"><Label>Hours</Label><Input value={edit.hours} onChange={(e) => setEdit({ ...edit, hours: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card><CardHeader className="pb-2"><CardDescription>Branches</CardDescription><CardTitle className="text-2xl">{rollup?.totals.outlets ?? outlets.length}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Revenue (30d)</CardDescription><CardTitle className="text-2xl">{money(rollup?.totals.revenue)}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Orders (30d)</CardDescription><CardTitle className="text-2xl">{rollup?.totals.orders ?? 0}</CardTitle></CardHeader></Card>
      </div>

      {(rollup?.outlets ?? []).length > 1 && (
        <Card>
          <CardHeader><CardTitle>Revenue by outlet — last 30 days</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {rollup!.outlets.map((o) => (
              <div key={o.outlet_id} className="flex items-center gap-3 text-sm">
                <span className="w-32 shrink-0 truncate">{o.name}</span>
                <div className="relative h-4 flex-1 overflow-hidden rounded bg-muted">
                  <div className="absolute inset-y-0 left-0 rounded bg-primary" style={{ width: `${Math.max(3, (o.revenue / maxRev) * 100)}%` }} />
                </div>
                <span className="w-20 text-right font-semibold">{money(o.revenue)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Manage outlets</CardTitle>
          <CardDescription>Add branches, rename them, deactivate, or remove (only if they have no history).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : outlets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No outlets.</p>
          ) : (
            outlets.map((o) => {
              const r = revByOutlet.get(o.id)
              const isViewing = canSwitch && effectiveOutletId === o.id
              return (
                <div
                  key={o.id}
                  onClick={canSwitch ? () => openOutlet(o) : undefined}
                  className={`flex items-center gap-3 rounded-lg border p-3 text-sm ${canSwitch ? "cursor-pointer transition-colors hover:bg-muted/50" : ""} ${isViewing ? "border-primary bg-primary/5 ring-1 ring-primary" : ""}`}
                >
                  <Store className={`h-5 w-5 ${o.is_active ? "text-primary" : "text-muted-foreground"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {o.outlet_name}{o.is_default && <Badge variant="secondary" className="ml-2">Main</Badge>}
                      {isViewing && <Badge className="ml-2">Viewing this outlet</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {o.outlet_add || "No address"}{r ? ` · ${money(r.revenue)} / ${r.orders} orders (30d)` : ""}
                    </p>
                  </div>
                  {/* Management controls — stop propagation so they never trigger the switch. */}
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    {canSwitch && (
                      <Button
                        variant={isViewing ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => openOutlet(o)}
                        title="Switch the dashboard into this outlet"
                      >
                        <ExternalLink className="mr-1 h-4 w-4" />
                        {isViewing ? "Viewing" : "Open outlet"}
                      </Button>
                    )}
                    <span className="text-xs text-muted-foreground">{o.is_active ? "Active" : "Inactive"}</span>
                    <Switch checked={o.is_active} disabled={o.is_default} onCheckedChange={() => toggleActive(o)} />
                    <Button variant="ghost" size="icon" onClick={() => setEdit({ open: true, id: o.id, name: o.outlet_name, address: o.outlet_add ?? "", phone: o.outlet_phone ?? "", hours: o.outlet_hours ?? "" })}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {!o.is_default && (
                      <Button variant="ghost" size="icon" onClick={() => remove(o)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>
    </div>
  )
}
