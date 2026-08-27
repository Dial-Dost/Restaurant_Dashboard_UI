"use client"

// THE date-range control. One component, mounted on every reporting surface:
// Analytics, Accounting, History, Cash. Not one picker per page — the point of
// the exercise is that the window means the same thing wherever you read it, and
// four pickers built four times would drift apart the way the four ad-hoc date
// filters this replaces already had.
//
// WHAT IT HAS TO DO, AND WHY EACH PART IS THERE
// ---------------------------------------------
//  * PRESETS FIRST. "Today" and "Last 7 days" are what an owner opens the app
//    for; those are one tap, on the left where the eye lands, not buried behind
//    a calendar they would have to count squares on every morning.
//  * A REAL CALENDAR for everything else, because "1–15 August" is a question
//    nothing but a calendar answers comfortably.
//  * THE CHOSEN RANGE IS ON THE TRIGGER, ALWAYS. The button is the chip: it reads
//    "Last 7 days · 22–28 Aug" whether the popover is open or shut. A filtered
//    money figure sitting next to a control that does not say what it filtered to
//    is how an owner reads a fortnight's takings as the month's.
//
// SELECTING A SPAN: BOTH GESTURES, ONE CODE PATH
// ----------------------------------------------
// Pointer users can PRESS AND DRAG across the grid — pointerdown on the 1st,
// sweep to the 15th, release. They can equally CLICK the 1st, move, and click the
// 15th, with the span previewing under the cursor the whole way.
//
// Touch gets tap-start / tap-end, deliberately. A finger drag inside a scrollable
// popover is ambiguous — the browser cannot know whether the gesture is "select
// these days" or "scroll this sheet", and it resolves that by capturing the touch
// to the element it started on, so `mouseenter` never fires for the cells the
// finger passes over. Fighting that with touch-action:none would break scrolling
// the popover on a 320dp phone, which is worse than the thing it buys. Two taps
// are unambiguous, reachable one-handed, and reuse exactly the same anchor state
// the pointer path uses — so the two gestures cannot diverge in behaviour.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CalendarRange, Check } from "lucide-react"
import type { DateRange as PickerRange } from "react-day-picker"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import {
  RANGE_PRESETS,
  dayKeyOfPickedDate,
  normalizeRange,
  pickedDateOfDayKey,
  pickerToday,
  presetLabel,
  rangeDays,
  rangeLabel,
  rangeTooltip,
  resolvePreset,
  type DateRange,
  type RangePreset,
} from "@/lib/date-range"

interface Props {
  value: DateRange
  onChange: (range: DateRange) => void
  /** The restaurant's IANA zone — every day in this control is one of its days. */
  timezone: string
  /** Popover alignment; toolbars on the right want "end". */
  align?: "start" | "center" | "end"
  className?: string
  /** Disabled while a screen has no restaurant yet (pre-login render). */
  disabled?: boolean
}

