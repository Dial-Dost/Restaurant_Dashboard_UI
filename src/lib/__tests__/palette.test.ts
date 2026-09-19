// WHICH VISUAL LANGUAGE THE PAGE WEARS.
//
// The rules here are small and the ways they fail are loud, which is why they
// are worth pinning rather than inlining:
//
//   * an unrecognised stored value left on the element leaves every token at
//     its `:root` value — the LIGHT palette — so a stale preference renders a
//     WHITE dashboard in a dark room and reads as a broken theme toggle;
//   * the inline boot script that runs before first paint cannot import this
//     module, so its literals are a hand-copy that can silently drift;
//   * a palette with no CSS block behind it does the same thing as an unknown
//     one, so the list and the stylesheet have to agree.

import {
  PALETTES, DEFAULT_PALETTE, STORAGE_KEY,
  isPaletteId, readPalette, applyPalette, paletteFromStorage,
} from "../palette";
import * as fs from "node:fs";
import * as path from "node:path";

function readSource(relative: string): string {
  for (const base of [process.cwd(), path.join(__dirname, "..", "..", "..")]) {
    const full = path.join(base, relative);
    if (fs.existsSync(full)) { return fs.readFileSync(full, "utf8"); }
  }
  throw new Error(`readSource could not find ${relative} from ${process.cwd()}`);
}

describe("what counts as a palette", () => {
  it("knows the ones it ships", () => {
    for (const p of PALETTES) { expect(isPaletteId(p.id)).toBe(true); }
  });

  it("refuses everything else", () => {
    for (const bad of ["", "Rustic", "RUSTIC", "midnight", null, undefined, 3, {}, []]) {
      expect(isPaletteId(bad)).toBe(false);
    }
  });

  it("defaults to Rustic Fork — the look the Flutter app ships with", () => {
    // The point of the parity work is that the two look like one product, so
    // the web's default has to be the app's default and not shadcn's.
    expect(DEFAULT_PALETTE).toBe("rustic");
    expect(PALETTES[0].id).toBe("rustic");
  });
});

describe("reading a stored preference", () => {
  it("passes a known one through", () => {
    expect(readPalette("gaia")).toBe("gaia");
    expect(readPalette("rustic")).toBe("rustic");
  });

  it("THE RULE: anything unrecognised becomes the default, never itself", () => {
    // Passing it through would put a `data-palette` on <html> that the
    // stylesheet has no rules for — leaving every token at its `:root` value,
    // which is the LIGHT palette. A white dashboard in a dark room.
    for (const bad of ["midnight", "", "  rustic  ", null, undefined, 42]) {
      expect(readPalette(bad)).toBe(DEFAULT_PALETTE);
    }
  });

  it("and that covers a palette a FUTURE build ships", () => {
    // The realistic case: a browser that has visited a newer deploy and kept
    // its preference, then loads an older one.
    expect(readPalette("some-palette-from-next-year")).toBe(DEFAULT_PALETTE);
  });
});

describe("reading it off storage never throws", () => {
  it("returns the stored palette", () => {
    expect(paletteFromStorage({ getItem: () => "gaia" })).toBe("gaia");
  });

  it("defaults when nothing is stored", () => {
    expect(paletteFromStorage({ getItem: () => null })).toBe(DEFAULT_PALETTE);
  });

  it("defaults when there is no storage at all", () => {
    expect(paletteFromStorage(null)).toBe(DEFAULT_PALETTE);
    expect(paletteFromStorage(undefined)).toBe(DEFAULT_PALETTE);
  });

  it("defaults when storage THROWS — private mode, blocked cookies", () => {
    // A palette is a preference. Failing to read one must never be worth an
    // exception on a page somebody is trying to take an order on.
    expect(paletteFromStorage({ getItem: () => { throw new Error("denied") } })).toBe(DEFAULT_PALETTE);
  });
});

