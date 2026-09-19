/**
 * THE APPEARANCE AXES — accent ramp, shell scheme, backdrop mixer.
 *
 * The Flutter owner app lets each device pick, per `appearance.dart`:
 *
 *   ACCENT  one of eight 6-stop ramps (+ glow trio), every stop AA-checked.
 *   SCHEME  one of five complete dark shells (the whole ground/ink ladder).
 *   BACKDROP  wash/bloom stops (or "follow the accent"), wash angle, intensity.
 *
 * Per-DEVICE, in localStorage, NOT on the server — the app's own reasoning
 * holds here verbatim: two tills of one restaurant are two working contexts
 * (the bar till and the floor till may want different accents precisely so
 * staff can tell which machine they are on), it is pure chrome with no place
 * in the tenant's audited settings, and it must work offline and before login.
 *
 * The CSS lives in `src/app/appearance.css` (generated from the same
 * catalogue); this module owns the VALUES and the two attributes —
 * `data-accent` and `data-scheme` on <html> — plus the backdrop math the CSS
 * cannot do (`resolveBackdrop`, with the AA guard from `contrast.dart`).
 *
 * COMPOSITION RULES, same as the app:
 *  - accent x scheme compose freely (the ramp is ground-independent);
 *  - while a light tone is painted, the scheme is remembered but not applied
 *    (the CSS blocks require `.dark`);
 *  - while GAIA is worn, both are remembered but not applied (the CSS blocks
 *    require `data-palette="rustic"`), and Gaia has NO light variant — a
 *    light tone picked under Gaia is remembered, not applied
 *    (`lightTonesApplyUnder`).
 *
 * Pure where it can be (readable and testable by value); the DOM appears only
 * in the apply/subscribe helpers, exactly like `palette.ts`.
 */

/* ── Catalogue: the eight accents (appearance.dart AppAccents) ──────── */

export interface AppAccent {
  id: string;
  label: string;
  /** The 5-stop ramp, light -> dark, as hexes (dark-mode values). */
  hi: string;
  base: string;
  mid: string;
  deep: string;
  shadow: string;
  /** Ink dark enough to sit on an accent-filled control. */
  on: string;
  /** The saturated backdrop trio. */
  glowBright: string;
  glowMid: string;
  glowDeep: string;
}

export const ACCENTS: readonly AppAccent[] = [
  { id: "copper", label: "Copper", hi: "#E3B89B", base: "#C9997A", mid: "#A9795C", deep: "#7D5B47", shadow: "#4E3928", on: "#221510", glowBright: "#C2410C", glowMid: "#9A3412", glowDeep: "#7C2D12" },
  { id: "brass", label: "Brass", hi: "#E5D29A", base: "#CBB676", mid: "#B79C4E", deep: "#8A773D", shadow: "#544927", on: "#221E11", glowBright: "#C0930C", glowMid: "#977611", glowDeep: "#785E12" },
  { id: "sage", label: "Sage", hi: "#BBDBA3", base: "#9CBD84", mid: "#7CA460", deep: "#5F7B4C", shadow: "#3B4B30", on: "#191F14", glowBright: "#57C00C", glowMid: "#499711", glowDeep: "#3C7812" },
  { id: "teal", label: "Teal", hi: "#A1DED9", base: "#81C1BB", mid: "#5BA9A2", deep: "#487F7B", shadow: "#2D4D4A", on: "#13201F", glowBright: "#0CC0B1", glowMid: "#11978C", glowDeep: "#12786F" },
  { id: "steel", label: "Steel", hi: "#9EBFE0", base: "#7DA1C5", mid: "#5682AE", deep: "#446383", shadow: "#2B3D50", on: "#121921", glowBright: "#0C66C0", glowMid: "#115497", glowDeep: "#124578" },
  { id: "lavender", label: "Lavender", hi: "#B39FDF", base: "#937FC3", mid: "#7259AB", deep: "#584681", shadow: "#362C4E", on: "#171320", glowBright: "#420CC0", glowMid: "#391197", glowDeep: "#301278" },
  { id: "rose", label: "Rose", hi: "#E09EB4", base: "#C57D95", mid: "#AE5673", deep: "#834459", shadow: "#502B37", on: "#211217", glowBright: "#C00C48", glowMid: "#97113E", glowDeep: "#781234" },
  { id: "ember", label: "Ember", hi: "#EBA593", base: "#D5826D", mid: "#C35B41", deep: "#944633", shadow: "#5A2C20", on: "#25130E", glowBright: "#C0300C", glowMid: "#972C11", glowDeep: "#782612" },
] as const;

