"use client";

// The Feedback drill-downs — web copies of `_feedbackVolumeSheet`,
// `_feedbackRatingSheet`, `_recoveryQueueSheet`, `_recoveryTicketSheet` and
// `_waiterFeedbackSheet` (restaurant_owner_app/lib/screens/modules.dart
// ~18440–18730). Every figure on the Feedback tab opens what is behind it,
// computed from the payloads the module already holds — nothing here fetches
// again.
//
// One honesty constraint runs through all of them: `/feedback` returns the
// newest 100 responses while the summary is computed over every response ever
// recorded. Any figure derived from the rows says so, rather than quietly
// presenting a sample as the whole history.

import * as React from "react";

import { DrillSheet } from "@/components/ui/drill-sheet";
import { DetailRow, SheetHead } from "@/components/feedback/bits";
import {
  fmtShort,
  intOf,
  numOf,
  pctOf,
  ratingSpread,
  scoreOf,
  sOf,
} from "@/components/feedback/feedback-format";
import type { FeedbackEntry, FeedbackSummary, RecoveryTicket } from "@/lib/api/feedback";

interface SheetShellProps {
  onClose: () => void;
}

const sheetProps = (onClose: () => void): { open: true; onOpenChange: (open: boolean) => void } => ({
  open: true,
  onOpenChange: (open: boolean) => { if (!open) { onClose(); } },
});

/* ── Responses volume ─────────────────────────────────────────────────── */

/**
 * Everything the "Responses" tile counts but cannot show: where the
 * responses came in from, how many carried words rather than only stars, and
 * the stretch of time the list actually covers.
 */
export function VolumeSheet({
  summary,
  items,
  timezone,
  onClose,
}: SheetShellProps & {
  summary: FeedbackSummary;
  items: FeedbackEntry[];
  timezone: string;
}): React.JSX.Element {
  const total = intOf(summary.totalResponses) ?? items.length;
  const withComment = items.filter((m) => sOf(m.comments, "") !== "").length;
  const withNps = items.filter((m) => m.nps != null).length;

  const bySource = new Map<string, number>();
  for (const m of items) {
    const src = sOf(m.source, "").trim();
    const key = src === "" || src === "—" ? "Not recorded" : src;
    bySource.set(key, (bySource.get(key) ?? 0) + 1);
  }
  const sources = [...bySource.entries()].sort((a, b) => b[1] - a[1]);

  // The server sends the rows newest-first, so the ends of the list are the
  // ends of the window.
  const newest = items.length === 0 ? "" : sOf(items[0].submitted_at, "");
  const oldest = items.length === 0 ? "" : sOf(items[items.length - 1].submitted_at, "");

  return (
    <DrillSheet {...sheetProps(onClose)} eyebrow="Responses" title={`${total} in total`}>
      <DetailRow label="All time" value={`${total}`} />
      <DetailRow label="Last 30 days" value={`${intOf(summary.last30DaysResponses) ?? 0}`} />
      <DetailRow label="Loaded below" value={`${items.length}`} />
      {newest !== "" && <DetailRow label="Newest" value={fmtShort(newest, timezone)} />}
      {oldest !== "" && items.length > 1 && (
        <DetailRow label="Oldest loaded" value={fmtShort(oldest, timezone)} />
      )}
      <SheetHead>OF THE {items.length} LOADED</SheetHead>
      <DetailRow label="Left a comment" value={`${withComment}`} trailing={pctOf(withComment, items.length)} />
      <DetailRow
        label={'Answered "would recommend"'}
        value={`${withNps}`}
        trailing={pctOf(withNps, items.length)}
      />
      {sources.length > 0 && (
        <>
          <SheetHead>WHERE THEY CAME IN</SheetHead>
          {sources.map(([label, count]) => (
            <DetailRow key={label} label={label} value={`${count}`} trailing={pctOf(count, items.length)} />
          ))}
        </>
      )}
    </DrillSheet>
  );
}

/* ── Average rating ───────────────────────────────────────────────────── */

/**
 * The spread and the per-question averages behind a single average score.
 * The tile can only show the mean, and a 4.0 made of straight 4s is a
 * different restaurant from a 4.0 made of 5s and 1s.
 */
