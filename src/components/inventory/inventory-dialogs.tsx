"use client";

// Inventory action dialogs — Flutter `_receiveStock` / `_recordWastage`,
// `_setReorderLevel`, `_addInventory`, `_InventoryCategoriesDialog` and
// `_VendorsSheet` (modules.dart), plus the web-only issue / expiry dialogs.

import * as React from "react";
import { Pencil, Plus, SlidersHorizontal, Tags, Trash2, Truck } from "lucide-react";
import type { InventoryItem } from "@/app/dashboard/inventory/page";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ForkCard } from "@/components/ui/fork-card";
import { SectionHeader } from "@/components/ui/section-header";
import { SkeletonBox } from "@/components/ui/fork-skeleton";
import { useConfirm, usePrompt } from "@/components/menu/confirm-dialog";
import {
  addVendor,
  deleteVendor,
  issueStock,
  receiveStock,
  recordWastage,
  setInventoryExpiry,
  setInventoryReorderLevel,
  type Vendor,
} from "@/lib/db";
import {
  createInventoryItem,
  errorStatus,
  fetchVendors,
  renameCategory,
  saveCategoryRoster,
} from "@/lib/api/inventory";
import { stockNum } from "./inventory-shared";

const msgOf = (e: unknown, fallback: string): string => (e instanceof Error && e.message ? e.message : fallback);

