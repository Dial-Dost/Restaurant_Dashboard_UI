"use client";

import * as React from "react";
import { ArrowDownLeft, Ban, Package, Send, Trash2, Truck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ForkCard } from "@/components/ui/fork-card";
import { MicroStat } from "@/components/ui/micro-stat";
import { InfoChip } from "@/components/ui/status-chip";
import { PoStatusChip } from "@/components/purchase-orders/po-bits";
import type { PurchaseOrderRecord } from "@/lib/api/purchase-orders";

export interface PoCardProps {
  po: PurchaseOrderRecord;
  money: (v: number | null | undefined) => string;
  /** A request for THIS row is in flight (web-extra kept from the old page —
   *  prevents a double Place/Receive while the round trip runs). */
  busy: boolean;
  onOpen: () => void;
  onPlace: () => void;
  onReceive: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

/**
 * One purchase order in the list (modules.dart `_poCard` via `_recordHeadRow`):
 * a 40×40 inset icon tile leads; the identity column is the vendor name over
 * two InfoChips ("{n} item(s)", "{received}/{ordered} received"); the trailing
 * group is the MicroStat total + the animated StatusChip, stacking under the
 * identity block below 760px. The card itself opens the detail sheet — the
 * action row keeps its own buttons, so that tap never resolves to Cancel or
 * Delete.
 */
export function PoCard({
  po,
  money,
  busy,
  onOpen,
  onPlace,
  onReceive,
  onCancel,
  onDelete,
}: PoCardProps): React.JSX.Element {
  const status = po.status;
  const ordered = po.items.reduce((sum, item) => sum + item.qty_ordered, 0);
  const received = po.items.reduce((sum, item) => sum + item.qty_received, 0);
  const canReceive = status === "ordered" || status === "draft";
  const vendorName = po.vendor_name || "Unassigned vendor";

  return (
    <ForkCard
      onClick={onOpen}
      className="px-[18px] py-3.5"
      aria-label={`Purchase order — ${vendorName}, ${status}. Opens details.`}
    >
      {/* Head row: wide = leading | identity | trailing on one line; below
          760px the trailing group stacks under the identity block. */}
      <div className="flex items-center gap-3 max-[759px]:flex-col max-[759px]:items-stretch">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-border bg-inset text-tertiary gaia:rounded-[2px]"
          >
            <Truck className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold tracking-[-0.005em] text-foreground">
              {vendorName}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <InfoChip icon={<Package />} label={`${po.items.length} item(s)`} />
              <InfoChip
                icon={<ArrowDownLeft />}
                label={`${received.toFixed(0)}/${ordered.toFixed(0)} received`}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <MicroStat value={money(po.total_cost)} label="total" alignEnd />
          <PoStatusChip id={po.id} status={status} />
        </div>
      </div>

      {/* The action row — its taps stay its own (Flutter keeps destructive
          controls off the card tap path). */}
      <div
        className="mt-3.5 flex flex-wrap gap-2"
        onClick={(event) => { event.stopPropagation(); }}
        onKeyDown={(event) => { event.stopPropagation(); }}
      >
        {status === "draft" && (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onPlace}>
            <Send /> Place
          </Button>
        )}
        {canReceive && (
          <Button type="button" size="sm" disabled={busy} onClick={onReceive}>
            <Package /> Receive
          </Button>
        )}
        {status !== "received" && status !== "cancelled" && (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
            <Ban /> Cancel
          </Button>
        )}
        {status !== "received" && (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onDelete}>
            <Trash2 /> Delete
          </Button>
        )}
      </div>
    </ForkCard>
  );
}
