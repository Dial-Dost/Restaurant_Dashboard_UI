// WHICH KITCHEN DOCKET THIS RESTAURANT PRINTS — the dashboard's half.
//
// The backend's kot_print_style.ts holds the same two words and the same rules;
// this file exists so the Settings card and src/lib/db.ts read a settings
// document the same way, and so the words an owner actually SEES are testable
// without rendering React (the web suite runs in a node environment).
//
// WHY THE SETTING EXISTS, because the copy below only makes sense with it: the
// reference kitchen docket is drawn as a RASTER IMAGE — the client's ticket is a
// proportional face and a thermal printer's built-in fonts are monospaced, so
// text mode cannot match it. Nearly every thermal printer draws a
// raster. The ones that do not DO NOT SAY SO: they feed blank paper. On a
// kitchen printer that is an order nobody cooks, with every screen in the
// building saying the order is fine. No printer model is on record for this
// estate, so the only honest answer is to let the owner switch back, from this
// screen, in the minute after the first blank ticket.
//
// A BACKEND WITHOUT THE SETTING IS NOT "THE DEFAULT". The backend that was live
// before this setting (and any backend rolled back to it) sends no
// kot_print_style and prints ONLY the classic text docket; its POST
// /restaurant/settings ignores keys it does not know, answering 200 with
// nothing stored. The dashboard and the backend deploy and roll back
// separately, so the card asks first (kotDocketSettingsSupported) and is not
// shown against such a backend, and a save whose reply lacks the key raises
// (savedKotPrintStyle / savedKotTextSize) instead of confirming. The owner app
// does the same, in the same words (models/kot_docket_settings.dart).

import { isRefusedAction, type RefusedAction } from './error-message';

export type KotPrintStyle = 'reference' | 'classic';

/** What a restaurant that has never chosen prints, on both sides of the wire. */
export const KOT_PRINT_STYLE_DEFAULT: KotPrintStyle = 'reference';

/** True for exactly the two values the backend will accept on a save. */
export const isKotPrintStyle = (value: unknown): value is KotPrintStyle =>
    value === 'reference' || value === 'classic';

/**
 * Read the style out of a /restaurant/settings document.
 *
 * FORGIVING, like the backend's own read: a NULL column and a value this
 * dashboard does not know both mean the default. (This backend sends the key
 * even while the column does not exist yet; a document WITHOUT it is a backend
 * that does not have the setting — see kotDocketSettingsSupported.)
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
        detail: "Plain text in the printer's own font, at its normal size. Use it if the new one does not print.",
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
// printer's own font, at its normal size (never stretched — client item 5), and
// ignores it — the copy says so, and the card repeats it
// while the classic docket is the one selected, so an owner on the fallback is
// never left wondering why Small changed nothing.
//
// A NULL OR UNKNOWN VALUE READS AS STANDARD, the client's reference ticket. A
// document without the key is a backend without the setting, as for the style.
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

/** A parsed JSON object — what a settings document is, as opposed to null, a list or a word. */
const isDocument = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Whether this backend has the two docket settings at all: its settings
 * document carries BOTH keys. The one live before them sends neither and prints
 * only the classic docket, so the card is not shown against it.
 */
export const kotDocketSettingsSupported = (settings: unknown): boolean =>
    isDocument(settings) && 'kot_print_style' in settings && 'kot_text_size' in settings;

/**
 * Both KOT docket settings, read out of ONE /restaurant/settings document — the
 * card needs both, and one request is one answer about one moment — and whether
 * the backend that sent it has them at all.
 */
export const readKotDocketSettings = (settings: unknown): { style: KotPrintStyle; textSize: KotTextSize; supported: boolean } => ({
    style: readKotPrintStyle(settings),
    textSize: readKotTextSize(settings),
    supported: kotDocketSettingsSupported(settings),
});

/**
 * What a save shows when the server stored nothing. The owner app shows the
 * same sentence (kotDocketNotSupported).
 */
export const KOT_DOCKET_NOT_SUPPORTED = 'This server does not support this setting yet, so nothing was saved.';

/**
 * What a save actually stored, read back from the settings document the POST
 * answers with.
 *
 * A document WITHOUT the key comes from a backend that ignored it — an older
 * one, or one rolled back since the card loaded — so nothing was stored and
 * this RAISES rather than confirming the pick. A reply that is not a document
 * at all says nothing either way, so the value that was sent stands (the save
 * was answered 2xx, and the backend refuses a value it does not accept).
 */
const savedKotSetting = <T>(reply: unknown, key: 'kot_print_style' | 'kot_text_size', sent: T, read: (settings: unknown) => T): T => {
    if (!isDocument(reply)) {return sent;}
    if (!(key in reply)) {throw new Error(KOT_DOCKET_NOT_SUPPORTED);}
    return read(reply);
};

export const savedKotPrintStyle = (reply: unknown, sent: KotPrintStyle): KotPrintStyle =>
    savedKotSetting(reply, 'kot_print_style', sent, readKotPrintStyle);

export const savedKotTextSize = (reply: unknown, sent: KotTextSize): KotTextSize =>
    savedKotSetting(reply, 'kot_text_size', sent, readKotTextSize);

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
    + 'at its normal size, and ignores this setting.';

