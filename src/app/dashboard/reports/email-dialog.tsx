"use client"

// SEND NOW — email the report on screen (or any of the eighteen) for the days
// on screen, to addresses from the restaurant's address book.
//
// What it will not pretend:
//  * the email is built and sent by the server, in the background. The dialog
//    shows "Sending…" while it polls the delivery and says what happened to
//    EACH address; if that takes longer than a minute it says so and points at
//    the history, rather than claiming a success it has not seen.
//  * a session filter (Lunch, Dinner) is NOT applied to an email — the server
//    refuses one, because an attachment an accountant opens must cover whole
//    days. The dialog says so instead of sending the filter anyway.
//  * one request id per SEND, not per opening. Pressing Send again with the
//    same choices before the delivery is final is the same send (the server
//    answers it as a replay, never as a second email); changing the reports,
//    days or addresses — or sending again after a final answer — is a new one.
//    One id for the whole opening once replayed an old failed send in place of
//    the corrected one.
//  * a failure the server will retry says so ("Not sent yet"), not "Couldn't
//    send".

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, CheckCircle2, Loader2, Mail, XCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { getReportDelivery, getReportEmailConfig, getReportEmailRecipients, sendReportEmail, type ReportDelivery } from "@/lib/db"
import { ALL_OUTLETS } from "@/lib/outlet"
import {
    EMAILABLE_REPORTS,
    EMAIL_AREA_TITLE,
    FORMAT_LABELS,
    MIS_EMAIL_KEYS,
    POLL_INTERVAL_MS,
    POLL_MAX_TRIES,
    RECIPIENT_OUTCOME_LABELS,
    WHOLE_DAYS_NOTE,
    bookEntryLabel,
    buildSendBody,
    isFinalDelivery,
    isResting,
    newClientRequestId,
    orderedKeys,
    readBook,
    readReportEmailConfig,
    recipientOutcomes,
    refusalTitle,
    reportDisabledReason,
    reportListPhrase,
    requestIdFor,
    sendBodyKey,
    sendNowBlocked,
    sendOutcome,
    type BookEntry,
    type LastSend,
    type ReportEmailConfig,
} from "@/lib/report-email"
import { cn } from "@/lib/utils"

