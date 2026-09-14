// THE PAYMENT MODES THIS RESTAURANT SETTLES WITH — read from its settings.
//
// Every picker on the dashboard that takes money (Orders' "Confirm Payment",
// the split dialog, the tender form) and the closed-bills filter used to keep
// its OWN hard-coded list, and the lists had drifted from the server: "Swiggy"
// and "Online Transfer" were offered and always refused, "Dine Out" and
// "Eazydiner" never asked for the screenshot the server demanded, District was
// missing, and an owner had no way to add a mode at all. Now the server's
// `payment_methods` (GET /restaurant/settings) is the one list, and this module
// is the only place the dashboard turns it into options.
//
// The server is the authority (Restaurant_Backend/payment_methods.ts). The
// naming rules below are a COURTESY copy so the editor can say what is wrong
// before the save; a save the server refuses still comes back as a 400 with its
// own sentences, which the editor shows verbatim.
//
// PURE: no fetch, no React — see src/lib/__tests__/payment-methods.test.ts.

export interface PaymentMethodConfig {
    id: string;
    label: string;
    enabled: boolean;
    requires_screenshot: boolean;
    online?: boolean;
    custom?: boolean;
    show_to_guests?: boolean;
}

/**
 * The backend's DEFAULT_PAYMENT_METHODS, verbatim. Used only when the settings
 * read fails or comes from a server older than configurable modes — a settle
 * must never be blocked because a settings document could not be fetched.
 */
export const DEFAULT_PAYMENT_METHODS: readonly PaymentMethodConfig[] = [
    { id: 'Razorpay', label: 'Pay online (Razorpay)', enabled: true, requires_screenshot: false, online: true, custom: false, show_to_guests: true },
    { id: 'Upi', label: 'UPI', enabled: true, requires_screenshot: false, custom: false, show_to_guests: true },
    { id: 'Cash', label: 'Cash', enabled: true, requires_screenshot: false, custom: false, show_to_guests: true },
    { id: 'Card', label: 'Card', enabled: true, requires_screenshot: false, custom: false, show_to_guests: true },
    { id: 'Dineout', label: 'Dineout', enabled: true, requires_screenshot: true, custom: false, show_to_guests: true },
    { id: 'Zomato', label: 'Zomato', enabled: true, requires_screenshot: true, custom: false, show_to_guests: true },
    { id: 'Eazydiner', label: 'EasyDiner', enabled: true, requires_screenshot: true, custom: false, show_to_guests: true },
    { id: 'District', label: 'District', enabled: true, requires_screenshot: true, custom: false, show_to_guests: true },
];

/** The server's own caps, mirrored so the editor stops before the refusal. */
export const PAYMENT_MODE_ID_MAX = 32;
export const PAYMENT_MODE_LABEL_MAX = 40;
export const MAX_CUSTOM_PAYMENT_MODES = 24;
/** normalizePaymentSplits accepts 2..6 parts (routes/bills.ts MAX_BILL_TENDERS). */
export const MAX_SPLIT_PARTS = 6;

/** A settings document's payment_methods, or the defaults when it has none. */
export const readPaymentMethods = (raw: unknown): PaymentMethodConfig[] => {
    if (!Array.isArray(raw)) {return DEFAULT_PAYMENT_METHODS.map((m) => ({ ...m }));}
    const out: PaymentMethodConfig[] = [];
    for (const entry of raw as unknown[]) {
        if (!entry || typeof entry !== 'object') {continue;}
        const o = entry as Record<string, unknown>;
        const id = typeof o.id === 'string' ? o.id.trim() : '';
        if (!id) {continue;}
        out.push({
            id,
            label: typeof o.label === 'string' && o.label.trim() ? o.label.trim() : id,
            enabled: o.enabled !== false,
            requires_screenshot: o.requires_screenshot === true,
            online: o.online === true,
            custom: o.custom === true,
            show_to_guests: o.show_to_guests !== false && !(o.custom === true && o.show_to_guests === undefined),
        });
    }
    return out.length > 0 ? out : DEFAULT_PAYMENT_METHODS.map((m) => ({ ...m }));
};

/** One option in a picker: `value` is what is SENT (the id), `label` what is shown. */
export interface PaymentOption {
    value: string;
    label: string;
    requiresScreenshot: boolean;
}

const toOption = (m: PaymentMethodConfig): PaymentOption => ({
    value: m.id,
    label: m.label || m.id,
    requiresScreenshot: m.requires_screenshot,
});

