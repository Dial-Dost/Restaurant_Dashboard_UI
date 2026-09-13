// 6.6 — LIGHT MODE'S COLOUR OPTIONS (white / beige / soft grey).
//
// Pinned here, because each one fails quietly:
//   * a stored value the page cannot render must fall back to white, and the
//     menu must tick what the page is actually wearing;
//   * picking a tone while in dark mode must switch to light (otherwise the
//     menu looks dead), and picking dark must not throw the tone away;
//   * the inline boot script in the root layout cannot import this module, so
//     its literals are a hand-copy that can drift;
//   * "WCAG AA" is a claim about numbers, so the numbers are checked from the
//     stylesheet itself rather than trusted from a comment;
//   * a tinted ground must never reach paper.

import {
  LIGHT_TONES, DEFAULT_LIGHT_TONE, LIGHT_TONE_STORAGE_KEY,
  isLightToneId, readLightTone, applyLightTone, lightToneFromStorage,
  applyAppearancePick, activeAppearance,
} from "../light-tone";
import * as fs from "node:fs";
import * as path from "node:path";

function readSource(relative: string): string {
  for (const base of [process.cwd(), path.join(__dirname, "..", "..", "..")]) {
    const full = path.join(base, relative);
    // Paths are this test's own repo-relative literals, never user input.
    if (fs.existsSync(full)) { return fs.readFileSync(full, "utf8"); } // eslint-disable-line security/detect-non-literal-fs-filename
  }
  throw new Error(`readSource could not find ${relative} from ${process.cwd()}`);
}

