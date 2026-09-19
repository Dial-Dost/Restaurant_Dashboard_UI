"use client";

/**
 * CACHE-PRIMED DATA LOADING — the web half of the app's AsyncView /
 * CachePrimedScreen (restaurant_owner_app/lib/widgets/async_view.dart).
 *
 * Semantics, in the app's own order:
 *
 *  1. STALE-WHILE-REVALIDATE BOOT. A screen the user has opened before paints
 *     its saved payload immediately from localStorage, then refreshes
 *     silently — no skeleton, no blink.
 *  2. A SILENT REFRESH NEVER REPLACES GOOD DATA WITH AN ERROR. If a refresh
 *     (or poll tick) fails while data is on screen, the data stays and the
 *     screen is marked `offline` — the stale pill is the affordance, not an
 *     error page.
 *  3. OFFLINE vs REFUSAL. Only a failure that never reached the server (the
 *     line is down) may wear the offline wording or reach for a saved copy; a
 *     403 or a 500 is a real answer and must be shown as one
 *     (`isUnreachableError`).
 *  4. THE OFFLINE LAST RESORT. Nothing on screen, network unreachable: the
 *     last-known-good copy is painted with the offline pill and its own age
 *     on it — a saved copy replaces a blank screen, never a reachable server.
 *  5. `retry()` is the loud path: skeleton allowed, cache bypassed.
 *
 * Render with <LoadErrorState/> for the error state and <CacheStalePill/>
 * over the content for staleness (src/components/ui/).
 */

import * as React from "react";

/* ── Offline vs refusal ─────────────────────────────────────────────── */

/** What a screen says when the line is down AND nothing is saved. The app's
 *  exact copy (async_view.dart) — same words for the same state. */
export const offlineNothingSavedTitle = "This device is offline";
export const offlineNothingSavedCaption =
  "It can't reach the restaurant server, and this section has nothing saved " +
  "to show. Reconnect to the restaurant Wi-Fi, or share a hotspot from a " +
  "phone, then tap Retry. If the other devices can't reach it either, the " +
  "server itself is down.";

/**
 * Whether a failure means the LINE is down rather than the server having
 * answered with a refusal. A fetch() that never got a response rejects with a
 * TypeError; an HTTP error is a response and therefore a refusal.
 */
export function isUnreachableError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) { return true; }
  if (e instanceof TypeError) { return true; }
  if (e && typeof e === "object" && "status" in e) {
    const status = (e as { status?: unknown }).status;
    return status == null;
  }
  const raw = String(e);
  return (
    raw.includes("Failed to fetch") ||
    raw.includes("NetworkError") ||
    raw.includes("Load failed") ||
    raw.includes("ERR_NETWORK") ||
    raw.includes("ECONNREFUSED") ||
    raw.includes("timed out") ||
    raw.includes("AbortError")
  );
}

/** "just now", "45s ago", "12m ago", "3h ago", "2d ago" — the pill's clock. */
export function formatAgo(at: number | null | undefined): string {
  if (at == null) { return "a moment ago"; }
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 45) { return "just now"; }
  if (s < 60) { return `${s}s ago`; }
  const m = Math.floor(s / 60);
  if (m < 60) { return `${m}m ago`; }
  const h = Math.floor(m / 60);
  if (h < 24) { return `${h}h ago`; }
  return `${Math.floor(h / 24)}d ago`;
}

/* ── The cache ──────────────────────────────────────────────────────── */

const CACHE_PREFIX = "cf-cache:";

interface CacheEntry<T> {
  at: number;
  data: T;
}

function readCache<T>(key: string): CacheEntry<T> | null {
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) { return null; }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || typeof (parsed as CacheEntry<T>).at !== "number") { return null; }
    return parsed as CacheEntry<T>;
  } catch {
    return null;
  }
}

function writeCache(key: string, data: unknown): void {
  try {
    window.localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* quota, private mode — the cache is a convenience, never required */
  }
}

/** Drop one saved payload (e.g. after a write that supersedes it). */
export function invalidateCachedFetch(key: string): void {
  try {
    window.localStorage.removeItem(CACHE_PREFIX + key);
  } catch {
    /* ignore */
  }
}

