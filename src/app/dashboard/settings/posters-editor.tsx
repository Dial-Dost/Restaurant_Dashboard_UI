"use client"

/**
 * Guest-menu POSTERS: the owner's library of promotional images, with a live
 * preview of where each one lands, a schedule, and delete.
 *
 * THREE THINGS THIS UI IS DELIBERATE ABOUT
 * ----------------------------------------
 * 1. "Showing now" is computed against the RESTAURANT's day, which the server
 *    sends as `today`, not against this browser's clock. An owner reviewing the
 *    menu from another country would otherwise be told a poster is live when
 *    their diners cannot see it (or the reverse), and the badge would be lying
 *    about the one thing it exists to say.
 * 2. The image is picked and sent in the SAME save as the metadata. There is no
 *    "upload now, describe later" step, so a file picked and then abandoned
 *    never becomes an orphaned object in the bucket.
 * 3. The refusals are the server's, repeated verbatim. The size/type rules live
 *    in the backend's posters.ts because that is where they are enforced; this
 *    form pre-checks the SIZE only, so the common mistake (a 12 MB camera photo)
 *    is caught before a megabyte crosses the wire, and everything else is
 *    answered by the same gate a scripted client would hit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import {
  createPoster,
  deletePoster,
  getPosters,
  updatePoster,
  type PosterLibrary,
  type PosterPlacement,
  type PosterRecord,
} from "@/lib/db"

// Mirrors the backend allowlist (posters.ts). Kept in sync by being SHORT and by
// the server refusing anything else — this list only shapes the file dialog.
const ACCEPT = "image/png,image/jpeg,image/webp"

/** The server's own predicate, restated for the badge. Both bounds inclusive,
 *  plain string compare — ISO day keys sort chronologically. */
function isShowing(p: PosterRecord, today: string): boolean {
  if (!p.active) {return false}
  if (!p.start_on && !p.end_on) {return true}
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {return false}
  if (p.start_on && p.start_on > today) {return false}
  if (p.end_on && p.end_on < today) {return false}
  return true
}

function scheduleLabel(p: PosterRecord, today: string): string {
  if (!p.active) {return "Paused"}
  if (!p.start_on && !p.end_on) {return "Always on"}
  if (p.start_on && p.end_on) {
    return p.start_on === p.end_on ? `On ${p.start_on}` : `${p.start_on} → ${p.end_on}`
  }
  if (p.start_on) {return `From ${p.start_on}`}
  if (p.end_on && p.end_on < today) {return `Ended ${p.end_on}`}
  return `Until ${p.end_on}`
}

const readFileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => { reject(new Error("Could not read that file.")) }
    reader.onload = () => {
      const out = String(reader.result ?? "")
      // FileReader gives a data URL; the API takes either form, but sending the
      // bare payload keeps the request smaller by the prefix.
      resolve(out.includes(",") ? (out.split(",").pop() ?? out) : out)
    }
    reader.readAsDataURL(file)
  })

