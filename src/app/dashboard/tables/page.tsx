
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Users, PlusCircle, MoreVertical, Trash2, GripVertical, Pencil, Link2, LayoutGrid } from "lucide-react";
import { type Table } from "./data";
import {
    SECTION_NAME_MAX,
    UNASSIGNED_SECTION_NAME,
    addSection,
    applyServerSections,
    isUnassignedSection,
    loadLayout,
    moveTable,
    normalizeSectionName,
    removeSection,
    renameSection,
    saveLayout,
    type TableLayout,
} from "./sections";
import {
    // addAuditLogEntry,
    occupyTable,
    releaseTable,
    updateTableCovers,
    getTables,
    getTableStatus,
    getBookings,
    updateTableSeating,
    requestBackend,
} from "@/lib/db";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { CollisionDetection, DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { DndContext, closestCenter, pointerWithin, useSensor, useSensors, PointerSensor, DragOverlay, useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable } from "@dnd-kit/sortable";

// A table that is part of a clubbed ("combined") reservation, as derived from
// the bookings list: the other tables it is seated together with.
interface CombinedInfo {
    partners: string[];
    customer: string;
    time: string;
}

// Droppable ids are namespaced so a drag ending on empty space inside a section
// is distinguishable from one ending on another table card.
const SECTION_DROP_PREFIX = "section:";
const sectionDropId = (sectionId: string) => `${SECTION_DROP_PREFIX}${sectionId}`;

/*
  A section's droppable wraps its cards, so the pointer is always inside BOTH.
  Prefer the card (precise position), fall back to the section (drop into empty
  space / append), and only then to geometry when the pointer left every zone.
  Plain `closestCenter` would let a big section rect beat the card under the
  cursor and turn every reorder into an append.
*/
const collisionDetection: CollisionDetection = (args) => {
    const withinPointer = pointerWithin(args);
    const cards = withinPointer.filter((collision) => !String(collision.id).startsWith(SECTION_DROP_PREFIX));
    if (cards.length > 0) {return cards;}
    if (withinPointer.length > 0) {return withinPointer;}
    return closestCenter(args);
};

function SortableTable({
    table,
    occupancy,
    combined,
    canDrag,
    onRemove,
    onEdit,
    onOpenOrders,
    onOccupy,
    onRelease,
    onUpdateCovers,
    busyTableName,
}: {
    table: Table;
    occupancy: { is_occupied: boolean; num_covers: number } | null;
    combined?: CombinedInfo | null;
    canDrag: boolean;
    onRemove: (tableId: number) => void;
    onEdit: (table: Table) => void;
    onOpenOrders: (tableName: string, linkedOrderId?: string | null) => void;
    onOccupy: (tableName: string, numCovers: number) => void;
    onRelease: (tableName: string) => void;
    onUpdateCovers: (tableName: string, numCovers: number) => void;
    busyTableName: string | null;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: table.id,
        disabled: !canDrag,
    });
    const [coverCount, setCoverCount] = useState(String(occupancy?.num_covers ?? table.capacity ?? 1));

    useEffect(() => {
        setCoverCount(String(occupancy?.num_covers ?? table.capacity ?? 1));
    }, [occupancy?.num_covers, table.capacity]);

    const style = {
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
    };

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

    return (
        <Card
            ref={setNodeRef}
            style={style}
            className={cn(
                "transition-all touch-none min-w-0",
                isOccupied ? 'bg-red-950/40 border-red-900' : isReserved ? 'bg-blue-950/30 border-blue-800' : 'bg-slate-800/50 border-slate-700',
                isDragging ? 'opacity-50 shadow-2xl z-10' : 'hover:shadow-lg hover:border-slate-600'
            )}
        >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3">
                <CardTitle className="text-xs font-medium sm:text-sm flex items-center gap-2 min-w-0">
                    <button
                        {...listeners}
                        {...attributes}
                        disabled={!canDrag}
                        title={canDrag ? "Drag to another section" : "Only an admin can rearrange the floor"}
                        className={cn("p-1 shrink-0", canDrag ? "cursor-grab" : "cursor-not-allowed opacity-40")}
                    >
                        <GripVertical className="h-4 w-4 text-muted-foreground" />
                    </button>
                    <button type="button" className="truncate text-left hover:underline" title={table.name} onClick={() => { onOpenOrders(table.name); }}>
                        {table.name}
                    </button>
                </CardTitle>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
                            <MoreVertical className="h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => { onEdit(table); }}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit seating
                        </DropdownMenuItem>
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); }} className="text-destructive">
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Delete
                                </DropdownMenuItem>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This will permanently delete the table &ldquo;{table.name}&rdquo;. This action cannot be undone.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => { onRemove(table.id); }} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">Delete</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </DropdownMenuContent>
                </DropdownMenu>
            </CardHeader>
            <CardContent className="p-3 pt-0">
                <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge
                            variant={isOccupied ? 'destructive' : 'default'}
                            className={cn(
                                "text-[10px] sm:text-xs",
                                isOccupied && 'bg-red-600 text-white',
                                !isOccupied && isReserved && 'bg-blue-600 text-white'
                            )}
                        >
                            {isOccupied ? 'Occupied' : isReserved ? 'Reserved' : 'Available'}
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
                    <div className="flex items-center text-muted-foreground text-xs">
                        <Users className="h-3 w-3 mr-1" />
                        <span>
                            Seats: {table.capacity}
                            {table.max_capacity > table.capacity ? ` · max ${table.max_capacity}` : ""}
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
                        <Label htmlFor={`covers-${table.id}`} className="text-[9px] uppercase tracking-wide text-muted-foreground">
                            Covers
                        </Label>
                        <Input
                            id={`covers-${table.id}`}
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
                        onClick={() => { isOccupied ? onUpdateCovers(table.name, parsedCoverCount) : onOccupy(table.name, parsedCoverCount); }}
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
                    <Button variant="ghost" className="w-full h-8 text-xs" onClick={() => { onOpenOrders(table.name, (occupancy as any)?.linkedOrderId ?? null); }}>
                        {(occupancy as any)?.linkedOrderId ? 'View Order' : 'Take Orders'}
                    </Button>
                ) : null}
            </div>
        </Card>
    )
}

