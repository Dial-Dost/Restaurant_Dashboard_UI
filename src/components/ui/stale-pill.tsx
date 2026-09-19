"use client"

import * as React from "react"
import { History } from "lucide-react"

import { formatAgo } from "@/hooks/use-cached-fetch"
import { cn } from "@/lib/utils"
import { InfoChip, StatusChip } from "@/components/ui/status-chip"

/**
 * The floating, non-blocking staleness pill (async_view.dart _StaleBanner):
 * offline always shows; a cache-primed copy still being refreshed labels
 * itself only once it is old enough to mislead (>60s). Feed it straight from
 * `useCachedFetch` and float it over the content:
 *
 *   <div className="relative">
 *     {content}
 *     <CacheStalePill offline={offline} fromCache={fromCache} updatedAt={updatedAt} />
 *   </div>
 */
export interface CacheStalePillProps {
  offline: boolean
  fromCache: boolean
  updatedAt: number | null
  /** The copy predates a change this device made — a stronger sentence. */
  superseded?: boolean
  className?: string
}

function CacheStalePill({ offline, fromCache, updatedAt, superseded = false, className }: CacheStalePillProps): React.JSX.Element | null {
  // Keep the "Xm ago" moving while the pill is up.
  const [, tick] = React.useReducer((n: number) => n + 1, 0)
  const shouldShow =
    offline || (fromCache && updatedAt != null && Date.now() - updatedAt > 60_000)
  React.useEffect(() => {
    if (!shouldShow) { return }
    const id = window.setInterval(tick, 30_000)
    return () => { window.clearInterval(id) }
  }, [shouldShow])

  if (!shouldShow) { return null }
  const age = formatAgo(updatedAt)
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-5 z-10 flex justify-center",
        className
      )}
    >
      <span className="rounded-full border border-input bg-popover shadow-[0_3px_12px_rgb(0_0_0/0.4)]">
        {offline ? (
          <StatusChip
            status="warning"
            label={
              superseded
                ? `Offline — last copy from before your recent changes · ${age}`
                : `Offline — showing saved data · ${age}`
            }
          />
        ) : (
          <InfoChip icon={<History />} label={`Updated ${age}`} />
        )}
      </span>
    </div>
  )
}

export { CacheStalePill }
