"use client";

/**
 * EXPO / PASS VIEW — one card per active table with ready-vs-pending counts
 * and item chips coloured by state (green served / amber preparing / grey
 * held or un-barked), the state always labelled, never colour alone. The web
 * `_ExpoView` (restaurant_owner_app modules.dart).
 */

import * as React from "react";
import { Inbox } from "lucide-react";

import type { KitchenExpoItem, KitchenExpoTable } from "@/lib/api/kitchen";
import { EmptyState } from "@/components/ui/empty-state";
import { ForkCard } from "@/components/ui/fork-card";
import { StatusChip } from "@/components/ui/status-chip";

export interface ExpoBoardProps {
  tables: KitchenExpoTable[];
}

export function ExpoBoard({ tables }: ExpoBoardProps): React.JSX.Element {
  if (tables.length === 0) {
    return <EmptyState icon={<Inbox />} title="Nothing to show" caption="No active tables on the pass." />;
  }
  return (
    // Same coarse tiling as the ticket board: a pass card is read the same way
    // a ticket is, and every item chip stays on it (14px gutter, equal rows).
    <div className="grid grid-cols-1 items-stretch gap-3.5 min-[1100px]:grid-cols-2 min-[1620px]:grid-cols-3">
      {tables.map((t) => (
        <ForkCard key={t.table} className="p-4">
          <div className="flex items-center gap-1.5">
            <div className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground gaia:font-serif">
              Table {t.table}
            </div>
            <StatusChip dense status="success" label={`${t.ready_count} ready`} className="shrink-0" />
            <StatusChip
              dense
              status={t.pending_count > 0 ? "warning" : "neutral"}
              label={`${t.pending_count} pending`}
              className="shrink-0"
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {t.items.map((item, idx) => (
              <ExpoChip key={idx} item={item} />
            ))}
          </div>
        </ForkCard>
      ))}
    </div>
  );
}

/**
 * Per-item pass chip — a tinted pill whose state always ships with a label
 * (· HOLD / · NOT BARKED), never colour alone.
 */
function ExpoChip({ item }: { item: KitchenExpoItem }): React.JSX.Element {
  const token =
    item.status === "served"
      ? "--success"
      : item.status === "held" || item.status === "unbarked"
        ? "--neutral"
        : "--warning";
  const station = (item.station ?? "").trim();
  const label =
    `${item.qty}× ${item.name}` +
    (station !== "" ? ` · ${station.toUpperCase()}` : "") +
    (item.status === "held" ? " · HOLD" : item.status === "unbarked" ? " · NOT BARKED" : "");
  return (
    <span
      className="inline-flex min-w-0 max-w-full items-center rounded-full border px-[9px] py-1 text-[11px] font-semibold tracking-[0.2px]"
      style={{
        background: `color-mix(in srgb, hsl(var(${token})) 12%, transparent)`,
        borderColor: `color-mix(in srgb, hsl(var(${token})) 28%, transparent)`,
        color: `color-mix(in srgb, hsl(var(${token})) 75%, hsl(var(--status-lift)))`,
      }}
    >
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}
