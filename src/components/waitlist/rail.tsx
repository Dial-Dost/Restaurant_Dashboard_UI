"use client";

// THE RIGHT RAIL — web copies of `_joinCard` / `_copyLink` / `_queuePoster` /
// `_printQueueQr`, `_summaryCard` / `_summaryRow` and `_toBeSeatedCard` /
// `_seatSoonRow` (modules.dart `_WaitlistView`).

import * as React from "react";
import { Copy, Download, Printer, QrCode } from "lucide-react";

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
import { SectionHeader } from "@/components/ui/section-header";
import { useToast } from "@/hooks/use-toast";
import { InitialsAvatar, RoundBadge, SheetTapRow } from "@/components/waitlist/bits";
import { guestCount } from "@/components/waitlist/format";
import { cn } from "@/lib/utils";
import type { PendingPreorderEntry, WaitlistEntry } from "@/lib/db";

/* ── Join-the-queue card ─────────────────────────────────────────────── */

export interface JoinQueueCardProps {
  qrUrl: string;
  qrPng: string;
  restaurantId: string;
}

export function JoinQueueCard({ qrUrl, qrPng, restaurantId }: JoinQueueCardProps): React.JSX.Element {
  const { toast } = useToast();
  const [posterOpen, setPosterOpen] = React.useState(false);

  // Claiming "copied" before knowing it worked is a lie a host only discovers
  // when they paste nothing — report the failure instead (Flutter `_copyLink`).
  const copyLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(qrUrl);
      toast({ title: "Queue link copied" });
    } catch {
      toast({ title: "Could not copy the link — select it and copy manually." });
    }
  };

  // The entrance poster — same shape as the table-QR sheet on purpose
  // (Flutter `_printQueueQr`); the popup approach is the web's print pipeline.
  const printQr = (): void => {
    if (!qrPng) { return; }
    const w = window.open("", "_blank", "width=520,height=680");
    if (!w) {
      toast({ title: "Pop-up blocked", description: "Allow pop-ups to print, or use Download.", variant: "destructive" });
      return;
    }
    w.document.title = "Join the queue";
    w.document.body.setAttribute(
      "style",
      "font-family:system-ui,sans-serif;text-align:center;padding:40px;color:#111",
    );
    w.document.body.innerHTML =
      `<h1 style="margin:0 0 8px;font-size:26px">Tables are full — scan to join the queue</h1>` +
      `<p style="margin:0 0 24px;font-size:15px;color:#333">Browse the menu and pre-order while you wait</p>` +
      `<img src="${qrPng}" style="width:260px;height:260px"/>` +
      `<p style="margin-top:16px;font-size:11px;color:#666;word-break:break-all">${qrUrl}</p>`;
    w.focus();
    setTimeout(() => {
      try { w.print(); } catch { /* ignore */ }
    }, 300);
  };

  // [web-extra] Download PNG — Flutter prints/copies only; kept, but it never
  // displaces the Copy-link affordance (audit 36).
  const downloadQr = (): void => {
    if (!qrPng) { return; }
    const a = document.createElement("a");
    a.href = qrPng;
    a.download = `queue-qr-${restaurantId || "restaurant"}.png`;
    a.click();
  };

  return (
    <ForkCard>
      <div className="flex items-center gap-3.5">
        <RoundBadge size={30}>
          <QrCode />
        </RoundBadge>
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-foreground">Join the queue</span>
      </div>

      {/* Paper exception: the QR keeps its white quiet zone so it stays
          scannable. Tapping the code enlarges it for the door. */}
      <div className="mt-4 flex justify-center">
        <button
          type="button"
          onClick={() => { setPosterOpen(true); }}
          className="cursor-pointer rounded-lg bg-white p-2 transition-transform duration-fast hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Enlarge the entrance QR"
        >
          {qrPng ? (
            <img src={qrPng} alt="Queue QR code" className="h-40 w-40" />
          ) : (
            <span className="flex h-40 w-40 items-center justify-center text-xs text-neutral-500">Generating…</span>
          )}
        </button>
      </div>
      <p className="mt-1.5 text-center text-[10.5px] text-tertiary">Tap the code to enlarge or print it</p>

      <p className="mt-3 text-center text-[13.5px] font-semibold text-foreground">Scan to join waitlist</p>
      <p className="mt-0.5 text-center text-xs text-muted-foreground">Browse menu &amp; pre-order while you wait</p>

      {/* Selectable, not truncated: the whole URL has to be readable off the
          screen when someone is typing it onto a printed sign. */}
      <div className="mt-3.5 flex items-center gap-1.5 rounded-[10px] border border-border bg-inset py-1.5 pl-3 pr-1.5">
        <span className="min-w-0 flex-1 select-all break-all text-[11px] leading-snug text-muted-foreground">
          {qrUrl}
        </span>
        <button
          type="button"
          title="Copy the join link"
          onClick={() => { void copyLink(); }}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-muted-foreground transition-colors duration-fast hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Copy aria-hidden className="h-3.5 w-3.5" />
          <span className="sr-only">Copy the join link</span>
        </button>
      </div>

      <div className="mt-2.5 flex justify-center">
        <Button variant="ghost" size="sm" onClick={downloadQr} disabled={!qrPng}>
          <Download /> Download PNG
        </Button>
      </div>
      {/* [web-extra] multi-outlet retargeting note (audit 37). */}
      <p className="mt-1.5 text-center text-[10.5px] text-tertiary">
        Switch outlets in the top bar and the QR re-targets that branch&rsquo;s queue.
      </p>

      {/* The door-sign view: the QR at a size someone can scan across a room. */}
      <Dialog open={posterOpen} onOpenChange={setPosterOpen}>
        <DialogContent className="max-w-[380px]">
          <DialogHeader>
            <DialogTitle>Entrance QR</DialogTitle>
            <DialogDescription className="text-center text-xs">
              Display this at your door. Guests scan it to join the queue when every table is full.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center">
            <div className="rounded-lg bg-white p-2.5">
              {qrPng ? (
                <img src={qrPng} alt="Queue QR code" className="h-60 w-60" />
              ) : (
                <span className="flex h-60 w-60 items-center justify-center text-xs text-neutral-500">Generating…</span>
              )}
            </div>
          </div>
          <p className="select-all break-all text-center text-[11px] text-muted-foreground">{qrUrl}</p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" size="sm" onClick={() => { setPosterOpen(false); }}>
              Close
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPosterOpen(false);
                void copyLink();
              }}
            >
              Copy link
            </Button>
            <Button
              size="sm"
              disabled={!qrPng}
              onClick={() => {
                setPosterOpen(false);
                printQr();
              }}
            >
              <Printer /> Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ForkCard>
  );
}

