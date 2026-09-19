"use client";

// THE WAITLIST DRILL-DOWN SHEETS — web copies of `_wholeQueue`,
// `_longestWaits`, `_guestsWaiting`, `_partySizeSpread`, `_freeTablesSheet`,
// `_heldPreorders` and `_partyDetails` (modules.dart `_WaitlistView`). Every
// sheet reads only what the page already fetched, every party line opens that
// party's read-only details (replacing the list sheet, exactly like the
// Flutter pop-then-open), and actions deliberately stay OUT of these sheets.

import * as React from "react";

import { DrillSheet, DrillSheetAction } from "@/components/ui/drill-sheet";
import { SheetRow, SheetTapRow } from "@/components/waitlist/bits";
import {
  guestCount,
  membersOf,
  moneyOf,
  preItemsOf,
} from "@/components/waitlist/format";
import type { PendingPreorderEntry, WaitlistEntry } from "@/lib/db";

/** Which drill sheet is open. */
export type WaitlistDrill =
  | { kind: "whole-queue" }
  | { kind: "longest-waits" }
  | { kind: "guests" }
  | { kind: "party-sizes" }
  | { kind: "free-tables" }
  | { kind: "held-preorders" }
  | { kind: "party"; entry: WaitlistEntry };

export interface WaitlistDrillsProps {
  drill: WaitlistDrill | null;
  onDrillChange: (drill: WaitlistDrill | null) => void;
  /** Everyone still in the queue, in the order the panel shows. */
  ordered: WaitlistEntry[];
  pending: PendingPreorderEntry[];
  freeTables: string[];
  currencySymbol: string;
  /** May this session open the Tables module? Hides the jump outright. */
  canOpenTables: boolean;
  onViewTables: () => void;
}

/** A list of parties whose every line opens that party's details. */
function PartyLines({
  parties,
  valueOf,
  trailingOf,
  onOpenParty,
}: {
  parties: WaitlistEntry[];
  valueOf: (e: WaitlistEntry) => React.ReactNode;
  trailingOf?: (e: WaitlistEntry) => React.ReactNode;
  onOpenParty: (e: WaitlistEntry) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col">
      {parties.map((e) => (
        <SheetTapRow key={e.id} onClick={() => { onOpenParty(e); }}>
          <SheetRow label={e.name} value={valueOf(e)} trailing={trailingOf?.(e)} />
        </SheetTapRow>
      ))}
    </div>
  );
}

