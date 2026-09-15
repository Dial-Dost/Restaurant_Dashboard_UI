/**
 * GROSS, NET AND ITEM TOTAL — three words, one meaning each, on every screen.
 *
 * Client: "Gross means the total value of all the bills including service
 * charge, taxes and so on. Net means just the menu price value of all the bills
 * where you reduce the discounts, service charge, taxes and so on."
 *
 *   GROSS       the grand total — net + service charge + tax + round off, before
 *               refunds. `grand_total` on the MIS reports, `total_sales` on the
 *               accounting Sales report.
 *   NET         the item total less discounts, before service charge, tax and
 *               round off. `net` on the MIS reports, `total_net` on Sales.
 *   ITEM TOTAL  the menu-price value of the lines before any discount.
 *               `item_total` (`gross_amount` on the three item-level reports).
 *
 * WHAT WENT WRONG, so nobody walks back into it: the pre-discount rung used to be
 * called "Gross", so a restaurant that never discounts saw Gross === Net on every
 * report while the Overview's "gross sale" was a different, tax-inclusive number.
 * The accounting "Net sales" card, meanwhile, showed a THIRD figure — the grand
 * total less refunds, tax and all. Nothing about the money changed; the words did.
 *
 * THE KEYS DID NOT MOVE. The backend keeps `gross` (= item total) and `net_sales`
 * (= gross − refunds) under their old names and values for installed tills, so
 * this module is the ONE place that decides which key a word reads — and falls
 * back to the old key where an older backend has not sent the new one.
 *
 * PURE: no fetch, no React. Shaping only; every figure is the server's.
 */

export const GROSS = 'Gross';
export const NET = 'Net';
export const ITEM_TOTAL = 'Item total';
/** Collected (or Gross) less refunds, tax still in — never called Net. */
export const AFTER_REFUNDS = 'After refunds';

type Totals = Record<string, unknown>;

const present = (v: unknown): boolean => v !== undefined && v !== null && v !== '';

/** A number, or null for absent/unparseable — never a made-up zero. */
const numOrNull = (v: unknown): number | null => {
    if (!present(v)) {return null;}
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

const r2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * The pre-discount rung off a ladder totals object. `item_total` from a backend
 * that sends it; the deprecated `gross` alias (same value) from one that does not.
 * NEVER `grand_total` — that is Gross.
 */
export const itemTotalOf = (totals: Totals): unknown =>
    present(totals.item_total) ? totals.item_total : totals.gross;

/** The Discount report's share, on the item total. Same fallback rule. */
export const discountPctOf = (totals: Totals): unknown =>
    present(totals.discount_pct_of_item_total) ? totals.discount_pct_of_item_total : totals.discount_pct_of_gross;

/**
 * What sits between Net and Gross on one tile: service charge + tax + round off.
 * Summed here, once, because the tile beside it says "Net" and the one after it
 * says "Gross" and the three must visibly add up — the round off included, which
 * the old "Tax + service charge" tile left out. Null when the ladder is absent.
 */
export const chargesAboveNet = (totals: Totals): number | null => {
    const tax = numOrNull(totals.tax);
    const sc = numOrNull(totals.service_charge);
    if (tax === null && sc === null) {return null;}
    return r2((tax ?? 0) + (sc ?? 0) + (numOrNull(totals.round_off) ?? 0));
};

/** The accounting Sales report, as far as these words need it. Structural on purpose. */
export interface SalesWords {
    total_sales?: number | null;
    total_net?: number | null;
    total_refund?: number | null;
    net_sales?: number | null;
}

export interface AccountingSalesFigures {
    /** total_sales — the grand total of the window's bills. */
    grossSales: number | null;
    /** total_net — null from a backend older than this change, never guessed. */
    netSales: number | null;
    refunds: number | null;
    /** net_sales, the legacy key: Gross less refunds, tax still in. */
    grossAfterRefunds: number | null;
    /**
     * The headline card. "Net sales" when the server sent Net; otherwise the
     * card says what it is actually showing rather than borrowing the word.
     */
    headline: { label: string; value: number | null };
}

export function readAccountingSales(sales: SalesWords | null | undefined): AccountingSalesFigures {
    const grossSales = numOrNull(sales?.total_sales);
    const netSales = numOrNull(sales?.total_net);
    const grossAfterRefunds = numOrNull(sales?.net_sales);
    return {
        grossSales,
        netSales,
        refunds: numOrNull(sales?.total_refund),
        grossAfterRefunds,
        headline: netSales !== null
            ? { label: 'Net sales', value: netSales }
            : { label: 'Gross after refunds', value: grossAfterRefunds },
    };
}
