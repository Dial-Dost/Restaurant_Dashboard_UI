/**
 * WHO MAY OPEN WHICH DASHBOARD SECTION — the nav's rule, in one place.
 *
 * The dashboard layout gates every nav item on an action-keyword list and
 * REDIRECTS a session that lands on a path it would not be offered. Any link
 * built without that same rule is a disguised dead tap: it navigates, the layout
 * bounces it, and the owner is back where they started with no idea why. The
 * Overview's cards and its "Today at a glance" box (client item 10) link into
 * these sections, so the keyword table lives here and the layout, the Overview
 * and the glance resolver all read it.
 *
 * THE KEYWORDS ARE THE LAYOUT'S, MOVED, NOT REWRITTEN. In particular Reports is
 * still keyworded on accounting words while the Flutter app keys it on 'apc'
 * (the "View Order APC" action that actually authorises /reports/mis/*). That
 * drift predates this file and is not fixed here; the glance resolver works
 * around it with fallbacks, which is what src/lib/__tests__ pins.
 *
 * PURE — no React, no fetch — like session-scope.ts, so jest can pin it.
 */

import { canOpenFloorPlan, isWaiterOnly, type ScopedSession } from './session-scope';

/** The action-keyword gate for every section the layout offers. */
export const SECTION_KEYWORDS = {
    '/dashboard': [],
    '/dashboard/orders': ['order', 'bill', 'payment'],
    '/dashboard/tables': ['table'],
    '/dashboard/floor-plan': [],
    '/dashboard/waitlist': ['table', 'order', 'waitlist'],
    '/dashboard/bookings': ['booking'],
    '/dashboard/menu': ['menu'],
    '/dashboard/inventory': ['inventory', 'stock'],
    '/dashboard/purchase-orders': ['inventory', 'stock', 'purchase', 'vendor'],
    '/dashboard/customers': ['customer'],
    '/dashboard/feedback': ['feedback'],
    '/dashboard/coupons': [],
    '/dashboard/attendance': [],
    '/dashboard/valet': ['valet', 'parking'],
    '/dashboard/analytics': ['analytics', 'apc', 'report'],
    '/dashboard/simulation': ['analytics', 'apc', 'report'],
    '/dashboard/history': ['analytics', 'report'],
    // Gated on ACCOUNTING in the nav; see the header for the drift this carries.
    '/dashboard/reports': ['report', 'accounting', 'finance'],
    '/dashboard/accounting': ['report', 'accounting', 'finance'],
    '/dashboard/cash': ['report', 'accounting', 'finance', 'cash'],
    '/dashboard/billing': [],
    '/dashboard/outlets': ['outlet', 'branch', 'setting', 'profile'],
} as const satisfies Record<string, readonly string[]>;

export type DashboardSection = keyof typeof SECTION_KEYWORDS;

/**
 * Offered to an admin only — the layout adds these for `hasRole('admin')`, and
 * Settings lives in the avatar menu on the same condition (the backend's
 * enforceAdmin gate).
 */
export const ADMIN_ONLY_SECTIONS: readonly string[] = [
    '/dashboard/coupons', '/dashboard/valet', '/dashboard/billing', '/dashboard/settings',
];

/** The two screens a scoped waiter works from — the layout's own allow-list. */
export const WAITER_SECTIONS: readonly string[] = ['/dashboard/orders', '/dashboard/tables'];

/** The keyword list a section is gated on. */
export const sectionKeywords = (href: DashboardSection): string[] => [...SECTION_KEYWORDS[href]];

const normalizeActionName = (value: string): string => value.trim().toLowerCase();

/** True when any granted action NAME contains one of the keywords. */
export const hasKeywordAction = (actionNames: ReadonlySet<string>, keywords: readonly string[]): boolean => {
    if (keywords.length === 0) {return true;}
    for (const actionName of actionNames) {
        if (keywords.some((keyword) => actionName.includes(keyword.toLowerCase()))) {
            return true;
        }
    }
    return false;
};

/** The fields of the signed-in user this module reads. */
export interface SectionSession extends ScopedSession {
    role?: string;
    role_all?: string[];
    action_names?: string[];
}

export const actionNameSet = (session: SectionSession | null | undefined): Set<string> =>
    new Set((session?.action_names ?? []).map(normalizeActionName).filter((name) => name.length > 0));

/**
 * The layout's keyword rule: a wildcard session, or one that carries no action
 * names at all (a session from before they were published), passes.
 */
export const canAccessByKeywords = (session: SectionSession | null | undefined, keywords: readonly string[]): boolean => {
    if (!session) {return false;}
    if (Array.isArray(session.actions_set) && session.actions_set.includes('*')) {return true;}
    const names = actionNameSet(session);
    if (names.size === 0) {return true;}
    return hasKeywordAction(names, keywords);
};

const hasRole = (session: SectionSession, role: string): boolean =>
    session.role === role || (Array.isArray(session.role_all) && session.role_all.includes(role));

/**
 * May this session open [href] without the layout bouncing it?
 *
 * The layout's whole rule, in its order: a valet has only the valet board; a
 * scoped waiter only Orders and Tables; Settings and the admin extras only an
 * admin; the floor plan only a session holding a layout permission; everything
 * else by its keyword list. An href the layout does not offer at all is false.
 */
export const canOpenDashboardSection = (session: SectionSession | null | undefined, href: string): boolean => {
    if (!session) {return false;}
    const isAdmin = hasRole(session, 'admin');
    if (hasRole(session, 'valet') && !isAdmin) {return href === '/dashboard/valet';}
    if (isWaiterOnly(session)) {return WAITER_SECTIONS.includes(href);}
    if (href === '/dashboard/settings') {return isAdmin;}
    if (ADMIN_ONLY_SECTIONS.includes(href) && !isAdmin) {return false;}
    if (href === '/dashboard/floor-plan') {return canOpenFloorPlan(session);}
    if (!(href in SECTION_KEYWORDS)) {return false;}
    return canAccessByKeywords(session, SECTION_KEYWORDS[href as DashboardSection]);
};
