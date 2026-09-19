"use client";

import * as React from "react";
import { PlusCircle, Trash2 } from "lucide-react";

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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { NewPoLine, PoInventoryItem, PoVendor } from "@/lib/api/purchase-orders";

export interface NewPoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendors: PoVendor[];
  inventory: PoInventoryItem[];
  money: (v: number | null | undefined) => string;
  /** The dialog's result, exactly like the Flutter `showDialog<String>`:
   *  the chosen status plus the drafted lines and optional vendor. */
  onSubmit: (result: {
    vendorId: string | null;
    lines: NewPoLine[];
    status: "draft" | "ordered";
  }) => void;
}

/**
 * The "New purchase order" dialog (modules.dart `_createPo`): an optional
 * Vendor dropdown (rendered only when vendors exist), the Item dropdown, Qty
 * and Unit cost beside an icon-only add button, the drafted line list
 * (name, "qty × cost", a small delete icon — no totals), and the three-action
 * footer Cancel / Save draft / Place order, the latter two disabled until at
 * least one line exists. The add button silently no-ops on an empty pick or a
 * non-positive quantity, as the Flutter one does.
 */
export function NewPoDialog({
  open,
  onOpenChange,
  vendors,
  inventory,
  money,
  onSubmit,
}: NewPoDialogProps): React.JSX.Element {
  const [vendorId, setVendorId] = React.useState("");
  const [pickId, setPickId] = React.useState("");
  const [qty, setQty] = React.useState("");
  const [cost, setCost] = React.useState("");
  const [lines, setLines] = React.useState<NewPoLine[]>([]);

  // Each open is a fresh dialog (Flutter constructs a new one every time).
  React.useEffect(() => {
    if (!open) { return; }
    setVendorId("");
    setPickId("");
    setQty("");
    setCost("");
    setLines([]);
  }, [open]);

  const addLine = (): void => {
    if (!pickId) { return; }
    const item = inventory.find((entry) => entry.id === pickId);
    const parsedQty = Number.parseFloat(qty.trim());
    if (!item || !(parsedQty > 0)) { return; }
    const parsedCost = Number.parseFloat(cost.trim());
    const unitCost = Number.isFinite(parsedCost) ? parsedCost : 0;
    setLines((prev) => [
      ...prev.filter((line) => line.inventory_id !== item.id),
      { inventory_id: item.id, name: item.name, qty_ordered: parsedQty, unit_cost: unitCost },
    ]);
    setPickId("");
    setQty("");
    setCost("");
  };

  const finish = (status: "draft" | "ordered"): void => {
    onSubmit({ vendorId: vendorId || null, lines, status });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>New purchase order</DialogTitle>
          <DialogDescription className="sr-only">
            Pick the items to order, then save a draft or place the order.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {vendors.length > 0 && (
            <div className="grid gap-1.5">
              <Label htmlFor="po-vendor">Vendor (optional)</Label>
              <Select value={vendorId} onValueChange={setVendorId}>
                <SelectTrigger id="po-vendor">
                  <SelectValue placeholder="Vendor (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {vendors.map((vendor) => (
                    <SelectItem key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="po-item">Item</Label>
            <Select value={pickId} onValueChange={setPickId}>
              <SelectTrigger id="po-item">
                <SelectValue placeholder="Item" />
              </SelectTrigger>
              <SelectContent>
                {inventory.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="po-qty">Qty</Label>
              <Input
                id="po-qty"
                type="number"
                inputMode="decimal"
                value={qty}
                onChange={(event) => { setQty(event.target.value); }}
              />
            </div>
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="po-cost">Unit cost</Label>
              <Input
                id="po-cost"
                type="number"
                inputMode="decimal"
                value={cost}
                onChange={(event) => { setCost(event.target.value); }}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Add line"
              onClick={addLine}
            >
              <PlusCircle />
            </Button>
          </div>

          {lines.length > 0 && (
            <div>
              {lines.map((line) => (
                <div key={line.inventory_id} className="flex items-center gap-2 py-1">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-foreground">
                      {line.name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {line.qty_ordered} × {money(line.unit_cost)}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${line.name}`}
                    onClick={() => {
                      setLines((prev) =>
                        prev.filter((entry) => entry.inventory_id !== line.inventory_id),
                      );
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-0 sm:space-x-2">
          <Button type="button" variant="ghost" onClick={() => { onOpenChange(false); }}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={lines.length === 0}
            onClick={() => { finish("draft"); }}
          >
            Save draft
          </Button>
          <Button
            type="button"
            disabled={lines.length === 0}
            onClick={() => { finish("ordered"); }}
          >
            Place order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
