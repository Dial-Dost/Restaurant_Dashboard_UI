"use client";

// Explains WHICH orders this grid is showing, and — when it is empty — why.
//
// Two correct-but-invisible behaviours made staff believe placed orders had
// vanished:
//   1. GET /orders is scoped to ONE outlet. A guest/QR order always lands on the
//      TABLE's outlet, so anyone signed into (or switched to) a branch with no
//      tables of its own saw a completely empty grid with no explanation.
//   2. Settled orders drop out of the live grid after `live_window_days`.
//
// Neither scoping rule is loosened here (a branch view must never leak another
// branch's orders). Instead GET /orders/scope reports the counts per outlet, so
// this component can name the outlet, say how many orders are sitting on the
// others, and offer the one click that reaches them.
//
// Shared by the Orders dashboard and the locked kitchen display, because the
// kitchen screen shows the same empty grid for the same two reasons.

import Link from "next/link";
import { Layers, Store, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ALL_OUTLETS, setSelectedOutlet } from "@/lib/outlet";
import type { OrdersScope } from "@/lib/db";

interface Props {
  scope: OrdersScope | null;
  /** How many orders the surface is actually rendering right now. */
  visibleCount: number;
  /** Extra context for a station-filtered surface ("Tandoor"), so "empty" reads correctly. */
  station?: string;
  /** `true` scales the copy up for a wall-mounted kitchen monitor. */
  large?: boolean;
  /**
   * Whether this user may change the active outlet. Only admins/managers can —
   * the backend rejects `X-Outlet-Id` targeting for anyone else, so offering the
   * button to a waiter would swap one silent failure for another. When false the
   * explanation still renders; only the actions are withheld.
   */
  canSwitchOutlet?: boolean;
}

export function OrdersScopeNotice({ scope, visibleCount, station, large = false, canSwitchOutlet = false }: Props) {
  // No scope payload (old backend / failed request) => say nothing rather than
  // guess. The surface behaves exactly as it did before.
  if (!scope) {return null;}

  const outletName = scope.outlet.name?.trim() || "this outlet";
  const elsewhere = Math.max(0, Number(scope.other_outlet_orders) || 0);
  const windowDays = Number(scope.live_window_days) || 3;
  const isEmpty = visibleCount === 0;
  const where = scope.is_all_outlets ? "all outlets (combined)" : outletName;

  // The outlet worth suggesting: the one holding the most live orders that is
  // not the one already being viewed.
  const suggestion = [...(scope.outlets ?? [])]
    .filter((o) => !o.is_current && o.live_orders > 0)
    .sort((a, b) => b.live_orders - a.live_orders)[0];

  // Quiet, permanent footnote: an old settled order being absent is by design,
  // and there are two real pages that still hold it.
  const historyNote = (
    <>
      Settled orders older than {windowDays} day{windowDays === 1 ? "" : "s"} leave this live list —
      {" "}
      <Link href="/dashboard/history" className="font-medium underline underline-offset-2">
        find them in History
      </Link>
      {" or "}
      <Link href="/dashboard/accounting" className="font-medium underline underline-offset-2">
        Reports
      </Link>
      .
    </>
  );

  const titleCls = large ? "text-2xl font-bold" : "font-semibold";
  const bodyCls = large ? "text-lg text-muted-foreground" : "text-sm text-muted-foreground";
  const noteCls = large ? "text-sm text-muted-foreground" : "text-xs text-muted-foreground";
  const stationSuffix = station ? ` for ${station}` : "";

  // --- The loud case: nothing here, but there ARE orders on another branch ----
  if (isEmpty && elsewhere > 0) {
    return (
      <Card className="border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/40">
        <CardContent className="space-y-3 pt-6">
          <div>
            <p className={titleCls}>No orders{stationSuffix} in {where} right now</p>
            <p className={bodyCls}>
              {elsewhere} live order{elsewhere === 1 ? " is" : "s are"} on{" "}
              {suggestion ? <strong className="font-semibold">{suggestion.outlet_name}</strong> : "another outlet"}
              . Orders are scoped to the outlet you are viewing, so nothing has been lost — it is somewhere else.
              {scope.current_outlet_has_tables === false
                ? " This outlet has no tables yet, so guest QR orders can never land here."
                : ""}
            </p>
          </div>
          {canSwitchOutlet ? (
            <div className="flex flex-wrap gap-2">
              {suggestion && (
                <Button size={large ? "default" : "sm"} onClick={() => { void setSelectedOutlet(suggestion.outlet_id); }}>
                  <Store className="mr-1.5 h-4 w-4" />
                  Switch to {suggestion.outlet_name}
                </Button>
              )}
              {!scope.is_all_outlets && (
                <Button size={large ? "default" : "sm"} variant="outline" onClick={() => { void setSelectedOutlet(ALL_OUTLETS); }}>
                  <Layers className="mr-1.5 h-4 w-4" />
                  View all outlets
                </Button>
              )}
            </div>
          ) : (
            <p className={bodyCls}>Only an admin or manager can change the active outlet — ask one to switch it for you.</p>
          )}
          <p className={noteCls}>{historyNote}</p>
        </CardContent>
      </Card>
    );
  }

  // --- The empty-everywhere case ---------------------------------------------
  if (isEmpty) {
    return (
      <Card className="border-dashed">
        <CardContent className="space-y-1 pt-6">
          <p className={titleCls}>No live orders{stationSuffix} in {where}</p>
          <p className={bodyCls}>
            Nothing is open right now.{" "}
            {scope.current_outlet_has_tables === false
              ? "This outlet has no tables yet, so guest QR orders can't land here — add tables in the Tables module."
              : "New table, QR and takeaway orders appear here the moment they are placed."}
          </p>
          <p className={`pt-1 ${noteCls}`}>{historyNote}</p>
        </CardContent>
      </Card>
    );
  }

  // --- The normal case: a one-line scope label, so the grid is never ambiguous
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${large ? "text-sm" : "text-xs"} text-muted-foreground`}>
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {scope.is_all_outlets ? <Layers className="h-3.5 w-3.5 shrink-0" /> : <Store className="h-3.5 w-3.5 shrink-0" />}
        <span>
          Showing <strong className="font-semibold">{where}</strong> · {visibleCount} order{visibleCount === 1 ? "" : "s"}
        </span>
      </span>
      {elsewhere > 0 && (
        canSwitchOutlet ? (
          <button
            type="button"
            onClick={() => { void setSelectedOutlet(ALL_OUTLETS); }}
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            <Layers className="h-3.5 w-3.5" />
            {elsewhere} more on other outlets — view all
          </button>
        ) : (
          <span className="inline-flex items-center gap-1">
            <Layers className="h-3.5 w-3.5" />
            {elsewhere} more on other outlets
          </span>
        )
      )}
      <span className="inline-flex items-center gap-1">
        <Info className="h-3.5 w-3.5 shrink-0" />
        {historyNote}
      </span>
    </div>
  );
}
