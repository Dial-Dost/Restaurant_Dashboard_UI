// EMAIL REPORTS — a pure port of the app's lib/models/report_email.dart: the
// emailable catalogue, the words, the config read, the address-book checks, the
// Send-now body and request-id rule, delivery states and per-address outcomes,
// and the schedule form. The screens (email-send.tsx, email-reports.tsx) only
// lay these out. No React, no network.

export interface EmailableReport {
    key: string
    title: string
    family: "mis" | "accounting"
    tradingDay: boolean
}

const r = (key: string, title: string, family: "mis" | "accounting" = "mis", tradingDay = true): EmailableReport =>
    ({ key, title, family, tradingDay })

/** The eighteen, in the backend's order. The config's own list replaces it. */
export const EMAILABLE_REPORTS: EmailableReport[] = [
    r("item_wise", "Item Wise"),
    r("discount", "Discount"),
    r("void_kot", "Void KOT"),
    r("bill_edit", "Bill Edit"),
    r("sales_summary", "Sales Summary"),
    r("order_summary", "Order Summary"),
    r("executive_summary", "Executive Summary"),
    r("cover_size_summary", "Cover Size Summary"),
    r("settlement_summary", "Settlement Summary"),
    r("nc_summary", "NC Summary"),
    r("service_charge_deny", "Service Charge Deny"),
    r("group_summary", "Group Summary"),
    r("variation_summary", "Variation Summary"),
    r("tip_summary", "Tip Summary"),
    r("counter_summary", "Counter Summary"),
    r("sales", "Sales (accounting)", "accounting"),
    r("gst", "GST", "accounting", false),
    r("pnl", "Profit & Loss", "accounting", false),
]

export const MIS_EMAIL_KEYS = EMAILABLE_REPORTS.filter((x) => x.family === "mis").map((x) => x.key)
const CALENDAR_ONLY_KEYS = EMAILABLE_REPORTS.filter((x) => !x.tradingDay).map((x) => x.key)

export const MAX_RECIPIENTS_PER_SEND = 10
export const MAX_ADDRESS_BOOK = 25

export const EMAIL_BUTTON_LABEL = "Email"
export const EMAIL_BUTTON_TOOLTIP = "Email this report"
export const MAIL_OFF_SENTENCE = "Email is not set up on this server"
export const MAIL_OFF_HINT = "Ask your administrator to set up the mail settings. Reports can still be downloaded here."
// The same fact said to the person who can act on it: the owner sets the
// transport up in Settings → Email (components/settings/mail-settings-card).
// Scheduled sends stay the restaurant server's own, which is why they are named.
export const MAIL_OFF_OWNER_HINT =
    "Set it up in Settings → Email. Reports can still be downloaded here. Emails on a schedule are sent by the " +
    "restaurant server itself and need the same settings in its environment."
export const SCHEMA_PENDING_SENTENCE = "Email reports need a database update that has not been applied to this server yet."
export const SCHEDULER_OFF_SENTENCE = "Scheduled emails are switched off on this server. Send now still works."
export const SEND_NOW_OFF_SENTENCE = "Sending reports on demand is switched off on this server."
export const TEST_EMAIL_LABEL = "Send test email"
export const ADDRESS_BOOK_TITLE = "Address book"
export const ADDRESS_BOOK_EMPTY = "No addresses yet. Reports can only be emailed to addresses in this list."
export const ADDRESS_BOOK_READ_ONLY = "Only someone with the Settings permission can add or remove addresses."
export const WHOLE_DAYS_NOTE = "Emailed reports always cover whole days — the session filter on screen is not applied."
export const CALENDAR_DAYS_ONLY = "Calendar days only"
export const ALL_MIS_REPORTS = "All 15 MIS reports"
export const FORMAT_LABELS: Record<string, string> = {
    xlsx: "Excel workbook (.xlsx)",
    csv: "CSV (one file per report)",
}
export const WINDOW_MODE_LABELS: Record<string, string> = {
    trading_day: "The day that just ended",
    calendar: "Previous calendar day",
}
export const RECIPIENT_OUTCOME_LABELS: Record<string, string> = {
    sent: "Sent",
    refused: "Refused",
    skipped: "Skipped",
    waiting: "Waiting",
}
export const SERVER_PREDATES_EMAIL_SENTENCE = "This server has not been updated for email reports yet"
export const SERVER_PREDATES_EMAIL_HINT =
    "Ask your administrator to update the server. Until then nothing can be emailed, and schedules cannot be " +
    "created or edited here. Reports can still be downloaded."

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => Boolean(v) && typeof v === "object" && !Array.isArray(v)
export const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined).map((x) => String(x)) : []
export const toInt = (v: unknown): number | null => {
    const n = Number(v ?? "")
    return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : Math.round(n)
}
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "")

