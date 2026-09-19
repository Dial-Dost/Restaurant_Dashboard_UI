"use client";

// "PRE-ORDERS TO CONFIRM" — web copy of `_pendingPreorderSection` /
// `_pendingCard` (modules.dart `_WaitlistView`): seated parties whose held
// items are still waiting on a yes/no. Confirm/decline are never one click
// from the list; they always go through the review dialog, and the caption
// says why: nothing reaches the kitchen until you confirm.

import * as React from "react";
import { Banknote, ClipboardCheck, Phone, Table2, Utensils } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ForkCard } from "@/components/ui/fork-card";
import { MicroStat } from "@/components/ui/micro-stat";
import { SectionHeader } from "@/components/ui/section-header";
import { InfoChip } from "@/components/ui/status-chip";
import { IconTile } from "@/components/waitlist/bits";
import { heldSubtotal, moneyOf, preItemsOf } from "@/components/waitlist/format";
import type { PendingPreorderEntry } from "@/lib/db";

export interface PendingPreordersSectionProps {
  pending: PendingPreorderEntry[];
  busyId: string | null;
  currencySymbol: string;
  onReview: (entry: PendingPreorderEntry, subtotal: number) => void;
}

export function PendingPreordersSection({
  pending,
  busyId,
  currencySymbol,
  onReview,
}: PendingPreordersSectionProps): React.JSX.Element | null {
  if (pending.length === 0) { return null; }
  return (
    <div>
      <SectionHeader title="Pre-orders to confirm" count={pending.length} />
      <div className="flex flex-col gap-3">
        {pending.map((e) => {
          const items = preItemsOf(e);
          // The held lines carry the price they were picked at; the server
          // re-prices on confirm, so this is an indication, not the bill.
          const subtotal = heldSubtotal(items);
          const table = e.table_name ?? "";
          const phone = e.phone ?? "";
          const busy = busyId === e.id;
          return (
            <ForkCard key={e.id} className="px-4 py-3.5">
              <div className="flex items-start gap-3.5">
                <IconTile size={40}>
                  <Utensils />
                </IconTile>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-semibold text-foreground">{e.name}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {table.length > 0 && table !== "—" && <InfoChip icon={<Table2 />} label={table} />}
                    <InfoChip icon={<Utensils />} label={`${String(items.length)}-item pre-order`} />
                    {phone.length > 0 && <InfoChip icon={<Phone />} label={phone} />}
                    {subtotal > 0 && <InfoChip icon={<Banknote />} label={moneyOf(currencySymbol, subtotal)} />}
                  </div>
                </div>
                <MicroStat value={`${String(e.minutes_since_seated || 0)}m`} label="seated" alignEnd />
              </div>
              <div className="mt-3.5 flex items-center gap-3.5">
                <Button size="sm" disabled={busy} onClick={() => { onReview(e, subtotal); }}>
                  <ClipboardCheck /> Review pre-order
                </Button>
                <p className="min-w-0 flex-1 text-[11px] text-tertiary">
                  Nothing reaches the kitchen until you confirm.
                </p>
              </div>
            </ForkCard>
          );
        })}
      </div>
    </div>
  );
}
