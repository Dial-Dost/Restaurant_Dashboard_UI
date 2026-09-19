"use client";

// One stock row — Flutter `inventoryModule`'s item ForkCard: the whole surface
// opens the item sheet; the kebab ("Stock") holds only the two stock actions.

import * as React from "react";
import { MoreVertical, Package, PackagePlus, Trash } from "lucide-react";
import type { InventoryItem } from "@/app/dashboard/inventory/page";
import { ForkCard } from "@/components/ui/fork-card";
import { MicroStat } from "@/components/ui/micro-stat";
import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { TONE_VAR, stockTone, withUnit } from "./inventory-shared";

export function StockRowCard({
  item,
  onOpen,
  onReceive,
  onWastage,
  highlight,
}: {
  item: InventoryItem;
  onOpen: () => void;
  onReceive: () => void;
  onWastage: () => void;
  /** `useHighlightRow` props for the deep-link ring (id + className). */
  highlight?: { id: string; className: string };
}): React.JSX.Element {
  const tone = stockTone(item.status);
  const attention = tone !== "success";
  const v = TONE_VAR[tone];

  return (
    <ForkCard
      onClick={onOpen}
      chevron={false}
      id={highlight?.id}
      className={cn("flex items-center gap-3 px-3.5 py-3", highlight?.className)}
      // Attention ring: a soft glow in the status colour (never colour alone —
      // the labelled chip rides with it).
      style={attention ? { boxShadow: `var(--shadow-card), 0 0 22px hsl(var(${v}) / 0.09)` } : undefined}
    >
      <div
        aria-hidden
        className={cn(
          "flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] border",
          attention ? "" : "border-border bg-inset text-muted-foreground",
        )}
        style={
          attention
            ? { background: `hsl(var(${v}) / 0.12)`, borderColor: `hsl(var(${v}) / 0.28)`, color: `hsl(var(${v}))` }
            : undefined
        }
      >
        <Package className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{item.name}</div>
      <MicroStat value={withUnit(String(item.stock), item.unit)} label="on hand" alignEnd className="shrink-0" />
      <StatusChip status={tone} label={item.status} className="shrink-0 max-[759px]:hidden" />
      <StatusChip status={tone} label={item.status} dense className="shrink-0 min-[760px]:hidden" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label="Stock"
            title="Stock"
            onClick={(e) => { e.stopPropagation(); }}
            onKeyDown={(e) => { e.stopPropagation(); }}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => { e.stopPropagation(); }}>
          <DropdownMenuItem onClick={onReceive}>
            <PackagePlus className="mr-2 h-4 w-4" /> Receive stock
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onWastage}>
            <Trash className="mr-2 h-4 w-4" /> Record wastage
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </ForkCard>
  );
}
