"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { getBrandConfig, saveBrandConfig } from "@/lib/db"
import { BRAND_FONTS, fontStack, loadBrandFont, loadDesignFonts } from "@/lib/brand-fonts"
import {
  DEFAULT_ACCENT,
  GUEST_CSS,
  SHELL,
  guestThemeVars,
  resolveGuestTheme,
  type GuestBrandConfig,
  type GuestTheme,
} from "@/lib/guest-theme"

const isHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v.trim())

type HeaderStyle = "gradient" | "solid"
type ButtonShape = "rounded" | "pill" | "square"
type SurfaceStyle = "frosted" | "solid" | "tinted"

// The five keys the new guest design actually renders. The backend advertises the
// same split via GET /restaurant/settings → brand_fields.live; these are only the
// client-side fallback for an older backend that doesn't send it.
const LIVE_FIELDS = ["color_primary", "font", "header_style", "button_shape", "surface_style"] as const
// Retired keys: still stored and returned by the API for tenants who set them
// once, but the dark guest design derives every surface from the accent, so they
// no longer paint anything. Shown as a quiet note instead of a dead control.
const LEGACY_FIELDS = ["color_secondary", "color_bg", "color_text", "color_card"] as const
const LEGACY_LABELS: Record<string, string> = {
  color_secondary: "Secondary colour",
  color_bg: "Page background",
  color_text: "Body text colour",
  color_card: "Card surface",
}

const HEADER_OPTIONS: { value: HeaderStyle; label: string; hint: string }[] = [
  { value: "gradient", label: "Gradient", hint: "accent fading into near-black" },
  { value: "solid", label: "Solid", hint: "a flat accent block" },
]
const SHAPE_OPTIONS: { value: ButtonShape; label: string; hint: string }[] = [
  { value: "rounded", label: "Rounded", hint: "13px — the default" },
  { value: "pill", label: "Pill", hint: "fully rounded ends" },
  { value: "square", label: "Square", hint: "4px, near-sharp" },
]
const SURFACE_OPTIONS: { value: SurfaceStyle; label: string; hint: string }[] = [
  { value: "frosted", label: "Frosted", hint: "blurred glass — the default" },
  { value: "solid", label: "Solid", hint: "opaque dark panels, no blur" },
  { value: "tinted", label: "Tinted", hint: "accent-tinted glass" },
]

interface BrandForm {
  color_primary: string
  font: string
  header_style: HeaderStyle
  button_shape: ButtonShape
  surface_style: SurfaceStyle
}

// Resolved defaults = exactly the shipped guest look, so "reset" lands on the
// design as delivered (keeping the tenant's own accent).
const defaultForm = (accent: string): BrandForm => ({
  color_primary: accent,
  font: "Inter",
  header_style: "gradient",
  button_shape: "rounded",
  surface_style: "frosted",
})

// One accent stop of the derived ramp, with its resolved hex underneath.
function Swatch({ name, hex, note }: { name: string; hex: string; note: string }) {
  return (
    <div className="min-w-0" title={`${name} — ${note}`}>
      <div className="h-7 w-full rounded-md border border-black/10 shadow-inner dark:border-white/10" style={{ backgroundColor: hex }} />
      <p className="mt-1 truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{name}</p>
      <p className="truncate font-mono text-[10px] uppercase text-muted-foreground/80">{hex}</p>
    </div>
  )
}

