/**
 * Guest-menu POSTERS — the client-side half.
 *
 * The SELECTION rule (which posters are showing today, in the restaurant's own
 * timezone) lives entirely on the server: /qr/:slug/menu serves only what is
 * live, and it OMITS the `posters` key altogether when nothing is. Nothing here
 * filters by date, on purpose — a second copy of the schedule on the client
 * would be a second answer, and the day the two disagree is the day an expired
 * poster is on a diner's phone.
 *
 * What IS here is the parsing and the slot vocabulary the two guest surfaces
 * (/order and /queue) plus the dashboard preview all have to agree on. Same
 * pure-lib / component split as queue-menu.ts and guest-theme.ts, so the parsing
 * is unit-testable without rendering anything.
 */

export type GuestPosterPlacement = "top" | "menu";

export interface GuestPoster {
    id: string;
    image_url: string;
    /** Owner's caption. Doubles as the image's accessible name; "" is a real
     *  value meaning "no caption", not a missing one. */
    title: string;
    placement: GuestPosterPlacement;
    /** Intrinsic size of the stored image; 0 when the encoder could not report
     *  one, which the renderer treats as "use the fallback ratio". */
    width: number;
    height: number;
}

/**
 * Parse the `posters` key of the guest menu payload.
 *
 * EVERY branch treats missing as "none" rather than as an error, because missing
 * is the normal case: the key is absent for every restaurant that has no poster
 * showing, which today is every restaurant. A row without an id or an image is
 * dropped rather than rendered — an <img> with an empty src is a broken-image
 * icon on a customer's phone, which is worse than showing nothing.
 */
export function readGuestPosters(raw: unknown): GuestPoster[] {
    if (!Array.isArray(raw)) {return [];}
    const out: GuestPoster[] = [];
    for (const entry of raw as unknown[]) {
        if (!entry || typeof entry !== "object") {continue;}
        const p = entry as Record<string, unknown>;
        const id = typeof p.id === "string" ? p.id : "";
        const image_url = typeof p.image_url === "string" ? p.image_url : "";
        if (!id || !image_url) {continue;}
        out.push({
            id,
            image_url,
            title: typeof p.title === "string" ? p.title : "",
            // Anything that is not the banner slot renders in the menu. An
            // unknown slot from a newer server should still show the poster
            // somewhere sensible rather than vanish.
            placement: p.placement === "top" ? "top" : "menu",
            width: typeof p.width === "number" && Number.isFinite(p.width) && p.width > 0 ? p.width : 0,
            height: typeof p.height === "number" && Number.isFinite(p.height) && p.height > 0 ? p.height : 0,
        });
    }
    return out;
}

/** The posters belonging to one slot, in the order the server sent them (which
 *  is the owner's order — the server sorts, the client never re-sorts). */
export function postersForSlot(posters: GuestPoster[], slot: GuestPosterPlacement): GuestPoster[] {
    return posters.filter((p) => p.placement === slot);
}

/**
 * The CSS aspect-ratio to reserve for a poster's box before its bytes arrive, so
 * a slow connection cannot shove the menu down the page as images pop in. The
 * fallback is a ratio, not a crop: the image is object-cover inside it either
 * way, so an unmeasured poster is letterboxed rather than distorted.
 */
export const POSTER_FALLBACK_RATIO = "16 / 9";
export function posterAspectRatio(p: Pick<GuestPoster, "width" | "height">): string {
    return p.width > 0 && p.height > 0 ? `${String(p.width)} / ${String(p.height)}` : POSTER_FALLBACK_RATIO;
}
