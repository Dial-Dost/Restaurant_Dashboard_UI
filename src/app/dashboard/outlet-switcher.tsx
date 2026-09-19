"use client"

// The outlet scope switcher — the web copy of home_shell.dart's
// `_outletSwitcher`: a compact ICON menu among the top-bar actions (store icon;
// layers icon tinted copper when "All outlets" is active), checked entries, and
// an IN-PLACE switch — the user stays exactly where they were, no reload.
//
// ALL_OUTLETS ("all") means "combine every outlet" — admins/managers see
// aggregated read-only data across all branches; the backend rejects writes
// (400) while it is active.
//
// Shown only for admin/manager sessions with ≥2 outlets. The `useOutletScope`
// hook is exported separately so the narrow-chrome overflow menu can fold the
// SAME entries (same list, same select path) instead of a second copy.

import { useEffect, useState } from "react"
import type { JSX } from "react"
import { Check, Layers, Store } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAuth } from "@/context/AuthContext"
import { getOutlets, type OutletRow } from "@/lib/db"
import { ALL_OUTLETS, SELECTED_OUTLET_KEY, applySelectedOutlet } from "@/lib/outlet"

export interface OutletScope {
  /** admin/manager with ≥2 outlets — everyone else renders no switcher at all. */
  canSwitch: boolean
  outlets: OutletRow[]
  activeId: string
  isAll: boolean
  /** Persist + announce IN PLACE (no reload) — the shell refreshes the module. */
  select: (id: string) => void
}

export const outletDisplayName = (o: OutletRow): string =>
  `${o.outlet_name}${o.is_active ? "" : " (inactive)"}`

export function useOutletScope(): OutletScope {
  const { user } = useAuth()
  const [outlets, setOutlets] = useState<OutletRow[]>([])
  const [activeId, setActiveId] = useState<string>("")

  const roles = [user?.role, ...(Array.isArray(user?.role_all) ? user.role_all : [])]
  const canSwitchRole = roles.includes("admin") || roles.includes("manager")

  useEffect(() => {
    if (!user?.restaurantUsername || !canSwitchRole) { return }
    let active = true
    getOutlets(user.restaurantUsername)
      .then((o) => {
        if (!active) { return }
        const list = o?.outlets ?? []
        setOutlets(list)
        let stored: string | null = null
        try {
          stored = typeof window !== "undefined" ? window.localStorage.getItem(SELECTED_OUTLET_KEY) : null
        } catch { /* private mode */ }
        const valid = stored && (stored === ALL_OUTLETS || list.some((x) => x.id === stored)) ? stored : list[0]?.id ?? ""
        setActiveId(valid)
      })
      .catch(() => { /* offline: keep whatever scope is already applied */ })
    return () => { active = false }
  }, [user?.restaurantUsername, canSwitchRole])

  const select = (id: string): void => {
    if (!id || id === activeId) { return }
    setActiveId(id)
    void applySelectedOutlet(id)
  }

  return {
    canSwitch: canSwitchRole && outlets.length >= 2,
    outlets,
    activeId,
    isAll: activeId === ALL_OUTLETS,
    select,
  }
}

export function OutletSwitcher({ scope }: { scope: OutletScope }): JSX.Element | null {
  if (!scope.canSwitch) { return null }
  const { outlets, activeId, isAll, select } = scope

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title={isAll ? "Viewing all outlets (combined)" : "Switch outlet"}
          className={isAll ? "text-accent-foreground" : "text-muted-foreground"}
        >
          {isAll ? <Layers className="h-5 w-5" /> : <Store className="h-5 w-5" />}
          <span className="sr-only">{isAll ? "Viewing all outlets (combined)" : "Switch outlet"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onSelect={() => { select(ALL_OUTLETS) }} className="gap-2">
          <span className="w-4 shrink-0">{isAll && <Check className="h-4 w-4" />}</span>
          All outlets (combined)
        </DropdownMenuItem>
        {outlets.map((o) => (
          <DropdownMenuItem key={o.id} onSelect={() => { select(o.id) }} className="gap-2">
            <span className="w-4 shrink-0">{o.id === activeId && <Check className="h-4 w-4" />}</span>
            {outletDisplayName(o)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
