"use client"

/**
 * THE MOBILE NAVIGATION, AND THE REASON THE DASHBOARD HAD NONE.
 *
 * ============================================================================
 * THE BLOCKER THIS REPLACES
 * ============================================================================
 * The dashboard's whole navigation is a macOS-style Dock: one fixed panel,
 * `width: fit-content`, centred with `left: 50%; transform: translateX(-50%)`.
 * For an admin it holds 22 icons in 7 titled sections with dividers — about
 * 1,200 pixels wide. On a 375px phone it does not shrink; it overflows off BOTH
 * edges, and the half you can see is unusable.
 *
 * Worse, and less obvious: every label is `opacity: 0` until `.dock-item:hover`.
 * A touch screen has no hover. So even the icons you could reach are unlabelled,
 * and 22 unlabelled icons is not a navigation — it is a guessing game.
 *
 * THE PAGES THEMSELVES WERE NEVER THE PROBLEM. They use the same responsive grid
 * classes as everything else here. The SHELL was the blocker, which is why this
 * is a shell component and not a rewrite of twenty screens.
 *
 * ============================================================================
 * WHAT THIS DOES INSTEAD
 * ============================================================================
 * A bottom bar of the FOUR destinations somebody on a phone actually uses, with
 * their labels visible, plus a "More" sheet holding everything else under the
 * same section headings the Dock draws. Four, not five or six: a 375px screen
 * divided five ways leaves 75px per target, and the text under the icon starts
 * truncating to nonsense.
 *
 * THE FOUR ARE CHOSEN, NOT TAKEN FROM THE TOP. `PRIMARY_ORDER` below is a list of
 * hrefs in the order a phone user wants them, and the bar takes the first four
 * that this session can actually reach. Slicing the nav's own first four would
 * give an admin Dashboard / Orders / Tables / Floor plan — and Floor plan is a
 * layout screen nobody opens mid-service, while Menu (86 a dish) is the one they
 * open constantly.
 *
 * A WAITER-ONLY OR VALET SESSION already has a two-item nav. It gets those two
 * and no More button, because a "More" that opens an empty sheet is worse than
 * no button.
 */

import { useState } from "react"
import Link from "next/link"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { MoreHorizontal } from "lucide-react"

export interface MobileNavItem {
  href: string
  label: string
  icon: React.ReactNode
  exact?: boolean
}

export interface MobileNavSection {
  title?: string
  items: MobileNavItem[]
}

/**
 * The order a phone user wants the bottom bar in.
 *
 * Orders first, not Dashboard: somebody holding a phone on the floor is taking
 * or checking an order, and the overview is what they open when they sit down.
 */
const PRIMARY_ORDER = [
  "/dashboard/orders",
  "/dashboard/tables",
  "/dashboard/menu",
  "/dashboard",
]

const isActive = (pathname: string, item: MobileNavItem): boolean =>
  item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`)

export function MobileNav({
  sections,
  pathname,
}: {
  sections: MobileNavSection[]
  pathname: string
}) {
  const [open, setOpen] = useState(false)

  const all = sections.flatMap((s) => s.items)
  if (all.length === 0) { return null }

  // The first four of PRIMARY_ORDER this session can actually reach, then any
  // remaining items in nav order until there are four. A session with only two
  // destinations gets two buttons, not two buttons and two gaps.
  const chosen: MobileNavItem[] = []
  for (const href of PRIMARY_ORDER) {
    const hit = all.find((i) => i.href === href)
    if (hit && !chosen.includes(hit)) { chosen.push(hit) }
    if (chosen.length === 4) { break }
  }
  for (const item of all) {
    if (chosen.length === 4) { break }
    if (!chosen.includes(item)) { chosen.push(item) }
  }

  const rest = all.filter((i) => !chosen.includes(i))

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 backdrop-blur md:hidden"
      // The home indicator on a modern phone sits over the bottom ~34px; without
      // this the last row of a nav bar is under the user's own gesture area.
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Main"
    >
      <div className="flex items-stretch">
        {chosen.map((item) => {
          const active = isActive(pathname, item)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              // min-h-14: a 56px target, which is what a thumb needs. Anything
              // smaller is the same defect as the 6px scrollbar handle.
              className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] font-medium transition-colors ${
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {/* The nav's icons come sized h-6 w-6 for the Dock; scaled down
                  here so the LABEL fits underneath, which is the whole point. */}
              <span className="[&_svg]:h-5 [&_svg]:w-5">{item.icon}</span>
              <span className="w-full truncate text-center">{item.label}</span>
            </Link>
          )
        })}

        {rest.length > 0 && (
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <MoreHorizontal className="h-5 w-5" />
                <span>More</span>
              </button>
            </SheetTrigger>
            {/* From the BOTTOM, because the button is at the bottom and a panel
                that flies in from the opposite edge reads as a different action. */}
            <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
              <SheetHeader className="text-left">
                <SheetTitle>All sections</SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-5 pb-6">
                {sections.map((section, si) => {
                  const items = section.items.filter((i) => rest.includes(i))
                  if (items.length === 0) { return null }
                  return (
                    <div key={section.title ?? `s${si}`}>
                      {section.title && (
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {section.title}
                        </p>
                      )}
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {items.map((item) => {
                          const active = isActive(pathname, item)
                          return (
                            <Link
                              key={item.href}
                              href={item.href}
                              onClick={() => { setOpen(false) }}
                              aria-current={active ? "page" : undefined}
                              className={`flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-lg border p-2 text-center text-[11px] font-medium transition-colors ${
                                active
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border text-foreground hover:bg-muted"
                              }`}
                            >
                              <span className="[&_svg]:h-5 [&_svg]:w-5">{item.icon}</span>
                              <span className="w-full break-words leading-tight">{item.label}</span>
                            </Link>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </SheetContent>
          </Sheet>
        )}
      </div>
    </nav>
  )
}
