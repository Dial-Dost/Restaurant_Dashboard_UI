"use client";

// Projected impact — Flutter `_resultsSection` (simulation.dart ~827-1030):
// error card with Try again, pre-run placeholder, or the results card
// (warnings first, the 12-row borderless table with the optional-row rule,
// the ran-with marketing payback chip, then the notes).

import type { JSX } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ForkCard } from "@/components/ui/fork-card";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";
import type { SimulationLine, SimulationResult } from "@/lib/api/simulation";
import { simFinite, type MoneyFormat, type RunBody } from "@/lib/simulation-params";
import { simNum, tenth } from "./sim-format";

interface RowDef {
  key: keyof SimulationLine;
  label: string;
  unit: "money" | "count" | "min";
  /** A rise is bad (costs, turnaround). */
  cost: boolean;
  /** Never coloured (display-only tax line). */
  neutral: boolean;
  /** Shown only when non-zero in current or simulated. */
  optional: boolean;
}

const ROWS: RowDef[] = [
  { key: "covers", label: "Covers / day", unit: "count", cost: false, neutral: false, optional: false },
  { key: "apc", label: "APC", unit: "money", cost: false, neutral: false, optional: false },
  { key: "revenue", label: "Revenue / day", unit: "money", cost: false, neutral: false, optional: false },
  { key: "service_charge", label: "Service charge / day", unit: "money", cost: false, neutral: false, optional: true },
  { key: "revenue_deductions", label: "Discounts & commission", unit: "money", cost: true, neutral: false, optional: true },
  { key: "labour_cost", label: "Labour / day", unit: "money", cost: true, neutral: false, optional: false },
  { key: "food_cost", label: "Food cost / day", unit: "money", cost: true, neutral: false, optional: false },
  { key: "fixed_cost", label: "Fixed costs / day", unit: "money", cost: true, neutral: false, optional: true },
  { key: "marketing_per_day", label: "Marketing / day", unit: "money", cost: true, neutral: false, optional: false },
  { key: "net_profit", label: "Net profit / day", unit: "money", cost: false, neutral: false, optional: false },
  { key: "tat_min", label: "Turnaround", unit: "min", cost: true, neutral: false, optional: false },
  { key: "tax_collected", label: "Tax collected / day", unit: "money", cost: false, neutral: true, optional: true },
];

interface ResultsSectionProps {
  result: SimulationResult | null;
  /** The exact body that produced `result`. */
  ranWith: RunBody | null;
  runError: string | null;
  running: boolean;
  money: MoneyFormat;
  onRetry: () => void;
}

export function ResultsSection({ result, ranWith, runError, running, money, onRetry }: ResultsSectionProps): JSX.Element {
  if (runError != null) {
    return (
      <ForkCard inset>
        <h4 className="text-sm font-semibold">The simulation could not run.</h4>
        <p className="mt-1 text-xs text-muted-foreground">{runError}</p>
        <Button className="mt-3" variant="outline" size="sm" disabled={running} onClick={onRetry}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Try again
        </Button>
      </ForkCard>
    );
  }
  if (result == null) {
    return (
      <ForkCard inset>
        <p className="text-xs text-muted-foreground">
          Projected impact appears here after a run — every major number as CURRENT | SIMULATED | DELTA.
        </p>
      </ForkCard>
    );
  }

  const plain = (r: RowDef, v: number): string =>
    r.unit === "money" ? money(v) : r.unit === "min" ? `${simNum(v)} min` : simNum(v);

  const visible = ROWS.filter((r) => !r.optional || result.current[r.key] !== 0 || result.simulated[r.key] !== 0);
  const beDays = result.breakeven_days != null ? Math.round(result.breakeven_days) : null;
  const ranSpend = simFinite(ranWith?.marketing_spend);

  return (
    <div>
      <SectionHeader title="Projected impact" />
      <ForkCard>
        {result.warnings.length > 0 && (
          <div className="mb-3 grid gap-1.5">
            {result.warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        <div role="table" className="text-[12.5px]">
          <div role="row" className="grid grid-cols-[1.5fr_1fr_1.1fr_1.1fr] gap-2 py-1.5">
            <span role="columnheader" className="micro-label">Metric</span>
            <span role="columnheader" className="micro-label text-right">Current</span>
            <span role="columnheader" className="micro-label text-right">Simulated</span>
            <span role="columnheader" className="micro-label text-right">Delta</span>
          </div>
          {visible.map((r) => {
            const d = result.delta[r.key];
            // Judge the delta AFTER display rounding.
            const dr = r.unit === "money" ? Math.round(d) : tenth(d);
            const zero = dr === 0;
            const good = r.cost ? dr < 0 : dr > 0;
            const tone = zero || r.neutral ? "text-muted-foreground" : good ? "text-success" : "text-destructive";
            const deltaText = zero
              ? r.unit === "money" ? money(0) : r.unit === "min" ? "0 min" : "0"
              : `${dr > 0 ? "+" : ""}${plain(r, dr)}`;
            const numCell = "min-w-0 truncate text-right tabular-nums";
            return (
              <div key={r.key} role="row" className="grid grid-cols-[1.5fr_1fr_1.1fr_1.1fr] items-center gap-2 py-1.5">
                <span role="cell" className="text-xs text-muted-foreground">{r.label}</span>
                <span role="cell" className={cn(numCell, "font-medium")}>{plain(r, result.current[r.key])}</span>
                <span role="cell" className={cn(numCell, "font-medium")}>{plain(r, result.simulated[r.key])}</span>
                <span role="cell" className={cn(numCell, "font-semibold", tone)}>{deltaText}</span>
              </div>
            );
          })}
        </div>

        {ranSpend > 0 && (
          <div className="mt-3">
            {beDays != null ? (
              <StatusChip status="info" label={`Marketing pays back in ~${beDays} day${beDays === 1 ? "" : "s"}`} />
            ) : (
              <p className="text-xs text-muted-foreground">
                The one-time {money(ranSpend)} spend never breaks even under these settings — there is no daily profit
                uplift to pay it back.
              </p>
            )}
          </div>
        )}

        {result.notes.length > 0 && (
          <>
            <div className="my-4 h-px bg-divider" />
            <ul className="grid gap-1.5">
              {result.notes.map((n, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span aria-hidden className="mt-[3px] h-3 w-[2px] shrink-0 rounded-[1px] bg-accent-hi" />
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </ForkCard>
    </div>
  );
}
