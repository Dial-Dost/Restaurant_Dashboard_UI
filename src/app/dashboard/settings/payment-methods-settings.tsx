"use client"

// PAYMENT MODES — which ways this restaurant takes money, and adding its own.
//
// "There has to be an option to add mode of payments, it's not there." The web
// had no payment settings at all, and the owner app's card could only switch the
// eight built-ins on or off for the guest QR page. This card edits the same
// `payment_methods` the owner app's Settings > Payments card edits, and every
// picker that takes money (Orders' Confirm Payment and split dialog, the tender
// form, the owner app's settle sheet) reads it.
//
// THE RULES THIS SCREEN KEEPS, each for money:
//   * A NEW MODE'S NAME IS PERMANENT. It is what every bill settled with it
//     stores and what reports group by, so only its LABEL can be changed later.
//   * NOTHING IS DELETED. "Switch off" keeps the mode so its bills keep their
//     name; a switched-off mode is refused for new payments.
//   * SOME NAMES ARE REFUSED: "Complimentary" / "NC" / "Staff meal" (a free meal
//     is not money collected — use Mark as non-chargeable), "Credit" / "Due"
//     (the bill would close as paid with nothing received), and anything that is
//     already a built-in or a report row. The server refuses them regardless
//     (400, shown here verbatim); the check below only says so sooner.
//   * A MODE YOU ADD IS NOT CASH. The drawer and "Cash collection" count only
//     Cash, so the copy says it.
//
// SAVES THE WHOLE LIST, and the server merges: a mode missing from a save — an
// older app that has never heard of it — is kept, never erased.

import { useCallback, useEffect, useState, type ReactElement } from "react"
import { Loader2, Plus, Save } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { getPaymentMethods, savePaymentMethods } from "@/lib/db"
import {
    DEFAULT_PAYMENT_METHODS,
    PAYMENT_MODE_ID_MAX,
    PAYMENT_MODE_LABEL_MAX,
    newPaymentModeRefusal,
    paymentLabelRefusal,
    tidyPaymentName,
    withCustomPaymentMode,
    type PaymentMethodConfig,
} from "@/lib/payment-methods"

