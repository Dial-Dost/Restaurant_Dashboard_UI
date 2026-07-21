"use client"

import { useEffect, useRef, useState } from "react"

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
import { BRAND_FONTS, fontStack, loadBrandFont, readableOn, shapeRadius } from "@/lib/brand-fonts"

// Lighten/darken a hex colour by a percentage — mirrors the guest page's shade()
// so a reset/default secondary matches the header gradient the guests actually
// see.
function shade(hex: string, pct: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return hex
  const num = parseInt(m[1], 16)
  const amt = Math.round(2.55 * pct)
  const r = Math.min(255, Math.max(0, (num >> 16) + amt))
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amt))
  const b = Math.min(255, Math.max(0, (num & 0xff) + amt))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`
}

const isHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v.trim())

type HeaderStyle = "gradient" | "solid"
type ButtonShape = "rounded" | "pill" | "square"

type BrandForm = {
  font: string
  color_primary: string
  color_secondary: string
  color_bg: string
  color_text: string
  color_card: string
  header_style: HeaderStyle
  button_shape: ButtonShape
}

// The guest order page's built-in fallback theme — also the "reset to default"
// target and the prefill for surfaces a tenant has never customised.
const DEFAULT_PRIMARY = "#ea580c"
const defaultForm = (primary: string): BrandForm => ({
  font: "Inter",
  color_primary: primary,
  color_secondary: shade(primary, -22),
  color_bg: "#fafafa",
  color_text: "#262626",
  color_card: "#ffffff",
  header_style: "gradient",
  button_shape: "pill",
})

function ColorField(props: {
  label: string
  hint?: string
  value: string
  disabled?: boolean
  onChange: (v: string) => void
}) {
  const { label, hint, value, disabled, onChange } = props
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          disabled={disabled}
          value={isHex(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <Input
          value={value}
          disabled={disabled}
          maxLength={7}
          spellCheck={false}
          onChange={(e) => {
            let v = e.target.value.trim()
            if (v && !v.startsWith("#")) v = `#${v}`
            onChange(v)
          }}
          className={cn("h-9 font-mono text-xs uppercase", value && !isHex(value) && "border-destructive")}
        />
      </div>
      {hint ? <p className="text-[11px] leading-tight text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function Segmented<T extends string>(props: {
  value: T
  options: { value: T; label: string }[]
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
          onClick={() => onChange(o.value)}
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

export function BrandingCustomizer(props: {
  restaurantId: string
  isAdmin: boolean
  restaurantName?: string
}) {
  const { restaurantId, isAdmin, restaurantName } = props
  const { toast } = useToast()

  const [form, setForm] = useState<BrandForm>(() => defaultForm(DEFAULT_PRIMARY))
  const [fonts, setFonts] = useState<string[]>(BRAND_FONTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // The tenant's brand primary as loaded — the "reset" preserves it rather than
  // stomping it back to the app's generic orange.
  const loadedPrimary = useRef(DEFAULT_PRIMARY)

  const set = <K extends keyof BrandForm>(key: K, value: BrandForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  useEffect(() => {
    let active = true
    getBrandConfig(restaurantId)
      .then(({ brand_config, brand_fonts }) => {
        if (!active) return
        const primary = isHex(brand_config.color_primary ?? "") ? (brand_config.color_primary as string) : DEFAULT_PRIMARY
        loadedPrimary.current = primary
        const base = defaultForm(primary)
        setForm({
          font: brand_config.font && brand_fonts.concat(BRAND_FONTS).includes(brand_config.font) ? brand_config.font : base.font,
          color_primary: primary,
          color_secondary: isHex(brand_config.color_secondary ?? "") ? (brand_config.color_secondary as string) : base.color_secondary,
          color_bg: isHex(brand_config.color_bg ?? "") ? (brand_config.color_bg as string) : base.color_bg,
          color_text: isHex(brand_config.color_text ?? "") ? (brand_config.color_text as string) : base.color_text,
          color_card: isHex(brand_config.color_card ?? "") ? (brand_config.color_card as string) : base.color_card,
          header_style: brand_config.header_style === "solid" ? "solid" : "gradient",
          button_shape:
            brand_config.button_shape === "rounded" || brand_config.button_shape === "square"
              ? brand_config.button_shape
              : "pill",
        })
        if (brand_fonts.length > 0) setFonts(brand_fonts)
      })
      .catch(() => {/* keep defaults */})
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [restaurantId])

  // Load the chosen font (for the live preview) whenever it changes.
  useEffect(() => { loadBrandFont(form.font) }, [form.font])

  const reset = () => setForm(defaultForm(loadedPrimary.current))

  const onSave = async () => {
    if (!isAdmin) {
      toast({ title: "Access denied", description: "You do not have the required role for this action. Required role: admin.", variant: "destructive" })
      return
    }
    // Guard against a half-typed hex leaking to the API (the backend would drop
    // it, but we'd rather tell the admin than silently ignore a colour).
    const colorKeys: (keyof BrandForm)[] = ["color_primary", "color_secondary", "color_bg", "color_text", "color_card"]
    for (const k of colorKeys) {
      if (!isHex(String(form[k]))) {
        toast({ title: "Invalid colour", description: `${k.replace("color_", "").replace("_", " ")} must be a #RRGGBB hex value.`, variant: "destructive" })
        return
      }
    }
    setSaving(true)
    try {
      const saved = await saveBrandConfig(restaurantId, {
        font: form.font,
        color_primary: form.color_primary,
        color_secondary: form.color_secondary,
        color_bg: form.color_bg,
        color_text: form.color_text,
        color_card: form.color_card,
        header_style: form.header_style,
        button_shape: form.button_shape,
      })
      loadedPrimary.current = isHex(saved.color_primary ?? "") ? (saved.color_primary as string) : loadedPrimary.current
      toast({ title: "Branding saved!", description: "Your customer order page now uses the new look." })
    } catch (error: any) {
      toast({ title: "Couldn't save branding", description: error?.message ?? "Unable to update customer-page branding.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const onPrimary = readableOn(form.color_primary)
  const headerBg =
    form.header_style === "solid"
      ? form.color_primary
      : `linear-gradient(135deg, ${form.color_primary}, ${isHex(form.color_secondary) ? form.color_secondary : shade(form.color_primary, -22)})`
  const previewFont = fontStack(form.font)
  const name = restaurantName?.trim() || "Your Restaurant"

  return (
    <Card>
      <CardHeader>
        <CardTitle>Customer Page Branding</CardTitle>
        <CardDescription>
          Customise the look of your QR order page — font, colours, header and button style. Changes preview live and apply to guests after you save.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-8 lg:grid-cols-2">
          {/* ---- Controls ---- */}
          <div className={cn("space-y-5", loading && "pointer-events-none opacity-60")}>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Font</Label>
              <Select value={form.font} onValueChange={(v) => set("font", v)} disabled={!isAdmin}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a font" />
                </SelectTrigger>
                <SelectContent>
                  {fonts.map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <ColorField label="Primary" hint="Header, buttons, accents" value={form.color_primary} disabled={!isAdmin} onChange={(v) => set("color_primary", v)} />
              <ColorField label="Secondary" hint="Header gradient end" value={form.color_secondary} disabled={!isAdmin} onChange={(v) => set("color_secondary", v)} />
              <ColorField label="Page background" value={form.color_bg} disabled={!isAdmin} onChange={(v) => set("color_bg", v)} />
              <ColorField label="Body text" value={form.color_text} disabled={!isAdmin} onChange={(v) => set("color_text", v)} />
              <ColorField label="Card surface" value={form.color_card} disabled={!isAdmin} onChange={(v) => set("color_card", v)} />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Header style</Label>
                <div>
                  <Segmented<HeaderStyle>
                    value={form.header_style}
                    disabled={!isAdmin}
                    onChange={(v) => set("header_style", v)}
                    options={[{ value: "gradient", label: "Gradient" }, { value: "solid", label: "Solid" }]}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Button shape</Label>
                <div>
                  <Segmented<ButtonShape>
                    value={form.button_shape}
                    disabled={!isAdmin}
                    onChange={(v) => set("button_shape", v)}
                    options={[{ value: "rounded", label: "Rounded" }, { value: "pill", label: "Pill" }, { value: "square", label: "Square" }]}
                  />
                </div>
              </div>
            </div>

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
          </div>

          {/* ---- Live preview (phone mock) ---- */}
          <div className="flex flex-col items-center gap-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Live preview</p>
            <div className="w-full max-w-[280px] overflow-hidden rounded-[2.2rem] border-[6px] border-neutral-800 bg-neutral-800 shadow-xl dark:border-neutral-700">
              <div style={{ backgroundColor: form.color_bg, fontFamily: previewFont }} className="min-h-[440px]">
                {/* header */}
                <div style={{ background: headerBg, color: onPrimary }} className="px-4 pb-6 pt-6">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-lg font-extrabold leading-tight">{name}</div>
                      <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-medium">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-300" />
                        Table 5
                      </span>
                    </div>
                    <span className="shrink-0 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold">Bill ₹0</span>
                  </div>
                  <p className="mt-3 text-[10px] font-medium uppercase tracking-[0.2em]" style={{ opacity: 0.7 }}>
                    Scan · Order · Pay
                  </p>
                </div>

                {/* menu */}
                <div className="space-y-2 p-4" style={{ color: form.color_text }}>
                  {[
                    { emoji: "🍕", name: "Margherita Pizza", price: "₹299" },
                    { emoji: "🥗", name: "Garden Salad", price: "₹149" },
                  ].map((it) => (
                    <div
                      key={it.name}
                      style={{ backgroundColor: form.color_card, color: form.color_text }}
                      className="flex items-center gap-3 rounded-2xl p-3 shadow-sm"
                    >
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-black/5 text-xl">{it.emoji}</div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{it.name}</div>
                        <div className="text-xs" style={{ opacity: 0.6 }}>{it.price}</div>
                      </div>
                      <button
                        type="button"
                        style={{ backgroundColor: form.color_primary, color: onPrimary, borderRadius: shapeRadius(form.button_shape) }}
                        className="px-4 py-1.5 text-xs font-semibold shadow"
                      >
                        Add
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
