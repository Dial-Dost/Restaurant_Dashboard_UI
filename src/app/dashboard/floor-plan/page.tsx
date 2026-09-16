"use client";

/*
  THE FLOOR PLAN — D5's LAYOUT HALF, AND THE ONLY PLACE A TABLE CAN BE DELETED.

  D5: "separate the floor plan from table management. In Floor Plan users can
  rearrange, group tables and modify layout. In the Tables Section users may NOT
  move, change layout, format, or delete tables."

  The web had FUSED the two: one card grid where the same card carried a drag
  grip, a Delete, an Edit seating, a covers box, Occupy, Release and Take Orders.
  Mid-service, on a laptop, with a party waiting. This page is everything on the
  left of that sentence; /dashboard/tables is everything on the right, and it no
  longer draws a single control that changes the layout.

  WHY A SEPARATE PAGE AND NOT A MODE SWITCH. A mode is a thing you can be in by
  accident. The two jobs have different audiences (the owner sets the floor up
  once; the floor works it all night), different permissions on the server, and
  different consequences for a mis-click — which is the whole reason the client
  asked for them apart.

  C7 + H8 — 'DELETE TABLE' LIVES IN EXACTLY ONE PLACE: THE HEADER OF THIS PAGE.
  It used to sit in the overflow menu of every table card on the web, three
  pixels from "Edit seating", on the screen staff use all night. It is now one
  header control, it names the table it is about to destroy, and it spells out
  what survives and what does not — see DeleteTableDialog.

  THE SERVER IS THE CONTROL, THIS PAGE IS THE COURTESY. Every act here is gated
  server-side on the permission quoted beside it in src/lib/session-scope.ts:
  add/move/re-seat on "Table Added", delete on "Table Deleted", zones on "Manage
  Table Sections". Hiding a control this session cannot use stops it 403-ing in
  front of a guest; it is not what stops the write. A deep link to this page by
  someone who holds none of them lands on a refusal, not on a working floor
  editor.
*/

import { useCallback, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
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
import { Users, PlusCircle, MoreVertical, Trash2, GripVertical, Pencil, LayoutGrid, ShieldAlert } from "lucide-react";
import { type Table } from "../tables/data";
import {
    SECTION_NAME_MAX,
    UNASSIGNED_SECTION_NAME,
    addSection,
    applyServerSections,
    isUnassignedSection,
    moveTable,
    normalizeSectionName,
    removeSection,
    renameSection,
    type TableLayout,
} from "../tables/sections";
import { requestBackend, updateTableSeating } from "@/lib/db";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useFloorTables, type TableOccupancy } from "@/hooks/use-floor-tables";
import { RESERVED_TABLE_NAME_ERROR, isReservedPartyName } from "@/lib/next-party";
import { can } from "@/lib/session-scope";
import type { CollisionDetection, DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { DndContext, closestCenter, pointerWithin, useSensor, useSensors, PointerSensor, DragOverlay, useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable } from "@dnd-kit/sortable";

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
    if (cards.length > 0) { return cards; }
    if (withinPointer.length > 0) { return withinPointer; }
    return closestCenter(args);
};

