// THE OVERVIEW'S OWN READS — thin client-side fetchers over the backend, one
// per figure block, so the dashboard Overview asks the very endpoint each
// module's own screen reads (which is what stops the Overview quoting a number
// the destination screen then contradicts).
//
// WHY THESE THROW instead of returning null like db.ts's readers: the Overview
// loads through `useCachedFetch`, whose whole offline-vs-refusal contract
// (async_view.dart) needs the failure, not a null that is indistinguishable
// from "fetched and empty". Network-unreachable failures surface as TypeError
// (isUnreachableError says offline); an HTTP refusal throws an Error carrying
// `status` and the server's own sentence.

import { requestBackend } from '@/lib/db';
import type { OverviewInsights } from '@/lib/db';
import { refusalSentence } from '@/lib/error-message';

export type { OverviewInsights };

/** An HTTP refusal: a real answer, shown as one (never dressed as an outage). */
export class BackendRefusal extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
        super(message);
        this.name = 'BackendRefusal';
        this.status = status;
    }
}

const fetchJson = async <T>(path: string, restaurantId: string): Promise<T> => {
    const res = await requestBackend<T>({ path, method: 'GET', restaurantId });
    if (res.status === 0) {
        // The server was never reached — the offline wording's case.
        throw new TypeError('Failed to fetch');
    }
    if (!res.ok) {
        const sentence = refusalSentence(res.data ?? res.text);
        throw new BackendRefusal(sentence ?? `Request failed (${res.status})`, res.status);
    }
    return (res.data ?? {}) as T;
};

// --- /analytics/headline ------------------------------------------------------

/** One headline figure, with the sentence that says what it counts. */
export interface GlanceFigure {
    value?: number | null;
    label?: string;
    hint?: string;
    /** The server's own destination for this figure (glance_drill.ts). */
    drill?: unknown;
}

export interface GlanceModeRow {
    method: string;
    label?: string;
    bills?: number;
    amount?: number;
    share_pct?: number | null;
    refund?: number;
    net_amount?: number;
}

/**
 * H1's payload, with everything item 10 added: per-figure drills, the `drills`
 * block, the NC line, the net→gross ladder and the online bill count. This is
 * `OverviewHeadline` in db.ts plus the fields that type predates; typed here
 * because db.ts is another lane's file.
 */
export interface GlanceHeadline {
    today?: string;
    month_from?: string;
    timezone?: string;
    /** Zero means NOTHING SETTLED YET, which is not the same as zero takings. */
    today_bills?: number | null;
    month_bills?: number | null;
    today_net?: GlanceFigure;
    today_gross?: GlanceFigure;
    online_net?: GlanceFigure;
    online_gross?: GlanceFigure;
    cash_collection?: GlanceFigure;
    month_to_date?: GlanceFigure;
    today_by_method?: GlanceModeRow[];
    today_split_bills?: number;
    today_unallocated?: number;
    by_method?: { label?: string; hint?: string };
    /** NC beside the modes — a bill that took 0.00 has no row among them. */
    today_nc?: { label?: string; hint?: string; bills?: number; value?: number };
    /** The steps between Net and Gross, when the server sent them. */
    today_ladder?: Record<string, number | null>;
    today_online_bills?: number | null;
    /** glance_drill.ts destinations for every non-figure element. */
    drills?: Record<string, unknown>;
    [key: string]: unknown;
}

export const getGlanceHeadline = (restaurantId: string): Promise<GlanceHeadline> =>
    fetchJson<GlanceHeadline>('/analytics/headline', restaurantId);

// --- the stat-card reads ------------------------------------------------------

export interface ApcMonth {
    month?: string;
    monthly_apc?: number | null;
    total_revenue?: number | null;
    total_covers?: number | null;
    yellow_band_percent?: number | null;
    orders?: unknown[];
}

/** MTD, all channels — the same read the APC screens make. */
export const getApcMonth = (restaurantId: string): Promise<ApcMonth> =>
    fetchJson<ApcMonth>('/orders/apc', restaurantId);

export interface DailyRevenuePoint { date?: string; revenue?: number; orders?: number }

export const getDailyRevenue = async (restaurantId: string, days = 14): Promise<DailyRevenuePoint[]> => {
    const d = await fetchJson<{ series?: DailyRevenuePoint[] }>(`/orders/daily-revenue?days=${days}`, restaurantId);
    return Array.isArray(d.series) ? d.series : [];
};

export interface FeedbackSummary {
    totalResponses?: number;
    averageRating?: number;
    last30DaysResponses?: number;
    categoryAverages?: Record<string, { label?: string; average?: number; count?: number; responses?: number }>;
}

