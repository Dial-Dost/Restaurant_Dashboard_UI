// EMAIL REPORTS (client item 9) — everything the Email reports area and the
// Send-now dialog decide, without React and without the "use server" graph.
//
// "In the reports section, all reports or any reports can be emailed to chosen
// email IDs, automated so emails are sent at the end of each day at a specific
// time to the chosen email IDs, with an option to choose/add both the email IDs
// and the send time."
//
// WHY A PURE MODULE. This project's jest runs in node with `roots: src/lib` and
// no DOM renderer, so the rules that have to be right live here and are proved
// by value: which reports may be asked for on which kind of day, what body goes
// to the server, what a delivery's status is called, which address got what.
// The components only lay these out.
//
// THE SERVER DECIDES, THIS FILE OBEYS. Whether this deployment can send mail,
// whether the scheduler runs, who may edit the address book and who may pick
// "all outlets" all come from GET /reports/email/config. Nothing here guesses a
// capability; a missing answer is "we could not ask", never "no".
//
// THE SAME WORDS AS THE APP. Every label below is also in the owner app's
// lib/models/report_email.dart, and a test reads that file when its checkout is
// beside this one. The backend's catalogue (report_catalogue.ts) is pinned the
// same way.

// --- The catalogue ------------------------------------------------------------

export type ReportWindowMode = 'calendar' | 'trading_day';
export type ReportEmailFormat = 'xlsx' | 'csv';
export type ReportFamily = 'mis' | 'accounting';

export interface EmailableReport {
    key: string;
    title: string;
    family: ReportFamily;
    /** The kinds of day this report may be read on. */
    window_modes: ReportWindowMode[];
}

const BOTH: ReportWindowMode[] = ['calendar', 'trading_day'];

/**
 * The eighteen reports, in the backend's order: the fifteen Insights → Reports
 * tabs, then the three accounting reports. The server's own list (config
 * `reports`) replaces this when it answers; this is the fallback and the
 * vocabulary the tests pin.
 */
export const EMAILABLE_REPORTS: readonly EmailableReport[] = [
    { key: 'item_wise', title: 'Item Wise', family: 'mis', window_modes: BOTH },
    { key: 'discount', title: 'Discount', family: 'mis', window_modes: BOTH },
    { key: 'void_kot', title: 'Void KOT', family: 'mis', window_modes: BOTH },
    { key: 'bill_edit', title: 'Bill Edit', family: 'mis', window_modes: BOTH },
    { key: 'sales_summary', title: 'Sales Summary', family: 'mis', window_modes: BOTH },
    { key: 'order_summary', title: 'Order Summary', family: 'mis', window_modes: BOTH },
    { key: 'executive_summary', title: 'Executive Summary', family: 'mis', window_modes: BOTH },
    { key: 'cover_size_summary', title: 'Cover Size Summary', family: 'mis', window_modes: BOTH },
    { key: 'settlement_summary', title: 'Settlement Summary', family: 'mis', window_modes: BOTH },
    { key: 'nc_summary', title: 'NC Summary', family: 'mis', window_modes: BOTH },
    { key: 'service_charge_deny', title: 'Service Charge Deny', family: 'mis', window_modes: BOTH },
    { key: 'group_summary', title: 'Group Summary', family: 'mis', window_modes: BOTH },
    { key: 'variation_summary', title: 'Variation Summary', family: 'mis', window_modes: BOTH },
    { key: 'tip_summary', title: 'Tip Summary', family: 'mis', window_modes: BOTH },
    { key: 'counter_summary', title: 'Counter Summary', family: 'mis', window_modes: BOTH },
    { key: 'sales', title: 'Sales (accounting)', family: 'accounting', window_modes: BOTH },
    { key: 'gst', title: 'GST', family: 'accounting', window_modes: ['calendar'] },
    { key: 'pnl', title: 'Profit & Loss', family: 'accounting', window_modes: ['calendar'] },
];

export const MIS_EMAIL_KEYS: readonly string[] = EMAILABLE_REPORTS.filter((r) => r.family === 'mis').map((r) => r.key);
/** GST and P&L are statutory, month-based documents: calendar days only. */
export const CALENDAR_ONLY_KEYS: readonly string[] = EMAILABLE_REPORTS.filter((r) => !r.window_modes.includes('trading_day')).map((r) => r.key);

/** The server's limits, restated for the fallback; the config's own win. */
export const MAX_RECIPIENTS_PER_SEND = 10;
export const MAX_ADDRESS_BOOK = 25;