/* ── The hook ───────────────────────────────────────────────────────── */

export interface CachedFetchOptions {
  /** Silent refetch interval, like AsyncView.pollEvery. Off by default. */
  pollMs?: number;
  /** Gate the whole load (e.g. until a session id exists). Default true. */
  enabled?: boolean;
}

export interface CachedFetchResult<T> {
  data: T | null;
  /** True only while nothing is on screen (skeleton state). */
  loading: boolean;
  /** Set only when there is nothing to show — render <LoadErrorState/>. */
  error: unknown;
  /** A refresh failed while data stayed on screen (or the saved copy is the
   *  offline last resort). Feed <CacheStalePill/>. */
  offline: boolean;
  /** What is on screen came from the cache, not (yet) the network. */
  fromCache: boolean;
  /** When the payload was last confirmed by the network (ms epoch). */
  updatedAt: number | null;
  /** The loud reload: skeleton allowed, cache bypassed. */
  retry: () => void;
  /** The silent reload: keeps what is on screen while it refetches. */
  refresh: () => void;
}

export function useCachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: CachedFetchOptions = {},
): CachedFetchResult<T> {
  const { pollMs, enabled = true } = options;

  const [data, setData] = React.useState<T | null>(null);
  const [hasData, setHasData] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<unknown>(null);
  const [offline, setOffline] = React.useState(false);
  const [fromCache, setFromCache] = React.useState(false);
  const [updatedAt, setUpdatedAt] = React.useState<number | null>(null);

  // A slow refresh that lands after a newer load must not overwrite it.
  const gen = React.useRef(0);
  const fetcherRef = React.useRef(fetcher);
  fetcherRef.current = fetcher;
  const hasDataRef = React.useRef(false);
  hasDataRef.current = hasData;

  const load = React.useCallback(
    async (silent: boolean) => {
      const myGen = ++gen.current;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const fresh = await fetcherRef.current();
        if (myGen !== gen.current) { return; }
        writeCache(key, fresh);
        setData(fresh);
        setHasData(true);
        setError(null);
        setLoading(false);
        setOffline(false);
        setFromCache(false);
        setUpdatedAt(Date.now());
      } catch (e) {
        if (myGen !== gen.current) { return; }
        if (hasDataRef.current) {
          // Good data stays; the pill says so.
          setOffline(true);
          setLoading(false);
          setError(null);
          return;
        }
        // Nothing on screen. Before an error page, the last-known-good copy —
        // but only for a genuine outage, never for a refusal.
        if (isUnreachableError(e)) {
          const saved = readCache<T>(key);
          if (saved) {
            setData(saved.data);
            setHasData(true);
            setError(null);
            setLoading(false);
            setOffline(true);
            setFromCache(true);
            setUpdatedAt(saved.at);
            return;
          }
        }
        setError(e);
        setLoading(false);
      }
    },
    [key],
  );

  // Boot: cache-primed instant paint, then a silent network chase.
  React.useEffect(() => {
    if (!enabled) { return; }
    const saved = readCache<T>(key);
    if (saved) {
      gen.current++;
      setData(saved.data);
      setHasData(true);
      setLoading(false);
      setError(null);
      setOffline(false);
      setFromCache(true);
      setUpdatedAt(saved.at);
      void load(true);
    } else {
      void load(false);
    }
    // Reset when the key changes: the next screen boots afresh.
    return () => {
      // The ref IS the generation counter — bumping it live on cleanup is the
      // point; a snapshot would cancel the wrong generation.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      gen.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  // Poll: always silent — the board must not blink.
  React.useEffect(() => {
    if (!enabled || !pollMs) { return; }
    const id = window.setInterval(() => { void load(true); }, pollMs);
    return () => { window.clearInterval(id); };
  }, [enabled, pollMs, load]);

  const retry = React.useCallback(() => { void load(false); }, [load]);
  const refresh = React.useCallback(() => { void load(true); }, [load]);

  return { data, loading, error, offline, fromCache, updatedAt, retry, refresh };
}
