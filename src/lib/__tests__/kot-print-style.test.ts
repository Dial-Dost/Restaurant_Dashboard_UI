// THE SETTINGS CONTROL THAT PUTS A KITCHEN BACK ON THE TEXT DOCKET.
//
// The reference kitchen docket is drawn as a raster image; a thermal printer
// that cannot draw one answers it with BLANK PAPER rather than an error, and on
// a kitchen printer that is an order nobody cooks while every screen says the
// order is fine. No printer model is on record for this estate, so the switch on
// this screen is the recovery path — pressed by an owner standing at a printer
// that is not printing.
//
// That is what makes the cases below worth having. Each is a way this card could
// fail while looking fine:
//
//   * a backend that does not send the key (an older one, or one whose column
//     migration 050 has not created yet) must render as the REFERENCE docket —
//     showing "classic" there would tell an owner their kitchen is already on
//     the fallback when it is not;
//   * the save must send the one key the backend accepts, and must RAISE when it
//     fails rather than leaving the card showing the choice that was refused;
//   * the card has to actually be on the Settings screen, gated on the
//     permission the POST requires;
//   * the help sentence has to tell somebody what to DO about a blank ticket.
//
// The words are pinned because they are the product here: this control is one
// radio group, and everything an owner learns from it is copy.

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
    KOT_PRINT_STYLE_DEFAULT,
    KOT_PRINT_STYLE_HELP,
    KOT_PRINT_STYLE_OPTIONS,
    isKotPrintStyle,
    readKotPrintStyle,
} from '../kot-print-style';

function readSource(relative: string): string {
    for (const base of [process.cwd(), path.join(__dirname, '..', '..', '..')]) {
        const full = path.join(base, relative);
        // A fixed list of this repo's own source files, not user input.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        if (fs.existsSync(full)) { return fs.readFileSync(full, 'utf8'); }
    }
    throw new Error(`readSource could not find ${relative} from ${process.cwd()}`);
}

/** Source with comments removed, so a pin reads the CODE rather than the prose beside it. */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('reading the setting out of /restaurant/settings', () => {
    it('a document that does not mention it is the reference docket', () => {
        // The deploy window, and an older backend. Both only ever print the
        // reference docket, so that is what the card must show.
        expect(readKotPrintStyle({})).toBe('reference');
        expect(readKotPrintStyle({ currency: '₹' })).toBe('reference');
        expect(readKotPrintStyle(null)).toBe('reference');
        expect(readKotPrintStyle(undefined)).toBe('reference');
        expect(KOT_PRINT_STYLE_DEFAULT).toBe('reference');
    });

    it('reads either style', () => {
        expect(readKotPrintStyle({ kot_print_style: 'classic' })).toBe('classic');
        expect(readKotPrintStyle({ kot_print_style: 'reference' })).toBe('reference');
    });

    it('a value this dashboard does not know is the default, not a blank control', () => {
        // A newer backend, or a value put in the column by hand. The radio has to
        // land on something, and the honest something is what an unconfigured
        // restaurant gets.
        for (const value of [null, '', 'raster', 'Classic', 7, true, {}]) {
            expect(readKotPrintStyle({ kot_print_style: value })).toBe('reference');
        }
    });

    it('only the two exact values the backend will accept are styles', () => {
        // The backend 400s anything else rather than coercing it, so a client
        // that thought " classic " was fine would produce a failed save with a
        // sentence the owner cannot act on.
        expect(isKotPrintStyle('reference')).toBe(true);
        expect(isKotPrintStyle('classic')).toBe(true);
        for (const value of [' classic', 'CLASSIC', '', null, undefined, 0, {}]) {
            expect(isKotPrintStyle(value)).toBe(false);
        }
    });
});

describe('what the control says', () => {
    it('offers exactly the two choices, recommended one first', () => {
        expect(KOT_PRINT_STYLE_OPTIONS.map((o) => o.value)).toEqual(['reference', 'classic']);
        expect(KOT_PRINT_STYLE_OPTIONS[0]!.label).toContain('recommended');
    });

    it('names each choice in words rather than in the stored token', () => {
        // "reference" and "classic" are column values. An owner reads the screen.
        for (const option of KOT_PRINT_STYLE_OPTIONS) {
            expect(option.label.length).toBeGreaterThan(10);
            expect(option.label).not.toBe(option.value);
            expect(option.detail.length).toBeGreaterThan(10);
        }
        expect(KOT_PRINT_STYLE_OPTIONS[1]!.label.toLowerCase()).toContain('classic');
    });

    it('the help text says it is an image, that almost every printer handles it, and what to do about a blank ticket', () => {
        // The three things, and no more. Whoever reads this is standing at a
        // printer; the sentence has to end in an instruction.
        expect(KOT_PRINT_STYLE_HELP).toMatch(/image/i);
        expect(KOT_PRINT_STYLE_HELP).toMatch(/almost every thermal printer/i);
        expect(KOT_PRINT_STYLE_HELP).toMatch(/blank/i);
        expect(KOT_PRINT_STYLE_HELP).toMatch(/switch back/i);
        expect(KOT_PRINT_STYLE_HELP).toMatch(/next KOT/i);
    });
});

describe('the save goes through the settings document, and the card is wired to it', () => {
    const db = code(readSource('src/lib/db.ts'));
    const card = code(readSource('src/app/dashboard/settings/kot-print-settings.tsx'));
    const form = code(readSource('src/app/dashboard/settings/settings-form.tsx'));

    it('writes the one key POST /restaurant/settings accepts — no new route', () => {
        expect(db).toContain("JSON.stringify({ kot_print_style: style })");
        expect(db).toContain("backendCall('/restaurant/settings', restaurantId, {");
    });

    it('a refused save raises instead of leaving the card on the choice that failed', () => {
        // The backend 400s a value it does not know. A card that swallowed that
        // would show "Classic text docket" selected while the kitchen is still
        // being sent the raster one.
        expect(db).toMatch(/if \(!res\?\.ok\) \{throw new Error\(res \? await readErrorMessage\(res\) : 'Unable to save the KOT print style'\);\}/);
        expect(card).toContain('setStyle(previous)');
    });

    it('the card reads and writes through db.ts rather than fetching for itself', () => {
        expect(card).toContain('getKotPrintStyle');
        expect(card).toContain('setKotPrintStyle');
    });

    it('the card is rendered on the Settings screen, gated on the settings permission', () => {
        // BUILT AND CALLED. A card nobody renders is the recovery path not
        // existing — which is indistinguishable, from the kitchen, from never
        // having built it.
        // The ELEMENT, not the import: a card that is imported and never
        // rendered is the recovery path not existing.
        expect(form).toContain('<KotPrintSettingsCard');
        // Bounded at this element's own closing `/>`, so the gate that satisfies
        // it cannot be the one on the card below.
        expect(form).toMatch(/<KotPrintSettingsCard(?:(?!\/>)[\s\S])*?canEdit=\{hasPermission\(user\.actions_set, PERM_SETTINGS\)\}/);
    });

    it('the card refuses to save for someone without the permission', () => {
        // The backend 403s them anyway; this is so the screen says why instead of
        // flipping the radio and then flipping it back.
        expect(card).toContain('if (!canEdit) {');
    });

    it('the copy on screen comes from the shared module, so these tests are pinning what is rendered', () => {
        expect(card).toContain('KOT_PRINT_STYLE_OPTIONS');
        expect(card).toContain('{KOT_PRINT_STYLE_HELP}');
    });
});
