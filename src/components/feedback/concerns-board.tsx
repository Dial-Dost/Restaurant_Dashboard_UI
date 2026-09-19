"use client";

// The Concerns board — the web copy of Flutter's `_ConcernsBoard`,
// `_concernCard`, `_concernSheet` and `_concernBandChip`
// (restaurant_owner_app/lib/screens/modules.dart 6929–7292).
//
// Everything that needs a person, worst first. Reads GET /analytics/concerns,
// which EXTENDS the Overview strip's `needs_attention` rather than
// re-detecting it — so a count here and a count on the Overview can never
// disagree. The routing below is the attention strip's, deliberately: both
// screens read the same `deep_link`, so a row cannot send the two lists to
// different places.

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BadgeCheck, CalendarRange, Lightbulb, RefreshCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DrillSheet, DrillSheetAction } from "@/components/ui/drill-sheet";
import { EmptyState } from "@/components/ui/empty-state";
import { ForkCard } from "@/components/ui/fork-card";
import { SectionHeader } from "@/components/ui/section-header";
import { InfoChip, StatusChip, type StatusChipStatus } from "@/components/ui/status-chip";
import { withFocusParam } from "@/components/focus-banner";
import { DetailRow, SheetHead } from "@/components/feedback/bits";
import { moneyOf, scoreOf, sOf } from "@/components/feedback/feedback-format";
import { useCurrency } from "@/hooks/use-currency";
import { useVisibleNav } from "@/hooks/use-nav";
import { moduleByLabel } from "@/lib/nav-registry";
import { formatFullDateTime } from "@/lib/tz";
import { useTimezone } from "@/lib/use-timezone";
import type { Concern, ConcernSeverity, ConcernsPayload } from "@/lib/api/feedback";

/** Severity bands, worst first — the order the screen renders them in. */
const CONCERN_SEVERITIES: readonly ConcernSeverity[] = ["high", "medium", "low"];

const CONCERN_STATUS: Record<ConcernSeverity, StatusChipStatus> = {
  high: "danger",
  medium: "warning",
  low: "info",
};

const CONCERN_VAR: Record<ConcernSeverity, string> = {
  high: "--destructive",
  medium: "--warning",
  low: "--info",
};

/** What a band means in the owner's terms. "High" alone says how bad, not
 *  how soon — and how soon is the decision being made on this screen. */
const bandTitle = (severity: ConcernSeverity): string =>
  severity === "high"
    ? "High — deal with today"
    : severity === "medium"
      ? "Medium — deal with this week"
      : "Low — worth a look";

/* ── Deep-link routing (the attention strip's, verbatim) ─────────────── */

/**
 * Focus keys each destination module actually READS — `_attentionFocusKeys`.
 * A module not listed here (Inventory, Menu) reads no focus at all. 'Tables'
 * deliberately omits `entity_id`: it resolves ids against TABLE NAMES.
 */
const ATTENTION_FOCUS_KEYS: Readonly<Record<string, readonly string[]>> = {
  Orders: ["entity_id", "order_id", "table"],
  Tables: ["table", "table_name"],
  Bookings: ["entity_id", "booking_id"],
  Feedback: ["entity_id", "feedback_id"],
  Waitlist: ["entity_id", "waitlist_id"],
};

/**
 * The part of a deep link's `params` [dest] can actually resolve — null when
 * nothing survives, so the row navigates with no focus request at all
 * (`_attentionFocus`). Forwarding a key nothing reads — `filter`, `status`,
 * `q` — would land the user on the right screen and then tell them their
 * record "isn't in this list".
 */
const concernFocus = (
  dest: string | null,
  signalKey: string,
  params: Record<string, unknown> | undefined,
): Record<string, unknown> | null => {
  const keys = dest == null ? undefined : ATTENTION_FOCUS_KEYS[dest];
  if (!keys || !params) { return null; }
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    // `pending_discounts` routes to Orders but its entity_id is a
    // DiscountRequests id, which Orders compares against ORDER ids.
    if (k === "entity_id" && signalKey === "pending_discounts") { continue; }
    const v = params[k];
    const s = `${typeof v === "string" || typeof v === "number" ? v : ""}`.trim();
    if (s === "" || s === "null") { continue; }
    out[k] = v;
  }
  return Object.keys(out).length === 0 ? null : out;
};

interface ConcernRoute {
  dest: string;
  href: string;
  focus: Record<string, unknown> | null;
}

