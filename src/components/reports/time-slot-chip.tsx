"use client"

// TimeSlotChip — the app's time_slot_picker.dart: All day, each saved session,
// Custom… (HH:mm–HH:mm, may cross midnight, end may be 24:00), and — for a
// caller the server marks `can_edit` — "Manage sessions…", the editor that PUTs
// the restaurant's saved list and shows the server's own refusal sentence.

import * as React from "react"
import { Check, Clock, Plus, Settings2, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { isUnreachableError } from "@/hooks/use-cached-fetch"
import { putTimeSlots } from "@/lib/api/reports"
import { cn } from "@/lib/utils"

import {
    ALL_DAY,
    MAX_TIME_SLOTS,
    catalogueFromJson,
    clockRange,
    crossesMidnight,
    customSelection,
    presetOptionLabel,
    presetSelection,
    selectionKey,
    selectionLabel,
    slotDraftsBody,
    validateCustomSlot,
    validateSlotDrafts,
    type TimeSlotCatalogue,
    type TimeSlotDraft,
    type TimeSlotSelection,
} from "./time-slot"

interface Props {
    value: TimeSlotSelection
    onChange: (next: TimeSlotSelection) => void
    catalogue: TimeSlotCatalogue | null
    onCatalogue: (next: TimeSlotCatalogue) => void
    disabled?: boolean
}

export function TimeSlotChip({ value, onChange, catalogue, onCatalogue, disabled }: Props): React.JSX.Element {
    const [open, setOpen] = React.useState(false)
    const [custom, setCustom] = React.useState(false)
    const [from, setFrom] = React.useState(value.kind === "custom" ? value.from : "")
    const [to, setTo] = React.useState(value.kind === "custom" ? value.to : "")
    const [manage, setManage] = React.useState(false)
    const presets = catalogue?.slots ?? []
    const customProblem = custom && (from || to) ? validateCustomSlot(from, to) : null

    const pick = (sel: TimeSlotSelection): void => { onChange(sel); setOpen(false); setCustom(false) }
    const Row = ({ sel, label, sub }: { sel: TimeSlotSelection; label: string; sub?: string }): React.JSX.Element => {
        const on = selectionKey(sel) === selectionKey(value)
        return (
            <button
                type="button"
                onClick={() => { pick(sel) }}
                className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-foreground/[0.05]", on && "text-accent-foreground")}
            >
                <span className="min-w-0 flex-1">
                    <span className="block truncate">{label}</span>
                    {sub ? <span className="block text-xs text-muted-foreground">{sub}</span> : null}
                </span>
                {on && <Check className="h-4 w-4 shrink-0" />}
            </button>
        )
    }

    return (
        <>
            <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setCustom(false) } }}>
                <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" disabled={(disabled ?? false) || !catalogue} className={cn(value.kind !== "all" && "border-accent-base/60 text-accent-foreground")}>
                        <Clock className="mr-1.5 h-4 w-4" />
                        {selectionLabel(value, presets)}
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-72 p-1.5">
                    <div className="micro-label px-2.5 pb-1 pt-1.5">Time of day</div>
                    <Row sel={ALL_DAY} label="All day" />
                    {presets.map((p) => (
                        <Row key={p.id} sel={presetSelection(p.id)} label={presetOptionLabel(p)} sub={p.crossesMidnight ? "Crosses midnight — counted on the day it starts" : undefined} />
                    ))}
                    {!custom ? (
                        <button type="button" onClick={() => { setCustom(true) }} className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-sm hover:bg-foreground/[0.05]">
                            <span className="flex-1">Custom…</span>
                            {value.kind === "custom" && <Check className="h-4 w-4 text-accent-foreground" />}
                        </button>
                    ) : (
                        <div className="space-y-2 rounded-md bg-inset p-2.5">
                            <div className="flex items-center gap-2">
                                <Input aria-label="From" placeholder="12:00" value={from} onChange={(e) => { setFrom(e.target.value) }} className="h-8" />
                                <span className="text-muted-foreground">–</span>
                                <Input aria-label="To" placeholder="17:00" value={to} onChange={(e) => { setTo(e.target.value) }} className="h-8" />
                            </div>
                            {customProblem ? (
                                <p className="text-xs text-destructive">{customProblem}</p>
                            ) : from && to && crossesMidnight(from, to) ? (
                                <p className="text-xs text-muted-foreground">Crosses midnight — each night is counted on the day it starts.</p>
                            ) : null}
                            <Button size="sm" className="w-full" disabled={!from || !to || Boolean(customProblem)} onClick={() => { pick(customSelection(from, to)) }}>
                                Apply {from && to && !customProblem ? clockRange(from, to) : ""}
                            </Button>
                        </div>
                    )}
                    {catalogue?.canEdit && (
                        <>
                            <div className="my-1 h-px bg-divider" />
                            <button type="button" onClick={() => { setOpen(false); setManage(true) }} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-foreground/[0.05]">
                                <Settings2 className="h-4 w-4 text-muted-foreground" /> Manage sessions…
                            </button>
                        </>
                    )}
                </PopoverContent>
            </Popover>
            {manage && catalogue && (
                <ManageSessions
                    catalogue={catalogue}
                    onClose={() => { setManage(false) }}
                    onSaved={(next) => { onCatalogue(next); setManage(false) }}
                />
            )}
        </>
    )
}

