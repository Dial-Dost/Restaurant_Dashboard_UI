// EMAILING REPORTS FROM THIS WEB APP — the rules and the words for the send
// this app performs ITSELF, with the transport in Settings → Email.
//
// WHY THIS EXISTS. "Email reports" belongs to the restaurant server: it builds
// the files, sends them, keeps the history and runs the schedules. Its mail
// transport comes from that server's ENVIRONMENT (Restaurant_Backend/mailer.ts
// reads process.env on every send), so when nobody set those variables the
// server answers `email_available: false` and refuses — and no screen, here or
// in the app, can change that. Saving settings in Settings → Email sets up THIS
// app's transport, which is why doing so left Reports saying the same sentence
// and left Send greyed out.
//
// So when the restaurant server cannot send, this app sends. It reads the same
// reports from the same server with the signed-in person's own token (so the
// permission that guards a report still guards the email of it), builds the
// files here, and hands them to the transport the owner saved. What it CANNOT
// do is pretend to be the server: these sends are not in the server's delivery
// History, they are not retried, and a SCHEDULE still runs on the server and
// still needs those environment variables. Every one of those facts is said in
// words on the screen rather than left for someone to discover.
//
// Pure: no React, no network, no node APIs. The I/O lives in
// lib/api/report-mail.ts, the transport in lib/mail-transport.ts.

import {
    buildExportMatrix,
    reportDef,
    rowsOf,
    toCsv,
    type MisColumn,
    type MisReportDef,
    type MisReportPayload,
    type MisRow,
} from "@/lib/mis-reports";

// --- Limits -------------------------------------------------------------------

/** One page of a paged MIS report; the server clamps its own limit to 500. */
export const WEB_SEND_PAGE = 500;
/** Rows we will gather for one report. Beyond this the file says it was cut. */
export const WEB_SEND_ROW_CAP = 5000;
/** Everything attached to one message. Mail servers refuse far less than this. */
export const WEB_SEND_MAX_BYTES = 12 * 1024 * 1024;
/** Addresses one send may go to, matching the server's own limit. */
export const WEB_SEND_MAX_RECIPIENTS = 10;

// --- The words ----------------------------------------------------------------

export const WEB_MAIL_TITLE = "This web app sends these emails";
export const WEB_MAIL_HINT =
    "The restaurant server has no mail settings, so Send now goes out through this web app using Settings → Email. " +
    "These sends are not listed in History below, and a schedule still runs on the restaurant server, which needs " +
    "the same settings in its environment.";
export const WEB_MAIL_SENT_NOTE = "Sent by this web app, not by the restaurant server — it will not appear in History.";
export const WEB_MAIL_OFF_SENTENCE =
    "Email is not set up on the restaurant server, and this web app has no mail settings either.";
export const WEB_MAIL_SIGN_IN_AGAIN = "Sign in again — this session has no identity the server recognises.";
export const WEB_MAIL_NO_SERVER = "Couldn't reach the restaurant server. Nothing has been sent.";

// --- What a report key is, and where its file comes from ------------------------

/** The three accounting reports, which are not MIS routes. */
const ACCOUNTING: Record<string, { title: string; path: string; csvRoute: boolean }> = {
    sales: { title: "Sales (accounting)", path: "/reports/sales.csv", csvRoute: true },
    gst: { title: "GST", path: "/reports/gst.csv", csvRoute: true },
    pnl: { title: "Profit & Loss", path: "/reports/pnl", csvRoute: false },
};

/** GST and P&L are whole calendar days — a trading-day close cannot cut them. */
export const CALENDAR_ONLY_MAIL_KEYS = ["gst", "pnl"];

export type ReportSourceKind = "mis" | "csv" | "pnl";

export interface ReportSource {
    key: string;
    title: string;
    kind: ReportSourceKind;
    /** Backend path WITHOUT the query. */
    path: string;
    /** The MIS descriptor, for paging and for which array is the table. */
    def: MisReportDef | null;
    /** True when this report honours ?day_close. */
    tradingDay: boolean;
}

