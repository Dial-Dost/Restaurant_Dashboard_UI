"use client";

/**
 * Add a table (or a numbered run of them), or edit an existing one's seating —
 * the web `_TableSeatingDialog` (screens/modules.dart 13346+).
 *
 * Add mode: name + "How many" (1–50) side by side, a LIVE preview of the run
 * (`allocateTableNames`) that names what will be created and what is being
 * stepped over, capacity defaulting to 4, max tracking capacity until touched,
 * a section dropdown of zones that already exist, and the reserved-name
 * refusal ("12 #2" is the server's to make). Edit mode: capacity/max only.
 */

import * as React from "react";

import { Button } from "@/components/ui/button";
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
import { DrillSheet } from "@/components/ui/drill-sheet";
import {
    MAX_TABLE_RUN,
    RESERVED_TABLE_NAME_ERROR,
    allocateTableNames,
    isReservedPartyName,
    seatsLabel,
    tableNameList,
} from "@/lib/api/tables-floor";

/** What the dialog hands back: the seed name (add mode), seats, max, zone, count. */
export interface TableSeatingResult {
    name: string;
    capacity: number;
    maxCapacity: number;
    /** Zone the new table lands in. '' = Unassigned (omitted from the request). */
    section: string;
    /** How many tables to create from `name` onwards (add mode only). */
    count: number;
}

export interface TableSeatingDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** null = add mode. */
    existing: { name: string; capacity: number; max_capacity: number } | null;
    /** Zones already on the floor, so a new table can be placed straight into one. */
    sections?: string[];
    /** Every table name already on the floor, for the run preview. */
    existingNames?: string[];
    busy?: boolean;
    onSubmit: (result: TableSeatingResult) => void;
}