/*
  ONE TABLE, AS A PIECE OF FURNITURE.

  Deliberately NOT a service card: no covers box, no Occupy, no Release, no Take
  Orders, and — C7/H8 — no Delete. It shows what a floor plan needs to show, which
  is where the table is and how many it seats.

  2.1 — "MAKE SURE WHAT IS SEEN IN TABLES IS NOT SHOWN IN THE FLOOR PLAN." This
  card used to carry the live floor as well: the In use / Reserved / Free badge,
  the red and blue occupancy tints the Tables screen paints (2.2), the clubbed-
  booking badge with the guest's name and time, and a "party is seated" note.
  That is the Tables screen, drawn a second time on the layout editor. It is all
  gone: the props are not taken, so it cannot creep back through a caller. The
  one place this page still asks who is sitting where is the Delete dialog, which
  refuses an occupied table before the server has to — a guard on the act, not
  a view of the floor.
*/
function PlanTable({
    table,
    canDrag,
    canEditSeating,
    onEdit,
}: {
    table: Table;
    canDrag: boolean;
    canEditSeating: boolean;
    onEdit: (table: Table) => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: table.id,
        disabled: !canDrag,
    });

    const style = {
        transform: transform ? `translate3d(${String(transform.x)}px, ${String(transform.y)}px, 0)` : undefined,
        transition,
    };

    return (
        <Card
            ref={setNodeRef}
            style={style}
            className={cn(
                "transition-all touch-none min-w-0",
                // One neutral surface for every table: occupancy colour is the
                // Tables screen's language (2.2), not the layout editor's.
                "bg-slate-800/50 border-slate-700",
                isDragging ? "opacity-50 shadow-2xl z-10" : "hover:shadow-lg hover:border-slate-600",
            )}
        >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3">
                <CardTitle className="text-xs font-medium sm:text-sm flex items-center gap-2 min-w-0">
                    <button
                        {...listeners}
                        {...attributes}
                        disabled={!canDrag}
                        title={canDrag ? "Drag to another section" : "Moving a table needs the “Table Added” permission"}
                        className={cn("p-1 shrink-0", canDrag ? "cursor-grab" : "cursor-not-allowed opacity-40")}
                    >
                        <GripVertical className="h-4 w-4 text-muted-foreground" />
                    </button>
                    <span className="truncate" title={table.name}>{table.name}</span>
                </CardTitle>
                {/* The only per-card act left is re-seating, and it rides on the same
                    "Table Added" permission as a move. Without it the menu would open
                    empty, so the trigger goes rather than the item. */}
                {canEditSeating ? (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
                                <MoreVertical className="h-4 w-4" />
                                <span className="sr-only">Table layout actions</span>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => { onEdit(table); }}>
                                <Pencil className="mr-2 h-4 w-4" />
                                Edit seating
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : null}
            </CardHeader>
            <CardContent className="p-3 pt-0">
                <div className="flex items-center text-muted-foreground text-xs">
                    <Users className="h-3 w-3 mr-1" />
                    <span>
                        Seats: {table.capacity}
                        {table.max_capacity > table.capacity ? ` · max ${String(table.max_capacity)}` : ""}
                    </span>
                </div>
            </CardContent>
        </Card>
    );
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

