"use client";

/*
  TABLES — D5's SERVICE HALF. NOTHING ON THIS PAGE CHANGES THE FLOOR PLAN.

  D5: "In the Tables Section users may NOT move, change layout, format, or delete
  tables."

  This page used to be both screens at once: the same card carried a drag grip, a
  Delete, an Edit seating, a covers box, Occupy, Release and Take Orders. Every
  layout act has moved to /dashboard/floor-plan; what is left is the job the
  floor actually does all night — seat a party, correct the covers, release the
  table, open its orders. There is no grip, no Add Table, no section editing, and
  — C7/H8 — no Delete anywhere on it.

  THE SPLIT IS THE SERVER'S, NOT A UI CONVENTION. Every route this page calls
  (/get-tables, /table-status, /occupy-table, /release-table, /table-covers)
  rides on the "Table Occupied" permission, which the core waiter role holds;
  every route the floor-plan page calls rides on "Table Added", "Table Deleted"
  or "Manage Table Sections", which it does not. Removing the layout controls
  from here removes controls that were already refusing for most of the people
  looking at them.

  D1 + D2 — THE TWO CLOCKS, AND THE SERVER OWNS THEM.
  D1, the "barking" time: how long since the order was placed, so a waiter can
  see the table that is waiting. D2: the live duration from the order to bill
  settlement, freezing at the real figure once the bill closes.

  Both are read off the SERVER's `service` block (`src/lib/service-clock.ts`),
  not subtracted here. They used to be `Date.now() - created_at` in this file
  while the owner app did its own version — one rule, two implementations, which
  is how the same table reads 40 minutes on the laptop and 30 on the phone. The
  backend measures it once, against its own clock, which also means a floor
  laptop whose clock is ten minutes fast no longer paints the whole floor late.

  ZONES ARE STILL SHOWN, and that is not a layout control: a waiter needs to know
  the Patio from the Main Hall to walk to the right table. They are headings
  here. Rearranging them is the other page.
*/

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LiveGrossBar } from "@/components/live-gross";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Users, Link2, LayoutGrid, Clock, Timer, ArrowRightLeft } from "lucide-react";
import { type Table } from "./data";
import { applyServerSections, isUnassignedSection } from "./sections";
import { seatingLeftTableUnattended } from "@/lib/table-assignment";
import { isRefusedAction } from "@/lib/error-message";
import {
    occupyTable,
    releaseTable,
    updateTableCovers,
    getOrders,
    moveTableParty,
    moveOrderToTable,
} from "@/lib/db";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useFloorTables, type CombinedInfo, type TableOccupancy } from "@/hooks/use-floor-tables";
import { canMoveOrderToTable, canMoveTableParty, canOpenFloorPlan } from "@/lib/session-scope";
import {
    isTableMoveEvent,
    kotTicketLabel,
    movedOrderSentence,
    movedPartySentence,
    orderMoveDestinations,
    partyMoveDestinations,
    refreshAfterTableMove,
} from "@/lib/table-move";
import {
    elapsedSincePlaced,
    elapsedToSettlement,
    formatDuration,
    latestAsOfMs,
    monotonicNow,
    tableServiceClockOf,
    waitTone,
    type ServiceClockCarrier,
} from "@/lib/service-clock";

/*
  The slice of an order this page reads, and nothing more.

  Deliberately NOT the orders page's own `Order` type: that lives in a 4,000-line
  client module and importing it here drags the whole orders screen into this
  bundle to borrow three fields. `ServiceClockCarrier` names the one the clocks
  need — the SERVER's `service` block — and these two are what turns a list of
  orders into a per-TABLE clock.
*/
interface TableOrder extends ServiceClockCarrier {
    table: string;
    status: string;
    /*
      D4 — the two fields a KOT reassignment needs, and no more.

      `id` is what POST /tables/move-order is addressed by. `kot_nos` is the
      handle the pass quotes, drawn beside each order in the move dialog so the
      person pressing the button is looking at the same number the kitchen is —
      moving "the 19:42 one" is how the wrong ticket gets moved. Absent on a
      backend older than the field, which `kotTicketLabel` reads as "draw
      nothing".
    */
    id: string;
    kot_nos?: number[] | null;
}

/** The two clocks a table card shows, already reduced from its orders. */
interface TableClocks {
    /** D1 — ms since the OLDEST unserved order on this table was placed. */
    sincePlacedMs: number;
    /** D2 — ms from that order to settlement; still counting unless `settled`. */
    spanMs: number;
    settled: boolean;
}

const TONE_CLASS: Record<ReturnType<typeof waitTone>, string> = {
    calm: "border-slate-600 text-slate-300",
    watch: "border-amber-500 text-amber-400",
    late: "border-red-500 text-red-400",
};

