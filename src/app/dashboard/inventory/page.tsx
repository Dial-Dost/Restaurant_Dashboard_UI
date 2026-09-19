"use client";

// Inventory — the web copy of Flutter `inventoryModule` (modules.dart): a
// three-tile summary band, stock grouped into category sections, clickable
// row cards into the item mini-overview, and the stock / reorder / vendor /
// category dialogs. Audit: docs/parity/inventory.md.

import { Suspense, useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Package, Plus, Tags, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat-card";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusChip } from "@/components/ui/status-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { SkeletonBox, SkeletonRows } from "@/components/ui/fork-skeleton";
import { CacheStalePill } from "@/components/ui/stale-pill";
import { useConfirm } from "@/components/menu/confirm-dialog";
import { useCachedFetch } from "@/hooks/use-cached-fetch";
import { useVisibleNav } from "@/hooks/use-nav";
import { useHighlightRow } from "@/hooks/use-highlight-row";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { removeInventoryItem } from "@/lib/db";
import { fetchInventoryBoard, type InventoryBoard } from "@/lib/api/inventory";
import { StockRowCard } from "@/components/inventory/stock-row-card";
import {
  BreakdownSheet,
  ItemSheet,
  ListSheet,
  type ItemAction,
  type ListSheetSpec,
} from "@/components/inventory/inventory-sheets";
import {
  AddItemDialog,
  CategoriesDialog,
  ExpiryDialog,
  ReorderLevelDialog,
  StockActionDialog,
  VendorsSheet,
  type StockMode,
} from "@/components/inventory/inventory-dialogs";
import { TapRow, groupByCategory, stockTone, type StockSection } from "@/components/inventory/inventory-shared";

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  stock: number;
  unit: string;
  /**
   * DECIDED BY THE SERVER, rendered verbatim here. The In/Low/Out rule
   * (quantity + unit + reorder level) lives only in the backend's
   * inventory_units module; this client holds no copy of it.
   */
  status: "In Stock" | "Low Stock" | "Out of Stock";
  expiry_date?: string | null; // "YYYY-MM-DD" when set
  /** Reorder level the owner set, in `reorder_unit`; null = none set. */
  reorder_level?: number | null;
  reorder_unit?: string | null;
  /** The threshold `status` was actually decided against, in the item's unit. */
  reorder_applied?: number | null;
  /** Where that threshold came from — words the sheet's "Reorder at" row. */
  reorder_basis?: "item" | "dimension-default" | "legacy" | null;
}

type Pending =
  | { kind: "stock"; item: InventoryItem; mode: StockMode }
  | { kind: "reorder"; item: InventoryItem }
  | { kind: "expiry"; item: InventoryItem }
  | null;