export type AccentId = (typeof ACCENTS)[number]["id"];
export const DEFAULT_ACCENT: AccentId = "copper";
export const ACCENT_STORAGE_KEY = "cuisineflow-accent";

/* ── Catalogue: the five dark shells (appearance.dart AppSchemes) ───── */

export interface AppShellScheme {
  id: string;
  label: string;
  /** What the picker's miniature paints. */
  bg: string;
  card: string;
  text: string;
}

export const SCHEMES: readonly AppShellScheme[] = [
  { id: "rustic", label: "Rustic", bg: "#0C0A09", card: "#1B1716", text: "#ECEAE6" },
  { id: "slate", label: "Slate", bg: "#090B0E", card: "#141A21", text: "#E8ECF1" },
  { id: "charcoal", label: "Charcoal", bg: "#121110", card: "#201D1B", text: "#EFEDEA" },
  { id: "midnight", label: "Midnight", bg: "#070A14", card: "#101728", text: "#E7EBF4" },
  { id: "graphite", label: "Graphite", bg: "#0B0B0C", card: "#19191B", text: "#EBEBEC" },
] as const;

export type SchemeId = (typeof SCHEMES)[number]["id"];
export const DEFAULT_SCHEME: SchemeId = "rustic";
export const SCHEME_STORAGE_KEY = "cuisineflow-scheme";

/* ── Reading and applying, the palette.ts way ───────────────────────── */

export function isAccentId(value: unknown): value is AccentId {
  return typeof value === "string" && ACCENTS.some((a) => a.id === value);
}
export function isSchemeId(value: unknown): value is SchemeId {
  return typeof value === "string" && SCHEMES.some((s) => s.id === value);
}

/** Anything unrecognised becomes the shipped default, never passed through. */
export function readAccent(stored: unknown): AccentId {
  return isAccentId(stored) ? stored : DEFAULT_ACCENT;
}
export function readScheme(stored: unknown): SchemeId {
  return isSchemeId(stored) ? stored : DEFAULT_SCHEME;
}

export function accentById(id: string | null | undefined): AppAccent {
  return ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];
}
export function schemeById(id: string | null | undefined): AppShellScheme {
  return SCHEMES.find((s) => s.id === id) ?? SCHEMES[0];
}

interface AttrRoot { setAttribute(name: string, value: string): void }

export function applyAccent(id: AccentId, root: AttrRoot): void {
  root.setAttribute("data-accent", id);
}
export function applyScheme(id: SchemeId, root: AttrRoot): void {
  root.setAttribute("data-scheme", id);
}

type ReadableStorage = { getItem(key: string): string | null } | null | undefined;

export function accentFromStorage(storage: ReadableStorage): AccentId {
  try {
    return readAccent(storage?.getItem(ACCENT_STORAGE_KEY));
  } catch {
    return DEFAULT_ACCENT;
  }
}
export function schemeFromStorage(storage: ReadableStorage): SchemeId {
  try {
    return readScheme(storage?.getItem(SCHEME_STORAGE_KEY));
  } catch {
    return DEFAULT_SCHEME;
  }
}

/**
 * Gaia has no light variant (appearance.dart: "picking a light tone under
 * Gaia is remembered but not applied"). Theme menus and the settings
 * appearance card consult this before offering/applying light rows.
 */
export function lightTonesApplyUnder(palette: string): boolean {
  return palette !== "gaia";
}

/* ── Backdrop style (backdrop_style.dart) ───────────────────────────── */

export interface BackdropStyle {
  /** Hero wash stop (hex), or null = follow the accent's glowDeep. */
  wash: string | null;
  /** Corner bloom stop (hex), or null = glowBright (orb: glowMid). */
  bloom: string | null;
  /** CSS convention: 0 points up, clockwise. The guest hero runs at 150. */
  angleDeg: number;
  /** 0..1 — how hard the warmth leans on the page. 1 is the shipped look. */
  intensity: number;
}

export const DEFAULT_BACKDROP_ANGLE = 150;
export const DEFAULT_BACKDROP: BackdropStyle = {
  wash: null,
  bloom: null,
  angleDeg: DEFAULT_BACKDROP_ANGLE,
  intensity: 1,
};

export const BACKDROP_STORAGE_KEYS = {
  wash: "cuisineflow-backdrop-wash",
  bloom: "cuisineflow-backdrop-bloom",
  angle: "cuisineflow-backdrop-angle",
  intensity: "cuisineflow-backdrop-intensity",
} as const;

const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

