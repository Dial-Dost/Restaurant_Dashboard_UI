/**
 * SETTLE AS NC — the dashboard's half of client item 5.
 *
 * "NC has to come up as an option for payment mode when settling a bill, this
 * has to be coded in as analytics for NC is required."
 *
 * NC IS A WAY TO CLOSE A BILL, NOT A WAY TO PAY ONE. The backend refuses "NC" as
 * a payment mode on purpose (payment_methods.ts): a mode is money collected, and
 * settling with one books the grand total as sales and tax for a meal nobody
 * paid for. So "Non-chargeable (NC)…" in the Confirm Payment menu is not another
 * till option. It calls POST /bills/order/:orderId/settle-nc, which comps every
 * remaining dish into the NC ledger (the same ledger "Non-chargeable item…"
 * writes) and closes the bill at 0.00 with payment_method 'NC'.
 *
 * WHOLE BILLS ONLY. Part of a bill is given away by comping dishes one by one
 * and taking the rest; the server refuses an amount, and every client says so
 * in the same sentence.
 *
 * THE SAME WORDS AS THE APP (lib/screens/mis_capture.dart) — the label, the
 * button, the refusal sentences and the overview line — and the same two
 * capability gates: the comp permission AND Close Bill. A waiter holds neither
 * and never sees any of it.
 *
 * PURE: no fetch, no React. Same discipline as settlement-breakdown.ts.
 */

/** What "Bills".payment_method says on a bill settled as non-chargeable. */
export const NC_SETTLE_METHOD = 'NC';

/** What every screen calls that marker. The backend's NC_SETTLE_LABEL. */
export const NC_SETTLE_LABEL = 'Non-chargeable (NC)';

/** The Confirm Payment menu item. The trailing ellipsis says a form follows. */
export const NC_SETTLE_MENU_LABEL = `${NC_SETTLE_LABEL}…`;

/** The one button that does it. */
export const NC_SETTLE_BUTTON = 'Settle as NC';

/** The backend's NC_WHOLE_BILL_ONLY, word for word. */
export const NC_WHOLE_BILL_ONLY =
    'Settle as NC covers the whole bill. To give part of it away, comp dishes individually, then take the rest.';

/** Under the split-payment form, which never offers NC. */
export const NC_SPLIT_NOTE =
    'NC is not a way to pay, so it is not offered here. To give part of this bill away, comp those dishes first (Controls → Non-chargeable item…), then split what is left.';

/** Is this stored method the NC marker? Case- and space-insensitive, as the server reads it. */
export const isNcSettleMethod = (raw: unknown): boolean =>
    String(raw ?? '').trim().toLowerCase() === 'nc';

/**
 * May this session be offered Settle as NC?
 *
 * BOTH gates, because the route has both: it is a comp ("Mark Items
 * Non-Chargeable") and a settle ("Close Bill"). A cashier holds only the second
 * and a waiter neither, so neither is shown an item that would 403.
 */
export const mayOfferNcSettle = (caps: { compItem: boolean; settleBill: boolean }): boolean =>
    caps.compItem === true && caps.settleBill === true;

const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number): number => Math.round(n * 100) / 100;

/** The open bill as the dialog reads it (GET /bill-for-table), only the keys it needs. */
export interface NcOpenBill {
    subtotal?: unknown;
    grand_total?: unknown;
    discount?: unknown;
    discount_value?: unknown;
    coupon_code?: unknown;
    nc_total?: unknown;
    payment_status?: unknown;
    items?: unknown;
}

/** The NC settle's quote, off the server's open bill. */
export interface NcQuote {
    /** The chargeable pre-tax subtotal — what the settle comps, and `expected_value`. */
    value: number;
    /** What the guest would pay today, service charge and tax included. Information only. */
    wouldHaveCharged: number;
    /** Dishes already comped one by one before this settle. */
    alreadyComped: number;
    /** Chargeable dishes (merged bill lines) the settle will comp. */
    lines: number;
}

/**
 * The quote the dialog shows and sends, from the server's own figures.
 *
 * `subtotal` on the open bill IS the chargeable pre-tax subtotal
 * (sumOrderTotalsForTable), which is exactly what the server checks
 * `expected_value` against — so nothing here is summed from the lines.
 */