export function RatingSheet({
  summary,
  items,
  onClose,
}: SheetShellProps & {
  summary: FeedbackSummary;
  items: FeedbackEntry[];
}): React.JSX.Element {
  const spread = ratingSpread(items);
  const rated = spread.reduce((a, b) => a + b, 0);
  const catRows = Object.entries(summary.categoryAverages ?? {})
    .map(([key, v]) => ({ label: sOf(v.label, key), avg: v.average ?? null }))
    .sort((a, b) => numOf(a.avg) - numOf(b.avg));
  const unhappy = spread[0] + spread[1];

  return (
    <DrillSheet
      {...sheetProps(onClose)}
      eyebrow="Average rating"
      title={`${summary.averageRating ?? "—"} / 5`}
    >
      <DetailRow label="Responses scored" value={`${rated}`} />
      <DetailRow label="At 2 stars or below" value={`${unhappy}`} trailing={pctOf(unhappy, rated)} />
      <SheetHead>HOW THE SCORES FALL</SheetHead>
      {[5, 4, 3, 2, 1].map((star) => (
        <DetailRow
          key={star}
          label={`${star} star${star === 1 ? "" : "s"}`}
          value={`${spread[star - 1]}`}
          trailing={pctOf(spread[star - 1], rated)}
        />
      ))}
      <SheetHead>BY QUESTION — WORST FIRST</SheetHead>
      {catRows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No per-question ratings have been recorded.</p>
      ) : (
        catRows.map((c) => (
          <DetailRow key={c.label} label={c.label} value={c.avg == null ? "—" : `${scoreOf(c.avg)} / 5`} />
        ))
      )}
      <p className="pt-2 text-xs leading-[1.35] text-tertiary">
        The spread is over the responses loaded below. The question averages come from every
        response ever recorded, so the two need not add up.
      </p>
    </DrillSheet>
  );
}

/* ── Recovery queue ───────────────────────────────────────────────────── */

/**
 * Who is still waiting to be called back. Reached from the "Recovery" tile,
 * which is ALWAYS tappable: at zero this sheet explains what service recovery
 * is and when a ticket lands here, because a tile whose caption names a
 * concept the owner may not know yet cannot be the thing that explains it by
 * staying silent.
 */
export function RecoveryQueueSheet({
  tickets,
  timezone,
  onClose,
}: SheetShellProps & {
  tickets: RecoveryTicket[];
  timezone: string;
}): React.JSX.Element {
  const worst = [...tickets].sort((a, b) => numOf(a.overall_rating) - numOf(b.overall_rating));
  return (
    <DrillSheet
      {...sheetProps(onClose)}
      eyebrow="Service recovery"
      title={tickets.length === 0 ? "All clear" : `${tickets.length} open`}
    >
      {tickets.length === 0 ? (
        <>
          <p className="text-sm text-foreground">No guest is waiting on a follow-up right now.</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Any feedback scored 2 out of 5 or below opens a recovery ticket here the moment it
            arrives, and the manager bell is pinged at the same time. Tickets stay in this queue
            until someone follows the guest up and marks them resolved with a note.
          </p>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Low-rating feedback that nobody has followed up yet, lowest score first.
          </p>
          <div className="mt-2">
            {worst.map((t) => (
              <DetailRow
                key={t.id}
                label={sOf(t.customer_name, "Guest")}
                value={`${scoreOf(t.overall_rating)} / 5`}
                trailing={fmtShort(sOf(t.submitted_at, ""), timezone)}
              />
            ))}
          </div>
        </>
      )}
    </DrillSheet>
  );
}

/* ── Recovery ticket detail ───────────────────────────────────────────── */

/**
 * The full record behind a recovery ticket. Not a re-print of the card: the
 * recovery reader returns only {key,label,rating,follow_up_answer} per
 * question, so the card cannot show the QUESTION that was asked, the
 * follow-up prompt, the recommend score or the source. Those live on the
 * matching row in the main feedback list, joined here by id. "Resolve" stays
 * on the card — closing a ticket is not what tapping a row to read it should
 * resolve to.
 */
