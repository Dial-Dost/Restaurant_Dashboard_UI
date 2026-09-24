"use client";

/*
  THE FLOOR OPENS WHEN THE SHIFT DOES.

  Client: "it will be better if the waiter can access the tables only when he is
  clocked in and present at the restaurant (only based on functionality basis)".

  WHAT THIS ENFORCES, AND WHAT IT CANNOT
  --------------------------------------
  Clocked in is the only evidence of "present" this system has. There is no
  geofence, no device pairing and no beacon, so this is an honest proxy and the
  UI says so in those words rather than claiming to know where anybody is.

  WHO IT APPLIES TO
  -----------------
  WAITER-ONLY SESSIONS. A manager, a cashier or an owner opening the floor on the
  pass terminal is not "a waiter arriving for a shift", and locking a manager out
  of the tables because they have not punched in would turn a nicety into an
  outage. `isWaiterOnly` is the server's own answer to that question
  (lib/session-scope.ts), never a role-string guess.

  IT IS A GATE, NOT A TRAP
  ------------------------
  The one action behind the gate is CLOCK IN, on the same screen, one tap, no
  manager needed — so a waiter who forgot is ten seconds from their tables. And
  a failed READ never gates: an attendance endpoint that is down, slow or absent
  leaves the floor open exactly as it is today. A restaurant loses money when
  staff cannot serve; it loses nothing when an attendance read fails open.
*/

import * as React from "react";

import { useAuth } from "@/context/AuthContext";
import { fetchMyShift, toggleClock } from "@/lib/api/attendance";
import { isWaiterOnly } from "@/lib/session-scope";

export interface ShiftGate {
    /** True when this session is one the gate applies to at all. */
    applies: boolean;
    /** The server's answer; true whenever the gate does not apply. */
    clockedIn: boolean;
    /** The first read is still out — hold the screen rather than flash the gate. */
    loading: boolean;
    /** When the shift started, ISO, or null. */
    since: string | null;
    /** The clock-in is filed but a manager has not approved it yet. */
    pendingApproval: boolean;
    /** Clock in from wherever the gate is drawn. Throws the server's sentence. */
    clockIn: () => Promise<void>;
    /** Re-read (after clocking in elsewhere, or on focus). */
    refresh: () => void;
}

export function useShiftGate(): ShiftGate {
    const { user } = useAuth();
    const restaurantId = user?.restaurantUsername ?? "";
    const applies = isWaiterOnly(user) && restaurantId !== "";

    const [clockedIn, setClockedIn] = React.useState(false);
    const [since, setSince] = React.useState<string | null>(null);
    const [pendingApproval, setPendingApproval] = React.useState(false);
    const [loading, setLoading] = React.useState(true);
    const [nonce, setNonce] = React.useState(0);

    React.useEffect(() => {
        if (!applies) { setClockedIn(true); setLoading(false); return; }
        // A holder rather than a bare `let`: cleanup flips it after the await has
        // already suspended, which a plain boolean read back inside the closure
        // is narrowed away from (the same guard AuthContext uses).
        const live = { current: true };
        setLoading(true);
        void (async () => {
            try {
                const me = await fetchMyShift(restaurantId);
                if (!live.current) { return; }
                setClockedIn(me.clocked_in);
                setSince(me.since);
                setPendingApproval(me.pending_approval === true);
            } catch {
                // FAIL OPEN — see the header. An unreachable attendance service
                // must not close a floor.
                if (live.current) { setClockedIn(true); }
            } finally {
                if (live.current) { setLoading(false); }
            }
        })();
        return () => { live.current = false; };
    }, [applies, restaurantId, nonce]);

    // A shift started in another tab (or in the owner app) counts here too.
    React.useEffect(() => {
        if (!applies) { return; }
        const onFocus = (): void => {
            if (document.visibilityState === "visible") { setNonce((n) => n + 1); }
        };
        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", onFocus);
        return () => {
            window.removeEventListener("focus", onFocus);
            document.removeEventListener("visibilitychange", onFocus);
        };
    }, [applies]);

    const clockIn = React.useCallback(async (): Promise<void> => {
        await toggleClock(restaurantId, true);
        setNonce((n) => n + 1);
    }, [restaurantId]);

    const refresh = React.useCallback((): void => { setNonce((n) => n + 1); }, []);

    return { applies, clockedIn: applies ? clockedIn : true, loading: applies && loading, since, pendingApproval, clockIn, refresh };
}
