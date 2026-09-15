// THE CAPTURE VOCABULARIES, THE CONTROL PERMISSIONS, AND THE SHAPE OF A TENDER.
//
// Migrations 034-039 gave this system six things it could not previously record:
// a comp, a void reason, a service-charge waiver, a split tender with a tip, the
// till a bill was rung on, and a menu group / price-point taxonomy. Every one of
// them is a CONTROLLED write — the server rejects a value outside its vocabulary
// with a 400 naming the allowed set — and every one of them is reached from a
// screen this module supports.
//
// WHAT THIS MODULE IS NOT
// -----------------------
// It does not do money. Not one figure the capture screens show is computed
// here. The saving on a service-charge waiver differs between the two tax shapes
// this fleet runs (GST rides on the charge in one and not the other), so it is
// taken from the server's own quote; the outstanding on a part-paid bill is the
// server's `outstanding`; the loss on a comp is the server's `value`. The only
// arithmetic below is `draftTenderTotal` — a sum of what is typed into a form,
// which is a fact about the screen and is labelled as such wherever it appears.
//
// PURE — no React, no fetch, no `window`. That is what lets
// `src/lib/__tests__/mis-capture.test.ts` pin the vocabularies and the wire
// shapes against the backend's own constants without driving a browser.
//
// WHY IT IS A PLAIN MODULE AND NOT IN db.ts: db.ts carries "use server" and may
// export ONLY async functions. A `export const NON_CHARGEABLE_KINDS = [...]`
// there is a build error that tsc and jest both wave through while every page
// 500s at runtime. `src/lib/table-assignment.ts` set that precedent and
// `src/lib/mis-reports.ts` follows it; so does this.

// --- The three control permissions -------------------------------------------
//
// MANAGER ONLY BY DEFAULT, and that is the whole reason they exist. All three
// acts REDUCE what a guest pays, and the permission every floor write already
// rides on ("Add Orders") is held by waiter, captain and cashier alike — so
// gating a comp on it would let any waiter comp their own friend's table. The
// backend grants these to the core `manager` role and to admin via "*".
//
// The ids are the backend's own (routes/_shared.ts). They are spelled out rather
// than fetched because a control that appears while its permission is being
// looked up, and then 403s on tap, is worse than one that appears a beat late.
/** PERM_NON_CHARGEABLE — "Mark Items Non-Chargeable" (Bills). */
export const PERM_NON_CHARGEABLE = 'b4e7a1c9-2d58-4f36-9a07-5c81e3b0d472';
/** PERM_VOID_ORDER — "Void Orders With Reason" (Orders). */
export const PERM_VOID_ORDER = 'c1f83b26-5a97-4e40-b8d3-7e02a9c4f156';
/** PERM_SERVICE_CHARGE_WAIVER — "Waive Service Charge" (Bills). */
export const PERM_SERVICE_CHARGE_WAIVER = 'd5a06e73-9c41-4b28-8f6a-1b74d3e08c95';
/** The permission GET/POST /bills/tenders, /bills/counter and GET /billing-counters ride on. */
export const PERM_RECORD_PAYMENT = '2393edd7-cdd9-439c-9ff3-d563d5216967';
/** PERM_SETTINGS — creating and renaming a till is configuration, not a floor act. */
export const PERM_SETTINGS = '6d0f3a94-8b21-4c67-9e53-1a4d7b2f8c60';
/** The menu pair the group / variation editor rides on. */
export const PERM_VIEW_MENU = 'f4177b38-77fa-4d8c-9fbd-c4f06bf28610';
export const PERM_EDIT_MENU = 'ed800655-b937-44ba-a7ca-7458295886c9';
/** ACCOUNTING_PERM — every /reports/* route, including GET /tips. */
export const PERM_ACCOUNTING = 'df75119b-e5f1-4f38-aba5-78a1cf182f56';

/**
 * Does this session hold a permission?
 *
 * `"*"` is admin. An action list that has not loaded yet is `false` — a control
 * that appears optimistically and then 403s on tap teaches the user that the
 * buttons on this screen are a lie, which is exactly what the honest-degrade
 * rule exists to prevent.
 */
export const hasPermission = (actions: unknown, permission: string): boolean =>
    Array.isArray(actions) && (actions.includes('*') || actions.includes(permission));