/* ── Queue summary card ──────────────────────────────────────────────── */

function SummaryRow({
  label,
  figure,
  unit,
  onClick,
}: {
  label: string;
  figure: number;
  unit: string;
  onClick?: () => void;
}): React.JSX.Element {
  const row = (
    <div className="flex flex-wrap items-center justify-between gap-x-3.5 gap-y-0.5 py-1.5">
      <span className="min-w-0 text-xs text-muted-foreground">{label}</span>
      <span className="whitespace-nowrap">
        <span className="text-[13px] font-semibold text-foreground tabular-nums">{figure}</span>
        <span className="ml-1 text-[11px] text-tertiary">{unit}</span>
      </span>
    </div>
  );
  // A figure counting nothing stays inert rather than offering a tap onto an
  // empty sheet (Flutter `_summaryRow`).
  if (!onClick) { return row; }
  return (
    <SheetTapRow onClick={onClick} className="-mx-1.5 px-1.5">
      {row}
    </SheetTapRow>
  );
}

export interface QueueSummaryCardProps {
  ordered: WaitlistEntry[];
  called: WaitlistEntry[];
  pending: PendingPreorderEntry[];
  onWholeQueue: () => void;
  onGuests: () => void;
  onNotified: () => void;
  onHeldPreorders: () => void;
}

/** Only figures GET /waitlist actually supports — "served today" would be a
 *  guess (Flutter `_summaryCard`). */
export function QueueSummaryCard({
  ordered,
  called,
  pending,
  onWholeQueue,
  onGuests,
  onNotified,
  onHeldPreorders,
}: QueueSummaryCardProps): React.JSX.Element {
  return (
    <ForkCard>
      <SectionHeader title="Queue summary" className="mb-2.5" />
      <SummaryRow
        label="Total in queue"
        figure={ordered.length}
        unit="groups"
        onClick={ordered.length === 0 ? undefined : onWholeQueue}
      />
      <SummaryRow
        label="Guests waiting"
        figure={guestCount(ordered)}
        unit="people"
        onClick={ordered.length === 0 ? undefined : onGuests}
      />
      <SummaryRow
        label="Notified"
        figure={called.length}
        unit="groups"
        onClick={called.length === 0 ? undefined : onNotified}
      />
      <SummaryRow
        label="Pre-orders to confirm"
        figure={pending.length}
        unit="holds"
        onClick={pending.length === 0 ? undefined : onHeldPreorders}
      />
    </ForkCard>
  );
}

/* ── Walk-ins to be seated ───────────────────────────────────────────── */

export interface ToBeSeatedCardProps {
  called: WaitlistEntry[];
  onViewAll: () => void;
  onOpenParty: (e: WaitlistEntry) => void;
}

export function ToBeSeatedCard({ called, onViewAll, onOpenParty }: ToBeSeatedCardProps): React.JSX.Element {
  const shown = called.length > 4 ? called.slice(0, 4) : called;
  return (
    <ForkCard>
      <SectionHeader
        title="Walk-ins to be seated"
        count={called.length === 0 ? undefined : called.length}
        className="mb-1"
        trailing={
          called.length === 0 ? undefined : (
            <Button variant="ghost" size="sm" onClick={onViewAll}>
              View all
            </Button>
          )
        }
      />
      {/* Said once, for the whole card: the dot beside each row is decoration
          on top of this sentence, never the only thing carrying the state. */}
      <p className="text-[11px] text-muted-foreground">Notified — waiting for a table.</p>
      <div className={cn("mt-3.5", shown.length > 0 && "flex flex-col gap-1")}>
        {shown.length === 0 ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Nobody has been called yet. Call a party from the queue and they show up here.
          </p>
        ) : (
          shown.map((e) => (
            <SheetTapRow key={e.id} onClick={() => { onOpenParty(e); }} className="-mx-1.5 px-1.5 py-1">
              <span className="flex items-center gap-3.5">
                <InitialsAvatar name={e.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-foreground">{e.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    Party of {e.party_size || 1} · {e.minutes_waiting || 0}m ago
                  </span>
                </span>
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-warning" />
              </span>
            </SheetTapRow>
          ))
        )}
      </div>
    </ForkCard>
  );
}
