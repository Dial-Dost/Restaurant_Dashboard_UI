"use client"

// What the printed bill says about the restaurant, and what it says above the
// feedback/valet QR.
//
// THREE FIELDS, ALL OPTIONAL, AND THE OPTIONALITY IS THE POINT. A bill in India
// normally carries the registered entity behind the trading name ("… HOSPITALITY
// LLP") and the GST registration; neither had anywhere to live, so neither could
// be printed. But plenty of tenants have no GSTIN and no separate entity, and
// they must get a CLEAN receipt — an unset field prints nothing at all, never an
// orphan "GSTN :" label and never a blank line where a field would have been.
//
// The QR sentence was a string literal inside the renderer, identical on every
// tenant's paper. Clearing this box restores that built-in line rather than
// printing nothing, so a restaurant that never opens this card sees no change.
//
// Pick-then-save (like the timezone card next door, unlike the OTP switch): this
// text goes on every guest's receipt, so it should take a deliberate click.
//
// THE QR ITSELF CAN BE SWITCHED OFF (migration 047). Off, the bill ends at the
// service-charge line with no QR and no sentence above one, so the message box
// is disabled rather than hidden: the owner's sentence is kept for the day they
// turn the QR back on. The switch saves with the same button as the text, for
// the same reason: it changes every guest's receipt.

import { useEffect, useState } from "react"
import { Receipt } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import type { BillPrintSettings } from "@/lib/db"
import { getBillPrintSettings, setBillPrintSettings } from "@/lib/db"

// Flutter counts the note in grapheme clusters (`characters.length`), so an
// emoji or a combined Indic letter is one character, not two or three.
const segmenter: Intl.Segmenter | null =
  typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null
const graphemes = (s: string): string[] => (segmenter ? Array.from(segmenter.segment(s), (g) => g.segment) : Array.from(s))
const graphemeCount = (s: string): number => graphemes(s).length
const capGraphemes = (s: string, max: number): string => {
  const g = graphemes(s)
  return g.length > max ? g.slice(0, max).join("") : s
}

export function BillPrintSettingsCard({ restaurantId, isAdmin }: { restaurantId: string; isAdmin: boolean }): React.JSX.Element {
  const { toast } = useToast()

  // `saved` is what the server last confirmed; the three controlled strings are
  // the pending edit. Comparing them is what drives the dirty state, so Save
  // stays disabled until something actually differs.
  const [saved, setSaved] = useState<BillPrintSettings | null>(null)
  const [legalName, setLegalName] = useState("")
  const [gstin, setGstin] = useState("")
  const [qrNote, setQrNote] = useState("")
  const [showQr, setShowQr] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!restaurantId) {return}
    let active = true
    getBillPrintSettings(restaurantId)
      .then((s) => {
        if (!active) {return}
        setSaved(s)
        setLegalName(s.legalName)
        setGstin(s.gstin)
        setQrNote(s.qrNote)
        setShowQr(s.showQr)
      })
      .catch(() => {/* fields stay empty; saving still works */})
      .finally(() => { if (active) {setLoading(false)} })
    return () => { active = false }
  }, [restaurantId])

  // The cap the backend enforces (BILL_QR_NOTE_MAX in escpos.ts), read from the
  // settings document rather than hardcoded, so the counter here can never
  // disagree with the truncation there.
  const noteMax = saved?.qrNoteMax ?? 120

  const handleSave = async (): Promise<void> => {
    if (!restaurantId) {return}
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
      // Trimmed, and sent even when empty — '' is how a field is CLEARED.
      const next = await setBillPrintSettings(restaurantId, {
        legalName: legalName.trim(),
        gstin: gstin.trim(),
        qrNote: qrNote.trim(),
        showQr,
      })
      setSaved(next)
      setLegalName(next.legalName)
      setGstin(next.gstin)
      setQrNote(next.qrNote)
      setShowQr(next.showQr)
      toast({
        title: "Bill details saved",
        description: "New bills will print with these details.",
      })
    } catch (error: unknown) {
      toast({
        title: "Couldn't save bill details",
        description: error instanceof Error ? error.message : "Unable to update the bill details.",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="h-5 w-5" />
          Bill details
        </CardTitle>
        <CardDescription>
          Printed under your restaurant name on every bill, plus the message above the
          feedback QR code. Leave a field blank and it is left off the receipt entirely.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="bill-legal-name">Registered business name</Label>
          <Input
            id="bill-legal-name"
            value={legalName}
            onChange={(e) => { setLegalName(e.target.value) }}
            placeholder="e.g. Navkrish Hospitality LLP"
            disabled={!isAdmin || loading}
          />
          <p className="text-xs text-muted-foreground">
            The legal entity behind the trading name. Printed under the restaurant name.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="bill-gstin">GSTIN</Label>
          <Input
            id="bill-gstin"
            value={gstin}
            onChange={(e) => { setGstin(e.target.value) }}
            placeholder="e.g. 29AAXFN2701Q1ZF"
            disabled={!isAdmin || loading}
          />
          <p className="text-xs text-muted-foreground">
            Printed as &quot;GSTN : …&quot;. Leave blank if you are not GST registered.
          </p>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-md border p-3">
          <div className="space-y-1">
            <Label htmlFor="bill-show-qr">Print QR code on the bill</Label>
            <p className="text-xs text-muted-foreground">
              The feedback / valet QR at the bottom of every customer bill. Turn it off to
              print bills without it.
            </p>
          </div>
          <Switch
            id="bill-show-qr"
            checked={showQr}
            onCheckedChange={(v) => { setShowQr(v) }}
            disabled={!isAdmin || loading}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="bill-qr-note">Message above the QR code</Label>
          <Textarea
            id="bill-qr-note"
            value={qrNote}
            onChange={(e) => { setQrNote(capGraphemes(e.target.value, noteMax)) }}
            placeholder={saved?.qrNoteDefault || "Scan the QR code below"}
            className="resize-none"
            rows={2}
            disabled={!isAdmin || loading || !showQr}
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {saved?.qrNoteDefault
                ? `Leave blank to use the default: “${saved.qrNoteDefault}”`
                : "Leave blank to use the built-in default."}
            </p>
            <p className="text-xs text-muted-foreground tabular-nums shrink-0">
              {graphemeCount(qrNote)}/{noteMax}
            </p>
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={() => { void handleSave() }} disabled={!isAdmin || saving || loading}>
            {saving ? "Saving…" : "Save bill details"}
          </Button>
        </div>

        {!isAdmin ? (
          <p className="text-xs text-muted-foreground">Only an admin can change what prints on the bill.</p>
        ) : null}
      </CardContent>
    </Card>
  )
}