/** One poster in the library: preview, schedule, placement, pause, delete. */
function PosterRow({
  poster,
  today,
  placements,
  disabled,
  onPatch,
  onDelete,
}: {
  poster: PosterRecord
  today: string
  placements: PosterLibrary["placements"]
  disabled: boolean
  onPatch: (patch: Parameters<typeof updatePoster>[2]) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const showing = isShowing(poster, today)
  // Reserve the preview's box from the stored intrinsic size so the list does
  // not jump as thumbnails load. 16:9 is the fallback when the encoder could not
  // report a size (width/height are 0 on rows written before it could).
  const ratio = poster.width > 0 && poster.height > 0 ? `${poster.width} / ${poster.height}` : "16 / 9"

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row">
      <div className="w-full shrink-0 sm:w-44">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={poster.image_url}
          alt={poster.title || "Poster"}
          style={{ aspectRatio: ratio }}
          className={cn(
            "w-full rounded-md border bg-muted object-cover",
            !showing && "opacity-50 grayscale",
          )}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              showing ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                : "bg-muted text-muted-foreground",
            )}
          >
            {showing ? "Showing now" : "Not showing"}
          </span>
          <span className="text-xs text-muted-foreground">{scheduleLabel(poster, today)}</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Caption (also the image's alt text)</Label>
            <Input
              defaultValue={poster.title}
              maxLength={80}
              disabled={disabled}
              placeholder="Sunday brunch, 11–3"
              // Saved on blur rather than per keystroke: this is one PATCH per
              // edit, not one per character.
              onBlur={(e) => {
                const next = e.target.value.trim()
                if (next !== poster.title) {void onPatch({ title: next })}
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Where it shows</Label>
            <Select
              value={poster.placement}
              disabled={disabled}
              onValueChange={(v) => { void onPatch({ placement: v as PosterPlacement }) }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {placements.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Starts (optional)</Label>
            <Input
              type="date"
              defaultValue={poster.start_on ?? ""}
              disabled={disabled}
              // An empty date CLEARS the bound: the API takes null for exactly
              // this, and without it an owner could set a start date and never
              // take it off again.
              //
              // onChange rather than onBlur because a native date picker sets the
              // value without moving focus, so a blur handler would miss the one
              // gesture this control exists for. The no-op guard is what keeps
              // that cheap: typing a date by keyboard fires intermediate empty
              // values, and each of those would otherwise be a PATCH.
              onChange={(e) => {
                const next = e.target.value || null
                if (next !== poster.start_on) {void onPatch({ start_on: next })}
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Ends (optional, inclusive)</Label>
            <Input
              type="date"
              defaultValue={poster.end_on ?? ""}
              disabled={disabled}
              onChange={(e) => {
                const next = e.target.value || null
                if (next !== poster.end_on) {void onPatch({ end_on: next })}
              }}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id={`poster-active-${poster.id}`}
                checked={poster.active}
                disabled={disabled}
                onCheckedChange={(v) => { void onPatch({ active: v }) }}
              />
              <Label htmlFor={`poster-active-${poster.id}`} className="text-sm">Live</Label>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor={`poster-order-${poster.id}`} className="text-sm">Order</Label>
              <Input
                id={`poster-order-${poster.id}`}
                type="number"
                min={0}
                max={999}
                className="w-20"
                defaultValue={poster.sort_order}
                disabled={disabled}
                onBlur={(e) => {
                  const next = Number(e.target.value)
                  if (Number.isFinite(next) && next !== poster.sort_order) {void onPatch({ sort_order: next })}
                }}
              />
            </div>
          </div>

          {confirming ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Delete this poster?</span>
              <Button type="button" variant="destructive" size="sm" disabled={disabled} onClick={() => { void onDelete() }}>
                Delete
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => { setConfirming(false) }}>Cancel</Button>
            </div>
          ) : (
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => { setConfirming(true) }}>
              Delete
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export function PostersEditor(props: { restaurantId: string; isAdmin: boolean }) {
  const { restaurantId, isAdmin } = props
  const { toast } = useToast()

  const [library, setLibrary] = useState<PosterLibrary | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(async () => {
    const next = await getPosters(restaurantId)
    setLibrary(next)
  }, [restaurantId])

  useEffect(() => {
    let active = true
    void getPosters(restaurantId).then((lib) => {
      if (active) { setLibrary(lib); setLoading(false) }
    })
    return () => { active = false }
  }, [restaurantId])

  const posters = library?.posters ?? []
  const today = library?.today ?? ""
  const placements = library?.placements ?? []
  const showingCount = useMemo(
    () => posters.filter((p) => isShowing(p, today)).length,
    [posters, today],
  )
  const full = library ? posters.length >= library.max_posters : false

  const onPick = async (file: File | null) => {
    if (!file || !library) {return}
    // The SIZE pre-check is here so a 12 MB photo never leaves the laptop; the
    // TYPE check is deliberately left to the server, which validates the bytes
    // and not just the name.
    if (file.size > library.max_upload_bytes) {
      const mb = (file.size / (1024 * 1024)).toFixed(1)
      const cap = (library.max_upload_bytes / (1024 * 1024)).toFixed(0)
      toast({
        title: "That image is too large",
        description: `${file.name} is ${mb} MB. Posters must be under ${cap} MB — try exporting it smaller.`,
        variant: "destructive",
      })
      return
    }
    setBusy(true)
    try {
      const image_base64 = await readFileAsBase64(file)
      await createPoster(restaurantId, {
        image_base64,
        content_type: file.type || "image/png",
        // A new poster starts LIVE, unscheduled and in the menu slot: the owner
        // just picked a promo they want up, so the zero-click outcome is the one
        // they meant. Everything is editable on the row below.
        placement: "menu",
        sort_order: posters.length,
        active: true,
      })
      await reload()
      toast({ title: "Poster added", description: "It's live on your guest menu now." })
    } catch (error: unknown) {
      toast({
        title: "Couldn't add that poster",
        description: error instanceof Error ? error.message : "Unable to save poster.",
        variant: "destructive",
      })
    } finally {
      setBusy(false)
      if (fileRef.current) {fileRef.current.value = ""}
    }
  }

  const onPatch = async (id: string, patch: Parameters<typeof updatePoster>[2]) => {
    setBusy(true)
    try {
      await updatePoster(restaurantId, id, patch)
      await reload()
    } catch (error: unknown) {
      // Reload on failure too: the row is showing an optimistic control state
      // (a flipped switch, a typed date) that the server refused, and leaving it
      // there would tell the owner a lie about what their guests see.
      await reload()
      toast({
        title: "Couldn't save that change",
        description: error instanceof Error ? error.message : "Unable to save poster.",
        variant: "destructive",
      })
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async (id: string) => {
    setBusy(true)
    try {
      await deletePoster(restaurantId, id)
      await reload()
      toast({ title: "Poster deleted", description: "It's off your guest menu." })
    } catch (error: unknown) {
      toast({
        title: "Couldn't delete that poster",
        description: error instanceof Error ? error.message : "Unable to delete poster.",
        variant: "destructive",
      })
    } finally {
      setBusy(false)
    }
  }

  if (!isAdmin) {return null}

  return (
    <Card>
      <CardHeader>
        <CardTitle>Guest menu posters</CardTitle>
        <CardDescription>
          Promotional images shown with your menu on the QR ordering page and the walk-in queue page.
          {library?.timezone ? ` Dates follow your restaurant's clock (${library.timezone}).` : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => { void onPick(e.target.files?.[0] ?? null) }}
          />
          <Button
            type="button"
            disabled={busy || loading || full}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? "Working…" : "Add poster"}
          </Button>
          <p className="text-sm text-muted-foreground">
            {loading
              ? "Loading…"
              : full
                ? `You've reached the limit of ${String(library?.max_posters ?? 0)} posters. Delete one to add another.`
                : posters.length === 0
                  ? "No posters yet — your menu looks exactly as it does today."
                  : `${String(showingCount)} of ${String(posters.length)} showing right now.`}
          </p>
        </div>

        {posters.length > 0 ? (
          <div className="space-y-3">
            {posters.map((p) => (
              <PosterRow
                key={p.id}
                poster={p}
                today={today}
                placements={placements}
                disabled={busy}
                onPatch={(patch) => onPatch(p.id, patch)}
                onDelete={() => onDelete(p.id)}
              />
            ))}
          </div>
        ) : null}

        {placements.length > 0 && posters.length > 0 ? (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
            {placements.map((p) => (
              <p key={p.value}><span className="font-medium text-foreground">{p.label}:</span> {p.hint}</p>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
