"use client";

// THE CHANNEL PICKER behind the "Takeaway / Delivery" action — Flutter's
// `_newTakeawayOrder` bottom sheet (modules.dart 3415–3428, finding 27): two
// rows, Takeaway 🥡 and Delivery 🛵, then the order-entry form provisions a
// virtual table on send.

import * as React from "react";

import { DrillSheet } from "@/components/ui/drill-sheet";
import { ForkCard } from "@/components/ui/fork-card";
import { FoodTile } from "@/components/orders/order-card";

export type OrderChannel = "takeaway" | "delivery";

export interface ChannelSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (channel: OrderChannel) => void;
}

export function ChannelSheet({ open, onOpenChange, onPick }: ChannelSheetProps): React.JSX.Element {
  const row = (channel: OrderChannel, emoji: string, label: string, caption: string): React.JSX.Element => (
    <ForkCard onClick={() => { onPick(channel); }} className="flex items-center gap-3 p-[14px] py-3">
      <FoodTile emoji={emoji} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{label}</div>
        <div className="truncate text-xs text-muted-foreground">{caption}</div>
      </div>
    </ForkCard>
  );
  return (
    <DrillSheet open={open} onOpenChange={onOpenChange} title="Takeaway / Delivery" eyebrow="New order">
      <div className="space-y-2.5">
        {row("takeaway", "🥡", "Takeaway", "Packed at the counter — no table.")}
        {row("delivery", "🛵", "Delivery", "Sent out — takes the guest's phone and address.")}
      </div>
    </DrillSheet>
  );
}
