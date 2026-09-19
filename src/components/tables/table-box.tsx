"use client";

/**
 * One service-floor tile — the web `_TableBox` (service surface).
 *
 * The ENTIRE tile is the control: tapping it opens the table sheet, and the
 * tile itself carries no buttons or inputs — state, chips and figures only.
 * Occupied and free must be tellable apart across the room, so the tile is
 * washed in its state's fixed ink (green free, amber seated, red running,
 * orange printed, blue reserved) with a stronger border when occupied and a
 * glow on the two money-owing states.
 */

import * as React from "react";
import { Link2, Lock, Users } from "lucide-react";

import { cn } from "@/lib/utils";
import type { FloorInkSet } from "@/lib/floor-state";
import { InfoChip } from "@/components/ui/status-chip";
import { MicroStat } from "@/components/ui/micro-stat";
import { TickTag } from "@/components/ui/tick-tag";
import { OutboxTagBadge } from "@/components/outbox-chip";
import {
    NEXT_PARTY_CHIP,
    PAPER_STALE_CHIP,
    isNextPartyRow,
    nextPartyBadge,
    printedClockOf,
    printedTileChips,
    seatsLabel,
    tableDisplayName,
    type FloorRow,
} from "@/lib/api/tables-floor";
import { FloorChip, FloorStateChip } from "./floor-chips";

export interface TableBoxProps {
    row: FloorRow;
    inks: FloorInkSet;
    /** A caller (a notification's "Open T4") asked for this table. */
    focused?: boolean;
    /** May this session see money figures? */
    showsMoney: boolean;
    /** May this session settle (approve a guest payment)? */
    maySettle: boolean;
    /** The restaurant's currency mark — "₹" unless configured otherwise. */
    currencySymbol?: string;
    timeZone: string;
    onOpen: (row: FloorRow) => void;
}

