"use server";

// SENDING REPORTS FROM THIS WEB APP. Three Server Actions: is this app able to
// send, send these reports, send a test.
//
// The restaurant server owns Email reports, and when ITS environment carries no
// mail transport it refuses every send — which is what "Email is not set up on
// this server" means, and why saving Settings → Email did not change it. These
// actions are the fallback: the reports are read from the same server with the
// signed-in person's OWN token (so the accounting permission that guards a
// report still guards emailing it), the files are built here, the addresses can
// only be ones already in the server's address book, and the message goes out
// through the transport the owner saved for this restaurant.
//
// What it does not do: it does not write to the restaurant server, it does not
// appear in the delivery History, and it does not retry. lib/report-mail.ts
// says so on the screen and in the email rather than leaving it to be found.

import { requestBackend } from "@/lib/db";
import { mailSettingsFor } from "@/lib/api/mail-settings";
import { buildTestMessage, mailConfigured, mailSettingsProblem, effectiveFrom } from "@/lib/mail-settings";
import { sendWithSettings, type MailAttachment } from "@/lib/mail-transport";
import { buildExportMatrix, type MisReportPayload, type MisRow } from "@/lib/mis-reports";
import { ALL_OUTLETS } from "@/lib/outlet";
import {
  WEB_MAIL_NO_SERVER,
  WEB_MAIL_OFF_SENTENCE,
  WEB_MAIL_SIGN_IN_AGAIN,
  WEB_SEND_MAX_BYTES,
  WEB_SEND_PAGE,
  WEB_SEND_ROW_CAP,
  buildReportsMessage,
  humanBytes,
  misCsv,
  pnlCsv,
  refusedWebSend,
  reportFileBase,
  reportSource,
  rowsFrom,
  sheetNameFor,
  webSendOutcome,
  webSendProblem,
  type SentFile,
  type WebMailStatus,
  type WebSendFailure,
  type WebSendRequest,
  type WebSendResult,
} from "@/lib/report-mail";

interface Me {
  restaurantId: string;
  restaurantName: string;
  byName: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Who this session is, according to the restaurant server. Same reasoning as
 * the mail settings gate: the cookie is a hint, the token is the proof, and
 * /auth/me recomputes identity from the verified session.
 */
async function whoAmI(): Promise<{ me: Me } | { refusal: string }> {
  const res = await requestBackend<Record<string, unknown>>({ path: "/auth/me", method: "GET" });
  if (res.status === 0) { return { refusal: WEB_MAIL_NO_SERVER }; }
  if (!res.ok || res.data === null) { return { refusal: WEB_MAIL_SIGN_IN_AGAIN }; }
  const me = res.data;
  const restaurantId = str(me.restaurantUsername) || str(me.res_id);
  if (restaurantId === "") { return { refusal: WEB_MAIL_SIGN_IN_AGAIN }; }
  const byName = [str(me.emp_Fname), str(me.emp_Lname)].filter((p) => p !== "").join(" ") || str(me.employeeUsername);
  return { me: { restaurantId, restaurantName: str(me.restaurantName) || restaurantId, byName } };
}

/** Can THIS app send mail for the signed-in restaurant right now? */
export async function reportMailStatus(): Promise<WebMailStatus> {
  const who = await whoAmI();
  if ("refusal" in who) { return { ready: false, from: "", reason: who.refusal }; }
  const settings = await mailSettingsFor(who.me.restaurantId);
  const production = process.env.NODE_ENV === "production";
  if (settings.transport === "off") { return { ready: false, from: "", reason: "" }; }
  const problem = mailSettingsProblem(settings, { production });
  if (problem !== null) { return { ready: false, from: effectiveFrom(settings), reason: problem }; }
  return { ready: mailConfigured(settings, { production }), from: effectiveFrom(settings), reason: "" };
}

// --- The address book --------------------------------------------------------------

interface Address { id: string; email: string }

/**
 * The server's own address book. Resolving ids HERE rather than trusting an
 * address from the browser is what keeps this from becoming a way to mail a
 * restaurant's takings anywhere: only what an admin already put on that list
 * can be chosen, and a suppressed address is not on it.
 */
async function addressBook(): Promise<Address[] | null> {
  const res = await requestBackend<Record<string, unknown>>({ path: "/reports/email/recipients", method: "GET" });
  if (!res.ok || res.data === null) { return null; }
  const rows = res.data.recipients;
  if (!Array.isArray(rows)) { return null; }
  const out: Address[] = [];
  for (const raw of rows) {
    if (raw === null || typeof raw !== "object") { continue; }
    const r = raw as Record<string, unknown>;
    const id = str(r.id);
    const email = str(r.email);
    if (id === "" || email === "" || r.status === "suppressed") { continue; }
    out.push({ id, email });
  }
  return out;
}

// --- The files ----------------------------------------------------------------------

type Cell = string | number | null;

interface ReportFile {
  key: string;
  title: string;
  csv: string;
  /** The table as a rectangle, when we have one; null means parse the CSV. */
  aoa: Cell[][] | null;
  rows: number;
  cut: boolean;
}

const query = (parts: Record<string, string | undefined>): string => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(parts)) {
    if (v !== undefined && v !== "") { qs.set(k, v); }
  }
  return qs.toString();
};