/** The sentence a disabled control shows instead of a 403. */
export const permissionDeniedReason = (what: string): string =>
    `Only a manager can ${what}. Ask a manager to sign in, or have your admin grant you this permission.`;

// --- The controlled vocabularies ---------------------------------------------
//
// Each mirrors a CHECK constraint in migrations 034-039 and the `as const` list
// the backend validates against in `mis_capture.ts`. They are restated here so a
// picker can only ever offer a value the server will accept — the alternative is
// a free-text box and a 400 the person at the till cannot act on.
//
// The LABELS are this module's own. The wire value is a snake_case token
// ("guest_complaint"); the backend renders it back with its own `humaniseVocabulary`
// for the reports, and these labels are the same words in the same order so the
// dropdown a manager picks from and the report their accountant reads agree.

export interface VocabularyOption {
    /** The token on the wire. Exactly what the CHECK constraint allows. */
    value: string;
    label: string;
    /** One line saying when this is the right choice, shown under the picker. */
    hint: string;
}

/** Why a dish was given away. 034's `nc_kind`. */
export const NON_CHARGEABLE_KINDS: readonly VocabularyOption[] = [
    { value: 'complimentary', label: 'Complimentary', hint: 'On the house — a gesture to this guest.' },
    { value: 'staff_meal', label: 'Staff meal', hint: 'Eaten by staff, not sold.' },
    { value: 'spoilage', label: 'Spoilage', hint: 'Made and not servable — dropped, burnt, sent back.' },
    { value: 'tasting', label: 'Tasting', hint: 'A sample given to the guest or to the trade.' },
    { value: 'guest_complaint', label: 'Guest complaint', hint: 'Taken off after something went wrong.' },
    { value: 'promo', label: 'Promotion', hint: 'Part of a running offer or a marketing giveaway.' },
] as const;

/** Why an order was voided. 035's `void_kind`. */
export const VOID_KINDS: readonly VocabularyOption[] = [
    { value: 'wrong_entry', label: 'Wrong entry', hint: 'Rung up in error — wrong table, wrong dish.' },
    { value: 'guest_changed_mind', label: 'Guest changed their mind', hint: 'Cancelled by the guest before it was wanted.' },
    { value: 'kitchen_error', label: 'Kitchen error', hint: 'The kitchen could not make it as ordered.' },
    { value: 'duplicate', label: 'Duplicate', hint: 'The same order was already placed.' },
    { value: 'test_order', label: 'Test order', hint: 'Placed to check a printer or a screen.' },
    { value: 'item_unavailable', label: 'Item unavailable', hint: 'Out of stock after the order was taken.' },
    { value: 'other', label: 'Other', hint: 'None of the above — say what happened in the reason.' },
] as const;

/** Why a service charge came off. 036's `waiver_kind`. */
export const SERVICE_CHARGE_WAIVER_KINDS: readonly VocabularyOption[] = [
    { value: 'guest_request', label: 'Guest asked', hint: 'The guest asked for it to be removed.' },
    { value: 'guest_complaint', label: 'Guest complaint', hint: 'Removed after something went wrong.' },
    { value: 'goodwill', label: 'Goodwill', hint: 'A gesture the house chose to make.' },
    { value: 'staff_meal', label: 'Staff meal', hint: 'Staff eating in — no service charge applies.' },
    { value: 'policy', label: 'House policy', hint: 'This order type never carries a service charge.' },
    { value: 'other', label: 'Other', hint: 'None of the above — say what happened in the reason.' },
] as const;

/** How a tip arrived. 037's `tip_mode`. */
export const TIP_MODES: readonly VocabularyOption[] = [
    { value: 'cash', label: 'Cash', hint: 'Left on the table or handed over.' },
    { value: 'card', label: 'Card', hint: 'Added on the card machine.' },
    { value: 'upi', label: 'UPI', hint: 'Sent by UPI.' },
    { value: 'wallet', label: 'Wallet', hint: 'Paid through a wallet app.' },
    { value: 'other', label: 'Other', hint: 'Anything else.' },
] as const;

/** A billing point, or a device that rings for one. 038's `kind`. */
export const COUNTER_KINDS: readonly VocabularyOption[] = [
    { value: 'counter', label: 'Counter', hint: 'A billing point — a till with a drawer.' },
    { value: 'terminal', label: 'Terminal', hint: 'A device that rings up to a counter.' },
] as const;

