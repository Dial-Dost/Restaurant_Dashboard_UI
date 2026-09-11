// The mutating half of the Scheduled reports section (see
// src/app/dashboard/accounting/scheduled-reports.tsx), lifted out of the
// component so it can be exercised by the jest suite.
//
// It lives here rather than beside the component because this project's jest
// config is `testEnvironment: 'node'` with `roots: ['<rootDir>/src/lib']` and no
// DOM renderer installed — a React component cannot be mounted, so the logic
// that has to be right has to be reachable without one. What has to be right is
// exactly the envelope below: every schedule mutation is a network call that can
// fail, and a failure must (a) reach the owner as an error and (b) release the
// busy flag. A handler that skips (b) leaves Run now / Pause / Edit / Delete
// disabled for the rest of the session, so one dropped request costs the owner
// the whole feature until they reload the page.
//
// Nothing here imports src/lib/db.ts: that is a "use server" module whose graph
// pulls in next/headers, which is why the patch shape is restated rather than
// imported (see ScheduleFormPatch).

/** The subset of useToast's argument these handlers ever pass. */
export interface ScheduleActionToast {
  title: string;
  description?: string;
  variant?: "destructive";
}

export interface ScheduleActionDeps {
  setBusy: (busy: boolean) => void;
  /** `useToast().toast`. Its return value is ignored. */
  toast: (t: ScheduleActionToast) => unknown;
}

/** `String(e?.message ?? e)` — the shape every catch on this page already used. */
export function describeActionError(e: unknown): string {
  const message = (e as { message?: unknown } | null | undefined)?.message;
  return String(message ?? e);
}

/**
 * Run one schedule mutation with the section's busy flag and its two toasts.
 *
 * `work` performs the request AND the reload, then returns the success toast, so
 * a caller can only announce success on a path that actually reached the end.
 * Returns whether it did — handy for a caller that wants to keep a form open on
 * failure, and for the tests.
 */
export async function runScheduleAction(
  deps: ScheduleActionDeps,
  failureTitle: string,
  work: () => Promise<ScheduleActionToast>,
): Promise<boolean> {
  deps.setBusy(true);
  try {
    const outcome = await work();
    deps.toast(outcome);
    return true;
  } catch (e) {
    // The backend's own sentence, not a generic one: /run-now can answer 409
    // "This report was just queued — try again in a minute", and a 400
    // "Select a specific outlet before making changes" is a real answer too.
    deps.toast({ title: failureTitle, description: describeActionError(e), variant: "destructive" });
    return false;
  } finally {
    // ALWAYS — including the throw path. This is the line the tests exist for.
    deps.setBusy(false);
  }
}

/**
 * Was this delivery a "Run now" rather than a scheduled occurrence?
 *
 * A manual run carries a `manual:`-prefixed key bucketed to the minute so that
 * rapid clicks collapse through the partial unique index; a scheduled one carries
 * a bare day key. Both are non-null, so presence alone no longer distinguishes
 * them — it did before manual runs were deduplicated, and reading it that way now
 * labels every manual run "Scheduled".
 *
 * Null is still treated as manual: that is what a manual run stored before the
 * dedup key existed.
 */
export function isManualRun(occurrenceKey: string | null | undefined): boolean {
  return !occurrenceKey || occurrenceKey.startsWith("manual:");
}

/** The create/edit form's fields. "HH:MM" is one control for the backend's
 *  hour_local + minute_local pair. */
export interface ScheduleFormState {
  name: string;
  report_key: string;
  frequency: string;
  time: string;
  weekday: string;
  day_of_month: string;
  channel: string;
  /** Raw as typed — one field, comma / semicolon / newline separated. */
  recipients: string;
}

/** The fields this form sends. Structurally a `ReportSchedulePatch` (src/lib/db.ts),
 *  restated so this module stays free of that file's "use server" graph. */
