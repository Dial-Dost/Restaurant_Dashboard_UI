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
import { type BrandContrastNote, type BrandSchemeMeta, getBrandConfig, saveBrandConfig } from "@/lib/db"
import { BRAND_FONTS, fontStack, loadBrandFont, loadDesignFonts } from "@/lib/brand-fonts"
import {
  DEFAULT_ACCENT,
  GUEST_CSS,
  type GuestPalette,
  guestThemeVars,
  paletteVars,
  resolveGuestPalette,
  resolveGuestTheme,
  type GuestBrandConfig,
  type GuestTheme,
} from "@/lib/guest-theme"

const isHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v.trim())

type HeaderStyle = "gradient" | "solid"
type ButtonShape = "rounded" | "pill" | "square"
type SurfaceStyle = "frosted" | "solid" | "tinted"
type FontScale = "small" | "medium" | "large"
type CardShape = "rounded" | "sharp"

// The five keys the new guest design actually renders. The backend advertises the
// same split via GET /restaurant/settings → brand_fields.live; these are only the
// client-side fallback for an older backend that doesn't send it.
const LIVE_FIELDS = [
  "scheme", "color_primary", "font", "font_scale", "header_style", "button_shape", "surface_style", "card_shape",
] as const
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
const FONT_SCALE_OPTIONS: { value: FontScale; label: string; hint: string }[] = [
  { value: "small", label: "S", hint: "92% — compact" },
  { value: "medium", label: "M", hint: "100% — the default" },
  { value: "large", label: "L", hint: "110% — easier reading" },
]
const CARD_SHAPE_OPTIONS: { value: CardShape; label: string; hint: string }[] = [
  { value: "rounded", label: "Rounded", hint: "22px — the default" },
  { value: "sharp", label: "Sharp", hint: "6px, squared-off panels" },
]

// Client-side fallback for the preset catalogue when the settings fetch didn't
// return brand_schemes (older backend / transient error). Mirrors the server's
// BRAND_SCHEMES; the server list wins whenever present.
const FALLBACK_SCHEMES: BrandSchemeMeta[] = [
  { id: "classic", label: "Classic dark", hint: "The shipped near-black design — the default.", preview: { background: "#08080A", surface: "#1A1A1F", text: "#ECEAE6", success: "#8FB27C", warning: "#E4C48C", error: "#E0A79B" } },
  { id: "copper", label: "Warm copper", hint: "A warmer, wood-and-copper take on the dark shell.", preview: { background: "#0E0A08", surface: "#201812", text: "#F1E9DF", success: "#97B884", warning: "#E4C48C", error: "#E0A79B" } },
  { id: "airy", label: "Light & airy", hint: "Paper-light shell with white cards and dark ink.", preview: { background: "#F6F4EF", surface: "#FFFFFF", text: "#2B2723", success: "#3F6F33", warning: "#8A5A14", error: "#B3402F" } },
  { id: "contrast", label: "High contrast", hint: "Pure black and white, maximum legibility.", preview: { background: "#000000", surface: "#101010", text: "#FFFFFF", success: "#57D982", warning: "#FFD666", error: "#FF8A7A" } },
  { id: "custom", label: "Custom", hint: "Pick every colour role yourself.", preview: { background: "#08080A", surface: "#1A1A1F", text: "#ECEAE6", success: "#8FB27C", warning: "#E4C48C", error: "#E0A79B" } },
]

interface BrandForm {
  scheme: string
  color_primary: string
  color_secondary: string
  color_accent: string
  color_bg: string
  color_card: string
  color_text: string
  color_success: string
  color_warning: string
  color_error: string
  font: string
  font_scale: FontScale
  header_style: HeaderStyle
  button_shape: ButtonShape
  surface_style: SurfaceStyle
  card_shape: CardShape
}

// Resolved defaults = exactly the shipped guest look, so "reset" lands on the
// design as delivered (keeping the tenant's own accent).
const defaultForm = (accent: string): BrandForm => ({
  scheme: "classic",
  color_primary: accent,
  // Blank = "derive it from the accent", which is exactly what the server does.
  // An owner only overrides the roles they actually care about.
  color_secondary: "",
  color_accent: "",
  color_bg: "",
  color_card: "",
  color_text: "",
  color_success: "",
  color_warning: "",
  color_error: "",
  font: "Inter",
  font_scale: "medium",
  header_style: "gradient",
  button_shape: "rounded",
  surface_style: "frosted",
  card_shape: "rounded",
})

