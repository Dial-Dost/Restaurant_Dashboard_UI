"use client";

import * as React from "react";

import { DrillSheet } from "@/components/ui/drill-sheet";
import { useCurrency } from "@/hooks/use-currency";
import { useTimezone } from "@/lib/use-timezone";
import type { GuestRow } from "@/lib/api/customers";
import { moneyOf, scoreOf } from "@/components/overview/overview-utils";
import { customerSegmentLabel, fmtGuestDay } from "@/components/customers/guest-format";

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

/**
 * The per-guest drill-down (`_guestSheet` -> `_detailSheet`): eyebrow
 * "GUEST BOOK · <SEGMENT>", the guest's name as title, then every figure the
 * row carries in the app's exact order and fallback copy — ending with the
 * spend-basis footnote when the server sent one. No "View in <Module>" jump:
 * the Flutter sheet passes none.
 */
export function GuestSheet({
  guest,
  spendBasis,
  onOpenChange,
}: {
  guest: GuestRow | null;
  /** The envelope's `spend_basis` sentence ('' when absent). */
  spendBasis: string;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element | null {
  const { currencySymbol } = useCurrency();
  const { timezone } = useTimezone();
  if (!guest) { return null; }

  const money = moneyOf(currencySymbol);
  return (
    <DrillSheet
      open
      onOpenChange={onOpenChange}
      eyebrow={`Guest book · ${customerSegmentLabel(guest.segment === "" ? "all" : guest.segment)}`}
      title={guest.name}
    >
      <div>
        <Kv k="Phone">{guest.phone}</Kv>
        <Kv k="Email">{guest.email}</Kv>
        {/* Straight off the Bookings table on every read, so a booking made a
            second ago is already in the count — the guest book must never show
            a guest who just reserved as someone who has never interacted. */}
        <Kv k="Bookings made">{guest.bookings_made}</Kv>
        <Kv k="Visits">{guest.visits}</Kv>
        <Kv k="Bills">{guest.bills}</Kv>
        <Kv k="Total spent">{money(guest.total_spend)}</Kv>
        <Kv k="Average per visit">{money(guest.avg_spend_per_visit)}</Kv>
        <Kv k="Of which tax">{money(guest.total_tax)}</Kv>
        <Kv k="Of which service charge">{money(guest.total_service_charge)}</Kv>
        <Kv k="Pre-tax spend">{money(guest.pre_tax_spend)}</Kv>
        <Kv k="Last visit">
          {guest.last_visit === "" ? "Never" : fmtGuestDay(guest.last_visit, timezone)}
        </Kv>
        <Kv k="Days since">{guest.days_since_last_visit ?? "—"}</Kv>
        {/* Never a bare 0 for "we have no ratings" — the count says which it is. */}
        <Kv k="Guest rating">
          {guest.avg_rating == null || guest.feedbacks === 0
            ? "No feedback yet"
            : `${scoreOf(guest.avg_rating)} / 5 from ${guest.feedbacks}`}
        </Kv>
        {spendBasis !== "" && (
          <p className="mt-3 text-xs text-muted-foreground">{spendBasis}</p>
        )}
      </div>
    </DrillSheet>
  );
}
