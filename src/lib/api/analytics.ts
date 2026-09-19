// THE ANALYTICS MODULE'S OWN READS — thin client-side fetchers over the
// backend, mirroring the Flutter `_analyticsBody` load exactly
// (restaurant_owner_app/lib/screens/modules.dart ~20497): nine requests in one
// `Promise.all`, four REQUIRED (a failure fails the whole page, one error
// surface with retry) and five OPTIONAL (`.catch` to an empty payload so the
// rest of the page still renders on an older backend).
//
// WHY THESE THROW instead of returning null like db.ts's readers: the page
// loads through `useCachedFetch`, whose offline-vs-refusal contract
// (async_view.dart) needs the failure, not a null that is indistinguishable
// from "fetched and empty". Network-unreachable failures surface as TypeError
// (isUnreachableError says offline); an HTTP refusal throws an Error carrying
// `status` and the server's own sentence.

import { requestBackend } from '@/lib/db';
import type {
    AdvancedAnalytics,
    AnalyticsWindow,
    ApcTrendPoint,
    KitchenAnalytics,
    MenuInsights,
    MetricExplainers,
    MonthlyApcInsight,
} from '@/lib/db';
import { refusalSentence } from '@/lib/error-message';

export type {
    AdvancedAnalytics,
    ApcTrendPoint,
    KitchenAnalytics,
    MenuInsights,
    MetricExplainers,
    MonthlyApcInsight,
};

/** An HTTP refusal: a real answer, shown as one (never dressed as an outage). */
export class AnalyticsRefusal extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
        super(message);
        this.name = 'AnalyticsRefusal';
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
        throw new AnalyticsRefusal(sentence ?? `Request failed (${res.status})`, res.status);
    }
    return (res.data ?? {}) as T;
};

// `from`/`to` AND `days` go on the wire together, exactly as the Flutter
// module sends them: a backend that understands the range uses it, one that
// does not still gets a window of the right LENGTH.
const windowQuery = (w: AnalyticsWindow): string => {
    const days = Math.max(1, Math.round(Number(w.days) || 30));
    return `days=${days}`
        + (w.from ? `&from=${encodeURIComponent(w.from)}` : '')
        + (w.to ? `&to=${encodeURIComponent(w.to)}` : '');
};

// --- Attendance (additive fields on /analytics/advanced) ---------------------
// The web `AdvancedAnalytics` type predates these, so they are typed here —
// db.ts is frozen for this lane. Verified against the live backend payload.

export interface StaffAttendanceRow {
    emp_id?: string;
    name: string;
    shifts: number;
    hours_worked: number;
    avg_shift_hours: number;
    days_present: number;
    absent_days: number;
    leave_days?: number;
    late_shifts: number;
    /** Null until the person has enough worked days for a baseline. */
    late_pct: number | null;
    typical_start?: string;
    pending_shifts?: number;
    rejected_shifts?: number;
    currently_clocked_in?: boolean;
    last_seen?: string;
}

export interface AttendanceSummary {
    window_days?: number;
    staff_tracked?: number;
    operating_days?: number;
    total_shifts?: number;
    total_hours?: number;
    avg_hours_per_staff?: number;
    pending_shifts?: number;
    late_shifts?: number;
    absent_days?: number;
    leave_days?: number;
}

/** /analytics/advanced with the attendance block the Flutter module reads. */
export interface AdvancedAnalyticsX extends AdvancedAnalytics {
    staff_attendance?: StaffAttendanceRow[];
    attendance_summary?: AttendanceSummary;
}

// --- Item-wise prep per station (additive field on /analytics/kitchen) -------
// Nested under the station that cooks it, built from the FULL dish set
// server-side (by_dish is capped at the 40 slowest overall). Each section's
// `dishes` is capped at 25 with `dishes_total` giving the true count.

export interface KitchenSectionDish {
    id?: string | null;
    name: string;
    station?: string;
    count: number;
    avg_prep_ms: number;
    p90_prep_ms?: number;
    min_prep_ms?: number;
    max_prep_ms?: number;
}

export interface KitchenSectionItems {
    section: string;
    items_timed?: number;
    dishes_total?: number;
    avg_prep_ms?: number;
    p90_prep_ms?: number;
    max_prep_ms?: number;
    dishes?: KitchenSectionDish[];
}

/** /analytics/kitchen with the per-station item lists. */
export interface KitchenAnalyticsX extends KitchenAnalytics {
    by_section_items?: KitchenSectionItems[];
}

