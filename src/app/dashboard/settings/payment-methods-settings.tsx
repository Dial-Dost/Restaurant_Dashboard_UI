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
//
// PAYMENTS & CURRENCY (Flutter `_PaymentSettingsCard`, modules.dart ~33383):
// the CURRENCY row sits above the modes and rides the same POST
// {currency, payment_methods}, so a currency picked here reaches every device.
// Adding a mode is a dialog; its Add saves the on-screen list plus the new mode.

import { useState, type ReactElement } from "react"
import { Plus, Zap, CreditCard } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { InfoChip } from "@/components/ui/status-chip"
import { Switch } from "@/components/ui/switch"
import { useCurrency } from "@/hooks/use-currency"
import { useToast } from "@/hooks/use-toast"
import { errorText, postSettings } from "@/lib/api/settings"
import {
    DEFAULT_PAYMENT_METHODS,
    PAYMENT_MODE_ID_MAX,
    PAYMENT_MODE_LABEL_MAX,
    newPaymentModeRefusal,
    paymentLabelRefusal,
    readPaymentMethods,
    tidyPaymentName,
    withCustomPaymentMode,
    type PaymentMethodConfig,
} from "@/lib/payment-methods"
import { cn } from "@/lib/utils"
import { SaveButton } from "@/components/settings/razorpay-messaging-cards"
import { FieldLabel, SettingsCard } from "@/components/settings/settings-card"

/** Flutter's currency presets (symbols, as the server stores them). */
const CURRENCY_PRESETS = ["₹", "$", "€", "£", "AED", "¥"]
/** The browser-side display hook still speaks codes; keep it in step with the server. */
const SYMBOL_TO_CODE: Record<string, string> = { "₹": "INR", "$": "USD", "€": "EUR", "£": "GBP" }

