"use client"

// Campaign ROI — the Flutter marketing card (modules.dart ~21561): sortable
// campaign rows with a colour-coded ROI StatusChip, an "Add" button opening
// the New-campaign dialog (Name / Cost / Starts / Ends), and a per-row delete.
// Deleting is destructive, so it confirms through a styled AlertDialog.

import * as React from "react"
import { Plus, Trash2 } from "lucide-react"

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
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { ForkCard } from "@/components/ui/fork-card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { StatusChip } from "@/components/ui/status-chip"
import { useToast } from "@/hooks/use-toast"
import { createCampaign, deleteCampaign } from "@/lib/db"
import type { AdvancedAnalytics } from "@/lib/db"
import { Dl } from "@/components/analytics/csv"
import { applySort, SortHeader, useSectionSort } from "@/components/analytics/sort"
import type { SortOption } from "@/components/analytics/sort"
import { money0, num0, str } from "@/components/analytics/format"

type CampaignRow = AdvancedAnalytics["campaigns"][number]

const CAMPAIGN_SORTS: SortOption<CampaignRow>[] = [
    { label: "ROI", key: (m) => num0(m.roi_pct) },
    { label: "Uplift", key: (m) => num0(m.uplift_pct) },
    { label: "Cost", key: (m) => num0(m.cost) },
    { label: "Sales (during)", key: (m) => num0(m.sales_during) },
    { label: "Name", key: (m) => str(m.name).toLowerCase() },
]

export function CampaignRoiCard({ campaigns, restaurantId, currencySymbol, dlOrder, onReload }: {
    campaigns: CampaignRow[]
    restaurantId: string
    currencySymbol: string
    dlOrder: number
    onReload: () => void
}): React.JSX.Element {
    const { toast } = useToast()
    const sort = useSectionSort("campaign", true)
    const money = (v: number): string => money0(currencySymbol, v)

    const [addOpen, setAddOpen] = React.useState(false)
    const [name, setName] = React.useState("")
    const [cost, setCost] = React.useState("")
    const [starts, setStarts] = React.useState("")
    const [ends, setEnds] = React.useState("")
    const [saving, setSaving] = React.useState(false)
    const [toDelete, setToDelete] = React.useState<CampaignRow | null>(null)

    const sorted = applySort(campaigns, CAMPAIGN_SORTS, sort)

    const submitAdd = async (): Promise<void> => {
        setSaving(true)
        try {
            await createCampaign(restaurantId, {
                name: name.trim(),
                cost: Number.parseFloat(cost.trim()) || 0,
                starts_at: starts.trim(),
                ends_at: ends.trim(),
            })
            setAddOpen(false)
            setName(""); setCost(""); setStarts(""); setEnds("")
            onReload()
        } catch (e) {
            toast({ description: e instanceof Error ? e.message : String(e), variant: "destructive" })
        } finally {
            setSaving(false)
        }
    }

    const confirmDelete = async (): Promise<void> => {
        const row = toDelete
        setToDelete(null)
        if (row == null) { return }
        try {
            await deleteCampaign(restaurantId, row.id)
            onReload()
        } catch (e) {
            toast({ description: e instanceof Error ? e.message : String(e), variant: "destructive" })
        }
    }

    return (
        <ForkCard>
            <Dl
                id="campaign-roi"
                order={dlOrder}
                headers={["Campaign", "Starts", "Ends", "Cost", "Sales during", "Sales before", "Uplift %", "ROI %"]}
                rows={sorted.map((m) => [
                    str(m.name),
                    str(m.starts_at),
                    str(m.ends_at),
                    money(num0(m.cost)),
                    money(num0(m.sales_during)),
                    money(num0(m.sales_before)),
                    m.uplift_pct == null ? "" : num0(m.uplift_pct).toFixed(0),
                    m.roi_pct == null ? "" : num0(m.roi_pct).toFixed(0),
                ])}
            />
            <SortHeader
                title="Campaign ROI"
                opts={CAMPAIGN_SORTS}
                sort={sort}
                className="mb-1.5"
                extra={
                    <Button variant="ghost" size="sm" onClick={() => { setAddOpen(true) }}>
                        <Plus className="h-3.5 w-3.5" />
                        Add
                    </Button>
                }
            />
            <p className="text-[11px] text-muted-foreground">Revenue in the campaign window vs the same-length window before it.</p>
            <div className="mt-2">
                {campaigns.length === 0 && (
                    <p className="py-1.5 text-sm text-muted-foreground">No campaigns yet — add one to measure uplift &amp; ROI.</p>
                )}
                {sorted.map((m) => {
                    const roi = m.roi_pct
                    const chipStatus = roi == null
                        ? "neutral" as const
                        : num0(roi) >= 20 ? "success" as const : num0(roi) >= 0 ? "warning" as const : "danger" as const
                    return (
                        <div key={m.id} className="flex items-center gap-3 py-[5px]">
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-[13.5px] font-semibold text-foreground">{str(m.name)}</div>
                                <div className="mt-0.5 text-[11px] text-muted-foreground">
                                    {str(m.starts_at)} → {str(m.ends_at)} · cost {money(num0(m.cost))}
                                </div>
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-[3px]">
                                <StatusChip
                                    dense
                                    status={chipStatus}
                                    label={roi != null
                                        ? `ROI ${num0(roi).toFixed(0)}%`
                                        : (m.uplift_pct != null ? `Uplift ${num0(m.uplift_pct).toFixed(0)}%` : "No data")}
                                />
                                <span className="text-[11px] text-muted-foreground tabular-nums">
                                    {money(num0(m.sales_during))} vs {money(num0(m.sales_before))}
                                </span>
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                                title="Delete campaign"
                                aria-label="Delete campaign"
                                onClick={() => { setToDelete(m) }}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    )
                })}
            </div>

            {/* New campaign — the Flutter AlertDialog form. */}
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
                <DialogContent className="sm:max-w-[420px]">
                    <DialogHeader>
                        <DialogTitle>New campaign</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-3">
                        <div className="grid gap-1.5">
                            <Label htmlFor="campaign-name">Name</Label>
                            <Input id="campaign-name" value={name} onChange={(e) => { setName(e.target.value) }} />
                        </div>
                        <div className="grid gap-1.5">
                            <Label htmlFor="campaign-cost">Cost (spend)</Label>
                            <Input id="campaign-cost" inputMode="decimal" value={cost} onChange={(e) => { setCost(e.target.value) }} />
                        </div>
                        <div className="grid gap-1.5">
                            <Label htmlFor="campaign-starts">Starts (YYYY-MM-DD)</Label>
                            <Input id="campaign-starts" value={starts} onChange={(e) => { setStarts(e.target.value) }} />
                        </div>
                        <div className="grid gap-1.5">
                            <Label htmlFor="campaign-ends">Ends (YYYY-MM-DD)</Label>
                            <Input id="campaign-ends" value={ends} onChange={(e) => { setEnds(e.target.value) }} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setAddOpen(false) }}>Cancel</Button>
                        <Button disabled={saving} onClick={() => { void submitAdd() }}>Add</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Deleting is destructive — always a confirmation dialog. */}
            <AlertDialog open={toDelete != null} onOpenChange={(o) => { if (!o) { setToDelete(null) } }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete campaign?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {`"${str(toDelete?.name, "This campaign")}" and its ROI reading will be removed. This cannot be undone.`}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => { void confirmDelete() }}>Delete campaign</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </ForkCard>
    )
}