/** The two axes a menu group classifies on. 039's `kind`. */
export const MENU_GROUP_KINDS: readonly VocabularyOption[] = [
    { value: 'revenue', label: 'Revenue', hint: 'How the money is cut — Food, Beverage, Liquor, Tobacco.' },
    { value: 'production', label: 'Production', hint: 'Where the food is made — Kitchen, Bar, Bakery.' },
] as const;

/**
 * The three void stages, DERIVED SERVER-SIDE and shown, never asked.
 *
 * 035 derives the stage from facts the client cannot reach — whether a bill
 * exists, whether the order was barked, whether a KOT print job went out —
 * precisely because the person whose void it is has an obvious interest in it
 * reading "before_print". So there is no picker for this anywhere in the UI, and
 * these labels exist only to render what the server decided.
 */
export const VOID_STAGE_LABELS: Readonly<Record<string, { label: string; hint: string }>> = {
    before_print: {
        label: 'Before print',
        hint: 'No bill and no evidence the kitchen had it. Nothing was committed.',
    },
    after_print: {
        label: 'After print',
        hint: 'The kitchen had this ticket — real food was committed before it was voided.',
    },
    after_bill: {
        label: 'After bill',
        hint: 'A bill already existed for this table, so the guest could have seen the charge.',
    },
};

/** Look a token up in a vocabulary. Null when it is not one of them. */
export const vocabularyOption = (
    options: readonly VocabularyOption[],
    value: string | null | undefined,
): VocabularyOption | null => options.find((o) => o.value === value) ?? null;

/**
 * A token as a person reads it.
 *
 * Falls back to the token with its underscores opened out and its first letter
 * capitalised — the same shape the backend's `humaniseVocabulary` produces — so
 * a value this build has never heard of (a vocabulary the server grew after this
 * release) still renders as words rather than as a raw enum or as a blank.
 */
export const humaniseToken = (
    value: string | null | undefined,
    options?: readonly VocabularyOption[],
): string => {
    if (value === null || value === undefined || value === '') {return '—';}
    if (options) {
        const found = vocabularyOption(options, value);
        if (found) {return found.label;}
    }
    const words = value.replace(/_/g, ' ').trim();
    return words.length === 0 ? '—' : words.charAt(0).toUpperCase() + words.slice(1);
};

// --- Record shapes on the wire -----------------------------------------------
// Mirrors of the backend's NonChargeableRecord / OrderVoidRecord /
// ServiceChargeWaiverRecord / BillTenderRecord / BillTenderState /
// BillingCounterRecord / MenuGroupRecord / MenuVariationRecord.

export interface NonChargeableRecord {
    id: string;
    created_at: string;
    order_id: string;
    item_id: string;
    item_name: string;
    nc_kind: string;
    reason: string;
    quantity: number;
    unit_price: number;
    /** The menu's list price at the moment of the comp. Null when the dish no longer resolves. */
    menu_price_at_nc: number | null;
    /** quantity x unit_price — the money the guest would otherwise have paid. */
    value: number;
    marked_by_username: string;
    authorised_by_username: string;
    reversed_at: string | null;
    reversed_by_username: string | null;
    reversal_reason: string | null;
}

export interface OrderVoidRecord {
    id: string;
    order_id: string;
    scope: 'order' | 'item';
    voided_at: string;
    void_kind: string;
    reason: string;
    /** DERIVED SERVER-SIDE from evidence the client cannot see. Displayed, never asked. */
    stage: string;
    stage_evidence: Record<string, unknown>;
    value_voided: number;
    voided_by_username: string;
    authorised_by_username: string;
}

export interface ServiceChargeWaiverRecord {
    id: string;
    bill_id: string;
    waived_at: string;
    /** Which of the two tax shapes carried the charge. */
    basis: 'restaurant_percent' | 'tax_line';
    basis_percent: number;
    basis_amount: number;
    amount_waived: number;
    tax_on_waived: number;
    /** amount_waived + tax_on_waived — what the guest does not pay. The server's own figure. */
    grand_total_reduction: number;
    waiver_kind: string;
    reason: string;
    waived_by_username: string;
    authorised_by_username: string;
    reversed_at: string | null;
    reversed_by_username: string | null;
    reversal_reason: string | null;
}