export function DateRangePicker({ value, onChange, timezone, align = "end", className, disabled }: Props) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)

  // The half-finished selection. `anchor` is the first end the user named; while
  // it is set, `hover` previews where the other end would land. Kept out of
  // `value` so a partial drag never reaches the screens behind the popover and
  // makes them refetch a one-day window mid-gesture.
  const [anchor, setAnchor] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  // The hovered day ALSO lives in a ref, and the pointer handlers read the ref
  // rather than the state. They have to: `pointerdown` can arrive in the same
  // event burst as the `mouseenter` that set the hover, before React has
  // re-rendered, so a handler closing over the state variable would still see
  // the PREVIOUS day — or null on the very first press, which silently killed
  // the whole drag gesture. The state copy exists only to paint the preview.
  const hoverRef = useRef<string | null>(null)
  const setHovered = useCallback((key: string | null) => {
    hoverRef.current = key
    setHover(key)
  }, [])
  // Drag bookkeeping. `movedOff` distinguishes a press-and-sweep (commit on
  // release) from a plain click (which must fall through to the two-click path,
  // or a single click would select a one-day range and end the interaction).
  const drag = useRef<{ from: string; movedOff: boolean } | null>(null)

  const resetDraft = useCallback(() => {
    setAnchor(null)
    setHovered(null)
    drag.current = null
  }, [setHovered])

  useEffect(() => { if (!open) {resetDraft()} }, [open, resetDraft])

  const commit = useCallback((a: string, b: string) => {
    onChange(normalizeRange({ from: a, to: b, preset: "custom" }, timezone))
    resetDraft()
    setOpen(false)
  }, [onChange, timezone, resetDraft])

  const choosePreset = useCallback((preset: RangePreset) => {
    onChange(resolvePreset(preset, timezone))
    resetDraft()
    setOpen(false)
  }, [onChange, timezone, resetDraft])

  // What the grid paints. Mid-selection it shows the draft so the sweep is
  // visible; otherwise it shows the committed window.
  const shown: PickerRange | undefined = useMemo(() => {
    if (anchor) {
      const other = hover ?? anchor
      const [a, b] = anchor <= other ? [anchor, other] : [other, anchor]
      return { from: pickedDateOfDayKey(a), to: pickedDateOfDayKey(b) }
    }
    const from = pickedDateOfDayKey(value.from)
    const to = pickedDateOfDayKey(value.to)
    return from ? { from, to } : undefined
  }, [anchor, hover, value.from, value.to])

  const onDayClick = useCallback((date: Date) => {
    const key = dayKeyOfPickedDate(date)
    if (!key) {return}
    if (!anchor) {
      setAnchor(key)
      setHovered(key)
      return
    }
    commit(anchor, key)
  }, [anchor, commit, setHovered])

  const onDayMouseEnter = useCallback((date: Date) => {
    const key = dayKeyOfPickedDate(date)
    if (!key) {return}
    setHovered(key)
    // A press that has reached a different cell is a drag, not a click.
    if (drag.current && key !== drag.current.from) {
      drag.current.movedOff = true
      // Adopt the pressed cell as the anchor so the sweep previews from it even
      // when the press never went through the click path.
      setAnchor((current) => current ?? drag.current?.from ?? null)
    }
  }, [setHovered])

  // react-day-picker exposes no onDayPointerDown, so the press is caught on the
  // grid wrapper and paired with the cell `onDayMouseEnter` last reported. That
  // is the cell under the pointer by definition — enter fires before down.
  const onPointerDown = useCallback(() => {
    const from = hoverRef.current
    if (from) {drag.current = { from, movedOff: false }}
  }, [])

  const onPointerUp = useCallback(() => {
    const d = drag.current
    drag.current = null
    const to = hoverRef.current
    // A cross-cell drag fires no `click` (press and release landed on different
    // elements), so this is the only chance to commit it. A same-cell release
    // does fire a click, and onDayClick handles it — committing here too would
    // collapse every first click into a one-day range.
    if (d?.movedOff && to && to !== d.from) {commit(d.from, to)}
  }, [commit])

  const days = rangeDays(value)
  const label = rangeLabel(value, timezone)
  const tooltip = rangeTooltip(value, timezone)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          title={tooltip}
          aria-label={tooltip}
          className={cn("h-9 gap-2 font-normal", className)}
        >
          <CalendarRange className="h-4 w-4 shrink-0 text-muted-foreground" />
          {/* The preset name is the nicety; the dates are the fact. On a narrow
              screen the nicety is what gets dropped. */}
          <span className="hidden text-muted-foreground sm:inline">{presetLabel(value.preset)}</span>
          <span className="hidden text-muted-foreground sm:inline">·</span>
          <span className="font-medium">{label}</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent align={align} className="w-auto max-w-[min(92vw,44rem)] p-0">
        <div className="flex flex-col sm:flex-row">
          {/* Presets. A wrapping row above the grid on a phone (where a column
              would eat the width the calendar needs), a column beside it on a
              desktop. */}
          <div className="flex flex-wrap gap-1 border-b p-2 sm:w-40 sm:flex-col sm:flex-nowrap sm:border-b-0 sm:border-r sm:p-2">
            {RANGE_PRESETS.map((p) => {
              const active = value.preset === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { choosePreset(p.id) }}
                  aria-pressed={active}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition",
                    active ? "bg-primary text-primary-foreground" : "hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <span className="whitespace-nowrap">{p.label}</span>
                  {active && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              )
            })}
          </div>

          <div className="min-w-0">
            <div
              // Pointer handlers live on the wrapper, not on the day cells, so a
              // release outside the grid still ends the drag instead of leaving
              // it armed for the next click.
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              onPointerLeave={() => { drag.current = null }}
            >
              <Calendar
                mode="range"
                selected={shown}
                // Selection is driven entirely by the day handlers below (they
                // are what make press-and-drag work); react-day-picker's own
                // range state would fight them for the anchor.
                onDayClick={onDayClick}
                onDayMouseEnter={onDayMouseEnter}
                defaultMonth={pickedDateOfDayKey(value.from)}
                today={pickerToday(timezone)}
                // There is no trade tomorrow. Greying the future is kinder than
                // accepting the click and returning a screen of zeros.
                disabled={{ after: pickerToday(timezone) ?? new Date() }}
                numberOfMonths={isMobile ? 1 : 2}
                showOutsideDays={false}
                className="p-2"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
              <span>
                {anchor
                  ? "Now pick the other end — or drag across the days."
                  : `${label} · ${days} day${days === 1 ? "" : "s"}`}
              </span>
              {anchor && (
                <button
                  type="button"
                  onClick={resetDraft}
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  Start over
                </button>
              )}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * The always-visible statement of what a figure was cut on, for use INSIDE a
 * card — under a heading, beside a total, in a chart caption.
 *
 * The picker's trigger already says it once at the top of the page, but a long
 * reporting screen scrolls the toolbar away, and a number without its window is
 * exactly the misreading this feature exists to prevent. Cheap enough to put on
 * every money section, so it is.
 */
export function RangeNote({
  range,
  timezone,
  prefix = "Showing",
  className,
}: {
  range: DateRange
  timezone: string
  prefix?: string
  className?: string
}) {
  return (
    <span
      title={rangeTooltip(range, timezone)}
      className={cn("whitespace-nowrap text-xs text-muted-foreground", className)}
    >
      {prefix} {rangeLabel(range, timezone)}
    </span>
  )
}
