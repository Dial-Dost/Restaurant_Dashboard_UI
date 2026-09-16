"use client";

/*
  THE FLOOR, LOADED ONCE — SHARED BY THE TWO SCREENS D5 SPLIT APART.

  D5: "separate the floor plan from table management. In Floor Plan users can
  rearrange, group tables and modify layout. In the Tables Section users may NOT
  move, change layout, format, or delete tables."

  So there are now two pages — /dashboard/floor-plan (layout) and
  /dashboard/tables (service) — and they read the SAME floor. This hook is that
  read, lifted out of the old fused page verbatim rather than rewritten, so the
  loading order, the failure directions and the reasons for them all survive the
  split. Copying it into both pages instead is how the two screens start
  disagreeing about which zone a table is in.

  The SERVER is what decides both halves and always has: every LAYOUT route is
  gated on "Table Added" / "Table Deleted" / "Manage Table Sections", every
  SERVICE route on "Table Occupied". The waiter core role holds the last one and
  none of the first three — D5, stated as permissions, before either page was
  written. Splitting the screens makes the UI agree with a line the backend was
  already drawing.

  EVERY FAILURE PATH LEAVES THE ROSTER UNKNOWN (null), NEVER EMPTY. Reporting
  "no zones" off a failed read would reconcile every empty zone off the floor:
  the read is not allowed to look like a deletion.
*/

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";

import { getBookings, getTableStatus, getTables, requestBackend } from "@/lib/db";
import { applyServerSections, loadLayout, saveLayout, type TableLayout } from "@/app/dashboard/tables/sections";
import type { Table } from "@/app/dashboard/tables/data";
import { hasPermission, PERM_MANAGE_SECTIONS } from "@/lib/session-scope";
import { roomTables } from "@/lib/next-party";

/**
 * A table that is part of a clubbed ("combined") reservation, as derived from
 * the bookings list: the other tables it is seated together with.
 */
export interface CombinedInfo {
    partners: string[];
    customer: string;
    time: string;
}

export interface TableOccupancy {
    is_occupied: boolean;
    num_covers: number;
    linkedOrderId?: string | null;
}

export interface FloorSession {
    restaurantUsername?: string;
    outlet_id?: string;
    actions_set?: string[];
}

export interface FloorTables {
    /**
     * Every table the server listed — including a next-party seat ("12 #2",
     * client item 6) unless the hook was asked for `roomOnly`.
     */
    tables: Table[];
    /** Keyed by LOWERCASED table name, the way every caller looks a table up. */
    occupancyByName: Record<string, TableOccupancy>;
    /** Keyed by lowercased table name; only tables clubbed with another appear. */
    combinedByName: Record<string, CombinedInfo>;
    /** The zone roster from the server. null = NOT KNOWN, which is not "empty". */
    serverZones: string[] | null;
    /** Remembered card order, reconciled against the server on every render. */
    layout: TableLayout;
    /** Single write path for the layout: state, ref and storage always agree. */
    commitLayout: (next: TableLayout) => void;
    /** Same for the roster. Never persisted — it is the server's list, re-read. */
    commitZones: (next: string[] | null) => void;
    layoutRef: RefObject<TableLayout>;
    serverZonesRef: RefObject<string[] | null>;
    setTables: Dispatch<SetStateAction<Table[]>>;
    reload: () => Promise<void>;
    reloadZones: () => Promise<void>;
}

/**
 * @param session   the signed-in user, for the tenant and the permission gate.
 * @param withOccupancy  service screens need who is sitting where; the layout
 *   screen needs it too, but only to WARN before it destroys an occupied table.
 *   Kept as a switch anyway so a future read-only consumer can skip N status
 *   calls it would never draw.
 * @param roomOnly  the LAYOUT screen's view: a next-party seat is a second name
 *   for a table already in the room, opened when its bill printed and retired
 *   minutes later, so the floor-plan editor never lists, drags or deletes it.
 */
