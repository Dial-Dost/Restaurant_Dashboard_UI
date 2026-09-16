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
        detail: 'Clear type, laid out like the printed ticket you approved. Its size is set below.',
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

// ---------------------------------------------------------------------------
// HOW LARGE THE REFERENCE DOCKET'S TYPE IS ("Restaurant".kot_text_size)
//
// The client, having printed the reference docket: "The font sizes must be
// smaller in the KOT." Standard is their reference ticket exactly; Small and
// Large are a step either side. The backend's kot_print_style.ts holds the same
// three words; the dots-per-em each one means is the renderer's business.
//
// IT SIZES THE REFERENCE DOCKET ONLY. The classic text docket prints in the
// printer's own font and ignores it — the copy says so, and the card repeats it
// while the classic docket is the one selected, so an owner on the fallback is
// never left wondering why Small changed nothing.
//
// A MISSING KEY READS AS STANDARD, for the reason a missing style reads as the
// reference docket: a backend that does not send it prints standard.
// ---------------------------------------------------------------------------

export type KotTextSize = 'small' | 'standard' | 'large';

/** What a restaurant that has never chosen prints: the client's reference ticket. */
export const KOT_TEXT_SIZE_DEFAULT: KotTextSize = 'standard';

/** Every size, smallest first — the order the card offers them in. */
export const KOT_TEXT_SIZES: readonly KotTextSize[] = ['small', 'standard', 'large'];

/** True for exactly the three values the backend will accept on a save. */
export const isKotTextSize = (value: unknown): value is KotTextSize =>
    value === 'small' || value === 'standard' || value === 'large';

/** Read the size out of a /restaurant/settings document. Forgiving, like the style. */
export const readKotTextSize = (settings: unknown): KotTextSize => {
    const value = (settings as { kot_text_size?: unknown } | null | undefined)?.kot_text_size;
    return isKotTextSize(value) ? value : KOT_TEXT_SIZE_DEFAULT;
};

/**
 * Both KOT docket settings, read out of ONE /restaurant/settings document — the
 * card needs both, and one request is one answer about one moment.
 */
export const readKotDocketSettings = (settings: unknown): { style: KotPrintStyle; textSize: KotTextSize } => ({
    style: readKotPrintStyle(settings),
    textSize: readKotTextSize(settings),
});

/**
 * The size choices, in the owner's words. The owner app's Settings screen
 * offers the same three labels (restaurant_owner_app, kotTextSizeOptions).
 */
export const KOT_TEXT_SIZE_OPTIONS: readonly { value: KotTextSize; label: string; detail: string }[] = [
    { value: 'small', label: 'Small', detail: 'A size down: more of a long order fits on less paper.' },
    { value: 'standard', label: 'Standard — matches your reference docket', detail: 'The same size as the printed ticket you approved.' },
    { value: 'large', label: 'Large', detail: 'A size up, for a pass read from further away. Long dish names wrap sooner.' },
];

/**
 * The sentence under the size control. It has to say the one thing an owner on
 * the fallback needs to know: this does nothing to the classic text docket.
 */
export const KOT_TEXT_SIZE_HELP =
    'Applies to the new docket only. The classic text docket prints in the printer\'s own font '
    + 'and ignores this setting.';

/** Shown under the size control while the classic docket is the selected style. */
export const KOT_TEXT_SIZE_CLASSIC_NOTE =
    'Your kitchens are on the classic text docket, so this size is not used until you switch back.';
