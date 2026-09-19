"use client";

// The inventory drill-downs — Flutter `_inventoryItemSheet`, `_ItemMovements`,
// `_inventoryListSheet` and the ITEMS TRACKED section breakdown.

import * as React from "react";
import { CalendarClock, ChefHat, Gauge, MoreHorizontal, PackagePlus, Trash, Trash2 } from "lucide-react";
import type { InventoryItem } from "@/app/dashboard/inventory/page";
import { DrillSheet } from "@/components/ui/drill-sheet";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { SkeletonBox } from "@/components/ui/fork-skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { StockMovement } from "@/lib/db";
import { fetchItemMovements } from "@/lib/api/inventory";
import { daysAgoInZone, formatDate, todayInZone } from "@/lib/tz";
import { useTimezone } from "@/lib/use-timezone";
import {
  DetailRow,
  TapRow,
  UNCATEGORISED,
  isShort,
  score,
  stockNum,
  toneChip,
  withUnit,
  type StockSection,
} from "./inventory-shared";

export type ItemAction = "receive" | "wastage" | "reorder" | "issue" | "expiry" | "delete";

const dayDiff = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Footer: ghost Close on the left, the optional primary jump on the right. */
function SheetFooter({ onClose, jump }: { onClose: () => void; jump?: (() => void) | null }): React.JSX.Element {
  return (
    <div className="flex w-full items-center justify-between gap-2">
      <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
      {jump ? <Button size="sm" onClick={jump}>View in Purchase Orders</Button> : <span />}
    </div>
  );
}

function ItemMovements({ restaurantId, item }: { restaurantId: string; item: InventoryItem }): React.JSX.Element {
  const { timezone } = useTimezone();
  const [state, setState] = React.useState<{ rows: StockMovement[] | null; failed: boolean }>({ rows: null, failed: false });

  React.useEffect(() => {
    let alive = true;
    fetchItemMovements(restaurantId, item.id, daysAgoInZone(29, timezone))
      .then((rows) => { if (alive) {setState({ rows, failed: false });} })
      .catch(() => { if (alive) {setState({ rows: [], failed: true });} });
    return () => { alive = false; };
  }, [restaurantId, item.id, timezone]);

  if (state.rows === null) {
    return (
      <div className="grid gap-2 py-2">
        <SkeletonBox height={14} />
        <SkeletonBox height={14} />
      </div>
    );
  }
  if (state.failed) {
    return <p className="text-xs text-tertiary">Movement history is unavailable right now.</p>;
  }
  if (state.rows.length === 0) {
    return <p className="text-xs text-tertiary">Nothing received, issued or wasted in this window.</p>;
  }
  return (
    <div>
      {state.rows.map((m) => {
        const delta = Number.isFinite(m.delta) ? m.delta : 0;
        return (
          <DetailRow
            key={m.id}
            label={[m.kind || "movement", m.reason?.trim() || null].filter(Boolean).join(" · ")}
            value={withUnit(`${delta > 0 ? "+" : ""}${score(delta)}`, item.unit)}
            trailing={m.created_at ? formatDate(m.created_at, timezone) : undefined}
          />
        );
      })}
    </div>
  );
}

