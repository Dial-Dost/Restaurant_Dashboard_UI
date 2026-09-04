// What these tests are actually protecting.
//
// The capture screens are the only way a restaurant can record a comp, a void
// reason, a service-charge waiver, a tip or a till. Four promises are expensive
// to break there, and all four are decidable by value:
//
//   1. EVERY OPTION A PICKER OFFERS IS ONE THE SERVER ACCEPTS. Migrations
//      034-039 put a CHECK constraint behind each vocabulary. A dropdown that
//      offers a seventh void reason produces a 400 in front of a guest.
//   2. THE CONTROLS DEGRADE HONESTLY. The three control acts are manager-only by
//      default; a waiter without the permission must be told, not 403'd on tap.
//   3. A TIP IS NOT A TENDER. It rides on the same row and is never added to the
//      amount that settles the bill — the wire shape is where that survives or
//      dies.
//   4. THE FORM NEVER SECOND-GUESSES THE SERVER'S MONEY. What is typed is a fact
//      about the screen; what is owed is the server's `outstanding`.
//
// Everything below is pure: fixed values in, values out. No DOM, no fetch.

import {
    COUNTER_KINDS,
    MAX_BILL_TENDERS,
    MENU_GROUP_KINDS,
    NON_CHARGEABLE_KINDS,
    PERM_NON_CHARGEABLE,
    PERM_SERVICE_CHARGE_WAIVER,
    PERM_VOID_ORDER,
    SERVICE_CHARGE_WAIVER_KINDS,
    TIP_MODES,
    VOID_KINDS,
    VOID_STAGE_LABELS,
    canPartiallyComp,
    compPreviewValue,
    draftTenderTotal,
    draftTipTotal,
    emptyTenderDraft,
    formatAmount,
    hasPermission,
    humaniseToken,
    isUnsplittableMethod,
    parseMoney,
    remainderForRow,
    tenderFormRefusal,
    tendersForWire,
    vocabularyOption,
    type CompCandidate,
    type TenderDraft,
} from '../mis-capture';

// The vocabularies exactly as migrations 034-039 CHECK them, and as the
// backend's own `mis_capture.ts` lists them. Restated here as literals rather
// than imported, because the point of the test is to catch this module drifting
// away from that file — importing it would make the two agree by construction.
const BACKEND_NON_CHARGEABLE_KINDS = [
    'complimentary', 'staff_meal', 'spoilage', 'tasting', 'guest_complaint', 'promo',
];
const BACKEND_VOID_KINDS = [
    'wrong_entry', 'guest_changed_mind', 'kitchen_error', 'duplicate', 'test_order',
    'item_unavailable', 'other',
];
const BACKEND_SERVICE_CHARGE_WAIVER_KINDS = [
    'guest_request', 'guest_complaint', 'goodwill', 'staff_meal', 'policy', 'other',
];
const BACKEND_TIP_MODES = ['cash', 'card', 'upi', 'wallet', 'other'];
const BACKEND_COUNTER_KINDS = ['counter', 'terminal'];
const BACKEND_MENU_GROUP_KINDS = ['revenue', 'production'];
const BACKEND_VOID_STAGES = ['before_print', 'after_print', 'after_bill'];