// --- The words ------------------------------------------------------------------

export const EMAIL_AREA_TITLE = 'Email reports';
export const EMAIL_BUTTON_LABEL = 'Email';
export const EMAIL_BUTTON_TOOLTIP = 'Email this report';
/** The backend's MAIL_OFF_SENTENCE, word for word. */
export const MAIL_OFF_SENTENCE = 'Email is not set up on this server';
export const MAIL_OFF_HINT = 'Ask your administrator to set up the mail settings. Reports can still be downloaded here.';
export const SCHEMA_PENDING_SENTENCE = 'Email reports need a database update that has not been applied to this server yet.';
export const SCHEDULER_OFF_SENTENCE = 'Scheduled emails are switched off on this server. Send now still works.';
export const SEND_NOW_OFF_SENTENCE = 'Sending reports on demand is switched off on this server.';
export const TEST_EMAIL_LABEL = 'Send test email';
export const ADDRESS_BOOK_TITLE = 'Address book';
export const ADDRESS_BOOK_EMPTY = 'No addresses yet. Reports can only be emailed to addresses in this list.';
export const ADDRESS_BOOK_READ_ONLY = 'Only someone with the Settings permission can add or remove addresses.';
export const WHOLE_DAYS_NOTE = 'Emailed reports always cover whole days — the session filter on screen is not applied.';
export const FORMAT_LABELS: Readonly<Record<ReportEmailFormat, string>> = {
    xlsx: 'Excel workbook (.xlsx)',
    csv: 'CSV (one file per report)',
};
export const WINDOW_MODE_LABELS: Readonly<Record<ReportWindowMode, string>> = {
    trading_day: 'The day that just ended',
    calendar: 'Previous calendar day',
};

// --- Selection ------------------------------------------------------------------

export function reportTitle(key: string, catalogue: readonly EmailableReport[] = EMAILABLE_REPORTS): string {
    return catalogue.find((r) => r.key === key)?.title ?? EMAILABLE_REPORTS.find((r) => r.key === key)?.title ?? key;
}

/**
 * "Sales Summary and Void KOT", "All 15 MIS reports", "Item Wise, Discount and
 * 3 more" — the backend's reportListPhrase, so a schedule row here reads like
 * the subject of the email it sends.
 */
export function reportListPhrase(keys: readonly string[], max = 2): string {
    const titles = keys.map((k) => reportTitle(k));
    if (titles.length === 0) {return 'No reports';}
    if (titles.length === EMAILABLE_REPORTS.length) {return 'All reports';}
    if (titles.length === MIS_EMAIL_KEYS.length && keys.every((k) => MIS_EMAIL_KEYS.includes(k))) {return 'All 15 MIS reports';}
    if (titles.length <= max) {return titles.join(titles.length === 2 ? ' and ' : '');}
    return `${titles.slice(0, max).join(', ')} and ${String(titles.length - max)} more`;
}

/** The chosen keys in catalogue order, de-duplicated, unknown ones dropped. */
export function orderedKeys(keys: readonly string[]): string[] {
    const wanted = new Set(keys);
    return EMAILABLE_REPORTS.map((r) => r.key).filter((k) => wanted.has(k));
}

/**
 * The same refusal the server gives, before the request: nothing chosen, or
 * GST / P&L on a trading day.
 */
export function selectionProblem(keys: readonly string[], mode: ReportWindowMode): string | null {
    const ordered = orderedKeys(keys);
    if (ordered.length === 0) {return 'Pick at least one report to send.';}
    if (mode === 'trading_day') {
        const blocked = CALENDAR_ONLY_KEYS.filter((k) => ordered.includes(k));
        if (blocked.length > 0) {
            const names = blocked.map((k) => reportTitle(k)).join(' and ');
            return `${names} can only be sent for calendar days. Choose "previous calendar day", or leave ${blocked.length > 1 ? 'them' : 'it'} out.`;
        }
    }
    return null;
}

/** Whether a report can be ticked for this kind of day — and why not. */
export function reportDisabledReason(key: string, mode: ReportWindowMode): string | null {
    return mode === 'trading_day' && CALENDAR_ONLY_KEYS.includes(key) ? 'Calendar days only' : null;
}

/** Formats in the server's order; an empty choice is refused, never defaulted silently. */
export function orderedFormats(formats: readonly string[]): ReportEmailFormat[] {
    return (['xlsx', 'csv'] as const).filter((f) => formats.includes(f));
}

