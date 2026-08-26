
"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { MoreHorizontal, PlusCircle, Trash2, PackagePlus, Trash, Truck, ChefHat, LineChart, CalendarClock, Tags, Pencil, X, Gauge } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type {
  Vendor,
  StockMovement,
  PricePoint} from "@/lib/db";
import {
  getInventory,
  addInventoryItem,
  removeInventoryItem,
  getVendors,
  addVendor,
  deleteVendor,
  receiveStock,
  recordWastage,
  issueStock,
  setInventoryExpiry,
  getPriceHistory,
  getStockMovements,
  getInventoryCategories,
  saveInventoryCategories,
  renameInventoryCategory,
  setInventoryReorderLevel
} from "@/lib/db";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { formatDate, formatDateTime, formatFullDateTime } from "@/lib/tz";
import { useTimezone } from "@/lib/use-timezone";
import { useHighlightRow } from "@/hooks/use-highlight-row";

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  stock: number;
  unit: string;
  /**
   * DECIDED BY THE SERVER, rendered verbatim here.
   *
   * This page used to hold its own copy of the rule (`stock < 10` -> "Low
   * Stock"), which is how two unit-blind copies of one rule came to disagree:
   * the server called anything under 10 low, the Overview feed called anything
   * under 5 low, and neither looked at the unit at all — so 5000 mg of potato
   * (five grams) read "In Stock" while 5 kg of it read "Low Stock". The rule now
   * lives in exactly one place (the backend's inventory_units module, which the
   * inventory list, the concerns feed, its notification and the Supply KPI all
   * call) and this client renders what it is told.
   */
  status: "In Stock" | "Low Stock" | "Out of Stock";
  expiry_date?: string | null; // "YYYY-MM-DD" when set
  /** Reorder level the owner set, in `reorder_unit`; null = none set. */
  reorder_level?: number | null;
  reorder_unit?: string | null;
  /** The threshold `status` was actually decided against, in the item's unit. */
  reorder_applied?: number | null;
  /** Where that threshold came from — used to word the hint under the level. */
  reorder_basis?: "item" | "dimension-default" | "legacy" | null;
}

const inventorySchema = z.object({
  name: z.string().min(1, "Item name is required."),
  category: z.string().min(1, "Category is required."),
  stock: z.coerce.number().min(0, "Stock cannot be negative."),
  unit: z.string().min(1, "Unit is required."),
  // Optional: blank means "use the sensible default for this kind of unit".
  reorder_level: z.union([z.coerce.number().positive("Reorder level must be greater than 0."), z.literal("")]).optional(),
});

type InventoryFormData = z.infer<typeof inventorySchema>;

// Quantities print whole when whole and to 2dp otherwise. Module-scoped
// because the reorder dialog needs it too: interpolating a raw default there
// showed a dozen item "0.416666666667 dozen" (1 dozen expressed in the base
// unit `each`), which reads as a bug even though the badge was correct.
const fmtQty = (n: number) => (Number.isInteger(n) ? `${n}` : n.toFixed(2));