/**
 * The concern's destination for this user, or null when unroutable (the
 * card then carries no "Open …" button and the sheet no jump). `deep_link`
 * is the routing the server verified against both clients; `module` is the
 * legacy fallback. The server's `href` wins when it belongs to the module
 * chosen — it is the only route the backend has confirmed the destination
 * page actually parses.
 */
const concernRoute = (c: Concern, canOpen: (label: string) => boolean): ConcernRoute | null => {
  const deep = (c.deep_link.module || "").trim();
  const legacy = (c.module || "").trim();
  const dest = canOpen(deep) ? deep : canOpen(legacy) ? legacy : null;
  if (dest == null) { return null; }
  const served = (c.deep_link.href ?? "").trim();
  const href = dest === deep && served !== "" ? served : moduleByLabel(dest)?.href;
  if (href == null) { return null; }
  return { dest, href, focus: concernFocus(dest, c.key, c.deep_link.params) };
};

/* ── One severity's summary pill, doubling as the filter ─────────────── */

/**
 * `_concernBandChip`: a band with nothing in it renders as a plain chip — no
 * click cursor, no tap. Selection is spelled out in the label ("2 high ·
 * only"), so the state is never carried by the tint alone.
 */
function ConcernBandChip({
  severity,
  count,
  selected,
  onTap,
}: {
  severity: ConcernSeverity;
  count: number;
  selected: boolean;
  onTap?: () => void;
}): React.JSX.Element {
  const chip = (
    <StatusChip
      status={CONCERN_STATUS[severity]}
      label={selected ? `${count} ${severity} · only` : `${count} ${severity}`}
    />
  );
  if (onTap == null) { return chip; }
  return (
    <button
      type="button"
      onClick={onTap}
      aria-pressed={selected}
      className="cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {chip}
    </button>
  );
}

/* ── One concern card ─────────────────────────────────────────────────── */

/**
 * `_concernCard`: what is wrong, WHO or WHAT it is happening to (by name —
 * a bare "6 items low on stock" sends the owner off to find out WHICH six),
 * the server's suggested action, and a working way to go and fix it. The
 * card caps the offenders at five and drops the server's prose the moment it
 * has any of them; the sheet carries both in full. The "Open <dest>" button
 * stays exactly where it was — the card tap is the additional way in, never
 * a replacement for it.
 */
function ConcernCard({
  concern,
  route,
  money,
  onOpenSheet,
  onJump,
}: {
  concern: Concern;
  route: ConcernRoute | null;
  money: (v: unknown) => string;
  onOpenSheet: () => void;
  onJump: (route: ConcernRoute) => void;
}): React.JSX.Element {
  const severity = concern.severity;
  const shown = concern.items.slice(0, 5);
  const more = concern.count - shown.length;
  const advice = concern.what_to_do;
  const fallbackDest = route?.dest ?? (concern.module || concern.deep_link.module);

  return (
    <ForkCard onClick={onOpenSheet} className="px-4 py-3.5">
      <div className="flex items-center gap-2">
        <StatusChip status={CONCERN_STATUS[severity]} label={severity.toUpperCase()} dense />
        <span className="min-w-0 flex-1 line-clamp-2 text-[13px] font-semibold text-foreground">
          {concern.title}
        </span>
        {concern.amount != null && (
          <span className="shrink-0 text-[13px] font-semibold text-accent-foreground tabular-nums">
            {money(concern.amount)}
          </span>
        )}
      </div>
      <div className="micro-label mt-2">{concern.count} affected</div>
      {shown.length > 0 ? (
        <div className="mt-2">
          {shown.map((it, i) => {
            const sub = sOf(it.sub, "").trim();
            return (
              <div key={it.id ?? `${it.label}-${i}`} className="flex items-start gap-2 py-0.5">
                <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/70" />
                <span className="min-w-0 flex-1 truncate text-xs text-foreground">{sOf(it.label, "")}</span>
                {sub !== "" && (
                  <span className="min-w-0 shrink truncate text-right text-[11px] text-muted-foreground">
                    {sub}
                  </span>
                )}
              </div>
            );
          })}
          {more > 0 && <p className="pt-[3px] text-[10.5px] text-tertiary">and {more} more</p>}
        </div>
      ) : (
        concern.detail !== "" && <p className="mt-2 text-xs text-muted-foreground">{concern.detail}</p>
      )}
      {/* The suggested action, always — every concern on this screen carries
          one, and a problem stated without a next step is just bad news. */}
      <div
        style={{ "--concern-color": `hsl(var(${CONCERN_VAR[severity]}))` } as React.CSSProperties}
        className="mt-3 flex items-start gap-2 rounded-[10px] border border-[color:color-mix(in_srgb,var(--concern-color)_28%,transparent)] bg-[color:color-mix(in_srgb,var(--concern-color)_12%,transparent)] px-3 py-2.5 gaia:rounded-[2px]"
      >
        <Lightbulb aria-hidden className="mt-px h-3.5 w-3.5 shrink-0 text-[color:var(--concern-color)]" />
        <p className="min-w-0 text-xs text-foreground">
          {advice !== ""
            ? advice
            // The server sends advice for every key it knows — this is a last
            // resort, and it still names a destination rather than shrugging.
            : `Open ${fallbackDest} and clear these ${concern.count}.`}
        </p>
      </div>
      {route != null && (
        <div
          className="mt-2.5"
          onClick={(e) => { e.stopPropagation(); }}
          onKeyDown={(e) => { e.stopPropagation(); }}
        >
          <Button type="button" variant="outline" size="sm" onClick={() => { onJump(route); }}>
            <ArrowRight /> Open {route.dest}
          </Button>
        </div>
      )}
    </ForkCard>
  );
}

