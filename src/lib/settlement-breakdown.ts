/**
 * THE PAYMENT-MODE BREAKDOWN, as the analytics section needs it.
 *
 * V3: "In the analytics section, add a dedicated row showing the breakdown of
 * the total amount paid by all available payment methods (Cash, UPI, cards,
 * etc.)."
 *
 * WHY THIS READS THE MIS REPORT INSTEAD OF A NEW ENDPOINT
 * ------------------------------------------------------
 * The number already exists and is already hard-won. `GetSettlementSummaryReport`
 * allocates a SPLIT TENDER across the modes it actually touched — a ₹1,000 bill
 * paid ₹600 cash and ₹400 UPI counts ₹600 under Cash and ₹400 under UPI, not
 * ₹1,000 under whichever mode happened to be stamped on the bill row — and it
 * carries refunds back to the mode that took the money. Writing a second,
 * simpler version for this card would produce a DIFFERENT cash figure from the
 * one in the accounting report, and two different answers to "how much cash came
 * in today" is worse than not showing the card.
 *
 * The two surfaces are also gated on the SAME permission — ACCOUNTING_PERM and
 * the analytics gate are the identical uuid (routes/_shared.ts) — so reusing the
 * report widens nothing.
 *
 * PURE: no fetch, no React. Everything here is shaping, so the rules below can
 * be argued with in a test without a server. Same discipline as
 * service-clock.ts and role-permissions.ts.
 */

import type { MisReportPayload } from '@/lib/mis-reports';

/** One payment mode's share of the window. */
export interface SettlementMode {
    /** 'Cash', 'UPI', 'Card', … or the unallocated bucket. */
    method: string;
    /** Bills that touched this mode. A split bill counts under each mode it used. */
    bills: number;
    /** Gross taken on this mode, before refunds. */
    amount: number;
    /** Refunds attributed back to this mode. */
    refund: number;
    /** amount − refund. What actually stayed. */
    net_amount: number;
    /** Share of the window's total, or null when there is nothing to divide. */
    share_pct: number | null;
}

export interface SettlementBreakdown {
    modes: SettlementMode[];
    total_amount: number;
    total_net: number;
    /** How many bills were paid across more than one mode. */
    split_bills: number;
    /**
     * Money that could not be attributed to any mode.
     *
     * Surfaced rather than hidden: a bill settled before the tender ledger
     * existed, or one whose splits do not sum to its total, lands here. Folding
     * it silently into Cash — the tempting default — would invent a cash figure
     * the till never saw, which is the one number a restaurant reconciles by hand.
     */
    unallocated: number;
}

const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/** The label the backend uses for money it could not attribute. */
export const UNALLOCATED_METHOD = 'Unallocated';

/**
 * Rows → modes. Shared by the analytics card and the Overview block so the two
 * cannot shape the same server rows two different ways.
 */
function shapeModes(rows: unknown[]): SettlementMode[] {
    return rows
        .map((raw) => {
            const r = (raw ?? {}) as Record<string, unknown>;
            const method = String(r.method ?? '').trim();
            return {
                method,
                bills: Math.round(num(r.bills)),
                amount: num(r.amount),
                refund: num(r.refund),
                net_amount: num(r.net_amount),
                share_pct: r.share_pct === null || r.share_pct === undefined ? null : num(r.share_pct),
            };
        })
        .filter((m) => m.method.length > 0)
        // Largest first: the question the card answers is "where did the money
        // come from", and the answer is the top row.
        .sort((a, z) => z.amount - a.amount);
}

/**
 * Shape the settlement report into the breakdown the card renders.
 *
 * Returns null for a payload that is not a settlement report, so a caller cannot
 * accidentally render another report's rows as payment modes.
 */
export function readSettlementBreakdown(payload: MisReportPayload | null): SettlementBreakdown | null {
    if (!payload) { return null; }
    const rows = (payload as { rows?: unknown }).rows;
    if (!Array.isArray(rows)) { return null; }

    const modes = shapeModes(rows);

    const totals = (payload.totals ?? {}) as Record<string, unknown>;
    // Prefer the server's own totals — it computed them from the same rows and a
    // client-side re-sum would drift on rounding. Fall back to summing so a
    // payload without totals still renders rather than showing zero.
    const total_amount = totals.amount !== undefined
        ? num(totals.amount)
        : Math.round(modes.reduce((s, m) => s + m.amount, 0) * 100) / 100;
    const total_net = totals.net_amount !== undefined
        ? num(totals.net_amount)
        : Math.round(modes.reduce((s, m) => s + m.net_amount, 0) * 100) / 100;

    return {
        modes,
        total_amount,
        total_net,
        // Both live in `totals`, NOT at the payload root — the backend puts every
        // whole-window figure there (database_supabase.ts, GetSettlementSummaryReport).
        // Reading them off the root would have yielded a silent zero on both,
        // which for `unallocated` means the one row that says "these bills need
        // looking at" would never appear.
        split_bills: Math.round(num(totals.split_bills)),
        unallocated: totals.unallocated !== undefined
            ? num(totals.unallocated)
            : (modes.find((m) => m.method === UNALLOCATED_METHOD)?.amount ?? 0),
    };
}

