"use client"

// WHICH PART OF THE DAY — the session picker beside the date range.
//
// Client ask: pick a time for session-wise reports, with Lunch and Dinner as
// presets, and let the superadmin choose which time slots exist. So the control
// does two jobs and keeps them visibly apart:
//
//  * PICKING is for anyone who can read the report: All day, one of the saved
//    sessions, or custom times. A slot is a filter on data the reader could
//    already see across the whole day, so it needs no permission of its own.
//  * MANAGING the saved list is behind `can_edit` — the server's answer to "does
//    this caller hold the settings permission" — and the entry is simply absent
//    for everyone else rather than present and refused.
//
// THE TRIGGER ALWAYS SAYS WHAT IS PICKED ("Dinner · 18:00–24:00"), for the same
// reason the date range's does: a filtered figure next to a control that does
// not say what it filtered to is how an evening's takings get read as a day's.
//
// Every rule and every sentence is in @/lib/report-time-slots, shared word for
// word with the owner app; this file is layout and state.

import { useEffect, useState, type ReactElement } from "react"
import { Check, Clock, Loader2, Plus, Settings2, Trash2 } from "lucide-react"

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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
    ALL_DAY,
    MAX_TIME_SLOTS,
    MAX_TIME_SLOT_LABEL,
    crossesMidnight,
    normaliseSlotSelection,
    presetOptionLabel,
    slotSelectionLabel,
    validateCustomSlot,
    validateSlotDrafts,
    type ReportTimeSlotPreset,
    type ReportTimeSlots,
    type TimeSlotDraft,
    type TimeSlotSelection,
} from "@/lib/report-time-slots"
import { cn } from "@/lib/utils"

type SaveOutcome = { ok: true; data: ReportTimeSlots } | { ok: false; error: string }

/**
 * What a save that never got an answer says — the sentence saveReportTimeSlots
 * returns when the backend itself cannot be reached. Trying again is safe: the
 * save replaces the whole list, so a repeat of one that did land changes nothing.
 */
const SAVE_UNREACHABLE = "Could not reach the server — check the connection and try again."

interface Props {
    value: TimeSlotSelection
    slots: ReportTimeSlotPreset[]
    canEdit: boolean
    onChange: (next: TimeSlotSelection) => void
    /** PUT the whole list. An empty list restores the defaults. */
    onSave: (drafts: TimeSlotDraft[]) => Promise<SaveOutcome>
    /** The list the server now holds, after a successful save. */
    onSaved: (next: ReportTimeSlots) => void
    disabled?: boolean
}

/**
 * The restaurant's list, edited as a whole and saved as a whole — the route
 * replaces the list, so the dialog never pretends a single row was saved on its
 * own. The server judges overlaps; its sentence is shown here, verbatim.
 */
