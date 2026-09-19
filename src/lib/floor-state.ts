/**
 * THE FLOOR'S INKS — fixed per scheme and NEVER the accent.
 *
 * Transcribed from `restaurant_owner_app/lib/ui/theme/app_colors.dart`
 * (AppShellScheme floor* fields) and `lib/ui/gaia/gaia_colors.dart`
 * (shellBridge). The app's comment names this exact file as the web's mirror.
 *
 * The floor used to paint a running table in the owner's accent, so an owner
 * on the Sage accent had running and free in two greens. Each state now has
 * one ink of its own, held in the app's tests to 4.5:1 on every ground of its
 * scheme and to a CIEDE2000 distance of 12 from every other state:
 *
 *   free       nobody there — every free table, the next party's included
 *   seated     a party sat down, nothing ordered yet
 *   running    food ordered, bill not printed
 *   printed    bill printed, not settled — the night-settle backlog
 *   reserved   a booking holds it
 *   nextParty  the neutral "#2" chip on a next-party seat
 *
 * One dark set serves all five dark shells, one light set serves all three
 * light tones (exactly as in the app), and Gaia brings its bridge set.
 */

export type FloorState =
  | "free"
  | "seated"
  | "running"
  | "printed"
  | "reserved"
  | "nextParty";

export type FloorInkSet = Readonly<Record<FloorState, string>>;

export const FLOOR_INKS: Readonly<{
  dark: FloorInkSet;
  light: FloorInkSet;
  gaia: FloorInkSet;
}> = {
  // AppShellScheme._darkFloor* — every dark shell.
  dark: {
    free: "#6CC070",
    seated: "#E2C458",
    running: "#E0697A",
    printed: "#F28C3A",
    reserved: "#79A7D8",
    nextParty: "#B9B4A8",
  },
  // AppLightPalettes.* — one set for white/beige/grey.
  light: {
    free: "#2B6326",
    seated: "#7A5B00",
    running: "#B0283C",
    printed: "#A84A06",
    reserved: "#2F5F8F",
    nextParty: "#5F6670",
  },
  // GaiaColors.shellBridge — sage for free, coral for running, text2 chip.
  gaia: {
    free: "#9BC4A0",
    seated: "#E2C458",
    running: "#D9705F",
    printed: "#F0934A",
    reserved: "#8FB0D0",
    nextParty: "#B3AC99",
  },
} as const;

/**
 * The set for what the page is wearing right now. `palette` is the
 * `data-palette` value; `isDark` is next-themes' resolved theme. Gaia is
 * dark-only, so it wins over the theme flag.
 */
export function floorInks(palette: string, isDark: boolean): FloorInkSet {
  if (palette === "gaia") { return FLOOR_INKS.gaia; }
  return isDark ? FLOOR_INKS.dark : FLOOR_INKS.light;
}
