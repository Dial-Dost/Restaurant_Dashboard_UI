"use client";

/**
 * ONE KITCHEN TICKET — the web `_KdsCard` (restaurant_owner_app modules.dart).
 *
 * Anatomy, top to bottom, exactly as the app draws it: header (table name
 * gives way to the timer and the stage, never the reverse) · KOT/placed
 * identity line · delivery/takeaway customer row · order-note warning box ·
 * item lines (qty in bold copper, names that WRAP rather than truncate, hold
 * and note lines hung UNDER the dish the way the docket prints them) · the
 * footer where bump/serve/hold stay ON the ticket — a chef mid-service cannot
 * be sent through a sheet.
 *
 * Timers tick from the parent's shared 1-second `now`; escalation is quiet
 * under ten minutes, warning past ten, danger past fifteen — idle (un-barked /
 * paused) timers stay neutral — and once escalated the card gains a soft glow
 * in the timer colour, never colour alone (the labelled chip always ships).
 */

import * as React from "react";
import {
  Bike,
  Check,
  CheckCircle2,
  Clock,
  ConciergeBell,
  Flame,
  Hand,
  Lock,
  Megaphone,
  Pause,
  Play,
  Printer,
  ReceiptText,
  RotateCcw,
  ShoppingBag,
  StickyNote,
  Undo2,
} from "lucide-react";

import {
  barkFeedbackMessage,
  barkKitchenOrder,
  CANCELLED_TICKET_CAPTION,
  fireKitchenItems,
  isKitchenOrderBarked,
  isKitchenOrderCancelled,
  kitchenKotLabel,
  reprintFeedbackMessage,
  reprintKitchenDocket,
  serveKitchenItem,
  setKitchenItemPaused,
  setKitchenOrderPaused,
  setKitchenOrderStatus,
  unserveKitchenItem,
} from "@/lib/api/kitchen";
import type { KitchenOrder, KitchenOrderItem } from "@/lib/api/kitchen";
import { kotCopyStamp, kotHoldLine, kotLineHeld, printKotCopy } from "@/components/kds/kot-copy";
import { formatDuration, timerElapsedMs } from "@/lib/order-clock";
import type { OrderTimer } from "@/lib/order-clock";
import { formatFullDateTime } from "@/lib/tz";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ForkCard } from "@/components/ui/fork-card";
import { InfoChip, StatusChip } from "@/components/ui/status-chip";
import type { StatusChipStatus } from "@/components/ui/status-chip";

/* ── Elapsed escalation (the kitchen's 10/15-minute thresholds) ─────── */

export type ElapsedTone = "neutral" | "warning" | "danger";

/**
 * Quiet under ten minutes, warning past ten, danger past fifteen. `idle` is
 * the un-barked / paused case: nothing is cooking, so nothing is late, and the
 * timer stays neutral however long it reads. One function, so the board and
 * any future wall screen cannot drift apart.
 */
export const elapsedTone = (ms: number, idle = false): ElapsedTone => {
  if (idle) { return "neutral"; }
  const mins = Math.floor(ms / 60000);
  if (mins > 15) { return "danger"; }
  if (mins > 10) { return "warning"; }
  return "neutral";
};

/** The stage chip's colour, ported from the app's `_stageColor`. */
const stageChipProps = (status: string): { status?: StatusChipStatus; color?: string } => {
  const s = status.toLowerCase();
  if (s.includes("cancel")) { return { status: "danger" }; }
  if (s.includes("closed")) { return { status: "neutral" }; }
  if (s.includes("paid") || s.includes("served")) { return { status: "success" }; }
  if (s.includes("bark")) {
    return s.startsWith("not") ? { status: "neutral" } : { color: "hsl(var(--primary))" };
  }
  if (s.includes("prepar")) { return { status: "info" }; }
  if (s.includes("pending") || s.includes("verif")) { return { status: "warning" }; }
  return { status: "neutral" };
};

/** Warning ink lifted toward the reading ink, as the app lerps toward white. */
const warnInk = (liftPct: number): string =>
  `color-mix(in srgb, hsl(var(--warning)) ${100 - liftPct}%, hsl(var(--status-lift)))`;

/**
 * "Jun 26, 14:05" — the app's default timestamp (`RestaurantTime.short`),
 * rendered in the RESTAURANT's zone. The same field reads identically on the
 * Orders screen and on a printed docket's stack at a shift handover.
 */
const placedStamp = (iso: string, timeZone: string): string => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) { return ""; }
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(ms));
    const p: Partial<Record<string, string>> = {};
    for (const part of parts) { p[part.type] = part.value; }
    if (!p.month || !p.day || !p.hour || !p.minute) { return ""; }
    return `${p.month} ${p.day}, ${p.hour}:${p.minute}`;
  } catch {
    return "";
  }
};

