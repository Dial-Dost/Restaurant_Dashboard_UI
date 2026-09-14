"use client"

// VALET PARKING ON THE GUEST FEEDBACK FORM — one switch for the whole valet part.
//
// On: the form opens with the vehicle-number step and asks guests to rate valet
// parking. Off: neither — no vehicle step, no "Valet Parking" rating
// (src/lib/feedback-form.ts). It is the same `feedback_config.valet_enabled`
// the owner app's feedback card edits, so both screens agree.
//
// SAVES ON FLIP, like the table-OTP switch beside it: it is one boolean with an
// obvious undo. The form's title, welcome text, review link and categories are
// left exactly as the owner set them (see setFeedbackValetEnabled).
//
// EDITABLE WITH THE PERMISSION THE SAVE NEEDS, not the admin role: POST
// /restaurant/settings checks "Manage Restaurant Settings", whose description
// names the feedback config, so a manager role holding it can flip this — the
// same call BillingCountersCard makes.

import { useEffect, useState } from "react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { getFeedbackValetEnabled, setFeedbackValetEnabled } from "@/lib/db"

export function FeedbackValetCard({ restaurantId, canEdit }: { restaurantId: string; canEdit: boolean }) {
  const { toast } = useToast()
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!restaurantId) {return}
    let active = true
    getFeedbackValetEnabled(restaurantId)
      .then((v) => { if (active) {setEnabled(v)} })
      .catch(() => {/* leave off, the backend default */})
      .finally(() => { if (active) {setLoading(false)} })
    return () => { active = false }
  }, [restaurantId])

  const handleChange = async (next: boolean) => {
    if (!canEdit) {
      toast({
        title: "Access denied",
        description: "Changing the feedback form needs the Manage Restaurant Settings permission.",
        variant: "destructive",
      })
      return
    }
    const previous = enabled
    setEnabled(next) // optimistic
    setSaving(true)
    try {
      const saved = await setFeedbackValetEnabled(restaurantId, next)
      setEnabled(saved)
      toast({
        title: "Feedback form updated",
        description: saved
          ? "Guests are asked for their vehicle number and to rate valet parking."
          : "The feedback form no longer asks about valet parking.",
      })
    } catch (error: unknown) {
      setEnabled(previous) // revert on failure
      toast({
        title: "Couldn't save setting",
        description: error instanceof Error ? error.message : "Unable to update the valet setting.",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Feedback form</CardTitle>
        <CardDescription>What the guest feedback form (the QR on the bill) asks.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="feedback-valet" className="text-sm font-medium">Valet parking</Label>
            <p className="text-sm text-muted-foreground">
              Ask guests for their vehicle number and to rate valet parking. Turn off if you don&apos;t offer valet.
            </p>
          </div>
          <Switch
            id="feedback-valet"
            checked={enabled}
            onCheckedChange={(v) => { void handleChange(v === true) }}
            disabled={saving || loading || !canEdit}
            aria-label="Valet parking on the feedback form"
          />
        </div>
      </CardContent>
    </Card>
  )
}