// --- Selection -------------------------------------------------------------------

export function reportTitle(key: string, catalogue: EmailableReport[] = EMAILABLE_REPORTS): string {
    return catalogue.find((x) => x.key === key)?.title ?? EMAILABLE_REPORTS.find((x) => x.key === key)?.title ?? key
}

export function orderedReportKeys(keys: Iterable<string>, catalogue: EmailableReport[] = EMAILABLE_REPORTS): string[] {
    const wanted = new Set(keys)
    return catalogue.filter((x) => wanted.has(x.key)).map((x) => x.key)
}

export function reportListPhrase(keys: string[], max = 2): string {
    const titles = keys.map((k) => reportTitle(k))
    if (titles.length === 0) { return "No reports" }
    if (titles.length === EMAILABLE_REPORTS.length) { return "All reports" }
    if (titles.length === MIS_EMAIL_KEYS.length && keys.every((k) => MIS_EMAIL_KEYS.includes(k))) { return ALL_MIS_REPORTS }
    if (titles.length <= max) {
        return titles.length === 1 ? titles[0] : `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}`
    }
    return `${titles.slice(0, max).join(", ")} and ${titles.length - max} more`
}

export function selectionProblem(keys: string[], mode: string): string | null {
    const ordered = orderedReportKeys(keys)
    if (ordered.length === 0) { return "Pick at least one report to send." }
    if (mode === "trading_day") {
        const blocked = CALENDAR_ONLY_KEYS.filter((k) => ordered.includes(k))
        if (blocked.length > 0) {
            const names = blocked.map((k) => reportTitle(k)).join(" and ")
            return `${names} can only be sent for calendar days. Choose "previous calendar day", or leave ${blocked.length > 1 ? "them" : "it"} out.`
        }
    }
    return null
}

export const reportDisabledReason = (key: string, mode: string, catalogue: EmailableReport[]): string | null => {
    const entry = catalogue.find((x) => x.key === key)
    const calendarOnly = entry ? !entry.tradingDay : CALENDAR_ONLY_KEYS.includes(key)
    return mode === "trading_day" && calendarOnly ? CALENDAR_DAYS_ONLY : null
}

export function orderedFormats(formats: Iterable<string>): string[] {
    const wanted = new Set(formats)
    return ["xlsx", "csv"].filter((f) => wanted.has(f))
}

export const defaultWindowMode = (frequency: string, keys: string[]): string =>
    frequency === "daily" && !keys.some((k) => CALENDAR_ONLY_KEYS.includes(k)) ? "trading_day" : "calendar"

// --- Time --------------------------------------------------------------------------

const two = (n: number): string => String(n).padStart(2, "0")
export const hhmm = (hour: number, minute: number): string => `${two(hour)}:${two(minute)}`

export function parseTime(value: string): number | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
    if (!m) { return null }
    const h = Number(m[1])
    const min = Number(m[2])
    if (h > 23 || min > 59) { return null }
    return h * 60 + min
}

const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

export function shortDay(key: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
    if (!m) { return key }
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
    return `${WEEKDAYS_SHORT[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`
}

export function periodPhrase(from: string, to: string): string {
    if (from === to) { return shortDay(from) }
    const dm = (k: string): string => shortDay(k).split(" ").slice(1).join(" ")
    return `${dm(from)} – ${dm(to)}`
}

