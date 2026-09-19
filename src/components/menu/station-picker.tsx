"use client";

/**
 * The quick per-item kitchen-section picker (modules.dart `_StationPickerSheet`):
 * a sheet titled "KOT ROUTING / Kitchen section / <item name>" with pill
 * choices — Unassigned + each managed section, the current one highlighted —
 * that assign on tap, plus a custom free-text field + Set button. A blank
 * custom Set is a NO-OP (dismiss): clearing is done explicitly via the
 * Unassigned pill, so a stray Set can never wipe an assignment.
 */

import * as React from "react";
import { Check } from "lucide-react";
import { DrillSheet } from "@/components/ui/drill-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function StationPickerSheet({
    itemName,
    current,
    sections,
    onPick,
    onClose,
}: {
    itemName: string;
    current: string;
    sections: string[];
    /** '' = Unassigned; any other string = the chosen section. */
    onPick: (station: string) => void;
    onClose: () => void;
}): React.JSX.Element {
    // Seed the custom field only with a legacy/unmanaged label so managed picks
    // aren't duplicated as free text.
    const inList = sections.some((s) => s.toLowerCase() === current.toLowerCase());
    const [custom, setCustom] = React.useState(inList ? "" : current);

    const isSelected = (s: string): boolean => s.toLowerCase() === current.toLowerCase();

    const pill = (label: string, selected: boolean, value: string): React.JSX.Element => (
        <button
            key={`${label}-pill`}
            type="button"
            onClick={() => { onPick(value); }}
            className={cn(
                "rounded-[10px] border px-3.5 py-[9px] text-[12.5px] tracking-[0.2px] transition-colors duration-fast",
                selected
                    ? "border-accent-base/55 bg-accent-base/12 font-semibold text-accent-foreground"
                    : "border-border bg-inset font-medium text-muted-foreground hover:text-foreground",
            )}
        >
            {label}
        </button>
    );

    const submitCustom = (): void => {
        const t = custom.trim();
        // Empty custom text is a no-op (dismiss) — see the header comment.
        if (!t) { onClose(); return; }
        onPick(t);
    };

    return (
        <DrillSheet
            open
            onOpenChange={(o) => { if (!o) { onClose(); } }}
            eyebrow="KOT Routing"
            title="Kitchen section"
            description={itemName}
        >
            <div className="flex flex-wrap gap-2">
                {pill("Unassigned", current === "", "")}
                {sections.map((s) => pill(s, isSelected(s), s))}
            </div>
            <div className="mt-4 flex items-end gap-2">
                <div className="min-w-0 flex-1">
                    <Label htmlFor="station-picker-custom" className="text-xs text-muted-foreground">Custom section</Label>
                    <Input
                        id="station-picker-custom"
                        className="mt-1"
                        placeholder="e.g. grill, bar"
                        value={custom}
                        onChange={(e) => { setCustom(e.target.value); }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                submitCustom();
                            }
                        }}
                    />
                </div>
                <Button type="button" onClick={submitCustom}>
                    <Check className="mr-2 h-4 w-4" /> Set
                </Button>
            </div>
        </DrillSheet>
    );
}
