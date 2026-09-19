"use client";

/**
 * THE EMPTY BOARD THAT EXPLAINS ITSELF — the web `_outletScopeEmpty` for the
 * kitchen. Every order lands on the outlet of the TABLE it was placed from,
 * and reads are scoped to the outlet you signed in to — so a perfectly healthy
 * restaurant can show an empty kitchen board. When /orders/scope says live
 * orders exist on another outlet, the board says where they are and offers the
 * one-click switch, instead of a bare "nothing here".
 *
 * History is deliberately NOT mentioned — worth saying on the Orders list,
 * noise on the kitchen board (mentionHistory: false in the app).
 */

import * as React from "react";
import { ArrowLeftRight, Layers, Soup, Store } from "lucide-react";

import type { OrdersScope, OrdersScopeOutlet } from "@/lib/db";
import { ALL_OUTLETS, applySelectedOutlet } from "@/lib/outlet";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export interface KdsScopeEmptyProps {
  scope: OrdersScope | null;
  /** Only admins/managers may target another outlet; others still get the
   *  explanation, just not the buttons. */
  canSwitchOutlet: boolean;
}

export function KdsScopeEmpty({ scope, canSwitchOutlet }: KdsScopeEmptyProps): React.JSX.Element {
  const other = Math.max(0, scope?.other_outlet_orders ?? 0);

  if (!scope || other <= 0) {
    return (
      <EmptyState
        icon={<Soup />}
        title="No active kitchen tickets"
        caption="Approved orders appear here for the kitchen to work."
      />
    );
  }

  // The outlet with the most live orders right now — where an empty board
  // should point the user.
  const busiest = [...scope.outlets]
    .filter((o) => !o.is_current && o.live_orders > 0)
    .sort((a, b) => b.live_orders - a.live_orders)[0] as OrdersScopeOutlet | undefined;
  const busiestName = busiest?.outlet_name.trim() ? busiest.outlet_name : "another outlet";
  const outletName = scope.outlet.name.trim() ? scope.outlet.name : "this outlet";
  const noTables = !scope.current_outlet_has_tables;

  return (
    <EmptyState
      icon={<Store />}
      title={`No kitchen tickets in ${outletName}`}
      caption={
        `${other} live ${other === 1 ? "order is" : "orders are"} in ${busiestName}.` +
        (noTables ? " This outlet has no tables yet, so guest QR orders can't land here." : "")
      }
      action={
        canSwitchOutlet ? (
          <>
            {busiest != null && (
              <Button size="sm" onClick={() => { void applySelectedOutlet(busiest.outlet_id); }}>
                <ArrowLeftRight /> Switch outlet
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => { void applySelectedOutlet(ALL_OUTLETS); }}>
              <Layers /> View all outlets
            </Button>
          </>
        ) : undefined
      }
    />
  );
}
