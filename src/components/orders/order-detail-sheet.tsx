"use client";

// THE ORDER DETAIL SHEET — Flutter's tap-anywhere drill-down (`_detailSheet`,
// modules.dart 4101–4219; finding 14): eyebrow (Table N / Delivery /
// Takeaway), title "Customer · ₹total" (money role-gated), the key/values
// (Stage, KOT when sent, Moved from / Moved, Placed, Taken by, the STATIC
// "Open for" / "Order to settle" span, Items), the full chip set, the full
// ticket (qty× name with per-line price when money shows), Contact, Note, the
// cancelled lock note, and the actions: Change stage, Bark → kitchen (when
// unbarked), Table bill · APC, and the recorded control acts (comp, void,
// waiver, payments) via the shared Controls menu.

import * as React from "react";
import { ArrowLeftRight, Gift, Lock, Megaphone, Table2, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DrillSheet } from "@/components/ui/drill-sheet";
import { readServiceClock } from "@/lib/service-clock";
import {
  CANCELLED_CAPTION,
  fmtDur,
  isOrderBarked,
  isOrderCancelled,
  kotLabelOf,
  movedAwayLine,
  orderIsPending,
  type Order,
} from "@/lib/api/orders";
import { OrderChips, orderChannelLabel } from "@/components/orders/order-card";
import { CaptureActions } from "@/app/dashboard/orders/capture-actions";

function Kv({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-divider py-1.5 text-sm last:border-b-0">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right">{value}</span>
    </div>
  );
}

export interface OrderDetailSheetProps {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  focused: boolean;
  showsMoney: boolean;
  money: (v: unknown) => string;
  /** "Jun 26, 14:05" in the restaurant's zone, or "". */
  placedLabel: string;
  /** May this session reach the Controls menu at all (C1). */
  showsControls: boolean;
  /** C2 — holds "Close Bill": sees the approve-payment entry point. */
  canSettleBill: boolean;
  /** May this session bark (`canBarkFromBoard`) — hidden, never greyed. */
  canBark?: boolean;
  onChangeStage: () => void;
  onBark: () => void;
  onOpenTableBill: () => void;
  onApprovePayment: () => void;
  /** Opens the unified payment sheet (settle, tenders, tips, NC). */
  onSettle?: () => void;
  /** Holds the comp permission: sees "Comp an item" (the comp sheet). */
  canComp?: boolean;
  onComp?: () => void;
  /** Opens the payment-proof screenshot preview (only passed when one exists). */
  onViewProof?: (() => void) | null;
  /** [web-extra] Extra key/value rows after the sheet's own (e.g. APC zone). */
  extraRows?: React.ReactNode;
  /** The page's web-extra actions (print bill, bill menu, editors, CFD…). */
  extraActions?: React.ReactNode;
  onChanged: () => void;
  busy?: boolean;
}

