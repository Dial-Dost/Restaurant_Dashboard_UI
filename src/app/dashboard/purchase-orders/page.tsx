"use client";

import { useCallback, useMemo, useState } from "react";
import type { JSX } from "react";
import { useRouter } from "next/navigation";
import { Plus, Truck } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/fork-skeleton";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { SectionHeader } from "@/components/ui/section-header";
import { CacheStalePill } from "@/components/ui/stale-pill";
import { PoCard } from "@/components/purchase-orders/po-card";
import { PoDetailSheet } from "@/components/purchase-orders/po-detail-sheet";
import { NewPoDialog } from "@/components/purchase-orders/new-po-dialog";
import { ReceivePoDialog } from "@/components/purchase-orders/receive-po-dialog";
import { poMoney } from "@/components/purchase-orders/po-bits";
import { useCachedFetch } from "@/hooks/use-cached-fetch";
import { useCurrency } from "@/hooks/use-currency";
import { useToast } from "@/hooks/use-toast";
import { useVisibleNav } from "@/hooks/use-nav";
import { useAuth } from "@/context/AuthContext";
import { moduleByLabel } from "@/lib/nav-registry";
import {
  createPo,
  deletePo,
  fetchPurchaseOrdersModule,
  receivePo,
  setPoStatus,
  type NewPoLine,
  type PurchaseOrderRecord,
  type PurchaseOrdersPayload,
} from "@/lib/api/purchase-orders";

/**
 * Purchase Orders — the web copy of Flutter's `_PurchaseOrdersView`
 * (restaurant_owner_app/lib/screens/modules.dart 26671–27193): the list IS the
 * page (SectionHeader + one card per PO), every card opens the detail sheet,
 * creation lives behind the always-live "New PO" floating action, and
 * receiving is the "Receive stock" modal. Loading is cache-primed with the
 * shared skeleton / error / offline-stale states.
 */
