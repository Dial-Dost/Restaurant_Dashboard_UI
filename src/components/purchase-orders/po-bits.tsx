"use client";

// Small shared pieces of the Purchase Orders module — the web copies of the
// Flutter helpers the module leans on (`_statusColor`, `_detailRow`, the
// AnimatedSwitcher-wrapped StatusChip in `_poCard`, and the `qty()` /
// `_money` formatters). Kept local to the module, like every other module's
// bits file.

import * as React from "react";

import { StatusChip } from "@/components/ui/status-chip";
import type { StatusChipStatus } from "@/components/ui/status-chip";

/** PO status voice (modules.dart `_statusColor`): draft=neutral, ordered=info,
 *  received=success, cancelled=danger — always paired with the labelled chip. */
export const poStatusOf = (status: string): StatusChipStatus => {
  switch (status) {
    case "received": return "success";
    case "ordered": return "info";
    case "cancelled": return "danger";
    default: return "neutral";
  }
};

/** Flutter `qty()`: whole quantities print as integers, fractional as 2dp. */
export const qtyText = (v: number): string =>
  v === Math.round(v) ? v.toFixed(0) : v.toFixed(2);

/** Flutter `_money`: `₹{n.toFixed(2)}`, or an em dash when there is no number. */
export const poMoney = (symbol: string, v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? "—" : `${symbol}${v.toFixed(2)}`;

/**
 * The card's status chip wrapped in the keyed cross-fade Flutter gets from an
 * `AnimatedSwitcher` keyed `po-{id}-{status}` — a Place/Cancel/Receive visibly
 * fades the new chip in instead of snapping. Dense below the app-wide 760px
 * narrow edge, exactly like the Flutter card.
 */
export function PoStatusChip({ id, status }: { id: string; status: string }): React.JSX.Element {
  const tone = poStatusOf(status);
  return (
    <span key={`po-${id}-${status}`} className="inline-flex animate-in fade-in-0 duration-base">
      <StatusChip label={status} status={tone} className="max-[759px]:hidden" />
      <StatusChip label={status} status={tone} dense className="min-[760px]:hidden" />
    </span>
  );
}

/**
 * Quiet label / value line inside the detail sheet (modules.dart
 * `_detailRow`): label left; optional small qualifier + semibold value right;
 * wraps rather than truncating the money on narrow widths.
 */
export function PoDetailRow({
  label,
  value,
  trailing,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  trailing?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 py-[5px]">
      <span className="text-[13px] text-foreground">{label}</span>
      <span className="flex flex-wrap items-center gap-x-4">
        {trailing != null && <span className="text-xs text-muted-foreground">{trailing}</span>}
        <span className="text-[13px] font-semibold text-foreground tabular-nums">{value}</span>
      </span>
    </div>
  );
}

/** The sheet's uppercase micro section label ("LINES (3)", "DATES", "NOTES"). */
export function PoSectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="micro-label pb-0.5 pt-3.5">{children}</div>;
}
