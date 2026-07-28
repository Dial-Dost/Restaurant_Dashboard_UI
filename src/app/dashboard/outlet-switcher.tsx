"use client"

import { useEffect, useState } from "react"
import { Store, Layers } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAuth } from "@/context/AuthContext"
import { getOutlets, type OutletRow } from "@/lib/db"
import { ALL_OUTLETS, SELECTED_OUTLET_KEY, setSelectedOutlet } from "@/lib/outlet"

// ALL_OUTLETS ("all") means "combine every outlet" — admins/managers see
// aggregated read-only data across all branches. The backend (X-Outlet-Id: "all")
// aggregates reads and rejects any WRITE with 400 while this is active.

// Lets admins/managers switch the active outlet (or view all combined). The choice
// is stored in localStorage and sent as X-Outlet-Id on every request (the backend
// authorizes it against the session), then the page reloads so all data refetches.
export function OutletSwitcher() {
  const { user } = useAuth()
  const [outlets, setOutlets] = useState<OutletRow[]>([])
  const [selected, setSelected] = useState<string>("")

  const roles = [user?.role, ...(Array.isArray(user?.role_all) ? user.role_all : [])]
  const canSwitch = roles.includes("admin") || roles.includes("manager")

  useEffect(() => {
    if (!user?.restaurantUsername || !canSwitch) {return}
    let active = true
    getOutlets(user.restaurantUsername)
      .then((o) => {
        if (!active) {return}
        const list = o?.outlets ?? []
        setOutlets(list)
        const stored = typeof window !== "undefined" ? window.localStorage.getItem(SELECTED_OUTLET_KEY) : null
        const valid = stored && (stored === ALL_OUTLETS || list.some((x) => x.id === stored)) ? stored : list[0]?.id ?? ""
        setSelected(valid)
      })
      .catch(() => {})
    return () => { active = false }
  }, [user?.restaurantUsername, canSwitch])

  if (!canSwitch || outlets.length < 2) {return null}

  // setSelectedOutlet persists to localStorage AND to the server cookie the
  // Server-Action data layer reads, then reloads so everything refetches.
  const onChange = (id: string) => {
    setSelected(id)
    void setSelectedOutlet(id)
  }

  const isAll = selected === ALL_OUTLETS

  return (
    <Select value={selected} onValueChange={onChange}>
      <SelectTrigger className={`h-9 w-[190px] ${isAll ? "border-primary text-primary" : ""}`}>
        {isAll ? <Layers className="mr-1 h-4 w-4 shrink-0" /> : <Store className="mr-1 h-4 w-4 shrink-0" />}
        <SelectValue placeholder="Outlet" />
      </SelectTrigger>
      <SelectContent>
        {/* Combined read-only view across every branch (admin/manager). */}
        <SelectItem value={ALL_OUTLETS}>All outlets (combined)</SelectItem>
        {outlets.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.outlet_name}{o.is_active ? "" : " (inactive)"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
