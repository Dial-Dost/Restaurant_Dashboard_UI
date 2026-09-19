"use client"

// Web copy of Flutter `_OutletsView` (modules.dart): stat tiles that drill into
// a ranked branch list, an interactive revenue chart, and a 2-up grid of outlet
// cards whose tap opens the outlet's own sheet. Switching scope is only ever the
// named "Open" / "Switch to this outlet" action, done in place.

import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, MoreVertical, Plus, Store } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ForkCard } from "@/components/ui/fork-card"
import { StatCard } from "@/components/ui/stat-card"
import { StatusChip } from "@/components/ui/status-chip"
import { TickTag } from "@/components/ui/tick-tag"
import { MicroStat } from "@/components/ui/micro-stat"
import { SectionHeader } from "@/components/ui/section-header"
import { LoadErrorState } from "@/components/ui/load-error-state"
import { SkeletonBox, SkeletonStats } from "@/components/ui/fork-skeleton"
import { DrillSheet } from "@/components/ui/drill-sheet"
import { HBarRow, Columns } from "@/components/ui/fork-charts"
import { CacheStalePill } from "@/components/ui/stale-pill"
import { KvRow, SheetRecordRow, useConfirm, useNarrow } from "@/components/outlets/sheet-parts"
import { useAuth } from "@/context/AuthContext"
import { useCurrency } from "@/hooks/use-currency"
import { useToast } from "@/hooks/use-toast"
import { useCachedFetch } from "@/hooks/use-cached-fetch"
import { ALL_OUTLETS, SELECTED_OUTLET_KEY, applySelectedOutlet } from "@/lib/outlet"
import { cn } from "@/lib/utils"
import {
  getOutlets, getOutletsRollup, addOutlet, updateOutlet, setOutletActive, deleteOutlet,
  type OutletRow, type OutletsRollup,
} from "@/lib/db"

type RollupRow = OutletsRollup["outlets"][number]

interface OutletsPayload { outlets: OutletRow[]; rollup: OutletsRollup | null }

interface EditState { open: boolean; id: string | null; name: string; address: string; phone: string; hours: string }
const EMPTY_EDIT: EditState = { open: false, id: null, name: "", address: "", phone: "", hours: "" }

type Branches = "revenue" | "orders"

const capped = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

