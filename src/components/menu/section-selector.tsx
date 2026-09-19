"use client";

/**
 * Kitchen-section pickers.
 *
 * `SectionSelector` is the add/edit item dialog's picker (modules.dart
 * `_SectionSelector`): a dropdown of managed sections + Unassigned + any
 * legacy label + a "Custom…" escape hatch that flips to a free-text field with
 * a close icon back to the list; plain free text when no managed sections
 * exist yet. Reports the chosen station ('' = unassigned) via onChange.
 *
 * `StationSelect` is the compact per-row picker the Organise-by-kitchen
 * dialog uses ([web-extra] kept from the old page).
 */

import * as React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// Radix Select forbids empty item values — sentinels for "no section"/custom.
const NO_STATION = "__none__";
const CUSTOM = "__custom__";

export function SectionSelector({
    value,
    sections,
    onChange,
}: {
    value: string;
    sections: string[];
    onChange: (v: string) => void;
}): React.JSX.Element {
    const inList = (v: string): boolean => sections.some((s) => s.toLowerCase() === v.toLowerCase());
    // A non-empty value that isn't a managed section starts in free-text mode
    // (legacy/unmanaged label) — unless there are simply no managed sections.
    const [customMode, setCustomMode] = React.useState(
        () => sections.length > 0 && value !== "" && !inList(value),
    );

    // No managed sections yet → plain free-text entry with the same contract.
    if (sections.length === 0) {
        return (
            <Input
                value={value}
                maxLength={40}
                placeholder="Optional — e.g. tandoor, grill, bar"
                aria-label="Kitchen section"
                onChange={(e) => { onChange(e.target.value); }}
            />
        );
    }

    if (customMode) {
        return (
            <div className="flex items-center gap-2">
                <Input
                    autoFocus
                    value={value}
                    maxLength={40}
                    placeholder="Custom section"
                    aria-label="Custom section"
                    onChange={(e) => { onChange(e.target.value); }}
                />
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    title="Pick from list"
                    aria-label="Pick from list"
                    onClick={() => {
                        setCustomMode(false);
                        onChange("");
                    }}
                >
                    <X className="h-4 w-4" />
                </Button>
            </div>
        );
    }

    const current = value;
    const unlisted = current !== "" && !inList(current);
    return (
        <Select
            value={current === "" ? NO_STATION : current}
            onValueChange={(v) => {
                if (v === CUSTOM) {
                    setCustomMode(true);
                    onChange("");
                } else {
                    onChange(v === NO_STATION ? "" : v);
                }
            }}
        >
            <SelectTrigger aria-label="Kitchen section" className={cn(unlisted && "border-dashed border-warning/50 text-warning")}>
                <SelectValue placeholder="Unassigned" />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value={NO_STATION}>Unassigned</SelectItem>
                {sections.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
                {unlisted && (
                    <SelectItem value={current} className="text-warning">{current} (unassigned)</SelectItem>
                )}
                <SelectItem value={CUSTOM}>Custom…</SelectItem>
            </SelectContent>
        </Select>
    );
}

/** Compact per-row picker for the Organise dialog: managed sections + the
 *  item's current-but-unmanaged station (styled unassigned) + No section. */
export function StationSelect({
    value,
    sections,
    onChange,
    id,
}: {
    value: string;
    sections: string[];
    onChange: (v: string) => void;
    id?: string;
}): React.JSX.Element {
    const current = value.trim();
    const unlisted = current !== "" && !sections.some((s) => s.toLowerCase() === current.toLowerCase());
    return (
        <Select value={current === "" ? NO_STATION : current} onValueChange={(v) => { onChange(v === NO_STATION ? "" : v); }}>
            <SelectTrigger id={id} aria-label="Kitchen section" className={cn(unlisted && "border-dashed border-warning/50 text-warning")}>
                <SelectValue placeholder="No section" />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value={NO_STATION}>No section</SelectItem>
                {sections.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
                {unlisted && (
                    <SelectItem value={current} className="text-warning">{current} (unassigned)</SelectItem>
                )}
            </SelectContent>
        </Select>
    );
}
