"use client"

// BRANDING group — Flutter `_BrandingCard` (modules.dart 34211–34333: logo
// upload + theme colour) and `_FeedbackSettingsCard` (32260–32445: the full
// feedback-form editor with a changed-keys-only save).

import * as React from "react"
import { Check, Plus, Store, Trash2, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { errorText, postBranding, postSettings, scalarText, type SettingsDoc } from "@/lib/api/settings"
import { cn } from "@/lib/utils"

import { SaveButton } from "./razorpay-messaging-cards"
import { FieldLabel, SettingsCard } from "./settings-card"

/* ── Customer ordering page branding ────────────────────────────────── */

const SWATCHES = ["#EA580C", "#DC2626", "#D97706", "#16A34A", "#0D9488", "#2563EB", "#7C3AED", "#DB2777", "#111827"]

const readBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const s = typeof r.result === "string" ? r.result : ""
      resolve(s.slice(s.indexOf(",") + 1))
    }
    r.onerror = () => { reject(new Error("Could not read the file.")) }
    r.readAsDataURL(file)
  })

export function BrandingLogoCard({ rid, initialLogo, initialColor, onSaved }: {
  rid: string; initialLogo: string; initialColor: string; onSaved: () => void
}): React.JSX.Element {
  const { toast } = useToast()
  const hex = initialColor.replace("#", "")
  const [color, setColor] = React.useState(/^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex.toUpperCase()}` : SWATCHES[0])
  const [logo, setLogo] = React.useState(initialLogo)
  const [busy, setBusy] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)

  const post = (body: SettingsDoc): void => {
    setBusy(true)
    void postBranding(rid, body)
      .then((res) => {
        if (res && typeof res.logo_url === "string") {setLogo(res.logo_url)}
        toast({ description: "Branding saved." })
        onSaved()
      })
      .catch((e: unknown) => { toast({ variant: "destructive", description: errorText(e) }) })
      .finally(() => { setBusy(false) })
  }

  const upload = (file: File | undefined): void => {
    if (!file) {return}
    const png = file.type === "image/png" || file.name.toLowerCase().endsWith(".png")
    readBase64(file)
      .then((b64) => { post({ logo_base64: b64, content_type: png ? "image/png" : "image/jpeg" }) })
      .catch((e: unknown) => { toast({ variant: "destructive", description: errorText(e) }) })
  }

  return (
    <SettingsCard title="Customer ordering page branding" caption="Logo + colour shown to guests on the QR ordering & reservation pages.">
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-inset">
          {logo ? (
            <img src={logo} alt="Restaurant logo" className="h-full w-full object-cover" />
          ) : (
            <Store className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden"
          onChange={(e) => { upload(e.target.files?.[0]); e.target.value = "" }} />
        <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload className="h-3.5 w-3.5" /> {logo ? "Change logo" : "Upload logo"}
        </Button>
      </div>
      <div className="space-y-2">
        <FieldLabel>Theme colour</FieldLabel>
        <div className="flex flex-wrap gap-2.5">
          {SWATCHES.map((c) => {
            const on = c === color
            return (
              <button key={c} type="button" aria-label={`Theme colour ${c}`} aria-pressed={on} disabled={busy}
                onClick={() => { setColor(c) }}
                className={cn("flex h-9 w-9 items-center justify-center rounded-full border-[3px]", on ? "border-foreground" : "border-transparent")}
                style={{ backgroundColor: c }}>
                {on ? <Check className="h-[18px] w-[18px] text-white" /> : null}
              </button>
            )
          })}
        </div>
      </div>
      <SaveButton busy={busy} label="Save theme colour" onClick={() => { post({ theme_color: color.toLowerCase() }) }} />
    </SettingsCard>
  )
}

/* ── Customer feedback form ─────────────────────────────────────────── */

const DEFAULT_CATEGORIES = ["Initial Greeting", "Waiter Service", "Food Quality", "Ambience", "Restroom", "Valet Parking"]

interface FeedbackForm {
  title: string
  subtitle: string
  review_url: string
  valet_enabled: boolean
  require_image: boolean
  categories: { label: string; key: string }[]
}

const catKey = (label: string): string =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")

/** Flutter `feedbackSettingsChanges`: only the keys that differ from the seed. */
const feedbackChanges = (base: FeedbackForm, cur: FeedbackForm): SettingsDoc => {
  const out: SettingsDoc = {}
  for (const k of ["title", "subtitle", "review_url", "valet_enabled", "require_image"] as const) {
    if (base[k] !== cur[k]) {out[k] = cur[k]}
  }
  const same = base.categories.length === cur.categories.length
    && base.categories.every((c, i) => c.label === cur.categories[i]?.label)
  if (!same) {out.categories = cur.categories}
  return out
}

interface CatRow { id: number; label: string }

export function FeedbackFormCard({ rid, initial }: { rid: string; initial: SettingsDoc }): React.JSX.Element {
  const { toast } = useToast()
  const s = (k: string, f = ""): string => scalarText(initial[k], f)
  const nextId = React.useRef(0)
  const [title, setTitle] = React.useState(s("title", "Restaurant Feedback"))
  const [subtitle, setSubtitle] = React.useState(s("subtitle"))
  const [reviewUrl, setReviewUrl] = React.useState(s("review_url"))
  const [valet, setValet] = React.useState(initial.valet_enabled === true)
  const [requireImage, setRequireImage] = React.useState(initial.require_image === true)
  const [cats, setCats] = React.useState<CatRow[]>(() => {
    const raw = Array.isArray(initial.categories) ? initial.categories : []
    const labels = raw.length === 0
      ? DEFAULT_CATEGORIES
      : raw.map((c) => (c && typeof c === "object" ? scalarText((c as SettingsDoc).label) : "")).filter((l) => l)
    return labels.map((label) => ({ id: nextId.current++, label }))
  })
  const [saving, setSaving] = React.useState(false)

  const current = (): FeedbackForm => ({
    title: title.trim(),
    subtitle: subtitle.trim(),
    valet_enabled: valet,
    require_image: requireImage,
    review_url: reviewUrl.trim(),
    categories: cats.map((c) => c.label.trim()).filter((l) => l).map((label) => ({ label, key: catKey(label) })),
  })
  const [baseline, setBaseline] = React.useState<FeedbackForm>(current)

  const save = (): void => {
    const cur = current()
    const changes = feedbackChanges(baseline, cur)
    if (Object.keys(changes).length === 0) {
      toast({ description: "Nothing to save — the feedback form is unchanged." })
      return
    }
    setSaving(true)
    void postSettings(rid, { feedback_config: changes })
      .then(() => { setBaseline(cur); toast({ description: "Feedback form saved." }) })
      .catch((e: unknown) => { toast({ variant: "destructive", description: errorText(e) }) })
      .finally(() => { setSaving(false) })
  }

  const field = (id: string, label: string, value: string, set: (v: string) => void, extra?: { placeholder?: string; type?: string }): React.JSX.Element => (
    <div className="space-y-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} value={value} disabled={saving} placeholder={extra?.placeholder} type={extra?.type}
        onChange={(e) => { set(e.target.value) }} />
    </div>
  )

  const switchRow = (id: string, label: string, hint: string, on: boolean, set: (v: boolean) => void): React.JSX.Element => (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={on} disabled={saving} onCheckedChange={set} aria-label={label} />
    </div>
  )

  return (
    <SettingsCard
      title="Customer feedback form"
      caption="Configure the QR feedback form: title, valet parking, rating categories, a review link for happy guests, and whether a photo is required. It is themed with your branding."
    >
      {field("fb-title", "Form title", title, setTitle)}
      {field("fb-subtitle", "Welcome text", subtitle, setSubtitle)}
      {field("fb-review", "Review link for happy guests (Google/TripAdvisor)", reviewUrl, setReviewUrl, { placeholder: "https://…", type: "url" })}
      {switchRow("fb-valet", "Valet parking", "Ask guests for their vehicle number and to rate valet parking. Off hides both.", valet, setValet)}
      {switchRow("fb-photo", "Require a photo", "Force guests to upload an image (off = optional)", requireImage, setRequireImage)}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <FieldLabel>Rating categories</FieldLabel>
          <Button type="button" variant="ghost" size="sm" className="gap-1" disabled={saving}
            onClick={() => { setCats((cs) => [...cs, { id: nextId.current++, label: "" }]) }}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
        {cats.map((c) => (
          <div key={c.id} className="flex items-center gap-2">
            <Input aria-label="Rating category" value={c.label} disabled={saving} className="min-w-0 flex-1"
              onChange={(e) => { const v = e.target.value; setCats((cs) => cs.map((x) => (x.id === c.id ? { ...x, label: v } : x))) }} />
            <Button type="button" variant="ghost" size="icon" title="Remove category" aria-label="Remove category" disabled={saving}
              onClick={() => { setCats((cs) => cs.filter((x) => x.id !== c.id)) }}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <SaveButton busy={saving} label="Save feedback form" onClick={save} />
    </SettingsCard>
  )
}
