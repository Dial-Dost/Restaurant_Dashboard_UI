// Turns a resolved notification target into a dashboard URL that opens the right
// page AND focuses the exact record.
//
// The backend resolver (GET /notifications/:id/target) answers in owner-app
// module labels ("Orders", "Bookings", …) so the Flutter app and the web
// dashboard agree on the destination. This table is the web half of that
// contract: label -> route, and entity type -> the query param the destination
// page reads to highlight one row.
//
// Rule: never navigate on `still_exists` alone. A record can exist and still be
// unreachable from the current scope, which is precisely what made notifications
// feel broken — the page opened and the record was not on it. Gate on
// `visible_here` and show the resolver's `message` otherwise.

import type { NotificationTarget } from '@/lib/db';

/** Owner-app module label -> web dashboard route. */
export const MODULE_ROUTES: Record<string, string> = {
    Orders: '/dashboard/orders',
    Bookings: '/dashboard/bookings',
    Waitlist: '/dashboard/waitlist',
    Valet: '/dashboard/valet',
    Feedback: '/dashboard/feedback',
    Inventory: '/dashboard/inventory',
    Employees: '/dashboard/employees',
    Analytics: '/dashboard/analytics',
    // Client item 9: a report bell opens the Email reports view (its history
    // and files); a 2.0.1 inbox schedule's bell names Accounting, whose card
    // points there.
    Reports: '/dashboard/reports?view=email',
    Accounting: '/dashboard/accounting',
};

/**
 * Entity type -> the `?param=` the destination page reads to scroll to and ring
 * one row. Keep in step with the pages that implement it (see useHighlightRow).
 */
export const ENTITY_HIGHLIGHT_PARAM: Record<string, string> = {
    order: 'highlightOrder',
    discount_request: 'highlightRequest',
    booking: 'highlightBooking',
    waitlist: 'highlightWaitlist',
    valet_record: 'highlightValet',
    feedback: 'highlightFeedback',
    inventory_item: 'highlightInventory',
    employee: 'highlightEmployee',
};

/**
 * The href to open for a resolved target, or null when there is nothing to open
 * (a KPI/exception alert with `module: null`).
 *
 * The highlight param is only appended when the destination can actually show
 * the row — linking to `?highlightOrder=<id>` for a record that is filtered out
 * would just re-create the original bug in URL form.
 */
export const notificationHref = (target: NotificationTarget): string | null => {
    const base = target.module ? MODULE_ROUTES[target.module] : null;
    if (!base) {return null;}
    const param = target.entity ? ENTITY_HIGHLIGHT_PARAM[target.entity.type] : undefined;
    if (!param || !target.entity || !target.visible_here) {return base;}
    return `${base}?${param}=${encodeURIComponent(target.entity.id)}`;
};

/**
 * What the UI should say when a notification cannot be opened. Prefers the
 * backend's own sentence (it knows *which* outlet, *which* window) and only
 * falls back for the handful of reasons it leaves uncommented.
 */
export const notificationBlockedMessage = (target: NotificationTarget): string => {
    if (target.message && target.message.trim().length > 0) {return target.message;}
    switch (target.reason_gone) {
        case 'deleted':
            return 'The record this notification was about no longer exists — it was deleted.';
        case 'other_outlet':
            return 'This record belongs to a different outlet. Switch outlet to open it.';
        case 'outside_live_window':
            return 'This order has been settled for a while and has left the live grid — find it in History.';
        case 'no_longer_in_queue':
            return 'This party has already left the queue.';
        case 'already_resolved':
            return 'This request has already been decided.';
        case 'no_target':
            return 'This is an alert about overall numbers, not a single record.';
        default:
            return 'This notification has no record to open.';
    }
};
