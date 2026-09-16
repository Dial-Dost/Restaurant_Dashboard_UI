"use client"

// WHICH KITCHEN DOCKET THIS RESTAURANT PRINTS — and the way back when the new
// one does not come out.
//
// THE FAILURE THIS CARD EXISTS FOR. The reference docket is drawn as a RASTER
// IMAGE, because the printed ticket the client approved is a proportional
// Arial-metric face and a thermal printer's built-in fonts are monospaced. Very
// nearly every thermal printer draws a raster. The ones that do not DO NOT SAY
// SO — they swallow the image and feed blank paper. On a bill printer somebody
// notices in seconds. On a KITCHEN printer it is an order nobody cooks, while
// every screen in the building says the order is fine.
//
// No printer model is on record for this estate, so that cannot be checked in
// advance. It can only be made recoverable — here, by the owner, in the minute
// after the first blank ticket, with no deploy and nobody to ring. That is the
// whole reason this control is on the Settings screen rather than being a
// constant in the renderer.
//
// SAVES ON PICK, unlike the bill-printing card next door, which batches its text
// fields behind a Save button. The difference is deliberate: that card changes
// what every GUEST's receipt says and deserves a deliberate click, while this
// one is pressed by somebody standing at a printer that is not printing. A
// second click between them and working paper is a second click too many.
//
// EDITABLE WITH THE PERMISSION THE SAVE NEEDS, not the admin role: POST
// /restaurant/settings checks "Manage Restaurant Settings", so a manager holding
// it can flip this. Same gate as the feedback and billing-counter cards.

import { useEffect, useState } from "react"
import { Printer } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useToast } from "@/hooks/use-toast"
import { getKotPrintStyle, setKotPrintStyle } from "@/lib/db"
import {
  KOT_PRINT_STYLE_DEFAULT,
  KOT_PRINT_STYLE_HELP,
  KOT_PRINT_STYLE_OPTIONS,
  isKotPrintStyle,
  type KotPrintStyle,
} from "@/lib/kot-print-style"

export function KotPrintSettingsCard({ restaurantId, canEdit }: { restaurantId: string; canEdit: boolean }) {
  const { toast } = useToast()
  const [style, setStyle] = useState<KotPrintStyle>(KOT_PRINT_STYLE_DEFAULT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!restaurantId) {return}
    let active = true
    getKotPrintStyle(restaurantId)
      .then((s) => { if (active) {setStyle(s)} })
      .catch(() => {/* the default is what an unreadable backend is printing */})
      .finally(() => { if (active) {setLoading(false)} })
    return () => { active = false }
  }, [restaurantId])

  const handleChange = async (next: string) => {
    if (!isKotPrintStyle(next) || next === style) {return}
    if (!canEdit) {
      toast({
        title: "Access denied",
        description: "You do not have permission to change printing settings.",
        variant: "destructive",
      })
      return
    }
    const previous = style
    // Moved first so the radio answers the click, then put back if the save
    // fails — a control that sat on the old value while the request was in
    // flight would be pressed again by someone in a hurry.
    setStyle(next)
    setSaving(true)
    try {
      const saved = await setKotPrintStyle(restaurantId, next)
      setStyle(saved)
      toast({
        title: "KOT print style updated",
        description: saved === "classic"
          ? "The next kitchen docket prints as plain text."
          : "The next kitchen docket prints in the reference layout.",
      })
    } catch (error: any) {
      setStyle(previous)
      toast({
        title: "Couldn't save the KOT print style",
        description: error?.message ?? "Unable to update the KOT print style.",
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
          <Printer className="h-5 w-5" />
          KOT print style
        </CardTitle>
        <CardDescription>
          How kitchen dockets are printed. This does not change the customer bill.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <RadioGroup
          value={style}
          onValueChange={(v) => { void handleChange(v) }}
          disabled={!canEdit || loading || saving}
          aria-label="KOT print style"
        >
          {KOT_PRINT_STYLE_OPTIONS.map((option) => (
            <div key={option.value} className="flex items-start gap-3 rounded-md border p-3">
              <RadioGroupItem value={option.value} id={`kot-print-style-${option.value}`} className="mt-1" />
              <div className="space-y-1">
                <Label htmlFor={`kot-print-style-${option.value}`} className="font-medium">
                  {option.label}
                </Label>
                <p className="text-xs text-muted-foreground">{option.detail}</p>
              </div>
            </div>
          ))}
        </RadioGroup>

        <p className="text-xs text-muted-foreground">{KOT_PRINT_STYLE_HELP}</p>

        {!canEdit ? (
          <p className="text-xs text-muted-foreground">
            Only someone with the settings permission can change how kitchen dockets print.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
