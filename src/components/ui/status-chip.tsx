"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Status chip (status_chip.dart): 12% tint fill of the status colour, 28%
 * edge, full-pill radius, solid dot, 11.5px w600 label lifted 25% toward
 * white (dark) / toward the primary ink (light) via --status-lift. Status is
 * NEVER colour-alone: the label always ships, and it ellipsises instead of
 * overflowing a narrow tile.
 *
 * Under Gaia the same component renders the engraved form (GaiaStatusChip):
 * no fill, 2px corners, the border in the status colour at FULL strength,
 * tracked uppercase 10.5px label in the status colour.
 */

export type StatusChipStatus = "success" | "warning" | "danger" | "info" | "neutral"

const STATUS_VAR: Record<StatusChipStatus, string> = {
  success: "--success",
  warning: "--warning",
  danger: "--destructive",
  info: "--info",
  neutral: "--neutral",
}

export interface StatusChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  label: React.ReactNode
  /** One of the five status inks… */
  status?: StatusChipStatus
  /** …or any CSS colour (e.g. a floor ink from FLOOR_INKS). Wins over status. */
  color?: string
  dense?: boolean
  /** Pulses the dot — for live states (a running timer, an open session). */
  animated?: boolean
}

function StatusChip({
  label,
  status = "neutral",
  color,
  dense = false,
  animated = false,
  className,
  style,
  ...props
}: StatusChipProps): React.JSX.Element {
  const base = color ?? `hsl(var(${STATUS_VAR[status]}))`
  const vars = {
    "--chip-color": base,
    // AppColors.lift(color, .25): toward white on dark, toward the primary
    // ink on light — --status-lift carries the direction per palette block.
    "--chip-label": `color-mix(in srgb, ${base} 75%, hsl(var(--status-lift)))`,
    ...style,
  } as React.CSSProperties
  return (
    <span
      style={vars}
      className={cn(
        "inline-flex min-w-0 max-w-full items-center rounded-full border",
        "border-[color:color-mix(in_srgb,var(--chip-color)_28%,transparent)]",
        "bg-[color:color-mix(in_srgb,var(--chip-color)_12%,transparent)]",
        "text-[color:var(--chip-label)]",
        dense ? "gap-[5px] px-2 py-[3px] text-[10.5px]" : "gap-1.5 px-2.5 py-[5px] text-[11.5px]",
        "font-semibold tracking-[0.3px]",
        // Gaia: engraved — no fill, hairline in the status colour itself,
        // 2px corners, tracked uppercase pill label in the status colour.
        "gaia:rounded-[2px] gaia:border-[color:var(--chip-color)] gaia:bg-transparent",
        "gaia:font-normal gaia:uppercase gaia:tracking-[0.14em] gaia:text-[10.5px]",
        "gaia:text-[color:var(--chip-color)]",
        className
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "shrink-0 rounded-full bg-[color:var(--chip-color)]",
          dense ? "h-[5px] w-[5px]" : "h-1.5 w-1.5",
          animated && "animate-pulse"
        )}
      />
      <span className="min-w-0 truncate">{label}</span>
    </span>
  )
}

/**
 * Quiet metadata chip (status_chip.dart InfoChip): icon + 11px label on a
 * recessed pill, radius 7, hairline border — dates, table numbers,
 * categories. Gaia: unfilled and square, the stronger hairline.
 */
export interface InfoChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  icon?: React.ReactNode
  label: React.ReactNode
  /** Wrap a long label rather than cut it (a label that ends in a figure). */
  wrap?: boolean
}

function InfoChip({ icon, label, wrap = false, className, ...props }: InfoChipProps): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-[5px] rounded-[7px] border border-border bg-inset px-[9px] py-1",
        "text-[11px] font-medium tracking-[0.2px] text-muted-foreground",
        "gaia:rounded-[2px] gaia:border-input gaia:bg-transparent",
        className
      )}
      {...props}
    >
      {icon != null && (
        <span aria-hidden className="shrink-0 text-tertiary [&>svg]:h-3 [&>svg]:w-3">
          {icon}
        </span>
      )}
      <span className={cn("min-w-0", wrap ? "" : "truncate")}>{label}</span>
    </span>
  )
}

export { StatusChip, InfoChip }
