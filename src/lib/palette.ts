/**
 * THE TWO VISUAL LANGUAGES, AND WHICH ONE THE WEB IS WEARING.
 *
 * The Flutter owner app ships two complete design systems and lets the user
 * pick — `DesignSystem` in `restaurant_owner_app/lib/ui/theme/appearance.dart`:
 *
 *   RUSTIC FORK  near-black warm ground, copper accent. The shipped look.
 *   GAIA         forest ground, champagne accent.
 *
 * The web wore neither. Its dark mode was shadcn's stock cold slate
 * (#030712, a blue-black), which is a different product to look at from the
 * app running on the till two feet away. This module is the web's half of
 * closing that, and the colours are TRANSCRIBED from the Dart constants rather
 * than eyeballed — see `palette.css` for each one's source line.
 *
 * ============================================================================
 * WHY IT IS A SEPARATE AXIS FROM DARK/LIGHT
 * ============================================================================
 * They answer different questions. Dark/light is "how bright is the room";
 * palette is "which product is this". Folding them into one four-way selector
 * would mean a tenant who prefers Gaia loses it every time somebody switches to
 * light, which is exactly the "half-migrated blend" the Flutter enum's own
 * comment exists to prevent.
 *
 * So: `next-themes` keeps owning `.dark` on <html>, and this owns
 * `data-palette`. They compose — `[data-palette="gaia"].dark` and
 * `[data-palette="gaia"]:not(.dark)` are both defined.
 *
 * ============================================================================
 * PURE, AND WHY
 * ============================================================================
 * No React and no DOM beyond the two functions that must touch it. The rules
 * worth arguing with — what a stored value means, what an unknown one falls
 * back to — are decided by value and tested without rendering anything.
 */

export const PALETTES = [
  {
    id: "rustic",
    label: "Rustic Fork",
    /** What the picker says under the name. */
    hint: "Near-black and copper — the look the app ships with.",
    /** The swatch the picker draws, so a name alone is not the only signal. */
    swatch: { bg: "#0C0A09", accent: "#C9997A" },
  },
  {
    id: "gaia",
    label: "Gaia",
    hint: "Forest green and champagne.",
    swatch: { bg: "#0C1513", accent: "#D3B88B" },
  },
] as const;

export type PaletteId = (typeof PALETTES)[number]["id"];

/**
 * Rustic Fork, because it is what the Flutter app ships with and the whole
 * point is that the two look like one product.
 */
export const DEFAULT_PALETTE: PaletteId = "rustic";

export const STORAGE_KEY = "cuisineflow-palette";

/** Is this a palette this build knows how to render? */
export function isPaletteId(value: unknown): value is PaletteId {
  return typeof value === "string" && PALETTES.some((p) => p.id === value);
}

/**
 * A stored value turned into a palette.
 *
 * ANYTHING UNRECOGNISED BECOMES THE DEFAULT rather than being passed through.
 * A `data-palette` attribute this stylesheet has no rules for leaves every
 * token at its `:root` value — which is the LIGHT palette — so a stale or
 * corrupted preference would render a white dashboard in a dark room and look
 * like a bug in the theme toggle. That includes a palette this build has simply
 * not shipped yet, which is the realistic case on a client that updates on a
 * different cadence from its server.
 */
export function readPalette(stored: unknown): PaletteId {
  return isPaletteId(stored) ? stored : DEFAULT_PALETTE;
}

/**
 * Put the palette on the document.
 *
 * Separate from reading it so the inline boot script and React can share one
 * definition of "applied" — if those two ever disagreed the page would flash
 * one palette and settle on another.
 */
export function applyPalette(id: PaletteId, root: { setAttribute(name: string, value: string): void }): void {
  root.setAttribute("data-palette", id);
}

/** What the page should wear on this device, from storage, never throwing. */
export function paletteFromStorage(storage: Pick<Storage, "getItem"> | null | undefined): PaletteId {
  try {
    return readPalette(storage?.getItem(STORAGE_KEY));
  } catch {
    // Private mode, a blocked cookie jar, a quota error. A palette is a
    // preference; failing to read one must never be worth an exception.
    return DEFAULT_PALETTE;
  }
}