const errorText = (e: unknown): string => {
  if (e instanceof Error) { return e.message; }
  return typeof e === "string" ? e : "Something went wrong.";
};

export interface KdsCardProps {
  order: KitchenOrder;
  /** The station filter — 'All' or one section; items are trimmed to it. */
  station: string;
  /** Shared 1-second tick from the board, so every timer visibly counts. */
  now: number;
  restaurantId: string;
  /** The restaurant's zone — the "Placed" clock must match printed dockets. */
  timezone: string;
  /** Whether this session may be offered "Bark to kitchen" (server's gate). */
  mayBark: boolean;
  /** Silent board refresh after any write. */
  onChanged: () => void;
}

export function KdsCard({
  order,
  station,
  now,
  restaurantId,
  timezone,
  mayBark,
  onChanged,
}: KdsCardProps): React.JSX.Element {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);

  const items = React.useMemo(
    () =>
      station === "All"
        ? order.items
        : order.items.filter((it) => (it.station ?? "").toLowerCase() === station.toLowerCase()),
    [order.items, station],
  );

  // Terminal stage: the ticket is a record only — no fire/serve/hold/bark.
  const cancelled = isKitchenOrderCancelled(order);
  // Un-barked tickets sit greyed with idle timers until the expo barks them.
  const barked = isKitchenOrderBarked(order);
  const orderTimer: OrderTimer | null = order.timing?.order ?? null;
  const itemTimers = order.timing?.items ?? {};
  const orderPaused = orderTimer?.paused === true;
  const orderMs = timerElapsedMs(orderTimer, now);
  const tone = elapsedTone(orderMs, !barked || orderPaused);
  const kot = kitchenKotLabel(order);
  const placed = order.created_at ? placedStamp(order.created_at, timezone) : "";
  const status = order.status;
  const statusLower = status.toLowerCase();
  // Items can only be un-served while the ORDER is still in progress.
  const orderFullyServed = statusLower !== "preparing" && statusLower !== "pending";

  const act = (key: string, fn: () => Promise<void>): void => {
    void (async () => {
      setBusy(key);
      try {
        await fn();
        onChanged();
      } catch (e) {
        toast({ description: errorText(e), variant: "destructive" });
      } finally {
        setBusy(null);
      }
    })();
  };

  const handleBark = (): void => {
    act("bark", async () => {
      const res = await barkKitchenOrder(restaurantId, order.id);
      const msg = barkFeedbackMessage(res);
      if (msg != null) { toast({ description: msg }); }
    });
  };

  const handleReprint = (): void => {
    act("reprint", async () => {
      const res = await reprintKitchenDocket(restaurantId, order.id);
      toast({ description: reprintFeedbackMessage(res) });
    });
  };

  const handlePrintCopy = (): void => {
    // Printed tickets leave the screen, so they carry their zone explicitly.
    printKotCopy({ ...order, items }, kotCopyStamp(timezone));
  };

  const deliveryish = (order.order_type ?? "dine_in") !== "dine_in";
  const isDelivery = order.order_type === "delivery";
  const customerLine = [
    ...(order.customer.trim() !== "" && order.customer.trim() !== "Guest" ? [order.customer.trim()] : []),
    ...(order.customer_phone.trim() !== "" ? [order.customer_phone.trim()] : []),
    ...(order.delivery_address.trim() !== "" ? [order.delivery_address.trim()] : []),
  ].join(" · ");

  const glow =
    tone === "danger"
      ? "0 0 22px 1px hsl(var(--destructive) / 0.09)"
      : tone === "warning"
        ? "0 0 22px 1px hsl(var(--warning) / 0.09)"
        : "none";

  return (
    // Subtle urgency glow once the ticket ages into warning/danger — always
    // paired with the labelled timer chip (never colour alone).
    <div className="h-full rounded-lg transition-shadow duration-slow ease-out" style={{ boxShadow: glow }}>
      <ForkCard className="flex h-full flex-col p-4">
        {/* Header: the table name gives way to the timer and the stage. */}
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground gaia:font-serif">
            Table {order.table}
          </div>
          {barked ? (
            <StatusChip
              dense
              status={tone === "danger" ? "danger" : tone === "warning" ? "warning" : "neutral"}
              label={orderPaused ? `${formatDuration(orderMs)} · held` : formatDuration(orderMs)}
              className="shrink-0 tabular-nums"
            />
          ) : (
            <InfoChip icon={<Megaphone />} label="Idle timer" className="shrink-0" />
          )}
          <StatusChip
            dense
            // Cancelled outranks the bark state — the terminal stage reads
            // first. Keyed on the label so a stage change fades the new chip
            // in, the app's AnimatedSwitcher swap.
            key={cancelled || barked ? status : "Not barked"}
            {...stageChipProps(cancelled || barked ? status : "Not barked")}
            label={cancelled || barked ? status : "Not barked"}
            className="shrink-0 animate-in fade-in-0 duration-base ease-out"
          />
        </div>

        {/* Ticket identity: which KOT this is, and when it was placed — its own
            line, each half only when its data exists. */}
        {(kot !== "" || placed !== "") && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {kot !== "" && <InfoChip icon={<ReceiptText />} label={kot} className="tabular-nums" />}
            {placed !== "" && (
              <InfoChip
                icon={<Clock />}
                label={`Placed ${placed}`}
                className="tabular-nums"
                title={order.created_at ? formatFullDateTime(order.created_at, timezone) : undefined}
              />
            )}
          </div>
        )}

        <div className="mt-3 flex-1">
          {/* Delivery / takeaway context: who this ticket is for. */}
          {deliveryish && (
            <div className="mb-2.5 flex items-center gap-2">
              <InfoChip
                icon={isDelivery ? <Bike /> : <ShoppingBag />}
                label={isDelivery ? "DELIVERY" : "TAKEAWAY"}
                className="shrink-0"
              />
              {customerLine !== "" && (
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{customerLine}</span>
              )}
            </div>
          )}

          {/* The order-level instruction — where an allergy reaches the pass. */}
          {order.note.trim() !== "" && (
            <div
              className="mb-2.5 flex w-full items-start gap-[7px] rounded-md border px-2.5 py-2"
              style={{
                background: "color-mix(in srgb, hsl(var(--warning)) 12%, transparent)",
                borderColor: "hsl(var(--warning) / 0.18)",
              }}
            >
              <StickyNote className="mt-px h-3.5 w-3.5 shrink-0 text-warning" />
              <span className="min-w-0 text-xs leading-[1.4]" style={{ color: warnInk(45) }}>
                {order.note}
              </span>
            </div>
          )}

          {items.map((item) => (
            <KdsItemRow
              key={item.id}
              item={item}
              timer={(itemTimers as Record<string, OrderTimer | undefined>)[item.id] ?? null}
              now={now}
              barked={barked}
              cancelled={cancelled}
              orderFullyServed={orderFullyServed}
              busy={busy != null}
              onFire={() => { act(`fire:${item.id}`, () => fireKitchenItems(restaurantId, order.id, [item.id])); }}
              onServe={() => { act(`serve:${item.id}`, () => serveKitchenItem(restaurantId, order.id, item.id)); }}
              onUnserve={() => { act(`unserve:${item.id}`, () => unserveKitchenItem(restaurantId, order.id, item.id)); }}
              onTogglePause={(paused) => {
                act(`pause:${item.id}`, () => setKitchenItemPaused(restaurantId, order.id, item.id, paused));
              }}
            />
          ))}
        </div>

        {/* Bump / serve / hold stay ON the ticket; on a narrow docket column
            they wrap onto a second line instead of being squeezed or dropped. */}
        <div className="mt-3.5 flex items-center gap-2">
          {cancelled ? (
            // Read-only footer: the caption replaces every stage action.
            <div className="flex min-w-0 flex-1 items-start gap-1.5">
              <Lock className="mt-px h-3.5 w-3.5 shrink-0 text-destructive" />
              <span className="min-w-0 text-xs text-destructive">{CANCELLED_TICKET_CAPTION}</span>
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              {!barked ? (
                mayBark && (
                  <Button size="sm" disabled={busy != null} onClick={handleBark}>
                    <Megaphone /> Bark to kitchen
                  </Button>
                )
              ) : statusLower === "preparing" ? (
                <Button
                  size="sm"
                  disabled={busy != null}
                  onClick={() => { act("advance", () => setKitchenOrderStatus(restaurantId, order.id, "Served")); }}
                >
                  <ConciergeBell /> Mark Served
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy != null}
                  onClick={() => { act("advance", () => setKitchenOrderStatus(restaurantId, order.id, "Preparing")); }}
                >
                  <Undo2 /> Back to Preparing
                </Button>
              )}
              {barked && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy != null}
                  onClick={() => { act("hold", () => setKitchenOrderPaused(restaurantId, order.id, !orderPaused)); }}
                >
                  {orderPaused ? <Play /> : <Pause />} {orderPaused ? "Resume" : "Hold"}
                </Button>
              )}
            </div>
          )}
          {/* THE REPRINT: how a kitchen with a jammed printer asks for the SAME
              docket again — shown only once the order is barked (before that
              there is no docket to reprint). */}
          {barked && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              title="Reprint kitchen docket"
              disabled={busy != null}
              onClick={handleReprint}
            >
              <RotateCcw />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            title="Print KOT (local PDF copy)"
            onClick={handlePrintCopy}
          >
            <Printer />
          </Button>
        </div>
      </ForkCard>
    </div>
  );
}