export default function OutletsPage(): React.JSX.Element {
  const { user } = useAuth()
  const { currencySymbol } = useCurrency()
  const { toast } = useToast()
  const narrow = useNarrow()
  const { confirm, confirmDialog } = useConfirm()
  const rid = user?.restaurantUsername ?? ""

  // Flutter `_fetch`: the outlets list must load; the rollup 403s without the
  // outlet-admin permission, so it is best-effort (null = drill-downs off).
  const fetcher = useCallback(async (): Promise<OutletsPayload> => {
    const [o, r] = await Promise.all([
      getOutlets(rid),
      getOutletsRollup(rid, 30).catch(() => null),
    ])
    if (!o) { throw new Error("Could not load outlets.") }
    return { outlets: Array.isArray(o.outlets) ? o.outlets : [], rollup: r ?? null }
  }, [rid])
  const q = useCachedFetch<OutletsPayload>(`outlets:${rid}`, fetcher, { enabled: rid.length > 0 })
  const outlets = useMemo(() => q.data?.outlets ?? [], [q.data])
  const rollup = q.data?.rollup ?? null
  const rollupOutlets = useMemo(() => rollup?.outlets ?? [], [rollup])

  const [edit, setEdit] = useState<EditState>(EMPTY_EDIT)
  const [saving, setSaving] = useState(false)
  const [sheetOutlet, setSheetOutlet] = useState<OutletRow | null>(null)
  const [branches, setBranches] = useState<Branches | null>(null)
  const [bar, setBar] = useState<RollupRow | null>(null)
  const [storedOutletId, setStoredOutletId] = useState<string | null>(null)

  useEffect(() => {
    try { setStoredOutletId(window.localStorage.getItem(SELECTED_OUTLET_KEY)) } catch { /* ignore */ }
  }, [])

  const roles = [user?.role, ...(Array.isArray(user?.role_all) ? user.role_all : [])]
  const canSwitch = roles.includes("admin") || roles.includes("manager")

  const money = (n: number): string => `${currencySymbol}${n.toFixed(0)}`

  // `_isCurrentOutlet` — for every role (knowing your scope is not gated).
  const defaultOutletId = outlets.find((o) => o.is_default)?.id ?? (outlets.length > 0 ? outlets[0].id : null)
  const currentId =
    storedOutletId && storedOutletId !== ALL_OUTLETS ? storedOutletId : (storedOutletId === ALL_OUTLETS ? null : (user?.outlet_id ?? defaultOutletId))
  const isCurrent = (o: OutletRow): boolean => o.id === currentId

  const rollupById = useMemo(() => new Map(rollupOutlets.map((r) => [r.outlet_id, r])), [rollupOutlets])

  const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err))

  /* ── Actions ──────────────────────────────────────────────────────── */

  const switchTo = async (o: OutletRow): Promise<void> => {
    if (isCurrent(o)) { return }
    await applySelectedOutlet(o.id)
    setStoredOutletId(o.id)
    toast({ description: `Now viewing ${o.outlet_name || "this outlet"}. Other modules will show this outlet's data.` })
    q.refresh()
  }

  const save = async (): Promise<void> => {
    if (!edit.name.trim()) {
      toast({ title: "Outlet name is required.", variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      const body = { name: edit.name.trim(), address: edit.address.trim(), phone: edit.phone.trim(), hours: edit.hours.trim() }
      if (edit.id) { await updateOutlet(rid, edit.id, body) } else { await addOutlet(rid, body) }
      setEdit(EMPTY_EDIT)
      q.refresh()
    } catch (err) {
      toast({ title: "Could not save outlet", description: errMsg(err), variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (o: OutletRow): Promise<void> => {
    try {
      await setOutletActive(rid, o.id, !o.is_active)
      q.refresh()
    } catch (err) {
      toast({ title: "Could not update outlet", description: errMsg(err), variant: "destructive" })
    }
  }

  const remove = async (o: OutletRow): Promise<void> => {
    const ok = await confirm({
      title: "Delete outlet?",
      body: `Delete "${o.outlet_name}"? Only possible if it has no orders/bills.`,
      confirmLabel: "Delete",
      destructive: true,
    })
    if (!ok) { return }
    try {
      await deleteOutlet(rid, o.id)
      q.refresh()
    } catch (err) {
      toast({ title: "Could not delete outlet", description: errMsg(err), variant: "destructive" })
    }
  }

  const openEdit = (o: OutletRow): void => {
    setEdit({ open: true, id: o.id, name: o.outlet_name, address: o.outlet_add ?? "", phone: o.outlet_phone ?? "", hours: o.outlet_hours ?? "" })
  }

  // Sheet actions step out of the sheet before acting.
  const fromSheet = (fn: () => void) => () => { setSheetOutlet(null); fn() }

  /* ── Render ───────────────────────────────────────────────────────── */

  const addButton = (
    <Button size="sm" onClick={() => { setEdit({ ...EMPTY_EDIT, open: true }) }}>
      <Plus className="mr-1 h-4 w-4" /> Add outlet
    </Button>
  )

  const hint = canSwitch ? "Tap an outlet for details and to switch" : "Tap an outlet for details"

  let body: React.ReactNode
  if (q.loading) {
    body = (
      <div className="grid gap-4">
        <SkeletonStats tiles={3} />
        <div className="grid grid-cols-1 gap-3.5 min-[760px]:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <SkeletonBox key={i} height={128} />)}
        </div>
      </div>
    )
  } else if (q.error) {
    body = <LoadErrorState whatFailed="Couldn't load outlets." error={q.error} onRetry={q.retry} />
  } else {
    const totals = rollup?.totals
    const drillable = rollupOutlets.length > 0
    const compare = rollupOutlets
    const maxRev = Math.max(1, ...compare.map((o) => o.revenue))
    const totalRev = compare.reduce((s, o) => s + o.revenue, 0)

    body = (
      <div className="grid gap-5">
        <div className="grid grid-cols-1 gap-3.5 min-[760px]:grid-cols-3">
          <StatCard value={String(totals?.outlets ?? outlets.length)} caption="BRANCHES" />
          <StatCard
            value={money(totals?.revenue ?? 0)}
            caption="REVENUE (30D)"
            onClick={drillable ? () => { setBranches("revenue") } : undefined}
          />
          <StatCard
            value={String(totals?.orders ?? 0)}
            caption="ORDERS (30D)"
            onClick={drillable ? () => { setBranches("orders") } : undefined}
          />
        </div>

        {compare.length > 1 && (
          <Card>
            <CardHeader><CardTitle>Revenue by outlet — last 30 days</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {compare.length >= 10 ? (
                <Columns
                  values={compare.map((o) => o.revenue)}
                  labels={compare.map((o) => o.name)}
                  formatValue={money}
                  onSelect={(i) => { setBar(compare[i]) }}
                  tooltip={(i) => `${compare[i].name} · ${money(compare[i].revenue)}`}
                />
              ) : (
                compare.map((o) => (
                  <HBarRow
                    key={o.outlet_id}
                    label={o.name}
                    fraction={o.revenue / maxRev}
                    value={money(o.revenue)}
                    onSelect={() => { setBar(o) }}
                    tooltip={`${o.name} · ${money(o.revenue)}`}
                  />
                ))
              )}
            </CardContent>
          </Card>
        )}

        <div className="grid gap-3">
          {narrow ? (
            <>
              <SectionHeader title="Manage outlets" />
              <p className="-mt-1 text-xs text-muted-foreground">{hint}</p>
            </>
          ) : (
            <SectionHeader title="Manage outlets" trailing={<span className="text-xs text-muted-foreground">{hint}</span>} />
          )}
          <div className="grid grid-cols-1 gap-3.5 min-[760px]:grid-cols-2">
            {outlets.map((o) => {
              const cur = isCurrent(o)
              const r = rollupById.get(o.id)
              return (
                <ForkCard key={o.id} selected={cur} chevron={false} onClick={() => { setSheetOutlet(o) }} className="flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] border transition-colors duration-base",
                        cur ? "border-accent-hi/40 bg-accent-hi/15 text-accent-hi" : "border-border bg-inset text-muted-foreground",
                      )}
                    >
                      <Store className="h-[18px] w-[18px]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[15px] font-semibold">{o.outlet_name}</span>
                        {o.is_default && <TickTag label="Main" />}
                      </div>
                      {o.outlet_add && <div className="mt-0.5 truncate text-xs text-muted-foreground">{o.outlet_add}</div>}
                    </div>
                    <StatusChip
                      dense
                      className="shrink-0"
                      {...(cur
                        ? { color: "hsl(var(--accent-hi))", label: "Viewing" }
                        : o.is_active
                          ? { status: "success" as const, label: "Active" }
                          : { status: "neutral" as const, label: "Inactive" })}
                    />
                    <div onClick={(e) => { e.stopPropagation() }} onKeyDown={(e) => { e.stopPropagation() }}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Outlet actions">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => { openEdit(o) }}>Edit</DropdownMenuItem>
                          {!o.is_default && (
                            <DropdownMenuItem onSelect={() => { void toggleActive(o) }}>{o.is_active ? "Deactivate" : "Activate"}</DropdownMenuItem>
                          )}
                          {!o.is_default && (
                            <DropdownMenuItem className="text-destructive" onSelect={() => { void remove(o) }}>Delete</DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
                    <MicroStat value={r ? money(r.revenue) : "—"} label="revenue (30d)" />
                    <MicroStat value={r ? String(r.orders) : "—"} label="orders (30d)" />
                    {o.outlet_phone && <MicroStat value={capped(o.outlet_phone, 20)} label="phone" />}
                    {o.outlet_hours && <MicroStat value={capped(o.outlet_hours, 20)} label="hours" />}
                    {canSwitch && !cur && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-auto"
                        onClick={(e) => { e.stopPropagation(); void switchTo(o) }}
                      >
                        Open
                      </Button>
                    )}
                  </div>
                </ForkCard>
              )
            })}
          </div>
        </div>

        {/* Stat drill: ranked branch list (tile → set → member). */}
        <DrillSheet
          open={branches != null}
          onOpenChange={(v) => { if (!v) { setBranches(null) } }}
          eyebrow="Multi-outlet · last 30 days"
          title={branches === "orders" ? "Orders by branch" : "Revenue by branch"}
        >
          {branches != null && (
            <div className="grid gap-2">
              <p className="mb-1 text-xs text-muted-foreground">
                {branches === "revenue"
                  ? "Every branch of this restaurant, best-earning first. Cancelled orders are already excluded. Share is of the group total."
                  : "Every branch of this restaurant, busiest first. Cancelled orders are already excluded, so this is orders actually served."}
              </p>
              {[...outlets]
                .sort((a, b) => {
                  const ra = rollupById.get(a.id)
                  const rb = rollupById.get(b.id)
                  if (!ra && !rb) { return 0 }
                  if (!ra) { return 1 }
                  if (!rb) { return -1 }
                  return branches === "revenue" ? rb.revenue - ra.revenue : rb.orders - ra.orders
                })
                .map((o) => {
                  const r = rollupById.get(o.id)
                  let sub = "Not in the 30-day roll-up"
                  if (r) {
                    if (branches === "revenue") {
                      const total = totals?.revenue ?? 0
                      const share = total <= 0 ? "" : `${((r.revenue / total) * 100).toFixed(0)}% of group · `
                      sub = `${share}${r.orders} order${r.orders === 1 ? "" : "s"}`
                    } else {
                      const total = totals?.orders ?? 0
                      const share = total <= 0 ? "" : `${((r.orders / total) * 100).toFixed(0)}% of group · `
                      sub = `${share}average ${r.orders === 0 ? "—" : money(r.revenue / r.orders)} per order`
                    }
                  }
                  const badge = isCurrent(o)
                    ? <StatusChip dense color="hsl(var(--accent-hi))" label="Viewing" />
                    : !o.is_active ? <StatusChip dense status="neutral" label="Inactive" /> : null
                  return (
                    <SheetRecordRow
                      key={o.id}
                      title={o.outlet_name}
                      badge={badge}
                      sub={sub}
                      trailing={r ? (branches === "revenue" ? money(r.revenue) : String(r.orders)) : ""}
                      onClick={() => { setBranches(null); setSheetOutlet(o) }}
                    />
                  )
                })}
            </div>
          )}
        </DrillSheet>

        {/* Chart drill: value / share / rank / total. */}
        <DrillSheet
          open={bar != null}
          onOpenChange={(v) => { if (!v) { setBar(null) } }}
          eyebrow="Revenue by outlet — last 30 days"
          title={bar?.name ?? ""}
        >
          {bar && (() => {
            const ranked = [...compare].sort((a, b) => b.revenue - a.revenue)
            const rank = ranked.findIndex((e) => e.outlet_id === bar.outlet_id) + 1
            return (
              <div>
                <KvRow label="Value" value={money(bar.revenue)} />
                <KvRow label="Share of total" value={totalRev > 0 ? `${((bar.revenue / totalRev) * 100).toFixed(1)}%` : "—"} />
                <KvRow label="Rank" value={rank > 0 ? `${rank} of ${compare.length}` : "—"} />
                <KvRow label="Total across all" value={money(totalRev)} />
              </div>
            )
          })()}
        </DrillSheet>
      </div>
    )
  }

  // Per-outlet sheet.
  const so = sheetOutlet
  const soR = so ? rollupById.get(so.id) : undefined
  const soCur = so ? isCurrent(so) : false

  return (
    <div className="relative grid gap-5">
      <SectionHeader title="Outlets" count={outlets.length} trailing={addButton} />
      {body}
      <CacheStalePill offline={q.offline} fromCache={q.fromCache} updatedAt={q.updatedAt} />

      <DrillSheet
        open={so != null}
        onOpenChange={(v) => { if (!v) { setSheetOutlet(null) } }}
        eyebrow="Multi-outlet"
        title={so?.outlet_name || "Outlet"}
      >
        {so && (
          <div>
            <KvRow label="Status" value={soCur ? "Viewing now" : so.is_active ? "Active" : "Inactive"} />
            <KvRow label="Role" value={so.is_default ? "Main outlet — the default this login lands on" : "Branch"} />
            <KvRow label="Address" value={so.outlet_add || "—"} />
            <KvRow label="Phone" value={so.outlet_phone || "—"} />
            <KvRow label="Hours" value={so.outlet_hours || "—"} />
            <KvRow label="Revenue (30d)" value={soR ? money(soR.revenue) : "Not in the roll-up"} />
            <KvRow label="Orders (30d)" value={soR ? String(soR.orders) : "Not in the roll-up"} />
            <KvRow label="Average order" value={soR && soR.orders > 0 ? money(soR.revenue / soR.orders) : "—"} />
            <div className="mt-3.5 flex flex-wrap gap-2">
              {canSwitch && !soCur && (
                <Button size="sm" onClick={fromSheet(() => { void switchTo(so) })}>Switch to this outlet</Button>
              )}
              <Button size="sm" variant="outline" onClick={fromSheet(() => { openEdit(so) })}>Edit</Button>
              {!so.is_default && (
                <Button size="sm" variant="outline" onClick={fromSheet(() => { void toggleActive(so) })}>
                  {so.is_active ? "Deactivate" : "Activate"}
                </Button>
              )}
              {!so.is_default && (
                <Button size="sm" variant="outline" onClick={fromSheet(() => { void remove(so) })}>Delete</Button>
              )}
            </div>
          </div>
        )}
      </DrillSheet>

      <Dialog open={edit.open} onOpenChange={(v) => { if (!v) { setEdit(EMPTY_EDIT) } }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <div className="micro-label">MULTI-OUTLET</div>
            <DialogTitle>{edit.id ? "Edit outlet" : "Add outlet"}</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(e) => { e.preventDefault(); void save() }}
          >
            <div className="grid gap-1"><Label htmlFor="outlet-name">Outlet name</Label><Input id="outlet-name" autoFocus value={edit.name} onChange={(e) => { setEdit({ ...edit, name: e.target.value }) }} /></div>
            <div className="grid gap-1"><Label htmlFor="outlet-add">Address (optional)</Label><Input id="outlet-add" value={edit.address} onChange={(e) => { setEdit({ ...edit, address: e.target.value }) }} /></div>
            <div className="grid gap-1"><Label htmlFor="outlet-phone">Phone (optional)</Label><Input id="outlet-phone" type="tel" value={edit.phone} onChange={(e) => { setEdit({ ...edit, phone: e.target.value }) }} /></div>
            <div className="grid gap-1"><Label htmlFor="outlet-hours">Hours (optional)</Label><Input id="outlet-hours" value={edit.hours} onChange={(e) => { setEdit({ ...edit, hours: e.target.value }) }} /></div>
            <DialogFooter className="mt-1 gap-2">
              <Button type="button" variant="outline" onClick={() => { setEdit(EMPTY_EDIT) }}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                <Check className="mr-1 h-4 w-4" />
                {saving ? "Saving…" : edit.id ? "Save" : "Add"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </div>
  )
}
