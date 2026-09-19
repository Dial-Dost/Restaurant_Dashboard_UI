"use client";

// THE TABBED QUEUE PANEL — web copy of `_queuePanel` / `_headerRow` /
// `_entryRow` / `_positionCell` / `_partyCell` / `_actionsMenu` /
// `_viewAllFooter` / `_emptyPanel` / `_reservationsPanel` (modules.dart
// `_WaitlistView`).
//
// Desktop (≥1050px viewport, ≈ the Flutter content-width gate) renders the
// real 8-column table; below that each row unpacks into the stacked record.
// A row TAP only ever opens the read-only party sheet; every action — call,
// seat, no-show, remove — lives in the per-row "…" menu, harmless work on
// top, the two destructive items last and behind a divider.

import * as React from "react";
import {
  ArrowRight,
  Armchair,
  Bell,
  BellRing,
  ChevronUp,
  CircleSlash,
  Clock,
  Ellipsis,
  Hourglass,
  CalendarCheck,
  IdCard,
  Phone,
  User,
  Users,
  Utensils,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { ForkCard } from "@/components/ui/fork-card";
import { InfoChip, StatusChip } from "@/components/ui/status-chip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { membersOf, preItemsOf } from "@/components/waitlist/format";
import { cn } from "@/lib/utils";
import type { WaitlistEntry } from "@/lib/db";

export type WaitlistTab = "queue" | "walkins" | "reservations";

/** The panel lists at most this many rows until "View all waitlist (N)". */
export const PREVIEW_ROWS = 8;

// The queue table's one column spec — header and body share it, which is the
// only reason the columns line up (Flutter `_cols` / `_colWidth` / `_colFlex`).
const GRID =
  "grid grid-cols-[56px_42px_minmax(0,3fr)_minmax(0,3fr)_60px_74px_100px_56px] items-center gap-2";

const COLS = ["Position", "Party", "Name", "Phone", "People", "Wait Time", "Status", "Actions"] as const;

export interface QueuePanelProps {
  ordered: WaitlistEntry[];
  called: WaitlistEntry[];
  tab: WaitlistTab;
  onTabChange: (tab: WaitlistTab) => void;
  showAll: boolean;
  onToggleShowAll: () => void;
  focusId: string | null;
  busyId: string | null;
  onOpenParty: (e: WaitlistEntry) => void;
  onCall: (e: WaitlistEntry) => void;
  onSeat: (e: WaitlistEntry) => void;
  onNoShow: (e: WaitlistEntry) => void;
  onRemove: (e: WaitlistEntry) => void;
  /** May this session open Bookings? Hides the jump outright. */
  canOpenBookings: boolean;
  onOpenBookings: () => void;
}

/** Queue position tile — swaps to the warning bell once the party is called
 *  (Flutter `_positionCell`; the colour transition is the switch). */
function PositionCell({ position, called }: { position: number | string; called: boolean }): React.JSX.Element {
  return (
    <span
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border transition-colors duration-base",
        called ? "border-warning/30 bg-warning/10" : "border-border bg-inset",
      )}
    >
      {called ? (
        <BellRing aria-hidden className="h-[18px] w-[18px] text-warning" />
      ) : (
        <span className="text-[15px] font-semibold text-accent-foreground tabular-nums">{position}</span>
      )}
    </span>
  );
}

/** The Party cell: the icon states pre-order vs plain party, a member-count
 *  pill overlaps the corner, and the tooltip spells both out. */
function PartyCell({ preCount, memberCount }: { preCount: number; memberCount: number }): React.JSX.Element {
  const hasPre = preCount > 0;
  const bits = [
    ...(hasPre ? [`${String(preCount)}-item pre-order`] : []),
    ...(memberCount > 0 ? [`${String(memberCount)} in party`] : []),
  ].join(" · ");
  return (
    <span className="relative inline-flex" title={bits.length > 0 ? bits : undefined}>
      <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-accent-hi/30 bg-accent-hi/10 text-accent-foreground">
        {hasPre ? <Utensils aria-hidden className="h-3.5 w-3.5" /> : <Users aria-hidden className="h-3.5 w-3.5" />}
      </span>
      {memberCount > 0 && (
        <span className="absolute -bottom-0.5 -right-1 rounded-[8px] border border-accent-hi/30 bg-card px-1 text-[9px] font-bold leading-[13px] text-accent-foreground tabular-nums">
          {memberCount}
        </span>
      )}
    </span>
  );
}