export function PaymentMethodsCard({ restaurantId, canEdit }: { restaurantId: string; canEdit: boolean }): ReactElement {
    const { toast } = useToast()
    const [methods, setMethods] = useState<PaymentMethodConfig[] | null>(null)
    const [failed, setFailed] = useState(false)
    const [busy, setBusy] = useState(false)
    const [dirty, setDirty] = useState(false)
    // The add form.
    const [name, setName] = useState("")
    const [needsShot, setNeedsShot] = useState(false)
    const [showGuests, setShowGuests] = useState(false)

    const load = useCallback(() => {
        setFailed(false)
        getPaymentMethods(restaurantId)
            .then((m) => { setMethods(m); setDirty(false) })
            .catch(() => { setFailed(true) })
    }, [restaurantId])
    useEffect(() => { if (restaurantId) {load()} }, [restaurantId, load])

    const patch = (id: string, p: Partial<PaymentMethodConfig>): void => {
        setMethods((prev) => (prev ?? []).map((m) => (m.id === id ? { ...m, ...p } : m)))
        setDirty(true)
    }

    const list = methods ?? []
    const addRefusal = name.trim() ? newPaymentModeRefusal(name, list) : null
    const labelRefusals = list
        .map((m) => ({ id: m.id, why: paymentLabelRefusal(m.label, m.id, list) }))
        .filter((r): r is { id: string; why: string } => r.why !== null)

    const save = async (next: PaymentMethodConfig[], success: string): Promise<boolean> => {
        if (!canEdit) {
            toast({ title: "Access denied", description: "Changing payment modes needs the Manage Restaurant Settings permission.", variant: "destructive" })
            return false
        }
        setBusy(true)
        try {
            const saved = await savePaymentMethods(restaurantId, next.map((m) => ({ ...m, label: tidyPaymentName(m.label) })))
            setMethods(saved)
            setDirty(false)
            toast({ title: "Payment modes saved", description: success })
            return true
        } catch (error: unknown) {
            // The server's own sentences (a reserved name, a clash…), verbatim.
            toast({ title: "Couldn't save payment modes", description: error instanceof Error ? error.message : "Unable to save.", variant: "destructive" })
            return false
        } finally {
            setBusy(false)
        }
    }

    const add = async (): Promise<void> => {
        const refusal = newPaymentModeRefusal(name, list)
        if (refusal) {
            toast({ title: "Can't add that payment mode", description: refusal, variant: "destructive" })
            return
        }
        const id = tidyPaymentName(name)
        const ok = await save(
            withCustomPaymentMode(list, { name: id, requiresScreenshot: needsShot, showToGuests: showGuests }),
            `${id} can now be chosen when settling a bill.`,
        )
        if (ok) { setName(""); setNeedsShot(false); setShowGuests(false) }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Payment modes</CardTitle>
                <CardDescription>
                    Payment modes offered at the till and on the guest QR page. Add your own (an aggregator, a card
                    machine, a bank), rename any, or switch one off — switched-off modes can&apos;t be used for new
                    payments, and past bills keep their mode.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {failed ? (
                    <div className="flex items-center justify-between gap-3 rounded-lg border p-4 text-sm">
                        <span className="text-muted-foreground">Couldn&apos;t load this restaurant&apos;s payment modes.</span>
                        <Button variant="outline" size="sm" onClick={load}>Try again</Button>
                    </div>
                ) : methods === null ? (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
                ) : (
                    <>
                        <div className="divide-y rounded-lg border">
                            {list.map((m) => {
                                const builtin = DEFAULT_PAYMENT_METHODS.find((d) => d.id === m.id)
                                const why = labelRefusals.find((r) => r.id === m.id)?.why
                                return (
                                    <div key={m.id} className="space-y-2 p-3" data-payment-mode={m.id}>
                                        <div className="flex flex-wrap items-center gap-3">
                                            <div className="min-w-[10rem] flex-1">
                                                <Input
                                                    aria-label={`Label for ${m.id}`}
                                                    value={m.label}
                                                    maxLength={PAYMENT_MODE_LABEL_MAX}
                                                    placeholder={builtin?.label ?? m.id}
                                                    disabled={!canEdit || busy}
                                                    onChange={(e) => { patch(m.id, { label: e.target.value }) }}
                                                />
                                            </div>
                                            {m.custom ? <Badge variant="outline">Added</Badge> : null}
                                            {m.online ? <Badge variant="secondary">Online</Badge> : null}
                                            {!m.enabled ? <Badge variant="secondary">Off</Badge> : null}
                                            <Switch
                                                checked={m.enabled}
                                                disabled={!canEdit || busy}
                                                onCheckedChange={(v) => { patch(m.id, { enabled: v }) }}
                                                aria-label={`${m.label} switched on`}
                                            />
                                        </div>
                                        {why ? <p className="text-xs text-red-600">{why}</p> : null}
                                        {m.label.trim() && tidyPaymentName(m.label) !== m.id ? (
                                            <p className="text-xs text-muted-foreground">Stored on bills as “{m.id}”.</p>
                                        ) : null}
                                        {m.online ? null : (
                                            <div className="flex flex-wrap gap-4 text-sm">
                                                <label className="flex items-center gap-2">
                                                    <Checkbox
                                                        checked={m.requires_screenshot}
                                                        disabled={!canEdit || busy}
                                                        onCheckedChange={(v) => { patch(m.id, { requires_screenshot: v === true }) }}
                                                    />
                                                    Require payment screenshot
                                                </label>
                                                <label className="flex items-center gap-2">
                                                    <Checkbox
                                                        checked={m.show_to_guests !== false}
                                                        disabled={!canEdit || busy}
                                                        onCheckedChange={(v) => { patch(m.id, { show_to_guests: v === true }) }}
                                                    />
                                                    Show on guest QR page
                                                </label>
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>

                        <div className="flex justify-end">
                            <Button
                                size="sm" className="gap-1"
                                disabled={!canEdit || busy || !dirty || labelRefusals.length > 0}
                                onClick={() => { void save(list, "Every till picks up the change on its next load.") }}
                            >
                                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save changes
                            </Button>
                        </div>

                        <div className="space-y-3 rounded-lg border p-3">
                            <Label htmlFor="new-payment-mode" className="text-sm font-medium">Add payment mode</Label>
                            <Input
                                id="new-payment-mode"
                                placeholder="e.g. Swiggy Dineout, Magicpin, HDFC card machine"
                                value={name}
                                maxLength={PAYMENT_MODE_ID_MAX}
                                disabled={!canEdit || busy}
                                onChange={(e) => { setName(e.target.value) }}
                            />
                            {addRefusal ? <p className="text-xs text-red-600">{addRefusal}</p> : null}
                            <div className="flex flex-wrap gap-4 text-sm">
                                <label className="flex items-center gap-2">
                                    <Checkbox checked={needsShot} disabled={!canEdit || busy} onCheckedChange={(v) => { setNeedsShot(v === true) }} />
                                    Require payment screenshot
                                </label>
                                <label className="flex items-center gap-2">
                                    <Checkbox checked={showGuests} disabled={!canEdit || busy} onCheckedChange={(v) => { setShowGuests(v === true) }} />
                                    Show on guest QR page
                                </label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                The name is permanent — it is what bills and reports record — but the label can be changed
                                later. Modes you add count as non-cash: the cash drawer and “Cash collection” include Cash only.
                                For free food use “Mark as non-chargeable” on the bill, not a payment mode.
                            </p>
                            <div className="flex justify-end">
                                <Button
                                    size="sm" variant="outline" className="gap-1"
                                    disabled={!canEdit || busy || !name.trim() || addRefusal !== null || dirty}
                                    title={dirty ? "Save or reload your other changes first" : undefined}
                                    onClick={() => { void add() }}
                                >
                                    <Plus className="h-3.5 w-3.5" /> Add payment mode
                                </Button>
                            </div>
                            {dirty ? <p className="text-xs text-muted-foreground">Save your changes above before adding a new mode.</p> : null}
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    )
}