/** '#RRGGBB' or null — anything unparseable loads as null ("follow the accent"). */
export function readBackdropHex(stored: unknown): string | null {
  if (typeof stored !== "string") { return null; }
  const m = HEX_RE.exec(stored.trim());
  return m ? `#${m[1].toUpperCase()}` : null;
}

export function normalizeBackdrop(style: Partial<BackdropStyle>): BackdropStyle {
  const angle = typeof style.angleDeg === "number" && Number.isFinite(style.angleDeg) ? style.angleDeg : DEFAULT_BACKDROP_ANGLE;
  const intensity = typeof style.intensity === "number" && Number.isFinite(style.intensity) ? style.intensity : 1;
  return {
    wash: readBackdropHex(style.wash),
    bloom: readBackdropHex(style.bloom),
    angleDeg: ((angle % 360) + 360) % 360,
    intensity: Math.min(1, Math.max(0, intensity)),
  };
}

export function isDefaultBackdrop(style: BackdropStyle): boolean {
  return style.wash === null && style.bloom === null
    && style.angleDeg === DEFAULT_BACKDROP_ANGLE && style.intensity === 1;
}

export function backdropFromStorage(storage: ReadableStorage): BackdropStyle {
  try {
    return normalizeBackdrop({
      wash: storage?.getItem(BACKDROP_STORAGE_KEYS.wash) ?? undefined,
      bloom: storage?.getItem(BACKDROP_STORAGE_KEYS.bloom) ?? undefined,
      angleDeg: parseFloat(storage?.getItem(BACKDROP_STORAGE_KEYS.angle) ?? ""),
      intensity: parseFloat(storage?.getItem(BACKDROP_STORAGE_KEYS.intensity) ?? ""),
    });
  } catch {
    return DEFAULT_BACKDROP;
  }
}

/* ── WCAG contrast math (contrast.dart, ported) ─────────────────────── */