/** Where one emailable report's file comes from, or null when we cannot make it. */
export function reportSource(key: string): ReportSource | null {
    const def = reportDef(key);
    if (def) {
        return { key, title: def.title, kind: "mis", path: def.path, def, tradingDay: true };
    }
    const accounting = Object.prototype.hasOwnProperty.call(ACCOUNTING, key) ? ACCOUNTING[key] : undefined;
    if (!accounting) { return null; }
    return {
        key,
        title: accounting.title,
        kind: accounting.csvRoute ? "csv" : "pnl",
        path: accounting.path,
        def: null,
        tradingDay: false,
    };
}

export const reportMailTitle = (key: string): string => reportSource(key)?.title ?? key;

// --- Files ---------------------------------------------------------------------

const slug = (text: string): string => text.trim().replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();

/** `sales-summary_outlet_2026-09-01_to_2026-09-02` — no extension. */
export function reportFileBase(key: string, from: string, to: string, allOutlets: boolean): string {
    const scope = allOutlets ? "all-outlets" : "outlet";
    const window = from === to ? from : `${from}_to_${to}`;
    return `${slug(key)}_${scope}_${window}`;
}

/** A workbook sheet name: Excel's 31 characters, none of its forbidden ones, unique. */
export function sheetNameFor(title: string, taken: readonly string[]): string {
    const clean = title.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim() || "Report";
    let name = clean.slice(0, 31);
    let n = 2;
    while (taken.includes(name)) {
        const suffix = ` (${String(n)})`;
        name = `${clean.slice(0, 31 - suffix.length)}${suffix}`;
        n += 1;
    }
    return name;
}

export type CsvCell = string | number | null;

