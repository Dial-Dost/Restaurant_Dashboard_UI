"use client";

import * as React from "react";
import { Armchair, Check, Table2, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DrillSheet } from "@/components/ui/drill-sheet";
import { useTimezone } from "@/lib/use-timezone";
import { useCurrency } from "@/hooks/use-currency";
import type { BookingRow } from "@/lib/api/bookings";
import { DepositChip } from "@/components/bookings/booking-card";
import {
  fmtDmy,
  isClubbed,
  isOnline,
  statusOf,
  tableLabelOf,
} from "@/components/bookings/booking-format";

/** Token-styled key/value row (modules.dart `_kv`): letter-spaced micro key,
 *  quiet 13px value. */
function Kv({ k, children }: { k: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-start gap-4 py-1.5">
      <div className="micro-label w-[148px] shrink-0 pt-0.5">{k}</div>
      <div className="min-w-0 flex-1 text-[13px] font-medium text-foreground">{children}</div>
    </div>
  );
}

export interface BookingDetailSheetProps {
  booking: BookingRow | null;
  onOpenChange: (open: boolean) => void;
  /** Joined contact when the row itself carries none (web fallback). */
  phone: string;
  onAssign: (booking: BookingRow) => void;
  onMarkConfirmed: (booking: BookingRow) => void;
  onMarkSeated: (booking: BookingRow) => void;
  onCancelBooking: (booking: BookingRow) => void;
  onDelete: (booking: BookingRow) => void;
}

/**
 * The booking detail surface (modules.dart `openDetail` -> `_detailSheet`):
 * uppercase status eyebrow, customer-name title, WHEN / PARTY / TABLE /
 * SOURCE / PHONE / NOTES rows, then the five ghost actions. Every stage
 * change lives here by design — a mis-tap in a dense grid cannot cancel
 * somebody's reservation.
 */
export function BookingDetailSheet({
  booking,
  onOpenChange,
  phone,
  onAssign,
  onMarkConfirmed,
  onMarkSeated,
  onCancelBooking,
  onDelete,
}: BookingDetailSheetProps): React.JSX.Element | null {
  const { timezone } = useTimezone();
  const { currencySymbol } = useCurrency();
  if (!booking) { return null; }

  const table = tableLabelOf(booking);
  const when = fmtDmy(booking.booking_date_time, timezone);
  const shownPhone = booking.customer_phone || phone;

  // Close the sheet first, then act — the Flutter buttons pop before running.
  const run = (fn: (b: BookingRow) => void) => () => {
    onOpenChange(false);
    fn(booking);
  };

  return (
    <DrillSheet
      open
      onOpenChange={onOpenChange}
      eyebrow={statusOf(booking)}
      title={booking.customer_name}
    >
      <div>
        <Kv k="When">{when || "—"}</Kv>
        <Kv k="Party">{booking.number_of_people ?? "—"}</Kv>
        <Kv k="Table">
          {table.length === 0 ? "Not assigned" : isClubbed(booking) ? `${table} (clubbed)` : table}
        </Kv>
        <Kv k="Source">{isOnline(booking) ? "Online" : "In-house"}</Kv>
        {shownPhone.length > 0 && <Kv k="Phone">{shownPhone}</Kv>}
        {booking.notes.length > 0 && <Kv k="Notes">{booking.notes}</Kv>}
        {/* Web-extra rows: reservation deposits / min spend exist only on the
            web backend surface today — kept through the redesign. */}
        {booking.deposit && (
          <Kv k="Deposit">
            <DepositChip deposit={booking.deposit} symbol={currencySymbol} />
          </Kv>
        )}
        {booking.min_spend != null && (
          <Kv k="Min spend">{currencySymbol}{booking.min_spend}</Kv>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={run(onAssign)}>
            <Table2 /> Assign / combine tables
          </Button>
          <Button variant="outline" size="sm" onClick={run(onMarkConfirmed)}>
            <Check /> Mark confirmed
          </Button>
          <Button variant="outline" size="sm" onClick={run(onMarkSeated)}>
            <Armchair /> Mark seated
          </Button>
          <Button variant="outline" size="sm" onClick={run(onCancelBooking)}>
            <X /> Cancel booking
          </Button>
          <Button variant="outline" size="sm" onClick={run(onDelete)}>
            <Trash2 /> Delete
          </Button>
        </div>
      </div>
    </DrillSheet>
  );
}
