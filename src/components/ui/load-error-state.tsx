"use client"

import * as React from "react"
import { AlertCircle, RefreshCw, WifiOff } from "lucide-react"

import {
  isUnreachableError,
  offlineNothingSavedCaption,
  offlineNothingSavedTitle,
} from "@/hooks/use-cached-fetch"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"

/**
 * The pane a screen shows when it has nothing to show and the load failed
 * (async_view.dart LoadErrorState). Two different sentences for two different
 * situations: an unreachable server is the READER's problem to act on (their
 * Wi-Fi, their hotspot), while a refusal is the server's own words and is
 * repeated verbatim rather than dressed up as an outage.
 */
export interface LoadErrorStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Names the section, for the refusal case only ("Couldn't load orders."). */
  whatFailed: string
  error: unknown
  onRetry: () => void
}

function LoadErrorState({ whatFailed, error, onRetry, ...props }: LoadErrorStateProps): React.JSX.Element {
  const offline = isUnreachableError(error)
  return (
    <EmptyState
      icon={offline ? <WifiOff /> : <AlertCircle />}
      title={offline ? offlineNothingSavedTitle : whatFailed}
      caption={offline ? offlineNothingSavedCaption : errorText(error)}
      action={
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw />
          Retry
        </Button>
      }
      {...props}
    />
  )
}

function errorText(error: unknown): string {
  if (error instanceof Error) { return error.message; }
  if (typeof error === "string") { return error; }
  if (typeof error === "number" || typeof error === "boolean") { return String(error); }
  return "Something went wrong.";
}

export { LoadErrorState }
