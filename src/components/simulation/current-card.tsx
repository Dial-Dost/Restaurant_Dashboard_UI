"use client";

// Current Performance — Flutter `_currentCard` (simulation.dart ~748-806): ten
// labelled rows, a refresh button, the fixed-window sentence, and a warning
// "estimated" chip before any value the backend could not measure.

import type { JSX } from "react";
import { RefreshCw } from "lucide-react";

import { ForkCard } from "@/components/ui/fork-card";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusChip } from "@/components/ui/status-chip";
import type { SimulationBaseline } from "@/lib/api/simulation";
import type { MoneyFormat } from "@/lib/simulation-params";
import { simNum } from "./sim-format";

interface CurrentCardProps {
  baseline: SimulationBaseline;
  money: MoneyFormat;
  currencySymbol: string;
  onReload: () => void;
}

export function CurrentCard({ baseline: b, money, currencySymbol, onReload }: CurrentCardProps): JSX.Element {
  const days = b.window_days > 0 ? Math.round(b.window_days) : 30;
  const rows: [string, string, keyof SimulationBaseline][] = [
    ["Covers / day", simNum(b.covers_per_day), "covers_per_day"],
    ["APC", money(b.apc), "apc"],
    ["Revenue / day", money(b.revenue_per_day), "revenue_per_day"],
    ["Food cost", `${simNum(b.food_cost_pct)}%`, "food_cost_pct"],
    ["Labour / day", money(b.labour_cost_per_day), "labour_cost_per_day"],
    ["Staff on shift", simNum(b.staff_count), "staff_count"],
    ["Avg turnaround", `${simNum(b.avg_tat_min)} min`, "avg_tat_min"],
    ["Tables", simNum(b.table_count), "table_count"],
    ["Fixed costs / day", money(b.fixed_costs_per_day), "fixed_costs_per_day"],
    ["Net profit / day", money(b.net_profit_per_day), "net_profit_per_day"],
  ];
  return (
    <ForkCard>
      <SectionHeader
        className="mb-1"
        title="Current Performance"
        trailing={
          <button
            type="button"
            title="Reload the live baseline"
            aria-label="Reload the live baseline"
            onClick={onReload}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-fast hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        }
      />
      <p className="text-xs text-muted-foreground">
        Live, from the last {days} days — a fixed window, unlike the other reporting screens. All {currencySymbol}{" "}
        figures are pre-tax (bill subtotal), per day.
      </p>
      <div className="mt-2">
        {rows.map(([label, value, key]) => (
          <div key={key} className="flex items-center gap-2 py-[5px]">
            <span className="micro-label min-w-0 flex-1 truncate">{label}</span>
            {b.sources[key] === "default" && <StatusChip status="warning" label="estimated" dense />}
            <span className="text-[13px] font-semibold tabular-nums text-foreground">{value}</span>
          </div>
        ))}
      </div>
    </ForkCard>
  );
}
