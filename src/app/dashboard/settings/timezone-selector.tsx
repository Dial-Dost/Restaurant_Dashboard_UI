"use client"

// The restaurant's timezone — the single setting that decides how every instant
// in the dashboard is rendered and, for tally, where one business day ends and
// the next begins. It was already stored and already used for PARSING booking
// wall-clock times; there was simply no way to see or change it.
//
// Deliberately a pick-then-save control rather than a save-on-select one (the
// OTP switch next door saves immediately). Changing the zone silently rewrites
// the labels on every historical timestamp and can move a night's covers onto a
// different accounting day, so a stray click in a 419-entry list should not be
// able to commit it.

import { useEffect, useMemo, useState } from "react"
import { Check, ChevronsUpDown, Globe } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useToast } from "@/hooks/use-toast"
import { getTimezoneOptions, setRestaurantTimezone } from "@/lib/db"
import { cn } from "@/lib/utils"
import {
  DEFAULT_TIMEZONE,
  formatFullDateTime,
  timezoneAbbreviation,
  timezoneOffsetMinutes,
  timezoneOptionLabel,
} from "@/lib/tz"
import { useTimezone } from "@/lib/use-timezone"

// The full IANA list is ~419 entries. cmdk's own filter scores every child, and
// mounting 419 items just to show 8 is wasteful on every keystroke — so filter
// here (shouldFilter={false}) and render only what matches.
const MAX_VISIBLE = 60

export function TimezoneSelector({ restaurantId, isAdmin }: { restaurantId: string; isAdmin: boolean }) {
  const { toast } = useToast()
  const { timezone: activeTimezone, setTimezone: setActiveTimezone } = useTimezone()

  const [zones, setZones] = useState<string[]>([])
  const [pending, setPending] = useState<string>("")
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [saving, setSaving] = useState(false)
  // Ticks once a second so the preview clock below the picker actually moves —
  // a static time reads as a formatting sample rather than "this is the time at
  // your restaurant right now", which is the whole point of showing it.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(id) }
  }, [])

  useEffect(() => {
    if (!restaurantId) {return}
    let active = true
    getTimezoneOptions(restaurantId)
      .then((opts) => {
        if (!active) {return}
        setZones(opts.timezones)
        // Prefer the server's notion of what's in force; the provider's value is
        // the same read, but this endpoint is the authority for this control.
        if (opts.current) {setPending(opts.current)}
      })
      .catch(() => {/* picker stays empty; the active zone is still displayed */})
    return () => { active = false }
  }, [restaurantId])

  // Until the list loads, still offer the zone actually in force so the control
  // is never blank.
  useEffect(() => {
    setPending((p) => p || activeTimezone)
  }, [activeTimezone])

  // Sorted west-to-east, which is how people scan a timezone list, with the
  // label carrying the offset so "Asia/Kolkata" is identifiable without knowing
  // it is +05:30.
  const options = useMemo(() => {
    const list = zones.length > 0 ? zones : [activeTimezone || DEFAULT_TIMEZONE]
    return list
      .map((tz) => ({ tz, label: timezoneOptionLabel(tz), offset: timezoneOffsetMinutes(tz) }))
      .sort((a, b) => a.offset - b.offset || a.tz.localeCompare(b.tz))
  }, [zones, activeTimezone])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) {return options.slice(0, MAX_VISIBLE)}
    // Match on the id AND the offset label, so both "kolkata" and "+05:30" work.
    return options.filter((o) => o.label.toLowerCase().includes(q)).slice(0, MAX_VISIBLE)
  }, [options, search])

  const dirty = Boolean(pending) && pending !== activeTimezone

  const handleSave = async () => {
    if (!restaurantId || !pending) {return}
    if (!isAdmin) {
      toast({
        title: "Access denied",
        description: "You do not have the required role for this action. Required role: admin.",
        variant: "destructive",
      })
      return
    }
    setSaving(true)
    try {
      // The backend 400s an id Intl won't accept rather than coercing it, so a
      // rejection here is a real error worth surfacing verbatim.
      const saved = await setRestaurantTimezone(restaurantId, pending)
      setActiveTimezone(saved)
      setPending(saved)
      toast({
        title: "Timezone updated",
        description: `Timestamps across the dashboard now display in ${saved}.`,
      })
    } catch (error: any) {
      toast({
        title: "Couldn't save timezone",
        description: error?.message ?? "Unable to update the restaurant timezone.",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const previewZone = pending || activeTimezone

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          Timezone
        </CardTitle>
        <CardDescription>
          The zone every timestamp in the dashboard is shown in, and the zone a business
          day starts and ends in for reports and tally.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border p-4 space-y-1">
          <p className="text-sm text-muted-foreground">Currently in force</p>
          <p className="text-sm font-medium">
            {activeTimezone}{" "}
            <span className="text-muted-foreground">({timezoneAbbreviation(activeTimezone, now)})</span>
          </p>
          <p className="text-2xl font-semibold tabular-nums">
            {formatFullDateTime(now, activeTimezone)}
          </p>
          <p className="text-xs text-muted-foreground">Local time at your restaurant right now.</p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Change timezone</p>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={open}
                aria-label="Select restaurant timezone"
                disabled={!isAdmin}
                className="w-full justify-between font-normal"
              >
                {previewZone ? timezoneOptionLabel(previewZone) : "Select a timezone"}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder="Search city or offset, e.g. Kolkata or +05:30"
                  value={search}
                  onValueChange={setSearch}
                />
                <CommandList>
                  <CommandEmpty>No matching timezone.</CommandEmpty>
                  <CommandGroup>
                    {filtered.map((o) => (
                      <CommandItem
                        key={o.tz}
                        value={o.tz}
                        onSelect={() => {
                          setPending(o.tz)
                          setOpen(false)
                          setSearch("")
                        }}
                      >
                        <Check className={cn("mr-2 h-4 w-4", pending === o.tz ? "opacity-100" : "opacity-0")} />
                        {o.label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          {dirty ? (
            <p className="text-xs text-muted-foreground">
              Preview in {pending}: <span className="font-medium">{formatFullDateTime(now, pending)}</span>
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <Button type="button" onClick={handleSave} disabled={!isAdmin || !dirty || saving}>
            {saving ? "Saving..." : "Save timezone"}
          </Button>
          {dirty ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => { setPending(activeTimezone) }}
              disabled={saving}
            >
              Cancel
            </Button>
          ) : null}
        </div>

        {!isAdmin ? (
          <p className="text-xs text-muted-foreground">Only an admin can change the restaurant timezone.</p>
        ) : null}
      </CardContent>
    </Card>
  )
}
