// MAIL SETTINGS — this app's own mail transport, set up from the Settings page
// by the owner (or the platform super admin) instead of by whoever has a shell
// on the server.
//
// WHY THE WEB APP HOLDS ITS OWN. The restaurant server decides its transport
// from ITS environment (Restaurant_Backend/mailer.ts reads SMTP_* /
// MAIL_TRANSPORT per send) and exposes no route that writes it — deliberately,
// because an SMTP password is an operator credential and not tenant data. This
// module changes nothing there. It gives THIS app a transport of its own, held
// next to it and never in the tenants table, so "Email is not set up on this
// server" is something an owner can fix on the Settings page: the test mail and
// anything the dashboard sends itself go through it.
//
// SCHEDULED report emails still run inside the restaurant server, on its own
// clock, and still read its environment — so the card also prints the exact env
// lines for it (never the secrets, which the person typing them already has).
//
// Pure: shapes, rules and words only. The file store, the session gate and the
// send live in lib/api/mail-settings.ts and lib/mail-transport.ts.

/** The four the restaurant server knows, same words, same meanings. */
export type MailTransportKind = "smtp" | "resend" | "log" | "off";

export interface MailSettings {
  transport: MailTransportKind;
  host: string;
  port: number;
  /** Implicit TLS. Always true on 465, which is why the field follows the port. */
  secure: boolean;
  user: string;
  /** Secret. Stored on the server, never sent to a browser. */
  pass: string;
  /** `Name <addr@host>` or a bare address. */
  from: string;
  /** Secret. Stored on the server, never sent to a browser. */
  resendApiKey: string;
  timeoutMs: number;
}

/** What is on disk: the settings plus who last wrote them. */
export interface StoredMailSettings extends MailSettings {
  updatedAt: string;
  updatedBy: string;
}

/** What a browser is allowed to read back: no password, no API key. */
export interface MailSettingsView {
  transport: MailTransportKind;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  hasPassword: boolean;
  hasResendKey: boolean;
  updatedAt: string;
  updatedBy: string;
}

/**
 * What the card sends back. A secret is `null` when it was left untouched —
 * the field shows dots, so an edit of the host must not blank the password.
 * `""` is a deliberate erase.
 */
export interface MailSettingsEdit {
  transport: MailTransportKind;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  pass: string | null;
  resendApiKey: string | null;
  timeoutMs?: number;
}

export const DEFAULT_MAIL_TIMEOUT_MS = 20_000;

export const EMPTY_MAIL_SETTINGS: MailSettings = {
  transport: "off",
  host: "",
  port: 587,
  secure: false,
  user: "",
  pass: "",
  from: "",
  resendApiKey: "",
  timeoutMs: DEFAULT_MAIL_TIMEOUT_MS,
};

export const MAIL_TRANSPORT_KINDS: MailTransportKind[] = ["smtp", "resend", "log", "off"];

export const TRANSPORT_LABELS: Record<MailTransportKind, string> = {
  smtp: "SMTP server",
  resend: "Resend (HTTPS API)",
  log: "Log only (testing)",
  off: "Off — don't send email",
};

export const TRANSPORT_CAPTIONS: Record<MailTransportKind, string> = {
  smtp: "A mailbox on a mail server — Gmail, Zoho, your host's. Port 465 is implicit TLS; 587 and 25 upgrade with STARTTLS.",
  resend: "For a server whose provider blocks outbound mail ports. Needs a Resend API key and a verified From address.",
  log: "Writes what would have been sent to the server log and contacts nobody. For trying the screens out; refused in production.",
  off: "Nothing is emailed from this app. Reports can still be downloaded.",
};

const trimmed = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const isKind = (v: unknown): v is MailTransportKind =>
  typeof v === "string" && (MAIL_TRANSPORT_KINDS as string[]).includes(v);

const asNumber = (v: unknown): number =>
  typeof v === "number" ? v : typeof v === "string" ? Number.parseInt(v, 10) : Number.NaN;

const toPort = (v: unknown, fallback: number): number => {
  const n = asNumber(v);
  return Number.isFinite(n) && n >= 1 && n <= 65535 ? Math.trunc(n) : fallback;
};

