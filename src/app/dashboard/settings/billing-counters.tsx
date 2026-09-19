"use client"

// BILLING COUNTERS — the tills this outlet rings on. Migration 038.
//
// A COUNTER IS AN IDENTITY, NOT AN EVENT. It is a till, configured once, durable,
// existing whether or not anyone is trading — as opposed to a cash session,
// which is one drawer counted once at the end of one shift. The relationship is
// one counter to many sessions, and 038 puts `counter_id` on BOTH the bill
// (which till RANG the sale) and the cash session (which till was COUNTED),
// because only with both can a cash-up be reconciled against the sales it is
// supposed to explain. That is the whole reason this screen exists, and it is
// why it does not try to be the cash-up: counting a drawer stays in
// Accounting → Cash.
//
// EMPTY IS THE NORMAL STATE, and this card says so rather than looking broken.
// Most restaurants have one billing point and never configure a counter; they
// get NULL attribution on every bill, which reads as "this outlet's till"
// everywhere, and the Counter Summary shows one honest unassigned row. Nothing
// on this screen is required of anybody.
//
// THERE IS NO DELETE, here or on the server. Removing a counter would orphan the
// attribution on every bill it ever rang — precisely the history the column
// exists to keep — so a till is RETIRED. A retired till stops being offered at
// the point of sale and still resolves on every bill and cash session that names
// it, which is what keeps last quarter's cash-up readable.

import { useCallback, useEffect, useState } from "react"
import type * as React from "react"
import { Loader2, Monitor, Pencil, Plus, RotateCcw, Save } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { forgetTillIfRetired } from "@/lib/api/payment"
import { getBillingCounters, saveBillingCounter } from "@/lib/db"
import { COUNTER_KINDS, humaniseToken, type BillingCounterRecord } from "@/lib/mis-capture"

interface Draft {
    code: string
    name: string
    kind: string
    device_hint: string
}

const EMPTY: Draft = { code: "", name: "", kind: "counter", device_hint: "" }