/**
 * What a cashier may settle a bill with at the till: every mode that is ON and
 * is not the online gateway. The same rule the owner app's settle sheet uses.
 */
export const tillPaymentOptions = (config: readonly PaymentMethodConfig[]): PaymentOption[] =>
    config.filter((m) => m.enabled && m.online !== true).map(toOption);

/**
 * The tender form's methods: every mode that is ON, the gateway included — a
 * lone Razorpay tender is how an online payment is recorded at the till, and
 * the form already greys it out beside another tender (isUnsplittableMethod).
 */
export const tenderPaymentOptions = (config: readonly PaymentMethodConfig[]): PaymentOption[] =>
    config.filter((m) => m.enabled).map(toOption);

/**
 * The closed-bills filter: EVERY mode the restaurant has ever configured, on or
 * off — a mode switched off last month still has last month's bills — plus
 * 'Split', the stored word for a bill paid several ways.
 */
export const closedBillMethodFilterOptions = (config: readonly PaymentMethodConfig[]): { value: string; label: string }[] => [
    ...config.map((m) => ({ value: m.id, label: m.label || m.id })),
    { value: 'Split', label: 'Split' },
];

/** Case/punctuation-insensitive key — the server's paymentNameKey. */
export const paymentNameKey = (raw: string | null | undefined): string => (raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const BUILTIN_ALIASES: Record<string, string> = {
    'upi': 'Upi', 'cash': 'Cash', 'card': 'Card', 'dineout': 'Dineout', 'dine out': 'Dineout',
    'zomato': 'Zomato', 'zomato pay': 'Zomato', 'zomatopay': 'Zomato', 'eazydiner': 'Eazydiner',
    'easydiner': 'Eazydiner', 'easy diner': 'Eazydiner', 'district': 'District', 'razorpay': 'Razorpay', 'split': 'Split',
};
const BUILTIN_ALIAS_KEYS = new Map<string, string>(Object.entries(BUILTIN_ALIASES).map(([a, id]) => [paymentNameKey(a), id]));

const findMethod = (method: string | null | undefined, config: readonly PaymentMethodConfig[]): PaymentMethodConfig | undefined => {
    const key = paymentNameKey(method);
    if (!key) {return undefined;}
    return config.find((m) => paymentNameKey(m.id) === key)
        ?? config.find((m) => m.custom !== true && BUILTIN_ALIAS_KEYS.get(key) === m.id);
};

/** Whether settling with this method needs a payment screenshot — the config's rule. */
export const methodNeedsScreenshot = (method: string | null | undefined, config: readonly PaymentMethodConfig[]): boolean =>
    findMethod(method, config)?.requires_screenshot === true;

/** The owner's name for a stored method; the stored string when the config has none. */
export const paymentMethodLabel = (method: string | null | undefined, config: readonly PaymentMethodConfig[]): string => {
    const s = (method ?? '').trim();
    if (!s) {return '';}
    return findMethod(s, config)?.label ?? s;
};

// --- naming a new mode (courtesy copy of the server's rules) -----------------

const COMP_KEYS = new Set(['complimentary', 'comp', 'nc', 'non chargeable', 'non-chargeable', 'staff meal'].map(paymentNameKey));
const CREDIT_KEYS = new Set(['credit', 'on account', 'due', 'pay later'].map(paymentNameKey));
const BUCKET_KEYS = new Set(['split', 'other', 'unallocated'].map(paymentNameKey));
const ID_CHARSET = /^[A-Za-z0-9 &+.\-/()']+$/;

/** Collapse whitespace and trim — the spelling a name is stored in. */
export const tidyPaymentName = (raw: string): string => raw.replace(/\s+/g, ' ').trim();

/**
 * Why `name` cannot be a new payment mode for this restaurant, or null. The
 * sentences match the server's, so the editor and a refused save read the same.
 */
export const newPaymentModeRefusal = (rawName: string, config: readonly PaymentMethodConfig[]): string | null => {
    const name = tidyPaymentName(rawName);
    if (!name) {return 'Give the payment mode a name.';}
    const key = paymentNameKey(name);
    if (!key) {return `"${name}" needs at least one letter or number.`;}
    if (COMP_KEYS.has(key)) {
        return `"${name}" can't be a payment mode: a free meal is not money collected, and settling it as paid books it as sales and tax. Use "Mark as non-chargeable" on the bill instead.`;
    }
    if (CREDIT_KEYS.has(key)) {return `"${name}" can't be a payment mode: it would close the bill as paid while no money has arrived.`;}
    if (BUCKET_KEYS.has(key)) {return `"${name}" can't be a payment mode: reports already use that name for their own rows.`;}
    const builtin = BUILTIN_ALIAS_KEYS.get(key);
    if (builtin) {
        return `"${name}" is already a built-in payment mode (${builtin}). Rename or switch on the built-in one instead of adding a copy.`;
    }
    if (name.length > PAYMENT_MODE_ID_MAX) {
        return `"${name}" is too long — a payment mode name can be at most ${String(PAYMENT_MODE_ID_MAX)} characters.`;
    }
    if (!ID_CHARSET.test(name)) {
        return `"${name}" has characters a payment mode name can't use. Letters, numbers, spaces and & + . - / ( ) ' are allowed.`;
    }
    const clash = config.find((m) => paymentNameKey(m.id) === key || paymentNameKey(m.label) === key);
    if (clash) {
        return clash.enabled
            ? `This restaurant already has "${clash.label}".`
            : `This restaurant already has "${clash.label}" — it is switched off. Switch it back on instead of adding it again.`;
    }
    if (config.filter((m) => m.custom === true).length >= MAX_CUSTOM_PAYMENT_MODES) {
        return `A restaurant can have at most ${String(MAX_CUSTOM_PAYMENT_MODES)} payment modes of its own. Switch off one you no longer use and rename it instead of adding another.`;
    }
    return null;
};

/** Why `label` cannot label mode `id`, or null. */
export const paymentLabelRefusal = (rawLabel: string, id: string, config: readonly PaymentMethodConfig[]): string | null => {
    const label = tidyPaymentName(rawLabel);
    if (!label) {return null;} // empty = back to the default name
    if (label.length > PAYMENT_MODE_LABEL_MAX) {return `A label can be at most ${String(PAYMENT_MODE_LABEL_MAX)} characters.`;}
    const key = paymentNameKey(label);
    if (COMP_KEYS.has(key)) {return `"${label}" can't be used as a label: a free meal is not money collected — use "Mark as non-chargeable" on the bill instead.`;}
    if (CREDIT_KEYS.has(key)) {return `"${label}" can't be used as a label: it would close the bill as paid while no money has arrived.`;}
    if (BUCKET_KEYS.has(key)) {return `"${label}" can't be used as a label: reports already use that name for their own rows.`;}
    const aliasOf = BUILTIN_ALIAS_KEYS.get(key);
    if (aliasOf && paymentNameKey(aliasOf) !== paymentNameKey(id)) {return `"${label}" can't label ${id}: that is the name of the built-in ${aliasOf} mode.`;}
    const other = config.find((m) => m.id !== id && (paymentNameKey(m.label) === key || paymentNameKey(m.id) === key));
    if (other) {return `"${label}" is already used by ${other.label}. Give each mode a different label.`;}
    return null;
};

/** The config with a new custom mode appended — what the editor saves. */
export const withCustomPaymentMode = (
    config: readonly PaymentMethodConfig[],
    draft: { name: string; requiresScreenshot: boolean; showToGuests: boolean },
): PaymentMethodConfig[] => {
    const id = tidyPaymentName(draft.name);
    return [
        ...config.map((m) => ({ ...m })),
        { id, label: id, enabled: true, requires_screenshot: draft.requiresScreenshot, custom: true, show_to_guests: draft.showToGuests },
    ];
};

// --- the split dialog --------------------------------------------------------

/**
 * The two rows a split dialog opens with: Cash then Card when the restaurant
 * takes both (what the dialog always opened with), otherwise the first two modes
 * it does take — never a mode that is switched off, which the server would
 * refuse the moment the split is recorded.
 */
export const splitDefaultRows = (
    options: readonly PaymentOption[],
    total: number | null,
): { method: string; amount: string }[] => {
    const pick = (id: string): string | undefined => options.find((o) => o.value === id)?.value;
    const first = pick('Cash') ?? (options.length > 0 ? options[0].value : 'Cash');
    const second = pick('Card') !== undefined && pick('Card') !== first
        ? 'Card'
        : options.find((o) => o.value !== first)?.value ?? first;
    return [
        { method: first, amount: total !== null ? total.toFixed(2) : '' },
        { method: second, amount: '0.00' },
    ];
};

/** The method a newly added split row starts on: the first mode not yet used, else the first mode. */
export const nextSplitMethod = (options: readonly PaymentOption[], rows: readonly { method: string }[]): string => {
    const used = new Set(rows.map((r) => r.method));
    return options.find((o) => !used.has(o.value))?.value ?? (options.length > 0 ? options[0].value : 'Cash');
};
