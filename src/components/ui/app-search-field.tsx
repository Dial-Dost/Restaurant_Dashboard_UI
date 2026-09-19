"use client"

import * as React from "react"
import { Search, X } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * THE one search box (app_search_field.dart). The app centralised search
 * after a real client bug — "pressing the x does not clear the search" — and
 * the rules live here once so a screen can no longer break them:
 *
 *  1. The box's text is the ONLY query source; every way of changing it
 *     (typing, the x, Escape, select-all-delete) reaches `onQuery`.
 *  2. An EMPTY box is never debounced: clearing cancels the pending timer and
 *     emits '' at once, so a cleared word can never land a moment later.
 *  3. The x is a real button inside the field, visible whenever the box has
 *     text (whatever the debounce is doing); pressing it clears instantly and
 *     KEEPS FOCUS — the next thing anyone does is type the next word.
 *  4. Nothing re-seeds the text from outside: `initialQuery` is read once.
 *  5. Escape clears a non-empty box (and stops there); on an empty box it
 *     passes through so a dialog still closes.
 *  6. Enter submits immediately, bypassing the debounce.
 *  7. A word still waiting when the box unmounts is dropped, not sent.
 */
export interface AppSearchFieldProps {
  /** Trimmed, deduplicated ('' the moment the box empties). */
  onQuery: (query: string) => void
  placeholder?: string
  /** Read once, never again. */
  initialQuery?: string
  /** How long typing waits before `onQuery` hears it. Clearing never waits. */
  debounceMs?: number
  autoFocus?: boolean
  /** The reports-toolbar smaller box: 13px text, 16px glyph, 32px tall. */
  compact?: boolean
  className?: string
  /** What the box searches, for screen readers (falls back to placeholder). */
  "aria-label"?: string
  disabled?: boolean
}

const CLEAR_LABEL = "Clear search"

function AppSearchField({
  onQuery,
  placeholder,
  initialQuery = "",
  debounceMs = 0,
  autoFocus = false,
  compact = false,
  className,
  disabled,
  "aria-label": ariaLabel,
}: AppSearchFieldProps): React.JSX.Element {
  const [text, setText] = React.useState(initialQuery)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const timerRef = React.useRef<number | null>(null)
  // The last query the screen has heard — sends are deduplicated against it.
  const heardRef = React.useRef(initialQuery.trim())
  const onQueryRef = React.useRef(onQuery)
  onQueryRef.current = onQuery

  const cancelPending = React.useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const send = React.useCallback((query: string) => {
    if (query === heardRef.current) { return }
    heardRef.current = query
    onQueryRef.current(query)
  }, [])

  // Unmount: drop a waiting word, never send it (the screen may be going too).
  React.useEffect(() => cancelPending, [cancelPending])

  const handleChange = (next: string): void => {
    setText(next)
    const query = next.trim()
    if (query === "") {
      cancelPending()
      send("")
    } else if (debounceMs <= 0) {
      cancelPending()
      send(query)
    } else {
      cancelPending()
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        send(query)
      }, debounceMs)
    }
  }

  const clear = (): void => {
    cancelPending()
    setText("")
    send("")
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") {
      cancelPending()
      send(text.trim())
    } else if (e.key === "Escape") {
      if (text !== "") {
        // Clears and stops here; an empty box passes Escape through so the
        // dialog around it still closes.
        e.preventDefault()
        e.stopPropagation()
        clear()
      }
    }
  }

  const glyph = compact ? "h-4 w-4" : "h-[18px] w-[18px]"
  return (
    <div className={cn("relative", className)}>
      <Search
        aria-hidden
        className={cn("pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-tertiary", glyph)}
      />
      <input
        ref={inputRef}
        type="text"
        role="searchbox"
        aria-label={ariaLabel ?? placeholder ?? "Search"}
        placeholder={placeholder}
        value={text}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => { handleChange(e.target.value) }}
        onKeyDown={handleKeyDown}
        className={cn(
          "w-full rounded-md border border-border bg-inset text-foreground",
          "placeholder:text-tertiary",
          "focus-visible:outline-none focus-visible:border-[hsl(var(--primary)/0.5)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "transition-colors duration-fast",
          "gaia:rounded-[2px] gaia:border-input gaia:bg-transparent",
          compact ? "h-8 pl-8 pr-8 text-[13px]" : "h-9 pl-9 pr-9 text-sm"
        )}
      />
      {text !== "" && (
        <button
          type="button"
          aria-label={CLEAR_LABEL}
          title={CLEAR_LABEL}
          // The input keeps focus through the click.
          onMouseDown={(e) => { e.preventDefault() }}
          onClick={clear}
          className={cn(
            "absolute right-0 top-0 flex h-full items-center justify-center px-2.5",
            "text-muted-foreground transition-colors duration-fast hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
          )}
        >
          <X aria-hidden className={glyph} />
        </button>
      )}
    </div>
  )
}

export { AppSearchField }
