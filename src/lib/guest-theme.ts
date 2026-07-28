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