const countRows = (csv: string): number => Math.max(0, csv.trim().split(/\r?\n/).length - 1);

/** One report's file, or the sentence saying why it could not be built. */
async function buildReportFile(
  key: string,
  r: WebSendRequest,
  restaurantId: string,
): Promise<{ file: ReportFile } | { error: string }> {
  const src = reportSource(key);
  if (src === null) { return { error: `${key} is not a report this app can email.` }; }
  // The same sentinel the Reports screen reads an all-outlets report with, so
  // an emailed combined report is the combined report on screen.
  const outletId = r.allOutlets ? ALL_OUTLETS : undefined;
  const base = { restaurantId, from: r.from, to: r.to };

  if (src.kind === "mis" && src.def !== null) {
    const def = src.def;
    const gathered: MisRow[] = [];
    let last: MisReportPayload | null = null;
    let total: number | null = null;
    for (let offset = 0; ; offset += WEB_SEND_PAGE) {
      const qs = query({
        ...base,
        day_close: r.dayClose === "" ? undefined : r.dayClose,
        ...(def.paged ? { limit: String(WEB_SEND_PAGE), offset: String(offset) } : {}),
      });
      const res = await requestBackend<MisReportPayload>({ path: `${def.path}?${qs}`, method: "GET", outletId });
      if (res.status === 0) { return { error: WEB_MAIL_NO_SERVER }; }
      if (!res.ok || res.data === null) {
        return { error: `${src.title}: ${res.text.trim() === "" ? "the server refused this report." : res.text.slice(0, 160)}` };
      }
      last = res.data;
      const batch = rowsFrom(res.data, def);
      gathered.push(...batch);
      total = typeof res.data.page?.total === "number" ? res.data.page.total : null;
      const more = def.paged && batch.length === WEB_SEND_PAGE && gathered.length < WEB_SEND_ROW_CAP
        && (total === null || gathered.length < total);
      if (!more) { break; }
    }
    // The loop above runs at least once, so `last` is the newest page it read.
    const rows = gathered.slice(0, WEB_SEND_ROW_CAP);
    const cut = total !== null && rows.length < total;
    const matrix = buildExportMatrix(
      Array.isArray(last.columns) ? last.columns : [],
      rows,
      last.totals ?? null,
      cut ? `Total (whole window; first ${String(rows.length)} rows attached)` : "Total",
    );
    return {
      file: {
        key,
        title: src.title,
        csv: misCsv(last, rows, cut),
        aoa: [matrix.header, ...matrix.body, ...(matrix.totals ? [matrix.totals] : [])],
        rows: rows.length,
        cut,
      },
    };
  }

  if (src.kind === "csv") {
    const res = await requestBackend({ path: `${src.path}?${query(base)}`, method: "GET", outletId, parseJson: false });
    if (res.status === 0) { return { error: WEB_MAIL_NO_SERVER }; }
    if (!res.ok) { return { error: `${src.title}: the server refused this report.` }; }
    return { file: { key, title: src.title, csv: res.text, aoa: null, rows: countRows(res.text), cut: false } };
  }

  const res = await requestBackend<Record<string, unknown>>({ path: `${src.path}?${query(base)}`, method: "GET", outletId });
  if (res.status === 0) { return { error: WEB_MAIL_NO_SERVER }; }
  if (!res.ok || res.data === null) { return { error: `${src.title}: the server refused this report.` }; }
  const csv = pnlCsv(res.data);
  return { file: { key, title: src.title, csv, aoa: null, rows: countRows(csv), cut: false } };
}

/** Every report in one workbook, a sheet each — the app's "Excel workbook". */
async function workbookOf(files: readonly ReportFile[]): Promise<Buffer> {
  const XLSX = await import("xlsx");
  const book = XLSX.utils.book_new();
  const taken: string[] = [];
  for (const f of files) {
    const sheet = f.aoa !== null
      ? XLSX.utils.aoa_to_sheet(f.aoa)
      // The accounting routes answer CSV, not rows: let the same library read
      // it back rather than writing a second CSV parser to disagree with it.
      : XLSX.read(f.csv.replace(/^\uFEFF/, ""), { type: "string" }).Sheets.Sheet1;
    const name = sheetNameFor(f.title, taken);
    taken.push(name);
    XLSX.utils.book_append_sheet(book, sheet, name);
  }
  const written = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
  return Buffer.from(written);
}

