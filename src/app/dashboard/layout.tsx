
"use client";

import { useEffect, useMemo } from 'react';
import { Inter } from 'next/font/google';
import {
  Home,
  LineChart,
  Package,
  ShoppingCart,
  Users,
  Globe,
  ClipboardList,
  ListOrdered,
  FileText,
  Settings,
  LifeBuoy,
  LogOut,
  BookOpen,
  Activity,
  Clock,
  Ticket,
  Wallet,
  Truck,
  CreditCard,
  Hourglass,
  History,
  SlidersHorizontal,
  FileSpreadsheet,
  LayoutGrid,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Image from 'next/image';
import { ThemeProvider } from '@/components/ThemeProvider';
import { ThemeToggle } from '@/components/ThemeToggle';
import { PaletteToggle } from '@/components/PaletteToggle';
import { OutletSwitcher } from './outlet-switcher';
import { NotificationsBell } from '@/components/notifications-bell';
import { SubscriptionBanner } from '@/components/subscription-banner';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslation } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { canEditDishAvailability, canOpenEmployeesPage, canOpenFloorPlan, isWaiterOnly as sessionIsWaiterOnly } from '@/lib/session-scope';
import { DishAvailabilitySidebar } from '@/components/dish-availability-sidebar';
import { RealtimeProvider } from '@/context/RealtimeContext';
import { TimezoneProvider } from '@/lib/use-timezone';
import Dock, { type DockSectionData } from '@/components/ui/Dock';
import { MobileNav } from '@/components/mobile-nav';
import '@/components/ui/Dock.css';

const inter = Inter({ subsets: ['latin'] });

const normalizeActionName = (value: string) => value.trim().toLowerCase();

const hasKeywordAction = (actionNames: Set<string>, keywords: string[]) => {
  if (keywords.length === 0) {return true;}
  for (const actionName of actionNames) {
    if (keywords.some((keyword) => actionName.includes(keyword.toLowerCase()))) {
      return true;
    }
  }
  return false;
};

function LayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t, setLanguage } = useTranslation();
  const { user, logout } = useAuth();

  const hasRole = (role: 'admin' | 'employee' | 'valet' | 'waiter' | 'cashier' | 'captain' | 'manager') => {
    if (!user) {return false;}
    if (user.role === role) {return true;}
    return Array.isArray(user.role_all) ? user.role_all.includes(role) : false;
  };

  const isValet = hasRole('valet') && !hasRole('admin');
  /*
    THE SERVER DECIDES WHO IS A SCOPED WAITER, AND THIS FILE OBEYS.

    This used to read `hasRole('waiter') && !hasRole('admin')` — one of three
    copies of that rule in this app, and a test on the SPELLING of a role rather
    than on authority. A waiter granted any custom role carries that role's UUID
    in `role_all`, so on any tenant using granular RBAC the rule answered
    differently here than it did on the phone in the same person's pocket.

    `scope.waiter_only` is the backend's single answer (role_scope.ts), shipped
    on the session payload. Nothing below re-derives it.
  */
  const isWaiterOnly = sessionIsWaiterOnly(user);
  const canAccessValet = hasRole('valet') || hasRole('admin');

  const actionNames = useMemo(
    () => new Set((user?.action_names ?? []).map(normalizeActionName).filter((name) => name.length > 0)),
    [user?.action_names],
  );

  /*
    D5 — the floor PLAN is a separate destination from the tables it draws.
    Offered only to a session holding at least one of the three layout
    permissions, because every control on that page rides on one of them and a
    page where nothing works is worse than no page.
  */
  const canEditFloorPlan = canOpenFloorPlan(user);

  const hasAllActions = Array.isArray(user?.actions_set) && user.actions_set.includes('*');
  const canAccessByAction = (keywords: string[]) => {
    if (hasAllActions) {return true;}
    if (actionNames.size === 0) {return true;}
    return hasKeywordAction(actionNames, keywords);
  };

  type NavItem = {
    href: string;
    label: string;
    icon: React.ReactNode;
    exact?: boolean;
    actionKeywords: string[];
  };
  type NavSection = { title: string; items: NavItem[] };

  // The nav, grouped by area of work. Every item keeps its exact href, icon
  // and action-keyword gate from the old flat list; per-section filtering
  // happens below, and a section whose every item is filtered out (role or
  // action permissions) disappears entirely — never an orphan header.
  //
  // Settings is NOT here: it lives in the avatar menu (admin-only), mirroring
  // the backend enforceAdmin gate — see the dropdown below.
  const navSections: NavSection[] = [
    {
      title: 'Operations',
      items: [
        { href: '/dashboard', label: t('dashboard'), icon: <Home className="h-6 w-6" />, exact: true, actionKeywords: [] },
        { href: '/dashboard/orders', label: t('orders'), icon: <ListOrdered className="h-6 w-6" />, actionKeywords: ['order', 'bill', 'payment'] },
        { href: '/dashboard/tables', label: t('tables'), icon: <Package className="h-6 w-6" />, actionKeywords: ['table'] },
        /*
          D5 — FLOOR PLAN IS ITS OWN DESTINATION, BESIDE TABLES AND NOT INSIDE IT.
          Tables is the SERVICE screen (occupy, covers, release, take orders);
          this is the LAYOUT screen (zones, add, move, re-seat, delete). They were
          one card grid, which is precisely what D5 forbids.

          Hidden — not merely disabled — for a session holding none of the three
          layout permissions, and every control on the page is separately gated
          by the permission its own route demands.
        */
        ...(canEditFloorPlan
          ? [{ href: '/dashboard/floor-plan', label: 'Floor plan', icon: <LayoutGrid className="h-6 w-6" />, actionKeywords: [] as string[] }]
          : []),
        { href: '/dashboard/waitlist', label: 'Waitlist', icon: <Hourglass className="h-6 w-6" />, actionKeywords: ['table', 'order', 'waitlist'] },
        { href: '/dashboard/bookings', label: t('bookings'), icon: <ShoppingCart className="h-6 w-6" />, actionKeywords: ['booking'] },
        { href: '/dashboard/menu', label: 'Menu', icon: <BookOpen className="h-6 w-6" />, actionKeywords: ['menu'] },
      ],
    },
    {
      title: 'Inventory',
      items: [
        { href: '/dashboard/inventory', label: t('inventory'), icon: <ClipboardList className="h-6 w-6" />, actionKeywords: ['inventory', 'stock'] },
        { href: '/dashboard/purchase-orders', label: 'Purchase orders', icon: <Truck className="h-6 w-6" />, actionKeywords: ['inventory', 'stock', 'purchase', 'vendor'] },
      ],
    },
    {
      title: 'Guests',
      items: [
        { href: '/dashboard/customers', label: t('customers'), icon: <Users className="h-6 w-6" />, actionKeywords: ['customer'] },
        { href: '/dashboard/feedback', label: 'Feedback', icon: <FileText className="h-6 w-6" />, actionKeywords: ['feedback'] },
        ...(hasRole('admin')
          ? [{ href: '/dashboard/coupons', label: 'Coupons', icon: <Ticket className="h-6 w-6" />, actionKeywords: [] as string[] }]
          : []),
      ],
    },
    {
      title: 'Team',
      items: [
        { href: '/dashboard/attendance', label: 'Attendance', icon: <Clock className="h-6 w-6" />, actionKeywords: [] },
        ...(hasRole('admin')
          ? [{ href: '/dashboard/valet', label: 'Valet Dashboard', icon: <Activity className="h-6 w-6" />, actionKeywords: ['valet', 'parking'] }]
          : []),
      ],
    },
    {
      title: 'Insights',
      items: [
        { href: '/dashboard/analytics', label: t('analytics'), icon: <LineChart className="h-6 w-6" />, actionKeywords: ['analytics', 'apc', 'report'] },
        // Simulation is analytics-derived (same backend action gate), so it sits
        // beside Analytics and opens for exactly the same roles.
        { href: '/dashboard/simulation', label: 'Simulation', icon: <SlidersHorizontal className="h-6 w-6" />, actionKeywords: ['analytics', 'apc', 'report'] },
        { href: '/dashboard/history', label: 'History', icon: <History className="h-6 w-6" />, actionKeywords: ['analytics', 'report'] },
        // The MIS / control report set (Item Wise, Void KOT, Bill Edit, …).
        // Gated on ACCOUNTING, not analytics: every /reports/mis/* route carries
        // the SAME ACCOUNTING_PERM as the rest of /reports/*, so keywording it
        // like its Insights neighbours would show the tab to a user whose every
        // request inside it comes back 403.
        { href: '/dashboard/reports', label: 'Reports', icon: <FileSpreadsheet className="h-6 w-6" />, actionKeywords: ['report', 'accounting', 'finance'] },
      ],
    },
    {
      title: 'Money',
      items: [
        { href: '/dashboard/accounting', label: 'Accounting', icon: <FileText className="h-6 w-6" />, actionKeywords: ['report', 'accounting', 'finance'] },
        { href: '/dashboard/cash', label: 'Cash register', icon: <Wallet className="h-6 w-6" />, actionKeywords: ['report', 'accounting', 'finance', 'cash'] },
        ...(hasRole('admin')
          ? [{ href: '/dashboard/billing', label: 'Billing & plan', icon: <CreditCard className="h-6 w-6" />, actionKeywords: [] as string[] }]
          : []),
      ],
    },
    {
      title: 'Setup',
      items: [
        { href: '/dashboard/outlets', label: 'Outlets', icon: <Globe className="h-6 w-6" />, actionKeywords: ['outlet', 'branch', 'setting', 'profile'] },
      ],
    },
  ]
    .map((section) => ({ ...section, items: section.items.filter((item) => canAccessByAction(item.actionKeywords)) }))
    .filter((section) => section.items.length > 0);

  // The flat list every existing consumer (route allow-list, valet/waiter
  // fallbacks) keeps reading — identical items, now in section order.
  const fullNavItems: NavItem[] = navSections.flatMap((section) => section.items);

  const navItems = useMemo(() => {
    if (isValet) {return [{ href: '/dashboard/valet', label: 'Valet Dashboard', icon: <Activity className="h-6 w-6" />, exact: true }];}
    /*
      A WAITER WORKS FROM TWO SCREENS, NOT ONE.

      This used to pin a waiter to /dashboard/orders alone, which contradicted
      C1 outright: a waiter is supposed to get "Add Order" and "Print Bill", and
      both start from a table. The Tables screen is now the SERVICE screen (D5),
      and every route it calls — /get-tables, /table-status, /occupy-table,
      /release-table, /table-covers — rides on the same "Table Occupied"
      permission the core waiter role already holds, so showing it grants
      nothing the server was not already answering. The floor-plan screen, which
      is where the layout acts moved to, is NOT on this list and its routes
      refuse a waiter anyway.
    */
    if (isWaiterOnly) {
      return [
        { href: '/dashboard/tables', label: t('tables'), icon: <Package className="h-6 w-6" />, exact: true },
        { href: '/dashboard/orders', label: t('orders'), icon: <ListOrdered className="h-6 w-6" />, exact: true },
      ];
    }
    return fullNavItems;
  }, [isValet, isWaiterOnly, fullNavItems, t]);

  useEffect(() => {
    if (!user) {
      return;
    }

    // Settings holds payment keys, taxes and branding — admin-only, so it is NOT
    // in any non-admin allow-list (mirrors the backend enforceAdmin gate).
    const isAdmin = hasRole('admin');
    const valetAllowedPaths = new Set(['/dashboard/valet']);
    // Kept in step with the waiter dock above: the two screens a waiter works
    // from. Deep-linking one of them elsewhere still bounces here, and the
    // floor-plan page is deliberately absent — its routes refuse a waiter, so
    // landing there would be a screen of controls that all fail.
    const waiterAllowedPaths = new Set(['/dashboard/orders', '/dashboard/tables']);
    const roleAwareAllowedPaths = new Set([
      ...navItems.map((item) => item.href),
      ...(isAdmin ? ['/dashboard/settings'] : []),
    ]);

    if (isValet && !valetAllowedPaths.has(pathname)) {
      router.replace('/dashboard/valet');
      return;
    }

    if (isWaiterOnly && !waiterAllowedPaths.has(pathname)) {
      router.replace('/dashboard/orders');
      return;
    }

    if (!canAccessValet && pathname.startsWith('/dashboard/valet')) {
      router.replace('/dashboard');
      return;
    }

    const canAccessCurrentPath = Array.from(roleAwareAllowedPaths).some(
      (allowedPath) => pathname === allowedPath || pathname.startsWith(`${allowedPath}/`),
    );

    if (!canAccessCurrentPath) {
      const firstAllowed = navItems[0]?.href ?? '/dashboard/settings';
      router.replace(firstAllowed);
    }
  }, [user, isValet, isWaiterOnly, canAccessValet, pathname, navItems, router]);

  const toDockItem = (item: { href: string; label: string; icon: React.ReactNode; exact?: boolean }) => ({
    icon: item.icon,
    label: item.label,
    onClick: () => { router.push(item.href); },
    className: (item.exact ? pathname === item.href : pathname.startsWith(item.href)) ? 'active-dock-item' : ''
  });

  // Valet / waiter-only sessions have a single pinned destination, so their
  // dock stays a plain untitled group; everyone else gets the titled sections.
  const dockSections: DockSectionData[] = isValet || isWaiterOnly
    ? [{ items: navItems.map(toDockItem) }]
    : navSections.map((section) => ({ title: section.title, items: section.items.map(toDockItem) }));
  const dockHasTitles = dockSections.some((section) => Boolean(section.title));

  const languages: { code: 'en' | 'hi' | 'kn' | 'te' | 'ta' | 'ml'; name: string }[] = [
    { code: 'en', name: 'English' },
    { code: 'hi', name: 'हिन्दी (Hindi)' },
    { code: 'kn', name: 'ಕನ್ನಡ (Kannada)' },
    { code: 'te', name: 'తెలుగు (Telugu)' },
    { code: 'ta', name: 'தமிழ் (Tamil)' },
    { code: 'ml', name: 'മലയാളം (Malayalam)' },
  ];

  const handleLogout = () => {
    logout();
    router.push('/login');
  }

  /*
    C5 + C6 — THE LINK TO THE ROLES SCREEN IS A PERMISSION, NOT A ROLE NAME.

    This read `hasRole('admin')`, which is the other half of the defect the page
    itself carried: the backend rewrites a primary role it cannot recognise (a
    custom role's uuid, or a record whose primary was never set) to the literal
    string "employee", and a manager the tenant has deliberately granted "View
    Roles" was never an admin to begin with. Both were shown a menu with no way
    into the screen the server would happily have served them.

    `canOpenRoles` asks the resolved action set — the same list GET /roles and
    GET /core-roles are gated on — so the menu entry appears exactly when the
    route would answer.
  */
  const canViewEmployees = canOpenEmployeesPage(user);
  const canViewAuditLogs = hasRole('admin') && canAccessByAction(['audit', 'log']);

  return (
      /* `dashboard-shell` is the hook H3's scrollbar rules hang off (globals.css).
         Scoped to this subtree on purpose: the guest-facing pages are phones,
         where the OS draws an overlay scrollbar and a permanent grey bar down
         the side of somebody's ordering screen would be a regression. */
      <div className={`dashboard-shell ${inter.className} flex min-h-screen w-full flex-col`}>
        <header className="sticky top-0 flex h-14 items-center gap-4 border-b bg-background px-4 lg:h-[60px] lg:px-6 z-40">
        <Link href={isValet ? "/dashboard/valet" : isWaiterOnly ? "/dashboard/orders" : "/dashboard"} className="flex items-center gap-2 font-semibold">
                <Package className="h-6 w-6" />
                <span>CuisineFlow</span>
            </Link>
          <div className="w-full flex-1">
            {/* Add nav items here */}
          </div>
          <OutletSwitcher />
          {/* Clicking one resolves its target server-side, then opens the exact
              record — or explains why it can't be opened from this outlet. */}
          {/* H4 — in the HEADER, so it opens over whatever the person was doing
              and closes back to it. Navigating to the menu page mid-rush loses
              the order somebody was taking, which is the whole reason this is a
              sheet and not a page. */}
          {canEditDishAvailability(user) && user?.restaurantUsername
            ? <DishAvailabilitySidebar rid={user.restaurantUsername} />
            : null}
          <NotificationsBell />
          {/* Two controls, not one: dark/light is "how bright is the room",
              palette is "which product is this". See PaletteToggle's header. */}
          <PaletteToggle />
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <Globe className="h-5 w-5" />
                <span className="sr-only">{t('selectLanguage')}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {languages.map((lang) => (
                <DropdownMenuItem key={lang.code} onSelect={() => { setLanguage(lang.code); }}>
                  {lang.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                className="rounded-full"
              >
                 <Image 
                    src="https://picsum.photos/seed/1/36/36"
                    width={36} 
                    height={36} 
                    alt="Avatar" 
                    className="rounded-full"
                    data-ai-hint="manager portrait"
                />
                <span className="sr-only">{t('toggleUserMenu')}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t('myAccount')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {hasRole('admin') && (
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/settings">
                    <Settings className="mr-2 h-4 w-4" />
                    {t('settings')}
                  </Link>
                </DropdownMenuItem>
              )}
               {(canViewEmployees || canViewAuditLogs) && (
                <>
                  {canViewEmployees && (
                    <DropdownMenuItem asChild>
                      <Link href="/dashboard/employees">
                        <Users className="mr-2 h-4 w-4" />
                        Employee List
                      </Link>
                    </DropdownMenuItem>
                  )}
                  {canViewAuditLogs && (
                    <DropdownMenuItem asChild>
                      <Link href="/dashboard/audit-logs">
                        <FileText className="mr-2 h-4 w-4" />
                        Audit Logs
                      </Link>
                    </DropdownMenuItem>
                  )}
                </>
              )}
              {!isValet && (
                <DropdownMenuItem>
                  <LifeBuoy className="mr-2 h-4 w-4" />
                  {t('support')}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut className="mr-2 h-4 w-4" />
                {t('logout')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        {/* NO `p-` SHORTHAND HERE, and that is not a style preference.
            `p-4 pb-20 lg:p-6` looks like "16px all round, 80px at the bottom,
            24px all round from lg" — and at 1280px it renders 24px at the
            bottom, because `lg:p-6` lives in a media query that comes AFTER the
            base `pb-20` in the generated stylesheet whatever order the classes
            are written in. Measured in the browser: the nav bar is 57px and the
            last card on every page was sitting underneath it.

            Axis utilities have no such collision, so the bottom padding is
            stated once and only ever overridden by another bottom padding:
            80px to clear the mobile bar, 96px from 2xl to clear the dock. */}
        <main className="flex flex-1 flex-col gap-4 px-4 pt-4 pb-20 lg:gap-6 lg:px-6 lg:pt-6 2xl:pb-24">
          <SubscriptionBanner />
          {children}
        </main>
        {/* THE DOCK ONLY APPEARS WHERE IT ACTUALLY FITS, and the threshold is
            MEASURED rather than guessed.

            It is `width: fit-content`, centred with a -50% transform, and an
            admin's 22 icons across 7 titled sections with dividers measure
            1,364px in the browser. So it does not merely break on a phone — it
            overflows a 1,280px LAPTOP by 42px a side, and a 1,024px screen by
            170px a side, which is three destinations hidden off each end. There
            is no scrollbar and no visual cut: the icons are simply not there,
            and nothing tells the person they are missing anything.

            The centred transform is also why the document reports no horizontal
            overflow — the panel hangs off both sides of the viewport rather than
            widening the page — so this was invisible to every check that asks
            "does the page scroll sideways".

            2xl (1536px) is the first Tailwind breakpoint with room for 1,364px
            plus its margins. Below it the mobile bar takes over, and it is a
            COMPLETE navigation with visible labels rather than a degraded one —
            which is why widening the range it covers is an improvement for a
            1,280px laptop too, not a compromise.

            (The other half of the phone problem: every dock label is
            `opacity: 0` until `:hover`, and a touch screen never fires hover.) */}
        <div className="fixed bottom-0 left-0 right-0 z-50 hidden justify-center 2xl:flex">
           <Dock
              sections={dockSections}
              // Titled sections stack a small caption above each icon group,
              // so the panel needs the extra rows' height; the untitled
              // valet/waiter dock keeps its original height.
              panelHeight={dockHasTitles ? 84 : 68}
              baseItemSize={50}
            />
        </div>
        <MobileNav sections={dockSections.map((section) => ({
          title: section.title,
          // The dock's items carry an onClick router.push; the mobile nav wants
          // real <Link>s, so it is fed from the SAME source list rather than a
          // second copy that could drift out of step with the permissions.
          items: (isValet || isWaiterOnly ? navItems : fullNavItems)
            .filter((n) => section.items.some((d) => d.label === n.label))
            .map((n) => ({ href: n.href, label: n.label, icon: n.icon, exact: n.exact })),
        }))} pathname={pathname} />
      </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const restaurantId = user?.restaurantUsername ?? "";

  // TimezoneProvider wraps even the no-restaurant case so that every screen can
  // call useTimezone() unconditionally; with an empty id it simply stays on the
  // default and never fetches.
  if (!restaurantId) {
    return (
      <TimezoneProvider restaurantId="">
        <LayoutContent>{children}</LayoutContent>
      </TimezoneProvider>
    );
  }

  return (
    <RealtimeProvider restaurantId={restaurantId}>
      <TimezoneProvider restaurantId={restaurantId}>
        <LayoutContent>{children}</LayoutContent>
      </TimezoneProvider>
    </RealtimeProvider>
  );
}