/*
  One floor section. The whole body is a drop target so a table can be dropped
  into an EMPTY section (dropping onto another card is handled by the sortable
  items themselves).
*/
function SectionDropZone({
    sectionId,
    isEmpty,
    children,
}: {
    sectionId: string;
    isEmpty: boolean;
    children: React.ReactNode;
}) {
    const { setNodeRef, isOver } = useDroppable({ id: sectionDropId(sectionId) });

    return (
        <div
            ref={setNodeRef}
            className={cn(
                "rounded-lg transition-colors",
                isEmpty ? "border-2 border-dashed p-6" : "p-1",
                isOver ? "border-primary bg-primary/5" : isEmpty ? "border-slate-700" : "border-transparent",
            )}
        >
            {isEmpty ? (
                <p className="text-center text-xs text-muted-foreground">
                    Empty section — drag a table here.
                </p>
            ) : (
                children
            )}
        </div>
    );
}

// Backend action id for "Manage Table Sections" (group: Tables).
const MANAGE_SECTIONS_PERMISSION = "2f7c5a94-8e13-4b60-9d27-6a0f3c8e5b41";

export default function TablesPage() {
  const router = useRouter();
  const { user } = useAuth();
  // "Manage Table Sections". Creating/renaming/removing a ZONE needs it; moving a
  // table into an EXISTING zone deliberately does not, so the floor keeps working
  // mid-service. Without this gate a custom role saw the buttons and got a raw 403.
  const canManageSections =
    Array.isArray(user?.actions_set) &&
    (user.actions_set.includes("*") || user.actions_set.includes(MANAGE_SECTIONS_PERMISSION));
  const [tablesData, setTablesData] = useState<Table[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newTableName, setNewTableName] = useState("");
  const [newTableCapacity, setNewTableCapacity] = useState("");
  const [newTableMaxCapacity, setNewTableMaxCapacity] = useState("");
  // Which zone a NEW table lands in. "" = Unassigned. Picking an existing zone is
  // a plain move (no extra permission); only naming a brand-new zone needs
  // "Manage Table Sections", which is why the free-text option is gated below.
  const [newTableSection, setNewTableSection] = useState("");
    const [tableOccupancyByName, setTableOccupancyByName] = useState<Record<string, { is_occupied: boolean; num_covers: number; linkedOrderId?: string | null }>>({});
    // name (lowercased) -> the other tables it is clubbed with for an upcoming booking
    const [combinedByName, setCombinedByName] = useState<Record<string, CombinedInfo>>({});
    const [busyTableName, setBusyTableName] = useState<string | null>(null);
    const [activeId, setActiveId] = useState<number | null>(null);
    const [editingTable, setEditingTable] = useState<Table | null>(null);
    const [editCapacity, setEditCapacity] = useState("");
    const [editMaxCapacity, setEditMaxCapacity] = useState("");
    const [savingSeating, setSavingSeating] = useState(false);
    // Floor sections. Held in a ref as well so the reconcile effect can fold the
    // live table list in without taking `layout` as a dependency (which loops).
    const [layout, setLayoutState] = useState<TableLayout>({ sections: [] });
    const layoutRef = useRef<TableLayout>({ sections: [] });
    // The zone roster from GET /table-sections — the server's answer to WHICH
    // zones exist, including the empty ones no table points at. null means "not
    // known" (never read, read failed, or the user lacks the permission that
    // gates the route); existence is only enforced against a roster we actually
    // hold, so a failed read can never look like a deletion.
    const [serverZones, setServerZones] = useState<string[] | null>(null);
    const serverZonesRef = useRef<string[] | null>(null);
    const [sectionDialog, setSectionDialog] = useState<{ mode: "add" | "rename"; id?: string } | null>(null);
    const [sectionName, setSectionName] = useState("");
    const [savingSection, setSavingSection] = useState(false);
  const { toast } = useToast();

    const hasRole = (role: "admin" | "employee" | "valet" | "waiter" | "cashier" | "captain" | "manager") => {
        if (!user) {return false;}
        if (user.role === role) {return true;}
        return Array.isArray(user.role_all) ? user.role_all.includes(role) : false;
    };

    const ensureAdmin = () => {
        if (hasRole("admin")) {
            return true;
        }
        toast({
            title: "Access denied",
            description: "You do not have the required role for this action. Required role: admin.",
            variant: "destructive",
        });
        return false;
    };

    const isAdmin = hasRole("admin");

  const sensors = useSensors(useSensor(PointerSensor));

    // Single write path for the layout: state, ref and storage always agree, so a
    // drop is durable the instant it lands (no save button, no debounce).
    const commitLayout = useCallback((next: TableLayout) => {
        layoutRef.current = next;
        setLayoutState(next);
        if (user?.restaurantUsername) {
            saveLayout(user.restaurantUsername, user.outlet_id, next);
        }
    }, [user?.restaurantUsername, user?.outlet_id]);

    // Same single write path for the roster. It is never persisted to storage:
    // it is the server's list, re-read on every load, not a browser preference.
    const commitZones = useCallback((next: string[] | null) => {
        serverZonesRef.current = next;
        setServerZones(next);
    }, []);

    useEffect(() => {
        if (!user?.restaurantUsername) {
            return;
        }
        const stored = loadLayout(user.restaurantUsername, user.outlet_id);
        layoutRef.current = stored;
        setLayoutState(stored);
    }, [user?.restaurantUsername, user?.outlet_id]);

    // Fold the server's sections into the remembered arrangement: the roster
    // decides which zones exist, the column decides which zone each table is in,
    // and the stored layout only decides the order. Deleted tables drop out; new
    // ones land under whatever their row says.
    useEffect(() => {
        if (!user?.restaurantUsername || tablesData.length === 0) {
            return;
        }
        const reconciled = applyServerSections(layoutRef.current, tablesData, serverZones);
        if (JSON.stringify(reconciled) === JSON.stringify(layoutRef.current)) {
            return;
        }
        commitLayout(reconciled);
    }, [tablesData, serverZones, user?.restaurantUsername, commitLayout]);

    /*
        The zone roster — including zones no table points at, which is the whole
        reason it exists. `GET /table-sections` is gated on "Manage Table Sections",
        the same permission that reveals the add/rename/delete controls, so it is
        only asked for when the user holds it: a waiter would collect a 403 on every
        load and gain nothing, since a zone that HOLDS tables still arrives with the
        tables themselves.

        Every failure path leaves the roster unknown (null), never empty. Reporting
        "no zones" off a failed read would reconcile every empty zone off the floor
        — the read is not allowed to look like a deletion.
    */
    const loadSectionRoster = async () => {
        if (!user?.restaurantUsername || !canManageSections) {
            commitZones(null);
            return;
        }
        try {
            const response = await requestBackend<{ sections?: { section?: string }[] }>({
                path: "/table-sections",
                method: "GET",
                restaurantId: user.restaurantUsername,
            });
            if (!response.ok || !Array.isArray(response.data?.sections)) {
                console.warn("Failed to load the table section roster", response.status, response.text);
                commitZones(null);
                return;
            }
            commitZones(
                response.data.sections
                    .map((entry) => (typeof entry?.section === "string" ? entry.section.trim() : ""))
                    .filter((name) => name.length > 0),
            );
        } catch (error) {
            console.warn("Failed to load the table section roster", error);
            commitZones(null);
        }
    };

    const loadTables = async () => {
        if (!user?.restaurantUsername) {
            setTablesData([]);
            setTableOccupancyByName({});
            commitZones(null);
            return;
        }

        await loadSectionRoster();

        try {
            const data = await getTables(user.restaurantUsername);
            // `getTables` maps the row down to the fields the rest of the app
            // uses and drops `section`, so the raw row is read once more purely
            // for the floor zone. A failure here is not fatal: every table then
            // simply renders under "Unassigned" until the next load, and nothing
            // is ever written back off the strength of a failed read.
            let sectionByTable: Record<string, string | null> = {};
            try {
                const raw = await requestBackend<{ table_name?: string; section?: string | null }[]>({
                    path: `/get-tables?restaurantId=${encodeURIComponent(user.restaurantUsername)}`,
                    method: "GET",
                    restaurantId: user.restaurantUsername,
                });
                if (raw.ok && Array.isArray(raw.data)) {
                    sectionByTable = Object.fromEntries(
                        raw.data
                            .filter((row) => typeof row?.table_name === "string")
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
            setTablesData(nextTables);

            const statusEntries = await Promise.all(
                nextTables.map(async (table) => {
                    try {
                                const status = await getTableStatus(user.restaurantUsername, table.name);
                                return [
                                    table.name.toLowerCase(),
                                    {
                                        is_occupied: Boolean(status?.is_occupied),
                                        num_covers: Math.max(1, Number(status?.num_covers ?? table.capacity ?? 1) || 1),
                                        linkedOrderId: typeof status?.linked_order_id === 'string' && status?.linked_order_id ? String(status.linked_order_id) : null,
                                    },
                                ] as const;
                    } catch {
                        return [
                            table.name.toLowerCase(),
                            {
                                is_occupied: table.status === "Occupied",
                                num_covers: Math.max(1, Number(table.capacity ?? 1) || 1),
                            },
                        ] as const;
                    }
                }),
            );

            setTableOccupancyByName(Object.fromEntries(statusEntries));

            // Clubbed reservations hold several tables under one booking. Mark
            // them on the floor so staff never move one half of a combination.
            try {
                const bookings = await getBookings(user.restaurantUsername);
                const combined: Record<string, CombinedInfo> = {};
                for (const booking of Array.isArray(bookings) ? bookings : []) {
                    const names = Array.isArray(booking.table_names) ? booking.table_names : [];
                    if (names.length < 2) {continue;}
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
            setTablesData([]);
            setTableOccupancyByName({});
            setCombinedByName({});
        }
    };

    useEffect(() => {
        if (!user?.restaurantUsername) {
            return;
        }

        loadTables().catch((error) => {
            console.error("Failed to load tables", error);
        });

        const handler = () => { loadTables().catch((err) => { console.error('tables:changed handler failed', err); }); };
        if (typeof window !== 'undefined') {
            window.addEventListener('tables:changed', handler as EventListener);
        }
        return () => {
            if (typeof window !== 'undefined') {window.removeEventListener('tables:changed', handler as EventListener);}
        };
    }, [user?.restaurantUsername]);

  const handleAddTable = async () => {
        if (!ensureAdmin()) {return;}

    if (newTableName && newTableCapacity && user?.restaurantUsername) {
      const trimmedName = newTableName.trim();
      const existingTable = tablesData.find(
        (table) => table.name.toLowerCase() === trimmedName.toLowerCase()
      );

      if (existingTable) {
        toast({
          title: "Duplicate Table",
          description: `A table with the name "${trimmedName}" already exists.`,
          variant: "destructive",
        });
        return;
      }

                  const capacityValue = newTableCapacity ? parseInt(newTableCapacity, 10) : undefined;
            // Optional MAX (extra chairs). Same rule the backend enforces: a whole
            // number >= 1, and never below the normal seat count (the backend
            // silently clamps it up, so refuse it here instead of surprising them).
            const maxValue = newTableMaxCapacity.trim() ? Number(newTableMaxCapacity) : undefined;
            if (maxValue !== undefined && (!Number.isInteger(maxValue) || maxValue < 1)) {
                toast({
                    title: "Invalid maximum",
                    description: "Max with extra chairs must be a whole number of 1 or more.",
                    variant: "destructive",
                });
                return;
            }
            if (maxValue !== undefined && capacityValue !== undefined && maxValue < capacityValue) {
                toast({
                    title: "Maximum too small",
                    description: `Max with extra chairs cannot be below the ${capacityValue} normal seats.`,
                    variant: "destructive",
                });
                return;
            }

      const chosenSection = newTableSection.trim();
      const payload: any = {
                table: {
                    name: trimmedName,
                    capacity: capacityValue,
                    max_capacity: maxValue,
                    // Omitted entirely when Unassigned, so the backend leaves it null.
                    ...(chosenSection ? { section: chosenSection } : {}),
                },
            };

            const response = await requestBackend({
                path: "/add-table",
                method: "POST",
                restaurantId: user.restaurantUsername,
                body: payload,
            });

            if (!response.ok) {
                throw new Error("Failed to create table");
            }

            // await addAuditLogEntry(user.restaurantUsername, {
            //     employee: ( `${user?.emp_Fname ?? ''}${user?.emp_Lname ? ` ${user.emp_Lname}` : ''}`.trim() || user?.employeeUsername ) ?? user?.employeeId ?? "System",
            //     employeeId: user?.employeeId,
            //     action: "Table Added",
            //     details: `Created table ${trimmedName}${payload.table.capacity ? ` (capacity ${payload.table.capacity})` : ""}`,
            // });

            await loadTables();
      setNewTableName("");
      setNewTableCapacity("");
      setNewTableMaxCapacity("");
      setNewTableSection("");
      setIsDialogOpen(false);
    }
  };

    const openEditTable = (table: Table) => {
        if (!ensureAdmin()) {return;}
        setEditingTable(table);
        setEditCapacity(String(table.capacity || 1));
        setEditMaxCapacity(String(table.max_capacity || table.capacity || 1));
    };

    const handleSaveSeating = async () => {
        if (!editingTable || !user?.restaurantUsername) {return;}
        if (!ensureAdmin()) {return;}

        const capacityValue = Number(editCapacity);
        const maxValue = Number(editMaxCapacity);
        if (!Number.isInteger(capacityValue) || capacityValue < 1 || !Number.isInteger(maxValue) || maxValue < 1) {
            toast({
                title: "Invalid seating",
                description: "Seats and max with extra chairs must both be whole numbers of 1 or more.",
                variant: "destructive",
            });
            return;
        }
        if (maxValue < capacityValue) {
            toast({
                title: "Maximum too small",
                description: `Max with extra chairs cannot be below the ${capacityValue} normal seats.`,
                variant: "destructive",
            });
            return;
        }

        setSavingSeating(true);
        try {
            const updated = await updateTableSeating(user.restaurantUsername, editingTable.name, {
                capacity: capacityValue,
                max_capacity: maxValue,
            });
            toast({
                title: "Seating updated",
                description: `${updated.table_name} now seats ${updated.capacity} (max ${updated.max_capacity}).`,
            });
            setEditingTable(null);
            await loadTables();
        } catch (error: any) {
            toast({
                title: "Unable to update seating",
                description: String(error?.message ?? "Failed to save the seating numbers."),
                variant: "destructive",
            });
        } finally {
            setSavingSeating(false);
        }
    };

    const handleRemoveTable = async (tableId: number) => {
        if (!ensureAdmin()) {return;}

        if (!user?.restaurantUsername) {return;}
        const removed = tablesData.find(t => t.id === tableId);
        if (!removed) {return;}

        const response = await requestBackend({
            path: `/table/${encodeURIComponent(removed.name)}`,
            method: "DELETE",
            restaurantId: user.restaurantUsername,
        });

        if (!response.ok && response.status !== 204) {
            throw new Error("Failed to delete table");
        }

        // await addAuditLogEntry(user.restaurantUsername, {
        //     employee: ( `${user?.emp_Fname ?? ''}${user?.emp_Lname ? ` ${user.emp_Lname}` : ''}`.trim() || user?.employeeUsername ) ?? user?.employeeId ?? "System",
        //     employeeId: user?.employeeId,
        //     action: "Table Removed",
        //     details: `Deleted table ${removed.name}`,
        // });

        await loadTables();
        toast({
            title: "Table Removed",
            description: "The table has been successfully deleted.",
        });
    };

    // --- Sections -----------------------------------------------------------

    const openAddSection = () => {
        if (!ensureAdmin()) {return;}
        setSectionName("");
        setSectionDialog({ mode: "add" });
    };

    const openRenameSection = (sectionId: string, currentName: string) => {
        if (!ensureAdmin()) {return;}
        setSectionName(currentName);
        setSectionDialog({ mode: "rename", id: sectionId });
    };

    /*
        Every section write is optimistic: the layout moves first so the floor
        never stalls under the cursor, then the write goes out, and a rejection
        puts the previous layout AND the previous roster straight back and
        reloads the truth. Both, because the roster is what decides a zone
        exists — rolling back one without the other leaves a zone that is drawn
        but not real, or real but not drawn.
    */
    const revertLayout = useCallback((previous: TableLayout, previousZones: string[] | null, title: string, error: unknown) => {
        commitLayout(previous);
        commitZones(previousZones);
        toast({
            title,
            description: String((error as any)?.message ?? "The change was rolled back."),
            variant: "destructive",
        });
        loadTables().catch((err) => { console.error("reload after failed section write", err); });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [commitLayout, commitZones, toast]);

    // The section routes answer with {"error":"…"}; the raw body would put JSON
    // in front of the owner.
    const backendMessage = (response: { data: unknown; text: string }, fallback: string): string => {
        const message = (response.data as { error?: unknown } | null)?.error;
        return typeof message === "string" && message.trim() ? message : (response.text || fallback);
    };

    const handleSaveSection = async () => {
        if (!sectionDialog || !user?.restaurantUsername) {return;}
        const trimmed = normalizeSectionName(sectionName);
        if (!trimmed) {
            toast({ title: "Name required", description: "Give the section a name.", variant: "destructive" });
            return;
        }

        const clashes = layoutRef.current.sections.some(
            (section) => section.id !== sectionDialog.id && section.name.toLowerCase() === trimmed.toLowerCase(),
        );
        if (clashes) {
            toast({
                title: "Duplicate section",
                description: `A section called "${trimmed}" already exists.`,
                variant: "destructive",
            });
            return;
        }

        const previous = layoutRef.current;
        const previousZones = serverZonesRef.current;
        const current = previous.sections.find((section) => section.id === sectionDialog.id);

        if (sectionDialog.mode === "add") {
            /*
                Optimistic on BOTH the layout and the roster. The roster is what
                decides a zone exists, so a zone added to the layout alone would be
                reconciled straight back off the floor on the very next render.
                Then POST /table-sections makes it real — and audited, and visible
                to the owner app and every other browser, which writing it to
                localStorage never was.
            */
            commitLayout(addSection(previous, trimmed));
            commitZones(previousZones ? [...previousZones, trimmed] : previousZones);
            setSectionDialog(null);
            setSavingSection(true);
            try {
                const response = await requestBackend<{ section?: string }>({
                    path: "/table-sections",
                    method: "POST",
                    restaurantId: user.restaurantUsername,
                    body: { name: trimmed },
                });
                if (!response.ok) {
                    throw new Error(backendMessage(response, "Failed to create the section"));
                }
                toast({ title: "Section created", description: `Drag tables into "${trimmed}".` });
                await loadSectionRoster();
            } catch (error) {
                revertLayout(previous, previousZones, "Unable to create the section", error);
            } finally {
                setSavingSection(false);
            }
            return;
        }

        if (!current) {
            // Reconciled away under the open dialog, or deleted on another device.
            setSectionDialog(null);
            toast({
                title: "Section not found",
                description: "That section is no longer on the floor.",
                variant: "destructive",
            });
            return;
        }

        commitLayout(renameSection(previous, sectionDialog.id ?? "", trimmed));
        // The roster is keyed by name, so it has to follow the rename or the next
        // reconcile drops the section it can no longer find under its new heading.
        commitZones(previousZones
            ? previousZones.map((zone) => (zone.toLowerCase() === current.name.toLowerCase() ? trimmed : zone))
            : previousZones);
        setSectionDialog(null);

        setSavingSection(true);
        try {
            // An empty section now has a roster row of its own, so it is renamed on
            // the server exactly like a full one — no local-only shortcut.
            const response = await requestBackend<{ section?: string; updated?: number }>({
                path: `/table-sections/${encodeURIComponent(current.name)}`,
                method: "PATCH",
                restaurantId: user.restaurantUsername,
                body: { name: trimmed },
            });
            if (!response.ok) {
                throw new Error(backendMessage(response, "Failed to rename the section"));
            }
            // Re-label the rows in memory before the refetch lands, otherwise the
            // reconcile briefly reads the OLD name off the stale snapshot and
            // resurrects the section under its previous heading.
            const moved = new Set(current.tables);
            setTablesData((tables) => tables.map((table) =>
                moved.has(table.name.toLowerCase()) ? { ...table, section: trimmed } : table,
            ));
            const updated = response.data?.updated ?? current.tables.length;
            toast({
                title: "Section renamed",
                description: updated > 0
                    ? `${updated} table${updated === 1 ? "" : "s"} now in "${trimmed}".`
                    : `The empty section is now called "${trimmed}".`,
            });
            await loadTables();
        } catch (error) {
            revertLayout(previous, previousZones, "Unable to rename the section", error);
        } finally {
            setSavingSection(false);
        }
    };

    const handleRemoveSection = async (sectionId: string, name: string) => {
        if (!ensureAdmin() || !user?.restaurantUsername) {return;}
        const previous = layoutRef.current;
        const previousZones = serverZonesRef.current;
        const doomed = previous.sections.find((section) => section.id === sectionId);
        if (!doomed) {return;}
        commitLayout(removeSection(previous, sectionId));
        commitZones(previousZones
            ? previousZones.filter((zone) => zone.toLowerCase() !== doomed.name.toLowerCase())
            : previousZones);

        try {
            // Un-labels the tables and drops the roster row; the DELETE route never
            // deletes a table. An empty section has a roster row of its own now, so
            // it needs this call every bit as much as a full one does.
            const response = await requestBackend({
                path: `/table-sections/${encodeURIComponent(doomed.name)}`,
                method: "DELETE",
                restaurantId: user.restaurantUsername,
            });
            if (!response.ok) {
                throw new Error(backendMessage(response, "Failed to remove the section"));
            }
            // Same reason as the rename: un-label the rows in memory first.
            const freed = new Set(doomed.tables);
            setTablesData((tables) => tables.map((table) =>
                freed.has(table.name.toLowerCase()) ? { ...table, section: null } : table,
            ));
            toast({
                title: "Section deleted",
                description: doomed.tables.length === 0
                    ? `"${name}" was empty, so nothing moved.`
                    : `Tables from "${name}" moved back to Unassigned.`,
            });
            await loadTables();
        } catch (error) {
            revertLayout(previous, previousZones, "Unable to remove the section", error);
        }
    };

  const handleDragStart = (event: DragStartEvent) => {
        setActiveId(Number(event.active.id));
  };

  const handleDragEnd = async (event: DragEndEvent) => {
        setActiveId(null);
        if (!ensureAdmin()) {
            return;
        }

        const { active, over } = event;
        if (!over || active.id === over.id) {
            return;
        }

        const dragged = tablesData.find((table) => table.id === Number(active.id));
        if (!dragged) {return;}

        const previous = layoutRef.current;
        const previousZones = serverZonesRef.current;
        // Reconciled with the roster so an EMPTY zone is a valid drop target.
        const current = applyServerSections(previous, tablesData, previousZones);
        const draggedKey = dragged.name.toLowerCase();
        const fromSection = current.sections.find((section) => section.tables.includes(draggedKey));

        const overId = String(over.id);
        let targetSectionId: string;
        let beforeName: string | null = null;

        if (overId.startsWith(SECTION_DROP_PREFIX)) {
            // Dropped on the section's empty space — append to the end.
            targetSectionId = overId.slice(SECTION_DROP_PREFIX.length);
        } else {
            const overTable = tablesData.find((table) => table.id === Number(over.id));
            if (!overTable) {return;}
            const overKey = overTable.name.toLowerCase();
            const targetSection = current.sections.find((section) => section.tables.includes(overKey));
            if (!targetSection) {return;}
            targetSectionId = targetSection.id;

            // Reordering INSIDE one section: dragging downwards has to land after
            // the card it was dropped on, otherwise the card never passes it.
            const overIndex = targetSection.tables.indexOf(overKey);
            const fromIndex = fromSection?.id === targetSection.id ? targetSection.tables.indexOf(draggedKey) : -1;
            beforeName = fromIndex >= 0 && fromIndex < overIndex
                ? (targetSection.tables[overIndex + 1] ?? null)
                : overKey;
        }

        if (fromSection?.id === targetSectionId && beforeName === null && overId.startsWith(SECTION_DROP_PREFIX)) {
            return;
        }

        const next = moveTable(current, dragged.name, targetSectionId, beforeName);
        commitLayout(next);

        // Reordering inside one section is arrangement only — there is no
        // position column, so nothing is written. CHANGING section is one
        // single-row PATCH; the card has already moved, so a failure has to put
        // it back exactly where it was.
        if (!fromSection || fromSection.id === targetSectionId) {
            return;
        }

        const target = next.sections.find((section) => section.id === targetSectionId);
        const targetName = target?.name ?? UNASSIGNED_SECTION_NAME;
        if (!user?.restaurantUsername) {return;}

        try {
            const response = await requestBackend<{ section?: string | null }>({
                path: `/table/${encodeURIComponent(dragged.name)}`,
                method: "PATCH",
                restaurantId: user.restaurantUsername,
                // null un-labels the row — dropping a table back into Unassigned.
                body: { section: isUnassignedSection(targetSectionId) ? null : targetName },
            });
            if (!response.ok) {
                throw new Error(response.text || "Failed to move the table");
            }
            // Keep the in-memory row in step so a re-render (or a drag straight
            // afterwards) does not read a stale zone off the old snapshot.
            setTablesData((tables) => tables.map((table) =>
                table.name === dragged.name
                    ? { ...table, section: isUnassignedSection(targetSectionId) ? null : targetName }
                    : table,
            ));
            toast({
                title: "Table moved",
                description: `${dragged.name} is now in ${targetName}.`,
            });
        } catch (error) {
            // A move never touches the roster, so it is handed back unchanged.
            revertLayout(previous, previousZones, `Could not move ${dragged.name}`, error);
        }
  };

    const activeTable = activeId ? tablesData.find(t => t.id === activeId) : null;

    const tablesByKey = useMemo(
        () => new Map(tablesData.map((table) => [table.name.toLowerCase(), table])),
        [tablesData],
    );

    // Render straight off a reconciled copy so a table is never invisible for the
    // frame between the tables loading and the persist effect running.
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
    const unavailableTables = tablesData.filter(t => t.status !== "Available").length;
    const openOrdersForTable = (tableName: string, linkedOrderId?: string | null) => {
        const params = new URLSearchParams();
        params.set('table', tableName);
        if (linkedOrderId) {params.set('highlightOrder', linkedOrderId);}
        router.push(`/dashboard/orders?${params.toString()}`);
    };

    const handleOccupyTable = async (tableName: string, numCovers: number) => {
        if (!user?.restaurantUsername) {return;}
        setBusyTableName(tableName);
        try {
            await occupyTable(user.restaurantUsername, tableName, numCovers);
            toast({
                title: "Table occupied",
                description: `${tableName} is now marked occupied with ${numCovers} cover${numCovers === 1 ? "" : "s"}.`,
            });
            await loadTables();
        } catch (error: any) {
            toast({
                title: "Unable to update table",
                description: String(error?.message ?? "Failed to mark the table occupied."),
                variant: "destructive",
            });
        } finally {
            setBusyTableName(null);
        }
    };

    const handleUpdateTableCovers = async (tableName: string, numCovers: number) => {
        if (!user?.restaurantUsername) {return;}
        setBusyTableName(tableName);
        try {
            await updateTableCovers(user.restaurantUsername, tableName, numCovers);
            toast({
                title: "Covers updated",
                description: `${tableName} now has ${numCovers} cover${numCovers === 1 ? "" : "s"}.`,
            });
            await loadTables();
        } catch (error: any) {
            toast({
                title: "Unable to update covers",
                description: String(error?.message ?? "Failed to save the cover count."),
                variant: "destructive",
            });
        } finally {
            setBusyTableName(null);
        }
    };

    const handleReleaseTable = async (tableName: string) => {
        if (!user?.restaurantUsername) {return;}
        setBusyTableName(tableName);
        try {
            await releaseTable(user.restaurantUsername, tableName);
            toast({
                title: "Table released",
                description: `${tableName} is now available.`,
            });
            await loadTables();
        } catch (error: any) {
            toast({
                title: "Unable to release table",
                description: String(error?.message ?? "Failed to mark the table available."),
                variant: "destructive",
            });
        } finally {
            setBusyTableName(null);
        }
    };

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={handleDragStart} onDragEnd={(event) => { void handleDragEnd(event); }}>
        <div className="grid gap-4 md:gap-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-lg font-semibold md:text-2xl">Table Management</h1>
            <div className="flex items-center gap-2">
            {canManageSections && (
            <Button variant="outline" onClick={openAddSection}>
                <LayoutGrid className="mr-2 h-4 w-4" />
                Add Section
            </Button>
            )}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
                <Button>
                <PlusCircle className="mr-2 h-4 w-4" />
                Add Table
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                <DialogTitle>Add New Table</DialogTitle>
                <DialogDescription>
                    Enter the details for the new table. Click save when you&apos;re done.
                </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="name" className="text-right">
                    Table Name
                    </Label>
                    <Input
                    id="name"
                    value={newTableName}
                    onChange={(e) => { setNewTableName(e.target.value); }}
                    className="col-span-3"
                    placeholder="e.g., T11"
                    />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="capacity" className="text-right">
                    Seats
                    </Label>
                    <Input
                    id="capacity"
                    type="number"
                    min={1}
                    value={newTableCapacity}
                    onChange={(e) => { setNewTableCapacity(e.target.value); }}
                    className="col-span-3"
                    placeholder="e.g., 4"
                    />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="table-section" className="text-right">
                    Section
                    </Label>
                    <div className="col-span-3">
                        <select
                            id="table-section"
                            value={newTableSection}
                            onChange={(e) => { setNewTableSection(e.target.value); }}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                            <option value="">Unassigned</option>
                            {layout.sections
                                .filter((sec) => sec.name && sec.name.toLowerCase() !== UNASSIGNED_SECTION_NAME.toLowerCase())
                                .map((sec) => (
                                    <option key={sec.id} value={sec.name}>{sec.name}</option>
                                ))}
                        </select>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                            Put the table straight into a zone, or leave it Unassigned and drag it later.
                        </p>
                    </div>
                </div>
                <div className="grid grid-cols-4 items-start gap-4">
                    <Label htmlFor="max-capacity" className="pt-2 text-right">
                    Max with extra chairs
                    </Label>
                    <div className="col-span-3">
                        <Input
                        id="max-capacity"
                        type="number"
                        min={1}
                        value={newTableMaxCapacity}
                        onChange={(e) => { setNewTableMaxCapacity(e.target.value); }}
                        placeholder={newTableCapacity ? `defaults to ${newTableCapacity}` : "same as seats"}
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                            The most this table can take when you squeeze in extra chairs. Leave blank to use the seat count.
                        </p>
                    </div>
                </div>
                </div>
                <DialogFooter>
                <Button onClick={handleAddTable}>Save changes</Button>
                </DialogFooter>
            </DialogContent>
            </Dialog>
            </div>
        </div>
        <Card>
            <CardHeader>
            <CardTitle>Table Status Overview</CardTitle>
            {totalTables > 0 ? (
                <CardDescription className="text-sm text-muted-foreground">
                    {unavailableTables} of {totalTables} tables are currently booked or reserved.
                    {" "}
                    {isAdmin
                        ? "Drag a table by its grip to reorder it or move it into another section — a move is saved on the server as you drop."
                        : "Only an admin can rearrange the floor."}
                </CardDescription>
            ) : (
                <CardDescription className="text-sm text-muted-foreground">
                    No tables have been added yet.
                </CardDescription>
            )}
            </CardHeader>
            <CardContent>
                {totalTables > 0 ? (
                    <div className="space-y-8">
                        {renderSections.map((section) => {
                            const reserved = isUnassignedSection(section.id);
                            // The reserved bucket only earns a header once real
                            // sections exist — otherwise it is just "the floor".
                            const showHeader = !reserved || hasCustomSections;
                            if (reserved && !hasCustomSections && section.tables.length === 0) {
                                return null;
                            }
                            const seats = section.tables.reduce((sum, table) => sum + (table.capacity || 0), 0);
                            return (
                                <div key={section.id}>
                                    {showHeader ? (
                                        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                                            <h3 className="text-lg font-semibold flex items-center md:text-xl">
                                                <LayoutGrid className="mr-2 h-5 w-5" /> {section.name}
                                                <span className="ml-3 text-xs font-normal text-muted-foreground">
                                                    {section.tables.length} table{section.tables.length === 1 ? "" : "s"} · {seats} seats
                                                </span>
                                            </h3>
                                            {/* Every entry in this menu needs the sections permission, so the
                                                trigger is hidden rather than opening an empty menu. */}
                                            {reserved || !canManageSections ? null : (
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-7 w-7">
                                                            <MoreVertical className="h-4 w-4" />
                                                            <span className="sr-only">Section actions</span>
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem onSelect={() => { openRenameSection(section.id, section.name); }}>
                                                            <Pencil className="mr-2 h-4 w-4" />
                                                            Rename section
                                                        </DropdownMenuItem>
                                                        <AlertDialog>
                                                            <AlertDialogTrigger asChild>
                                                                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); }} className="text-destructive">
                                                                    <Trash2 className="mr-2 h-4 w-4" />
                                                                    Delete section
                                                                </DropdownMenuItem>
                                                            </AlertDialogTrigger>
                                                            <AlertDialogContent>
                                                                <AlertDialogHeader>
                                                                    <AlertDialogTitle>Delete &ldquo;{section.name}&rdquo;?</AlertDialogTitle>
                                                                    <AlertDialogDescription>
                                                                        {section.tables.length === 0
                                                                            ? "The section is empty, so nothing moves."
                                                                            : `The ${section.tables.length} table${section.tables.length === 1 ? "" : "s"} in it move back to Unassigned.`}
                                                                        {" "}No table is deleted.
                                                                    </AlertDialogDescription>
                                                                </AlertDialogHeader>
                                                                <AlertDialogFooter>
                                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                    <AlertDialogAction
                                                                        onClick={() => { void handleRemoveSection(section.id, section.name); }}
                                                                        className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                                                                    >
                                                                        Delete section
                                                                    </AlertDialogAction>
                                                                </AlertDialogFooter>
                                                            </AlertDialogContent>
                                                        </AlertDialog>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            )}
                                        </div>
                                    ) : null}
                                    <SectionDropZone sectionId={section.id} isEmpty={section.tables.length === 0}>
                                        <SortableContext items={section.tables.map((table) => table.id)}>
                                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-8 gap-4">
                                                {section.tables.map((table) => (
                                                    <SortableTable
                                                        key={table.id}
                                                        table={table}
                                                        occupancy={tableOccupancyByName[table.name.toLowerCase()] ?? null}
                                                        combined={combinedByName[table.name.toLowerCase()] ?? null}
                                                        canDrag={isAdmin}
                                                        onRemove={handleRemoveTable}
                                                        onEdit={openEditTable}
                                                        onOpenOrders={openOrdersForTable}
                                                        onOccupy={handleOccupyTable}
                                                        onRelease={handleReleaseTable}
                                                        onUpdateCovers={handleUpdateTableCovers}
                                                        busyTableName={busyTableName}
                                                    />
                                                ))}
                                            </div>
                                        </SortableContext>
                                    </SectionDropZone>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="text-center text-muted-foreground py-12">
                        <p className="mb-4">You have no tables configured for your restaurant.</p>
                        <Button onClick={() => { setIsDialogOpen(true); }}>Add Your First Table</Button>
                    </div>
                )}
            </CardContent>
        </Card>
        <Dialog open={sectionDialog !== null} onOpenChange={(open) => { if (!open) {setSectionDialog(null);} }}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>{sectionDialog?.mode === "rename" ? "Rename section" : "New section"}</DialogTitle>
                    <DialogDescription>
                        Sections group the floor — Main Hall, Patio, Rooftop, Private Dining. Drag any table
                        into a section to move it; the move is saved on the server, so everyone sees it.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-2 py-2">
                    <Label htmlFor="section-name">Section name</Label>
                    <Input
                        id="section-name"
                        value={sectionName}
                        maxLength={SECTION_NAME_MAX}
                        onChange={(e) => { setSectionName(e.target.value); }}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleSaveSection(); } }}
                        placeholder="e.g., Patio"
                    />
                    {sectionDialog?.mode === "add" ? (
                        <p className="text-xs text-muted-foreground">
                            The section is saved on the server straight away, so every device sees it —
                            it just holds no tables until you drag one in.
                        </p>
                    ) : null}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => { setSectionDialog(null); }}>Cancel</Button>
                    <Button onClick={() => { void handleSaveSection(); }} disabled={savingSection}>
                        {savingSection ? "Saving…" : sectionDialog?.mode === "rename" ? "Save name" : "Create section"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        <Dialog open={editingTable !== null} onOpenChange={(open) => { if (!open) {setEditingTable(null);} }}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Edit seating — {editingTable?.name}</DialogTitle>
                    <DialogDescription>
                        &ldquo;Seats&rdquo; is the normal cover count. &ldquo;Max with extra chairs&rdquo; is the largest party the
                        table can take; reservations use it to decide when two tables have to be clubbed together.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-2">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="edit-capacity" className="text-right">Seats</Label>
                        <Input
                            id="edit-capacity"
                            type="number"
                            min={1}
                            value={editCapacity}
                            onChange={(e) => { setEditCapacity(e.target.value); }}
                            className="col-span-3"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="edit-max-capacity" className="text-right">Max with extra chairs</Label>
                        <Input
                            id="edit-max-capacity"
                            type="number"
                            min={1}
                            value={editMaxCapacity}
                            onChange={(e) => { setEditMaxCapacity(e.target.value); }}
                            className="col-span-3"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => { setEditingTable(null); }}>Cancel</Button>
                    <Button onClick={handleSaveSeating} disabled={savingSeating}>
                        {savingSeating ? "Saving…" : "Save seating"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        </div>
         <DragOverlay>
            {activeTable ? (
                <SortableTable
                    table={activeTable}
                    occupancy={tableOccupancyByName[activeTable.name.toLowerCase()] ?? null}
                    combined={combinedByName[activeTable.name.toLowerCase()] ?? null}
                    canDrag={false}
                    onRemove={() => {}}
                    onEdit={() => {}}
                    onOpenOrders={openOrdersForTable}
                    onOccupy={handleOccupyTable}
                    onRelease={handleReleaseTable}
                    onUpdateCovers={handleUpdateTableCovers}
                    busyTableName={busyTableName}
                />
            ) : null}
        </DragOverlay>
    </DndContext>
  );
}
