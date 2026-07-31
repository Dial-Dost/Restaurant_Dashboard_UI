// Shared "Rustic Fork" premium-dark design system for the CUSTOMER-facing pages
// (/order/[restaurant] and /feedback — the valet step lives inside the feedback
// flow). Extracted from the order page so all guest surfaces derive the SAME
// accent ramp, panel material, control radius and hero wash from the tenant's
// brand_config, instead of each page re-implementing (or hardcoding) it.
//
// Nothing here touches the network or React state: pure colour maths + a CSS
// custom-property bag, so both the order page and the feedback page can render
// identical surfaces from one source of truth.
import type { CSSProperties } from "react";
import type { BrandConfig } from "@/lib/brand-fonts";

// The default accent when a tenant has configured nothing at all (same value the
// order page has always used).
export const DEFAULT_ACCENT = "#ea580c";
export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// brand_config as the guest pages consume it. `surface_style` is the newer key
// (panel material) the backend added when the legacy colour keys were retired;
// declared here as an optional extension so the guest pages don't depend on the
// editor-side type being updated in lockstep.
export interface GuestBrandConfig extends BrandConfig {
  surface_style?: "frosted" | "solid" | "tinted";
}

// Only #rrggbb is accepted; anything else (null, "", a name, a short hex) is
// treated as "not configured" so the next fallback in the chain wins.
export function pickHex(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && HEX_RE.test(v.trim())) {return v.trim();}
  }
  return null;
}

// h in degrees, s & l in 0..1 → [r,g,b] 0..255.
export function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

// [r,g,b] 0..255 → [h(deg), s(0..1), l(0..1)].
export function rgb2hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) {h = (g - b) / d + (g < b ? 6 : 0);}
    else if (mx === g) {h = (b - r) / d + 2;}
    else {h = (r - g) / d + 4;}
    h *= 60;
  }
  return [h, s, l];
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const hexOf = (rgb: number[]) =>
  "#" + rgb.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("");

export interface Ramp {
  acc: string; accHi: string; accMid: string; accDeep: string; accShadow: string; onAcc: string;
  accRGB: string; accHiRGB: string; accDeepRGB: string; accShadowRGB: string;
}

// The 6-stop ramp, exactly like the design prototype: hi L.75, acc L.63,
// mid L.51, deep L.39, shadow L.27, onAcc (dark ink) L.09. h in deg, s in 0..100.
export function rampHS(h: number, s: number): Ramp {
  const hi = hsl2rgb(h, clamp01((s + 7) / 100), 0.75);
  const acc = hsl2rgb(h, clamp01(s / 100), 0.63);
  const mid = hsl2rgb(h, clamp01((s - 3) / 100), 0.51);
  const deep = hsl2rgb(h, clamp01((s - 6) / 100), 0.39);
  const shadow = hsl2rgb(h, clamp01((s - 8) / 100), 0.27);
  const on = hsl2rgb(h, clamp01((s - 5) / 100), 0.09);
  return {
    acc: hexOf(acc), accHi: hexOf(hi), accMid: hexOf(mid), accDeep: hexOf(deep), accShadow: hexOf(shadow), onAcc: hexOf(on),
    accRGB: acc.join(","), accHiRGB: hi.join(","), accDeepRGB: deep.join(","), accShadowRGB: shadow.join(","),
  };
}

