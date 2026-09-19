"use client";

// Cash register — the web copy of the Flutter `_CashView` (modules.dart
// 26142–26669), to docs/parity/cash.md: one narrow column; the "Open
// register" card cross-fading with the open-session pair (live drawer +
// "Close & count down" with the COUNT THE DRAWER denomination tally); then
// "Past sessions" — section header with closed-count badge and range
// InfoChip, the range chip row, and one ForkCard per closed session with the
// signed-variance MicroStat and the Balanced/Over/Short chip. Cache-primed
// load, skeleton on first paint, LoadErrorState + Retry on failure, stale
// pill when offline.

import { useCallback, useEffect, useState } from "react";
import type { JSX, ReactNode } from "react";
import { Banknote, Calendar, Lock, LockOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ForkCard } from "@/components/ui/fork-card";
import { SkeletonRows } from "@/components/ui/fork-skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { MicroStat } from "@/components/ui/micro-stat";
import { SectionHeader } from "@/components/ui/section-header";
import { CacheStalePill } from "@/components/ui/stale-pill";
import { InfoChip, StatusChip } from "@/components/ui/status-chip";
import type { StatusChipStatus } from "@/components/ui/status-chip";
import { DateRangePicker } from "@/components/date-range-picker";
import { DenominationTally } from "@/components/cash/denomination-tally";
import {
  amountOf,
  denomEntered,
  denomTotal,
  emptyDenomCounts,
  moneyOf,
  numOf,
  shortTime,
} from "@/components/cash/format";
import { useNarrow } from "@/components/cash/use-narrow";
import { useCachedFetch } from "@/hooks/use-cached-fetch";
import { useCurrency } from "@/hooks/use-currency";
import { useDateRange } from "@/hooks/use-date-range";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { getSelectedOutletId } from "@/lib/outlet";
import { closeCashSession, openCashSession } from "@/lib/db";
import type { CashSession, CurrentCashSession } from "@/lib/db";
import { fetchCashBoard } from "@/lib/api/cash";
import type { CashBoard } from "@/lib/api/cash";

/** Flutter snackbars print `'$e'` — the message, nothing dressed around it. */
const errorTextOf = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

