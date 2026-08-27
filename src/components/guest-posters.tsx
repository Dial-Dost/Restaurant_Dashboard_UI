"use client";

/**
 * Promotional POSTERS on the customer-facing pages, in the two slots the guest
 * surfaces can actually honour. Shared by /order/[restaurant] and
 * /queue/[restaurant] so the owner's placement choice means the SAME thing on
 * both — a "Banner" poster is a banner in the queue and a banner at the table.
 *
 * THE TWO SLOTS, and why these two
 * --------------------------------
 *  top  — a full-bleed strip directly under the hero. It is the first thing on
 *         the page, so it is also the only one a guest can DISMISS: an offer
 *         they have read should not sit between them and the menu for the rest
 *         of the meal. Dismissal is per poster id in sessionStorage, so it lasts
 *         the sitting and not forever.
 *  menu — a card in the flow of the dishes (above the grid on /order, above the
 *         pre-order list on the queue page). Not dismissible: it is part of the
 *         menu the guest chose to browse, and it scrolls away on its own.
 *
 * "Between categories" was considered and rejected: /order shows ONE category
 * at a time (a chip strip, not a long scroll), so there is no between to sit in
 * — a poster there would appear and disappear as the guest tapped chips.
 *
 * ABSENT = TODAY. With no posters this renders null and neither page changes by
 * a single pixel. Nothing here paints its own colours; every surface is the
 * tenant's own CSS vars, so a poster strip inherits whatever the owner's
 * brand_config resolved to.
 */

import { useCallback, useEffect, useState } from "react";

import {
  posterAspectRatio,
  postersForSlot,
  type GuestPoster,
  type GuestPosterPlacement,
} from "@/lib/guest-posters";

// Re-exported so the two guest pages import the parser and the component from
// one place; the rules themselves live in the pure lib (see guest-posters.ts).
export { readGuestPosters } from "@/lib/guest-posters";
export type { GuestPoster, GuestPosterPlacement } from "@/lib/guest-posters";

const DISMISS_KEY = "guest_posters_dismissed";

function readDismissed(): string[] {
  try {
    const raw = sessionStorage.getItem(DISMISS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
  } catch {
    // Private mode, or storage disabled. A guest who cannot persist a dismissal
    // still gets a working page — they just see the banner again next reload.
    return [];
  }
}

function PosterImage({ poster, eager }: { poster: GuestPoster; eager: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={poster.image_url}
      // An empty caption means the owner gave the image no accessible name, and
      // alt="" is the correct answer for that: a screen reader skips it rather
      // than reading out a URL. A captioned poster announces its caption.
      alt={poster.title}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      style={{ aspectRatio: posterAspectRatio(poster) }}
      className="block w-full object-cover"
    />
  );
}

/**
 * The dismissible hero banner. One poster at a time, swipeable when there are
 * several (scroll-snap — no JS animation, so it stays smooth on the cheap phones
 * this page actually runs on).
 */
function TopPosters({ items }: { items: GuestPoster[] }) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [active, setActive] = useState(0);

  // Read AFTER mount: sessionStorage does not exist during SSR, and reading it
  // in the initial state would make the server and client render disagree.
  useEffect(() => { setDismissed(readDismissed()); }, []);

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = prev.includes(id) ? prev : [...prev, id];
      try { sessionStorage.setItem(DISMISS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, []);

  const shown = items.filter((p) => !dismissed.includes(p.id));
  if (shown.length === 0) {return null;}

  return (
    <section className="px-4 pt-3" aria-label="Offers">
      <div
        onScroll={(e) => {
          const el = e.currentTarget;
          const w = el.clientWidth || 1;
          setActive(Math.round(el.scrollLeft / w));
        }}
        className="rf-sc flex snap-x snap-mandatory overflow-x-auto [-webkit-overflow-scrolling:touch]"
        style={{ borderRadius: "var(--rCard)", scrollbarWidth: "none" }}
      >
        {shown.map((p, i) => (
          <div key={p.id} className="relative w-full flex-none snap-center">
            <div
              className="relative overflow-hidden"
              style={{
                borderRadius: "var(--rCard)",
                border: "1.5px solid rgba(var(--edgeRGB),var(--pbA))",
                boxShadow: "0 14px 34px rgba(0,0,0,0.45)",
              }}
            >
              <PosterImage poster={p} eager={i === 0} />
              {p.title ? (
                <div
                  className="absolute inset-x-0 bottom-0 px-3.5 py-2.5 text-[length:calc(12.5px*var(--fs,1))] font-semibold"
                  style={{
                    color: "var(--inkStrong)",
                    background: "linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,0.62))",
                  }}
                >
                  {p.title}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => { dismiss(p.id); }}
                aria-label="Dismiss offer"
                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full transition active:scale-90"
                style={{
                  backgroundColor: "rgba(0,0,0,0.45)",
                  color: "var(--inkStrong)",
                  backdropFilter: "blur(6px)",
                  WebkitBackdropFilter: "blur(6px)",
                }}
              >
                <span className="ms" aria-hidden="true" style={{ fontSize: "calc(16px*var(--fs,1))" }}>close</span>
              </button>
            </div>
          </div>
        ))}
      </div>
      {shown.length > 1 ? (
        <div className="mt-2 flex justify-center gap-1.5" aria-hidden="true">
          {shown.map((p, i) => (
            <span
              key={p.id}
              className="h-1.5 rounded-full transition-all"
              style={{
                width: i === active ? 14 : 6,
                backgroundColor: i === active ? "var(--accHi)" : "rgba(var(--edgeRGB),0.25)",
              }}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** The in-menu cards: a plain vertical stack, in the owner's order. */
function MenuPosters({ items }: { items: GuestPoster[] }) {
  if (items.length === 0) {return null;}
  return (
    <section className="mb-3 space-y-2.5" aria-label="Offers">
      {items.map((p) => (
        <figure
          key={p.id}
          className="relative m-0 overflow-hidden"
          style={{
            borderRadius: "var(--rCard)",
            background: "var(--panelBg)",
            backdropFilter: "blur(var(--blur))",
            WebkitBackdropFilter: "blur(var(--blur))",
            border: "1.5px solid rgba(var(--edgeRGB),var(--pbA))",
            boxShadow: "0 14px 34px rgba(0,0,0,0.45)",
          }}
        >
          <PosterImage poster={p} eager={false} />
          {p.title ? (
            <figcaption
              className="px-3.5 py-2.5 text-[length:calc(12.5px*var(--fs,1))] font-semibold"
              style={{ color: "var(--ink)" }}
            >
              {p.title}
            </figcaption>
          ) : null}
        </figure>
      ))}
    </section>
  );
}

/**
 * Render whichever posters belong in `slot`. Returns null when there are none,
 * which is what keeps a restaurant without posters pixel-identical to today.
 */
export function GuestPosters({ posters, slot }: { posters: GuestPoster[]; slot: GuestPosterPlacement }) {
  const items = postersForSlot(posters, slot);
  if (items.length === 0) {return null;}
  return slot === "top" ? <TopPosters items={items} /> : <MenuPosters items={items} />;
}