export function TableBox({
    row,
    inks,
    focused = false,
    showsMoney,
    maySettle,
    currencySymbol = "₹",
    timeZone,
    onOpen,
}: TableBoxProps): React.JSX.Element {
    const state = row.state;
    const ink = inks[state];
    const printed = state === "printed";
    const occupied = row.seated;
    const awaitingOrder = occupied && row.hasOrder === false;
    const nextParty = isNextPartyRow(row.raw);
    const shownName = tableDisplayName(row.raw);
    const seats = seatsLabel(row.raw);
    const hasWaiter = row.waiter_name !== null && row.waiter_name !== "—";
    const hasTotal = showsMoney && occupied && (row.table_total ?? 0) !== 0;
    const otp = occupied ? row.order_otp : "";

    const borderAlpha = focused ? 1 : state === "running" || printed ? 0.85 : state === "seated" ? 0.6 : state === "reserved" ? 0.5 : 0.45;
    const apcTick = hasTotal && row.apc_status !== "neutral"
        ? (
            <TickTag
                label={row.apc_status === "green" ? "APC ok" : row.apc_status === "yellow" ? "APC close" : "APC low"}
                color={row.apc_status === "green" ? "hsl(var(--success))" : row.apc_status === "yellow" ? "hsl(var(--warning))" : "hsl(var(--destructive))"}
            />
        )
        : null;

    const money = (v: number | null): string => (v === null ? "—" : `${currencySymbol}${v.toFixed(2)}`);

    return (
        <button
            type="button"
            onClick={() => { onOpen(row); }}
            data-testid={`table-tile-${row.name}`}
            className={cn(
                "flex min-h-[128px] min-w-0 flex-col items-stretch rounded-lg border p-3.5 text-left",
                "transition-all duration-fast ease-out hover:-translate-y-0.5 cursor-pointer",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "gaia:rounded-[2px]",
            )}
            style={{
                backgroundColor: `color-mix(in srgb, ${ink} ${String(Math.round((state === "running" || printed ? 0.18 : state === "seated" ? 0.16 : state === "reserved" ? 0.13 : 0.10) * 100))}%, hsl(var(--card)))`,
                borderColor: focused
                    ? "hsl(var(--accent-hi))"
                    : `color-mix(in srgb, ${ink} ${String(Math.round(borderAlpha * 100))}%, transparent)`,
                borderWidth: focused || occupied ? 2 : 1,
                boxShadow: focused
                    ? "0 0 26px 1px color-mix(in srgb, hsl(var(--accent-hi)) 22%, transparent)"
                    : state === "running" || printed
                        ? `0 0 24px color-mix(in srgb, ${ink} 10%, transparent)`
                        : undefined,
            }}
        >
            <span className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.01em] text-foreground gaia:font-serif">
                    {shownName}
                </span>
                {row.payment_pending ? (
                    <FloorChip label="PAID" color="hsl(var(--warning))" />
                ) : null}
                <OutboxTagBadge tag={`table:${row.name}`} />
            </span>

            <span className="mt-2 flex flex-wrap items-center justify-between gap-1.5">
                <FloorStateChip state={state} inks={inks} />
                {nextParty ? (
                    <FloorChip
                        label={nextPartyBadge(row.party_no) ?? NEXT_PARTY_CHIP}
                        color={inks.nextParty}
                        tooltip={NEXT_PARTY_CHIP}
                    />
                ) : null}
                {apcTick}
            </span>

            {printed ? (
                <span className="mt-1.5 flex flex-wrap gap-1.5">
                    {printedTileChips({
                        printedClock: printedClockOf(row.printed_at_iso, timeZone),
                        paperStale: row.paper_stale,
                        printedAs: row.printed_as,
                    }).map((chip) => chip === PAPER_STALE_CHIP
                        ? <FloorChip key={chip} label={chip} color={inks.printed} maxLines={2} />
                        : <InfoChip key={chip} label={chip} />)}
                </span>
            ) : null}

            {otp !== "" ? (
                <span className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-[7px] border border-accent-mid/40 bg-accent-deep/15 px-2 py-1">
                    <Lock aria-hidden className="h-3 w-3 text-accent-foreground" />
                    <span className="text-[13px] font-bold tracking-[0.12em] text-accent-foreground">OTP {otp}</span>
                </span>
            ) : null}

            {row.clubbed_with.length > 0 ? (
                <span
                    className="mt-2 inline-flex w-fit min-w-0 max-w-full items-center gap-1.5 rounded-[7px] border border-accent-mid/40 bg-accent-deep/15 px-2 py-1"
                    title={`Clubbed with ${row.clubbed_with.join(" + ")}`}
                >
                    <Link2 aria-hidden className="h-3 w-3 shrink-0 text-accent-foreground" />
                    <span className="min-w-0 truncate text-[11.5px] font-bold text-accent-foreground">
                        + {row.clubbed_with.join(" + ")}
                    </span>
                </span>
            ) : null}

            {/* No timers on the tile (tables-floor.md ~120): Flutter's tile has
                none. The elapsed chips — "On table" and "Latest order" in the
                kitchen's 10/15-minute colours — live in the table SHEET. */}

            {(seats !== "" || hasWaiter || (occupied && row.covers !== null)) ? (
                <span className="mt-2 flex flex-wrap gap-1.5">
                    {seats !== "" ? <InfoChip icon={<Users />} label={seats} /> : null}
                    {occupied && row.covers !== null ? (
                        <InfoChip icon={<Users />} label={`${String(row.covers)} covers`} />
                    ) : null}
                    {hasWaiter && row.waiter_name !== null ? (
                        <InfoChip
                            label={row.waiter_name.length > 14 ? `${row.waiter_name.slice(0, 13)}…` : row.waiter_name}
                        />
                    ) : null}
                </span>
            ) : null}

            <span className="mt-auto pt-2.5">
                {row.payment_pending ? (
                    <span className="text-[11px] font-semibold text-warning">
                        {maySettle ? "Tap to approve payment" : "Paid — a manager must approve"}
                    </span>
                ) : hasTotal ? (
                    <MicroStat
                        value={money(row.table_total)}
                        label={`bill · apc ${money(row.table_apc)}`}
                    />
                ) : awaitingOrder ? (
                    <span className="text-[11px] font-semibold text-warning">Seated — no order yet</span>
                ) : (
                    <span className="text-[11px] text-tertiary">Tap to manage</span>
                )}
            </span>
        </button>
    );
}
