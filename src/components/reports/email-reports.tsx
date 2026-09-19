"use client"

// EMAIL REPORTS — the second view of the Reports module (the app's
// `_EmailReportsPanel`): config banners, the address book, the schedules with
// their editor, and the delivery history with per-address outcomes and files.

import * as React from "react"
import {
    ChevronDown, ChevronRight, Download, Lock, Mail, MoreHorizontal, Pencil, Play, Plus, Repeat, Send, Trash2,
} from "lucide-react"

import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DrillSheet } from "@/components/ui/drill-sheet"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ForkCard } from "@/components/ui/fork-card"
import { Input } from "@/components/ui/input"
import { LoadErrorState } from "@/components/ui/load-error-state"
import { SectionHeader } from "@/components/ui/section-header"
import { SkeletonRows } from "@/components/ui/fork-skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StatusChip } from "@/components/ui/status-chip"
import { Switch } from "@/components/ui/switch"
import { useCachedFetch } from "@/hooks/use-cached-fetch"
import { useToast } from "@/hooks/use-toast"
import {
    addRecipient, createEmailSchedule, deleteEmailSchedule, fetchDeliveries, fetchEmailPanel,
    fetchLegacyDeliveryCsv, patchEmailSchedule, removeRecipient, runEmailScheduleNow, sendTestEmail,
    type ApiError, type EmailPanelData,
} from "@/lib/api/reports"
import { formatFullDateTime } from "@/lib/tz"
import { cn } from "@/lib/utils"

import { downloadDeliveryFile } from "./download-action"
import { Banner, OutcomeList, emailErrorSentence } from "./email-send"
import {
    ADDRESS_BOOK_EMPTY, ADDRESS_BOOK_READ_ONLY, ADDRESS_BOOK_TITLE, ALL_MIS_REPORTS, FORMAT_LABELS, MAX_ADDRESS_BOOK,
    MIS_EMAIL_KEYS, POLL_INTERVAL_MS, SERVER_PREDATES_EMAIL_SENTENCE, TEST_EMAIL_LABEL, WEEKDAY_NAMES, WINDOW_MODE_LABELS,
    addressProblem, bookFromJson, buildSchedulePatch, cadenceCaption, configBanners, configFromJson, coverageCaption,
    deliveryKind, deliveryStatus, fileLabel, formFromSchedule, hhmm, isFinalDelivery, isWatched, newClientRequestId,
    newScheduleForm, nextRunCaption, orderedFormats, periodPhrase, recipientOutcomes, refusalTitle, reportDisabledReason,
    reportListPhrase, retryCaption, strings, toInt, wallClock,
    type BookEntry, type EmailScheduleForm, type ReportEmailConfig,
} from "./report-email"

type Json = Record<string, unknown>
const s = (v: unknown, fb = ""): string => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : fb)
const capped = (t: string, n: number): string => (t.length > n ? `${t.slice(0, n - 1)}…` : t)
const TONE: Record<string, "success" | "danger" | "info"> = { ok: "success", bad: "danger", pending: "info" }

function saveBlob(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => { URL.revokeObjectURL(url) }, 2000)
}

interface Props {
    restaurantId: string
    timezone: string
    /** The dashboard is on "All outlets (combined)" — schedules are read-only. */
    combined: boolean
}