// --- Remove service charge & print (client item 6) ---------------------------
//
// "Reprint without service charge and waive service charge should be merged as
// one option instead of being 2 separate steps." The waiver and the print are
// ONE server call now, POST /bills/service-charge-waiver/print, which answers
// every refusal before it writes anything and prints from the bill as it stands
// after the waiver commits. Everything below reads that route's answer; none of
// it decides anything about money.

/** What POST /bills/service-charge-waiver/print answers with `render: "client"`. */
export interface RemoveServiceChargeAndPrintResult {
    success: boolean;
    /** The live waiver now on the bill — the one just recorded, or the one reprinted. */
    waiver: ServiceChargeWaiverRecord | null;
    /** False when the bill already carried a waiver (or another device won the race) and was only reprinted. */
    waiver_created: boolean;
    /** What the guest was asked for before THIS waiver. Null on a reprint. */
    grand_total_before: number | null;
    /** What is on the paper when there is paper; the waiver's own figure when the print failed. */
    grand_total_after: number | null;
    service_charge_removed: boolean;
    printed: boolean;
    print_error?: string;
    render?: 'thermal' | 'client';
    /** The server's priced bill for the browser to render — the claim's own `printable_bill`. */
    printable_bill?: Record<string, unknown> | null;
    print_count?: number;
}

const SERVICE_CHARGE_LINE = /service\s*charge/i;

/**
 * The service charge on an open bill, in both shapes — a HEADLINE for the form,
 * never a figure anybody is charged. The percent leg plus any tax line whose
 * name the server would call a service charge.
 */
export const serviceChargeOnBill = (bill: { service_charge?: unknown; taxes?: unknown } | null | undefined): number => {
    if (!bill) {return 0;}
    let paise = Math.round((Number(bill.service_charge) || 0) * 100);
    for (const t of Array.isArray(bill.taxes) ? bill.taxes : []) {
        const line = (t ?? {}) as { name?: unknown; amount?: unknown };
        if (typeof line.name === 'string' && SERVICE_CHARGE_LINE.test(line.name)) {
            paise += Math.round((Number(line.amount) || 0) * 100);
        }
    }
    return paise / 100;
};

/**
 * Does this open bill carry a service charge that could be taken off?
 *
 * THE SERVER'S `service_charge_basis` DECIDES whenever it is sent: "none" is the
 * only value that means there is nothing to remove. This used to be
 * `(bill.service_charge ?? 0) <= 0`, and `service_charge` is only the
 * restaurant_percent leg — it is 0 on every tenant carrying the charge as a tax
 * line, which in production is seven of the nine that charge one — so the
 * dialog told most of the fleet "This bill carries no service charge".
 *
 * The fallback, for a backend that predates the field, reads both shapes, and
 * matches a tax line the way the server does (`/service\s*charge/i`).
 */
export const billCarriesServiceCharge = (bill: {
    service_charge?: unknown;
    service_charge_basis?: unknown;
    taxes?: unknown;
} | null | undefined): boolean => {
    if (!bill) {return false;}
    if (typeof bill.service_charge_basis === 'string' && bill.service_charge_basis.length > 0) {
        return bill.service_charge_basis !== 'none';
    }
    return serviceChargeOnBill(bill) > 0;
};

/**
 * WHAT TO TELL SOMEBODY AFTER "Remove service charge & print", in the words the
 * Windows and Android till use (serviceChargeRemovalOutcome in
 * restaurant_owner_app/lib/screens/mis_capture.dart). Only what the server
 * reported:
 *
 *   * removed and printed — both payable totals;
 *   * an existing waiver reprinted — the total on the paper, no claim of a new
 *     removal;
 *   * the print FAILED after the waiver landed — that the charge is off AND
 *     that no paper came out, with what to press (`tone: "warn"`);
 *   * paper that carries the charge after all — that, never "removed".
 */
