"use client";

// The dashboard's left navigation — the web copy of home_shell.dart's nav rail:
// brand lockup on top (copper gradient monogram + restaurant name + "OWNER
// WORKSPACE"), grouped sections under 10px uppercase tracked headers, a copper
// tick + icon + 13px label per entry with a quiet hover wash, collapsible to a
// 68px icon-only rail (tooltips, thin dividers replacing the headers), and the
// same list reused verbatim by the narrow-window drawer.

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, UtensilsCrossed } from "lucide-react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { NavModule, NavSection } from "@/lib/nav-registry";
import { cn } from "@/lib/utils";

export const SIDEBAR_WIDTH = 224;
export const SIDEBAR_COLLAPSED_WIDTH = 68;

/** Persisted collapse preference — SharedPreferences' `sidebar_collapsed`. */
export const SIDEBAR_COLLAPSED_KEY = "sidebar_collapsed";

export const readSidebarCollapsed = (): boolean => {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
};

export const writeSidebarCollapsed = (collapsed: boolean): void => {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch { /* private mode — the choice just does not survive a reload */ }
};

const isActive = (pathname: string, mod: NavModule): boolean =>
  mod.exact ? pathname === mod.href : pathname === mod.href || pathname.startsWith(`${mod.href}/`);

// Copper monogram + restaurant wordmark — the brand lockup at the top of the
// sidebar (mirrors the "⊙ RUSTIC FORK" reference pattern).
function BrandMark({ restaurantName, inDrawer, onCollapse }: {
  restaurantName: string;
  inDrawer: boolean;
  onCollapse?: () => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center">
      <div
        aria-hidden
        className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent-hi to-accent-deep shadow-[0_3px_12px_hsl(var(--accent-shadow)/0.6)]"
      >
        <UtensilsCrossed className="h-4 w-4 text-accent-on" />
      </div>
      <div className="ml-2.5 min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold tracking-[0.3px] text-foreground">
          {restaurantName}
        </p>
        <p className="mt-0.5 text-[9px] font-semibold tracking-[1.2px] text-muted-foreground/80">
          OWNER WORKSPACE
        </p>
      </div>
      {/* Collapse control lives on the fixed sidebar only — the drawer is
          dismissed by tapping away, so it needs no collapse button. */}
      {!inDrawer && onCollapse != null && (
        <button
          type="button"
          onClick={onCollapse}
          title="Collapse sidebar"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-tertiary transition-colors duration-fast hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="sr-only">Collapse sidebar</span>
        </button>
      )}
    </div>
  );
}

function NavItem({ mod, active, collapsed, onNavigate }: {
  mod: NavModule;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}): React.JSX.Element {
  const Icon = mod.icon;
  const item = (
    <Link
      href={mod.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group mb-0.5 flex items-center rounded-[9px] py-[9px] transition-colors duration-fast",
        collapsed ? "justify-center px-0" : "px-3",
        active ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.03]",
      )}
    >
      {/* Copper tick marks the active module. */}
      {!collapsed && (
        <span
          aria-hidden
          className={cn(
            "mr-[9px] w-[2.5px] shrink-0 rounded-sm bg-accent-hi transition-all duration-fast",
            active ? "h-3.5" : "h-0",
          )}
        />
      )}
      <Icon
        className={cn(
          "h-[17px] w-[17px] shrink-0",
          active
            ? "text-accent-foreground"
            : "text-muted-foreground group-hover:text-foreground/85",
        )}
      />
      {!collapsed && (
        <span
          className={cn(
            "ml-2.5 min-w-0 flex-1 truncate text-[13px] tracking-[0.1px]",
            active
              ? "font-semibold text-foreground"
              : "font-medium text-muted-foreground group-hover:text-foreground/85",
          )}
        >
          {mod.label}
        </span>
      )}
    </Link>
  );

  if (!collapsed) { return item; }
  return (
    <Tooltip>
      <TooltipTrigger asChild>{item}</TooltipTrigger>
      <TooltipContent side="right">{mod.label}</TooltipContent>
    </Tooltip>
  );
}

export interface SidebarNavProps {
  sections: NavSection[];
  pathname: string;
  restaurantName: string;
  /** Icon-only rail. Never true inside the drawer. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** The drawer variant — headers always shown, no collapse control. */
  inDrawer?: boolean;
  /** Called on every navigation (the drawer closes itself with it). */
  onNavigate?: () => void;
}

/**
 * The nav list, reused by the wide sidebar (optionally collapsed to an
 * icon-only rail) and the narrow drawer. A section whose every module is
 * gated away contributes NOTHING — the caller already filtered them.
 */
export function SidebarNav({
  sections,
  pathname,
  restaurantName,
  collapsed = false,
  onToggleCollapsed,
  inDrawer = false,
  onNavigate,
}: SidebarNavProps): React.JSX.Element {
  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex h-full min-h-0 flex-col">
        <div className={cn("pt-[18px] pb-3.5", collapsed ? "px-2" : "pl-[18px] pr-2")}>
          {collapsed ? (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={onToggleCollapsed}
                title="Expand sidebar"
                className="flex h-9 w-9 items-center justify-center rounded-md text-tertiary transition-colors duration-fast hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronRight className="h-4 w-4" />
                <span className="sr-only">Expand sidebar</span>
              </button>
            </div>
          ) : (
            <BrandMark restaurantName={restaurantName} inDrawer={inDrawer} onCollapse={onToggleCollapsed} />
          )}
        </div>
        <nav aria-label="Modules" className={cn("min-h-0 flex-1 overflow-y-auto pb-4", collapsed ? "px-2" : "px-3")}>
          {sections.map((section, si) => (
            <React.Fragment key={section.title}>
              {collapsed ? (
                // Icon-only rail: no room for words — a hairline marks the
                // boundary. The first group opens the list, no separator.
                si > 0 && <div aria-hidden className="mx-2.5 my-[7px] h-px bg-divider" />
              ) : (
                // The same overline voice as the module headers everywhere:
                // 10px, w600, wide tracking, tertiary ink.
                <p className={cn("px-2 pb-1.5 text-[10px] font-semibold tracking-[0.11em] text-tertiary", si > 0 ? "pt-4" : "pt-0")}>
                  {section.title}
                </p>
              )}
              {section.modules.map((mod) => (
                <NavItem
                  key={mod.href}
                  mod={mod}
                  active={isActive(pathname, mod)}
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                />
              ))}
            </React.Fragment>
          ))}
        </nav>
      </div>
    </TooltipProvider>
  );
}

/**
 * The fixed rail's own gradient: a translucent scrim at the top so the hero
 * wash reads through, deepening to a warm — never neutral — floor
 * (home_shell.dart's rail decoration, on the live glow tokens).
 */
export const RAIL_GRADIENT =
  "linear-gradient(180deg, hsl(var(--background-deep)/0) 0%, hsl(var(--glow-deep)/0.06) 52%, hsl(var(--glow-deep)/0.10) 100%)";

/**
 * The drawer floats ABOVE the page, so it needs the OPAQUE equivalents of what
 * the rail composites to — derived from the live tokens, never frozen hexes
 * (a hardcoded warm scrim is how the Flutter phone drawer once ignored the
 * accent setting).
 */
export const DRAWER_GRADIENT =
  "linear-gradient(180deg, hsl(var(--background)) 0%, color-mix(in srgb, hsl(var(--glow-deep)) 14%, hsl(var(--background))) 52%, hsl(var(--background-deep)) 100%)";
