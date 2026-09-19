// THE APPEARANCE AXES — accent, scheme, backdrop.
//
// Same shape as palette.test.ts: the rules are small and fail loudly (an
// unknown attribute leaves every accent token at its copper default, a boot
// script that drifts from the catalogue strands a stored choice), so the
// list, the boot script and the guard math are pinned.

import {
  ACCENTS, DEFAULT_ACCENT, ACCENT_STORAGE_KEY, readAccent, accentFromStorage,
  SCHEMES, DEFAULT_SCHEME, SCHEME_STORAGE_KEY, readScheme, schemeFromStorage,
  DEFAULT_BACKDROP, isDefaultBackdrop, normalizeBackdrop, readBackdropHex,
  contrastRatio, hexToRgb, maxAlphaForContrast, alphaBlend, resolveBackdrop,
  hslTripleToRgb, lightTonesApplyUnder,
} from "../appearance";
import * as fs from "node:fs";
import * as path from "node:path";

function readSource(relative: string): string {
  for (const base of [process.cwd(), path.join(__dirname, "..", "..", "..")]) {
    const full = path.join(base, relative);
    if (fs.existsSync(full)) { return fs.readFileSync(full, "utf8"); }
  }
  throw new Error(`readSource could not find ${relative} from ${process.cwd()}`);
}