export const serviceChargeRemovalSentence = (
    result: Partial<RemoveServiceChargeAndPrintResult> | null | undefined,
    money: (v: unknown) => string,
): { message: string; tone: 'ok' | 'warn' } => {
    const r = result ?? {};
    const created = r.waiver_created === true;
    const printed = r.printed === true;
    const before = r.grand_total_before;
    const after = r.grand_total_after;
    const hasTotals = before !== null && before !== undefined && after !== null && after !== undefined;
    if (printed && r.service_charge_removed === false) {
        return { message: 'Printed WITH the service charge — the waiver was put back before the bill printed.', tone: 'warn' };
    }
    if (!printed) {
        const why = (r.print_error ?? '').trim();
        const notPrinted = `did not print${why ? `: ${why}` : ''}. Press Print bill.`;
        if (created && hasTotals) {
            return { message: `Service charge removed (${money(before)} → ${money(after)}), but the bill ${notPrinted}`, tone: 'warn' };
        }
        return {
            message: created || (r.waiver !== null && typeof r.waiver === 'object')
                ? `The service charge is off this bill, but the bill ${notPrinted}`
                : `The bill ${notPrinted}`,
            tone: 'warn',
        };
    }
    if (created && hasTotals) {
        return { message: `Service charge removed — total ${money(before)} → ${money(after)}. Printing bill…`, tone: 'ok' };
    }
    return {
        message: after !== null && after !== undefined
            ? `Reprinting without the service charge — total ${money(after)}.`
            : 'Reprinting without the service charge…',
        tone: 'ok',
    };
};

export interface BillTenderRecord {
    id: string;
    bill_id: string;
    seq: number;
    method: string;
    /** The portion of the BILL this settles. NEVER includes the tip. */
    amount: number;
    txn_ref: string | null;
    settled_at: string;
    settled_by_username: string;
    tip_amount: number;
    tip_mode: string | null;
    tip_credited_to_username: string | null;
    voided_at: string | null;
    voided_by_username: string | null;
    void_reason: string | null;
}

/** What the server says this bill is worth and what has been paid against it. */
export interface BillTenderState {
    bill_id: string;
    grand_total: number;
    tenders: BillTenderRecord[];
    tendered: number;
    /** THE FIGURE ON SCREEN. Never recomputed in the browser. */
    outstanding: number;
    exact: boolean;
    partial: boolean;
    over: boolean;
    /** Reported separately and never added to `tendered` — a tip is not revenue. */
    tips_total: number;
    payment_method: string | null;
    payment_splits: { method: string; amount: number }[];
}

export interface BillingCounterRecord {
    id: string;
    outlet_id: string;
    code: string;
    name: string;
    kind: string;
    device_hint: string | null;
    active: boolean;
    sort_order: number;
}

export interface MenuGroupRecord {
    id: string;
    outlet_id: string;
    name: string;
    kind: string;
    active: boolean;
    sort_order: number;
}

export interface MenuVariationRecord {
    id: string;
    outlet_id: string;
    menu_id: string;
    name: string;
    price: number;
    is_default: boolean;
    active: boolean;
    sort_order: number;
}

/** One row of the classification map: what a category or an item is filed as. */
export interface MenuGroupAssignmentRow {
    id: string;
    name: string;
    /** The group set DIRECTLY on this row. For an item, the override. */
    group_id: string | null;
    /** What it RESOLVES to today (item override -> category default -> nothing). */
    resolved_group_id: string | null;
    resolved_group_name: string | null;
}

export interface MenuGroupAssignments {
    kind: string;
    groups: MenuGroupRecord[];
    categories: MenuGroupAssignmentRow[];
    items: MenuGroupAssignmentRow[];
    /** The Unclassified bucket a group report will carry. Shown before the report shows it. */
    unclassified_items: number;
}

// --- The tender form ---------------------------------------------------------

/**
 * HOW MANY WAYS ONE BILL MAY BE SPLIT.
 *
 * Six, and the number is the backend's (routes/bills.ts, MAX_BILL_TENDERS). It
 * is mirrored here so the form can stop offering a seventh row rather than let
 * someone fill one in and be refused — that refusal arrives with a guest
 * standing at the counter. It is a SHAPE rule, not a money rule: the amounts
 * themselves are never checked here.
 */
export const MAX_BILL_TENDERS = 6;

/**
 * Methods that cannot be one of several payments on the same bill.
 *
 * The bill's `payment_splits` column will not accept them as a part, so a
 * Razorpay tender alongside a cash one records fine and then cannot be settled —
 * a fully paid bill stranded open with the guest gone. The server refuses this
 * before writing anything; the form greys the option out so nobody reaches that
 * refusal. Same set, same reason (routes/bills.ts UNSPLITTABLE_TENDER_METHODS).
 */
export const UNSPLITTABLE_TENDER_METHODS: readonly string[] = ['razorpay', 'split'] as const;

