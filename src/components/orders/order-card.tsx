"use client";

// ONE ORDER AS A CLICKABLE TILE — Flutter's `orderCard` (modules.dart
// 3956–4350), card anatomy line for line: emoji FoodTile, "Table X" title,
// "customer · N item(s)" (or the moved-away line when a move emptied it),
// animated stage chip, money + "Placed HH:mm" bottom row, the wrap chips
// (moved-from, stale, notification, channel), the on-tile Bark and the
// Pending Approve/Decline pair, and the cancelled lock caption. The whole
// tile opens the detail sheet; time-critical actions stay ON the tile.

import * as React from "react";
import { BellRing, Check, Lock, MoveDown, Megaphone, ReceiptText, Clock, ConciergeBell, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ForkCard } from "@/components/ui/fork-card";
import { InfoChip, StatusChip } from "@/components/ui/status-chip";
import {
  isOrderBarked,
  isOrderCancelled,
  kotLabelOf,
  movedAwayLine,
  orderIsPending,
  orderStale,
  stageChipTone,
  type Order,
} from "@/lib/api/orders";
import { orderServiceClock, LiveElapsed } from "@/components/orders/live-elapsed";

/** 🍽️ dine-in / 🥡 takeaway / 🛵 delivery — Flutter's FoodTile emoji. */
export const orderEmoji = (orderType: string | null | undefined): string =>
  orderType === "delivery" ? "🛵" : orderType === "takeaway" ? "🥡" : "🍽️";

export const orderChannelLabel = (orderType: string | null | undefined): string =>
  orderType === "delivery" ? "Delivery" : "Takeaway";

/** The 34px emoji tile Flutter leads every food card with. */
export function FoodTile({ emoji }: { emoji: string }): React.JSX.Element {
  return (
    <span aria-hidden className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] border border-border bg-inset text-lg">
      {emoji}
    </span>
  );
}

/** The stage chip: label + Flutter's `_stageColor` semantics, never colour alone. */
export function StageChip({ label, dense = true }: { label: string; dense?: boolean }): React.JSX.Element {
  const tone = stageChipTone(label);
  return "color" in tone
    ? <StatusChip label={label} color={tone.color} dense={dense} />
    : <StatusChip label={label} status={tone.status} dense={dense} />;
}

export interface OrderChipsProps {
  order: Order;
  focused: boolean;
  /** "Jun 26, 14:05" in the restaurant's zone, or "". */
  placedLabel: string;
}

/**
 * The quiet chip row every card carries and the sheet repeats: stale flag,
 * notification, KOT handle (leading the metadata — the one chip staff act ON),
 * placed instant, taken-by, the live D1/D2 chip, and the channel.
 */
export function OrderChips({ order, focused, placedLabel }: OrderChipsProps): React.JSX.Element {
  const cancelled = isOrderCancelled(order);
  const clock = orderServiceClock(order, cancelled);
  const settledIso = order.bill_closed_at ?? "";
  const running = clock?.running ?? settledIso.trim() === "";
  const kot = kotLabelOf(order);
  const stale = orderStale(order);
  const orderType = order.order_type ?? "dine_in";
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      {stale ? <StatusChip label="Over 24h · unsettled" status="warning" dense /> : null}
      {focused ? <InfoChip icon={<BellRing />} label="From your notification" /> : null}
      {kot ? <InfoChip icon={<ReceiptText />} label={kot} /> : null}
      {placedLabel ? <InfoChip icon={<Clock />} label={`Placed ${placedLabel}`} /> : null}
      {order.taken_by_employee_name ? <InfoChip icon={<ConciergeBell />} label={order.taken_by_employee_name} /> : null}
      {!cancelled ? (
        <LiveElapsed
          clock={clock}
          fromIso={order.created_at ?? ""}
          toIso={settledIso}
          // "Open 18m 04s" while the money is owed; "Took 42m 11s" once
          // settled — history, not an alarm, so it never escalates then.
          label={running ? "Open" : "Took"}
          escalates={running}
        />
      ) : null}
      {orderType !== "dine_in" ? <InfoChip label={`${orderEmoji(orderType)} ${orderChannelLabel(orderType)}`} /> : null}
    </div>
  );
}

export interface OrderCardProps {
  order: Order;
  focused: boolean;
  showsMoney: boolean;
  money: (v: unknown) => string;
  /** "Jun 26, 14:05" in the restaurant's zone, or "". */
  placedLabel: string;
  /** May this session bark at all (`canBarkFromBoard`) — hides the button, never greys it. */
  canBark?: boolean;
  onOpen: () => void;
  onBark: () => void;
  onApprove: () => void;
  onDecline: () => void;
  busy?: boolean;
}

