/**
 * Configurable menu badges, client side.
 *
 * The backend owns the rules (Restaurant_Backend/menu_badges.ts): which badges
 * exist per restaurant, what they are called, and how an item's tags plus its
 * allergen list resolve into the ordered list a diner sees. This module is the
 * thin client half of that contract:
 *
 *   - the shared TYPES, so the staff editor and both guest pages agree;
 *   - `resolveBadges`, a mirror of the server rule used ONLY as a staff-side
 *     preview (the guest pages never call it — GET /qr/:slug/menu already hands
 *     them resolved, ordered ids, so there is exactly one authority for what a
 *     guest is told);
 *   - the TONE map, which is where "a nut warning is not a Bestseller sticker"
 *     becomes pixels.
 *
 * ABSENT = NOTHING. An empty catalogue renders no badge anywhere. Every function
 * here returns [] for it rather than falling back to a default set — a badge is
 * a claim, and a claim nobody made must not appear on a menu.
 */

/**
 * Raised when the server refuses to drop a dietary/safety badge that dishes
 * still carry, so the editor can ask instead of just failing.
 *
 * It lives HERE and not in lib/db.ts because that file is a Next `"use server"`
 * module: it may export nothing but async functions, and exporting a class from
 * it takes the whole app down at compile time.
 */
export class MenuBadgeInUseError extends Error {
  public badges: { id: string; label: string; kind: string; items: number }[];
  constructor(message: string, badges: { id: string; label: string; kind: string; items: number }[]) {
    super(message);
    this.name = "MenuBadgeInUseError";
    this.badges = badges;
  }
}

export type MenuBadgeKind = "alert" | "diet" | "promo";

/** Render order: safety, then dietary identity, then marketing. */
export const BADGE_KIND_ORDER: MenuBadgeKind[] = ["alert", "diet", "promo"];

export interface MenuBadge {
  id: string;
  label: string;
  kind: MenuBadgeKind;
  enabled: boolean;
  /** `alert` only: this badge comes from the dish's allergen list, not a tag. */
  allergen?: string;
}

export const BADGE_KIND_LABEL: Record<MenuBadgeKind, string> = {
  alert: "Warning",
  diet: "Dietary",
  promo: "Highlight",
};

export const BADGE_KIND_HINT: Record<MenuBadgeKind, string> = {
  alert: "Warn before ordering. Always shown to guests, never trimmed to make room.",
  diet: "What a guest can and cannot eat. Always shown, never trimmed.",
  promo: "Your own recommendation. Shown last, and trimmed first on small cards.",
};

/** Parse whatever the API returned into a clean catalogue. Junk resolves to []. */
export function parseBadgeCatalogue(raw: unknown): MenuBadge[] {
  if (!Array.isArray(raw)) {return [];}
  const out: MenuBadge[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {continue;}
    const b = entry as Record<string, unknown>;
    const id = typeof b.id === "string" ? b.id.trim() : "";
    if (!id) {continue;}
    const kind = BADGE_KIND_ORDER.includes(b.kind as MenuBadgeKind) ? (b.kind as MenuBadgeKind) : "promo";
    const badge: MenuBadge = {
      id,
      label: typeof b.label === "string" && b.label.trim() ? b.label.trim() : id,
      kind,
      enabled: b.enabled !== false,
    };
    const allergen = kind === "alert" && typeof b.allergen === "string" ? b.allergen.trim().toLowerCase() : "";
    if (allergen) {badge.allergen = allergen;}
    out.push(badge);
  }
  return out;
}

/** A badge whose fact lives in the dish's allergen list rather than in a tag. */
export const isDerivedBadge = (b: MenuBadge): boolean => b.kind === "alert" && !!b.allergen;

/**
 * Badges a tenant may not quietly drop while dishes carry them. Mirrors the
 * server's MENU_BADGE_PROTECTED_KINDS; the editor uses it to warn BEFORE the
 * server refuses, so the confirm reads as a decision rather than an error.
 */
export const isProtectedBadge = (b: MenuBadge): boolean => b.kind !== "promo";

/**
 * Map already-RESOLVED ids (what GET /qr/:slug/menu returns per item) onto the
 * catalogue. Server order is preserved — it is the authority — and ids the
 * catalogue no longer knows are dropped.
 */
