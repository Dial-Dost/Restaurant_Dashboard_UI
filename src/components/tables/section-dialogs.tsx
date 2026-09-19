"use client";

/**
 * The floor plan's zone dialogs — web ports of `_NewSectionDialog` and
 * `_ReorderSectionsDialog` (screens/modules.dart 8607+).
 *
 * NEW SECTION names a zone and optionally picks the tables to start it with:
 * the roster (`POST /table-sections`) records the NAME, so an empty zone is a
 * real saved thing, and each picked table is the same `PATCH /table/:name
 * {section}` a drag issues.
 *
 * ARRANGE returns the section NAMES in their new order for one
 * `PUT /table-sections/order` carrying the WHOLE list. Three ways to move a
 * row — drag the handle, or the Move up / Move down buttons — and "Save
 * order" stays disabled until something actually moved.
 */

import * as React from "react";
import { Check, ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import type { DragEndEvent } from "@dnd-kit/core";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { cn } from "@/lib/utils";
import { seatsLabel, type FloorRow } from "@/lib/api/tables-floor";

/* ────────────────────────────────────────────────────────────────────────
   New section
   ──────────────────────────────────────────────────────────────────────── */

export interface NewSectionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Every room table on the floor (next-party seats already filtered out). */
    tables: FloorRow[];
    /** Zone names that already exist, for the duplicate check. */
    existing: string[];
    /** What each table's section reads as RIGHT NOW (optimistic included). */
    sectionOf: (row: FloorRow) => string | null;
    busy?: boolean;
    onCreate: (picked: { name: string; tables: string[] }) => void;
}

export function NewSectionDialog({
    open,
    onOpenChange,
    tables,
    existing,
    sectionOf,
    busy = false,
    onCreate,
}: NewSectionDialogProps): React.JSX.Element {
    const [name, setName] = React.useState("");
    const [picked, setPicked] = React.useState<Set<string>>(new Set());
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (!open) { return; }
        setName("");
        setPicked(new Set());
        setError(null);
    }, [open]);

    const submit = (): void => {
        const trimmed = name.trim().replace(/\s+/g, " ");
        if (trimmed === "") {
            setError("Give the section a name.");
            return;
        }
        // Cheap client-side echo of the server's own 409 — the POST is still
        // the authority, this just saves a round-trip on the obvious case.
        if (existing.some((e) => e.toLowerCase() === trimmed.toLowerCase())) {
            setError(`"${trimmed}" already exists — drag tables into it instead.`);
            return;
        }
        onCreate({ name: trimmed, tables: [...picked] });
    };

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!busy) { onOpenChange(next); } }}>
            <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-[400px]">
                <DialogHeader>
                    <div className="micro-label">Floor</div>
                    <DialogTitle>New section</DialogTitle>
                    <DialogDescription className="sr-only">Name the zone and optionally seed it with tables</DialogDescription>
                </DialogHeader>
                <div className="grid gap-3">
                    <div className="grid gap-1.5">
                        <Label htmlFor="new-section-name">Section name (e.g. Terrace)</Label>
                        <Input
                            id="new-section-name"
                            autoFocus
                            value={name}
                            onChange={(e) => { setName(e.target.value); setError(null); }}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
                        />
                    </div>
                    <p className="text-xs text-muted-foreground">
                        {tables.length === 0
                            ? "The section is saved on its own — add tables to the floor and drag them in whenever you like."
                            : "Optionally start it with a few tables. Leave them all unticked to create an empty section and drag tables in later."}
                    </p>
                    {tables.length > 0 ? (
                        <div className="max-h-60 space-y-0.5 overflow-y-auto">
                            {tables.map((row) => {
                                const current = sectionOf(row);
                                const seats = seatsLabel(row.raw);
                                const checked = picked.has(row.name);
                                return (
                                    <label
                                        key={row.name}
                                        className="flex cursor-pointer items-start gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-foreground/5"
                                    >
                                        <Checkbox
                                            checked={checked}
                                            onCheckedChange={(value) => {
                                                setPicked((prev) => {
                                                    const next = new Set(prev);
                                                    if (value === true) { next.add(row.name); } else { next.delete(row.name); }
                                                    return next;
                                                });
                                                setError(null);
                                            }}
                                            className="mt-0.5"
                                        />
                                        <span className="min-w-0">
                                            <span className="block truncate text-sm font-semibold text-foreground">{row.name}</span>
                                            <span className="block text-xs text-muted-foreground">
                                                {seats === "" ? "No seat count" : seats} · {current === null ? "unassigned" : `in ${current}`}
                                            </span>
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                    ) : null}
                    {error !== null ? <p className="text-xs text-destructive">{error}</p> : null}
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => { onOpenChange(false); }} disabled={busy}>Cancel</Button>
                    <Button onClick={submit} disabled={busy}>
                        <Check /> Create section
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/* ────────────────────────────────────────────────────────────────────────
   Arrange sections
   ──────────────────────────────────────────────────────────────────────── */

export interface ArrangeSectionItem {
    /** Lower-cased identity. */
    key: string;
    /** The label as it reads and is written back. */
    name: string;
    tables: number;
}

export interface ArrangeSectionsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    items: ArrangeSectionItem[];
    busy?: boolean;
    /** The section NAMES in their new order. */
    onSave: (names: string[]) => void;
}

function ArrangeRow({ item, index, count, onShift }: {
    item: ArrangeSectionItem;
    index: number;
    count: number;
    onShift: (from: number, to: number) => void;
}): React.JSX.Element {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.key });
    return (
        <div
            ref={setNodeRef}
            style={{
                transform: transform ? `translate3d(${String(transform.x)}px, ${String(transform.y)}px, 0)` : undefined,
                transition,
            }}
            className={cn(
                "flex items-center gap-1 rounded-md border border-border bg-inset p-1",
                isDragging && "z-10 opacity-90 shadow-card-hover",
            )}
        >
            <button
                type="button"
                {...attributes}
                {...listeners}
                aria-label={`Reorder ${item.name}`}
                className="cursor-grab touch-none px-2 py-2.5 text-muted-foreground"
            >
                <GripVertical className="h-[18px] w-[18px]" />
            </button>
            {/* The position, spelled out — the order is the whole subject here. */}
            <span className="w-[22px] shrink-0 text-center text-[11px] text-muted-foreground tabular-nums">
                {index + 1}
            </span>
            <div className="min-w-0 flex-1 pl-1.5">
                <div className="truncate text-sm font-semibold text-foreground">{item.name}</div>
                <div className="text-xs text-muted-foreground">
                    {item.tables === 0 ? "Empty" : `${String(item.tables)} ${item.tables === 1 ? "table" : "tables"}`}
                </div>
            </div>
            <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Move up"
                title="Move up"
                disabled={index === 0}
                onClick={() => { onShift(index, index - 1); }}
            >
                <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Move down"
                title="Move down"
                disabled={index === count - 1}
                onClick={() => { onShift(index, index + 1); }}
            >
                <ChevronDown className="h-4 w-4" />
            </Button>
        </div>
    );
}

