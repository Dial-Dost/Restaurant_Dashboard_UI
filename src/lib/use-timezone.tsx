"use client";

// Reads the restaurant's IANA timezone ONCE per dashboard session and hands it
// to every screen, so a table with 200 timestamped rows doesn't make 200 calls
// (and, more importantly, so two panels on the same page can never disagree
// about which zone they're rendering).
//
// Mirrors CurrencyProvider's shape deliberately — same import ergonomics, same
// "read it from a hook and format" habit at the call sites.
//
// Optimistic-until-loaded: it starts on the backend's own default rather than
// blocking, because the alternative (rendering nothing, or rendering in the
// browser zone until the fetch lands) is worse — the first is a flash of empty
// tables, the second is a flash of WRONG times that looks authoritative.
// `ready` is exposed for the settings screen, which must not save a value it
// hasn't actually loaded yet.

import type { ReactNode } from 'react';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { getRestaurantTimezone } from '@/lib/db';
import { DEFAULT_TIMEZONE, sanitizeTimezone } from '@/lib/tz';

interface TimezoneContextType {
    /** The restaurant's zone — always a value Intl will accept. */
    timezone: string;
    /** False until the tenant's stored zone has actually been read. */
    ready: boolean;
    /** Called by the settings form after a successful save, so open screens re-render. */
    setTimezone: (tz: string) => void;
    /** Re-read from the backend (e.g. after switching outlet). */
    refresh: () => void;
}

const TimezoneContext = createContext<TimezoneContextType | undefined>(undefined);

// Last-known zone, cached per restaurant. The backend read is a server action and
// therefore async, but several screens seed a date-range filter on their FIRST
// render (`useState(() => todayInZone(tz))`). Without a synchronous seed those
// would compute a day boundary from the default zone and only self-correct if
// the user touched the control — so a returning user could open Accounting on
// the wrong day. Cheap to cache, and it is not authoritative: the fetch below
// still overwrites it.
const cacheKey = (restaurantId: string) => `app-timezone:${restaurantId}`;

const readCachedTimezone = (restaurantId: string): string => {
    if (!restaurantId || typeof window === 'undefined') {return DEFAULT_TIMEZONE;}
    try {
        const stored = window.localStorage.getItem(cacheKey(restaurantId));
        return stored ? sanitizeTimezone(stored) : DEFAULT_TIMEZONE;
    } catch {
        return DEFAULT_TIMEZONE;
    }
};

const writeCachedTimezone = (restaurantId: string, tz: string) => {
    if (!restaurantId || typeof window === 'undefined') {return;}
    try { window.localStorage.setItem(cacheKey(restaurantId), tz); } catch {/* private mode / quota — the fetch still works */}
};

export const TimezoneProvider = ({ restaurantId, children }: { restaurantId: string; children: ReactNode }) => {
    const [timezone, setTimezoneState] = useState<string>(() => readCachedTimezone(restaurantId));
    const [ready, setReady] = useState(false);
    const [nonce, setNonce] = useState(0);

    useEffect(() => {
        if (!restaurantId) {return;}
        let active = true;
        getRestaurantTimezone(restaurantId)
            .then((tz) => {
                if (!active) {return;}
                // A tenant that never set one reads back '' — keep the default
                // rather than letting sanitize() decide on an empty string.
                if (tz) {
                    const clean = sanitizeTimezone(tz);
                    setTimezoneState(clean);
                    writeCachedTimezone(restaurantId, clean);
                }
                setReady(true);
            })
            .catch(() => { if (active) {setReady(true);} });
        return () => { active = false; };
    }, [restaurantId, nonce]);

    const setTimezone = useCallback((tz: string) => {
        const clean = sanitizeTimezone(tz);
        setTimezoneState(clean);
        writeCachedTimezone(restaurantId, clean);
    }, [restaurantId]);
    const refresh = useCallback(() => { setNonce((n) => n + 1); }, []);

    const value = useMemo(
        () => ({ timezone, ready, setTimezone, refresh }),
        [timezone, ready, setTimezone, refresh],
    );

    return <TimezoneContext.Provider value={value}>{children}</TimezoneContext.Provider>;
};

/**
 * The restaurant's timezone. Safe outside the provider (falls back to the
 * default) so a screen rendered before login, or a print view mounted on its
 * own, still formats sensibly instead of crashing.
 */
export const useTimezone = (): TimezoneContextType => {
    const context = useContext(TimezoneContext);
    if (context === undefined) {
        return { timezone: DEFAULT_TIMEZONE, ready: false, setTimezone: () => undefined, refresh: () => undefined };
    }
    return context;
};