/* ── The concern detail sheet ─────────────────────────────────────────── */

/**
 * `_concernSheet`: the whole concern, which the card can only ever show part
 * of — EVERY offender (the card stops at five), the server's prose (the card
 * drops it as soon as it has structured rows), and the window the count was
 * measured over. The jump carries the same filtered focus payload the card's
 * button does.
 */
function ConcernSheet({
  concern,
  windowDays,
  route,
  money,
  onJump,
  onClose,
}: {
  concern: Concern;
  windowDays: number;
  route: ConcernRoute | null;
  money: (v: unknown) => string;
  onJump: (route: ConcernRoute) => void;
  onClose: () => void;
}): React.JSX.Element {
  // The server sends the worst offenders, not necessarily all of them, so a
  // shortfall is stated rather than left as a silent disagreement with count.
  const unlisted = concern.count - concern.items.length;
  return (
    <DrillSheet
      open
      onOpenChange={(open) => { if (!open) { onClose(); } }}
      eyebrow={bandTitle(concern.severity)}
      title={concern.title}
      action={
        route != null ? (
          <DrillSheetAction
            module={route.dest}
            className="text-accent-foreground"
            onClick={() => {
              onClose();
              onJump(route);
            }}
          />
        ) : undefined
      }
    >
      <DetailRow label="Affected" value={`${concern.count}`} />
      {concern.amount != null && <DetailRow label="At stake" value={money(concern.amount)} />}
      <DetailRow label="Measured over" value={`Last ${windowDays} days`} />
      {concern.detail !== "" && (
        <p className="pt-3 text-xs text-muted-foreground">{concern.detail}</p>
      )}
      {concern.items.length > 0 && (
        <>
          <SheetHead>AFFECTED</SheetHead>
          {concern.items.map((it, i) => {
            const sub = sOf(it.sub, "").trim();
            return (
              <DetailRow
                key={it.id ?? `${it.label}-${i}`}
                label={sOf(it.label, "")}
                value={sub !== "" ? sub : it.value == null ? "—" : scoreOf(it.value)}
              />
            );
          })}
          {unlisted > 0 && (
            <p className="pt-1 text-xs text-tertiary">{unlisted} more not listed by the server.</p>
          )}
        </>
      )}
      {concern.what_to_do !== "" && (
        <>
          <SheetHead>WHAT TO DO</SheetHead>
          <p className="pt-1.5 text-xs text-foreground">{concern.what_to_do}</p>
        </>
      )}
    </DrillSheet>
  );
}

/* ── The board ────────────────────────────────────────────────────────── */

/**
 * Stateful only for the severity filter. The summary pills and the band
 * headings are the same control from two places — on a busy day this list
 * runs well past a screen, and "show me only the ones I have to deal with
 * today" is the question those two counts were already being asked.
 */