/*
  C7 + H8 — DELETING A TABLE, SAID OUT LOUD.

  H8: "remove from ubiquitous views; only in the 'Floor' header of the dashboard,
  and the UI must be explicit about what the action does."

  The old confirmation said "This will permanently delete the table. This action
  cannot be undone." Two words of that were true and the rest was not:
    * the backend SOFT-deletes any table that carries orders or bills, precisely
      so those records survive — so "permanently" was wrong on the common case;
    * it refuses outright while a party is seated or a bill is open, so "cannot
      be undone" was being shown for an action that was about to be declined;
    * and it never said the thing that actually bites, which is that the table's
      QR code dies with it and a guest scanning the sticker on that table gets
      nothing.

  So this dialog names the table, says what goes, says what stays, and refuses to
  arm the button while the server would refuse anyway. Picking the table from a
  list rather than deleting "the one you were just looking at" is the other half
  of C7: the act is now something you go and do on purpose.
*/
function DeleteTableDialog({
    open,
    onOpenChange,
    tables,
    occupancyByName,
    onConfirm,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    tables: Table[];
    occupancyByName: Record<string, TableOccupancy>;
    onConfirm: (table: Table) => Promise<void>;
}) {
    const [selectedName, setSelectedName] = useState("");
    const [busy, setBusy] = useState(false);

    const selected = tables.find((table) => table.name === selectedName) ?? null;
    const occupancy = selected ? occupancyByName[selected.name.toLowerCase()] ?? null : null;
    const isOccupied = Boolean(occupancy?.is_occupied);

    const confirm = async () => {
        if (!selected || isOccupied) { return; }
        setBusy(true);
        try {
            await onConfirm(selected);
            setSelectedName("");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!busy) { onOpenChange(next); } }}>
            <DialogContent className="sm:max-w-[480px]">
                <DialogHeader>
                    <DialogTitle>Delete a table</DialogTitle>
                    <DialogDescription>
                        This takes a table off the floor for good. It is the only place in the dashboard that can.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-2">
                    <Label htmlFor="delete-table-pick">Which table?</Label>
                    <select
                        id="delete-table-pick"
                        value={selectedName}
                        onChange={(e) => { setSelectedName(e.target.value); }}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                        <option value="">Choose a table…</option>
                        {[...tables]
                            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
                            .map((table) => (
                                <option key={table.id} value={table.name}>
                                    {table.name} · {table.capacity} seats{table.section ? ` · ${table.section}` : ""}
                                </option>
                            ))}
                    </select>
                </div>

                {selected ? (
                    <div className="space-y-3">
                        <div className="rounded-md border border-destructive/50 bg-destructive/[0.06] p-3 text-sm">
                            <p className="font-semibold">Deleting {selected.name} will:</p>
                            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-muted-foreground">
                                <li>take it off the floor plan and out of the Tables screen for everyone;</li>
                                <li>
                                    kill its QR code — a guest scanning the sticker on {selected.name} will not be
                                    able to order, and a new sticker is needed if you ever add it back;
                                </li>
                                <li>free it from {selected.section ? `the “${selected.section}” section` : "the Unassigned section"} and from any waiter assigned to it;</li>
                                <li>remove it from future reservations and from the seating suggestions.</li>
                            </ul>
                        </div>
                        <div className="rounded-md border p-3 text-sm">
                            <p className="font-semibold">What it will NOT do:</p>
                            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-muted-foreground">
                                {/* Accurate to RemoveTable: a table carrying orders or bills is
                                    soft-deleted precisely so those records survive, and only a
                                    table with no history at all is actually removed. Telling an
                                    owner their sales history is about to go is how they never
                                    press the button that tidies their floor. */}
                                <li>Past orders, bills and reports for {selected.name} stay exactly as they are.</li>
                                <li>No money moves, and nothing in accounting changes.</li>
                            </ul>
                        </div>
                        {isOccupied ? (
                            <div className="rounded-md border border-amber-500/60 bg-amber-500/[0.07] p-3 text-sm">
                                <p className="font-semibold">{selected.name} has a party seated on it right now.</p>
                                <p className="mt-1 text-muted-foreground">
                                    Settle or release it from the Tables screen first. The server refuses to delete an
                                    occupied table or one with an open bill, so this would fail anyway — and taking the
                                    table away underneath a live bill is exactly what that rule exists to prevent.
                                </p>
                            </div>
                        ) : null}
                    </div>
                ) : null}

                <DialogFooter>
                    <Button variant="outline" onClick={() => { onOpenChange(false); }} disabled={busy}>Cancel</Button>
                    <Button
                        variant="destructive"
                        onClick={() => { void confirm(); }}
                        disabled={busy || !selected || isOccupied}
                    >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {selected ? `Delete ${selected.name}` : "Delete table"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default function FloorPlanPage() {
    const { user } = useAuth();
    const { toast } = useToast();

    /*
      THE THREE LAYOUT PERMISSIONS, ASKED OF THE SERVER'S OWN ANSWER.

      Not of the role name. A manager, a floor supervisor on a custom role and an
      owner whose stored primary role got mangled into "employee" are all people
      the backend will happily serve here; a role-name test refuses two of the
      three. `actions_set` is the resolved list the routes themselves check.
    */
    const canManageSections = can(user, "manage_table_sections");
    const canEditLayout = can(user, "edit_table");
    const canDeleteTables = can(user, "delete_table");

    // THE ROOM ONLY (client item 6): the next party's seat at a printed table
    // ("12 #2") is not furniture — the server opens and retires it — so it is
    // never listed, dragged, counted or offered for deletion here.
    const floor = useFloorTables(user, { roomOnly: true });
    const {
        tables: tablesData,
        occupancyByName,
        serverZones,
        layout,
        commitLayout,
        commitZones,
        layoutRef,
        serverZonesRef,
        setTables,
        reload: loadTables,
        reloadZones: loadSectionRoster,
    } = floor;

    const [isAddTableOpen, setIsAddTableOpen] = useState(false);
    const [newTableName, setNewTableName] = useState("");
    const [newTableCapacity, setNewTableCapacity] = useState("");
    const [newTableMaxCapacity, setNewTableMaxCapacity] = useState("");
    const [newTableSection, setNewTableSection] = useState("");
    const [activeId, setActiveId] = useState<number | null>(null);
    const [editingTable, setEditingTable] = useState<Table | null>(null);
    const [editCapacity, setEditCapacity] = useState("");
    const [editMaxCapacity, setEditMaxCapacity] = useState("");
    const [savingSeating, setSavingSeating] = useState(false);
    const [sectionDialog, setSectionDialog] = useState<{ mode: "add" | "rename"; id?: string } | null>(null);
    const [sectionName, setSectionName] = useState("");
    const [savingSection, setSavingSection] = useState(false);
    const [isDeleteTableOpen, setIsDeleteTableOpen] = useState(false);

    const sensors = useSensors(useSensor(PointerSensor));

    // The toast has to name the permission the owner ticks; "required role:
    // admin" sends them looking for a grant that does not exist.
    const ensurePermission = (granted: boolean, permissionName: string) => {
        if (granted) { return true; }
        toast({
            title: "Access denied",
            description: `You do not have the required permission for this action. Required permission: ${permissionName}.`,
            variant: "destructive",
        });
        return false;
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
            description: error instanceof Error ? error.message : "The change was rolled back.",
            variant: "destructive",
        });
        loadTables().catch((err: unknown) => { console.error("reload after failed section write", err); });
    }, [commitLayout, commitZones, toast, loadTables]);

    // The section routes answer with {"error":"…"}; the raw body would put JSON
    // in front of the owner.
    const backendMessage = (response: { data: unknown; text: string }, fallback: string): string => {
        const message = (response.data as { error?: unknown } | null)?.error;
        return typeof message === "string" && message.trim() ? message : (response.text || fallback);
    };

    const handleAddTable = async () => {
        if (!ensurePermission(canEditLayout, "Table Added")) { return; }
        if (!newTableName || !newTableCapacity || !user?.restaurantUsername) { return; }

        const trimmedName = newTableName.trim();
        // "12 #2" is the server's to make; its own sentence, before the request.
        if (isReservedPartyName(trimmedName)) {
            toast({ title: "Pick another name", description: RESERVED_TABLE_NAME_ERROR, variant: "destructive" });
            return;
        }
        const existingTable = tablesData.find((table) => table.name.toLowerCase() === trimmedName.toLowerCase());
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
                description: `Max with extra chairs cannot be below the ${String(capacityValue)} normal seats.`,
                variant: "destructive",
            });
            return;
        }

        const chosenSection = newTableSection.trim();
        const response = await requestBackend({
            path: "/add-table",
            method: "POST",
            restaurantId: user.restaurantUsername,
            body: {
                table: {
                    name: trimmedName,
                    capacity: capacityValue,
                    max_capacity: maxValue,
                    // Omitted entirely when Unassigned, so the backend leaves it null.
                    ...(chosenSection ? { section: chosenSection } : {}),
                },
            },
        });

        if (!response.ok) {
            toast({
                title: "Unable to add the table",
                description: backendMessage(response, "Failed to create table"),
                variant: "destructive",
            });
            return;
        }

        await loadTables();
        setNewTableName("");
        setNewTableCapacity("");
        setNewTableMaxCapacity("");
        setNewTableSection("");
        setIsAddTableOpen(false);
        toast({ title: "Table added", description: `${trimmedName} is on the floor.` });
    };

    const openEditTable = (table: Table) => {
        if (!ensurePermission(canEditLayout, "Table Added")) { return; }
        setEditingTable(table);
        setEditCapacity(String(table.capacity || 1));
        setEditMaxCapacity(String(table.max_capacity || table.capacity || 1));
    };

    const handleSaveSeating = async () => {
        if (!editingTable || !user?.restaurantUsername) { return; }
        if (!ensurePermission(canEditLayout, "Table Added")) { return; }

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
                description: `Max with extra chairs cannot be below the ${String(capacityValue)} normal seats.`,
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
                description: `${updated.table_name} now seats ${String(updated.capacity)} (max ${String(updated.max_capacity)}).`,
            });
            setEditingTable(null);
            await loadTables();
        } catch (error: unknown) {
            toast({
                title: "Unable to update seating",
                description: error instanceof Error ? error.message : "Failed to save the seating numbers.",
                variant: "destructive",
            });
        } finally {
            setSavingSeating(false);
        }
    };

    // --- Sections -----------------------------------------------------------

    const openAddSection = () => {
        if (!ensurePermission(canManageSections, "Manage Table Sections")) { return; }
        setSectionName("");
        setSectionDialog({ mode: "add" });
    };

    const openRenameSection = (sectionId: string, currentName: string) => {
        if (!ensurePermission(canManageSections, "Manage Table Sections")) { return; }
        setSectionName(currentName);
        setSectionDialog({ mode: "rename", id: sectionId });
    };

    const handleSaveSection = async () => {
        if (!sectionDialog || !user?.restaurantUsername) { return; }
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
            setTables((tables) => tables.map((table) =>
                moved.has(table.name.toLowerCase()) ? { ...table, section: trimmed } : table,
            ));
            const updated = response.data?.updated ?? current.tables.length;
            toast({
                title: "Section renamed",
                description: updated > 0
                    ? `${String(updated)} table${updated === 1 ? "" : "s"} now in "${trimmed}".`
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
        if (!ensurePermission(canManageSections, "Manage Table Sections") || !user?.restaurantUsername) { return; }
        const previous = layoutRef.current;
        const previousZones = serverZonesRef.current;
        const doomed = previous.sections.find((section) => section.id === sectionId);
        if (!doomed) { return; }
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
            setTables((tables) => tables.map((table) =>
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

    // --- Deleting a table (C7 + H8) -----------------------------------------

    const handleDeleteTable = async (table: Table) => {
        if (!ensurePermission(canDeleteTables, "Table Deleted") || !user?.restaurantUsername) { return; }

        const response = await requestBackend({
            path: `/table/${encodeURIComponent(table.name)}`,
            method: "DELETE",
            restaurantId: user.restaurantUsername,
        });

        if (!response.ok && response.status !== 204) {
            // The backend refuses an occupied table or one with an open bill, with
            // a sentence written for a human ("Settle or release the table before
            // deleting it."). Show ITS words: the screen cannot know which of the
            // two it was, and guessing would send someone to the wrong place.
            toast({
                title: `Could not delete ${table.name}`,
                description: backendMessage(response, "Failed to delete the table."),
                variant: "destructive",
            });
            return;
        }

        setIsDeleteTableOpen(false);
        await loadTables();
        toast({
            title: "Table deleted",
            description: `${table.name} is off the floor. Its past orders and bills are untouched.`,
        });
    };

    // --- Drag and drop ------------------------------------------------------

    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(Number(event.active.id));
    };

    const handleDragEnd = async (event: DragEndEvent) => {
        setActiveId(null);
        // A drop writes PATCH /table/:name, which needs "Table Added". The grip is
        // already disabled without it; this is the same check at the write.
        if (!ensurePermission(canEditLayout, "Table Added")) { return; }

        const { active, over } = event;
        if (!over || active.id === over.id) { return; }

        const dragged = tablesData.find((table) => table.id === Number(active.id));
        if (!dragged) { return; }

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
            if (!overTable) { return; }
            const overKey = overTable.name.toLowerCase();
            const targetSection = current.sections.find((section) => section.tables.includes(overKey));
            if (!targetSection) { return; }
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
        if (!fromSection || fromSection.id === targetSectionId) { return; }

        const target = next.sections.find((section) => section.id === targetSectionId);
        const targetName = target?.name ?? UNASSIGNED_SECTION_NAME;
        if (!user?.restaurantUsername) { return; }

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
            setTables((tables) => tables.map((table) =>
                table.name === dragged.name
                    ? { ...table, section: isUnassignedSection(targetSectionId) ? null : targetName }
                    : table,
            ));
            toast({ title: "Table moved", description: `${dragged.name} is now in ${targetName}.` });
        } catch (error) {
            // A move never touches the roster, so it is handed back unchanged.
            revertLayout(previous, previousZones, `Could not move ${dragged.name}`, error);
        }
    };

    const activeTable = activeId ? tablesData.find((t) => t.id === activeId) : null;

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
    const totalSeats = tablesData.reduce((sum, table) => sum + (table.capacity || 0), 0);

    /*
      A DEEP LINK BY SOMEBODY WHO HOLDS NONE OF THE THREE LAYOUT PERMISSIONS.

      The nav does not offer this page to them and the shell bounces a scoped
      waiter out of it, but a bookmark, a back-navigation or a shared URL reaches
      it anyway — and a page of controls that every 403 is worse than a sentence.
      The controls below are individually gated too; this is the front door.
    */
    if (!canEditLayout && !canDeleteTables && !canManageSections) {
        return (
            <div className="grid gap-4 md:gap-8">
                <h1 className="text-lg font-semibold md:text-2xl">Floor Plan</h1>
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <ShieldAlert className="h-4 w-4 text-amber-600" />
                            You cannot change the floor plan
                        </CardTitle>
                        <CardDescription>
                            Editing the floor needs one of the “Table Added”, “Table Deleted” or “Manage Table
                            Sections” permissions. Ask your admin to grant one from Employees → Role Access
                            Control. Seating guests, covers and orders all live under Tables, which you can still use.
                        </CardDescription>
                    </CardHeader>
                </Card>
            </div>
        );
    }

    return (
        <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={handleDragStart} onDragEnd={(event) => { void handleDragEnd(event); }}>
            <div className="grid gap-4 md:gap-8">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <h1 className="text-lg font-semibold md:text-2xl">Floor Plan</h1>
                        <p className="text-sm text-muted-foreground">
                            The shape of the room: zones, which table sits where, and how many each seats.
                            Seating guests and taking orders happen under Tables.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {canManageSections ? (
                            <Button variant="outline" onClick={openAddSection}>
                                <LayoutGrid className="mr-2 h-4 w-4" />
                                Add Section
                            </Button>
                        ) : null}
                        {/* C7 + H8 — THE ONE AND ONLY DELETE TABLE CONTROL IN THE PRODUCT.
                            In the Floor header, named for what it does, and nowhere near
                            the cards staff touch all night. */}
                        {canDeleteTables ? (
                            <Button variant="outline" className="border-destructive/50 text-destructive hover:bg-destructive/10" onClick={() => { setIsDeleteTableOpen(true); }}>
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete table…
                            </Button>
                        ) : null}
                        {canEditLayout ? (
                            <Button onClick={() => { setIsAddTableOpen(true); }}>
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Add Table
                            </Button>
                        ) : null}
                    </div>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Layout</CardTitle>
                        <CardDescription className="text-sm text-muted-foreground">
                            {totalTables > 0
                                ? <>{totalTables} table{totalTables === 1 ? "" : "s"} · {totalSeats} seats. {canEditLayout
                                    ? "Drag a table by its grip to reorder it or move it into another section — a move is saved on the server as you drop."
                                    : "Rearranging the floor needs the “Table Added” permission."}</>
                                : "No tables have been added yet."}
                        </CardDescription>
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
                                                                            <AlertDialogTitle>Delete the section &ldquo;{section.name}&rdquo;?</AlertDialogTitle>
                                                                            <AlertDialogDescription>
                                                                                {section.tables.length === 0
                                                                                    ? "The section is empty, so nothing moves."
                                                                                    : `The ${String(section.tables.length)} table${section.tables.length === 1 ? "" : "s"} in it move back to Unassigned.`}
                                                                                {" "}This removes the ZONE only. No table is deleted, and no orders or bills are touched.
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
                                                            <PlanTable
                                                                key={table.id}
                                                                table={table}
                                                                canDrag={canEditLayout}
                                                                canEditSeating={canEditLayout}
                                                                onEdit={openEditTable}
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
                                {canEditLayout ? (
                                    <Button onClick={() => { setIsAddTableOpen(true); }}>Add Your First Table</Button>
                                ) : null}
                            </div>
                        )}
                    </CardContent>
                </Card>

                <DeleteTableDialog
                    open={isDeleteTableOpen}
                    onOpenChange={setIsDeleteTableOpen}
                    tables={tablesData}
                    occupancyByName={occupancyByName}
                    onConfirm={handleDeleteTable}
                />

                <Dialog open={isAddTableOpen} onOpenChange={setIsAddTableOpen}>
                    <DialogContent className="sm:max-w-[425px]">
                        <DialogHeader>
                            <DialogTitle>Add New Table</DialogTitle>
                            <DialogDescription>
                                Enter the details for the new table. Click save when you&apos;re done.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="name" className="text-right">Table Name</Label>
                                <Input
                                    id="name"
                                    value={newTableName}
                                    onChange={(e) => { setNewTableName(e.target.value); }}
                                    className="col-span-3"
                                    placeholder="e.g., T11"
                                />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="capacity" className="text-right">Seats</Label>
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
                                <Label htmlFor="table-section" className="text-right">Section</Label>
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
                                <Label htmlFor="max-capacity" className="pt-2 text-right">Max with extra chairs</Label>
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
                            <Button onClick={() => { void handleAddTable(); }}>Save changes</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                <Dialog open={sectionDialog !== null} onOpenChange={(open) => { if (!open) { setSectionDialog(null); } }}>
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

                <Dialog open={editingTable !== null} onOpenChange={(open) => { if (!open) { setEditingTable(null); } }}>
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
                            <Button onClick={() => { void handleSaveSeating(); }} disabled={savingSeating}>
                                {savingSeating ? "Saving…" : "Save seating"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
            <DragOverlay>
                {activeTable ? (
                    <PlanTable
                        table={activeTable}
                        canDrag={false}
                        canEditSeating={false}
                        onEdit={() => { /* the drag ghost is not interactive */ }}
                    />
                ) : null}
            </DragOverlay>
        </DndContext>
    );
}

