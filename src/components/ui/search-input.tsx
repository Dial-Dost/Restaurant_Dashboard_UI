"use client"

// CLIENT ITEM 6 (app 2.0.2) — the one search box for the dashboard, the web
// twin of the app's AppSearchField. Why it exists and every rule it keeps are
// in `lib/search-input.ts`, where they are tested; this file only draws them.
//
//  * `value` / `onValueChange` hold the box's text, so the x can only ever
//    reset the one value the box shows;
//  * the x is a real <button type="button">, 40px wide and as tall as the box,
//    drawn whenever the box holds anything. Pressing it keeps the caret in the
//    box (the mousedown is not allowed to move focus to the button), so the
//    next word goes straight in;
//  * `onQueryChange` is how a screen hears the query: debounced for typing, at
//    once for an emptied box, trimmed, and only when it changes;
//  * Escape clears a box that has text. Inside a Dialog, Sheet or Popover the
//    container lets it (see `keepOpenForSearchEscape`); on an empty box Escape
//    still closes them;
//  * type="text" with inputMode="search": no browser-drawn cancel glyph to
//    double up with this x.
//
// `bare` is for a page with its own skin (the guest ordering page): same
// behaviour, the caller's box, glyph and colours.
import * as React from "react"
import { Search, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import {
  SEARCH_CLEAR_BUTTON_CLASS,
  SEARCH_CLEAR_LABEL,
  SEARCH_INPUT_ATTR,
  scheduleSearchQuery,
  searchKeyAction,
  searchQueryOf,
  showSearchClear,
} from "@/lib/search-input"

export interface SearchInputProps
  extends Omit<React.ComponentProps<"input">, "value" | "defaultValue" | "onChange" | "type" | "ref"> {
  value: string
  onValueChange: (next: string) => void
  /** The trimmed query: after `debounceMs` while typing, at once when emptied. */
  onQueryChange?: (query: string) => void
  debounceMs?: number
  clearLabel?: string
  wrapperClassName?: string
  wrapperStyle?: React.CSSProperties
  /** The caller's own skin: no Input styling, no positioned glyphs. */
  bare?: boolean
  /** Replaces the search glyph (drawn before the box). */
  icon?: React.ReactNode
  /** Replaces the x glyph inside the button. */
  clearIcon?: React.ReactNode
  clearClassName?: string
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    value,
    onValueChange,
    onQueryChange,
    debounceMs = 0,
    clearLabel = SEARCH_CLEAR_LABEL,
    className,
    wrapperClassName,
    wrapperStyle,
    bare = false,
    icon,
    clearIcon,
    clearClassName,
    onKeyDown,
    ...rest
  },
  ref,
) {
  const inner = React.useRef<HTMLInputElement | null>(null)
  const setRefs = React.useCallback((node: HTMLInputElement | null) => {
    inner.current = node
    if (typeof ref === "function") {
      ref(node)
    } else if (ref) {
      ref.current = node
    }
  }, [ref])

  // The screen's handler can change every render; the query effect must not
  // restart (and lose its pending wait) because of that.
  const onQuery = React.useRef(onQueryChange)
  React.useEffect(() => { onQuery.current = onQueryChange }, [onQueryChange])
  // What the screen already has: a box that mounts holding a query does not
  // repeat it.
  const lastSent = React.useRef(searchQueryOf(value))
  React.useEffect(
    () => scheduleSearchQuery(value, debounceMs, lastSent, (query) => { onQuery.current?.(query) }),
    [value, debounceMs],
  )

  const clear = (): void => {
    onValueChange("")
    inner.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    // A Dialog's own Escape guard has already run (and prevented its close);
    // only a preventDefault from the SCREEN's handler means "mine, leave it".
    const before = e.defaultPrevented
    onKeyDown?.(e)
    const action = searchKeyAction({
      key: e.key,
      value,
      handledByScreen: !before && e.defaultPrevented,
      composing: e.nativeEvent.isComposing,
    })
    if (action === "clear") {
      e.preventDefault()
      e.stopPropagation()
      clear()
    }
  }

  const inputProps = {
    ...rest,
    [SEARCH_INPUT_ATTR]: "",
    type: "text",
    inputMode: "search" as const,
    enterKeyHint: "search" as const,
    autoComplete: "off",
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => { onValueChange(e.target.value) },
    onKeyDown: handleKeyDown,
  }

  const button = showSearchClear(value) ? (
    <button
      type="button"
      aria-label={clearLabel}
      title={clearLabel}
      // Keep the caret where it is: a mousedown on a button would take focus.
      onMouseDown={(e) => { e.preventDefault() }}
      onClick={clear}
      className={cn(
        bare ? "inline-flex h-10 w-10 shrink-0 items-center justify-center" : SEARCH_CLEAR_BUTTON_CLASS,
        clearClassName,
      )}
    >
      {clearIcon ?? <X aria-hidden className="h-4 w-4" />}
    </button>
  ) : null

  if (bare) {
    return (
      <div className={wrapperClassName} style={wrapperStyle}>
        {icon}
        <input ref={setRefs} className={className} {...inputProps} />
        {button}
      </div>
    )
  }

  return (
    <div className={cn("relative", wrapperClassName)} style={wrapperStyle}>
      {icon ?? (
        <Search
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
      )}
      <Input ref={setRefs} className={cn("pl-8 pr-10", className)} {...inputProps} />
      {button ? <span className="absolute inset-y-0 right-0 flex items-center">{button}</span> : null}
    </div>
  )
})
SearchInput.displayName = "SearchInput"