describe("what counts as a light tone", () => {
  it("ships white, beige and soft grey", () => {
    expect(LIGHT_TONES.map((t) => t.id)).toEqual(["white", "beige", "grey"]);
    for (const t of LIGHT_TONES) { expect(isLightToneId(t.id)).toBe(true); }
  });

  it("refuses everything else", () => {
    for (const bad of ["", "Beige", "cream", "dark", null, undefined, 1, {}]) {
      expect(isLightToneId(bad)).toBe(false);
    }
  });

  it("defaults to WHITE — an existing user sees no change", () => {
    expect(DEFAULT_LIGHT_TONE).toBe("white");
  });

  it("every tone has a label, a hint and a paintable swatch", () => {
    for (const t of LIGHT_TONES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.hint.length).toBeGreaterThan(10);
      expect(t.swatch.bg).toMatch(/^#[0-9A-F]{6}$/);
      expect(t.swatch.border).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});

describe("persistence", () => {
  it("passes a known stored tone through", () => {
    expect(readLightTone("beige")).toBe("beige");
    expect(lightToneFromStorage({ getItem: (k) => (k === LIGHT_TONE_STORAGE_KEY ? "grey" : null) })).toBe("grey");
  });

  it("anything unrecognised — including a future tone — becomes white", () => {
    for (const bad of ["sepia", " beige", null, undefined, 7]) {
      expect(readLightTone(bad)).toBe("white");
    }
  });

  it("never throws: no storage, nothing stored, or storage that throws", () => {
    expect(lightToneFromStorage(null)).toBe("white");
    expect(lightToneFromStorage(undefined)).toBe("white");
    expect(lightToneFromStorage({ getItem: () => null })).toBe("white");
    expect(lightToneFromStorage({ getItem: () => { throw new Error("denied") } })).toBe("white");
  });

  it("uses its own key, not the palette's or next-themes'", () => {
    expect(LIGHT_TONE_STORAGE_KEY).toBe("cuisineflow-light-tone");
    expect(LIGHT_TONE_STORAGE_KEY).not.toBe("cuisineflow-palette");
    expect(LIGHT_TONE_STORAGE_KEY).not.toBe("theme");
  });

  it("applies as data-light-tone on the element it is given", () => {
    const calls: [string, string][] = [];
    applyLightTone("beige", { setAttribute: (n, v) => { calls.push([n, v]) } });
    expect(calls).toEqual([["data-light-tone", "beige"]]);
  });
});

describe("what picking a menu row does", () => {
  it("picking a tone switches to light AND sets the tone", () => {
    expect(applyAppearancePick("beige")).toEqual({ theme: "light", tone: "beige" });
    expect(applyAppearancePick("white")).toEqual({ theme: "light", tone: "white" });
  });

  it("picking dark leaves the stored tone alone for next time", () => {
    expect(applyAppearancePick("dark")).toEqual({ theme: "dark", tone: null });
  });

  it("the tick follows what the page is wearing", () => {
    expect(activeAppearance("dark", "beige")).toBe("dark");
    expect(activeAppearance("light", "beige")).toBe("beige");
    expect(activeAppearance("light", "white")).toBe("white");
  });

  it("ticks nothing while next-themes has not reported a theme yet", () => {
    expect(activeAppearance(undefined, "beige")).toBeNull();
    expect(activeAppearance("system", "beige")).toBeNull();
  });
});

describe("the inline boot script's copy is pinned", () => {
  const layout = (): string => readSource("src/app/layout.tsx");

  it("names every tone, the key, and falls back to white on both paths", () => {
    const src = layout();
    for (const t of LIGHT_TONES) { expect(src).toContain(`t!=='${t.id}'`); }
    expect(src).toContain(`localStorage.getItem('${LIGHT_TONE_STORAGE_KEY}')`);
    expect(src).toContain(`t='${DEFAULT_LIGHT_TONE}';`);
    expect(src).toContain(`setAttribute('data-light-tone','${DEFAULT_LIGHT_TONE}')`);
  });

  it("runs in <head>, before the first paint", () => {
    const src = layout();
    expect(src.indexOf(LIGHT_TONE_STORAGE_KEY)).toBeGreaterThan(src.indexOf("<head>"));
    expect(src.indexOf(LIGHT_TONE_STORAGE_KEY)).toBeLessThan(src.indexOf("<body"));
  });
});

// ---------------------------------------------------------------------------
// The stylesheet.
// ---------------------------------------------------------------------------

type Hsl = [number, number, number];

/** The colour declarations inside the first `selector {` block (`--radius` is skipped). */
function tokens(css: string, selector: string): Record<string, Hsl> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) { throw new Error(`no block for ${selector}`); }
  const body = css.slice(start, css.indexOf("}", start));
  const out: Record<string, Hsl> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
    if (m[2].trim().endsWith("rem")) { continue; }
    const parts = /^([\d.]+) ([\d.]+)% ([\d.]+)%$/.exec(m[2].trim());
    if (!parts) { throw new Error(`${m[1]} in ${selector} is not a bare HSL triple: ${m[2]}`); }
    out[m[1]] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  }
  return out;
}

function luminance([h, s, l]: Hsl): number {
  const sat = s / 100, light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    return light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const lin = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(f(0)) + 0.7152 * lin(f(8)) + 0.0722 * lin(f(4));
}

