// CLIENT ITEMS 1 AND 2 — the floor's five colours, pinned.
//
//   1. WHICH STATE: printed beats running beats seated; a free table (the next
//      party's "12 #2" included) is green; an older server's row reads as before.
//   2. THE INKS ARE READABLE AND DISTINCT in every scheme the web draws: ink on
//      every card and ground at >= 4.5:1, and every pair of inks at a CIEDE2000
//      distance >= 12 — the two numbers the investigation measured (and the app
//      pins in its own appearance test).
//   3. globals.css CARRIES EXACTLY THESE INKS, per scheme — the CSS variables
//      are what the page paints, so a drift between the table and the
//      stylesheet would be a colour nobody tested.
//   4. The words, the legend, the "#2" badge and the printed chips.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    FLOOR_INKS,
    FLOOR_STATES,
    FLOOR_STATE_WORDS,
    PAPER_STALE_CHIP,
    floorChipStyle,
    floorInkVar,
    floorLegend,
    floorStateOf,
    floorTileStyle,
    hasOrderField,
    nextPartyBadge,
    printedClockLabel,
    printedTileChips,
} from '../floor-state';

// --- colour science, as the investigation measured it -----------------------
const rgb = (hex: string): [number, number, number] => {
    const h = hex.replace('#', '');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
};
const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string): number => {
    const [r, g, b] = rgb(hex).map(lin);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};
const lab = (hex: string): [number, number, number] => {
    const [r, g, b] = rgb(hex).map(lin);
    const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
};
const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;
/** CIEDE2000 (Sharma, Wu and Dalal's formulation). */
const deltaE2000 = (h1: string, h2: string): number => {
    const [L1, a1, b1] = lab(h1);
    const [L2, a2, b2] = lab(h2);
    const C1 = Math.hypot(a1, b1);
    const C2 = Math.hypot(a2, b2);
    const Cb = (C1 + C2) / 2;
    const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
    const a1p = (1 + G) * a1;
    const a2p = (1 + G) * a2;
    const C1p = Math.hypot(a1p, b1);
    const C2p = Math.hypot(a2p, b2);
    const h1p = (deg(Math.atan2(b1, a1p)) + 360) % 360;
    const h2p = (deg(Math.atan2(b2, a2p)) + 360) % 360;
    const dLp = L2 - L1;
    const dCp = C2p - C1p;
    let dh = h2p - h1p;
    if (C1p * C2p === 0) { dh = 0; } else if (dh > 180) { dh -= 360; } else if (dh < -180) { dh += 360; }
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dh / 2));
    const Lbp = (L1 + L2) / 2;
    const Cbp = (C1p + C2p) / 2;
    let hbp: number;
    if (C1p * C2p === 0) { hbp = h1p + h2p; } else if (Math.abs(h1p - h2p) <= 180) { hbp = (h1p + h2p) / 2; } else if (h1p + h2p < 360) { hbp = (h1p + h2p + 360) / 2; } else { hbp = (h1p + h2p - 360) / 2; }
    const T = 1 - 0.17 * Math.cos(rad(hbp - 30)) + 0.24 * Math.cos(rad(2 * hbp)) + 0.32 * Math.cos(rad(3 * hbp + 6)) - 0.2 * Math.cos(rad(4 * hbp - 63));
    const dth = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
    const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
    const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
    const Sc = 1 + 0.045 * Cbp;
    const Sh = 1 + 0.015 * Cbp * T;
    const Rt = -Math.sin(rad(2 * dth)) * Rc;
    return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
};

/** Every card AND ground each scheme puts a chip on (globals.css / palette.css). */
const SURFACES: Record<keyof typeof FLOOR_INKS, string[]> = {
    // stock .dark card/ground, Rustic Fork's card and ground, and the app's other dark schemes
    dark: ['#030712', '#1B1716', '#0C0A09', '#141A21', '#201D1B', '#101728', '#19191B'],
    gaia: ['#132320', '#0C1513'],
    // white, beige card and ground, soft grey card and ground
    light: ['#FFFFFF', '#FBF7EF', '#F5EFE3', '#F8F9FA', '#EEEFF1'],
};