export interface ScheduleFormPatch {
  name: string;
  report_key: string;
  frequency: string;
  hour_local: number;
  minute_local: number;
  weekday: number | null;
  day_of_month: number | null;
  channel: string;
  recipients: string[];
}

export type ScheduleFormResult =
  | { ok: true; patch: ScheduleFormPatch }
  | { ok: false; message: string };

/**
 * Validate the form and turn it into the patch body, or say what is missing.
 *
 * Refusing here rather than letting the backend refuse matters: the CHECK
 * constraints behind these columns answer with a 23514, which is not a sentence
 * anyone can act on.
 */
export function buildSchedulePatch(form: ScheduleFormState): ScheduleFormResult {
  const name = form.name.trim();
  if (!name) {return { ok: false, message: "Give the schedule a name" };}
  const at = /^(\d{1,2}):(\d{2})$/.exec(form.time);
  if (!at) {return { ok: false, message: "Pick a time of day" };}
  // The SAME cleaning the server applies, so what the owner sees saved is what
  // will be used — and so the refusal below is about the list that will actually
  // be stored rather than the raw text.
  const recipients = parseRecipients(form.recipients);
  if (form.channel === "email" && recipients.length === 0) {
    return {
      ok: false,
      message: form.recipients.trim().length > 0
        // Naming the problem as "none of these look like addresses" rather than
        // "add an address" matters when somebody has clearly typed some: the
        // useful information is that what they typed was not usable.
        ? "None of those look like email addresses. Check for a missing @ or a typo."
        : "Add at least one email address, or choose the in-app inbox instead.",
    };
  }
  return {
    ok: true,
    patch: {
      name,
      report_key: form.report_key,
      frequency: form.frequency,
      hour_local: Number(at[1]),
      minute_local: Number(at[2]),
      // Only the shape this frequency uses is sent, and the other is explicitly
      // nulled — a schedule switched weekly → monthly must not keep a weekday.
      weekday: form.frequency === "weekly" ? Number(form.weekday) : null,
      day_of_month: form.frequency === "monthly" ? Number(form.day_of_month) : null,
      channel: form.channel,
      // Only ever sent for the channel that uses them. Sending a stale list on an
      // inbox schedule would leave addresses stored against a schedule that does
      // not email, which is a surprise waiting for whoever switches it later.
      recipients: form.channel === "email" ? recipients : [],
    },
  };
}

/**
 * The recipient list, cleaned exactly the way mailer.ts cleans it server-side:
 * split on commas / semicolons / newlines, trimmed, implausible entries dropped,
 * de-duplicated case-insensitively, capped at ten.
 *
 * Duplicated rather than imported because this module is deliberately free of
 * the server graph — and kept honest by a test that pins the two lists against
 * the same inputs. The cap is not a performance limit: a report carrying a
 * restaurant's takings to forty addresses is a mistake somebody makes once.
 */
export function parseRecipients(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of String(raw ?? "").split(/[,;\n]/)) {
    const s = entry.trim();
    if (!isPlausibleEmail(s)) {continue;}
    const key = s.toLowerCase();
    if (seen.has(key)) {continue;}
    seen.add(key);
    out.push(s);
    if (out.length >= 10) {break;}
  }
  return out;
}

/**
 * A syntactically plausible address — deliberately permissive.
 *
 * The only thing worth refusing in a form is a value that CANNOT be an address.
 * Whether a mailbox exists behind it is not knowable here, and a bounce is the
 * honest way to find out; anything stricter than this reliably refuses somebody's
 * real address with a plus tag or a long TLD.
 */
export function isPlausibleEmail(raw: string): boolean {
  const s = String(raw ?? "").trim();
  if (s.length === 0 || s.length > 254) {return false;}
  if (/\s/.test(s)) {return false;}
  const at = s.indexOf("@");
  if (at <= 0 || at !== s.lastIndexOf("@")) {return false;}
  const domain = s.slice(at + 1);
  if (domain.length < 3 || !domain.includes(".")) {return false;}
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) {return false;}
  return true;
}
