"use client";

import * as React from "react";

import { ForkCard } from "@/components/ui/fork-card";
import { SkeletonBox } from "@/components/ui/fork-skeleton";
import { TickTag } from "@/components/ui/tick-tag";
import type { GuestRow, GuestSortKey } from "@/lib/api/customers";
import { customerRankValue } from "@/components/customers/guest-format";

/**
 * One ranking of the whole filtered set (`_leaderCard`). Says so in as many
 * words, because a top-five that silently meant "of the page" would be
 * indistinguishable. The card whose sort matches the active list sort renders
 * selected with a "sorting the list" tag; every row opens that guest's sheet.
 *
 * Per-card states: a failed ranking SAYS it failed — it must not fall back to
 * an empty list, which reads identically to "no guests match" and would hide
 * a broken endpoint.
 */
export function LeaderCard({
  title,
  sortKey,
  activeSort,
  rows,
  error,
  loading,
  money,
  timezone,
  onOpenGuest,
}: {
  title: string;
  sortKey: GuestSortKey;
  activeSort: string;
  rows: GuestRow[];
  error: string | null;
  loading: boolean;
  money: (v: unknown) => string;
  timezone: string;
  onOpenGuest: (guest: GuestRow) => void;
}): React.JSX.Element {
  const selected = sortKey === activeSort;
  return (
    <ForkCard className="px-3.5 py-3" selected={selected}>
      <div className="mb-2 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-[-0.007em] text-foreground">
          {title}
        </span>
        {selected && <TickTag label="sorting the list" />}
      </div>
      {error != null ? (
        <p className="text-xs text-destructive">Couldn&apos;t rank: {error}</p>
      ) : loading && rows.length === 0 ? (
        <SkeletonBox height={84} className="rounded-lg" />
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing to rank under these filters.</p>
      ) : (
        <div>
          {rows.map((row, i) => (
            <button
              key={row.customer_id === "" ? `${sortKey}-${i}` : row.customer_id}
              type="button"
              onClick={() => { onOpenGuest(row); }}
              className="flex w-full items-center gap-2 rounded-[6px] px-1 py-1 text-left transition-colors duration-fast hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="w-[18px] shrink-0 text-[11px] font-semibold text-tertiary tabular-nums">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{row.name}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                {customerRankValue(row, sortKey, money, timezone)}
              </span>
            </button>
          ))}
        </div>
      )}
    </ForkCard>
  );
}