export const ncQuote = (bill: NcOpenBill | null | undefined): NcQuote | null => {
    if (!bill) { return null; }
    const items = Array.isArray(bill.items) ? (bill.items as { nc?: unknown; price?: unknown }[]) : [];
    return {
        value: r2(num(bill.subtotal)),
        wouldHaveCharged: r2(num(bill.grand_total)),
        alreadyComped: r2(num(bill.nc_total)),
        lines: items.filter((it) => it?.nc !== true && num(it?.price) > 0).length,
    };
};

/**
 * Why this bill cannot be settled as NC right now, before the form opens — or
 * null. The SERVER decides (these are its refusals, read again inside its
 * transaction); this only saves the manager filling in a form the server will
 * refuse. Same order and the same sentences as ncSettleRefusal.
 */
export const ncSettleBlocker = (
    bill: NcOpenBill | null | undefined,
    tenders: { tendered?: unknown; tenders?: unknown } | null | undefined,
    money: (n: number) => string,
): string | null => {
    if (!bill) { return 'There is no open bill on this table to settle.'; }
    if (bill.payment_status === 'pending_approval') {
        return 'A payment for this bill is already waiting for approval. Approve it, or re-open the bill afterwards — settling it as non-chargeable now would erase money already taken.';
    }
    const tendered = r2(num(tenders?.tendered));
    if (tendered > 0) {
        return `${money(tendered)} is already recorded as paid on this bill. Void that payment first, or comp dishes individually and take the rest.`;
    }
    if (num(bill.discount) > 0 || num(bill.discount_value) > 0 || String(bill.coupon_code ?? '').trim() !== '') {
        return 'This bill carries a discount or a coupon. Remove it first — a comped bill has nothing to discount.';
    }
    // A table whose every dish was already comped one by one still settles
    // here: nothing is left to comp, and the bill closes at 0.00 as NC.
    const quote = ncQuote(bill);
    if (!quote || (quote.value <= 0 && quote.alreadyComped <= 0)) {
        return 'There is nothing on this table to settle.';
    }
    return null;
};

/** Is the form complete? Kind, reason AND authoriser — the reason stays required for a whole-bill NC. */
export const ncSettleFormReady = (f: { kind: string; reason: string; authorisedBy: string }): boolean =>
    f.kind.trim() !== '' && f.reason.trim() !== '' && f.authorisedBy.trim() !== '';

/** What POST /bills/order/:orderId/settle-nc is sent. Never an amount: whole bills only. */
export interface NcSettleBody {
    nc_kind: string;
    reason: string;
    authorised_by: string;
    expected_value: number;
    print: boolean;
}

export const ncSettleBody = (f: { kind: string; reason: string; authorisedBy: string; expectedValue: number; print?: boolean }): NcSettleBody => ({
    nc_kind: f.kind.trim(),
    reason: f.reason.trim(),
    authorised_by: f.authorisedBy.trim(),
    expected_value: r2(f.expectedValue),
    print: f.print !== false,
});

/** The headline the form shows. The app's settle sheet says the same. */
export const ncSettleHeadline = (value: number, money: (n: number) => string): string =>
    `NOTHING TO PAY · ${money(value)} given away`;

/** What the server answered, as the toast says it. */
export const ncSettleDoneSentence = (
    r: { bill_no?: unknown; nc_value?: unknown; printed?: unknown; print_error?: unknown; already?: unknown },
    money: (n: number) => string,
): string => {
    const no = String(r.bill_no ?? '').trim();
    const bill = no ? `Bill ${no}` : 'The bill';
    if (r.already === true) { return `${bill} was already settled as non-chargeable.`; }
    const head = `${bill} was settled as non-chargeable — ${money(num(r.nc_value))} given away, nothing collected.`;
    if (r.printed === true) { return `${head} The NC bill is printing.`; }
    const why = String(r.print_error ?? '').trim();
    return why ? `${head} The NC bill did not print: ${why}` : head;
};

// ---------------------------------------------------------------------------
// Reading the NC figures back — paper, closed bill, overview, reports
// ---------------------------------------------------------------------------