/** An instant on the restaurant's wall clock: "18 Sep, 02:00". */
export function wallClock(iso: string | null | undefined, timezone: string): string {
    if (!iso) { return "" }
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) { return iso }
    try {
        const parts = new Intl.DateTimeFormat("en-GB", {
            timeZone: timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
        }).formatToParts(d)
        const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? ""
        return `${get("day")} ${get("month")}, ${get("hour")}:${get("minute")}`
    } catch {
        return iso
    }
}

export function coverageCaption(frequency: string, mode: string, time: string): string {
    if (frequency === "weekly") { return "Covers the seven restaurant days ending the day before it runs." }
    if (frequency === "monthly") { return "Covers the whole previous calendar month." }
    if (mode === "trading_day") {
        const at = parseTime(time) === null ? "the send time" : time
        return `Covers the 24 hours up to ${at} — the trading day that just closed, so bills settled after midnight count on the day they belong to.`
    }
    return "Covers the previous calendar day, midnight to midnight."
}

export function cadenceCaption(s: Json): string {
    const at = hhmm(toInt(s.hour_local) ?? 0, toInt(s.minute_local) ?? 0)
    const frequency = str(s.frequency) || "daily"
    if (frequency === "weekly") {
        const wd = toInt(s.weekday) ?? 0
        return `Every ${wd >= 0 && wd < 7 ? WEEKDAY_NAMES[wd] : "week"} at ${at}`
    }
    if (frequency === "monthly") { return `On day ${toInt(s.day_of_month) ?? 1} of each month at ${at}` }
    const mode = s.window_mode === "trading_day" ? "trading_day" : "calendar"
    return `Every day at ${at} · ${WINDOW_MODE_LABELS[mode].toLowerCase()}`
}

export function nextRunCaption(s: Json, timezone: string): string {
    if (s.enabled === false) { return "" }
    const at = str(s.next_run_at)
    if (!at || at === "null") { return "" }
    const next = `Next: ${wallClock(at, timezone)}`
    const w = s.next_window
    if (!isObj(w)) { return next }
    if (w.day_close !== null && w.day_close !== undefined && str(w.day_close) !== "") {
        return `${next} — covers ${wallClock(str(w.start_at), timezone)} → ${wallClock(str(w.end_at), timezone)}`
    }
    return `${next} — covers ${periodPhrase(str(w.from), str(w.to))}`
}

// --- The config ---------------------------------------------------------------------

export interface ReportEmailConfig {
    emailAvailable: boolean
    reason: string | null
    schemaReady: boolean
    sendNowEnabled: boolean
    schedulerEnabled: boolean
    recipientsPerSend: number
    addressBookMax: number
    formats: string[]
    reports: EmailableReport[]
    canEditRecipients: boolean
    canUseAllOutlets: boolean
}

export function configFromJson(raw: unknown): ReportEmailConfig | null {
    if (!isObj(raw) || typeof raw.email_available !== "boolean") { return null }
    const sched = isObj(raw.scheduler) ? raw.scheduler : {}
    const limits = isObj(raw.limits) ? raw.limits : {}
    const served: EmailableReport[] = []
    if (Array.isArray(raw.reports)) {
        for (const item of raw.reports as unknown[]) {
            if (!isObj(item)) { continue }
            const key = str(item.key)
            if (!key) { continue }
            const modes = Array.isArray(item.window_modes) ? strings(item.window_modes) : ["calendar"]
            served.push({ key, title: str(item.title) || key, family: item.family === "accounting" ? "accounting" : "mis", tradingDay: modes.includes("trading_day") })
        }
    }
    const reason = raw.reason
    return {
        emailAvailable: raw.email_available,
        reason: typeof reason === "string" && reason ? reason : null,
        schemaReady: raw.schema_ready !== false,
        sendNowEnabled: raw.send_now_enabled !== false,
        schedulerEnabled: sched.enabled === true,
        recipientsPerSend: toInt(limits.recipients_per_send) ?? MAX_RECIPIENTS_PER_SEND,
        addressBookMax: toInt(limits.address_book) ?? MAX_ADDRESS_BOOK,
        formats: Array.isArray(raw.formats) ? orderedFormats(strings(raw.formats)) : ["xlsx", "csv"],
        reports: served.length > 0 ? served : EMAILABLE_REPORTS,
        canEditRecipients: raw.can_edit_recipients === true,
        canUseAllOutlets: raw.can_use_all_outlets === true,
    }
}