/**
 * The share of the window a mode took, as a percentage.
 *
 * Recomputed here rather than trusted from the row when the row has none: a
 * missing share is not the same as zero, and a card that prints "0%" beside
 * ₹40,000 of cash is actively misleading.
 */
export function modeSharePct(mode: SettlementMode, total: number): number | null {
    if (mode.share_pct !== null) { return mode.share_pct; }
    if (!(total > 0)) { return null; }
    return Math.round((mode.amount / total) * 1000) / 10;
}

/**
 * Is this breakdown worth rendering at all?
 *
 * An empty window is not an error and must not look like one — a restaurant that
 * has not settled a bill yet today should see "nothing settled yet", never a
 * table of zeroes or a spinner that never resolves.
 */
export function hasSettlements(b: SettlementBreakdown | null): boolean {
    return b !== null && b.modes.length > 0 && b.total_amount > 0;
}

/** The Overview's "Collected by payment method" block, shaped. */
export interface HeadlineByMethod extends SettlementBreakdown {
    /** The server's label for the block — printed verbatim, like every figure's. */
    label: string;
    /** The server's definition of what the rows count. */
    hint: string;
    /**
     * Bills whose split parts did not add back to the bill — the Unallocated
     * row's bill count, 0 without one. NOT derivable from `unallocated`: that is
     * netted across bills, so ₹50 short on one and ₹50 over on another reads 0.
     */
    unallocated_bills: number;
}

/**
 * TODAY BY PAYMENT METHOD, off the headline payload the Overview already reads.
 *
 * Client ask: "How much money from each payment method made in the day has to be
 * shown." The rows are GetOverviewHeadline's `today_by_method` — the Settlement
 * Summary's own cut (settlementByMethod) over today's bills — so the Cash row
 * here IS the Cash collection tile beside it, and the rows add up to Today's
 * gross sale. Nothing is re-summed that the server already totalled.
 *
 * NULL — render nothing — when:
 *   * there is no payload (the headline itself failed; that card says so);
 *   * `today_by_method` is absent. An older backend never sent it, and "the
 *     server did not say" must not read as "no money by any method";
 *   * the block has no label. An unnamed list of money is worse than none —
 *     the same rule the Flutter headline applies to an unlabelled figure.
 *
 * An EMPTY list is returned as an empty breakdown, and `hasSettlements` says no:
 * the headline card already says "nothing settled yet today".
 */
export function readHeadlineByMethod(headline: {
    today_by_method?: unknown;
    today_split_bills?: unknown;
    today_unallocated?: unknown;
    today_gross?: { value?: unknown } | null;
    by_method?: { label?: unknown; hint?: unknown } | null;
} | null): HeadlineByMethod | null {
    if (!headline || !Array.isArray(headline.today_by_method)) { return null; }
    const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
    const label = text(headline.by_method?.label);
    if (!label) { return null; }
    const modes = shapeModes(headline.today_by_method);
    const unallocatedRow = modes.find((m) => m.method === UNALLOCATED_METHOD);
    const r2 = (n: number): number => Math.round(n * 100) / 100;
    return {
        label,
        hint: text(headline.by_method?.hint),
        modes,
        // The server's Today's gross sale, which the rows are required to add up
        // to (jest proves it backend-side). Re-summed only when it is missing.
        total_amount: headline.today_gross?.value !== undefined
            ? num(headline.today_gross.value)
            : r2(modes.reduce((s, m) => s + m.amount, 0)),
        total_net: r2(modes.reduce((s, m) => s + m.net_amount, 0)),
        split_bills: Math.round(num(headline.today_split_bills)),
        unallocated: headline.today_unallocated !== undefined
            ? num(headline.today_unallocated)
            : (unallocatedRow?.amount ?? 0),
        unallocated_bills: unallocatedRow?.bills ?? 0,
    };
}

/**
 * The Overview block's Unallocated warning, or null when there is nothing wrong.
 *
 * Keyed off the ROW as well as the sum. Residuals net across bills, so two bills
 * whose splits are ₹50 short and ₹50 over put ₹0.00 in Unallocated — and a
 * warning gated on the sum alone would say nothing about two bills that need
 * looking at. The server never filters the Unallocated row for that reason.
 * Worded to match the Flutter Overview line for line.
 */
export function unallocatedWarning(b: HeadlineByMethod, money: (n: number) => string): string | null {
    const n = b.unallocated_bills;
    const whose = n === 0 ? "those bills'" : (n === 1 ? "1 bill's" : `${String(n)} bills'`);
    if (b.unallocated !== 0) {
        return `${money(Math.abs(b.unallocated))} could not be put under a payment method — ${whose} split `
            + 'amounts do not add up to their totals and need looking at.';
    }
    if (n > 0) {
        return `${whose} split amounts do not add up to their totals and need looking at `
            + `(the differences cancel out to ${money(0)} today).`;
    }
    return null;
}