/** The settlement block a printed NC bill carries — the backend's ReceiptOptions.settlement. */
export interface NcPrintSettlement {
    kind: string;
    authorisedBy: string;
    wouldHaveCharged: number | null;
}

/**
 * GetClosedBill's `nc_settlement`, as the bill renderers take it — or null for
 * every bill that was not settled as NC. The same three fields
 * settledBillReceiptOptions hands escpos.ts, so the dashboard's reprint of an NC
 * bill is the backend's, byte for byte.
 */
export const ncPrintSettlement = (settled: { payment_method?: unknown; nc_settlement?: unknown } | null | undefined): NcPrintSettlement | null => {
    if (!settled || !isNcSettleMethod(settled.payment_method)) { return null; }
    const s = settled.nc_settlement as { kind_label?: unknown; authorised_by?: unknown; would_have_charged?: unknown } | null | undefined;
    if (!s || typeof s !== 'object') { return null; }
    const would = s.would_have_charged;
    return {
        kind: String(s.kind_label ?? ''),
        authorisedBy: String(s.authorised_by ?? ''),
        wouldHaveCharged: would === null || would === undefined || !Number.isFinite(Number(would)) ? null : Number(would),
    };
};

/** A labelled NC figure beside a block of money — never inside it. */
export interface NcBeside {
    label: string;
    hint: string;
    bills: number;
    value: number;
}

/**
 * The Overview's `today_nc`, or null. Null when an older backend sent none or
 * sent it unlabelled (an unnamed figure is worse than none), and when today has
 * nothing to show — no NC bill and nothing given away.
 */
export const readHeadlineNc = (headline: { today_nc?: unknown } | null | undefined): NcBeside | null => {
    const raw = headline?.today_nc as { label?: unknown; hint?: unknown; bills?: unknown; value?: unknown } | null | undefined;
    if (!raw || typeof raw !== 'object') { return null; }
    const label = typeof raw.label === 'string' ? raw.label.trim() : '';
    if (!label) { return null; }
    const bills = Math.round(num(raw.bills));
    const value = r2(num(raw.value));
    if (bills === 0 && value === 0) { return null; }
    return { label, hint: typeof raw.hint === 'string' ? raw.hint.trim() : '', bills, value };
};

/** "2 NC bills · ₹1,200.00 given away" — the line both clients print beside the figures. */
export const ncBesideLine = (b: { bills: number; value: number }, money: (n: number) => string): string =>
    `${String(b.bills)} NC bill${b.bills === 1 ? '' : 's'} · ${money(b.value)} given away`;

/** Sales Summary totals' NC figures (`nc_bills`, `nc_value`), or null when there are none. */
export const salesSummaryNc = (totals: Record<string, unknown> | null | undefined): { bills: number; value: number } | null => {
    const bills = Math.round(num(totals?.nc_bills));
    const value = r2(num(totals?.nc_value));
    return bills === 0 && value === 0 ? null : { bills, value };
};

/** Settlement Summary `totals.nc`, or null when there are none. */
export const settlementSummaryNc = (totals: Record<string, unknown> | null | undefined): { bills: number; value: number } | null => {
    const nc = totals?.nc as { bills?: unknown; value?: unknown } | null | undefined;
    if (!nc || typeof nc !== 'object') { return null; }
    const bills = Math.round(num(nc.bills));
    const value = r2(num(nc.value));
    return bills === 0 && value === 0 ? null : { bills, value };
};

/** NC Summary `by_scope`, with the empty scopes dropped. */
export const ncSummaryByScope = (payload: Readonly<Record<string, unknown>> | null | undefined): { scope: string; label: string; entries: number; loss: number }[] =>
    (Array.isArray(payload?.by_scope) ? (payload.by_scope as { scope?: unknown; label?: unknown; entries?: unknown; loss?: unknown }[]) : [])
        .map((s) => ({ scope: String(s?.scope ?? ''), label: String(s?.label ?? ''), entries: Math.round(num(s?.entries)), loss: r2(num(s?.loss)) }))
        .filter((s) => s.label !== '' && (s.entries > 0 || s.loss !== 0));
