"use client";

import * as React from "react";
import { Bell, Calendar, Check, Globe, Link2, StickyNote, Table2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ForkCard } from "@/components/ui/fork-card";
import { InfoChip, StatusChip } from "@/components/ui/status-chip";
import type { BookingDeposit } from "@/app/dashboard/bookings/data";
import type { BookingRow } from "@/lib/api/bookings";
import {
  bookingStatusChip,
  initialsOf,
  isClubbed,
  isOnline,
  isRequested,
  statusOf,
  tableLabelOf,
} from "@/components/bookings/booking-format";

/** Copper-ringed initials disc (food_tile.dart InitialsAvatar, 38px). */
export function InitialsAvatar({ initials, className }: { initials: string; className?: string }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full",
        "border-[1.2px] border-[hsl(var(--primary)/0.35)] bg-inset",
        "text-[12px] font-semibold uppercase tracking-[0.5px] text-accent-foreground",
        className,
      )}
    >
      {initials.toUpperCase()}
    </span>
  );
}

/**
 * Reservation-deposit chip — web-extra (no Flutter counterpart yet), carried
 * through the card-grid redesign as a labelled StatusChip so the state
 * survives without off-palette colours. `dense` is the card form: amount
 * only, full wording in the title.
 */
export function DepositChip({
  deposit,
  symbol,
  dense = false,
}: {
  deposit: BookingDeposit | null | undefined;
  symbol: string;
  dense?: boolean;
}): React.JSX.Element | null {
  if (!deposit) { return null; }
  const status = ({
    pending: "warning",
    paid: "success",
    refund_due: "danger",
    forfeited: "neutral",
  } as const)[deposit.status];
  const full: Record<string, string> = {
    pending: `Deposit ${symbol}${deposit.amount} pending`,
    paid: `Deposit ${symbol}${deposit.amount} paid`,
    refund_due: `Refund due ${symbol}${deposit.amount}`,
    forfeited: `Deposit ${symbol}${deposit.amount} forfeited`,
  };
  const compact: Record<string, string> = {
    pending: `${symbol}${deposit.amount} due`,
    paid: `${symbol}${deposit.amount} paid`,
    refund_due: `${symbol}${deposit.amount} refund`,
    forfeited: `${symbol}${deposit.amount} kept`,
  };
  const fullLabel = full[deposit.status] ?? `Deposit ${symbol}${deposit.amount}`;
  return (
    <StatusChip
      status={status}
      dense={dense}
      label={dense ? (compact[deposit.status] ?? `${symbol}${deposit.amount}`) : fullLabel}
      title={dense ? fullLabel : undefined}
    />
  );
}

export interface BookingCardProps {
  booking: BookingRow;
  /** dd/mm/yy · HH:mm, precomputed in the restaurant's zone. */
  whenLabel: string;
  /** This card is the one the notification asked for. */
  focused: boolean;
  currencySymbol: string;
  onOpen: () => void;
  /** Requested-only inline actions (PATCH Confirmed / Cancelled). */
  onConfirm: () => void;
  onDecline: () => void;
}

/**
 * One booking tile of the responsive grid (modules.dart `_list` cards):
 * avatar + name + "Party of N", animated StatusChip, info-chip wrap
 * (when / table / Online), italic 2-line notes preview, and — on a
 * Requested booking — the inline Decline / Confirm pair. The whole card
 * opens the detail sheet; requested and focused cards wear the selected
 * outline.
 */
export function BookingCard({
  booking,
  whenLabel,
  focused,
  currencySymbol,
  onOpen,
  onConfirm,
  onDecline,
}: BookingCardProps): React.JSX.Element {
  const status = statusOf(booking);
  const requested = isRequested(booking);
  const table = tableLabelOf(booking);
  const chip = bookingStatusChip(status);

  return (
    <ForkCard
      selected={requested || focused}
      onClick={onOpen}
      chevron={false}
      className="flex h-full flex-col px-3.5 py-3"
    >
      <div className="flex items-center gap-2.5">
        <InitialsAvatar initials={initialsOf(booking.customer_name)} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold text-foreground">
            {booking.customer_name}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            Party of {booking.number_of_people ?? "—"}
          </div>
        </div>
        {/* Re-keyed on the status word so a stage change re-enters with a
            small transition (Flutter's AnimatedSwitcher). */}
        <span key={status} className="shrink-0 animate-in fade-in-0 zoom-in-95 duration-200">
          <StatusChip label={status} status={chip.status} color={chip.color} dense />
        </span>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {focused && <InfoChip icon={<Bell />} label="From your notification" />}
        <InfoChip icon={<Calendar />} label={whenLabel || "—"} />
        {table.length > 0 && (
          <InfoChip
            icon={isClubbed(booking) ? <Link2 /> : <Table2 />}
            label={isClubbed(booking) ? `${table} (clubbed)` : table}
          />
        )}
        {isOnline(booking) && <InfoChip icon={<Globe />} label="Online" />}
        <DepositChip deposit={booking.deposit} symbol={currencySymbol} dense />
      </div>

      {booking.notes.length > 0 && (
        <div className="mt-2 flex items-start gap-1.5">
          <StickyNote aria-hidden className="mt-0.5 h-3 w-3 shrink-0 text-tertiary" />
          <p className="line-clamp-2 min-w-0 text-[11px] italic leading-snug text-tertiary">
            {booking.notes}
          </p>
        </div>
      )}

      {requested && (
        <div
          className="mt-auto flex gap-2 pt-2.5"
          onClick={(event) => { event.stopPropagation(); }}
          onKeyDown={(event) => { event.stopPropagation(); }}
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={onDecline}
          >
            <X /> Decline
          </Button>
          <Button type="button" size="sm" className="flex-1" onClick={onConfirm}>
            <Check /> Confirm
          </Button>
        </div>
      )}
    </ForkCard>
  );
}