// --- Time -----------------------------------------------------------------------

const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** "HH:mm" → minutes, or null. 24:00 is not a send time. */
export function parseTime(value: string): number | null {
    const m = TIME_RE.exec(String(value ?? '').trim());
    if (!m) {return null;}
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) {return null;}
    return h * 60 + min;
}

export const hhmm = (hour: number, minute: number): string =>
    `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Wed 17 Sep" — the backend's own month names, so ICU's "Sept" never appears. */
export function shortDay(key: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? ''));
    if (!m) {return String(key ?? '');}
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return `${WEEKDAYS_SHORT[d.getUTCDay()]} ${String(Number(m[3]))} ${MONTHS_SHORT[Number(m[2]) - 1]}`;
}

/** "17 Sep" or "1 Sep – 15 Sep". */
export function periodPhrase(from: string, to: string): string {
    const a = shortDay(from).split(' ').slice(1).join(' ');
    const b = shortDay(to).split(' ').slice(1).join(' ');
    return from === to ? shortDay(from) : `${a} – ${b}`;
}

/** An instant on the restaurant's wall clock: "18 Sep, 02:00". */
export function wallClock(iso: string | null | undefined, timeZone: string): string {
    if (!iso) {return '';}
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {return String(iso);}
    let parts: Intl.DateTimeFormatPart[];
    try {
        parts = new Intl.DateTimeFormat('en-GB', {
            timeZone, day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
        }).formatToParts(d);
    } catch {
        return d.toISOString();
    }
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${String(Number(get('day')))} ${MONTHS_SHORT[Number(get('month')) - 1] ?? get('month')}, ${get('hour')}:${get('minute')}`;
}

/**
 * What one run of a schedule covers, in words the owner can check against the
 * drawer. A trading day names its close, because "the day" is the whole point.
 */
export function coverageCaption(frequency: string, mode: ReportWindowMode, time: string): string {
    if (frequency === 'weekly') {return 'Covers the seven restaurant days ending the day before it runs.';}
    if (frequency === 'monthly') {return 'Covers the whole previous calendar month.';}
    if (mode === 'trading_day') {
        const at = parseTime(time) === null ? 'the send time' : time;
        return `Covers the 24 hours up to ${at} — the trading day that just closed, so bills settled after midnight count on the day they belong to.`;
    }
    return 'Covers the previous calendar day, midnight to midnight.';
}

/** The kind of day a new schedule gets unless the owner says otherwise. */
export function defaultWindowMode(frequency: string, keys: readonly string[]): ReportWindowMode {
    return frequency === 'daily' && !keys.some((k) => CALENDAR_ONLY_KEYS.includes(k)) ? 'trading_day' : 'calendar';
}

// --- The config -----------------------------------------------------------------

