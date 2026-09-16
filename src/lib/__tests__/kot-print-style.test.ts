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
//   * a backend that does not send the keys (the one live before them, or one
//     rolled back to it) prints ONLY the classic docket and ignores a save of
//     them — so the card is not shown against it, and a save it answered
//     without the key RAISES rather than confirming a change nothing stored;
//   * a value the dashboard does not know renders as the REFERENCE docket, the
//     default — never as classic, which would tell an owner their kitchen is
//     already on the fallback when it is not;
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
    KOT_DOCKET_NOT_SUPPORTED,
    KOT_PRINT_STYLE_DEFAULT,
    KOT_PRINT_STYLE_HELP,
    KOT_PRINT_STYLE_OPTIONS,
    KOT_TEXT_SIZES,
    KOT_TEXT_SIZE_CLASSIC_NOTE,
    KOT_TEXT_SIZE_DEFAULT,
    KOT_TEXT_SIZE_HELP,
    KOT_TEXT_SIZE_OPTIONS,
    isKotPrintStyle,
    isKotTextSize,
    kotDocketSettingsSupported,
    readKotDocketSettings,
    readKotPrintStyle,
    readKotTextSize,
    savedKotPrintStyle,
    savedKotTextSize,
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
    it('the reader is forgiving: a document that does not mention it reads as the default', () => {
        // The reader never throws and never lands on classic by accident. (A
        // document without the key is a backend WITHOUT the setting; the card
        // asks kotDocketSettingsSupported before it shows any of this.)
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
        expect(card).toContain('getKotDocketSettings(restaurantId)');
        expect(card).toContain('setKotPrintStyle(restaurantId, next)');
        expect(card).toContain('setKotTextSize(restaurantId, next)');
        expect(card).not.toMatch(/\bfetch\(/);
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
        // flipping the radio and then flipping it back. One refusal, shared by
        // both controls.
        expect(card).toMatch(/const refuseWithoutPermission = \(\): boolean => \{\s*if \(canEdit\) \{return false\}\s*toast\(/);
        expect(card).toMatch(/const handleChange = async[\s\S]*?if \(refuseWithoutPermission\(\)\) \{return\}/);
    });

    it('the copy on screen comes from the shared module, so these tests are pinning what is rendered', () => {
        expect(card).toContain('KOT_PRINT_STYLE_OPTIONS');
        expect(card).toContain('{KOT_PRINT_STYLE_HELP}');
    });
});

// ---------------------------------------------------------------------------
// KOT TEXT SIZE — the second control on the card.
//
// The client: "The font sizes must be smaller in the KOT." Standard is their
// reference ticket exactly; Small and Large are a step either side. What can go
// wrong while looking fine: a backend without the key showing a size it is not
// printing, a save that sends a word the backend refuses, a control that is
// imported and never rendered, and an owner on the classic docket being told
// nothing about why Small changed nothing.
// ---------------------------------------------------------------------------

describe('reading the text size out of /restaurant/settings', () => {
    it('a document that does not mention it is the standard size', () => {
        expect(readKotTextSize({})).toBe('standard');
        expect(readKotTextSize(null)).toBe('standard');
        expect(readKotTextSize({ kot_print_style: 'classic' })).toBe('standard');
        expect(KOT_TEXT_SIZE_DEFAULT).toBe('standard');
    });

    it('reads each of the three sizes, and nothing else', () => {
        for (const size of ['small', 'standard', 'large']) { expect(readKotTextSize({ kot_text_size: size })).toBe(size); }
        for (const value of [null, '', 'medium', 'Small', ' large', 24, true, {}]) {
            expect(readKotTextSize({ kot_text_size: value })).toBe('standard');
        }
    });

    it('only the three exact words the backend accepts are sizes, smallest first', () => {
        expect([...KOT_TEXT_SIZES]).toEqual(['small', 'standard', 'large']);
        for (const size of KOT_TEXT_SIZES) { expect(isKotTextSize(size)).toBe(true); }
        for (const value of ['SMALL', ' small', '', null, undefined, 1, {}]) { expect(isKotTextSize(value)).toBe(false); }
    });

    it('both settings come out of one document, with whether the backend has them', () => {
        expect(readKotDocketSettings({ kot_print_style: 'classic', kot_text_size: 'small' }))
            .toEqual({ style: 'classic', textSize: 'small', supported: true });
        expect(readKotDocketSettings({ kot_print_style: 'reference', kot_text_size: 'standard' }))
            .toEqual({ style: 'reference', textSize: 'standard', supported: true });
        expect(readKotDocketSettings({ currency: '₹' })).toEqual({ style: 'reference', textSize: 'standard', supported: false });
    });
});

// ---------------------------------------------------------------------------
// A BACKEND WITHOUT THE SETTINGS — the one live before them, or one rolled back
// to it. It sends neither key, prints ONLY the classic docket, and answers a
// save of either key with 200 and its settings document, having stored
// nothing. The card must neither describe a docket that kitchen does not get
// nor confirm a change that was not made. The owner app holds the same rules
// (restaurant_owner_app test/kot_docket_settings_test.dart).
// ---------------------------------------------------------------------------

describe('a backend that does not have the settings', () => {
    it('is recognised by its settings document lacking the keys — both must be there', () => {
        // This backend sends both even before migration 050 is applied by hand.
        expect(kotDocketSettingsSupported({ kot_print_style: 'reference', kot_text_size: 'standard' })).toBe(true);
        expect(kotDocketSettingsSupported({ kot_print_style: 'classic', kot_text_size: null })).toBe(true);
        expect(kotDocketSettingsSupported({})).toBe(false);
        expect(kotDocketSettingsSupported({ currency: '₹', kot_auto_print: true })).toBe(false);
        expect(kotDocketSettingsSupported({ kot_print_style: 'reference' })).toBe(false);
        expect(kotDocketSettingsSupported({ kot_text_size: 'small' })).toBe(false);
        for (const value of [null, undefined, 'kot_print_style', 0, ['kot_print_style', 'kot_text_size']]) {
            expect(kotDocketSettingsSupported(value)).toBe(false);
        }
    });

    it('a save answered with a document WITHOUT the key raises — nothing was stored', () => {
        expect(() => savedKotTextSize({ currency: '₹' }, 'small')).toThrow(KOT_DOCKET_NOT_SUPPORTED);
        expect(() => savedKotPrintStyle({}, 'classic')).toThrow(KOT_DOCKET_NOT_SUPPORTED);
        // The OTHER key being there does not count.
        expect(() => savedKotTextSize({ kot_print_style: 'reference' }, 'large')).toThrow(KOT_DOCKET_NOT_SUPPORTED);
        expect(() => savedKotPrintStyle({ kot_text_size: 'small' }, 'classic')).toThrow(KOT_DOCKET_NOT_SUPPORTED);
    });

    it('a document WITH the key is what was stored — even when it disagrees with what was sent', () => {
        expect(savedKotTextSize({ kot_text_size: 'large' }, 'large')).toBe('large');
        expect(savedKotTextSize({ kot_text_size: 'standard' }, 'small')).toBe('standard');
        expect(savedKotPrintStyle({ kot_print_style: 'classic' }, 'classic')).toBe('classic');
        expect(savedKotPrintStyle({ kot_print_style: 'reference' }, 'classic')).toBe('reference');
    });

    it('a reply that is not a document says nothing either way, so the value sent stands', () => {
        for (const reply of [null, 'ok', 1, ['kot_text_size']]) {
            expect(savedKotTextSize(reply, 'small')).toBe('small');
            expect(savedKotPrintStyle(reply, 'classic')).toBe('classic');
        }
    });

    it('says so in the owner app\'s words', () => {
        expect(KOT_DOCKET_NOT_SUPPORTED).toBe('This server does not support this setting yet, so nothing was saved.');
    });
});

describe('what the size control says', () => {
    it('offers Small / Standard — matches your reference docket / Large, in that order', () => {
        expect(KOT_TEXT_SIZE_OPTIONS.map((o) => o.value)).toEqual(['small', 'standard', 'large']);
        expect(KOT_TEXT_SIZE_OPTIONS.map((o) => o.label)).toEqual([
            'Small',
            'Standard — matches your reference docket',
            'Large',
        ]);
        for (const option of KOT_TEXT_SIZE_OPTIONS) { expect(option.detail.length).toBeGreaterThan(10); }
    });

    it('says the classic text docket ignores it', () => {
        expect(KOT_TEXT_SIZE_HELP).toMatch(/new docket only/i);
        expect(KOT_TEXT_SIZE_HELP).toMatch(/classic text docket/i);
        expect(KOT_TEXT_SIZE_HELP).toMatch(/ignores/i);
        expect(KOT_TEXT_SIZE_CLASSIC_NOTE).toMatch(/classic text docket/i);
    });

    it('the style copy no longer promises LARGER type — the size is now the owner\'s choice', () => {
        expect(KOT_PRINT_STYLE_OPTIONS[0]!.detail).not.toMatch(/larger/i);
    });
});

describe('the size is saved through the settings document, and the card renders it', () => {
    const db = code(readSource('src/lib/db.ts'));
    const card = code(readSource('src/app/dashboard/settings/kot-print-settings.tsx'));

    it('writes the one key POST /restaurant/settings accepts', () => {
        expect(db).toContain('JSON.stringify({ kot_text_size: size })');
    });

    it('a refused save raises, and the card puts the old size back', () => {
        expect(db).toMatch(/if \(!res\?\.ok\) \{throw new Error\(res \? await readErrorMessage\(res\) : 'Unable to save the KOT text size'\);\}/);
        expect(card).toContain('setTextSize(previous)');
    });

    it('one read fills both controls', () => {
        expect(db).toMatch(/export const getKotDocketSettings = async[\s\S]*?settings = await res\.json\(\)[\s\S]*?return readKotDocketSettings\(settings\);/);
        expect(card).toContain('setTextSize(s.textSize)');
        // The old single-purpose read is gone rather than left uncalled.
        expect(db).not.toContain('export const getKotPrintStyle');
    });

    it('the size control is RENDERED, from the shared options, bound to the save', () => {
        expect(card).toContain('KOT_TEXT_SIZE_OPTIONS.map(');
        expect(card).toContain('onValueChange={(v) => { void handleSizeChange(v) }}');
        expect(card).toContain('value={textSize}');
        expect(card).toContain('{KOT_TEXT_SIZE_HELP}');
    });

    it('the card shows WHAT THE SERVER STORED after a save, not only what was sent', () => {
        // Both saves echo the server's word through db.ts; a card that dropped
        // it would show the pick while the server holds something else.
        expect(card).toMatch(/const saved = await setKotTextSize\(restaurantId, next\)\s*setTextSize\(saved\)/);
        expect(card).toMatch(/const saved = await setKotPrintStyle\(restaurantId, next\)\s*setStyle\(saved\)/);
        // …and the toasts name the stored word.
        expect(card).toContain('prints at the ${saved} size.');
        expect(card).toMatch(/description: saved === "classic"/);
    });

    it('a save the server did not store raises, from both setters, through the shared reader', () => {
        // The reply is parsed once; a document without the key throws
        // KOT_DOCKET_NOT_SUPPORTED, which the card's catch puts back and shows.
        expect(db).toMatch(/export const setKotPrintStyle = async[\s\S]*?try \{ reply = await res\.json\(\); \} catch \{ return style; \}\s*return savedKotPrintStyle\(reply, style\);/);
        expect(db).toMatch(/export const setKotTextSize = async[\s\S]*?try \{ reply = await res\.json\(\); \} catch \{ return size; \}\s*return savedKotTextSize\(reply, size\);/);
        expect(card).toMatch(/catch \(error: unknown\) \{\s*setTextSize\(previous\)[\s\S]*?error instanceof Error \? error\.message/);
        expect(card).toMatch(/catch \(error: any\) \{\s*setStyle\(previous\)[\s\S]*?error\?\.message/);
    });

    it('the card is not shown against a backend without the settings', () => {
        expect(db).toMatch(/const fallback = \{ style: KOT_PRINT_STYLE_DEFAULT, textSize: KOT_TEXT_SIZE_DEFAULT, supported: true \};/);
        expect(card).toContain('setSupported(s.supported)');
        // Rendered nothing, before the Card, once the read says so.
        expect(card).toMatch(/if \(!supported\) \{return null\}\s*return \(\s*<Card>/);
        expect(card).toContain('const [supported, setSupported] = useState(true)');
    });

    it('it is gated like the style, and says so while classic is selected', () => {
        expect(card).toMatch(/const handleSizeChange = async[\s\S]*?if \(refuseWithoutPermission\(\)\) \{return\}/);
        expect(card).toMatch(/style === "classic" \? \([\s\S]*?\{KOT_TEXT_SIZE_CLASSIC_NOTE\}/);
        // Disabled on the same terms as the style's radio group.
        expect((card.match(/disabled=\{!canEdit \|\| loading \|\| saving\}/g) ?? []).length).toBe(2);
    });
});
