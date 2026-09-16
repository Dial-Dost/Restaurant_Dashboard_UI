// WHICH KITCHEN DOCKET THIS RESTAURANT PRINTS — the dashboard's half.
//
// The backend's kot_print_style.ts holds the same two words and the same rules;
// this file exists so the Settings card and src/lib/db.ts read a settings
// document the same way, and so the words an owner actually SEES are testable
// without rendering React (the web suite runs in a node environment).
//
// WHY THE SETTING EXISTS, because the copy below only makes sense with it: the
// reference kitchen docket is drawn as a RASTER IMAGE — the client's ticket is a
// proportional Arial-metric face and a thermal printer's built-in fonts are
// monospaced, so text mode cannot match it. Nearly every thermal printer draws a
// raster. The ones that do not DO NOT SAY SO: they feed blank paper. On a
// kitchen printer that is an order nobody cooks, with every screen in the
// building saying the order is fine. No printer model is on record for this
// estate, so the only honest answer is to let the owner switch back, from this
// screen, in the minute after the first blank ticket.
//
// A MISSING KEY READS AS THE REFERENCE DOCKET, never as classic. A dashboard
// talking to a backend from before this setting existed is talking to one that
// only knows the reference docket, so that is what it must show — the two deploy
// separately and roll back separately.

export type KotPrintStyle = 'reference' | 'classic';

/** What a restaurant that has never chosen prints, on both sides of the wire. */
export const KOT_PRINT_STYLE_DEFAULT: KotPrintStyle = 'reference';

/** True for exactly the two values the backend will accept on a save. */
export const isKotPrintStyle = (value: unknown): value is KotPrintStyle =>
    value === 'reference' || value === 'classic';

/**
 * Read the style out of a /restaurant/settings document.
 *
 * FORGIVING, like the backend's own read: a NULL column, a column the database
 * does not have yet, a backend too old to send the key, and an unreadable
 * response all mean the same thing here — show the default.
 */
export const readKotPrintStyle = (settings: unknown): KotPrintStyle => {
    const value = (settings as { kot_print_style?: unknown } | null | undefined)?.kot_print_style;
    return isKotPrintStyle(value) ? value : KOT_PRINT_STYLE_DEFAULT;
};

/**
 * The choices, in the order the card offers them, in the owner's words.
 *
 * THE COPY IS DATA, not JSX, for two reasons. It is the part of this feature a
 * non-engineer is most likely to want changed, and it is the part a test can
 * actually hold: "the recommended option is the reference docket" and "the help
 * text tells you what to do about a blank ticket" are properties of the product,
 * not of a component.
 */
export const KOT_PRINT_STYLE_OPTIONS: readonly { value: KotPrintStyle; label: string; detail: string }[] = [
    {
        value: 'reference',
        label: 'Match the reference docket (recommended)',
        detail: 'Larger, clearer type, laid out like the printed ticket you approved.',
    },
    {
        value: 'classic',
        label: 'Classic text docket',
        detail: 'The plain ticket this system printed before. Use it if the new one does not print.',
    },
];

/**
 * The one sentence under the control.
 *
 * It has to say three things and no more: the new docket is an image, almost
 * every printer can print one, and here is the exact thing to do if a kitchen
 * printer comes out blank. Anyone reading it is standing at a printer.
 */
export const KOT_PRINT_STYLE_HELP =
    'The new docket prints as an image, which almost every thermal printer supports. '
    + 'If a kitchen printer prints a blank ticket, switch back to the classic text docket here '
    + 'and the next KOT prints as text again.';