function Eyebrow({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="micro-label">{children}</div>;
}

// ---------------------------------------------------------------------------
// Receive / wastage / issue

export type StockMode = "receive" | "wastage" | "issue";

export function StockActionDialog({
  restaurantId,
  item,
  mode,
  onClose,
  onDone,
  onError,
}: {
  restaurantId: string;
  item: InventoryItem;
  mode: StockMode;
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (msg: string) => void;
}): React.JSX.Element {
  const [qty, setQty] = React.useState("");
  const [vendorId, setVendorId] = React.useState("");
  const [unitCost, setUnitCost] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [vendors, setVendors] = React.useState<Vendor[]>([]);

  // Vendors are read fresh on open; the picker shows only when there are some.
  React.useEffect(() => {
    if (mode !== "receive") {return;}
    let alive = true;
    fetchVendors(restaurantId).then((v) => { if (alive) {setVendors(v);} }).catch(() => undefined);
    return () => { alive = false; };
  }, [mode, restaurantId]);

  const title = mode === "receive" ? "Receive" : mode === "wastage" ? "Wastage" : "Issue to kitchen";

  const submit = async (): Promise<void> => {
    const q = Number(qty);
    if (!qty.trim() || !Number.isFinite(q) || q <= 0) {
      onError("Enter a valid quantity.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "receive") {
        await receiveStock(restaurantId, {
          inventory_id: item.id,
          qty: q,
          vendor_id: vendorId || undefined,
          unit_cost: unitCost ? Number(unitCost) : undefined,
        });
        onDone("Stock received.");
      } else if (mode === "issue") {
        await issueStock(restaurantId, { inventory_id: item.id, qty: q, note: reason.trim() || undefined });
        onDone("Issued to kitchen.");
      } else {
        await recordWastage(restaurantId, { inventory_id: item.id, qty: q, reason: reason.trim() || undefined });
        onDone("Wastage logged.");
      }
    } catch (e) {
      onError(msgOf(e, "Action failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) {onClose();} }}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{title} · {item.name}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
        >
          <div className="grid gap-1">
            <Label htmlFor="inv-qty">Quantity{item.unit ? ` (${item.unit})` : ""}</Label>
            <Input id="inv-qty" type="number" min="0" step="any" value={qty} onChange={(e) => { setQty(e.target.value); }} autoFocus />
          </div>
          {mode === "receive" ? (
            <>
              {vendors.length > 0 && (
                <div className="grid gap-1">
                  <Label>Vendor (optional)</Label>
                  <Select value={vendorId} onValueChange={setVendorId}>
                    <SelectTrigger><SelectValue placeholder="No vendor" /></SelectTrigger>
                    <SelectContent>
                      {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid gap-1">
                <Label htmlFor="inv-cost">Unit cost (optional)</Label>
                <Input id="inv-cost" type="number" min="0" step="any" value={unitCost} onChange={(e) => { setUnitCost(e.target.value); }} placeholder="₹ per unit" />
              </div>
            </>
          ) : (
            <div className="grid gap-1">
              <Label htmlFor="inv-reason">{mode === "issue" ? "Note (optional)" : "Reason (optional)"}</Label>
              <Input id="inv-reason" value={reason} onChange={(e) => { setReason(e.target.value); }} placeholder={mode === "issue" ? "e.g. dinner prep" : "e.g. spoiled, breakage"} />
            </div>
          )}
          <DialogFooter className="mt-1">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant={mode === "wastage" ? "destructive" : "default"} disabled={busy}>
              {mode === "receive" ? "Receive" : mode === "wastage" ? "Log wastage" : "Issue"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Reorder level (`_setReorderLevel`)

export function ReorderLevelDialog({
  restaurantId,
  item,
  onClose,
  onDone,
  onError,
}: {
  restaurantId: string;
  item: InventoryItem;
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (msg: string) => void;
}): React.JSX.Element {
  const [value, setValue] = React.useState(item.reorder_level == null ? "" : String(item.reorder_level));
  const [busy, setBusy] = React.useState(false);
  const unit = item.unit;
  const helper =
    item.reorder_applied != null && item.reorder_basis === "dimension-default"
      ? `Blank = default (${stockNum(item.reorder_applied)} ${unit})`
      : "Blank = sensible default for this unit";

  const save = async (): Promise<void> => {
    const raw = value.trim();
    const level = raw === "" ? null : Number(raw);
    if (level !== null && !(Number.isFinite(level) && level > 0)) {
      onError("Enter a number greater than 0, or leave it blank.");
      return;
    }
    setBusy(true);
    try {
      await setInventoryReorderLevel(restaurantId, item.id, level);
      onDone(level === null ? "Using the default level." : "Reorder level saved.");
    } catch (e) {
      onError(msgOf(e, "Unable to set the reorder level."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) {onClose();} }}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <Eyebrow>Inventory</Eyebrow>
          <DialogTitle>Reorder level - {item.name}</DialogTitle>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <p className="text-sm text-muted-foreground">
            Flag this item Low Stock at or below this level. Entered in the item&apos;s own unit ({unit}).
          </p>
          <div className="grid gap-1">
            <Label htmlFor="inv-reorder">Reorder at ({unit})</Label>
            <Input id="inv-reorder" type="number" step="any" min="0" value={value} onChange={(e) => { setValue(e.target.value); }} autoFocus />
            <p className="text-xs text-muted-foreground">{helper}</p>
          </div>
          <DialogFooter className="mt-1">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Expiry (web-only extra, audit 42)

export function ExpiryDialog({
  restaurantId,
  item,
  onClose,
  onDone,
  onError,
}: {
  restaurantId: string;
  item: InventoryItem;
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (msg: string) => void;
}): React.JSX.Element {
  const [date, setDate] = React.useState(item.expiry_date ?? "");
  const [busy, setBusy] = React.useState(false);

  const save = async (value: string | null): Promise<void> => {
    setBusy(true);
    try {
      await setInventoryExpiry(restaurantId, item.id, value);
      onDone(value ? "Expiry saved." : "Expiry cleared.");
    } catch (e) {
      onError(msgOf(e, "Unable to set expiry."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) {onClose();} }}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <Eyebrow>Inventory</Eyebrow>
          <DialogTitle>Expiry - {item.name}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-1">
          <Label htmlFor="inv-expiry">Expiry date</Label>
          <Input id="inv-expiry" type="date" value={date} onChange={(e) => { setDate(e.target.value); }} />
          <p className="text-xs text-muted-foreground">Items expiring within 7 days appear in the dashboard stock alerts.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {item.expiry_date && (
            <Button variant="outline" onClick={() => void save(null)} disabled={busy}>Clear</Button>
          )}
          <Button onClick={() => void save(date || null)} disabled={busy || !date}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Categories (`_InventoryCategoriesDialog`)

export function CategoriesDialog({
  open,
  restaurantId,
  categories,
  isAdmin,
  onClose,
}: {
  open: boolean;
  restaurantId: string;
  categories: string[];
  isAdmin: boolean;
  /** `changed` = anything was saved (drives the caller's reload). */
  onClose: (changed: boolean) => void;
}): React.JSX.Element {
  const [list, setList] = React.useState<string[]>(categories);
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [changed, setChanged] = React.useState(false);
  const { confirm, confirmDialog } = useConfirm();
  const { prompt, promptDialog } = usePrompt();

  React.useEffect(() => {
    if (open) {
      setList(categories);
      setName("");
      setError(null);
      setChanged(false);
    }
    // Seed only when the dialog opens; saves update `list` locally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fail = (e: unknown, fallback: string): void => {
    setError(errorStatus(e) === 403 ? "Only an admin can change inventory categories." : msgOf(e, fallback));
  };

  const clean = (s: string): string => s.trim().replace(/\s+/g, " ").slice(0, 40);

  const add = async (): Promise<void> => {
    const next = clean(name);
    if (!next) {return;}
    if (list.some((c) => c.toLowerCase() === next.toLowerCase())) {
      setName("");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const roster = [...list, next];
      await saveCategoryRoster(restaurantId, roster);
      setList(roster);
      setName("");
      setChanged(true);
    } catch (e) {
      fail(e, "Couldn't add the category.");
    } finally {
      setBusy(false);
    }
  };

  const rename = async (from: string): Promise<void> => {
    const answer = await prompt({ title: `Rename "${from}"`, label: "New category name", initial: from, maxLength: 40 });
    const to = clean(answer ?? "");
    if (!to || to === from) {return;}
    setBusy(true);
    setError(null);
    try {
      await renameCategory(restaurantId, from, to);
      setList((l) => l.map((c) => (c === from ? to : c)));
      setChanged(true);
    } catch (e) {
      fail(e, "Couldn't rename the category.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (cat: string): Promise<void> => {
    const ok = await confirm({
      title: "Remove category",
      body: `Remove "${cat}"? Existing items keep the label but it leaves the picker.`,
      confirmLabel: "Remove",
    });
    if (!ok) {return;}
    setBusy(true);
    setError(null);
    try {
      const roster = list.filter((c) => c !== cat);
      await saveCategoryRoster(restaurantId, roster);
      setList(roster);
      setChanged(true);
    } catch (e) {
      fail(e, "Couldn't remove the category.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) {onClose(changed);} }}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <Eyebrow>Stock organisation</Eyebrow>
            <DialogTitle>Inventory categories</DialogTitle>
          </DialogHeader>
          {!isAdmin && (
            <p className="text-xs text-muted-foreground">Adding or removing categories is admin-only.</p>
          )}
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void add(); }}>
            <div className="grid flex-1 gap-1">
              <Label htmlFor="inv-new-cat">New category (e.g. Produce)</Label>
              <Input id="inv-new-cat" value={name} maxLength={40} onChange={(e) => { setName(e.target.value); }} />
            </div>
            <Button type="submit" size="icon" variant="outline" disabled={busy || !name.trim()} aria-label="Add category">
              <Plus className="h-4 w-4" />
            </Button>
          </form>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="max-h-[45vh] space-y-2 overflow-y-auto">
            {list.length === 0 ? (
              <p className="text-sm text-muted-foreground">No categories yet.</p>
            ) : (
              list.map((c) => (
                <ForkCard key={c} inset className="flex items-center gap-3 p-3">
                  <Tags className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{c}</span>
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={busy} aria-label={`Rename ${c}`} onClick={() => void rename(c)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" disabled={busy} aria-label={`Remove ${c}`} onClick={() => void remove(c)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </ForkCard>
              ))
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => { onClose(changed); }}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmDialog}
      {promptDialog}
    </>
  );
}

// ---------------------------------------------------------------------------
// Vendors (`_VendorsSheet`) — a bottom sheet, read fresh on open.

export function VendorsSheet({
  open,
  restaurantId,
  onOpenChange,
  onError,
}: {
  open: boolean;
  restaurantId: string;
  onOpenChange: (open: boolean) => void;
  onError: (msg: string) => void;
}): React.JSX.Element {
  const [vendors, setVendors] = React.useState<Vendor[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const { confirm, confirmDialog } = useConfirm();

  const load = React.useCallback(async (): Promise<void> => {
    try {
      setVendors(await fetchVendors(restaurantId));
      setFailed(false);
    } catch {
      setFailed(true);
      setVendors((v) => v ?? []);
    }
  }, [restaurantId]);

  React.useEffect(() => {
    if (open) {
      setVendors(null);
      setFailed(false);
      void load();
    }
  }, [open, load]);

  const add = async (): Promise<void> => {
    if (!name.trim()) {return;}
    setBusy(true);
    try {
      await addVendor(restaurantId, { name: name.trim(), phone: phone.trim() || undefined });
      setName("");
      setPhone("");
      await load();
    } catch (e) {
      onError(msgOf(e, "Unable to add vendor."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (v: Vendor): Promise<void> => {
    const ok = await confirm({ title: "Remove vendor", body: `Remove "${v.name}"?`, confirmLabel: "Remove" });
    if (!ok) {return;}
    try {
      await deleteVendor(restaurantId, v.id);
      await load();
    } catch (e) {
      onError(msgOf(e, "Unable to delete vendor."));
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
          <div className="mx-auto w-full max-w-2xl">
            <SheetTitle asChild>
              <div><SectionHeader title="Vendors" /></div>
            </SheetTitle>
            <SheetDescription className="sr-only">Suppliers you receive stock from.</SheetDescription>
            <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void add(); }}>
              <Input aria-label="Vendor name" placeholder="Name" value={name} onChange={(e) => { setName(e.target.value); }} className="flex-1" />
              <Input aria-label="Vendor phone" placeholder="Phone" value={phone} onChange={(e) => { setPhone(e.target.value); }} className="w-[110px]" />
              <Button type="submit" disabled={busy || !name.trim()}>
                <Plus className="mr-1 h-4 w-4" /> Add
              </Button>
            </form>
            <div className="mt-4 space-y-2">
              {vendors === null ? (
                [0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <SkeletonBox width={32} height={32} />
                    <SkeletonBox height={14} className="flex-1" />
                  </div>
                ))
              ) : failed && vendors.length === 0 ? (
                <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                  <span>Couldn&apos;t load vendors.</span>
                  <Button size="sm" variant="outline" onClick={() => { setVendors(null); void load(); }}>Retry</Button>
                </div>
              ) : vendors.length === 0 ? (
                <p className="text-sm text-muted-foreground">No vendors yet — add your first supplier above.</p>
              ) : (
                vendors.map((v) => (
                  <ForkCard key={v.id} inset className="flex items-center gap-3 p-3">
                    <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-md border border-border bg-card">
                      <Truck className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{v.name}</p>
                      {v.phone ? <p className="truncate text-xs text-muted-foreground">{v.phone}</p> : null}
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Delete ${v.name}`} onClick={() => void remove(v)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </ForkCard>
                ))
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
      {confirmDialog}
    </>
  );
}

// ---------------------------------------------------------------------------
// Add item (`_addInventory`)

export function AddItemDialog({
  open,
  restaurantId,
  categories,
  roster,
  isAdmin,
  onOpenChange,
  onAdded,
  onCategoriesChanged,
  onError,
}: {
  open: boolean;
  restaurantId: string;
  /** Picker options (managed roster first, then legacy labels). */
  categories: string[];
  /** The managed roster alone — what the manage dialog edits. */
  roster: string[];
  isAdmin: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
  onCategoriesChanged: () => void;
  onError: (msg: string) => void;
}): React.JSX.Element {
  const [name, setName] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [stock, setStock] = React.useState("");
  const [unit, setUnit] = React.useState("");
  const [reorder, setReorder] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [manageOpen, setManageOpen] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setName("");
      setStock("");
      setUnit("");
      setReorder("");
      setProblem(null);
      setCategory(categories[0] ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep a valid selection as the roster refreshes in place.
  React.useEffect(() => {
    if (category && categories.some((c) => c === category)) {return;}
    setCategory(categories[0] ?? "");
  }, [categories, category]);

  const submit = async (): Promise<void> => {
    const qty = Number(stock);
    const level = reorder.trim() === "" ? null : Number(reorder);
    if (!name.trim()) { setProblem("Item name is required."); return; }
    if (!unit.trim()) { setProblem("Unit is required."); return; }
    if (stock.trim() === "" || !Number.isFinite(qty) || qty < 0) { setProblem("Enter a valid quantity."); return; }
    if (level !== null && !(Number.isFinite(level) && level > 0)) { setProblem("Enter a number greater than 0, or leave it blank."); return; }
    setProblem(null);
    setBusy(true);
    try {
      await createInventoryItem(restaurantId, {
        name: name.trim(),
        category: category.trim(),
        stock: qty,
        unit: unit.trim(),
        reorder_level: level,
      });
      onAdded();
    } catch (e) {
      onError(msgOf(e, "Couldn't add the item."));
    } finally {
      setBusy(false);
    }
  };

  const unitLabel = unit.trim();

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <Eyebrow>Inventory</Eyebrow>
            <DialogTitle>Add inventory item</DialogTitle>
          </DialogHeader>
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <div className="grid gap-1">
              <Label htmlFor="inv-add-name">Name</Label>
              <Input id="inv-add-name" value={name} onChange={(e) => { setName(e.target.value); }} autoFocus />
            </div>
            <div className="grid gap-1">
              <Label>Category</Label>
              <div className="flex items-center gap-2">
                {categories.length === 0 ? (
                  <p className="flex-1 text-sm text-muted-foreground">No categories yet — add one via the tune icon.</p>
                ) : (
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                <Button type="button" variant="outline" size="icon" aria-label="Manage categories" title="Manage categories" onClick={() => { setManageOpen(true); }}>
                  <SlidersHorizontal className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="inv-add-stock">Stock</Label>
              <Input id="inv-add-stock" type="number" min="0" step="any" value={stock} onChange={(e) => { setStock(e.target.value); }} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="inv-add-unit">Unit (e.g. kg)</Label>
              <Input id="inv-add-unit" value={unit} onChange={(e) => { setUnit(e.target.value); }} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="inv-add-reorder">Reorder at{unitLabel ? ` (${unitLabel})` : ""}</Label>
              <Input id="inv-add-reorder" type="number" min="0" step="any" value={reorder} onChange={(e) => { setReorder(e.target.value); }} />
              <p className="text-xs text-muted-foreground">Blank = sensible default for this unit</p>
            </div>
            {problem && <p className="text-sm text-destructive">{problem}</p>}
            <DialogFooter className="mt-1">
              <Button type="button" variant="outline" onClick={() => { onOpenChange(false); }}>Cancel</Button>
              <Button type="submit" disabled={busy}>
                <Plus className="mr-1 h-4 w-4" /> Add
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <CategoriesDialog
        open={manageOpen}
        restaurantId={restaurantId}
        categories={roster}
        isAdmin={isAdmin}
        onClose={(changed) => {
          setManageOpen(false);
          if (changed) {onCategoriesChanged();}
        }}
      />
    </>
  );
}
