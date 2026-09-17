// PAYMENT MODES ON THE DASHBOARD — the lists every money picker is built from.
//
// The owner's ask: "there has to be an option to add mode of payments". The
// server now stores the modes; this suite pins the dashboard's half:
//   * a mode saved in Settings REACHES every picker that takes money, shown by
//     its label and sent by its id (the wiring test — "built but never called"
//     is this codebase's most repeated defect);
//   * the pickers no longer keep lists of their own (source guards), because the
//     old ones offered modes the server refused and asked for screenshots on the
//     wrong ones;
//   * the editor's naming rules say what the server will say.

import * as fs from 'fs';
import * as path from 'path';

import {
    DEFAULT_PAYMENT_METHODS,
    MAX_CUSTOM_PAYMENT_MODES,
    MAX_SPLIT_PARTS,
    closedBillMethodFilterOptions,
    methodNeedsScreenshot,
    newPaymentModeRefusal,
    nextSplitMethod,
    notMoneyKind,
    paymentLabelRefusal,
    paymentMethodLabel,
    readPaymentMethods,
    reportModeName,
    splitDefaultRows,
    splitScreenshotLabels,
    tenderPaymentOptions,
    tillPaymentOptions,
    withCustomPaymentMode,
} from '../payment-methods';

const source = (relative: string): string => {
    for (const base of [process.cwd(), path.join(__dirname, '..', '..', '..')]) {
        const full = path.join(base, relative);
        if (fs.existsSync(full)) { return fs.readFileSync(full, 'utf8'); }
    }
    throw new Error(`source not found: ${relative}`);
};

/** What GET /restaurant/settings answers after an owner added "Swiggy Dineout" and switched Card off. */
const SETTINGS_AFTER_ADD = {
    payment_methods: [
        ...DEFAULT_PAYMENT_METHODS.map((m) => (m.id === 'Card' ? { ...m, enabled: false } : m)),
        { id: 'Swiggy Dineout', label: 'Swiggy (Dineout)', enabled: true, requires_screenshot: true, custom: true, show_to_guests: false },
    ],
};

describe('a mode saved in Settings reaches every picker that takes money', () => {
    const config = readPaymentMethods(SETTINGS_AFTER_ADD.payment_methods);

    test('the Orders settle submenu and the split dialog: label shown, id sent, gateway and switched-off modes absent', () => {
        const till = tillPaymentOptions(config);
        expect(till).toContainEqual({ value: 'Swiggy Dineout', label: 'Swiggy (Dineout)', requiresScreenshot: true });
        expect(till.map((o) => o.value)).not.toContain('Card');
        expect(till.map((o) => o.value)).not.toContain('Razorpay');
        expect(till.map((o) => o.value)).toEqual(['Upi', 'Cash', 'Dineout', 'Zomato', 'Eazydiner', 'District', 'Swiggy Dineout']);
    });

    test('the tender form offers it too (and keeps the lone-gateway option)', () => {
        const tender = tenderPaymentOptions(config).map((o) => o.value);
        expect(tender).toContain('Swiggy Dineout');
        expect(tender).toContain('Razorpay');
        expect(tender).not.toContain('Card');
    });

    test('the closed-bills filter lists every configured mode, switched off or not, plus Split and NC', () => {
        const filter = closedBillMethodFilterOptions(config);
        expect(filter).toContainEqual({ value: 'Swiggy Dineout', label: 'Swiggy (Dineout)' });
        expect(filter.map((o) => o.value)).toContain('Card');
        // Neither is a mode; both are stored on bills an owner looks for. NC is
        // a bill settled as non-chargeable (backend migration 052).
        expect(filter.slice(-2)).toEqual([
            { value: 'Split', label: 'Split' },
            { value: 'NC', label: 'Non-chargeable (NC)' },
        ]);
    });

    test('the NC marker has one name wherever a stored method is shown, and is still never a mode', () => {
        expect(paymentMethodLabel('NC', config)).toBe('Non-chargeable (NC)');
        expect(paymentMethodLabel(' nc ', config)).toBe('Non-chargeable (NC)');
        expect(tillPaymentOptions(config).map((o) => o.value)).not.toContain('NC');
        expect(tenderPaymentOptions(config).map((o) => o.value)).not.toContain('NC');
    });

    test('its screenshot rule is its own, and the built-ins keep theirs through their aliases', () => {
        expect(methodNeedsScreenshot('Swiggy Dineout', config)).toBe(true);
        expect(methodNeedsScreenshot('swiggy dineout', config)).toBe(true);
        expect(methodNeedsScreenshot('Dine Out', config)).toBe(true);
        expect(methodNeedsScreenshot('Zomato Pay', config)).toBe(true);
        expect(methodNeedsScreenshot('Cash', config)).toBe(false);
        expect(methodNeedsScreenshot('Split', config)).toBe(false);
    });

    test('a stored method reads by its label; an unknown one by itself', () => {
        expect(paymentMethodLabel('Upi', config)).toBe('UPI');
        expect(paymentMethodLabel('Swiggy Dineout', config)).toBe('Swiggy (Dineout)');
        expect(paymentMethodLabel('Legacy', config)).toBe('Legacy');
        expect(paymentMethodLabel(null, config)).toBe('');
    });
});

