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
    KOT_TEST_PRINT_BODY,
    KOT_TEST_PRINT_FAILED_TITLE,
    KOT_TEST_PRINT_HELP,
    KOT_TEST_PRINT_LABEL,
    KOT_TEST_PRINT_OFFLINE,
    KOT_TEST_PRINT_PATH,
    KOT_TEST_PRINT_SENDING,
    KOT_TEST_PRINT_SENT_TITLE,
    kotDocketCardLocks,
    kotTestPrintHandler,
    kotTestPrintOutcome,
    kotTestPrintReplayNote,
    type KotTestPrintResult,
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
        // Disabled on the same terms as the style's radio group — the card's
        // shared locks (pinned below).
        expect((card.match(/disabled=\{locks\.choicesDisabled\}/g) ?? []).length).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// CLIENT ITEM 5 — "the font looks elongated and stretched vertically".
//
// The classic text docket no longer prints double height, so its copy says it
// prints at the printer's normal size, and no longer calls itself "the ticket
// this system printed before" (that one was the stretched one).
// ---------------------------------------------------------------------------

describe('the classic docket is described as it now prints', () => {
    it('plain text, in the printer\'s own font, at its normal size', () => {
        expect(KOT_PRINT_STYLE_OPTIONS.map((o) => o.detail)[1]).toBe(
            "Plain text in the printer's own font, at its normal size. Use it if the new one does not print.",
        );
        expect(KOT_TEXT_SIZE_HELP).toBe(
            "Applies to the new docket only. The classic text docket prints in the printer's own font "
            + 'at its normal size, and ignores this setting.',
        );
    });
});

// ---------------------------------------------------------------------------
// "PRINT A TEST KOT" — the card's third control, and the first caller POST
// /print/test has ever had. What can go wrong while looking fine: a button that
// is never rendered or never posts; a double click that prints two slips; an
// offline tap that queues or hangs; a refusal shown as "Something went wrong"
// instead of the server's sentence; an outcome that hides where the slip went.
// ---------------------------------------------------------------------------

describe('what the test button says', () => {
    it('in the owner app\'s words', () => {
        expect(KOT_TEST_PRINT_LABEL).toBe('Print a test KOT');
        expect(KOT_TEST_PRINT_SENDING).toBe('Sending a test KOT…');
        expect(KOT_TEST_PRINT_HELP).toBe(
            'Sends one test docket to the kitchen printer in the style and size chosen above, '
            + 'so you can check the paper before service.',
        );
        expect(KOT_TEST_PRINT_SENT_TITLE).toBe('Test KOT sent');
        expect(KOT_TEST_PRINT_FAILED_TITLE).toBe("Couldn't print a test KOT");
        expect(KOT_TEST_PRINT_OFFLINE).toBe('A test KOT needs a connection — reconnect and try again.');
    });

    it('posts the existing route with the one role it tests', () => {
        expect(KOT_TEST_PRINT_PATH).toBe('/print/test');
        expect(KOT_TEST_PRINT_BODY).toEqual({ role: 'kot' });
        expect(Object.isFrozen(KOT_TEST_PRINT_BODY)).toBe(true);
    });

    it('names where the slip went', () => {
        const reply = (r: Record<string, unknown>): unknown => ({ results: [{ role: 'kot', jobId: 'j1', ...r }], skipped: 0 });
        expect(kotTestPrintOutcome(reply({ mode: 'directed', reason: 'routed', destination: 'Kitchen Epson' })))
            .toBe('Sent to Kitchen Epson. Check the paper there.');
        expect(kotTestPrintOutcome(reply({ mode: 'directed', reason: 'routed', destination: null })))
            .toBe('Sent to the kitchen printer. Check the paper there.');
        expect(kotTestPrintOutcome(reply({ mode: 'broadcast', reason: 'no_device_online', destination: 'Kitchen Epson' })))
            .toBe('Kitchen Epson is not online, so every connected device with a kitchen printer was asked to print it. '
                + 'Check the paper. If nothing came out, it may still print when a kitchen device connects.');
        for (const reason of ['no_route', 'flag_off', 'schema_missing', 'unpersisted', 'route_lookup_failed']) {
            expect(kotTestPrintOutcome(reply({ mode: 'broadcast', reason, destination: null })))
                .toBe('Every connected device with a kitchen printer was asked to print it. Check the paper. '
                    + 'If nothing came out, it may still print when a kitchen device connects.');
        }
        expect(kotTestPrintOutcome({ results: [], skipped: 0 })).toBe('Nothing was sent to print.');
        for (const odd of [null, 'ok', 1, [], {}, { results: 'x' }]) {
            expect(kotTestPrintOutcome(odd)).toBe("Sent. Check the kitchen printer's paper.");
        }
    });
});