export function badgesById(catalogue: MenuBadge[], ids: unknown): MenuBadge[] {
  if (!Array.isArray(ids) || catalogue.length === 0) {return [];}
  const byId = new Map(catalogue.filter((b) => b.enabled).map((b) => [b.id, b]));
  const out: MenuBadge[] = [];
  for (const id of ids) {
    const hit = typeof id === "string" ? byId.get(id) : undefined;
    if (hit && !out.includes(hit)) {out.push(hit);}
  }
  return out;
}

/**
 * STAFF PREVIEW ONLY — mirrors the server's resolveMenuBadges so the menu module
 * can show a dish the way a guest will see it. The guest pages must NOT use
 * this: they receive resolved ids and call badgesById instead, so the rule that
 * decides what a diner is told lives in exactly one place.
 */
export function resolveBadges(catalogue: MenuBadge[], tagged: unknown, allergens: unknown): MenuBadge[] {
  const enabled = catalogue.filter((b) => b.enabled);
  if (enabled.length === 0) {return [];}
  const tags = new Set((Array.isArray(tagged) ? tagged : []).filter((t): t is string => typeof t === "string"));
  const tags2 = new Set(
    (Array.isArray(allergens) ? allergens : [])
      .filter((a): a is string => typeof a === "string")
      .map((a) => a.trim().toLowerCase()),
  );
  return enabled
    .map((badge, index) => ({ badge, index }))
    .filter(({ badge }) => (isDerivedBadge(badge) ? tags2.has(badge.allergen ?? "") : tags.has(badge.id)))
    .sort((a, b) => {
      const rank = BADGE_KIND_ORDER.indexOf(a.badge.kind) - BADGE_KIND_ORDER.indexOf(b.badge.kind);
      return rank !== 0 ? rank : a.index - b.index;
    })
    .map(({ badge }) => badge);
}

/** Allergen tags an enabled derived badge already speaks for (drop the chip). */
export function coveredAllergens(catalogue: MenuBadge[]): Set<string> {
  const out = new Set<string>();
  for (const b of catalogue) {
    if (b.enabled && isDerivedBadge(b) && b.allergen) {out.add(b.allergen);}
  }
  return out;
}

/**
 * Trim a resolved list for a card that has no room. Only `promo` may be cut —
 * an alert or dietary badge falling off a card is the failure this whole design
 * exists to prevent — and the overflow count is returned so the card can say
 * "+2" instead of silently swallowing them.
 */
export function capBadges(resolved: MenuBadge[], promoLimit: number): { shown: MenuBadge[]; hidden: number } {
  const limit = Number.isFinite(promoLimit) && promoLimit > 0 ? Math.floor(promoLimit) : 0;
  const shown: MenuBadge[] = [];
  let promoSeen = 0;
  let hidden = 0;
  for (const badge of resolved) {
    if (badge.kind !== "promo") { shown.push(badge); continue; }
    if (promoSeen < limit) { shown.push(badge); promoSeen += 1; }
    else { hidden += 1; }
  }
  return { shown, hidden };
}

/**
 * Guest-surface colours per kind, as inline style values built from the guest
 * theme's CSS variables — so a tenant's palette drives them and the dark glass
 * design still holds.
 *
 * The deliberate part: `promo` is the only kind painted in the brand ACCENT.
 * A warning must not inherit a restaurant's brand colour, because a brand
 * colour can be a cheerful green — and a cheerful green "Contains nuts" reads
 * as a feature. Warnings take the palette's warning role, dietary badges its
 * success role, and both are outlined rather than filled so they survive being
 * next to a bright accent chip.
 */
export function guestBadgeStyle(kind: MenuBadgeKind): { color: string; borderColor: string; backgroundColor: string } {
  if (kind === "alert") {
    return { color: "var(--warn)", borderColor: "rgba(var(--warnRGB),0.45)", backgroundColor: "rgba(var(--warnRGB),0.14)" };
  }
  if (kind === "diet") {
    return { color: "var(--ok)", borderColor: "rgba(var(--okRGB),0.42)", backgroundColor: "rgba(var(--okRGB),0.13)" };
  }
  return { color: "var(--accHi)", borderColor: "rgba(var(--accRGB),0.42)", backgroundColor: "rgba(var(--accRGB),0.16)" };
}

/** Tailwind classes for the STAFF surfaces, which are not on the guest palette. */
export function staffBadgeClass(kind: MenuBadgeKind): string {
  if (kind === "alert") {return "border-amber-400/70 bg-amber-400/10 text-amber-700 dark:text-amber-300";}
  if (kind === "diet") {return "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";}
  return "border-primary/50 bg-primary/10 text-primary";
}
