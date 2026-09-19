"use client";

// THE DASHBOARD SHELL — the web copy of the Flutter owner app's HomeShell
// (restaurant_owner_app/lib/screens/home_shell.dart, the source of truth).
//
// Chassis: a fixed left sidebar (224px, collapsible to a 68px icon rail,
// persisted) over the shared gradient backdrop; below 700px the same nav list
// becomes a drawer behind a hamburger. The top bar carries the back trail, the
// module title, and — left to right — the outbox chip, outlet switcher, bell,
// theme toggle, Refresh and a visible "Sign out"; below 760px everything but
// the chip and the bell folds into one overflow menu.
//
// The module registry (labels, grouping, order, every permission/plan/role
// gate) lives in src/lib/nav-registry.ts and is resolved once by useVisibleNav
// — the sidebar, the route guard and the notifications bell all read that one
// source.

import * as React from "react";
import { Inter } from "next/font/google";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  ArrowLeft,
  Check,
  EllipsisVertical,
  Layers,
  LogOut,
  Menu,
  Moon,
  RefreshCw,
  Sparkles,
  Store,
  Sun,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { GradientBackdrop } from "@/components/ui/gradient-backdrop";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationsBell } from "@/components/notifications-bell";
import { SubscriptionBanner } from "@/components/subscription-banner";
import { DishAvailabilitySidebar } from "@/components/dish-availability-sidebar";
import { OutboxChip } from "@/components/outbox-chip";
import { ReprintNeededListener } from "@/components/reprint-needed";
import {
  DRAWER_GRADIENT,
  RAIL_GRADIENT,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_WIDTH,
  SidebarNav,
  readSidebarCollapsed,
  writeSidebarCollapsed,
} from "@/components/app-sidebar";
import { OutletSwitcher, outletDisplayName, useOutletScope } from "./outlet-switcher";
import { useAuth } from "@/context/AuthContext";
import { RealtimeProvider } from "@/context/RealtimeContext";
import { TimezoneProvider } from "@/lib/use-timezone";
import { useVisibleNav } from "@/hooks/use-nav";
import { canEditDishAvailability } from "@/lib/session-scope";
import { moduleByLabel, moduleForPath } from "@/lib/nav-registry";
import { ALL_OUTLETS, OUTLET_CHANGED_EVENT } from "@/lib/outlet";
import { setOutboxScope } from "@/lib/outbox";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  LIGHT_TONES,
  activeAppearance,
  applyAppearancePick,
  applyLightTone,
  DEFAULT_LIGHT_TONE,
  LIGHT_TONE_STORAGE_KEY,
  lightToneFromStorage,
  type AppearancePick,
  type LightToneId,
} from "@/lib/light-tone";

const inter = Inter({ subsets: ["latin"] });

// A workspace trail, not a browser history: far more hops than anyone walks
// back through, and it stops a long shift growing the list without bound.
const HISTORY_LIMIT = 20;

/** True when the caret sits in a text field — Escape there means "I am typing". */
const editingText = (): boolean => {
  const el = document.activeElement;
  if (!el) { return false; }
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
    (el as HTMLElement).isContentEditable;
};

/** An open dialog / menu / sheet claims Escape before the shell may. */
const overlayOpen = (): boolean =>
  document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"]',
  ) != null;