export function RecoveryTicketSheet({
  ticket,
  items,
  timezone,
  onClose,
}: SheetShellProps & {
  ticket: RecoveryTicket;
  items: FeedbackEntry[];
  timezone: string;
}): React.JSX.Element {
  const id = sOf(ticket.id, "");
  const full = items.find((m) => sOf(m.id, "") === id) ?? null;
  const cats = (full ?? ticket).category_ratings ?? [];
  const comment = sOf(ticket.comments, "");

  return (
    <DrillSheet
      {...sheetProps(onClose)}
      eyebrow={`Recovery ticket · ${sOf(ticket.recovery_status, "open")}`}
      title={sOf(ticket.customer_name, "Guest")}
    >
      <DetailRow label="Overall" value={`${scoreOf(ticket.overall_rating)} / 5`} />
      <DetailRow label="Submitted" value={fmtShort(sOf(ticket.submitted_at, ""), timezone)} />
      {full?.nps != null && (
        <DetailRow label="Would recommend" value={`${numOf(full.nps).toFixed(0)} / 10`} />
      )}
      {full != null && sOf(full.source) !== "" && (
        <DetailRow label="Came in via" value={sOf(full.source)} />
      )}
      {comment !== "" && (
        <>
          <SheetHead>IN THEIR WORDS</SheetHead>
          <p className="text-sm italic text-foreground">&quot;{comment}&quot;</p>
        </>
      )}
      <SheetHead>QUESTION BY QUESTION</SheetHead>
      {cats.length === 0 ? (
        <p className="text-xs text-muted-foreground">No per-question ratings were recorded.</p>
      ) : (
        cats.map((c, i) => (
          <React.Fragment key={`${sOf(c.key, "")}-${i}`}>
            <DetailRow label={sOf(c.label, sOf(c.key))} value={`${scoreOf(c.rating)} / 5`} />
            {sOf(c.question) !== "" && (
              <div className="micro-label mb-0.5 ml-2">{sOf(c.question)}</div>
            )}
            {(sOf(c.follow_up) !== "" || sOf(c.follow_up_answer) !== "") && (
              <div className="mb-1.5 ml-2">
                {sOf(c.follow_up) !== "" && <div className="micro-label">{sOf(c.follow_up)}</div>}
                <p className="text-xs text-muted-foreground">
                  {sOf(c.follow_up_answer, "") === "" ? "— not answered" : sOf(c.follow_up_answer)}
                </p>
              </div>
            )}
          </React.Fragment>
        ))
      )}
      {full == null && (
        <p className="pt-2.5 text-xs leading-[1.35] text-tertiary">
          The original response is older than the list below, so the question wording and the
          recommend score could not be attached.
        </p>
      )}
      <SheetHead>FOLLOW-UP</SheetHead>
      <DetailRow label="Status" value={sOf(ticket.recovery_status, "open")} />
      {sOf(ticket.recovery_resolved_at, "") !== "" && (
        <DetailRow label="Resolved" value={fmtShort(sOf(ticket.recovery_resolved_at, ""), timezone)} />
      )}
      {sOf(ticket.recovery_resolved_by, "") !== "" && (
        <DetailRow label="Resolved by" value={sOf(ticket.recovery_resolved_by, "")} />
      )}
      {sOf(ticket.recovery_note, "") !== "" && (
        <p className="text-xs text-muted-foreground">{sOf(ticket.recovery_note, "")}</p>
      )}
    </DrillSheet>
  );
}

/* ── Per-waiter feedback ──────────────────────────────────────────────── */

/**
 * How one waiter's own QR is actually performing. Reached from a button on
 * the QR card rather than the card itself — that card holds a selectable URL,
 * and a tap gesture over it would fight text selection.
 */
export function WaiterFeedbackSheet({
  name,
  eid,
  items,
  timezone,
  onClose,
}: SheetShellProps & {
  name: string;
  eid: string;
  items: FeedbackEntry[];
  timezone: string;
}): React.JSX.Element {
  const mine = items.filter((m) => sOf(m.employee_id, "") === eid);
  const scored = mine.filter((m) => numOf(m.overall_rating) > 0);
  const avg =
    scored.length === 0
      ? null
      : scored.reduce((a, m) => a + numOf(m.overall_rating), 0) / scored.length;
  const spread = ratingSpread(mine);
  const unhappy = spread[0] + spread[1];

  return (
    <DrillSheet {...sheetProps(onClose)} eyebrow="Feedback tagged to this waiter" title={name}>
      {mine.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No loaded response is tagged to them. Either their QR has not been scanned yet, or their
          responses are older than the newest {items.length} shown on this page.
        </p>
      ) : (
        <>
          <DetailRow label="Responses" value={`${mine.length}`} />
          <DetailRow label="Average" value={avg == null ? "—" : `${avg.toFixed(2)} / 5`} />
          <DetailRow
            label="At 2 stars or below"
            value={`${unhappy}`}
            trailing={pctOf(unhappy, scored.length)}
          />
          <SheetHead>MOST RECENT</SheetHead>
          {mine.slice(0, 6).map((m) => (
            <DetailRow
              key={m.id}
              label={sOf(m.customer_name, "Guest")}
              value={`${scoreOf(m.overall_rating)} / 5`}
              trailing={fmtShort(sOf(m.submitted_at, ""), timezone)}
            />
          ))}
          {mine.length > 6 && (
            <p className="pt-1.5 text-xs text-muted-foreground">
              and {mine.length - 6} more in the list below.
            </p>
          )}
        </>
      )}
    </DrillSheet>
  );
}
