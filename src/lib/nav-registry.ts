// THE MODULE REGISTRY — the web copy of the Flutter shell's `_navSections`
// (restaurant_owner_app/lib/screens/home_shell.dart), which is the source of
// truth for what exists, how it is grouped, what it is called, and who sees it.
//
// ONE source: the sidebar, the route guard and the notifications bell all read
// this file. Section order, labels and every gate below are copied from
// home_shell.dart VERBATIM — do not "improve" a keyword list here; the Flutter
// file documents at length why each one is exactly what it is (e.g. Reports
// carries Analytics' keywords because the authorizing action is NAMED
// "View Order APC", and the 'accounting' FEATURE because FEATURE_BY_PREFIX maps
// /reports to the accounting plan flag).
//
// Pure TypeScript — no React, no fetch — so the gating is testable the same way
// `visibleModuleLabelsFor` is on the Flutter side.

import type { LucideIcon } from 'lucide-react';
import {
    BookOpen,
    Banknote,
    CalendarCheck,
    CalendarDays,
    ChartLine,
    ChefHat,
    Clock,
    CreditCard,
    FileSpreadsheet,
    History,
    Hourglass,
    IdCard,
    Landmark,
    LayoutDashboard,
    LayoutGrid,
    MessageSquareText,
    Package,
    Printer,
    ReceiptText,
    Settings,
    Shield,
    SlidersHorizontal,
    SquareParking,
    Store,
    TriangleAlert,
    Truck,
    Users,
    Utensils,
} from 'lucide-react';

import type { Capability } from '@/lib/session-scope';

/** Subscription-plan feature flags the registry gates on (Profile.featureEnabled). */
export type PlanFeature = 'analytics' | 'inventory' | 'valet' | 'accounting' | 'multi_outlet';

export interface NavModule {
    /** The Flutter registry label, verbatim — also the bell's module vocabulary. */
    label: string;
    href: string;
    icon: LucideIcon;
    /** Only Overview: `/dashboard` would otherwise prefix-match everything. */
    exact?: boolean;
    /** Permission keywords (substring match on permitted ACTION NAMES); empty = always visible. */
    keywords: string[];
    /** Plan feature flag (additive — hidden only when the plan explicitly sets it false). */
    feature?: PlanFeature;
    /** Hard admin gate, regardless of keywords. */
    adminOnly?: boolean;
    /**
     * THE SERVER'S OWN ANSWER for "may this identity open this module", where
     * there is one. ANDed with the keyword gate, never a replacement — a module
     * can only ever be NARROWED by adding one. On a backend that has not
     * answered, the keyword gate stays the whole rule (fallback true).
     */
    capability?: Capability;
}

export interface NavSection {
    /** Stored uppercase — rendered verbatim as the 10px tracked header. */
    title: string;
    modules: NavModule[];
}

/**
 * Overview is a NAMED const because one role moves it: a waiter's nav ends with
 * it instead of opening on it (see `sectionsFor`). Both lists must hold the
 * SAME instance.
 */
const OVERVIEW_ENTRY: NavModule = {
    label: 'Overview',
    href: '/dashboard',
    icon: LayoutDashboard,
    exact: true,
    keywords: [],
};