export function TableSeatingDialog({
    open,
    onOpenChange,
    existing,
    sections = [],
    existingNames = [],
    busy = false,
    onSubmit,
}: TableSeatingDialogProps): React.JSX.Element {
    const adding = existing === null;
    const [name, setName] = React.useState("");
    const [capacity, setCapacity] = React.useState("4");
    const [max, setMax] = React.useState("4");
    const [maxTouched, setMaxTouched] = React.useState(false);
    const [count, setCount] = React.useState("1");
    const [section, setSection] = React.useState("");
    const [error, setError] = React.useState<string | null>(null);

    // Re-seed per open (and per table in edit mode): capacity defaults to 4,
    // max tracks it until touched — legacy rows carry no max, so pre-fill the
    // seat count instead of a blank.
    React.useEffect(() => {
        if (!open) { return; }
        const cap = existing?.capacity && existing.capacity >= 1 ? existing.capacity : 4;
        const maxCap = existing?.max_capacity && existing.max_capacity >= 1 ? existing.max_capacity : cap;
        setName(existing?.name ?? "");
        setCapacity(String(cap));
        setMax(String(maxCap));
        setMaxTouched(existing !== null && maxCap > cap);
        setCount("1");
        setSection("");
        setError(null);
    }, [open, existing]);

    const setCapacityTracking = (value: string): void => {
        setCapacity(value);
        if (!maxTouched) { setMax(value.trim()); }
    };

    /** Blank or unparseable reads as 1; the preview clamps to what a run may do. */
    const runCount = React.useMemo(() => {
        const n = Number.parseInt(count.trim(), 10);
        if (!Number.isFinite(n) || n < 1) { return 1; }
        return n > MAX_TABLE_RUN ? MAX_TABLE_RUN : n;
    }, [count]);

    const preview = React.useMemo(
        () => (adding ? allocateTableNames(name, runCount, existingNames) : null),
        [adding, name, runCount, existingNames],
    );

    const submit = (): void => {
        const trimmed = name.trim();
        if (adding && trimmed === "") {
            setError("Give the table a name (e.g. T7).");
            return;
        }
        // "12 #2" is the server's to make (client item 6): its own sentence,
        // before the request rather than after it — for every name a run makes.
        if (adding && (isReservedPartyName(trimmed)
            || allocateTableNames(trimmed, runCount, existingNames).names.some(isReservedPartyName))) {
            setError(RESERVED_TABLE_NAME_ERROR);
            return;
        }
        const cap = Number.parseInt(capacity.trim(), 10);
        const maxCap = Number.parseInt(max.trim(), 10);
        if (!Number.isInteger(cap) || cap < 1 || !Number.isInteger(maxCap) || maxCap < 1
            || String(cap) !== capacity.trim() || String(maxCap) !== max.trim()) {
            setError("Seats and max must be whole numbers of 1 or more.");
            return;
        }
        if (maxCap < cap) {
            setError(`Max capacity cannot be below the seat count (${String(cap)}).`);
            return;
        }
        const typed = Number.parseInt(count.trim(), 10);
        if (adding && (!Number.isInteger(typed) || typed < 1 || typed > MAX_TABLE_RUN || String(typed) !== count.trim())) {
            setError(`How many must be a whole number from 1 to ${String(MAX_TABLE_RUN)}.`);
            return;
        }
        onSubmit({
            name: trimmed,
            capacity: cap,
            maxCapacity: maxCap,
            section,
            count: adding ? runCount : 1,
        });
    };

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!busy) { onOpenChange(next); } }}>
            <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>{adding ? "Add table" : `Seating for ${existing.name}`}</DialogTitle>
                    <DialogDescription className="sr-only">
                        {adding ? "Name and seating for the new table" : "Seat counts for this table"}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-3">
                    {adding ? (
                        <>
                            <div className="flex items-start gap-3">
                                <div className="grid flex-1 gap-1.5">
                                    <Label htmlFor="seat-name">Table name (e.g. T7)</Label>
                                    <Input
                                        id="seat-name"
                                        autoFocus
                                        value={name}
                                        onChange={(e) => { setName(e.target.value); setError(null); }}
                                    />
                                </div>
                                {/* The run counter. Numbering carries on from the name
                                    typed left of it and skips whatever is taken. */}
                                <div className="grid w-[88px] shrink-0 gap-1.5">
                                    <Label htmlFor="seat-count">How many</Label>
                                    <Input
                                        id="seat-count"
                                        type="number"
                                        min={1}
                                        max={MAX_TABLE_RUN}
                                        value={count}
                                        onChange={(e) => { setCount(e.target.value); setError(null); }}
                                    />
                                </div>
                            </div>
                            {/* Spells out the run BEFORE it is committed. */}
                            {preview !== null && !(preview.names.length === 0 && preview.skipped.length === 0 && preview.problem === "") ? (
                                <div className="space-y-0.5">
                                    {preview.problem !== "" ? (
                                        <p className="text-[11.5px] leading-snug text-warning">{preview.problem}</p>
                                    ) : null}
                                    {preview.names.length > 0 ? (
                                        <p className="text-[11.5px] leading-snug text-accent-foreground">
                                            Creates {tableNameList(preview.names)}
                                        </p>
                                    ) : null}
                                    {preview.skipped.length > 0 ? (
                                        <p className="text-[11.5px] leading-snug text-tertiary">
                                            Skips {tableNameList(preview.skipped)} — already on the floor
                                        </p>
                                    ) : null}
                                </div>
                            ) : null}
                        </>
                    ) : null}
                    <div className="grid gap-1.5">
                        <Label htmlFor="seat-capacity">Seats (the usual cover count)</Label>
                        <Input
                            id="seat-capacity"
                            type="number"
                            min={1}
                            autoFocus={!adding}
                            value={capacity}
                            onChange={(e) => { setCapacityTracking(e.target.value); setError(null); }}
                        />
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="seat-max">Max capacity (with extra chairs)</Label>
                        <Input
                            id="seat-max"
                            type="number"
                            min={1}
                            value={max}
                            onChange={(e) => { setMaxTouched(true); setMax(e.target.value); setError(null); }}
                        />
                    </div>
                    {/* Only offered when adding, and only zones that already exist —
                        creating a NEW zone needs "Manage Table Sections". */}
                    {adding && sections.length > 0 ? (
                        <div className="grid gap-1.5">
                            <Label htmlFor="seat-section">Section</Label>
                            <select
                                id="seat-section"
                                value={section}
                                onChange={(e) => { setSection(e.target.value); }}
                                className="flex h-10 w-full rounded-md border border-input bg-inset px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                                <option value="">Unassigned</option>
                                {sections.map((sec) => (
                                    <option key={sec} value={sec}>{sec}</option>
                                ))}
                            </select>
                        </div>
                    ) : null}
                    <p className="text-[11.5px] leading-snug text-tertiary">
                        {adding && runCount > 1
                            ? "Seats, max capacity and section apply to every table in the run. A party larger than the max is offered a combination of adjacent tables instead — staff always confirm the suggestion."
                            : "A party larger than the max is offered a combination of adjacent tables instead — staff always confirm the suggestion."}
                    </p>
                    {error !== null ? (
                        <p className="text-xs text-destructive">{error}</p>
                    ) : null}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => { onOpenChange(false); }} disabled={busy}>Cancel</Button>
                    <Button onClick={submit} disabled={busy}>
                        {adding ? (runCount > 1 ? `Add ${String(runCount)} tables` : "Add") : "Save"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/** What one run of `addFloorTable` writes actually did, for the report sheet. */
export interface TableRunOutcome {
    /** The full allocation the run set out to create. */
    names: string[];
    skipped: string[];
    problem: string;
    created: string[];
    /** The first server rejection — the run stops there. */
    failedName: string;
    error: string;
    section: string;
    capacity: number;
    maxCapacity: number;
}

function RunReportRow({ label, value }: { label: string; value: string }): React.JSX.Element {
    return (
        <div className="border-b border-divider py-2 last:border-b-0">
            <div className="micro-label">{label}</div>
            <div className="mt-0.5 text-sm text-foreground">{value}</div>
        </div>
    );
}

/**
 * The run report — the app's detail sheet after a bulk add: Created / Skipped /
 * Failed / Not attempted / Section / Seating, with the numbering problem first.
 */
export function TableRunReportSheet({ outcome, onOpenChange }: {
    outcome: TableRunOutcome | null;
    onOpenChange: (open: boolean) => void;
}): React.JSX.Element | null {
    if (outcome === null) { return null; }
    const attempted = outcome.created.length + (outcome.failedName === "" ? 0 : 1);
    const notAttempted = outcome.names.slice(attempted);
    return (
        <DrillSheet
            open
            onOpenChange={onOpenChange}
            eyebrow="Floor"
            title={outcome.created.length === 0
                ? "No tables were added"
                : `Added ${String(outcome.created.length)} table${outcome.created.length === 1 ? "" : "s"}`}
        >
            <div>
                {/* First, above the lists: why the run is not what was asked for. */}
                {outcome.problem !== "" ? <RunReportRow label="Numbering" value={outcome.problem} /> : null}
                {outcome.created.length > 0 ? <RunReportRow label="Created" value={tableNameList(outcome.created)} /> : null}
                {outcome.skipped.length > 0 ? (
                    <RunReportRow label="Skipped" value={`${tableNameList(outcome.skipped)} — already on the floor`} />
                ) : null}
                {outcome.failedName !== "" ? (
                    <RunReportRow label="Failed" value={`${outcome.failedName} — ${outcome.error}`} />
                ) : null}
                {notAttempted.length > 0 ? <RunReportRow label="Not attempted" value={tableNameList(notAttempted)} /> : null}
                {outcome.section.trim() !== "" ? <RunReportRow label="Section" value={outcome.section.trim()} /> : null}
                <RunReportRow
                    label="Seating"
                    value={seatsLabel({ capacity: outcome.capacity, max_capacity: outcome.maxCapacity })}
                />
            </div>
        </DrillSheet>
    );
}
