import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Shimmer skeleton primitives (skeleton.dart SkeletonBox + async_view.dart's
 * _LoadingSkeleton): quiet pulsing blocks on the raised surface — visible on
 * the card they load inside, unlike bg-muted — with the app's 6px radius and
 * opacity pulse.
 */

export interface SkeletonBoxProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Pixel width; omit for full width. */
  width?: number
  /** Pixel height; default 14. */
  height?: number
}

function SkeletonBox({ width, height = 14, className, style, ...props }: SkeletonBoxProps): React.JSX.Element {
  return (
    <div
      aria-hidden
      className={cn("animate-skeleton-pulse rounded-[6px] bg-popover", width == null && "w-full", className)}
      style={{ width, height, ...style }}
      {...props}
    />
  )
}

/**
 * The section-loading pane: a title bar and a run of row placeholders on
 * inset panels — what every module shows instead of "Loading…" text.
 */
export interface SkeletonRowsProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  rows?: number
  /** Skip the leading title bar (when the section header is already up). */
  title?: boolean
}

function SkeletonRows({ rows = 6, title = true, className, ...props }: SkeletonRowsProps): React.JSX.Element {
  return (
    <div aria-busy="true" className={cn("space-y-3", className)} {...props}>
      {title && <SkeletonBox width={180} height={22} className="mb-5 rounded-[7px]" />}
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-border bg-inset p-[18px]">
          <SkeletonBox width={40} height={40} className="rounded-[10px]" />
          <div className="flex-1 space-y-2">
            <SkeletonBox width={160} height={13} />
            <SkeletonBox width={90} height={11} />
          </div>
          <SkeletonBox width={56} height={24} className="rounded-[8px]" />
        </div>
      ))}
    </div>
  )
}

/** A grid of stat-tile placeholders for dashboard headers. */
export interface SkeletonStatsProps extends React.HTMLAttributes<HTMLDivElement> {
  tiles?: number
}

function SkeletonStats({ tiles = 4, className, ...props }: SkeletonStatsProps): React.JSX.Element {
  return (
    <div aria-busy="true" className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-4", className)} {...props}>
      {Array.from({ length: tiles }, (_, i) => (
        <div key={i} className="space-y-3 rounded-lg border border-border bg-inset p-[18px]">
          <SkeletonBox width={90} height={28} className="rounded-[7px]" />
          <SkeletonBox height={40} className="rounded-[4px]" />
          <SkeletonBox width={130} height={11} />
        </div>
      ))}
    </div>
  )
}

export { SkeletonBox, SkeletonRows, SkeletonStats }