export const isUnsplittableMethod = (method: string): boolean =>
    UNSPLITTABLE_TENDER_METHODS.includes(method.trim().toLowerCase());

// The methods a till offers are the RESTAURANT'S OWN modes that are switched
// on — tenderPaymentOptions in src/lib/payment-methods.ts, read from settings.
// The fixed list that lived here offered Wallet, Bank Transfer, Voucher and
// Other, every one of which RecordBillTenders refused, and left out Dineout,
// Zomato, EasyDiner and District. `Split` is the mirror's own word and is never
// one.

/** One row of the settle form, as it is typed. Strings — an empty box is not 0. */
export interface TenderDraft {
    method: string;
    amount: string;
    txn_ref: string;
    tip_amount: string;
    tip_mode: string;
    tip_credited_to: string;
}

export const emptyTenderDraft = (method = 'Cash'): TenderDraft => ({
    method,
    amount: '',
    txn_ref: '',
    tip_amount: '',
    tip_mode: '',
    tip_credited_to: '',
});

/**
 * A money box as a number, or null.
 *
 * NULL FOR AN EMPTY BOX, not 0. "The guest paid nothing on this row" and "this
 * row has not been filled in" are different states, and a form that treats them
 * the same either submits a zero tender the server refuses or silently drops a
 * row someone meant to fill.
 */
export const parseMoney = (raw: string): number | null => {
    const s = raw.trim();
    if (s.length === 0) {return null;}
    const n = Number(s);
    if (!Number.isFinite(n)) {return null;}
    return Math.round(n * 100) / 100;
};

/**
 * What the ROWS ON THIS FORM add up to.
 *
 * A FACT ABOUT THE SCREEN, not about the bill — and it is labelled that way
 * wherever it is rendered. The bill's own outstanding is the server's
 * `outstanding` and nothing here ever replaces it; this is only "what you have
 * typed so far", which the person filling six rows in front of a guest genuinely
 * needs and which no round trip can answer because the rows are not sent yet.
 */
export const draftTenderTotal = (rows: readonly TenderDraft[]): number => {
    const paise = rows.reduce((sum, r) => sum + Math.round((parseMoney(r.amount) ?? 0) * 100), 0);
    return paise / 100;
};

/** The same, for the tips column. Tips are never added to the tender total. */
export const draftTipTotal = (rows: readonly TenderDraft[]): number => {
    const paise = rows.reduce((sum, r) => sum + Math.round((parseMoney(r.tip_amount) ?? 0) * 100), 0);
    return paise / 100;
};

/** One tender as POST /bills/tenders takes it. */
export interface TenderWire {
    method: string;
    amount: number;
    txn_ref?: string;
    tip_amount?: number;
    tip_mode?: string;
    tip_credited_to_username?: string;
}

/**
 * The rows, as the wire takes them.
 *
 * Rows with no amount are DROPPED — an untouched extra row on the form is not a
 * payment. Everything else is passed through as typed; the server's
 * `readTenderList` is explicitly SHAPE-ONLY and `RecordBillTenders` owns every
 * rule about whether the set reconciles, so restating any of that here would
 * create a second copy of the money rules that could drift from the first.
 *
 * THERE IS NO ACTOR FIELD. Who took the payment comes from the verified session
 * and there is no body key that can set it. `tip_credited_to_username` is a
 * DESTINATION, not an actor — tips are routinely owed to the kitchen or to a
 * pool, i.e. to people who hold no POS permission at all.
 */
export const tendersForWire = (rows: readonly TenderDraft[]): TenderWire[] => {
    const out: TenderWire[] = [];
    for (const r of rows) {
        const amount = parseMoney(r.amount);
        if (amount === null || amount <= 0) {continue;}
        const method = r.method.trim();
        if (method.length === 0) {continue;}
        const tip = parseMoney(r.tip_amount);
        const wire: TenderWire = { method, amount };
        if (r.txn_ref.trim().length > 0) {wire.txn_ref = r.txn_ref.trim();}
        if (tip !== null && tip > 0) {
            wire.tip_amount = tip;
            if (r.tip_mode.trim().length > 0) {wire.tip_mode = r.tip_mode.trim();}
            if (r.tip_credited_to.trim().length > 0) {wire.tip_credited_to_username = r.tip_credited_to.trim();}
        }
        out.push(wire);
    }
    return out;
};