export function ArrangeSectionsDialog({
    open,
    onOpenChange,
    items,
    busy = false,
    onSave,
}: ArrangeSectionsDialogProps): React.JSX.Element {
    const [order, setOrder] = React.useState<ArrangeSectionItem[]>(items);
    React.useEffect(() => {
        if (open) { setOrder(items); }
    }, [open, items]);

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

    // Nothing moved = nothing to save. Sending the list anyway would stamp
    // explicit positions on an outlet that had none, which is a real change
    // (new sections would start landing at the end) dressed up as a no-op.
    const changed = order.length !== items.length
        || order.some((item, i) => item.key !== items[i]?.key);

    const shift = (from: number, to: number): void => {
        if (to < 0 || to >= order.length || from === to) { return; }
        setOrder((prev) => arrayMove(prev, from, to));
    };

    const onDragEnd = (event: DragEndEvent): void => {
        const { active, over } = event;
        if (!over || active.id === over.id) { return; }
        setOrder((prev) => {
            const from = prev.findIndex((item) => item.key === active.id);
            const to = prev.findIndex((item) => item.key === over.id);
            if (from < 0 || to < 0) { return prev; }
            return arrayMove(prev, from, to);
        });
    };

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!busy) { onOpenChange(next); } }}>
            <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-[440px]">
                <DialogHeader>
                    <div className="micro-label">Floor</div>
                    <DialogTitle>Arrange sections</DialogTitle>
                    <DialogDescription>
                        Drag a handle, or use the arrows. This is the order the floor plan shows for this
                        outlet on every device. Tables with no section always come last.
                    </DialogDescription>
                </DialogHeader>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                    <SortableContext items={order.map((item) => item.key)} strategy={verticalListSortingStrategy}>
                        <div className="space-y-2">
                            {order.map((item, i) => (
                                <ArrangeRow key={item.key} item={item} index={i} count={order.length} onShift={shift} />
                            ))}
                        </div>
                    </SortableContext>
                </DndContext>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => { onOpenChange(false); }} disabled={busy}>Cancel</Button>
                    <Button
                        disabled={busy || !changed}
                        onClick={() => { onSave(order.map((item) => item.name)); }}
                    >
                        <Check /> Save order
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
