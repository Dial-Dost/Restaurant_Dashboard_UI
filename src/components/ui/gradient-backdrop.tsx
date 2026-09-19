"use client"

import * as React from "react"

import {
  getBackdrop,
  hslTripleToRgb,
  isDefaultBackdrop,
  resolveBackdrop,
  subscribeAppearance,
  type ResolvedBackdrop,
  type Rgb,
} from "@/lib/appearance"
import { cn } from "@/lib/utils"

/**
 * The guest ordering page's warmth, behind the dashboard — a layer-for-layer
 * translation of the app's GradientBackdrop (gradient_backdrop.dart):
 *
 *   1. near-black base                 (the page ground)
 *   2. hero wash                       linear-gradient(150deg, glowDeep → ground 78%)
 *      over the top 42% of the viewport, clamped 180–520px
 *   3. a glow-bright bloom off the top-right corner (34%, 62% stop)
 *   4. a darkening pass                180deg bgDeep .15 → .40@45% → ground .96
 *   5. two static ambient orbs         glowMid / glowDeep at 22%
 *
 * PURE CSS on the glow tokens, so a different accent (or the derived light
 * glow tints) recolours it with no code. STATIC on purpose — the app
 * deliberately does not animate a layer that sits behind every module. Under
 * Gaia the whole thing collapses to the flat ground (`gaia:hidden` — Gaia's
 * depth is the ladder and a hairline, not a wash).
 *
 * When the owner has mixed the backdrop (appearance.ts setBackdrop), the
 * resolved tones — with the AA guard clamping unreadable extremes — override
 * the token-driven defaults inline.
 *
 * Place it as the first child of a `relative` page wrapper:
 *   <div className="relative"><GradientBackdrop />…content…</div>
 */
export function GradientBackdrop({ className }: { className?: string }): React.JSX.Element {
  const [resolved, setResolved] = React.useState<ResolvedBackdrop | null>(null)

  React.useEffect(() => {
    const update = (): void => {
      const style = getBackdrop()
      if (isDefaultBackdrop(style)) {
        // The shipped path: the CSS below reads the live tokens directly.
        setResolved(null)
        return
      }
      const cs = getComputedStyle(document.documentElement)
      const read = (token: string, fallback: Rgb): Rgb =>
        hslTripleToRgb(cs.getPropertyValue(token)) ?? fallback
      setResolved(
        resolveBackdrop({
          style,
          glowBright: read("--glow-bright", [194, 65, 12]),
          glowMid: read("--glow-mid", [154, 52, 18]),
          glowDeep: read("--glow-deep", [124, 45, 18]),
          bg: read("--background", [12, 10, 9]),
          ink: read("--foreground", [236, 234, 230]),
        })
      )
    }
    update()
    const unsubscribe = subscribeAppearance(update)
    // Theme / palette / accent flips change the tokens the guard ran against.
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-palette", "data-accent", "data-scheme", "data-light-tone"],
    })
    return () => {
      unsubscribe()
      observer.disconnect()
    }
  }, [])

  const heroHeight = "clamp(180px, 42vh, 520px)"
  const washAngle = resolved ? `${resolved.washAngleDeg}deg` : "150deg"
  const washFrom = resolved ? resolved.washColor : "hsl(var(--glow-deep))"

  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-hidden gaia:hidden", className)}
    >
      {/* 1 — the base every other layer sits on. */}
      <div className="absolute inset-0 bg-background" />

      {/* 5 — ambient orbs, painted before the hero so it reads brighter. */}
      <Orb
        className="-left-20 -top-[120px] h-[360px] w-[360px]"
        color={resolved ? resolved.orbNearColor : "hsl(var(--glow-mid))"}
        opacity={resolved ? resolved.orbNearOpacity : 0.22}
        stop={65}
      />
      <Orb
        className="-bottom-[140px] -right-[60px] h-[340px] w-[340px]"
        color={resolved ? resolved.orbFarColor : "hsl(var(--glow-deep))"}
        opacity={resolved ? resolved.orbFarOpacity : 0.22}
        stop={65}
      />

      {/* 2 — the hero wash: the warm event at the top, gone by ~78%. */}
      <div
        className="absolute inset-x-0 top-0"
        style={{
          height: heroHeight,
          background: `linear-gradient(${washAngle}, ${washFrom}, hsl(var(--background)) 78%)`,
        }}
      />

      {/* 3 — the bright bloom spilling off the top-right corner. */}
      <Orb
        className="-right-[70px] -top-[120px] h-[340px] w-[340px]"
        color={resolved ? resolved.bloomColor : "hsl(var(--glow-bright))"}
        opacity={resolved ? resolved.bloomOpacity : 0.34}
        stop={62}
      />

      {/* 4 — the darkening pass that lands the wash back on the page. */}
      <div
        className="absolute inset-x-0 top-0"
        style={{
          height: heroHeight,
          background:
            "linear-gradient(180deg, hsl(var(--background-deep)/0.15), hsl(var(--background-deep)/0.40) 45%, hsl(var(--background)/0.96))",
        }}
      />
    </div>
  )
}

/** One soft circular glow — a radial stop instead of a blur filter. */
function Orb({
  className,
  color,
  opacity,
  stop,
}: {
  className: string
  color: string
  opacity: number
  stop: number
}): React.JSX.Element {
  return (
    <div
      className={cn("absolute rounded-full", className)}
      style={{
        background: `radial-gradient(circle, color-mix(in srgb, ${color} ${Math.round(opacity * 100)}%, transparent), transparent ${stop}%)`,
      }}
    />
  )
}
