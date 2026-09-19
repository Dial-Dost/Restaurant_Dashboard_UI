"use client";

import * as React from "react";
import { Clock, Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MOBILE_10_ERROR, normalizeMobile10, PHONE_INPUT_PROPS, sanitizePhoneInput } from "@/lib/phone";
import { daysAgoInZone, utcToWallClockInZone, wallClockToUtcInZone } from "@/lib/tz";
import { useTimezone } from "@/lib/use-timezone";

/** What the form pops on "Choose table" (the Flutter dialog's result map). */
export interface NewBookingForm {
  name: string;
  /** Normalised to bare 10 digits. */
  phone: string;
  party: number;
  /** UTC instant of the restaurant-wall-clock the staff picked. */
  atIso: string;
  source: string;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** "YYYY-MM-DD" + n days, plain-date arithmetic (no DST drift). */
const addDaysToKey = (key: string, days: number): string => {
  const [y, m, d] = key.split("-").map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d, 12));
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return `${anchor.getUTCFullYear()}-${pad2(anchor.getUTCMonth() + 1)}-${pad2(anchor.getUTCDate())}`;
};

/** A "YYYY-MM-DD" key as a local Date (noon, so the calendar can't day-shift). */
const keyToDate = (key: string): Date => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
};

const dateToKey = (date: Date): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

/** "dd/mm/yy" from a "YYYY-MM-DD" key. */
const dmyOfKey = (key: string): string => {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y.slice(-2)}`;
};

/**
 * The "New booking" form (modules.dart `_NewBookingDialog`): who, how many,
 * when. Table choice happens AFTER this dialog, driven by the seating
 * suggester, so the form never offers a table the party cannot use — the
 * submit is literally "Choose table".
 *
 * The date/time is the RESTAURANT's wall clock (rendered and validated in the
 * tenant zone), date pickable from yesterday to +90 days, defaulting to the
 * next full hour — the common "they are on the phone now" case books for
 * later today.
 */
export function NewBookingDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (form: NewBookingForm) => void;
}): React.JSX.Element {
  const { timezone } = useTimezone();

  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [party, setParty] = React.useState(2);
  const [day, setDay] = React.useState("");
  const [time, setTime] = React.useState("00:00");
  const [source, setSource] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  const [whenOpen, setWhenOpen] = React.useState(false);

  // Each open is a fresh dialog (Flutter constructs a new one every time).
  React.useEffect(() => {
    if (!open) { return; }
    setName("");
    setPhone("");
    setParty(2);
    setSource("");
    setErr(null);
    setWhenOpen(false);
    const wall = utcToWallClockInZone(new Date(), timezone); // "YYYY-MM-DDTHH:mm"
    const [nowDay, nowClock] = wall.split("T");
    const nextHour = Number(nowClock.slice(0, 2)) + 1;
    if (nextHour > 23) {
      setDay(addDaysToKey(nowDay, 1));
      setTime("00:00");
    } else {
      setDay(nowDay);
      setTime(`${pad2(nextHour)}:00`);
    }
  }, [open, timezone]);

  // Bookable window: yesterday .. +90 days, in the restaurant's calendar.
  const minDay = daysAgoInZone(1, timezone);
  const maxDay = daysAgoInZone(-90, timezone);

  const save = (): void => {
    const trimmedName = name.trim();
    // Same rule POST /add-booking enforces server-side: exactly 10 digits
    // once formatting (and a 91/0 prefix) is stripped.
    const normalizedPhone = normalizeMobile10(phone);
    if (trimmedName.length === 0) { setErr("Customer name is required"); return; }
    if (normalizedPhone == null) { setErr(MOBILE_10_ERROR); return; }
    const instant = day ? wallClockToUtcInZone(`${day}T${time}`, timezone) : null;
    if (!instant || instant.getTime() < Date.now() - 60_000) {
      setErr("Pick a future date and time");
      return;
    }
    onSubmit({
      name: trimmedName,
      phone: normalizedPhone,
      party,
      atIso: instant.toISOString(),
      source: source.trim(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>New booking</DialogTitle>
          <DialogDescription className="sr-only">
            Who, how many and when — the table is chosen next.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="nb-name">Customer name</Label>
            <Input
              id="nb-name"
              value={name}
              onChange={(e) => { setName(e.target.value); }}
              autoComplete="off"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="nb-phone">Mobile (10 digits)</Label>
            <Input
              id="nb-phone"
              type="tel"
              {...PHONE_INPUT_PROPS}
              value={phone}
              onChange={(e) => { setPhone(sanitizePhoneInput(e.target.value)); }}
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="flex-1 text-[13.5px] font-semibold text-foreground">Party</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Fewer guests"
              disabled={party <= 1}
              onClick={() => { setParty((p) => Math.max(1, p - 1)); }}
            >
              <Minus />
            </Button>
            <span className="w-8 text-center text-[15px] font-semibold tabular-nums text-foreground">
              {party}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="More guests"
              disabled={party >= 30}
              onClick={() => { setParty((p) => Math.min(30, p + 1)); }}
            >
              <Plus />
            </Button>
          </div>
          <Popover open={whenOpen} onOpenChange={setWhenOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-1 py-2 text-left transition-colors duration-fast hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Clock aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-foreground">
                  {day ? `${dmyOfKey(day)} · ${time}` : "—"}
                </span>
                <span className="shrink-0 text-xs text-accent-foreground">Change</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-0">
              <CalendarPicker
                mode="single"
                selected={day ? keyToDate(day) : undefined}
                defaultMonth={day ? keyToDate(day) : undefined}
                fromDate={keyToDate(minDay)}
                toDate={keyToDate(maxDay)}
                onSelect={(picked) => { if (picked) { setDay(dateToKey(picked)); } }}
              />
              <div className="flex items-center gap-2 border-t border-divider p-3">
                <Label htmlFor="nb-time" className="shrink-0 text-xs text-muted-foreground">
                  Time
                </Label>
                <Input
                  id="nb-time"
                  type="time"
                  value={time}
                  onChange={(e) => { if (e.target.value) { setTime(e.target.value); } }}
                  className="h-8"
                />
                <Button type="button" size="sm" variant="outline" onClick={() => { setWhenOpen(false); }}>
                  Done
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <div className="grid gap-1.5">
            <Label htmlFor="nb-source">Source (optional)</Label>
            <Input
              id="nb-source"
              value={source}
              onChange={(e) => { setSource(e.target.value); }}
              placeholder="Phone, walk-in, EazyDiner…"
            />
          </div>
          {err != null && <p className="text-xs text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => { onOpenChange(false); }}>
            Cancel
          </Button>
          <Button type="button" onClick={save}>Choose table</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
