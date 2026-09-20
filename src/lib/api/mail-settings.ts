"use server";

// THE MAIL SETTINGS STORE AND ITS GATE. Four Server Actions behind one rule:
// only the OWNER of the signed-in restaurant may read or write them, and the
// owner is whoever GET /auth/me says is an admin on THIS session's token — not
// whoever the browser cookie claims to be. The cookie is written by the client
// (POST /api/session), so it is a hint about identity, never a proof of one;
// the token in it is the proof, and the restaurant server is what reads it.
//
// The secrets (an SMTP password, a Resend key) are written to a file beside
// this app with 0600 and are never sent to a browser: the card gets
// `hasPassword` and dots. They are kept PER RESTAURANT, keyed by the tenant on
// the verified session, so one owner's mailbox is never another's.
//
// Nothing here writes to the restaurant server. See lib/mail-settings.ts for
// why this app holds a transport of its own at all.

import { constants as fsConstants, promises as fs } from "node:fs";
import { dirname, join } from "node:path";

import { cookies } from "next/headers";

import { requestBackend } from "@/lib/db";
import { sendWithSettings } from "@/lib/mail-transport";
import {
  EMPTY_MAIL_SETTINGS,
  MAIL_ADMIN_ONLY,
  buildTestMessage,
  looksLikeEmail,
  mailEnvLines,
  mailSettingsProblem,
  mergeMailEdit,
  normalizeMailSettings,
  redactMailSettings,
  refusedMailPanel,
  type MailActionResult,
  type MailPanel,
  type MailSettings,
  type MailSettingsEdit,
  type StoredMailSettings,
} from "@/lib/mail-settings";

interface Owner {
  restaurantId: string;
  restaurantName: string;
  byName: string;
}

const SIGN_IN_AGAIN = "Sign in again — this session has no identity the server recognises.";
const NO_SERVER = "Couldn't reach the restaurant server to check who you are. Nothing has been changed.";

const isProduction = (): boolean => process.env.NODE_ENV === "production";

/** Where the settings live. An absolute path in MAIL_SETTINGS_FILE wins. */
const storeFile = (): string => {
  const configured = (process.env.MAIL_SETTINGS_FILE ?? "").trim();
  return configured !== "" ? configured : join(process.cwd(), ".mail-settings.json");
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

async function sessionToken(): Promise<string> {
  try {
    const jar = await cookies();
    const raw = jar.get("authUser")?.value;
    if (raw === undefined || raw === "") { return ""; }
    const parsed = JSON.parse(decodeURIComponent(raw)) as { token?: unknown };
    return str(parsed.token);
  } catch {
    return "";
  }
}

/**
 * The owner, confirmed by the restaurant server, or the sentence to show
 * instead. `role`/`role_all` come from /auth/me, which recomputes them from the
 * verified session — a demoted manager loses this on their next call, and a
 * hand-written cookie never has it at all.
 */
async function requireOwner(): Promise<{ owner: Owner } | { refusal: string }> {
  if ((await sessionToken()) === "") { return { refusal: SIGN_IN_AGAIN }; }
  const res = await requestBackend<Record<string, unknown>>({ path: "/auth/me", method: "GET" });
  // 0 is this app failing to reach the server at all; 401 has already been
  // turned into a redirect to the login screen by requestBackend.
  if (res.status === 0) { return { refusal: NO_SERVER }; }
  if (!res.ok || res.data === null) { return { refusal: SIGN_IN_AGAIN }; }
  const me = res.data;
  const roles = [str(me.role), ...(Array.isArray(me.role_all) ? me.role_all.map((r) => str(r)) : [])];
  if (!roles.includes("admin")) { return { refusal: MAIL_ADMIN_ONLY }; }
  const restaurantId = str(me.restaurantUsername) || str(me.res_id);
  if (restaurantId === "") { return { refusal: SIGN_IN_AGAIN }; }
  const byName = [str(me.emp_Fname), str(me.emp_Lname)].filter((p) => p !== "").join(" ") || str(me.employeeUsername);
  return { owner: { restaurantId, restaurantName: str(me.restaurantName) || restaurantId, byName } };
}

interface StoreFile {
  version: number;
  restaurants: Record<string, unknown>;
}

async function readStoreFile(): Promise<StoreFile> {
  const file = storeFile();
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is this app's own, from env or cwd; never from a request.
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const restaurants = parsed.restaurants;
    return {
      version: 1,
      restaurants: restaurants !== null && typeof restaurants === "object" ? (restaurants as Record<string, unknown>) : {},
    };
  } catch {
    // No file yet, or an unreadable one: an empty store, never a crash on a
    // screen whose whole job is to write the first settings.
    return { version: 1, restaurants: {} };
  }
}

function storedFor(store: StoreFile, restaurantId: string): StoredMailSettings {
  const row = Object.prototype.hasOwnProperty.call(store.restaurants, restaurantId)
    ? (store.restaurants[restaurantId] as Record<string, unknown> | undefined)
    : undefined;
  const base = normalizeMailSettings(row);
  return {
    ...base,
    updatedAt: str(row?.updatedAt),
    updatedBy: str(row?.updatedBy),
  };
}