export interface EmailReportDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    rid: string
    /** The report tab on screen — ticked when the dialog opens. */
    reportKey: string
    from: string
    to: string
    /** The session filter on screen, when one is applied ("Lunch"). */
    slotPhrase: string | null
    /** The Reports screen's own outlet choice; ALL_OUTLETS for the combined view. */
    outletId: string | undefined
    /** A real outlet to run the request as when the combined view is chosen. */
    fallbackOutletId: string | undefined
    outletLabel: string
    /** Opens the Email reports area (the address book lives there). */
    onOpenArea: () => void
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function EmailReportDialog(props: EmailReportDialogProps) {
    const { open, onOpenChange, rid, reportKey, from, to, slotPhrase, outletId, fallbackOutletId, outletLabel, onOpenArea } = props
    const { toast } = useToast()

    const [config, setConfig] = useState<ReportEmailConfig | null>(null)
    const [book, setBook] = useState<BookEntry[]>([])
    const [loaded, setLoaded] = useState(false)
    const [keys, setKeys] = useState<string[]>([reportKey])
    const [formats, setFormats] = useState<string[]>(["xlsx"])
    const [dayFrom, setDayFrom] = useState(from)
    const [dayTo, setDayTo] = useState(to)
    const [close, setClose] = useState("")
    const [chosen, setChosen] = useState<string[]>([])
    const [error, setError] = useState<string | null>(null)
    const [sending, setSending] = useState(false)
    const [delivery, setDelivery] = useState<ReportDelivery | null>(null)
    const lastSend = useRef<LastSend | null>(null)
    const alive = useRef(true)

    const combined = outletId === ALL_OUTLETS

    // Every opening is a new send: no id yet, the tab on screen, the days on screen.
    useEffect(() => {
        if (!open) {return}
        alive.current = true
        lastSend.current = null
        setKeys([reportKey])
        setFormats(["xlsx"])
        setDayFrom(from)
        setDayTo(to)
        setClose("")
        setChosen([])
        setError(null)
        setDelivery(null)
        setSending(false)
        setLoaded(false)
        let active = true
        void Promise.all([getReportEmailConfig(rid), getReportEmailRecipients(rid)]).then(([c, b]) => {
            if (!active) {return}
            setConfig(readReportEmailConfig(c))
            setBook((readBook(b)?.recipients ?? []).filter((e) => e.status === "active"))
            setLoaded(true)
        })
        return () => { active = false; alive.current = false }
    }, [open, rid, reportKey, from, to])

    const blocked = loaded ? sendNowBlocked(config) : null
    const allOutletsRefused = combined && config !== null && !config.can_use_all_outlets
    const maxRecipients = config?.limits.recipients_per_send ?? 10
    const mode = close.trim() ? "trading_day" : "calendar"
    const catalogue = config?.reports ?? [...EMAILABLE_REPORTS]
    const misKeys = catalogue.filter((r) => r.family === "mis").map((r) => r.key)
    const accountingReports = catalogue.filter((r) => r.family === "accounting")
    const allMis = MIS_EMAIL_KEYS.every((k) => keys.includes(k))

    const toggleKey = (key: string) => {
        setKeys((k) => (k.includes(key) ? k.filter((x) => x !== key) : orderedKeys([...k, key])))
    }
    const toggleFormat = (f: string) => {
        setFormats((list) => (list.includes(f) ? list.filter((x) => x !== f) : [...list, f]))
    }
    const toggleRecipient = (id: string) => {
        setChosen((list) => (list.includes(id) ? list.filter((x) => x !== id) : list.length >= maxRecipients ? list : [...list, id]))
    }

    const poll = useCallback(async (deliveryId: string): Promise<{ d: ReportDelivery | null; timedOut: boolean }> => {
        let last: ReportDelivery | null = null
        for (let i = 0; i < POLL_MAX_TRIES && alive.current; i += 1) {
            await sleep(POLL_INTERVAL_MS)
            const d = await getReportDelivery(rid, deliveryId)
            if (d) {
                last = d
                setDelivery(d)
                if (isResting(d)) {return { d, timedOut: false }}
            }
        }
        return { d: last, timedOut: true }
    }, [rid])

    const send = async () => {
        setError(null)
        // A fresh id is only USED when this is not a retry of the last send.
        const fresh = newClientRequestId()
        const built = buildSendBody({
            clientRequestId: fresh,
            reportKeys: keys,
            formats,
            from: dayFrom,
            to: dayTo,
            dayClose: close,
            scope: combined ? "all" : "outlet",
            recipientIds: chosen,
        }, maxRecipients)
        if (!built.ok) { setError(built.error); return }
        const bodyKey = sendBodyKey(built.body)
        const id = requestIdFor(lastSend.current, bodyKey, () => fresh)
        const current: LastSend = { id, bodyKey, settled: false }
        lastSend.current = current
        setDelivery(null)
        setSending(true)
        try {
            // The request runs as a REAL outlet; the combined scope is in the body.
            const asOutlet = combined ? fallbackOutletId : outletId
            const res = await sendReportEmail(rid, { ...built.body, client_request_id: id }, asOutlet)
            if (!res.ok) {
                setError(res.error)
                toast({ title: refusalTitle(res.code), description: res.error, variant: "destructive" })
                return
            }
            const { d, timedOut } = await poll(res.data.delivery_id)
            // A FINAL answer ends this id: the next press is a new send.
            if (d && isFinalDelivery(d)) {current.settled = true}
            const outcome = sendOutcome(d, timedOut)
            toast({ title: outcome.title, description: outcome.description, variant: outcome.destructive ? "destructive" : undefined })
            if (d?.status === "delivered") { onOpenChange(false) }
        } finally {
            if (alive.current) {setSending(false)}
        }
    }

    const rows = useMemo(() => (delivery ? recipientOutcomes(delivery) : []), [delivery])

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!sending) {onOpenChange(v)} }}>
            <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><Mail className="h-5 w-5" /> Email reports</DialogTitle>
                    <DialogDescription>
                        {outletLabel} · the server builds the files and emails them to each address separately — nobody sees anybody else&apos;s address.
                    </DialogDescription>
                </DialogHeader>

                {!loaded ? (
                    <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking the email settings…</p>
                ) : (
                    <div className="space-y-4 text-sm">
                        {(blocked || allOutletsRefused) && (
                            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                                <div>
                                    <p className="font-medium">{blocked ?? "All outlets needs an admin or a manager"}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {blocked
                                            ? "Nothing can be emailed until this is fixed. Reports can still be exported from this screen."
                                            : "Pick a single outlet to email its reports."}
                                    </p>
                                </div>
                            </div>
                        )}

                        <section className="space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="font-medium">Reports</p>
                                <Button
                                    type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs"
                                    onClick={() => { setKeys(allMis ? [reportKey] : orderedKeys([...keys, ...misKeys])) }}
                                >
                                    {allMis ? "Only this report" : "All 15 MIS reports"}
                                </Button>
                            </div>
                            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                                {[...catalogue.filter((r) => r.family === "mis"), ...accountingReports].map((r) => {
                                    const why = reportDisabledReason(r.key, mode)
                                    return (
                                        <label key={r.key} className={cn("flex items-center gap-2 rounded px-1 py-0.5", why && "opacity-60")}>
                                            <Checkbox checked={keys.includes(r.key)} disabled={Boolean(why)} onCheckedChange={() => { toggleKey(r.key) }} />
                                            <span className="min-w-0 truncate">{r.title}</span>
                                            {why && <span className="text-xs text-muted-foreground">({why})</span>}
                                        </label>
                                    )
                                })}
                            </div>
                            <p className="text-xs text-muted-foreground">{reportListPhrase(orderedKeys(keys))}</p>
                        </section>

                        <section className="grid gap-3 sm:grid-cols-3">
                            <div className="space-y-1">
                                <Label htmlFor="email-from">From</Label>
                                <Input id="email-from" type="date" value={dayFrom} onChange={(e) => { setDayFrom(e.target.value) }} />
                            </div>
                            <div className="space-y-1">
                                <Label htmlFor="email-to">To</Label>
                                <Input id="email-to" type="date" value={dayTo} onChange={(e) => { setDayTo(e.target.value) }} />
                            </div>
                            <div className="space-y-1">
                                <Label htmlFor="email-close">Close each day at</Label>
                                <Input
                                    id="email-close" type="time" step={60} value={close}
                                    title="Leave empty for calendar days (midnight to midnight)"
                                    onChange={(e) => { setClose(e.target.value) }}
                                />
                            </div>
                            <p className="text-xs text-muted-foreground sm:col-span-3">
                                {close
                                    ? `Each day runs for 24 hours up to ${close} — bills settled after midnight count on the day they belong to. GST and Profit & Loss are calendar days only.`
                                    : "Calendar days, midnight to midnight, in the restaurant's time zone."}
                                {slotPhrase ? ` ${WHOLE_DAYS_NOTE} (${slotPhrase})` : ""}
                            </p>
                        </section>

                        <section className="space-y-1.5">
                            <p className="font-medium">Attach as</p>
                            <div className="flex flex-wrap gap-4">
                                {(config?.formats ?? ["xlsx", "csv"]).map((f) => (
                                    <label key={f} className="flex items-center gap-2">
                                        <Checkbox checked={formats.includes(f)} onCheckedChange={() => { toggleFormat(f) }} />
                                        <span>{FORMAT_LABELS[f]}</span>
                                    </label>
                                ))}
                            </div>
                        </section>

                        <section className="space-y-1.5">
                            <p className="font-medium">Send to <span className="font-normal text-muted-foreground">(up to {maxRecipients})</span></p>
                            {book.length === 0 ? (
                                <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                                    <p>No addresses in the address book yet. Reports can only be emailed to addresses in it.</p>
                                    <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => { onOpenChange(false); onOpenArea() }}>
                                        Open {EMAIL_AREA_TITLE} → Address book
                                    </Button>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                                    {book.map((e) => (
                                        <label key={e.id} className="flex min-w-0 items-center gap-2">
                                            <Checkbox
                                                checked={chosen.includes(e.id)}
                                                disabled={!chosen.includes(e.id) && chosen.length >= maxRecipients}
                                                onCheckedChange={() => { toggleRecipient(e.id) }}
                                            />
                                            <span className="min-w-0 truncate" title={e.email}>{bookEntryLabel(e)}</span>
                                        </label>
                                    ))}
                                </div>
                            )}
                        </section>

                        {rows.length > 0 && (
                            <section className="space-y-1 rounded-md border p-2">
                                {rows.map((r) => (
                                    <p key={r.email} className="flex items-center gap-2 text-xs">
                                        {r.outcome === "sent" ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                                            : r.outcome === "waiting" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                                                : <XCircle className="h-3.5 w-3.5 text-destructive" />}
                                        <span className="min-w-0 truncate">{r.email}</span>
                                        <span className="ml-auto text-muted-foreground">{RECIPIENT_OUTCOME_LABELS[r.outcome]}</span>
                                    </p>
                                ))}
                            </section>
                        )}

                        {error && <p className="text-sm text-destructive">{error}</p>}
                    </div>
                )}

                <DialogFooter className="gap-2">
                    <Button variant="ghost" disabled={sending} onClick={() => { onOpenChange(false) }}>Close</Button>
                    <Button
                        disabled={!loaded || sending || Boolean(blocked) || allOutletsRefused || book.length === 0}
                        title={blocked ?? undefined}
                        onClick={() => void send()}
                    >
                        {sending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Mail className="mr-1.5 h-4 w-4" />}
                        {sending ? "Sending…" : "Send"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
