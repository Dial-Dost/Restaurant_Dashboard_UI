"use client"

// INSIGHTS → REPORTS → EMAIL REPORTS (client item 9).
//
// "All reports or any reports can be emailed to chosen email IDs, automated so
// emails are sent at the end of each day at a specific time to the chosen
// email IDs, with an option to choose/add both the email IDs and the send time."
//
// Three blocks, in the order an owner sets this up:
//   1. THE ADDRESS BOOK. Reports only ever go to addresses in it. Adding and
//      removing is the Settings permission (the owner always has it); anyone
//      with the reports permission can pick from it. "Send test email" proves
//      the whole path — DNS, the provider, the spam folder — before the first
//      real report depends on it.
//   2. THE SCHEDULES. Any of the eighteen reports, any minute of the day, one
//      email per schedule with an Excel workbook (CSV optional). A daily
//      schedule covers "the day that just ended": the 24 hours up to the send
//      time, so a 02:00 close reports the trading day it closes.
//   3. THE HISTORY. Every run is a row the moment it is claimed — a missing
//      report is a visible row, not an absence — with what happened to each
//      address and the files themselves.
//
// The server decides what this deployment can do (GET /reports/email/config)
// and this screen obeys: "Email is not set up on this server" is shown, the
// email controls are disabled with that reason, and the in-app inbox still
// works. Waiters never reach this page (the Reports tab is ACCOUNTING-gated).
//
// Every hour here is the RESTAURANT's wall clock, never the viewer's.