/**
 * Whether the form can be submitted at all, and why not when it cannot.
 *
 * SHAPE ONLY, deliberately — the same contract `readTenderList` states. It never
 * asks whether the amounts add up to the bill: that is the server's decision,
 * taken inside the settle transaction against a grand total that can move while
 * this form is open, and a browser that pre-judged it would either block a
 * legitimate settle or promise one the server then refuses.
 */
export const tenderFormRefusal = (
    rows: readonly TenderDraft[],
    liveCount: number,
): string | null => {
    const wire = tendersForWire(rows);
    if (wire.length === 0) {return 'Enter an amount on at least one row.';}
    if (liveCount + wire.length > MAX_BILL_TENDERS) {
        return `A bill can be settled across at most ${String(MAX_BILL_TENDERS)} payments, and this one already carries ${String(liveCount)}. Void one before adding another.`;
    }
    if (liveCount + wire.length > 1) {
        const bad = wire.find((t) => isUnsplittableMethod(t.method));
        if (bad) {
            return `${bad.method} settles a bill on its own — it cannot be one of several payments. Take the rest another way, or settle this bill as ${bad.method} alone.`;
        }
    }
    const tipNoMode = wire.find((t) => (t.tip_amount ?? 0) > 0 && !t.tip_mode);
    if (tipNoMode) {return 'A tip needs to say how it arrived — pick a tip mode.';}
    return null;
};

/**
 * Prefill an amount box with what is still owed.
 *
 * A PREFILL, NOT A SECOND OPINION. It starts from the SERVER's `outstanding`
 * (never a browser-side re-derivation of the bill) and subtracts only the other
 * rows on this form, which the server has not seen yet. The result is typed into
 * a box the user can change and the server still has the last word — an
 * over-tender is refused there, not here. Returns null when there is nothing
 * left to fill, so the button can be disabled rather than write a 0.
 */
export const remainderForRow = (
    rows: readonly TenderDraft[],
    index: number,
    serverOutstanding: number,
): number | null => {
    const othersPaise = rows.reduce(
        (sum, r, i) => (i === index ? sum : sum + Math.round((parseMoney(r.amount) ?? 0) * 100)),
        0,
    );
    const paise = Math.round(serverOutstanding * 100) - othersPaise;
    return paise > 0 ? paise / 100 : null;
};

// --- The comp form -----------------------------------------------------------

/** One order line, as the comp picker needs it. */
export interface CompCandidate {
    /** The line id inside "Orders".food.items[]. What POST .../non-chargeable takes. */
    id: string;
    name: string;
    quantity: number;
    price: number;
    /** Already comped — set by the server, never by a client payload. */
    nc: boolean;
    nc_id: string | null;
    nc_kind: string | null;
}

/**
 * What a comp of this line, at this quantity, gives away.
 *
 * A PREVIEW OF THE LINE'S OWN MONEY, not a report figure: `quantity x price`
 * where both come off the line the user is looking at. The authoritative loss is
 * the `value` column Postgres computes on the ledger row (034: GENERATED
 * ALWAYS), which comes back on the response and is what every report reads; this
 * exists so the manager approving it can see the size of what they are giving
 * away before they give it away.
 */
export const compPreviewValue = (line: CompCandidate, quantity: number | null): number => {
    const qty = quantity === null || quantity <= 0 ? line.quantity : Math.min(quantity, line.quantity);
    return Math.round(qty * line.price * 100) / 100;
};

/** Whether a partial comp is even possible on this line. */
export const canPartiallyComp = (line: CompCandidate): boolean => line.quantity > 1;

// --- Small shared formatting -------------------------------------------------

/**
 * A money figure for a capture screen: `₹1,234.50`.
 *
 * Two decimals always — paise reconcile, and a tender form that rounded to the
 * rupee would show a bill as settled while the server still holds 40p
 * outstanding. Kept here rather than imported from mis-reports so a capture
 * screen never depends on the reports module.
 */
export const formatAmount = (value: unknown, currencySymbol = '₹'): string => {
    const n = Number(value);
    if (value === null || value === undefined || value === '' || Number.isNaN(n)) {return '—';}
    const sign = n < 0 ? '-' : '';
    return `${sign}${currencySymbol}${Math.abs(n).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
};
