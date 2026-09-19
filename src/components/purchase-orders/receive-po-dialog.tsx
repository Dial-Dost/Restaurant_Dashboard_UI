"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { PurchaseOrderRecord } from "@/lib/api/purchase-orders";

// 0 = not rated; 1–5 feeds the supplier score. Stars only, in the Flutter
// dropdown's exact order (Not rated, 5, 4, 3, 2, 1).
const QUALITY_OPTIONS: { value: string; label: string }[] = [
  { value: "0", label: "Not rated" },
  { value: "5", label: "★★★★★" },
  { value: "4", label: "★★★★" },
  { value: "3", label: "★★★" },
  { value: "2", label: "★★" },
  { value: "1", label: "★" },
];

export interface ReceivePoDialogProps {
  /** The PO being received; null keeps the dialog closed. */
  po: PurchaseOrderRecord | null;
  onOpenChange: (open: boolean) => void;
  /** Confirm pressed: the dialog has closed itself; the caller filters the
   *  quantities and guards the all-empty case (Flutter `_receivePo`). */
  onConfirm: (
    po: PurchaseOrderRecord,
    lines: { inventory_id: string; qty_received: number }[],
    qualityRating: number,
  ) => void;
}

/**
 * The "Receive stock" dialog (modules.dart `_receivePo`): one row per line —
 * item name beside a 90px Qty field pre-seeded with the remaining quantity
 * (ordered − received, blank when nothing is left) — then a divider, the
 * "Delivery quality" star dropdown with its Analytics caption, and
 * Cancel / Confirm.
 */
export function ReceivePoDialog({ po, onOpenChange, onConfirm }: ReceivePoDialogProps): React.JSX.Element {
  const [qty, setQty] = React.useState<Record<string, string>>({});
  const [rating, setRating] = React.useState("0");

  // Seed each opening from the PO in hand, like the Flutter controllers.
  const poId = po?.id ?? null;
  React.useEffect(() => {
    if (!po) { return; }
    const seed: Record<string, string> = {};
    for (const item of po.items) {
      const remaining = item.qty_ordered - item.qty_received;
      seed[item.inventory_id] = remaining > 0 ? remaining.toFixed(0) : "";
    }
    setQty(seed);
    setRating("0");
    // Re-seed per PO, not per refreshed row object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poId]);

  const confirm = (): void => {
    if (!po) { return; }
    const lines: { inventory_id: string; qty_received: number }[] = [];
    for (const item of po.items) {
      const parsed = Number.parseFloat((qty[item.inventory_id] ?? "").trim());
      if (Number.isFinite(parsed) && parsed > 0) {
        lines.push({ inventory_id: item.inventory_id, qty_received: parsed });
      }
    }
    const parsedRating = Number.parseInt(rating, 10);
    onOpenChange(false);
    onConfirm(po, lines, Number.isFinite(parsedRating) ? parsedRating : 0);
  };

  return (
    <Dialog open={po != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Receive stock</DialogTitle>
          <DialogDescription className="sr-only">
            Enter the quantities that arrived against this purchase order.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {(po?.items ?? []).map((item) => (
            <div key={item.inventory_id} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                {item.name}
              </span>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="Qty"
                aria-label={`Quantity received — ${item.name}`}
                className="w-[90px]"
                value={qty[item.inventory_id] ?? ""}
                onChange={(event) => {
                  setQty((prev) => ({ ...prev, [item.inventory_id]: event.target.value }));
                }}
              />
            </div>
          ))}
          <Separator className="my-1" />
          <div className="flex items-center gap-3">
            <span className="min-w-0 flex-1 text-[13px] text-foreground">Delivery quality</span>
            <Select value={rating} onValueChange={setRating}>
              <SelectTrigger className="w-[140px]" aria-label="Delivery quality">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUALITY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-[11px] text-muted-foreground">Feeds the supplier score in Analytics.</p>
        </div>
        <DialogFooter className="gap-2 sm:gap-0 sm:space-x-2">
          <Button type="button" variant="ghost" onClick={() => { onOpenChange(false); }}>
            Cancel
          </Button>
          <Button type="button" onClick={confirm}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
