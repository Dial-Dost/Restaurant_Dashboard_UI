// Generates the palette.css additions: HSL triples, composites, dark accent
// blocks, derived light accent blocks (port of AppLightPalettes.accentFor),
// and shell-scheme blocks. Output is ready-to-paste CSS.

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex([r, g, b]) {
  const c = (v) => Math.round(v).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s, l];
}
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb;
  if (h < 60) {rgb = [c, x, 0];}
  else if (h < 120) {rgb = [x, c, 0];}
  else if (h < 180) {rgb = [0, c, x];}
  else if (h < 240) {rgb = [0, x, c];}
  else if (h < 300) {rgb = [x, 0, c];}
  else {rgb = [c, 0, x];}
  return rgb.map((v) => (v + m) * 255);
}
function triple(hex) {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  const f = (v, d) => {
    const r = Number(v.toFixed(d));
    return String(r);
  };
  return `${f(h, 1)} ${f(s * 100, 1)}% ${f(l * 100, 1)}%`;
}
function tripleRgb(rgb) {
  const [h, s, l] = rgbToHsl(rgb);
  return `${Number(h.toFixed(1))} ${Number((s * 100).toFixed(1))}% ${Number((l * 100).toFixed(1))}%`;
}
// WCAG
function relLum([r, g, b]) {
  const chan = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}
