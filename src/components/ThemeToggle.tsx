"use client"

/**
 * 6.6 — DARK OR LIGHT, AND WHICH LIGHT.
 *
 * This was a one-click sun/moon flip. The requirement adds colour options for
 * light mode (white, beige, …), so the same button now opens a short menu:
 *
 *   Dark
 *   Light — White | Beige | Soft grey
 *
 * One menu rather than a second header button, because the tone only means
 * something in light mode — a separate "beige" control that does nothing in
 * dark mode would look broken. Picking a tone switches to light; picking Dark
 * keeps the tone for next time (see `applyAppearancePick`).
 *
 * The sun/moon icon on the trigger is unchanged, so the control is where
 * everybody already looks for it.
 */

import * as React from "react"
import { Check, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  DEFAULT_LIGHT_TONE,
  LIGHT_TONES,
  LIGHT_TONE_STORAGE_KEY,
  activeAppearance,
  applyAppearancePick,
  applyLightTone,
  lightToneFromStorage,
  type AppearancePick,
  type LightToneId,
} from "@/lib/light-tone"

export function ThemeToggle(): React.JSX.Element {
  const { theme, setTheme } = useTheme()
  // DEFAULT, not a storage read, on the first render — same hydration reason as
  // PaletteToggle. The boot script in the root layout has already put the real
  // tone on <html>, so only this menu's tick can be briefly stale, never the page.
  const [tone, setTone] = React.useState<LightToneId>(DEFAULT_LIGHT_TONE)
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setTone(lightToneFromStorage(typeof window === "undefined" ? null : window.localStorage))
    setMounted(true)
  }, [])

  const active = mounted ? activeAppearance(theme, tone) : null

  const choose = (pick: AppearancePick): void => {
    const next = applyAppearancePick(pick)
    if (next.tone) {
      setTone(next.tone)
      applyLightTone(next.tone, document.documentElement)
      try {
        window.localStorage.setItem(LIGHT_TONE_STORAGE_KEY, next.tone)
      } catch {
        // Private mode: the tone still applies for this session, it just will
        // not survive a reload.
      }
    }
    // next-themes persists this itself (localStorage "theme"), as it always has.
    setTheme(next.theme)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon">
          <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => { choose("dark") }} className="flex items-center gap-2.5">
          <Moon aria-hidden className="h-4 w-4" />
          <span className="flex-1 text-sm font-medium">Dark</span>
          {active === "dark" && <Check aria-label="Selected" className="h-3.5 w-3.5" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Sun aria-hidden className="h-3.5 w-3.5" />
          Light
        </DropdownMenuLabel>
        {LIGHT_TONES.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onSelect={() => { choose(t.id) }}
            className="flex items-start gap-2.5 py-2"
          >
            {/* The swatch is the real ground colour — "beige" and "soft grey"
                are words, and this menu is where they are first seen. */}
            <span
              aria-hidden
              className="mt-0.5 h-5 w-5 shrink-0 rounded-full border"
              style={{ backgroundColor: t.swatch.bg, borderColor: t.swatch.border }}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                {t.label}
                {active === t.id && <Check aria-label="Selected" className="h-3.5 w-3.5" />}
              </span>
              <span className="block text-xs leading-snug text-muted-foreground">{t.hint}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