// A SLIP NO DEVICE PRINTED IS NOT GONE. The server keeps it for the minutes its
// reply names (replayMinutes) for a kitchen device that connects late, and
// never after — so "the kitchen PC is off" is answered with what will happen
// when somebody switches it on, and nobody expects it mid-service.
describe('what a broadcast slip says about later', () => {
    const broadcast = (r: Record<string, unknown>, extra: Record<string, unknown> = {}): unknown => ({
        results: [{ role: 'kot', jobId: 'j1', mode: 'broadcast', ...r }], skipped: 0, ...extra,
    });

    it('names the window the server reported', () => {
        expect(kotTestPrintOutcome(broadcast({ reason: 'no_device_online', destination: 'Kitchen Epson' }, { replayMinutes: 5 })))
            .toBe('Kitchen Epson is not online, so every connected device with a kitchen printer was asked to print it. '
                + 'Check the paper. If nothing came out, it prints on the first kitchen device to connect within 5 minutes, '
                + 'and not after that.');
        expect(kotTestPrintOutcome(broadcast({ reason: 'no_route', destination: null }, { replayMinutes: 5 })))
            .toBe('Every connected device with a kitchen printer was asked to print it. Check the paper. '
                + 'If nothing came out, it prints on the first kitchen device to connect within 5 minutes, and not after that.');
        expect(kotTestPrintReplayNote({ replayMinutes: 1 }))
            .toBe('If nothing came out, it prints on the first kitchen device to connect within 1 minute, and not after that.');
    });

    it('a reply without a usable window says only that it may still print', () => {
        for (const odd of [undefined, null, 0, -5, 2.5, '5', Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(kotTestPrintReplayNote({ results: [], replayMinutes: odd }))
                .toBe('If nothing came out, it may still print when a kitchen device connects.');
        }
        expect(kotTestPrintReplayNote(null)).toBe('If nothing came out, it may still print when a kitchen device connects.');
    });

    it('a slip sent to a named, online printer says nothing about later', () => {
        const directed = { results: [{ mode: 'directed', destination: 'Kitchen Epson' }], replayMinutes: 5 };
        expect(kotTestPrintOutcome(directed)).toBe('Sent to Kitchen Epson. Check the paper there.');
    });
});

// A TEST PRESSED MID-SAVE PRINTS THE OLD SETTING. The server reads the style
// and size when it builds the slip; the card moves before its save lands. So
// the button waits out a save, and the choices wait out a test.
describe('the card\'s controls lock each other out', () => {
    const all = [true, false];

    it('the test button is off while loading, saving or testing — and never for want of the settings permission', () => {
        for (const canEdit of all) {
            for (const loading of all) {
                for (const saving of all) {
                    for (const testing of all) {
                        const locks = kotDocketCardLocks({ canEdit, loading, saving, testing });
                        expect([{ canEdit, loading, saving, testing }, locks.testDisabled])
                            .toEqual([{ canEdit, loading, saving, testing }, loading || saving || testing]);
                        expect([{ canEdit, loading, saving, testing }, locks.choicesDisabled])
                            .toEqual([{ canEdit, loading, saving, testing }, !canEdit || loading || saving || testing]);
                    }
                }
            }
        }
    });

    it('the cases the review found, by name', () => {
        // A size pick is saving: no test slip until it lands.
        expect(kotDocketCardLocks({ canEdit: true, loading: false, saving: true, testing: false }).testDisabled).toBe(true);
        // A test is out: no style or size pick until it answers.
        expect(kotDocketCardLocks({ canEdit: true, loading: false, saving: false, testing: true }).choicesDisabled).toBe(true);
        // Idle: both on.
        expect(kotDocketCardLocks({ canEdit: true, loading: false, saving: false, testing: false }))
            .toEqual({ choicesDisabled: false, testDisabled: false });
    });

    it('the card draws every control from those locks, and its handlers refuse mid-save and mid-test', () => {
        const card = code(readSource('src/app/dashboard/settings/kot-print-settings.tsx'));
        expect(card).toContain('const locks = kotDocketCardLocks({ canEdit, loading, saving, testing })');
        expect((card.match(/disabled=\{locks\.choicesDisabled\}/g) ?? []).length).toBe(2);
        expect((card.match(/disabled=\{locks\.testDisabled\}/g) ?? []).length).toBe(1);
        // No control is disabled on any other terms.
        expect((card.match(/disabled=\{/g) ?? []).length).toBe(3);
        expect(card).toMatch(/const handleChange = async \(next: string\) => \{\s*if \(!isKotPrintStyle\(next\) \|\| next === style\) \{return\}\s*if \(saving \|\| testing\) \{return\}/);
        expect(card).toMatch(/const handleSizeChange = async \(next: string\): Promise<void> => \{\s*if \(!isKotTextSize\(next\) \|\| next === textSize\) \{return\}\s*if \(saving \|\| testing\) \{return\}/);
        // `saving` is set in the same tick the pick moves the card, before the
        // request is awaited — which is what makes the button's lock cover it.
        expect(card).toMatch(/setTextSize\(next\)\s*setSaving\(true\)\s*try \{\s*const saved = await setKotTextSize/);
        expect(card).toMatch(/setStyle\(next\)\s*setSaving\(true\)\s*try \{\s*const saved = await setKotPrintStyle/);
    });
});

describe('pressing the test button', () => {
    interface Notice { title: string; description: string; failed: boolean }
    interface Harness {
        press: () => Promise<void>;
        sends: number[];
        notices: Notice[];
        busy: boolean[];
        release: (value: KotTestPrintResult) => void;
    }
    const harness = (opts: { online?: boolean; send?: () => Promise<KotTestPrintResult> } = {}): Harness => {
        const sends: number[] = [];
        const notices: Notice[] = [];
        const busy: boolean[] = [];
        let release: (value: KotTestPrintResult) => void = (): void => undefined;
        const press = kotTestPrintHandler({
            online: () => opts.online ?? true,
            send: () => {
                sends.push(1);
                return opts.send ? opts.send() : new Promise<KotTestPrintResult>((resolve) => { release = resolve; });
            },
            notify: (n) => { notices.push(n); },
            busy: (b) => { busy.push(b); },
        });
        return { press, sends, notices, busy, release: (v: KotTestPrintResult): void => { release(v); } };
    };
    const directed: KotTestPrintResult = { sent: true, reply: { results: [{ mode: 'directed', destination: 'Kitchen Epson' }] } };

    it('ONE TAP IS ONE REQUEST — a second tap while the first is in flight sends nothing', async () => {
        const h = harness();
        const first = h.press();
        const second = h.press();
        await second;
        expect(h.sends).toHaveLength(1);
        h.release(directed);
        await first;
        expect(h.sends).toHaveLength(1);
        expect(h.notices).toEqual([{ title: 'Test KOT sent', description: 'Sent to Kitchen Epson. Check the paper there.', failed: false }]);
        // The button was disabled for exactly the request.
        expect(h.busy).toEqual([true, false]);
        // …and pressing again afterwards is a new slip.
        const third = h.press();
        h.release(directed);
        await third;
        expect(h.sends).toHaveLength(2);
    });

    it('offline, nothing is sent and the owner is told it needs a connection', async () => {
        const h = harness({ online: false });
        await h.press();
        expect(h.sends).toHaveLength(0);
        expect(h.busy).toEqual([]);
        expect(h.notices).toEqual([{ title: "Couldn't print a test KOT", description: KOT_TEST_PRINT_OFFLINE, failed: true }]);
    });

    it('a refusal is shown in the server\'s own sentence', async () => {
        const h = harness({
            send: () => Promise.resolve({ refused: true, status: 403, error: 'You need the "Print" permission to print a test slip.' }),
        });
        await h.press();
        expect(h.sends).toHaveLength(1);
        expect(h.notices).toEqual([
            { title: "Couldn't print a test KOT", description: 'You need the "Print" permission to print a test slip.', failed: true },
        ]);
        expect(h.busy).toEqual([true, false]);
    });

    it('a request that never completed says it needs a connection, and frees the button', async () => {
        const h = harness({ send: () => Promise.reject(new Error('Failed to fetch')) });
        await h.press();
        expect(h.notices).toEqual([{ title: "Couldn't print a test KOT", description: KOT_TEST_PRINT_OFFLINE, failed: true }]);
        expect(h.busy).toEqual([true, false]);
    });
});

describe('the test button is built AND called', () => {
    const db = code(readSource('src/lib/db.ts'));
    const card = code(readSource('src/app/dashboard/settings/kot-print-settings.tsx'));

    it('db.ts posts the shared body to the shared path, and RETURNS a refusal', () => {
        expect(db).toMatch(/export const printTestKot = async \(restaurantId: string\): Promise<KotTestPrintResult> => \{\s*const res = await backendCall\(KOT_TEST_PRINT_PATH, restaurantId, \{\s*method: 'POST',[\s\S]*?body: JSON\.stringify\(KOT_TEST_PRINT_BODY\),/);
        expect(db).toMatch(/if \(!res\) \{return \{ refused: true, status: 0, error: KOT_TEST_PRINT_OFFLINE \};\}/);
        expect(db).toMatch(/if \(!res\.ok\) \{return \{ refused: true, status: res\.status, error: await readErrorMessage\(res, 'Unable to print a test KOT\.'\) \};\}/);
        // Exactly one caller of the route in the dashboard, and it is this one.
        expect((db.match(/backendCall\(KOT_TEST_PRINT_PATH, restaurantId/g) ?? []).length).toBe(1);
        expect(db).not.toMatch(/print\/test/);
    });

    it('the card renders the button, bound to the one handler, disabled while it sends', () => {
        expect(card).toContain('send: () => printTestKot(restaurantId),');
        expect(card).toMatch(/const printTest = useMemo\(\(\) => kotTestPrintHandler\(\{/);
        expect(card).toMatch(/<Button[\s\S]*?onClick=\{\(\) => \{ void printTest\(\) \}\}[\s\S]*?disabled=\{locks\.testDisabled\}[\s\S]*?\{testing \? KOT_TEST_PRINT_SENDING : KOT_TEST_PRINT_LABEL\}[\s\S]*?<\/Button>/);
        expect(card).toContain('{KOT_TEST_PRINT_HELP}');
        expect(card).toContain('busy: setTesting,');
        expect(card).toContain('window.navigator.onLine');
        // Rendered inside the card that is itself rendered on Settings (pinned above).
        expect(card.indexOf('void printTest()')).toBeGreaterThan(card.indexOf('if (!supported) {return null}'));
        expect(card).not.toMatch(/\bfetch\(/);
    });
});
