"use client";

import type { ReactNode } from "react";

const ACCENT: Record<string, string> = {
  gold: "var(--gold)",
  azure: "var(--azure)",
  emerald: "var(--emerald)",
  violet: "var(--violet)",
  neutral: "var(--ink-3)",
  // The mock dashboard wears the real product's Rustic Fork palette: one
  // copper accent ramp plus labeled status tints — never multi-hue
  // categorical color (that is the product's own charting rule).
  copper: "var(--copper-hi)",
  copperMid: "var(--copper-mid)",
  success: "var(--rf-success)",
  warning: "var(--rf-warning)",
  danger: "var(--rf-danger)",
  info: "var(--rf-info)",
};

export function accentColor(name?: string) {
  return ACCENT[name ?? "neutral"] ?? ACCENT.neutral;
}

/** One glass card in the dashboard. `exp-widget` is the assembly-animation hook. */
export default function Widget({
  title,
  chip,
  className = "",
  children,
}: {
  title: string;
  chip?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-tilt
      className={`exp-widget glass glass-rim glass-shine flex flex-col gap-3 rounded-2xl p-4 will-change-transform ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3">
          {title}
        </span>
        {chip}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
