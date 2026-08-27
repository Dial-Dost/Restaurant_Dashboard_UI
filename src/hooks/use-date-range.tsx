"use client"

// Binds the shared date-range control to one screen's state.
//
// Every reporting page does the same four things with a window — seed it, keep
// it across a tab hop, turn it into query parameters, and label it — so they do
// them through this hook rather than each rolling its own `useState` pair. That
// is what stops Accounting and Analytics drifting into two different notions of
// "the last 30 days" again.
//
// SEEDING ORDER, and why it is that order:
//   1. `?from=&to=` on the URL. A deep link ("open August in Accounting", a link
//      pasted to an accountant) has to open on the window it names, or the link
//      is a lie.
//   2. This screen's stored window for the session, so switching modules and
//      coming back does not silently reset to a different window than the one
//      the owner was reasoning about.
//   3. The default (last 30 days).

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  defaultRange,
  hasStored,
  loadRange,
  rangeFromParams,
  rangeLabel,
  resolvePreset,
  saveRange,
  toQuery,
  toQueryString,
  type DateRange,
  type RangeQuery,
} from "@/lib/date-range"
import { useTimezone } from "@/lib/use-timezone"

interface UseDateRange {
  range: DateRange
  setRange: (next: DateRange) => void
  /** `{ from, to, days }` — what every reporting call is parameterised by. */
  query: RangeQuery
  /** `from=…&to=…&days=…`, for export URLs built by hand. */
  queryString: string
  /** `1–15 Aug` — the chip text, for captions inside cards. */
  label: string
  timezone: string
}

export function useDateRange(
  /** Stable per-screen key: "accounting", "analytics", "history", "cash". */
  screen: string,
  options: {
    params?: { get(name: string): string | null } | null
    /**
     * This screen's own opening window, when 30 days is the wrong question to
     * open on. History is the case: it exists to show years, so opening it on a
     * month would make it look empty for a restaurant with a quiet fortnight.
     * Only consulted when neither the URL nor the session has a window.
     */
    fallback?: (timezone: string) => DateRange
  } = {},
): UseDateRange {
  const { timezone } = useTimezone()
  const params = options.params ?? null
  const fallback = options.fallback

  // Seeded once, synchronously, so the screen's first fetch already uses the
  // right window instead of firing for the default and again for the real one.
  const [range, setRangeState] = useState<DateRange>(() => {
    const fromUrl = rangeFromParams(params, timezone)
    if (fromUrl) {return fromUrl}
    const stored = loadRange(screen, timezone)
    // `loadRange` cannot tell "nothing stored" from "stored, and it happens to
    // equal the default", so the screen's own opening window is applied only
    // when storage is genuinely empty — otherwise a returning owner who had
    // deliberately chosen the last 30 days would be bounced back to a year.
    return hasStored(screen) ? stored : (fallback?.(timezone) ?? stored)
  })

  const setRange = useCallback((next: DateRange) => {
    setRangeState(next)
    saveRange(screen, next)
  }, [screen])

  // The tenant zone arrives asynchronously (TimezoneProvider opens on a cached
  // or default zone and corrects itself). A PRESET has to be recomputed when it
  // lands: "Today" for a Dubai restaurant is not the same day as "Today" for the
  // Asia/Kolkata default, and the seed above may have been taken against the
  // wrong one. A CUSTOM range is left alone — it names days, not a rule.
  const seededZone = useRef(timezone)
  useEffect(() => {
    if (seededZone.current === timezone) {return}
    seededZone.current = timezone
    setRangeState((current) => (current.preset === "custom" ? current : resolvePreset(current.preset, timezone)))
  }, [timezone])

  const query = useMemo(() => toQuery(range), [range])

  return {
    range,
    setRange,
    query,
    queryString: useMemo(() => toQueryString(range), [range]),
    label: useMemo(() => rangeLabel(range, timezone), [range, timezone]),
    timezone,
  }
}

/** The window a screen shows before its restaurant is known. Exported for tests. */
export const initialRange = defaultRange