export function PaymentMethodsCard({ restaurantId, canEdit, initialCurrency, initialMethods }: {
    restaurantId: string
    canEdit: boolean
    initialCurrency: string
    initialMethods: unknown
}): ReactElement {
    const { toast } = useToast()
    const { setCurrency: setDisplayCurrency } = useCurrency()
    const [methods, setMethods] = useState<PaymentMethodConfig[]>(() => readPaymentMethods(initialMethods))
    const [currency, setCurrency] = useState(initialCurrency.trim() === "" ? "₹" : initialCurrency.trim())
    const [busy, setBusy] = useState(false)
    // The add dialog.
    const [adding, setAdding] = useState(false)
    const [name, setName] = useState("")
    const [needsShot, setNeedsShot] = useState(false)
    const [showGuests, setShowGuests] = useState(false)

    const currencyOptions = CURRENCY_PRESETS.includes(currency) ? CURRENCY_PRESETS : [currency, ...CURRENCY_PRESETS]

    const patch = (id: string, p: Partial<PaymentMethodConfig>): void => {
        setMethods((prev) => prev.map((m) => (m.id === id ? { ...m, ...p } : m)))
    }

    const list = methods
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
            const tidy = next.map((m) => ({ ...m, label: tidyPaymentName(m.label) }))
            const reply = await postSettings(restaurantId, { currency, payment_methods: tidy })
            setMethods(reply && Array.isArray(reply.payment_methods) ? readPaymentMethods(reply.payment_methods) : tidy)
            const code = SYMBOL_TO_CODE[currency]
            if (code) {setDisplayCurrency(code)}
            toast({ description: success })
            return true
        } catch (error: unknown) {
            // The server's own sentences (a reserved name, a clash…), verbatim.
            toast({ title: "Couldn't save payment settings", description: errorText(error, "Unable to save."), variant: "destructive" })
            return false
        } finally {
            setBusy(false)
        }
    }

    const add = async (): Promise<void> => {
        const refusal = newPaymentModeRefusal(name, list)
        if (refusal) {return}
        const id = tidyPaymentName(name)
        const ok = await save(
            withCustomPaymentMode(list, { name: id, requiresScreenshot: needsShot, showToGuests: showGuests }),
            `${id} can now be chosen when settling a bill.`,
        )
        if (ok) { setAdding(false); setName(""); setNeedsShot(false); setShowGuests(false) }
    }

    return (
        <SettingsCard
            title="Payments & currency"
            caption="Payment modes offered at the till and on the guest QR page. Add your own, rename any, or switch one off — a switched-off mode can’t be used for new payments, and past bills keep their mode."
        >
            <div className="flex items-center justify-between gap-3">
                <FieldLabel>Currency</FieldLabel>
                <Select value={currency} onValueChange={setCurrency} disabled={!canEdit || busy}>
                    <SelectTrigger className="w-28" aria-label="Currency"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {currencyOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
            <FieldLabel>Payment modes</FieldLabel>
            <div className="divide-y divide-divider rounded-lg border">
                {list.map((m) => {
                    const builtin = DEFAULT_PAYMENT_METHODS.find((d) => d.id === m.id)
                    const why = labelRefusals.find((r) => r.id === m.id)?.why
                    const showStored = m.custom === true || tidyPaymentName(m.label) !== m.id
                    return (
                        <div key={m.id} className="space-y-2 p-3" data-payment-mode={m.id}>
                            <div className="flex flex-wrap items-center gap-2">
                                <div className="min-w-[10rem] flex-1">
                                    <Input
                                        aria-label={`Label for ${m.id}`}
                                        value={m.label}
                                        maxLength={PAYMENT_MODE_LABEL_MAX}
                                        placeholder={builtin?.label ?? m.id}
                                        disabled={!canEdit || busy}
                                        className={cn(!m.enabled && "text-muted-foreground")}
                                        onChange={(e) => { patch(m.id, { label: e.target.value }) }}
                                    />
                                </div>
                                {m.custom ? <InfoChip icon={<CreditCard className="h-3 w-3" />} label="added" /> : null}
                                {m.online ? <InfoChip icon={<Zap className="h-3 w-3" />} label="online" /> : null}
                                <Switch
                                    checked={m.enabled}
                                    disabled={!canEdit || busy}
                                    onCheckedChange={(v) => { patch(m.id, { enabled: v }) }}
                                    aria-label={`${m.label} switched on`}
                                />
                            </div>
                            {why ? <p className="text-xs text-destructive">{why}</p> : null}
                            {showStored ? (
                                <p className="text-xs text-muted-foreground">Stored on bills as “{m.id}”{m.enabled ? "" : " · switched off"}</p>
                            ) : null}
                            {m.online ? null : (
                                <div className="flex flex-wrap gap-4 text-xs sm:text-sm">
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

            <div className="flex flex-wrap items-center justify-between gap-2">
                <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={!canEdit || busy} onClick={() => { setAdding(true) }}>
                    <Plus className="h-3.5 w-3.5" /> Add payment mode
                </Button>
                <SaveButton
                    busy={busy}
                    label="Save payments & currency"
                    disabled={!canEdit || labelRefusals.length > 0}
                    onClick={() => { void save(list, "Payment settings saved.") }}
                />
            </div>

            <Dialog open={adding} onOpenChange={(o) => { if (!busy) {setAdding(o)} }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader><DialogTitle>Add payment mode</DialogTitle></DialogHeader>
                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            <Label htmlFor="new-payment-mode">Name</Label>
                            <Input
                                id="new-payment-mode"
                                autoFocus
                                placeholder="e.g. Swiggy Dineout, Magicpin, HDFC card machine"
                                value={name}
                                maxLength={PAYMENT_MODE_ID_MAX}
                                disabled={busy}
                                onChange={(e) => { setName(e.target.value) }}
                                onKeyDown={(e) => {
                                    if (e.key !== "Enter") {return}
                                    e.preventDefault()
                                    if (!busy && name.trim() && addRefusal === null) {void add()}
                                }}
                            />
                            {addRefusal ? <p className="text-xs text-destructive">{addRefusal}</p> : null}
                        </div>
                        <label className="flex items-center gap-2 text-sm">
                            <Checkbox checked={needsShot} disabled={busy} onCheckedChange={(v) => { setNeedsShot(v === true) }} />
                            Require payment screenshot
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                            <Checkbox checked={showGuests} disabled={busy} onCheckedChange={(v) => { setShowGuests(v === true) }} />
                            Show on guest QR page
                        </label>
                        <p className="text-xs text-muted-foreground">
                            The name is permanent — it is what bills and reports record — but the label can be changed
                            later. Modes you add count as non-cash: the cash drawer counts Cash only. For free food use
                            “Mark as non-chargeable” on the bill, not a payment mode.
                        </p>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="ghost" disabled={busy} onClick={() => { setAdding(false) }}>Cancel</Button>
                        <Button type="button" disabled={busy || !name.trim() || addRefusal !== null} onClick={() => { void add() }}>Add</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </SettingsCard>
    )
}
