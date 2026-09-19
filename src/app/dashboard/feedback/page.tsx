"use client";

// Feedback — the web copy of the Flutter `feedbackModule`
// (restaurant_owner_app/lib/screens/modules.dart ~18732): the three
// drill-down KPI tiles (Responses / AVG RATING with the donut gauge /
// RECOVERY), the collapsible per-waiter QR card, the Service recovery queue
// with its Resolve flow, and the "All feedback" list with the
// question-by-question expansion — in exactly that order.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { ChevronDown, ChevronRight, ChevronUp, Inbox, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Donut } from "@/components/ui/fork-charts";
import { ForkCard } from "@/components/ui/fork-card";
import { SkeletonRows, SkeletonStats } from "@/components/ui/fork-skeleton";
import { Label } from "@/components/ui/label";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { MicroStat } from "@/components/ui/micro-stat";
import { SectionHeader } from "@/components/ui/section-header";
import { CacheStalePill } from "@/components/ui/stale-pill";
import { StatCard } from "@/components/ui/stat-card";
import { InfoChip, StatusChip } from "@/components/ui/status-chip";
import { Textarea } from "@/components/ui/textarea";
import { FocusBanner, useFocusRequest } from "@/components/focus-banner";
import { InitialsAvatar } from "@/components/feedback/bits";
import {
  RatingSheet,
  RecoveryQueueSheet,
  RecoveryTicketSheet,
  VolumeSheet,
} from "@/components/feedback/feedback-sheets";
import {
  fmtShort,
  initialsOf,
  numOf,
  scoreOf,
  sOf,
} from "@/components/feedback/feedback-format";
import { WaiterQrSection } from "@/components/feedback/waiter-qr-section";
import { useCachedFetch } from "@/hooks/use-cached-fetch";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { useRealtime } from "@/context/RealtimeContext";
import { useTimezone } from "@/lib/use-timezone";
import {
  fetchFeedbackBundle,
  resolveRecoveryTicket,
  type FeedbackBundle,
  type FeedbackEntry,
  type RecoveryTicket,
} from "@/lib/api/feedback";

/** Which drill sheet is open — every figure on this tab opens what is
 *  behind it, computed from the payloads already in hand. */
type SheetState =
  | { kind: "volume" }
  | { kind: "rating" }
  | { kind: "queue" }
  | { kind: "ticket"; ticket: RecoveryTicket }
  | null;

/** The copper "DETAILS ›" footer affordance on the Responses tile
 *  (Flutter `_statCard`). */
function DetailsFooter(): JSX.Element {
  return (
    <span className="flex items-center text-[10px] font-semibold uppercase tracking-[0.11em] text-accent-foreground">
      DETAILS
      <ChevronRight aria-hidden className="ml-0.5 h-3.5 w-3.5" />
    </span>
  );
}

