"use client";

// THE CLICKABLE STAT STRIP — web copy of `_statStrip` / `_statTile`
// (modules.dart `_WaitlistView`): four figures, all read off data the page
// already holds. "Estimated wait" is deliberately NOT here — GET /waitlist
// carries no turn-time, so it would have been invented. Every tile that
// counts something drills into exactly that set; the Free tile is tappable
// even at zero because "which tables" is the question either way.

import * as React from "react";
import { Clock, Table2, User, Users } from "lucide-react";

import { ForkCard } from "@/components/ui/fork-card";
import { RoundBadge } from "@/components/waitlist/bits";
import { guestCount } from "@/components/waitlist/format";
import type { WaitlistDrill } from "@/components/waitlist/drills";
import type { WaitlistEntry } from "@/lib/db";

function StatTile({
  figure,
  unit,
  caption,
  icon,
  onClick,
}: {
  figure: string;
  unit: string;
  caption: string;
  icon: React.ReactNode;
  onClick?: () => void;
}): React.JSX.Element {
  return (
    <ForkCard
      onClick={onClick}
      interactive={onClick != null}
      chevron={false}
      className="flex items-center gap-3.5 px-4 py-3.5"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate">
          <span className="text-[22px] font-normal leading-none tracking-[-0.02em] text-foreground tabular-nums">
            {figure}
          </span>
          <span className="ml-2 text-[11px] font-medium text-muted-foreground">{unit}</span>
        </div>
        <div className="micro-label mt-1 line-clamp-2 whitespace-normal">{caption}</div>
      </div>
      <RoundBadge>{icon}</RoundBadge>
    </ForkCard>
  );
}

export interface StatStripProps {
  ordered: WaitlistEntry[];
  freeTables: string[];
  onDrill: (drill: WaitlistDrill) => void;
}

export function StatStrip({ ordered, freeTables, onDrill }: StatStripProps): React.JSX.Element {
  const mins = ordered.map((e) => e.minutes_waiting || 0).sort((a, b) => a - b);
  const guests = guestCount(ordered);
  const avg = ordered.length === 0 ? 0 : guests / ordered.length;
  const empty = ordered.length === 0;

  return (
    <div className="grid grid-cols-1 gap-3.5 min-[520px]:grid-cols-2 min-[1240px]:grid-cols-4">
      <StatTile
        figure={String(ordered.length)}
        unit="Groups"
        caption="Current queue"
        icon={<Users />}
        onClick={empty ? undefined : () => { onDrill({ kind: "whole-queue" }); }}
      />
      <StatTile
        figure={
          mins.length === 0
            ? "0"
            : mins[0] === mins[mins.length - 1]
              ? String(mins[0])
              : `${String(mins[0])}–${String(mins[mins.length - 1])}`
        }
        unit="Min"
        caption="Waited so far, shortest to longest"
        icon={<Clock />}
        onClick={empty ? undefined : () => { onDrill({ kind: "longest-waits" }); }}
      />
      <StatTile
        figure={String(freeTables.length)}
        unit="Free"
        caption="Tables ready to seat now"
        icon={<Table2 />}
        onClick={() => { onDrill({ kind: "free-tables" }); }}
      />
      <StatTile
        figure={avg === 0 ? "0" : avg % 1 === 0 ? avg.toFixed(0) : avg.toFixed(1)}
        unit="People"
        caption="Average party size"
        icon={<User />}
        onClick={empty ? undefined : () => { onDrill({ kind: "party-sizes" }); }}
      />
    </div>
  );
}
