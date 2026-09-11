"use client"

/**
 * PICK WHICH PRODUCT THIS LOOKS LIKE.
 *
 * A separate control from the dark/light toggle beside it, because they answer
 * different questions: that one is "how bright is the room", this one is "which
 * visual language". The Flutter app keeps them apart for the same reason — see
 * `DesignSystem` in lib/ui/theme/appearance.dart — and folding them into one
 * four-way menu would lose a tenant's Gaia every time somebody switched to
 * light.
 *
 * THE SWATCH IS NOT DECORATION. "Rustic Fork" and "Gaia" are names for
 * near-black-and-copper and forest-and-champagne; nobody can be expected to
 * know that from the words, and this menu is the only place the mapping is
 * ever shown. So each row draws its actual ground and accent.
 */

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Check, Palette } from "lucide-react"
import { PALETTES, STORAGE_KEY, applyPalette, paletteFromStorage, type PaletteId } from "@/lib/palette"

export function PaletteToggle() {
  // DEFAULT_PALETTE, not a read, for the first render: this is a client
  // component inside a server-rendered tree, and reading localStorage during
  // render would produce markup that disagrees with the server's. The real
  // value lands in the effect below — and the inline boot script in the root
  // layout has already put it on <html>, so the PAGE never flashes even though
  // this button's tick briefly might.
  const [palette, setPalette] = useState<PaletteId>(PALETTES[0].id)

  useEffect(() => {
    setPalette(paletteFromStorage(typeof window === "undefined" ? null : window.localStorage))
  }, [])

  const choose = (id: PaletteId) => {
    setPalette(id)
    applyPalette(id, document.documentElement)
    try {
      window.localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // Private mode or a blocked cookie jar. The palette still APPLIES for
      // this session — it just will not survive a reload, which is a better
      // outcome than refusing to change at all.
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change the look">
          <Palette className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {PALETTES.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onSelect={() => { choose(p.id) }}
            className="flex items-start gap-2.5 py-2"
          >
            <span
              aria-hidden
              className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border"
              style={{ backgroundColor: p.swatch.bg }}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.swatch.accent }} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                {p.label}
                {palette === p.id && <Check className="h-3.5 w-3.5" />}
              </span>
              <span className="block text-xs leading-snug text-muted-foreground">{p.hint}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