const toTimeout = (v: unknown): number => {
  const n = asNumber(v);
  // The floor is not politeness: every send is raced against this, and a value
  // of zero would make a healthy server look like a dead one.
  return Number.isFinite(n) && n >= 1000 && n <= 120_000 ? Math.trunc(n) : DEFAULT_MAIL_TIMEOUT_MS;
};

/** The bare address inside `Name <addr>`, or the string itself. */
export function addressOf(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1] : from).trim();
}

export function looksLikeEmail(value: string): boolean {
  const a = addressOf(value);
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(a);
}

/** Whatever JSON was on disk (or came from a form), coerced into the shape. */
export function normalizeMailSettings(raw: unknown): MailSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const port = toPort(r.port, EMPTY_MAIL_SETTINGS.port);
  return {
    transport: isKind(r.transport) ? r.transport : "off",
    host: trimmed(r.host),
    // 465 is implicit TLS whatever the box says, exactly as the restaurant
    // server derives it — one less way to configure a silent failure.
    secure: port === 465 ? true : r.secure === true,
    port,
    user: trimmed(r.user),
    pass: typeof r.pass === "string" ? r.pass : "",
    from: trimmed(r.from),
    resendApiKey: typeof r.resendApiKey === "string" ? r.resendApiKey.trim() : "",
    timeoutMs: toTimeout(r.timeoutMs),
  };
}

/** SMTP may take its From from the username, like the restaurant server does. */
export function effectiveFrom(s: MailSettings): string {
  const from = s.from.trim();
  if (from !== "") { return from; }
  return s.transport === "smtp" ? s.user.trim() : "";
}

/**
 * Why these settings cannot send, in the operator's words — or null when they
 * can. Checked before a save so nothing unusable is ever stored, and again
 * before a send.
 */
export function mailSettingsProblem(s: MailSettings, opts?: { production?: boolean }): string | null {
  const from = effectiveFrom(s);
  switch (s.transport) {
    case "off":
      return null;
    case "log":
      return opts?.production === true
        ? "Log only is refused in production: it would record mail as sent that nobody received."
        : null;
    case "smtp": {
      if (s.host === "") { return "Enter the mail server's address (for example smtp.gmail.com)."; }
      if (s.port < 1 || s.port > 65535) { return "The port must be between 1 and 65535."; }
      if (from === "") { return "Enter the From address the mail is sent as."; }
      if (!looksLikeEmail(from)) { return "The From address needs to be an email address."; }
      if (s.user !== "" && s.pass === "") { return "Enter the password for the mail account (or clear the username)."; }
      return null;
    }
    case "resend": {
      if (s.resendApiKey === "") { return "Enter the Resend API key."; }
      if (from === "") { return "Enter the From address the mail is sent as."; }
      if (!looksLikeEmail(from)) { return "The From address needs to be an email address."; }
      return null;
    }
  }
}

/** Is this transport set up well enough to send anything at all? */
export function mailConfigured(s: MailSettings, opts?: { production?: boolean }): boolean {
  return s.transport !== "off" && mailSettingsProblem(s, opts) === null;
}

export function redactMailSettings(s: StoredMailSettings): MailSettingsView {
  return {
    transport: s.transport,
    host: s.host,
    port: s.port,
    secure: s.secure,
    user: s.user,
    from: s.from,
    hasPassword: s.pass !== "",
    hasResendKey: s.resendApiKey !== "",
    updatedAt: s.updatedAt,
    updatedBy: s.updatedBy,
  };
}

/** An edit, over what is stored: `null` secrets keep the stored ones. */
export function mergeMailEdit(current: MailSettings, edit: MailSettingsEdit): MailSettings {
  return normalizeMailSettings({
    transport: edit.transport,
    host: edit.host,
    port: edit.port,
    secure: edit.secure,
    user: edit.user,
    from: edit.from,
    pass: edit.pass ?? current.pass,
    resendApiKey: edit.resendApiKey ?? current.resendApiKey,
    timeoutMs: edit.timeoutMs ?? current.timeoutMs,
  });
}

