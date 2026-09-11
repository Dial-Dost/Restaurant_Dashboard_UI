/**
 * WHICH FOUR DESTINATIONS GO IN THE PHONE'S BOTTOM BAR.
 *
 * Extracted from the component because it is a DECISION, not markup, and the
 * ways it can be wrong are invisible in a screenshot: an admin getting four
 * buttons they never use, a waiter getting two buttons and two gaps, or the
 * "More" sheet quietly dropping a destination that is in neither list.
 *
 * PURE — no React, no DOM. Same discipline as service-clock.ts and
 * role-permissions.ts: a rule about what a person can reach should be arguable
 * in a test without rendering anything.
 *
 * ============================================================================
 * WHY FOUR
 * ============================================================================
 * A 375px screen divided five ways is 75px a target, and the label under the
 * icon starts truncating to nonsense ("Purch…", "Attend…"). Four plus More is
 * 75px each as well — but the fifth slot is a single word, "More", that never
 * truncates. Three would waste the bar.
 *
 * ============================================================================
 * WHY THE FOUR ARE CHOSEN AND NOT SLICED OFF THE TOP
 * ============================================================================
 * The nav's own order is the DESKTOP order, grouped by area of work: Dashboard,
 * Orders, Tables, Floor plan, Waitlist, Bookings, Menu… Slicing the first four
 * gives a phone user Floor plan — a layout screen nobody opens mid-service —
 * while Menu, which is where you take a dish off during a rush, falls into a
 * sheet behind another tap.
 *
 * So PRIMARY_ORDER names what somebody holding a phone on the floor actually
 * wants, and the bar takes the first four of those this session can reach.
 * Orders leads, not Dashboard: a phone is used to take and check orders; the
 * overview is what you open when you sit down at a desk.
 */

export interface MobileNavItemLike {
  href: string;
}

/**
 * The order a phone user wants, most wanted first.
 *
 * Only hrefs that exist in the nav are used, so a session that cannot reach one
 * simply skips it rather than getting a dead button.
 */
export const PRIMARY_ORDER: readonly string[] = [
  "/dashboard/orders",
  "/dashboard/tables",
  "/dashboard/menu",
  "/dashboard",
];

/** How many fit across a phone beside the "More" button. See the header. */
export const PRIMARY_SLOTS = 4;

export interface MobileNavLayout<T extends MobileNavItemLike> {
  /** The bottom bar, in PRIMARY_ORDER where possible. Never more than four. */
  primary: T[];
  /** Everything else, in the nav's own order. Empty means no "More" button. */
  rest: T[];
}

/**
 * Split a session's navigation into the bar and the sheet.
 *
 * THE INVARIANT, and the one worth stating: `primary` and `rest` together are
 * exactly `all`, with no duplicates and nothing dropped. A destination that
 * appears in neither is one the person can no longer reach at all on a phone,
 * which is the failure this whole component exists to fix.
 */
export function splitMobileNav<T extends MobileNavItemLike>(all: readonly T[]): MobileNavLayout<T> {
  const primary: T[] = [];
  const taken = new Set<T>();

  for (const href of PRIMARY_ORDER) {
    if (primary.length === PRIMARY_SLOTS) { break; }
    const hit = all.find((i) => i.href === href && !taken.has(i));
    if (hit) { primary.push(hit); taken.add(hit); }
  }
  // A short nav (valet, waiter-only) or an unusual permission set may not fill
  // four from PRIMARY_ORDER. Top up from the nav's own order rather than
  // leaving the bar half empty — a gap reads as something failing to load.
  for (const item of all) {
    if (primary.length === PRIMARY_SLOTS) { break; }
    if (!taken.has(item)) { primary.push(item); taken.add(item); }
  }

  return { primary, rest: all.filter((i) => !taken.has(i)) };
}