export function useFloorTables(
    session: FloorSession | null | undefined,
    { withOccupancy = true, roomOnly = false }: { withOccupancy?: boolean; roomOnly?: boolean } = {},
): FloorTables {
    const restaurantId = session?.restaurantUsername;
    const outletId = session?.outlet_id;
    /*
      `GET /table-sections` is gated on "Manage Table Sections" — the same
      permission that reveals the add/rename/delete controls — so it is only
      asked for when the user holds it: a waiter would collect a 403 on every
      load and gain nothing, since a zone that HOLDS tables still arrives with
      the tables themselves.
    */
    const canReadZones = hasPermission(session?.actions_set, PERM_MANAGE_SECTIONS);

    const [tables, setTables] = useState<Table[]>([]);
    const [occupancyByName, setOccupancyByName] = useState<Record<string, TableOccupancy>>({});
    const [combinedByName, setCombinedByName] = useState<Record<string, CombinedInfo>>({});
    // Held in a ref as well as state so the reconcile effect can fold the live
    // table list in without taking `layout` as a dependency (which loops).
    const [layout, setLayoutState] = useState<TableLayout>({ sections: [] });
    const layoutRef = useRef<TableLayout>({ sections: [] });
    const [serverZones, setServerZones] = useState<string[] | null>(null);
    const serverZonesRef = useRef<string[] | null>(null);

    const commitLayout = useCallback((next: TableLayout) => {
        layoutRef.current = next;
        setLayoutState(next);
        if (restaurantId) {
            saveLayout(restaurantId, outletId, next);
        }
    }, [restaurantId, outletId]);

    const commitZones = useCallback((next: string[] | null) => {
        serverZonesRef.current = next;
        setServerZones(next);
    }, []);

    useEffect(() => {
        if (!restaurantId) { return; }
        const stored = loadLayout(restaurantId, outletId);
        layoutRef.current = stored;
        setLayoutState(stored);
    }, [restaurantId, outletId]);

    // Fold the server's sections into the remembered arrangement: the roster
    // decides which zones exist, the column decides which zone each table is in,
    // and the stored layout only decides the order. Deleted tables drop out; new
    // ones land under whatever their row says.
    // THE REMEMBERED ARRANGEMENT IS THE ROOM'S. It is shared with the floor-plan
    // screen and kept in storage, so a next-party seat must never enter it: the
    // Tables screen would append "12 #2" to a zone and the floor plan would drop
    // it again on every visit. Seats are placed beside their table at render
    // time instead (withNextPartySeats).
    useEffect(() => {
        if (!restaurantId || tables.length === 0) { return; }
        const reconciled = applyServerSections(layoutRef.current, roomTables(tables), serverZones);
        if (JSON.stringify(reconciled) === JSON.stringify(layoutRef.current)) { return; }
        commitLayout(reconciled);
    }, [tables, serverZones, restaurantId, commitLayout]);

    const reloadZones = useCallback(async () => {
        if (!restaurantId || !canReadZones) {
            commitZones(null);
            return;
        }
        try {
            const response = await requestBackend<{ sections?: { section?: string }[] }>({
                path: "/table-sections",
                method: "GET",
                restaurantId,
            });
            const sections = response.data?.sections;
            if (!response.ok || !Array.isArray(sections)) {
                console.warn("Failed to load the table section roster", response.status, response.text);
                commitZones(null);
                return;
            }
            commitZones(
                sections
                    .map((entry) => (typeof entry.section === "string" ? entry.section.trim() : ""))
                    .filter((name) => name.length > 0),
            );
        } catch (error) {
            console.warn("Failed to load the table section roster", error);
            commitZones(null);
        }
    }, [restaurantId, canReadZones, commitZones]);

    const reload = useCallback(async () => {
        if (!restaurantId) {
            setTables([]);
            setOccupancyByName({});
            commitZones(null);
            return;
        }

        await reloadZones();

        try {
            const data = await getTables(restaurantId);
            /*
              `getTables` maps the row down to the fields the rest of the app uses
              and drops `section`, so the raw row is read once more purely for the
              floor zone. A failure here is not fatal: every table then simply
              renders under "Unassigned" until the next load, and nothing is ever
              written back off the strength of a failed read.
            */
            let sectionByTable: Record<string, string | null> = {};
            try {
                const raw = await requestBackend<{ table_name?: string; section?: string | null }[]>({
                    path: `/get-tables?restaurantId=${encodeURIComponent(restaurantId)}`,
                    method: "GET",
                    restaurantId,
                });
                if (raw.ok && Array.isArray(raw.data)) {
                    sectionByTable = Object.fromEntries(
                        raw.data
                            .filter((row) => typeof row.table_name === "string")
                            .map((row) => [
                                String(row.table_name).toLowerCase(),
                                typeof row.section === "string" && row.section.trim() ? row.section.trim() : null,
                            ]),
                    );
                }
            } catch (sectionError) {
                console.warn("Failed to load table sections", sectionError);
            }

            const nextTables = (Array.isArray(data) ? data : []).map((table) => ({
                ...table,
                section: sectionByTable[table.name.toLowerCase()] ?? null,
            }));
            setTables(nextTables);

            if (withOccupancy) {
                const statusEntries = await Promise.all(
                    nextTables.map(async (table) => {
                        try {
                            const status = await getTableStatus(restaurantId, table.name) as {
                                is_occupied?: unknown;
                                num_covers?: unknown;
                                linked_order_id?: unknown;
                            } | null;
                            const linked = typeof status?.linked_order_id === "string" ? status.linked_order_id.trim() : "";
                            const covers = Number(status?.num_covers ?? table.capacity);
                            const entry: TableOccupancy = {
                                is_occupied: Boolean(status?.is_occupied),
                                num_covers: Math.max(1, Number.isFinite(covers) ? covers : 1),
                                linkedOrderId: linked.length > 0 ? linked : null,
                            };
                            return [table.name.toLowerCase(), entry] as const;
                        } catch {
                            // A status read that failed is not evidence the table is
                            // free: fall back to the row's own status, which is the
                            // last thing the server did say about it.
                            const entry: TableOccupancy = {
                                is_occupied: table.status === "Occupied",
                                num_covers: Math.max(1, table.capacity),
                            };
                            return [table.name.toLowerCase(), entry] as const;
                        }
                    }),
                );
                setOccupancyByName(Object.fromEntries(statusEntries));
            }

            // Clubbed reservations hold several tables under one booking. Mark
            // them on the floor so staff never move one half of a combination.
            try {
                const bookings = await getBookings(restaurantId);
                const combined: Record<string, CombinedInfo> = {};
                for (const booking of Array.isArray(bookings) ? bookings : []) {
                    const names = Array.isArray(booking.table_names) ? booking.table_names : [];
                    if (names.length < 2) { continue; }
                    for (const name of names) {
                        combined[name.toLowerCase()] = {
                            partners: names.filter((other) => other !== name),
                            customer: booking.customer,
                            time: booking.time,
                        };
                    }
                }
                setCombinedByName(combined);
            } catch (bookingError) {
                console.warn("Failed to load combined bookings", bookingError);
                setCombinedByName({});
            }
        } catch (error) {
            console.error("Failed to load tables", error);
            setTables([]);
            setOccupancyByName({});
            setCombinedByName({});
        }
    }, [restaurantId, withOccupancy, reloadZones, commitZones]);

    useEffect(() => {
        if (!restaurantId) { return; }
        reload().catch((error: unknown) => { console.error("Failed to load tables", error); });

        // Both screens, plus the orders page, broadcast this after a write, so a
        // table occupied on one tab redraws on the other without a poll.
        const handler = (): void => {
            reload().catch((err: unknown) => { console.error("tables:changed handler failed", err); });
        };
        if (typeof window !== "undefined") {
            window.addEventListener("tables:changed", handler);
        }
        return () => {
            if (typeof window !== "undefined") { window.removeEventListener("tables:changed", handler); }
        };
    }, [restaurantId, reload]);

    // One array per load, not per render: both screens key memos and effects on it.
    const shownTables = useMemo(() => (roomOnly ? roomTables(tables) : tables), [roomOnly, tables]);

    return {
        tables: shownTables,
        occupancyByName,
        combinedByName,
        serverZones,
        layout,
        commitLayout,
        commitZones,
        layoutRef,
        serverZonesRef,
        setTables,
        reload,
        reloadZones,
    };
}