describe('a settle is never blocked by a settings read', () => {
    test.each([undefined, null, [], 'nonsense', [{ nope: true }]])('%p reads as the server defaults', (raw) => {
        const config = readPaymentMethods(raw);
        expect(config.map((m) => m.id)).toEqual(DEFAULT_PAYMENT_METHODS.map((m) => m.id));
        // …which is exactly the till the server settles with for a tenant with no config.
        expect(tillPaymentOptions(config).map((o) => o.value)).toEqual(['Upi', 'Cash', 'Card', 'Dineout', 'Zomato', 'Eazydiner', 'District']);
    });

    test('the defaults ask for a screenshot on exactly the four the server demands one for', () => {
        const config = readPaymentMethods(undefined);
        expect(tillPaymentOptions(config).filter((o) => o.requiresScreenshot).map((o) => o.value))
            .toEqual(['Dineout', 'Zomato', 'Eazydiner', 'District']);
    });
});

describe('the split dialog', () => {
    const till = tillPaymentOptions(readPaymentMethods(SETTINGS_AFTER_ADD.payment_methods));

    test('opens on Cash + the next mode the restaurant actually takes (Card is off here)', () => {
        expect(splitDefaultRows(till, 1380)).toEqual([
            { method: 'Cash', amount: '1380.00' },
            { method: 'Upi', amount: '0.00' },
        ]);
        expect(splitDefaultRows(tillPaymentOptions(readPaymentMethods(undefined)), null)).toEqual([
            { method: 'Cash', amount: '' },
            { method: 'Card', amount: '0.00' },
        ]);
    });

    test('a new row starts on a mode not yet used', () => {
        expect(nextSplitMethod(till, [{ method: 'Cash' }, { method: 'Upi' }])).toBe('Dineout');
    });

    test('six parts, the server ceiling', () => {
        expect(MAX_SPLIT_PARTS).toBe(6);
    });

    test('a part in a mode that needs a screenshot is named, so the dialog asks for one', () => {
        const config = readPaymentMethods(SETTINGS_AFTER_ADD.payment_methods);
        expect(splitScreenshotLabels([{ method: 'Cash', amount: '1.00' }, { method: 'Zomato', amount: '999.00' }], config)).toEqual(['Zomato']);
        expect(splitScreenshotLabels([
            { method: 'Swiggy Dineout', amount: 5 }, { method: 'zomato', amount: 3 }, { method: 'Zomato', amount: 2 },
        ], config)).toEqual(['Swiggy (Dineout)', 'Zomato']);
        expect(splitScreenshotLabels([{ method: 'Cash', amount: '1.00' }, { method: 'Upi', amount: '9.00' }], config)).toEqual([]);
        // A row left at 0.00 is dropped before the split is sent, so it asks for nothing.
        expect(splitScreenshotLabels([{ method: 'Cash', amount: '10.00' }, { method: 'Zomato', amount: '0.00' }], config)).toEqual([]);
        // The owner's switch decides.
        const off = readPaymentMethods(DEFAULT_PAYMENT_METHODS.map((m) => (m.id === 'Zomato' ? { ...m, requires_screenshot: false } : m)));
        expect(splitScreenshotLabels([{ method: 'Cash', amount: 1 }, { method: 'Zomato', amount: 9 }], off)).toEqual([]);
    });
});

describe('reports read the owner\'s label, and keep keying on the id', () => {
    test('label when the server sent one, the stored id otherwise', () => {
        expect(reportModeName({ method: 'Dineout', label: 'Swiggy Dineout' })).toBe('Swiggy Dineout');
        expect(reportModeName({ method: 'Upi' })).toBe('Upi');
        expect(reportModeName({ method: 'Other', label: '  ' })).toBe('Other');
        expect(reportModeName({ method: 'Cash', label: null })).toBe('Cash');
    });
});