export function EmailReportsPanel({ restaurantId, timezone, combined }: Props): React.JSX.Element {
    const { toast } = useToast()
    const panel = useCachedFetch<EmailPanelData>(`reports:email:${restaurantId}:${combined ? "all" : "one"}`, fetchEmailPanel, { enabled: Boolean(restaurantId) })
    const [deliveries, setDeliveries] = React.useState<Json[] | null>(null)
    const [busy, setBusy] = React.useState(false)
    const [email, setEmail] = React.useState("")
    const [label, setLabel] = React.useState("")
    const [addProblem, setAddProblem] = React.useState<string | null>(null)
    const [removing, setRemoving] = React.useState<BookEntry | null>(null)
    const [deleting, setDeleting] = React.useState<Json | null>(null)
    const [editing, setEditing] = React.useState<{ existing: Json | null } | null>(null)
    const [openRow, setOpenRow] = React.useState<string | null>(null)

    const data = panel.data
    const config: ReportEmailConfig | null = data ? configFromJson(data.config) : null
    const book: BookEntry[] = data ? bookFromJson(data.recipients) ?? [] : []
    const bookFailed = data ? bookFromJson(data.recipients) === null : false
    const schedules = (data?.schedules ?? []).filter((x): x is Json => Boolean(x) && typeof x === "object")
    const history = deliveries ?? (data?.deliveries ?? []).filter((x): x is Json => Boolean(x) && typeof x === "object")
    const byId = new Map(schedules.map((x) => [s(x.id), x]))
    const banners = data ? configBanners(config, data.configMissing) : []
    const max = config?.addressBookMax ?? MAX_ADDRESS_BOOK
    const canEdit = config?.canEditRecipients === true
    const serverOutdated = data?.configMissing === true && !config

    React.useEffect(() => { setDeliveries(null) }, [data])

    // In-flight deliveries refresh the history by themselves, for WATCH_MAX_MS.
    React.useEffect(() => {
        const now = Date.now()
        if (!history.some((d) => isWatched(d, now))) { return }
        const t = setTimeout(() => {
            void fetchDeliveries(30).then((rows) => { setDeliveries(rows.filter((x): x is Json => Boolean(x) && typeof x === "object")) }).catch(() => { /* next load */ })
        }, POLL_INTERVAL_MS * 3)
        return () => { clearTimeout(t) }
    }, [history])

    const write = async (work: () => Promise<unknown>, done?: string): Promise<void> => {
        setBusy(true)
        try {
            await work()
            if (done) { toast({ title: done }) }
            panel.refresh()
        } catch (e) {
            const code = (e as ApiError).code
            toast({ title: code ? refusalTitle(code) : "Couldn't save", description: emailErrorSentence(e), variant: "destructive" })
        } finally {
            setBusy(false)
        }
    }

    const add = (): void => {
        const why = addressProblem(email, book, max)
        if (why) { setAddProblem(why); return }
        const e = email.trim()
        const l = label.trim()
        setAddProblem(null)
        void write(async () => { await addRecipient(e, l || null); setEmail(""); setLabel("") }, `${e} can now be chosen for reports.`)
    }

    const runNow = async (sch: Json): Promise<void> => {
        setBusy(true)
        try {
            const r = await runEmailScheduleNow(s(sch.id))
            toast({
                title: r === "already"
                    ? "Already queued a moment ago — that run is still on its way, so nothing extra was queued. Watch the history."
                    : "Queued — its result appears in the history below.",
            })
        } catch (e) {
            toast({ title: emailErrorSentence(e), variant: "destructive" })
        } finally {
            setBusy(false)
            panel.refresh()
        }
    }

    const download = async (d: Json, f: Json): Promise<void> => {
        const res = await downloadDeliveryFile(s(d.id), s(f.id))
        if (!res.ok) { toast({ title: res.message, variant: "destructive" }); return }
        const bytes = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0))
        saveBlob(new Blob([bytes], { type: res.contentType }), s(f.filename, "report"))
    }

    const downloadLegacy = async (d: Json): Promise<void> => {
        try {
            const csv = await fetchLegacyDeliveryCsv(s(d.id))
            saveBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), s(d.artifact_name, "report.csv"))
        } catch (e) {
            toast({ title: emailErrorSentence(e), variant: "destructive" })
        }
    }

    if (panel.loading) { return <SkeletonRows rows={6} title /> }
    if (panel.error || !data) {
        return <LoadErrorState whatFailed="Couldn't load Email reports." error={panel.error} onRetry={panel.retry} />
    }

    return (
        <div className="flex flex-col gap-6">
            {banners.map((b) => <Banner key={b.title} tone={b.tone} text={b.title} detail={b.detail} />)}

            {/* ---- Address book ---- */}
            <ForkCard>
                <SectionHeader title={ADDRESS_BOOK_TITLE} count={book.length} trailing={<span className="text-xs text-muted-foreground">up to {max}</span>} />
                {bookFailed ? (
                    <p className="text-sm text-muted-foreground">Couldn&apos;t load the address book. Pull to refresh or try again.</p>
                ) : book.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{ADDRESS_BOOK_EMPTY}</p>
                ) : (
                    <ul className="divide-y divide-divider">
                        {book.map((b) => (
                            <li key={b.id} className="flex flex-wrap items-center gap-2 py-2">
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm">{b.label ?? b.email}</div>
                                    {b.label && <div className="truncate text-xs text-muted-foreground">{b.email}</div>}
                                </div>
                                {!b.active && <StatusChip status="warning" dense label="Paused" title={b.suppressedReason ?? undefined} />}
                                <Button variant="outline" size="sm" disabled={busy || !b.active} onClick={() => {
                                    void write(() => sendTestEmail(b.id, newClientRequestId()), `Test email queued — check ${b.email} in a minute, and its spam folder.`)
                                }}>
                                    <Send className="mr-1.5 h-3.5 w-3.5" /> {TEST_EMAIL_LABEL}
                                </Button>
                                {canEdit && (
                                    <Button variant="ghost" size="icon" aria-label={`Remove ${b.email}`} disabled={busy} onClick={() => { setRemoving(b) }}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
                {canEdit ? (
                    <div className="mt-3 flex flex-col gap-2 min-[760px]:flex-row">
                        <Input placeholder="name@example.com" value={email} onChange={(e) => { setEmail(e.target.value) }} className="min-[760px]:flex-1" disabled={book.length >= max} />
                        <Input placeholder="Label (optional)" maxLength={80} value={label} onChange={(e) => { setLabel(e.target.value) }} className="min-[760px]:w-48" disabled={book.length >= max} />
                        <Button onClick={add} disabled={busy || book.length >= max}><Plus className="mr-1.5 h-4 w-4" /> Add</Button>
                    </div>
                ) : (
                    <p className="mt-3 text-xs text-muted-foreground">{ADDRESS_BOOK_READ_ONLY}</p>
                )}
                {addProblem && <p className="mt-1.5 text-sm text-destructive">{addProblem}</p>}
            </ForkCard>

            {/* ---- Schedules ---- */}
            <ForkCard>
                <SectionHeader
                    title="Schedules"
                    count={schedules.length}
                    trailing={!combined && !serverOutdated && (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => { setEditing({ existing: null }) }}>
                            <Plus className="mr-1.5 h-4 w-4" /> New schedule
                        </Button>
                    )}
                />
                {combined && (
                    <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Lock className="h-3.5 w-3.5" /> Switch to a single outlet to create, edit, pause, delete or run one.
                    </p>
                )}
                {serverOutdated && <p className="mb-2 text-xs text-muted-foreground">{SERVER_PREDATES_EMAIL_SENTENCE} — new and edited schedules are withheld.</p>}
                {data.schedules === null ? (
                    <p className="text-sm text-muted-foreground">Couldn&apos;t load the schedules.</p>
                ) : schedules.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No schedules yet. A schedule emails the reports you pick at a set time.</p>
                ) : (
                    <ul className="divide-y divide-divider">
                        {schedules.map((sch) => {
                            const enabled = sch.enabled !== false
                            const keys = strings(sch.report_keys).length > 0 ? strings(sch.report_keys) : [s(sch.report_key, "sales")]
                            const fmts = orderedFormats(strings(sch.formats).length > 0 ? strings(sch.formats) : [s(sch.format, "csv")])
                            const isEmail = sch.channel === "email"
                            const next = nextRunCaption(sch, timezone)
                            const failures = toInt(sch.consecutive_failures) ?? 0
                            const err = s(sch.last_error)
                            return (
                                <li key={s(sch.id)} className="flex gap-3 py-3">
                                    <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-input bg-inset text-accent-foreground", !enabled && "opacity-50")}>
                                        {isEmail ? <Mail className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="truncate text-sm font-medium">{s(sch.name, "Schedule")}</span>
                                            <StatusChip dense status={enabled ? "success" : "neutral"} label={enabled ? "On" : "Paused"} />
                                            {sch.last_status === "delivered" && <StatusChip dense status="success" label="Last run OK" />}
                                            {sch.last_status === "failed" && <StatusChip dense status="danger" label="Last run failed" />}
                                        </div>
                                        <div className="truncate text-xs text-muted-foreground">
                                            {[reportListPhrase(keys), fmts.map((f) => f.toUpperCase()).join(" + "), sch.outlet_scope === "all" ? "all outlets" : ""].filter(Boolean).join(" · ")}
                                        </div>
                                        <div className="truncate text-xs text-muted-foreground">
                                            {cadenceCaption(sch)} · {isEmail ? `Email to ${strings(sch.recipients).join(", ") || "—"}` : "In-app inbox"}
                                        </div>
                                        {next && <div className="text-xs text-muted-foreground">{next}</div>}
                                        {err && (
                                            <div className="mt-1 text-xs text-destructive">
                                                {capped(err, 200)}{failures > 1 ? ` · ${failures} failures in a row` : ""}
                                            </div>
                                        )}
                                        {!enabled && failures > 0 && (
                                            <div className="text-xs text-muted-foreground">Paused automatically after repeated failures — fix the cause, then resume it.</div>
                                        )}
                                    </div>
                                    {!combined && (
                                        <div className="flex shrink-0 items-start gap-1">
                                            <Button size="sm" variant="outline" disabled={busy} onClick={() => { void runNow(sch) }}>
                                                <Play className="mr-1 h-3.5 w-3.5" /> Run now
                                            </Button>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button size="icon" variant="ghost" aria-label="More"><MoreHorizontal className="h-4 w-4" /></Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    {!serverOutdated && (
                                                        <DropdownMenuItem onSelect={() => { setEditing({ existing: sch }) }}><Pencil className="mr-2 h-4 w-4" /> Edit</DropdownMenuItem>
                                                    )}
                                                    <DropdownMenuItem onSelect={() => {
                                                        void write(() => patchEmailSchedule(s(sch.id), { enabled: !enabled }), enabled ? "Schedule paused" : "Schedule resumed")
                                                    }}>
                                                        <Repeat className="mr-2 h-4 w-4" /> {enabled ? "Pause" : "Resume"}
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem className="text-destructive" onSelect={() => { setDeleting(sch) }}>
                                                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    )}
                                </li>
                            )
                        })}
                    </ul>
                )}
            </ForkCard>

            {/* ---- History ---- */}
            <ForkCard>
                <SectionHeader title="History" count={history.length} />
                <p className="mb-2 text-xs text-muted-foreground">Every run and every send, with what happened to each address. Files are kept for 90 days.</p>
                {data.deliveries === null ? (
                    <p className="text-sm text-muted-foreground">Couldn&apos;t load the history.</p>
                ) : history.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing has been sent yet.</p>
                ) : (
                    <ul className="divide-y divide-divider">
                        {history.map((d) => {
                            const id = s(d.id)
                            const status = deliveryStatus(d)
                            const kind = deliveryKind(d)
                            const sch = byId.get(s(d.schedule_id))
                            const title = d.kind === "adhoc" ? kind : sch ? s(sch.name, "Scheduled report") : "Removed schedule"
                            const keys = strings(d.report_keys)
                            const rows = recipientOutcomes(d, sch ? strings(sch.recipients) : [])
                            const files = Array.isArray(d.files) ? (d.files as unknown[]).filter((x): x is Json => Boolean(x) && typeof x === "object") : []
                            const window = d.day_close != null && s(d.window_start_at)
                                ? `${wallClock(s(d.window_start_at), timezone)} → ${wallClock(s(d.window_end_at), timezone)}`
                                : periodPhrase(s(d.period_from), s(d.period_to))
                            const attempts = toInt(d.attempts) ?? 0
                            const sent = rows.filter((r) => r.outcome === "sent").length
                            const err = s(d.error)
                            const retry = retryCaption(d, timezone)
                            const open = openRow === id
                            return (
                                <li key={id} className="py-2.5">
                                    <button type="button" onClick={() => { setOpenRow(open ? null : id) }} className="flex w-full items-start gap-2 text-left">
                                        {open ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-tertiary" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-tertiary" />}
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-sm">{title}</div>
                                            <div className="line-clamp-2 text-xs text-muted-foreground">{[keys.length > 0 ? reportListPhrase(keys) : "", window].filter(Boolean).join(" · ")}</div>
                                            <div className="line-clamp-2 text-xs text-muted-foreground">
                                                {[
                                                    d.kind !== "adhoc" ? kind : "",
                                                    s(d.fire_at) ? formatFullDateTime(s(d.fire_at), timezone) : "",
                                                    d.channel === "email" && rows.length > 0 ? `${sent}/${rows.length} sent` : "",
                                                    attempts > 1 ? `${attempts} attempts` : "",
                                                    d.maybe_duplicate === true ? "may have been sent twice" : "",
                                                ].filter(Boolean).join(" · ")}
                                            </div>
                                        </div>
                                        <StatusChip dense status={TONE[status.tone]} label={status.label} />
                                    </button>
                                    {err && <div className={cn("ml-6 mt-0.5 text-xs", isFinalDelivery(d) ? "text-destructive" : "text-tertiary")}>{capped(err, 160)}</div>}
                                    {retry && <div className="ml-6 text-xs text-muted-foreground">{retry}</div>}
                                    {open && (
                                        <div className="ml-6 mt-2 space-y-2">
                                            {rows.length > 0 && <OutcomeList rows={rows} />}
                                            <div className="flex flex-wrap gap-2">
                                                {files.map((f) => (
                                                    <Button key={s(f.id)} size="sm" variant="outline" disabled={f.purged === true} onClick={() => { void download(d, f) }}>
                                                        <Download className="mr-1.5 h-3.5 w-3.5" /> {fileLabel(f)}
                                                    </Button>
                                                ))}
                                                {files.length === 0 && s(d.artifact_name) && (
                                                    <Button size="sm" variant="outline" onClick={() => { void downloadLegacy(d) }}>
                                                        <Download className="mr-1.5 h-3.5 w-3.5" /> CSV
                                                    </Button>
                                                )}
                                                {files.length === 0 && !s(d.artifact_name) && (
                                                    <span className="text-xs text-muted-foreground">{d.kind === "adhoc" && keys.length === 0 ? "A test email carries no files." : "No files yet."}</span>
                                                )}
                                            </div>
                                            {d.day_close != null && (
                                                <div className="text-xs text-muted-foreground">Trading day closing {s(d.day_close)} · times in {s(d.timezone, timezone)}</div>
                                            )}
                                        </div>
                                    )}
                                </li>
                            )
                        })}
                    </ul>
                )}
            </ForkCard>

            <AlertDialog open={removing !== null} onOpenChange={(o) => { if (!o) { setRemoving(null) } }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove this address?</AlertDialogTitle>
                        <AlertDialogDescription>{removing?.email} stops receiving reports — every schedule skips it from the next run.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => {
                            const b = removing
                            setRemoving(null)
                            if (b) { void write(() => removeRecipient(b.id), `${b.email} will not receive any more reports.`) }
                        }}>Remove</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={deleting !== null} onOpenChange={(o) => { if (!o) { setDeleting(null) } }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete this schedule?</AlertDialogTitle>
                        <AlertDialogDescription>
                            &ldquo;{s(deleting?.name)}&rdquo; stops running. Reports it already produced stay in the history and can still be downloaded.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => {
                            const sch = deleting
                            setDeleting(null)
                            if (sch) { void write(() => deleteEmailSchedule(s(sch.id)), "Schedule removed") }
                        }}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {editing && (
                <ScheduleEditor
                    existing={editing.existing}
                    config={config}
                    book={book.filter((b) => b.active)}
                    timezone={timezone}
                    onClose={() => { setEditing(null) }}
                    onSave={(patch) => {
                        const ex = editing.existing
                        setEditing(null)
                        void write(() => (ex ? patchEmailSchedule(s(ex.id), patch) : createEmailSchedule(patch)), ex ? "Schedule updated" : "Schedule created")
                    }}
                />
            )}
        </div>
    )
}

function ScheduleEditor({ existing, config, book, timezone, onClose, onSave }: {
    existing: Json | null
    config: ReportEmailConfig | null
    book: BookEntry[]
    timezone: string
    onClose: () => void
    onSave: (patch: Json) => void
}): React.JSX.Element {
    const seed = React.useMemo(() => (existing
        ? formFromSchedule(existing, book)
        : { form: newScheduleForm(config?.emailAvailable ? "email" : "inbox"), missing: [] as string[] }), [existing, book, config])
    const [f, setF] = React.useState<EmailScheduleForm>(seed.form)
    const [touched, setTouched] = React.useState(existing === null)
    const [error, setError] = React.useState<string | null>(null)
    const set = (patch: Partial<EmailScheduleForm>): void => { setF((x) => ({ ...x, ...patch })) }
    const catalogue = config?.reports ?? []
    const mode = f.frequency === "daily" ? f.windowMode : "calendar"
    const max = config?.recipientsPerSend ?? 10
    const toggle = (list: string[], v: string, on: boolean): string[] => (on ? [...list.filter((x) => x !== v), v] : list.filter((x) => x !== v))
    const misAll = MIS_EMAIL_KEYS.every((k) => f.reportKeys.includes(k))
    const time = hhmm(f.hour, f.minute)

    const save = (): void => {
        const built = buildSchedulePatch(f, max, touched)
        if (!built.patch) { setError(built.error); return }
        onSave(built.patch)
    }

    return (
        <DrillSheet
            open
            onOpenChange={(o) => { if (!o) { onClose() } }}
            eyebrow="Email reports"
            title={existing ? "Edit schedule" : "New schedule"}
            action={<Button onClick={save}>{existing ? "Save" : "Create"}</Button>}
        >
            <div className="space-y-5">
                <section>
                    <div className="micro-label mb-1">Name</div>
                    <Input value={f.name} maxLength={120} placeholder="Daily close" onChange={(e) => { set({ name: e.target.value }) }} />
                </section>

                <section className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-3">
                    <div>
                        <div className="micro-label mb-1">Frequency</div>
                        <Select value={f.frequency} onValueChange={(v) => { set({ frequency: v }) }}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="daily">Daily</SelectItem>
                                <SelectItem value="weekly">Weekly</SelectItem>
                                <SelectItem value="monthly">Monthly</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {f.frequency === "weekly" && (
                        <div>
                            <div className="micro-label mb-1">Day</div>
                            <Select value={String(f.weekday)} onValueChange={(v) => { set({ weekday: Number(v) }) }}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>{WEEKDAY_NAMES.map((n, i) => <SelectItem key={n} value={String(i)}>{n}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                    )}
                    {f.frequency === "monthly" && (
                        <div>
                            <div className="micro-label mb-1">Day of month</div>
                            <Select value={String(f.dayOfMonth)} onValueChange={(v) => { set({ dayOfMonth: Number(v) }) }}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>{Array.from({ length: 28 }, (_, i) => <SelectItem key={i} value={String(i + 1)}>{i + 1}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                    )}
                    <div>
                        <div className="micro-label mb-1">Send at</div>
                        <Input type="time" value={time} onChange={(e) => {
                            const [h, m] = e.target.value.split(":").map(Number)
                            if (Number.isFinite(h) && Number.isFinite(m)) { set({ hour: h, minute: m }) }
                        }} />
                    </div>
                </section>

                {f.frequency === "daily" && (
                    <section>
                        <div className="micro-label mb-1">Each email covers</div>
                        <Select value={f.windowMode} onValueChange={(v) => { set({ windowMode: v }) }}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="trading_day">{WINDOW_MODE_LABELS.trading_day}</SelectItem>
                                <SelectItem value="calendar">{WINDOW_MODE_LABELS.calendar}</SelectItem>
                            </SelectContent>
                        </Select>
                    </section>
                )}
                <p className="-mt-3 text-xs text-muted-foreground">{coverageCaption(f.frequency, mode, time)} Times are {timezone}.</p>

                <section>
                    <div className="mb-1.5 flex items-center justify-between">
                        <span className="micro-label">Reports</span>
                        <button type="button" className="text-xs text-accent-foreground hover:underline" onClick={() => {
                            set({ reportKeys: misAll ? f.reportKeys.filter((k) => !MIS_EMAIL_KEYS.includes(k)) : [...new Set([...f.reportKeys, ...MIS_EMAIL_KEYS])] })
                        }}>{ALL_MIS_REPORTS}</button>
                    </div>
                    <div className="grid grid-cols-1 gap-1 min-[520px]:grid-cols-2">
                        {catalogue.map((r) => {
                            const why = reportDisabledReason(r.key, mode, catalogue)
                            return (
                                <label key={r.key} className={cn("flex items-center gap-2 rounded-md px-1.5 py-1 text-sm", why && "opacity-50")}>
                                    <Checkbox disabled={Boolean(why)} checked={f.reportKeys.includes(r.key)} onCheckedChange={(c) => { set({ reportKeys: toggle(f.reportKeys, r.key, c === true) }) }} />
                                    <span className="min-w-0 flex-1 truncate">{r.title}</span>
                                    {why && <span className="text-[11px] text-muted-foreground">{why}</span>}
                                </label>
                            )
                        })}
                    </div>
                </section>

                <section className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2">
                    <div>
                        <div className="micro-label mb-1">Deliver to</div>
                        <Select value={f.channel} onValueChange={(v) => { set({ channel: v }) }}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="email" disabled={!config?.emailAvailable}>Email{config?.emailAvailable ? "" : " (not set up on this server)"}</SelectItem>
                                <SelectItem value="inbox">In-app inbox</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {config?.canUseAllOutlets && (
                        <div>
                            <div className="micro-label mb-1">Outlets</div>
                            <Select value={f.allOutlets ? "all" : "outlet"} onValueChange={(v) => { set({ allOutlets: v === "all" }) }}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="outlet">This outlet</SelectItem>
                                    <SelectItem value="all">All outlets (combined)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                </section>

                <section>
                    <div className="micro-label mb-1">Formats</div>
                    {(config?.formats ?? ["xlsx", "csv"]).map((x) => (
                        <label key={x} className="flex items-center gap-2 py-0.5 text-sm">
                            <Checkbox checked={f.formats.includes(x)} onCheckedChange={(c) => { set({ formats: toggle(f.formats, x, c === true) }) }} />
                            {FORMAT_LABELS[x] ?? x}
                        </label>
                    ))}
                </section>

                {f.channel === "email" && (
                    <section>
                        <div className="micro-label mb-1">Send to (up to {max})</div>
                        {book.length === 0 && <p className="text-sm text-muted-foreground">{ADDRESS_BOOK_EMPTY}</p>}
                        {book.map((b) => (
                            <label key={b.id} className="flex items-center gap-2 py-0.5 text-sm">
                                <Checkbox
                                    checked={f.recipientIds.includes(b.id)}
                                    disabled={!f.recipientIds.includes(b.id) && f.recipientIds.length >= max}
                                    onCheckedChange={(c) => { setTouched(true); set({ recipientIds: toggle(f.recipientIds, b.id, c === true) }) }}
                                />
                                <span className="truncate">{b.label ? `${b.label} — ${b.email}` : b.email}</span>
                            </label>
                        ))}
                        {seed.missing.length > 0 && (
                            <p className="mt-1 text-xs text-warning">Also stored: {seed.missing.join(", ")} — not in the address book, so skipped at send time.</p>
                        )}
                    </section>
                )}

                <label className="flex items-center gap-2 text-sm">
                    <Switch checked={f.enabled} onCheckedChange={(v) => { set({ enabled: v }) }} />
                    {f.enabled ? "On" : "Paused"}
                </label>

                {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
        </DrillSheet>
    )
}
