// THE SEND. Server-only: imported from the "use server" module in
// lib/api/mail-settings.ts and from nowhere a browser bundle can reach.
//
// Bounded three ways, for the reasons Restaurant_Backend/mailer.ts sets out at
// length and which apply here word for word: nodemailer's own socket timeouts,
// a hard race around the whole send (the hangs that matter happen ABOVE the
// socket — a retry loop, a DNS resolver, a pool), and pool: false so no socket
// or timer outlives the call. A Server Action that never settles is a request
// that never answers, and the person is left looking at a spinner.
//
// It never reports a success it did not get. Every failure comes back as a
// sentence about what to change.

import { randomUUID } from "node:crypto";

import { addressOf, effectiveFrom, mailSettingsProblem, type MailSettings } from "@/lib/mail-settings";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailSendResult {
  ok: boolean;
  message: string;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** nodemailer/undici error codes, in the words of the thing to fix. */
function sentenceFor(error: unknown): string {
  const e = error as { code?: unknown; responseCode?: unknown; message?: unknown } | null;
  const code = typeof e?.code === "string" ? e.code : "";
  const raw = typeof e?.message === "string" && e.message !== "" ? e.message : String(error);
  switch (code) {
    case "EAUTH":
      return `The mail server refused the sign-in — check the username and password. (${raw})`;
    case "ENOTFOUND":
    case "EDNS":
      return `No mail server answers at that address — check the host. (${raw})`;
    case "ECONNREFUSED":
      return `The mail server refused the connection — check the host and port. (${raw})`;
    case "ETIMEDOUT":
    case "ESOCKET":
    case "ECONNECTION":
      return `Couldn't reach the mail server — check the host, the port and whether this server is allowed out on it. (${raw})`;
    case "EENVELOPE":
      return `The mail server refused the addresses — check the From and the recipient. (${raw})`;
    default:
      return raw;
  }
}

/** A promise that loses the race after `ms`, and cleans its timer up either way. */
async function bounded<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new Error(`${what} did not finish within ${String(ms)}ms.`)); }, ms);
  });
  try {
    return await Promise.race([work, bound]);
  } finally {
    if (timer !== undefined) { clearTimeout(timer); }
  }
}

async function sendSmtp(s: MailSettings, msg: MailMessage, from: string): Promise<MailSendResult> {
  const { default: nodemailer } = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: s.user !== "" ? { user: s.user, pass: s.pass } : undefined,
    // No pool: it is nodemailer's default and the one we want. A pooled
    // transport keeps sockets and timers alive between sends, and there is
    // nothing to gain from that here beyond a handle that outlives the call.
    connectionTimeout: s.timeoutMs,
    greetingTimeout: s.timeoutMs,
    socketTimeout: s.timeoutMs,
  });
  try {
    const info = await bounded(
      transporter.sendMail({ from, to: msg.to, subject: msg.subject, text: msg.text }),
      s.timeoutMs,
      "The mail server",
    );
    const id = typeof info.messageId === "string" ? info.messageId : "";
    return { ok: true, message: id === "" ? `Sent to ${msg.to}.` : `Sent to ${msg.to} (${id}).` };
  } catch (error) {
    return { ok: false, message: sentenceFor(error) };
  } finally {
    transporter.close();
  }
}

async function sendResend(s: MailSettings, msg: MailMessage, from: string): Promise<MailSendResult> {
  const endpoint = (process.env.RESEND_API_URL ?? "").trim() || RESEND_ENDPOINT;
  try {
    const res = await bounded(
      fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${s.resendApiKey}`,
          "Content-Type": "application/json",
          // A retried request must not mail twice.
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({ from, to: [addressOf(msg.to)], subject: msg.subject, text: msg.text }),
        cache: "no-store",
      }),
      s.timeoutMs,
      "Resend",
    );
    if (!res.ok) {
      let detail = "";
      try {
        const body = (await res.json()) as Record<string, unknown>;
        detail = typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "";
      } catch { /* not JSON */ }
      return {
        ok: false,
        message: detail !== ""
          ? `Resend refused the message: ${detail}`
          : `Resend refused the message (HTTP ${String(res.status)}).`,
      };
    }
    return { ok: true, message: `Sent to ${msg.to}.` };
  } catch (error) {
    return { ok: false, message: sentenceFor(error) };
  }
}

/**
 * Send one message with these settings. Refuses before it opens anything when
 * the settings cannot work, so the reason names a field rather than a socket.
 */
export async function sendWithSettings(s: MailSettings, msg: MailMessage): Promise<MailSendResult> {
  const production = process.env.NODE_ENV === "production";
  const problem = mailSettingsProblem(s, { production });
  if (problem !== null) { return { ok: false, message: problem }; }
  if (s.transport === "off") {
    return { ok: false, message: "Email is switched off here — pick a transport above and save it first." };
  }
  const from = effectiveFrom(s);
  if (s.transport === "log") {
    // Development only (mailSettingsProblem refuses it in production): what
    // WOULD have gone, and nobody is contacted.
    console.warn("[mail:log] would send", {
      to: addressOf(msg.to),
      from: addressOf(from),
      subject: msg.subject,
      bytes: msg.text.length,
    });
    return { ok: false, message: "Nothing was sent: the transport is “Log only”, which writes to the server log and contacts nobody." };
  }
  return s.transport === "smtp" ? sendSmtp(s, msg, from) : sendResend(s, msg, from);
}