describe('naming a new mode — the editor says what the server will say', () => {
    const config = readPaymentMethods(SETTINGS_AFTER_ADD.payment_methods);

    test.each(['Complimentary', 'NC', 'n/c', 'Staff meal', 'Non-Chargeable'])('%s points at Mark as non-chargeable', (n) => {
        expect(newPaymentModeRefusal(n, config)).toMatch(/Mark as non-chargeable/);
    });
    test.each(['Credit', 'On account', 'Due', 'Pay later'])('%s would close a bill as paid with no money', (n) => {
        expect(newPaymentModeRefusal(n, config)).toMatch(/no money has arrived/);
    });
    // The same whole-word cases the server's suite pins (jest-tests/payment_methods.test.ts).
    test.each(['Staff Meals', 'Complimentary Meal', 'Comps', 'FOC', 'Non Chargeable Bill', 'Guest (Comp)', 'Staff-Meal Friday', 'NonChargeable'])(
        '%s is still a comp', (n) => {
            expect(notMoneyKind(n)).toBe('comp');
            expect(newPaymentModeRefusal(n, config)).toMatch(/Mark as non-chargeable/);
        });
    test.each(['On Credit', 'Due Payment', 'Credit/Due', 'Customer Credit', 'Pay Later - Regulars', 'PayLater', 'On Account (Corporate)'])(
        '%s is still money that has not arrived', (n) => {
            expect(notMoneyKind(n)).toBe('credit');
            expect(newPaymentModeRefusal(n, config)).toMatch(/no money has arrived/);
        });
    test('whole words, not letters — and a credit CARD is money', () => {
        for (const n of ['Credit Card', 'HDFC Credit/Debit Card', 'Credit Cards (Visa)', 'Company Card', 'Compass Pay', 'Duet Pay', 'NCB Bank', 'Focus Wallet', 'Staffing Co']) {
            expect(notMoneyKind(n)).toBeNull();
            expect(newPaymentModeRefusal(n, config)).toBeNull();
        }
        expect(notMoneyKind('Card Credit')).toBe('credit');
        expect(paymentLabelRefusal('Staff Meals', 'Swiggy Dineout', config)).toMatch(/non-chargeable/);
        expect(paymentLabelRefusal('Card on Credit', 'Card', config)).toMatch(/no money has arrived/);
    });
    test.each(['Split', 'Other', 'Unallocated'])('%s is a report row', (n) => {
        expect(newPaymentModeRefusal(n, config)).toMatch(/reports already use/);
    });
    test.each(['Zomato Pay', 'dine-out', 'UPI', 'Razorpay'])('%s is already built in', (n) => {
        expect(newPaymentModeRefusal(n, config)).toMatch(/built-in/);
    });

    test('charset, length, duplicates (including a switched-off one) and the cap', () => {
        expect(newPaymentModeRefusal('Swiggy;Dineout', config)).toMatch(/characters/);
        expect(newPaymentModeRefusal('x'.repeat(33), config)).toMatch(/too long/);
        expect(newPaymentModeRefusal('swiggy-dineout', config)).toMatch(/already has/);
        const off = readPaymentMethods([...DEFAULT_PAYMENT_METHODS, { id: 'Magicpin', label: 'Magicpin', enabled: false, requires_screenshot: false, custom: true }]);
        expect(newPaymentModeRefusal('magicpin', off)).toMatch(/switched off/);
        const full = readPaymentMethods([
            ...DEFAULT_PAYMENT_METHODS,
            ...Array.from({ length: MAX_CUSTOM_PAYMENT_MODES }, (_, i) => ({ id: `Mode ${String(i)}`, label: `Mode ${String(i)}`, enabled: true, requires_screenshot: false, custom: true })),
        ]);
        expect(newPaymentModeRefusal('One more', full)).toMatch(/at most 24/);
        expect(newPaymentModeRefusal('Magicpin', config)).toBeNull();
        expect(newPaymentModeRefusal('Credit Card (Amex)', config)).toBeNull();
    });

    test('labels', () => {
        expect(paymentLabelRefusal('Complimentary', 'Swiggy Dineout', config)).toMatch(/non-chargeable/);
        expect(paymentLabelRefusal('Cash', 'Upi', config)).toMatch(/built-in Cash/);
        expect(paymentLabelRefusal('Zomato Pay', 'Zomato', config)).toBeNull();
        expect(paymentLabelRefusal('UPI', 'Swiggy Dineout', config)).toMatch(/built-in Upi|already used/);
        expect(paymentLabelRefusal('', 'Dineout', config)).toBeNull();
    });

    test('what the editor saves for a new mode: permanent tidy id, label = name, flags as ticked', () => {
        const next = withCustomPaymentMode(readPaymentMethods(undefined), { name: '  Swiggy   Dineout ', requiresScreenshot: true, showToGuests: false });
        expect(next[next.length - 1]).toEqual({ id: 'Swiggy Dineout', label: 'Swiggy Dineout', enabled: true, requires_screenshot: true, custom: true, show_to_guests: false });
        expect(next).toHaveLength(DEFAULT_PAYMENT_METHODS.length + 1);
    });
});