function ManageSessions({ catalogue, onClose, onSaved }: { catalogue: TimeSlotCatalogue; onClose: () => void; onSaved: (c: TimeSlotCatalogue) => void }): React.JSX.Element {
    const [drafts, setDrafts] = React.useState<TimeSlotDraft[]>(() => catalogue.slots.map((p) => ({ id: p.id, label: p.label, start: p.start, end: p.end })))
    const [error, setError] = React.useState<string | null>(null)
    const [saving, setSaving] = React.useState(false)

    const set = (i: number, patch: Partial<TimeSlotDraft>): void => { setDrafts((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x))) }

    const save = async (): Promise<void> => {
        const problem = validateSlotDrafts(drafts)
        if (problem) { setError(problem); return }
        setSaving(true)
        setError(null)
        try {
            const res = await putTimeSlots(slotDraftsBody(drafts))
            const next = catalogueFromJson(res)
            onSaved(next ?? { ...catalogue, slots: drafts.map((d) => ({ id: d.id ?? d.label, label: d.label, start: d.start, end: d.end, crossesMidnight: crossesMidnight(d.start, d.end) })) })
        } catch (e) {
            setError(isUnreachableError(e)
                ? "This device can't reach the restaurant server. Reconnect and try again — nothing was saved."
                : (e as Error).message)
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open onOpenChange={(o) => { if (!o) { onClose() } }}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Manage sessions</DialogTitle>
                    <DialogDescription>
                        The restaurant&apos;s saved times of day, for every report. Up to {MAX_TIME_SLOTS}; an end earlier than its start runs past midnight.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                    {drafts.map((d, i) => (
                        <div key={d.id ?? `new-${i}`} className="flex items-center gap-2">
                            <Input aria-label="Session name" placeholder="Lunch" value={d.label} maxLength={24} onChange={(e) => { set(i, { label: e.target.value }) }} className="h-9 flex-1" />
                            <Input aria-label="Start" placeholder="12:00" value={d.start} onChange={(e) => { set(i, { start: e.target.value }) }} className="h-9 w-20" />
                            <span className="text-muted-foreground">–</span>
                            <Input aria-label="End" placeholder="17:00" value={d.end} onChange={(e) => { set(i, { end: e.target.value }) }} className="h-9 w-20" />
                            <Button variant="ghost" size="icon" aria-label="Remove session" onClick={() => { setDrafts((x) => x.filter((_, j) => j !== i)) }}>
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>
                    ))}
                    {drafts.length === 0 && <p className="text-sm text-muted-foreground">No sessions. Saving an empty list restores the defaults.</p>}
                    <Button variant="outline" size="sm" disabled={drafts.length >= MAX_TIME_SLOTS} onClick={() => { setDrafts((x) => [...x, { label: "", start: "", end: "" }]) }}>
                        <Plus className="mr-1.5 h-4 w-4" /> Add session
                    </Button>
                    {error && <p className="text-sm text-destructive">{error}</p>}
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button onClick={() => { void save() }} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