describe("the catalogues", () => {
  it("ships the app's eight accents in the app's order, copper first", () => {
    expect(ACCENTS.map((a) => a.id)).toEqual([
      "copper", "brass", "sage", "teal", "steel", "lavender", "rose", "ember",
    ]);
    expect(DEFAULT_ACCENT).toBe("copper");
  });

  it("ships the app's five shells, rustic first", () => {
    expect(SCHEMES.map((s) => s.id)).toEqual([
      "rustic", "slate", "charcoal", "midnight", "graphite",
    ]);
    expect(DEFAULT_SCHEME).toBe("rustic");
  });

  it("every accent's hi and base stops clear WCAG AA on the near-black ground", () => {
    // The app's own guarantee (appearance.dart): hi 8.4–13.2, base 5.7–9.9.
    const bg = hexToRgb("#0C0A09");
    for (const a of ACCENTS) {
      expect(contrastRatio(hexToRgb(a.hi), bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(hexToRgb(a.base), bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("reading stored choices", () => {
  it("passes known ids through and defaults everything else", () => {
    expect(readAccent("sage")).toBe("sage");
    expect(readScheme("midnight")).toBe("midnight");
    for (const bad of ["", "SAGE", "  sage ", null, undefined, 7, "next-year"]) {
      expect(readAccent(bad)).toBe(DEFAULT_ACCENT);
      expect(readScheme(bad)).toBe(DEFAULT_SCHEME);
    }
  });

  it("never throws on hostile storage", () => {
    const thrower = { getItem: () => { throw new Error("denied"); } };
    expect(accentFromStorage(thrower)).toBe(DEFAULT_ACCENT);
    expect(schemeFromStorage(thrower)).toBe(DEFAULT_SCHEME);
    expect(accentFromStorage(null)).toBe(DEFAULT_ACCENT);
  });
});

describe("gaia is dark-only", () => {
  it("light tones apply under rustic, are remembered-not-applied under gaia", () => {
    expect(lightTonesApplyUnder("rustic")).toBe(true);
    expect(lightTonesApplyUnder("gaia")).toBe(false);
  });
});

describe("backdrop style", () => {
  it("defaults mean 'follow the accent' at the guest page's 150deg", () => {
    expect(DEFAULT_BACKDROP).toEqual({ wash: null, bloom: null, angleDeg: 150, intensity: 1 });
    expect(isDefaultBackdrop(DEFAULT_BACKDROP)).toBe(true);
  });

  it("anything unparseable loads as null, never as a junk colour", () => {
    expect(readBackdropHex("#C2410C")).toBe("#C2410C");
    expect(readBackdropHex("c2410c")).toBe("#C2410C");
    for (const bad of ["", "#FFF", "red", null, undefined, 42, "#GGGGGG"]) {
      expect(readBackdropHex(bad)).toBeNull();
    }
  });

  it("normalises angle into [0,360) and clamps intensity", () => {
    expect(normalizeBackdrop({ angleDeg: 370, intensity: 3 })).toEqual({
      wash: null, bloom: null, angleDeg: 10, intensity: 1,
    });
    expect(normalizeBackdrop({ angleDeg: -90, intensity: -1 }).angleDeg).toBe(270);
    expect(normalizeBackdrop({ intensity: -1 }).intensity).toBe(0);
  });
});

describe("the AA guard (contrast.dart, ported)", () => {
  it("maxAlphaForContrast answers from the passing side", () => {
    // A white wash under warm-white ink: the guard must trim it.
    const a = maxAlphaForContrast({
      tint: hexToRgb("#FFFFFF"), ground: hexToRgb("#0C0A09"), ink: hexToRgb("#ECEAE6"),
    });
    expect(a).toBeLessThan(1);
    const composed = alphaBlend(hexToRgb("#FFFFFF"), a, hexToRgb("#0C0A09"));
    expect(contrastRatio(hexToRgb("#ECEAE6"), composed)).toBeGreaterThanOrEqual(4.5);
  });

  it("the shipped copper glow passes untouched at full alpha", () => {
    // Measured 7.79:1 in the app — the default look must not move.
    const a = maxAlphaForContrast({
      tint: hexToRgb("#7C2D12"), ground: hexToRgb("#0C0A09"), ink: hexToRgb("#ECEAE6"),
    });
    expect(a).toBe(1);
  });

  it("resolveBackdrop keeps ink readable on the wash whatever the owner picked", () => {
    const r = resolveBackdrop({
      style: { wash: "#FFFFFF", bloom: "#FFFFFF", angleDeg: 150, intensity: 1 },
      glowBright: hexToRgb("#C2410C"), glowMid: hexToRgb("#9A3412"), glowDeep: hexToRgb("#7C2D12"),
      bg: hexToRgb("#0C0A09"), ink: hexToRgb("#ECEAE6"),
    });
    const m = /rgb\((\d+) (\d+) (\d+)\)/.exec(r.washColor);
    expect(m).not.toBeNull();
    const wash: [number, number, number] = [Number(m![1]), Number(m![2]), Number(m![3])];
    expect(contrastRatio(hexToRgb("#ECEAE6"), wash)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("hsl triple parsing (for computed-style reads)", () => {
  it("round-trips the rustic ground", () => {
    expect(hslTripleToRgb("20 14.3% 4.1%")).toEqual([12, 10, 9]);
  });
  it("refuses garbage", () => {
    expect(hslTripleToRgb("")).toBeNull();
    expect(hslTripleToRgb("not a colour")).toBeNull();
  });
});

describe("the inline boot script cannot import, so its copy is pinned here", () => {
  const layout = (): string => readSource("src/app/layout.tsx");

  it("names every accent and scheme this module ships", () => {
    const src = layout();
    for (const a of ACCENTS) { expect(src).toContain(`'${a.id}'`); }
    for (const s of SCHEMES) { expect(src).toContain(`'${s.id}'`); }
  });

  it("uses the same storage keys and defaults", () => {
    const src = layout();
    expect(src).toContain(`localStorage.getItem('${ACCENT_STORAGE_KEY}')`);
    expect(src).toContain(`localStorage.getItem('${SCHEME_STORAGE_KEY}')`);
    expect(src).toContain(`a='${DEFAULT_ACCENT}'`);
    expect(src).toContain(`s='${DEFAULT_SCHEME}'`);
  });

  it("keeps the dark class on while Gaia is worn", () => {
    expect(layout()).toContain("classList.add('dark')");
  });
});
