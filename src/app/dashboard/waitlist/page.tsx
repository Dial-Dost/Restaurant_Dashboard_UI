"use client";

// THE WAITLIST BOARD — web copy of Flutter `_WaitlistView` (modules.dart):
// a two-column board (main column + 320px right rail), a clickable stat
// strip whose every figure drills into the set it counts, one tabbed queue
// panel (Queue / Walk-ins / Reservations) rendered as a real 8-column table
// on desktop, a per-row "…" actions menu, read-only party sheets on every
// row tap, the join-QR rail card, and a closing "preview guest experience"
// banner. Every action posts the same REST calls as the app.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";

// The qrcode package ships no types (src/types/qrcode.d.ts declares it as
// any); pin the one call this page makes.
const qrToDataUrl = (QRCode as {
  toDataURL: (text: string, opts?: { width?: number; margin?: number }) => Promise<string>;
}).toDataURL;

import { SkeletonRows } from "@/components/ui/fork-skeleton";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { CacheStalePill } from "@/components/ui/stale-pill";
import { FocusBanner, useFocusRequest } from "@/components/focus-banner";
import { useCachedFetch } from "@/hooks/use-cached-fetch";
import { useCurrency } from "@/hooks/use-currency";
import { useToast } from "@/hooks/use-toast";
import { useVisibleNav } from "@/hooks/use-nav";
import { useAuth } from "@/context/AuthContext";
import {
  callWaitlistEntry,
  cancelWaitlistEntry,
  confirmWaitlistPreorder,
  declineWaitlistPreorder,
  seatWaitlistEntry,
  type PendingPreorderEntry,
  type WaitlistEntry,
} from "@/lib/db";
import { fetchWaitlistBoard, type WaitlistBoard } from "@/lib/api/waitlist";
import { seatingLeftTableUnattended } from "@/lib/table-assignment";
import { getSelectedOutletId } from "@/lib/outlet";
import { preItemsOf, type PreorderItem } from "@/components/waitlist/format";
import { WaitlistHero, ClosingBanner } from "@/components/waitlist/hero";
import { StatStrip } from "@/components/waitlist/stat-strip";
import { WaitlistDrills, type WaitlistDrill } from "@/components/waitlist/drills";
import { QueuePanel, type WaitlistTab } from "@/components/waitlist/queue-panel";
import { PendingPreordersSection } from "@/components/waitlist/pending-preorders";
import { JoinQueueCard, QueueSummaryCard, ToBeSeatedCard } from "@/components/waitlist/rail";
import {
  PreorderReviewDialog,
  RemoveConfirmDialog,
  SeatTableDialog,
} from "@/components/waitlist/dialogs";

/** What the review dialog is deciding on. */
interface ReviewState {
  id: string;
  name: string;
  table: string;
  items: PreorderItem[];
  subtotal: number;
}

