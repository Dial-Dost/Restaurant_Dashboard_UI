"use client";

// "View order" — the read-back sheet (Flutter order_entry.dart ≈1100–1285,
// finding 17). It is fed by the pad's own draft and calls the pad's own
// handlers; "Send to kitchen" only CLOSES the sheet and asks the pad to send,
// so the sheet can never post on its own (double-post designed out).

import * as React from "react";

import { Button } from "@/components/ui/button";
import { DrillSheet } from "@/components/ui/drill-sheet";
import { ForkCard } from "@/components/ui/fork-card";
import { StatusChip } from "@/components/ui/status-chip";
import { draftSummary, type DraftLine } from "@/lib/api/order-entry";
import { LineControls } from "./line-controls";

export interface ReviewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  lines: DraftLine[];
  showsMoney: boolean;
  /** Formatted total, or null when money is hidden. */
  totalText: string | null;
  money: (raw: unknown) => string;
  facts: { label: string; value: string }[];
  block: string | null;
  sending: boolean;
  onToggleHold: (id: string) => void;
  onEditNote: (id: string) => void;
  onStep: (id: string, delta: number) => void;
  onRemove: (id: string) => void;
  onSend: () => void;
}

export function ReviewSheet(props: ReviewSheetProps): React.JSX.Element {
  const { open, onOpenChange, title, lines, showsMoney, totalText, money, facts, block, sending } = props;
  return (
    <DrillSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Review order · ${title}`}
      description="Read it back to the guest, then send."
      action={(
        <div className="flex w-full gap-2">
          <Button variant="outline" className="flex-1" onClick={() => { onOpenChange(false); }}>Back to menu</Button>
          <Button className="flex-1" disabled={sending || block !== null} onClick={props.onSend}>Send to kitchen</Button>
        </div>
      )}
    >
      <div className="space-y-3">
        <div className="text-sm font-semibold">
          {draftSummary(lines)}{showsMoney && totalText !== null ? ` · ${totalText}` : ""}
        </div>
        {lines.map((l) => (
          <ForkCard key={l.menuId} className="px-3.5 py-2.5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">
                  {`${String(l.quantity)} × ${l.name}`}
                  {l.variationName ? <span className="font-normal text-muted-foreground">{` · ${l.variationName}`}</span> : null}
                </div>
                {showsMoney && l.unitPrice !== null ? (
                  <div className="text-xs tabular-nums text-muted-foreground">{money(l.unitPrice * l.quantity)}</div>
                ) : null}
              </div>
            </div>
            {!l.onMenu || l.held ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {!l.onMenu ? <StatusChip status="danger" label="No longer on the menu" dense /> : null}
                {l.held ? <StatusChip status="warning" label="HOLD" dense /> : null}
              </div>
            ) : null}
            {l.note !== "" ? <div className="mt-1 text-xs italic text-muted-foreground">{l.note}</div> : null}
            <div className="mt-1.5 flex justify-end">
              <LineControls
                name={l.name}
                quantity={l.quantity}
                held={l.held}
                hasNote={l.note !== ""}
                disabled={sending}
                onToggleHold={() => { props.onToggleHold(l.menuId); }}
                onEditNote={() => { props.onEditNote(l.menuId); }}
                onStep={(d) => { props.onStep(l.menuId, d); }}
                onRemove={() => { props.onRemove(l.menuId); }}
              />
            </div>
          </ForkCard>
        ))}
        {facts.length > 0 ? (
          <ForkCard inset className="px-3.5 py-2">
            {facts.map((f) => (
              <div key={f.label} className="flex items-baseline justify-between gap-3 border-b border-divider py-1.5 text-sm last:border-b-0">
                <span className="shrink-0 text-xs text-muted-foreground">{f.label}</span>
                <span className="min-w-0 text-right">{f.value}</span>
              </div>
            ))}
          </ForkCard>
        ) : null}
        {block !== null ? <p className="text-sm font-semibold text-destructive">{block}</p> : null}
      </div>
    </DrillSheet>
  );
}