export interface EmailBanner { tone: "error" | "warning" | "info"; title: string; detail: string | null }

export function configBanners(c: ReportEmailConfig | null, serverOutdated = false): EmailBanner[] {
    if (!c) {
        return serverOutdated
            ? [{ tone: "warning", title: SERVER_PREDATES_EMAIL_SENTENCE, detail: SERVER_PREDATES_EMAIL_HINT }]
            : [{ tone: "warning", title: "Couldn't check the email settings", detail: "Check the connection and reload. Nothing has been changed." }]
    }
    const out: EmailBanner[] = []
    if (!c.schemaReady) { out.push({ tone: "error", title: SCHEMA_PENDING_SENTENCE, detail: "Ask your administrator to apply migrations 056–058." }) }
    if (!c.emailAvailable) {
        out.push({ tone: "error", title: MAIL_OFF_SENTENCE, detail: c.reason ? `${MAIL_OFF_HINT} (${c.reason})` : MAIL_OFF_HINT })
    } else if (!c.schedulerEnabled) {
        out.push({ tone: "info", title: SCHEDULER_OFF_SENTENCE, detail: null })
    }
    if (c.emailAvailable && !c.sendNowEnabled) { out.push({ tone: "info", title: SEND_NOW_OFF_SENTENCE, detail: null }) }
    return out
}

export function sendNowBlocked(c: ReportEmailConfig | null, serverOutdated = false): string | null {
    if (!c) { return serverOutdated ? SERVER_PREDATES_EMAIL_SENTENCE : "Couldn't check the email settings — reload and try again." }
    if (!c.schemaReady) { return SCHEMA_PENDING_SENTENCE }
    if (!c.emailAvailable) { return MAIL_OFF_SENTENCE }
    if (!c.sendNowEnabled) { return SEND_NOW_OFF_SENTENCE }
    return null
}

export function refusalTitle(code: string | null | undefined): string {
    switch (code) {
        case "mail_not_configured": return MAIL_OFF_SENTENCE
        case "schema_pending": return SCHEMA_PENDING_SENTENCE
        case "send_now_disabled": return SEND_NOW_OFF_SENTENCE
        case "rate_limited": return "Too many emails in a short time"
        case "daily_limit": return "Daily email limit reached"
        case "recipient_not_allowed": return "An address is no longer allowed"
        case "all_outlets_not_allowed": return "All outlets needs an admin or a manager"
        case "duplicate": return "Already in the address book"
        default: return "Couldn't send"
    }
}

// --- The address book -------------------------------------------------------------------

export interface BookEntry { id: string; email: string; label: string | null; active: boolean; suppressedReason: string | null }

export const bookDisplay = (b: BookEntry): string => (b.label ? `${b.label} — ${b.email}` : b.email)

export function bookFromJson(raw: unknown): BookEntry[] | null {
    if (!isObj(raw) || !Array.isArray(raw.recipients)) { return null }
    return (raw.recipients as unknown[]).filter(isObj)
        .filter((x) => str(x.id) && str(x.email))
        .map((x) => ({
            id: str(x.id),
            email: str(x.email),
            label: typeof x.label === "string" && x.label ? x.label : null,
            active: x.status !== "suppressed",
            suppressedReason: typeof x.suppressed_reason === "string" ? x.suppressed_reason : null,
        }))
}

const emailKey = (s: string): string => s.trim().toLowerCase()

