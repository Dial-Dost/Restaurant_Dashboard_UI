import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Initials avatar for people (food_tile.dart InitialsAvatar): a copper-tinted
 * ring on a recessed disc, the initials lifted toward the accent's hi stop.
 */
export function InitialsAvatar({
  initials,
  size = 38,
  className,
}: {
  initials: string;
  size?: number;
  className?: string;
}): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border-[1.2px] border-[hsl(var(--primary)/0.35)] bg-inset",
        "font-semibold uppercase tracking-[0.5px] text-accent-foreground",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.32) }}
    >
      {initials}
    </span>
  );
}

/**
 * A segment filter pill carrying its own server-side count (`_SegmentChip`):
 * selected = copper tint + copper edge + semibold; unselected = inset. The
 * count is PART of the label ("All guests · 25"), so selection is never the
 * only thing colour is carrying — and a count nobody can vouch for is simply
 * omitted, never guessed.
 */
export function SegmentChip({
  label,
  count,
  selected,
  onClick,
}: {
  label: string;
  count: number | null;
  selected: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "rounded-full border px-[11px] py-1.5 text-[11.5px] transition-colors duration-fast",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "gaia:rounded-[2px]",
        selected
          ? "border-[hsl(var(--primary)/0.28)] bg-[hsl(var(--primary)/0.12)] font-semibold text-accent-foreground gaia:border-accent-mid gaia:bg-transparent"
          : "border-border bg-inset font-medium text-muted-foreground hover:text-foreground/85 gaia:bg-transparent",
      )}
    >
      {count == null ? label : `${label} · ${count}`}
    </button>
  );
}