/* ── One item line ──────────────────────────────────────────────────── */

interface KdsItemRowProps {
  item: KitchenOrderItem;
  timer: OrderTimer | null;
  now: number;
  barked: boolean;
  cancelled: boolean;
  orderFullyServed: boolean;
  busy: boolean;
  onFire: () => void;
  onServe: () => void;
  onUnserve: () => void;
  onTogglePause: (paused: boolean) => void;
}

function KdsItemRow({
  item,
  timer,
  now,
  barked,
  cancelled,
  orderFullyServed,
  busy,
  onFire,
  onServe,
  onUnserve,
  onTogglePause,
}: KdsItemRowProps): React.JSX.Element {
  const served = timer?.ended_at != null;
  const paused = timer?.paused === true;
  // Held courses do not age; the timer starts when fired.
  const held = !served && kotLineHeld(item);
  const ms = timerElapsedMs(timer, now);
  const itemNote = (item.note ?? "").trim();
  const stationLabel = (item.station ?? "").trim();

  return (
    <div
      className={cn(
        "py-0.5 transition-opacity duration-base ease-out",
        (held || !barked || cancelled) && "opacity-55",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-[7px]">
          <span className="shrink-0 text-[15px] font-semibold leading-[1.35] text-accent-foreground tabular-nums">
            {item.quantity} ×
          </span>
          {/* Narrowing the ticket must never cost the chef a dish name: the
              name WRAPS onto as many lines as it needs (no ellipsis) and the
              tags flow after it. The card grows downwards — a docket is tall. */}
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "text-[15px] leading-[1.35]",
                served && "line-through",
                (served || held) && "text-muted-foreground",
              )}
            >
              {item.name}
            </span>
            {stationLabel !== "" && (
              <InfoChip label={stationLabel.toUpperCase()} className="ml-1.5 align-middle" />
            )}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {cancelled || !barked ? null : held ? (
            <Button size="sm" disabled={busy} onClick={onFire}>
              <Flame /> Fire
            </Button>
          ) : (
            <>
              <span
                className={cn(
                  "text-[11px] font-semibold tracking-[0.2px] tabular-nums",
                  served ? "text-success" : "text-muted-foreground",
                )}
              >
                {formatDuration(ms)}
              </span>
              {!served ? (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title={paused ? "Resume item" : "Pause item"}
                    disabled={busy}
                    onClick={() => { onTogglePause(!paused); }}
                  >
                    {paused ? <Play className="text-muted-foreground" /> : <Pause className="text-muted-foreground" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Item served"
                    disabled={busy}
                    onClick={onServe}
                  >
                    <Check className="text-success" />
                  </Button>
                </>
              ) : (
                // A served item's tick is the undo control. Once the whole
                // order is Served the server refuses the undo, so it disables.
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title={
                    orderFullyServed
                      ? "The whole order is served — individual items can no longer be undone"
                      : "Undo served"
                  }
                  disabled={busy || orderFullyServed}
                  onClick={onUnserve}
                >
                  <CheckCircle2 className={orderFullyServed ? "text-muted-foreground" : "text-success"} />
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      {/* The hold hangs UNDER the dish, in the note's slot and style and ahead
          of the note, the way the docket prints it. */}
      {held && (
        <div className="flex items-center gap-1 pb-0.5 pl-2">
          <Hand className="h-[13px] w-[13px] shrink-0 text-warning" />
          <span
            className="min-w-0 text-xs font-semibold italic leading-[1.4]"
            style={{ color: `color-mix(in srgb, hsl(var(--warning)) 65%, hsl(var(--status-lift)))` }}
          >
            {kotHoldLine}
          </span>
        </div>
      )}
      {itemNote !== "" && (
        <div className="flex items-start gap-1 pb-0.5 pl-2">
          <StickyNote className="mt-px h-[13px] w-[13px] shrink-0 text-warning" />
          <span
            className="min-w-0 text-xs italic leading-[1.4]"
            style={{ color: `color-mix(in srgb, hsl(var(--warning)) 65%, hsl(var(--status-lift)))` }}
          >
            {itemNote}
          </span>
        </div>
      )}
    </div>
  );
}
