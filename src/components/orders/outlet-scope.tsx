"use client";

// OUTLET SCOPE, THE FLUTTER WAY (modules.dart `_outletScopeBar` 383 /
// `_outletScopeEmpty` 422, findings 26 & 36): a quiet one-line strip only when
// the tenant has ≥2 outlets — icon + outlet name (or "All outlets (combined)"),
// right-aligned "N in other outlets" in warning ink + a ghost "View all" for
// sessions that may switch — and the empty state that explains itself instead
// of a bare table: icon, "No orders yet", the History note, "Open History",
// and the busiest-other-outlet suggestion when the orders live elsewhere.

import * as React from "react";
import { CalendarDays, Layers, Store, SwatchBook, ReceiptText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ALL_OUTLETS, applySelectedOutlet } from "@/lib/outlet";
import type { OrdersScope, OrdersScopeOutlet } from "@/lib/db";

const scopeOutletName = (scope: OrdersScope): string => scope.outlet.name.trim() || "this outlet";

const busiestOtherOutlet = (scope: OrdersScope): OrdersScopeOutlet | null =>
  [...scope.outlets]
    .filter((o) => !o.is_current && o.live_orders > 0)
    .sort((a, b) => b.live_orders - a.live_orders)
    .at(0) ?? null;

export interface OutletScopeBarProps {
  scope: OrdersScope | null;
  /** Only admins/managers may retarget the outlet — others see facts, no buttons. */
  canSwitchOutlet: boolean;
}

/** The quiet strip. Null (nothing at all) for single-outlet tenants. */
export function OutletScopeBar({ scope, canSwitchOutlet }: OutletScopeBarProps): React.JSX.Element | null {
  if (!scope || scope.outlets.length < 2) { return null; }
  const all = scope.is_all_outlets;
  const other = Math.max(0, scope.other_outlet_orders);
  return (
    <div className="flex items-center gap-1.5 text-[11.5px]">
      {all
        ? <Layers className="h-3.5 w-3.5 shrink-0 text-accent-foreground" />
        : <Store className="h-3.5 w-3.5 shrink-0 text-accent-foreground" />}
      <span className="min-w-0 flex-1 truncate font-semibold">
        {all ? "All outlets (combined)" : scopeOutletName(scope)}
      </span>
      {!all && other > 0 ? (
        <>
          <span className="shrink-0 text-warning">{other} in other outlets</span>
          {canSwitchOutlet ? (
            <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={() => { void applySelectedOutlet(ALL_OUTLETS); }}>
              <Layers /> View all
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export interface OrdersEmptyStateProps {
  scope: OrdersScope | null;
  canSwitchOutlet: boolean;
  canOpenHistory: boolean;
  onOpenHistory: () => void;
}

/** `_outletScopeEmpty` for the Orders grid: noun "orders", receipt icon. */
export function OrdersEmptyState({ scope, canSwitchOutlet, canOpenHistory, onOpenHistory }: OrdersEmptyStateProps): React.JSX.Element {
  const other = Math.max(0, Number(scope?.other_outlet_orders) || 0);
  const days = Math.max(0, Number(scope?.live_window_days) || 0);
  const historyNote = days > 0
    ? ` Settled orders older than ${String(days)} days move to History.`
    : " Settled orders move to History after a few days.";

  if (!scope || other <= 0) {
    return (
      <EmptyState
        icon={<ReceiptText />}
        title="No orders yet"
        caption={`New orders appear here the moment they are placed.${historyNote}`}
        action={canOpenHistory ? (
          <Button variant="ghost" size="sm" onClick={onOpenHistory}>
            <CalendarDays /> Open History
          </Button>
        ) : undefined}
      />
    );
  }

  const busiest = busiestOtherOutlet(scope);
  const busiestName = busiest ? busiest.outlet_name : "another outlet";
  const noTables = !scope.current_outlet_has_tables;
  return (
    <EmptyState
      icon={<Store />}
      title={`No orders in ${scopeOutletName(scope)}`}
      caption={
        `${String(other)} live ${other === 1 ? "order is" : "orders are"} in ${busiestName}.` +
        (noTables ? " This outlet has no tables yet, so guest QR orders can't land here." : "") +
        historyNote
      }
      action={canSwitchOutlet ? (
        <div className="flex flex-wrap justify-center gap-2">
          {busiest ? (
            <Button size="sm" onClick={() => { void applySelectedOutlet(busiest.outlet_id); }}>
              <SwatchBook /> Switch outlet
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => { void applySelectedOutlet(ALL_OUTLETS); }}>
            <Layers /> View all outlets
          </Button>
        </div>
      ) : undefined}
    />
  );
}
