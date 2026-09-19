"use client";

// Small shared pieces of the Feedback + Concerns screens — the web copies of
// Flutter's `InitialsAvatar`, `_detailRow` and the micro section heads the
// drill sheets use ("AFFECTED", "IN THEIR WORDS", …).

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Flutter `InitialsAvatar`: a 38px circle on the inset fill with a tinted
 * edge. `text` is rendered verbatim (uppercased) — the recovery cards put the
 * RAW rating in it ("1.25"), not initials, exactly as the app does.
 */
export function InitialsAvatar({
  text,
  danger = false,
  size = 38,
  className,
}: {
  text: string;
  /** Recovery voice: the red edge + ink instead of the copper. */
  danger?: boolean;
  size?: number;
  className?: string;
}): React.JSX.Element {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.round(size * 0.32) }}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-inset font-semibold uppercase tracking-[0.5px] tabular-nums",
        danger
          ? "border border-destructive/35 text-destructive"
          : "border border-accent-hi/35 text-accent-foreground",
        className,
      )}
    >
      {text}
    </span>
  );
}

/**
 * Quiet label / value / trailing line inside a drill sheet (Flutter
 * `_detailRow`): the qualifier drops under the label on a narrow sheet
 * rather than truncating the figure.
 */
export function DetailRow({
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

/** The tracked micro head above a sheet section ("HOW THE SCORES FALL"). */
export function SheetHead({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="micro-label pb-0.5 pt-3.5">{children}</div>;
}