/** `_inventoryItemSheet`: the item's mini-overview. */
export function ItemSheet({
  restaurantId,
  item,
  onClose,
  onAction,
  onJump,
}: {
  restaurantId: string;
  item: InventoryItem | null;
  onClose: () => void;
  /** Called AFTER the sheet closes — never stack a dialog over a stale sheet. */
  onAction: (item: InventoryItem, action: ItemAction) => void;
  /** Null when Purchase Orders is not reachable for this session. */
  onJump: (() => void) | null;
}): React.JSX.Element {
  const { timezone } = useTimezone();
  const it = item;
  const act = (a: ItemAction) => () => {
    if (!it) {return;}
    onClose();
    onAction(it, a);
  };

  let expiry: { value: string; note?: string } = { value: "Not set" };
  if (it?.expiry_date) {
    const days = dayDiff(todayInZone(timezone), it.expiry_date);
    expiry = {
      value: formatDate(`${it.expiry_date}T12:00:00Z`, timezone),
      note: Number.isNaN(days) ? undefined : days < 0 ? `${-days}d ago` : days === 0 ? "today" : `in ${days}d`,
    };
  }
  const showReorder = it?.reorder_applied != null && it.reorder_basis !== "legacy";

  return (
    <DrillSheet
      open={it != null}
      onOpenChange={(o) => { if (!o) {onClose();} }}
      eyebrow="Inventory"
      title={it?.name ?? ""}
      action={<SheetFooter onClose={onClose} jump={it && isShort(it) ? onJump : null} />}
    >
      {it && (
        <>
          <StatusChip status={toneChip(it.status)} label={it.status} />
          <div className="mt-3">
            <DetailRow label="On hand" value={withUnit(stockNum(it.stock), it.unit)} />
            {showReorder && (
              <DetailRow
                label={it.reorder_basis === "item" ? "Reorder at" : "Reorder at (default)"}
                value={withUnit(stockNum(it.reorder_applied), it.unit)}
              />
            )}
            <DetailRow label="Category" value={it.category.trim() || UNCATEGORISED} />
            <DetailRow label="Expiry" value={expiry.value} trailing={expiry.note} />
          </div>
          <div className="micro-label mb-1 mt-5">Movements · last 30 days</div>
          <ItemMovements restaurantId={restaurantId} item={it} />
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={act("receive")}>
              <PackagePlus className="mr-1.5 h-4 w-4" /> Receive stock
            </Button>
            <Button variant="outline" size="sm" onClick={act("wastage")}>
              <Trash className="mr-1.5 h-4 w-4" /> Record wastage
            </Button>
            <Button variant="outline" size="sm" onClick={act("reorder")}>
              <Gauge className="mr-1.5 h-4 w-4" /> Reorder level
            </Button>
            {/* Web-only extras (audit 39/40/42), kept behind one quiet menu. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" aria-label="More actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={act("issue")}>
                  <ChefHat className="mr-2 h-4 w-4" /> Issue to kitchen
                </DropdownMenuItem>
                <DropdownMenuItem onClick={act("expiry")}>
                  <CalendarClock className="mr-2 h-4 w-4" /> Set expiry
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={act("delete")} className="text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" /> Delete item
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </>
      )}
    </DrillSheet>
  );
}

export interface ListSheetSpec {
  eyebrow: string;
  title: string;
  items: InventoryItem[];
  /** Section sheets lead with "Items: N" / "Need restocking: n". */
  lead?: { items: number; short: number };
  /** Offer the Purchase Orders jump. */
  jump: boolean;
}

/** `_inventoryListSheet`: a set of items, each a row into its item sheet. */
export function ListSheet({
  spec,
  onClose,
  onOpenItem,
  onJump,
}: {
  spec: ListSheetSpec | null;
  onClose: () => void;
  onOpenItem: (item: InventoryItem) => void;
  onJump: (() => void) | null;
}): React.JSX.Element {
  return (
    <DrillSheet
      open={spec != null}
      onOpenChange={(o) => { if (!o) {onClose();} }}
      eyebrow={spec?.eyebrow}
      title={spec?.title ?? ""}
      action={<SheetFooter onClose={onClose} jump={spec?.jump ? onJump : null} />}
    >
      {spec && (
        <>
          {spec.lead && (
            <div className="mb-2">
              <DetailRow label="Items" value={spec.lead.items} />
              <DetailRow label="Need restocking" value={spec.lead.short} />
            </div>
          )}
          {spec.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing in this set.</p>
          ) : (
            spec.items.map((it) => (
              <DetailRow
                key={it.id}
                label={it.name}
                value={withUnit(String(it.stock), it.unit)}
                trailing={it.status}
                onClick={() => { onClose(); onOpenItem(it); }}
              />
            ))
          )}
        </>
      )}
    </DrillSheet>
  );
}

/** ITEMS TRACKED → every section with its count and "n short". */
export function BreakdownSheet({
  open,
  total,
  sections,
  onClose,
  onOpenSection,
}: {
  open: boolean;
  total: number;
  sections: StockSection[];
  onClose: () => void;
  onOpenSection: (s: StockSection) => void;
}): React.JSX.Element {
  return (
    <DrillSheet
      open={open}
      onOpenChange={(o) => { if (!o) {onClose();} }}
      eyebrow="Inventory"
      title={`${total} items tracked`}
      action={<SheetFooter onClose={onClose} />}
    >
      {sections.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing in this set.</p>
      ) : (
        sections.map((s) => (
          <TapRow
            key={s.label}
            onClick={() => { onClose(); onOpenSection(s); }}
            className="flex w-[calc(100%+1rem)] items-center gap-3 border-b border-divider py-2.5 text-left last:border-b-0"
          >
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{s.label}</span>
            <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{s.items.length}</span>
            {s.short > 0 && <span className="shrink-0 text-xs text-warning">{s.short} short</span>}
          </TapRow>
        ))
      )}
    </DrillSheet>
  );
}
