"use client";

/*
  THE FLOOR PLAN — D5's LAYOUT HALF, AND THE ONLY PLACE A TABLE CAN BE DELETED.

  D5: "separate the floor plan from table management. In Floor Plan users can
  rearrange, group tables and modify layout. In the Tables Section users may NOT
  move, change layout, format, or delete tables."

  2.1 — the plan tile is a piece of FURNITURE: name, seats, zone. No occupancy
  wash, no bill, no waiter, no OTP — that is the Tables screen's language. A tap
  opens the layout-only PlanTableSheet; the whole card is also the drag.

  The floor itself loads through the same read the Tables screen uses (one
  code path, so the zone order can never disagree between the two), the section
  ORDER is the SERVER's — owner positions, then creation order, then the
  alphabet, "Unassigned" always last — and the Arrange dialog writes the whole
  list back with PUT /table-sections/order. Nothing here persists layout to
  localStorage any more, and next-party seats ("12 #2") are not furniture, so
  the editor never shows them.

  C7 + H8 — 'DELETE TABLE' LIVES IN EXACTLY ONE PLACE: THE HEADER OF THIS PAGE.
  The picker offers only tables the server would accept (not seated), says how
  many busy ones are not listed, and the confirmation spells out what survives.

  THE SERVER IS THE CONTROL, THIS PAGE IS THE COURTESY. Every act here is gated
  server-side on the permission quoted beside it in src/lib/session-scope.ts:
  add/move/re-seat on "Table Added", delete on "Table Deleted", zones on "Manage
  Table Sections". A deep link by someone who holds none of them lands on a
  refusal, not on a working floor editor.
*/

import * as React from "react";
import {
    ArrowUpDown,
    Armchair,
    GripVertical,
    HelpCircle,
    LayoutGrid,
    Pencil,
    Plus,
    PlusCircle,
    ShieldAlert,
    Trash2,
    Ungroup,
} from "lucide-react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
    DndContext,
    DragOverlay,
    PointerSensor,
    pointerWithin,
    useDraggable,
    useDroppable,
    useSensor,
    useSensors,
} from "@dnd-kit/core";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { SectionHeader } from "@/components/ui/section-header";
import { SkeletonBox } from "@/components/ui/fork-skeleton";
import { CacheStalePill } from "@/components/ui/stale-pill";
import { InfoChip, StatusChip } from "@/components/ui/status-chip";
import { PlanTableSheet } from "@/components/tables/plan-table-sheet";
import { NewSectionDialog, ArrangeSectionsDialog } from "@/components/tables/section-dialogs";
import {
    TableSeatingDialog,
    TableRunReportSheet,
    type TableRunOutcome,
    type TableSeatingResult,
} from "@/components/tables/table-seating-dialog";
import { useFloor } from "@/components/tables/use-floor";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { updateTableSeating } from "@/lib/db";
import { can } from "@/lib/session-scope";
import {
    addFloorTable,
    allocateTableNames,
    composeFloorSections,
    createTableSection,
    deleteTableSection,
    floorScopeOf,
    isNextPartyRow,
    removeFloorTable,
    renameTableSection,
    saveSectionOrder,
    seatsLabel,
    setTableSection,
    type FloorRow,
    type FloorSectionGroup,
} from "@/lib/api/tables-floor";

// Droppable ids are namespaced; '' (Unassigned) becomes "zone:".
const ZONE_DROP_PREFIX = "zone:";
const zoneDropId = (key: string): string => `${ZONE_DROP_PREFIX}${key}`;

/*
  ONE TABLE, AS A PIECE OF FURNITURE (2.1). The WHOLE card is both the tap
  (opens the layout sheet) and the drag (the pointer sensor's 6px distance
  keeps a plain click a click). The grip stays as the visible affordance.
*/
function PlanTileCard({ row, canEditSeating, canDrag, dragging = false }: {
    row: FloorRow;
    canEditSeating: boolean;
    canDrag: boolean;
    dragging?: boolean;
}): React.JSX.Element {
    const seats = seatsLabel(row.raw);
    return (
        <span
            className={cn(
                "flex min-h-[96px] min-w-0 flex-col items-start rounded-lg border border-border p-3.5 text-left",
                "bg-card bg-gradient-to-b from-card-top to-card-bottom shadow-card",
                "transition-all duration-fast ease-out gaia:rounded-[2px]",
                dragging ? "shadow-card-hover" : "hover:-translate-y-0.5 hover:border-input",
            )}
        >
            <span className="flex w-full items-center gap-1.5">
                {canDrag ? (
                    <GripVertical aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : null}
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.01em] text-foreground gaia:font-serif">
                    {row.name}
                </span>
            </span>
            {seats !== "" ? (
                <span className="mt-2">
                    <InfoChip icon={<Armchair />} label={seats} />
                </span>
            ) : null}
            <span className="mt-auto pt-2.5 text-[11px] text-tertiary">
                {canEditSeating ? "Tap to edit seating" : "Layout"}
            </span>
        </span>
    );
}

