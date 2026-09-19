"use client";

import * as React from "react";
import { Tag } from "lucide-react";

import { ForkCard } from "@/components/ui/fork-card";
import { MicroStat } from "@/components/ui/micro-stat";
import { InfoChip } from "@/components/ui/status-chip";
import type { GuestRow } from "@/lib/api/customers";
import { InitialsAvatar } from "@/components/customers/guest-bits";
import { customerSegmentLabel, fmtGuestDay, guestInitials } from "@/components/customers/guest-format";

/**
 * One guest in the grid (`_guestCard`): avatar + name + phone, the three
 * MicroStats — Spent / Visits / Last — wrapped rather than spaced across a
 * row (a lifetime spend can run to seven figures), then the neutral segment
 * chip. The whole card is the tap target and opens the guest sheet.
 */
export function GuestCard({
  guest,
  money,
  timezone,
  onOpen,
}: {
  guest: GuestRow;
  money: (v: unknown) => string;
  timezone: string;
  onOpen: (guest: GuestRow) => void;
}): React.JSX.Element {
  const segmentLabel = customerSegmentLabel(guest.segment);
  return (
    <ForkCard
      className="px-3.5 py-3"
      onClick={() => { onOpen(guest); }}
      aria-label={`Open ${guest.name}`}
    >
      <div className="flex items-center gap-3 pr-4">
        <InitialsAvatar initials={guestInitials(guest.name)} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold tracking-[-0.007em] text-foreground gaia:font-serif gaia:text-[15px] gaia:font-medium">
            {guest.name}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {guest.phone === "" ? "—" : guest.phone}
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-2">
        <MicroStat value={money(guest.total_spend)} label="Spent" />
        <MicroStat value={String(guest.visits)} label="Visits" />
        <MicroStat
          value={guest.last_visit === "" ? "never" : fmtGuestDay(guest.last_visit, timezone)}
          label="Last"
        />
      </div>
      {guest.segment !== "" && guest.segment !== "—" && (
        <div className="mt-2">
          <InfoChip icon={<Tag />} label={segmentLabel} />
        </div>
      )}
    </ForkCard>
  );
}
