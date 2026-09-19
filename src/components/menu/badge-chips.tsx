"use client";

/**
 * The badge chips one dish wears, resolved and ordered exactly as a guest sees
 * them (menu_badges.dart MenuBadgeChips). `promoLimit` trims only highlights —
 * warnings and dietary badges always show — and the overflow renders as a small
 * "+N" instead of being swallowed. The detail sheet lifts the cap (promoLimit
 * 99); the card keeps Flutter's 2.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import {
    capBadges,
    isDerivedBadge,
    resolveBadges,
    type MenuBadge,
    type MenuBadgeKind,
} from "@/lib/menu-badges";

/** Kind → tokened tint classes (status is never colour-alone: the label ships). */
export function badgePillClass(kind: MenuBadgeKind): string {
    if (kind === "alert") { return "border-warning/28 bg-warning/12 text-warning"; }
    if (kind === "diet") { return "border-success/28 bg-success/12 text-success"; }
    return "border-accent-base/40 bg-accent-base/10 text-accent-foreground";
}

export function BadgePill({ badge, dense = true, faded = false }: { badge: MenuBadge; dense?: boolean; faded?: boolean }): React.JSX.Element {
    return (
        <span
            className={cn(
                "inline-flex max-w-full items-center rounded-full border font-semibold",
                dense ? "px-[7px] py-px text-[10px] leading-[1.35]" : "px-[9px] py-0.5 text-[11.5px] leading-[1.35]",
                faded ? "border-input bg-transparent text-tertiary" : badgePillClass(badge.kind),
            )}
        >
            <span className="truncate">{badge.label}</span>
        </span>
    );
}

export function MenuBadgeChips({
    catalogue,
    tagged,
    allergens,
    promoLimit = 2,
    className,
}: {
    catalogue: MenuBadge[];
    tagged: unknown;
    allergens: unknown;
    promoLimit?: number;
    className?: string;
}): React.JSX.Element | null {
    const resolved = resolveBadges(catalogue, tagged, allergens);
    if (resolved.length === 0) { return null; }
    const capped = capBadges(resolved, promoLimit);
    return (
        <span className={cn("inline-flex flex-wrap items-center gap-[5px]", className)}>
            {capped.shown.map((b) => (
                <span key={b.id} title={isDerivedBadge(b) ? `Shown automatically because this dish lists "${b.allergen ?? ""}" as an allergen.` : undefined}>
                    <BadgePill badge={b} />
                </span>
            ))}
            {capped.hidden > 0 && <span className="text-[10px] text-tertiary">+{capped.hidden}</span>}
        </span>
    );
}
