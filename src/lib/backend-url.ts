// The single source of truth for "where is the backend".
//
// WHY THIS FILE EXISTS
// --------------------
// Nine call sites used to resolve the backend independently, all with the same
// idiom:
//     process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001"
// `??` only falls back on null/undefined. A production image was built with the
// build-arg present but EMPTY (`ARG NEXT_PUBLIC_BACKEND_URL` carried no default,
// so `ENV X=$ARG` produced ""), and "" is neither null nor undefined — so it
// sailed through all nine fallbacks and every base URL in the browser bundle
// became the empty string. Requests went to /platform/auth/login on the
// dashboard's own origin, Next answered with its 404 HTML page, and the console
// filled with
//     Unexpected token '<', "<!DOCTYPE "... is not valid JSON
// while every counter read 0. Guest ordering broke on the same host.
//
// So: `readConfigured` treats blank as ABSENT, which is the one behaviour the
// `??` idiom could not express, and nothing else in the app reads the env var
// directly any more.
//
// WHY THERE ARE THREE RESOLVERS, NOT ONE
// --------------------------------------
// "The backend URL" is not one value. Code in this repo runs in three places
// and each needs a different address:
//
//   browserBackendBase()  HTTP from a browser (staff dashboard + guest phones).
//                         Prefers the configured public origin; falls back to
//                         the SAME-ORIGIN "/backend-api" prefix, which
//                         next.config.ts rewrites to the backend server-side.
//
//   serverBackendBase()   HTTP from inside the Next server — `"use server"`
//                         modules (lib/db.ts, services/authService.ts) and any
//                         SSR path. MUST be absolute: a server-side fetch to
//                         "/backend-api/x" has no host and throws
//                         `TypeError: Failed to parse URL`. Prefers the docker
//                         network address, which never leaves the host.
//
//   socketBackendBase()   Socket.IO. MUST be absolute and MUST be the backend's
//                         own public origin — see the note on that function for
//                         why "/backend-api" cannot carry socket traffic.
//
// Feeding the wrong one of these to the wrong place is exactly how this bug
// stayed invisible: on a dev laptop all three collapse to http://localhost:3001,
// which really is the backend, so nothing distinguishes them until deploy.

/** Hostnames that mean "this machine", where a bare localhost backend is real. */
const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]", "::1"];

/** The backend's port in local development. */
const DEV_BACKEND_URL = "http://localhost:3001";

/**
 * Same-origin path prefix that next.config.ts rewrites to the backend.
 * Browser-only: it is a path, not a URL, and is meaningless anywhere else.
 */
export const SAME_ORIGIN_BACKEND_PREFIX = "/backend-api";

function isLocalHostname(hostname: string): boolean {
  return LOCAL_HOSTNAMES.includes(hostname.toLowerCase());
}

/**
 * Read an env value as "configured or not". A missing var, an empty string and
 * a string of spaces are all ABSENT — which is the distinction the nine `??`
 * call sites failed to make. Any trailing slashes are stripped so callers can
 * always concatenate a path beginning with "/".
 */