import { useCallback, useEffect, useMemo, useState } from "react"
import {
    AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Download, Info, Layers, Loader2, Mail, Pause, Play, Plus, Send, Store, Trash2, XCircle,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import {
    addReportEmailRecipient, deleteReportSchedule, getReportDeliveries, getReportDeliveryCsv, getReportDeliveryFile,
    getReportEmailConfig, getReportEmailRecipients, getReportSchedules, removeReportEmailRecipient, runReportScheduleFor,
    saveReportSchedule, sendReportTestEmail,
    type ReportDelivery, type ReportSchedule,
} from "@/lib/db"
import { ALL_OUTLETS, getSelectedOutletId, setSelectedOutlet } from "@/lib/outlet"
import {
    ADDRESS_BOOK_EMPTY, ADDRESS_BOOK_READ_ONLY, ADDRESS_BOOK_TITLE, BLANK_EMAIL_SCHEDULE, EMAILABLE_REPORTS, FORMAT_LABELS,
    MIS_EMAIL_KEYS, POLL_INTERVAL_MS, RECIPIENT_OUTCOME_LABELS, TEST_EMAIL_LABEL, WINDOW_MODE_LABELS,
    addressProblem, bookEntryLabel, buildEmailSchedulePatch, cadenceCaption, configBanners, coverageCaption,
    defaultWindowMode, deliveryKind, deliveryStatus, fileLabel, formFromSchedule, isFinalDelivery, newClientRequestId,
    nextRunCaption, orderedKeys, periodPhrase, readBook, readReportEmailConfig, recipientOutcomes, refusalTitle,
    reportDisabledReason, reportListPhrase, retryCaption, wallClock, WATCH_MAX_MS,
    type BookEntry, type DeliveryFile, type EmailScheduleForm, type ReportEmailConfig, type StatusTone,
} from "@/lib/report-email"
import { runScheduleAction } from "@/lib/report-schedule-actions"
import { timezoneCaption } from "@/lib/tz"
import { cn } from "@/lib/utils"

const DELIVERY_LIMIT = 30
const SELECT_CLASS = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-ring"
const CHIP = "whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold"
const TONE_CLASS: Record<StatusTone, string> = {
    ok: `${CHIP} bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300`,
    bad: `${CHIP} bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300`,
    pending: `${CHIP} bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300`,
    muted: `${CHIP} bg-muted text-muted-foreground`,
}
const FREQUENCIES = [
    { value: "daily", label: "Daily" },
    { value: "weekly", label: "Weekly" },
    { value: "monthly", label: "Monthly" },
]
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const MONTH_DAYS = Array.from({ length: 28 }, (_, i) => i + 1)

// A schedule belongs to ONE outlet, and the backend refuses every write made
// from the all-outlets combined view (see accounting/scheduled-reports.tsx for
// the history of this rule).
const COMBINED_VIEW_NOTE = "Pick a single outlet before changing a schedule — a combined view spans several."

function saveBase64(base64: string, mime: string, filename: string) {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
}

export interface EmailReportsPanelProps {
    rid: string
    timezone: string
}

export function EmailReportsPanel({ rid, timezone }: EmailReportsPanelProps) {
    const { toast } = useToast()
    const [config, setConfig] = useState<ReportEmailConfig | null>(null)
    const [configAsked, setConfigAsked] = useState(false)
    const [book, setBook] = useState<BookEntry[]>([])
    const [bookFailed, setBookFailed] = useState(false)
    const [schedules, setSchedules] = useState<ReportSchedule[]>([])
    const [schedulesFailed, setSchedulesFailed] = useState(false)
    const [deliveries, setDeliveries] = useState<ReportDelivery[]>([])
    const [historyFailed, setHistoryFailed] = useState(false)
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [combinedView, setCombinedView] = useState(false)
    useEffect(() => { setCombinedView(getSelectedOutletId() === ALL_OUTLETS) }, [])

    const load = useCallback(async () => {
        if (!rid) {return}
        setLoading(true)
        const [c, b, s, d] = await Promise.all([
            getReportEmailConfig(rid),
            getReportEmailRecipients(rid),
            getReportSchedules(rid),
            getReportDeliveries(rid, { limit: DELIVERY_LIMIT }),
        ])
        setConfig(readReportEmailConfig(c))
        setConfigAsked(true)
        const parsed = readBook(b)
        setBook(parsed?.recipients ?? [])
        setBookFailed(parsed === null)
        setSchedules(s ?? [])
        setSchedulesFailed(s === null)
        setDeliveries(d ?? [])
        setHistoryFailed(d === null)
        setLoading(false)
    }, [rid])

    useEffect(() => { void load() }, [load])

    // A delivery still in flight — or waiting for the server's retry — refreshes
    // itself, so "Sending" turns into "Sent" without anyone pressing Refresh.
    const inFlight = deliveries.some((d) => !isFinalDelivery(d) && Date.now() - Date.parse(d.created_at) < WATCH_MAX_MS)
    useEffect(() => {
        if (!inFlight) {return}
        const t = setTimeout(() => {
            void getReportDeliveries(rid, { limit: DELIVERY_LIMIT }).then((d) => { if (d) {setDeliveries(d)} })
        }, POLL_INTERVAL_MS * 3)
        return () => { clearTimeout(t) }
    }, [inFlight, deliveries, rid])

    const banners = configAsked ? configBanners(config) : []
    const canEditBook = config?.can_edit_recipients === true
    const mailReady = config?.email_available === true && config.schema_ready

    return (
        <div className="flex flex-col gap-4">
            {banners.map((b) => (
                <div
                    key={b.title}
                    role="status"
                    className={cn(
                        "flex items-start gap-2 rounded-lg border p-3 text-sm",
                        b.tone === "error" ? "border-destructive/40 bg-destructive/5" : b.tone === "warning" ? "border-amber-500/40 bg-amber-500/5" : "bg-muted/40",
                    )}
                >
                    {b.tone === "info" ? <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : <AlertCircle className={cn("mt-0.5 h-4 w-4 shrink-0", b.tone === "error" ? "text-destructive" : "text-amber-600")} />}
                    <div className="min-w-0">
                        <p className="font-medium">{b.title}</p>
                        {b.detail && <p className="text-xs text-muted-foreground">{b.detail}</p>}
                    </div>
                </div>
            ))}

            <AddressBookCard
                rid={rid}
                book={book}
                failed={bookFailed}
                loading={loading}
                canEdit={canEditBook}
                mailReady={mailReady}
                max={config?.limits.address_book ?? 25}
                reload={load}
                toast={toast}
            />

            <SchedulesCard
                rid={rid}
                timezone={timezone}
                config={config}
                book={book}
                schedules={schedules}
                failed={schedulesFailed}
                loading={loading}
                busy={busy}
                setBusy={setBusy}
                combinedView={combinedView}
                reload={load}
                toast={toast}
            />

            <HistoryCard
                rid={rid}
                timezone={timezone}
                schedules={schedules}
                deliveries={deliveries}
                failed={historyFailed}
                reload={load}
                toast={toast}
            />
        </div>
    )
}

type Toast = ReturnType<typeof useToast>["toast"]

// --- The address book ----------------------------------------------------------

function AddressBookCard({ rid, book, failed, loading, canEdit, mailReady, max, reload, toast }: {
    rid: string; book: BookEntry[]; failed: boolean; loading: boolean; canEdit: boolean; mailReady: boolean
    max: number; reload: () => Promise<void>; toast: Toast
}) {
    const [email, setEmail] = useState("")
    const [label, setLabel] = useState("")
    const [working, setWorking] = useState<string | null>(null)
    const [problem, setProblem] = useState<string | null>(null)

    const add = async () => {
        const why = addressProblem(email, book, max)
        if (why) { setProblem(why); return }
        setProblem(null)
        setWorking("add")
        try {
            const res = await addReportEmailRecipient(rid, { email: email.trim(), label: label.trim() || undefined })
            if (!res.ok) { setProblem(res.error); return }
            setEmail("")
            setLabel("")
            toast({ title: "Address added", description: `${email.trim()} can now be chosen for reports.` })
            await reload()
        } finally { setWorking(null) }
    }

    const remove = async (e: BookEntry) => {
        if (!window.confirm(`Remove ${e.email}? Every schedule stops emailing it from the next run.`)) {return}
        setWorking(e.id)
        try {
            const res = await removeReportEmailRecipient(rid, e.id)
            if (!res.ok) { toast({ title: "Couldn't remove the address", description: res.error, variant: "destructive" }); return }
            toast({ title: "Address removed", description: `${e.email} will not receive any more reports.` })
            await reload()
        } finally { setWorking(null) }
    }

    const test = async (e: BookEntry) => {
        setWorking(`test:${e.id}`)
        try {
            const res = await sendReportTestEmail(rid, { recipientId: e.id, clientRequestId: newClientRequestId() })
            if (!res.ok) { toast({ title: refusalTitle(res.code), description: res.error, variant: "destructive" }); return }
            toast({ title: "Test email queued", description: `Check ${e.email} in a minute — and its spam folder. The result appears in the history below.` })
            await reload()
        } finally { setWorking(null) }
    }

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-base">{ADDRESS_BOOK_TITLE}</CardTitle>
                <CardDescription>
                    Reports are only ever emailed to these addresses — up to {max}. They do not need a login. Removing an
                    address stops every schedule from emailing it.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {loading ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                ) : failed ? (
                    <p className="text-sm text-muted-foreground">Couldn&apos;t load the address book.</p>
                ) : book.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{ADDRESS_BOOK_EMPTY}</p>
                ) : (
                    <ul className="divide-y rounded-lg border">
                        {book.map((e) => (
                            <li key={e.id} className="flex flex-wrap items-center gap-2 p-2 text-sm">
                                <div className="min-w-0 flex-1">
                                    <p className="truncate font-medium" title={e.email}>{e.label ?? e.email}</p>
                                    {e.label && <p className="truncate text-xs text-muted-foreground">{e.email}</p>}
                                </div>
                                {e.status === "suppressed" && (
                                    <span className={TONE_CLASS.muted} title={e.suppressed_reason ?? undefined}>Paused</span>
                                )}
                                {canEdit && (
                                    <>
                                        <Button
                                            size="sm" variant="outline" disabled={!mailReady || e.status !== "active" || working !== null}
                                            title={mailReady ? undefined : "Email is not set up on this server"}
                                            onClick={() => void test(e)}
                                        >
                                            {working === `test:${e.id}` ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
                                            {TEST_EMAIL_LABEL}
                                        </Button>
                                        <Button size="icon" variant="ghost" aria-label={`Remove ${e.email}`} disabled={working !== null} onClick={() => void remove(e)}>
                                            <Trash2 className="h-4 w-4 text-destructive" />
                                        </Button>
                                    </>
                                )}
                            </li>
                        ))}
                    </ul>
                )}

                {canEdit ? (
                    <div className="space-y-1">
                        <div className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]">
                            <Input
                                type="email" value={email} placeholder="name@example.com" aria-label="Email address"
                                onChange={(ev) => { setEmail(ev.target.value); setProblem(null) }}
                            />
                            <Input value={label} placeholder="Label (optional)" aria-label="Label" maxLength={80} onChange={(ev) => { setLabel(ev.target.value) }} />
                            <Button disabled={working !== null || book.length >= max} onClick={() => void add()}>
                                {working === "add" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />} Add address
                            </Button>
                        </div>
                        {problem && <p className="text-xs text-destructive">{problem}</p>}
                    </div>
                ) : (
                    <p className="text-xs text-muted-foreground">{ADDRESS_BOOK_READ_ONLY}</p>
                )}
            </CardContent>
        </Card>
    )
}