export interface ReportEmailConfig {
    email_available: boolean;
    transport: string;
    message: string | null;
    /** Names the missing setting — sent only to someone who can edit the book. */
    reason: string | null;
    schema_ready: boolean;
    send_now_enabled: boolean;
    scheduler: {
        enabled: boolean;
        armed_here: boolean;
        last_sweep_at: string | null;
        leader_seen_at: string | null;
        lease_until: string | null;
        mail_ready: boolean | null;
    };
    limits: {
        recipients_per_send: number;
        address_book: number;
        email_schedules_per_outlet: number;
        window_days: number;
        restaurant_daily: number;
        platform_daily: number;
        send_now_per_hour: number;
        test_per_hour: number;
    };
    formats: ReportEmailFormat[];
    reports: EmailableReport[];
    can_edit_recipients: boolean;
    can_use_all_outlets: boolean;
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** The config as this client can use it, or null when the answer is unreadable. */
export function readReportEmailConfig(raw: unknown): ReportEmailConfig | null {
    if (!raw || typeof raw !== 'object') {return null;}
    const r = raw as Record<string, unknown>;
    if (typeof r.email_available !== 'boolean') {return null;}
    const sched = (r.scheduler && typeof r.scheduler === 'object' ? r.scheduler : {}) as Record<string, unknown>;
    const limits = (r.limits && typeof r.limits === 'object' ? r.limits : {}) as Record<string, unknown>;
    const reports = Array.isArray(r.reports)
        ? r.reports
            .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
            .map((x) => ({
                key: String(x.key ?? ''),
                title: String(x.title ?? x.key ?? ''),
                family: (x.family === 'accounting' ? 'accounting' : 'mis') as ReportFamily,
                window_modes: (Array.isArray(x.window_modes) ? x.window_modes : ['calendar'])
                    .filter((m): m is ReportWindowMode => m === 'calendar' || m === 'trading_day'),
            }))
            .filter((x) => x.key.length > 0)
        : [];
    return {
        email_available: r.email_available,
        transport: String(r.transport ?? 'off'),
        message: str(r.message),
        reason: str(r.reason),
        schema_ready: r.schema_ready !== false,
        send_now_enabled: r.send_now_enabled !== false,
        scheduler: {
            enabled: sched.enabled === true,
            armed_here: sched.armed_here === true,
            last_sweep_at: str(sched.last_sweep_at),
            leader_seen_at: str(sched.leader_seen_at),
            lease_until: str(sched.lease_until),
            mail_ready: typeof sched.mail_ready === 'boolean' ? sched.mail_ready : null,
        },
        limits: {
            recipients_per_send: num(limits.recipients_per_send, MAX_RECIPIENTS_PER_SEND),
            address_book: num(limits.address_book, MAX_ADDRESS_BOOK),
            email_schedules_per_outlet: num(limits.email_schedules_per_outlet, 20),
            window_days: num(limits.window_days, 92),
            restaurant_daily: num(limits.restaurant_daily, 200),
            platform_daily: num(limits.platform_daily, 2000),
            send_now_per_hour: num(limits.send_now_per_hour, 10),
            test_per_hour: num(limits.test_per_hour, 3),
        },
        formats: Array.isArray(r.formats) ? orderedFormats(r.formats.map(String)) : ['xlsx', 'csv'],
        reports: reports.length > 0 ? reports : [...EMAILABLE_REPORTS],
        can_edit_recipients: r.can_edit_recipients === true,
        can_use_all_outlets: r.can_use_all_outlets === true,
    };
}

export type BannerTone = 'error' | 'warning' | 'info';
export interface Banner { tone: BannerTone; title: string; detail: string | null }

/**
 * What the area says above everything else, most serious first. `null` config
 * means the question could not be asked — said as that, not as "no email".
 */
export function configBanners(config: ReportEmailConfig | null): Banner[] {
    if (!config) {
        return [{ tone: 'warning', title: "Couldn't check the email settings", detail: 'Check the connection and reload. Nothing has been changed.' }];
    }
    const out: Banner[] = [];
    if (!config.schema_ready) {
        out.push({ tone: 'error', title: SCHEMA_PENDING_SENTENCE, detail: 'Ask your administrator to apply migrations 056–058.' });
    }
    if (!config.email_available) {
        out.push({ tone: 'error', title: MAIL_OFF_SENTENCE, detail: config.reason ? `${MAIL_OFF_HINT} (${config.reason})` : MAIL_OFF_HINT });
    } else if (!config.scheduler.enabled) {
        out.push({ tone: 'info', title: SCHEDULER_OFF_SENTENCE, detail: null });
    }
    if (config.email_available && !config.send_now_enabled) {
        out.push({ tone: 'info', title: SEND_NOW_OFF_SENTENCE, detail: null });
    }
    return out;
}

/** Why Send now cannot be used right now, or null when it can. */
export function sendNowBlocked(config: ReportEmailConfig | null): string | null {
    if (!config) {return "Couldn't check the email settings — reload and try again.";}
    if (!config.schema_ready) {return SCHEMA_PENDING_SENTENCE;}
    if (!config.email_available) {return MAIL_OFF_SENTENCE;}
    if (!config.send_now_enabled) {return SEND_NOW_OFF_SENTENCE;}
    return null;
}

// --- The address book -------------------------------------------------------------

export interface BookEntry {
    id: string;
    email: string;
    label: string | null;
    status: 'active' | 'suppressed';
    suppressed_reason: string | null;
}

export function readBook(raw: unknown): { recipients: BookEntry[]; can_edit: boolean; max: number } | null {
    if (!raw || typeof raw !== 'object') {return null;}
    const r = raw as Record<string, unknown>;
    if (!Array.isArray(r.recipients)) {return null;}
    return {
        recipients: r.recipients
            .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
            .map((x) => ({
                id: String(x.id ?? ''),
                email: String(x.email ?? ''),
                label: str(x.label),
                status: x.status === 'suppressed' ? 'suppressed' as const : 'active' as const,
                suppressed_reason: str(x.suppressed_reason),
            }))
            .filter((x) => x.id && x.email),
        can_edit: r.can_edit === true,
        max: num(r.max, MAX_ADDRESS_BOOK),
    };
}

/** How an address is shown: "Accounts — accounts@firm.in", or the address alone. */
export function bookEntryLabel(e: Pick<BookEntry, 'email' | 'label'>): string {
    return e.label ? `${e.label} — ${e.email}` : e.email;
}

const emailKey = (s: string): string => String(s ?? '').trim().toLowerCase();

/** The book ids behind a schedule's stored addresses; addresses no longer in the book are reported, not dropped silently. */
export function idsForAddresses(addresses: readonly string[], book: readonly BookEntry[]): { ids: string[]; missing: string[] } {
    const ids: string[] = [];
    const missing: string[] = [];
    for (const a of addresses) {
        const hit = book.find((b) => emailKey(b.email) === emailKey(a) && b.status === 'active');
        if (hit) { if (!ids.includes(hit.id)) {ids.push(hit.id);} } else { missing.push(a); }
    }
    return { ids, missing };
}

/** A client-side check of a typed address — the server checks again. */
export function addressProblem(email: string, book: readonly BookEntry[], max: number): string | null {
    const s = String(email ?? '').trim();
    if (!s) {return 'Type an email address.';}
    if (s.length > 254 || /\s/.test(s) || !/^[^@]+@[^@]+\.[^@]+$/.test(s)) {return 'That does not look like an email address.';}
    if (book.some((b) => emailKey(b.email) === emailKey(s))) {return 'That address is already in the address book.';}
    if (book.length >= max) {return `The address book holds at most ${String(max)} addresses. Remove one first.`;}
    return null;
}

// --- Send now ---------------------------------------------------------------------

export interface SendNowChoice {
    clientRequestId: string;
    reportKeys: string[];
    formats: string[];
    from: string;
    to: string;
    /** "HH:mm", or empty for calendar days. */
    dayClose: string;
    scope: 'outlet' | 'all';
    recipientIds: string[];
}

export interface SendNowBody {
    client_request_id: string;
    report_keys: string[];
    formats: ReportEmailFormat[];
    window: { from: string; to: string; day_close?: string };
    outlet_scope: 'outlet' | 'all';
    recipient_ids: string[];
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The POST /reports/email/send body, or the sentence that stops it. No time
 * slot is ever sent — the server refuses one, and the dialog says so instead.
 */
export function buildSendBody(c: SendNowChoice, maxRecipients = MAX_RECIPIENTS_PER_SEND): { ok: true; body: SendNowBody } | { ok: false; error: string } {
    const close = c.dayClose.trim();
    if (close && parseTime(close) === null) {return { ok: false, error: 'Write the closing time as HH:mm, or leave it empty for calendar days.' };}
    const mode: ReportWindowMode = close ? 'trading_day' : 'calendar';
    const problem = selectionProblem(c.reportKeys, mode);
    if (problem) {return { ok: false, error: problem };}
    const formats = orderedFormats(c.formats);
    if (formats.length === 0) {return { ok: false, error: 'Choose Excel, CSV or both.' };}
    if (!DAY_RE.test(c.from) || !DAY_RE.test(c.to) || c.from > c.to) {return { ok: false, error: 'Pick the days to send.' };}
    const ids = [...new Set(c.recipientIds)];
    if (ids.length === 0) {return { ok: false, error: 'Choose at least one address from the address book.' };}
    if (ids.length > maxRecipients) {return { ok: false, error: `Choose at most ${String(maxRecipients)} addresses.` };}
    if (!isRequestId(c.clientRequestId)) {return { ok: false, error: 'This send has no request id — close the dialog and open it again.' };}
    return {
        ok: true,
        body: {
            client_request_id: c.clientRequestId,
            report_keys: orderedKeys(c.reportKeys),
            formats,
            window: close ? { from: c.from, to: c.to, day_close: close } : { from: c.from, to: c.to },
            outlet_scope: c.scope,
            recipient_ids: ids,
        },
    };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isRequestId = (v: string): boolean => UUID_RE.test(String(v ?? ''));

/**
 * ONE id per dialog, made when it opens and reused by every retry of that send
 * — the server turns a repeat into a replay of the same delivery, so a dropped
 * response can never become a second email.
 */
export function newClientRequestId(rand: () => number = Math.random): string {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (rand === Math.random && typeof c?.randomUUID === 'function') {return c.randomUUID();}
    const hex = Array.from({ length: 32 }, () => Math.floor(rand() * 16).toString(16));
    hex[12] = '4';
    hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
    const h = hex.join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The refusal a client can act on, by the server's `code`. */
export function refusalTitle(code: string | null | undefined): string {
    switch (code) {
        case 'mail_not_configured': return MAIL_OFF_SENTENCE;
        case 'schema_pending': return SCHEMA_PENDING_SENTENCE;
        case 'send_now_disabled': return SEND_NOW_OFF_SENTENCE;
        case 'rate_limited': return 'Too many emails in a short time';
        case 'daily_limit': return 'Daily email limit reached';
        case 'recipient_not_allowed': return 'An address is no longer allowed';
        case 'all_outlets_not_allowed': return 'All outlets needs an admin or a manager';
        case 'duplicate': return 'Already in the address book';
        default: return "Couldn't send";
    }
}

// --- Deliveries -------------------------------------------------------------------

export interface DeliveryFile {
    id: string;
    report_key: string;
    format: string;
    filename: string;
    mime: string;
    bytes: number;
    rows: number;
    truncated: boolean;
    purged: boolean;
}

export interface DeliveryLike {
    status: string;
    channel?: string | null;
    kind?: string | null;
    report_keys?: string[] | null;
    recipients?: string[] | null;
    delivered_to?: string[] | null;
    rejected_to?: string[] | null;
    skipped_to?: string[] | null;
    maybe_duplicate?: boolean | null;
    attempts?: number;
    error?: string | null;
}

export type StatusTone = 'ok' | 'bad' | 'pending' | 'muted';

/** One word per state, the same on web and app. */
export function deliveryStatus(d: Pick<DeliveryLike, 'status' | 'channel'>): { label: string; tone: StatusTone } {
    switch (d.status) {
        case 'delivered': return { label: d.channel === 'email' ? 'Sent' : 'Delivered', tone: 'ok' };
        case 'failed': return { label: 'Failed', tone: 'bad' };
        case 'abandoned': return { label: 'Missed', tone: 'bad' };
        case 'sending': return { label: 'Sending', tone: 'pending' };
        case 'rendered': return { label: 'Building', tone: 'pending' };
        default: return { label: 'Queued', tone: 'pending' };
    }
}

/** Where a delivery came from. */
export function deliveryKind(d: Pick<DeliveryLike, 'kind' | 'report_keys'>, occurrenceKey?: string | null): string {
    if (d.kind === 'adhoc') {return (d.report_keys ?? []).length === 0 ? 'Test email' : 'Sent from Reports';}
    if (d.kind === 'manual' || (!d.kind && (!occurrenceKey || occurrenceKey.startsWith('manual:')))) {return 'Run now';}
    return 'Scheduled';
}

/** Settled = nothing more will happen without a person. A failed row may still be retried by the server. */
export const isSettled = (status: string): boolean => status === 'delivered' || status === 'abandoned' || status === 'failed';

export type RecipientOutcome = 'sent' | 'refused' | 'skipped' | 'waiting';
export const RECIPIENT_OUTCOME_LABELS: Readonly<Record<RecipientOutcome, string>> = {
    sent: 'Sent',
    refused: 'Refused',
    skipped: 'Skipped',
    waiting: 'Waiting',
};

/**
 * ONE OUTCOME PER ADDRESS. The addresses a send was for (a Send now's own list,
 * or — for a scheduled row — whatever the log recorded), each with what
 * happened to it. An address the log has not decided yet is "waiting".
 */
export function recipientOutcomes(d: DeliveryLike, scheduled: readonly string[] = []): { email: string; outcome: RecipientOutcome }[] {
    const sent = d.delivered_to ?? [];
    const refused = d.rejected_to ?? [];
    const skipped = d.skipped_to ?? [];
    const addressed = d.recipients && d.recipients.length > 0 ? d.recipients : d.channel === 'email' ? [...scheduled] : [];
    const all: string[] = [];
    for (const a of [...addressed, ...sent, ...refused, ...skipped]) {
        if (!all.some((x) => emailKey(x) === emailKey(a))) {all.push(a);}
    }
    const has = (list: readonly string[], a: string) => list.some((x) => emailKey(x) === emailKey(a));
    return all.map((email) => ({
        email,
        outcome: has(sent, email) ? 'sent' : has(refused, email) ? 'refused' : has(skipped, email) ? 'skipped' : 'waiting',
    }));
}

/** The toast a finished (or still running) Send now ends with. */
export function sendOutcome(d: DeliveryLike | null, timedOut: boolean): { title: string; description: string; destructive: boolean } {
    if (!d) {
        return { title: 'Queued', description: 'The email is on its way. Its result will appear in Email reports → History.', destructive: false };
    }
    const rows = recipientOutcomes(d);
    const count = (o: RecipientOutcome) => rows.filter((r) => r.outcome === o).length;
    const sent = count('sent');
    const extra: string[] = [];
    if (count('refused') > 0) {extra.push(`${String(count('refused'))} refused by the mail service`);}
    if (count('skipped') > 0) {extra.push(`${String(count('skipped'))} skipped`);}
    if (d.maybe_duplicate) {extra.push('the server restarted while sending, so someone may have received it twice');}
    if (d.status === 'delivered') {
        return {
            title: `Sent to ${String(sent)} address${sent === 1 ? '' : 'es'}`,
            description: extra.length > 0 ? `${extra.join('; ')}.` : 'The files are also kept in Email reports → History.',
            destructive: false,
        };
    }
    if (d.status === 'failed' || d.status === 'abandoned') {
        return {
            title: "Couldn't send",
            description: d.error ?? (extra.length > 0 ? `${extra.join('; ')}.` : 'The mail service did not accept the email.'),
            destructive: true,
        };
    }
    return {
        title: timedOut ? 'Still sending' : 'Queued',
        description: 'The email is on its way. Its result will appear in Email reports → History.',
        destructive: false,
    };
}

/** "Excel workbook", "Item Wise (CSV)", with its size. */
export function fileLabel(f: Pick<DeliveryFile, 'report_key' | 'format' | 'bytes' | 'truncated' | 'purged'>): string {
    const what = f.format === 'xlsx' ? 'Excel workbook' : `${reportTitle(f.report_key)} (CSV)`;
    const size = f.bytes >= 1024 * 1024 ? `${(f.bytes / (1024 * 1024)).toFixed(1)} MB` : `${String(Math.max(1, Math.round(f.bytes / 1024)))} KB`;
    const notes = [f.purged ? 'cleared after 90 days' : size, f.truncated ? 'cut short' : ''].filter(Boolean);
    return `${what} · ${notes.join(' · ')}`;
}

/** Poll every two seconds for up to a minute; after that the history takes over. */
export const POLL_INTERVAL_MS = 2000;
export const POLL_MAX_TRIES = 30;

// --- Schedules --------------------------------------------------------------------

export interface EmailScheduleForm {
    name: string;
    report_keys: string[];
    formats: string[];
    frequency: string;
    /** "HH:mm", any minute. */
    time: string;
    weekday: string;
    day_of_month: string;
    window_mode: ReportWindowMode;
    outlet_scope: 'outlet' | 'all';
    channel: string;
    recipient_ids: string[];
}

export interface EmailSchedulePatch {
    name: string;
    report_keys: string[];
    formats: ReportEmailFormat[];
    frequency: string;
    hour_local: number;
    minute_local: number;
    weekday: number | null;
    day_of_month: number | null;
    window_mode: ReportWindowMode;
    outlet_scope: 'outlet' | 'all';
    channel: string;
    recipient_ids?: string[];
}

export const BLANK_EMAIL_SCHEDULE: EmailScheduleForm = {
    name: '',
    report_keys: ['sales_summary', 'settlement_summary'],
    formats: ['xlsx'],
    frequency: 'daily',
    time: '23:30',
    weekday: '1',
    day_of_month: '1',
    window_mode: 'trading_day',
    outlet_scope: 'outlet',
    channel: 'email',
    recipient_ids: [],
};

/** The form for a stored schedule. Addresses no longer in the book come back in `missing`. */
export function formFromSchedule(
    s: {
        name: string; report_key: string; report_keys?: string[] | null; formats?: string[] | null; format?: string;
        frequency: string; hour_local: number; minute_local: number; weekday: number | null; day_of_month: number | null;
        window_mode?: string | null; outlet_scope?: string | null; channel: string; recipients?: string[] | null;
    },
    book: readonly BookEntry[],
): { form: EmailScheduleForm; missing: string[] } {
    const keys = s.report_keys && s.report_keys.length > 0 ? s.report_keys : [s.report_key];
    const { ids, missing } = idsForAddresses(s.recipients ?? [], book);
    return {
        form: {
            name: s.name,
            report_keys: orderedKeys(keys),
            formats: s.formats && s.formats.length > 0 ? orderedFormats(s.formats) : orderedFormats([s.format ?? 'csv']),
            frequency: s.frequency,
            time: hhmm(s.hour_local, s.minute_local),
            weekday: String(s.weekday ?? 1),
            day_of_month: String(s.day_of_month ?? 1),
            window_mode: s.window_mode === 'trading_day' ? 'trading_day' : 'calendar',
            outlet_scope: s.outlet_scope === 'all' ? 'all' : 'outlet',
            channel: s.channel,
            recipient_ids: ids,
        },
        missing,
    };
}

/**
 * The create/edit body, or what is missing. `recipientsTouched` false on an
 * edit leaves the stored list alone, so an address the owner did not touch is
 * never dropped because it could not be matched to the book on this screen.
 */
export function buildEmailSchedulePatch(
    f: EmailScheduleForm,
    opts: { maxRecipients?: number; recipientsTouched?: boolean } = {},
): { ok: true; patch: EmailSchedulePatch } | { ok: false; message: string } {
    const name = f.name.trim();
    if (!name) {return { ok: false, message: 'Give the schedule a name' };}
    const minutes = parseTime(f.time);
    if (minutes === null) {return { ok: false, message: 'Pick a time of day' };}
    const mode: ReportWindowMode = f.frequency === 'daily' ? f.window_mode : 'calendar';
    const problem = selectionProblem(f.report_keys, mode);
    if (problem) {return { ok: false, message: problem };}
    const formats = orderedFormats(f.formats);
    if (formats.length === 0) {return { ok: false, message: 'Choose Excel, CSV or both.' };}
    const max = opts.maxRecipients ?? MAX_RECIPIENTS_PER_SEND;
    const touched = opts.recipientsTouched !== false;
    const ids = [...new Set(f.recipient_ids)];
    if (f.channel === 'email' && touched && ids.length === 0) {
        return { ok: false, message: 'Choose at least one address from the address book, or deliver to the in-app inbox instead.' };
    }
    if (ids.length > max) {return { ok: false, message: `Choose at most ${String(max)} addresses.` };}
    const patch: EmailSchedulePatch = {
        name,
        report_keys: orderedKeys(f.report_keys),
        formats,
        frequency: f.frequency,
        hour_local: Math.floor(minutes / 60),
        minute_local: minutes % 60,
        weekday: f.frequency === 'weekly' ? Number(f.weekday) : null,
        day_of_month: f.frequency === 'monthly' ? Number(f.day_of_month) : null,
        window_mode: mode,
        outlet_scope: f.outlet_scope,
        channel: f.channel,
    };
    if (f.channel !== 'email') {patch.recipient_ids = [];}
    else if (touched) {patch.recipient_ids = ids;}
    return { ok: true, patch };
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Every day at 23:30 · the day that just ended", "Every Monday at 08:00". */
export function cadenceCaption(s: { frequency: string; hour_local: number; minute_local: number; weekday: number | null; day_of_month: number | null; window_mode?: string | null }): string {
    const at = hhmm(s.hour_local, s.minute_local);
    if (s.frequency === 'weekly') {return `Every ${WEEKDAY_NAMES[s.weekday ?? 0] ?? 'week'} at ${at}`;}
    if (s.frequency === 'monthly') {return `On day ${String(s.day_of_month ?? 1)} of each month at ${at}`;}
    return `Every day at ${at} · ${(s.window_mode === 'trading_day' ? WINDOW_MODE_LABELS.trading_day : WINDOW_MODE_LABELS.calendar).toLowerCase()}`;
}

/** "Next: 18 Sep, 02:00 — covers 17 Sep, 02:00 → 18 Sep, 02:00". Empty for a
 *  paused schedule: its chip already says so, and it has no next run. */
export function nextRunCaption(
    s: { enabled: boolean; next_run_at?: string | null; next_window?: { from: string; to: string; day_close: string | null; start_at: string; end_at: string } | null },
    timeZone: string,
): string {
    if (!s.enabled) {return '';}
    if (!s.next_run_at) {return '';}
    const next = `Next: ${wallClock(s.next_run_at, timeZone)}`;
    const w = s.next_window;
    if (!w) {return next;}
    if (w.day_close) {return `${next} — covers ${wallClock(w.start_at, timeZone)} → ${wallClock(w.end_at, timeZone)}`;}
    return `${next} — covers ${periodPhrase(w.from, w.to)}`;
}
