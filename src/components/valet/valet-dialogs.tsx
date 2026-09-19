"use client";

// The small dialogs behind the valet board's actions — web twins of Flutter
// `_ValetCheckInDialog`, the "Assign bay" SimpleDialog, and the Location /
// Condition / Charge / Add-bay AlertDialogs in `valetModule` (modules.dart).
// Each one only collects input; the page posts and refetches.

import * as React from "react";
import { Camera, Check } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ValetBay } from "./valet-model";

const NO_BAY = "__none__";

/* ── Check in ─────────────────────────────────────────────────────────── */

export interface CheckInPayload { number_plate: string; customer_name?: string; bay_id?: string }

export function CheckInDialog({
  bays, initialBayId, onClose, onSubmit, onScan,
}: {
  bays: ValetBay[];
  initialBayId?: string | null;
  onClose: () => void;
  onSubmit: (p: CheckInPayload) => void;
  /** Reads a plate from a photo; null = nothing readable. */
  onScan: (file: File) => Promise<string | null>;
}): React.JSX.Element {
  const [plate, setPlate] = React.useState("");
  const [name, setName] = React.useState("");
  // Only honour a pre-selected bay that is still in the list.
  const [bayId, setBayId] = React.useState<string>(() =>
    initialBayId && bays.some((b) => String(b.Bay_id) === initialBayId) ? initialBayId : NO_BAY,
  );
  const [reading, setReading] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  const submit = (): void => {
    const p = plate.trim().toUpperCase();
    if (!p) { return; } // empty plate = silent no-op, like the app
    const out: CheckInPayload = { number_plate: p };
    if (name.trim()) { out.customer_name = name.trim(); }
    if (bayId !== NO_BAY) { out.bay_id = bayId; }
    onSubmit(out);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) { onClose(); } }}>
      <DialogContent className="sm:max-w-[360px]">
        <DialogHeader>
          <div className="micro-label">VALET</div>
          <DialogTitle>Check in vehicle</DialogTitle>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="grid gap-1">
            <Label htmlFor="valet-plate">Number plate</Label>
            <Input
              id="valet-plate"
              autoFocus
              autoCapitalize="characters"
              className="font-mono uppercase tracking-[0.12em]"
              value={plate}
              onChange={(e) => { setPlate(e.target.value.toUpperCase()); }}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {reading ? "Reading the photo…" : "Or capture it with the camera"}
            </span>
            <Button type="button" size="sm" variant="outline" disabled={reading} onClick={() => fileRef.current?.click()}>
              <Camera className="mr-1 h-4 w-4" />
              {reading ? "Reading…" : "Scan plate"}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) { return; }
                setReading(true);
                void onScan(f)
                  .then((p) => { if (p) { setPlate(p); } })
                  .finally(() => { setReading(false); });
              }}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="valet-name">Customer name (optional)</Label>
            <Input id="valet-name" value={name} onChange={(e) => { setName(e.target.value); }} />
          </div>
          {bays.length > 0 && (
            <div className="grid gap-1">
              <Label>Bay (optional)</Label>
              <Select value={bayId} onValueChange={setBayId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_BAY}>No bay</SelectItem>
                  {bays.map((b) => (
                    <SelectItem key={String(b.Bay_id)} value={String(b.Bay_id)}>{b.Bay_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter className="mt-1 gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit"><Check className="mr-1 h-4 w-4" />Check in</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── Assign bay ───────────────────────────────────────────────────────── */

export function AssignBayDialog({
  bays, onClose, onPick,
}: { bays: ValetBay[]; onClose: () => void; onPick: (bayId: string) => void }): React.JSX.Element {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) { onClose(); } }}>
      <DialogContent className="sm:max-w-[320px]">
        <DialogHeader><DialogTitle>Assign bay</DialogTitle></DialogHeader>
        <div className="grid gap-1">
          {bays.map((b) => (
            <button
              key={String(b.Bay_id)}
              type="button"
              onClick={() => { onPick(String(b.Bay_id)); }}
              className="rounded-md px-3 py-2.5 text-left text-sm transition-colors duration-fast hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {b.Bay_name}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Parking location ─────────────────────────────────────────────────── */

export function LocationDialog({
  initial, onClose, onSave,
}: { initial: string; onClose: () => void; onSave: (v: string) => void }): React.JSX.Element {
  const [v, setV] = React.useState(initial);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) { onClose(); } }}>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader><DialogTitle>Parking location</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); onSave(v.trim()); }}>
          <Input autoFocus placeholder="e.g. P2 / Level 1 / Slot 14" aria-label="Parking location" value={v} onChange={(e) => { setV(e.target.value); }} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── Condition ────────────────────────────────────────────────────────── */

export function ConditionDialog({
  initial, onClose, onSave,
}: { initial: string; onClose: () => void; onSave: (notes: string, photo: File | null) => void }): React.JSX.Element {
  const [notes, setNotes] = React.useState(initial);
  const [photo, setPhoto] = React.useState<File | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) { onClose(); } }}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader><DialogTitle>Vehicle condition</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); onSave(notes.trim(), photo); }}>
          <Textarea rows={3} autoFocus placeholder="Notes (scratches, dents...)" aria-label="Notes" value={notes} onChange={(e) => { setNotes(e.target.value); }} />
          <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => fileRef.current?.click()}>
            <Camera className="mr-1 h-4 w-4" />
            {photo ? "Photo attached" : "Attach photo (optional)"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => { setPhoto(e.target.files?.[0] ?? null); e.target.value = ""; }}
          />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── Charge to table ──────────────────────────────────────────────────── */

export function ChargeDialog({
  tables, onClose, onCharge,
}: { tables: string[]; onClose: () => void; onCharge: (table: string, amount: number | null) => void }): React.JSX.Element {
  const [table, setTable] = React.useState(tables[0] ?? "");
  const [amount, setAmount] = React.useState("");
  return (
    <Dialog open onOpenChange={(o) => { if (!o) { onClose(); } }}>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader><DialogTitle>Charge valet fee to table</DialogTitle></DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(amount.trim());
            onCharge(table, amount.trim() && Number.isFinite(n) ? n : null);
          }}
        >
          <div className="grid gap-1">
            <Label>Occupied table</Label>
            <Select value={table} onValueChange={setTable}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {tables.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="valet-fee">Fee amount</Label>
            <Input id="valet-fee" autoFocus inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); }} />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Charge</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── Add bay ──────────────────────────────────────────────────────────── */

export function AddBayDialog({
  onClose, onAdd,
}: { onClose: () => void; onAdd: (name: string, capacity: number) => void }): React.JSX.Element {
  const [name, setName] = React.useState("");
  const [cap, setCap] = React.useState("10");
  return (
    <Dialog open onOpenChange={(o) => { if (!o) { onClose(); } }}>
      <DialogContent className="sm:max-w-[360px]">
        <DialogHeader><DialogTitle>Add parking bay</DialogTitle></DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => { e.preventDefault(); onAdd(name.trim(), Math.trunc(Number(cap.trim())) || 0); }}
        >
          <div className="grid gap-1">
            <Label htmlFor="bay-name">Bay name (e.g. Front Lot)</Label>
            <Input id="bay-name" autoFocus value={name} onChange={(e) => { setName(e.target.value); }} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="bay-cap">Capacity</Label>
            <Input id="bay-cap" inputMode="numeric" value={cap} onChange={(e) => { setCap(e.target.value); }} />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Add</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