const csvCell = (value: CsvCell): string => {
    const text = value === null ? "" : typeof value === "number" ? String(value) : value;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** A CSV with the byte-order mark Excel wants, like lib/mis-reports' own toCsv. */
export const csvOf = (header: readonly string[], rows: readonly (readonly CsvCell[])[]): string => {
    const lines = [header.map((h) => csvCell(h)).join(",")];
    for (const row of rows) { lines.push(row.map((c) => csvCell(c)).join(",")); }
    return `\uFEFF${lines.join("\r\n")}\r\n`;
};

/**
 * The P&L as a sheet. The restaurant server has no `/reports/pnl.csv`, and its
 * own emailed P&L is rendered from the same payload in the same seven lines
 * plus the expense categories (Restaurant_Backend/report_render.ts) — mirrored
 * here so the two files say the same thing in the same order.
 */
export function pnlCsv(payload: unknown): string {
    const p = (payload ?? {}) as Record<string, unknown>;
    const num = (v: unknown): number => {
        const n = Number(v ?? 0);
        return Number.isFinite(n) ? n : 0;
    };
    const rows: CsvCell[][] = [
        ["Gross sales", num(p.gross_sales)],
        ["Refunds", num(p.refunds)],
        ["Tax collected", num(p.tax_collected)],
        ["Service charge", num(p.service_charge)],
        ["Revenue ex-tax (after refunds)", num(p.net_revenue)],
        ["Total expenses", num(p.total_expenses)],
        ["Net profit", num(p.net_profit)],
    ];
    const byCategory = Array.isArray(p.expenses_by_category) ? p.expenses_by_category : [];
    for (const raw of byCategory) {
        if (raw === null || typeof raw !== "object") { continue; }
        const e = raw as Record<string, unknown>;
        rows.push([`Expense — ${typeof e.category === "string" ? e.category : ""}`, num(e.amount)]);
    }
    return csvOf(["Line", "Amount"], rows);
}

/** One MIS report's sheet: every column the server serves, its totals row last. */
export function misCsv(payload: MisReportPayload, rows: readonly MisRow[], cut: boolean): string {
    const columns: MisColumn[] = Array.isArray(payload.columns) ? payload.columns : [];
    // A paged report's totals cover the WHOLE window while the body may not, and
    // an export whose rows do not add up to its own total, with nothing saying
    // why, is the document that destroys confidence in the other seventeen.
    const label = cut ? `Total (whole window; first ${String(rows.length)} rows attached)` : "Total";
    return toCsv(buildExportMatrix(columns, rows, payload.totals ?? null, label));
}

export const rowsFrom = (payload: MisReportPayload, def: MisReportDef): MisRow[] => rowsOf(payload, def);

// --- Before anything is sent ------------------------------------------------------

export interface WebSendRequest {
    reportKeys: string[];
    formats: string[];
    from: string;
    to: string;
    /** "HH:mm" for a trading day, or "" for calendar days. */
    dayClose: string;
    allOutlets: boolean;
    recipientIds: string[];
}

/** A day key, with its parts — this module both checks and reads them. */
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Why this send cannot go, in the sender's words — or null when it can. */
export function webSendProblem(r: WebSendRequest, addressCount: number): string | null {
    const keys = r.reportKeys.filter((k) => reportSource(k) !== null);
    if (keys.length === 0) { return "Pick at least one report to send."; }
    const formats = r.formats.filter((f) => f === "xlsx" || f === "csv");
    if (formats.length === 0) { return "Choose Excel, CSV or both."; }
    if (!DAY.test(r.from) || !DAY.test(r.to) || r.from > r.to) { return "Pick the days to send."; }
    if (r.dayClose !== "" && !/^\d{1,2}:\d{2}$/.test(r.dayClose)) {
        return "Write the closing time as HH:mm, or leave it empty for calendar days.";
    }
    if (r.dayClose !== "") {
        const blocked = keys.filter((k) => CALENDAR_ONLY_MAIL_KEYS.includes(k)).map((k) => reportMailTitle(k));
        if (blocked.length > 0) {
            const them = blocked.length > 1 ? "them" : "it";
            return `${blocked.join(" and ")} can only be sent for calendar days. Turn the closing time off, or leave ${them} out.`;
        }
    }
    if (addressCount === 0) { return "Choose at least one address from the address book."; }
    if (addressCount > WEB_SEND_MAX_RECIPIENTS) {
        return `Choose at most ${String(WEB_SEND_MAX_RECIPIENTS)} addresses.`;
    }
    return null;
}

// --- What the message says ----------------------------------------------------------

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Wed 17 Sep 2026". Own month names: ICU's have changed between Node versions. */
export function dayLabel(key: string): string {
    const m = DAY.exec(key);
    if (!m) { return key; }
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return `${WEEKDAYS[d.getUTCDay()]} ${String(Number(m[3]))} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** "Wed 17 Sep 2026", "1 Sep – 15 Sep 2026", or both years in full across one. */
export function periodLabel(from: string, to: string): string {
    if (from === to) { return dayLabel(from); }
    const a = dayLabel(from).split(" ");
    const b = dayLabel(to).split(" ");
    if (a.length < 4 || b.length < 4) { return `${from} – ${to}`; }
    return a[3] === b[3] ? `${a[1]} ${a[2]} – ${b[1]} ${b[2]} ${b[3]}` : `${a.slice(1).join(" ")} – ${b.slice(1).join(" ")}`;
}

/** Tenant text is not trusted in a header: one line, no controls, bounded. */
export function cleanName(raw: string, max = 60): string {
    // eslint-disable-next-line no-control-regex -- stripping the controls is the point.
    const flat = raw.replace(/[ -]+/g, " ").replace(/\s+/g, " ").trim();
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export interface SentFile {
    filename: string;
    /** What it holds, in words: "Sales Summary, 42 rows" or "every report, one sheet each". */
    description: string;
    bytes: number;
}

export interface ReportMessageInput {
    restaurantName: string;
    byName: string;
    reportKeys: string[];
    from: string;
    to: string;
    dayClose: string;
    allOutlets: boolean;
    files: SentFile[];
    /** An ISO instant and the restaurant's zone, for the "sent at" line. */
    sentAt: string;
    timezone: string;
}

const listPhrase = (keys: string[]): string => {
    const titles = keys.map((k) => reportMailTitle(k));
    if (titles.length === 0) { return "Reports"; }
    if (titles.length === 1) { return titles[0]; }
    if (titles.length === 2) { return `${titles[0]} and ${titles[1]}`; }
    return `${titles[0]}, ${titles[1]} and ${String(titles.length - 2)} more`;
};

/** An instant on the restaurant's wall clock: "17 Sep 2026, 21:05". */
export function wallClockLabel(iso: string, timezone: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) { return iso; }
    try {
        const parts = new Intl.DateTimeFormat("en-GB", {
            timeZone: timezone,
            day: "numeric",
            month: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        }).formatToParts(d);
        const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
        const month = MONTHS[Number(get("month")) - 1] ?? get("month");
        return `${String(Number(get("day")))} ${month} ${get("year")}, ${get("hour")}:${get("minute")}`;
    } catch {
        return iso;
    }
}

export const humanBytes = (bytes: number): string =>
    bytes >= 1024 * 1024
        ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
        : `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;

/** Subject and body. Never a figure in the subject — it is read on lock screens. */
export function buildReportsMessage(i: ReportMessageInput): { subject: string; text: string } {
    const who = cleanName(i.restaurantName) || "Your restaurant";
    const where = i.allOutlets ? " · All outlets" : "";
    const what = i.reportKeys.length === 1 ? listPhrase(i.reportKeys) : i.from === i.to ? "Daily reports" : "Reports";
    const subject = `${who}${where} — ${what} — ${periodLabel(i.from, i.to)}`;
    const lines = [
        listPhrase(i.reportKeys),
        `${who}${where}`,
        periodLabel(i.from, i.to),
        "",
        i.dayClose === ""
            ? `Calendar ${i.from === i.to ? "day" : "days"}, midnight to midnight (${i.timezone}).`
            : `Trading ${i.from === i.to ? "day" : "days"} closing at ${i.dayClose} (${i.timezone}).`,
        "",
        i.files.length === 1 ? "Attached: 1 file." : `Attached: ${String(i.files.length)} files.`,
        ...i.files.map((f) => `  ${f.filename} — ${f.description}, ${humanBytes(f.bytes)}`),
        "",
        `Sent from the dashboard by ${cleanName(i.byName) || "a signed-in user"} on ${wallClockLabel(i.sentAt, i.timezone)}.`,
        WEB_MAIL_SENT_NOTE,
    ];
    return { subject, text: `${lines.join("\n")}\n` };
}

// --- What came of it -----------------------------------------------------------------

export interface WebSendFailure { email: string; message: string }

export interface WebSendResult {
    ok: boolean;
    title: string;
    description: string;
    sent: string[];
    failed: WebSendFailure[];
    /** Set when nothing was attempted: the reason, in one sentence. */
    refusal: string;
}

export const refusedWebSend = (refusal: string): WebSendResult =>
    ({ ok: false, title: "Couldn't send", description: refusal, sent: [], failed: [], refusal });

/** One outcome sentence for however the addresses went. */
export function webSendOutcome(sent: string[], failed: WebSendFailure[]): WebSendResult {
    const n = sent.length;
    const why = failed.map((f) => `${f.email}: ${f.message}`).join(" ");
    if (n > 0 && failed.length === 0) {
        return {
            ok: true,
            title: `Sent to ${String(n)} address${n === 1 ? "" : "es"}`,
            description: `${WEB_MAIL_SENT_NOTE} Check the spam folder if it does not arrive.`,
            sent,
            failed,
            refusal: "",
        };
    }
    if (n > 0) {
        return {
            ok: true,
            title: `Sent to ${String(n)} of ${String(n + failed.length)} addresses`,
            description: why,
            sent,
            failed,
            refusal: "",
        };
    }
    return {
        ok: false,
        title: "Couldn't send",
        description: why === "" ? "Nothing was sent." : why,
        sent,
        failed,
        refusal: "",
    };
}

// --- The status the screens read ------------------------------------------------------

export interface WebMailStatus {
    /** True when THIS app can send mail for this restaurant right now. */
    ready: boolean;
    /** The From address it would send as, for the screen to name. */
    from: string;
    /** Why not, when it cannot — a sentence, or "". */
    reason: string;
}

export const webMailUnknown = (): WebMailStatus => ({ ready: false, from: "", reason: "" });