export function idsForAddresses(addresses: string[], book: BookEntry[]): { ids: string[]; missing: string[] } {
    const ids: string[] = []
    const missing: string[] = []
    for (const a of addresses) {
        const hit = book.find((b) => b.active && emailKey(b.email) === emailKey(a))
        if (!hit) { missing.push(a) } else if (!ids.includes(hit.id)) { ids.push(hit.id) }
    }
    return { ids, missing }
}

export function addressProblem(email: string, book: BookEntry[], max: number): string | null {
    const s = email.trim()
    if (!s) { return "Type an email address." }
    if (s.length > 254 || /\s/.test(s) || !/^[^@]+@[^@]+\.[^@]+$/.test(s)) { return "That does not look like an email address." }
    if (book.some((b) => emailKey(b.email) === emailKey(s))) { return "That address is already in the address book." }
    if (book.length >= max) { return `The address book holds at most ${max} addresses. Remove one first.` }
    return null
}

// --- Send now ------------------------------------------------------------------------------

export function newClientRequestId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") { return crypto.randomUUID() }
    const b = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))
    b[6] = (b[6] & 0x0f) | 0x40
    b[8] = (b[8] & 0x3f) | 0x80
    const h = b.map((x) => x.toString(16).padStart(2, "0")).join("")
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export function sendBodyKey(body: Json): string {
    const sorted = (v: unknown): string[] => strings(v).sort()
    const w = isObj(body.window) ? body.window : {}
    return JSON.stringify([
        sorted(body.report_keys), sorted(body.formats), str(w.from), str(w.to), str(w.day_close),
        str(body.outlet_scope), sorted(body.recipient_ids),
    ])
}

export interface LastSend { id: string; bodyKey: string; settled: boolean }

export const requestIdFor = (last: LastSend | null, bodyKey: string, fresh: string): string =>
    last && !last.settled && last.bodyKey === bodyKey ? last.id : fresh

export function buildSendBody(o: {
    clientRequestId: string; reportKeys: string[]; formats: string[]; from: string; to: string
    dayClose: string; allOutlets: boolean; recipientIds: string[]; maxRecipients: number
}): { body: Json | null; error: string | null } {
    const close = o.dayClose.trim()
    if (close && parseTime(close) === null) { return { body: null, error: "Write the closing time as HH:mm, or leave it empty for calendar days." } }
    const problem = selectionProblem(o.reportKeys, close ? "trading_day" : "calendar")
    if (problem) { return { body: null, error: problem } }
    const fmts = orderedFormats(o.formats)
    if (fmts.length === 0) { return { body: null, error: "Choose Excel, CSV or both." } }
    const day = /^\d{4}-\d{2}-\d{2}$/
    if (!day.test(o.from) || !day.test(o.to) || o.from > o.to) { return { body: null, error: "Pick the days to send." } }
    const ids = [...new Set(o.recipientIds)]
    if (ids.length === 0) { return { body: null, error: "Choose at least one address from the address book." } }
    if (ids.length > o.maxRecipients) { return { body: null, error: `Choose at most ${o.maxRecipients} addresses.` } }
    return {
        body: {
            client_request_id: o.clientRequestId,
            report_keys: orderedReportKeys(o.reportKeys),
            formats: fmts,
            window: { from: o.from, to: o.to, ...(close ? { day_close: close } : {}) },
            outlet_scope: o.allOutlets ? "all" : "outlet",
            recipient_ids: ids,
        },
        error: null,
    }
}

// --- Deliveries ------------------------------------------------------------------------------

export type EmailTone = "ok" | "bad" | "pending"

export function isFinalDelivery(d: Json): boolean {
    const status = str(d.status)
    if (status === "delivered" || status === "abandoned") { return true }
    return status === "failed" && d.final !== false
}

export const isResting = (d: Json): boolean => str(d.status) === "failed" || isFinalDelivery(d)

export function deliveryStatus(d: Json): { label: string; tone: EmailTone } {
    switch (str(d.status)) {
        case "delivered": return { label: d.channel === "email" ? "Sent" : "Delivered", tone: "ok" }
        case "failed": return isFinalDelivery(d) ? { label: "Failed", tone: "bad" } : { label: "Will retry", tone: "pending" }
        case "abandoned": return { label: "Missed", tone: "bad" }
        case "sending": return { label: "Sending", tone: "pending" }
        case "rendered": return { label: "Building", tone: "pending" }
        default: return { label: "Queued", tone: "pending" }
    }
}

