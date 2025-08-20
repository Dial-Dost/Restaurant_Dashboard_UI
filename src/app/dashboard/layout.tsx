
"use client";

import { Inter } from 'next/font/google';

import {
  Home,
  LineChart,
  Package,
  Package2,
  ShoppingCart,
  Users,
  Globe
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarFooter,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { usePathname } from 'next/navigation';
import { useTranslation } from '@/context/LanguageContext';


const inter = Inter({ subsets: ['latin'] });

function DashboardNav() {
  const pathname = usePathname();
  const { t } = useTranslation();
  
  const navItems = [
    { href: '/dashboard', label: t('dashboard'), icon: Home, exact: true },
    { href: '/dashboard/bookings', label: t('bookings'), icon: ShoppingCart, badge: '6' },
    { href: '/dashboard/tables', label: t('tables'), icon: Package },
    { href: '/dashboard/customers', label: t('customers'), icon: Users },
    { href: '/dashboard/analytics', label: t('analytics'), icon: LineChart },
  ];

  return (
    <SidebarContent>
      <SidebarMenu>
        {navItems.map((item) => (
          <SidebarMenuItem key={item.label}>
            <SidebarMenuButton 
              href={item.href} 
              asChild
              isActive={item.exact ? pathname === item.href : pathname.startsWith(item.href)}
              tooltip={item.label}
            >
              <Link href={item.href}>
                <item.icon className="h-5 w-5" />
                <span className="group-data-[[data-collapsible=icon][data-state=collapsed]]:hidden">{item.label}</span>
                {item.badge && (
                  <Badge className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full group-data-[[data-collapsible=icon][data-state=collapsed]]:hidden">
                    {item.badge}
                  </Badge>
                )}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarContent>
  );
}


export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t, setLanguage } = useTranslation();

  const languages = [
    { code: 'en', name: 'English' },
    { code: 'hi', name: 'हिन्दी (Hindi)' },
    { code: 'kn', name: 'ಕನ್ನಡ (Kannada)' },
    { code: 'te', name: 'తెలుగు (Telugu)' },
    { code: 'ta', name: 'தமிழ் (Tamil)' },
    { code: 'ml', name: 'മലയാളം (Malayalam)' },
  ];

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <SidebarProvider>
        <div className={`${inter.className} flex min-h-screen w-full`}>
          <Sidebar collapsible="icon">
            <SidebarHeader>
                <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
                    <Package2 className="h-6 w-6" />
                    <span className="group-data-[[data-collapsible=icon][data-state=collapsed]]:hidden">CuisineFlow</span>
                </Link>
            </SidebarHeader>
            <DashboardNav />
            <SidebarFooter>
              <Card>
                <CardHeader className="p-2 pt-0 md:p-4 group-data-[[data-collapsible=icon][data-state=collapsed]]:hidden">
                  <CardTitle>{t('upgradeToPro')}</CardTitle>
                  <CardDescription>
                    {t('upgradeToProDesc')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-2 pt-0 md:p-4 md:pt-0 group-data-[[data-collapsible=icon][data-state=collapsed]]:hidden">
                  <Button size="sm" className="w-full">
                    {t('upgrade')}
                  </Button>
                </CardContent>
              </Card>
            </SidebarFooter>
          </Sidebar>
          <div className="flex flex-col w-full">
            <header className="flex h-14 items-center gap-4 border-b bg-muted/40 px-4 lg:h-[60px] lg:px-6">
              <SidebarTrigger className="md:hidden"/>
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
                        src="https://placehold.co/36x36" 
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
                  <DropdownMenuItem asChild>
                    <Link href="/dashboard/settings">{t('settings')}</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem>{t('support')}</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/">{t('logout')}</Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </header>
            <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
              {children}
            </main>
          </div>
        </div>
      </SidebarProvider>
    </ThemeProvider>
  );
}