function contrast(a, b) {
  const la = relLum(a), lb = relLum(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
function blend(tint, alpha, ground) {
  // Match Flutter Color.alphaBlend byte rounding: probe rounds to display bytes.
  return tint.map((t, i) => Math.round(alpha * t + (1 - alpha) * ground[i]));
}
function composite(hexTint, alpha, hexGround) {
  return rgbToHex(blend(hexToRgb(hexTint), alpha, hexToRgb(hexGround)));
}

// ── Accents (appearance.dart AppAccents) ─────────────────────────────
const ACCENTS = {
  copper:  { hi: '#E3B89B', base: '#C9997A', mid: '#A9795C', deep: '#7D5B47', shadow: '#4E3928', on: '#221510', glowBright: '#C2410C', glowMid: '#9A3412', glowDeep: '#7C2D12' },
  brass:   { hi: '#E5D29A', base: '#CBB676', mid: '#B79C4E', deep: '#8A773D', shadow: '#544927', on: '#221E11', glowBright: '#C0930C', glowMid: '#977611', glowDeep: '#785E12' },
  sage:    { hi: '#BBDBA3', base: '#9CBD84', mid: '#7CA460', deep: '#5F7B4C', shadow: '#3B4B30', on: '#191F14', glowBright: '#57C00C', glowMid: '#499711', glowDeep: '#3C7812' },
  teal:    { hi: '#A1DED9', base: '#81C1BB', mid: '#5BA9A2', deep: '#487F7B', shadow: '#2D4D4A', on: '#13201F', glowBright: '#0CC0B1', glowMid: '#11978C', glowDeep: '#12786F' },
  steel:   { hi: '#9EBFE0', base: '#7DA1C5', mid: '#5682AE', deep: '#446383', shadow: '#2B3D50', on: '#121921', glowBright: '#0C66C0', glowMid: '#115497', glowDeep: '#124578' },
  lavender:{ hi: '#B39FDF', base: '#937FC3', mid: '#7259AB', deep: '#584681', shadow: '#362C4E', on: '#171320', glowBright: '#420CC0', glowMid: '#391197', glowDeep: '#301278' },
  rose:    { hi: '#E09EB4', base: '#C57D95', mid: '#AE5673', deep: '#834459', shadow: '#502B37', on: '#211217', glowBright: '#C00C48', glowMid: '#97113E', glowDeep: '#781234' },
  ember:   { hi: '#EBA593', base: '#D5826D', mid: '#C35B41', deep: '#944633', shadow: '#5A2C20', on: '#25130E', glowBright: '#C0300C', glowMid: '#972C11', glowDeep: '#782612' },
};

// ── Shell schemes (appearance.dart AppSchemes) ───────────────────────
const SCHEMES = {
  slate:    { bg: '#090B0E', bgDeep: '#050708', surface: '#10141A', card: '#141A21', cardTop: '#182028', cardBottom: '#11161C', cardRaised: '#1D2530', inset: '#0C1015', text: '#E8ECF1', text2: '#97A1AE', text3: '#5C6570' },
  charcoal: { bg: '#121110', bgDeep: '#0C0B0A', surface: '#1A1817', card: '#201D1B', cardTop: '#252220', cardBottom: '#1B1917', cardRaised: '#2A2624', inset: '#161413', text: '#EFEDEA', text2: '#A5A19A', text3: '#6A665F' },
  midnight: { bg: '#070A14', bgDeep: '#04060D', surface: '#0D1220', card: '#101728', cardTop: '#131B2E', cardBottom: '#0E1421', cardRaised: '#16203A', inset: '#0A0E1A', text: '#E7EBF4', text2: '#93A0B8', text3: '#57627A' },
  graphite: { bg: '#0B0B0C', bgDeep: '#070708', surface: '#131315', card: '#19191B', cardTop: '#1E1E20', cardBottom: '#161618', cardRaised: '#232326', inset: '#0F0F10', text: '#EBEBEC', text2: '#9B9B9E', text3: '#616163' },
};

// ── Light tones' darkest grounds (AppLightPalettes) ──────────────────
const TONES = { white: '#F3F4F6', beige: '#ECE3D2', grey: '#E3E5E8' };

// AppLightPalettes.accentFor, ported exactly.
function accentForLight(accent, darkestHex) {
  const darkest = hexToRgb(darkestHex);
  const [h, s0] = rgbToHsl(hexToRgb(accent.base));
  const sat = Math.min(Math.max(s0 * 1.15, 0.30), 0.70);
  const at = (l) => hslToRgb(h, sat, l).map(Math.round);
  const stop = (target) => {
    let lo = 0.0, hi = 1.0;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (contrast(at(mid), darkest) >= target) {lo = mid;} else {hi = mid;}
    }
    return at(lo);
  };
  const tint = (l, s) => hslToRgb(h, s, l).map(Math.round);
  return {
    hi: stop(7.0), base: stop(5.2), mid: stop(4.6), deep: stop(3.0), shadow: stop(1.6),
    on: [255, 255, 255],
    glowBright: tint(0.74, 0.80), glowMid: tint(0.82, 0.70), glowDeep: tint(0.88, 0.60),
  };
}

const out = [];
const t = (hex) => triple(hex);

if (process.argv[2] === 'emit') {
  emit();
  process.exit(0);
}

function emit() {
  const o = [];
  o.push(`/* ===========================================================================
   APPEARANCE AXES — accent ramps and shell schemes, transcribed + derived
   from restaurant_owner_app/lib/ui/theme/appearance.dart.
   ===========================================================================

   GENERATED FILE — do not hand-edit values. Regenerate with the script kept in
   the parity notes (docs/parity/COMPONENTS.md > Appearance axes): every dark
   stop is the Dart constant converted to an H S% L% triple, and every light
   block is AppLightPalettes.accentFor ported bit-for-bit (saturation *1.15
   clamped 0.30..0.70, 24-step binary search for the largest lightness whose
   stop still clears its WCAG target — hi 7.0, base 5.2, mid 4.6, deep 3.0,
   shadow 1.6 — against the tone's darkest ground; glow trio = pale tints at
   L .74/.82/.88, S .80/.70/.60). In light mode the ramp keeps its meaning and
   flips direction: hi is the darkest stop, a filled control's ink is white.

   AXES AND COMPOSITION (same rules as the app):
   - data-accent composes with any dark scheme; the ramp is ground-independent.
   - data-scheme applies only while dark ([data-palette="rustic"].dark);
     while a light tone or Gaia is painted the choice is remembered on the
     attribute but these rules do not match — exactly "remembered, not applied".
   - Gaia pins its own champagne ramp and forest glow in palette.css; nothing
     here matches under [data-palette="gaia"].
   =========================================================================== */
`);
  // Dark accent blocks
  o.push('/* ── ACCENTS, DARK (AppAccents — every hi/base stop AA on near-black) ── */');
  for (const [id, a] of Object.entries(ACCENTS)) {
    o.push(`[data-palette="rustic"][data-accent="${id}"].dark {`);
    o.push(`  --primary: ${t(a.base)}; /* ${a.base} */`);
    o.push(`  --primary-foreground: ${t(a.on)}; /* ${a.on} */`);
    o.push(`  --ring: ${t(a.base)};`);
    o.push(`  --accent-foreground: ${t(a.hi)}; /* ${a.hi} */`);
    o.push(`  --accent-hi: ${t(a.hi)};`);
    o.push(`  --accent-base: ${t(a.base)};`);
    o.push(`  --accent-mid: ${t(a.mid)}; /* ${a.mid} */`);
    o.push(`  --accent-deep: ${t(a.deep)}; /* ${a.deep} */`);
    o.push(`  --accent-shadow: ${t(a.shadow)}; /* ${a.shadow} */`);
    o.push(`  --accent-on: ${t(a.on)};`);
    o.push(`  --glow-bright: ${t(a.glowBright)}; /* ${a.glowBright} */`);
    o.push(`  --glow-mid: ${t(a.glowMid)}; /* ${a.glowMid} */`);
    o.push(`  --glow-deep: ${t(a.glowDeep)}; /* ${a.glowDeep} */`);
    o.push(`  --chart-1: ${t(a.hi)};`);
    o.push(`  --chart-2: ${t(a.base)};`);
    o.push(`  --chart-3: ${t(a.mid)};`);
    o.push(`  --chart-4: ${t(a.deep)};`);
    o.push(`  --chart-5: ${t(a.shadow)};`);
    o.push(`}`);
  }
  o.push('');
  o.push('/* ── ACCENTS, LIGHT (derived per tone; hi = darkest, on-accent ink = white) ── */');
  for (const [id, a] of Object.entries(ACCENTS)) {
    for (const [tone, darkest] of Object.entries(TONES)) {
      const d = accentForLight(a, darkest);
      const tt = (rgb) => tripleRgb(rgb);
      o.push(`[data-palette="rustic"][data-accent="${id}"][data-light-tone="${tone}"]:not(.dark) {`);
      o.push(`  --primary: ${tt(d.base)}; /* ${rgbToHex(d.base)} */`);
      o.push(`  --primary-foreground: 0 0% 100%;`);
      o.push(`  --ring: ${tt(d.base)};`);
      o.push(`  --accent-foreground: ${tt(d.hi)}; /* ${rgbToHex(d.hi)} */`);
      o.push(`  --accent-hi: ${tt(d.hi)};`);
      o.push(`  --accent-base: ${tt(d.base)};`);
      o.push(`  --accent-mid: ${tt(d.mid)}; /* ${rgbToHex(d.mid)} */`);
      o.push(`  --accent-deep: ${tt(d.deep)}; /* ${rgbToHex(d.deep)} */`);
      o.push(`  --accent-shadow: ${tt(d.shadow)}; /* ${rgbToHex(d.shadow)} */`);
      o.push(`  --accent-on: 0 0% 100%;`);
      o.push(`  --glow-bright: ${tt(d.glowBright)}; /* ${rgbToHex(d.glowBright)} */`);
      o.push(`  --glow-mid: ${tt(d.glowMid)}; /* ${rgbToHex(d.glowMid)} */`);
      o.push(`  --glow-deep: ${tt(d.glowDeep)}; /* ${rgbToHex(d.glowDeep)} */`);
      o.push(`  --chart-1: ${tt(d.hi)};`);
      o.push(`  --chart-2: ${tt(d.base)};`);
      o.push(`  --chart-3: ${tt(d.mid)};`);
      o.push(`  --chart-4: ${tt(d.deep)};`);
      o.push(`  --chart-5: ${tt(d.shadow)};`);
      o.push(`}`);
    }
  }
  o.push('');
  o.push('/* ── SHELL SCHEMES (AppSchemes — dark only; light tones and Gaia pin the shell) ── */');
  for (const [id, s] of Object.entries(SCHEMES)) {
    o.push(`[data-palette="rustic"][data-scheme="${id}"].dark {`);
    o.push(`  --background: ${t(s.bg)}; /* ${s.bg} */`);
    o.push(`  --background-deep: ${t(s.bgDeep)}; /* ${s.bgDeep} */`);
    o.push(`  --foreground: ${t(s.text)}; /* ${s.text} */`);
    o.push(`  --card: ${t(s.card)}; /* ${s.card} */`);
    o.push(`  --card-foreground: ${t(s.text)};`);
    o.push(`  --card-top: ${t(s.cardTop)}; /* ${s.cardTop} */`);
    o.push(`  --card-bottom: ${t(s.cardBottom)}; /* ${s.cardBottom} */`);
    o.push(`  --popover: ${t(s.cardRaised)}; /* ${s.cardRaised} */`);
    o.push(`  --popover-foreground: ${t(s.text)};`);
    o.push(`  --secondary: ${t(s.surface)}; /* ${s.surface} */`);
    o.push(`  --secondary-foreground: ${t(s.text)};`);
    o.push(`  --muted: ${t(s.surface)};`);
    o.push(`  --muted-foreground: ${t(s.text2)}; /* ${s.text2} */`);
    o.push(`  --accent: ${t(s.cardRaised)};`);
    o.push(`  --inset: ${t(s.inset)}; /* ${s.inset} */`);
    o.push(`  --text-tertiary: ${t(s.text3)}; /* ${s.text3} */`);
    o.push(`  --border: ${t(composite('#FFFFFF', 0.07, s.bg))}; /* 7% white over ${s.bg} */`);
    o.push(`  --input: ${t(composite('#FFFFFF', 0.12, s.bg))}; /* 12% white */`);
    o.push(`  --divider: ${t(composite('#FFFFFF', 0.05, s.bg))}; /* 5% white */`);
    o.push(`  --sidebar-background: ${t(s.bg)};`);
    o.push(`  --sidebar-foreground: ${t(s.text)};`);
    o.push(`  --sidebar-accent: ${t(s.cardRaised)};`);
    o.push(`  --sidebar-accent-foreground: ${t(s.text)};`);
    o.push(`}`);
  }
  console.log(o.join('\n'));
}

// 1. Composites
out.push('/* composites over grounds */');
out.push(`rustic divider (5% white over #0C0A09): ${composite('#FFFFFF', 0.05, '#0C0A09')} -> ${t(composite('#FFFFFF', 0.05, '#0C0A09'))}`);
out.push(`gaia divider (5% white over #0C1513): ${composite('#FFFFFF', 0.05, '#0C1513')} -> ${t(composite('#FFFFFF', 0.05, '#0C1513'))}`);
for (const [id, s] of Object.entries(SCHEMES)) {
  out.push(`${id} border 7%: ${t(composite('#FFFFFF', 0.07, s.bg))}  input 12%: ${t(composite('#FFFFFF', 0.12, s.bg))}  divider 5%: ${t(composite('#FFFFFF', 0.05, s.bg))}`);
}

// 2. Plain triples needed
out.push('\n/* fixed triples */');
const FIXED = {
  'rustic bgDeep #080605': '#080605', 'rustic cardTop #201B1A': '#201B1A', 'rustic cardBottom #181412': '#181412',
  'rustic inset #110E0D': '#110E0D', 'rustic text3 #615E57': '#615E57',
  'success #8FB27C': '#8FB27C', 'warning #D9A962': '#D9A962', 'info #8FA3B8': '#8FA3B8', 'neutral #9A978F': '#9A978F',
  'gaia bgDeep #050807': '#050807', 'gaia inset #0E1A17': '#0E1A17', 'gaia text3AA #95907C': '#95907C',
  'gaia success #9BC4A0': '#9BC4A0', 'gaia warning #D9B06A': '#D9B06A', 'gaia info #8FB0D0': '#8FB0D0', 'gaia neutral #B3AC99': '#B3AC99',
  'white bgDeep/inset #F3F4F6': '#F3F4F6', 'white text3 #6B7280': '#6B7280', 'white mutedfg fix #4B5563': '#4B5563',
  'light success #2B6326': '#2B6326', 'white warning #8A5A00': '#8A5A00', 'light info #36648A': '#36648A', 'white neutral #5F6670': '#5F6670',
  'light danger #C32222': '#C32222',
  'beige bgDeep/inset #ECE3D2': '#ECE3D2', 'beige text3 #8C7B69': '#8C7B69', 'beige divider #E6DCC9': '#E6DCC9',
  'beige warning #805300': '#805300', 'beige neutral #625649': '#625649',
  'grey bgDeep/inset #E3E5E8': '#E3E5E8', 'grey text3 #7D838C': '#7D838C', 'grey divider #E8E9EC': '#E8E9EC',
  'grey neutral #575D66': '#575D66',
};
for (const [k, v] of Object.entries(FIXED)) {out.push(`${k}: ${t(v)}`);}

// 3. Dark accent blocks (skip copper: baked into the base rustic block, but emit for reference)
out.push('\n/* ── DARK ACCENT BLOCKS ── */');
for (const [id, a] of Object.entries(ACCENTS)) {
  out.push(`/* ${id} */`);
  out.push(`[data-palette="rustic"][data-accent="${id}"].dark {`);
  out.push(`  --primary: ${t(a.base)};              /* ${a.base} */`);
  out.push(`  --primary-foreground: ${t(a.on)};     /* ${a.on} */`);
  out.push(`  --ring: ${t(a.base)};`);
  out.push(`  --accent-foreground: ${t(a.hi)};      /* ${a.hi} */`);
  out.push(`  --accent-hi: ${t(a.hi)};`);
  out.push(`  --accent-base: ${t(a.base)};`);
  out.push(`  --accent-mid: ${t(a.mid)};            /* ${a.mid} */`);
  out.push(`  --accent-deep: ${t(a.deep)};          /* ${a.deep} */`);
  out.push(`  --accent-shadow: ${t(a.shadow)};      /* ${a.shadow} */`);
  out.push(`  --accent-on: ${t(a.on)};`);
  out.push(`  --glow-bright: ${t(a.glowBright)};    /* ${a.glowBright} */`);
  out.push(`  --glow-mid: ${t(a.glowMid)};          /* ${a.glowMid} */`);
  out.push(`  --glow-deep: ${t(a.glowDeep)};        /* ${a.glowDeep} */`);
  out.push(`  --chart-1: ${t(a.hi)}; --chart-2: ${t(a.base)}; --chart-3: ${t(a.mid)}; --chart-4: ${t(a.deep)}; --chart-5: ${t(a.shadow)};`);
  out.push(`}`);
}

// 4. Light accent blocks (8 accents x 3 tones, derived)
out.push('\n/* ── LIGHT ACCENT BLOCKS (derived per AppLightPalettes.accentFor) ── */');
for (const [id, a] of Object.entries(ACCENTS)) {
  for (const [tone, darkest] of Object.entries(TONES)) {
    const d = accentForLight(a, darkest);
    const tt = (rgb) => tripleRgb(rgb);
    out.push(`[data-palette="rustic"][data-accent="${id}"][data-light-tone="${tone}"]:not(.dark) {`);
    out.push(`  --primary: ${tt(d.base)};           /* ${rgbToHex(d.base)} */`);
    out.push(`  --primary-foreground: 0 0% 100%;`);
    out.push(`  --ring: ${tt(d.base)};`);
    out.push(`  --accent-foreground: ${tt(d.hi)};   /* ${rgbToHex(d.hi)} */`);
    out.push(`  --accent-hi: ${tt(d.hi)};`);
    out.push(`  --accent-base: ${tt(d.base)};`);
    out.push(`  --accent-mid: ${tt(d.mid)};         /* ${rgbToHex(d.mid)} */`);
    out.push(`  --accent-deep: ${tt(d.deep)};       /* ${rgbToHex(d.deep)} */`);
    out.push(`  --accent-shadow: ${tt(d.shadow)};   /* ${rgbToHex(d.shadow)} */`);
    out.push(`  --accent-on: 0 0% 100%;`);
    out.push(`  --glow-bright: ${tt(d.glowBright)}; /* ${rgbToHex(d.glowBright)} */`);
    out.push(`  --glow-mid: ${tt(d.glowMid)};       /* ${rgbToHex(d.glowMid)} */`);
    out.push(`  --glow-deep: ${tt(d.glowDeep)};     /* ${rgbToHex(d.glowDeep)} */`);
    out.push(`  --chart-1: ${tt(d.hi)}; --chart-2: ${tt(d.base)}; --chart-3: ${tt(d.mid)}; --chart-4: ${tt(d.deep)}; --chart-5: ${tt(d.shadow)};`);
    out.push(`}`);
  }
}

// 5. Scheme blocks
out.push('\n/* ── SHELL SCHEME BLOCKS ── */');
for (const [id, s] of Object.entries(SCHEMES)) {
  out.push(`[data-palette="rustic"][data-scheme="${id}"].dark {`);
  out.push(`  --background: ${t(s.bg)};             /* ${s.bg} */`);
  out.push(`  --background-deep: ${t(s.bgDeep)};    /* ${s.bgDeep} */`);
  out.push(`  --foreground: ${t(s.text)};           /* ${s.text} */`);
  out.push(`  --card: ${t(s.card)};                 /* ${s.card} */`);
  out.push(`  --card-foreground: ${t(s.text)};`);
  out.push(`  --card-top: ${t(s.cardTop)};          /* ${s.cardTop} */`);
  out.push(`  --card-bottom: ${t(s.cardBottom)};    /* ${s.cardBottom} */`);
  out.push(`  --popover: ${t(s.cardRaised)};        /* ${s.cardRaised} */`);
  out.push(`  --popover-foreground: ${t(s.text)};`);
  out.push(`  --secondary: ${t(s.surface)};         /* ${s.surface} */`);
  out.push(`  --secondary-foreground: ${t(s.text)};`);
  out.push(`  --muted: ${t(s.surface)};`);
  out.push(`  --muted-foreground: ${t(s.text2)};    /* ${s.text2} */`);
  out.push(`  --accent: ${t(s.cardRaised)};`);
  out.push(`  --inset: ${t(s.inset)};               /* ${s.inset} */`);
  out.push(`  --text-tertiary: ${t(s.text3)};       /* ${s.text3} */`);
  out.push(`  --border: ${t(composite('#FFFFFF', 0.07, s.bg))};   /* 7% white over ${s.bg} */`);
  out.push(`  --input: ${t(composite('#FFFFFF', 0.12, s.bg))};    /* 12% */`);
  out.push(`  --divider: ${t(composite('#FFFFFF', 0.05, s.bg))};  /* 5% */`);
  out.push(`  --sidebar-background: ${t(s.bg)};`);
  out.push(`  --sidebar-foreground: ${t(s.text)};`);
  out.push(`  --sidebar-accent: ${t(s.cardRaised)};`);
  out.push(`  --sidebar-accent-foreground: ${t(s.text)};`);
  out.push(`}`);
}

console.log(out.join('\n'));