export default function PurchaseOrdersPage(): JSX.Element {
  const { user } = useAuth();
  const { currencySymbol } = useCurrency();
  const { toast } = useToast();
  const { labels } = useVisibleNav();
  const router = useRouter();
  const rid = user?.restaurantUsername ?? "";

  const po = useCachedFetch<PurchaseOrdersPayload>(
    `purchase-orders:${rid}`,
    useCallback(() => fetchPurchaseOrdersModule(rid), [rid]),
    { enabled: rid.length > 0 },
  );
  const orders = useMemo(() => po.data?.orders ?? [], [po.data]);
  const vendors = po.data?.vendors ?? [];
  const inventory = po.data?.inventory ?? [];
  const inventoryError = po.data?.inventoryError ?? null;

  const money = useCallback(
    (v: number | null | undefined) => poMoney(currencySymbol, v),
    [currencySymbol],
  );

  const [detail, setDetail] = useState<PurchaseOrderRecord | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [guardOpen, setGuardOpen] = useState(false);
  const [receiving, setReceiving] = useState<PurchaseOrderRecord | null>(null);
  const [deleting, setDeleting] = useState<PurchaseOrderRecord | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // The "View in Inventory" jump — hidden outright when this session cannot
  // open that module (the Flutter sheet gates on ModuleNavigator.canOpen).
  const canOpenInventory = labels.includes("Inventory");
  const openInventory = useCallback(() => {
    router.push(moduleByLabel("Inventory")?.href ?? "/dashboard/inventory");
  }, [router]);

  /* ── Actions — failures surface the server's words; success is the list
        reloading (Flutter only snackbars on failure, except receive) ─────── */

  const failToast = useCallback(
    (error: unknown): void => {
      toast({
        title: String(error instanceof Error ? error.message : error),
        variant: "destructive",
      });
    },
    [toast],
  );

  const refresh = po.refresh;

  const changeStatus = async (record: PurchaseOrderRecord, status: "ordered" | "cancelled"): Promise<void> => {
    setBusyId(record.id);
    try {
      await setPoStatus(rid, record.id, status);
      refresh();
    } catch (error) {
      failToast(error);
    } finally {
      setBusyId(null);
    }
  };

  const reallyDelete = async (record: PurchaseOrderRecord): Promise<void> => {
    setBusyId(record.id);
    try {
      await deletePo(rid, record.id);
      refresh();
    } catch (error) {
      failToast(error);
    } finally {
      setBusyId(null);
    }
  };

  /**
   * "New PO" — ALWAYS live (a FAB that looked tappable but silently ate the
   * tap was a real owner complaint). A PO line IS an inventory item, so with
   * none loaded the guard dialog says which of the two situations this is —
   * nothing in stock yet, or a read that failed — instead of a dead tap.
   */
  const startNewPo = (): void => {
    if (inventory.length === 0) {
      setGuardOpen(true);
      return;
    }
    setNewOpen(true);
  };

  const submitNewPo = async (result: {
    vendorId: string | null;
    lines: NewPoLine[];
    status: "draft" | "ordered";
  }): Promise<void> => {
    setNewOpen(false);
    try {
      await createPo(rid, { vendorId: result.vendorId, items: result.lines, status: result.status });
      refresh();
    } catch (error) {
      failToast(error);
    }
  };

  const confirmReceive = async (
    record: PurchaseOrderRecord,
    lines: { inventory_id: string; qty_received: number }[],
    qualityRating: number,
  ): Promise<void> => {
    if (lines.length === 0) {
      toast({ title: "Enter quantities to receive.", variant: "destructive" });
      return;
    }
    setBusyId(record.id);
    try {
      await receivePo(rid, record.id, lines, qualityRating);
      toast({ title: "Stock received." });
      refresh();
    } catch (error) {
      failToast(error);
    } finally {
      setBusyId(null);
    }
  };

  /* ── Render ─────────────────────────────────────────────────────────── */

  return (
    // Bottom padding keeps the last card's actions clear of the floating
    // "New PO" button.
    <div className="pb-24">
      {po.loading ? (
        <SkeletonRows rows={6} />
      ) : po.error != null ? (
        <LoadErrorState
          whatFailed="Could not load purchase orders"
          error={po.error}
          onRetry={po.retry}
        />
      ) : (
        <div className="relative">
          {orders.length === 0 ? (
            <EmptyState
              icon={<Truck />}
              title="No purchase orders yet"
              caption="Raise a PO to restock from your vendors — received stock updates inventory automatically."
            />
          ) : (
            <>
              <SectionHeader title="Purchase orders" count={orders.length} />
              <div className="space-y-3.5">
                {orders.map((record) => (
                  <PoCard
                    key={record.id}
                    po={record}
                    money={money}
                    busy={busyId === record.id}
                    onOpen={() => { setDetail(record); }}
                    onPlace={() => { void changeStatus(record, "ordered"); }}
                    onReceive={() => { setReceiving(record); }}
                    onCancel={() => { void changeStatus(record, "cancelled"); }}
                    onDelete={() => { setDeleting(record); }}
                  />
                ))}
              </div>
            </>
          )}
          <CacheStalePill offline={po.offline} fromCache={po.fromCache} updatedAt={po.updatedAt} />
        </div>
      )}

      {/* The extended-FAB "New PO" action — never disabled once the page is
          up (see startNewPo); like Flutter it belongs to the list view, not
          to the skeleton or the error screen. */}
      {!po.loading && po.error == null && (
        <Button
          type="button"
          size="lg"
          onClick={startNewPo}
          className="fixed bottom-6 right-6 z-40 h-12 rounded-full px-5 shadow-card-hover"
        >
          <Plus /> New PO
        </Button>
      )}

      {/* Everything a card cannot hold: lines, dates, notes, quality, the
          received %, the forward actions and the Inventory jump. */}
      <PoDetailSheet
        po={detail}
        money={money}
        onOpenChange={(open) => { if (!open) { setDetail(null); } }}
        canOpenInventory={canOpenInventory}
        onJumpToInventory={openInventory}
        onPlace={(record) => { void changeStatus(record, "ordered"); }}
        onReceive={(record) => { setReceiving(record); }}
      />

      <NewPoDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        vendors={vendors}
        inventory={inventory}
        money={money}
        onSubmit={(result) => { void submitNewPo(result); }}
      />

      <ReceivePoDialog
        po={receiving}
        onOpenChange={(open) => { if (!open) { setReceiving(null); } }}
        onConfirm={(record, lines, rating) => { void confirmReceive(record, lines, rating); }}
      />

      {/* The New-PO guard: inventory read failed vs genuinely empty — two
          different sentences, two different ways forward (Flutter _createPo). */}
      <AlertDialog open={guardOpen} onOpenChange={setGuardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>New purchase order</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line">
              {inventoryError != null
                ? `Your inventory could not be loaded, and every purchase-order line must name an inventory item.\n\n${inventoryError}`
                : "Every purchase-order line names an inventory item, and this outlet has none yet. Add the ingredients you stock in Inventory first — then raise a PO to order them from a vendor."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            {inventoryError != null ? (
              <AlertDialogAction onClick={() => { po.retry(); }}>Retry</AlertDialogAction>
            ) : canOpenInventory ? (
              <AlertDialogAction onClick={openInventory}>Open Inventory</AlertDialogAction>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete is the one unrecoverable action — always behind a styled
          confirmation. */}
      <AlertDialog
        open={deleting != null}
        onOpenChange={(open) => { if (!open) { setDeleting(null); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete purchase order</AlertDialogTitle>
            <AlertDialogDescription>Remove this purchase order?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = deleting;
                setDeleting(null);
                if (target) { void reallyDelete(target); }
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
