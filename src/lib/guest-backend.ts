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
  if (typeof window === "undefined") return configured;
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
