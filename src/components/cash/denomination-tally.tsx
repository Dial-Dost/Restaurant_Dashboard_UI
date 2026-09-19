"use client";

// COUNT THE DRAWER — web copy of Flutter `_denomTally` (modules.dart
// 26479–26581): count the drawer note by note and coin by coin, then check
// the tally against what the register expects. The counts themselves are NOT
// saved — `CashSessions` has no denomination column and POST /cash/close
// reads only counted_cash / cash_payouts / notes — so the section says so
// rather than implying a record it cannot keep. What the tally does is
// compute the TOTAL and drive the Counted-cash field (the parent owns that
// wiring, `_denomChanged`).
//
// `expected` arrives already netted of the typed Cash-paid-out figure,
// because the server computes the stored variance as counted − (float +
// sales − refunds − payouts): comparing against live_expected alone would
// show "Balanced" on a drawer the server then records as short by exactly
// the payout (modules.dart 26641–26646).

import * as React from "react";
import { Calculator } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ForkCard } from "@/components/ui/fork-card";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";
import type { StatusChipStatus } from "@/components/ui/status-chip";
import {
  DENOMINATIONS,
  denomCountOf,
  denomEntered,
  denomTotal,
  moneyOf,
} from "@/components/cash/format";

export interface DenominationTallyProps {
  /** One digits-only string per denomination, owned by the page. */
  counts: readonly string[];
  onCountChange: (index: number, digits: string) => void;
  /** Live expected MINUS the typed Cash-paid-out figure. */
  expected: number;
  /** Currency symbol for the summary rows (the denominations are ₹). */
  symbol: string;
}

export function DenominationTally({
  counts,
  onCountChange,
  expected,
  symbol,
}: DenominationTallyProps): React.JSX.Element {
  // Collapsible, because it is eleven fields; open by default because
  // counting the drawer IS closing the drawer (`_showDenoms = true`).
  const [show, setShow] = React.useState(true);

  const total = denomTotal(counts);
  const entered = denomEntered(counts);
  const diff = total - expected;
  const diffStatus: StatusChipStatus = diff === 0 ? "success" : diff > 0 ? "warning" : "danger";
  // Never colour alone: the chip always spells out which way it is out.
  const diffLabel = diff === 0 ? "Balanced" : diff > 0 ? "Over" : "Short";

  const line = (i: number): React.JSX.Element => {
    const { value, coin } = DENOMINATIONS[i];
    const n = denomCountOf(counts, i);
    return (
      // ₹20 and ₹10 are each a note AND a coin, so the row's own label is
      // not a unique handle for it — key by (value, isCoin).
      <div key={`denom-${coin ? "coin" : "note"}-${value}`} className="mb-2 flex items-center">
        <span className="w-[66px] shrink-0 truncate text-[13px] text-foreground">₹{value}</span>
        <Input
          value={counts[i] ?? ""}
          inputMode="numeric"
          placeholder="0"
          aria-label={`₹${value} ${coin ? "coin" : "note"} count`}
          onChange={(e) => { onCountChange(i, e.target.value.replace(/\D/g, "")); }}
          className="h-8 min-w-0 flex-1 px-2.5 py-1 text-[13px] md:text-[13px]"
        />
        <span className="ml-2 w-[84px] shrink-0 truncate text-right text-xs text-muted-foreground tabular-nums">
          {n === 0 ? "—" : `₹${n * value}`}
        </span>
      </div>
    );
  };

  const summaryRow = (label: string, valueSlot: React.ReactNode): React.JSX.Element => (
    <div className="flex items-center py-1">
      <span className="min-w-0 flex-1 text-[13px] text-muted-foreground">{label}</span>
      <span className="ml-2 shrink-0">{valueSlot}</span>
    </div>
  );

  return (
    <ForkCard inset className="p-3">
      <div className="flex items-center">
        <Calculator aria-hidden className="h-[15px] w-[15px] shrink-0 text-accent-foreground" />
        <span className="micro-label ml-2 min-w-0 flex-1">COUNT THE DRAWER</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => { setShow((s) => !s); }}
        >
          {show ? "Hide" : "Show"}
        </Button>
      </div>

      {show && (
        <>
          <p className="mt-2 text-xs text-muted-foreground">
            Enter how many of each — the total fills in Counted cash below. The
            per-denomination counts are a counting aid and are not saved with
            the session.
          </p>
          <div className="micro-label mt-3">NOTES</div>
          <div className="mt-2">
            {DENOMINATIONS.map((d, i) => (!d.coin ? line(i) : null))}
          </div>
          <div className="micro-label mt-1">COINS</div>
          <div className="mt-2">
            {DENOMINATIONS.map((d, i) => (d.coin ? line(i) : null))}
          </div>
        </>
      )}

      <div aria-hidden className="my-1.5 h-px bg-divider" />
      {summaryRow(
        "Counted from tally",
        <span className="text-[15px] font-semibold text-foreground tabular-nums">
          {moneyOf(symbol, total)}
        </span>,
      )}
      {summaryRow(
        "Expected in drawer",
        <span className="text-[13px] font-semibold text-foreground tabular-nums">
          {moneyOf(symbol, expected)}
        </span>,
      )}
      {entered &&
        summaryRow(
          "Difference",
          <StatusChip
            status={diffStatus}
            label={diff === 0 ? diffLabel : `${diffLabel} ${moneyOf(symbol, Math.abs(diff))}`}
            dense
          />,
        )}
    </ForkCard>
  );
}