export type Rgb = readonly [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const m = HEX_RE.exec(hex.trim());
  const h = m ? m[1] : "000000";
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function relativeLuminance([r, g, b]: Rgb): number {
  const chan = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** tint at [alpha] composited over ground, rounded to display bytes. */
export function alphaBlend(tint: Rgb, alpha: number, ground: Rgb): Rgb {
  return [
    Math.round(alpha * tint[0] + (1 - alpha) * ground[0]),
    Math.round(alpha * tint[1] + (1 - alpha) * ground[1]),
    Math.round(alpha * tint[2] + (1 - alpha) * ground[2]),
  ];
}

/**
 * The largest alpha (<= max) at which tint blended over ground still leaves
 * ink readable at floor. The answer PASSES the floor by construction — the
 * binary search converges from the passing side, probing display bytes.
 */
export function maxAlphaForContrast(opts: {
  tint: Rgb; ground: Rgb; ink: Rgb; floor?: number; max?: number;
}): number {
  const { tint, ground, ink, floor = 4.5, max = 1 } = opts;
  const passes = (a: number): boolean => contrastRatio(ink, alphaBlend(tint, a, ground)) >= floor;
  if (passes(max)) { return max; }
  let lo = 0;
  let hi = max;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (passes(mid)) { lo = mid; } else { hi = mid; }
  }
  return lo;
}

/* ── resolveBackdrop (backdrop_style.dart, ported) ──────────────────── */

export interface ResolvedBackdrop {
  /** The hero wash's OPAQUE top stop: chosen tone pre-composited onto the
   *  scheme ground at the guarded alpha. Text can sit directly on this. */
  washColor: string;
  /** CSS gradient angle in degrees (already normalised). */
  washAngleDeg: number;
  bloomColor: string;
  bloomOpacity: number;
  orbNearColor: string;
  orbNearOpacity: number;
  orbFarColor: string;
  orbFarOpacity: number;
}

function rgbCss([r, g, b]: Rgb): string {
  return `rgb(${r} ${g} ${b})`;
}

/**
 * Compose style x glow ramp x scheme with the AA guard: the wash's top stop
 * and the corner bloom are clamped so [ink] keeps 4.5:1 on the brightest
 * surface they compose. The shipped glow tones pass at full alpha, so the
 * default look does not move.
 */
export function resolveBackdrop(opts: {
  style: BackdropStyle;
  glowBright: Rgb; glowMid: Rgb; glowDeep: Rgb;
  bg: Rgb; ink: Rgb;
}): ResolvedBackdrop {
  const { style, glowBright, glowMid, glowDeep, bg, ink } = opts;
  const washStop = style.wash ? hexToRgb(style.wash) : glowDeep;
  const bloomStop = style.bloom ? hexToRgb(style.bloom) : glowBright;
  const orbNearStop = style.bloom ? hexToRgb(style.bloom) : glowMid;
  const orbFarStop = style.wash ? hexToRgb(style.wash) : glowDeep;
  const intensity = Math.min(1, Math.max(0, style.intensity));

  const washAlpha = maxAlphaForContrast({ tint: washStop, ground: bg, ink, max: intensity });
  const washColor = alphaBlend(washStop, washAlpha, bg);

  const bloomOpacity = maxAlphaForContrast({ tint: bloomStop, ground: washColor, ink, max: 0.34 * intensity });
  const orbNearOpacity = maxAlphaForContrast({ tint: orbNearStop, ground: bg, ink, max: 0.22 * intensity });
  const orbFarOpacity = maxAlphaForContrast({ tint: orbFarStop, ground: bg, ink, max: 0.22 * intensity });

  return {
    washColor: rgbCss(washColor),
    washAngleDeg: style.angleDeg,
    bloomColor: rgbCss(bloomStop),
    bloomOpacity,
    orbNearColor: rgbCss(orbNearStop),
    orbNearOpacity,
    orbFarColor: rgbCss(orbFarStop),
    orbFarOpacity,
  };
}

/** Parse an `H S% L%` shadcn token triple into RGB (for computed-style reads). */
export function hslTripleToRgb(triple: string): Rgb | null {
  const m = /^\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*$/.exec(triple);
  if (!m) { return null; }
  const h = ((parseFloat(m[1]) % 360) + 360) % 360;
  const s = parseFloat(m[2]) / 100;
  const l = parseFloat(m[3]) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const mm = l - c / 2;
  let rgb: [number, number, number];
  if (h < 60) { rgb = [c, x, 0]; } else if (h < 120) { rgb = [x, c, 0]; }
  else if (h < 180) { rgb = [0, c, x]; } else if (h < 240) { rgb = [0, x, c]; }
  else if (h < 300) { rgb = [x, 0, c]; } else { rgb = [c, 0, x]; }
  return [Math.round((rgb[0] + mm) * 255), Math.round((rgb[1] + mm) * 255), Math.round((rgb[2] + mm) * 255)];
}

/* ── The client controller ──────────────────────────────────────────── */

type Listener = () => void;
const listeners = new Set<Listener>();

let currentBackdrop: BackdropStyle | null = null;

function notify(): void {
  for (const l of listeners) { l(); }
}

/** Re-render on any appearance change (accent, scheme, backdrop). */
export function subscribeAppearance(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The device's backdrop style (lazy-read once, then in-memory). */
export function getBackdrop(): BackdropStyle {
  currentBackdrop ??= typeof window === "undefined"
    ? DEFAULT_BACKDROP
    : backdropFromStorage(window.localStorage);
  return currentBackdrop;
}

function persist(key: string, value: string | null): void {
  try {
    if (value === null) {
      // Absence means "follow the accent", so a future default change reaches
      // devices that never pinned a colour.
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch {
    /* keep the in-memory choice */
  }
}

/** Set + persist + notify. Applies live via the data-accent attribute. */
export function setAccent(id: AccentId): void {
  applyAccent(readAccent(id), document.documentElement);
  persist(ACCENT_STORAGE_KEY, readAccent(id));
  notify();
}

export function setScheme(id: SchemeId): void {
  applyScheme(readScheme(id), document.documentElement);
  persist(SCHEME_STORAGE_KEY, readScheme(id));
  notify();
}

export function setBackdrop(style: Partial<BackdropStyle>): void {
  const normalized = normalizeBackdrop({ ...getBackdrop(), ...style });
  currentBackdrop = normalized;
  persist(BACKDROP_STORAGE_KEYS.wash, normalized.wash);
  persist(BACKDROP_STORAGE_KEYS.bloom, normalized.bloom);
  persist(BACKDROP_STORAGE_KEYS.angle, normalized.angleDeg === DEFAULT_BACKDROP_ANGLE ? null : String(normalized.angleDeg));
  persist(BACKDROP_STORAGE_KEYS.intensity, normalized.intensity === 1 ? null : String(normalized.intensity));
  notify();
}

/** One-tap "back to scheme default". */
export function resetBackdrop(): void {
  setBackdrop(DEFAULT_BACKDROP);
}

/** The accent worn right now, read off the document (boot script set it). */
export function currentAccentId(): AccentId {
  if (typeof document === "undefined") { return DEFAULT_ACCENT; }
  return readAccent(document.documentElement.getAttribute("data-accent"));
}

export function currentSchemeId(): SchemeId {
  if (typeof document === "undefined") { return DEFAULT_SCHEME; }
  return readScheme(document.documentElement.getAttribute("data-scheme"));
}