function FeedbackPageInner(): JSX.Element {
  const { user } = useAuth();
  const { toast } = useToast();
  const { timezone } = useTimezone();
  const { lastEvent } = useRealtime();
  const rid = user?.restaurantUsername ?? "";
  const employeeId = user?.employeeId;
  const outletId = user?.outlet_id;

  const scope = useMemo(
    () => ({ restaurantId: rid, employeeId, outletId }),
    [rid, employeeId, outletId],
  );

  const bundle = useCachedFetch<FeedbackBundle>(
    `feedback:${rid}:${outletId ?? ""}`,
    useCallback(() => fetchFeedbackBundle(scope), [scope]),
    { enabled: rid.length > 0 },
  );
  const refresh = bundle.refresh;

  // Realtime: any feedback* event refetches all four payloads silently — the
  // backend emits feedback:created on every submission and a dedicated
  // feedback:recovery on new low-rating ones; both start with "feedback".
  useEffect(() => {
    if (lastEvent?.event.startsWith("feedback")) {
      refresh();
    }
  }, [lastEvent, refresh]);

  /* ── Notification deep-link focus (a low-rating alert asked us to focus
        one response) ─────────────────────────────────────────────────── */

  const focus = useFocusRequest();
  const focusId = focus?.idOf(["feedback_id"]) ?? null;

  // A new focus request refetches — the response may have just arrived.
  useEffect(() => {
    if (!focus) { return; }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.serial]);

  const summary = bundle.data?.summary ?? null;
  const items = useMemo(() => bundle.data?.items ?? [], [bundle.data]);
  const tickets = useMemo(() => bundle.data?.tickets ?? [], [bundle.data]);
  const employees = useMemo(() => bundle.data?.employees ?? [], [bundle.data]);

  const isFocused = useCallback(
    (row: { id?: string | null }): boolean => focusId != null && sOf(row.id, "") === focusId,
    [focusId],
  );
  const focusFound =
    focusId != null && (items.some((m) => isFocused(m)) || tickets.some((t) => isFocused(t)));

  // Bring the focused record on screen once the list holding it has painted.
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (focusId == null || !focusFound || scrolledFor.current === focusId) { return; }
    scrolledFor.current = focusId;
    document.getElementById(`feedback-${focusId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusId, focusFound]);

  /* ── Screen state ───────────────────────────────────────────────────── */

  const [sheet, setSheet] = useState<SheetState>(null);
  /** Which feedback card is expanded (one at a time keeps the list scannable). */
  const [openId, setOpenId] = useState("");
  const [resolving, setResolving] = useState<RecoveryTicket | null>(null);
  const [resolveNote, setResolveNote] = useState("");

  /**
   * The Resolve flow (Flutter `_resolveRecovery`): the dialog closes on
   * "Mark resolved", then the POST runs — an error surfaces as a toast with
   * the server's own sentence, success reloads the queue.
   */
  const submitResolve = (): void => {
    const ticket = resolving;
    if (ticket == null) { return; }
    const note = resolveNote;
    setResolving(null);
    void (async () => {
      try {
        await resolveRecoveryTicket(scope, sOf(ticket.id, ""), note);
        refresh();
      } catch (error) {
        toast({
          title: String(error instanceof Error ? error.message : error),
          variant: "destructive",
        });
      }
    })();
  };

  if (bundle.loading) {
    return (
      <div className="grid gap-4">
        <div className="flex flex-wrap gap-3">
          {[0, 1, 2].map((i) => (
            <ForkCard key={i} className="w-[200px]">
              <SkeletonStats tiles={1} />
            </ForkCard>
          ))}
        </div>
        <SkeletonRows rows={6} />
      </div>
    );
  }

  if (bundle.error != null || summary == null) {
    return (
      <LoadErrorState
        whatFailed="Couldn't load feedback."
        error={bundle.error}
        onRetry={bundle.retry}
      />
    );
  }

  const avgRating = numOf(summary.averageRating ?? 0);

  return (
    <div className="relative grid gap-6">
      {focus != null && (
        <FocusBanner
          className="mb-0"
          found={focusFound}
          message={
            focusFound
              ? "Highlighted the response from your notification."
              : "That response isn't in this list — it may have been removed, or belong to another outlet."
          }
          onDismiss={focus.dismiss}
          showAllLabel="Show all feedback"
        />
      )}

      {/* ── The three drill-down KPI tiles ──────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <StatCard
          className="w-[200px]"
          value={`${summary.totalResponses ?? 0}`}
          caption="RESPONSES"
          footer={<DetailsFooter />}
          onClick={() => { setSheet({ kind: "volume" }); }}
        />
        <StatCard
          className="w-[200px]"
          value={`${summary.averageRating ?? 0}`}
          unit="/ 5"
          caption="AVG RATING"
          chart={
            <div className="flex justify-start">
              <Donut fraction={Math.min(1, Math.max(0, avgRating / 5))} size={46} />
            </div>
          }
          onClick={() => { setSheet({ kind: "rating" }); }}
        />
        {/* Always opens the queue — at zero the sheet explains what service
            recovery IS instead of eating the tap. */}
        <StatCard
          className="w-[200px]"
          value={`${tickets.length}`}
          caption="RECOVERY"
          tag={tickets.length > 0 ? "Open" : undefined}
          tagColor="hsl(var(--destructive))"
          onClick={() => { setSheet({ kind: "queue" }); }}
        />
      </div>

      {/* ── Per-waiter feedback QR (collapsed by default) ───────────── */}
      <WaiterQrSection
        employees={employees}
        items={items}
        timezone={timezone}
        restaurantUsername={rid}
        outletId={outletId ?? ""}
      />

      {/* ── Service recovery ────────────────────────────────────────── */}
      {tickets.length > 0 && (
        <section>
          <SectionHeader
            title="Service recovery"
            count={tickets.length}
            trailing={<StatusChip status="danger" label="Needs follow-up" dense />}
          />
          {tickets.map((t) => {
            const comment = sOf(t.comments, "");
            const cats = t.category_ratings ?? [];
            return (
              <ForkCard
                key={t.id}
                id={`feedback-${sOf(t.id, "")}`}
                selected={isFocused(t)}
                // Opens the full response — the question wording, the
                // follow-up prompts and the recommend score the recovery
                // reader does not return. "Resolve" keeps its own button so
                // reading a complaint can never close it.
                onClick={() => { setSheet({ kind: "ticket", ticket: t }); }}
                className="mb-2"
              >
                <div className="flex flex-col gap-2 min-[760px]:flex-row min-[760px]:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {/* The raw rating in a red ring, exactly as the app draws it. */}
                    <InitialsAvatar text={`${t.overall_rating ?? "-"}`} danger />
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-sm font-semibold text-foreground">
                        {sOf(t.customer_name, "Guest")}
                      </p>
                      {/* Not the raw ISO date: submitted_at is a UTC instant,
                          so slicing at the "T" dates a 1am review to the
                          previous day in Asia/Kolkata. */}
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {fmtShort(sOf(t.submitted_at, ""), timezone)}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <StatusChip status="danger" label="Low rating" dense />
                    <span
                      onClick={(e) => { e.stopPropagation(); }}
                      onKeyDown={(e) => { e.stopPropagation(); }}
                    >
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          setResolveNote("");
                          setResolving(t);
                        }}
                      >
                        Resolve
                      </Button>
                    </span>
                  </div>
                </div>
                {comment !== "" && (
                  <p className="mt-2 text-sm italic text-foreground">&quot;{comment}&quot;</p>
                )}
                {cats.map((c, i) => {
                  const ans = sOf(c.follow_up_answer);
                  return (
                    <div key={`${sOf(c.key, "")}-${i}`} className="mt-1.5 flex items-start gap-2">
                      <InfoChip icon={<Star />} label={`${sOf(c.label)} · ${c.rating}/5`} />
                      {ans !== "" && (
                        <p className="min-w-0 flex-1 pt-1 text-xs text-muted-foreground">{ans}</p>
                      )}
                    </div>
                  );
                })}
              </ForkCard>
            );
          })}
        </section>
      )}

      {/* ── All feedback ────────────────────────────────────────────── */}
      <section>
        <SectionHeader title="All feedback" count={items.length} />
        {items.length === 0 ? (
          <EmptyState icon={<Inbox />} title="Nothing to show" caption="No feedback yet." />
        ) : (
          items.map((m: FeedbackEntry, index) => {
            const id = sOf(m.id, "");
            const open = openId === id && id !== "";
            const guest = sOf(m.customer_name, "Guest");
            const cats = m.category_ratings ?? [];
            const comment = sOf(m.comments, "");
            return (
              <ForkCard
                key={id !== "" ? id : `row-${index}`}
                id={`feedback-${id}`}
                selected={isFocused(m)}
                chevron={false}
                // Tapping opens the full question-by-question breakdown; the
                // collapsed row alone can't show WHY a score is what it is.
                onClick={id === "" ? undefined : () => { setOpenId(open ? "" : id); }}
                className="mb-2 px-4 py-3"
                aria-expanded={id === "" ? undefined : open}
              >
                <div className="flex items-center gap-3">
                  <InitialsAvatar text={initialsOf(guest)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{guest}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {comment !== ""
                        ? comment
                        : `${cats.length} question${cats.length === 1 ? "" : "s"} answered`}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <MicroStat value={`${scoreOf(m.overall_rating)} / 5`} label="Rating" alignEnd />
                    <span className="micro-label">{fmtShort(sOf(m.submitted_at, ""), timezone)}</span>
                  </div>
                  {id !== "" &&
                    (open ? (
                      <ChevronUp aria-hidden className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronDown aria-hidden className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
                    ))}
                </div>
                {open && (
                  <div className="mt-3 border-t border-divider pt-3">
                    {cats.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No per-question ratings were recorded.</p>
                    ) : (
                      cats.map((c, i) => {
                        const r = numOf(c.rating);
                        const followUp = sOf(c.follow_up);
                        const answer = sOf(c.follow_up_answer);
                        return (
                          <div key={`${sOf(c.key, "")}-${i}`} className="mb-2">
                            <div className="flex items-center gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm text-foreground">{sOf(c.label, sOf(c.key))}</p>
                                {sOf(c.question) !== "" && (
                                  <p className="micro-label">{sOf(c.question)}</p>
                                )}
                              </div>
                              <StatusChip
                                dense
                                label={`${r.toFixed(0)}/5`}
                                status={r <= 2 ? "danger" : r >= 4 ? "success" : "warning"}
                              />
                            </div>
                            {followUp !== "" && (
                              <div className="ml-2 mt-1">
                                <p className="micro-label">{followUp}</p>
                                <p className="text-xs text-muted-foreground">
                                  {answer !== "" ? answer : "— not answered"}
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      <InfoChip label={`Overall ${scoreOf(m.overall_rating)}/5 (avg of ${cats.length})`} />
                      {m.nps != null && <InfoChip label={`Recommend ${numOf(m.nps).toFixed(0)}/10`} />}
                      {sOf(m.source) !== "" && <InfoChip label={`Via ${sOf(m.source)}`} />}
                    </div>
                    {comment !== "" && (
                      <p className="mt-2 text-xs text-muted-foreground">{comment}</p>
                    )}
                  </div>
                )}
              </ForkCard>
            );
          })
        )}
      </section>

      <CacheStalePill offline={bundle.offline} fromCache={bundle.fromCache} updatedAt={bundle.updatedAt} />

      {/* ── Drill sheets ────────────────────────────────────────────── */}
      {sheet?.kind === "volume" && (
        <VolumeSheet
          summary={summary}
          items={items}
          timezone={timezone}
          onClose={() => { setSheet(null); }}
        />
      )}
      {sheet?.kind === "rating" && (
        <RatingSheet summary={summary} items={items} onClose={() => { setSheet(null); }} />
      )}
      {sheet?.kind === "queue" && (
        <RecoveryQueueSheet tickets={tickets} timezone={timezone} onClose={() => { setSheet(null); }} />
      )}
      {sheet?.kind === "ticket" && (
        <RecoveryTicketSheet
          ticket={sheet.ticket}
          items={items}
          timezone={timezone}
          onClose={() => { setSheet(null); }}
        />
      )}

      {/* ── Resolve recovery ticket ─────────────────────────────────── */}
      <Dialog open={resolving != null} onOpenChange={(open) => { if (!open) { setResolving(null); } }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Resolve recovery ticket</DialogTitle>
            <DialogDescription className="sr-only">
              Record how the guest was followed up, then mark the ticket resolved.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="resolve-note">How was it resolved? (optional)</Label>
            <Textarea
              id="resolve-note"
              rows={3}
              value={resolveNote}
              onChange={(e) => { setResolveNote(e.target.value); }}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setResolving(null); }}>
              Cancel
            </Button>
            <Button type="button" onClick={submitResolve}>
              Mark resolved
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// useSearchParams (via useFocusRequest) requires a Suspense boundary
// (same pattern as the bookings and accounting pages).
export default function FeedbackPage(): JSX.Element {
  return (
    <Suspense fallback={<SkeletonRows rows={6} />}>
      <FeedbackPageInner />
    </Suspense>
  );
}