function LayoutContent({ children }: { children: React.ReactNode }): React.JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const nav = useVisibleNav();
  const outletScope = useOutletScope();
  const { theme, setTheme } = useTheme();

  // ------------------------------------------------------------- chrome state
  const [collapsed, setCollapsed] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [refreshTick, setRefreshTick] = React.useState(0);
  // Restore the persisted collapse preference after mount (hydration-safe —
  // the Flutter shell restores it async from SharedPreferences the same way).
  React.useEffect(() => { setCollapsed(readSidebarCollapsed()); }, []);
  const toggleCollapsed = (): void => {
    setCollapsed((prev) => {
      writeSidebarCollapsed(!prev);
      return !prev;
    });
  };

  // The theme rows for the narrow overflow fold — same entries as ThemeToggle.
  const [tone, setTone] = React.useState<LightToneId>(DEFAULT_LIGHT_TONE);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setTone(lightToneFromStorage(typeof window === "undefined" ? null : window.localStorage));
    setMounted(true);
  }, []);
  const activeTheme = mounted ? activeAppearance(theme, tone) : null;
  const chooseTheme = (pick: AppearancePick): void => {
    const next = applyAppearancePick(pick);
    if (next.tone) {
      setTone(next.tone);
      applyLightTone(next.tone, document.documentElement);
      try { window.localStorage.setItem(LIGHT_TONE_STORAGE_KEY, next.tone); } catch { /* private mode */ }
    }
    setTheme(next.theme);
  };

  // ------------------------------------------------------------ refresh paths
  // The shell Refresh: remounts the current page content so it refetches, and
  // asks Next for fresh server data — the web's `_refreshTick`.
  const refresh = React.useCallback(() => {
    setRefreshTick((t) => t + 1);
    router.refresh();
  }, [router]);

  // An in-place outlet switch (the switcher, the bell's "Switch outlet", any
  // module affordance) refreshes the current module the same way — the user
  // stays exactly where they were, no flash, no reload.
  React.useEffect(() => {
    const handler = (): void => { refresh(); };
    window.addEventListener(OUTLET_CHANGED_EVENT, handler);
    return () => { window.removeEventListener(OUTLET_CHANGED_EVENT, handler); };
  }, [refresh]);

  // The offline outbox is scoped restaurant|outlet, exactly like the read
  // cache — switching branches switches queues.
  React.useEffect(() => {
    const rid = user?.restaurantUsername ?? null;
    setOutboxScope(rid, outletScope.activeId || user?.outlet_id || "");
  }, [user?.restaurantUsername, user?.outlet_id, outletScope.activeId]);

  // ---------------------------------------------------------------- back trail
  // Labels, not paths: the visible module list is permission- and plan-
  // dependent, so an entry hidden mid-session must read as "no history".
  const trailRef = React.useRef<string[]>([]);
  const currentLabelRef = React.useRef<string>("");
  const pendingBackRef = React.useRef<string | null>(null);
  const [backTarget, setBackTarget] = React.useState<string | null>(null);

  const computeBackTarget = React.useCallback((): string | null => {
    for (let i = trailRef.current.length - 1; i >= 0; i--) {
      const label = trailRef.current[i];
      if (nav.labels.includes(label)) { return label; }
    }
    return null;
  }, [nav.labels]);

  React.useEffect(() => {
    const label = moduleForPath(pathname)?.label ?? "";
    const prev = currentLabelRef.current;
    if (label && prev && label !== prev) {
      if (pendingBackRef.current === label) {
        // This navigation IS the back step — never re-record it.
        pendingBackRef.current = null;
      } else {
        // Record the module being LEFT, never the same label twice in a row.
        const trail = trailRef.current;
        if (trail.length === 0 || trail[trail.length - 1] !== prev) {
          trail.push(prev);
          if (trail.length > HISTORY_LIMIT) { trail.shift(); }
        }
      }
    }
    if (label) { currentLabelRef.current = label; }
    setBackTarget(computeBackTarget());
  }, [pathname, computeBackTarget]);

  const goBack = React.useCallback(() => {
    const trail = trailRef.current;
    while (trail.length > 0) {
      const label = trail.pop();
      if (!label || !nav.labels.includes(label)) { continue; } // module retired mid-session
      const mod = moduleByLabel(label);
      if (!mod) { continue; }
      pendingBackRef.current = label;
      router.push(mod.href);
      setBackTarget(computeBackTarget());
      return;
    }
    setBackTarget(null);
  }, [nav.labels, router, computeBackTarget]);

  // Escape walks the back trail — but only an Escape nothing closer to the
  // focus claimed: not while a dialog / menu / the drawer is open (they close
  // themselves first), and never while typing in a text field.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) { return; }
      if (overlayOpen()) { return; } // the drawer and every dialog close themselves
      if (editingText()) { return; }
      if (backTarget != null) {
        event.preventDefault();
        goBack();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, [backTarget, goBack]);

  // ---------------------------------------------------------------- route guard
  // Landing is applied ONCE — a starting position, not a rule (Flutter's
  // `_landed`): after it, the URL belongs to whatever the user did last.
  const landedRef = React.useRef(false);
  React.useEffect(() => {
    if (!user || nav.modules.length === 0) { return; }

    if (!landedRef.current) {
      landedRef.current = true;
      if (pathname === "/dashboard" && nav.landing && nav.landing.href !== "/dashboard") {
        router.replace(nav.landing.href);
        return;
      }
    }

    // Routable but deliberately out of nav: Coupons keeps its page (admin).
    const extraAllowed = nav.isAdmin ? ["/dashboard/coupons"] : [];
    const allowed = [...nav.modules.map((m) => m.href), ...extraAllowed];
    const canAccess = pathname === "/dashboard"
      ? nav.modules.some((m) => m.href === "/dashboard")
      : allowed.some((href) => href !== "/dashboard" && (pathname === href || pathname.startsWith(`${href}/`)));

    if (!canAccess) {
      router.replace(nav.landing?.href ?? "/dashboard");
    }
  }, [user, nav.modules, nav.landing, nav.isAdmin, pathname, router]);

  // ------------------------------------------------------------------ render
  const currentModule = moduleForPath(pathname);
  const title = currentModule?.label ?? "";
  const restaurantName = user?.restaurantName.trim() || "CuisineFlow";

  const handleLogout = (): void => {
    logout();
    router.push("/login");
  };

  // The shell's "no modules" state — never a redirect loop onto a 403 page.
  if (user && nav.modules.length === 0) {
    return (
      <div className={`dashboard-shell ${inter.className} relative flex min-h-screen w-full items-center justify-center`}>
        <GradientBackdrop />
        <div className="relative flex flex-col items-center gap-4 text-center">
          <p className="text-sm text-muted-foreground">No modules available for your role.</p>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            <LogOut className="mr-1.5 h-3.5 w-3.5" /> Sign out
          </Button>
        </div>
      </div>
    );
  }

  const overflowTint = outletScope.canSwitch && outletScope.isAll;

  return (
    <div className={`dashboard-shell ${inter.className} relative min-h-screen w-full`}>
      {/* 6 — the shared warm backdrop behind the whole shell; the rail carries
          its own translucent glow gradient on top of it. */}
      <GradientBackdrop className="fixed" />

      <div className="relative flex min-h-screen w-full">
        {/* The fixed sidebar — a drawer below 700px. */}
        <aside
          className="sticky top-0 hidden h-screen shrink-0 overflow-hidden border-r border-divider transition-[width] duration-base ease-in-out min-[700px]:block"
          style={{ width: collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH, background: RAIL_GRADIENT }}
        >
          <SidebarNav
            sections={nav.sections}
            pathname={pathname}
            restaurantName={restaurantName}
            collapsed={collapsed}
            onToggleCollapsed={toggleCollapsed}
          />
        </aside>

        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent side="left" className="w-[280px] border-divider p-0" style={{ background: DRAWER_GRADIENT }}>
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SidebarNav
              sections={nav.sections}
              pathname={pathname}
              restaurantName={restaurantName}
              inDrawer
              onNavigate={() => { setDrawerOpen(false); }}
            />
          </SheetContent>
        </Sheet>

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          {/* The top bar. `dashboard-header` keeps --dash-header-h honest for
              anything that sticks below it. */}
          <header className="dashboard-header sticky top-0 z-40 flex h-14 items-center gap-1 border-b border-divider bg-background/80 px-2 backdrop-blur sm:px-3 lg:h-[60px] lg:px-4">
            {/* Drawer button — narrow windows only, the AppBar's leading slot. */}
            <Button
              variant="ghost"
              size="icon"
              className="min-[700px]:hidden"
              onClick={() => { setDrawerOpen(true); }}
            >
              <Menu className="h-5 w-5" />
              <span className="sr-only">Open navigation</span>
            </Button>

            {/* Back walks the module trail; greyed out rather than removed — a
                control that appears and disappears is harder to aim at. */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              disabled={backTarget == null}
              title={backTarget == null ? "No previous tab" : `Back to ${backTarget}`}
              onClick={goBack}
            >
              <ArrowLeft className={`h-[18px] w-[18px] ${backTarget == null ? "text-tertiary/45" : "text-muted-foreground"}`} />
              <span className="sr-only">{backTarget == null ? "No previous tab" : `Back to ${backTarget}`}</span>
            </Button>

            <Sparkles aria-hidden className="ml-0.5 h-3.5 w-3.5 shrink-0 text-accent-foreground" />
            <h1 className="ml-1.5 min-w-0 flex-1 truncate text-[17px] font-semibold tracking-[-0.2px] text-foreground">
              {title}
            </h1>

            {/* The outbox chip sits ahead of everything and is NEVER folded
                away; it renders nothing while the queue is empty. */}
            <OutboxChip />

            {/* Web-extra, kept deliberately: the "86 a dish" sheet opens over
                whatever the person was doing (H4). */}
            {canEditDishAvailability(user) && user?.restaurantUsername
              ? <DishAvailabilitySidebar rid={user.restaurantUsername} />
              : null}

            <div className="hidden min-[760px]:block">
              <OutletSwitcher scope={outletScope} />
            </div>

            <NotificationsBell />

            {/* Wide chrome: theme, Refresh, a visible "Sign out". */}
            <div className="hidden items-center gap-1 min-[760px]:flex">
              <ThemeToggle />
              <Button variant="ghost" size="icon" title="Refresh" onClick={refresh}>
                <RefreshCw className="h-4 w-4" />
                <span className="sr-only">Refresh</span>
              </Button>
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={handleLogout}>
                <LogOut className="mr-1.5 h-4 w-4" /> Sign out
              </Button>
            </div>

            {/* Narrow chrome: outlet, theme, Refresh and Sign out fold into ONE
                menu — nothing dropped, nothing duplicated, and the combined-view
                signal survives the fold (copper trigger + tooltip). */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`min-[760px]:hidden ${overflowTint ? "text-accent-foreground" : ""}`}
                  title={overflowTint ? "Viewing all outlets (combined)" : "More"}
                >
                  <EllipsisVertical className="h-5 w-5" />
                  <span className="sr-only">More</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {outletScope.canSwitch && (
                  <>
                    <DropdownMenuLabel className="text-xs text-muted-foreground">OUTLET</DropdownMenuLabel>
                    <DropdownMenuItem onSelect={() => { outletScope.select(ALL_OUTLETS); }} className="gap-2">
                      <span className="w-4 shrink-0">{outletScope.isAll && <Check className="h-4 w-4" />}</span>
                      <Layers className="h-4 w-4 text-muted-foreground" /> All outlets (combined)
                    </DropdownMenuItem>
                    {outletScope.outlets.map((o) => (
                      <DropdownMenuItem key={o.id} onSelect={() => { outletScope.select(o.id); }} className="gap-2">
                        <span className="w-4 shrink-0">{o.id === outletScope.activeId && <Check className="h-4 w-4" />}</span>
                        <Store className="h-4 w-4 text-muted-foreground" /> {outletDisplayName(o)}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                  </>
                )}
                {/* The theme entries — same rows as the wide bar's ThemeToggle. */}
                <DropdownMenuItem onSelect={() => { chooseTheme("dark"); }} className="gap-2.5">
                  <Moon className="h-4 w-4" />
                  <span className="flex-1">Dark</span>
                  {activeTheme === "dark" && <Check className="h-3.5 w-3.5" />}
                </DropdownMenuItem>
                <DropdownMenuLabel className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Sun aria-hidden className="h-3.5 w-3.5" /> LIGHT
                </DropdownMenuLabel>
                {LIGHT_TONES.map((t) => (
                  <DropdownMenuItem key={t.id} onSelect={() => { chooseTheme(t.id); }} className="gap-2.5">
                    <span
                      aria-hidden
                      className="h-4 w-4 shrink-0 rounded-full border"
                      style={{ backgroundColor: t.swatch.bg, borderColor: t.swatch.border }}
                    />
                    <span className="flex-1">{t.label}</span>
                    {activeTheme === t.id && <Check className="h-3.5 w-3.5" />}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={refresh} className="gap-2.5">
                  <RefreshCw className="h-4 w-4 text-muted-foreground" /> Refresh
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handleLogout} className="gap-2.5">
                  <LogOut className="h-4 w-4 text-muted-foreground" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>

          <main className="flex flex-1 flex-col gap-4 px-4 pb-8 pt-4 lg:gap-6 lg:px-6 lg:pt-6">
            <SubscriptionBanner />
            {/* Keyed on the refresh tick, so Refresh / an outlet switch remounts
                the module and it refetches — the web's KeyedSubtree. */}
            <div key={refreshTick} className="flex flex-1 flex-col gap-4 lg:gap-6">
              {children}
            </div>
          </main>
        </div>
      </div>

      {/* Shell-level "Print the updated bill?" listener (client item 6). */}
      <ReprintNeededListener />
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const { user } = useAuth();
  const restaurantId = user?.restaurantUsername ?? "";

  // TimezoneProvider wraps even the no-restaurant case so that every screen can
  // call useTimezone() unconditionally; with an empty id it simply stays on the
  // default and never fetches.
  if (!restaurantId) {
    return (
      <TimezoneProvider restaurantId="">
        <TooltipProvider delayDuration={300}>
          <LayoutContent>{children}</LayoutContent>
        </TooltipProvider>
      </TimezoneProvider>
    );
  }

  return (
    <RealtimeProvider restaurantId={restaurantId}>
      <TimezoneProvider restaurantId={restaurantId}>
        <TooltipProvider delayDuration={300}>
          <LayoutContent>{children}</LayoutContent>
        </TooltipProvider>
      </TimezoneProvider>
    </RealtimeProvider>
  );
}