// --- The schedules ---------------------------------------------------------------

function SchedulesCard({ rid, timezone, config, book, schedules, failed, loading, busy, setBusy, combinedView, reload, toast }: {
    rid: string; timezone: string; config: ReportEmailConfig | null; book: BookEntry[]; schedules: ReportSchedule[]
    failed: boolean; loading: boolean; busy: boolean; setBusy: (b: boolean) => void; combinedView: boolean
    reload: () => Promise<void>; toast: Toast
}) {
    // null = closed, "" = creating, an id = editing that row.
    const [editing, setEditing] = useState<string | null>(null)
    const [form, setForm] = useState<EmailScheduleForm>(BLANK_EMAIL_SCHEDULE)
    const [missing, setMissing] = useState<string[]>([])
    const [recipientsTouched, setRecipientsTouched] = useState(false)
    const [enabled, setEnabled] = useState(true)
    const actionDeps = { setBusy, toast }
    const activeBook = book.filter((b) => b.status === "active")
    const emailOk = config?.email_available === true

    const startCreate = () => {
        setEditing("")
        setForm({ ...BLANK_EMAIL_SCHEDULE, channel: emailOk ? "email" : "inbox" })
        setMissing([])
        setRecipientsTouched(true)
        setEnabled(true)
    }
    const startEdit = (s: ReportSchedule) => {
        const { form: f, missing: m } = formFromSchedule(s, book)
        setEditing(s.id)
        setForm(f)
        setMissing(m)
        setRecipientsTouched(false)
        setEnabled(s.enabled)
    }

    const save = async () => {
        const built = buildEmailSchedulePatch(form, { maxRecipients: config?.limits.recipients_per_send, recipientsTouched })
        if (!built.ok) { toast({ title: built.message, variant: "destructive" }); return }
        const isEdit = Boolean(editing)
        await runScheduleAction(actionDeps, "Couldn't save the schedule", async () => {
            const res = await saveReportSchedule(rid, editing || null, { ...built.patch, enabled })
            if (!res.ok) {throw new Error(res.error)}
            setEditing(null)
            await reload()
            return { title: isEdit ? "Schedule updated" : "Schedule created" }
        })
    }

    const toggleEnabled = async (s: ReportSchedule) => {
        await runScheduleAction(actionDeps, "Couldn't change the schedule", async () => {
            // One key: the backend fills every other field from the stored row.
            const res = await saveReportSchedule(rid, s.id, { enabled: !s.enabled })
            if (!res.ok) {throw new Error(res.error)}
            await reload()
            return { title: s.enabled ? "Schedule paused" : "Schedule resumed" }
        })
    }

    const remove = async (s: ReportSchedule) => {
        if (!window.confirm(`Stop sending "${s.name}"? Past deliveries stay in the history and can still be downloaded.`)) {return}
        await runScheduleAction(actionDeps, "Couldn't remove the schedule", async () => {
            await deleteReportSchedule(rid, s.id)
            if (editing === s.id) {setEditing(null)}
            await reload()
            return { title: "Schedule removed" }
        })
    }

    const runNow = async (s: ReportSchedule) => {
        await runScheduleAction(actionDeps, "Couldn't queue this report", async () => {
            const res = await runReportScheduleFor(rid, s.id)
            if (!res.ok) {throw new Error(res.error)}
            await reload()
            if (!res.data.queued) {
                return { title: "Already queued", description: res.data.note ?? "This report is already queued for this minute — nothing extra was started." }
            }
            return {
                title: "Queued",
                description: s.next_window?.day_close
                    ? "It covers the trading day that closed most recently. Its result appears in the history below."
                    : "Its result appears in the history below in a moment.",
            }
        })
    }

    const set = <K extends keyof EmailScheduleForm>(key: K, value: EmailScheduleForm[K]) => {
        setForm((f) => {
            const next = { ...f, [key]: value }
            // Weekly and monthly runs are calendar periods; a new daily one closes at its send time.
            if (key === "frequency") {next.window_mode = value === "daily" ? defaultWindowMode("daily", next.report_keys) : "calendar"}
            return next
        })
    }
    const toggleKey = (key: string) => {
        setForm((f) => ({ ...f, report_keys: f.report_keys.includes(key) ? f.report_keys.filter((k) => k !== key) : orderedKeys([...f.report_keys, key]) }))
    }
    const toggleRecipient = (id: string) => {
        setRecipientsTouched(true)
        setForm((f) => ({ ...f, recipient_ids: f.recipient_ids.includes(id) ? f.recipient_ids.filter((x) => x !== id) : [...f.recipient_ids, id] }))
    }
    const toggleFormat = (fmt: string) => {
        setForm((f) => ({ ...f, formats: f.formats.includes(fmt) ? f.formats.filter((x) => x !== fmt) : [...f.formats, fmt] }))
    }

    const catalogue = config?.reports ?? [...EMAILABLE_REPORTS]
    const mode = form.frequency === "daily" ? form.window_mode : "calendar"
    const allMis = MIS_EMAIL_KEYS.every((k) => form.report_keys.includes(k))
    const maxRecipients = config?.limits.recipients_per_send ?? 10

    const editor = (
        <div className="space-y-4 rounded-lg border p-3 text-sm">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="sched-name">Name</Label>
                    <Input id="sched-name" placeholder="e.g. Nightly close" value={form.name} maxLength={120} onChange={(e) => { set("name", e.target.value) }} />
                </div>
                <div className="space-y-1">
                    <Label htmlFor="sched-freq">How often</Label>
                    <select id="sched-freq" className={SELECT_CLASS} value={form.frequency} onChange={(e) => { set("frequency", e.target.value) }}>
                        {FREQUENCIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </div>
                <div className="space-y-1">
                    <Label htmlFor="sched-time">Send at</Label>
                    {/* Any minute of the day — step 60 seconds, the restaurant's clock. */}
                    <Input id="sched-time" type="time" step={60} value={form.time} title={`In ${timezone}, not your device's zone`} onChange={(e) => { set("time", e.target.value) }} />
                </div>
                {form.frequency === "weekly" && (
                    <div className="space-y-1">
                        <Label htmlFor="sched-weekday">Day</Label>
                        <select id="sched-weekday" className={SELECT_CLASS} value={form.weekday} onChange={(e) => { set("weekday", e.target.value) }}>
                            {WEEKDAYS.map((d, i) => <option key={d} value={String(i)}>{d}</option>)}
                        </select>
                    </div>
                )}
                {form.frequency === "monthly" && (
                    <div className="space-y-1">
                        <Label htmlFor="sched-dom">Day of month</Label>
                        <select id="sched-dom" className={SELECT_CLASS} value={form.day_of_month} onChange={(e) => { set("day_of_month", e.target.value) }}>
                            {MONTH_DAYS.map((d) => <option key={d} value={String(d)}>Day {d}</option>)}
                        </select>
                    </div>
                )}
            </div>

            {form.frequency === "daily" && (
                <fieldset className="space-y-1">
                    <legend className="font-medium">Each email covers</legend>
                    <div className="flex flex-wrap gap-4">
                        {(["trading_day", "calendar"] as const).map((m) => (
                            <label key={m} className="flex items-center gap-2">
                                <input type="radio" name="sched-window" checked={form.window_mode === m} onChange={() => { set("window_mode", m) }} />
                                <span>{WINDOW_MODE_LABELS[m]}</span>
                            </label>
                        ))}
                    </div>
                </fieldset>
            )}
            <p className="text-xs text-muted-foreground">{coverageCaption(form.frequency, mode, form.time)} Restaurant time · {timezoneCaption(timezone)}.</p>

            <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">Reports <span className="font-normal text-muted-foreground">· {reportListPhrase(orderedKeys(form.report_keys))}</span></p>
                    <Button
                        type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs"
                        onClick={() => { setForm((f) => ({ ...f, report_keys: allMis ? f.report_keys.filter((k) => !MIS_EMAIL_KEYS.includes(k)) : orderedKeys([...f.report_keys, ...MIS_EMAIL_KEYS]) })) }}
                    >
                        {allMis ? "Clear the MIS reports" : "All 15 MIS reports"}
                    </Button>
                </div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                    {catalogue.map((r) => {
                        const why = reportDisabledReason(r.key, mode)
                        return (
                            <label key={r.key} className={cn("flex items-center gap-2", why && "opacity-60")}>
                                <Checkbox checked={form.report_keys.includes(r.key)} disabled={Boolean(why)} onCheckedChange={() => { toggleKey(r.key) }} />
                                <span className="min-w-0 truncate">{r.title}</span>
                                {why && <span className="text-xs text-muted-foreground">({why})</span>}
                            </label>
                        )
                    })}
                </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                    <Label htmlFor="sched-channel">Deliver to</Label>
                    <select id="sched-channel" className={SELECT_CLASS} value={form.channel} onChange={(e) => { set("channel", e.target.value) }}>
                        <option value="email" disabled={!emailOk}>{emailOk ? "Email" : "Email (not set up on this server)"}</option>
                        <option value="inbox">In-app inbox (notification bell)</option>
                    </select>
                </div>
                {config?.can_use_all_outlets && (
                    <div className="space-y-1">
                        <Label htmlFor="sched-scope">Outlets</Label>
                        <select id="sched-scope" className={SELECT_CLASS} value={form.outlet_scope} onChange={(e) => { set("outlet_scope", e.target.value === "all" ? "all" : "outlet") }}>
                            <option value="outlet">This outlet</option>
                            <option value="all">All outlets (combined)</option>
                        </select>
                    </div>
                )}
            </div>

            <div className="space-y-1.5">
                <p className="font-medium">Attach as</p>
                <div className="flex flex-wrap gap-4">
                    {(["xlsx", "csv"] as const).map((f) => (
                        <label key={f} className="flex items-center gap-2">
                            <Checkbox checked={form.formats.includes(f)} onCheckedChange={() => { toggleFormat(f) }} />
                            <span>{FORMAT_LABELS[f]}</span>
                        </label>
                    ))}
                </div>
            </div>

            {form.channel === "email" && (
                <div className="space-y-1.5">
                    <p className="font-medium">Send to <span className="font-normal text-muted-foreground">(up to {maxRecipients}, from the address book)</span></p>
                    {activeBook.length === 0 ? (
                        <p className="text-xs text-muted-foreground">{ADDRESS_BOOK_EMPTY}</p>
                    ) : (
                        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                            {activeBook.map((b) => (
                                <label key={b.id} className="flex min-w-0 items-center gap-2">
                                    <Checkbox
                                        checked={form.recipient_ids.includes(b.id)}
                                        disabled={!form.recipient_ids.includes(b.id) && form.recipient_ids.length >= maxRecipients}
                                        onCheckedChange={() => { toggleRecipient(b.id) }}
                                    />
                                    <span className="min-w-0 truncate" title={b.email}>{bookEntryLabel(b)}</span>
                                </label>
                            ))}
                        </div>
                    )}
                    {missing.length > 0 && !recipientsTouched && (
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                            Also stored: {missing.join(", ")} — not in the address book, so skipped at send time. Change the selection to drop {missing.length === 1 ? "it" : "them"}.
                        </p>
                    )}
                </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2">
                    <Switch checked={enabled} onCheckedChange={setEnabled} />
                    <span>{enabled ? "On" : "Paused"}</span>
                </label>
                <div className="ml-auto flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(null) }}>Cancel</Button>
                    <Button size="sm" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : editing ? "Save" : "Create"}</Button>
                </div>
            </div>
        </div>
    )

    return (
        <Card>
            <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <CardTitle className="text-base">Schedules</CardTitle>
                        <CardDescription>
                            Any reports, any time of day, one email per schedule. A daily schedule covers the day that just
                            ended — the 24 hours up to its send time.
                        </CardDescription>
                        {combinedView && (
                            <p className="mt-2 inline-flex items-start gap-1.5 text-xs text-muted-foreground">
                                <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                <span>Showing <strong className="font-semibold">all outlets (combined)</strong>. {COMBINED_VIEW_NOTE}</span>
                            </p>
                        )}
                    </div>
                    <Button size="sm" onClick={startCreate} disabled={editing === "" || combinedView} title={combinedView ? COMBINED_VIEW_NOTE : undefined}>
                        <Plus className="mr-1 h-4 w-4" /> New schedule
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                {editing === "" && editor}
                {loading ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                ) : failed ? (
                    <div className="text-sm text-muted-foreground">
                        <p>Couldn&apos;t load the schedules.</p>
                        <Button variant="outline" size="sm" className="mt-2" onClick={() => void reload()}>Retry</Button>
                    </div>
                ) : schedules.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No schedules yet — create one and the reports arrive without anyone opening this page.</p>
                ) : (
                    schedules.map((s) => {
                        const keys = s.report_keys && s.report_keys.length > 0 ? s.report_keys : [s.report_key]
                        const next = nextRunCaption(s, timezone)
                        return (
                            <div key={s.id} className="rounded-lg border p-3 text-sm">
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="min-w-0 flex-1">
                                        <p className="font-medium">
                                            {s.name}
                                            <span className="text-xs font-normal text-muted-foreground">
                                                {" · "}{reportListPhrase(keys)} · {(s.formats && s.formats.length > 0 ? s.formats : [s.format]).map((f) => f.toUpperCase()).join(" + ")}
                                                {s.outlet_scope === "all" ? " · all outlets" : ""}
                                            </span>
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {cadenceCaption(s)} · {s.channel === "email"
                                                ? `Email to ${(s.recipients ?? []).join(", ") || "nobody yet"}`
                                                : "In-app inbox"}
                                        </p>
                                        {next && <p className="text-xs text-muted-foreground">{next}</p>}
                                    </div>
                                    {!s.enabled && <span className={TONE_CLASS.muted}>Paused</span>}
                                    {s.last_status && (
                                        <span className={s.last_status === "delivered" ? TONE_CLASS.ok : TONE_CLASS.bad}>
                                            {s.last_status === "delivered" ? "Last run OK" : "Last run failed"}
                                        </span>
                                    )}
                                    {combinedView ? (
                                        <Button size="sm" variant="outline" title={COMBINED_VIEW_NOTE} onClick={() => { void setSelectedOutlet(s.outlet_id) }}>
                                            <Store className="mr-1 h-4 w-4" /> Switch to this outlet
                                        </Button>
                                    ) : (
                                        <div className="flex flex-wrap gap-1">
                                            <Button
                                                size="sm" variant="outline" disabled={busy || (s.channel === "email" && !emailOk)}
                                                title={s.channel === "email" && !emailOk ? "Email is not set up on this server" : undefined}
                                                onClick={() => void runNow(s)}
                                            >
                                                <Play className="mr-1 h-4 w-4" /> Run now
                                            </Button>
                                            <Button size="sm" variant="outline" disabled={busy} onClick={() => void toggleEnabled(s)}>
                                                {s.enabled ? <><Pause className="mr-1 h-4 w-4" /> Pause</> : "Resume"}
                                            </Button>
                                            <Button size="sm" variant="outline" onClick={() => { if (editing === s.id) {setEditing(null)} else {startEdit(s)} }}>Edit</Button>
                                            <Button size="icon" variant="ghost" aria-label={`Remove ${s.name}`} disabled={busy} onClick={() => void remove(s)}>
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                            </Button>
                                        </div>
                                    )}
                                </div>
                                {s.last_status !== "delivered" && s.last_error && (
                                    <p className="mt-2 text-xs text-destructive">
                                        {s.last_error}
                                        {s.consecutive_failures > 0 ? ` · ${s.consecutive_failures} failure${s.consecutive_failures === 1 ? "" : "s"} in a row` : ""}
                                        {!s.enabled ? " · paused automatically — resume it once the cause is fixed" : ""}
                                    </p>
                                )}
                                {editing === s.id && <div className="mt-3">{editor}</div>}
                            </div>
                        )
                    })
                )}
            </CardContent>
        </Card>
    )
}

