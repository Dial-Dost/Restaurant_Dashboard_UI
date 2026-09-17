"use client"

// WHICH KITCHEN DOCKET THIS RESTAURANT PRINTS — and the way back when the new
// one does not come out.
//
// THE FAILURE THIS CARD EXISTS FOR. The reference docket is drawn as a RASTER
// IMAGE, because the printed ticket the client approved is set in a
// proportional face and a thermal printer's built-in fonts are monospaced. Very
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
//
// KOT TEXT SIZE, the second control. The client, having printed the reference
// docket: "The font sizes must be smaller in the KOT." Small / Standard (their
// reference ticket exactly) / Large, saved on pick like the style and for the
// same reason — whoever changes it is comparing paper. It sizes the reference
// docket only; the classic text docket ignores it, which the copy says and the
// card repeats while classic is selected.
//
// "PRINT A TEST KOT", the third control (client item 5): one test docket in the
// style and size above, via the existing POST /print/test, so whoever changed
// either can read the paper instead of waiting for the next order. Online only;
// one tap is one slip; a refusal shows the server's sentence. The handler is
// kotTestPrintHandler in src/lib/kot-print-style.ts, where the web suite can
// press it. Not gated on canEdit: the route checks the PRINT permission, not
// the settings one, and says so itself when it refuses. It IS off while a style
// or size save is out (the server reads both when it builds the slip, and the
// card has already moved), and the choices are off while a test is out:
// kotDocketCardLocks. Under a slip no device printed, the toast says the server
// keeps it for a few minutes for a kitchen device that connects late.
//
// NOT SHOWN AGAINST A BACKEND WITHOUT THE SETTINGS. The one live before them
// sends neither key, prints only the classic docket, and answers a save of them
// with 200 and nothing stored. Showing "Match the reference docket" there would
// describe paper that kitchen never gets, so the card renders nothing once the
// read says so — and a save whose reply lacks the key (a backend rolled back
// since the read) raises, and is put back like any refused save.

import { useEffect, useMemo, useState } from "react"
import { Printer } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useToast } from "@/hooks/use-toast"
import { getKotDocketSettings, printTestKot, setKotPrintStyle, setKotTextSize } from "@/lib/db"
import {
  KOT_PRINT_STYLE_DEFAULT,
  KOT_PRINT_STYLE_HELP,
  KOT_PRINT_STYLE_OPTIONS,
  KOT_TEST_PRINT_HELP,
  KOT_TEST_PRINT_LABEL,
  KOT_TEST_PRINT_SENDING,
  KOT_TEXT_SIZE_CLASSIC_NOTE,
  KOT_TEXT_SIZE_DEFAULT,
  KOT_TEXT_SIZE_HELP,
  KOT_TEXT_SIZE_OPTIONS,
  isKotPrintStyle,
  isKotTextSize,
  kotDocketCardLocks,
  kotTestPrintHandler,
  type KotPrintStyle,
  type KotTextSize,
} from "@/lib/kot-print-style"

export function KotPrintSettingsCard({ restaurantId, canEdit }: { restaurantId: string; canEdit: boolean }) {
  const { toast } = useToast()
  const [style, setStyle] = useState<KotPrintStyle>(KOT_PRINT_STYLE_DEFAULT)
  const [textSize, setTextSize] = useState<KotTextSize>(KOT_TEXT_SIZE_DEFAULT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [supported, setSupported] = useState(true)
  const [testing, setTesting] = useState(false)

  // Made once per restaurant, so its in-flight guard outlives a re-render.
  const printTest = useMemo(() => kotTestPrintHandler({
    online: () => typeof window === "undefined" || window.navigator.onLine,
    send: () => printTestKot(restaurantId),
    notify: ({ title, description, failed }) => {
      toast(failed ? { title, description, variant: "destructive" } : { title, description })
    },
    busy: setTesting,
  }), [restaurantId, toast])

  useEffect(() => {
    if (!restaurantId) {return}
    let active = true
    getKotDocketSettings(restaurantId)
      .then((s) => { if (active) { setStyle(s.style); setTextSize(s.textSize); setSupported(s.supported) } })
      .catch(() => {/* cannot tell: the card stays, on the defaults — see getKotDocketSettings */})
      .finally(() => { if (active) {setLoading(false)} })
    return () => { active = false }
  }, [restaurantId])

  const refuseWithoutPermission = (): boolean => {
    if (canEdit) {return false}
    toast({
      title: "Access denied",
      description: "You do not have permission to change printing settings.",
      variant: "destructive",
    })
    return true
  }

  // Which controls are off this render. The handlers below repeat the
  // save/test half, as a second lock behind the disabled radio groups.
  const locks = kotDocketCardLocks({ canEdit, loading, saving, testing })

  const handleChange = async (next: string) => {
    if (!isKotPrintStyle(next) || next === style) {return}
    if (saving || testing) {return}
    if (refuseWithoutPermission()) {return}
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

  const handleSizeChange = async (next: string): Promise<void> => {
    if (!isKotTextSize(next) || next === textSize) {return}
    if (saving || testing) {return}
    if (refuseWithoutPermission()) {return}
    const previous = textSize
    // Moved first, put back on a failed save — the same rule as the style.
    setTextSize(next)
    setSaving(true)
    try {
      const saved = await setKotTextSize(restaurantId, next)
      setTextSize(saved)
      toast({
        title: "KOT text size updated",
        description: style === "classic"
          ? "Saved. It applies when the kitchen is back on the new docket."
          : `The next kitchen docket prints at the ${saved} size.`,
      })
    } catch (error: unknown) {
      setTextSize(previous)
      toast({
        title: "Couldn't save the KOT text size",
        description: error instanceof Error ? error.message : "Unable to update the KOT text size.",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  if (!supported) {return null}

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
          disabled={locks.choicesDisabled}
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

        <div className="space-y-2 border-t pt-4">
          <Label className="font-medium" id="kot-text-size-label">KOT text size</Label>
          <RadioGroup
            value={textSize}
            onValueChange={(v) => { void handleSizeChange(v) }}
            disabled={locks.choicesDisabled}
            aria-labelledby="kot-text-size-label"
            className="grid gap-2 sm:grid-cols-3"
          >
            {KOT_TEXT_SIZE_OPTIONS.map((option) => (
              <div key={option.value} className="flex items-start gap-3 rounded-md border p-3">
                <RadioGroupItem value={option.value} id={`kot-text-size-${option.value}`} className="mt-1" />
                <div className="space-y-1">
                  <Label htmlFor={`kot-text-size-${option.value}`} className="font-medium">
                    {option.label}
                  </Label>
                  <p className="text-xs text-muted-foreground">{option.detail}</p>
                </div>
              </div>
            ))}
          </RadioGroup>
          <p className="text-xs text-muted-foreground">{KOT_TEXT_SIZE_HELP}</p>
          {style === "classic" ? (
            <p className="text-xs font-medium text-muted-foreground">{KOT_TEXT_SIZE_CLASSIC_NOTE}</p>
          ) : null}
        </div>

        <div className="space-y-2 border-t pt-4">
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => { void printTest() }}
            disabled={locks.testDisabled}
            data-testid="kot-test-print"
          >
            <Printer className="h-4 w-4" />
            {testing ? KOT_TEST_PRINT_SENDING : KOT_TEST_PRINT_LABEL}
          </Button>
          <p className="text-xs text-muted-foreground">{KOT_TEST_PRINT_HELP}</p>
        </div>

        {!canEdit ? (
          <p className="text-xs text-muted-foreground">
            Only someone with the settings permission can change how kitchen dockets print.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