// --- The four REQUIRED reads --------------------------------------------------

export const getApcInsight = (restaurantId: string): Promise<MonthlyApcInsight> =>
    fetchJson<MonthlyApcInsight>('/orders/apc', restaurantId);

export interface FeedbackSummary {
    totalResponses?: number;
    averageRating?: number;
    last30DaysResponses?: number;
}

export const getFeedbackSummary = (restaurantId: string): Promise<FeedbackSummary> =>
    fetchJson<FeedbackSummary>('/feedback/summary', restaurantId);

export interface DailyRevenuePoint { date?: string; revenue?: number; orders?: number }

/**
 * Fixed at 14 points on purpose (the Flutter module's comment): this is the
 * sparkline strip, not a report — it is a shape, and stretching it to a year
 * of daily bars renders as a solid block.
 */
export const getDailyRevenue = async (restaurantId: string, days = 14): Promise<DailyRevenuePoint[]> => {
    const d = await fetchJson<{ series?: DailyRevenuePoint[] }>(`/orders/daily-revenue?days=${days}`, restaurantId);
    return Array.isArray(d.series) ? d.series : [];
};

export interface TimingStats { avg_prep_ms?: number; max_prep_ms?: number; count?: number }

export const getTimingStats = (restaurantId: string): Promise<TimingStats> =>
    fetchJson<TimingStats>('/orders/timing-stats', restaurantId);

// --- The five OPTIONAL reads (degrade to empty on an older backend) -----------

const getMenuInsightsStrict = (restaurantId: string, w: AnalyticsWindow): Promise<MenuInsights> =>
    fetchJson<MenuInsights>(`/analytics/menu-insights?${windowQuery(w)}`, restaurantId);

const getApcTrendsStrict = async (restaurantId: string, months: number): Promise<ApcTrendPoint[]> => {
    const d = await fetchJson<{ series?: ApcTrendPoint[] }>(
        `/orders/apc-trends?months=${Math.max(1, months)}`,
        restaurantId,
    );
    return Array.isArray(d.series) ? d.series : [];
};

const getAdvancedStrict = (restaurantId: string, w: AnalyticsWindow): Promise<AdvancedAnalyticsX> =>
    fetchJson<AdvancedAnalyticsX>(`/analytics/advanced?${windowQuery(w)}`, restaurantId);

const getKitchenStrict = (restaurantId: string, w: AnalyticsWindow): Promise<KitchenAnalyticsX> =>
    fetchJson<KitchenAnalyticsX>(`/analytics/kitchen?${windowQuery(w)}`, restaurantId);

const getExplainersStrict = async (restaurantId: string): Promise<MetricExplainers> => {
    const d = await fetchJson<{ explainers?: MetricExplainers }>('/analytics/metric-explainers', restaurantId);
    return d.explainers ?? {};
};

// --- The one load the whole page makes -----------------------------------------

export interface AnalyticsBundle {
    apc: MonthlyApcInsight;
    feedback: FeedbackSummary;
    daily: DailyRevenuePoint[];
    timing: TimingStats;
    menu: MenuInsights | null;
    trends: ApcTrendPoint[];
    adv: AdvancedAnalyticsX | null;
    kitchen: KitchenAnalyticsX | null;
    explainers: MetricExplainers;
}

/**
 * Every window-aware read takes the SAME window (`from`/`to`/`days`), and the
 * month-granular trend takes the months the window spans — the one-window rule
 * the Flutter module exists to enforce.
 */
export const loadAnalyticsBundle = async (
    restaurantId: string,
    w: AnalyticsWindow,
    trendMonths: number,
): Promise<AnalyticsBundle> => {
    const [apc, feedback, daily, timing, menu, trends, adv, kitchen, explainers] = await Promise.all([
        getApcInsight(restaurantId),
        getFeedbackSummary(restaurantId),
        getDailyRevenue(restaurantId, 14),
        getTimingStats(restaurantId),
        getMenuInsightsStrict(restaurantId, w).catch(() => null),
        getApcTrendsStrict(restaurantId, trendMonths).catch(() => [] as ApcTrendPoint[]),
        getAdvancedStrict(restaurantId, w).catch(() => null),
        getKitchenStrict(restaurantId, w).catch(() => null),
        getExplainersStrict(restaurantId).catch(() => ({})),
    ]);
    return { apc, feedback, daily, timing, menu, trends, adv, kitchen, explainers };
};