function readConfigured(raw: string | undefined | null): string | null {
  if (typeof raw !== "string") {return null;}
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parse a configured value as an absolute http(s) URL, or return null.
 * A relative value like "/backend-api", a bare host like "api.example.com"
 * (no scheme, so `new URL` throws) and a non-http scheme all yield null rather
 * than being passed on to something that requires an absolute origin.
 */
function parseAbsolute(value: string | null): URL | null {
  if (!value) {return null;}
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** The configured public backend origin, or null when unset/blank/relative. */
export function publicBackendOrigin(): string | null {
  const parsed = parseAbsolute(readConfigured(process.env.NEXT_PUBLIC_BACKEND_URL));
  return parsed ? parsed.toString().replace(/\/+$/, "") : null;
}

/**
 * True when `configured` points at localhost but the page was NOT opened on
 * localhost — a guest's phone on the LAN IP, or anyone coming through a tunnel.
 * There "localhost" names the visitor's own device, so the configured value is
 * actively wrong and the same-origin proxy must be used instead.
 */
function localBackendButRemotePage(configured: URL): boolean {
  if (typeof window === "undefined") {return false;}
  return isLocalHostname(configured.hostname) && !isLocalHostname(window.location.hostname);
}

/**
 * Backend base for fetches issued BY THE NEXT SERVER — `"use server"` modules
 * and SSR. Always absolute.
 *
 * Order:
 *  1. BACKEND_INTERNAL_URL (http://backend:3001 in production compose). Read at
 *     runtime because it is not a NEXT_PUBLIC_ var; it stays inside the docker
 *     network, so it costs no public round trip and does not depend on DNS,
 *     egress or the CORS allowlist.
 *  2. The configured public origin. Correct but slower — it hairpins out
 *     through Cloudflare and back — so it is a fallback, not the default.
 *  3. localhost:3001, the dev backend.
 *
 * Never returns a relative value: server-side `fetch("/backend-api/x")` throws.
 */
export function serverBackendBase(): string {
  // NEXT_PUBLIC_RECEPTION_API_URL and NEXT_BACKEND_URL are legacy aliases, both
  // commented out in .env.example. They are kept so nobody who has one set
  // loses it, but they are now LAST rather than first: lib/db.ts used to rank
  // NEXT_PUBLIC_BACKEND_URL above NEXT_PUBLIC_RECEPTION_API_URL while
  // services/authService.ts ranked them the other way round, so the same
  // variable chose a different backend depending on which module you entered
  // through. One order, applied everywhere, is the point of this file.
  const candidates = [
    process.env.BACKEND_INTERNAL_URL,
    process.env.NEXT_PUBLIC_BACKEND_URL,
    process.env.NEXT_PUBLIC_RECEPTION_API_URL,
    process.env.NEXT_BACKEND_URL,
  ];
  for (const candidate of candidates) {
    const parsed = parseAbsolute(readConfigured(candidate));
    if (parsed) {return parsed.toString().replace(/\/+$/, "");}
  }
  return DEV_BACKEND_URL;
}

/**
 * Backend base for fetches issued BY A BROWSER.
 *
 * Resolution order:
 *  1. No window (SSR / server action / build) -> defer to serverBackendBase(),
 *     because a relative prefix has no meaning without a browser to resolve it.
 *  2. A usable absolute public origin -> use it. This is the production path;
 *     the backend allowlists the dashboard origin for CORS (verified live).
 *  3. Otherwise -> the same-origin "/backend-api" prefix, proxied by the Next
 *     rewrite. This covers three cases with one answer: the env var is unset
 *     (plain dev), it is EMPTY (the production bug this file exists for), or it
 *     says localhost while the page is on a LAN IP or tunnel.
 *
 * Case 3 is why the fix is safe even if a build ever ships a blank value again:
 * the browser silently keeps working over the proxy instead of calling its own
 * origin and parsing Next's 404 HTML as JSON.
 */
export function browserBackendBase(): string {
  if (typeof window === "undefined") {return serverBackendBase();}
  const configured = parseAbsolute(readConfigured(process.env.NEXT_PUBLIC_BACKEND_URL));
  if (!configured) {return SAME_ORIGIN_BACKEND_PREFIX;}
  if (localBackendButRemotePage(configured)) {return SAME_ORIGIN_BACKEND_PREFIX;}
  return configured.toString().replace(/\/+$/, "");
}

/**
 * Pick the base for a server-side fetch when a caller offered an override.
 *
 * A caller-supplied base is honoured ONLY if it is an absolute http(s) URL.
 * Anything else — undefined, "", "   ", or a relative prefix like
 * "/backend-api" — falls back to serverBackendBase().
 *
 * This guard is load-bearing, not decorative. `requestBackend` in lib/db.ts is
 * a Server Action, so its fetch runs on the server, but several client
 * components computed a `baseUrl` in the BROWSER and passed it in. A browser
 * value such as "/backend-api" (or "") would reach a server-side fetch and
 * throw `TypeError: Failed to parse URL`. Now it cannot.
 */
export function serverBaseUrlFrom(candidate?: string | null): string {
  const parsed = parseAbsolute(readConfigured(candidate));
  return parsed ? parsed.toString().replace(/\/+$/, "") : serverBackendBase();
}

/**
 * Backend base for the Socket.IO client. Absolute, always, and never the
 * same-origin proxy prefix.
 *
 * TWO independent reasons "/backend-api" cannot carry realtime:
 *  1. A Next rewrite proxies HTTP, not websockets, so the upgrade never
 *     completes.
 *  2. More immediately: socket.io-client's own URL parser DISCARDS the path of
 *     the value it is given and uses the separate `path` option ("/socket.io")
 *     instead. Passing "/backend-api" resolves to
 *     https://<dashboard-host>/socket.io — the dashboard origin, which does not
 *     serve socket.io at all.
 *
 * The empty-string bug was worse here than for HTTP: `io("")` resolves to
 * `https://:443`, a URL with an EMPTY HOST, so realtime could not connect at
 * all. Realtime therefore needs a real public backend origin to exist; when
 * none is configured we fall back to the dev convention (page host, port 3001)
 * rather than inventing an address that cannot work.
 */
export function socketBackendBase(): string {
  const configured = parseAbsolute(readConfigured(process.env.NEXT_PUBLIC_BACKEND_URL));
  if (configured && !localBackendButRemotePage(configured)) {
    return configured.toString().replace(/\/+$/, "");
  }
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:3001`;
  }
  return DEV_BACKEND_URL;
}