export function OrderDetailSheet({
  order, open, onOpenChange, restaurantId, focused, showsMoney, money, placedLabel,
  showsControls, canSettleBill, canBark = true, onChangeStage, onBark, onOpenTableBill, onApprovePayment,
  onSettle, canComp = false, onComp,
  onViewProof, extraRows, extraActions, onChanged, busy = false,
}: OrderDetailSheetProps): React.JSX.Element | null {
  if (!order) { return null; }
  const status: string = order.status;
  const pending = orderIsPending(status);
  const cancelled = isOrderCancelled(order);
  const unbarked = !pending && !cancelled && status.toLowerCase() === "preparing" && !isOrderBarked(order);
  const stageLabel = unbarked ? "Not barked" : status;
  const orderType = order.order_type ?? "dine_in";
  const kot = kotLabelOf(order);
  const movedFrom = order.moved_from ?? "";
  const movedAway = movedAwayLine(order);
  const clock = readServiceClock(order);
  const settledIso = (order.bill_closed_at ?? "").trim();
  const running = clock?.running ?? settledIso === "";
  // D2's span as a STATIC line — a detail sheet is read once and dismissed, so
  // the server's reading is printed exactly as it arrived, with no tick added.
  let spanMs: number | null = null;
  if (clock) {
    spanMs = clock.elapsed_ms;
  } else {
    const from = Date.parse(order.created_at ?? "");
    if (Number.isFinite(from)) {
      const to = settledIso === "" ? Date.now() : Date.parse(settledIso);
      if (Number.isFinite(to)) { spanMs = Math.max(0, to - from); }
    }
  }
  const contact = [order.customer_phone ?? "", order.delivery_address ?? ""].filter((s) => s.trim() !== "").join(" · ");
  const eyebrow = orderType === "dine_in" ? `Table ${order.table}` : orderChannelLabel(orderType);
  const title = showsMoney ? `${order.customer || "Guest"} · ${money(order.total)}` : (order.customer || "Guest");

  return (
    <DrillSheet open={open} onOpenChange={onOpenChange} eyebrow={eyebrow} title={title}>
      <div>
        <Kv label="Stage" value={stageLabel} />
        {/* Only when the backend actually sent numbers: no "KOT —" line
            implying the ticket was never sent to the kitchen. */}
        {kot ? <Kv label="KOT" value={kot} /> : null}
        {movedFrom !== "" ? <Kv label="Moved from" value={`Table ${movedFrom}`} /> : null}
        {movedAway !== null ? <Kv label="Moved" value={movedAway} /> : null}
        <Kv label="Placed" value={placedLabel || "—"} />
        <Kv label="Taken by" value={order.taken_by_employee_name ?? "—"} />
        {spanMs !== null ? <Kv label={running ? "Open for" : "Order to settle"} value={fmtDur(spanMs)} /> : null}
        <Kv label="Items" value={String(order.items.length)} />
        {/* [web-extra] The recorded tender, when one has been confirmed — the
            proof screenshot opens from here rather than off a grid row. */}
        {order.payment_method ? (
          <Kv
            label="Payment"
            value={
              <span className="inline-flex flex-wrap items-center justify-end gap-x-2">
                <span>{order.payment_method}</span>
                {onViewProof ? (
                  <button type="button" className="text-xs text-accent-foreground underline underline-offset-2" onClick={onViewProof}>
                    View payment screenshot
                  </button>
                ) : null}
              </span>
            }
          />
        ) : null}
        {extraRows}
      </div>
      {/* The chip set moves here rather than being dropped: who took the
          order, the KOT handle and the live timing the tile has no room for. */}
      <div className="mt-3">
        <OrderChips order={order} focused={focused} placedLabel={placedLabel} />
      </div>
      {/* The full ticket — the one thing a tile genuinely cannot show. */}
      <div className="mt-3 space-y-1">
        {order.items.map((it) => (
          <div key={it.id} className="flex items-start gap-1.5 text-sm">
            <span className="shrink-0 text-accent-foreground">{it.quantity}×</span>
            <span className="min-w-0 flex-1">
              {it.name}
              {it.variation_name ? ` (${it.variation_name})` : ""}
              {it.note ? <span className="block text-xs text-muted-foreground">Note: {it.note}</span> : null}
            </span>
            {showsMoney ? <span className="shrink-0 tabular-nums">{money(it.price)}</span> : null}
          </div>
        ))}
      </div>
      {orderType !== "dine_in" && contact !== "" ? (
        <div className="mt-3"><Kv label="Contact" value={contact} /></div>
      ) : null}
      {order.note ? (
        <div className="mt-3"><Kv label="Note" value={order.note} /></div>
      ) : null}
      {cancelled ? (
        <div className="mt-4 flex items-start gap-1.5 text-[11.5px] text-destructive">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{CANCELLED_CAPTION}</span>
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!cancelled ? (
          <Button size="sm" disabled={busy} onClick={onChangeStage}>
            <ArrowLeftRight /> Change stage
          </Button>
        ) : null}
        {unbarked && canBark ? (
          <Button size="sm" disabled={busy} onClick={onBark}>
            <Megaphone /> Bark → kitchen
          </Button>
        ) : null}
        {orderType === "dine_in" && order.table.trim() !== "" && order.table !== "—" ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={onOpenTableBill}>
            <Table2 /> Table bill · APC
          </Button>
        ) : null}
        {/* The unified payment sheet — Flutter's settle (tenders, splits,
            tips, proof, till, Settle as NC). */}
        {onSettle && canSettleBill && !cancelled && status !== "Payment Pending Approval" && status !== "Paid" && order.table.trim() !== "" ? (
          <Button size="sm" disabled={busy} onClick={onSettle}>
            <Wallet /> Settle bill
          </Button>
        ) : null}
        {/* Flutter's "Comp an item" — the comp sheet for this order. */}
        {onComp && canComp && !cancelled && status !== "Paid" && status !== "Closed" ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={onComp}>
            <Gift /> Comp an item
          </Button>
        ) : null}
        {/* "Payment Pending Approval" settles one hop away, as on the Flutter
            table-bill sheet ("Approve payment & close"). */}
        {status === "Payment Pending Approval" && canSettleBill ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={onApprovePayment}>
            <Wallet /> Approve payment &amp; close
          </Button>
        ) : null}
        {/* The recorded control acts — comp ("Non-chargeable item…"), void,
            waiver, payments & tip, billing counter — Flutter's "Comp an item"
            entry, permission-gated inside the menu itself. */}
        {!cancelled && showsControls ? (
          <CaptureActions
            restaurantId={restaurantId}
            order={{
              id: order.id,
              table: order.table,
              status: order.status,
              items: order.items.map((it) => ({
                id: it.id, name: it.name, quantity: it.quantity, price: it.price,
                nc: it.nc === true, nc_id: it.nc_id ?? null, nc_kind: it.nc_kind ?? null,
              })),
            }}
            onChanged={onChanged}
          />
        ) : null}
        {/* [web-extra] Everything the web keeps beyond the Flutter sheet (print
            bill, the 6.5 Bill menu, item/bill editors, CFD, re-open) — built by
            the page, which owns those flows and their gates. */}
        {extraActions}
      </div>
    </DrillSheet>
  );
}
