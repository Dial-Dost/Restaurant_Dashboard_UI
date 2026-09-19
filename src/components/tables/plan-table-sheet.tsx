"use client";

/**
 * The Floor plan's per-table sheet — the web `_PlanTableSheet` (requirement
 * 2.1's other half).
 *
 * What a table IS in the room: its name, its seats and its zone, and the one
 * per-table layout act, "Edit seating". Deliberately nothing the Tables screen
 * shows: no state chip, no order, no bill, no timers, no waiter, no QR, no
 * Settle. Deleting stays in the Floor plan header (C7/H8), and seating a party
 * stays on Tables.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Armchair, LayoutGrid } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DrillSheet, DrillSheetAction } from "@/components/ui/drill-sheet";
import { InfoChip } from "@/components/ui/status-chip";
import { seatsLabel, type FloorRow } from "@/lib/api/tables-floor";

export interface PlanTableSheetProps {
    row: FloorRow | null;
    onOpenChange: (open: boolean) => void;
    canEditSeating: boolean;
    onEditSeating: (row: FloorRow) => void;
}

export function PlanTableSheet({
    row,
    onOpenChange,
    canEditSeating,
    onEditSeating,
}: PlanTableSheetProps): React.JSX.Element | null {
    const router = useRouter();
    if (row === null) { return null; }
    const seats = seatsLabel(row.raw);
    const zone = (row.section ?? "").trim();
    return (
        <DrillSheet
            open
            onOpenChange={onOpenChange}
            eyebrow="Floor"
            title={`Table ${row.name}`}
            action={(
                <DrillSheetAction
                    module="Tables"
                    onClick={() => { onOpenChange(false); router.push("/dashboard/tables"); }}
                />
            )}
        >
            <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-1.5">
                    {seats !== "" ? <InfoChip icon={<Armchair />} label={seats} /> : null}
                    <InfoChip icon={<LayoutGrid />} label={zone === "" ? "Unassigned" : zone} />
                </div>
                <p className="text-xs text-tertiary">
                    Seating guests, orders and bills are on the Tables screen.
                </p>
                {canEditSeating ? (
                    <div className="flex justify-center pt-1">
                        <Button
                            variant="outline"
                            size="sm"
                            data-testid="plan-edit-seating"
                            onClick={() => { onEditSeating(row); }}
                        >
                            <Armchair /> Edit seating
                        </Button>
                    </div>
                ) : null}
            </div>
        </DrillSheet>
    );
}
