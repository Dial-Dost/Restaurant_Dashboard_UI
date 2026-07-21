// Shared helpers for the customer-page branding (brand_config) — used by both
// the settings customizer (live preview) and the public guest order page so the
// two stay in lockstep. No heavy deps here on purpose: the guest page must be
// able to import this without pulling in the auth-heavy db.ts module.

// A tenant's customer-page customization. Mirrors the backend BrandConfig shape
// (all keys optional; the read layer applies defaults for font/header/button).
export type BrandConfig = {
  font?: string;
  color_primary?: string;
  color_secondary?: string;
  color_bg?: string;
  color_text?: string;
  color_card?: string;
  header_style?: "gradient" | "solid";
  button_shape?: "rounded" | "pill" | "square";
};

// The curated font allowlist the backend accepts (kept here as a client-side
// fallback for the dropdown when /restaurant/settings doesn't return one).
export const BRAND_FONTS: string[] = [
  "Inter",
  "Poppins",
  "Playfair Display",
  "Montserrat",
  "Lato",
  "Nunito",
  "Oswald",
  "Roboto Slab",
  "DM Sans",
  "Merriweather",
];

// Serif families in the allowlist fall back to a serif system stack; the rest
// to a sans-serif one, so an un-loaded font still looks close to the target.
const SERIF_FONTS = new Set(["Playfair Display", "Roboto Slab", "Merriweather"]);

// A CSS font-family value for a chosen family, with a sensible system fallback.
export function fontStack(family: string | undefined): string {
  const f = (family ?? "").trim();
  const fallback = SERIF_FONTS.has(f) ? "Georgia, 'Times New Roman', serif" : "system-ui, -apple-system, sans-serif";
  return f ? `"${f}", ${fallback}` : fallback;
}

// Inject a Google Fonts <link> for the chosen family (once per family). Safe to
// call repeatedly and on every render — it de-dupes by id and no-ops on the
// server. A stylesheet <link> is CSP-friendly for the app pages (dashboard +
// guest order page are normal Next pages, not sandboxed artifacts).
export function loadBrandFont(family: string | undefined): void {
  if (typeof document === "undefined") return;
  const f = (family ?? "").trim();
  if (!f || !BRAND_FONTS.includes(f)) return;
  const id = `brand-font-${f.replace(/\s+/g, "-").toLowerCase()}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;500;600;700;800&display=swap`;
  document.head.appendChild(link);
}

// Pick a readable text colour (near-white or near-black) for text sitting on a
// solid brand colour — WCAG relative-luminance threshold. Used so a light
// color_primary doesn't get unreadable white text on it.
export function readableOn(hex: string | undefined): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex ?? "").trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const srgb = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  const lum = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  return lum > 0.55 ? "#111111" : "#ffffff";
}

// Border-radius for the primary action buttons, driven by button_shape.
export function shapeRadius(shape: string | undefined): string {
  switch (shape) {
    case "square":
      return "0.25rem"; // near-sharp corners (a hair of rounding, not razor edges)
    case "rounded":
      return "0.75rem";
    case "pill":
    default:
      return "9999px";
  }
}
