/**
 * 6.6 — THE COLOUR OF LIGHT MODE.
 *
 * V3: "Implement a toggle allowing users to switch the interface between dark
 * mode and light mode. For the light mode, add different color options like
 * white, beige, etc."
 *
 * The dark/light toggle already existed; what was missing is the second half —
 * a choice of GROUND once the room is bright. White is what light mode has
 * always been; beige is a warm cream that is easier on the eye under a
 * restaurant's yellow lighting; soft grey sits between the two.
 *
 * ============================================================================
 * A THIRD AXIS, NOT A FOURTH PALETTE
 * ============================================================================
 * `data-palette` (palette.ts) is already "which product is this" — Rustic Fork
 * or Gaia — and it only overrides the ACCENT tokens in light mode (primary,
 * ring, charts). A light tone overrides the GROUND tokens (background, card,
 * borders, text). The two sets do not overlap, so they compose: Gaia on beige
 * is champagne buttons on cream, and switching tone never loses a tenant's
 * palette. Folding tones into PALETTES would have made that a 2x3 list.
 *
 * `next-themes` keeps owning `.dark`; every tone rule is scoped to
 * `:not(.dark)`, so a stored "beige" is inert in dark mode and comes back the
 * moment somebody switches to light.
 *
 * PURE for the same reason palette.ts is: what a stored value means and what
 * the menu does when a row is picked are decided by value and tested without
 * rendering anything.
 */

export const LIGHT_TONES = [
  {
    id: "white",
    label: "White",
    hint: "Plain white — light mode as it has always been.",
    /** The ground the picker paints, so a name alone is not the only signal. */
    swatch: { bg: "#FFFFFF", border: "#E5E7EB" },
  },
  {
    id: "beige",
    label: "Beige",
    hint: "Warm cream — softer under warm restaurant lighting.",
    swatch: { bg: "#F5EFE3", border: "#E0D3BE" },
  },
  {
    id: "grey",
    label: "Soft grey",
    hint: "A quiet grey — less glare than white, cooler than beige.",
    swatch: { bg: "#EEEFF1", border: "#D9DCE1" },
  },
] as const;

export type LightToneId = (typeof LIGHT_TONES)[number]["id"];

/**
 * White, because it is what light mode already looked like. An existing user
 * who has never opened the new menu must see no change at all.
 */
export const DEFAULT_LIGHT_TONE: LightToneId = "white";

export const LIGHT_TONE_STORAGE_KEY = "cuisineflow-light-tone";

/** Is this a tone this build knows how to render? */
export function isLightToneId(value: unknown): value is LightToneId {
  return typeof value === "string" && LIGHT_TONES.some((t) => t.id === value);
}

/**
 * A stored value turned into a tone. Anything unrecognised — including a tone
 * a newer deploy shipped — becomes white rather than being passed through.
 * (An unknown attribute would ALSO render white, since no rule matches it, but
 * the menu would then tick nothing; normalising keeps page and menu agreeing.)
 */
export function readLightTone(stored: unknown): LightToneId {
  return isLightToneId(stored) ? stored : DEFAULT_LIGHT_TONE;
}

/** Put the tone on the document — shared by the boot script's rule and React. */
export function applyLightTone(id: LightToneId, root: { setAttribute(name: string, value: string): void }): void {
  root.setAttribute("data-light-tone", id);
}

/** The tone this device chose, from storage, never throwing. */
export function lightToneFromStorage(storage: { getItem(key: string): string | null } | null | undefined): LightToneId {
  try {
    return readLightTone(storage?.getItem(LIGHT_TONE_STORAGE_KEY));
  } catch {
    // Private mode, a blocked cookie jar. A colour preference is never worth
    // an exception on a page somebody is taking an order on.
    return DEFAULT_LIGHT_TONE;
  }
}

/** One row of the theme menu: dark, or light in a particular tone. */
export type AppearancePick = "dark" | LightToneId;

/**
 * What picking a row does.
 *
 * PICKING A TONE ALSO SWITCHES TO LIGHT. Somebody in dark mode who taps
 * "Beige" wants to see beige; applying it silently to a mode they are not in
 * would look like the menu did nothing.
 *
 * PICKING DARK LEAVES THE TONE ALONE (`tone: null`), so the next switch back to
 * light returns to the colour they chose rather than resetting to white.
 */
export function applyAppearancePick(pick: AppearancePick): { theme: "dark" | "light"; tone: LightToneId | null } {
  return pick === "dark" ? { theme: "dark", tone: null } : { theme: "light", tone: pick };
}

/**
 * Which row carries the tick, given what `next-themes` reports and the stored
 * tone. `null` while the theme is still unknown (before next-themes mounts) so
 * the menu never ticks a guess.
 */
export function activeAppearance(theme: string | undefined, tone: LightToneId): AppearancePick | null {
  if (theme === "dark") { return "dark"; }
  if (theme === "light") { return tone; }
  return null;
}