// Resolve a brand hex into {h, s(0..100)} for the ramp. Falls back to copper.
export function hexToHS(hex: string): { h: number; s: number } {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex ?? "").trim());
  const hp = m?.[1];
  if (!hp) {return { h: 24, s: 38 };}
  const n = parseInt(hp, 16);
  const [h, s] = rgb2hsl((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
  return { h, s: s * 100 };
}

// Panel material (brand_config.surface_style). "frosted" is the shipped look, so
// an untouched tenant is pixel-identical to before this key existed.
interface Surface { panelBg: string; blur: string; pbA: string }
const SURFACES: Record<string, Surface> = {
  frosted: { panelBg: "rgba(26,26,31,0.55)", blur: "22px", pbA: "0.12" },
  solid: { panelBg: "rgba(18,18,21,0.94)", blur: "0px", pbA: "0.10" },
  tinted: { panelBg: "rgba(var(--accShadowRGB),0.42)", blur: "22px", pbA: "0.18" },
};

// Control radius (brand_config.button_shape). "rounded" (13px) is the shipped
// value; the card radius stays a design constant at 22px.
const CTRL_RADII: Record<string, string> = { rounded: "13px", pill: "9999px", square: "4px" };
const CARD_RADIUS = "22px";

export interface GuestTheme extends Ramp {
  panelBg: string; blur: string; pbA: string;
  rCard: string; rCtrl: string;
  heroWash: string;
}

// The full surface theme for a guest page: the accent ramp derived from the
// tenant's accent, plus the three brand_config knobs that are real
// (surface_style → panel material, button_shape → control radius,
// header_style → hero wash).
export function resolveGuestTheme(accent: string, cfg: GuestBrandConfig | null | undefined): GuestTheme {
  const { h, s } = hexToHS(accent);
  const surface = SURFACES[cfg?.surface_style ?? "frosted"] ?? SURFACES.frosted;
  const rCtrl = CTRL_RADII[cfg?.button_shape ?? "rounded"] ?? CTRL_RADII.rounded;
  // "solid" paints a flat accent block; "gradient" (default) is the shipped
  // accent→near-black wash. Both sit under the same dark scrim in the markup.
  const heroWash = cfg?.header_style === "solid"
    ? "var(--accDeep)"
    : "linear-gradient(150deg, var(--accDeep), #0B0B0D 78%)";
  return { ...rampHS(h, s), ...surface, rCard: CARD_RADIUS, rCtrl, heroWash };
}

// The CSS custom properties every guest surface is styled from. Set on the page
// root; the CSS module / inline styles below it only ever reference these.
export function guestThemeVars(theme: GuestTheme): CSSProperties {
  return {
    "--acc": theme.acc, "--accHi": theme.accHi, "--accMid": theme.accMid,
    "--accDeep": theme.accDeep, "--accShadow": theme.accShadow, "--onAcc": theme.onAcc,
    "--accRGB": theme.accRGB, "--accHiRGB": theme.accHiRGB, "--accDeepRGB": theme.accDeepRGB,
    "--accShadowRGB": theme.accShadowRGB, "--panelBg": theme.panelBg, "--blur": theme.blur,
    "--pbA": theme.pbA, "--rCard": theme.rCard, "--rCtrl": theme.rCtrl,
    "--heroWash": theme.heroWash,
  } as CSSProperties;
}

// Shell colours shared by every guest surface (near-black page, warm off-white
// ink, muted/dim greys, and the shared "soft red" used for errors & warnings).
export const SHELL = {
  bg: "#08080A",
  ink: "#ECEAE6",
  inkStrong: "#F7F5F2",
  muted: "#9A978F",
  dim: "#615E57",
  warn: "#E0A79B",
} as const;

// Utility classes + keyframes the guest pages rely on (Material Symbols glyphs,
// hidden scrollbars, the thin numeral face, the serif display face, floating
// accent orbs, sheet/fade animations).
export const GUEST_CSS = `
.ms{font-family:'Material Symbols Outlined';font-weight:400;font-style:normal;line-height:1;-webkit-font-smoothing:antialiased;user-select:none;}
.rf-sc{scrollbar-width:none;-ms-overflow-style:none;}
.rf-sc::-webkit-scrollbar{width:0;height:0;}
.rf-num{font-family:Roboto,system-ui,sans-serif;font-weight:300;letter-spacing:-0.5px;}
.rf-serif{font-family:'Instrument Serif',Georgia,serif;}
@keyframes rfFloatOrb{0%,100%{transform:translate(0,0) scale(1);}50%{transform:translate(24px,-20px) scale(1.08);}}
@keyframes rfSheetUp{from{transform:translateY(100%);}to{transform:translateY(0);}}
@keyframes rfFadeIn{from{opacity:0;}to{opacity:1;}}
`;

// ---------------------------------------------------------------------------
// Brand PALETTE — the nine colour ROLES the backend resolves for every tenant
// and returns from GET /qr/:slug/menu (and /qr/:slug/branding) as
// `brand_palette`. Every value is already a #rrggbb (never null) with defaults
// that reproduce the shipped dark design exactly.
//
// The ramp above answers "what is the brand accent"; this answers "what is the
// page made of" — page, panel, ink, and the three semantic states. Guest pages
// should theme from BOTH: `resolveGuestTheme(palette.primary, brand_config)`
// for the accent ramp/material, `resolveGuestPalette(brand_palette)` for the
// shell + status colours. Nothing here changes what the order page renders —
// it is additive, so the order page keeps its current output byte-for-byte.
// ---------------------------------------------------------------------------
export interface GuestPalette {
  primary: string; secondary: string; accent: string;
  background: string; surface: string; text: string;
  success: string; warning: string; error: string;
}

// Mirrors the backend's BRAND_PALETTE_DEFAULTS / BRAND_DEFAULT_PRIMARY, so a
// page that cannot reach the API still paints the shipped look rather than an
// unstyled (i.e. monochrome) fallback.
export const PALETTE_DEFAULTS: GuestPalette = {
  primary: DEFAULT_ACCENT,
  secondary: "#c2410c",
  accent: "#fdba74",
  background: SHELL.bg,
  surface: "#1A1A1F",
  text: SHELL.ink,
  success: "#8FB27C",
  warning: "#E4C48C",
  error: SHELL.warn,
};

// "#rrggbb" → "r,g,b" for rgba() compositing in CSS custom properties.
export function rgbOf(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex ?? "").trim());
  if (!m) {return "0,0,0";}
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 0xff},${(n >> 8) & 0xff},${n & 0xff}`;
}

// Validate a raw `brand_palette` payload into a complete palette. Anything the
// tenant hasn't set (or that arrives malformed) falls back to a value DERIVED
// from the tenant's own primary where a derivation exists (secondary/accent),
// and to the shipped design constant otherwise — so a partially configured
// tenant is still fully branded, never grey.
export function resolveGuestPalette(raw: unknown, fallbackPrimary?: string | null): GuestPalette {
  const p = (raw ?? {}) as Record<string, unknown>;
  const primary = pickHex(p.primary, fallbackPrimary) ?? PALETTE_DEFAULTS.primary;
  const { h, s } = hexToHS(primary);
  const derived = rampHS(h, s);
  return {
    primary,
    secondary: pickHex(p.secondary) ?? derived.accMid,
    accent: pickHex(p.accent) ?? derived.accHi,
    background: pickHex(p.background) ?? PALETTE_DEFAULTS.background,
    surface: pickHex(p.surface) ?? PALETTE_DEFAULTS.surface,
    text: pickHex(p.text) ?? PALETTE_DEFAULTS.text,
    success: pickHex(p.success) ?? PALETTE_DEFAULTS.success,
    warning: pickHex(p.warning) ?? PALETTE_DEFAULTS.warning,
    error: pickHex(p.error) ?? PALETTE_DEFAULTS.error,
  };
}

// The palette as CSS custom properties, to be spread alongside guestThemeVars()
// on a guest page root. Both the flat hex and an "r,g,b" triplet are exposed so
// markup can tint/scrim a role (rgba(var(--okRGB),0.14)) without re-parsing hex.
// Muted/dim ink is deliberately NOT a separate role: it is the tenant's own text
// colour at reduced alpha, so the greys track the brand instead of being fixed.
export function paletteVars(p: GuestPalette): CSSProperties {
  return {
    "--bg": p.background, "--bgRGB": rgbOf(p.background),
    "--surface": p.surface, "--surfaceRGB": rgbOf(p.surface),
    "--ink": p.text, "--inkRGB": rgbOf(p.text),
    "--brand": p.primary, "--brandRGB": rgbOf(p.primary),
    "--brand2": p.secondary, "--brand2RGB": rgbOf(p.secondary),
    "--brand3": p.accent, "--brand3RGB": rgbOf(p.accent),
    "--ok": p.success, "--okRGB": rgbOf(p.success),
    "--warn": p.warning, "--warnRGB": rgbOf(p.warning),
    "--err": p.error, "--errRGB": rgbOf(p.error),
  } as CSSProperties;
}

// Extra motion + material utilities for the waitlist / reservation surfaces.
// Kept separate from GUEST_CSS so the order page's injected stylesheet is
// unchanged; pages that want these inject both strings.
export const GUEST_FX_CSS = `
@keyframes rfRise{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
@keyframes rfHalo{0%{transform:scale(0.86);opacity:0.55;}70%{transform:scale(1.35);opacity:0;}100%{transform:scale(1.35);opacity:0;}}
@keyframes rfShimmer{0%{background-position:-220% 0;}100%{background-position:220% 0;}}
@keyframes rfSpin{to{transform:rotate(360deg);}}
@keyframes rfBellSwing{0%,60%,100%{transform:rotate(0deg);}70%{transform:rotate(13deg);}80%{transform:rotate(-11deg);}90%{transform:rotate(6deg);}}
.rf-rise{animation:rfRise .45s cubic-bezier(.22,.9,.28,1) both;}
.rf-skel{background:linear-gradient(90deg,rgba(var(--inkRGB),0.05) 25%,rgba(var(--inkRGB),0.12) 45%,rgba(var(--inkRGB),0.05) 65%);background-size:220% 100%;animation:rfShimmer 1.5s linear infinite;border-radius:10px;}
.rf-press{transition:transform .16s cubic-bezier(.22,.9,.28,1),box-shadow .2s ease,background-color .2s ease,border-color .2s ease,opacity .2s ease;}
.rf-press:active{transform:scale(.97);}
.rf-field{width:100%;font-size:16px;line-height:1.35;color:var(--ink);background:rgba(var(--bgRGB),0.55);border:1.5px solid rgba(var(--inkRGB),0.10);border-radius:var(--rCtrl);padding:12px 14px;outline:none;caret-color:var(--accHi);transition:border-color .2s ease,box-shadow .2s ease,background-color .2s ease;-webkit-appearance:none;appearance:none;}
.rf-field::placeholder{color:rgba(var(--inkRGB),0.32);}
.rf-field:focus{border-color:rgba(var(--accRGB),0.8);background:rgba(var(--bgRGB),0.72);box-shadow:0 0 0 4px rgba(var(--accRGB),0.15);}
.rf-field[aria-invalid="true"]{border-color:rgba(var(--errRGB),0.75);}
.rf-field[aria-invalid="true"]:focus{box-shadow:0 0 0 4px rgba(var(--errRGB),0.16);}
.rf-field::-webkit-calendar-picker-indicator{filter:invert(1);opacity:.55;cursor:pointer;}
@media (prefers-reduced-motion:reduce){
.rf-rise,.rf-skel,.rf-press{animation:none!important;transition:none!important;}
}
`;