describe('the controlled vocabularies match the CHECK constraints behind them', () => {
    it('offers exactly the values migrations 034-039 accept, in the same order', () => {
        expect(NON_CHARGEABLE_KINDS.map((o) => o.value)).toEqual(BACKEND_NON_CHARGEABLE_KINDS);
        expect(VOID_KINDS.map((o) => o.value)).toEqual(BACKEND_VOID_KINDS);
        expect(SERVICE_CHARGE_WAIVER_KINDS.map((o) => o.value)).toEqual(BACKEND_SERVICE_CHARGE_WAIVER_KINDS);
        expect(TIP_MODES.map((o) => o.value)).toEqual(BACKEND_TIP_MODES);
        expect(COUNTER_KINDS.map((o) => o.value)).toEqual(BACKEND_COUNTER_KINDS);
        expect(MENU_GROUP_KINDS.map((o) => o.value)).toEqual(BACKEND_MENU_GROUP_KINDS);
    });

    it('gives every option a label and a hint, so no picker shows a raw enum', () => {
        const all = [
            ...NON_CHARGEABLE_KINDS, ...VOID_KINDS, ...SERVICE_CHARGE_WAIVER_KINDS,
            ...TIP_MODES, ...COUNTER_KINDS, ...MENU_GROUP_KINDS,
        ];
        for (const o of all) {
            expect(o.label.length).toBeGreaterThan(0);
            expect(o.label).not.toContain('_');
            expect(o.hint.length).toBeGreaterThan(0);
        }
    });

    it('has a label for every void stage the server can derive', () => {
        // The stage is DERIVED server-side and only ever displayed. A stage the
        // server can return and this build cannot name would render as a blank on
        // the one column an auditor reads a void for.
        for (const stage of BACKEND_VOID_STAGES) {
            expect(VOID_STAGE_LABELS[stage]?.label.length ?? 0).toBeGreaterThan(0);
            expect(VOID_STAGE_LABELS[stage]?.hint.length ?? 0).toBeGreaterThan(0);
        }
        expect(Object.keys(VOID_STAGE_LABELS).sort()).toEqual([...BACKEND_VOID_STAGES].sort());
    });

    it('resolves a token to its option, and refuses one that is not in the list', () => {
        expect(vocabularyOption(VOID_KINDS, 'duplicate')?.label).toBe('Duplicate');
        expect(vocabularyOption(VOID_KINDS, 'because_i_said_so')).toBeNull();
        expect(vocabularyOption(VOID_KINDS, null)).toBeNull();
    });

    it('renders a token this build has never heard of as words, never as a blank', () => {
        // The server may grow a vocabulary before this client ships again. A row
        // showing an empty cell would read as "not captured", which is a lie about
        // a control ledger that captured it fine.
        expect(humaniseToken('guest_complaint', NON_CHARGEABLE_KINDS)).toBe('Guest complaint');
        expect(humaniseToken('brand_new_reason', NON_CHARGEABLE_KINDS)).toBe('Brand new reason');
        expect(humaniseToken('brand_new_reason')).toBe('Brand new reason');
        expect(humaniseToken(null)).toBe('—');
        expect(humaniseToken('')).toBe('—');
    });
});

describe('the control permissions', () => {
    it('are the three the backend gates the capture routes on', () => {
        expect(PERM_NON_CHARGEABLE).toBe('b4e7a1c9-2d58-4f36-9a07-5c81e3b0d472');
        expect(PERM_VOID_ORDER).toBe('c1f83b26-5a97-4e40-b8d3-7e02a9c4f156');
        expect(PERM_SERVICE_CHARGE_WAIVER).toBe('d5a06e73-9c41-4b28-8f6a-1b74d3e08c95');
    });

    it('are three SEPARATE grants, never one', () => {
        // A restaurant that lets a floor manager comp a dessert does not
        // necessarily let them waive 10% off a ₹40,000 bill. Holding one must
        // never imply another.
        const compOnly = [PERM_NON_CHARGEABLE];
        expect(hasPermission(compOnly, PERM_NON_CHARGEABLE)).toBe(true);
        expect(hasPermission(compOnly, PERM_VOID_ORDER)).toBe(false);
        expect(hasPermission(compOnly, PERM_SERVICE_CHARGE_WAIVER)).toBe(false);
    });

    it('treats "*" as admin and an unloaded session as denied', () => {
        expect(hasPermission(['*'], PERM_VOID_ORDER)).toBe(true);
        // NOT optimistic. A control that appears while the action list is still
        // loading and then 403s on tap teaches the user the buttons are a lie.
        expect(hasPermission(undefined, PERM_VOID_ORDER)).toBe(false);
        expect(hasPermission(null, PERM_VOID_ORDER)).toBe(false);
        expect(hasPermission([], PERM_VOID_ORDER)).toBe(false);
        expect(hasPermission('*', PERM_VOID_ORDER)).toBe(false);
    });
});

