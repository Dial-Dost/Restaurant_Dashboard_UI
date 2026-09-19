// WHAT THE OVERVIEW MAY PUT ON SCREEN FOR ONE SIGNED-IN USER.
//
// COMPOSED, not filtered — the web copy of the Flutter `OverviewScope`
// (restaurant_owner_app/lib/models/role_scope.dart). Every flag is asked BEFORE
// the request that feeds its block, so a section this user may not see is never
// fetched, never rendered, and never leaves a 403-shaped hole behind.
//
// Each flag is two gates ANDed:
//   * PERMISSION mirrors what the server enforces on the endpoints behind the
//     block, quoting the module registry's own keyword lists (nav-registry.ts)
//     rather than inventing new ones. /orders/apc and /orders/daily-revenue are
//     both gated on the action NAMED "View Order APC" — which is precisely what
//     Analytics' ['analytics', 'apc', 'report'] matches.
//   * ROLE is the server's `waiter_only` (session-scope.ts). A waiter's landing
//     screen carries no restaurant money EVEN WHEN their tenant granted them
//     "View Order APC". The web adds the valet-only role to the same side of
//     the line: a valet session is a car-park post, not the till.
//
// A WAITER'S OVERVIEW IS A DIFFERENT PAGE, not a subset of this one. It is
// `scorecard`: their APC, their attendance, their guest ratings and the
// composite score built from them, and nothing else.
//
// Lives beside the Overview (not in session-scope.ts) because that shared file
// is other lanes' surface too; nothing here re-derives an answer the server
// sent — `isWaiterOnly` is read as given.

import type { AuthUser } from '@/context/AuthContext';
import { canAccessByKeywords, type NavGateContext } from '@/lib/nav-registry';
import { isWaiterOnly } from '@/lib/session-scope';

export interface OverviewScope {
    /** The rupee figures read straight from /orders/apc and /orders/daily-revenue. */
    money: boolean;
    /** The composed 30-day insight read (/analytics/overview). Carries the plan flag too. */
    insights: boolean;
    /** The restaurant-wide guest-rating summary (/feedback/summary). */
    rating: boolean;
    /** The floor read (/get-tables): occupancy and covers seated across the restaurant. */
    floor: boolean;
    /** Whether the open-bills tile may price itself. Gates the RUPEES only, never the count. */
    billValue: boolean;
    /** The waiter's personal scorecard (/me/scorecard) — the whole of their Overview. */
    scorecard: boolean;
    /** The tenant's subscription limits on the Account card. */
    planLimits: boolean;
}

/**
 * Analytics' keyword list, VERBATIM (nav-registry.ts). 'apc' is the keyword
 * that does the work: the authorizing action is named "View Order APC".
 */
export const ANALYTICS_KEYWORDS = ['analytics', 'apc', 'report'];

// A full NavGateContext so `canAccessByKeywords` — the one implementation of
// the keyword rule — can be reused; the fields it never reads are inert stubs.
const keywordCtx = (user: AuthUser | null | undefined): NavGateContext => ({
    isAdmin: false,
    waiterOnly: false,
    hasAllActions: Array.isArray(user?.actions_set) && user.actions_set.includes('*'),
    actionNames: new Set(
        (user?.action_names ?? [])
            .map((name) => name.trim().toLowerCase())
            .filter((name) => name.length > 0),
    ),
    capabilityAnswered: () => undefined,
    featureEnabled: () => true,
});

const valetOnly = (user: AuthUser | null | undefined): boolean => {
    const roles = new Set(
        [user?.role, ...(Array.isArray(user?.role_all) ? user.role_all : [])]
            .map((r) => (r ?? '').toLowerCase())
            .filter((r) => r.length > 0),
    );
    return roles.has('valet') && !roles.has('admin');
};

export const overviewScopeOf = (
    user: AuthUser | null | undefined,
    featureEnabled: (feature: 'analytics') => boolean,
): OverviewScope => {
    const waiterOnly = isWaiterOnly(user);
    // The valet post: no restaurant money, no floor summary, no insights — but
    // not the waiter's scorecard page either; their landing module is Valet.
    const scoped = waiterOnly || valetOnly(user);
    const ctx = keywordCtx(user);
    const can = (keywords: string[]): boolean => canAccessByKeywords(ctx, keywords);
    const analytics = can(ANALYTICS_KEYWORDS);
    return {
        money: !scoped && analytics,
        insights: !scoped && analytics && featureEnabled('analytics'),
        rating: !scoped && can(['feedback']),
        floor: !scoped && can(['table']),
        billValue: !scoped,
        scorecard: waiterOnly,
        planLimits: !scoped,
    };
};