// --- Send now ---------------------------------------------------------------------------

/**
 * Build the chosen reports and email them through this app's transport. Every
 * check the restaurant server would make is made here too, because this path
 * does not go through it: who you are, what you may read, which addresses
 * exist, and whether the settings can send at all.
 */
export async function sendReportsFromWebApp(request: WebSendRequest, timezone: string): Promise<WebSendResult> {
  const who = await whoAmI();
  if ("refusal" in who) { return refusedWebSend(who.refusal); }
  const { me } = who;

  const settings = await mailSettingsFor(me.restaurantId);
  const production = process.env.NODE_ENV === "production";
  if (!mailConfigured(settings, { production })) {
    return refusedWebSend(mailSettingsProblem(settings, { production }) ?? WEB_MAIL_OFF_SENTENCE);
  }

  const book = await addressBook();
  if (book === null) { return refusedWebSend("Couldn't read the address book, so nothing has been sent."); }
  const wanted = [...new Set(request.recipientIds)];
  const addresses = wanted.map((id) => book.find((b) => b.id === id)?.email ?? "").filter((e) => e !== "");
  if (addresses.length < wanted.length) {
    return refusedWebSend("One of the chosen addresses is no longer in the address book. Reload and pick again.");
  }

  const problem = webSendProblem(request, addresses.length);
  if (problem !== null) { return refusedWebSend(problem); }

  const built: ReportFile[] = [];
  for (const key of request.reportKeys) {
    const one = await buildReportFile(key, request, me.restaurantId);
    if ("error" in one) { return refusedWebSend(one.error); }
    built.push(one.file);
  }

  const attachments: MailAttachment[] = [];
  const summary: SentFile[] = [];
  const window = reportFileBase("reports", request.from, request.to, request.allOutlets);
  if (request.formats.includes("xlsx")) {
    const bytes = await workbookOf(built);
    const filename = `${window}.xlsx`;
    attachments.push({
      filename,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      content: bytes,
    });
    summary.push({ filename, description: "every report, one sheet each", bytes: bytes.byteLength });
  }
  if (request.formats.includes("csv")) {
    for (const f of built) {
      const filename = `${reportFileBase(f.key, request.from, request.to, request.allOutlets)}.csv`;
      const content = Buffer.from(f.csv, "utf8");
      attachments.push({ filename, contentType: "text/csv; charset=utf-8", content });
      summary.push({
        filename,
        description: `${f.title}, ${String(f.rows)} row${f.rows === 1 ? "" : "s"}${f.cut ? " (cut short — the sheet says so)" : ""}`,
        bytes: content.byteLength,
      });
    }
  }

  const total = attachments.reduce((sum, a) => sum + a.content.byteLength, 0);
  if (total > WEB_SEND_MAX_BYTES) {
    return refusedWebSend(
      `These files come to ${humanBytes(total)}, which most mail servers refuse. Send fewer reports, fewer days, or only one format.`,
    );
  }

  const message = buildReportsMessage({
    restaurantName: me.restaurantName,
    byName: me.byName,
    reportKeys: request.reportKeys,
    from: request.from,
    to: request.to,
    dayClose: request.dayClose,
    allOutlets: request.allOutlets,
    files: summary,
    sentAt: new Date().toISOString(),
    timezone: timezone.trim() === "" ? "UTC" : timezone.trim(),
  });

  // One message per address: an address book is not a mailing list, and the
  // people on it have no business reading each other's addresses.
  const sent: string[] = [];
  const failed: WebSendFailure[] = [];
  for (const email of addresses) {
    const result = await sendWithSettings(settings, {
      to: email,
      subject: message.subject,
      text: message.text,
      attachments,
    });
    if (result.ok) { sent.push(email); } else { failed.push({ email, message: result.message }); }
  }
  return webSendOutcome(sent, failed);
}

/** A test message to one address already in the server's address book. */
export async function sendWebTestMail(recipientId: string): Promise<WebSendResult> {
  const who = await whoAmI();
  if ("refusal" in who) { return refusedWebSend(who.refusal); }
  const { me } = who;
  const settings = await mailSettingsFor(me.restaurantId);
  const production = process.env.NODE_ENV === "production";
  if (!mailConfigured(settings, { production })) {
    return refusedWebSend(mailSettingsProblem(settings, { production }) ?? WEB_MAIL_OFF_SENTENCE);
  }
  const book = await addressBook();
  const email = book?.find((b) => b.id === recipientId.trim())?.email ?? "";
  if (email === "") { return refusedWebSend("That address is no longer in the address book."); }
  const message = buildTestMessage({ restaurantName: me.restaurantName, byName: me.byName });
  const result = await sendWithSettings(settings, { to: email, subject: message.subject, text: message.text });
  return result.ok
    ? webSendOutcome([email], [])
    : webSendOutcome([], [{ email, message: result.message }]);
}
