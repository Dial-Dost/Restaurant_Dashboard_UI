"use client";

// Shared pieces of the inventory module — the web copies of Flutter
// `_inventoryStockColor`, `_stockNum`, `_score`, `_detailRow` and `_TapRow`
// (modules.dart), plus the category grouping of `inventoryModule`.

import * as React from "react";
import type { InventoryItem } from "@/app/dashboard/inventory/page";
import type { StatusChipStatus } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";

export type StockTone = "danger" | "warning" | "success";

/** Out → danger, Low → warning, else success (derived from the server status). */
export const stockTone = (status: string | null | undefined): StockTone => {
  const s = (status ?? "").toLowerCase();
  if (s.includes("out")) {return "danger";}
  if (s.includes("low")) {return "warning";}
  return "success";
};

export const TONE_VAR: Record<StockTone, string> = {
  danger: "--destructive",
  warning: "--warning",
  success: "--success",
};

export const toneChip = (status: string): StatusChipStatus => stockTone(status);

export const isShort = (it: InventoryItem): boolean => stockTone(it.status) !== "success";

/** Whole numbers without decimals; decimals as typed (`_stockNum`). */
export const stockNum = (n: number | null | undefined): string => {
  return n == null || !Number.isFinite(n) ? "0" : String(n);
};

/** Whole → no decimals, else 1dp (`_score`). */
export const score = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export const withUnit = (qty: string, unit: string): string => (unit.trim() ? `${qty} ${unit}` : qty);

export const UNCATEGORISED = "Uncategorised";

export interface StockSection {
  label: string;
  items: InventoryItem[];
  short: number;
}

/**
 * Managed roster ∪ labels carried by items, keyed case-insensitively (first
 * spelling seen wins), named sections alphabetical, "Uncategorised" last.
 * Empty roster sections are kept (they render "Nothing in this section yet.").
 */
export const groupByCategory = (items: InventoryItem[], roster: string[]): StockSection[] => {
  const labels = new Map<string, string>();
  const members = new Map<string, InventoryItem[]>();
  const note = (raw: string): string | null => {
    const label = raw.trim();
    if (!label) {return null;}
    const key = label.toLowerCase();
    if (!labels.has(key)) {
      labels.set(key, label);
      members.set(key, []);
    }
    return key;
  };
  roster.forEach((c) => note(c));
  const loose: InventoryItem[] = [];
  for (const it of items) {
    const key = note(it.category);
    const bucket = key == null ? undefined : members.get(key);
    if (bucket) {bucket.push(it);}
    else {loose.push(it);}
  }
  const named = [...labels.entries()]
    .map(([key, label]) => ({ label, items: members.get(key) ?? [] }))
    .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
  const out = named.map((s) => ({ ...s, short: s.items.filter(isShort).length }));
  if (loose.length > 0) {
    out.push({ label: UNCATEGORISED, items: loose, short: loose.filter(isShort).length });
  }
  return out;
};

/** `_detailRow`: label left, value right, optional tertiary trailing note. */
export function DetailRow({
  label,
  value,
  trailing,
  onClick,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  trailing?: React.ReactNode;
  onClick?: () => void;
}): React.JSX.Element {
  const body = (
    <>
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{label}</span>
      <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">{value}</span>
      {trailing != null && <span className="min-w-[48px] shrink-0 text-right text-xs text-tertiary">{trailing}</span>}
    </>
  );
  const cls = "flex items-center gap-3 border-b border-divider py-2.5 text-left last:border-b-0";
  return onClick ? (
    <TapRow onClick={onClick} className={cn(cls, "w-[calc(100%+1rem)]")}>{body}</TapRow>
  ) : (
    <div className={cn(cls, "w-full")}>{body}</div>
  );
}

/** `_TapRow`: hover wash + pointer on a whole row. */
export function TapRow({
  onClick,
  className,
  children,
}: {
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "-mx-2 rounded-md px-2 transition-colors duration-fast hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
    </button>
  );
}