export function WaitlistDrills({
  drill,
  onDrillChange,
  ordered,
  pending,
  freeTables,
  currencySymbol,
  canOpenTables,
  onViewTables,
}: WaitlistDrillsProps): React.JSX.Element | null {
  const money = (n: number): string => moneyOf(currencySymbol, n);
  const openParty = (entry: WaitlistEntry): void => { onDrillChange({ kind: "party", entry }); };
  const close = (open: boolean): void => { if (!open) { onDrillChange(null); } };

  if (!drill) { return null; }

  if (drill.kind === "whole-queue") {
    // The whole queue, in order — the figure and the capped panel disagree the
    // moment a ninth party joins, so the tile opens the whole of it.
    return (
      <DrillSheet
        open
        onOpenChange={close}
        eyebrow="In the queue"
        title={`${String(ordered.length)} ${ordered.length === 1 ? "group" : "groups"} waiting`}
      >
        <PartyLines
          parties={ordered}
          valueOf={(e) => `${String(e.minutes_waiting || 0)}m`}
          trailingOf={() => "waited"}
          onOpenParty={openParty}
        />
      </DrillSheet>
    );
  }

  if (drill.kind === "longest-waits") {
    // Who has actually been standing longest — the panel is ordered by
    // POSITION, so this is the only ranking by wait anywhere on the page.
    const by = [...ordered].sort((a, b) => (b.minutes_waiting || 0) - (a.minutes_waiting || 0));
    return (
      <DrillSheet open onOpenChange={close} eyebrow="Waiting longest first" title="Who has waited how long">
        <PartyLines
          parties={by}
          valueOf={(e) => `${String(e.minutes_waiting || 0)}m`}
          trailingOf={(e) => `position ${String(e.position || "–")}`}
          onOpenParty={openParty}
        />
      </DrillSheet>
    );
  }

  if (drill.kind === "guests") {
    return (
      <DrillSheet open onOpenChange={close} eyebrow="In the queue" title={`${String(guestCount(ordered))} guests waiting`}>
        <PartyLines
          parties={ordered}
          valueOf={(e) => String(e.party_size || 1)}
          trailingOf={() => "people"}
          onOpenParty={openParty}
        />
      </DrillSheet>
    );
  }

  if (drill.kind === "party-sizes") {
    // How many groups of each size — an average of 3.4 says nothing about
    // whether the room is pairs or one large booking.
    const counts = new Map<number, number>();
    for (const e of ordered) {
      const n = Math.round(e.party_size || 1);
      const size = n < 1 ? 1 : n;
      counts.set(size, (counts.get(size) ?? 0) + 1);
    }
    const sizes = [...counts.keys()].sort((a, b) => a - b);
    return (
      <DrillSheet open onOpenChange={close} eyebrow="In the queue" title="Party sizes">
        {sizes.map((size) => {
          const groups = counts.get(size) ?? 0;
          return (
            <SheetRow
              key={size}
              label={`${String(size)} ${size === 1 ? "person" : "people"}`}
              value={String(groups)}
              trailing={groups === 1 ? "group" : "groups"}
            />
          );
        })}
      </DrillSheet>
    );
  }

  if (drill.kind === "free-tables") {
    // WHICH tables are free, not just how many — and the way to the floor
    // plan when the answer is "none".
    return (
      <DrillSheet
        open
        onOpenChange={close}
        eyebrow="Right now"
        title={
          freeTables.length === 0
            ? "No table is free"
            : `${String(freeTables.length)} table${freeTables.length === 1 ? "" : "s"} ready`
        }
        action={
          canOpenTables ? (
            <DrillSheetAction
              module="Tables"
              onClick={() => {
                onDrillChange(null);
                onViewTables();
              }}
            />
          ) : undefined
        }
      >
        {freeTables.length === 0 ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Every table is occupied, booked or reserved. Free one on the floor plan and the next party in the
            queue can be seated.
          </p>
        ) : (
          freeTables.map((t) => <SheetRow key={t} label={t} value="Free" />)
        )}
      </DrillSheet>
    );
  }

  if (drill.kind === "held-preorders") {
    // The held lines behind the "pre-orders to confirm" count — what each
    // party actually picked. Read-only; the cards above carry the actions.
    return (
      <DrillSheet open onOpenChange={close} eyebrow="Waiting on a yes or no" title="Held pre-orders">
        {pending.map((raw) => {
          const table = raw.table_name ?? "";
          const items = preItemsOf(raw);
          return (
            <div key={raw.id} className="mb-3.5">
              <div className="text-[13.5px] font-semibold text-foreground">
                {[raw.name, table].filter((s) => s.length > 0).join(" · ")}
              </div>
              {items.map((it) => (
                <SheetRow
                  key={it.id}
                  label={`${it.name} ×${String(Math.round(it.quantity || 1))}`}
                  value={it.price > 0 ? money(it.price) : "—"}
                />
              ))}
            </div>
          );
        })}
      </DrillSheet>
    );
  }

  // Party details — the read-only sheet a row tap / "Party details" opens.
  const e = drill.entry;
  const phone = e.phone ?? "";
  const preItems = preItemsOf(e);
  const members = membersOf(e);
  return (
    <DrillSheet open onOpenChange={close} eyebrow="In the queue" title={e.name}>
      <SheetRow label="Party size" value={String(e.party_size || 1)} />
      <SheetRow label="Phone" value={phone.length === 0 ? "—" : phone} />
      <SheetRow label="Waiting" value={`${String(e.minutes_waiting || 0)}m`} />
      <SheetRow label="Position" value={String(e.position || "–")} />
      {preItems.length > 0 && (
        <>
          <div className="micro-label mt-3.5">Pre-order</div>
          {preItems.map((it) => (
            <SheetRow
              key={it.id}
              label={`${it.name} ×${String(Math.round(it.quantity || 1))}`}
              value={it.price > 0 ? money(it.price) : "—"}
              trailing={it.note && it.note.length > 0 ? it.note : undefined}
            />
          ))}
        </>
      )}
      {members.length > 0 && (
        <>
          <div className="micro-label mt-3.5">Party members</div>
          {members.map((m, i) => (
            <SheetRow key={i} label={m.name || "—"} value={m.phone && m.phone.length > 0 ? m.phone : "—"} />
          ))}
        </>
      )}
    </DrillSheet>
  );
}
