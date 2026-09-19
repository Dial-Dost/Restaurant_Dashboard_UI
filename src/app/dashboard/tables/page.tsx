"use client";

/*
  TABLES — D5's SERVICE HALF, drawn in the app's own floor language.

  The whole tile is the control (tap → the table sheet), the tile is washed in
  its state's fixed ink (green Free, amber Seated, red Running, orange Bill
  printed, blue Reserved), the legend counts those same five states in their own
  inks, and the sections render in the SERVER's order with "Unassigned" last.
  Layout acts live on /dashboard/floor-plan; nothing here changes the floor.

  D1 + D2 — the two clocks stay on the card ([web-extra]); the sheet carries the
  app's own "On table / Latest order" chips. Both read the SERVER's `service`
  block (src/lib/service-clock.ts), never a local subtraction.
*/

import * as React from "react";
import Link from "next/link";
import { LayoutGrid, HelpCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { SectionHeader } from "@/components/ui/section-header";
import { SkeletonBox } from "@/components/ui/fork-skeleton";
import { CacheStalePill } from "@/components/ui/stale-pill";
import { InfoChip, StatusChip } from "@/components/ui/status-chip";
import { FocusBanner, useFocusRequest } from "@/components/focus-banner";
import { LiveGrossBar } from "@/components/live-gross";
import { FloorColourKey, FloorLegendChip, useFloorInks } from "@/components/tables/floor-chips";
import { TableBox } from "@/components/tables/table-box";
import { TableSheet } from "@/components/tables/table-sheet";
import { useFloor } from "@/components/tables/use-floor";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/hooks/use-currency";
import { useTimezone } from "@/lib/use-timezone";
import { getOrders, moveOrderToTable, moveTableParty } from "@/lib/db";
import { isRefusedAction } from "@/lib/error-message";
import { canOpenFloorPlan } from "@/lib/session-scope";
import { announceReprintNeeded, readReprintNeeded } from "@/lib/reprint-needed";
import {
    isTableMoveEvent,
    movedPartySentence,
    partyMoveDestinations,
    refreshAfterTableMove,
} from "@/lib/table-move";
import type { ServiceClockCarrier } from "@/lib/service-clock";
import { visibleMoneyText } from "@/lib/order-prices";
import { OrderPad, type OrderPadRequest } from "@/components/order-pad/order-pad";
import {
    floorLegend,
    floorScopeOf,
    isNextPartyRow,
    moveOrderKitchenHas,
    moveOrderKitchenSentence,
    moveOrderTitle,
    movedDishesOf,
    movedOrderDishesSentence,
    orderDishLines,
    printedBacklogFilterOn,
    printedPartyMoveNote,
    sameTableFamily,
    seatsLabel,
    tableSentenceName,
    tableSentenceNameOf,
    composeFloorSections,
    type FloorRow,
    type FloorTileState,
} from "@/lib/api/tables-floor";

/*
  The slice of an order this page reads — deliberately NOT the orders page's own
  `Order` type (importing it drags the whole orders screen into this bundle).
*/
interface TableOrder extends ServiceClockCarrier {
    id: string;
    table: string;
    status: string;
    kot_nos?: number[] | null;
    created_at?: string | null;
    barked_at?: string | null;
    items?: { id?: string | null; name: string; quantity: number; price?: number; note?: string | null }[] | null;
    total?: unknown;
}

/*
  D3 + D4 — the party move and the single-ticket move, one dialog. Each order
  block names the ticket the way the pass knows it, lists its dishes, says
  whether the kitchen has it, and spells the kitchen consequence before the
  button — the same sentences the owner app builds in order_moves.dart.
*/
function MoveTableDialog({
    open,
    onOpenChange,
    row,
    allRows,
    orders,
    mayMoveParty,
    mayMoveOrder,
    showsMoney,
    currencySymbol,
    busy,
    onMoveParty,
    onMoveOrder,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    row: FloorRow | null;
    allRows: FloorRow[];
    orders: TableOrder[];
    mayMoveParty: boolean;
    mayMoveOrder: boolean;
    showsMoney: boolean;
    currencySymbol: string;
    busy: boolean;
    onMoveParty: (toTable: string, destinationSentence: string) => void;
    onMoveOrder: (order: TableOrder, toTable: string) => void;
}): React.JSX.Element | null {
    const [partyDestination, setPartyDestination] = React.useState("");
    const [orderDestinations, setOrderDestinations] = React.useState<Record<string, string>>({});

    // Reopening on a different table must not carry the previous table's
    // destination across.
    React.useEffect(() => {
        setPartyDestination("");
        setOrderDestinations({});
    }, [row?.name, open]);

    const sourceName = row?.name ?? "";
    const covers = row?.covers ?? row?.capacity ?? 1;
    const byName = React.useMemo(() => {
        const map = new Map<string, FloorRow>();
        for (const r of allRows) { map.set(r.name.toLowerCase(), r); }
        return map;
    }, [allRows]);
    const isSeated = React.useCallback(
        (name: string): boolean => byName.get(name.toLowerCase())?.seated === true,
        [byName],
    );

    // Free tables that seat the covers — and never the source's own table
    // family ("12" cannot move to "12 #2").
    const partyOptions = React.useMemo(() => {
        if (row === null) { return []; }
        const candidates = allRows.filter((r) => !sameTableFamily(row.raw, r.raw));
        return partyMoveDestinations(candidates, isSeated, sourceName, covers);
    }, [allRows, row, isSeated, sourceName, covers]);

    const orderOptions = React.useMemo(
        () => allRows.filter((r) => r.name !== "" && r.name.toLowerCase() !== sourceName.toLowerCase()),
        [allRows, sourceName],
    );

    if (row === null) { return null; }
    const from = tableSentenceNameOf(row.raw);
    const partyTo = partyDestination === "" ? "" : tableSentenceName(partyDestination);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Move from {from}</DialogTitle>
                    <DialogDescription>
                        Move the whole party to another table, or send one mis-keyed order to the table it
                        should have been rung in on.
                    </DialogDescription>
                </DialogHeader>

                {mayMoveParty ? (
                    <div className="space-y-2 border-b border-divider pb-4">
                        <div className="micro-label">Move the whole party</div>
                        {partyOptions.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                                No free table seats {covers} right now. Free one up, or raise its max seats.
                            </p>
                        ) : (
                            <>
                                <Select value={partyDestination} onValueChange={setPartyDestination}>
                                    <SelectTrigger><SelectValue placeholder="Move the party to…" /></SelectTrigger>
                                    <SelectContent>
                                        {partyOptions.map((option) => {
                                            const raw = byName.get(option.name.toLowerCase())?.raw ?? {};
                                            return (
                                                <SelectItem key={option.name} value={option.name}>
                                                    Table {tableSentenceName(option.name)} — {seatsLabel(raw) || `max ${String(option.max_capacity)}`}
                                                </SelectItem>
                                            );
                                        })}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    The guests, their {covers} cover{covers === 1 ? "" : "s"}, every order and the
                                    running bill move together. {from} becomes free.
                                    {row.printed && partyDestination !== ""
                                        ? ` ${printedPartyMoveNote(from, partyTo)}`
                                        : ""}
                                </p>
                                <Button
                                    className="w-full"
                                    disabled={busy || partyDestination === ""}
                                    onClick={() => { onMoveParty(partyDestination, partyTo); }}
                                >
                                    Move everything to {partyTo || "…"}
                                </Button>
                            </>
                        )}
                    </div>
                ) : null}

                {mayMoveOrder ? (
                    <div className="space-y-3">
                        <div className="micro-label">Move one order to the right table</div>
                        {orders.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                                No live order on this table to move.
                            </p>
                        ) : orderOptions.length === 0 ? (
                            <p className="text-xs text-muted-foreground">There is no other table to move it to.</p>
                        ) : (
                            orders.map((order) => {
                                const raw = order as unknown as Record<string, unknown>;
                                const title = moveOrderTitle(raw);
                                const dishes = orderDishLines(raw);
                                const kitchenHas = moveOrderKitchenHas(raw);
                                const total = Number(order.total);
                                const totalText = showsMoney && Number.isFinite(total)
                                    ? visibleMoneyText(currencySymbol, total)
                                    : null;
                                const destination = orderDestinations[order.id] ?? "";
                                return (
                                    <div key={order.id} className="space-y-1.5 rounded-md border border-border p-2.5">
                                        <div className="flex items-center justify-between gap-2 text-xs">
                                            <span className="font-semibold text-foreground">
                                                {totalText !== null ? `${title} · ${totalText}` : title}
                                            </span>
                                            <Badge variant="outline" className="text-[10px]">{order.status}</Badge>
                                        </div>
                                        {dishes.length > 0 ? (
                                            <p className="text-[11px] leading-snug text-muted-foreground">{dishes.join(", ")}</p>
                                        ) : null}
                                        <p className="text-[11px] font-medium text-muted-foreground">
                                            {kitchenHas ? "The kitchen has this one" : "Not sent to the kitchen yet"}
                                        </p>
                                        <Select
                                            value={destination}
                                            onValueChange={(value) => {
                                                setOrderDestinations((prev) => ({ ...prev, [order.id]: value }));
                                            }}
                                        >
                                            <SelectTrigger className="h-8 text-xs">
                                                <SelectValue placeholder="Move this order to…" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {orderOptions.map((option) => (
                                                    <SelectItem key={option.name} value={option.name}>
                                                        Table {option.name} — {option.seated ? "Seated" : "Free — this will seat it"}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <p className="text-[11px] leading-snug text-muted-foreground">
                                            {moveOrderKitchenSentence({
                                                fromTable: row.name,
                                                toTable: destination === "" ? "the new table" : destination,
                                                barked: kitchenHas,
                                            })}
                                        </p>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-8 w-full text-xs"
                                            disabled={busy || destination === ""}
                                            onClick={() => { onMoveOrder(order, destination); }}
                                        >
                                            Move this order to {destination || "…"}
                                        </Button>
                                    </div>
                                );
                            })
                        )}
                    </div>
                ) : null}

                <DialogFooter>
                    <Button variant="ghost" onClick={() => { onOpenChange(false); }}>Close</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/** Skeleton floor: a header line and two zones of grey tiles. */
function FloorSkeleton(): React.JSX.Element {
    return (
        <div className="space-y-4" data-testid="floor-skeleton">
            <SkeletonBox width={220} height={22} />
            {[0, 1].map((zone) => (
                <div key={zone} className="rounded-lg border border-border bg-inset p-3">
                    <SkeletonBox width={160} height={14} />
                    <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <SkeletonBox key={i} height={128} />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

export default function TablesPage(): React.JSX.Element {
    const { user } = useAuth();
    const { toast } = useToast();
    const { currencySymbol } = useCurrency();
    const { timezone } = useTimezone();
    const inks = useFloorInks();

    const floor = useFloor(user, "service");
    const { rows, byName, zones, zoneError, zoneOrder, zoneBorn } = floor;
    const scope = React.useMemo(() => floorScopeOf(user ?? undefined, "service"), [user]);

    const [busy, setBusy] = React.useState(false);
    const [sheetName, setSheetName] = React.useState<string | null>(null);
    const [moveTableName, setMoveTableName] = React.useState<string | null>(null);
    // The staff order pad, opened in place from the table sheet.
    const [padRequest, setPadRequest] = React.useState<OrderPadRequest | null>(null);
    const [printedFilterAsked, setPrintedFilterAsked] = React.useState(false);
    const [orders, setOrders] = React.useState<TableOrder[]>([]);

    /* ── The orders behind the table sheet (SERVER-owned durations) ── */
    // tables-floor.md ~120: the Flutter tile carries NO timers — the "On
    // table" / "Latest order" chips live in the table sheet, which ticks its own.

    const ordersActiveRef = React.useRef(true);
    const reloadOrders = React.useCallback(async (): Promise<void> => {
        if (!user?.restaurantUsername) { return; }
        try {
            const list = await getOrders(user.restaurantUsername);
            if (ordersActiveRef.current) { setOrders(Array.isArray(list) ? list : []); }
        } catch (error: unknown) {
            console.warn("Failed to load orders for the table clocks", error);
        }
    }, [user?.restaurantUsername]);
    const { refresh } = floor;
    React.useEffect(() => {
        if (!user?.restaurantUsername) { return; }
        ordersActiveRef.current = true;
        const pull = (): void => { void reloadOrders(); };
        const onRealtime = (event: Event): void => {
            if (!isTableMoveEvent((event as Event & { detail?: { event?: unknown } }).detail?.event)) { return; }
            void refreshAfterTableMove({ tables: () => { refresh(); return Promise.resolve(); }, orders: reloadOrders });
        };
        pull();
        const id = setInterval(pull, 20000);
        window.addEventListener("tables:changed", pull);
        window.addEventListener("realtime:event", onRealtime);
        return () => {
            ordersActiveRef.current = false;
            clearInterval(id);
            window.removeEventListener("tables:changed", pull);
            window.removeEventListener("realtime:event", onRealtime);
        };
    }, [user?.restaurantUsername, reloadOrders, refresh]);

    /* ── Focus request ("Open T4" from a notification) ─────────────── */
    const focus = useFocusRequest();
    const focusTable = focus?.tableName ?? focus?.idOf(["table_name"]) ?? null;
    const focusFound = focusTable !== null && rows.some((r) => r.name === focusTable);

    /* ── The five-state legend, counted off the tiles' own rule ────── */
    // An idle next-party seat is not a free TABLE (the root is already
    // counted) and it carries the root's booking — so Free/Reserved
    // next-party rows are left out of the count.
    const floorStates = React.useMemo<FloorTileState[]>(
        () => rows
            .filter((r) => !(isNextPartyRow(r.raw) && (r.state === "free" || r.state === "reserved")))
            .map((r) => r.state),
        [rows],
    );
    const filterOn = printedBacklogFilterOn(printedFilterAsked, floorStates);
    // The last printed bill settled with the filter on: the floor already
    // reads it as off; the REQUEST itself is dropped too (the app's
    // PrintedBacklogFilter does the same), so a later print does not
    // silently re-narrow the floor.
    React.useEffect(() => {
        if (printedFilterAsked && !floorStates.includes("printed")) {
            setPrintedFilterAsked(false);
        }
    }, [printedFilterAsked, floorStates]);
    const shownRows = React.useMemo(
        () => (filterOn ? rows.filter((r) => r.state === "printed") : rows),
        [rows, filterOn],
    );

    const sections = React.useMemo(
        () => composeFloorSections(shownRows, zones, zoneOrder, zoneBorn, {
            // An empty zone has no backlog, so the filter hides it.
            includeEmptyZones: !filterOn,
        }),
        [shownRows, zones, zoneOrder, zoneBorn, filterOn],
    );

    const legendChips = React.useMemo(
        () => floorLegend(floorStates, true).map((row) => (
            <FloorLegendChip
                key={row.state}
                state={row.state}
                label={row.label}
                inks={inks}
                filterOn={filterOn}
                onToggleFilter={row.state === "printed"
                    ? () => { setPrintedFilterAsked((v) => !v); }
                    : undefined}
            />
        )),
        [floorStates, inks, filterOn],
    );

    /* ── Moves ─────────────────────────────────────────────────────── */
    const moveRow = moveTableName !== null ? byName.get(moveTableName.toLowerCase()) ?? null : null;
    const liveOrdersFor = (tableName: string): TableOrder[] =>
        orders.filter((order) =>
            (order.table || "").toLowerCase() === tableName.toLowerCase()
            && order.status !== "Cancelled"
            && order.status !== "Closed");

    const reloadBoth = React.useCallback(async (): Promise<void> => {
        await refreshAfterTableMove({ tables: () => { refresh(); return Promise.resolve(); }, orders: reloadOrders });
    }, [refresh, reloadOrders]);

    const handleMoveParty = async (toTable: string): Promise<void> => {
        if (!user?.restaurantUsername || moveTableName === null) { return; }
        const fromTable = moveTableName;
        setBusy(true);
        try {
            const result = await moveTableParty(user.restaurantUsername, fromTable, toTable);
            if (isRefusedAction(result)) {
                toast({ title: "Party not moved", description: result.error, variant: "destructive" });
                return;
            }
            // A printed party's destination gets its own green seat; the server
            // names it (next_party_message) and the toast passes it on.
            const said = (result as unknown as Record<string, unknown>).next_party_message;
            const seat = typeof said === "string" ? said.trim() : "";
            toast({
                title: "Party moved",
                description: movedPartySentence(result.from_table, result.to_table, result.moved_orders)
                    + (seat === "" ? "" : ` ${seat}`),
            });
            const reprints = readReprintNeeded(result);
            if (reprints.length > 0) { announceReprintNeeded(reprints); }
            setMoveTableName(null);
            await reloadBoth();
        } catch (error: unknown) {
            toast({
                title: "Unable to move the party",
                description: error instanceof Error ? error.message : "The move did not go through.",
                variant: "destructive",
            });
        } finally {
            setBusy(false);
        }
    };

    const handleMoveOrder = async (order: TableOrder, toTable: string): Promise<void> => {
        if (!user?.restaurantUsername || moveTableName === null) { return; }
        setBusy(true);
        try {
            const result = await moveOrderToTable(user.restaurantUsername, order.id, toTable);
            if (isRefusedAction(result)) {
                toast({ title: "Order not moved", description: result.error, variant: "destructive" });
                return;
            }
            const served = movedDishesOf(result);
            toast({
                title: "Order moved",
                description: movedOrderDishesSentence({
                    toTable: result.to_table,
                    printed: result.print?.printed === true,
                    kotNo: result.print?.kot_no,
                    dishes: served.length > 0 ? served : orderDishLines(order as unknown as Record<string, unknown>),
                }),
            });
            // A move between printed bills names the reprints it caused; the
            // shell's listener asks "Print the updated bill?" per table.
            const reprints = readReprintNeeded(result);
            if (reprints.length > 0) { announceReprintNeeded(reprints); }
            setMoveTableName(null);
            await reloadBoth();
        } catch (error: unknown) {
            toast({
                title: "Unable to move that order",
                description: error instanceof Error ? error.message : "The move did not go through.",
                variant: "destructive",
            });
        } finally {
            setBusy(false);
        }
    };

    /* ── Render ────────────────────────────────────────────────────── */
    const showFloorPlanLink = canOpenFloorPlan(user);
    const sheetRow = sheetName !== null ? byName.get(sheetName.toLowerCase()) ?? null : null;

    const header = (
        <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
                <h1 className="text-lg font-semibold md:text-2xl">Tables</h1>
                <p className="text-sm text-muted-foreground">
                    Seat parties, correct covers, release tables and open their orders.
                </p>
            </div>
            {showFloorPlanLink ? (
                <Button variant="outline" asChild>
                    <Link href="/dashboard/floor-plan">
                        <LayoutGrid className="mr-2 h-4 w-4" />
                        Edit floor plan
                    </Link>
                </Button>
            ) : null}
        </div>
    );

    if (!user) {
        return <div className="grid gap-4 md:gap-8">{header}<FloorSkeleton /></div>;
    }

    if (floor.loading) {
        return <div className="grid gap-4 md:gap-8">{header}<FloorSkeleton /></div>;
    }

    if (floor.error != null) {
        return (
            <div className="grid gap-4 md:gap-8">
                {header}
                <LoadErrorState
                    whatFailed="Couldn't load the floor."
                    error={floor.error}
                    onRetry={floor.retry}
                />
            </div>
        );
    }

    return (
        <div className="relative grid gap-4 md:gap-8">
            {header}

            {focus !== null ? (
                <FocusBanner
                    found={focusFound}
                    message={focusFound
                        ? `Highlighted ${focusTable} — tap it to manage the bill.`
                        : `${focusTable ?? "That table"} is not on this floor plan — it may have been removed, or belong to another outlet.`}
                    onDismiss={focus.dismiss}
                    showAllLabel="Show all tables"
                />
            ) : null}

            {/* H5/6.4 — the live gross ABOVE the tables. */}
            <LiveGrossBar rid={user.restaurantUsername} />

            {rows.length === 0 && zones.length === 0 ? (
                <EmptyState
                    icon={<LayoutGrid />}
                    title="No tables on the floor yet."
                    caption={showFloorPlanLink
                        ? "Tables are added on the floor plan."
                        : "Ask an admin to add them on the floor plan."}
                    action={showFloorPlanLink ? (
                        <Button variant="outline" asChild>
                            <Link href="/dashboard/floor-plan">Open floor plan</Link>
                        </Button>
                    ) : undefined}
                />
            ) : (
                <div className="space-y-3">
                    {/* The counted legend for a senior; the count-free colour key
                        for a waiter (no floor summary). Below 620px the legend
                        drops under the title. */}
                    {scope.floorSummary ? (
                        <>
                            <SectionHeader
                                title="Tables"
                                count={rows.length}
                                trailing={(
                                    <div className="hidden flex-wrap items-center gap-1.5 min-[620px]:flex">
                                        {legendChips}
                                    </div>
                                )}
                            />
                            <div className="flex flex-wrap items-center gap-1.5 min-[620px]:hidden">
                                {legendChips}
                            </div>
                        </>
                    ) : (
                        <FloorColourKey inks={inks} />
                    )}

                    {zoneError !== "" ? (
                        <div className="flex items-center gap-2.5 rounded-md border border-warning/28 bg-warning/12 px-3.5 py-2.5">
                            <p className="min-w-0 flex-1 text-xs text-warning">
                                Section list unavailable — sections with no tables in them are missing from this floor plan. {zoneError}
                            </p>
                            <Button variant="outline" size="sm" onClick={() => { floor.refresh(); }}>Retry</Button>
                        </div>
                    ) : null}

                    {sections.map((section) => (
                        <div
                            key={section.key === "" ? "::unassigned" : section.key}
                            className="rounded-lg border border-border bg-inset p-3 pb-3.5 gaia:rounded-[2px]"
                        >
                            <div className="flex flex-wrap items-center gap-2">
                                {section.key === ""
                                    ? <HelpCircle aria-hidden className="h-[15px] w-[15px] shrink-0 text-muted-foreground" />
                                    : <LayoutGrid aria-hidden className="h-[15px] w-[15px] shrink-0 text-muted-foreground" />}
                                <span className="text-[11px] font-bold uppercase tracking-[0.8px] text-muted-foreground">
                                    {section.name}
                                </span>
                                {section.rows.length === 0 && section.key !== "" ? (
                                    <StatusChip status="neutral" label="Empty" dense />
                                ) : (
                                    <>
                                        <InfoChip label={`${String(section.rows.length)} ${section.rows.length === 1 ? "table" : "tables"}`} />
                                        <InfoChip label={`${String(section.rows.reduce((n, r) => n + r.capacity, 0))} seats`} />
                                    </>
                                )}
                            </div>
                            <div className="mt-3">
                                {section.rows.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">Nothing here yet.</p>
                                ) : (
                                    <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
                                        {section.rows.map((row) => (
                                            <TableBox
                                                key={row.name}
                                                row={row}
                                                inks={inks}
                                                focused={focusTable !== null && row.name === focusTable}
                                                showsMoney={scope.money}
                                                maySettle={scope.settle}
                                                currencySymbol={currencySymbol}
                                                timeZone={timezone}
                                                onOpen={(r) => { setSheetName(r.name); }}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <CacheStalePill offline={floor.offline} fromCache={floor.fromCache} updatedAt={floor.updatedAt} />

            <TableSheet
                open={sheetRow !== null}
                onOpenChange={(open) => { if (!open) { setSheetName(null); } }}
                row={sheetRow}
                allRows={rows}
                inks={inks}
                user={user}
                orders={orders}
                onReload={() => { refresh(); void reloadOrders(); }}
                onOpenMove={(tableName) => { setMoveTableName(tableName); }}
                onOpenPad={setPadRequest}
            />

            {padRequest !== null && user.restaurantUsername ? (
                <OrderPad
                    request={padRequest}
                    restaurantId={user.restaurantUsername}
                    onClose={() => { setPadRequest(null); }}
                    onSent={() => { refresh(); void reloadOrders(); }}
                />
            ) : null}

            <MoveTableDialog
                open={moveTableName !== null}
                onOpenChange={(next) => { if (!next) { setMoveTableName(null); } }}
                row={moveRow}
                allRows={rows}
                orders={moveTableName !== null ? liveOrdersFor(moveTableName) : []}
                mayMoveParty={scope.moveTable}
                mayMoveOrder={scope.moveOrder}
                showsMoney={scope.money}
                currencySymbol={currencySymbol}
                busy={busy}
                onMoveParty={(toTable) => { void handleMoveParty(toTable); }}
                onMoveOrder={(order, toTable) => { void handleMoveOrder(order, toTable); }}
            />
        </div>
    );
}
