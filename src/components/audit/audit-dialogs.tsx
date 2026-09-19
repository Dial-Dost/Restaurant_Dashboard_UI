"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Undo2, User } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { InfoChip } from "@/components/ui/status-chip";
import { keyToPickerDate, pickerDateToKey, type AuditLog } from "@/lib/api/audit-logs";
import { hasText, shortStamp } from "./audit-entry-card";

/* ── Day / range picker ─────────────────────────────────────────────────── */

interface PickerProps {
  mode: "day" | "range" | null;
  /** Bounds as day keys: three years back .. the restaurant's today. */
  first: string;
  last: string;
  seedFrom: string;
  seedTo: string;
  onCancel: () => void;
  onPick: (from: string, to: string) => void;
}

const clampKey = (k: string, lo: string, hi: string): string => (k < lo ? lo : k > hi ? hi : k);

/** "A day…" / "A range…" — a cancelled picker changes nothing. */
export function AuditRangePicker({ mode, first, last, seedFrom, seedTo, onCancel, onPick }: PickerProps): React.JSX.Element {
  const [day, setDay] = useState<Date | undefined>();
  const [range, setRange] = useState<DateRange | undefined>();

  useEffect(() => {
    if (mode === null) { return; }
    const f = clampKey(seedFrom, first, last);
    let t = clampKey(seedTo, first, last);
    if (t < f) { t = f; }
    setDay(keyToPickerDate(f));
    setRange({ from: keyToPickerDate(f), to: keyToPickerDate(t) });
  }, [mode, seedFrom, seedTo, first, last]);

  const fromDate = keyToPickerDate(first);
  const toDate = keyToPickerDate(last);
  const ready = mode === "day" ? day != null : range?.from != null;

  const confirm = (): void => {
    if (mode === "day" && day) {
      const k = pickerDateToKey(day);
      onPick(k, k);
    } else if (mode === "range" && range?.from) {
      onPick(pickerDateToKey(range.from), pickerDateToKey(range.to ?? range.from));
    }
  };

  return (
    <Dialog open={mode !== null} onOpenChange={(o) => { if (!o) { onCancel(); } }}>
      <DialogContent className="w-auto max-w-[calc(100vw-32px)]">
        <DialogHeader>
          <DialogTitle>{mode === "range" ? "Entries between two days" : "Entries from one day"}</DialogTitle>
        </DialogHeader>
        <div className="flex justify-center">
          {mode === "range" ? (
            <Calendar
              mode="range"
              selected={range}
              onSelect={setRange}
              fromDate={fromDate}
              toDate={toDate}
              defaultMonth={range?.from}
            />
          ) : (
            <Calendar
              mode="single"
              selected={day}
              onSelect={setDay}
              fromDate={fromDate}
              toDate={toDate}
              defaultMonth={day}
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button disabled={!ready} onClick={confirm}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Undo confirm ───────────────────────────────────────────────────────── */

interface UndoProps {
  log: AuditLog | null;
  timeZone: string;
  onCancel: () => void;
  onConfirm: (log: AuditLog) => void;
}

export function UndoConfirmDialog({ log, timeZone, onCancel, onConfirm }: UndoProps): React.JSX.Element {
  return (
    <Dialog open={log !== null} onOpenChange={(o) => { if (!o) { onCancel(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Undo this action?</DialogTitle>
          <DialogDescription className="sr-only">Confirm reversing this audited action.</DialogDescription>
        </DialogHeader>
        {log && (
          <div className="space-y-3">
            <div>
              <div className="text-sm font-medium">{log.action}</div>
              {hasText(log.details) && (
                <div className="mt-0.5 text-xs text-muted-foreground">{log.details}</div>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {hasText(log.employee) && <InfoChip icon={<User />} label={log.employee} />}
              <InfoChip icon={<CalendarClock />} label={shortStamp(log.timestamp, timeZone)} />
            </div>
            <p className="text-sm text-muted-foreground">
              This reverses that change and puts the data back the way it was before. Nothing is deleted
              from the trail — the original entry stays, and a new &quot;Undid:&quot; entry is added on top.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => { if (log) { onConfirm(log); } }}>
            <Undo2 /> Undo this action
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