export function deliveryKind(d: Json): string {
    const kind = d.kind
    if (kind === "adhoc") { return strings(d.report_keys).length === 0 ? "Test email" : "Sent from Reports" }
    const key = d.occurrence_key
    if (kind === "manual" || (kind == null && (typeof key !== "string" || !key || key.startsWith("manual:")))) { return "Run now" }
    return "Scheduled"
}

export function retryCaption(d: Json, timezone: string): string {
    if (str(d.status) !== "failed" || isFinalDelivery(d)) { return "" }
    const next = str(d.next_attempt_at)
    const at = next ? wallClock(next, timezone) : ""
    return at ? `The server tries again at ${at}.` : "The server tries again shortly."
}

export const WATCH_MAX_MS = 15 * 60 * 1000
export const POLL_INTERVAL_MS = 2000
export const POLL_MAX_TRIES = 30

export function isWatched(d: Json, now: number): boolean {
    if (isFinalDelivery(d)) { return false }
    const created = Date.parse(str(d.created_at))
    return Number.isFinite(created) && now - created < WATCH_MAX_MS
}

export interface RecipientOutcome { email: string; outcome: "sent" | "refused" | "skipped" | "waiting" }

export function recipientOutcomes(d: Json, scheduled: string[] = []): RecipientOutcome[] {
    const sent = strings(d.delivered_to)
    const refused = strings(d.rejected_to)
    const skipped = strings(d.skipped_to)
    const own = strings(d.recipients)
    const addressed = own.length > 0 ? own : d.channel === "email" ? scheduled : []
    const all: string[] = []
    for (const a of [...addressed, ...sent, ...refused, ...skipped]) {
        if (!all.some((x) => emailKey(x) === emailKey(a))) { all.push(a) }
    }
    const has = (list: string[], a: string): boolean => list.some((x) => emailKey(x) === emailKey(a))
    return all.map((email) => ({
        email,
        outcome: has(sent, email) ? "sent" : has(refused, email) ? "refused" : has(skipped, email) ? "skipped" : "waiting",
    }))
}

export function sendOutcome(d: Json | null, timedOut: boolean, timezone: string): { title: string; description: string; bad: boolean } {
    const onItsWay = "The email is on its way. Its result will appear in Email reports → History."
    if (!d) { return { title: "Queued", description: onItsWay, bad: false } }
    const rows = recipientOutcomes(d)
    const count = (o: string): number => rows.filter((x) => x.outcome === o).length
    const sent = count("sent")
    const extra = [
        count("refused") > 0 ? `${count("refused")} refused by the mail service` : "",
        count("skipped") > 0 ? `${count("skipped")} skipped` : "",
        d.maybe_duplicate === true ? "the server restarted while sending, so someone may have received it twice" : "",
    ].filter(Boolean)
    const status = str(d.status)
    const err = str(d.error)
    if (status === "delivered") {
        return {
            title: `Sent to ${sent} address${sent === 1 ? "" : "es"}`,
            description: extra.length > 0 ? `${extra.join("; ")}.` : "The files are also kept in Email reports → History.",
            bad: false,
        }
    }
    if (status === "failed" && !isFinalDelivery(d)) {
        return {
            title: "Not sent yet",
            description: `${err ? `${err} ` : ""}${retryCaption(d, timezone)} Its result will appear in Email reports → History; pressing Send again with the same choices does not send it twice.`,
            bad: false,
        }
    }
    if (status === "failed" || status === "abandoned") {
        return {
            title: "Couldn't send",
            description: err || (extra.length > 0 ? `${extra.join("; ")}.` : "The mail service did not accept the email."),
            bad: true,
        }
    }
    return { title: timedOut ? "Still sending" : "Queued", description: onItsWay, bad: false }
}