function Segmented<T extends string>(props: {
  value: T
  options: { value: T; label: string; hint?: string }[]
  disabled?: boolean
  onChange: (v: T) => void
}) {
  const { value, options, disabled, onChange } = props
  return (
    <div className="inline-flex rounded-lg border bg-muted/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          title={o.hint}
          onClick={() => { onChange(o.value); }}
          aria-pressed={value === o.value}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium capitalize transition disabled:cursor-not-allowed disabled:opacity-50",
            value === o.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// A Material Symbols glyph — same mechanism (and font) the guest pages use, so
// the preview's icons are the real ones.
function Icon({ name, style }: { name: string; style?: React.CSSProperties }) {
  return <span className="ms" style={style} aria-hidden="true">{name}</span>
}

// ---------------------------------------------------------------------------
// LIVE PREVIEW — a scaled-down slice of the real guest order page: near-black
// shell, two floating accent orbs, the hero wash, the frosted dish cards and the
// floating total bar. It is styled ONLY from guestThemeVars(), i.e. the exact
// same CSS custom properties the guest surfaces consume, so anything that moves
// here moves there.
function GuestPreview({ theme, font, restaurantName }: { theme: GuestTheme; font: string; restaurantName: string }) {
  const bodyFont = font ? fontStack(font) : "Roboto, system-ui, sans-serif"
  const dishes = [
    { name: "Slow-roasted carrots", price: 429 },
    { name: "Sticky toffee pudding", price: 380 },
  ]

  const panel: React.CSSProperties = {
    borderRadius: "var(--rCard)",
    background: "var(--panelBg)",
    backdropFilter: "blur(var(--blur))",
    WebkitBackdropFilter: "blur(var(--blur))",
    border: "1.5px solid rgba(255,255,255,var(--pbA))",
    boxShadow: "0 14px 34px rgba(0,0,0,0.45)",
  }
  const ctrl: React.CSSProperties = {
    backgroundColor: "rgba(14,14,16,0.7)",
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: "var(--rCtrl)",
  }

  return (
    <div
      className="relative overflow-hidden"
      style={{ ...guestThemeVars(theme), backgroundColor: SHELL.bg, color: SHELL.ink, fontFamily: bodyFont }}
    >
      <style>{GUEST_CSS}</style>
      {/* Near-black base + two floating accent orbs behind everything. */}
      <div className="pointer-events-none absolute" style={{ top: -90, left: -60, width: 240, height: 240, borderRadius: "50%", background: "radial-gradient(circle, rgba(var(--accRGB),0.20), transparent 65%)", filter: "blur(30px)", animation: "rfFloatOrb 16s ease-in-out infinite" }} />
      <div className="pointer-events-none absolute" style={{ bottom: -110, right: -50, width: 230, height: 230, borderRadius: "50%", background: "radial-gradient(circle, rgba(var(--accDeepRGB),0.22), transparent 65%)", filter: "blur(30px)", animation: "rfFloatOrb 20s ease-in-out infinite reverse" }} />

      <div className="relative">
        {/* HERO — header_style picks the wash. */}
        <header className="relative overflow-hidden" style={{ height: 132 }}>
          <div className="absolute inset-0" style={{ background: "var(--heroWash)" }} />
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(6,6,7,0.15), rgba(6,6,7,0.4) 45%, rgba(8,8,10,0.96))" }} />
          <div className="pointer-events-none absolute" style={{ top: -60, right: -30, width: 150, height: 150, borderRadius: "50%", background: "radial-gradient(circle, rgba(var(--accHiRGB),0.3), transparent 62%)", filter: "blur(12px)" }} />
          <div className="relative flex h-full flex-col justify-between px-4 pb-3 pt-5">
            <div className="flex items-start">
              <div className="flex items-center gap-1.5 rounded-full border px-2.5 py-1" style={{ backgroundColor: "rgba(10,10,12,0.5)", borderColor: "rgba(255,255,255,0.14)" }}>
                <Icon name="table_restaurant" style={{ fontSize: 12, color: "var(--accHi)" }} />
                <span className="text-[9.5px] font-bold tracking-wide" style={{ color: SHELL.inkStrong }}>Table 5 · DINE-IN</span>
              </div>
            </div>
            <div>
              <div className="mb-0.5 text-[9px] font-bold uppercase tracking-[2px]" style={{ color: "var(--accHi)" }}>SCAN · CHOOSE · ENJOY</div>
              <h1 className="rf-serif truncate text-[26px] leading-none" style={{ color: SHELL.inkStrong, textShadow: "0 2px 16px rgba(0,0,0,0.55)" }}>{restaurantName}</h1>
            </div>
          </div>
        </header>

        {/* CONTROLS + SEARCH — button_shape drives --rCtrl on every control. */}
        <div className="flex items-center gap-1.5 px-3 pt-2.5">
          <div className="flex items-center gap-1.5 border px-2.5 py-2" style={ctrl}>
            <Icon name="receipt_long" style={{ fontSize: 14, color: "var(--accHi)" }} />
            <span className="text-[8.5px] font-bold uppercase tracking-wide" style={{ color: SHELL.muted }}>Bill</span>
            <span className="rf-num text-[14px]">₹0</span>
          </div>
          <div className="flex-1" />
          <div className="flex overflow-hidden border text-[10px] font-semibold" style={{ borderColor: "rgba(255,255,255,0.08)", borderRadius: "var(--rCtrl)" }}>
            <span className="px-2 py-1.5" style={{ backgroundColor: "var(--accHi)", color: "var(--onAcc)" }}>EN</span>
            <span className="px-2 py-1.5" style={{ backgroundColor: "rgba(14,14,16,0.7)", color: SHELL.muted }}>हिं</span>
          </div>
        </div>
        <div className="px-3 pt-2">
          <div className="flex items-center gap-2 border px-2.5 py-2" style={ctrl}>
            <Icon name="search" style={{ fontSize: 15, color: SHELL.dim }} />
            <span className="text-[11px]" style={{ color: SHELL.dim }}>Search the menu…</span>
          </div>
        </div>

        {/* CATEGORY CHIPS */}
        <div className="flex gap-1.5 px-3 py-2.5">
          <span className="rounded-full px-3 py-1 text-[11px] font-semibold" style={{ background: "var(--accHi)", color: "var(--onAcc)" }}>Desserts</span>
          <span className="rounded-full border px-3 py-1 text-[11px] font-semibold" style={{ backgroundColor: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)", color: SHELL.muted }}>Mains</span>
        </div>

        {/* DISH CARDS — surface_style drives the panel material. */}
        <div className="grid grid-cols-2 gap-2.5 px-3 pb-3">
          {dishes.map((d) => (
            <div key={d.name} className="relative overflow-hidden" style={panel}>
              <div className="relative flex items-center justify-center" style={{ height: 68, background: "linear-gradient(140deg,#26262B,#111113)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <div className="pointer-events-none absolute" style={{ width: 56, height: 56, borderRadius: "50%", background: "radial-gradient(circle, rgba(var(--accDeepRGB),0.55), transparent 70%)" }} />
                <span className="rf-serif relative text-[28px] leading-none" style={{ color: "var(--accHi)" }}>{d.name.trim()[0]?.toUpperCase()}</span>
              </div>
              <div className="px-2.5 pb-2.5 pt-2">
                <div className="text-[11.5px] font-semibold leading-tight" style={{ minHeight: 28 }}>{d.name}</div>
                <div className="mt-1.5 flex items-end justify-between gap-2">
                  <div className="rf-num text-[18px]">₹{d.price}</div>
                  <span className="flex h-[28px] w-[28px] items-center justify-center" style={{ borderRadius: "var(--rCtrl)", background: "rgba(var(--accRGB),0.16)", border: "1px solid rgba(var(--accRGB),0.3)" }}>
                    <Icon name="add" style={{ fontSize: 17, color: "var(--accHi)" }} />
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* FLOATING TOTAL BAR */}
        <div className="px-3 pb-4 pt-6" style={{ background: "linear-gradient(180deg, transparent, rgba(6,6,7,0.85) 40%)" }}>
          <div
            className="flex items-center gap-2.5 px-3 py-2.5"
            style={{ borderRadius: "var(--rCard)", background: "rgba(24,24,28,0.72)", backdropFilter: "blur(26px) saturate(150%)", WebkitBackdropFilter: "blur(26px) saturate(150%)", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 20px 50px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)" }}
          >
            <div className="relative flex h-9 w-9 shrink-0 items-center justify-center" style={{ borderRadius: 13, background: "linear-gradient(145deg, var(--accHi), var(--accMid))", boxShadow: "0 8px 20px rgba(var(--accShadowRGB),0.55)" }}>
              <Icon name="shopping_bag" style={{ fontSize: 18, color: "var(--onAcc)" }} />
              <div className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white" style={{ backgroundColor: "#C97B6E", border: "2px solid #16161A" }}>2</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[9.5px] font-semibold uppercase tracking-wide" style={{ color: SHELL.muted }}>2 items · tap to review</div>
              <div className="rf-num text-[20px] leading-tight">₹809.00</div>
            </div>
            <span className="px-3 py-2 text-[11px] font-bold" style={{ borderRadius: 14, background: "linear-gradient(180deg, var(--accHi), var(--accMid))", color: "var(--onAcc)", boxShadow: "0 10px 24px rgba(var(--accShadowRGB),0.5)" }}>Review</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function BrandingCustomizer(props: {
  restaurantId: string
  isAdmin: boolean
  restaurantName?: string
}) {
  const { restaurantId, isAdmin, restaurantName } = props
  const { toast } = useToast()

  const [form, setForm] = useState<BrandForm>(() => defaultForm(DEFAULT_ACCENT))
  const [fonts, setFonts] = useState<string[]>(BRAND_FONTS)
  const [live, setLive] = useState<string[]>([...LIVE_FIELDS])
  // Retired keys this tenant actually has stored — the only ones worth naming in
  // the note (a tenant who never set them sees nothing).
  const [retired, setRetired] = useState<{ key: string; value: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // The tenant's accent as loaded — "reset" restores the shipped defaults around
  // it rather than stomping the brand colour back to the app's generic orange.
  const loadedAccent = useRef(DEFAULT_ACCENT)

  const set = <K extends keyof BrandForm>(key: K, value: BrandForm[K]) =>
    { setForm((f) => ({ ...f, [key]: value })); }

  useEffect(() => {
    let active = true
    getBrandConfig(restaurantId)
      .then(({ brand_config, brand_fonts, brand_fields, brand_field_options }) => {
        if (!active) {return}
        const cfg = brand_config as GuestBrandConfig
        const accent = isHex(cfg.color_primary ?? "") ? (cfg.color_primary!) : DEFAULT_ACCENT
        loadedAccent.current = accent
        const base = defaultForm(accent)
        const allowedFonts = (brand_field_options?.font?.length ? brand_field_options.font : brand_fonts).concat(BRAND_FONTS)
        setForm({
          color_primary: accent,
          font: cfg.font && allowedFonts.includes(cfg.font) ? cfg.font : base.font,
          header_style: cfg.header_style === "solid" ? "solid" : "gradient",
          button_shape:
            cfg.button_shape === "pill" || cfg.button_shape === "square" ? cfg.button_shape : "rounded",
          surface_style:
            cfg.surface_style === "solid" || cfg.surface_style === "tinted" ? cfg.surface_style : "frosted",
        })
        if (brand_field_options?.font?.length) {setFonts(brand_field_options.font)}
        else if (brand_fonts.length > 0) {setFonts(brand_fonts)}
        if (brand_fields?.live?.length) {setLive(brand_fields.live)}
        const legacyKeys = brand_fields?.legacy?.length ? brand_fields.legacy : [...LEGACY_FIELDS]
        setRetired(
          legacyKeys
            .map((k) => ({ key: k, value: String((brand_config as Record<string, unknown>)[k] ?? "") }))
            .filter((r) => r.value.trim().length > 0),
        )
      })
      .catch(() => {/* keep defaults */})
      .finally(() => { if (active) {setLoading(false)} })
    return () => { active = false }
  }, [restaurantId])

  // Load the chosen body font + the design constants (Instrument Serif display,
  // Roboto thin numerals, Material Symbols) so the preview renders in them.
  useEffect(() => { loadBrandFont(form.font) }, [form.font])
  useEffect(() => { loadDesignFonts() }, [])

  const reset = () => { setForm(defaultForm(loadedAccent.current)); }

  const onSave = async () => {
    if (!isAdmin) {
      toast({ title: "Access denied", description: "You do not have the required role for this action. Required role: admin.", variant: "destructive" })
      return
    }
    if (!isHex(form.color_primary)) {
      toast({ title: "Invalid colour", description: "The accent must be a #RRGGBB hex value.", variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      // Only the LIVE keys are sent. The save merges on omit, so a tenant's
      // retired colour values stay exactly as they are rather than being
      // rewritten by an editor that no longer shows them.
      const saved = await saveBrandConfig(restaurantId, {
        color_primary: form.color_primary,
        font: form.font,
        header_style: form.header_style,
        button_shape: form.button_shape,
        surface_style: form.surface_style,
      })
      loadedAccent.current = isHex(saved.color_primary ?? "") ? (saved.color_primary!) : loadedAccent.current
      toast({ title: "Branding saved!", description: "Your guest pages — menu, feedback and valet — now use the new look." })
    } catch (error: any) {
      toast({ title: "Couldn't save branding", description: error?.message ?? "Unable to update customer-page branding.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const theme = useMemo(
    () => resolveGuestTheme(isHex(form.color_primary) ? form.color_primary : DEFAULT_ACCENT, {
      button_shape: form.button_shape,
      surface_style: form.surface_style,
      header_style: form.header_style,
    }),
    [form.color_primary, form.button_shape, form.surface_style, form.header_style],
  )
  const name = restaurantName?.trim() || "Your Restaurant"
  const shows = (key: string) => live.includes(key)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Guest Page Branding</CardTitle>
        <CardDescription>
          One accent colour themes every customer-facing screen — the QR order page, the feedback form and the valet
          step. Pick the accent, the font and how the surfaces feel; everything else is derived. Changes preview live
          and apply to guests after you save.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-8 lg:grid-cols-2">
          {/* ---- Controls: exactly the keys the guest design renders ---- */}
          <div className={cn("space-y-5", loading && "pointer-events-none opacity-60")}>
            {shows("color_primary") && (
              <div className="space-y-2">
                <Label className="text-xs font-medium">Accent colour</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label="Accent colour"
                    disabled={!isAdmin}
                    value={isHex(form.color_primary) ? form.color_primary : "#000000"}
                    onChange={(e) => { set("color_primary", e.target.value); }}
                    className="h-9 w-10 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <Input
                    value={form.color_primary}
                    disabled={!isAdmin}
                    maxLength={7}
                    spellCheck={false}
                    onChange={(e) => {
                      let v = e.target.value.trim()
                      if (v && !v.startsWith("#")) {v = `#${v}`}
                      set("color_primary", v)
                    }}
                    className={cn("h-9 font-mono text-xs uppercase", form.color_primary && !isHex(form.color_primary) && "border-destructive")}
                  />
                </div>
                <p className="text-[11px] leading-tight text-muted-foreground">
                  Everything accented on the guest pages is derived from this one colour.
                </p>
                {/* The derived ramp — what the accent actually produces. */}
                <div className="grid grid-cols-6 gap-1.5 pt-1">
                  <Swatch name="Hi" hex={theme.accHi} note="highlights, icons, active chips" />
                  <Swatch name="Acc" hex={theme.acc} note="the accent itself" />
                  <Swatch name="Mid" hex={theme.accMid} note="button gradients" />
                  <Swatch name="Deep" hex={theme.accDeep} note="hero wash, image glow" />
                  <Swatch name="Shadow" hex={theme.accShadow} note="glows and drop shadows" />
                  <Swatch name="On acc" hex={theme.onAcc} note="ink on top of the accent" />
                </div>
              </div>
            )}

            {shows("font") && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Body font</Label>
                <Select value={form.font} onValueChange={(v) => { set("font", v); }} disabled={!isAdmin}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a font" />
                  </SelectTrigger>
                  <SelectContent>
                    {fonts.map((f) => (
                      <SelectItem key={f} value={f}>{f}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] leading-tight text-muted-foreground">
                  Applies to body text. The display serif and the thin price numerals are part of the design.
                </p>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              {shows("header_style") && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Header wash</Label>
                  <div>
                    <Segmented<HeaderStyle>
                      value={form.header_style}
                      disabled={!isAdmin}
                      onChange={(v) => { set("header_style", v); }}
                      options={HEADER_OPTIONS}
                    />
                  </div>
                </div>
              )}
              {shows("button_shape") && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Control shape</Label>
                  <div>
                    <Segmented<ButtonShape>
                      value={form.button_shape}
                      disabled={!isAdmin}
                      onChange={(v) => { set("button_shape", v); }}
                      options={SHAPE_OPTIONS}
                    />
                  </div>
                </div>
              )}
            </div>

            {shows("surface_style") && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Panel material</Label>
                <div>
                  <Segmented<SurfaceStyle>
                    value={form.surface_style}
                    disabled={!isAdmin}
                    onChange={(v) => { set("surface_style", v); }}
                    options={SURFACE_OPTIONS}
                  />
                </div>
                <p className="text-[11px] leading-tight text-muted-foreground">
                  How the dish cards and sheets are built — frosted glass, flat dark panels, or glass tinted with your accent.
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" onClick={onSave} disabled={!isAdmin || saving || loading}>
                {saving ? "Saving..." : "Save branding"}
              </Button>
              <Button type="button" variant="outline" onClick={reset} disabled={!isAdmin || saving}>
                Reset to default
              </Button>
            </div>
            {!isAdmin ? (
              <p className="text-xs text-muted-foreground">Only admins can change customer-page branding.</p>
            ) : null}

            {/* Quiet, honest note about the controls that used to be here. */}
            {retired.length > 0 && (
              <div className="rounded-lg border border-dashed bg-muted/30 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">No longer used</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  The guest pages now build every surface from your accent, so these older settings don&apos;t paint
                  anything any more. Your saved values are kept, not deleted — nothing else changed.
                </p>
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {retired.map((r) => (
                    <li key={r.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {isHex(r.value) && (
                        <span className="h-3 w-3 shrink-0 rounded-sm border border-black/10 dark:border-white/10" style={{ backgroundColor: r.value }} />
                      )}
                      <span>{LEGACY_LABELS[r.key] ?? r.key}</span>
                      <span className="font-mono uppercase opacity-70">{r.value}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* ---- Live preview (the real guest surface, in a phone mock) ---- */}
          <div className="flex flex-col items-center gap-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Live preview</p>
            <div className="w-full max-w-[300px] overflow-hidden rounded-[2.2rem] border-[6px] border-neutral-800 bg-neutral-800 shadow-xl dark:border-neutral-700">
              <GuestPreview theme={theme} font={form.font} restaurantName={name} />
            </div>
            <p className="max-w-[300px] text-center text-[11px] leading-tight text-muted-foreground">
              This is the guest order page. The feedback form and the valet step use the same accent ramp, font and
              panel material.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