function PlanTile({ row, sectionKey, canEditSeating, canDrag, onOpen }: {
    row: FloorRow;
    sectionKey: string;
    canEditSeating: boolean;
    canDrag: boolean;
    onOpen: (row: FloorRow) => void;
}): React.JSX.Element {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: row.name,
        data: { sectionKey },
        disabled: !canDrag,
    });
    // A finished drag still fires a click on the tile it started from; that
    // click must not open the sheet the drop just left behind.
    const draggedRef = React.useRef(false);
    React.useEffect(() => {
        if (isDragging) { draggedRef.current = true; }
    }, [isDragging]);
    return (
        <button
            ref={setNodeRef}
            type="button"
            {...attributes}
            {...listeners}
            data-testid={`plan-table-${row.name}`}
            onClick={() => {
                if (draggedRef.current) { draggedRef.current = false; return; }
                onOpen(row);
            }}
            title={canDrag ? "Drag onto another section to move it" : undefined}
            className={cn(
                "min-w-0 touch-none text-left outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg",
                isDragging && "opacity-40",
            )}
        >
            <PlanTileCard row={row} canEditSeating={canEditSeating} canDrag={canDrag} />
        </button>
    );
}

/*
  One zone: an inset group container whose WHOLE body is the drop target. The
  drop-hover paints it copper with "DROP TO MOVE HERE", and the inline rename /
  remove icon actions hide while a drag hovers.
*/
function PlanZone({ group, canManage, canMove, canEditSeating, draggingFromKey, onOpenTile, onRename, onRemove }: {
    group: FloorSectionGroup;
    canManage: boolean;
    canMove: boolean;
    canEditSeating: boolean;
    /** The section key the active drag started from; null = no drag. */
    draggingFromKey: string | null;
    onOpenTile: (row: FloorRow) => void;
    onRename: (group: FloorSectionGroup) => void;
    onRemove: (group: FloorSectionGroup) => void;
}): React.JSX.Element {
    const { setNodeRef, isOver } = useDroppable({ id: zoneDropId(group.key) });
    const hot = isOver && draggingFromKey !== null && draggingFromKey !== group.key && canMove;
    const seats = group.rows.reduce((n, r) => n + r.capacity, 0);
    return (
        <div
            ref={setNodeRef}
            className={cn(
                "rounded-lg border p-3 pb-3.5 transition-colors duration-fast gaia:rounded-[2px]",
                hot
                    ? "border-2 border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.10)]"
                    : "border-border bg-inset",
            )}
        >
            <div className="flex flex-wrap items-center gap-2">
                {group.key === ""
                    ? <HelpCircle aria-hidden className={cn("h-[15px] w-[15px] shrink-0", hot ? "text-accent-foreground" : "text-muted-foreground")} />
                    : <LayoutGrid aria-hidden className={cn("h-[15px] w-[15px] shrink-0", hot ? "text-accent-foreground" : "text-muted-foreground")} />}
                <span className={cn(
                    "text-[11px] font-bold uppercase tracking-[0.8px]",
                    hot ? "text-accent-foreground" : "text-muted-foreground",
                )}>
                    {group.name}
                </span>
                {/* An empty zone is a real, saved zone — say so. */}
                {group.rows.length === 0 && group.key !== "" ? (
                    <StatusChip status="neutral" label="Empty" dense />
                ) : (
                    <>
                        <InfoChip label={`${String(group.rows.length)} ${group.rows.length === 1 ? "table" : "tables"}`} />
                        <InfoChip label={`${String(seats)} seats`} />
                    </>
                )}
                {hot ? (
                    <span className="micro-label !text-accent-foreground">Drop to move here</span>
                ) : null}
                <span className="min-w-0 flex-1" />
                {!hot && canManage && group.key !== "" ? (
                    <span className="flex items-center gap-0.5">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Rename section"
                            onClick={() => { onRename(group); }}
                        >
                            <Pencil className="h-3.5 w-3.5" />
                            <span className="sr-only">Rename section</span>
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Remove section (tables stay)"
                            onClick={() => { onRemove(group); }}
                        >
                            <Ungroup className="h-3.5 w-3.5" />
                            <span className="sr-only">Remove section (tables stay)</span>
                        </Button>
                    </span>
                ) : null}
            </div>
            <div className="mt-3">
                {group.rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing here yet.</p>
                ) : (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
                        {group.rows.map((row) => (
                            <PlanTile
                                key={row.name}
                                row={row}
                                sectionKey={group.key}
                                canEditSeating={canEditSeating}
                                canDrag={canMove}
                                onOpen={onOpenTile}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

/** Skeleton floor: a header line and two zones of grey tiles. */
function PlanSkeleton(): React.JSX.Element {
    return (
        <div className="space-y-4" data-testid="plan-skeleton">
            <SkeletonBox width={220} height={22} />
            {[0, 1].map((zone) => (
                <div key={zone} className="rounded-lg border border-border bg-inset p-3">
                    <SkeletonBox width={160} height={14} />
                    <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <SkeletonBox key={i} height={96} />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

type Snapshot = Record<string, { had: boolean; value: string | null }>;

export default function FloorPlanPage(): React.JSX.Element {
    const { user } = useAuth();
    const { toast } = useToast();

    /*
      THE THREE LAYOUT PERMISSIONS, ASKED OF THE SERVER'S OWN ANSWER — not of
      the role name. `actions_set` is the resolved list the routes themselves
      check, and floorScopeOf ANDs it with the surface (D5).
    */
    const scope = React.useMemo(() => floorScopeOf(user ?? undefined, "plan"), [user]);
    const canManageSections = scope.arrangeFloor && can(user, "manage_table_sections");
    const canEditLayout = scope.arrangeFloor && can(user, "edit_table");
    const canDeleteTables = scope.deleteTable;

    const floor = useFloor(user, "plan");
    const { rows, zones, zoneError, zoneOrder, zoneBorn, refresh } = floor;

    // CLIENT ITEM 6 — the room has no "12 #2" in it. A next-party seat is a
    // second name for a table the plan already draws; it is not furniture.
    const planRows = React.useMemo(() => rows.filter((r) => !isNextPartyRow(r.raw)), [rows]);

    /* ── Optimistic overlays (the app's _pending / _zonePending / order) ── */
    const [pendingSections, setPendingSections] = React.useState<Record<string, string | null>>({});
    const [zoneOverlay, setZoneOverlay] = React.useState<Record<string, string | null>>({});
    const [orderPending, setOrderPending] = React.useState<string[] | null>(null);
    const pendingRef = React.useRef(pendingSections);
    pendingRef.current = pendingSections;
    const overlayRef = React.useRef(zoneOverlay);
    overlayRef.current = zoneOverlay;

    // Drop every optimistic value the server has now confirmed, so a
    // successful write never flickers back while the refresh is in flight.
    React.useEffect(() => {
        const data = floor.data;
        if (!data) { return; }
        setPendingSections((prev) => {
            const keys = Object.keys(prev);
            if (keys.length === 0) { return prev; }
            const live = new Map<string, string | null>();
            for (const r of data.rows) { live.set(r.name.toLowerCase(), r.section); }
            const next: Record<string, string | null> = {};
            let changed = false;
            for (const key of keys) {
                if (live.has(key) && live.get(key) === prev[key]) { changed = true; continue; }
                next[key] = prev[key];
            }
            return changed ? next : prev;
        });
        setZoneOverlay((prev) => {
            const keys = Object.keys(prev);
            if (keys.length === 0) { return prev; }
            const live = new Set<string>();
            for (const r of data.rows) {
                if (r.section !== null && r.section.trim() !== "") { live.add(r.section.trim().toLowerCase()); }
            }
            for (const z of data.zones) {
                if (z.trim() !== "") { live.add(z.trim().toLowerCase()); }
            }
            const next: Record<string, string | null> = {};
            let changed = false;
            for (const key of keys) {
                const value = prev[key];
                const settled = value === null ? !live.has(key) : live.has(value.toLowerCase());
                if (settled) { changed = true; continue; }
                next[key] = value;
            }
            return changed ? next : prev;
        });
        setOrderPending((prev) => {
            if (prev === null) { return prev; }
            const live = data.zoneOrder;
            let settled = prev.every((key) => key in live);
            if (settled) {
                const ranked = [...prev].sort((a, b) => live[a] - live[b]);
                settled = ranked.every((key, i) => key === prev[i]);
            }
            return settled ? null : prev;
        });
    }, [floor.data]);

    const restoreInto = (
        current: Record<string, string | null>,
        snap: Snapshot,
    ): Record<string, string | null> => {
        const next: Record<string, string | null> = {};
        for (const [key, value] of Object.entries(current)) {
            const s = snap[key] as Snapshot[string] | undefined;
            if (s === undefined) { next[key] = value; } else if (s.had) { next[key] = s.value; }
        }
        for (const [key, s] of Object.entries(snap)) {
            if (s.had && !(key in next)) { next[key] = s.value; }
        }
        return next;
    };
    const restorePending = (snap: Snapshot): void => {
        setPendingSections((current) => restoreInto(current, snap));
    };
    const restoreOverlay = (snap: Snapshot): void => {
        setZoneOverlay((current) => restoreInto(current, snap));
    };
    const snapPending = (keys: string[]): Snapshot => {
        const snap: Snapshot = {};
        for (const key of keys) {
            snap[key] = {
                had: Object.prototype.hasOwnProperty.call(pendingRef.current, key),
                value: pendingRef.current[key] ?? null,
            };
        }
        return snap;
    };
    const snapOverlay = (key: string): Snapshot => ({
        [key]: {
            had: Object.prototype.hasOwnProperty.call(overlayRef.current, key),
            value: overlayRef.current[key] ?? null,
        },
    });

    /** What this table's section reads as RIGHT NOW (optimistic included). */
    const sectionOfRow = React.useCallback((row: FloorRow): string | null => {
        const key = row.name.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(pendingSections, key)) { return pendingSections[key]; }
        return row.section;
    }, [pendingSections]);

    const sections = React.useMemo(
        () => composeFloorSections(planRows, zones, zoneOrder, zoneBorn, {
            pendingSections,
            zoneOverlay,
            orderPending,
            includeEmptyZones: true,
        }),
        [planRows, zones, zoneOrder, zoneBorn, pendingSections, zoneOverlay, orderPending],
    );
    const named = React.useMemo(() => sections.filter((s) => s.key !== ""), [sections]);

    /* ── Dialog state ─────────────────────────────────────────────── */
    const [busy, setBusy] = React.useState(false);
    const [sheetName, setSheetName] = React.useState<string | null>(null);
    const [addOpen, setAddOpen] = React.useState(false);
    const [editingName, setEditingName] = React.useState<string | null>(null);
    const [runOutcome, setRunOutcome] = React.useState<TableRunOutcome | null>(null);
    const [newSectionOpen, setNewSectionOpen] = React.useState(false);
    const [arrangeOpen, setArrangeOpen] = React.useState(false);
    const [renameFrom, setRenameFrom] = React.useState<FloorSectionGroup | null>(null);
    const [renameText, setRenameText] = React.useState("");
    const [removeGroup, setRemoveGroup] = React.useState<FloorSectionGroup | null>(null);
    const [deletePickerOpen, setDeletePickerOpen] = React.useState(false);
    const [deleteName, setDeleteName] = React.useState<string | null>(null);
    const [activeDrag, setActiveDrag] = React.useState<{ name: string; fromKey: string } | null>(null);

    const byName = floor.byName;
    const sheetRow = sheetName !== null ? byName.get(sheetName.toLowerCase()) ?? null : null;
    const editingRow = editingName !== null ? byName.get(editingName.toLowerCase()) ?? null : null;

    const rid = user?.restaurantUsername ?? "";

    const failToast = (title: string, error: unknown): void => {
        toast({
            title,
            description: error instanceof Error ? error.message : String(error),
            variant: "destructive",
        });
    };

    // The toast has to name the permission the owner ticks; "required role:
    // admin" sends them looking for a grant that does not exist.
    const ensurePermission = (granted: boolean, permissionName: string): boolean => {
        if (granted) { return true; }
        toast({
            title: "Access denied",
            description: `You do not have the required permission for this action. Required permission: ${permissionName}.`,
            variant: "destructive",
        });
        return false;
    };

    /* ── Zones the add dialog may place a table into ───────────────── */
    const existingZoneNames = React.useMemo(() => {
        const byKey = new Map<string, string>();
        for (const r of planRows) {
            const v = (r.section ?? "").trim();
            if (v !== "" && !byKey.has(v.toLowerCase())) { byKey.set(v.toLowerCase(), v); }
        }
        for (const z of zones) {
            const v = z.trim();
            if (v !== "" && !byKey.has(v.toLowerCase())) { byKey.set(v.toLowerCase(), v); }
        }
        return [...byKey.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    }, [planRows, zones]);

    const existingNames = React.useMemo(() => planRows.map((r) => r.name), [planRows]);

    /* ── Moves (drag one table between zones) ──────────────────────── */
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

    const moveTableToZone = async (row: FloorRow, targetKey: string, targetName: string): Promise<void> => {
        const key = row.name.toLowerCase();
        const snap = snapPending([key]);
        const section = targetKey === "" ? null : targetName;
        setPendingSections((prev) => ({ ...prev, [key]: section }));
        try {
            await setTableSection(rid, row.name, section);
            refresh();
        } catch (error: unknown) {
            restorePending(snap);
            toast({
                title: `Could not move ${row.name}`,
                description: error instanceof Error ? error.message : String(error),
                variant: "destructive",
            });
        }
    };

    const onDragStart = (event: DragStartEvent): void => {
        const fromKey = (event.active.data.current as { sectionKey?: string } | undefined)?.sectionKey ?? "";
        setActiveDrag({ name: String(event.active.id), fromKey });
    };

    const onDragEnd = (event: DragEndEvent): void => {
        const drag = activeDrag;
        setActiveDrag(null);
        if (!drag || !event.over) { return; }
        const overId = String(event.over.id);
        if (!overId.startsWith(ZONE_DROP_PREFIX)) { return; }
        const targetKey = overId.slice(ZONE_DROP_PREFIX.length);
        if (targetKey === drag.fromKey) { return; }
        if (!ensurePermission(canEditLayout, "Table Added")) { return; }
        const row = byName.get(drag.name.toLowerCase());
        if (!row) { return; }
        const target = sections.find((s) => s.key === targetKey);
        void moveTableToZone(row, targetKey, target?.name ?? targetKey);
    };

    /* ── Section writes (roster-first, optimistic, rolled back) ────── */

    const applySectionToTables = async (
        tables: FloorRow[],
        section: string | null,
    ): Promise<{ failed: string[]; error: string }> => {
        if (tables.length === 0) { return { failed: [], error: "" }; }
        const keys = tables.map((t) => t.name.toLowerCase());
        const snap = snapPending(keys);
        setPendingSections((prev) => {
            const next = { ...prev };
            for (const key of keys) { next[key] = section; }
            return next;
        });
        const failed: string[] = [];
        let error = "";
        for (const t of tables) {
            try {
                await setTableSection(rid, t.name, section);
            } catch (e: unknown) {
                failed.push(t.name);
                if (error === "") { error = e instanceof Error ? e.message : String(e); }
            }
        }
        if (failed.length > 0) {
            const failedKeys = new Set(failed.map((n) => n.toLowerCase()));
            const failedSnap: Snapshot = {};
            for (const [key, s] of Object.entries(snap)) {
                if (failedKeys.has(key)) { failedSnap[key] = s; }
            }
            restorePending(failedSnap);
        }
        return { failed, error };
    };

    const handleCreateSection = async (picked: { name: string; tables: string[] }): Promise<void> => {
        const key = picked.name.toLowerCase();
        const snap = snapOverlay(key);
        setZoneOverlay((prev) => ({ ...prev, [key]: picked.name }));
        setNewSectionOpen(false);
        setBusy(true);
        try {
            await createTableSection(rid, picked.name);
        } catch (error: unknown) {
            restoreOverlay(snap);
            toast({
                title: `Could not create "${picked.name}"`,
                description: error instanceof Error ? error.message : String(error),
                variant: "destructive",
            });
            setBusy(false);
            return;
        }
        const chosen = planRows.filter((r) => picked.tables.includes(r.name));
        const res = await applySectionToTables(chosen, picked.name);
        setBusy(false);
        refresh();
        if (res.failed.length > 0) {
            toast({
                title: picked.name,
                description: `${res.failed.join(", ")} could not be moved — ${res.error}`,
                variant: "destructive",
            });
        }
    };

    const handleRenameSection = async (): Promise<void> => {
        const group = renameFrom;
        if (group === null) { return; }
        const from = group.name;
        const to = renameText.trim().replace(/\s+/g, " ");
        setRenameFrom(null);
        if (to === "" || to === from) { return; }
        // Both halves move together: the members' labels AND the roster entry,
        // so an EMPTY zone still renames on screen.
        const key = from.toLowerCase();
        const memberKeys = group.rows.map((r) => r.name.toLowerCase());
        const overlaySnap = snapOverlay(key);
        const pendingSnap = snapPending(memberKeys);
        setZoneOverlay((prev) => ({ ...prev, [key]: to }));
        setPendingSections((prev) => {
            const next = { ...prev };
            for (const k of memberKeys) { next[k] = to; }
            return next;
        });
        setBusy(true);
        try {
            await renameTableSection(rid, from, to);
            refresh();
        } catch (error: unknown) {
            restoreOverlay(overlaySnap);
            restorePending(pendingSnap);
            toast({
                title: `Could not rename "${from}"`,
                description: error instanceof Error ? error.message : String(error),
                variant: "destructive",
            });
        } finally {
            setBusy(false);
        }
    };

    const handleRemoveSection = async (): Promise<void> => {
        const group = removeGroup;
        if (group === null) { return; }
        setRemoveGroup(null);
        const key = group.name.toLowerCase();
        const memberKeys = group.rows.map((r) => r.name.toLowerCase());
        const overlaySnap = snapOverlay(key);
        const pendingSnap = snapPending(memberKeys);
        setZoneOverlay((prev) => ({ ...prev, [key]: null }));
        setPendingSections((prev) => {
            const next = { ...prev };
            for (const k of memberKeys) { next[k] = null; }
            return next;
        });
        setBusy(true);
        try {
            await deleteTableSection(rid, group.name);
            refresh();
        } catch (error: unknown) {
            restoreOverlay(overlaySnap);
            restorePending(pendingSnap);
            toast({
                title: `Could not remove "${group.name}"`,
                description: error instanceof Error ? error.message : String(error),
                variant: "destructive",
            });
        } finally {
            setBusy(false);
        }
    };

    const handleSaveOrder = async (names: string[]): Promise<void> => {
        const prev = orderPending;
        setOrderPending(names.map((n) => n.trim().toLowerCase()));
        setArrangeOpen(false);
        setBusy(true);
        try {
            await saveSectionOrder(rid, names);
            refresh();
        } catch (error: unknown) {
            setOrderPending(prev);
            toast({
                title: "Could not save the section order",
                description: error instanceof Error ? error.message : String(error),
                variant: "destructive",
            });
        } finally {
            setBusy(false);
        }
    };

    /* ── Add a table, or a numbered run of them ────────────────────── */

    const handleAddTables = async (result: TableSeatingResult): Promise<void> => {
        if (!ensurePermission(canEditLayout, "Table Added")) { return; }
        setAddOpen(false);
        // A single table keeps the old path exactly — the name typed is the
        // name created, so "Patio" stays "Patio" instead of becoming "Patio1".
        const run = result.count <= 1
            ? { names: [result.name], skipped: [] as string[], problem: "" }
            : allocateTableNames(result.name, result.count, existingNames);
        setBusy(true);
        const created: string[] = [];
        let failedName = "";
        let error = "";
        for (const name of run.names) {
            try {
                await addFloorTable(rid, {
                    name,
                    capacity: result.capacity,
                    max_capacity: result.maxCapacity,
                    section: result.section,
                });
                created.push(name);
            } catch (e: unknown) {
                // Stop at the first rejection rather than firing the rest at a
                // server that just refused: a partial batch is reported, not
                // continued.
                failedName = name;
                error = e instanceof Error ? e.message : String(e);
                break;
            }
        }
        setBusy(false);
        if (created.length > 0) { refresh(); }
        // One table, nothing skipped and nothing to explain: silent on
        // success, a toast on failure. Anything else gets the run report —
        // a run that allocated no names at all included.
        if (run.names.length <= 1 && run.skipped.length === 0 && run.problem === "") {
            if (error !== "") { failToast("Unable to add the table", error); }
            return;
        }
        setRunOutcome({
            names: run.names,
            skipped: run.skipped,
            problem: run.problem,
            created,
            failedName,
            error,
            section: result.section,
            capacity: result.capacity,
            maxCapacity: result.maxCapacity,
        });
    };

    /* ── Edit seating ──────────────────────────────────────────────── */

    const handleSaveSeating = async (result: TableSeatingResult): Promise<void> => {
        const row = editingRow;
        if (row === null) { return; }
        if (!ensurePermission(canEditLayout, "Table Added")) { return; }
        setBusy(true);
        try {
            const updated = await updateTableSeating(rid, row.name, {
                capacity: result.capacity,
                max_capacity: result.maxCapacity,
            });
            toast({
                title: "Seating updated",
                description: `${updated.table_name} now seats ${String(updated.capacity)} (max ${String(updated.max_capacity)}).`,
            });
            setEditingName(null);
            refresh();
        } catch (error: unknown) {
            failToast("Unable to update seating", error);
        } finally {
            setBusy(false);
        }
    };

    /* ── Deleting a table (C7 + H8) ────────────────────────────────── */

    // Deliberately only the ones the server would accept. Offering a busy
    // table and collecting a 400 teaches staff that this screen guesses.
    const deletable = React.useMemo(
        () => planRows.filter((r) => !r.seated && r.name !== ""),
        [planRows],
    );
    const busyCount = planRows.length - deletable.length;

    const openDeletePicker = (): void => {
        if (!ensurePermission(canDeleteTables, "Table Deleted")) { return; }
        if (deletable.length === 0) {
            toast({
                title: busyCount === 0
                    ? "There are no tables to delete."
                    : "Every table is in use. A table can only be deleted once it has been settled or released.",
            });
            return;
        }
        setDeletePickerOpen(true);
    };

    const handleDeleteTable = async (): Promise<void> => {
        const name = deleteName;
        if (name === null) { return; }
        setBusy(true);
        try {
            await removeFloorTable(rid, name);
            setDeleteName(null);
            toast({ title: `${name} removed from the floor plan.` });
            refresh();
        } catch (error: unknown) {
            // The backend refuses an occupied table or one with an open bill,
            // with a sentence written for a human. Show ITS words.
            failToast(`Could not delete ${name}`, error);
        } finally {
            setBusy(false);
        }
    };

    /* ── Render ────────────────────────────────────────────────────── */

    const header = (
        <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
                <h1 className="text-lg font-semibold md:text-2xl">Floor Plan</h1>
                <p className="text-sm text-muted-foreground">
                    The shape of the room: zones, which table sits where, and how many each seats.
                    Seating guests and taking orders happen under Tables.
                </p>
            </div>
            {scope.addTable ? (
                <Button onClick={() => { setAddOpen(true); }}>
                    <PlusCircle /> Add table
                </Button>
            ) : null}
        </div>
    );

    /*
      A DEEP LINK BY SOMEBODY WHO HOLDS NONE OF THE THREE LAYOUT PERMISSIONS.
      The nav does not offer this page to them, but a bookmark reaches it
      anyway — and a page of controls that every 403 is worse than a sentence.
    */
    if (user && !can(user, "edit_table") && !can(user, "delete_table") && !can(user, "manage_table_sections")) {
        return (
            <div className="grid gap-4 md:gap-8">
                <h1 className="text-lg font-semibold md:text-2xl">Floor Plan</h1>
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <ShieldAlert className="h-4 w-4 text-warning" />
                            You cannot change the floor plan
                        </CardTitle>
                        <CardDescription>
                            Editing the floor needs one of the &ldquo;Table Added&rdquo;, &ldquo;Table Deleted&rdquo; or &ldquo;Manage Table
                            Sections&rdquo; permissions. Ask your admin to grant one from Employees → Role Access
                            Control. Seating guests, covers and orders all live under Tables, which you can still use.
                        </CardDescription>
                    </CardHeader>
                </Card>
            </div>
        );
    }

    if (!user || floor.loading) {
        return <div className="grid gap-4 md:gap-8">{header}<PlanSkeleton /></div>;
    }

    if (floor.error != null) {
        return (
            <div className="grid gap-4 md:gap-8">
                {header}
                <LoadErrorState
                    whatFailed="Couldn't load the floor plan."
                    error={floor.error}
                    onRetry={floor.retry}
                />
            </div>
        );
    }

    // 2.1 — the plan header reads the ROOM, not the service: tables and seats.
    const legendChips = (
        <>
            <StatusChip
                status="neutral"
                label={`${String(planRows.length)} table${planRows.length === 1 ? "" : "s"}`}
                dense
            />
            <StatusChip
                status="neutral"
                label={`${String(planRows.reduce((n, r) => n + r.capacity, 0))} seats`}
                dense
            />
            {canDeleteTables && planRows.length > 0 ? (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive" onClick={openDeletePicker}>
                    <Trash2 /> Delete a table
                </Button>
            ) : null}
        </>
    );

    const sectionActions = canManageSections ? (
        <>
            {/* Nothing to arrange with fewer than two zones. */}
            {named.length > 1 ? (
                <Button variant="outline" size="sm" onClick={() => { setArrangeOpen(true); }}>
                    <ArrowUpDown /> Arrange
                </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => { setNewSectionOpen(true); }}>
                <Plus /> New section
            </Button>
        </>
    ) : null;

    return (
        <div className="relative grid gap-4 md:gap-8">
            {header}

            {planRows.length === 0 && zones.length === 0 ? (
                <EmptyState
                    icon={<LayoutGrid />}
                    title={scope.addTable
                        ? "No tables yet — add one with the button below."
                        : "No tables on the floor yet."}
                    caption="Tables added here appear on the Tables screen for service."
                    action={scope.addTable ? (
                        <Button onClick={() => { setAddOpen(true); }}>
                            <PlusCircle /> Add table
                        </Button>
                    ) : undefined}
                />
            ) : (
                <div className="space-y-3">
                    <SectionHeader
                        title="Floor plan"
                        count={planRows.length}
                        trailing={(
                            <div className="hidden flex-wrap items-center gap-1.5 min-[620px]:flex">
                                {legendChips}
                            </div>
                        )}
                    />
                    <div className="flex flex-wrap items-center gap-1.5 min-[620px]:hidden">
                        {legendChips}
                    </div>

                    <SectionHeader
                        title="Sections"
                        count={named.length}
                        trailing={sectionActions !== null ? (
                            <div className="hidden flex-wrap items-center gap-1.5 min-[620px]:flex">
                                {sectionActions}
                            </div>
                        ) : undefined}
                    />
                    {sectionActions !== null ? (
                        <div className="flex flex-wrap items-center gap-1.5 min-[620px]:hidden">
                            {sectionActions}
                        </div>
                    ) : null}

                    <p className="text-sm text-muted-foreground">Tables are grouped by their floor section.</p>

                    {/* The roster is half the picture — if it didn't load, say so
                        instead of quietly showing only the zones that happen to
                        have a table in them. */}
                    {zoneError !== "" ? (
                        <div className="flex items-center gap-2.5 rounded-md border border-warning/28 bg-warning/12 px-3.5 py-2.5">
                            <p className="min-w-0 flex-1 text-xs text-warning">
                                Section list unavailable — sections with no tables in them are missing from this floor plan. {zoneError}
                            </p>
                            <Button variant="outline" size="sm" onClick={() => { refresh(); }}>Retry</Button>
                        </div>
                    ) : null}

                    <DndContext
                        sensors={sensors}
                        collisionDetection={pointerWithin}
                        onDragStart={onDragStart}
                        onDragEnd={onDragEnd}
                        onDragCancel={() => { setActiveDrag(null); }}
                    >
                        <div className="space-y-3">
                            {sections.map((group) => (
                                <PlanZone
                                    key={group.key === "" ? "::unassigned" : group.key}
                                    group={group}
                                    canManage={canManageSections}
                                    canMove={canEditLayout}
                                    canEditSeating={scope.editSeating}
                                    draggingFromKey={activeDrag?.fromKey ?? null}
                                    onOpenTile={(row) => { setSheetName(row.name); }}
                                    onRename={(g) => { setRenameText(g.name); setRenameFrom(g); }}
                                    onRemove={(g) => { setRemoveGroup(g); }}
                                />
                            ))}
                        </div>
                        <DragOverlay>
                            {activeDrag !== null ? (() => {
                                const row = byName.get(activeDrag.name.toLowerCase());
                                return row ? (
                                    <PlanTileCard row={row} canEditSeating={scope.editSeating} canDrag dragging />
                                ) : null;
                            })() : null}
                        </DragOverlay>
                    </DndContext>
                </div>
            )}

            <CacheStalePill offline={floor.offline} fromCache={floor.fromCache} updatedAt={floor.updatedAt} />

            {/* ── The layout-only per-table sheet (2.1) ─────────────── */}
            <PlanTableSheet
                row={sheetRow !== null ? { ...sheetRow, section: sectionOfRow(sheetRow) } : null}
                onOpenChange={(open) => { if (!open) { setSheetName(null); } }}
                canEditSeating={scope.editSeating}
                onEditSeating={(row) => { setSheetName(null); setEditingName(row.name); }}
            />

            {/* ── Add table / bulk run ──────────────────────────────── */}
            <TableSeatingDialog
                open={addOpen}
                onOpenChange={setAddOpen}
                existing={null}
                sections={existingZoneNames}
                existingNames={existingNames}
                busy={busy}
                onSubmit={(result) => { void handleAddTables(result); }}
            />
            <TableRunReportSheet
                outcome={runOutcome}
                onOpenChange={(open) => { if (!open) { setRunOutcome(null); } }}
            />

            {/* ── Edit seating ──────────────────────────────────────── */}
            <TableSeatingDialog
                open={editingRow !== null}
                onOpenChange={(open) => { if (!open) { setEditingName(null); } }}
                existing={editingRow !== null
                    ? { name: editingRow.name, capacity: editingRow.capacity, max_capacity: editingRow.max_capacity }
                    : null}
                busy={busy}
                onSubmit={(result) => { void handleSaveSeating(result); }}
            />

            {/* ── Section dialogs ───────────────────────────────────── */}
            <NewSectionDialog
                open={newSectionOpen}
                onOpenChange={setNewSectionOpen}
                tables={planRows}
                existing={named.map((s) => s.name)}
                sectionOf={sectionOfRow}
                busy={busy}
                onCreate={(picked) => { void handleCreateSection(picked); }}
            />
            <ArrangeSectionsDialog
                open={arrangeOpen}
                onOpenChange={setArrangeOpen}
                items={named.map((s) => ({ key: s.key, name: s.name, tables: s.rows.length }))}
                busy={busy}
                onSave={(names) => { void handleSaveOrder(names); }}
            />

            <Dialog open={renameFrom !== null} onOpenChange={(open) => { if (!open) { setRenameFrom(null); } }}>
                <DialogContent className="sm:max-w-[360px]">
                    <DialogHeader>
                        <DialogTitle>Rename &ldquo;{renameFrom?.name}&rdquo;</DialogTitle>
                        <DialogDescription className="sr-only">The zone&apos;s new name</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-1.5">
                        <Label htmlFor="rename-section">Section name</Label>
                        <Input
                            id="rename-section"
                            autoFocus
                            value={renameText}
                            onChange={(e) => { setRenameText(e.target.value); }}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleRenameSection(); } }}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setRenameFrom(null); }}>Cancel</Button>
                        <Button disabled={busy} onClick={() => { void handleRenameSection(); }}>Save</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={removeGroup !== null} onOpenChange={(open) => { if (!open) { setRemoveGroup(null); } }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove section &ldquo;{removeGroup?.name}&rdquo;?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {removeGroup !== null && removeGroup.rows.length === 0
                                ? "Nothing is in it — removing it just takes the name off the floor plan."
                                : `The ${String(removeGroup?.rows.length ?? 0)} table${(removeGroup?.rows.length ?? 0) === 1 ? "" : "s"} in it stay on the floor — they just stop carrying a section.`}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction disabled={busy} onClick={() => { void handleRemoveSection(); }}>
                            Remove section
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* ── Delete a table: pick, then the explicit confirm ───── */}
            <Dialog open={deletePickerOpen} onOpenChange={setDeletePickerOpen}>
                <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-[400px]">
                    <DialogHeader>
                        <DialogTitle>Delete which table?</DialogTitle>
                        <DialogDescription>
                            {busyCount === 0
                                ? "Pick the table to remove from the floor plan."
                                : `Pick the table to remove from the floor plan. ${String(busyCount)} in use ${busyCount === 1 ? "is" : "are"} not listed — a table can only be deleted once it has been settled or released.`}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-72 space-y-1 overflow-y-auto">
                        {deletable.map((row) => {
                            const seats = seatsLabel(row.raw);
                            const zone = (sectionOfRow(row) ?? "").trim();
                            const subtitle = [
                                ...(seats !== "" ? [seats] : []),
                                ...(zone !== "" ? [`in ${zone}`] : []),
                            ].join(" · ");
                            return (
                                <button
                                    key={row.name}
                                    type="button"
                                    data-testid={`delete-pick-${row.name}`}
                                    onClick={() => { setDeletePickerOpen(false); setDeleteName(row.name); }}
                                    className="flex w-full flex-col rounded-md border border-border px-3 py-2 text-left hover:bg-foreground/5"
                                >
                                    <span className="text-sm font-semibold text-foreground">{row.name}</span>
                                    {subtitle !== "" ? (
                                        <span className="text-xs text-muted-foreground">{subtitle}</span>
                                    ) : null}
                                </button>
                            );
                        })}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setDeletePickerOpen(false); }}>Cancel</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={deleteName !== null} onOpenChange={(open) => { if (!open && !busy) { setDeleteName(null); } }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete table {deleteName} permanently?</AlertDialogTitle>
                        <AlertDialogDescription className="space-y-3">
                            <span className="block">
                                {deleteName} disappears from the floor plan on every device, for everyone.
                                Any waiter assigned to it is unassigned, and the ordering QR code printed
                                for {deleteName} stops working.
                            </span>
                            <span className="block">
                                Its past orders and bills are NOT deleted — they stay in your history, your
                                reports and the takings for the day, exactly as they are.
                            </span>
                            <span className="block">
                                This cannot be undone from this screen. Creating a table called {deleteName} again
                                does not bring the old one back.
                            </span>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={busy}
                            data-testid="floor-delete-confirm"
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => { void handleDeleteTable(); }}
                        >
                            Delete {deleteName}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