export default function CashPage(): JSX.Element {
  const { user } = useAuth();
  const { currencySymbol } = useCurrency();
  const { toast } = useToast();
  const rid = user?.restaurantUsername ?? "";
  // Z-report hunting is its own question, so this screen keeps its own window —
  // the same control everywhere else uses, remembered separately ("cash").
  const { range, setRange, query, label, timezone } = useDateRange("cash");
  const narrow = useNarrow();

  // Scope the cached copy the way the fetch itself is scoped (the outlet
  // header), so switching outlets can never paint the other drawer first.
  const outletKey = getSelectedOutletId() ?? "";
  const board = useCachedFetch<CashBoard>(
    `cash:${rid}:${outletKey}:${query.from}:${query.to}`,
    useCallback(
      () => fetchCashBoard(rid, query.from, query.to),
      [rid, query.from, query.to],
    ),
    { enabled: rid.length > 0 },
  );

  // Forms (Flutter's four controllers + the twelve denomination counts).
  const [openingFloat, setOpeningFloat] = useState("");
  const [countedCash, setCountedCash] = useState("");
  const [payouts, setPayouts] = useState("");
  const [notes, setNotes] = useState("");
  const [denomCounts, setDenomCounts] = useState<string[]>(emptyDenomCounts);
  const [busy, setBusy] = useState(false);

  // The tally drives the Counted-cash field while it holds any counts, so the
  // number submitted is the one the closer actually counted rather than a
  // second, hand-typed figure that could disagree with it. Clearing every
  // count leaves the field alone, so typing the total straight in still works
  // (Flutter `_denomChanged`).
  useEffect(() => {
    if (denomEntered(denomCounts)) {
      setCountedCash(denomTotal(denomCounts).toFixed(0));
    }
  }, [denomCounts]);

  const onDenomChange = useCallback((i: number, digits: string): void => {
    setDenomCounts((prev) => prev.map((c, idx) => (idx === i ? digits : c)));
  }, []);

  const money = useCallback(
    (v: unknown): string => moneyOf(currencySymbol, v),
    [currencySymbol],
  );
  const fmtTime = useCallback(
    (iso: string | null | undefined): string => shortTime(iso, timezone),
    [timezone],
  );

  // Flutter `_open`: no validation (empty parses to 0), no success snackbar —
  // the UI switching to the open-session card is the confirmation.
  const onOpen = async (): Promise<void> => {
    setBusy(true);
    try {
      await openCashSession(rid, amountOf(openingFloat));
      setOpeningFloat("");
      board.retry();
    } catch (e) {
      toast({ title: errorTextOf(e) });
    } finally {
      setBusy(false);
    }
  };

  // Flutter `_close`: blocks only on an EMPTY counted field; one neutral
  // snackbar reports the stored variance either way.
  const onClose = async (): Promise<void> => {
    if (countedCash.trim() === "") {
      toast({ title: "Enter the counted cash first." });
      return;
    }
    setBusy(true);
    try {
      const res = await closeCashSession(rid, {
        counted_cash: amountOf(countedCash),
        cash_payouts: amountOf(payouts),
        notes: notes.trim(),
      });
      setCountedCash("");
      setPayouts("");
      setNotes("");
      setDenomCounts(emptyDenomCounts());
      const v = numOf(res.variance ?? 0);
      toast({
        title:
          v === 0
            ? "Drawer balanced 🎯"
            : `Variance ${money(v)} (${v > 0 ? "over" : "short"})`,
      });
      board.retry();
    } catch (e) {
      toast({ title: errorTextOf(e) });
    } finally {
      setBusy(false);
    }
  };

  if (board.loading) {
    return (
      <div className="mx-auto w-full max-w-[760px]">
        <SkeletonRows rows={6} />
      </div>
    );
  }

  if (board.error != null || board.data == null) {
    return (
      <LoadErrorState
        whatFailed="Could not load cash sessions"
        error={board.error}
        onRetry={board.retry}
      />
    );
  }

  const current = board.data.current;
  // Empty-check the CLOSED subset, not the raw list: a window whose only
  // session is the open one is an empty Z-report window (modules.dart 26364).
  const closed = board.data.history.filter((s) => s.status === "closed");

  return (
    <div className="relative">
      <div className="mx-auto w-full max-w-[760px]">
        {/* Flutter cross-fades the closed/open pair (AnimatedSwitcher, ease
            in/out, AppDurations.base). */}
        <div
          key={current == null ? "cash-closed" : "cash-open"}
          className="animate-in fade-in-0 duration-base ease-out"
        >
          {current == null ? (
            <OpenRegisterCard
              symbol={currencySymbol}
              openingFloat={openingFloat}
              onOpeningFloatChange={setOpeningFloat}
              busy={busy}
              onOpen={() => { void onOpen(); }}
            />
          ) : (
            <OpenSessionCards
              current={current}
              money={money}
              fmtTime={fmtTime}
              symbol={currencySymbol}
              countedCash={countedCash}
              onCountedCashChange={setCountedCash}
              payouts={payouts}
              onPayoutsChange={setPayouts}
              notes={notes}
              onNotesChange={setNotes}
              denomCounts={denomCounts}
              onDenomChange={onDenomChange}
              busy={busy}
              onClose={() => { void onClose(); }}
            />
          )}
        </div>

        <div className="mt-6">
          <SectionHeader
            className="mb-2"
            title="Past sessions"
            count={closed.length}
            trailing={<InfoChip icon={<Calendar />} label={label} />}
          />
          <div className="mb-3 flex">
            <DateRangePicker
              value={range}
              onChange={setRange}
              timezone={timezone}
              align="start"
              className="w-full flex-1 justify-start"
            />
          </div>
          {closed.length === 0 ? (
            // Names the window rather than saying "yet": with a filter on
            // screen, "no closed sessions yet" would read as "this restaurant
            // has never closed a drawer", which is a different and alarming
            // claim (modules.dart 26388).
            <p className="text-xs text-muted-foreground">
              No closed sessions in {label}.
            </p>
          ) : (
            <div className="space-y-2.5">
              {closed.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  money={money}
                  fmtTime={fmtTime}
                  narrow={narrow}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <CacheStalePill
        offline={board.offline}
        fromCache={board.fromCache}
        updatedAt={board.updatedAt}
      />
    </div>
  );
}

/* ── The closed-register card (no open session) ─────────────────────────── */

function OpenRegisterCard({
  symbol,
  openingFloat,
  onOpeningFloatChange,
  busy,
  onOpen,
}: {
  symbol: string;
  openingFloat: string;
  onOpeningFloatChange: (v: string) => void;
  busy: boolean;
  onOpen: () => void;
}): JSX.Element {
  return (
    <ForkCard>
      <div className="flex items-center">
        <IconTile>
          <LockOpen className="h-4 w-4" />
        </IconTile>
        <span className="ml-3 min-w-0 flex-1 text-[15px] font-semibold tracking-[-0.007em] text-foreground">
          Open register
        </span>
        <StatusChip label="Closed" status="neutral" dense />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        No register is open for this outlet. Enter the starting float to begin.
      </p>
      <div className="mt-3 space-y-1">
        <Label htmlFor="cash-opening-float">Opening float ({symbol})</Label>
        <Input
          id="cash-opening-float"
          type="number"
          inputMode="decimal"
          value={openingFloat}
          onChange={(e) => { onOpeningFloatChange(e.target.value); }}
        />
      </div>
      <div className="mt-3 flex justify-end">
        <Button onClick={onOpen} disabled={busy}>
          <LockOpen />
          {busy ? "…" : "Open register"}
        </Button>
      </div>
    </ForkCard>
  );
}

/* ── The open-session pair: live drawer + close-and-count-down ──────────── */

function OpenSessionCards({
  current,
  money,
  fmtTime,
  symbol,
  countedCash,
  onCountedCashChange,
  payouts,
  onPayoutsChange,
  notes,
  onNotesChange,
  denomCounts,
  onDenomChange,
  busy,
  onClose,
}: {
  current: CurrentCashSession;
  money: (v: unknown) => string;
  fmtTime: (iso: string | null | undefined) => string;
  symbol: string;
  countedCash: string;
  onCountedCashChange: (v: string) => void;
  payouts: string;
  onPayoutsChange: (v: string) => void;
  notes: string;
  onNotesChange: (v: string) => void;
  denomCounts: readonly string[];
  onDenomChange: (i: number, digits: string) => void;
  busy: boolean;
  onClose: () => void;
}): JSX.Element {
  const expected = numOf(current.live_expected);
  return (
    <div>
      <ForkCard>
        <div className="flex items-center">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[hsl(var(--success)/0.28)] bg-[hsl(var(--success)/0.12)] text-success gaia:rounded-[2px]"
          >
            <LockOpen className="h-4 w-4" />
          </span>
          <span className="ml-3 min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.007em] text-foreground">
            Open since {fmtTime(current.opened_at)}
          </span>
          <StatusChip label="Open" status="success" dense />
        </div>
        <div className="mt-3">
          <DrawerRow label="Opening float" value={money(current.opening_float)} />
          <DrawerRow label="Cash sales (settled)" value={money(current.live_cash_sales)} />
          <DrawerRow label="Cash refunds" value={`− ${money(current.live_cash_refunds)}`} />
          <div aria-hidden className="my-1.5 h-px bg-divider" />
          <DrawerRow label="Expected in drawer" value={money(expected)} strong />
        </div>
      </ForkCard>

      <ForkCard className="mt-3">
        <div className="flex items-center">
          <IconTile>
            <Lock className="h-4 w-4" />
          </IconTile>
          <span className="ml-3 min-w-0 flex-1 text-[15px] font-semibold tracking-[-0.007em] text-foreground">
            Close &amp; count down
          </span>
        </div>
        <div className="mt-3">
          {/* Payouts are subtracted here because the server subtracts them
              when it computes the variance it STORES: expected = float +
              sales − refunds − payouts. Comparing the tally against
              live_expected alone would show "Balanced" on a drawer the
              server then records as short by exactly the payout
              (modules.dart 26641–26646). */}
          <DenominationTally
            counts={denomCounts}
            onCountChange={onDenomChange}
            expected={expected - amountOf(payouts)}
            symbol={symbol}
          />
        </div>
        <div className="mt-3 space-y-1">
          <Label htmlFor="cash-counted">Counted cash ({symbol})</Label>
          <Input
            id="cash-counted"
            type="number"
            inputMode="decimal"
            value={countedCash}
            onChange={(e) => { onCountedCashChange(e.target.value); }}
          />
        </div>
        <div className="mt-2.5 space-y-1">
          <Label htmlFor="cash-payouts">Cash paid out ({symbol})</Label>
          <Input
            id="cash-payouts"
            type="number"
            inputMode="decimal"
            value={payouts}
            onChange={(e) => { onPayoutsChange(e.target.value); }}
          />
        </div>
        <div className="mt-2.5 space-y-1">
          <Label htmlFor="cash-notes">Notes (optional)</Label>
          <Input
            id="cash-notes"
            value={notes}
            onChange={(e) => { onNotesChange(e.target.value); }}
          />
        </div>
        <div className="mt-3 flex justify-end">
          <Button onClick={onClose} disabled={busy}>
            <Lock />
            {busy ? "…" : "Close register"}
          </Button>
        </div>
      </ForkCard>
    </div>
  );
}

/* ── One closed session (Z-report) row ──────────────────────────────────── */

function SessionRow({
  session,
  money,
  fmtTime,
  narrow,
}: {
  session: CashSession;
  money: (v: unknown) => string;
  fmtTime: (iso: string | null | undefined) => string;
  narrow: boolean;
}): JSX.Element {
  const v = numOf(session.variance ?? 0);
  const vStatus: StatusChipStatus = v === 0 ? "success" : v > 0 ? "warning" : "danger";
  const vLabel = v === 0 ? "Balanced" : v > 0 ? "Over" : "Short";
  return (
    <ForkCard className="px-4 py-3">
      <div className="flex items-center">
        <span
          aria-hidden
          className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] border border-border bg-inset text-tertiary gaia:rounded-[2px]"
        >
          <Banknote className="h-4 w-4" />
        </span>
        <div className="ml-3 min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-foreground">
            {fmtTime(session.closed_at)}
          </div>
          <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            Float {money(session.opening_float)} · sales {money(session.cash_sales)} · expected {money(session.expected_cash)} · counted {money(session.counted_cash)}
          </div>
        </div>
        <MicroStat
          className="ml-3"
          value={`${v > 0 ? "+" : ""}${money(v)}`}
          label="Variance"
          alignEnd
        />
        <StatusChip className="ml-3.5" label={vLabel} status={vStatus} dense={narrow} />
      </div>
    </ForkCard>
  );
}

/* ── Small shared bits ──────────────────────────────────────────────────── */

/** The 36px inset icon tile every card header leads with. */
function IconTile({ children }: { children: ReactNode }): JSX.Element {
  return (
    <span
      aria-hidden
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-border bg-inset text-accent-foreground gaia:rounded-[2px]"
    >
      {children}
    </span>
  );
}

/** One "label … value" line on the live-drawer card. */
function DrawerRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}): JSX.Element {
  return (
    <div className="flex items-center py-[5px]">
      <span className="min-w-0 flex-1 text-[13px] text-muted-foreground">{label}</span>
      <span
        className={
          strong
            ? "ml-3 shrink-0 text-[15px] font-semibold text-foreground tabular-nums"
            : "ml-3 shrink-0 text-[13px] font-semibold text-foreground tabular-nums"
        }
      >
        {value}
      </span>
    </div>
  );
}
