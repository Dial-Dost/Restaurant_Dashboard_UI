"use client";

import * as React from "react";
import { Package, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DrillSheet, DrillSheetAction } from "@/components/ui/drill-sheet";
import { PoDetailRow, PoSectionLabel, qtyText } from "@/components/purchase-orders/po-bits";
import { formatDateTime } from "@/lib/tz";
import { useTimezone } from "@/lib/use-timezone";
import type { PurchaseOrderRecord } from "@/lib/api/purchase-orders";

export interface PoDetailSheetProps {
  po: PurchaseOrderRecord | null;
  money: (v: number | null | undefined) => string;
  onOpenChange: (open: boolean) => void;
  /** Hidden outright when this session cannot open Inventory. */
  canOpenInventory: boolean;
  onJumpToInventory: () => void;
  onPlace: (po: PurchaseOrderRecord) => void;
  onReceive: (po: PurchaseOrderRecord) => void;
}

/**
 * The whole PO (modules.dart `_openPo` -> `_detailSheet`): who it is with,
 * what was asked for, what actually arrived, what it cost and when each step
 * happened — eyebrow "PURCHASE ORDER · {status}", vendor-name title, the
 * Status / Total cost / Received / Delivery quality rows, then LINES, DATES
 * and NOTES sections, the two forward-moving actions, and the "View in
 * Inventory" jump. Cancel and Delete stay on the card alone: a sheet the
 * owner opened to READ must not put a destructive control under the next tap.
 */
export function PoDetailSheet({
  po,
  money,
  onOpenChange,
  canOpenInventory,
  onJumpToInventory,
  onPlace,
  onReceive,
}: PoDetailSheetProps): React.JSX.Element | null {
  const { timezone } = useTimezone();
  if (!po) { return null; }

  const status = po.status;
  const ordered = po.items.reduce((sum, item) => sum + item.qty_ordered, 0);
  const received = po.items.reduce((sum, item) => sum + item.qty_received, 0);
  const quality = po.quality_rating;
  const canReceive = status === "ordered" || status === "draft";

  // Close the sheet first, then act — the Flutter buttons pop before running.
  const run = (fn: (record: PurchaseOrderRecord) => void) => () => {
    onOpenChange(false);
    fn(po);
  };

  return (
    <DrillSheet
      open
      onOpenChange={onOpenChange}
      eyebrow={`Purchase order · ${status}`}
      title={po.vendor_name || "Unassigned vendor"}
      action={
        canOpenInventory ? (
          <DrillSheetAction
            module="Inventory"
            onClick={() => {
              onOpenChange(false);
              onJumpToInventory();
            }}
          />
        ) : undefined
      }
    >
      <div>
        <PoDetailRow label="Status" value={status} />
        <PoDetailRow label="Total cost" value={money(po.total_cost)} />
        <PoDetailRow
          label="Received"
          value={`${qtyText(received)} of ${qtyText(ordered)}`}
          trailing={ordered > 0 ? `${((received / ordered) * 100).toFixed(0)}%` : undefined}
        />
        {quality != null && quality > 0 && (
          <PoDetailRow label="Delivery quality" value={`${quality.toFixed(0)} of 5`} />
        )}

        <PoSectionLabel>LINES ({po.items.length})</PoSectionLabel>
        {po.items.length === 0 ? (
          <p className="text-xs text-muted-foreground">This order has no lines.</p>
        ) : (
          po.items.map((item) => (
            <PoDetailRow
              key={item.inventory_id}
              label={item.name}
              value={money(item.qty_ordered * item.unit_cost)}
              // What was asked for and what turned up, on the same line — a
              // short delivery is the thing a PO is opened to check.
              trailing={`${qtyText(item.qty_ordered)} × ${money(item.unit_cost)} · ${qtyText(item.qty_received)} in`}
            />
          ))
        )}

        <PoSectionLabel>DATES</PoSectionLabel>
        {po.created_at.length > 0 && (
          <PoDetailRow label="Raised" value={formatDateTime(po.created_at, timezone)} />
        )}
        {po.created_by.length > 0 && <PoDetailRow label="Raised by" value={po.created_by} />}
        {po.ordered_at.length > 0 && (
          <PoDetailRow label="Placed" value={formatDateTime(po.ordered_at, timezone)} />
        )}
        {po.expected_date.length > 0 && <PoDetailRow label="Expected" value={po.expected_date} />}
        {po.received_at.length > 0 && (
          <PoDetailRow label="Received on" value={formatDateTime(po.received_at, timezone)} />
        )}

        {po.notes.length > 0 && (
          <>
            <PoSectionLabel>NOTES</PoSectionLabel>
            <p className="text-xs leading-relaxed text-muted-foreground">{po.notes}</p>
          </>
        )}

        {status === "draft" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 w-full"
            onClick={run(onPlace)}
          >
            <Send /> Place this order
          </Button>
        )}
        {canReceive && (
          <Button type="button" size="sm" className="mt-2 w-full" onClick={run(onReceive)}>
            <Package /> Receive stock
          </Button>
        )}
      </div>
    </DrillSheet>
  );
}