async function writeStoreFile(store: StoreFile): Promise<void> {
  const file = storeFile();
  const tmp = `${file}.tmp`;
  const body = JSON.stringify(store, null, 2);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- same path as above.
  await fs.mkdir(dirname(file), { recursive: true });
  // 0600 on the way in, not after: the window between create and chmod is the
  // window in which a secret is world-readable.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- same path as above.
  await fs.writeFile(tmp, body, { encoding: "utf8", mode: 0o600, flag: "w" });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- same path as above.
  await fs.rename(tmp, file);
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- same path as above.
    await fs.chmod(file, 0o600);
  } catch {
    /* a filesystem without modes (a Windows share, a container volume) */
  }
}

async function storeIsWritable(): Promise<boolean> {
  const dir = dirname(storeFile());
  try {
    await fs.access(dir, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function panelFor(stored: StoredMailSettings, storeLabel: string): MailPanel {
  return {
    allowed: true,
    view: redactMailSettings(stored),
    problem: mailSettingsProblem(stored, { production: isProduction() }),
    envLines: mailEnvLines(stored),
    production: isProduction(),
    storeLabel,
    message: "",
  };
}

async function panelForOwner(owner: Owner): Promise<MailPanel> {
  const store = await readStoreFile();
  return panelFor(storedFor(store, owner.restaurantId), storeFile());
}

/** What the card shows on open. Never the password or the API key. */
export async function loadMailPanel(): Promise<MailPanel> {
  const gate = await requireOwner();
  if ("refusal" in gate) { return refusedMailPanel(gate.refusal); }
  return panelForOwner(gate.owner);
}

/** Save the card's fields. Settings that cannot send are refused, not stored. */
export async function saveMailSettings(edit: MailSettingsEdit): Promise<MailActionResult> {
  const gate = await requireOwner();
  if ("refusal" in gate) { return { ok: false, message: gate.refusal, panel: refusedMailPanel(gate.refusal) }; }
  const { owner } = gate;
  const store = await readStoreFile();
  const current = storedFor(store, owner.restaurantId);
  const next: MailSettings = mergeMailEdit(current, edit);
  const problem = mailSettingsProblem(next, { production: isProduction() });
  if (problem !== null) {
    return { ok: false, message: problem, panel: panelFor(current, storeFile()) };
  }
  if (!(await storeIsWritable())) {
    return {
      ok: false,
      message: `This server can't write ${storeFile()} — nothing has been saved. Give the app write access there, or set MAIL_SETTINGS_FILE to a writable path.`,
      panel: panelFor(current, storeFile()),
    };
  }
  const saved: StoredMailSettings = { ...next, updatedAt: new Date().toISOString(), updatedBy: owner.byName };
  store.restaurants[owner.restaurantId] = saved;
  try {
    await writeStoreFile(store);
  } catch (error) {
    return {
      ok: false,
      message: `Couldn't save the mail settings: ${error instanceof Error ? error.message : String(error)}`,
      panel: panelFor(current, storeFile()),
    };
  }
  return {
    ok: true,
    message: next.transport === "off" ? "Email is switched off for this restaurant." : "Mail settings saved.",
    panel: panelFor(saved, storeFile()),
  };
}

/** Forget everything, including the secrets. */
export async function clearMailSettings(): Promise<MailActionResult> {
  const gate = await requireOwner();
  if ("refusal" in gate) { return { ok: false, message: gate.refusal, panel: refusedMailPanel(gate.refusal) }; }
  const { owner } = gate;
  const store = await readStoreFile();
  const current = storedFor(store, owner.restaurantId);
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- the key is a tenant id, and the row must go, not be blanked.
  delete store.restaurants[owner.restaurantId];
  try {
    await writeStoreFile(store);
  } catch (error) {
    return {
      ok: false,
      message: `Couldn't clear the mail settings: ${error instanceof Error ? error.message : String(error)}`,
      panel: panelFor(current, storeFile()),
    };
  }
  const empty: StoredMailSettings = { ...EMPTY_MAIL_SETTINGS, updatedAt: "", updatedBy: "" };
  return { ok: true, message: "Mail settings cleared.", panel: panelFor(empty, storeFile()) };
}

/**
 * Send one real message with what is STORED (not with what is unsaved on the
 * screen) — so a pass here is a pass for everything this app emails.
 */
export async function sendTestMail(to: string): Promise<MailActionResult> {
  const gate = await requireOwner();
  if ("refusal" in gate) { return { ok: false, message: gate.refusal, panel: refusedMailPanel(gate.refusal) }; }
  const { owner } = gate;
  const address = to.trim();
  const store = await readStoreFile();
  const stored = storedFor(store, owner.restaurantId);
  const panel = panelFor(stored, storeFile());
  if (address === "" || !looksLikeEmail(address)) {
    return { ok: false, message: "Enter the address to send the test to.", panel };
  }
  const message = buildTestMessage({ restaurantName: owner.restaurantName, byName: owner.byName });
  const sent = await sendWithSettings(stored, { to: address, subject: message.subject, text: message.text });
  return { ok: sent.ok, message: sent.message, panel };
}

/** Read-only view for other server code: this restaurant's transport. */
export async function mailSettingsFor(restaurantId: string): Promise<MailSettings> {
  const store = await readStoreFile();
  return storedFor(store, restaurantId.trim());
}