describe('the colour science is the investigation\'s (sanity)', () => {
    it('reproduces its measured figures', () => {
        expect(contrast('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
        // palette_out.txt: Occupied~Seated in Rustic was 11.5; Reserved~Next party 0.
        expect(deltaE2000('#C9997A', '#D9A962')).toBeCloseTo(11.5, 0);
        expect(deltaE2000('#8FA3B8', '#8FA3B8')).toBe(0);
        expect(deltaE2000('#E2C458', '#B9B4A8')).toBeCloseTo(21.1, 0);
    });
});

describe.each(Object.keys(FLOOR_INKS) as (keyof typeof FLOOR_INKS)[])('the %s inks', (scheme) => {
    const inks = FLOOR_INKS[scheme];

    it('every ink reads at >= 4.5:1 on every card and ground of the scheme', () => {
        for (const [state, ink] of Object.entries(inks)) {
            for (const surface of SURFACES[scheme]) {
                const ratio = contrast(ink, surface);
                expect({ state, surface, ok: ratio >= 4.5 }).toEqual({ state, surface, ok: true });
            }
        }
    });

    it('every pair of inks is at least 12 apart (CIEDE2000) — Reserved and Next party were 0 on 2.0.1', () => {
        const entries = Object.entries(inks);
        for (let i = 0; i < entries.length; i += 1) {
            for (let j = i + 1; j < entries.length; j += 1) {
                const d = deltaE2000(entries[i][1], entries[j][1]);
                expect({ pair: `${entries[i][0]}~${entries[j][0]}`, ok: d >= 12 }).toEqual({ pair: `${entries[i][0]}~${entries[j][0]}`, ok: true });
            }
        }
    });

    it('free is green and printed is orange — the client\'s own two words', () => {
        const hue = (hex: string): number => {
            const [r, g, b] = rgb(hex);
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const d = max - min;
            const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
            return (h * 60 + 360) % 360;
        };
        expect(hue(inks.free)).toBeGreaterThanOrEqual(90);
        expect(hue(inks.free)).toBeLessThanOrEqual(150);
        expect(hue(inks.printed)).toBeGreaterThanOrEqual(15);
        expect(hue(inks.printed)).toBeLessThanOrEqual(40);
    });
});

describe('globals.css carries exactly these inks', () => {
    const css = readFileSync(join(__dirname, '..', '..', 'app', 'globals.css'), 'utf8').replace(/\r\n/g, '\n');
    const block = (selector: string): Record<string, string> => {
        // At the START of a line: ".dark" is also the tail of the Gaia selector.
        const at = css.lastIndexOf(`\n${selector} {\n  --floor-free`);
        expect({ selector, found: at > -1 }).toEqual({ selector, found: true });
        const body = css.slice(at, css.indexOf('}', at));
        const out: Record<string, string> = {};
        for (const m of body.matchAll(/--floor-([a-z-]+):\s*(#[0-9A-Fa-f]{6});/g)) { out[m[1]] = m[2].toUpperCase(); }
        return out;
    };
    const asCss = (inks: Record<string, string>): Record<string, string> => ({
        free: inks.free, seated: inks.seated, running: inks.running, printed: inks.printed, reserved: inks.reserved, 'next-party': inks.nextParty,
    });

    it.each([
        [':root', 'light'],
        ['.dark', 'dark'],
        ['[data-palette="gaia"].dark', 'gaia'],
    ] as const)('%s is the %s table', (selector, scheme) => {
        expect(block(selector)).toEqual(asCss(FLOOR_INKS[scheme]));
    });

    it('has_order is carried only as the server\'s boolean', () => {
        expect(hasOrderField({ has_order: true })).toEqual({ has_order: true });
        expect(hasOrderField({ has_order: false })).toEqual({ has_order: false });
        for (const row of [{}, { has_order: 'true' }, null, 'x']) { expect(hasOrderField(row)).toEqual({}); }
    });

    it('the styles read those variables, and a chip sits on the opaque card', () => {
        expect(floorInkVar('printed')).toBe('var(--floor-printed)');
        expect(floorInkVar('nextParty')).toBe('var(--floor-next-party)');
        expect(floorChipStyle('free')).toEqual({ color: 'var(--floor-free)', borderColor: 'var(--floor-free)', backgroundColor: 'hsl(var(--card))' });
        expect(floorTileStyle('printed')).toEqual({
            borderColor: 'var(--floor-printed)',
            backgroundColor: 'color-mix(in srgb, var(--floor-printed) 16%, transparent)',
        });
    });
});

describe('floorStateOf — one state per tile', () => {
    it.each([
        // occupied, hasOrder, printed, reserved -> state
        [false, false, false, false, 'free'],
        [false, null, false, true, 'reserved'],
        [true, false, false, false, 'seated'],
        [true, true, false, false, 'running'],
        [true, null, false, false, 'running'],   // an older server: seated reads as it always did
        [true, true, true, false, 'printed'],
        [true, false, true, true, 'printed'],     // printed beats everything
        [false, true, true, false, 'printed'],    // a QR order on an unseated, printed table
        [false, true, false, false, 'running'],
        [false, false, true, false, 'free'],      // a stale print on an empty table is not a bill
        [true, true, false, true, 'running'],     // a party in the chair beats the booking
    ] as const)('occupied %p, ordered %p, printed %p, reserved %p -> %p', (occupied, hasOrder, printed, reserved, state) => {
        expect(floorStateOf({ occupied, hasOrder, printed, reserved })).toBe(state);
    });

    it('the words are the app\'s', () => {
        expect(FLOOR_STATE_WORDS).toEqual({ free: 'Free', seated: 'Seated', running: 'Running', printed: 'Bill printed', reserved: 'Reserved' });
        expect(FLOOR_STATES).toEqual(['running', 'printed', 'seated', 'reserved', 'free']);
        expect(PAPER_STALE_CHIP).toBe('Updated — print again');
    });
});

describe('the legend, the badge and the printed chips', () => {
    it('a senior reads counts, busiest first, empty states left out', () => {
        expect(floorLegend(['free', 'printed', 'running', 'printed', 'free', 'free'], true).map((r) => r.label))
            .toEqual(['1 Running', '2 Bill printed', '3 Free']);
    });

    it('a waiter reads the key, every state, no counts', () => {
        expect(floorLegend(['free'], false).map((r) => r.label)).toEqual(['Running', 'Bill printed', 'Seated', 'Reserved', 'Free']);
    });

    it('the next party reads "#2"; nothing for a room table', () => {
        expect(nextPartyBadge(2)).toBe('#2');
        expect(nextPartyBadge(13)).toBe('#13');
        for (const n of [null, undefined, 1, 0, 2.5]) { expect(nextPartyBadge(n)).toBeNull(); }
    });

    it('printed chips: the time, then "Updated — print again", then "Printed as"', () => {
        expect(printedTileChips({ printedClock: '13:32', paperStale: true, printedAs: '12' }))
            .toEqual(['Printed 13:32', 'Updated — print again', 'Printed as 12']);
        expect(printedTileChips({ printedClock: '', paperStale: null, printedAs: null })).toEqual(['Printed']);
        expect(printedTileChips({ printedClock: '13:32', paperStale: false })).toEqual(['Printed 13:32']);
    });

    it('the clock is the restaurant\'s, with the date only on another day — the backend\'s billPrintedClock', () => {
        const now = new Date('2026-09-16T12:00:00.000Z');
        expect(printedClockLabel('2026-09-16T08:02:00.000Z', 'Asia/Kolkata', now)).toBe('13:32');
        expect(printedClockLabel('2026-09-15T08:02:00.000Z', 'Asia/Kolkata', now)).toBe('15/09 13:32');
        expect(printedClockLabel('2026-09-15T19:00:00.000Z', 'Asia/Kolkata', now)).toBe('00:30');
        expect(printedClockLabel('2026-09-16T08:02:00.000Z', 'Not/AZone', now)).toBe('13:32');
        expect(printedClockLabel(null, 'Asia/Kolkata', now)).toBe('');
        expect(printedClockLabel('garbage', 'Asia/Kolkata', now)).toBe('');
    });
});
