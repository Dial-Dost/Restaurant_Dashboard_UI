// Backend base URL for PUBLIC guest pages (/order, /queue, /reserve, /cfd,
// /feedback) — pages that are opened on customers' phones, not just the dev PC.
//
// In dev NEXT_PUBLIC_BACKEND_URL is http://localhost:3001, which is correct in
// a browser on the dev machine but wrong anywhere else: on a phone that opened
// the page via the PC's LAN IP, "localhost" is the phone itself; through a
// Cloudflare tunnel, the backend isn't on the page's host at all. In both
// cases every fetch fails and the page renders blank.
//
// So when the configured backend host is localhost but the page is being
// viewed from a non-localhost host, guest pages use the SAME-ORIGIN
// "/backend-api" prefix instead — next.config.ts rewrites it to the backend
// server-side. That works identically for LAN IPs and tunnel URLs, with no
// extra firewall rule for the backend port.
//
// Production URLs (a real https backend host) pass through untouched, as does
// server-side rendering (no window).
export function guestBackendBase(): string {
  const configured = (process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001").replace(/\/$/, "");
  if (typeof window === "undefined") {return configured;}
  try {
    const u = new URL(configured);
    const localhostNames = ["localhost", "127.0.0.1", "[::1]"];
    if (localhostNames.includes(u.hostname) && !localhostNames.includes(window.location.hostname)) {
      return "/backend-api";
    }
  } catch {
    // fall through to the configured value on any malformed URL
  }
  return configured;
}

/// Read a guest-facing response WITHOUT assuming it is JSON.
///
/// Every guest page used to do `await res.json()` and only then check `res.ok`.
/// That is fine while the backend is up and answering in JSON, and awful the
/// moment it is not: when the backend is unreachable the Next rewrite in front
/// of /backend-api answers with the plain text "Internal Server Error", so the
/// parse throws on the leading "I" and the guest is shown
///   Unexpected token 'I', "Internal S"... is not valid JSON
/// on their phone, at their table, instead of anything they can act on.
///
/// So: check the status first, parse defensively, and translate a transport
/// failure into a sentence a diner can understand. The raw body is kept on
/// `detail` for the console — useful to whoever debugs it, invisible to the guest.
export class GuestRequestError extends Error {
  constructor(message: string, readonly status: number, readonly detail?: string) {
    super(message);
    this.name = "GuestRequestError";
  }
}

export async function readGuestJson<T = unknown>(res: Response, fallback: string): Promise<T> {
  const raw = await res.text();
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    // Not JSON — an upstream error page, a proxy message, or an empty body.
    parsed = null;
  }
  if (!res.ok) {
    const fromBody = (parsed as { error?: unknown } | null)?.error;
    // A 5xx is ours to apologise for; the body of one is never guest-readable.
    const message = typeof fromBody === "string" && fromBody.trim()
      ? fromBody
      : res.status >= 500
        ? "We could not reach the kitchen just now. Please try again in a moment."
        : fallback;
    throw new GuestRequestError(message, res.status, raw.slice(0, 200));
  }
  if (parsed === null && raw.trim()) {
    throw new GuestRequestError(
      "We could not reach the kitchen just now. Please try again in a moment.",
      res.status,
      raw.slice(0, 200),
    );
  }
  return parsed as T;
}

/// Like [readGuestJson] but NEVER throws — for the calls that need to inspect
/// the failure body themselves (e.g. an order rejected with code "otp_required",
/// where the guest has to be re-prompted rather than shown an error). Returns a
/// null `data` when the body was not JSON, so a proxy's plain-text error page
/// can no longer masquerade as a parse bug in front of a customer.
export async function readGuestBody(
  res: Response,
): Promise<{ ok: boolean; status: number; data: any; raw: string }> {
  const raw = await res.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data, raw };
}

/// The sentence a guest sees when the backend could not be reached at all.
/// Deliberately not the raw body: "Internal Server Error" tells a diner nothing.
export const GUEST_UNREACHABLE =
  "We could not reach the kitchen just now. Please try again in a moment.";