function InventoryPageInner() {
  const { timezone } = useTimezone();
  const { user } = useAuth();
  const { toast } = useToast();
  const restaurantId = user?.restaurantUsername ?? "";
  const isAdmin = !!user && (user.role === "admin" || (Array.isArray(user.role_all) && user.role_all.includes("admin")));

  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  // A low-stock notification links here as ?highlightInventory=<barcode>, which
  // is exactly InventoryItem.id — ring and scroll to that item.
  const highlight = useHighlightRow("highlightInventory", inventory.length);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [vendorsOpen, setVendorsOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [action, setAction] = useState<{ item: InventoryItem; mode: "receive" | "wastage" | "issue" } | null>(null);
  const [historyItem, setHistoryItem] = useState<InventoryItem | null>(null);
  const [expiryItem, setExpiryItem] = useState<InventoryItem | null>(null);
  const [reorderItem, setReorderItem] = useState<InventoryItem | null>(null);

  const refresh = useCallback(async () => {
    if (!restaurantId) {return;}
    const [inv, ven, mov, cats] = await Promise.all([
      getInventory(restaurantId),
      getVendors(restaurantId).catch(() => [] as Vendor[]),
      getStockMovements(restaurantId).catch(() => [] as StockMovement[]),
      getInventoryCategories(restaurantId).catch(() => [] as string[]),
    ]);
    setInventory(inv);
    setVendors(ven);
    setMovements(mov);
    setCategories(cats);
  }, [restaurantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleAddItem = async (data: InventoryFormData) => {
    if (!restaurantId) {return;}
    // No status is computed here any more, and none is sent. The server owns the
    // rule; `refresh()` reads back the badge it decided. (The id this used to
    // invent — `inventory.length + 1` — was never the barcode the server stores
    // either, so it is gone with it.)
    await addInventoryItem(restaurantId, {
      name: data.name,
      category: data.category,
      stock: data.stock,
      unit: data.unit,
      reorder_level: data.reorder_level === "" || data.reorder_level === undefined ? null : Number(data.reorder_level),
    });
    await refresh();
    setIsDialogOpen(false);
  };

  const handleRemoveItem = async (itemId: string) => {
    if (!restaurantId) {return;}
    await removeInventoryItem(restaurantId, itemId);
    await refresh();
  };

  const getStatusVariant = (status: string) => {
    switch (status) {
      case "In Stock":
        return "default";
      case "Low Stock":
        return "secondary";
      case "Out of Stock":
        return "destructive";
      default:
        return "outline";
    }
  };


  // What the badge was decided against, in the item's own unit — so "Low Stock"
  // on 50 g is explicable rather than mysterious. Says nothing when the server
  // could not classify the unit (older payloads, or a unit like "handful"),
  // because there is no meaningful level to quote in that case.
  const reorderHint = (item: InventoryItem): string | null => {
    if (item.reorder_applied == null || item.reorder_basis === "legacy") {return null;}
    const own = item.reorder_basis === "item";
    return `${own ? "Reorder at" : "Default reorder"} ${fmtQty(item.reorder_applied)} ${item.unit}`;
  };

  // Days until expiry (negative = already expired); null when no expiry set.
  const daysToExpiry = (item: InventoryItem): number | null => {
    if (!item.expiry_date) {return null;}
    const d = new Date(`${item.expiry_date}T00:00:00`);
    if (Number.isNaN(d.getTime())) {return null;}
    return Math.floor((d.getTime() - Date.now()) / 86_400_000);
  };

  return (
    <div className="grid gap-4 md:gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl">Inventory</h1>
        <div className="flex gap-2">
          {isAdmin && (
            <Button variant="outline" onClick={() => { setCategoriesOpen(true); }}>
              <Tags className="mr-2 h-4 w-4" /> Categories
            </Button>
          )}
          <Button variant="outline" onClick={() => { setVendorsOpen(true); }}>
            <Truck className="mr-2 h-4 w-4" /> Vendors
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <PlusCircle className="mr-2 h-4 w-4" />
                Add Item
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Add New Inventory Item</DialogTitle>
                <DialogDescription>Fill in the details to add a new item to the inventory.</DialogDescription>
              </DialogHeader>
              <InventoryForm categories={categories} inventory={inventory} onSubmit={handleAddItem} afterSubmit={() => { setIsDialogOpen(false); }} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Inventory List</CardTitle>
          <CardDescription>A list of all items in your restaurant&apos;s inventory.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item Name</TableHead>
                <TableHead className="hidden md:table-cell">Category</TableHead>
                <TableHead className="hidden md:table-cell text-center">Stock</TableHead>
                <TableHead className="hidden md:table-cell">Expiry</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inventory.map((item) => {
                const days = daysToExpiry(item);
                return (
                <TableRow key={item.id} {...highlight.rowProps(item.id)}>
                  <TableCell className="font-medium">
                    <div>{item.name}</div>
                    <div className="text-sm text-muted-foreground md:hidden">{item.category}</div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{item.category}</TableCell>
                  <TableCell className="hidden md:table-cell text-center">
                    <div>{fmtQty(item.stock)} {item.unit}</div>
                    {reorderHint(item) && (
                      <div className="text-xs text-muted-foreground">{reorderHint(item)}</div>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {item.expiry_date ? (
                      days != null && days <= 7 ? (
                        <Badge variant="destructive">{days < 0 ? "Expired" : days === 0 ? "Expires today" : `${days}d left`}</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">{item.expiry_date}</span>
                      )
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={getStatusVariant(item.status)}>{item.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button aria-haspopup="true" size="icon" variant="ghost">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Toggle menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => { setAction({ item, mode: "receive" }); }}>
                          <PackagePlus className="mr-2 h-4 w-4" />
                          Receive stock
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setAction({ item, mode: "issue" }); }}>
                          <ChefHat className="mr-2 h-4 w-4" />
                          Issue to kitchen
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setAction({ item, mode: "wastage" }); }}>
                          <Trash className="mr-2 h-4 w-4" />
                          Record wastage
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => { setHistoryItem(item); }}>
                          <LineChart className="mr-2 h-4 w-4" />
                          Price history
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setExpiryItem(item); }}>
                          <CalendarClock className="mr-2 h-4 w-4" />
                          Set expiry
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setReorderItem(item); }}>
                          <Gauge className="mr-2 h-4 w-4" />
                          Set reorder level
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleRemoveItem(item.id)} className="text-destructive">
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
                );
              })}
              {inventory.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">No inventory items yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Stock movements ledger */}
      <Card>
        <CardHeader>
          <CardTitle>Stock movements</CardTitle>
          <CardDescription>Recent receipts and wastage (last 30 days).</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No movements recorded.</TableCell>
                </TableRow>
              ) : (
                movements.map((mv) => {
                  const vendor = vendors.find((v) => v.id === mv.vendor_id);
                  const detail = [mv.reason, vendor ? `from ${vendor.name}` : null, mv.unit_cost ? `@ ₹${mv.unit_cost}` : null]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <TableRow key={mv.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap" title={formatFullDateTime(mv.created_at, timezone)}>{formatDateTime(mv.created_at, timezone)}</TableCell>
                      <TableCell>{mv.item_name ?? mv.inventory_id}</TableCell>
                      <TableCell className="capitalize">{mv.kind}</TableCell>
                      <TableCell className={`text-right font-medium ${mv.delta < 0 ? "text-destructive" : "text-green-600"}`}>
                        {mv.delta > 0 ? "+" : ""}{fmtQty(mv.delta)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{detail || "—"}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {action && (
        <StockActionDialog
          restaurantId={restaurantId}
          item={action.item}
          mode={action.mode}
          vendors={vendors}
          onClose={() => { setAction(null); }}
          onDone={async () => {
            setAction(null);
            await refresh();
            toast({ title: action.mode === "receive" ? "Stock received" : action.mode === "issue" ? "Issued to kitchen" : "Wastage recorded" });
          }}
          onError={(msg) => toast({ title: "Error", description: msg, variant: "destructive" })}
        />
      )}

      {historyItem && (
        <PriceHistoryDialog
          restaurantId={restaurantId}
          item={historyItem}
          onClose={() => { setHistoryItem(null); }}
        />
      )}

      {reorderItem && (
        <ReorderLevelDialog
          restaurantId={restaurantId}
          item={reorderItem}
          onClose={() => { setReorderItem(null); }}
          onDone={async () => {
            setReorderItem(null);
            await refresh();
            toast({ title: "Reorder level updated" });
          }}
          onError={(msg) => toast({ title: "Error", description: msg, variant: "destructive" })}
        />
      )}

      {expiryItem && (
        <ExpiryDialog
          restaurantId={restaurantId}
          item={expiryItem}
          onClose={() => { setExpiryItem(null); }}
          onDone={async () => {
            setExpiryItem(null);
            await refresh();
            toast({ title: "Expiry updated" });
          }}
          onError={(msg) => toast({ title: "Error", description: msg, variant: "destructive" })}
        />
      )}

      <VendorsDialog
        open={vendorsOpen}
        onOpenChange={setVendorsOpen}
        restaurantId={restaurantId}
        vendors={vendors}
        onChanged={refresh}
        onError={(msg) => toast({ title: "Error", description: msg, variant: "destructive" })}
      />

      <CategoriesDialog
        open={categoriesOpen}
        onOpenChange={setCategoriesOpen}
        restaurantId={restaurantId}
        categories={categories}
        inventory={inventory}
        onChanged={refresh}
        onNotice={(msg) => toast({ title: msg })}
        onError={(msg) => toast({ title: "Error", description: msg, variant: "destructive" })}
      />
    </div>
  );
}

function StockActionDialog({
  restaurantId,
  item,
  mode,
  vendors,
  onClose,
  onDone,
  onError,
}: {
  restaurantId: string;
  item: InventoryItem;
  mode: "receive" | "wastage" | "issue";
  vendors: Vendor[];
  onClose: () => void;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [qty, setQty] = useState("");
  const [vendorId, setVendorId] = useState<string>("");
  const [unitCost, setUnitCost] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const titles = { receive: "Receive stock", wastage: "Record wastage", issue: "Issue to kitchen" } as const;
  const descriptions = {
    receive: "Add received quantity to stock.",
    wastage: "Remove wasted/spoiled quantity from stock.",
    issue: "Move quantity from the store to the kitchen (counts toward food cost).",
  } as const;

  const submit = async () => {
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) {
      onError("Enter a positive quantity.");
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
      } else if (mode === "issue") {
        await issueStock(restaurantId, { inventory_id: item.id, qty: q, note: reason || undefined });
      } else {
        await recordWastage(restaurantId, { inventory_id: item.id, qty: q, reason: reason || undefined });
      }
      onDone();
    } catch (e: any) {
      onError(e?.message ?? "Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) {onClose();} }}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{titles[mode]} — {item.name}</DialogTitle>
          <DialogDescription>{descriptions[mode]}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1">
            <Label htmlFor="qty">Quantity ({item.unit})</Label>
            <Input id="qty" type="number" min="0" step="any" value={qty} onChange={(e) => { setQty(e.target.value); }} autoFocus />
          </div>
          {mode === "receive" ? (
            <>
              <div className="grid gap-1">
                <Label>Vendor (optional)</Label>
                <Select value={vendorId} onValueChange={setVendorId}>
                  <SelectTrigger><SelectValue placeholder="No vendor" /></SelectTrigger>
                  <SelectContent>
                    {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="cost">Unit cost (optional)</Label>
                <Input id="cost" type="number" min="0" step="any" value={unitCost} onChange={(e) => { setUnitCost(e.target.value); }} placeholder="₹ per unit" />
              </div>
            </>
          ) : (
            <div className="grid gap-1">
              <Label htmlFor="reason">{mode === "issue" ? "Note (optional)" : "Reason (optional)"}</Label>
              <Input id="reason" value={reason} onChange={(e) => { setReason(e.target.value); }} placeholder={mode === "issue" ? "e.g., dinner prep" : "e.g., spoiled, breakage"} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy}>{mode === "receive" ? "Receive" : mode === "issue" ? "Issue" : "Record"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Vendor price history for one ingredient — every costed purchase in the ledger.
function PriceHistoryDialog({
  restaurantId,
  item,
  onClose,
}: {
  restaurantId: string;
  item: InventoryItem;
  onClose: () => void;
}) {
  const { timezone } = useTimezone();
  const [points, setPoints] = useState<PricePoint[] | null>(null);

  useEffect(() => {
    let alive = true;
    getPriceHistory(restaurantId, item.id)
      .then((p) => { if (alive) {setPoints(p);} })
      .catch(() => { if (alive) {setPoints([]);} });
    return () => { alive = false; };
  }, [restaurantId, item.id]);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) {onClose();} }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Price history — {item.name}</DialogTitle>
          <DialogDescription>Unit cost of every recorded purchase, oldest first.</DialogDescription>
        </DialogHeader>
        {points === null ? (
          <p className="py-4 text-sm text-muted-foreground">Loading…</p>
        ) : points.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No costed purchases recorded yet. Receive stock with a unit cost to build history.</p>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {points.map((p, i) => {
                  const prev = i > 0 ? points[i - 1].unit_cost : null;
                  const changed = prev != null && prev !== p.unit_cost;
                  return (
                    <TableRow key={`${p.date}-${i}`}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(p.date, timezone)}</TableCell>
                      <TableCell>{p.vendor ?? "—"}</TableCell>
                      <TableCell className="text-right">{p.qty}</TableCell>
                      <TableCell className={`text-right font-medium ${changed ? (p.unit_cost > (prev ?? 0) ? "text-destructive" : "text-green-600") : ""}`}>
                        ₹{p.unit_cost}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Set or clear an item's expiry date (drives expiring-soon alerts).
function ExpiryDialog({
  restaurantId,
  item,
  onClose,
  onDone,
  onError,
}: {
  restaurantId: string;
  item: InventoryItem;
  onClose: () => void;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [date, setDate] = useState(item.expiry_date ?? "");
  const [busy, setBusy] = useState(false);

  const save = async (value: string | null) => {
    setBusy(true);
    try {
      await setInventoryExpiry(restaurantId, item.id, value);
      onDone();
    } catch (e: any) {
      onError(e?.message ?? "Unable to set expiry");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) {onClose();} }}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Set expiry — {item.name}</DialogTitle>
          <DialogDescription>Items expiring within 7 days appear in the dashboard stock alerts.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1 py-2">
          <Label htmlFor="expiry">Expiry date</Label>
          <Input id="expiry" type="date" value={date} onChange={(e) => { setDate(e.target.value); }} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {item.expiry_date && (
            <Button variant="outline" onClick={() => void save(null)} disabled={busy}>Clear</Button>
          )}
          <Button onClick={() => void save(date || null)} disabled={busy || !date}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VendorsDialog({
  open,
  onOpenChange,
  restaurantId,
  vendors,
  onChanged,
  onError,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  restaurantId: string;
  vendors: Vendor[];
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!name.trim()) {return;}
    setBusy(true);
    try {
      await addVendor(restaurantId, { name: name.trim(), phone: phone.trim() || undefined });
      setName("");
      setPhone("");
      await onChanged();
    } catch (e: any) {
      onError(e?.message ?? "Unable to add vendor");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteVendor(restaurantId, id);
      await onChanged();
    } catch (e: any) {
      onError(e?.message ?? "Unable to delete vendor");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Vendors</DialogTitle>
          <DialogDescription>Suppliers you receive stock from.</DialogDescription>
        </DialogHeader>
        <div className="flex items-end gap-2">
          <div className="grid flex-1 gap-1">
            <Label htmlFor="v-name">Name</Label>
            <Input id="v-name" value={name} onChange={(e) => { setName(e.target.value); }} placeholder="Vendor name" />
          </div>
          <div className="grid w-[140px] gap-1">
            <Label htmlFor="v-phone">Phone</Label>
            <Input id="v-phone" value={phone} onChange={(e) => { setPhone(e.target.value); }} placeholder="optional" />
          </div>
          <Button onClick={() => void add()} disabled={busy || !name.trim()}>Add</Button>
        </div>
        <div className="mt-2 max-h-[40vh] space-y-2 overflow-y-auto">
          {vendors.length === 0 ? (
            <p className="text-sm text-muted-foreground">No vendors yet.</p>
          ) : (
            vendors.map((v) => (
              <div key={v.id} className="flex items-center justify-between rounded-md border p-2">
                <div>
                  <p className="font-medium">{v.name}</p>
                  {v.phone ? <p className="text-xs text-muted-foreground">{v.phone}</p> : null}
                </div>
                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => void remove(v.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Manage the restaurant's inventory categories (the picker list on the add-item
// form). Mirrors the menu page's kitchen-sections manager: add appends, rename
// cascades onto items via the backend, delete drops it from the managed list
// (items keep their old label). Admin-gated by the backend (403 -> toast).
function CategoriesDialog({
  open,
  onOpenChange,
  restaurantId,
  categories,
  inventory,
  onChanged,
  onNotice,
  onError,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  restaurantId: string;
  categories: string[];
  inventory: InventoryItem[];
  onChanged: () => Promise<void>;
  onNotice: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const countFor = (cat: string) => inventory.filter((it) => (it.category ?? "").toLowerCase() === cat.toLowerCase()).length;

  const add = async () => {
    const next = name.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!next) {return;}
    if (categories.some((c) => c.toLowerCase() === next.toLowerCase())) {
      setName("");
      return;
    }
    setBusy(true);
    try {
      await saveInventoryCategories(restaurantId, [...categories, next]);
      setName("");
      await onChanged();
    } catch (e: any) {
      onError(e?.message ?? "Unable to add category.");
    } finally {
      setBusy(false);
    }
  };

  const rename = async (from: string) => {
    const to = window.prompt(`Rename category "${from}" to:`, from)?.trim().replace(/\s+/g, " ").slice(0, 40) ?? "";
    if (!to || to.toLowerCase() === from.toLowerCase()) {return;}
    setBusy(true);
    try {
      const result = await renameInventoryCategory(restaurantId, from, to);
      await onChanged();
      const n = result.updated_items ?? 0;
      onNotice(`Renamed “${from}” to “${to}” (${n} item${n === 1 ? "" : "s"} updated).`);
    } catch (e: any) {
      onError(e?.message ?? "Unable to rename category.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (cat: string) => {
    const count = countFor(cat);
    if (!window.confirm(
      count > 0
        ? `Remove category "${cat}"? ${count} item${count === 1 ? "" : "s"} keep the label but it will no longer be in the picker.`
        : `Remove category "${cat}"?`,
    )) {return;}
    setBusy(true);
    try {
      await saveInventoryCategories(restaurantId, categories.filter((c) => c.toLowerCase() !== cat.toLowerCase()));
      await onChanged();
    } catch (e: any) {
      onError(e?.message ?? "Unable to remove category.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Inventory categories</DialogTitle>
          <DialogDescription>
            The category options on the add-item form. Renaming a category cascades to every item using it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {categories.length === 0 && (
            <p className="text-sm text-muted-foreground">No categories yet — add e.g. Vegetable, Meat, Dairy.</p>
          )}
          {categories.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-full border bg-background px-3 py-1 text-sm">
              {c}
              <button
                type="button"
                className="ml-1 rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
                title={`Rename ${c} (updates all its items)`}
                aria-label={`Rename category ${c}`}
                disabled={busy}
                onClick={() => void rename(c)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="rounded p-0.5 text-muted-foreground hover:text-destructive disabled:opacity-50"
                title={`Remove ${c}`}
                aria-label={`Remove category ${c}`}
                disabled={busy}
                onClick={() => void remove(c)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Input
            placeholder="New category (e.g. Spices)"
            value={name}
            maxLength={40}
            onChange={(e) => { setName(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={() => void add()} disabled={busy || !name.trim()}>
            <PlusCircle className="mr-2 h-4 w-4" /> Add
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Set (or clear) ONE item's reorder level, in that item's own unit.
 *
 * Separate from the add form on purpose: the add form posts `stock`, so reusing
 * it to change a threshold would write a stale quantity over any receive /
 * wastage / issue that happened while the dialog sat open. A threshold edit must
 * never move stock.
 */
function ReorderLevelDialog({
  restaurantId,
  item,
  onClose,
  onDone,
  onError,
}: {
  restaurantId: string;
  item: InventoryItem;
  onClose: () => void;
  onDone: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [value, setValue] = useState(item.reorder_level == null ? "" : String(item.reorder_level));
  const [busy, setBusy] = useState(false);

  const save = async (level: number | null) => {
    setBusy(true);
    try {
      await setInventoryReorderLevel(restaurantId, item.id, level);
      await onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Unable to set reorder level");
    } finally {
      setBusy(false);
    }
  };

  const parsed = value.trim() === "" ? null : Number(value);
  const invalid = parsed !== null && !(Number.isFinite(parsed) && parsed > 0);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) {onClose();} }}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Reorder level — {item.name}</DialogTitle>
          <DialogDescription>
            Mark this item Low Stock once it falls to this level or below. Entered in
            the item&apos;s own unit ({item.unit}).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <Label htmlFor="reorder-level">Reorder at or below ({item.unit})</Label>
          <Input
            id="reorder-level"
            type="number"
            step="any"
            min="0"
            value={value}
            onChange={(e) => { setValue(e.target.value); }}
            placeholder={item.reorder_applied == null ? "" : `default: ${fmtQty(item.reorder_applied)}`}
          />
          {invalid && <p className="text-sm text-destructive">Enter a number greater than 0, or clear the field.</p>}
          <p className="text-xs text-muted-foreground">
            Leave blank to use the default for {item.unit}
            {item.reorder_basis !== "legacy" && item.reorder_applied != null ? ` (${fmtQty(item.reorder_applied)} ${item.unit})` : ""}.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => save(null)}>Use default</Button>
          <Button disabled={busy || invalid} onClick={() => save(parsed)}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InventoryForm({ categories, inventory, onSubmit, afterSubmit }: { categories: string[]; inventory: InventoryItem[]; onSubmit: (data: InventoryFormData) => void; afterSubmit: () => void; }) {
  const { register, handleSubmit, control, watch, formState: { errors } } = useForm<InventoryFormData>({
    resolver: zodResolver(inventorySchema),
  });
  // The reorder level is meaningless without the unit it is counted in, so the
  // field is labelled with whatever the unit box currently says.
  const unitLabel = (watch("unit") ?? "").trim();

  // Managed categories first, then any legacy category present on existing
  // items but no longer in the managed list, so those stay selectable.
  const options = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of [...categories, ...inventory.map((it) => it.category)]) {
      const name = (c ?? "").trim();
      if (!name) {continue;}
      const key = name.toLowerCase();
      if (seen.has(key)) {continue;}
      seen.add(key);
      out.push(name);
    }
    return out;
  }, [categories, inventory]);

  const handleFormSubmit = (data: InventoryFormData) => {
    onSubmit(data);
    afterSubmit();
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="grid gap-4 py-4">
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="name" className="text-right">Item Name</Label>
        <div className="col-span-3">
          <Input id="name" {...register("name")} placeholder="e.g., Tomatoes" />
          {errors.name && <p className="text-sm text-destructive mt-1">{errors.name.message}</p>}
        </div>
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="category" className="text-right">Category</Label>
        <div className="col-span-3">
          <Controller
            name="category"
            control={control}
            render={({ field }) => (
              <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {options.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">No categories — add one via “Categories”.</div>
                  ) : (
                    options.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            )}
          />
          {errors.category && <p className="text-sm text-destructive mt-1">{errors.category.message}</p>}
        </div>
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="stock" className="text-right">Stock</Label>
        <div className="col-span-3">
          <Input id="stock" type="number" {...register("stock")} placeholder="e.g., 50" />
          {errors.stock && <p className="text-sm text-destructive mt-1">{errors.stock.message}</p>}
        </div>
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="unit" className="text-right">Unit</Label>
        <div className="col-span-3">
          <Input id="unit" {...register("unit")} placeholder="e.g., kg" />
          {errors.unit && <p className="text-sm text-destructive mt-1">{errors.unit.message}</p>}
        </div>
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="reorder_level" className="text-right">
          Reorder at{unitLabel ? ` (${unitLabel})` : ""}
        </Label>
        <div className="col-span-3">
          <Input id="reorder_level" type="number" step="any" min="0" {...register("reorder_level")} placeholder={unitLabel ? `e.g., 5 ${unitLabel}` : "optional"} />
          {errors.reorder_level && <p className="text-sm text-destructive mt-1">{errors.reorder_level.message}</p>}
          <p className="text-xs text-muted-foreground mt-1">
            Optional. Below this{unitLabel ? ` many ${unitLabel}` : ""} the item is flagged Low Stock.
            Leave blank for a sensible default based on the unit.
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button type="submit">Save Item</Button>
      </DialogFooter>
    </form>
  );
}

// useSearchParams (via useHighlightRow) requires a Suspense boundary
// (same pattern as the accounting and queue pages).
export default function InventoryPage() {
  return (
    <Suspense fallback={<div className="py-10 text-center text-muted-foreground">Loading…</div>}>
      <InventoryPageInner />
    </Suspense>
  );
}
