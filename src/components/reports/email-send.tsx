"use client"

// SEND NOW — the app's `_EmailSendSheet` (screens/report_email.dart): pick any of
// the emailable reports (the one on screen pre-ticked), the days on screen
// (read-only), an optional trading-day close, formats, and addresses from the
// address book; POST /reports/email/send with an idempotent request id; then
// watch the delivery and show one outcome per address.

import * as React from "react"
import { AlertTriangle, CheckCircle2, Clock, Loader2, Mail, XCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { DrillSheet } from "@/components/ui/drill-sheet"
import { useToast } from "@/hooks/use-toast"
import { isUnreachableError } from "@/hooks/use-cached-fetch"
import { fetchDelivery, fetchSendSetup, sendReportEmail, type ApiError } from "@/lib/api/reports"
import { reportMailStatus, sendReportsFromWebApp } from "@/lib/api/report-mail"
import { WEB_MAIL_HINT, WEB_MAIL_TITLE, webMailUnknown, type WebMailStatus } from "@/lib/report-mail"
import { cn } from "@/lib/utils"

import {
    ADDRESS_BOOK_EMPTY,
    ALL_MIS_REPORTS,
    FORMAT_LABELS,
    MIS_EMAIL_KEYS,
    POLL_INTERVAL_MS,
    POLL_MAX_TRIES,
    RECIPIENT_OUTCOME_LABELS,
    WHOLE_DAYS_NOTE,
    bookDisplay,
    bookFromJson,
    buildSendBody,
    configFromJson,
    isFinalDelivery,
    isResting,
    newClientRequestId,
    periodPhrase,
    recipientOutcomes,
    refusalTitle,
    reportDisabledReason,
    sendBodyKey,
    sendNowBlocked,
    sendOutcome,
    requestIdFor,
    type BookEntry,
    type LastSend,
    type RecipientOutcome,
    type ReportEmailConfig,
} from "./report-email"

export const emailErrorSentence = (e: unknown): string =>
    isUnreachableError(e)
        ? "This device can't reach the restaurant server. Reconnect to the Wi-Fi the restaurant uses and try again."
        : (e instanceof Error && e.message ? e.message : "Something went wrong.")

export function OutcomeList({ rows }: { rows: RecipientOutcome[] }): React.JSX.Element {
    return (
        <ul className="space-y-1">
            {rows.map((r) => (
                <li key={r.email} className="flex items-center gap-2 text-sm">
                    {r.outcome === "sent" ? <CheckCircle2 className="h-4 w-4 text-success" />
                        : r.outcome === "waiting" ? <Clock className="h-4 w-4 text-muted-foreground" />
                            : <XCircle className="h-4 w-4 text-destructive" />}
                    <span className="min-w-0 flex-1 truncate">{r.email}</span>
                    <span className="text-xs text-muted-foreground">{RECIPIENT_OUTCOME_LABELS[r.outcome]}</span>
                </li>
            ))}
        </ul>
    )
}

interface Props {
    open: boolean
    onClose: () => void
    reportKey: string
    from: string
    to: string
    /** The applied session phrase, when the screen is cut to one. */
    slotPhrase: string | null
    timezone: string
    /** The screen is on "All outlets (combined)". */
    combined: boolean
    /** The session's own outlet, for a combined send. */
    homeOutletId?: string
}

export function EmailSendSheet({ open, onClose, reportKey, from, to, slotPhrase, timezone, combined, homeOutletId }: Props): React.JSX.Element {
    const { toast } = useToast()
    const [config, setConfig] = React.useState<ReportEmailConfig | null>(null)
    const [configMissing, setConfigMissing] = React.useState(false)
    const [book, setBook] = React.useState<BookEntry[]>([])
    const [asked, setAsked] = React.useState(false)
    const [keys, setKeys] = React.useState<string[]>([reportKey])
    const [formats, setFormats] = React.useState<string[]>(["xlsx"])
    const [closeOn, setCloseOn] = React.useState(false)
    const [closeAt, setCloseAt] = React.useState("02:00")
    const [chosen, setChosen] = React.useState<string[]>([])
    const [error, setError] = React.useState<string | null>(null)
    const [sending, setSending] = React.useState(false)
    const [delivery, setDelivery] = React.useState<Record<string, unknown> | null>(null)
    // This app's own transport, for when the restaurant server has none.
    const [webMail, setWebMail] = React.useState<WebMailStatus>(webMailUnknown())
    const [webRows, setWebRows] = React.useState<RecipientOutcome[]>([])
    const last = React.useRef<LastSend | null>(null)
    const alive = React.useRef(true)
    const isAlive = (): boolean => alive.current

    React.useEffect(() => {
        alive.current = true
        return () => { alive.current = false }
    }, [])

    React.useEffect(() => {
        if (!open) { return }
        setKeys([reportKey])
        setError(null)
        setDelivery(null)
        setWebRows([])
        setAsked(false)
        void reportMailStatus().then((st) => { if (alive.current) { setWebMail(st) } }).catch(() => { /* treated as not ready */ })
        void fetchSendSetup().then((r) => {
            if (!alive.current) { return }
            setConfig(configFromJson(r.config))
            setConfigMissing(r.configMissing)
            setBook((bookFromJson(r.recipients) ?? []).filter((b) => b.active))
            setAsked(true)
        }).catch(() => { if (alive.current) { setAsked(true) } })
    }, [open, reportKey])

    const catalogue = config?.reports ?? []
    const mode = closeOn ? "trading_day" : "calendar"
    // When the restaurant server cannot send, this app does — same reports,
    // same address book, this app's transport.
    const viaWebApp = config !== null && !config.emailAvailable && webMail.ready
    const blocked = asked ? sendNowBlocked(config, configMissing, webMail.ready) : null
    const allOutletsRefused = combined && config !== null && !config.canUseAllOutlets
    const maxRecipients = config?.recipientsPerSend ?? 10
    const misAll = MIS_EMAIL_KEYS.every((k) => keys.includes(k))

    const toggle = (list: string[], v: string, on: boolean): string[] => (on ? [...list.filter((x) => x !== v), v] : list.filter((x) => x !== v))

    /** The fallback send: this app builds the files and mails them itself. */
    const sendHere = async (): Promise<void> => {
        setError(null)
        setSending(true)
        setWebRows([])
        setDelivery(null)
        try {
            const res = await sendReportsFromWebApp({
                reportKeys: keys, formats, from, to,
                dayClose: closeOn ? closeAt : "", allOutlets: combined, recipientIds: chosen,
            }, timezone)
            if (!alive.current) { return }
            setWebRows([
                ...res.sent.map((email): RecipientOutcome => ({ email, outcome: "sent" })),
                ...res.failed.map((f): RecipientOutcome => ({ email: f.email, outcome: "refused" })),
            ])
            if (!res.ok) { setError(res.description || res.refusal) }
            toast({ title: res.title, description: res.description, variant: res.ok ? undefined : "destructive" })
            if (res.ok && res.failed.length === 0) { onClose() }
        } catch (e) {
            const message = emailErrorSentence(e)
            setError(message)
            toast({ title: "Couldn't send", description: message, variant: "destructive" })
        } finally {
            if (alive.current) { setSending(false) }
        }
    }

    const send = async (): Promise<void> => {
        const fresh = newClientRequestId()
        const built = buildSendBody({
            clientRequestId: fresh, reportKeys: keys, formats, from, to,
            dayClose: closeOn ? closeAt : "", allOutlets: combined, recipientIds: chosen, maxRecipients,
        })
        if (!built.body) { setError(built.error); return }
        if (viaWebApp) { await sendHere(); return }
        const key = sendBodyKey(built.body)
        const current: LastSend = { id: requestIdFor(last.current, key, fresh), bodyKey: key, settled: false }
        last.current = current
        setError(null)
        setSending(true)
        setDelivery(null)
        try {
            const id = await sendReportEmail({ ...built.body, client_request_id: current.id }, combined ? homeOutletId : undefined)
            let d: Record<string, unknown> | null = null
            let timedOut = true
            for (let i = 0; i < POLL_MAX_TRIES && alive.current && id; i++) {
                await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
                if (!isAlive()) { return }
                try {
                    const got = await fetchDelivery(id)
                    if (got) {
                        d = got
                        setDelivery(got)
                        if (isResting(got)) { timedOut = false; break }
                    }
                } catch { /* a failed poll is not a failed send */ }
            }
            if (d && isFinalDelivery(d)) { current.settled = true }
            const outcome = sendOutcome(d, timedOut, timezone)
            toast({ title: outcome.title, description: outcome.description, variant: outcome.bad ? "destructive" : undefined })
            if (d?.status === "delivered") { onClose() }
        } catch (e) {
            const message = emailErrorSentence(e)
            setError(message)
            toast({ title: refusalTitle((e as ApiError).code), description: message, variant: "destructive" })
        } finally {
            if (alive.current) { setSending(false) }
        }
    }

    const outcomes = delivery ? recipientOutcomes(delivery) : webRows

    return (
        <DrillSheet
            open={open}
            onOpenChange={(o) => { if (!o) { onClose() } }}
            eyebrow="Email reports"
            title="Send now"
            action={
                <Button onClick={() => { void send() }} disabled={sending || !asked || Boolean(blocked) || allOutletsRefused}>
                    {sending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Mail className="mr-1.5 h-4 w-4" />}
                    {sending ? "Sending…" : "Send"}
                </Button>
            }
        >
            {!asked ? (
                <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : (
                <div className="space-y-5">
                    {(blocked || allOutletsRefused) && (
                        <Banner tone="error" text={blocked ?? "All outlets needs an admin or a manager"} />
                    )}
                    {viaWebApp && !blocked && (
                        <Banner
                            tone="info"
                            text={WEB_MAIL_TITLE}
                            detail={webMail.from ? `${WEB_MAIL_HINT} Sent as ${webMail.from}.` : WEB_MAIL_HINT}
                        />
                    )}
                    {slotPhrase && <Banner tone="info" text={WHOLE_DAYS_NOTE} />}

                    <section>
                        <div className="mb-1.5 flex items-center justify-between">
                            <span className="micro-label">Reports</span>
                            <button
                                type="button"
                                className="text-xs text-accent-foreground hover:underline"
                                onClick={() => { setKeys(misAll ? keys.filter((k) => !MIS_EMAIL_KEYS.includes(k)) : [...new Set([...keys, ...MIS_EMAIL_KEYS])]) }}
                            >
                                {ALL_MIS_REPORTS}
                            </button>
                        </div>
                        <div className="grid grid-cols-1 gap-1 min-[520px]:grid-cols-2">
                            {catalogue.map((r) => {
                                const why = reportDisabledReason(r.key, mode, catalogue)
                                return (
                                    <label key={r.key} className={cn("flex items-center gap-2 rounded-md px-1.5 py-1 text-sm", why && "opacity-50")}>
                                        <Checkbox disabled={Boolean(why)} checked={keys.includes(r.key)} onCheckedChange={(c) => { setKeys(toggle(keys, r.key, c === true)) }} />
                                        <span className="min-w-0 flex-1 truncate">{r.title}</span>
                                        {why && <span className="text-[11px] text-muted-foreground">{why}</span>}
                                    </label>
                                )
                            })}
                        </div>
                    </section>

                    <section>
                        <div className="micro-label mb-1">Days</div>
                        <div className="text-sm font-medium">{periodPhrase(from, to)}</div>
                        <p className="text-xs text-muted-foreground">Change the dates on the Reports screen before opening this.</p>
                        <label className="mt-2 flex items-center gap-2 text-sm">
                            <Switch checked={closeOn} onCheckedChange={setCloseOn} />
                            Close each day at a set time
                        </label>
                        {closeOn && (
                            <div className="mt-2 flex items-center gap-2">
                                <Input type="time" value={closeAt} onChange={(e) => { setCloseAt(e.target.value) }} className="h-9 w-32" />
                                <span className="text-xs text-muted-foreground">Each day runs to this time; GST and P&amp;L are calendar days only.</span>
                            </div>
                        )}
                    </section>

                    <section>
                        <div className="micro-label mb-1">Formats</div>
                        {(config?.formats ?? ["xlsx", "csv"]).map((f) => (
                            <label key={f} className="flex items-center gap-2 py-0.5 text-sm">
                                <Checkbox checked={formats.includes(f)} onCheckedChange={(c) => { setFormats(toggle(formats, f, c === true)) }} />
                                {FORMAT_LABELS[f] ?? f}
                            </label>
                        ))}
                    </section>

                    <section>
                        <div className="micro-label mb-1">Send to (up to {maxRecipients})</div>
                        {book.length === 0 ? (
                            <p className="text-sm text-muted-foreground">{ADDRESS_BOOK_EMPTY} Add them under Email reports → Address book.</p>
                        ) : book.map((b) => (
                            <label key={b.id} className="flex items-center gap-2 py-0.5 text-sm">
                                <Checkbox
                                    checked={chosen.includes(b.id)}
                                    disabled={!chosen.includes(b.id) && chosen.length >= maxRecipients}
                                    onCheckedChange={(c) => { setChosen(toggle(chosen, b.id, c === true)) }}
                                />
                                <span className="truncate">{bookDisplay(b)}</span>
                            </label>
                        ))}
                    </section>

                    {error && <p className="text-sm text-destructive">{error}</p>}
                    {outcomes.length > 0 && <OutcomeList rows={outcomes} />}
                </div>
            )}
        </DrillSheet>
    )
}

export function Banner({ tone, text, detail, action }: {
    tone: "error" | "warning" | "info"
    text: string
    detail?: string | null
    /** The way out of what the banner reports, for whoever may take it. */
    action?: React.ReactNode
}): React.JSX.Element {
    return (
        <div className={cn(
            "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
            tone === "error" ? "border-destructive/30 bg-destructive/10" : tone === "warning" ? "border-warning/30 bg-warning/10" : "border-info/30 bg-info/10",
        )}>
            <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", tone === "error" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-info")} />
            <div className="min-w-0 flex-1">
                <div className="font-medium">{text}</div>
                {detail ? <div className="text-xs text-muted-foreground">{detail}</div> : null}
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
        </div>
    )
}
