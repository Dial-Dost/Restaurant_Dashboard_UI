"use client"

/**
 * H4 — "86 A DISH": the quick-access availability sidebar.
 *
 * V3: "Add a quick-access sidebar menu that allows staff to easily toggle
 * individual dishes as 'available' or 'unavailable' to save time."
 *
 * ============================================================================
 * WHAT MAKES THIS DIFFERENT FROM THE MENU EDITOR
 * ============================================================================
 * The menu editor is for planning: you open it between services, you change a
 * price, you upload a photo. This is for the middle of a rush, when the kitchen
 * shouts that the paneer has run out and three waiters are mid-order. That
 * difference decides everything below:
 *
 *   * IT OPENS OVER WHATEVER YOU WERE DOING and closes back to it. Navigating to
 *     the menu page and back loses the order somebody was taking.
 *   * IT SEARCHES FIRST. A 96-item menu is not a list you scroll during service.
 *   * ONE TAP IS THE WHOLE INTERACTION — no row to expand, no dialog, no Save.
 *   * IT SHOWS THE UNAVAILABLE DISHES FIRST, because the second thing anybody
 *     does here is put back the dish that came in an hour ago, and hunting for
 *     it among ninety available ones is the slow half of this job.
 *
 * ============================================================================
 * OPTIMISTIC, BUT HONEST ABOUT FAILING
 * ============================================================================
 * The toggle flips immediately — waiting on a round trip while somebody is
 * holding a ticket is the thing this exists to avoid. If the write fails the
 * flip is REVERTED and the reason is shown. A control that pretends to have
 * worked is worse here than a slow one: the dish stays orderable and the
 * kitchen gets a ticket for something they have already said they cannot cook.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { SearchInput } from "@/components/ui/search-input"
import { Badge } from "@/components/ui/badge"
import { CircleSlash, UtensilsCrossed } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { getMenuItems, setMenuItemAvailability } from "@/lib/db"
import type { MenuItem } from "@/app/dashboard/menu/data"

/** An item is available unless it says otherwise — the stored default. */
const isAvailable = (m: MenuItem): boolean => m.available !== false

export function DishAvailabilitySidebar({ rid }: { rid: string }) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<MenuItem[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState("")
  /** Ids with a write in flight, so a double-tap cannot race itself. */
  const [busy, setBusy] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    if (!rid) { return }
    setLoading(true)
    try { setItems(await getMenuItems(rid)) } finally { setLoading(false) }
  }, [rid])

  // Loaded when the sheet OPENS, not on mount: this component sits in the
  // header of every dashboard page, and fetching a 96-item menu on every page
  // load to populate a panel nobody opened is pure cost.
  useEffect(() => { if (open) { void load() } }, [open, load])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = q
      ? items.filter((m) => m.name.toLowerCase().includes(q) || (m.category ?? "").toLowerCase().includes(q))
      : items
    // Unavailable first — putting a dish BACK is the second half of this job and
    // the half that is otherwise slow.
    return [...matched].sort((a, b) => {
      const av = Number(isAvailable(a)) - Number(isAvailable(b))
      return av !== 0 ? av : a.name.localeCompare(b.name)
    })
  }, [items, query])

  const offCount = useMemo(() => items.filter((m) => !isAvailable(m)).length, [items])

  const toggle = async (item: MenuItem) => {
    if (busy.has(item.id)) { return }
    const next = !isAvailable(item)
    setBusy((b) => new Set(b).add(item.id))
    // Optimistic: the flip lands before the round trip.
    setItems((list) => list.map((m) => (m.id === item.id ? { ...m, available: next } : m)))
    try {
      await setMenuItemAvailability(rid, item.id, next)
      toast({
        title: next ? `${item.name} is back on` : `${item.name} is off the menu`,
        description: next
          ? "Guests and staff can order it again."
          : "It will not appear on the guest menu and cannot be added to an order.",
      })
    } catch (e) {
      // REVERTED. A control that pretends to have worked leaves the dish
      // orderable and the kitchen gets a ticket for something they cannot cook.
      setItems((list) => list.map((m) => (m.id === item.id ? { ...m, available: !next } : m)))
      toast({
        title: "Could not change that",
        description: e instanceof Error ? e.message : "The change was not saved.",
        variant: "destructive",
      })
    } finally {
      setBusy((b) => { const n = new Set(b); n.delete(item.id); return n })
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <UtensilsCrossed className="h-4 w-4" />
          <span className="hidden sm:inline">Dish availability</span>
          {/* The count is the reason to open it: "3 off" is a standing reminder
              to put them back, and it is visible without opening anything. */}
          {offCount > 0 && <Badge variant="destructive" className="ml-1">{offCount} off</Badge>}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Dish availability</SheetTitle>
          <SheetDescription>
            One tap takes a dish off the menu or puts it back. Nothing else about the dish changes.
          </SheetDescription>
        </SheetHeader>

        <SearchInput
          wrapperClassName="mt-4"
          placeholder="Search dishes…"
          aria-label="Search dishes"
          value={query}
          onValueChange={setQuery}
          autoFocus
        />

        <div className="mt-3 flex-1 overflow-y-auto pr-1">
          {loading && items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading the menu…</p>
          ) : shown.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {items.length === 0 ? "No dishes on the menu yet." : "No dish matches that."}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {shown.map((m) => {
                const on = isAvailable(m)
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      disabled={busy.has(m.id)}
                      onClick={() => { void toggle(m) }}
                      aria-pressed={!on}
                      className="flex w-full items-center justify-between gap-3 py-3 text-left transition-colors hover:bg-muted/60 disabled:opacity-60"
                    >
                      <span className="min-w-0">
                        <span className={`block truncate text-sm font-medium ${on ? "" : "text-muted-foreground line-through"}`}>
                          {m.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">{m.category}</span>
                      </span>
                      {on ? (
                        <Badge variant="secondary" className="shrink-0">Available</Badge>
                      ) : (
                        <Badge variant="destructive" className="shrink-0 gap-1">
                          <CircleSlash className="h-3 w-3" /> Off
                        </Badge>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
