"use client";

// THE UNIFIED "Change stage" PICKER — Flutter's `_changeOrderStatus` dialog
// (modules.dart 13636–13835), the ONLY way a stage is advanced from this
// screen (finding 15): a "NOW" chip (+ "Not barked"), pickable stage cards
// with one-line hints, radio-select + Confirm. Gating: Barked only when
// unbarked and not Pending (a Pending order isn't approved to the kitchen
// yet), Served only when barked, Cancelled only when this session may cancel
// (a Pending decline is everybody's). A cancelled order gets the read-only
// terminal dialog with the lock note; Paid/Closed never opens this at all —
// the caller shows the settled-and-locked toast instead.

import * as React from "react";
import { Check, Circle, CheckCircle2, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ForkCard } from "@/components/ui/fork-card";
import { InfoChip } from "@/components/ui/status-chip";
import { CANCELLED_NOTE, isCancelledStatus, orderIsPending, stageHint } from "@/lib/api/orders";
import { StageChip } from "@/components/orders/order-card";

export interface ChangeStageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The order's current stage label. */
  current: string;
  /** Whether the expo has barked it to the kitchen. */
  barked: boolean;
  /** May this session cancel it (see `cancelKotRoute`); a Pending decline always may. */
  mayCancel: boolean;
  /** Called with the picked stage: "Barked" | "Preparing" | "Served" | "Cancelled". */
  onPick: (stage: string) => void;
  busy?: boolean;
}

export function ChangeStageDialog({ open, onOpenChange, current, barked, mayCancel, onPick, busy = false }: ChangeStageDialogProps): React.JSX.Element {
  const [sel, setSel] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!open) { setSel(null); }
  }, [open]);

  const isPending = orderIsPending(current);
  const cancelled = isCancelledStatus(current);
  const stages: string[] = [
    ...(!barked && !isPending ? ["Barked"] : []),
    "Preparing",
    ...(barked ? ["Served"] : []),
    ...(mayCancel || isPending ? ["Cancelled"] : []),
  ];

  // Cancelled is terminal: no stage options at all — just the note and a way
  // out. The audit-log undo is the only sanctioned reversal.
  if (cancelled) {
    return (
      <Dialog open={open} onOpenChange={(v) => { if (!busy) { onOpenChange(v); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Order stage</DialogTitle>
            <DialogDescription className="sr-only">This order is cancelled and locked.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <span className="micro-label">Now</span>
            <StageChip label={current} />
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-destructive/28 bg-destructive/12 p-3">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-xs leading-snug">{CANCELLED_NOTE}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { onOpenChange(false); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) { onOpenChange(v); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Order stage</DialogTitle>
          <DialogDescription className="sr-only">Pick the stage this order moves to.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <span className="micro-label">Now</span>
          <StageChip label={current} />
          {!barked ? <InfoChip icon={<Circle />} label="Not barked" /> : null}
        </div>
        <div className="space-y-2.5">
          {stages.map((stage) => (
            <ForkCard
              key={stage}
              selected={sel === stage}
              chevron={false}
              onClick={() => { setSel(stage); }}
              className="flex items-center gap-3 p-[14px] py-3"
            >
              <StageChip label={stage} />
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{stageHint(stage)}</span>
              {sel === stage
                ? <CheckCircle2 className="h-4 w-4 shrink-0 text-accent-foreground" />
                : <Circle className="h-4 w-4 shrink-0 text-tertiary" />}
            </ForkCard>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => { onOpenChange(false); }}>Cancel</Button>
          <Button
            size="sm"
            disabled={sel === null || busy}
            className={sel === null ? "opacity-45" : undefined}
            onClick={() => { if (sel !== null) { onPick(sel); } }}
          >
            <Check /> Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