export const NAV_SECTIONS: NavSection[] = [
    {
        title: 'OPERATIONS',
        modules: [
            OVERVIEW_ENTRY,
            // Keywords and feature MIRROR Analytics exactly — GET /analytics/concerns
            // is gated on the one analytics Action every /analytics/* route uses.
            { label: 'Concerns', href: '/dashboard/concerns', icon: TriangleAlert, keywords: ['analytics', 'apc', 'report'], feature: 'analytics' },
            { label: 'Orders', href: '/dashboard/orders', icon: ReceiptText, keywords: ['order', 'bill', 'payment'] },
            { label: 'Kitchen', href: '/dashboard/kitchen', icon: ChefHat, keywords: ['order', 'kitchen', 'kot', 'kds'] },
            { label: 'Tables', href: '/dashboard/tables', icon: Utensils, keywords: ['table'] },
            // D5 — same keywords as Tables, deliberately: every write behind it is
            // re-checked by the server; a narrower invented gate is the failure the
            // Flutter Simulation entry records.
            { label: 'Floor plan', href: '/dashboard/floor-plan', icon: LayoutGrid, keywords: ['table'] },
            { label: 'Waitlist', href: '/dashboard/waitlist', icon: Hourglass, keywords: ['table', 'order', 'waitlist'] },
            { label: 'Bookings', href: '/dashboard/bookings', icon: CalendarCheck, keywords: ['booking'] },
            { label: 'Menu', href: '/dashboard/menu', icon: BookOpen, keywords: ['menu'] },
        ],
    },
    {
        title: 'INVENTORY',
        modules: [
            { label: 'Inventory', href: '/dashboard/inventory', icon: Package, keywords: ['inventory', 'stock'], feature: 'inventory' },
            { label: 'Purchase Orders', href: '/dashboard/purchase-orders', icon: Truck, keywords: ['inventory', 'stock', 'purchase', 'vendor'], feature: 'inventory' },
        ],
    },
    {
        title: 'TEAM',
        modules: [
            { label: 'Attendance', href: '/dashboard/attendance', icon: Clock, keywords: [] },
            { label: 'Employees', href: '/dashboard/employees', icon: IdCard, keywords: ['employee', 'role', 'user'] },
            // Keywords AND the server's viewRoles capability — the keyword gate said
            // yes to every employee editor, whose two reads would then 403 (C6).
            { label: 'Roles', href: '/dashboard/roles', icon: Shield, keywords: ['role', 'permission'], capability: 'view_roles' },
            { label: 'Valet', href: '/dashboard/valet', icon: SquareParking, keywords: ['valet', 'parking'], feature: 'valet' },
        ],
    },
    // GUESTS SITS AFTER TEAM, AND FEEDBACK LEADS IT, so Feedback reads directly
    // under Valet — deliberate placement, copied from home_shell.dart.
    {
        title: 'GUESTS',
        modules: [
            { label: 'Feedback', href: '/dashboard/feedback', icon: MessageSquareText, keywords: ['feedback'] },
            { label: 'Customers', href: '/dashboard/customers', icon: Users, keywords: ['customer'] },
        ],
    },
    {
        title: 'INSIGHTS',
        modules: [
            { label: 'Analytics', href: '/dashboard/analytics', icon: ChartLine, keywords: ['analytics', 'apc', 'report'], feature: 'analytics' },
            // Analytics' keyword list VERBATIM — the authorizing action is named
            // "View Order APC"; 'apc' is the keyword that matches it.
            { label: 'Simulation', href: '/dashboard/simulation', icon: SlidersHorizontal, keywords: ['analytics', 'apc', 'report'], feature: 'analytics' },
            { label: 'History', href: '/dashboard/history', icon: CalendarDays, keywords: ['analytics', 'report'], feature: 'analytics' },
            // KEYWORDS are Analytics' list verbatim; FEATURE is 'accounting' because
            // FEATURE_BY_PREFIX maps the /reports prefix to the accounting plan flag.
            { label: 'Reports', href: '/dashboard/reports', icon: FileSpreadsheet, keywords: ['analytics', 'apc', 'report'], feature: 'accounting' },
        ],
    },
    {
        title: 'MONEY',
        modules: [
            { label: 'Accounting', href: '/dashboard/accounting', icon: Landmark, keywords: ['report', 'accounting', 'finance', 'expense', 'analytics'], feature: 'accounting' },
            { label: 'Cash register', href: '/dashboard/cash', icon: Banknote, keywords: ['report', 'accounting', 'finance', 'cash'], feature: 'accounting' },
            { label: 'Billing', href: '/dashboard/billing', icon: CreditCard, keywords: [], adminOnly: true },
        ],
    },
    {
        title: 'SETUP',
        modules: [
            { label: 'Outlets', href: '/dashboard/outlets', icon: Store, keywords: ['outlet', 'branch', 'setting', 'profile'], feature: 'multi_outlet' },
            { label: 'Printer', href: '/dashboard/printer', icon: Printer, keywords: [] },
            { label: 'Audit Log', href: '/dashboard/audit-logs', icon: History, keywords: ['audit', 'log'] },
            { label: 'Settings', href: '/dashboard/settings', icon: Settings, keywords: [], adminOnly: true },
        ],
    },
];

// ---------------------------------------------------------------- role scope --
// The waiter scoping, copied from restaurant_owner_app/lib/models/role_scope.dart.
// `waiter_only` itself is the SERVER's answer (session-scope.ts) — this file
// only says what follows from it.

/** The nav group a waiter's Overview is moved into — the LAST section. */
export const TRAILING_SECTION_TITLE = 'YOUR SHIFT';

/** The tab a waiter opens the app on. */
export const WAITER_LANDING_MODULE = 'Tables';

/**
 * Modules a waiter-only identity never sees in the nav, whatever their tenant's
 * grants say. RoleScope.hiddenModules verbatim: the floor modules that are not
 * a waiter's job, and every module that prices the restaurant.
 */
export const WAITER_HIDDEN_MODULES: ReadonlySet<string> = new Set([
    // the floor modules
    'Floor plan',
    'Menu',
    'Kitchen',
    'Waitlist',
    'Bookings',
    // the money modules
    'Concerns',
    'Analytics',
    'Simulation',
    'History',
    'Reports',
    'Accounting',
    'Cash register',
]);

/**
 * The sidebar groups THIS user is given, in render order. Identical to
 * NAV_SECTIONS for everyone except a waiter-only identity, whose Overview
 * leaves OPERATIONS and becomes a trailing "YOUR SHIFT" section of its own.
 */
