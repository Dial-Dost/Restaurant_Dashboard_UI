"use client";

// EVERY CANCEL IS PROMPTED FOR A REASON — Flutter's `_cancelOrder` /
// `misVoidOrder` / `misCancelReason` (modules.dart 14631, mis_capture.dart
// 961–1063), findings 15 & 17. The PROMPT is unconditional; the ROUTE depends
// on what this session holds (`cancelKotRoute`):
//
//   'void'   — POST /orders/:id/void: kind + reason + authoriser, the strict
//              record the Void KOT report reads.
//   'status' — PATCH /orders/:id/status {Cancelled, reason, cancel_kind}: the
//              everyday cancel (and a waiter's Decline on a Pending ticket).
//
// Backing out cancels nothing. There is no bare Delete on this screen.

import * as React from "react";
import { Ban, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { voidOrderWithReason } from "@/lib/db";
import { CANCEL_KINDS } from "@/lib/api/payment";
import { Pill } from "@/components/payment/capture-reason-dialog";
import { cancelOrderViaStatus, type Order } from "@/lib/api/orders";

export type CancelRoute = "void" | "status";

export interface CancelOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  order: Order;
  route: CancelRoute;
  /** "₹840.00" for sessions that see money, "" for a waiter (no headline). */
  value: string;
  /** True for a Pending decline — never ticketed. */
  pending: boolean;
  /** Suggested authoriser for the void form (this session's username). */
  suggestedAuthoriser?: string;
  /** Called after the order really was cancelled. */
  onCancelled: () => void;
}

export function CancelOrderDialog({
  open, onOpenChange, restaurantId, order, route, value, pending, suggestedAuthoriser, onCancelled,
}: CancelOrderDialogProps): React.JSX.Element {
  const { toast } = useToast();
  const [kind, setKind] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [authorisedBy, setAuthorisedBy] = React.useState(suggestedAuthoriser ?? "");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setKind("");
      setReason("");
      setAuthorisedBy(suggestedAuthoriser ?? "");
    }
  }, [open, suggestedAuthoriser]);

  const isVoid = route === "void";
  const what = pending ? "this pending order" : "this order";
  const canSubmit = kind !== "" && reason.trim() !== "" && (!isVoid || authorisedBy.trim() !== "");

  const submit = async (): Promise<void> => {
    if (!canSubmit) { return; }
    setBusy(true);
    try {
      if (isVoid) {
        await voidOrderWithReason(restaurantId, order.id, {
          void_kind: kind,
          reason: reason.trim(),
          authorised_by: authorisedBy.trim(),
        });
        toast({ title: "Order voided, with the reason recorded." });
      } else {
        await cancelOrderViaStatus(restaurantId, order.id, reason.trim(), kind);
        toast({ title: pending ? "Order declined, with the reason recorded." : "Order cancelled, with the reason recorded." });
      }
      onOpenChange(false);
      onCancelled();
    } catch (e) {
      // The server's own sentence, verbatim — it is written to be acted on.
      toast({ title: isVoid ? "Order not voided" : "Order not cancelled", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) { onOpenChange(v); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-destructive">
            {isVoid ? "Void order" : "Cancel order"}{value ? ` · ${value}` : ""}
          </DialogTitle>
          <DialogDescription>
            {isVoid
              ? `Voiding ${what} is final — it cannot be un-cancelled from this screen. The reason and both names go on the Void KOT report.`
              : `Cancelling ${what} stops the kitchen and takes it off the bill. A reason is required before it can be processed, and it is printed on the cancellation slip that goes to the pass.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="micro-label">What happened</div>
            {/* Pills (Flutter's _CapturePill row), never free text: each value
                mirrors a CHECK constraint; sent as void_kind / cancel_kind. */}
            <div className="flex flex-wrap gap-2">
              {CANCEL_KINDS.map((k) => (
                <Pill key={k.value} selected={kind === k.value} disabled={busy} onClick={() => { setKind(k.value); }}>{k.label}</Pill>
              ))}
            </div>
            {kind !== "" ? (
              <p className="text-xs text-muted-foreground">{CANCEL_KINDS.find((k) => k.value === kind)?.hint}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">Reason</Label>
            <Textarea
              id="cancel-reason"
              rows={2}
              placeholder="Say what happened, in your own words."
              value={reason}
              onChange={(e) => { setReason(e.target.value); }}
            />
          </div>
          {isVoid ? (
            <div className="space-y-1.5">
              <Label htmlFor="cancel-authoriser">Authorised by</Label>
              <Input
                id="cancel-authoriser"
                placeholder="Who signed off on this void"
                value={authorisedBy}
                onChange={(e) => { setAuthorisedBy(e.target.value); }}
              />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => { onOpenChange(false); }}>Keep the order</Button>
          <Button variant="destructive" size="sm" disabled={!canSubmit || busy} onClick={() => { void submit(); }}>
            {busy ? <Loader2 className="animate-spin" /> : <Ban />}
            {isVoid ? "Void it" : "Cancel it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
