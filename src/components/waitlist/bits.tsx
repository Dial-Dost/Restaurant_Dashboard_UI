"use client";

// Small shared pieces of the waitlist page — the web copies of the Flutter
// view's `_roundBadge`, the 40/44px icon tiles, `InitialsAvatar`,
// `_detailRow` and `_TapRow` (modules.dart).

import * as React from "react";

import { cn } from "@/lib/utils";
import { guestInitials } from "@/components/waitlist/format";

/** Round tinted icon badge (Flutter `_roundBadge`) — copper tint + edge. */
export function RoundBadge({
  size = 34,
  className,
  children,
}: {
  size?: number;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border border-accent-hi/30 bg-accent-hi/10 text-accent-foreground",
        "[&>svg]:h-[48%] [&>svg]:w-[48%]",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Square tinted icon tile (the hero's 44px / pending card's 40px tile). */
export function IconTile({
  size = 40,
  className,
  children,
}: {
  size?: number;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[10px] border border-accent-hi/30 bg-accent-hi/10 text-accent-foreground",
        "[&>svg]:h-[46%] [&>svg]:w-[46%]",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** 30px initials avatar for the rail's "to be seated" rows. */
export function InitialsAvatar({ name, size = 30 }: { name: string; size?: number }): React.JSX.Element {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-full border border-accent-hi/30 bg-accent-hi/10 text-[11px] font-semibold text-accent-foreground"
    >
      {guestInitials(name)}
    </span>
  );
}

/** Quiet label / value / trailing line inside a drill sheet (Flutter
 *  `_detailRow`): the qualifier drops under the label on a narrow sheet
 *  rather than truncating the figure. */
export function SheetRow({
  label,
  value,
  trailing,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  trailing?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3.5 gap-y-0.5 py-[5px]">
      <span className="min-w-0 text-[13px] leading-snug text-foreground">{label}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-3.5">
        {trailing != null && <span className="text-xs text-muted-foreground">{trailing}</span>}
        <span className="text-[13px] font-semibold text-foreground tabular-nums">{value}</span>
      </span>
    </div>
  );
}

/** A sheet / rail line that opens something — pointer cursor + a neutral
 *  hover wash, never the copper focus tint (Flutter `_TapRow`). */
export function SheetTapRow({
  onClick,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "block w-full cursor-pointer rounded-[6px] text-left transition-colors duration-fast",
        "hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
