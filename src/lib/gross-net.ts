// GROSS, NET AND ITEM TOTAL — three words, one meaning each, on every screen.
//
// Client: "Gross means the total value of all the bills including service
// charge, taxes and so on. Net means just the menu price value of all the bills
// where you reduce the discounts, service charge, taxes and so on."
//
//   GROSS       the grand total — net + service charge + tax + round off, before
//               refunds. `grand_total` on the MIS reports, `total_sales` on the
//               accounting Sales report.
//   NET         the item total less discounts, before service charge, tax and
//               round off. `net` on the MIS reports, `total_net` on Sales.
//   ITEM TOTAL  the menu-price value of the lines before any discount.
//               `item_total` (`gross_amount` on the three item-level reports).
//
// WHAT WENT WRONG, so nobody walks back into it: the pre-discount rung used to
// be called "Gross", so a restaurant that never discounts saw Gross === Net on
// every report while the Overview's "gross sale" was a different, tax-inclusive
// number. The Accounting NET SALES card, meanwhile, showed a THIRD figure — the
// grand total less refunds, tax and all. Nothing about the money changed; the
// words did.
//
// THE KEYS DID NOT MOVE. The backend keeps `gross` (= item total) and
// `net_sales` (= gross − refunds) under their old names and values for tills
// that have not updated, so this file is the ONE place that decides which key a
// word reads — and falls back to the old key where an older backend has not
// sent the new one. The Flutter app's lib/models/gross_net.dart makes the same
// decisions in the same words; the two must not drift.
//
// PURE: no React, no fetch. Every figure is the server's.

export const kGross = 'Gross';
export const kNet = 'Net';
export const kItemTotal = 'Item total';

/** Collected (or Gross) less refunds, tax still in — never called Net. */
export const kAfterRefunds = 'After refunds';

const present = (v: unknown): boolean => {
    if (v == null) {return false;}
    if (typeof v === 'string') {return v.trim() !== '';}
    return typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint';
};

const numOrNull = (v: unknown): number | null => {
    if (!present(v)) {return null;}
    const n = typeof v === 'number' ? v : Number(typeof v === 'string' ? v.trim() : v);
    return Number.isFinite(n) ? n : null;
};

/**
 * The pre-discount rung off a ladder totals map: `item_total` from a backend
 * that sends it, the deprecated `gross` alias (same value) from one that does
 * not. NEVER `grand_total` — that is Gross.
 */
export const itemTotalOf = (totals: Record<string, unknown>): unknown =>
    present(totals.item_total) ? totals.item_total : totals.gross;

/** The Discount report's share, on the item total. Same fallback rule. */
export const discountPctOf = (totals: Record<string, unknown>): unknown =>
    present(totals.discount_pct_of_item_total)
        ? totals.discount_pct_of_item_total
        : totals.discount_pct_of_gross;

/** The accounting Sales report, as far as these words need it. */
export interface AccountingSalesFigures {
    /** total_sales — the grand total of the window's bills. */
    grossSales: number | null;
    /** total_net — null from a backend older than this change, never guessed. */
    netSales: number | null;
    refunds: number | null;
    /** net_sales, the legacy key: Gross less refunds, tax still in. */
    grossAfterRefunds: number | null;
    /** total_round_off — null from an older backend. */
    roundOff: number | null;
    /**
     * The headline card's caption. "Net sales" when the server sent Net;
     * otherwise the card says what it is actually showing.
     */
    headlineLabel: string;
    headlineValue: number | null;
}

export const readAccountingSales = (sales: unknown): AccountingSalesFigures => {
    const rec: Record<string, unknown> | undefined =
        sales != null && typeof sales === 'object' ? (sales as Record<string, unknown>) : undefined;
    const netSales = numOrNull(rec?.total_net);
    const grossAfterRefunds = numOrNull(rec?.net_sales);
    return {
        grossSales: numOrNull(rec?.total_sales),
        netSales,
        refunds: numOrNull(rec?.total_refund),
        grossAfterRefunds,
        roundOff: numOrNull(rec?.total_round_off),
        headlineLabel: netSales != null ? 'Net sales' : 'Gross after refunds',
        headlineValue: netSales ?? grossAfterRefunds,
    };
};

/** One line of the printed Accounting PDF's Sales block. */
export interface SalesPdfLine {
    label: string;
    /** The server's raw value, formatted by the PDF's own `kv`. */
    value: unknown;
    bold: boolean;
}

/**
 * The Sales block of the Accounting PDF, as (label, value) lines off the
 * accounting Sales report.
 *
 * PURE and here, not inline in the PDF builder, because the PDF is the copy
 * that gets filed and nothing else pinned which key its lines read: pointing
 * "Net sales" back at `net_sales` — Gross less refunds, tax and all, which is
 * exactly the client's complaint — passed every suite. "Net sales" is printed
 * only when the server sent `total_net`; an older backend's PDF says what it
 * has rather than borrowing the word.
 */
export const accountingSalesPdfLines = (sales: unknown): SalesPdfLine[] => {
    const rec: Record<string, unknown> =
        sales != null && typeof sales === 'object' ? (sales as Record<string, unknown>) : {};
    const lines: SalesPdfLine[] = [
        { label: 'Gross sales', value: rec.total_sales, bold: false },
        { label: 'Bills', value: rec.bill_count ?? 0, bold: false },
        { label: 'Gross after refunds', value: rec.net_sales, bold: false },
    ];
    if (readAccountingSales(rec).netSales != null) {
        lines.push({ label: 'Net sales', value: rec.total_net, bold: true });
    }
    return lines;
};