// One editable colour ROLE. Leaving it blank means "derive from the accent",
// which is what the server does — owners override only what they care about.
function ColorRole({
  label, hint, value, disabled, derived, onChange,
}: {
  label: string; hint: string; value: string; disabled: boolean; derived?: string;
  onChange: (v: string) => void;
}) {
  const valid = !value || isHex(value)
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          disabled={disabled}
          value={isHex(value) ? value : (derived && isHex(derived) ? derived : "#000000")}
          onChange={(e) => { onChange(e.target.value); }}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <Input
          value={value}
          disabled={disabled}
          maxLength={7}
          spellCheck={false}
          placeholder={derived ? `auto — ${derived}` : "auto"}
          onChange={(e) => {
            let v = e.target.value.trim()
            if (v && !v.startsWith("#")) {v = `#${v}`}
            onChange(v)
          }}
          className={cn("h-9 font-mono text-xs uppercase", !valid && "border-destructive")}
        />
        {value ? (
          <Button type="button" variant="ghost" size="sm" disabled={disabled}
            onClick={() => { onChange("") }} className="h-9 shrink-0 px-2 text-xs">
            Auto
          </Button>
        ) : null}
      </div>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  )
}

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
function GuestPreview({ theme, palette, font, restaurantName }: { theme: GuestTheme; palette: GuestPalette; font: string; restaurantName: string }) {
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
    border: "1.5px solid rgba(var(--edgeRGB),var(--pbA))",
    boxShadow: "0 14px 34px rgba(0,0,0,0.45)",
  }
  const ctrl: React.CSSProperties = {
    backgroundColor: "rgba(var(--panelRGB),0.7)",
    borderColor: "rgba(var(--edgeRGB),0.08)",
    borderRadius: "var(--rCtrl)",
  }

  return (
    <div
      className="relative overflow-hidden"
      style={{ ...guestThemeVars(theme), ...paletteVars(palette), backgroundColor: "var(--bg)", color: "var(--ink)", fontFamily: bodyFont }}
    >
      <style>{GUEST_CSS}</style>
      {/* Near-black base + two floating accent orbs behind everything. */}
      <div className="pointer-events-none absolute" style={{ top: -90, left: -60, width: 240, height: 240, borderRadius: "50%", background: "radial-gradient(circle, rgba(var(--accRGB),0.20), transparent 65%)", filter: "blur(30px)", animation: "rfFloatOrb 16s ease-in-out infinite" }} />
      <div className="pointer-events-none absolute" style={{ bottom: -110, right: -50, width: 230, height: 230, borderRadius: "50%", background: "radial-gradient(circle, rgba(var(--accDeepRGB),0.22), transparent 65%)", filter: "blur(30px)", animation: "rfFloatOrb 20s ease-in-out infinite reverse" }} />

      <div className="relative">
        {/* HERO — header_style picks the wash. */}
        <header className="relative overflow-hidden" style={{ height: 132 }}>
          <div className="absolute inset-0" style={{ background: "var(--heroWash)" }} />
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(6,6,7,0.15), rgba(6,6,7,0.4) 45%, rgba(var(--bgRGB),0.96))" }} />
          <div className="pointer-events-none absolute" style={{ top: -60, right: -30, width: 150, height: 150, borderRadius: "50%", background: "radial-gradient(circle, rgba(var(--accHiRGB),0.3), transparent 62%)", filter: "blur(12px)" }} />
          <div className="relative flex h-full flex-col justify-between px-4 pb-3 pt-5">
            <div className="flex items-start">
              <div className="flex items-center gap-1.5 rounded-full border px-2.5 py-1" style={{ backgroundColor: "rgba(var(--chipRGB),0.5)", borderColor: "rgba(var(--edgeRGB),0.14)" }}>
                <Icon name="table_restaurant" style={{ fontSize: 12, color: "var(--accHi)" }} />
                <span className="text-[9.5px] font-bold tracking-wide" style={{ color: "var(--inkStrong)" }}>Table 5 · DINE-IN</span>
              </div>
            </div>
            <div>
              <div className="mb-0.5 text-[9px] font-bold uppercase tracking-[2px]" style={{ color: "var(--accHi)" }}>SCAN · CHOOSE · ENJOY</div>
              <h1 className="rf-serif truncate text-[26px] leading-none" style={{ color: "var(--inkStrong)", textShadow: "0 2px 16px rgba(0,0,0,0.55)" }}>{restaurantName}</h1>
            </div>
          </div>
        </header>

        {/* CONTROLS + SEARCH — button_shape drives --rCtrl on every control. */}
        <div className="flex items-center gap-1.5 px-3 pt-2.5">
          <div className="flex items-center gap-1.5 border px-2.5 py-2" style={ctrl}>
            <Icon name="receipt_long" style={{ fontSize: 14, color: "var(--accHi)" }} />
            <span className="text-[8.5px] font-bold uppercase tracking-wide" style={{ color: "var(--inkMuted)" }}>Bill</span>
            <span className="rf-num text-[14px]">₹0</span>
          </div>
          <div className="flex-1" />
          <div className="flex overflow-hidden border text-[10px] font-semibold" style={{ borderColor: "rgba(255,255,255,0.08)", borderRadius: "var(--rCtrl)" }}>
            <span className="px-2 py-1.5" style={{ backgroundColor: "var(--accHi)", color: "var(--onAcc)" }}>EN</span>
            <span className="px-2 py-1.5" style={{ backgroundColor: "rgba(var(--panelRGB),0.7)", color: "var(--inkMuted)" }}>हिं</span>
          </div>
        </div>
        <div className="px-3 pt-2">
          <div className="flex items-center gap-2 border px-2.5 py-2" style={ctrl}>
            <Icon name="search" style={{ fontSize: 15, color: "var(--inkDim)" }} />
            <span className="text-[11px]" style={{ color: "var(--inkDim)" }}>Search the menu…</span>
          </div>
        </div>

        {/* CATEGORY CHIPS */}
        <div className="flex gap-1.5 px-3 py-2.5">
          <span className="rounded-full px-3 py-1 text-[11px] font-semibold" style={{ background: "var(--accHi)", color: "var(--onAcc)" }}>Desserts</span>
          <span className="rounded-full border px-3 py-1 text-[11px] font-semibold" style={{ backgroundColor: "rgba(var(--edgeRGB),0.04)", borderColor: "rgba(var(--edgeRGB),0.08)", color: "var(--inkMuted)" }}>Mains</span>
        </div>

        {/* DISH CARDS — surface_style drives the panel material. */}
        <div className="grid grid-cols-2 gap-2.5 px-3 pb-3">
          {dishes.map((d) => (
            <div key={d.name} className="relative overflow-hidden" style={panel}>
              <div className="relative flex items-center justify-center" style={{ height: 68, background: "linear-gradient(140deg,var(--phTop),var(--phBot))", borderBottom: "1px solid rgba(var(--edgeRGB),0.05)" }}>
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
        <div className="px-3 pb-4 pt-6" style={{ background: "linear-gradient(180deg, transparent, rgba(var(--bgRGB),0.85) 40%)" }}>
          <div
            className="flex items-center gap-2.5 px-3 py-2.5"
            style={{ borderRadius: "var(--rCard)", background: "rgba(var(--floatRGB),0.72)", backdropFilter: "blur(26px) saturate(150%)", WebkitBackdropFilter: "blur(26px) saturate(150%)", border: "1px solid rgba(var(--edgeRGB),0.12)", boxShadow: "0 20px 50px rgba(0,0,0,0.6), inset 0 1px 0 rgba(var(--edgeRGB),0.08)" }}
          >
            <div className="relative flex h-9 w-9 shrink-0 items-center justify-center" style={{ borderRadius: 13, background: "linear-gradient(145deg, var(--accHi), var(--accMid))", boxShadow: "0 8px 20px rgba(var(--accShadowRGB),0.55)" }}>
              <Icon name="shopping_bag" style={{ fontSize: 18, color: "var(--onAcc)" }} />
              <div className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white" style={{ backgroundColor: "#C97B6E", border: "2px solid #16161A" }}>2</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[9.5px] font-semibold uppercase tracking-wide" style={{ color: "var(--inkMuted)" }}>2 items · tap to review</div>
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
  // Preset scheme catalogue (server-first) + the server's WCAG clamp note from
  // the last save, repeated to the owner so a corrected text colour isn't a
  // silent mystery.
  const [schemes, setSchemes] = useState<BrandSchemeMeta[]>(FALLBACK_SCHEMES)
  const [contrastNotes, setContrastNotes] = useState<BrandContrastNote[]>([])
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
      .then(({ brand_config, brand_fonts, brand_fields, brand_field_options, brand_schemes, brand_contrast }) => {
        if (!active) {return}
        const cfg = brand_config as GuestBrandConfig
        const accent = isHex(cfg.color_primary ?? "") ? (cfg.color_primary!) : DEFAULT_ACCENT
        loadedAccent.current = accent
        const base = defaultForm(accent)
        const allowedFonts = (brand_field_options?.font?.length ? brand_field_options.font : brand_fonts).concat(BRAND_FONTS)
        // Only a valid hex is adopted; anything else stays blank = "derive it".
        const hexOrBlank = (v: unknown) => (typeof v === "string" && isHex(v) ? v : "")
        setForm({
          scheme: typeof cfg.scheme === "string" && cfg.scheme ? cfg.scheme : "classic",
          color_primary: accent,
          color_secondary: hexOrBlank(cfg.color_secondary),
          color_accent: hexOrBlank((cfg as Record<string, unknown>).color_accent),
          color_bg: hexOrBlank(cfg.color_bg),
          color_card: hexOrBlank(cfg.color_card),
          color_text: hexOrBlank(cfg.color_text),
          color_success: hexOrBlank((cfg as Record<string, unknown>).color_success),
          color_warning: hexOrBlank((cfg as Record<string, unknown>).color_warning),
          color_error: hexOrBlank((cfg as Record<string, unknown>).color_error),
          font: cfg.font && allowedFonts.includes(cfg.font) ? cfg.font : base.font,
          font_scale: cfg.font_scale === "small" || cfg.font_scale === "large" ? cfg.font_scale : "medium",
          header_style: cfg.header_style === "solid" ? "solid" : "gradient",
          button_shape:
            cfg.button_shape === "pill" || cfg.button_shape === "square" ? cfg.button_shape : "rounded",
          surface_style:
            cfg.surface_style === "solid" || cfg.surface_style === "tinted" ? cfg.surface_style : "frosted",
          card_shape: cfg.card_shape === "sharp" ? "sharp" : "rounded",
        })
        if (brand_schemes?.length) {setSchemes(brand_schemes)}
        if (brand_contrast?.length) {setContrastNotes(brand_contrast)}
        if (brand_field_options?.font?.length) {setFonts(brand_field_options.font)}
        else if (brand_fonts.length > 0) {setFonts(brand_fonts)}
        if (brand_fields?.live?.length) {setLive(brand_fields.live)}
        // An EMPTY array means the server has retired nothing — only a MISSING
        // field should fall back to the built-in list. Using `.length` here kept
        // showing the revived palette keys as dead notes after they went live.
        const legacyKeys = Array.isArray(brand_fields?.legacy) ? brand_fields.legacy : [...LEGACY_FIELDS]
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

  // Applying a preset fills the shell/semantic colour fields with the scheme's
  // values (blank for "classic" = derive the shipped defaults) so what is saved
  // is exactly what the picker showed — the tenant's accent is never touched.
  // "custom" only flips the marker and leaves every field alone.
  const applyScheme = (id: string) => {
    const scheme = schemes.find((sc) => sc.id === id)
    setForm((f) => {
      if (id === "custom" || !scheme) {return { ...f, scheme: id }}
      const preview = id === "classic" ? null : scheme.preview
      return {
        ...f,
        scheme: id,
        color_bg: preview?.background ?? "",
        color_card: preview?.surface ?? "",
        color_text: preview?.text ?? "",
        color_success: preview?.success ?? "",
        color_warning: preview?.warning ?? "",
        color_error: preview?.error ?? "",
      }
    })
  }

  // Any manual colour tweak while a named preset is active flips the marker to
  // "custom", so the picker never claims a look the tenant has since edited.
  const setColor = (key: keyof BrandForm, value: string) => {
    setForm((f) => ({
      ...f,
      [key]: value,
      ...(f.scheme !== "classic" && f.scheme !== "custom" && key !== "color_primary" ? { scheme: "custom" } : {}),
    }))
  }

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
        scheme: form.scheme,
        color_primary: form.color_primary,
        // A blank role means "derive from the accent / the scheme". Sent as
        // null so the server CLEARS the stored override (brand_config merges on
        // omit, so a missing key would keep the stale value forever).
        color_secondary: form.color_secondary || null,
        color_accent: form.color_accent || null,
        color_bg: form.color_bg || null,
        color_card: form.color_card || null,
        color_text: form.color_text || null,
        color_success: form.color_success || null,
        color_warning: form.color_warning || null,
        color_error: form.color_error || null,
        font: form.font,
        font_scale: form.font_scale,
        header_style: form.header_style,
        button_shape: form.button_shape,
        surface_style: form.surface_style,
        card_shape: form.card_shape,
      })
      const savedCfg = saved.brand_config
      loadedAccent.current = isHex(savedCfg.color_primary ?? "") ? (savedCfg.color_primary!) : loadedAccent.current
      setContrastNotes(saved.brand_contrast)
      toast({
        title: "Branding saved!",
        description: saved.brand_contrast.length > 0
          ? "Saved — but your text colour was adjusted to stay readable (see the note under the colours)."
          : "Your guest pages — menu, queue, reservations and feedback — now use the new look.",
      })
    } catch (error: any) {
      toast({ title: "Couldn't save branding", description: error?.message ?? "Unable to update customer-page branding.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  // The palette the preview paints with: the picked roles over the selected
  // scheme's shell over the shipped defaults — mirroring the server resolver.
  const previewPalette = useMemo<GuestPalette>(() => {
    const scheme = schemes.find((sc) => sc.id === form.scheme)
    const base = form.scheme !== "classic" && form.scheme !== "custom" && scheme ? scheme.preview : {} as Record<string, string>
    return resolveGuestPalette({
      primary: isHex(form.color_primary) ? form.color_primary : undefined,
      secondary: form.color_secondary || undefined,
      accent: form.color_accent || undefined,
      background: form.color_bg || base.background,
      surface: form.color_card || base.surface,
      text: form.color_text || base.text,
      success: form.color_success || base.success,
      warning: form.color_warning || base.warning,
      error: form.color_error || base.error,
    })
  }, [form, schemes])
  const theme = useMemo(
    () => resolveGuestTheme(isHex(form.color_primary) ? form.color_primary : DEFAULT_ACCENT, {
      button_shape: form.button_shape,
      surface_style: form.surface_style,
      header_style: form.header_style,
      card_shape: form.card_shape,
      font_scale: form.font_scale,
    }, previewPalette),
    [form.color_primary, form.button_shape, form.surface_style, form.header_style, form.card_shape, form.font_scale, previewPalette],
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
            {shows("scheme") && (
              <div className="space-y-2">
                <Label className="text-xs font-medium">Colour scheme</Label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {schemes.map((sc) => {
                    const active = form.scheme === sc.id
                    return (
                      <button
                        key={sc.id}
                        type="button"
                        disabled={!isAdmin}
                        title={sc.hint}
                        onClick={() => { applyScheme(sc.id) }}
                        aria-pressed={active}
                        className={cn(
                          "rounded-lg border p-2 text-left transition disabled:cursor-not-allowed disabled:opacity-50",
                          active ? "border-primary ring-1 ring-primary" : "hover:border-foreground/30",
                        )}
                      >
                        {/* Swatch strip: page / card / ink / the three states. */}
                        <div className="flex h-6 w-full overflow-hidden rounded-md border border-black/10 dark:border-white/10">
                          <span className="flex-[3]" style={{ backgroundColor: sc.preview.background }} />
                          <span className="flex-[2]" style={{ backgroundColor: sc.preview.surface }} />
                          <span className="flex-[2]" style={{ backgroundColor: sc.preview.text }} />
                          <span className="flex-1" style={{ backgroundColor: sc.preview.success }} />
                          <span className="flex-1" style={{ backgroundColor: sc.preview.warning }} />
                          <span className="flex-1" style={{ backgroundColor: sc.preview.error }} />
                        </div>
                        <p className="mt-1.5 truncate text-xs font-medium">{sc.label}</p>
                      </button>
                    )
                  })}
                </div>
                <p className="text-[11px] leading-tight text-muted-foreground">
                  A preset re-shells the guest pages (page, cards, ink, status colours) and keeps your accent. Tweak any
                  colour below to go custom.
                </p>
              </div>
            )}

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

            {/* Every other colour ROLE the guest surfaces use. Blank = derived
                from the accent by the server, so an owner can theme as little or
                as much as they want without producing an incoherent palette. */}
            {shows("color_secondary") && (
              <ColorRole label="Secondary colour" hint="Chips, secondary buttons." disabled={!isAdmin}
                value={form.color_secondary} derived={theme.accMid}
                onChange={(v) => { setColor("color_secondary", v) }} />
            )}
            {shows("color_accent") && (
              <ColorRole label="Highlight colour" hint="Badges and price emphasis." disabled={!isAdmin}
                value={form.color_accent} derived={theme.accHi}
                onChange={(v) => { setColor("color_accent", v) }} />
            )}
            {shows("color_bg") && (
              <ColorRole label="Page background" hint="The shell behind everything." disabled={!isAdmin}
                value={form.color_bg} derived="#08080A"
                onChange={(v) => { setColor("color_bg", v) }} />
            )}
            {shows("color_card") && (
              <ColorRole label="Card surface" hint="Panel base; transparency comes from the panel material." disabled={!isAdmin}
                value={form.color_card} derived="#1A1A1F"
                onChange={(v) => { setColor("color_card", v) }} />
            )}
            {shows("color_text") && (
              <ColorRole label="Body text" hint="Main ink colour on dark surfaces." disabled={!isAdmin}
                value={form.color_text} derived="#ECEAE6"
                onChange={(v) => { setColor("color_text", v) }} />
            )}
            {shows("color_success") && (
              <ColorRole label="Success" hint="Confirmations, ready/seated states." disabled={!isAdmin}
                value={form.color_success} derived="#8FB27C"
                onChange={(v) => { setColor("color_success", v) }} />
            )}
            {shows("color_warning") && (
              <ColorRole label="Warning" hint="Waiting and caution states." disabled={!isAdmin}
                value={form.color_warning} derived="#E4C48C"
                onChange={(v) => { setColor("color_warning", v) }} />
            )}
            {shows("color_error") && (
              <ColorRole label="Error" hint="Failures and destructive actions." disabled={!isAdmin}
                value={form.color_error} derived="#E0A79B"
                onChange={(v) => { setColor("color_error", v) }} />
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

            <div className="grid gap-4 sm:grid-cols-2">
              {shows("font_scale") && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Text size</Label>
                  <div>
                    <Segmented<FontScale>
                      value={form.font_scale}
                      disabled={!isAdmin}
                      onChange={(v) => { set("font_scale", v); }}
                      options={FONT_SCALE_OPTIONS}
                    />
                  </div>
                  <p className="text-[11px] leading-tight text-muted-foreground">
                    Scales every guest-page text size together.
                  </p>
                </div>
              )}
              {shows("card_shape") && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Card shape</Label>
                  <div>
                    <Segmented<CardShape>
                      value={form.card_shape}
                      disabled={!isAdmin}
                      onChange={(v) => { set("card_shape", v); }}
                      options={CARD_SHAPE_OPTIONS}
                    />
                  </div>
                  <p className="text-[11px] leading-tight text-muted-foreground">
                    Rounded panels (the default) or squared-off corners.
                  </p>
                </div>
              )}
            </div>

            {contrastNotes.length > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">Readability guard</p>
                {contrastNotes.map((n) => (
                  <p key={`${n.role}-${n.requested}`} className="mt-1 text-xs text-muted-foreground">
                    Your {n.role} colour <span className="font-mono uppercase">{n.requested}</span> only reaches {n.ratio}:1
                    contrast against the {n.against}, below the {n.minimum}:1 readability minimum — guests are shown{" "}
                    <span className="inline-block h-2.5 w-2.5 rounded-sm border border-black/10 align-middle dark:border-white/10" style={{ backgroundColor: n.applied }} />{" "}
                    <span className="font-mono uppercase">{n.applied}</span> instead. Pick a stronger colour to clear the guard.
                  </p>
                ))}
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
              <GuestPreview theme={theme} palette={previewPalette} font={form.font} restaurantName={name} />
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