function InventoryPageInner(): React.JSX.Element {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const { labels } = useVisibleNav();
  const restaurantId = user?.restaurantUsername ?? "";
  const isAdmin = !!user && (user.role === "admin" || (Array.isArray(user.role_all) && user.role_all.includes("admin")));

  const fetcher = useCallback(() => fetchInventoryBoard(restaurantId), [restaurantId]);
  const board = useCachedFetch<InventoryBoard>(`inventory:${restaurantId}`, fetcher, { enabled: !!restaurantId });
  const items = useMemo(() => board.data?.items ?? [], [board.data]);
  const roster = useMemo(() => board.data?.categories ?? [], [board.data]);

  const highlight = useHighlightRow("highlightInventory", items.length);
  const { confirm, confirmDialog } = useConfirm();

  const sections = useMemo(() => groupByCategory(items, roster), [items, roster]);
  const low = useMemo(() => items.filter((i) => stockTone(i.status) === "warning"), [items]);
  const out = useMemo(() => items.filter((i) => stockTone(i.status) === "danger"), [items]);
  // Picker options: managed roster first, then legacy labels still on items
  // (web keeps these selectable — audit 27, flagged).
  const pickerOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: string[] = [];
    for (const c of [...roster, ...items.map((i) => i.category)]) {
      const name = c.trim();
      if (!name || seen.has(name.toLowerCase())) {continue;}
      seen.add(name.toLowerCase());
      opts.push(name);
    }
    return opts;
  }, [roster, items]);

  const [sheetItem, setSheetItem] = useState<InventoryItem | null>(null);
  const [listSheet, setListSheet] = useState<ListSheetSpec | null>(null);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [vendorsOpen, setVendorsOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  const poReachable = labels.includes("Purchase Orders");
  const jump = poReachable ? () => { router.push("/dashboard/purchase-orders"); } : null;

  const fail = (msg: string): void => { toast({ title: msg, variant: "destructive" }); };
  const done = (msg: string): void => {
    setPending(null);
    board.refresh();
    toast({ title: msg });
  };

  const openSection = (s: StockSection): void => {
    setListSheet({
      eyebrow: "Stock section",
      title: s.label,
      items: s.items,
      lead: { items: s.items.length, short: s.short },
      jump: s.short > 0,
    });
  };

  const onItemAction = async (item: InventoryItem, action: ItemAction): Promise<void> => {
    switch (action) {
      case "receive":
      case "wastage":
      case "issue":
        setPending({ kind: "stock", item, mode: action });
        return;
      case "reorder":
        setPending({ kind: "reorder", item });
        return;
      case "expiry":
        setPending({ kind: "expiry", item });
        return;
      case "delete": {
        const ok = await confirm({
          title: "Delete item",
          body: `Delete "${item.name}" from inventory? This cannot be undone.`,
          confirmLabel: "Delete",
        });
        if (!ok) {return;}
        try {
          await removeInventoryItem(restaurantId, item.id);
          board.refresh();
          toast({ title: "Item deleted." });
        } catch (e) {
          fail(e instanceof Error ? e.message : "Couldn't delete the item.");
        }
      }
    }
  };

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-lg font-semibold md:text-2xl">Inventory</h1>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => { setCategoriesOpen(true); }}>
          <Tags className="mr-1.5 h-4 w-4" /> Categories
        </Button>
        <Button variant="outline" size="sm" onClick={() => { setVendorsOpen(true); }}>
          <Truck className="mr-1.5 h-4 w-4" /> Vendors
        </Button>
      </div>
    </div>
  );

  let body: React.ReactNode;
  if (board.loading) {
    body = (
      <div className="grid gap-4">
        <SkeletonBox height={28} width={220} />
        <SkeletonRows rows={6} />
      </div>
    );
  } else if (board.error) {
    body = <LoadErrorState whatFailed="Couldn't load inventory." error={board.error} onRetry={board.retry} />;
  } else if (items.length === 0 && roster.length === 0) {
    body = (
      <EmptyState
        icon={<Package />}
        title="No inventory yet"
        caption="Add your first stock item to start tracking levels."
      />
    );
  } else {
    body = (
      <div className="grid gap-6">
        <div className="grid grid-cols-1 gap-3.5 min-[760px]:grid-cols-3">
          <StatCard value={items.length} caption="ITEMS TRACKED" onClick={() => { setBreakdownOpen(true); }} />
          <StatCard
            value={low.length}
            caption="LOW STOCK"
            tag={low.length > 0 ? "Lo" : undefined}
            tagColor="hsl(var(--warning))"
            onClick={
              low.length > 0
                ? () => { setListSheet({ eyebrow: "Inventory", title: "Low stock", items: low, jump: true }); }
                : undefined
            }
          />
          <StatCard
            value={out.length}
            caption="OUT OF STOCK"
            tag={out.length > 0 ? "Out" : undefined}
            tagColor="hsl(var(--destructive))"
            onClick={
              out.length > 0
                ? () => { setListSheet({ eyebrow: "Inventory", title: "Out of stock", items: out, jump: true }); }
                : undefined
            }
          />
        </div>

        <div>
          <SectionHeader
            title="Stock levels"
            count={items.length}
            trailing={
              <span className="text-xs text-muted-foreground">
                {sections.length} section{sections.length === 1 ? "" : "s"}
              </span>
            }
            className="mb-1"
          />
          <p className="mb-5 text-xs text-muted-foreground">
            Grouped by category — manage the list with Categories above.
          </p>

          <div className="grid gap-6">
            {sections.map((s) => {
              const heading = (
                <SectionHeader
                  title={s.label}
                  count={s.items.length}
                  className="mb-0 w-full"
                  trailing={
                    s.short > 0 ? (
                      <StatusChip status="warning" dense label={`${s.short} need${s.short === 1 ? "s" : ""} restocking`} />
                    ) : undefined
                  }
                />
              );
              return (
                <section key={s.label}>
                  <div className="mb-2.5">
                    {s.items.length > 0 ? (
                      <TapRow onClick={() => { openSection(s); }} className="flex w-[calc(100%+1rem)] py-1.5 text-left">
                        {heading}
                      </TapRow>
                    ) : (
                      <div className="py-1.5">{heading}</div>
                    )}
                  </div>
                  {s.items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing in this section yet.</p>
                  ) : (
                    <div className="grid gap-2">
                      {s.items.map((it) => (
                        <StockRowCard
                          key={it.id}
                          item={it}
                          highlight={highlight.rowProps(it.id)}
                          onOpen={() => { setSheetItem(it); }}
                          onReceive={() => { setPending({ kind: "stock", item: it, mode: "receive" }); }}
                          onWastage={() => { setPending({ kind: "stock", item: it, mode: "wastage" }); }}
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative grid gap-4 pb-20 md:gap-6">
      {header}
      {body}
      <CacheStalePill offline={board.offline} fromCache={board.fromCache} updatedAt={board.updatedAt} />

      {/* "Add item" — Flutter's extended FAB, bottom-right. */}
      <Button
        className="fixed bottom-6 right-6 z-40 h-12 rounded-full px-5 shadow-lg"
        onClick={() => { setAddOpen(true); }}
      >
        <Plus className="mr-1.5 h-4 w-4" /> Add item
      </Button>

      <BreakdownSheet
        open={breakdownOpen}
        total={items.length}
        sections={sections}
        onClose={() => { setBreakdownOpen(false); }}
        onOpenSection={openSection}
      />
      <ListSheet
        spec={listSheet}
        onClose={() => { setListSheet(null); }}
        onOpenItem={(it) => { setSheetItem(it); }}
        onJump={jump}
      />
      <ItemSheet
        restaurantId={restaurantId}
        item={sheetItem}
        onClose={() => { setSheetItem(null); }}
        onAction={(it, a) => { void onItemAction(it, a); }}
        onJump={jump}
      />

      {pending?.kind === "stock" && (
        <StockActionDialog
          restaurantId={restaurantId}
          item={pending.item}
          mode={pending.mode}
          onClose={() => { setPending(null); }}
          onDone={done}
          onError={fail}
        />
      )}
      {pending?.kind === "reorder" && (
        <ReorderLevelDialog
          restaurantId={restaurantId}
          item={pending.item}
          onClose={() => { setPending(null); }}
          onDone={done}
          onError={fail}
        />
      )}
      {pending?.kind === "expiry" && (
        <ExpiryDialog
          restaurantId={restaurantId}
          item={pending.item}
          onClose={() => { setPending(null); }}
          onDone={done}
          onError={fail}
        />
      )}

      <AddItemDialog
        open={addOpen}
        restaurantId={restaurantId}
        categories={pickerOptions}
        roster={roster}
        isAdmin={isAdmin}
        onOpenChange={setAddOpen}
        onAdded={() => {
          setAddOpen(false);
          board.refresh();
          toast({ title: "Item added." });
        }}
        onCategoriesChanged={board.refresh}
        onError={fail}
      />
      <VendorsSheet open={vendorsOpen} restaurantId={restaurantId} onOpenChange={setVendorsOpen} onError={fail} />
      <CategoriesDialog
        open={categoriesOpen}
        restaurantId={restaurantId}
        categories={roster}
        isAdmin={isAdmin}
        onClose={(changed) => {
          setCategoriesOpen(false);
          if (changed) {board.refresh();}
        }}
      />
      {confirmDialog}
    </div>
  );
}

// useSearchParams (via useHighlightRow) requires a Suspense boundary.
export default function InventoryPage(): React.JSX.Element {
  return (
    <Suspense fallback={<SkeletonRows rows={6} />}>
      <InventoryPageInner />
    </Suspense>
  );
}
