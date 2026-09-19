"use client";

// The per-dish controls shared by the menu row and the review sheet (Flutter
// order_entry.dart ≈1010–1040 / ≈1230–1270): hold ✋, note, − qty +, and in
// the review a trash "Remove from order". Both surfaces call the pad's own
// handlers, so they can never disagree.

import * as React from "react";
import { Hand, Minus, Plus, StickyNote, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface LineControlsProps {
  name: string;
  quantity: number;
  held: boolean;
  hasNote: boolean;
  disabled: boolean;
  onToggleHold: () => void;
  onEditNote: () => void;
  onStep: (delta: number) => void;
  onRemove?: () => void;
}

export function LineControls(props: LineControlsProps): React.JSX.Element {
  const { name, quantity, held, hasNote, disabled, onToggleHold, onEditNote, onStep, onRemove } = props;
  const holdTip = held ? "Course held — tap to release" : "Hold course (fire later from the KDS)";
  const noteTip = hasNote ? "Edit note" : "Add note";
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("h-8 w-8", held ? "text-warning" : "text-muted-foreground")}
        aria-pressed={held}
        aria-label={`${holdTip} — ${name}`}
        title={holdTip}
        disabled={disabled}
        onClick={onToggleHold}
      >
        <Hand />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("h-8 w-8", hasNote ? "text-accent-hi" : "text-muted-foreground")}
        aria-label={`${noteTip} — ${name}`}
        title={noteTip}
        disabled={disabled}
        onClick={onEditNote}
      >
        <StickyNote />
      </Button>
      <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label={`One fewer ${name}`} title="One fewer" disabled={disabled} onClick={() => { onStep(-1); }}>
        <Minus />
      </Button>
      <span className="w-7 text-center text-sm font-semibold tabular-nums" aria-live="polite">{quantity}</span>
      <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label={`One more ${name}`} title="One more" disabled={disabled} onClick={() => { onStep(1); }}>
        <Plus />
      </Button>
      {onRemove ? (
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label={`Remove ${name} from order`} title="Remove from order" disabled={disabled} onClick={onRemove}>
          <Trash2 />
        </Button>
      ) : null}
    </div>
  );
}