describe("applying it", () => {
  it("sets data-palette on the element it is given", () => {
    const calls: [string, string][] = [];
    applyPalette("gaia", { setAttribute: (n, v) => { calls.push([n, v]) } });
    expect(calls).toEqual([["data-palette", "gaia"]]);
  });
});

describe("the inline boot script cannot import, so its copy is pinned here", () => {
  const layout = (): string => readSource("src/app/layout.tsx");

  it("names every palette this module ships", () => {
    // If a third palette is added to PALETTES and not to the script, a browser
    // holding it would fall through the script's check and render light.
    const src = layout();
    for (const p of PALETTES) {
      expect(src).toContain(`v!=='${p.id}'`);
    }
  });

  it("uses the same storage key", () => {
    expect(layout()).toContain(`localStorage.getItem('${STORAGE_KEY}')`);
  });

  it("falls back to the same default, on BOTH paths", () => {
    const src = layout();
    // The unknown-value path…
    expect(src).toContain(`v='${DEFAULT_PALETTE}';`);
    // …and the storage-threw path.
    expect(src).toContain(`setAttribute('data-palette','${DEFAULT_PALETTE}')`);
  });

  it("runs in <head>, before the first paint", () => {
    // A useEffect is by definition after the paint, which is the flash this
    // exists to remove.
    const src = layout();
    expect(src.indexOf("<head>")).toBeGreaterThan(-1);
    expect(src.indexOf("cuisineflow-palette")).toBeGreaterThan(src.indexOf("<head>"));
    expect(src.indexOf("cuisineflow-palette")).toBeLessThan(src.indexOf("<body"));
  });
});

describe("every palette has a stylesheet behind it", () => {
  const css = (): string => readSource("src/app/palette.css");

  it("defines the blocks each palette's rules promise", () => {
    // Rustic has a dark block and a light block (the light toggle keeps
    // working). GAIA IS DARK-ONLY, exactly as the Flutter app forbids light
    // Gaia: one block that applies with or without `.dark`, and no light
    // variant for a tone to reveal.
    const src = css();
    expect(src).toContain(`[data-palette="rustic"].dark`);
    expect(src).toContain(`[data-palette="rustic"]:not(.dark)`);
    expect(src).toContain(`html[data-palette="gaia"]`);
    expect(src).not.toContain(`[data-palette="gaia"]:not(.dark)`);
  });

  it("and the stylesheet is actually imported", () => {
    expect(readSource("src/app/globals.css")).toContain('@import "./palette.css"');
  });

  it("every token value is a bare HSL triple, never a finished colour", () => {
    // shadcn components write `hsl(var(--token))` and sometimes
    // `hsl(var(--border) / 0.5)`. A token holding `#0C0A09` or `rgb(...)`
    // breaks every one of those, and it breaks them silently — the property
    // just fails to parse and the element inherits.
    const src = css();
    const decls = src.match(/^\s*--[a-z0-9-]+:\s*[^;]+;/gm) ?? [];
    expect(decls.length).toBeGreaterThan(20);
    for (const d of decls) {
      const value = d.split(":")[1].replace(";", "").trim();
      if (value.endsWith("rem")) { continue; } // --radius
      // Non-colour tokens carry what they are: --shadow-card is a whole
      // box-shadow (or `none` under Gaia), and the sidebar accents alias the
      // live accent via var() so a scheme/accent flip carries through.
      if (value.startsWith("var(") || value === "none" || /\dpx/.test(value)) { continue; }
      expect(value).toMatch(/^[\d.]+ [\d.]+% [\d.]+%$/);
    }
  });

  it("each palette's swatch is a real colour the picker can paint", () => {
    for (const p of PALETTES) {
      expect(p.swatch.bg).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(p.swatch.accent).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("and every palette has a label and a hint — a name alone is not a signal", () => {
    for (const p of PALETTES) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.hint.length).toBeGreaterThan(10);
    }
  });
});