/**
 * Every row action, in one menu. Order is the safety rule: destructive items
 * last, behind a divider, never under the cursor when the menu opens. The
 * trigger stops propagation so reaching for the menu never fires the row tap.
 */
function RowActionsMenu({
  entry,
  busy,
  onCall,
  onSeat,
  onOpenParty,
  onNoShow,
  onRemove,
}: {
  entry: WaitlistEntry;
  busy: boolean;
  onCall: (e: WaitlistEntry) => void;
  onSeat: (e: WaitlistEntry) => void;
  onOpenParty: (e: WaitlistEntry) => void;
  onNoShow: (e: WaitlistEntry) => void;
  onRemove: (e: WaitlistEntry) => void;
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={busy}>
        <button
          type="button"
          aria-label="Actions"
          disabled={busy}
          onClick={(ev) => { ev.stopPropagation(); }}
          onKeyDown={(ev) => { ev.stopPropagation(); }}
          className={cn(
            "flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border border-border",
            "text-muted-foreground transition-colors duration-fast hover:border-input hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:text-tertiary",
          )}
        >
          <Ellipsis aria-hidden className="h-[18px] w-[18px]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(ev) => { ev.stopPropagation(); }}>
        {entry.status === "waiting" && (
          <DropdownMenuItem onClick={() => { onCall(entry); }}>
            <Bell aria-hidden className="mr-2 h-4 w-4" /> Call
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className="text-success focus:text-success" onClick={() => { onSeat(entry); }}>
          <Armchair aria-hidden className="mr-2 h-4 w-4" /> Seat
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => { onOpenParty(entry); }}>
          <IdCard aria-hidden className="mr-2 h-4 w-4" /> Party details
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => { onNoShow(entry); }}>
          <CircleSlash aria-hidden className="mr-2 h-4 w-4" /> No-show
        </DropdownMenuItem>
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => { onRemove(entry); }}>
          <X aria-hidden className="mr-2 h-4 w-4" /> Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Shared row shell: divider, focus tint, row tap → party details only. */
function RowShell({
  focused,
  last,
  onOpen,
  className,
  children,
}: {
  focused: boolean;
  last: boolean;
  onOpen: () => void;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "cursor-pointer px-4 py-3 outline-none transition-colors duration-fast",
        "hover:bg-foreground/[0.04] focus-visible:bg-foreground/[0.04]",
        focused && "bg-accent-hi/10",
        !last && "border-b border-divider",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function QueuePanel({
  ordered,
  called,
  tab,
  onTabChange,
  showAll,
  onToggleShowAll,
  focusId,
  busyId,
  onOpenParty,
  onCall,
  onSeat,
  onNoShow,
  onRemove,
  canOpenBookings,
  onOpenBookings,
}: QueuePanelProps): React.JSX.Element {
  const rows = tab === "walkins" ? called : ordered;
  const capped = showAll || rows.length <= PREVIEW_ROWS ? rows : rows.slice(0, PREVIEW_ROWS);
  const caption =
    tab === "walkins"
      ? "Notified — waiting for a table"
      : tab === "reservations"
        ? "Booked ahead, not a walk-in"
        : "Everyone still in the queue";

  const actionProps = { onCall, onSeat, onOpenParty, onNoShow, onRemove };

  const renderRow = (e: WaitlistEntry, index: number, table: boolean): React.JSX.Element => {
    const calledRow = e.status === "called";
    const focused = focusId != null && e.id === focusId;
    const last = index === capped.length - 1 && rows.length <= PREVIEW_ROWS;
    const phone = e.phone ?? "";
    const preItems = preItemsOf(e);
    const members = membersOf(e);
    // Status is never colour alone — the chip always ships its label.
    const chip = (
      <StatusChip
        dense
        label={calledRow ? "Notified" : e.status === "waiting" ? "Waiting" : e.status}
        status={calledRow ? "warning" : e.status === "waiting" ? "info" : "neutral"}
      />
    );

    if (table) {
      return (
        <RowShell key={e.id} focused={focused} last={last} onOpen={() => { onOpenParty(e); }} className={GRID}>
          <span className="flex justify-start">
            <PositionCell position={e.position || "–"} called={calledRow} />
          </span>
          <span className="flex justify-start">
            <PartyCell preCount={preItems.length} memberCount={members.length} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] font-semibold text-foreground">{e.name}</span>
            {focused && (
              <span className="block truncate text-[10.5px] text-accent-foreground">From your notification</span>
            )}
          </span>
          <span className="min-w-0 truncate text-xs text-muted-foreground">{phone.length === 0 ? "—" : phone}</span>
          <span className="text-[13px] text-foreground tabular-nums">{e.party_size || 1}</span>
          <span className="text-[13px] text-foreground tabular-nums">{e.minutes_waiting || 0}m</span>
          <span className="flex min-w-0 justify-start">{chip}</span>
          <span className="flex justify-end">
            <RowActionsMenu entry={e} busy={busyId === e.id} {...actionProps} />
          </span>
        </RowShell>
      );
    }

    // Phone degradation: the row unpacks into a stacked record — every field
    // still here, at full width, in a wrap that can only drop to a new run.
    return (
      <RowShell key={e.id} focused={focused} last={last} onOpen={() => { onOpenParty(e); }}>
        <div className="flex items-center gap-3.5">
          <PositionCell position={e.position || "–"} called={calledRow} />
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-foreground">{e.name}</span>
          <RowActionsMenu entry={e} busy={busyId === e.id} {...actionProps} />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {focused && <InfoChip icon={<BellRing />} label="From your notification" />}
          {chip}
          <InfoChip icon={<Users />} label={`Party of ${String(e.party_size || 1)}`} />
          {phone.length > 0 && <InfoChip icon={<Phone />} label={phone} />}
          <InfoChip icon={<Clock />} label={`${String(e.minutes_waiting || 0)}m waited`} />
          {preItems.length > 0 && <InfoChip icon={<Utensils />} label={`${String(preItems.length)}-item pre-order`} />}
          {members.length > 0 && <InfoChip icon={<User />} label={`${String(members.length)} in party`} />}
        </div>
      </RowShell>
    );
  };

  return (
    <ForkCard className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3.5 gap-y-2 px-4 pb-3 pt-3.5">
        <Tabs value={tab} onValueChange={(v) => { onTabChange(v as WaitlistTab); }}>
          <TabsList>
            <TabsTrigger value="queue">Queue ({ordered.length})</TabsTrigger>
            <TabsTrigger value="walkins">Walk-ins</TabsTrigger>
            <TabsTrigger value="reservations">Reservations</TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="text-[11px] text-muted-foreground">{caption}</span>
      </div>
      <div className="border-t border-divider" />

      {tab === "reservations" ? (
        // Reservations are booked ahead and live in Bookings — this endpoint
        // holds walk-ins only.
        <EmptyState
          icon={<CalendarCheck />}
          title="Reservations are booked ahead"
          caption="This queue holds walk-ins. Tables booked in advance have their own arrival times."
          action={
            canOpenBookings ? (
              <Button size="sm" onClick={onOpenBookings}>
                <ArrowRight /> Open Bookings
              </Button>
            ) : undefined
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Hourglass />}
          title={tab === "walkins" ? "Nobody waiting for a table" : "Queue is empty"}
          caption={
            tab === "walkins"
              ? "Parties you call appear here until you seat them."
              : "Walk-ins who scan the entrance QR appear here in arrival order."
          }
        />
      ) : (
        <>
          {/* ≥1050px: the real table. */}
          <div className="hidden min-[1050px]:block">
            <div className={cn(GRID, "border-b border-divider bg-inset px-4 py-[9px]")}>
              {COLS.map((c, i) => (
                <span
                  key={c}
                  className={cn(
                    "truncate text-[11px] font-semibold uppercase tracking-[0.3px] text-tertiary",
                    i === COLS.length - 1 && "text-right",
                  )}
                >
                  {c}
                </span>
              ))}
            </div>
            {capped.map((e, i) => renderRow(e, i, true))}
          </div>
          {/* Below: the stacked record. */}
          <div className="min-[1050px]:hidden">{capped.map((e, i) => renderRow(e, i, false))}</div>

          {rows.length > PREVIEW_ROWS && (
            <div className="px-4 pb-3 pt-2.5">
              <Button variant="ghost" size="sm" onClick={onToggleShowAll}>
                {showAll ? (
                  <>
                    <ChevronUp /> Show fewer
                  </>
                ) : (
                  <>
                    <ArrowRight /> View all waitlist ({rows.length})
                  </>
                )}
              </Button>
            </div>
          )}
        </>
      )}
    </ForkCard>
  );
}