function contrast(a: Hsl, b: Hsl): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe("the tone stylesheet", () => {
  const css = (): string => readSource("src/app/globals.css");
  const screenBlock = (): string => {
    const src = css();
    return src.slice(src.indexOf("@media screen {"));
  };

  it("sanity: the contrast helper agrees with known values", () => {
    expect(contrast([0, 0, 0], [0, 0, 100])).toBeCloseTo(21, 5);
    expect(contrast([0, 0, 100], [0, 0, 100])).toBeCloseTo(1, 5);
  });

  it("every non-white tone has a light-only block; white has none (it IS :root)", () => {
    const src = css();
    for (const t of LIGHT_TONES) {
      const selector = `[data-light-tone="${t.id}"]:not(.dark) {`;
      if (t.id === DEFAULT_LIGHT_TONE) { expect(src).not.toContain(selector); }
      else { expect(src).toContain(selector); }
    }
  });

  it("the tone blocks are SCREEN ONLY, so paper stays white", () => {
    const src = css();
    const screenAt = src.indexOf("@media screen {");
    expect(screenAt).toBeGreaterThan(-1);
    for (const t of LIGHT_TONES.filter((x) => x.id !== DEFAULT_LIGHT_TONE)) {
      expect(src.indexOf(`[data-light-tone="${t.id}"]`)).toBeGreaterThan(screenAt);
    }
  });

  it("the bill preview's receipt card is reset to white", () => {
    const receipt = tokens(screenBlock(), "[data-light-tone]:not(.dark) .receipt-card");
    expect(receipt["--card"]).toEqual([0, 0, 100]);
  });

  it("tones never override the palette's accent tokens", () => {
    // `data-palette` owns these in light mode; a tone setting one would
    // silently replace Rustic's copper or Gaia's champagne.
    for (const t of LIGHT_TONES.filter((x) => x.id !== DEFAULT_LIGHT_TONE)) {
      const block = tokens(screenBlock(), `[data-light-tone="${t.id}"]:not(.dark)`);
      for (const owned of ["--primary", "--primary-foreground", "--ring", "--accent-foreground", "--chart-1", "--radius"]) {
        expect(block[owned]).toBeUndefined();
      }
    }
  });

  describe.each(LIGHT_TONES.filter((x) => x.id !== DEFAULT_LIGHT_TONE).map((t) => t.id))("%s meets WCAG AA", (id) => {
    const AA = 4.5;
    const tone = (): Record<string, Hsl> => tokens(screenBlock(), `[data-light-tone="${id}"]:not(.dark)`);
    const palette = (pid: string): Record<string, Hsl> => tokens(readSource("src/app/palette.css"), `[data-palette="${pid}"]:not(.dark)`);
    const rusticOnTone = (): Record<string, Hsl> => tokens(screenBlock(), `[data-palette="rustic"][data-light-tone="beige"]:not(.dark),\n  [data-palette="rustic"][data-light-tone="grey"]:not(.dark)`);

    it("body and muted text on the ground, cards, popovers and muted surfaces", () => {
      const t = tone();
      for (const surface of ["--background", "--card", "--popover", "--muted", "--secondary", "--accent"]) {
        expect(contrast(t["--foreground"], t[surface])).toBeGreaterThanOrEqual(AA);
        expect(contrast(t["--muted-foreground"], t[surface])).toBeGreaterThanOrEqual(AA);
      }
      expect(contrast(t["--card-foreground"], t["--card"])).toBeGreaterThanOrEqual(AA);
      expect(contrast(t["--popover-foreground"], t["--popover"])).toBeGreaterThanOrEqual(AA);
    });

    it("destructive text on the ground, and white on a destructive button", () => {
      const t = tone();
      expect(contrast(t["--destructive"], t["--background"])).toBeGreaterThanOrEqual(AA);
      expect(contrast(t["--destructive"], t["--muted"])).toBeGreaterThanOrEqual(AA);
      expect(contrast(t["--destructive-foreground"], t["--destructive"])).toBeGreaterThanOrEqual(AA);
    });

    it("each palette's accent, as text on the tone and under its button label", () => {
      const t = tone();
      const gaia = palette("gaia");
      const rustic = { ...palette("rustic"), ...rusticOnTone() };
      for (const p of [gaia, rustic]) {
        for (const surface of ["--background", "--card", "--muted"]) {
          expect(contrast(p["--primary"], t[surface])).toBeGreaterThanOrEqual(AA);
        }
        expect(contrast(p["--accent-foreground"], t["--accent"])).toBeGreaterThanOrEqual(AA);
        expect(contrast(p["--primary-foreground"], p["--primary"])).toBeGreaterThanOrEqual(AA);
      }
    });

    it("borders are visible but quiet against the ground", () => {
      const t = tone();
      expect(contrast(t["--border"], t["--background"])).toBeGreaterThan(1.1);
      expect(contrast(t["--input"], t["--card"])).toBeGreaterThan(1.3);
    });
  });
});
