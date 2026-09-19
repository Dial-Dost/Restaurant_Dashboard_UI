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
import { FOCUS_PARAM } from '@/components/focus-banner';

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
    // The resolver (and the explain flow) also answer with these — a missing
    // row here rendered as "Can't open this one" for a perfectly good target.
    Reports: '/dashboard/reports',
    Accounting: '/dashboard/accounting',
    History: '/dashboard/history',
    Tables: '/dashboard/tables',
    Kitchen: '/dashboard/kitchen',
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
 * What the destination module needs to focus the record: the notification's own
 * meta, plus the resolver's entity so even an old row (meta with just
 * `order_id`) resolves to a concrete id. Mirrors the Flutter bell's
 * `_focusTarget`.
 */
export const notificationFocusTarget = (
    meta: Record<string, unknown> | null | undefined,
    resolved?: Pick<NotificationTarget, 'entity'> | null,
): Record<string, unknown> => {
    const merged: Record<string, unknown> = { ...(meta ?? {}) };
    const entity = resolved?.entity;
    if (entity) {
        if (entity.id) {merged.entity_id = entity.id;}
        if (entity.type) {merged.entity_type = entity.type;}
    }
    return merged;
};

/**
 * The href to open for a resolved target, or null when there is nothing to open
 * (a KPI/exception alert with `module: null`).
 *
 * The focus payload (`?focus=<json>` — see useFocusRequest) and the legacy
 * highlight param are only appended when the destination can actually show the
 * row — linking a record that is filtered out would just re-create the original
 * bug in URL form. The legacy param stays until every module reads the focus
 * banner instead of useHighlightRow.
 */
export const notificationHref = (target: NotificationTarget): string | null => {
    const base = target.module ? MODULE_ROUTES[target.module] : null;
    if (!base) {return null;}
    if (!target.entity || !target.visible_here) {return base;}
    let href = `${base}?${FOCUS_PARAM}=${encodeURIComponent(JSON.stringify(notificationFocusTarget(target.meta, target)))}`;
    const param = ENTITY_HIGHLIGHT_PARAM[target.entity.type];
    if (param) {href += `&${param}=${encodeURIComponent(target.entity.id)}`;}
    return href;
};

/**
 * The type -> module fallback for when the resolver cannot be reached (offline
 * or an older backend) — `_moduleForType` in notifications_bell.dart, verbatim.
 * `warning` is overloaded, so it is disambiguated by which id its meta carries.
 */
export const fallbackModuleForType = (
    type: string,
    meta: Record<string, unknown> | null | undefined,
): string | null => {
    const m = meta ?? {};
    switch (type) {
        case 'order':
        case 'payment':
            return 'Orders';
        case 'reservation':
            return 'Bookings';
        case 'waitlist':
            return 'Waitlist';
        case 'valet':
            return 'Valet';
        case 'warning':
            if ('request_id' in m) {return 'Orders';} // discount approval
            if ('feedback_id' in m) {return 'Feedback';} // low rating
            return 'Analytics'; // KPI alert (alert_key) and everything else
        case 'report':
            return m.module === 'Accounting' ? 'Accounting' : 'Reports';
        default:
            return null;
    }
};

/** The best-effort href for the resolver-unreachable path. */
export const fallbackNotificationHref = (
    type: string,
    meta: Record<string, unknown> | null | undefined,
): string | null => {
    const moduleLabel = fallbackModuleForType(type, meta);
    const base = moduleLabel ? MODULE_ROUTES[moduleLabel] : null;
    if (!base) {return null;}
    const target = notificationFocusTarget(meta);
    if (Object.keys(target).length === 0) {return base;}
    return `${base}?${FOCUS_PARAM}=${encodeURIComponent(JSON.stringify(target))}`;
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
