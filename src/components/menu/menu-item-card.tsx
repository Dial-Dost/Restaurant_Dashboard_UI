"use client";

/**
 * One menu tile (modules.dart `itemCard` + food_tile.dart FoodTile): leading
 * 44px photo (or the gradient 🍽️ placeholder), name + quiet cost line, the
 * three-state kitchen-section tag, capped badge chips, a right-aligned Price
 * MicroStat, the animated Available/Sold-out chip and the on-card 86 toggle —
 * the one menu action taken mid-service, so it stays ON the tile.
 *
 * Everything else (blurb, edit, section re-route, price points, delete) lives
 * one tap away behind the card's onOpen, so a mis-tap in a dense grid can never
 * delete a dish.
 */

import * as React from "react";
import { Eye, EyeOff, Soup } from "lucide-react";
import { ForkCard } from "@/components/ui/fork-card";
import { InfoChip, StatusChip } from "@/components/ui/status-chip";
import { TickTag } from "@/components/ui/tick-tag";
import { MicroStat } from "@/components/ui/micro-stat";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatAmount } from "@/lib/mis-capture";
import type { MenuBadge } from "@/lib/menu-badges";
import type { MenuModuleItem } from "@/lib/api/menu";
import { MenuBadgeChips } from "./badge-chips";

/** A station is "managed" when it appears in the tenant's kitchen-section list. */
export const isManagedStation = (station: string | null | undefined, sections: string[]): boolean =>
    !!station && sections.some((s) => s.toLowerCase() === station.toLowerCase());

/** Flutter's quiet one-tone costing line: `cost ₹X · Y% margin`. */
export const costingLine = (item: MenuModuleItem, currencySymbol: string): string => {
    if (item.cost == null) { return ""; }
    const margin = typeof item.margin_pct === "number" ? ` · ${item.margin_pct.toFixed(0)}% margin` : "";
    return `cost ${formatAmount(item.cost, currencySymbol)}${margin}`;
};

/** Dish photo, or the FoodTile gradient placeholder with the 🍽️ glyph. */
export function DishImage({ url, size = 44 }: { url?: string | null; size?: number }): React.JSX.Element {
    const [broken, setBroken] = React.useState(false);
    const px = { width: size, height: size };
    if (url && !broken) {
        return (
            <img
                src={url}
                alt=""
                style={px}
                className="shrink-0 rounded-[10px] border border-border object-cover"
                onError={() => { setBroken(true); }}
            />
        );
    }
    return (
        <div
            style={px}
            className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-border bg-gradient-to-br from-card-top to-inset"
            aria-hidden
        >
            {/* Soft copper glow so the glyph sits in the palette. */}
            <div
                className="absolute rounded-full bg-accent-deep/35 blur-[5px]"
                style={{ width: size * 0.62, height: size * 0.62 }}
            />
            <span className="relative" style={{ fontSize: size * 0.44 }}>🍽️</span>
        </div>
    );
}

/**
 * Kitchen-section tag, three states: managed → solid InfoChip (soup-kitchen
 * icon, UPPERCASE); leftover label from a deleted section → amber
 * "STATION · UNASSIGNED"; no station → faint "No section".
 */
export function SectionTag({ station, managed }: { station: string; managed: boolean }): React.JSX.Element {
    if (!station) {
        return <TickTag label="No section" />;
    }
    if (managed) {
        return <InfoChip icon={<Soup />} label={station.toUpperCase()} />;
    }
    return <StatusChip status="warning" label={`${station.toUpperCase()} · UNASSIGNED`} dense />;
}

export function MenuItemCard({
    item,
    sections,
    badges,
    currencySymbol,
    onOpen,
    onToggleAvailability,
    toggleBusy = false,
}: {
    item: MenuModuleItem;
    sections: string[];
    badges: MenuBadge[];
    currencySymbol: string;
    onOpen: () => void;
    onToggleAvailability: () => void;
    toggleBusy?: boolean;
}): React.JSX.Element {
    const soldOut = item.available === false;
    const station = item.station ?? "";
    const detail = costingLine(item, currencySymbol);

    return (
        <ForkCard onClick={onOpen} chevron={false} className="px-3.5 py-3">
            <div className="flex items-start gap-3">
                <DishImage url={item.image_url} />
                <div className="min-w-0 flex-1">
                    <p
                        className={cn(
                            "line-clamp-2 text-sm font-semibold leading-snug",
                            soldOut && "text-muted-foreground line-through",
                        )}
                    >
                        {item.name}
                    </p>
                    {detail && <p className="mt-[3px] truncate text-xs text-muted-foreground">{detail}</p>}
                    <div className="mt-1.5 flex">
                        <SectionTag station={station} managed={isManagedStation(station, sections)} />
                    </div>
                    {badges.length > 0 && (
                        <MenuBadgeChips
                            catalogue={badges}
                            tagged={item.badges}
                            allergens={item.allergens}
                            className="mt-1.5"
                        />
                    )}
                </div>
                <MicroStat value={formatAmount(item.price, currencySymbol)} label="Price" alignEnd />
            </div>
            <div className="mt-3 flex items-center">
                <StatusChip
                    status={soldOut ? "danger" : "success"}
                    label={soldOut ? "Sold out" : "Available"}
                    dense
                />
                <div className="ml-auto">
                    {/* 86-ing a dish is the one menu action taken mid-service, so it
                        stays on the tile rather than behind a tap. */}
                    <Button
                        variant="ghost"
                        size="icon"
                        disabled={toggleBusy}
                        title={soldOut ? "Mark available" : "Mark sold out"}
                        aria-label={soldOut ? `Mark ${item.name} available` : `Mark ${item.name} sold out`}
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleAvailability();
                        }}
                    >
                        {soldOut ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                </div>
            </div>
        </ForkCard>
    );
}