describe('WIRED: the pickers read the config and keep no list of their own', () => {
    const orders = source('src/app/dashboard/orders/page.tsx');
    const capture = source('src/app/dashboard/orders/capture-actions.tsx');
    const closed = source('src/components/closed-bills.tsx');
    const mis = source('src/lib/mis-capture.ts');
    const settings = source('src/app/dashboard/settings/settings-form.tsx');
    const card = source('src/app/dashboard/settings/payment-methods-settings.tsx');
    const db = source('src/lib/db.ts');

    test('Orders: the settle submenu and split dialog are built from tillPaymentOptions', () => {
        expect(orders).toContain('usePaymentMethods(user?.restaurantUsername)');
        expect(orders).toContain('tillOptions.map((option) => (');
        expect(orders).toContain('tillOptions.map((o) => (');
        expect(orders).toContain('splitRows.length < MAX_SPLIT_PARTS');
        expect(orders).toContain('methodNeedsScreenshot(paymentMethod, paymentMethods)');
        // The lists that drifted from the server are gone.
        expect(orders).not.toMatch(/PAYMENT_METHOD_OPTIONS|PROOF_REQUIRED_METHODS/);
        expect(orders).not.toMatch(/^\s*"Online Transfer",/m);
        expect(orders).not.toContain('["Cash", "Upi", "Card"]');
    });

    test('the tender form is built from tenderPaymentOptions', () => {
        expect(capture).toContain('tenderPaymentOptions(paymentMethods)');
        expect(capture).not.toContain('TENDER_METHODS');
        expect(mis).not.toMatch(/'Wallet', 'Bank Transfer', 'Voucher'/);
    });

    test('the closed-bills filter is built from the config', () => {
        expect(closed).toContain('closedBillMethodFilterOptions(paymentMethods)');
        expect(closed).not.toMatch(/const PAYMENT_METHODS = \[/);
    });

    test('Settings mounts the editor, and the editor saves through savePaymentMethods', () => {
        expect(settings).toContain('<PaymentMethodsCard');
        expect(card).toContain('savePaymentMethods(restaurantId');
        expect(card).toContain('withCustomPaymentMode(');
    });

    test('the split dialog asks for the screenshot a part needs, and sends it', () => {
        const start = orders.indexOf('const submitSplitPayment = async');
        const body = orders.slice(start, orders.indexOf('const refreshOrders = async', start));
        expect(body).toContain('splitScreenshotLabels(splits, paymentMethods)');
        expect(body).toContain('pickPaymentProofScreenshot()');
        expect(body).toContain('"Split", splitProofUrl, splits, { settledWithStalePaper: view.staleWarning !== null })');
        expect(body).not.toContain('"Split", null, splits)');
    });

    test('Accounting and the settlement card show the label the server attached', () => {
        const accounting = source('src/app/dashboard/accounting/page.tsx');
        expect(accounting).toContain('{reportModeName(m)}');
        expect(accounting).toContain('{reportModeName(r)}');
        expect(accounting).not.toMatch(/font-medium">\{m\.method\}/);
        expect(accounting).not.toMatch(/font-medium">\{r\.method\}/);
        // …while the reconciliation save still keys on the id.
        expect(accounting).toContain('void save(r.method)');
        const card = source('src/app/dashboard/analytics/settlement-breakdown.tsx');
        expect(card).toContain('{m.label}');
        expect(db).toMatch(/by_method: \{ method: string; label\?: string; sales: number; bills: number \}\[\]/);
    });

    test('the Payment modes card never submits the profile form it sits inside', () => {
        // It is mounted inside SettingsForm's <form>; a <button> with no type submits it.
        expect(settings.indexOf('<PaymentMethodsCard')).toBeGreaterThan(settings.indexOf('<form'));
        expect(settings.indexOf('<PaymentMethodsCard')).toBeLessThan(settings.indexOf('</form>'));
        const buttons = card.match(/<Button\b[^>]*>/g) ?? [];
        expect(buttons.length).toBeGreaterThanOrEqual(3);
        for (const b of buttons) {expect(b).toContain('type="button"');}
        // Enter in the new-mode name adds the mode instead of submitting the form.
        const nameInput = card.slice(card.indexOf('id="new-payment-mode"'), card.indexOf('{addRefusal ?'));
        expect(nameInput).toContain('onKeyDown');
        expect(nameInput).toContain('e.preventDefault()');
        expect(nameInput).toContain('void add()');
    });

    test('the save posts ONLY payment_methods (settings POST is merge-on-omit)', () => {
        const start = db.indexOf('export const savePaymentMethods');
        const body = db.slice(start, db.indexOf('\n};', start));
        expect(body).toContain('JSON.stringify({ payment_methods: methods })');
    });
});
