"use client";

/**
 * The per-dish drill-down mini-overview (modules.dart `_detailSheet` for one
 * menu tile): eyebrow = category, title = dish name, k/v rows for Price /
 * Costing / Kitchen section / Availability, EVERY badge (the tile's cap is a
 * layout concession, never a decision about what a guest may know), the guest
 * blurb, and the action row — Edit item, Kitchen section, Price points (saved
 * dishes only), Delete item, plus Close. The destructive-ish actions
 * deliberately live one tap away from the grid.
 */

import * as React from "react";
import { Pencil, Ruler, Soup, Trash2 } from "lucide-react";
import { DrillSheet } from "@/components/ui/drill-sheet";
import { Button } from "@/components/ui/button";
import { formatAmount } from "@/lib/mis-capture";
import { resolveBadges, type MenuBadge } from "@/lib/menu-badges";
import type { MenuModuleItem } from "@/lib/api/menu";
import { MenuBadgeChips } from "./badge-chips";
import { costingLine } from "./menu-item-card";

function Kv({ k, v }: { k: string; v: string }): React.JSX.Element {
    return (
        <div className="flex items-start gap-3 py-1.5">
            <div className="micro-label w-[148px] shrink-0 pt-0.5">{k}</div>
            <div className="min-w-0 flex-1 text-[13px] font-medium">{v}</div>
        </div>
    );
}

export function ItemDetailSheet({
    item,
    badges,
    currencySymbol,
    onClose,
    onEdit,
    onKitchenSection,
    onPricePoints,
    onDelete,
}: {
    item: MenuModuleItem;
    badges: MenuBadge[];
    currencySymbol: string;
    onClose: () => void;
    onEdit: () => void;
    onKitchenSection: () => void;
    onPricePoints: () => void;
    onDelete: () => void;
}): React.JSX.Element {
    const soldOut = item.available === false;
    const station = item.station ?? "";
    let detail = costingLine(item, currencySymbol);
    if (detail && item.missing_costs > 0) {
        detail += ` (partial — ${item.missing_costs} uncosted)`;
    }
    const blurb = (item.blurb ?? "").trim();
    const hasBadges = resolveBadges(badges, item.badges, item.allergens).length > 0;

    return (
        <DrillSheet open onOpenChange={(o) => { if (!o) { onClose(); } }} eyebrow={item.category || "Menu"} title={item.name}>
            <Kv k="Price" v={formatAmount(item.price, currencySymbol)} />
            {detail && <Kv k="Costing" v={detail} />}
            <Kv k="Kitchen section" v={station || "—"} />
            <Kv k="Availability" v={soldOut ? "Sold out" : "Available"} />
            {/* The sheet has room, so nothing is trimmed here. */}
            {hasBadges && (
                <MenuBadgeChips
                    catalogue={badges}
                    tagged={item.badges}
                    allergens={item.allergens}
                    promoLimit={99}
                    className="mt-2.5"
                />
            )}
            {blurb && <p className="mt-2.5 whitespace-pre-line text-xs text-tertiary">{blurb}</p>}
            <div className="mt-3.5 flex flex-wrap gap-2">
                <Button size="sm" onClick={onEdit}>
                    <Pencil className="mr-2 h-3.5 w-3.5" /> Edit item
                </Button>
                <Button size="sm" variant="outline" onClick={onKitchenSection}>
                    <Soup className="mr-2 h-3.5 w-3.5" /> Kitchen section
                </Button>
                {/* Sizes (migration 039) — only for a SAVED dish: a variation is a
                    row pointing at a menu id. */}
                {item.id && (
                    <Button size="sm" variant="outline" onClick={onPricePoints}>
                        <Ruler className="mr-2 h-3.5 w-3.5" /> Price points
                    </Button>
                )}
                <Button size="sm" variant="outline" onClick={onDelete}>
                    <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete item
                </Button>
                <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
            </div>
        </DrillSheet>
    );
}