function ManageSessionsDialog({
    open, onOpenChange, slots, onSave, onSaved,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    slots: ReportTimeSlotPreset[]
    onSave: (drafts: TimeSlotDraft[]) => Promise<SaveOutcome>
    onSaved: (next: ReportTimeSlots) => void
}): ReactElement {
    const [drafts, setDrafts] = useState<TimeSlotDraft[]>([])
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [confirmReset, setConfirmReset] = useState(false)

    useEffect(() => {
        if (!open) {return}
        setDrafts(slots.map((s) => ({ id: s.id, label: s.label, start: s.start, end: s.end })))
        setError(null)
        setSaving(false)
        setConfirmReset(false)
    }, [open, slots])

    const edit = (i: number, patch: Partial<TimeSlotDraft>): void => {
        setDrafts((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
        setError(null)
    }

    const submit = async (list: TimeSlotDraft[]): Promise<void> => {
        const problem = validateSlotDrafts(list)
        if (problem) {setError(problem); return}
        setSaving(true)
        // A THROWN SAVE MUST STILL UNLOCK THE DIALOG. onSave is a Server Action:
        // it RETURNS the backend's refusals, but the browser-to-Next hop itself
        // rejects — till wifi dropping, or a deploy landing while this tab was
        // open ("Failed to find Server Action"). Without the finally, `saving`
        // stays true, every button here is disabled and the dialog refuses to
        // close, so only a page reload gets the owner out.
        let outcome: SaveOutcome
        try {
            outcome = await onSave(list)
        } catch {
            outcome = { ok: false, error: SAVE_UNREACHABLE }
        } finally {
            setSaving(false)
        }
        if (!outcome.ok) {setError(outcome.error); return}
        onSaved(outcome.data)
        onOpenChange(false)
    }

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!saving) {onOpenChange(next)} }}>
            <DialogContent className="max-h-[90vh] max-w-[min(94vw,34rem)] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Manage sessions</DialogTitle>
                    <DialogDescription>
                        Saved for the whole restaurant. Everyone who reads reports can pick these; only people who can
                        change settings can edit them. 24-hour times; an end may be 24:00, and an end before the start
                        runs past midnight.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-2">
                    {drafts.map((d, i) => (
                        <div key={d.id ?? `new-${String(i)}`} className="flex flex-wrap items-center gap-2 rounded-md border p-2 sm:flex-nowrap sm:border-0 sm:p-0">
                            <Input
                                value={d.label}
                                onChange={(e) => { edit(i, { label: e.target.value }) }}
                                placeholder="Name"
                                maxLength={MAX_TIME_SLOT_LABEL}
                                className="h-9 min-w-0 basis-full sm:basis-auto sm:flex-1"
                                aria-label={`Session ${String(i + 1)} name`}
                            />
                            <Input
                                value={d.start}
                                onChange={(e) => { edit(i, { start: e.target.value }) }}
                                placeholder="HH:mm"
                                inputMode="numeric"
                                maxLength={5}
                                className="h-9 w-[5.5rem]"
                                aria-label={`Session ${String(i + 1)} start, HH:mm`}
                            />
                            <span className="text-muted-foreground">–</span>
                            <Input
                                value={d.end}
                                onChange={(e) => { edit(i, { end: e.target.value }) }}
                                placeholder="HH:mm"
                                inputMode="numeric"
                                maxLength={5}
                                className="h-9 w-[5.5rem]"
                                aria-label={`Session ${String(i + 1)} end, HH:mm (24:00 allowed)`}
                            />
                            <Button
                                variant="ghost"
                                size="icon"
                                className="ml-auto h-9 w-9 shrink-0"
                                onClick={() => { setDrafts((rows) => rows.filter((_, j) => j !== i)); setError(null) }}
                                aria-label={`Remove ${d.label || `session ${String(i + 1)}`}`}
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>
                    ))}
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={drafts.length >= MAX_TIME_SLOTS}
                        onClick={() => { setDrafts((rows) => [...rows, { label: "", start: "", end: "" }]); setError(null) }}
                    >
                        <Plus className="mr-1.5 h-4 w-4" />
                        {drafts.length >= MAX_TIME_SLOTS ? `At most ${String(MAX_TIME_SLOTS)} sessions` : "Add session"}
                    </Button>
                </div>

                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

                <DialogFooter className="gap-2 sm:items-center sm:justify-between sm:space-x-0">
                    {confirmReset ? (
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span>Replace these with Lunch and Dinner?</span>
                            <Button size="sm" variant="destructive" disabled={saving} onClick={() => { void submit([]) }}>Reset</Button>
                            <Button size="sm" variant="ghost" disabled={saving} onClick={() => { setConfirmReset(false) }}>Keep</Button>
                        </div>
                    ) : (
                        <Button variant="ghost" size="sm" disabled={saving} onClick={() => { setConfirmReset(true) }}>
                            Reset to defaults
                        </Button>
                    )}
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled={saving} onClick={() => { onOpenChange(false) }}>Cancel</Button>
                        <Button size="sm" disabled={saving} onClick={() => { void submit(drafts) }}>
                            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                            Save sessions
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export function TimeSlotPicker({ value, slots, canEdit, onChange, onSave, onSaved, disabled }: Props): ReactElement {
    const [open, setOpen] = useState(false)
    const [managing, setManaging] = useState(false)
    const [customOpen, setCustomOpen] = useState(value.kind === "custom")
    const [from, setFrom] = useState(value.kind === "custom" ? value.from : "")
    const [to, setTo] = useState(value.kind === "custom" ? value.to : "")
    const [customError, setCustomError] = useState<string | null>(null)

    // Reopening shows the committed choice, not a half-typed pair from last time.
    useEffect(() => {
        if (!open) {return}
        setCustomOpen(value.kind === "custom")
        setFrom(value.kind === "custom" ? value.from : "")
        setTo(value.kind === "custom" ? value.to : "")
        setCustomError(null)
    }, [open, value])

    const choose = (next: TimeSlotSelection): void => {
        onChange(next)
        setOpen(false)
    }

    const applyCustom = (): void => {
        const problem = validateCustomSlot(from, to)
        if (problem) {setCustomError(problem); return}
        choose(normaliseSlotSelection({ kind: "custom", from, to }))
    }

    const label = slotSelectionLabel(value, slots)
    const filtered = value.kind !== "all"

    const option = (key: string, text: string, active: boolean, onClick: () => void): ReactElement => (
        <button
            key={key}
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={cn(
                "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition",
                active ? "bg-primary text-primary-foreground" : "hover:bg-accent hover:text-accent-foreground",
            )}
        >
            <span className="truncate">{text}</span>
            {active && <Check className="h-3.5 w-3.5 shrink-0" />}
        </button>
    )

    return (
        <>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={disabled}
                        aria-label={`Session: ${label}`}
                        title="The part of each day this report counts, in restaurant time"
                        className={cn("h-9 max-w-full gap-2 font-normal", filtered && "border-primary text-primary")}
                    >
                        <Clock className="h-4 w-4 shrink-0" />
                        <span className="max-w-[13rem] truncate font-medium">{label}</span>
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 max-w-[92vw] p-2">
                    <p className="px-2.5 pb-1 pt-0.5 text-xs font-medium">Session</p>
                    <p className="px-2.5 pb-2 text-xs leading-snug text-muted-foreground">
                        Restaurant time, on each day of the range.
                    </p>
                    <div className="space-y-0.5">
                        {option("all", "All day", value.kind === "all", () => { choose(ALL_DAY) })}
                        {slots.map((p) => option(
                            p.id,
                            presetOptionLabel(p),
                            value.kind === "preset" && value.id === p.id,
                            () => { choose({ kind: "preset", id: p.id }) },
                        ))}
                        {option("custom", "Custom…", value.kind === "custom", () => { setCustomOpen((v) => !v) })}
                    </div>

                    {customOpen && (
                        <div className="mt-2 space-y-2 rounded-md border p-2">
                            <div className="flex items-end gap-2">
                                <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
                                    From
                                    <Input
                                        value={from}
                                        onChange={(e) => { setFrom(e.target.value); setCustomError(null) }}
                                        placeholder="HH:mm"
                                        inputMode="numeric"
                                        maxLength={5}
                                        className="h-8"
                                        aria-label="Custom session start, HH:mm"
                                    />
                                </label>
                                <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
                                    To
                                    <Input
                                        value={to}
                                        onChange={(e) => { setTo(e.target.value); setCustomError(null) }}
                                        onKeyDown={(e) => { if (e.key === "Enter") {applyCustom()} }}
                                        placeholder="HH:mm"
                                        inputMode="numeric"
                                        maxLength={5}
                                        className="h-8"
                                        aria-label="Custom session end, HH:mm (24:00 allowed)"
                                    />
                                </label>
                                <Button size="sm" className="h-8" onClick={applyCustom}>Apply</Button>
                            </div>
                            {customError ? (
                                <p role="alert" className="text-xs text-destructive">{customError}</p>
                            ) : (
                                <p className="text-xs leading-snug text-muted-foreground">
                                    {crossesMidnight(from, to)
                                        ? "Crosses midnight — each night is counted on the day it starts."
                                        : "24-hour times. The end may be 24:00."}
                                </p>
                            )}
                        </div>
                    )}

                    {canEdit && (
                        <>
                            <div className="my-2 h-px bg-border" />
                            <button
                                type="button"
                                onClick={() => { setOpen(false); setManaging(true) }}
                                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                            >
                                <Settings2 className="h-3.5 w-3.5" /> Manage sessions…
                            </button>
                        </>
                    )}
                </PopoverContent>
            </Popover>

            {canEdit && (
                <ManageSessionsDialog
                    open={managing}
                    onOpenChange={setManaging}
                    slots={slots}
                    onSave={onSave}
                    onSaved={onSaved}
                />
            )}
        </>
    )
}