/*
  D3 + D4 — MOVING A LIVE PARTY, AND MOVING ONE MIS-KEYED TICKET.

  ============================================================================
  WHY BOTH OF THESE ARE ON THE TABLES PAGE AND NOT ON THE FLOOR PLAN
  ============================================================================
  This page's header states the split D5 asks for: /dashboard/floor-plan is the
  LAYOUT screen (add, rename, delete, rearrange, zone), /dashboard/tables is the
  SERVICE screen (seat, correct the covers, release, open the orders). The test
  that decides which side a control belongs on is NOT "does it involve tables" —
  every control on both pages involves tables. It is the one the header already
  gives and the one the SERVER draws:

      LAYOUT acts ride on "Table Added" / "Table Deleted" / "Manage Table
      Sections". SERVICE acts ride on "Table Occupied".

  POST /tables/move is gated on 090ea8d4 — "Table Occupied", the SERVICE
  permission, the one the core waiter role holds and the same id behind Occupy,
  Release and Covers on the cards above. The backend's own comment above that
  route says why in as many words: "service, not administration; the person who
  sat them down is the person who moves them." Putting it on the floor plan would
  contradict the permission it actually rides on and would hide it from the
  waiter it was gated for.

  And it does not change the floor: after a move there are exactly as many
  tables, in the same zones, in the same places. WHAT MOVED IS THE PARTY — their
  covers, their orders, their bill, their waiter, their booking. That is a
  service act performed on a room whose layout is untouched, which is precisely
  the line D5 draws. A floor plan with a table missing out of it is not a floor
  plan; a floor plan whose guests have walked to another table is the same floor
  plan.

  D4's order move is on the same page for the mirror reason: it rides on "Add
  Orders" (4ad474d4), the everyday floor permission, it is a correction to a
  TICKET rather than to the room, and it is reached from the very order list this
  page already opens.

  ============================================================================
  TWO ACTS, ONE DIALOG, AND THEY ARE NOT INTERCHANGEABLE
  ============================================================================
  Moving the PARTY takes everything with them and frees the source table.
  Moving an ORDER takes one ticket and leaves the party exactly where they are.
  Confusing the two costs money in opposite directions, so each half names its
  own consequences before it runs — the same wording the owner app uses, because
  a restaurant running both must not be taught two different things about one
  act.

  THE CONFIRMATION IS THE INTERACTION. Neither call is idempotent and neither is
  queueable offline (routes/tables.ts argues both at length), so there is no undo
  and no retry: the sentence in front of the button is the last point at which a
  mistake is cheap.
*/
function MoveTableDialog({
    open,
    onOpenChange,
    table,
    covers,
    allTables,
    isSeated,
    orders,
    mayMoveParty,
    mayMoveOrder,
    busy,
    onMoveParty,
    onMoveOrder,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    table: Table | null;
    covers: number;
    allTables: Table[];
    isSeated: (tableName: string) => boolean;
    orders: TableOrder[];
    mayMoveParty: boolean;
    mayMoveOrder: boolean;
    busy: boolean;
    onMoveParty: (toTable: string) => void;
    onMoveOrder: (orderId: string, toTable: string) => void;
}): ReactElement | null {
    const [partyDestination, setPartyDestination] = useState("");
    const [orderDestinations, setOrderDestinations] = useState<Record<string, string>>({});

    // Reopening on a different table must not carry the previous table's
    // destination across — the commonest way a confirmed move lands somewhere
    // nobody chose.
    useEffect(() => {
        setPartyDestination("");
        setOrderDestinations({});
    }, [table?.name, open]);

    const sourceName = table?.name ?? "";
    const partyOptions = useMemo(
        () => partyMoveDestinations(allTables, isSeated, sourceName, covers),
        [allTables, isSeated, sourceName, covers],
    );
    const orderOptions = useMemo(
        () => orderMoveDestinations(allTables, sourceName),
        [allTables, sourceName],
    );

    if (!table) { return null; }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Move from {table.name}</DialogTitle>
                    <DialogDescription>
                        Move the whole party to another table, or send one mis-keyed order to the table it
                        should have been rung in on.
                    </DialogDescription>
                </DialogHeader>

                {mayMoveParty ? (
                    <div className="space-y-2 border-b pb-4">
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                            Move the whole party
                        </Label>
                        {partyOptions.length === 0 ? (
                            /* The server refuses an occupied destination by name (it answers
                               400 and the message names Merge) and refuses one too small for
                               the covers, so offering either here and then explaining the
                               refusal would be a worse way to teach the same thing than not
                               offering it. When nothing fits, say what would fix it. */
                            <p className="text-xs text-muted-foreground">
                                No free table seats {covers} right now. Free one up, or raise its max seats on the
                                floor plan.
                            </p>
                        ) : (
                            <>
                                <Select value={partyDestination} onValueChange={setPartyDestination}>
                                    <SelectTrigger><SelectValue placeholder="Move the party to…" /></SelectTrigger>
                                    <SelectContent>
                                        {partyOptions.map((option) => (
                                            <SelectItem key={option.name} value={option.name}>
                                                {option.name} — seats {option.max_capacity}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {/* NAMED CONSEQUENCES, because this moves money as well as
                                    people. One transaction on the server: a party half-moved
                                    would split the bill, make the floor lie about who is
                                    sitting where, and count the covers behind APC against a
                                    table nobody is at. */}
                                <p className="text-xs text-muted-foreground">
                                    The guests, their {covers} cover{covers === 1 ? "" : "s"}, every order and the
                                    running bill move together. {table.name} becomes free.
                                </p>
                                <Button
                                    className="w-full"
                                    disabled={busy || partyDestination === ""}
                                    onClick={() => { onMoveParty(partyDestination); }}
                                >
                                    Move everything to {partyDestination || "…"}
                                </Button>
                            </>
                        )}
                    </div>
                ) : null}

                {mayMoveOrder ? (
                    <div className="space-y-3">
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                            Move one order to the right table
                        </Label>
                        {orders.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                                There are no live orders on {table.name} to move.
                            </p>
                        ) : orderOptions.length === 0 ? (
                            <p className="text-xs text-muted-foreground">There is no other table to move it to.</p>
                        ) : (
                            orders.map((order) => {
                                const kot = kotTicketLabel(order.kot_nos);
                                const destination = orderDestinations[order.id] ?? "";
                                return (
                                    <div key={order.id} className="space-y-1.5 rounded-md border p-2">
                                        <div className="flex items-center justify-between gap-2 text-xs">
                                            {/* The KOT number, where there is one. This is the handle
                                                the pass quotes; picking an order by its position in a
                                                list is how the wrong ticket gets moved. */}
                                            <span className="font-medium">{kot || `Order ${order.id}`}</span>
                                            <Badge variant="outline" className="text-[10px]">{order.status}</Badge>
                                        </div>
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
                                                {/* EVERY other table, occupied included — a mis-keyed
                                                    ticket usually belongs to a table that already has
                                                    guests on it, and the party at THIS table stays
                                                    seated either way. */}
                                                {orderOptions.map((option) => (
                                                    <SelectItem key={option.name} value={option.name}>
                                                        {option.name} — {isSeated(option.name) ? "seated" : "free, this will seat it"}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        {/* WHAT THE KITCHEN SEES is the half that makes this safe, so
                                            it is said before anything happens. If the docket is
                                            already on the pass it is paper for the wrong table, and
                                            the server prints a correction carrying the SAME KOT
                                            number so the two can be paired. If it was never printed
                                            there is nothing to correct and nothing prints. */}
                                        <p className="text-[11px] leading-snug text-muted-foreground">
                                            {kot
                                                ? `The kitchen already has ${kot} for ${table.name}, so a correction docket prints at the new table with the same number. ${table.name} keeps its guests and its other orders.`
                                                : `The kitchen has not been sent this order yet, so nothing prints now — it will print at the new table when it is sent.`}
                                        </p>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="w-full h-8 text-xs"
                                            disabled={busy || destination === ""}
                                            onClick={() => { onMoveOrder(order.id, destination); }}
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

/*
  ONE TABLE, AS A PLACE PEOPLE ARE SITTING.

  Everything on it is a SERVICE act. The props it does not take are as much the
  point as the ones it does: no onRemove, no onEdit, no drag listeners.
*/
function ServiceTable({
    table,
    occupancy,
    combined,
    clocks,
    onOpenOrders,
    onOccupy,
    onRelease,
    onUpdateCovers,
    onMove,
    canMove,
    busyTableName,
}: {
    table: Table;
    occupancy: TableOccupancy | null;
    combined?: CombinedInfo | null;
    clocks: TableClocks | null;
    onOpenOrders: (tableName: string, linkedOrderId?: string | null, preview?: boolean) => void;
    onOccupy: (tableName: string, numCovers: number) => void;
    onRelease: (tableName: string) => void;
    onUpdateCovers: (tableName: string, numCovers: number) => void;
    /** D3/D4 — opens the move dialog for THIS table. Occupied tables only. */
    onMove: (tableName: string) => void;
    /**
     * Does this session hold either move permission? Drawn per-card rather than
     * per-page because the card is where the act starts; the dialog asks each
     * half's own question again, and both routes refuse independently — a
     * control whose only defence is being undrawn is not a control.
     */
    canMove: boolean;
    busyTableName: string | null;
}) {
    const [coverCount, setCoverCount] = useState(String(occupancy?.num_covers ?? table.capacity));

    useEffect(() => {
        setCoverCount(String(occupancy?.num_covers ?? table.capacity));
    }, [occupancy?.num_covers, table.capacity]);

    const isOccupied = Boolean(occupancy?.is_occupied);
    // A table with an active booking window ("Booked") or an upcoming reservation
    // ("Reserved") is Reserved (blue) — clearly distinct from physically Occupied
    // (red) and still orderable/occupiable (the Occupy action below stays enabled).
    const isReserved = !isOccupied && (table.status === "Reserved" || table.status === "Booked");
    const parsedCoverCount = Math.max(1, Number(coverCount) || 1);
    const isBusy = busyTableName === table.name;
    // The OTP chip is rendered ONLY while the restaurant's table-OTP gate is on.
    // With the gate off the backend already nulls `order_otp`, so this is belt
    // and braces against a stale cached snapshot showing a dead code.
    const showOtp = isOccupied && table.otp_required === true && Boolean(table.order_otp);
    const tone = clocks ? waitTone(clocks.sincePlacedMs) : "calm";

    return (
        <Card
            className={cn(
                "transition-all min-w-0",
                isOccupied ? "bg-red-950/40 border-red-900" : isReserved ? "bg-blue-950/30 border-blue-800" : "bg-slate-800/50 border-slate-700",
                "hover:shadow-lg hover:border-slate-600",
            )}
        >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3">
                <CardTitle className="text-xs font-medium sm:text-sm flex items-center gap-2 min-w-0">
                    {/* 1.8 — selecting an OCCUPIED table opens its preview (its KOTs,
                        one block each, with Add Order and Print Bill on top)
                        rather than dropping a new-order dialog over them. A free
                        table has nothing to preview, so it still goes straight
                        to taking the order. */}
                    <button
                        type="button"
                        className="truncate text-left hover:underline"
                        title={isOccupied ? `Preview ${table.name}'s KOTs` : table.name}
                        onClick={() => { onOpenOrders(table.name, null, isOccupied); }}
                    >
                        {table.name}
                    </button>
                </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
                <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge
                            variant={isOccupied ? "destructive" : "default"}
                            className={cn(
                                "text-[10px] sm:text-xs",
                                isOccupied && "bg-red-600 text-white",
                                !isOccupied && isReserved && "bg-blue-600 text-white",
                            )}
                        >
                            {isOccupied ? "Occupied" : isReserved ? "Reserved" : "Available"}
                        </Badge>
                        {occupancy ? (
                            <Badge variant="outline" className="text-[10px] sm:text-xs bg-slate-700/50">
                                {occupancy.num_covers} covers
                            </Badge>
                        ) : null}
                        {showOtp ? (
                            <Badge className="text-[10px] sm:text-xs font-mono font-bold tracking-widest bg-amber-500 text-black hover:bg-amber-500">
                                OTP {table.order_otp}
                            </Badge>
                        ) : null}
                        {!isOccupied && isReserved ? (
                            <Badge variant="secondary" className="text-[10px] sm:text-xs">
                                {table.status === "Booked" ? "In booking window" : "Upcoming"}
                            </Badge>
                        ) : null}
                        {combined ? (
                            <Badge
                                variant="outline"
                                className="text-[10px] sm:text-xs border-amber-600 text-amber-400"
                                title={`Clubbed with ${combined.partners.join(", ")} for ${combined.customer} at ${combined.time}`}
                            >
                                <Link2 className="mr-1 h-3 w-3" />
                                + {combined.partners.join(" + ")}
                            </Badge>
                        ) : null}
                    </div>

                    {/* D1 + D2. Drawn ONLY when the SERVER actually sent a clock for
                        this table: `tableServiceClockOf` answers null otherwise, and a
                        badge reading "0s" on a table that has been waiting twenty
                        minutes is worse than no badge at all. */}
                    {clocks ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                            <Badge
                                variant="outline"
                                className={cn("text-[10px] sm:text-xs tabular-nums", TONE_CLASS[tone])}
                                title="D1 — time since the oldest order on this table was placed."
                            >
                                <Clock className="mr-1 h-3 w-3" />
                                {formatDuration(clocks.sincePlacedMs)} since order
                            </Badge>
                            <Badge
                                variant="outline"
                                className="text-[10px] sm:text-xs tabular-nums border-slate-600 text-slate-300"
                                title={clocks.settled
                                    ? "D2 — the final order-to-settlement time for this table."
                                    : "D2 — order to settlement, still running. It stops when the bill is settled."}
                            >
                                <Timer className="mr-1 h-3 w-3" />
                                {clocks.settled ? "Settled in " : "Open "}{formatDuration(clocks.spanMs)}
                            </Badge>
                        </div>
                    ) : null}

                    <div className="flex items-center text-muted-foreground text-xs">
                        <Users className="h-3 w-3 mr-1" />
                        <span>
                            Seats: {table.capacity}
                            {table.max_capacity > table.capacity ? ` · max ${String(table.max_capacity)}` : ""}
                        </span>
                    </div>
                    {combined ? (
                        <p className="text-[10px] leading-snug text-amber-400/90">
                            Combined reservation — {combined.customer} ({combined.time})
                        </p>
                    ) : null}
                </div>
            </CardContent>
            <div className="px-3 pb-3 space-y-2">
                <div className="grid gap-1.5 grid-cols-2">
                    <div className="space-y-1">
                        <Label htmlFor={`covers-${String(table.id)}`} className="text-[9px] uppercase tracking-wide text-muted-foreground">
                            Covers
                        </Label>
                        <Input
                            id={`covers-${String(table.id)}`}
                            type="number"
                            min={1}
                            value={coverCount}
                            onChange={(event) => { setCoverCount(event.target.value); }}
                            className="h-8 text-sm"
                        />
                    </div>
                    <Button
                        variant={isOccupied ? "outline" : "default"}
                        className="col-span-1 self-end h-8 text-xs"
                        disabled={isBusy}
                        onClick={() => {
                            if (isOccupied) { onUpdateCovers(table.name, parsedCoverCount); } else { onOccupy(table.name, parsedCoverCount); }
                        }}
                    >
                        {isOccupied ? "Update" : "Occupy"}
                    </Button>
                </div>
                {isOccupied ? (
                    <Button
                        variant="outline"
                        className="w-full h-8 text-xs"
                        disabled={isBusy}
                        onClick={() => { onRelease(table.name); }}
                    >
                        Release
                    </Button>
                ) : null}
                {isOccupied ? (
                    <Button variant="ghost" className="w-full h-8 text-xs" onClick={() => { onOpenOrders(table.name, occupancy?.linkedOrderId ?? null); }}>
                        {occupancy?.linkedOrderId ? "View Order" : "Take Orders"}
                    </Button>
                ) : null}
                {/* D3/D4 — offered only on an OCCUPIED table, because both acts are
                    about a party or a ticket that exists. There is nothing to move
                    off an empty table, and a Move button on one would be a control
                    whose every press the server refuses. */}
                {isOccupied && canMove ? (
                    <Button
                        variant="ghost"
                        className="w-full h-8 text-xs"
                        disabled={isBusy}
                        onClick={() => { onMove(table.name); }}
                    >
                        <ArrowRightLeft className="mr-1 h-3 w-3" /> Move
                    </Button>
                ) : null}
            </div>
        </Card>
    );
}

export default function TablesPage() {
    const router = useRouter();
    const { user } = useAuth();
    const { toast } = useToast();

    const floor = useFloorTables(user);
    const { tables: tablesData, occupancyByName, combinedByName, serverZones, layout, reload: loadTables } = floor;

    const [busyTableName, setBusyTableName] = useState<string | null>(null);
    const [orders, setOrders] = useState<TableOrder[]>([]);
    /*
      THE SERVER OWNS THE DURATION; THIS PAGE OWNS ONLY THE TICK.

      These badges used to be `Date.now() - created_at`, computed here, while the
      owner app computed its own version of the same subtraction — one rule,
      implemented twice, drifting. The backend's `service_clock.ts` answers it
      once and ships the figure with `as_of`, the SERVER instant it was measured
      at, precisely so the two screens cannot disagree about the table the
      manager is standing next to.

      And a till's wall clock is not evidence: a floor laptop ten minutes fast
      used to paint every table ten minutes late the moment an order landed.

      So the only thing measured here is HOW LONG THIS DEVICE HAS HELD THE
      RESPONSE — a difference between two readings of one local timer, which is
      unaffected by that timer being wrong. It is zeroed when the SERVER
      re-measured (`as_of` advancing), never merely when this component's state
      object changed, which would rewind every badge on the floor.

      One interval for the whole page rather than one per card: thirty tables
      each owning a timer is thirty React re-render cascades a second on a laptop
      that is also driving the floor.
    */
    const [tickMs, setTickMs] = useState(0);
    const clockOriginRef = useRef<{ asOf: number; at: number }>({ asOf: 0, at: monotonicNow() });
    const ordersAsOfMs = useMemo(() => latestAsOfMs(orders), [orders]);
    useEffect(() => {
        if (ordersAsOfMs > clockOriginRef.current.asOf) {
            clockOriginRef.current = { asOf: ordersAsOfMs, at: monotonicNow() };
            setTickMs(0);
        }
    }, [ordersAsOfMs]);
    useEffect(() => {
        const id = setInterval(() => {
            setTickMs(Math.max(0, monotonicNow() - clockOriginRef.current.at));
        }, 1000);
        return () => { clearInterval(id); };
    }, []);

    // Whoever may edit the floor gets a way to it from here; everyone else is not
    // told about a page whose every control would refuse them.
    const showFloorPlanLink = canOpenFloorPlan(user);

    /*
      D3 / D4 — the two move permissions, asked separately.

      They are genuinely different grants: POST /tables/move rides on "Table
      Occupied" (the service permission a waiter holds) and POST
      /tables/move-order on "Add Orders" (the same id that gates the KOT
      reprint). A tenant can hold one and not the other, so the dialog draws only
      the halves this session can actually use, and the Move button appears when
      EITHER is held — holding neither means every control inside would refuse,
      which is not a dialog worth opening.
    */
    const mayMoveParty = canMoveTableParty(user);
    const mayMoveOrder = canMoveOrderToTable(user);
    const mayMoveAnything = mayMoveParty || mayMoveOrder;
    const [moveTableName, setMoveTableName] = useState<string | null>(null);

    /*
      THE ORDERS BEHIND THE CLOCKS.

      GET /orders rides on "View Orders", which the core waiter role holds, so
      this read is available to exactly the people who need the clocks. A failure
      leaves `orders` empty and the cards simply draw no clock — never a zero.

      Polled on the same 20s beat the orders page uses, and refreshed on the
      `tables:changed` broadcast, so seating a party or taking an order updates
      the clock without a reload.

      D3/D4 — and after a MOVE, here or anywhere else. The clocks are grouped by
      each ticket's table, so a grid-only refresh left a moved party's clock on
      the table it had left until the next poll. `reloadOrders` is what the move
      handlers call (through refreshAfterTableMove), and the server's
      `table:moved` / `table:order_moved` socket events do the same for a move
      made on another device.
    */
    const ordersActiveRef = useRef(true);
    const reloadOrders = useCallback(async (): Promise<void> => {
        if (!user?.restaurantUsername) { return; }
        try {
            const rows = await getOrders(user.restaurantUsername);
            if (ordersActiveRef.current) { setOrders(Array.isArray(rows) ? rows : []); }
        } catch (error: unknown) {
            console.warn("Failed to load orders for the table clocks", error);
        }
    }, [user?.restaurantUsername]);
    useEffect(() => {
        if (!user?.restaurantUsername) { return; }
        ordersActiveRef.current = true;
        const pull = (): void => { void reloadOrders(); };
        const onRealtime = (event: Event): void => {
            if (!isTableMoveEvent((event as Event & { detail?: { event?: unknown } }).detail?.event)) { return; }
            void refreshAfterTableMove({ tables: loadTables, orders: reloadOrders });
        };
        pull();
        const id = setInterval(pull, 20000);
        if (typeof window !== "undefined") {
            window.addEventListener("tables:changed", pull);
            window.addEventListener("realtime:event", onRealtime);
        }
        return () => {
            ordersActiveRef.current = false;
            clearInterval(id);
            if (typeof window !== "undefined") {
                window.removeEventListener("tables:changed", pull);
                window.removeEventListener("realtime:event", onRealtime);
            }
        };
    }, [user?.restaurantUsername, reloadOrders, loadTables]);

    /*
      D1 + D2 per table, FROM THE SERVER'S CLOCKS.

      Each order carries the duration the server measured for it. This reduces
      them to one figure per table by the SERVER's own rule — earliest order,
      still running while ANY order on the table is unsettled, stopping at the
      last settlement — which is `tableServiceClockOf`, a restatement of the
      backend's `tableServiceClock` over inputs the backend computed. The running
      table bill (GET /bill-for-table) publishes exactly that clock for one
      table; this grid draws thirty of them off one polled feed rather than
      asking for thirty bills a poll.

      Both badges come from the SAME reduced clock, so a card can no longer say
      "40m since order / settled in 3m" — the two figures are two readings of one
      duration, not two independent picks from the row list.

      Cancelled tickets are left out: a cancelled order is not something the
      table is waiting for, and counting one would leave a red "48m since order"
      badge on a table whose food was called off an hour ago.

      A table whose orders carry no clock at all — a backend older than the
      field, or rows the server could not date — yields nothing here, and the
      card draws no badge. ABSENT IS NOT ZERO.
    */
    const clocksByTable = useMemo(() => {
        const byTable = new Map<string, TableOrder[]>();
        for (const order of orders) {
            if (!order.table || order.status === "Cancelled") { continue; }
            const key = order.table.toLowerCase();
            const bucket = byTable.get(key);
            if (bucket) { bucket.push(order); } else { byTable.set(key, [order]); }
        }

        const result: Record<string, TableClocks> = {};
        for (const [key, rows] of byTable) {
            const clock = tableServiceClockOf(rows);
            if (clock === null) { continue; }
            const span = elapsedToSettlement(clock, tickMs);
            result[key] = {
                sincePlacedMs: elapsedSincePlaced(clock, tickMs),
                spanMs: span.ms,
                settled: span.settled,
            };
        }
        return result;
    }, [orders, tickMs]);

    const tablesByKey = useMemo(
        () => new Map(tablesData.map((table) => [table.name.toLowerCase(), table])),
        [tablesData],
    );

    // Zones are read straight off the server's reconciliation — shown as
    // headings, never editable from here.
    const renderSections = useMemo(() => {
        const reconciled = applyServerSections(layout, tablesData, serverZones);
        return reconciled.sections.map((section) => ({
            id: section.id,
            name: section.name,
            tables: section.tables
                .map((name) => tablesByKey.get(name))
                .filter((table): table is Table => Boolean(table)),
        }));
    }, [layout, tablesData, tablesByKey, serverZones]);

    const hasCustomSections = renderSections.some((section) => !isUnassignedSection(section.id));
    const totalTables = tablesData.length;
    const occupiedCount = Object.values(occupancyByName).filter((entry) => entry.is_occupied).length;
    const reservedCount = tablesData.filter((table) => {
        const occupancy: TableOccupancy | undefined = occupancyByName[table.name.toLowerCase()];
        return !occupancy?.is_occupied && (table.status === "Reserved" || table.status === "Booked");
    }).length;

    /*
      D3/D4 — the party move and the order move, both of them ONE call.

      NEITHER IS RETRIED AND NEITHER IS QUEUED. routes/tables.ts declines
      idempotent() and the offline outbox for both, and argues it: a replay
      bounces off the precondition the first execution consumed ("T1 is not
      seated") having changed nothing, and a move held on a till for twenty
      minutes and replayed against a floor that has moved on lands on a
      destination somebody else has since seated — by which time whoever pressed
      it is long gone and believes the guests were moved. So a failure here is
      reported and stops; it is never silently re-attempted.

      A REFUSAL IS A RESULT, NOT AN EXCEPTION, for the reason handleReleaseTable
      gives: an Error thrown out of a Server Action has its message redacted in
      production, and the server's sentence ("T7 is occupied — use Merge…") is
      the entire value of the response.
    */
    const moveTable = useMemo(
        () => tablesData.find((table) => table.name === moveTableName) ?? null,
        [tablesData, moveTableName],
    );

    /*
      WHO IS SITTING WHERE, AND HOW MANY OF THEM — reduced once for the move
      dialog rather than indexed per candidate table.

      Reduced rather than read through `occupancyByName[...]` at each call site
      because the destination filter asks the question ONCE PER TABLE ON THE
      FLOOR every time the dialog re-renders, and because one derivation is one
      place for "seated" to be defined. `partyMoveDestinations` takes the
      predicate rather than the map for exactly that reason.
    */
    const seating = useMemo(() => {
        const seated = new Set<string>();
        const covers = new Map<string, number>();
        for (const [name, occupancy] of Object.entries(occupancyByName)) {
            if (occupancy.is_occupied) { seated.add(name); }
            covers.set(name, occupancy.num_covers);
        }
        return { seated, covers };
    }, [occupancyByName]);

    /*
      HOW MANY PEOPLE ARE ACTUALLY BEING MOVED.

      The seated cover count, which is the figure the server measures the
      destination against (assertCoversFitTable) and the figure the confirmation
      quotes back. Falls back to the table's laid-up capacity only when the
      occupancy read has not arrived — never to 1, which would offer the whole
      floor to a party of eight.
    */
    const moveCovers = useMemo((): number => {
        if (!moveTable) { return 1; }
        return seating.covers.get(moveTable.name.toLowerCase()) ?? moveTable.capacity;
    }, [moveTable, seating]);

    const isTableSeated = (tableName: string): boolean => seating.seated.has(tableName.toLowerCase());

    /** The live tickets on one table — what D4's per-order picker lists. */
    const ordersForTable = (tableName: string): TableOrder[] =>
        orders.filter(
            (order) =>
                (order.table || "").toLowerCase() === tableName.toLowerCase()
                // A cancelled or closed ticket is not something that can be
                // moved: the first is terminal (the server refuses every
                // modification) and the second belongs to a settled bill.
                && order.status !== "Cancelled"
                && order.status !== "Closed",
        );

    const handleMoveParty = async (toTable: string): Promise<void> => {
        if (!user?.restaurantUsername || !moveTableName) { return; }
        const fromTable = moveTableName;
        setBusyTableName(fromTable);
        try {
            const result = await moveTableParty(user.restaurantUsername, fromTable, toTable);
            if (isRefusedAction(result)) {
                toast({ title: "Party not moved", description: result.error, variant: "destructive" });
                return;
            }
            toast({
                title: "Party moved",
                description: movedPartySentence(result.from_table, result.to_table, result.moved_orders),
            });
            setMoveTableName(null);
            await refreshAfterTableMove({ tables: loadTables, orders: reloadOrders });
        } catch (error: unknown) {
            toast({
                title: "Unable to move the party",
                description: error instanceof Error ? error.message : "The move did not go through.",
                variant: "destructive",
            });
        } finally {
            setBusyTableName(null);
        }
    };

    const handleMoveOrder = async (orderId: string, toTable: string): Promise<void> => {
        if (!user?.restaurantUsername || !moveTableName) { return; }
        setBusyTableName(moveTableName);
        try {
            const result = await moveOrderToTable(user.restaurantUsername, orderId, toTable);
            if (isRefusedAction(result)) {
                toast({ title: "Order not moved", description: result.error, variant: "destructive" });
                return;
            }
            // The correction docket's outcome is the SERVER's and it is not a
            // detail: "KOT-26 is printing, tell the pass" and "nothing was on the
            // pass for it" are two different things for staff to go and do.
            toast({ title: "Order moved", description: movedOrderSentence(result.to_table, result.print) });
            setMoveTableName(null);
            await refreshAfterTableMove({ tables: loadTables, orders: reloadOrders });
        } catch (error: unknown) {
            toast({
                title: "Unable to move that order",
                description: error instanceof Error ? error.message : "The move did not go through.",
                variant: "destructive",
            });
        } finally {
            setBusyTableName(null);
        }
    };

    const openOrdersForTable = (tableName: string, linkedOrderId?: string | null, preview?: boolean): void => {
        const params = new URLSearchParams();
        params.set("table", tableName);
        if (linkedOrderId) { params.set("highlightOrder", linkedOrderId); }
        // 1.8 — the orders screen draws this table's preview whenever `table` is
        // set; `preview` only stops it opening the new-order dialog on top.
        if (preview) { params.set("preview", "1"); }
        router.push(`/dashboard/orders?${params.toString()}`);
    };

    const handleOccupyTable = async (tableName: string, numCovers: number) => {
        if (!user?.restaurantUsername) { return; }
        setBusyTableName(tableName);
        try {
            const res = await occupyTable(user.restaurantUsername, tableName, numCovers);
            // Seating is supposed to make the seater this table's waiter. Say what
            // actually happened, here, at the moment of seating. The bug this
            // replaces was silent on both ends: the server skipped the assignment
            // without logging and the client never asked, so a floor running with
            // no waiter on any table looked completely normal for weeks.
            const assignment = res.assignment;
            const unattended = seatingLeftTableUnattended(assignment);
            toast({
                title: unattended ? "Occupied — but no waiter assigned" : "Table occupied",
                description: `${tableName} is now marked occupied with ${String(numCovers)} cover${numCovers === 1 ? "" : "s"}.`
                    + (assignment ? ` ${assignment.message}` : ""),
                variant: unattended ? "destructive" : undefined,
            });
            await loadTables();
        } catch (error: unknown) {
            toast({
                title: "Unable to update table",
                description: error instanceof Error ? error.message : "Failed to mark the table occupied.",
                variant: "destructive",
            });
        } finally {
            setBusyTableName(null);
        }
    };

    const handleUpdateTableCovers = async (tableName: string, numCovers: number) => {
        if (!user?.restaurantUsername) { return; }
        setBusyTableName(tableName);
        try {
            await updateTableCovers(user.restaurantUsername, tableName, numCovers);
            toast({
                title: "Covers updated",
                description: `${tableName} now has ${String(numCovers)} cover${numCovers === 1 ? "" : "s"}.`,
            });
            await loadTables();
        } catch (error: unknown) {
            toast({
                title: "Unable to update covers",
                description: error instanceof Error ? error.message : "Failed to save the cover count.",
                variant: "destructive",
            });
        } finally {
            setBusyTableName(null);
        }
    };

    const handleReleaseTable = async (tableName: string) => {
        if (!user?.restaurantUsername) { return; }
        setBusyTableName(tableName);
        try {
            const result = await releaseTable(user.restaurantUsername, tableName);
            // A REFUSAL IS A RESULT, NOT AN EXCEPTION. The server answers a
            // blocked release with the sentence naming what the release would
            // have destroyed ("would write off ₹1,240 of unpaid orders — settle
            // or void them first"); an Error thrown out of a Server Action has
            // its message redacted in production, so that sentence only reaches
            // this toast because it comes back as a value.
            if (isRefusedAction(result)) {
                toast({
                    title: "Table not released",
                    description: result.error,
                    variant: "destructive",
                });
                return;
            }
            toast({ title: "Table released", description: `${tableName} is now available.` });
            await loadTables();
        } catch (error: unknown) {
            toast({
                title: "Unable to release table",
                description: error instanceof Error ? error.message : "Failed to mark the table available.",
                variant: "destructive",
            });
        } finally {
            setBusyTableName(null);
        }
    };

    return (
        <div className="grid gap-4 md:gap-8">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h1 className="text-lg font-semibold md:text-2xl">Tables</h1>
                    <p className="text-sm text-muted-foreground">
                        Seat parties, correct covers, release tables and open their orders.
                    </p>
                </div>
                {showFloorPlanLink ? (
                    /* The only route from here to the layout half, and it is a LINK —
                       going to the floor plan is a deliberate trip, not something you
                       fall into from a table card mid-service. */
                    <Button variant="outline" asChild>
                        <Link href="/dashboard/floor-plan">
                            <LayoutGrid className="mr-2 h-4 w-4" />
                            Edit floor plan
                        </Link>
                    </Button>
                ) : null}
            </div>

            {/* H5 — the live gross, ABOVE the tables, which is where the
                requirement puts it and also where it is read: a manager walking
                the floor wants "what is out there" before "which table". */}
            {user?.restaurantUsername ? <LiveGrossBar rid={user.restaurantUsername} /> : null}

            <Card>
                <CardHeader>
                    <CardTitle>Table Status Overview</CardTitle>
                    <CardDescription className="text-sm text-muted-foreground">
                        {totalTables > 0
                            ? <>
                                {occupiedCount} occupied · {reservedCount} reserved · {Math.max(0, totalTables - occupiedCount - reservedCount)} free,
                                of {totalTables} table{totalTables === 1 ? "" : "s"}.
                                {" "}Each occupied table shows how long since its order went in, and how long its bill has been running.
                            </>
                            : "No tables have been added yet."}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {totalTables > 0 ? (
                        <div className="space-y-8">
                            {renderSections.map((section) => {
                                const reserved = isUnassignedSection(section.id);
                                const showHeader = !reserved || hasCustomSections;
                                if (reserved && !hasCustomSections && section.tables.length === 0) {
                                    return null;
                                }
                                if (section.tables.length === 0) {
                                    // An EMPTY zone is a floor-plan fact, not a service one.
                                    // On the plan it is a drop target; here it would be a
                                    // heading over nothing.
                                    return null;
                                }
                                const seats = section.tables.reduce((sum, table) => sum + (table.capacity || 0), 0);
                                return (
                                    <div key={section.id}>
                                        {showHeader ? (
                                            <div className="mb-4 flex flex-wrap items-center gap-2">
                                                <h3 className="text-lg font-semibold flex items-center md:text-xl">
                                                    <LayoutGrid className="mr-2 h-5 w-5" /> {section.name}
                                                    <span className="ml-3 text-xs font-normal text-muted-foreground">
                                                        {section.tables.length} table{section.tables.length === 1 ? "" : "s"} · {seats} seats
                                                    </span>
                                                </h3>
                                            </div>
                                        ) : null}
                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-8 gap-4">
                                            {section.tables.map((table) => (
                                                <ServiceTable
                                                    key={table.id}
                                                    table={table}
                                                    occupancy={occupancyByName[table.name.toLowerCase()] ?? null}
                                                    combined={combinedByName[table.name.toLowerCase()] ?? null}
                                                    clocks={clocksByTable[table.name.toLowerCase()] ?? null}
                                                    onOpenOrders={openOrdersForTable}
                                                    onOccupy={(name, covers) => { void handleOccupyTable(name, covers); }}
                                                    onRelease={(name) => { void handleReleaseTable(name); }}
                                                    onUpdateCovers={(name, covers) => { void handleUpdateTableCovers(name, covers); }}
                                                    onMove={(name) => { setMoveTableName(name); }}
                                                    canMove={mayMoveAnything}
                                                    busyTableName={busyTableName}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="text-center text-muted-foreground py-12">
                            <p className="mb-2">You have no tables configured for your restaurant.</p>
                            {showFloorPlanLink ? (
                                <p className="text-sm">
                                    Tables are added on the{" "}
                                    <Link href="/dashboard/floor-plan" className="underline">floor plan</Link>.
                                </p>
                            ) : (
                                <p className="text-sm">Ask an admin to add them on the floor plan.</p>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* D3/D4. One dialog for the whole page rather than one per card —
                thirty cards each mounting a Dialog is thirty Radix portals on a
                laptop that is also driving the floor, for a control that can only
                ever be open on one table at a time. */}
            <MoveTableDialog
                open={moveTableName !== null}
                onOpenChange={(next) => { if (!next) { setMoveTableName(null); } }}
                table={moveTable}
                covers={moveCovers}
                allTables={tablesData}
                isSeated={isTableSeated}
                orders={moveTableName ? ordersForTable(moveTableName) : []}
                mayMoveParty={mayMoveParty}
                mayMoveOrder={mayMoveOrder}
                busy={busyTableName !== null}
                onMoveParty={(toTable) => { void handleMoveParty(toTable); }}
                onMoveOrder={(orderId, toTable) => { void handleMoveOrder(orderId, toTable); }}
            />
        </div>
    );
}
