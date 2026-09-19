"use client";

import * as React from "react";
import { Check, Info, Link2, SlidersHorizontal, Square, SquareCheck, Table2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  SeatingCombination,
  SeatingSuggestion,
  SeatingSuggestionTable,
} from "@/lib/db";
import type { RoomTable } from "@/lib/api/bookings";
import { seatsLabel } from "@/components/bookings/booking-format";

/*
 * The three table-choice surfaces of the Bookings module, mirrored from
 * modules.dart:
 *
 *  - SingleTableDialog       "Table for N" — a single free table fits, plain
 *                            one-tap choice, least friction.
 *  - SeatingSuggestionDialog "Party of N needs X tables — combine T1 + T2?"
 *                            — the server's best clubbing highlighted with
 *                            Accept, runners-up under "Other options", and a
 *                            manual override across every free table.
 *  - PlainTablePickDialog    "Assign to table" — every room table with its
 *                            free/occupied read-out; the assign flow's
 *                            fallback when the suggester is unusable.
 *
 * None of them decide anything on their own: closing a dialog picks nothing.
 */

export function SingleTableDialog({
  open,
  party,
  singles,
  onPick,
  onOpenChange,
}: {
  open: boolean;
  party: number;
  singles: SeatingSuggestionTable[];
  onPick: (names: string[]) => void;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle>Table for {party}</DialogTitle>
          <DialogDescription className="sr-only">
            Free tables that can take this party at that time.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col">
          {singles.map((t) => (
            <button
              key={t.table_id || t.table_name}
              type="button"
              onClick={() => { onPick([t.table_name]); }}
              className="flex items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors duration-fast hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Table2 aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{t.table_name}</span>
              <span className="shrink-0 text-[11.5px] text-muted-foreground">{seatsLabel(t)}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const namesOf = (combo: SeatingCombination): string[] =>
  combo.table_names.filter((n) => n.length > 0);

function ComboCard({
  combo,
  party,
  primary,
  onUse,
}: {
  combo: SeatingCombination;
  party: number;
  primary: boolean;
  onUse: (names: string[]) => void;
}): React.JSX.Element {
  const names = namesOf(combo);
  const seats = combo.total_capacity;
  return (
    <div
      className={cn(
        "mb-2 flex items-center gap-2.5 rounded-lg border p-3",
        primary
          ? "border-[hsl(var(--primary)/0.28)] bg-[hsl(var(--primary)/0.12)]"
          : "border-border bg-inset",
      )}
    >
      {names.length > 1
        ? <Link2 aria-hidden className={cn("h-4 w-4 shrink-0", primary ? "text-accent-foreground" : "text-muted-foreground")} />
        : <Table2 aria-hidden className={cn("h-4 w-4 shrink-0", primary ? "text-accent-foreground" : "text-muted-foreground")} />}
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-[13.5px] font-semibold", primary ? "text-accent-foreground" : "text-foreground")}>
          {names.join(" + ")}
        </div>
        <div className="mt-0.5 text-[11.5px] text-muted-foreground">
          {seats} seats · party of {party}
        </div>
      </div>
      {primary ? (
        <Button size="sm" onClick={() => { onUse(names); }}>
          <Check /> Accept
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => { onUse(names); }}>
          Use
        </Button>
      )}
    </div>
  );
}

export function SeatingSuggestionDialog({
  open,
  suggestion,
  party,
  onPick,
  onOpenChange,
}: {
  open: boolean;
  suggestion: SeatingSuggestion;
  party: number;
  onPick: (names: string[]) => void;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  // Staff asked to pick their own tables instead of taking a suggestion.
  const [override, setOverride] = React.useState(false);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());

  // A fresh open starts on the suggestions, nothing picked.
  React.useEffect(() => {
    if (open) {
      setOverride(false);
      setPicked(new Set());
    }
  }, [open]);

  const combos = suggestion.combinations;
  const best = combos.length > 0 ? combos[0] : null;
  const free = suggestion.free_tables;
  const noneReason = (suggestion.none_reason ?? "").trim();
  const unnumbered = suggestion.unnumbered_free_tables;

  // Free tables in server order, filtered to the manual selection.
  const pickedInOrder = free
    .map((t) => t.table_name)
    .filter((n) => n.length > 0 && picked.has(n));
  const pickedSeats = free
    .filter((t) => picked.has(t.table_name))
    .reduce((sum, t) => sum + (t.max_capacity || t.capacity || 0), 0);

  const toggle = (name: string): void => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) { next.delete(name); } else { next.add(name); }
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>
            {best == null
              ? `No table fits a party of ${party}`
              : `Party of ${party} needs ${namesOf(best).length} tables`}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Seating suggestion — accept a combination or pick tables manually.
          </DialogDescription>
        </DialogHeader>
        <div>
          {best != null ? (
            <>
              <p className="mb-2.5 text-sm text-muted-foreground">
                Combine {namesOf(best).join(" + ")}?
              </p>
              <ComboCard combo={best} party={party} primary onUse={onPick} />
              {combos.length > 1 && (
                <>
                  <div className="micro-label mb-1.5 mt-1.5">Other options</div>
                  {combos.slice(1).map((c) => (
                    <ComboCard
                      key={namesOf(c).join("|")}
                      combo={c}
                      party={party}
                      primary={false}
                      onUse={onPick}
                    />
                  ))}
                </>
              )}
            </>
          ) : (
            // The server's own words for why nothing fits — never one we invent.
            <div className="flex items-start gap-2.5 rounded-lg border border-warning/28 bg-warning/12 p-3">
              <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p className="min-w-0 text-xs text-foreground">
                {noneReason.length === 0 || noneReason === "—"
                  ? `No free table or adjacent group can seat ${party} at that time.`
                  : noneReason}
              </p>
            </div>
          )}

          {unnumbered.length > 0 && best == null && (
            <p className="mt-2 text-[11.5px] text-tertiary">
              {unnumbered.join(", ")} cannot be clubbed automatically — no number in the name.
            </p>
          )}

          <div className="mt-3">
            {!override ? (
              <Button variant="outline" size="sm" onClick={() => { setOverride(true); }}>
                <SlidersHorizontal /> {best == null ? "Choose tables manually" : "Choose different tables"}
              </Button>
            ) : (
              <>
                <div className="micro-label mb-1.5">Free tables</div>
                {free.length === 0 ? (
                  <p className="text-xs text-destructive">No tables are free for this slot.</p>
                ) : (
                  <>
                    {free.map((t) => {
                      const on = picked.has(t.table_name);
                      return (
                        <button
                          key={t.table_id || t.table_name}
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          onClick={() => { toggle(t.table_name); }}
                          className="flex w-full items-center gap-2.5 rounded-md px-1 py-1.5 text-left transition-colors duration-fast hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {on
                            ? <SquareCheck aria-hidden className="h-[18px] w-[18px] shrink-0 text-accent-foreground" />
                            : <Square aria-hidden className="h-[18px] w-[18px] shrink-0 text-tertiary" />}
                          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-foreground">
                            {t.table_name}
                          </span>
                          <span className="shrink-0 text-[11.5px] text-muted-foreground">{seatsLabel(t)}</span>
                        </button>
                      );
                    })}
                    <div className="mt-2.5 flex items-center gap-2.5">
                      <p
                        className={cn(
                          "min-w-0 flex-1 text-[11.5px]",
                          pickedInOrder.length > 0 && pickedSeats < party
                            ? "text-warning"
                            : "text-muted-foreground",
                        )}
                      >
                        {pickedInOrder.length === 0
                          ? "Pick one or more tables."
                          : `${pickedInOrder.join(" + ")} · ${pickedSeats} seats for ${party}`}
                      </p>
                      <Button
                        size="sm"
                        disabled={pickedInOrder.length === 0}
                        onClick={() => { onPick(pickedInOrder); }}
                      >
                        <Check /> Assign
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => { onOpenChange(false); }}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PlainTablePickDialog({
  open,
  tables,
  onPick,
  onOpenChange,
}: {
  open: boolean;
  tables: RoomTable[];
  onPick: (name: string) => void;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle>Assign to table</DialogTitle>
          <DialogDescription className="sr-only">
            Every room table, with whether it is currently free.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col">
          {tables.map((t) => (
            <button
              key={t.table_name}
              type="button"
              onClick={() => { onPick(t.table_name); }}
              className="flex items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors duration-fast hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Table2
                aria-hidden
                className={cn("h-[18px] w-[18px] shrink-0", t.occupied ? "text-destructive" : "text-success")}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                {t.table_name}
              </span>
              <span className={cn("shrink-0 text-[11px]", t.occupied ? "text-destructive" : "text-success")}>
                {t.occupied ? "occupied" : "free"}
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