export function OrderCard({ order, focused, showsMoney, money, placedLabel, canBark = true, onOpen, onBark, onApprove, onDecline, busy = false }: OrderCardProps): React.JSX.Element {
  const status: string = order.status;
  const pending = orderIsPending(status);
  const cancelled = isOrderCancelled(order);
  // Awaiting its bark: greyed stage, idle timers, prominent Bark action.
  const unbarked = !pending && !cancelled && status.toLowerCase() === "preparing" && !isOrderBarked(order);
  const orderType = order.order_type ?? "dine_in";
  const stageLabel = unbarked ? "Not barked" : status;
  const movedAway = movedAwayLine(order);
  const movedFrom = order.moved_from ?? "";
  const stale = orderStale(order);
  const items = order.items;
  // D1/D2's live chip on the tile: "Open 18m 04s" ticking with the kitchen's
  // 10/15-minute escalation while the money is owed, "Took 42m 11s" frozen and
  // neutral once settled. Server clock first; ISO fallback for old backends.
  const clock = orderServiceClock(order, cancelled);
  const settledIso = order.bill_closed_at ?? "";
  const orderRunning = clock?.running ?? settledIso.trim() === "";
  const hasClockChip = !cancelled && (clock !== null || (order.created_at ?? "").trim() !== "");

  const stop = (e: React.SyntheticEvent, act: () => void): void => {
    e.stopPropagation();
    act();
  };

  return (
    <ForkCard selected={pending || focused} onClick={onOpen} className="flex h-full flex-col p-[14px] py-3">
      <div className="flex items-center gap-2.5">
        <FoodTile emoji={orderEmoji(orderType)} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">Table {order.table}</div>
          {/* A ticket a dish move emptied says what left it, not "0 item(s)". */}
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {movedAway !== null && items.length === 0
              ? movedAway
              : `${order.customer || "Guest"} · ${String(items.length)} item(s)`}
          </div>
        </div>
        <div className="mr-4 shrink-0">
          <StageChip label={stageLabel} />
        </div>
      </div>
      <div className="mt-2.5 flex items-end gap-2">
        <div className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          {placedLabel ? `Placed ${placedLabel}` : ""}
        </div>
        {showsMoney ? <div className="shrink-0 text-sm font-semibold tabular-nums">{money(order.total)}</div> : null}
      </div>
      {stale || focused || orderType !== "dine_in" || movedFrom !== "" || hasClockChip ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {hasClockChip ? (
            <LiveElapsed
              clock={clock}
              fromIso={order.created_at ?? ""}
              toIso={settledIso}
              label={orderRunning ? "Open" : "Took"}
              escalates={orderRunning}
            />
          ) : null}
          {movedFrom !== "" ? <InfoChip icon={<MoveDown />} label={`Moved from ${movedFrom}`} /> : null}
          {stale ? <StatusChip label="Over 24h · unsettled" status="warning" dense /> : null}
          {focused ? <InfoChip icon={<BellRing />} label="From your notification" /> : null}
          {orderType !== "dine_in" ? <InfoChip label={`${orderEmoji(orderType)} ${orderChannelLabel(orderType)}`} /> : null}
        </div>
      ) : null}
      {/* Approve/decline and bark stay ON the tile — they are the whole reason
          this screen is open. */}
      {unbarked && canBark ? (
        <div className="mt-2.5">
          <Button size="sm" disabled={busy} onClick={(e) => { stop(e, onBark); }}>
            <Megaphone /> Bark → kitchen
          </Button>
        </div>
      ) : null}
      {pending && !cancelled ? (
        <div className="mt-2.5 flex gap-2">
          {/* Declining a pending ticket is a cancel: the reason is asked for
              here too, and a waiter keeps decline for Pending. */}
          <Button variant="outline" size="sm" className="flex-1" disabled={busy} onClick={(e) => { stop(e, onDecline); }}>
            <X /> Decline
          </Button>
          <Button size="sm" className="flex-1" disabled={busy} onClick={(e) => { stop(e, onApprove); }}>
            <Check /> Approve
          </Button>
        </div>
      ) : null}
      {cancelled ? (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-destructive">
          <Lock className="h-3 w-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate">Cancelled</span>
        </div>
      ) : null}
    </ForkCard>
  );
}
