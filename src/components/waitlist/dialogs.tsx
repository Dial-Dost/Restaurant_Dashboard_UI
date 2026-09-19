"use client";

// THE WAITLIST DIALOGS — web copies of the Flutter seat table-picker
// (`_seat`'s AlertDialog), `_confirmRemove` and `_PreorderConfirmDialog`
// (modules.dart). Styled dialogs only — no window.confirm anywhere.

import * as React from "react";
import { Table2, Utensils } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InfoChip } from "@/components/ui/status-chip";
import { heldItemCount, heldLineTotal, moneyOf, type PreorderItem } from "@/components/waitlist/format";

/* ── Seat table-picker ───────────────────────────────────────────────── */

export interface SeatTableDialogProps {
  partyName: string;
  partySize: number;
  freeTables: string[];
  onSeat: (tableName: string) => void;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Seat <name> (party of N)" with a full-width Table dropdown pre-selected to
 * the first free table. Only an explicit choice posts — there is no silent
 * default seat (audit 28).
 */
export function SeatTableDialog({
  partyName,
  partySize,
  freeTables,
  onSeat,
  onOpenChange,
}: SeatTableDialogProps): React.JSX.Element {
  const [pick, setPick] = React.useState(freeTables[0] ?? "");
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            Seat {partyName} (party of {partySize})
          </DialogTitle>
          <DialogDescription className="sr-only">Choose the table to seat this party at.</DialogDescription>
        </DialogHeader>
        <div>
          <div className="micro-label mb-1.5">Table</div>
          <Select value={pick} onValueChange={setPick}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Table" />
            </SelectTrigger>
            <SelectContent>
              {freeTables.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" size="sm" onClick={() => { onOpenChange(false); }}>
            Cancel
          </Button>
          <Button size="sm" disabled={pick.length === 0} onClick={() => { onSeat(pick); }}>
            Seat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Remove confirmation ─────────────────────────────────────────────── */

export interface RemoveConfirmDialogProps {
  partyName: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

/** Remove is the one action that takes a guest's place away with no undo —
 *  it always asks first (Flutter `_confirmRemove`). */
export function RemoveConfirmDialog({
  partyName,
  onConfirm,
  onOpenChange,
}: RemoveConfirmDialogProps): React.JSX.Element {
  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {partyName} from the queue?</AlertDialogTitle>
          <AlertDialogDescription>
            They lose their place in line. Use No-show instead if they were called and never turned up.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep them</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Remove</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ── Pre-order review / confirm ──────────────────────────────────────── */

export interface PreorderReviewDialogProps {
  partyName: string;
  tableName: string;
  items: PreorderItem[];
  subtotal: number;
  currencySymbol: string;
  onConfirm: () => void;
  onDecline: () => void;
  /** Dismiss decides NOTHING — the hold stays pending in the list above. */
  onOpenChange: (open: boolean) => void;
}

/**
 * "Send <name>'s pre-order?" — Flutter `_PreorderConfirmDialog`, line for
 * line: table + item-count chips, each held line with the guest's note in
 * italics and its line price, the SUBTOTAL divider row, the re-pricing
 * footnote, and "Let them change it" / "Confirm & send" (disabled when the
 * held list is empty).
 */
export function PreorderReviewDialog({
  partyName,
  tableName,
  items,
  subtotal,
  currencySymbol,
  onConfirm,
  onDecline,
  onOpenChange,
}: PreorderReviewDialogProps): React.JSX.Element {
  const money = (n: number): string => moneyOf(currencySymbol, n);
  const count = heldItemCount(items);
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Send {partyName}&rsquo;s pre-order?</DialogTitle>
          <DialogDescription className="sr-only">Review the held pre-order before it reaches the kitchen.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60dvh] space-y-3.5 overflow-y-auto">
          <div className="flex flex-wrap gap-1.5">
            {tableName.length > 0 && tableName !== "—" && <InfoChip icon={<Table2 />} label={tableName} />}
            <InfoChip icon={<Utensils />} label={`${String(count)} item${count === 1 ? "" : "s"}`} />
          </div>

          <p className="text-xs text-muted-foreground">
            They picked these while waiting. Nothing has gone to the kitchen yet.
          </p>

          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground">The held pre-order is empty.</p>
          ) : (
            <div className="rounded-[10px] border border-border bg-inset px-3.5 py-2">
              {items.map((it) => (
                <div key={it.id} className="flex items-start gap-2.5 py-[5px]">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] text-foreground">
                      {it.name}
                      <span className="text-muted-foreground">&ensp;×{Math.round(it.quantity || 1)}</span>
                    </div>
                    {it.note != null && it.note.length > 0 && (
                      <div className="mt-0.5 text-[11px] italic text-muted-foreground">{it.note}</div>
                    )}
                  </div>
                  <div className="shrink-0 text-[13px] font-semibold text-foreground tabular-nums">
                    {money(heldLineTotal(it))}
                  </div>
                </div>
              ))}
              {subtotal > 0 && (
                <>
                  <div className="my-1.5 border-t border-divider" />
                  <div className="flex items-center justify-between py-1">
                    <span className="micro-label">Subtotal</span>
                    <span className="text-[13px] font-semibold text-foreground tabular-nums">{money(subtotal)}</span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* True of the server: it re-prices from the menu on confirm. */}
          <p className="text-[11px] text-tertiary">Prices are re-checked against the menu when you confirm.</p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" size="sm" onClick={onDecline}>
            Let them change it
          </Button>
          <Button size="sm" disabled={items.length === 0} onClick={onConfirm}>
            Confirm &amp; send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