export function fileLabel(f: Json): string {
    const format = str(f.format)
    const what = format === "xlsx" ? "Excel workbook" : `${reportTitle(str(f.report_key))} (CSV)`
    const bytes = toInt(f.bytes) ?? 0
    const size = bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
    const notes = [f.purged === true ? "cleared after 90 days" : size, ...(f.truncated === true ? ["cut short"] : [])]
    return `${what} · ${notes.join(" · ")}`
}

// --- Schedules ----------------------------------------------------------------------------------

export interface EmailScheduleForm {
    name: string
    reportKeys: string[]
    formats: string[]
    frequency: string
    hour: number
    minute: number
    weekday: number
    dayOfMonth: number
    windowMode: string
    allOutlets: boolean
    channel: string
    recipientIds: string[]
    enabled: boolean
}

export const newScheduleForm = (channel: string): EmailScheduleForm => ({
    name: "", reportKeys: ["sales_summary", "settlement_summary"], formats: ["xlsx"], frequency: "daily",
    hour: 23, minute: 30, weekday: 1, dayOfMonth: 1, windowMode: "trading_day", allOutlets: false,
    channel, recipientIds: [], enabled: true,
})

export function formFromSchedule(s: Json, book: BookEntry[]): { form: EmailScheduleForm; missing: string[] } {
    const keys = strings(s.report_keys)
    const fmts = strings(s.formats)
    const found = idsForAddresses(strings(s.recipients), book)
    return {
        form: {
            name: str(s.name),
            reportKeys: orderedReportKeys(keys.length > 0 ? keys : [str(s.report_key) || "sales"]),
            formats: orderedFormats(fmts.length > 0 ? fmts : [str(s.format) || "csv"]),
            frequency: str(s.frequency) || "daily",
            hour: toInt(s.hour_local) ?? 8,
            minute: toInt(s.minute_local) ?? 0,
            weekday: toInt(s.weekday) ?? 1,
            dayOfMonth: toInt(s.day_of_month) ?? 1,
            windowMode: s.window_mode === "trading_day" ? "trading_day" : "calendar",
            allOutlets: s.outlet_scope === "all",
            channel: str(s.channel) || "inbox",
            recipientIds: found.ids,
            enabled: s.enabled !== false,
        },
        missing: found.missing,
    }
}

export function buildSchedulePatch(f: EmailScheduleForm, maxRecipients: number, recipientsTouched = true): { patch: Json | null; error: string | null } {
    const name = f.name.trim()
    if (!name) { return { patch: null, error: "Give the schedule a name" } }
    if (f.hour < 0 || f.hour > 23 || f.minute < 0 || f.minute > 59) { return { patch: null, error: "Pick a time of day" } }
    const mode = f.frequency === "daily" ? f.windowMode : "calendar"
    const problem = selectionProblem(f.reportKeys, mode)
    if (problem) { return { patch: null, error: problem } }
    const fmts = orderedFormats(f.formats)
    if (fmts.length === 0) { return { patch: null, error: "Choose Excel, CSV or both." } }
    const ids = [...new Set(f.recipientIds)]
    if (f.channel === "email" && recipientsTouched && ids.length === 0) {
        return { patch: null, error: "Choose at least one address from the address book, or deliver to the in-app inbox instead." }
    }
    if (ids.length > maxRecipients) { return { patch: null, error: `Choose at most ${maxRecipients} addresses.` } }
    return {
        patch: {
            name,
            report_keys: orderedReportKeys(f.reportKeys),
            formats: fmts,
            frequency: f.frequency,
            hour_local: f.hour,
            minute_local: f.minute,
            weekday: f.frequency === "weekly" ? f.weekday : null,
            day_of_month: f.frequency === "monthly" ? f.dayOfMonth : null,
            window_mode: mode,
            outlet_scope: f.allOutlets ? "all" : "outlet",
            channel: f.channel,
            enabled: f.enabled,
            ...(f.channel !== "email" ? { recipient_ids: [] } : {}),
            ...(f.channel === "email" && recipientsTouched ? { recipient_ids: ids } : {}),
        },
        error: null,
    }
}
