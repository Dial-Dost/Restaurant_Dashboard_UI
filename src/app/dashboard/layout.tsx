
"use client";

import { useEffect } from 'react';
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
import { usePathname, useRouter } from 'next/navigation';
import { useTranslation } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { RealtimeProvider } from '@/context/RealtimeContext';
import Dock from '@/components/ui/Dock';
import '@/components/ui/Dock.css';

const inter = Inter({ subsets: ['latin'] });

function LayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t, setLanguage } = useTranslation();
  const { user, logout } = useAuth();

  const isValet = user?.role === 'valet';
  const canAccessValet = user?.role === 'valet' || user?.role === 'admin';

  useEffect(() => {
    if (!user) {
      return;
    }

    if (isValet && pathname !== '/dashboard/valet') {
      router.replace('/dashboard/valet');
      return;
    }

    if (!canAccessValet && pathname.startsWith('/dashboard/valet')) {
      router.replace('/dashboard');
    }
  }, [user, isValet, canAccessValet, pathname, router]);

  const navItems = isValet
    ? [
        { href: '/dashboard/valet', label: 'Valet Dashboard', icon: <Activity className="h-6 w-6" />, exact: true },
      ]
    : [
        { href: '/dashboard', label: t('dashboard'), icon: <Home className="h-6 w-6" />, exact: true },
        { href: '/dashboard/bookings', label: t('bookings'), icon: <ShoppingCart className="h-6 w-6" /> },
        { href: '/dashboard/orders', label: t('orders'), icon: <ListOrdered className="h-6 w-6" /> },
        { href: '/dashboard/menu', label: 'Menu', icon: <BookOpen className="h-6 w-6" /> },
        { href: '/dashboard/tables', label: t('tables'), icon: <Package className="h-6 w-6" /> },
        { href: '/dashboard/inventory', label: t('inventory'), icon: <ClipboardList className="h-6 w-6" /> },
        { href: '/dashboard/customers', label: t('customers'), icon: <Users className="h-6 w-6" /> },
        { href: '/dashboard/feedback', label: 'Feedback', icon: <FileText className="h-6 w-6" /> },
        { href: '/dashboard/analytics', label: t('analytics'), icon: <LineChart className="h-6 w-6" /> },
        ...(user?.role === 'admin'
          ? [{ href: '/dashboard/valet', label: 'Valet Dashboard', icon: <Activity className="h-6 w-6" /> }]
          : []),
      ];

  const dockItems = navItems.map(item => ({
    icon: item.icon,
    label: item.label,
    onClick: () => router.push(item.href),
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

  return (
      <div className={`${inter.className} flex min-h-screen w-full flex-col`}>
        <header className="sticky top-0 flex h-14 items-center gap-4 border-b bg-background px-4 lg:h-[60px] lg:px-6 z-40">
            <Link href={isValet ? "/dashboard/valet" : "/dashboard"} className="flex items-center gap-2 font-semibold">
                <Package className="h-6 w-6" />
                <span>CuisineFlow</span>
            </Link>
          <div className="w-full flex-1">
            {/* Add nav items here */}
          </div>
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
                <DropdownMenuItem key={lang.code} onSelect={() => setLanguage(lang.code)}>
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
              {!isValet && (
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/settings">
                    <Settings className="mr-2 h-4 w-4" />
                    {t('settings')}
                  </Link>
                </DropdownMenuItem>
              )}
               {user?.role === 'admin' && (
                <>
                  <DropdownMenuItem asChild>
                    <Link href="/dashboard/employees">
                      <Users className="mr-2 h-4 w-4" />
                      Employee List
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/dashboard/audit-logs">
                      <FileText className="mr-2 h-4 w-4" />
                      Audit Logs
                    </Link>
                  </DropdownMenuItem>
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
  const restaurantId = user?.restaurantId ?? "";

  if (!restaurantId) {
    return <LayoutContent>{children}</LayoutContent>;
  }

  return (
    <RealtimeProvider restaurantId={restaurantId}>
      <LayoutContent>{children}</LayoutContent>
    </RealtimeProvider>
  );
}