export const getFeedbackSummary = (restaurantId: string): Promise<FeedbackSummary> =>
    fetchJson<FeedbackSummary>('/feedback/summary', restaurantId);

/** A raw /get-tables row — the fields the Overview's occupancy figures read. */
export interface FloorTableRow {
    table_name?: string;
    parent_table?: string | null;
    occupied?: boolean;
    covers?: number;
    payment_pending?: boolean;
    table_total?: number;
    apc_status?: string;
    otp_required?: boolean;
    order_otp?: string | null;
    [key: string]: unknown;
}

export const getFloorTableRows = async (restaurantId: string): Promise<FloorTableRow[]> => {
    const rows = await fetchJson<unknown>(`/get-tables?restaurantId=${encodeURIComponent(restaurantId)}`, restaurantId);
    return Array.isArray(rows) ? rows as FloorTableRow[] : [];
};

// --- the cross-tab Operations reads -------------------------------------------

export interface OpenBillsPeek { total?: number; outstanding_total?: number }

/**
 * limit=1: the page itself is thrown away. `total` and `outstanding_total` are
 * computed over EVERY open bill regardless of paging, so one row is all this
 * costs.
 */
export const getOpenBillsPeek = (restaurantId: string): Promise<OpenBillsPeek> =>
    fetchJson<OpenBillsPeek>('/bills/open?limit=1', restaurantId);

export interface UpcomingBookingRow {
    status?: string;
    booking_date_time?: string;
    number_of_people?: number;
    [key: string]: unknown;
}

export const getUpcomingBookingRows = async (restaurantId: string): Promise<UpcomingBookingRow[]> => {
    const rows = await fetchJson<unknown>(
        `/get-bookings?restaurantId=${encodeURIComponent(restaurantId)}&window=upcoming`,
        restaurantId,
    );
    return Array.isArray(rows) ? rows as UpcomingBookingRow[] : [];
};

export interface WaitlistRow { name?: string; status?: string; [key: string]: unknown }

export const getWaitlistRows = async (restaurantId: string): Promise<WaitlistRow[]> => {
    const d = await fetchJson<{ entries?: WaitlistRow[] }>(
        `/waitlist?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
    );
    return Array.isArray(d.entries) ? d.entries : [];
};

export interface InventoryRow { status?: string; [key: string]: unknown }

export const getInventoryRows = async (restaurantId: string): Promise<InventoryRow[]> => {
    const rows = await fetchJson<unknown>(
        `/inventory?restaurantId=${encodeURIComponent(restaurantId)}`,
        restaurantId,
    );
    return Array.isArray(rows) ? rows as InventoryRow[] : [];
};

export interface PurchaseOrderRow { status?: string; total_cost?: number; [key: string]: unknown }

export const getPurchaseOrderRows = async (restaurantId: string): Promise<PurchaseOrderRow[]> => {
    const d = await fetchJson<{ orders?: PurchaseOrderRow[] }>('/purchase-orders', restaurantId);
    return Array.isArray(d.orders) ? d.orders : [];
};

// --- /analytics/overview ------------------------------------------------------

export const getOverviewInsightsRead = (restaurantId: string, days = 30): Promise<OverviewInsights> =>
    fetchJson<OverviewInsights>(`/analytics/overview?days=${days}`, restaurantId);

// --- /auth/me (Account card facts) --------------------------------------------

/**
 * The slice of /auth/me the Account card reads: the tenant's subscription
 * limits. Roles come off the session profile; the limits are re-read here
 * because the login payload's `limits` never made it into the stored AuthUser
 * shape (AuthContext is another lane's file).
 */
export interface SessionAccountFacts {
    limits?: Record<string, unknown>;
}

export const getSessionAccountFacts = (restaurantId: string): Promise<SessionAccountFacts> =>
    fetchJson<SessionAccountFacts>('/auth/me', restaurantId);

// --- /me/scorecard ------------------------------------------------------------

export interface ScorecardComponent {
    value?: number | null;
    score?: number | null;
    available?: boolean;
    note?: string;
}

/**
 * THE ONE READ A WAITER'S OVERVIEW MAKES. Session-scoped — it takes no employee
 * id, because the server reads that off the verified session — and it carries
 * their own APC, guest rating, attendance and the composite score, with the
 * house benchmarks those were measured against stripped out server-side.
 */
export interface MyScorecard {
    window_days?: number;
    score?: number | null;
    components_available?: number;
    effective_weights?: Record<string, number>;
    components?: Record<string, ScorecardComponent>;
    attendance_now?: { clocked_in?: boolean; today_minutes?: number; pending_approval?: boolean };
}

export const getMyScorecard = (restaurantId: string): Promise<MyScorecard> =>
    fetchJson<MyScorecard>('/me/scorecard', restaurantId);
