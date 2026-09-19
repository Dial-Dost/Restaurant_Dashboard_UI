"use client"

// BILLING & TAXES group — Flutter `_TaxSettingsCard` (modules.dart
// 33986–34146), `_BillingControlsCard` (33201–33307) and `_BillLogoCard`
// (31830–32035).

import * as React from "react"
import { FileUp, Image as ImageIcon, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MicroStat } from "@/components/ui/micro-stat"
import { StatusChip } from "@/components/ui/status-chip"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { errorText, postSettings, scalarText } from "@/lib/api/settings"
import { cn } from "@/lib/utils"

import { SaveButton } from "./razorpay-messaging-cards"
import { FieldLabel, Hint, SettingsCard } from "./settings-card"

/* ── Taxes & service charge ─────────────────────────────────────────── */

interface TaxRow { key: number; name: string; percentage: string }

const pctNum = (v: unknown): number => {
  if (typeof v === "number" && Number.isFinite(v)) {return v}
  const n = Number.parseFloat(scalarText(v))
  return Number.isFinite(n) ? n : 0
}

export function TaxCard({ rid, initialTaxes, initialServiceCharge, onSaved }: {
  rid: string; initialTaxes: unknown[]; initialServiceCharge: number; onSaved: () => void
}): React.JSX.Element {
  const { toast } = useToast()
  const nextKey = React.useRef(0)
  const [rows, setRows] = React.useState<TaxRow[]>(() =>
    initialTaxes
      .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
      .map((t) => ({ key: nextKey.current++, name: scalarText(t.name), percentage: String(pctNum(t.percentage)) })),
  )
  const [sc, setSc] = React.useState(initialServiceCharge > 0 ? String(initialServiceCharge) : "")
  const [busy, setBusy] = React.useState(false)

  const patch = (key: number, p: Partial<TaxRow>): void => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)))
  }
  const configured = rows.filter((r) => r.name.trim())

  const save = (): void => {
    const clean = rows
      .map((r) => ({ name: r.name.trim(), percentage: pctNum(r.percentage) }))
      .filter((t) => t.name && t.percentage >= 0)
    const serviceCharge = pctNum(sc)
    setBusy(true)
    void postSettings(rid, { taxes: clean, service_charge: serviceCharge })
      .then(() => { toast({ description: "Taxes & service charge saved." }); onSaved() })
      .catch((e: unknown) => { toast({ variant: "destructive", description: errorText(e) }) })
      .finally(() => { setBusy(false) })
  }

  return (
    <SettingsCard
      title="Taxes & service charge"
      caption="Add a service charge and taxes (e.g. CGST 2.5%, SGST 2.5%). These are added on top of the subtotal in the final bill."
    >
      {configured.length > 0 ? (
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {configured.map((t) => (
            <MicroStat key={t.key} value={`${pctNum(t.percentage)}%`} label={t.name.trim()} />
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <FieldLabel htmlFor="service-charge">Service charge</FieldLabel>
          <Hint>Applied to the subtotal (before tax). Leave 0 to disable.</Hint>
        </div>
        <div className="relative w-28">
          <Input id="service-charge" inputMode="decimal" placeholder="0" value={sc} disabled={busy} className="pr-7 tabular-nums text-right"
            onChange={(e) => { setSc(e.target.value.replace(/[^0-9.]/g, "")) }} />
          <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-muted-foreground">%</span>
        </div>
      </div>
      {rows.length === 0 ? (
        <Hint>No taxes configured. Bills will show the subtotal only.</Hint>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center gap-2">
              <Input aria-label="Tax name" placeholder="Tax name" value={r.name} disabled={busy} className="min-w-0 flex-1"
                onChange={(e) => { patch(r.key, { name: e.target.value }) }} />
              <div className="relative w-24 shrink-0">
                <Input aria-label="Tax percentage" inputMode="decimal" placeholder="0" value={r.percentage} disabled={busy} className="pr-7 tabular-nums text-right"
                  onChange={(e) => { patch(r.key, { percentage: e.target.value.replace(/[^0-9.]/g, "") }) }} />
                <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-muted-foreground">%</span>
              </div>
              <Button type="button" variant="ghost" size="icon" title="Remove tax" aria-label="Remove tax" disabled={busy}
                onClick={() => { setRows((rs) => rs.filter((x) => x.key !== r.key)) }}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={busy}
          onClick={() => { setRows((rs) => [...rs, { key: nextKey.current++, name: "", percentage: "0" }]) }}>
          <Plus className="h-3.5 w-3.5" /> Add tax
        </Button>
        <SaveButton busy={busy} label="Save taxes" onClick={save} />
      </div>
    </SettingsCard>
  )
}

/* ── Billing controls ───────────────────────────────────────────────── */

export function BillingControlsCard({ rid, initialThreshold, initialReopenWindow, onSaved }: {
  rid: string; initialThreshold: number; initialReopenWindow: number; onSaved: () => void
}): React.JSX.Element {
  const { toast } = useToast()
  const [threshold, setThreshold] = React.useState(String(initialThreshold))
  const [reopen, setReopen] = React.useState(String(initialReopenWindow))
  const [busy, setBusy] = React.useState(false)

  const save = (): void => {
    const t = threshold.trim() === "" ? 0 : Number.parseFloat(threshold)
    if (!Number.isFinite(t) || t < 0) {
      toast({ variant: "destructive", description: "Discount threshold must be a non-negative amount." })
      return
    }
    const r = Number.parseInt(reopen.trim(), 10)
    if (!Number.isFinite(r) || r < 0 || !/^\d+$/.test(reopen.trim())) {
      toast({ variant: "destructive", description: "Re-open window must be a non-negative number of minutes." })
      return
    }
    setBusy(true)
    void postSettings(rid, { discount_approval_threshold: t, bill_reopen_window_min: r })
      .then(() => { toast({ description: "Billing controls saved." }); onSaved() })
      .catch((e: unknown) => { toast({ variant: "destructive", description: errorText(e) }) })
      .finally(() => { setBusy(false) })
  }

  return (
    <SettingsCard title="Billing controls" caption="Manager approval for large staff discounts + how long a closed bill stays re-openable.">
      <div className="space-y-1.5">
        <FieldLabel htmlFor="discount-threshold">Discount approval threshold</FieldLabel>
        <Input id="discount-threshold" inputMode="decimal" placeholder="0" value={threshold} disabled={busy} className="max-w-[12rem] tabular-nums"
          onChange={(e) => { setThreshold(e.target.value) }} />
        <Hint>Staff discounts above this amount need manager approval. 0 = every discount applies directly.</Hint>
      </div>
      <div className="space-y-1.5">
        <FieldLabel htmlFor="reopen-window">Bill re-open window (minutes)</FieldLabel>
        <Input id="reopen-window" inputMode="numeric" placeholder="240" value={reopen} disabled={busy} className="max-w-[12rem] tabular-nums"
          onChange={(e) => { setReopen(e.target.value) }} />
        <Hint>How long after settling a bill an admin can still re-open it.</Hint>
      </div>
      <SaveButton busy={busy} label="Save" onClick={save} />
    </SettingsCard>
  )
}

/* ── Bill printing (paper width + SVG bill logo) ────────────────────── */

export function BillLogoCard({ rid, initialSvg, initialPaperWidth, onSaved }: {
  rid: string; initialSvg: string; initialPaperWidth: string; onSaved: () => void
}): React.JSX.Element {
  const { toast } = useToast()
  const [svg, setSvg] = React.useState(initialSvg)
  const [savedSvg, setSavedSvg] = React.useState(initialSvg)
  const [paper, setPaper] = React.useState(initialPaperWidth === "58mm" ? "58mm" : "80mm")
  const [busy, setBusy] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const hasLogo = savedSvg.trim().length > 0

  const savePaper = (v: string): void => {
    if (busy || v === paper) {return}
    const prev = paper
    setPaper(v)
    setBusy(true)
    void postSettings(rid, { bill_paper_width: v })
      .then(() => { toast({ description: `Paper size set to ${v}.` }) })
      .catch((e: unknown) => { setPaper(prev); toast({ variant: "destructive", description: errorText(e) }) })
      .finally(() => { setBusy(false) })
  }

  const saveLogo = (clear: boolean): void => {
    const value = clear ? "" : svg.trim()
    if (!clear && value && !value.toLowerCase().includes("<svg")) {
      toast({ variant: "destructive", description: "Enter valid SVG markup (must contain an <svg> tag)." })
      return
    }
    setBusy(true)
    void postSettings(rid, { bill_logo_svg: value })
      .then(() => {
        setSavedSvg(value)
        if (clear) {setSvg("")}
        toast({ description: clear ? "Bill logo cleared." : "Bill logo saved." })
        onSaved()
      })
      .catch((e: unknown) => { toast({ variant: "destructive", description: errorText(e) }) })
      .finally(() => { setBusy(false) })
  }

  const pickFile = (file: File | undefined): void => {
    if (!file) {return}
    file.text()
      .then((text) => {
        if (!text.toLowerCase().includes("<svg")) {
          toast({ variant: "destructive", description: "That file doesn't look like an SVG." })
          return
        }
        setSvg(text)
      })
      .catch(() => { toast({ variant: "destructive", description: "Could not read the file." }) })
  }

  return (
    <SettingsCard
      title="Bill printing"
      caption="Thermal paper size + a vector (SVG) logo printed at the top of the bill (crisp at any size, separate from the customer-page logo). Paste the SVG markup or load a .svg file."
    >
      <div className="flex items-center justify-between gap-3">
        <FieldLabel>Thermal paper size</FieldLabel>
        <div role="radiogroup" aria-label="Thermal paper size" className="inline-flex rounded-full border bg-inset p-0.5">
          {["80mm", "58mm"].map((v) => (
            <button key={v} type="button" role="radio" aria-checked={paper === v} disabled={busy}
              onClick={() => { savePaper(v) }}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors duration-fast disabled:opacity-60",
                paper === v ? "bg-accent-base text-accent-on" : "text-muted-foreground hover:text-foreground",
              )}>
              {v}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border bg-[#FAFAF7]", hasLogo ? "border-accent-base/60" : "border-border")}>
          {hasLogo ? (
            <img alt="Bill logo" className="max-h-11 max-w-11" src={`data:image/svg+xml;utf8,${encodeURIComponent(savedSvg)}`} />
          ) : (
            <ImageIcon className="h-[22px] w-[22px] text-[#9A978F]" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{hasLogo ? "Bill logo is set" : "No bill logo yet"}</div>
          <div className="micro-label">Bill header · SVG</div>
        </div>
        <StatusChip dense status={hasLogo ? "success" : "neutral"} label={hasLogo ? "Set" : "Empty"} />
      </div>
      <div className="space-y-1.5">
        <FieldLabel htmlFor="bill-logo-svg">SVG markup</FieldLabel>
        <Textarea id="bill-logo-svg" rows={5} value={svg} disabled={busy} spellCheck={false} className="font-mono text-xs"
          placeholder={'<svg xmlns="http://www.w3.org/2000/svg" ...> … </svg>'}
          onChange={(e) => { setSvg(e.target.value) }} />
      </div>
      <input ref={fileRef} type="file" accept=".svg,image/svg+xml" className="hidden"
        onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = "" }} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={busy} onClick={() => fileRef.current?.click()}>
          <FileUp className="h-3.5 w-3.5" /> Load .svg file
        </Button>
        <div className="flex items-center gap-2">
          {hasLogo ? (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { saveLogo(true) }}>Clear</Button>
          ) : null}
          <SaveButton busy={busy} label="Save bill logo" onClick={() => { saveLogo(false) }} />
        </div>
      </div>
    </SettingsCard>
  )
}
