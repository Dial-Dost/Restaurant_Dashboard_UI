"use client";

// Shared "a notification sent me here — show me THAT row" behaviour.
//
// The orders page already did this by hand for ?highlightOrder=; this hook is
// that pattern extracted so bookings, the waitlist, feedback and inventory can
// focus a record too, instead of dumping the user on a page and letting them
// hunt. Deep-links stay shareable: the id lives in the URL, not in state.
//
// Usage:
//   const highlight = useHighlightRow("highlightBooking", rows.length);
//   <div {...highlight.rowProps(b.id)}>…</div>

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/** How long the ring stays on after the row is found. */
const HIGHLIGHT_MS = 3500;

/** Tailwind classes for the transient ring. Same visual language everywhere. */
export const HIGHLIGHT_CLASS = "ring-2 ring-primary ring-offset-2 ring-offset-background";

export interface HighlightRow {
  /** The id being looked for, or null. Stays set until the ring times out. */
  id: string | null;
  /** True while THIS row should be ringed. */
  isActive: (rowId: string | null | undefined) => boolean;
  /** Spread onto the row element: stable anchor id + the ring while active. */
  rowProps: (rowId: string | null | undefined) => { id: string; className: string };
}

/**
 * @param param    query-string key carrying the id (e.g. "highlightBooking")
 * @param readyKey changes whenever the list re-renders with new data, so the
 *                 scroll retries once the target row actually exists in the DOM
 */
export function useHighlightRow(param: string, readyKey: unknown = 0): HighlightRow {
  const searchParams = useSearchParams();
  const wanted = searchParams.get(param)?.trim() ?? "";
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (!wanted) { setActive(null); return; }
    setActive(wanted);
    // The row may not be mounted yet on the first pass; the readyKey dependency
    // re-runs this after data lands, and the timeout covers layout.
    const findTimer = setTimeout(() => {
      const el = document.getElementById(`${param}-${wanted}`);
      if (!el) {return;}
      try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch { /* jsdom / old browsers */ }
    }, 250);
    const clearTimer = setTimeout(() => { setActive(null); }, HIGHLIGHT_MS + 250);
    return () => { clearTimeout(findTimer); clearTimeout(clearTimer); };
  }, [wanted, param, readyKey]);

  const isActive = (rowId: string | null | undefined) =>
    active != null && rowId != null && String(rowId) === active;

  return {
    id: active,
    isActive,
    rowProps: (rowId: string | null | undefined) => ({
      id: `${param}-${String(rowId ?? "")}`,
      className: isActive(rowId) ? HIGHLIGHT_CLASS : "",
    }),
  };
}
