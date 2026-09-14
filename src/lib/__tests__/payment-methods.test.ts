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
    paymentLabelRefusal,
    paymentMethodLabel,
    readPaymentMethods,
    splitDefaultRows,
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

    test('the closed-bills filter lists every configured mode, switched off or not, plus Split', () => {
        const filter = closedBillMethodFilterOptions(config);
        expect(filter).toContainEqual({ value: 'Swiggy Dineout', label: 'Swiggy (Dineout)' });
        expect(filter.map((o) => o.value)).toContain('Card');
        expect(filter[filter.length - 1]).toEqual({ value: 'Split', label: 'Split' });
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
});

describe('naming a new mode — the editor says what the server will say', () => {
    const config = readPaymentMethods(SETTINGS_AFTER_ADD.payment_methods);

    test.each(['Complimentary', 'NC', 'n/c', 'Staff meal', 'Non-Chargeable'])('%s points at Mark as non-chargeable', (n) => {
        expect(newPaymentModeRefusal(n, config)).toMatch(/Mark as non-chargeable/);
    });
    test.each(['Credit', 'On account', 'Due', 'Pay later'])('%s would close a bill as paid with no money', (n) => {
        expect(newPaymentModeRefusal(n, config)).toMatch(/no money has arrived/);
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

    test('the save posts ONLY payment_methods (settings POST is merge-on-omit)', () => {
        const start = db.indexOf('export const savePaymentMethods');
        const body = db.slice(start, db.indexOf('\n};', start));
        expect(body).toContain('JSON.stringify({ payment_methods: methods })');
    });
});