export const sectionsFor = (waiterOnly: boolean): NavSection[] => {
    if (!waiterOnly) { return NAV_SECTIONS; }
    return [
        ...NAV_SECTIONS.map((s) =>
            s.modules.includes(OVERVIEW_ENTRY)
                ? { ...s, modules: s.modules.filter((m) => m !== OVERVIEW_ENTRY) }
                : s,
        ),
        { title: TRAILING_SECTION_TITLE, modules: [OVERVIEW_ENTRY] },
    ];
};

// ------------------------------------------------------------------- gating --

/**
 * Everything a visibility decision needs, resolved ONCE by the caller (a React
 * hook or a test) so this module stays pure.
 */
export interface NavGateContext {
    isAdmin: boolean;
    /** The server's `scope.waiter_only` — never re-derived from role strings. */
    waiterOnly: boolean;
    /** `actions_set` contains the `*` wildcard. */
    hasAllActions: boolean;
    /** Permitted action NAMES, lowercased. */
    actionNames: ReadonlySet<string>;
    /**
     * The server's capability answer, or undefined when it did not send one —
     * `answered()` from session-scope.ts. Undefined falls back to TRUE so the
     * keyword gate stays the whole rule on an older backend (RoleScope.may with
     * fallback: true).
     */
    capabilityAnswered: (c: Capability) => boolean | undefined;
    /** Additive plan gate — false ONLY when the plan explicitly disables the flag. */
    featureEnabled: (feature?: PlanFeature) => boolean;
}

/**
 * `Profile.can`, line for line: empty keywords ⇒ true; the `*` wildcard ⇒ true;
 * otherwise substring-match the keywords against permitted action names. An
 * EMPTY action-name list also passes — the lenient direction this web app has
 * always taken for payloads that predate `action_names`.
 */
export const canAccessByKeywords = (ctx: NavGateContext, keywords: string[]): boolean => {
    if (keywords.length === 0) { return true; }
    if (ctx.hasAllActions) { return true; }
    if (ctx.actionNames.size === 0) { return true; }
    for (const name of ctx.actionNames) {
        if (keywords.some((k) => name.includes(k))) { return true; }
    }
    return false;
};

/** The shell's one visibility rule — `_visibleModulesFor` verbatim. */
export const moduleVisible = (ctx: NavGateContext, mod: NavModule): boolean =>
    (!mod.adminOnly || ctx.isAdmin) &&
    canAccessByKeywords(ctx, mod.keywords) &&
    (mod.capability == null || (ctx.capabilityAnswered(mod.capability) ?? true)) &&
    ctx.featureEnabled(mod.feature) &&
    !(ctx.waiterOnly && WAITER_HIDDEN_MODULES.has(mod.label));

/**
 * The grouped nav this user is shown. A section whose every module is hidden
 * contributes NOTHING — no orphan headers, no stacked dividers.
 */
export const visibleSectionsFor = (ctx: NavGateContext): NavSection[] =>
    sectionsFor(ctx.waiterOnly)
        .map((s) => ({ ...s, modules: s.modules.filter((m) => moduleVisible(ctx, m)) }))
        .filter((s) => s.modules.length > 0);

/** The flat list, in section order — route guard, back trail and bell all read it. */
export const visibleModulesFor = (ctx: NavGateContext): NavModule[] =>
    visibleSectionsFor(ctx).flatMap((s) => s.modules);

/**
 * The module this user opens the app on. Resolved by LABEL against the list
 * actually being rendered, so a role whose landing module is hidden lands on
 * the first module they really do have. `valetOnly` is the web's one landing
 * preference beyond the Flutter rule: a valet-role session starts on Valet.
 */
export const landingModuleFor = (
    visible: NavModule[],
    opts: { waiterOnly: boolean; valetOnly: boolean },
): NavModule | null => {
    if (visible.length === 0) { return null; }
    const want = opts.waiterOnly ? WAITER_LANDING_MODULE : opts.valetOnly ? 'Valet' : null;
    if (want) {
        const hit = visible.find((m) => m.label === want);
        if (hit) { return hit; }
    }
    return visible[0];
};

/** Every registered module, flat — for label→href lookups outside gating. */
export const ALL_NAV_MODULES: NavModule[] = NAV_SECTIONS.flatMap((s) => s.modules);

/** label → module (the bell's `visibleLabels` vocabulary). */
export const moduleByLabel = (label: string): NavModule | null =>
    ALL_NAV_MODULES.find((m) => m.label === label) ?? null;

/**
 * The module a pathname belongs to (longest prefix wins; Overview only exact),
 * for the top bar title and the back trail.
 */
export const moduleForPath = (pathname: string): NavModule | null => {
    let best: NavModule | null = null;
    for (const mod of ALL_NAV_MODULES) {
        if (mod.exact) {
            if (pathname === mod.href) { return mod; }
            continue;
        }
        if (pathname === mod.href || pathname.startsWith(`${mod.href}/`)) {
            if (!best || mod.href.length > best.href.length) { best = mod; }
        }
    }
    return best;
};
