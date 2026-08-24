
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
import { OutletSwitcher } from './outlet-switcher';
import { NotificationsBell } from '@/components/notifications-bell';
import { SubscriptionBanner } from '@/components/subscription-banner';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslation } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { RealtimeProvider } from '@/context/RealtimeContext';
import { TimezoneProvider } from '@/lib/use-timezone';
import Dock from '@/components/ui/Dock';
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
  const isWaiterOnly = hasRole('waiter') && !hasRole('admin');
  const canAccessValet = hasRole('valet') || hasRole('admin');

  const actionNames = useMemo(
    () => new Set((user?.action_names ?? []).map(normalizeActionName).filter((name) => name.length > 0)),
    [user?.action_names],
  );

  const hasAllActions = Array.isArray(user?.actions_set) && user.actions_set.includes('*');
  const canAccessByAction = (keywords: string[]) => {
    if (hasAllActions) {return true;}
    if (actionNames.size === 0) {return true;}
    return hasKeywordAction(actionNames, keywords);
  };

  const fullNavItems = [
    { href: '/dashboard', label: t('dashboard'), icon: <Home className="h-6 w-6" />, exact: true, actionKeywords: [] as string[] },
    { href: '/dashboard/bookings', label: t('bookings'), icon: <ShoppingCart className="h-6 w-6" />, actionKeywords: ['booking'] },
    { href: '/dashboard/orders', label: t('orders'), icon: <ListOrdered className="h-6 w-6" />, actionKeywords: ['order', 'bill', 'payment'] },
    { href: '/dashboard/menu', label: 'Menu', icon: <BookOpen className="h-6 w-6" />, actionKeywords: ['menu'] },
    { href: '/dashboard/tables', label: t('tables'), icon: <Package className="h-6 w-6" />, actionKeywords: ['table'] },
    { href: '/dashboard/waitlist', label: 'Waitlist', icon: <Hourglass className="h-6 w-6" />, actionKeywords: ['table', 'order', 'waitlist'] },
    { href: '/dashboard/inventory', label: t('inventory'), icon: <ClipboardList className="h-6 w-6" />, actionKeywords: ['inventory', 'stock'] },
    { href: '/dashboard/purchase-orders', label: 'Purchase orders', icon: <Truck className="h-6 w-6" />, actionKeywords: ['inventory', 'stock', 'purchase', 'vendor'] },
    { href: '/dashboard/customers', label: t('customers'), icon: <Users className="h-6 w-6" />, actionKeywords: ['customer'] },
    { href: '/dashboard/attendance', label: 'Attendance', icon: <Clock className="h-6 w-6" />, actionKeywords: [] as string[] },
    { href: '/dashboard/feedback', label: 'Feedback', icon: <FileText className="h-6 w-6" />, actionKeywords: ['feedback'] },
    { href: '/dashboard/analytics', label: t('analytics'), icon: <LineChart className="h-6 w-6" />, actionKeywords: ['analytics', 'apc', 'report'] },
    // Simulation is analytics-derived (same backend action gate), so it sits
    // beside Analytics and opens for exactly the same roles.
    { href: '/dashboard/simulation', label: 'Simulation', icon: <SlidersHorizontal className="h-6 w-6" />, actionKeywords: ['analytics', 'apc', 'report'] },
    { href: '/dashboard/history', label: 'History', icon: <History className="h-6 w-6" />, actionKeywords: ['analytics', 'report'] },
    { href: '/dashboard/accounting', label: 'Accounting', icon: <FileText className="h-6 w-6" />, actionKeywords: ['report', 'accounting', 'finance'] },
    { href: '/dashboard/cash', label: 'Cash register', icon: <Wallet className="h-6 w-6" />, actionKeywords: ['report', 'accounting', 'finance', 'cash'] },
    { href: '/dashboard/outlets', label: 'Outlets', icon: <Globe className="h-6 w-6" />, actionKeywords: ['outlet', 'branch', 'setting', 'profile'] },
    ...(hasRole('admin')
      ? [{ href: '/dashboard/valet', label: 'Valet Dashboard', icon: <Activity className="h-6 w-6" />, actionKeywords: ['valet', 'parking'] }]
      : []),
    ...(hasRole('admin')
      ? [{ href: '/dashboard/coupons', label: 'Coupons', icon: <Ticket className="h-6 w-6" />, actionKeywords: [] as string[] }]
      : []),
    ...(hasRole('admin')
      ? [{ href: '/dashboard/billing', label: 'Billing & plan', icon: <CreditCard className="h-6 w-6" />, actionKeywords: [] as string[] }]
      : []),
  ].filter((item) => canAccessByAction(item.actionKeywords));

  const navItems = useMemo(() => {
    if (isValet) {return [{ href: '/dashboard/valet', label: 'Valet Dashboard', icon: <Activity className="h-6 w-6" />, exact: true }];}
    if (isWaiterOnly) {return [{ href: '/dashboard/orders', label: t('orders'), icon: <ListOrdered className="h-6 w-6" />, exact: true }];}
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
    const waiterAllowedPaths = new Set(['/dashboard/orders']);
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

  const dockItems = navItems.map(item => ({
    icon: item.icon,
    label: item.label,
    onClick: () => { router.push(item.href); },
    className: (item.exact ? pathname === item.href : pathname.startsWith(item.href)) ? 'active-dock-item' : ''
  }));

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

  const canViewEmployees = hasRole('admin') && canAccessByAction(['employee', 'role']);
  const canViewAuditLogs = hasRole('admin') && canAccessByAction(['audit', 'log']);

  return (
      <div className={`${inter.className} flex min-h-screen w-full flex-col`}>
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
          <NotificationsBell />
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
        <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6 pb-24">
          <SubscriptionBanner />
          {children}
        </main>
        <div className="fixed bottom-0 left-0 right-0 flex justify-center z-50">
           <Dock 
              items={dockItems}
              panelHeight={68}
              baseItemSize={50}
            />
        </div>
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
