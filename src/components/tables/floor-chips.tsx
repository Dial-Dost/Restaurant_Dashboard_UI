"use client";

/**
 * The floor's colours, drawn — the web half of lib/widgets/floor_chips.dart.
 *
 * A floor chip is NOT a StatusChip: a status chip is a 12% tint of its ink, and
 * on a tile already washed in the same ink the label drops below contrast. Ink
 * on an OPAQUE card pill is the pairing the app pins, so that is what these
 * render.
 */

import * as React from "react";
import { useTheme } from "next-themes";
import { Filter } from "lucide-react";

import { cn } from "@/lib/utils";
import { floorInks, type FloorInkSet } from "@/lib/floor-state";
import {
    FLOOR_STATE_WORDS,
    floorLegend,
    type FloorTileState,
} from "@/lib/api/tables-floor";

/** The ink set for what the page is wearing right now (palette × scheme). */
export function useFloorInks(): FloorInkSet {
    const { resolvedTheme } = useTheme();
    const [palette, setPalette] = React.useState<string>("rustic");
    React.useEffect(() => {
        const root = document.documentElement;
        const read = (): void => { setPalette(root.getAttribute("data-palette") ?? "rustic"); };
        read();
        const observer = new MutationObserver(read);
        observer.observe(root, { attributes: true, attributeFilter: ["data-palette"] });
        return () => { observer.disconnect(); };
    }, []);
    return floorInks(palette, resolvedTheme !== "light");
}

export interface FloorChipProps {
    label: React.ReactNode;
    color: string;
    dense?: boolean;
    /** Spoken and shown on hover — the "#2" chip says "Next party" here. */
    tooltip?: string;
    /** 2 for a sentence that must not lose its end ("Updated — print again"). */
    maxLines?: number;
    className?: string;
}

/** A floor chip: the ink on an OPAQUE card-coloured pill with a solid dot. */
export function FloorChip({ label, color, dense = true, tooltip, maxLines = 1, className }: FloorChipProps): React.JSX.Element {
    return (
        <span
            title={tooltip}
            aria-label={tooltip}
            style={{ borderColor: color, color }}
            className={cn(
                "inline-flex min-w-0 max-w-full items-center rounded-full border bg-card font-semibold tracking-[0.3px]",
                dense ? "gap-[5px] px-2 py-[3px] text-[10.5px]" : "gap-1.5 px-2.5 py-[5px] text-[11.5px]",
                "gaia:rounded-[2px] gaia:uppercase gaia:tracking-[0.14em] gaia:font-normal",
                className,
            )}
        >
            <span
                aria-hidden
                style={{ backgroundColor: color }}
                className={cn("shrink-0 rounded-full", dense ? "h-[5px] w-[5px]" : "h-1.5 w-1.5")}
            />
            <span className={cn("min-w-0", maxLines <= 1 ? "truncate" : "line-clamp-2")}>{label}</span>
        </span>
    );
}

/** A state's chip, in its own words and ink. */
export function FloorStateChip({ state, inks, dense = true }: {
    state: FloorTileState;
    inks: FloorInkSet;
    dense?: boolean;
}): React.JSX.Element {
    return <FloorChip label={FLOOR_STATE_WORDS[state]} color={inks[state]} dense={dense} />;
}

/**
 * The waiter's colour key — the five states, no counts. A waiter has no
 * floor-summary strip: what colour means what is a fact about the tiles in
 * front of them; "23 Free" is a fact about the restaurant.
 */
export function FloorColourKey({ inks }: { inks: FloorInkSet }): React.JSX.Element {
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" data-testid="floor-colour-key">
            {floorLegend([], false).map((row) => (
                <span key={row.state} className="inline-flex items-center gap-[5px] text-[11.5px] text-muted-foreground">
                    <span
                        aria-hidden
                        className="h-[9px] w-[9px] shrink-0 rounded-full"
                        style={{ backgroundColor: inks[row.state] }}
                    />
                    {row.label}
                </span>
            ))}
        </div>
    );
}

/**
 * One counted legend chip. The "N Bill printed" one is a toggle for the
 * printed-backlog filter: tap → the floor narrows to only printed tables.
 */
export function FloorLegendChip({ state, label, inks, filterOn, onToggleFilter }: {
    state: FloorTileState;
    label: string;
    inks: FloorInkSet;
    /** Only meaningful on the printed chip. */
    filterOn?: boolean;
    /** Present = this chip toggles the printed-backlog filter. */
    onToggleFilter?: () => void;
}): React.JSX.Element {
    const chip = <FloorChip label={label} color={inks[state]} />;
    if (state !== "printed" || !onToggleFilter) { return chip; }
    const on = filterOn === true;
    return (
        <button
            type="button"
            aria-pressed={on}
            onClick={onToggleFilter}
            title={on ? "Showing only printed tables — tap to show all" : "Show only printed tables"}
            className="inline-flex items-center gap-1 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
            {chip}
            {on ? <Filter aria-hidden className="h-3.5 w-3.5" style={{ color: inks.printed }} /> : null}
        </button>
    );
}