describe('money boxes: an empty box is not a zero', () => {
    it('reads a typed amount to the paisa', () => {
        expect(parseMoney('1200')).toBe(1200);
        expect(parseMoney(' 1200.55 ')).toBe(1200.55);
        expect(parseMoney('0')).toBe(0);
    });

    it('returns null for a box nobody filled in, and for text', () => {
        // "The guest paid nothing on this row" and "this row is untouched" are
        // different states. Collapsing them either submits a zero tender the
        // server refuses or silently drops a row someone meant to fill.
        expect(parseMoney('')).toBeNull();
        expect(parseMoney('   ')).toBeNull();
        expect(parseMoney('abc')).toBeNull();
        expect(parseMoney('1,200')).toBeNull();
    });

    it('formats to two decimals always, because paise reconcile', () => {
        expect(formatAmount(1234.5)).toBe('₹1,234.50');
        expect(formatAmount(0)).toBe('₹0.00');
        expect(formatAmount(-40.4)).toBe('-₹40.40');
        expect(formatAmount(null)).toBe('—');
        expect(formatAmount('')).toBe('—');
    });
});

describe('the tender form', () => {
    const row = (over: Partial<TenderDraft>): TenderDraft => ({ ...emptyTenderDraft(), ...over });

    it('sums what is typed without floating-point drift', () => {
        const rows = [row({ amount: '0.1' }), row({ amount: '0.2' })];
        // 0.1 + 0.2 in floats is 0.30000000000000004; a settle form that showed
        // that next to a bill total is a support ticket.
        expect(draftTenderTotal(rows)).toBe(0.3);
    });

    it('keeps the tip out of the amount that settles the bill', () => {
        const rows = [row({ amount: '1000', tip_amount: '100', tip_mode: 'cash' })];
        expect(draftTenderTotal(rows)).toBe(1000);
        expect(draftTipTotal(rows)).toBe(100);
        const wire = tendersForWire(rows);
        expect(wire).toHaveLength(1);
        expect(wire[0]?.amount).toBe(1000);
        expect(wire[0]?.tip_amount).toBe(100);
    });

    it('drops untouched rows and never invents a zero tender', () => {
        const rows = [row({ amount: '500' }), row({ amount: '' }), row({ amount: '0' })];
        const wire = tendersForWire(rows);
        expect(wire).toHaveLength(1);
        expect(wire[0]?.amount).toBe(500);
    });

    it('omits an empty tip rather than sending tip_amount: 0', () => {
        const wire = tendersForWire([row({ amount: '500', tip_mode: 'cash' })]);
        expect(wire[0]).toEqual({ method: 'Cash', amount: 500 });
        expect('tip_amount' in (wire[0] ?? {})).toBe(false);
        // A tip mode with no tip is not a tip, and sending it would put a mode on
        // a zero row in the tip ledger.
        expect('tip_mode' in (wire[0] ?? {})).toBe(false);
    });

    it('carries a tip destination but NEVER an actor', () => {
        const wire = tendersForWire([
            row({ amount: '500', tip_amount: '50', tip_mode: 'card', tip_credited_to: 'ravi' }),
        ]);
        expect(wire[0]?.tip_credited_to_username).toBe('ravi');
        // Who TOOK the payment comes from the verified session. There is no body
        // key for it and this form must never grow one — a till that could name
        // its own cashier could sign someone else's settlement.
        expect(Object.keys(wire[0] ?? {})).not.toContain('settled_by_username');
        expect(Object.keys(wire[0] ?? {})).not.toContain('settled_by_employee_id');
        expect(Object.keys(wire[0] ?? {})).not.toContain('actor');
    });

    it('refuses an empty form, and a tip that will not say how it arrived', () => {
        expect(tenderFormRefusal([row({ amount: '' })], 0)).toMatch(/at least one row/i);
        expect(tenderFormRefusal([row({ amount: '500', tip_amount: '50' })], 0)).toMatch(/how it arrived/i);
        expect(tenderFormRefusal([row({ amount: '500', tip_amount: '50', tip_mode: 'cash' })], 0)).toBeNull();
    });

    it('stops at the six the whole chain agrees on, counting what the bill already carries', () => {
        const six = Array.from({ length: 6 }, () => row({ amount: '100' }));
        expect(tenderFormRefusal(six, 0)).toBeNull();
        expect(tenderFormRefusal(six, 1)).toMatch(/at most 6 payments/i);
        expect(tenderFormRefusal([row({ amount: '100' })], MAX_BILL_TENDERS)).toMatch(/at most 6 payments/i);
    });

    it('refuses a method that cannot be one of several payments, but allows it alone', () => {
        // A Razorpay tender alongside a cash one records fine and then cannot be
        // settled — a fully paid bill stranded open with the guest gone.
        expect(isUnsplittableMethod('Razorpay')).toBe(true);
        expect(isUnsplittableMethod('  split ')).toBe(true);
        expect(isUnsplittableMethod('Cash')).toBe(false);
        const mixed = [row({ method: 'Razorpay', amount: '600' }), row({ method: 'Cash', amount: '400' })];
        expect(tenderFormRefusal(mixed, 0)).toMatch(/on its own/i);
        expect(tenderFormRefusal([row({ method: 'Razorpay', amount: '1000' })], 0)).toBeNull();
        // Alone on the FORM but not alone on the BILL is still a split.
        expect(tenderFormRefusal([row({ method: 'Razorpay', amount: '1000' })], 1)).toMatch(/on its own/i);
    });

    it('prefills a row from the SERVER\'s outstanding, less the other rows on this form', () => {
        const rows = [row({ amount: '400' }), row({ amount: '' })];
        // 1000 is the server's figure; 400 is what this form has that the server
        // has not seen. Nothing here re-derives the bill.
        expect(remainderForRow(rows, 1, 1000)).toBe(600);
        // Nothing left to fill -> null, so the button disables instead of writing 0.
        expect(remainderForRow([row({ amount: '1000' }), row({ amount: '' })], 1, 1000)).toBeNull();
        expect(remainderForRow([row({ amount: '1200' }), row({ amount: '' })], 1, 1000)).toBeNull();
        // The row being filled is excluded from its own subtraction.
        expect(remainderForRow([row({ amount: '999' })], 0, 1000)).toBe(1000);
    });
});

describe('the comp preview', () => {
    const line = (over: Partial<CompCandidate>): CompCandidate => ({
        id: 'l1', name: 'Paneer Tikka', quantity: 3, price: 320,
        nc: false, nc_id: null, nc_kind: null, ...over,
    });

    it('shows the whole line when no quantity is given', () => {
        expect(compPreviewValue(line({}), null)).toBe(960);
    });

    it('shows the part when one is', () => {
        expect(compPreviewValue(line({}), 1)).toBe(320);
        expect(compPreviewValue(line({}), 2)).toBe(640);
    });

    it('never previews more than the line holds', () => {
        // The server refuses it too; showing a bigger giveaway than is possible
        // would put a wrong number in front of the manager approving it.
        expect(compPreviewValue(line({}), 9)).toBe(960);
        expect(compPreviewValue(line({}), 0)).toBe(960);
    });

    it('only offers a partial comp on a line that has more than one of the dish', () => {
        expect(canPartiallyComp(line({ quantity: 1 }))).toBe(false);
        expect(canPartiallyComp(line({ quantity: 2 }))).toBe(true);
    });
});