function WaitlistPageInner(): JSX.Element {
  const { user } = useAuth();
  const { toast } = useToast();
  const { currencySymbol } = useCurrency();
  const { labels } = useVisibleNav();
  const router = useRouter();
  const rid = user?.restaurantUsername ?? "";

  // Cache-primed board, refreshed on the app's 10s cadence (Flutter `_poll`).
  const board = useCachedFetch<WaitlistBoard>(
    `waitlist:${rid}`,
    useCallback(() => fetchWaitlistBoard(rid), [rid]),
    { pollMs: 10_000, enabled: rid.length > 0 },
  );
  const entries = useMemo(() => board.data?.entries ?? [], [board.data]);
  const pending = useMemo(() => board.data?.pending ?? [], [board.data]);
  const freeTables = useMemo(() => board.data?.freeTables ?? [], [board.data]);
  const refresh = board.refresh;

  /* ── Notification deep-link focus ───────────────────────────────────── */

  const focus = useFocusRequest();
  const focusId = focus?.idOf(["waitlist_id"]) ?? null;
  const focusFound = focusId != null && entries.some((e) => e.id === focusId);

  // A new focus request refetches — the party may have just joined.
  useEffect(() => {
    if (!focus) { return; }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.serial]);

  // The focused party first so it needs no scrolling; otherwise the server's
  // position order stands (Flutter's stable focused-first sort).
  const ordered = useMemo(() => {
    if (focusId == null) { return entries; }
    return [...entries].sort(
      (a, b) => (a.id === focusId ? 0 : 1) - (b.id === focusId ? 0 : 1),
    );
  }, [entries, focusId]);

  // Called = notified, on their way to a table — the one real sub-list this
  // endpoint supports (GET /waitlist returns waiting + called, nothing else).
  const called = useMemo(() => ordered.filter((e) => e.status === "called"), [ordered]);

  /* ── UI state ───────────────────────────────────────────────────────── */

  const [tab, setTab] = useState<WaitlistTab>("queue");
  // The table lists 8 rows until the footer asks for the rest, so a
  // forty-party Saturday does not push the rail off the page.
  const [showAll, setShowAll] = useState(false);
  const [drill, setDrill] = useState<WaitlistDrill | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [seatFor, setSeatFor] = useState<WaitlistEntry | null>(null);
  const [removeFor, setRemoveFor] = useState<WaitlistEntry | null>(null);
  const [review, setReview] = useState<ReviewState | null>(null);

  const goWalkinsTab = useCallback(() => {
    setTab("walkins");
    setShowAll(false);
  }, []);

  /* ── Entrance QR ────────────────────────────────────────────────────── */

  // Encodes this dashboard's own /queue/<slug> URL (with the selected outlet
  // for multi-outlet) — how a guest gets INTO the queue when tables are full.
  const [qrUrl, setQrUrl] = useState("");
  const [qrPng, setQrPng] = useState("");
  useEffect(() => {
    if (!rid || typeof window === "undefined") { return; }
    const outlet = getSelectedOutletId();
    const url = `${window.location.origin}/queue/${encodeURIComponent(rid)}${outlet ? `?outlet=${encodeURIComponent(outlet)}` : ""}`;
    setQrUrl(url);
    qrToDataUrl(url, { width: 512, margin: 2 }).then(setQrPng).catch(() => { setQrPng(""); });
  }, [rid]);

  /* ── Actions ────────────────────────────────────────────────────────── */

  const act = async (id: string, fn: () => Promise<unknown>, ok?: string): Promise<void> => {
    setBusyId(id);
    try {
      await fn();
      if (ok) { toast({ title: ok }); }
      refresh();
    } catch (e) {
      toast({ title: String(e instanceof Error ? e.message : e), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const callParty = (e: WaitlistEntry): void => {
    void act(e.id, () => callWaitlistEntry(rid, e.id), `Notified ${e.name}`);
  };

  // No-show is silent on purpose — same as the app.
  const noShow = (e: WaitlistEntry): void => {
    void act(e.id, () => cancelWaitlistEntry(rid, e.id, "no_show"));
  };

  // Remove asks first — it takes a guest's place away with no undo.
  const reallyRemove = (e: WaitlistEntry): void => {
    setRemoveFor(null);
    void act(e.id, () => cancelWaitlistEntry(rid, e.id, "cancelled"), `${e.name} removed from the queue`);
  };

  // Seat ALWAYS goes through the table-picker dialog — no silent default
  // table (Flutter `_seat`).
  const seat = (e: WaitlistEntry): void => {
    if (freeTables.length === 0) {
      toast({ title: "No free tables — free one first." });
      return;
    }
    setSeatFor(e);
  };

  const reallySeat = (entry: WaitlistEntry, table: string): void => {
    setSeatFor(null);
    void act(entry.id, async () => {
      // Seating never places the held pre-order — the server hands it back as
      // `pending_preorder` and someone must answer for it. Ask right here,
      // while the party is still standing in front of the host.
      const r = await seatWaitlistEntry(rid, entry.id, table);
      const held = r.pending_preorder && r.pending_preorder.items.length > 0 ? r.pending_preorder : null;
      // WHO is serving this table, said in the same breath as "seated" — the
      // cheapest moment there will ever be to fix an unattended table.
      const assigned = r.assignment;
      const unattended = seatingLeftTableUnattended(assigned);
      toast({
        title:
          `Seated at ${table}` +
          (held ? " · confirm their pre-order" : "") +
          (assigned ? ` · ${assigned.message}` : ""),
        variant: unattended ? "destructive" : undefined,
      });
      if (held) {
        setReview({ id: entry.id, name: entry.name, table, items: held.items, subtotal: held.subtotal });
      }
    });
  };

  // Confirm places the held pre-order as a real order; decline leaves the
  // items on the entry so the guest can change them. Dismissing the dialog
  // decides nothing — the hold stays in "Pre-orders to confirm".
  const confirmPre = (r: ReviewState): void => {
    setReview(null);
    void act(r.id, async () => {
      const res = await confirmWaitlistPreorder(rid, r.id);
      toast({
        title: res.already
          ? "Pre-order was already sent"
          : `Pre-order sent to the kitchen for ${res.table_name || r.table}`,
      });
    });
  };

  const declinePre = (r: ReviewState): void => {
    setReview(null);
    void act(r.id, async () => {
      await declineWaitlistPreorder(rid, r.id);
      toast({ title: `${r.name} can change their pre-order before it is placed` });
    });
  };

  const reviewPending = (e: PendingPreorderEntry, subtotal: number): void => {
    setReview({
      id: e.id,
      name: e.name,
      table: e.table_name ?? "",
      items: preItemsOf(e),
      subtotal,
    });
  };

  const openParty = useCallback((e: WaitlistEntry) => { setDrill({ kind: "party", entry: e }); }, []);

  /* ── Render ─────────────────────────────────────────────────────────── */

  if (board.loading) { return <SkeletonRows rows={6} />; }
  if (board.error) {
    return (
      <LoadErrorState
        whatFailed="Could not load the waitlist"
        error={board.error}
        onRetry={board.retry}
      />
    );
  }

  // A queue notification asked us to focus one party. The queue only holds
  // parties still waiting, so a seated / removed party is simply not here any
  // more — say so instead of showing an unexplained list.
  const banner = focus != null && (
    <FocusBanner
      found={focusFound}
      message={
        focusFound
          ? "Showing the party from your notification."
          : "That party has left the queue — it was seated, cancelled or marked a no-show."
      }
      onDismiss={focus.dismiss}
      showAllLabel="Dismiss"
      className="mb-0"
    />
  );

  return (
    <div className="relative">
      <div className="grid grid-cols-1 gap-5 min-[1000px]:grid-cols-[minmax(0,1fr)_320px] min-[1000px]:items-start">
        {/* Main column. */}
        <div className="flex min-w-0 flex-col gap-4">
          {banner}
          <WaitlistHero />
          <StatStrip ordered={ordered} freeTables={freeTables} onDrill={setDrill} />
          <PendingPreordersSection
            pending={pending}
            busyId={busyId}
            currencySymbol={currencySymbol}
            onReview={reviewPending}
          />
          <QueuePanel
            ordered={ordered}
            called={called}
            tab={tab}
            onTabChange={(t) => {
              setTab(t);
              setShowAll(false);
            }}
            showAll={showAll}
            onToggleShowAll={() => { setShowAll((s) => !s); }}
            focusId={focusId}
            busyId={busyId}
            onOpenParty={openParty}
            onCall={callParty}
            onSeat={seat}
            onNoShow={noShow}
            onRemove={setRemoveFor}
            canOpenBookings={labels.includes("Bookings")}
            onOpenBookings={() => { router.push("/dashboard/bookings"); }}
          />
        </div>

        {/* The 320px right rail (stacks under the main column below 1000px). */}
        <div className="flex min-w-0 flex-col gap-4">
          <JoinQueueCard qrUrl={qrUrl} qrPng={qrPng} restaurantId={rid} />
          <QueueSummaryCard
            ordered={ordered}
            called={called}
            pending={pending}
            onWholeQueue={() => { setDrill({ kind: "whole-queue" }); }}
            onGuests={() => { setDrill({ kind: "guests" }); }}
            onNotified={goWalkinsTab}
            onHeldPreorders={() => { setDrill({ kind: "held-preorders" }); }}
          />
          <ToBeSeatedCard called={called} onViewAll={goWalkinsTab} onOpenParty={openParty} />
        </div>

        {/* Full-width closing banner. */}
        <div className="min-[1000px]:col-span-2">
          <ClosingBanner queueUrl={qrUrl} />
        </div>
      </div>

      {/* Drill-down sheets — every figure opens the set it counts. */}
      <WaitlistDrills
        drill={drill}
        onDrillChange={setDrill}
        ordered={ordered}
        pending={pending}
        freeTables={freeTables}
        currencySymbol={currencySymbol}
        canOpenTables={labels.includes("Tables")}
        onViewTables={() => { router.push("/dashboard/tables"); }}
      />

      {/* Seat table-picker — an explicit choice, never a silent default. */}
      {seatFor != null && (
        <SeatTableDialog
          key={seatFor.id}
          partyName={seatFor.name}
          partySize={seatFor.party_size || 1}
          freeTables={freeTables}
          onSeat={(table) => {
            const entry = seatFor;
            reallySeat(entry, table);
          }}
          onOpenChange={(open) => { if (!open) { setSeatFor(null); } }}
        />
      )}

      {/* Remove confirmation. */}
      {removeFor != null && (
        <RemoveConfirmDialog
          partyName={removeFor.name}
          onConfirm={() => { reallyRemove(removeFor); }}
          onOpenChange={(open) => { if (!open) { setRemoveFor(null); } }}
        />
      )}

      {/* Pre-order review — the one confirm surface for held pre-orders. */}
      {review != null && (
        <PreorderReviewDialog
          partyName={review.name}
          tableName={review.table}
          items={review.items}
          subtotal={review.subtotal}
          currencySymbol={currencySymbol}
          onConfirm={() => { confirmPre(review); }}
          onDecline={() => { declinePre(review); }}
          onOpenChange={(open) => { if (!open) { setReview(null); } }}
        />
      )}

      <CacheStalePill offline={board.offline} fromCache={board.fromCache} updatedAt={board.updatedAt} />
    </div>
  );
}

// useSearchParams (via useFocusRequest) requires a Suspense boundary
// (same pattern as the bookings and accounting pages).
export default function WaitlistPage(): JSX.Element {
  return (
    <Suspense fallback={<SkeletonRows rows={6} />}>
      <WaitlistPageInner />
    </Suspense>
  );
}
