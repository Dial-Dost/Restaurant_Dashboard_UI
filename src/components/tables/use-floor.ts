"use client";

/**
 * ONE floor read, shared by the two screens D5 split apart, on the module's
 * standard data discipline: cache-primed useCachedFetch (skeleton while empty,
 * LoadErrorState on failure, stale pill when offline), refreshed silently on
 * the `tables:changed` broadcast and on the server's table-move socket events.
 */

import * as React from "react";

import { useCachedFetch, type CachedFetchResult } from "@/hooks/use-cached-fetch";
import { isTableMoveEvent } from "@/lib/table-move";
import {
    canReadZoneRoster,
    fetchFloor,
    type FloorPayload,
    type FloorRow,
    type FloorSurface,
} from "@/lib/api/tables-floor";
import type { ScopedSession } from "@/lib/session-scope";

export interface FloorSession extends ScopedSession {
    restaurantUsername: string;
    outlet_id: string;
}

export interface UseFloorResult extends CachedFetchResult<FloorPayload> {
    rows: FloorRow[];
    /** Keyed by LOWER-CASED table name. */
    byName: Map<string, FloorRow>;
    zones: string[];
    zoneError: string;
    zoneOrder: Record<string, number>;
    zoneBorn: Record<string, string>;
}

const EMPTY_ROWS: FloorRow[] = [];
const EMPTY_ZONES: string[] = [];
const EMPTY_ORDER: Record<string, number> = {};
const EMPTY_BORN: Record<string, string> = {};

export function useFloor(
    session: FloorSession | null | undefined,
    surface: FloorSurface,
): UseFloorResult {
    const restaurantId = session?.restaurantUsername ?? "";
    const outletId = session?.outlet_id ?? "";
    const canZones = canReadZoneRoster(session);
    const live = surface === "service";

    const fetcher = React.useCallback(
        () => fetchFloor(restaurantId, { live, canReadZones: canZones }),
        [restaurantId, live, canZones],
    );

    const state = useCachedFetch<FloorPayload>(
        `tables-floor:${restaurantId}:${outletId}:${surface}`,
        fetcher,
        { pollMs: 30_000, enabled: restaurantId !== "" },
    );

    const { refresh } = state;
    React.useEffect(() => {
        if (restaurantId === "" || typeof window === "undefined") { return; }
        const onChanged = (): void => { refresh(); };
        const onRealtime = (event: Event): void => {
            const detail = (event as Event & { detail?: { event?: unknown } }).detail;
            if (isTableMoveEvent(detail?.event)) { refresh(); }
        };
        window.addEventListener("tables:changed", onChanged);
        window.addEventListener("realtime:event", onRealtime);
        return () => {
            window.removeEventListener("tables:changed", onChanged);
            window.removeEventListener("realtime:event", onRealtime);
        };
    }, [restaurantId, refresh]);

    const rows = state.data?.rows ?? EMPTY_ROWS;
    const byName = React.useMemo(() => {
        const map = new Map<string, FloorRow>();
        for (const row of rows) { map.set(row.name.toLowerCase(), row); }
        return map;
    }, [rows]);

    return {
        ...state,
        rows,
        byName,
        zones: state.data?.zones ?? EMPTY_ZONES,
        zoneError: state.data?.zoneError ?? "",
        zoneOrder: state.data?.zoneOrder ?? EMPTY_ORDER,
        zoneBorn: state.data?.zoneBorn ?? EMPTY_BORN,
    };
}