/** Shown under the size control while the classic docket is the selected style. */
export const KOT_TEXT_SIZE_CLASSIC_NOTE =
    'Your kitchens are on the classic text docket, so this size is not used until you switch back.';

// ---------------------------------------------------------------------------
// "PRINT A TEST KOT" — the card's third control.
//
// The server has always had POST /print/test (PERM_PRINT). It prints one slip
// in THIS restaurant's own docket style and text size, on its own roll, through
// the same routing a real ticket takes — so it answers the only question an
// owner at a kitchen printer has after changing either setting: "what will the
// kitchen get?" Nothing on the web or the app called it. This is the caller.
//
// ONLINE ONLY. A test slip printed from a queue an hour later is not a test of
// anything, and every /print write is refused offline by design (the owner app's
// OutboxPolicy denies the prefix). The card checks before it sends and says so.
//
// ONE TAP, ONE SLIP. The handler below ignores a tap while one is in flight,
// and the card disables the button for the same window, so a double click is
// one request — two test slips would read as a printer that duplicates jobs.
//
// A REFUSAL IS SHOWN IN THE SERVER'S WORDS. The route 403s without the print
// permission and 400s a role it does not know; db.ts RETURNS that sentence (a
// "use server" module has its thrown messages redacted in production) and the
// card puts it in the toast. The owner app says the same things
// (models/kot_docket_settings.dart, kotTestPrint*).
// ---------------------------------------------------------------------------

/** The existing route, and the one body this card sends to it. */
export const KOT_TEST_PRINT_PATH = '/print/test';
export const KOT_TEST_PRINT_BODY: Readonly<{ role: 'kot' }> = Object.freeze({ role: 'kot' });

export const KOT_TEST_PRINT_LABEL = 'Print a test KOT';
export const KOT_TEST_PRINT_SENDING = 'Sending a test KOT…';
export const KOT_TEST_PRINT_HELP =
    'Sends one test docket to the kitchen printer in the style and size chosen above, '
    + 'so you can check the paper before service.';
export const KOT_TEST_PRINT_SENT_TITLE = 'Test KOT sent';
export const KOT_TEST_PRINT_FAILED_TITLE = "Couldn't print a test KOT";
export const KOT_TEST_PRINT_OFFLINE = 'A test KOT needs a connection — reconnect and try again.';

/**
 * What the server did with the slip, in one sentence.
 *
 * POST /print/test answers `{ results: [{ role, mode, reason, destination, … }] }`.
 * 'directed' went to one named printer; 'broadcast' went to every connected
 * device, each of which prints it on the kitchen printer it has set up — and
 * when a routed printer's device is offline, the owner should know that is why.
 * A reply this card cannot read still means the request was accepted.
 */
export const kotTestPrintOutcome = (reply: unknown): string => {
    const results = isDocument(reply) && Array.isArray(reply.results)
        ? reply.results.filter(isDocument)
        : null;
    if (!results) {return "Sent. Check the kitchen printer's paper.";}
    if (results.length === 0) {return 'Nothing was sent to print.';}
    const first = results[0];
    const destination = typeof first.destination === 'string' && first.destination.trim()
        ? first.destination.trim()
        : null;
    if (first.mode === 'directed') {return `Sent to ${destination ?? 'the kitchen printer'}. Check the paper there.`;}
    if (first.reason === 'no_device_online' && destination) {
        return `${destination} is not online, so every connected device with a kitchen printer was asked to print it. Check the paper.`;
    }
    return 'Every connected device with a kitchen printer was asked to print it. Check the paper.';
};

/** What the card's send returns: the reply, or the server's refusal. */
export type KotTestPrintResult = { sent: true; reply: unknown } | RefusedAction;

export interface KotTestPrintDeps {
    /** False only when the browser knows it is offline. */
    online: () => boolean;
    /** The one request. */
    send: () => Promise<KotTestPrintResult>;
    notify: (notice: { title: string; description: string; failed: boolean }) => void;
    /** Told true before the request and false after, for the button. */
    busy: (sending: boolean) => void;
}

/**
 * The button's click handler: one tap, one request, and a tap while one is in
 * flight does nothing. Pure of React so the web suite (node) can press it.
 */
export const kotTestPrintHandler = (deps: KotTestPrintDeps): (() => Promise<void>) => {
    let inFlight = false;
    return async () => {
        if (inFlight) {return;}
        if (!deps.online()) {
            deps.notify({ title: KOT_TEST_PRINT_FAILED_TITLE, description: KOT_TEST_PRINT_OFFLINE, failed: true });
            return;
        }
        inFlight = true;
        deps.busy(true);
        try {
            const result = await deps.send();
            if (isRefusedAction(result)) {
                deps.notify({ title: KOT_TEST_PRINT_FAILED_TITLE, description: result.error, failed: true });
            } else {
                deps.notify({ title: KOT_TEST_PRINT_SENT_TITLE, description: kotTestPrintOutcome(result.reply), failed: false });
            }
        } catch {
            // The server action itself did not complete: the browser lost the
            // line mid-request. Its message is not a sentence for an owner.
            deps.notify({ title: KOT_TEST_PRINT_FAILED_TITLE, description: KOT_TEST_PRINT_OFFLINE, failed: true });
        } finally {
            inFlight = false;
            deps.busy(false);
        }
    };
};