export function ConcernsBoard({
  data,
  reload,
}: {
  data: ConcernsPayload;
  reload: () => void;
}): React.JSX.Element {
  const router = useRouter();
  const { labels } = useVisibleNav();
  const { currencySymbol } = useCurrency();
  const { timezone } = useTimezone();
  const [bandState, setBandState] = React.useState<ConcernSeverity | null>(null);
  const [sheet, setSheet] = React.useState<Concern | null>(null);

  const canOpen = React.useCallback((label: string) => labels.includes(label), [labels]);
  const money = React.useCallback((v: unknown) => moneyOf(currencySymbol, v), [currencySymbol]);

  const openRoute = React.useCallback(
    (route: ConcernRoute) => {
      router.push(
        route.focus != null && Object.keys(route.focus).length > 0
          ? withFocusParam(route.href, route.focus)
          : route.href,
      );
    },
    [router],
  );

  const all = data.concerns;
  const windowDays = data.window_days;

  if (all.length === 0) {
    // Good news, not a failed load: an empty list is the state an owner is
    // trying to reach, so it reads as an achievement rather than an error.
    const overviewHref = canOpen("Overview") ? moduleByLabel("Overview")?.href : undefined;
    return (
      <EmptyState
        icon={<BadgeCheck />}
        title="Nothing needs your attention"
        caption={`No open concerns across stock, bills, approvals, staff, guest feedback or suppliers in the last ${windowDays} days. Anything that goes wrong shows up here on its own.`}
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={reload}>
              <RefreshCw /> Check again
            </Button>
            {overviewHref != null && (
              <Button type="button" size="sm" onClick={() => { router.push(overviewHref); }}>
                <ArrowRight /> Back to Overview
              </Button>
            )}
          </div>
        }
      />
    );
  }

  const bandCount = (sev: ConcernSeverity): number =>
    all.filter((c) => c.severity === sev).length;
  // A refresh can empty the band that was selected; falling back to "all"
  // beats showing a filtered screen with nothing on it and no explanation.
  const band = bandState != null && bandCount(bandState) > 0 ? bandState : null;

  const toggleBand = (sev: ConcernSeverity): void => {
    setBandState(band === sev ? null : sev);
  };

  return (
    <div>
      <SectionHeader
        title="Concerns"
        count={all.length}
        trailing={
          <Button type="button" variant="outline" size="sm" onClick={reload}>
            <RefreshCw /> Refresh
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        {CONCERN_SEVERITIES.map((sev) => (
          <ConcernBandChip
            key={sev}
            severity={sev}
            count={data.totals[sev] ?? bandCount(sev)}
            selected={band === sev}
            onTap={bandCount(sev) === 0 ? undefined : () => { toggleBand(sev); }}
          />
        ))}
        <InfoChip icon={<CalendarRange />} label={`Last ${windowDays} days`} />
        {band != null && (
          <Button type="button" variant="ghost" size="sm" onClick={() => { setBandState(null); }}>
            <X /> Show every severity
          </Button>
        )}
      </div>
      <div className="mt-4 space-y-5">
        {CONCERN_SEVERITIES.map((sev) => {
          if (band != null && sev !== band) { return null; }
          const rows = all.filter((c) => c.severity === sev);
          if (rows.length === 0) { return null; }
          return (
            <section key={sev}>
              {/* The band heading is the same filter from a second place. */}
              <button
                type="button"
                onClick={() => { toggleBand(sev); }}
                aria-pressed={band === sev}
                className="block w-full cursor-pointer rounded-[6px] text-left transition-colors duration-fast hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <SectionHeader
                  title={bandTitle(sev)}
                  count={rows.length}
                  trailing={
                    <span className="micro-label">
                      {band === sev ? "Showing only this band" : "Show only this band"}
                    </span>
                  }
                  className="mb-0"
                />
              </button>
              <div className="mt-3.5 grid grid-cols-1 gap-3.5 min-[1000px]:grid-cols-2 min-[1500px]:grid-cols-3">
                {rows.map((c, i) => (
                  <ConcernCard
                    key={`${c.key}-${i}`}
                    concern={c}
                    route={concernRoute(c, canOpen)}
                    money={money}
                    onOpenSheet={() => { setSheet(c); }}
                    onJump={openRoute}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {data.generated_at !== "" && (
        <p className="micro-label mt-4">Checked {formatFullDateTime(data.generated_at, timezone)}</p>
      )}
      {sheet != null && (
        <ConcernSheet
          concern={sheet}
          windowDays={windowDays}
          route={concernRoute(sheet, canOpen)}
          money={money}
          onJump={openRoute}
          onClose={() => { setSheet(null); }}
        />
      )}
    </div>
  );
}