/**
 * The lines the RESTAURANT SERVER needs in its environment for the scheduled
 * reports it sends on its own clock. Secrets are named, never printed: the
 * person reading this is the person who just typed them.
 */
export function mailEnvLines(s: MailSettings): string[] {
  const from = effectiveFrom(s);
  switch (s.transport) {
    case "off":
      return ["MAIL_TRANSPORT=off"];
    case "log":
      return ["MAIL_TRANSPORT=log"];
    case "resend":
      return [
        "MAIL_TRANSPORT=resend",
        "RESEND_API_KEY=<the API key you entered above>",
        `MAIL_FROM=${from}`,
      ];
    case "smtp": {
      const lines = ["MAIL_TRANSPORT=smtp", `SMTP_HOST=${s.host}`, `SMTP_PORT=${String(s.port)}`];
      // 465 already implies it; anywhere else it is the thing that decides
      // whether the socket is TLS from the first byte.
      if (s.secure && s.port !== 465) { lines.push("SMTP_SECURE=true"); }
      if (s.user !== "") { lines.push(`SMTP_USER=${s.user}`, "SMTP_PASS=<the password you entered above>"); }
      lines.push(`SMTP_FROM=${from}`);
      return lines;
    }
  }
}

export const MAIL_CARD_TITLE = "Email delivery (SMTP)";
export const MAIL_CARD_CAPTION =
  "How this dashboard sends email — the test mail below, and reports it emails itself. Only the owner can see or change it.";
export const MAIL_ADMIN_ONLY = "Only the restaurant owner (or the platform super admin) can set the mail settings up.";
export const MAIL_SECRET_PLACEHOLDER = "••••••••";
export const MAIL_SECRET_KEPT_HINT = "Stored. Leave it as it is to keep it, or type a new one.";
export const MAIL_SERVER_ENV_TITLE = "Scheduled reports run on the restaurant server";
export const MAIL_SERVER_ENV_HINT =
  "Emails this dashboard sends use the settings above. Reports on a schedule are sent by the restaurant server itself, " +
  "so whoever runs it has to put the same settings in its environment and restart it:";

/** The test message — one place, so the screen and its test agree. */
export function buildTestMessage(args: { restaurantName: string; byName: string; now?: Date }): { subject: string; text: string } {
  const name = args.restaurantName.trim() || "your restaurant";
  const by = args.byName.trim();
  const at = (args.now ?? new Date()).toISOString();
  return {
    subject: `Test email from ${name}`,
    text: [
      `This is a test email from the ${name} dashboard.`,
      "",
      "If you are reading it, the mail settings work and reports can be emailed from here.",
      "",
      by === "" ? `Sent at ${at}.` : `Sent by ${by} at ${at}.`,
    ].join("\n"),
  };
}

/** Everything the card renders, decided on the server. */
export interface MailPanel {
  /** False for anyone who is not the owner: the card then says so and shows nothing. */
  allowed: boolean;
  view: MailSettingsView;
  /** Why what is stored cannot send, or null. */
  problem: string | null;
  /** The env lines for the restaurant server's own scheduled sends. */
  envLines: string[];
  /** NODE_ENV=production here — "Log only" is refused. */
  production: boolean;
  /** Where the settings are kept, for the operator. Never a secret. */
  storeLabel: string;
  /** Why the panel is empty, when it is. */
  message: string;
}

export interface MailActionResult {
  ok: boolean;
  message: string;
  panel: MailPanel;
}

export function emptyMailView(): MailSettingsView {
  return {
    transport: "off",
    host: "",
    port: EMPTY_MAIL_SETTINGS.port,
    secure: false,
    user: "",
    from: "",
    hasPassword: false,
    hasResendKey: false,
    updatedAt: "",
    updatedBy: "",
  };
}

export function refusedMailPanel(message: string): MailPanel {
  return {
    allowed: false,
    view: emptyMailView(),
    problem: null,
    envLines: [],
    production: false,
    storeLabel: "",
    message,
  };
}
