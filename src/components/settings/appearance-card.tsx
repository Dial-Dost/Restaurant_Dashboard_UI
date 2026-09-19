"use client"

// "Appearance — this device" (Flutter widgets/appearance_card.dart): the
// device-local look controls the web supports — dark/light tone (the header
// ThemeToggle menu), the accent ramp and the dark shell scheme. Nothing here is
// a tenant setting; every pick applies live and persists in this browser only.

import * as React from "react"
import { Check } from "lucide-react"

import { ThemeToggle } from "@/components/ThemeToggle"
import {
  ACCENTS,
  SCHEMES,
  currentAccentId,
  currentSchemeId,
  setAccent,
  setScheme,
  subscribeAppearance,
  type AccentId,
  type SchemeId,
} from "@/lib/appearance"
import { cn } from "@/lib/utils"

import { FieldLabel, Hint, SettingsCard } from "./settings-card"

export function AppearanceCard(): React.JSX.Element {
  const [accent, setAccentState] = React.useState<AccentId | null>(null)
  const [scheme, setSchemeState] = React.useState<SchemeId | null>(null)

  React.useEffect(() => {
    const sync = (): void => {
      setAccentState(currentAccentId())
      setSchemeState(currentSchemeId())
    }
    sync()
    return subscribeAppearance(sync)
  }, [])

  return (
    <SettingsCard
      title="Appearance"
      caption="How this dashboard looks on this device only. Other devices and your guests are not affected."
    >
      <div className="flex items-center justify-between gap-3">
        <FieldLabel>Theme</FieldLabel>
        <ThemeToggle />
      </div>
      <div className="space-y-2">
        <FieldLabel>Accent</FieldLabel>
        <div className="flex flex-wrap gap-2.5">
          {ACCENTS.map((a) => {
            const on = a.id === accent
            return (
              <button
                key={a.id}
                type="button"
                title={a.label}
                aria-label={`Accent ${a.label}`}
                aria-pressed={on}
                onClick={() => { setAccent(a.id) }}
                className={cn("flex h-8 w-8 items-center justify-center rounded-full border-2", on ? "border-foreground" : "border-transparent")}
                style={{ backgroundColor: a.base }}
              >
                {on ? <Check className="h-4 w-4" style={{ color: a.on }} /> : null}
              </button>
            )
          })}
        </div>
      </div>
      <div className="space-y-2">
        <FieldLabel>Shell scheme (dark mode)</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {SCHEMES.map((s) => {
            const on = s.id === scheme
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                onClick={() => { setScheme(s.id) }}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-fast",
                  on ? "border-accent-base/60 bg-accent-base/10" : "border-border hover:border-input",
                )}
              >
                <span className="h-3.5 w-3.5 rounded-full border border-white/20" style={{ background: `linear-gradient(135deg, ${s.bg} 50%, ${s.card} 50%)` }} />
                {s.label}
              </button>
            )
          })}
        </div>
        <Hint>The shell scheme applies while the dashboard is dark.</Hint>
      </div>
    </SettingsCard>
  )
}