export function BillingCountersCard({ restaurantId, canEdit }: {
    restaurantId: string
    canEdit: boolean
}): React.JSX.Element {
    const { toast } = useToast()
    const [counters, setCounters] = useState<BillingCounterRecord[]>([])
    // "None configured" and "could not be read" look identical as an empty list
    // and mean opposite things — one is a correct configuration, the other is an
    // outage. The read returns null for the second, and this keeps them apart.
    const [failed, setFailed] = useState(false)
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [draft, setDraft] = useState<Draft>(EMPTY)
    // The per-row edit dialog (finding 35 / settings 26): code, name, kind and
    // device hint, saved explicitly rather than on blur.
    const [editing, setEditing] = useState<BillingCounterRecord | null>(null)
    const [edit, setEdit] = useState<Draft>(EMPTY)

    const load = useCallback(() => {
        if (!restaurantId) {return}
        setLoading(true)
        // include_inactive: this is the editor, and it is the ONLY place a retired
        // till can be seen — which makes it the only place one can be reinstated.
        void getBillingCounters(restaurantId, true)
            .then((rows) => { setFailed(rows === null); setCounters(rows ?? []) })
            .finally(() => { setLoading(false) })
    }, [restaurantId])
    useEffect(() => { load() }, [load])

    const fail = (e: unknown): void => {
        toast({ title: "Not saved", description: e instanceof Error ? e.message : String(e), variant: "destructive" })
    }

    const add = async (): Promise<void> => {
        if (!draft.code.trim()) {return}
        setBusy(true)
        try {
            const saved = await saveBillingCounter(restaurantId, {
                code: draft.code.trim(),
                name: draft.name.trim() || draft.code.trim(),
                kind: draft.kind,
                device_hint: draft.device_hint.trim() || null,
            })
            toast({ title: `Saved ${saved.code}`, description: `${saved.name} · ${humaniseToken(saved.kind, COUNTER_KINDS)}` })
            setDraft(EMPTY)
            load()
        } catch (e) { fail(e) } finally { setBusy(false) }
    }

    const setActive = async (c: BillingCounterRecord, active: boolean): Promise<void> => {
        setBusy(true)
        try {
            // The write UPSERTS ON THE CODE, so re-sending the row's own fields with
            // one changed is a merge, not a duplicate — and "C1" and "c1" can never
            // become two tills nobody can tell apart on a cash-up sheet at 1am.
            await saveBillingCounter(restaurantId, {
                id: c.id, code: c.code, name: c.name, kind: c.kind,
                device_hint: c.device_hint, sort_order: c.sort_order, active,
            })
            // The payment sheet's session till memory must not keep offering a
            // till that no longer rings sales.
            if (!active) { forgetTillIfRetired(c.id) }
            toast({
                title: active ? `${c.code} is back in service` : `${c.code} retired`,
                description: active
                    ? "It will be offered again at the point of sale."
                    : "It stops being offered. Every bill and cash session that names it still resolves.",
            })
            load()
        } catch (e) { fail(e) } finally { setBusy(false) }
    }

    const rename = async (c: BillingCounterRecord, name: string): Promise<void> => {
        if (name.trim().length === 0 || name.trim() === c.name) {return}
        setBusy(true)
        try {
            await saveBillingCounter(restaurantId, {
                id: c.id, code: c.code, name: name.trim(), kind: c.kind,
                device_hint: c.device_hint, sort_order: c.sort_order, active: c.active,
            })
            load()
        } catch (e) { fail(e) } finally { setBusy(false) }
    }

    const openEdit = (c: BillingCounterRecord): void => {
        setEdit({ code: c.code, name: c.name, kind: c.kind, device_hint: c.device_hint ?? "" })
        setEditing(c)
    }

    const editCodeChanged = editing !== null && edit.code.trim().toLowerCase() !== editing.code.toLowerCase()

    const saveEdit = async (): Promise<void> => {
        if (editing === null || !edit.code.trim()) {return}
        const c = editing
        setBusy(true)
        try {
            const fields = {
                name: edit.name.trim() || edit.code.trim(),
                kind: edit.kind,
                device_hint: edit.device_hint.trim() || null,
                sort_order: c.sort_order,
            }
            if (!editCodeChanged) {
                // Same code (case-insensitively) — the upsert merges onto this till.
                await saveBillingCounter(restaurantId, { id: c.id, code: edit.code.trim(), active: c.active, ...fields })
                toast({ title: `Saved ${edit.code.trim()}`, description: `${fields.name} · ${humaniseToken(fields.kind, COUNTER_KINDS)}` })
            } else {
                // THE WRITE UPSERTS ON THE CODE, so a new code is a different
                // till: save it under the new code, then retire the old one so
                // it stops being offered. Every bill the old code rang still
                // resolves to it — history is never rewritten.
                const saved = await saveBillingCounter(restaurantId, { code: edit.code.trim(), active: true, ...fields })
                await saveBillingCounter(restaurantId, {
                    id: c.id, code: c.code, name: c.name, kind: c.kind,
                    device_hint: c.device_hint, sort_order: c.sort_order, active: false,
                })
                forgetTillIfRetired(c.id)
                toast({
                    title: `Saved ${saved.code}; ${c.code} retired`,
                    description: `Bills ${c.code} already rang still name it. New sales ring on ${saved.code}.`,
                })
            }
            setEditing(null)
            load()
        } catch (e) { fail(e) } finally { setBusy(false) }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Monitor className="h-5 w-5 text-primary" /> Billing counters
                </CardTitle>
                <CardDescription>
                    The tills this outlet rings bills on. Configure them only if you have more than one —
                    with none configured every bill counts as this outlet&apos;s single till, which is correct
                    and is what the Counter Summary will show.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {loading ? (
                    <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Reading this outlet&apos;s tills…
                    </div>
                ) : failed ? (
                    <p className="text-sm text-destructive">
                        This outlet&apos;s tills could not be read — this is not the same as &ldquo;none configured&rdquo;.
                        Check your connection and reload before changing anything here.
                    </p>
                ) : counters.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        No tills configured. Every bill is attributed to this outlet as a whole — which is the
                        right answer for a restaurant with one billing point.
                    </p>
                ) : (
                    <div className="space-y-2">
                        {counters.map((c) => (
                            <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
                                <Badge variant="outline" className="font-mono">{c.code}</Badge>
                                <Input
                                    className="h-8 w-48"
                                    defaultValue={c.name}
                                    disabled={!canEdit || busy}
                                    aria-label={`Name of till ${c.code}`}
                                    onBlur={(e) => { void rename(c, e.target.value) }}
                                />
                                <span className="text-xs text-muted-foreground">
                                    {humaniseToken(c.kind, COUNTER_KINDS)}
                                    {c.device_hint ? ` · ${c.device_hint}` : ""}
                                </span>
                                {c.active ? null : (
                                    <Badge variant="secondary" className="text-[10px] uppercase">Retired</Badge>
                                )}
                                {canEdit ? (
                                    <Button
                                        variant="ghost" size="sm" className="ml-auto gap-1"
                                        disabled={busy}
                                        aria-label={`Edit till ${c.code}`}
                                        onClick={() => { openEdit(c) }}
                                    >
                                        <Pencil className="h-3.5 w-3.5" /> Edit
                                    </Button>
                                ) : null}
                                <Button
                                    variant="ghost" size="sm" className={canEdit ? "gap-1" : "ml-auto gap-1"}
                                    disabled={!canEdit || busy}
                                    onClick={() => void setActive(c, !c.active)}
                                >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                    {c.active ? "Retire" : "Reinstate"}
                                </Button>
                            </div>
                        ))}
                    </div>
                )}

                {canEdit ? (
                    <div className="grid gap-2 rounded-md border border-dashed p-3 sm:grid-cols-12">
                        <div className="sm:col-span-2">
                            <Label className="text-[11px]">Code</Label>
                            <Input
                                className="h-9" value={draft.code} maxLength={16}
                                onChange={(e) => { setDraft((d) => ({ ...d, code: e.target.value })) }}
                                placeholder="C1"
                            />
                        </div>
                        <div className="sm:col-span-4">
                            <Label className="text-[11px]">Name</Label>
                            <Input
                                className="h-9" value={draft.name}
                                onChange={(e) => { setDraft((d) => ({ ...d, name: e.target.value })) }}
                                placeholder="Front counter"
                            />
                        </div>
                        <div className="sm:col-span-3">
                            <Label className="text-[11px]">Kind</Label>
                            <Select value={draft.kind} onValueChange={(v) => { setDraft((d) => ({ ...d, kind: v })) }}>
                                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {COUNTER_KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="sm:col-span-3">
                            <Label className="text-[11px]">Device hint</Label>
                            <div className="flex gap-1">
                                <Input
                                    className="h-9" value={draft.device_hint}
                                    onChange={(e) => { setDraft((d) => ({ ...d, device_hint: e.target.value })) }}
                                    placeholder="optional"
                                />
                                <Button className="h-9 shrink-0 gap-1" disabled={busy || !draft.code.trim()} onClick={() => void add()}>
                                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                                    Add
                                </Button>
                            </div>
                        </div>
                        <p className="text-xs text-muted-foreground sm:col-span-12">
                            A <b>counter</b>{" "}is a billing point with a drawer; a <b>terminal</b>{" "}is a device that rings up
                            to one. Saving a code that already exists updates that till rather than creating a second
                            one, so re-saving this screen is always safe.
                        </p>
                    </div>
                ) : (
                    <p className="text-xs text-muted-foreground">
                        Creating and renaming a till needs the &ldquo;Manage Restaurant Settings&rdquo; permission.
                        Whoever takes payment can already <i>choose</i>{" "}their till at the point of sale.
                    </p>
                )}

                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Save className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Tills are retired, never deleted — a bill that names one must still resolve next year.
                </p>

                <Dialog open={editing !== null} onOpenChange={(v) => { if (!v && !busy) {setEditing(null)} }}>
                    <DialogContent className="max-w-lg">
                        <DialogHeader>
                            <DialogTitle>Edit till {editing?.code ?? ""}</DialogTitle>
                            <DialogDescription>
                                Change what this till is called, what kind it is and which device it lives on.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label>Code</Label>
                                <Input
                                    value={edit.code} maxLength={16}
                                    onChange={(e) => { setEdit((d) => ({ ...d, code: e.target.value })) }}
                                />
                                <p className="text-[11px] text-muted-foreground">
                                    Short and unique — it is what a cash-up sheet says at 1am.
                                </p>
                            </div>
                            <div className="space-y-1.5">
                                <Label>Name</Label>
                                <Input
                                    value={edit.name}
                                    onChange={(e) => { setEdit((d) => ({ ...d, name: e.target.value })) }}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Kind</Label>
                                <Select value={edit.kind} onValueChange={(v) => { setEdit((d) => ({ ...d, kind: v })) }}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {COUNTER_KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label>Device hint</Label>
                                <Input
                                    value={edit.device_hint} placeholder="optional"
                                    onChange={(e) => { setEdit((d) => ({ ...d, device_hint: e.target.value })) }}
                                />
                            </div>
                        </div>
                        {editCodeChanged ? (
                            <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
                                A till is saved by its code, so a new code is a new till: saving creates (or updates)
                                <b> {edit.code.trim()}</b>{" "}and retires <b>{editing.code}</b>. Bills {editing.code}{" "}
                                already rang keep naming it.
                            </p>
                        ) : null}
                        <DialogFooter>
                            <Button variant="ghost" disabled={busy} onClick={() => { setEditing(null) }}>Cancel</Button>
                            <Button disabled={busy || !edit.code.trim()} onClick={() => void saveEdit()}>
                                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                Save
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    )
}