// --- The history -----------------------------------------------------------------

function HistoryCard({ rid, timezone, schedules, deliveries, failed, reload, toast }: {
    rid: string; timezone: string; schedules: ReportSchedule[]; deliveries: ReportDelivery[]
    failed: boolean; reload: () => Promise<void>; toast: Toast
}) {
    const [open, setOpen] = useState<string | null>(null)
    const byId = useMemo(() => new Map(schedules.map((s) => [s.id, s])), [schedules])

    const download = async (d: ReportDelivery, f: DeliveryFile) => {
        const res = await getReportDeliveryFile(rid, d.id, f.id)
        if (!res.ok) { toast({ title: "Couldn't download the file", description: res.error, variant: "destructive" }); return }
        saveBase64(res.data.base64, res.data.mime, f.filename)
    }
    const downloadLegacy = async (d: ReportDelivery) => {
        try {
            const csv = await getReportDeliveryCsv(rid, d.id)
            const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
            const a = document.createElement("a")
            a.href = url
            a.download = d.artifact_name ?? `report_${d.period_from}_to_${d.period_to}.csv`
            a.click()
            URL.revokeObjectURL(url)
        } catch (e) {
            toast({ title: "Couldn't download the report", description: String((e as Error)?.message ?? e), variant: "destructive" })
        }
    }

    return (
        <Card>
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                    <div>
                        <CardTitle className="text-base">History</CardTitle>
                        <CardDescription>Every run and every send, with what happened to each address. Files are kept for 90 days.</CardDescription>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => void reload()}>Refresh</Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-2">
                {failed ? (
                    <p className="text-sm text-muted-foreground">Couldn&apos;t load the history.</p>
                ) : deliveries.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing has run yet.</p>
                ) : deliveries.map((d) => {
                    const status = deliveryStatus(d)
                    const schedule = d.schedule_id ? byId.get(d.schedule_id) : undefined
                    const keys = d.report_keys && d.report_keys.length > 0 ? d.report_keys : []
                    const kindLabel = deliveryKind(d, d.occurrence_key)
                    // Deliveries outlive their schedule, so a removed one still says something.
                    const title = d.kind === "adhoc" ? kindLabel : schedule?.name ?? "Removed schedule"
                    const rows = recipientOutcomes(d, d.channel === "email" && schedule ? schedule.recipients ?? [] : [])
                    const files = d.files ?? []
                    const expanded = open === d.id
                    return (
                        <div key={d.id} className="rounded-lg border p-2 text-sm">
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    className="flex min-w-0 flex-1 items-start gap-1 text-left"
                                    aria-expanded={expanded}
                                    onClick={() => { setOpen(expanded ? null : d.id) }}
                                >
                                    {expanded ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" />}
                                    <span className="min-w-0">
                                        <span className="block font-medium">
                                            {title}
                                            <span className="text-xs font-normal text-muted-foreground">
                                                {" · "}{keys.length > 0 ? `${reportListPhrase(keys)} · ` : ""}
                                                {d.day_close && d.window_start_at && d.window_end_at
                                                    ? `${wallClock(d.window_start_at, d.timezone)} → ${wallClock(d.window_end_at, d.timezone)}`
                                                    : periodPhrase(d.period_from, d.period_to)}
                                            </span>
                                        </span>
                                        <span className="block text-xs text-muted-foreground">
                                            {d.kind === "adhoc" ? "" : `${kindLabel} · `}{wallClock(d.fire_at, d.timezone)}
                                            {d.channel === "email" && rows.length > 0 ? ` · ${rows.filter((r) => r.outcome === "sent").length}/${rows.length} sent` : ""}
                                            {d.attempts > 1 ? ` · ${d.attempts} attempts` : ""}
                                            {d.maybe_duplicate ? " · may have been sent twice" : ""}
                                        </span>
                                    </span>
                                </button>
                                <span className={TONE_CLASS[status.tone]}>{status.label}</span>
                            </div>
                            {d.error && <p className={cn("mt-1 text-xs", isFinalDelivery(d) ? "text-destructive" : "text-muted-foreground")}>{d.error}</p>}
                            {retryCaption(d) && <p className="mt-0.5 text-xs text-muted-foreground">{retryCaption(d)}</p>}
                            {expanded && (
                                <div className="mt-2 space-y-2 border-t pt-2">
                                    {rows.length > 0 && (
                                        <ul className="space-y-0.5">
                                            {rows.map((r) => (
                                                <li key={r.email} className="flex items-center gap-2 text-xs">
                                                    {r.outcome === "sent" ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                                                        : r.outcome === "waiting" ? <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                                                            : <XCircle className="h-3.5 w-3.5 text-destructive" />}
                                                    <span className="min-w-0 truncate">{r.email}</span>
                                                    <span className="ml-auto text-muted-foreground">{RECIPIENT_OUTCOME_LABELS[r.outcome]}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                    <div className="flex flex-wrap gap-2">
                                        {files.map((f) => (
                                            <Button key={f.id} size="sm" variant="outline" disabled={f.purged} onClick={() => void download(d, f)}>
                                                <Download className="mr-1 h-4 w-4" /> {fileLabel(f)}
                                            </Button>
                                        ))}
                                        {files.length === 0 && d.artifact_name && (
                                            <Button size="sm" variant="outline" onClick={() => void downloadLegacy(d)}>
                                                <Download className="mr-1 h-4 w-4" /> CSV
                                            </Button>
                                        )}
                                        {files.length === 0 && !d.artifact_name && (
                                            <p className="text-xs text-muted-foreground">{keys.length === 0 && d.kind === "adhoc" ? "A test email carries no files." : "No files yet."}</p>
                                        )}
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Times in {d.timezone}{d.day_close ? ` · trading day closing ${d.day_close}` : ""}{d.outlet_scope === "all" ? " · all outlets" : ""}
                                        {timezone !== d.timezone ? ` (this page shows ${timezone})` : ""}
                                    </p>
                                </div>
                            )}
                        </div>
                    )
                })}
            </CardContent>
        </Card>
    )
}
