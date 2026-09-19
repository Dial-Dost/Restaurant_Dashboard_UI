"use client"

/*
  ROUND 2 ITEM 1 + CLIENT ITEM 7 — "Edit name / GSTIN / address" on a SETTLED
  bill (history.md findings 32, 49). The web port of Flutter's
  `_BillCustomerNameDialog` + `_EditSettledBillCustomerButton`
  (restaurant_owner_app/lib/screens/bill_customer_name.dart).

  WHY NOT the shared `bill-customer-dialog.tsx`: that dialog edits name + GSTIN
  only and serves the LIVE-table route too; the address is a settled-surface
  requirement this module owns. The validation primitives (GSTIN pattern, the
  placeholder rule) are still the shared ones from `src/lib/bill-customer.ts` —
  one definition of a GSTIN, two dialogs reading it.

  THE ADDRESS IS SEEN BEFORE IT IS EDITED. A LIST ROW never carries the address,
  so the row's button reads GET /bills/closed/:id first and opens the dialog
  with the address the invoice really carries. When that read fails, the box
  opens empty and the address goes out only if somebody typed one
  (`billAddressToSend`) — sending the row's "nothing" would wipe an address off
  the invoice that nobody on this screen had seen.
*/

import { useEffect, useRef, useState, type ReactElement } from "react"
import { UserRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { billCustomerSeed, gstinAsTyped, gstinError, gstinToSend } from "@/lib/bill-customer"
import { fetchClosedBillDetail, saveSettledBillCustomer } from "@/lib/api/history"
import {
  ADDRESS_HELP,
  ADDRESS_MAX_CHARS,
  ADDRESS_MAX_LINES,
  ADDRESS_NOT_SAVED_MESSAGE,
  billAddressError,
  billAddressSeed,
  billAddressToSend,
  billAddressUsage,
  normalizeBillAddress,
} from "@/components/history/settled-bill-lib"

/** The label on every control that opens the dialog — the Flutter words. */
export const BILL_CUSTOMER_EDIT_LABEL = "Edit name / GSTIN / address"

/** What a save answered, for the caller to repaint its row / sheet with. */
export interface SettledBillCustomerSaved {
  customer: string | null
  customer_gstin: string | null
  /** Present only when the server's answer carried the field — a row that
   *  never knew the address must not start claiming one. */
  customer_address?: string | null
}

/** The bill payload the dialog seeds itself from (a row or the full detail). */
export interface SettledBillCustomerSeed {
  id: string
  bill_no?: string | null
  customer?: string | null
  customer_gstin?: string | null
  customer_address?: string | null
  /** True when the payload REALLY carried `customer_address` (the detail). */
  addressKnown: boolean
}

export function SettledBillCustomerDialog({
  open,
  onOpenChange,
  restaurantId,
  seed,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  restaurantId: string
  seed: SettledBillCustomerSeed | null
  onSaved: (saved: SettledBillCustomerSaved) => void
}): ReactElement {
  const { toast } = useToast()
  const [customerName, setCustomerName] = useState("")
  const [gstin, setGstin] = useState("")
  const [gstinKnown, setGstinKnown] = useState(false)
  const [gstinTouched, setGstinTouched] = useState(false)
  /** Shown only once Save has been tried, cleared as soon as the box is
   *  edited — a GSTIN is typed a character at a time, and every one of the
   *  first fourteen is "wrong". */
  const [gstinMessage, setGstinMessage] = useState<string | null>(null)
  const [address, setAddress] = useState("")
  const [addressTouched, setAddressTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  // Read once PER OPENING, through a ref: a host re-rendering under the open
  // dialog (a poll, a list refresh) must not overwrite what is being typed.
  const seedRef = useRef(seed)
  seedRef.current = seed

  useEffect(() => {
    if (!open) { return }
    const s = seedRef.current
    const base = billCustomerSeed(s)
    setCustomerName(base.customer)
    setGstin(base.gstin)
    setGstinKnown(base.gstinKnown)
    setGstinTouched(false)
    setGstinMessage(null)
    setAddress(s?.addressKnown ? billAddressSeed(s.customer_address) : "")
    setAddressTouched(false)
    setServerError(null)
  }, [open])

  const addressLimit = billAddressError(address)
  const usage = billAddressUsage(address)
  const billNo = (seed?.bill_no ?? "").trim()

  const save = async (): Promise<void> => {
    const s = seedRef.current
    if (!s) { return }
    const gstinProblem = gstinError(gstin)
    if (gstinProblem !== null) { setGstinMessage(gstinProblem); return }
    if (addressLimit !== null) { return }
    const seedAddress = s.addressKnown ? billAddressSeed(s.customer_address) : ""
    // ONLY A CHANGE GOES OUT — see billAddressToSend.
    const sendAddress = billAddressToSend({
      address,
      seed: seedAddress,
      known: s.addressKnown,
      touched: addressTouched,
    })
    const normalisedAddress = normalizeBillAddress(address)
    setBusy(true)
    setServerError(null)
    try {
      const sendGstin = gstinToSend(gstin, gstinKnown, gstinTouched)
      const r = await saveSettledBillCustomer(restaurantId, s.id, {
        customer: customerName,
        ...(sendGstin === undefined ? {} : { gstin: sendGstin }),
        ...(sendAddress ? { address: normalisedAddress } : {}),
      })
      if (!r.ok) {
        // The route missing means one specific thing: the web is a release
        // ahead of the API — the Flutter sentence for the settled route.
        const message = r.outdated
          ? "This server has not finished updating, so the name, GSTIN and address on a settled bill cannot be changed from here yet. Ask your administrator to complete the update."
          : r.message
        if (r.outdated) {
          toast({ title: "Not available yet", description: message, variant: "destructive" })
        }
        // The SERVER's sentence, verbatim, where the person is looking.
        setServerError(message)
        return
      }
      // A server a release behind keeps the name and GSTIN and ignores a field
      // it has never heard of; say so rather than let the paper say it.
      const addressIgnored = sendAddress && normalisedAddress !== "" && r.customer_address === undefined
      const gstinIgnored = sendGstin !== undefined && sendGstin.trim() !== "" && !r.gstinSaved
      const what = sendAddress ? "Name, GSTIN and address" : "Name and GSTIN"
      if (gstinIgnored) {
        toast({
          title: "Name saved — GSTIN not saved",
          description: "This server has not finished updating, so the GSTIN could not be stored yet. Ask your administrator to complete the update.",
          variant: "destructive",
        })
      } else {
        toast({
          title: billNo === "" ? `${what} updated on the bill.` : `${what} updated on Bill #${billNo}.`,
          ...(addressIgnored ? { description: ADDRESS_NOT_SAVED_MESSAGE, variant: "destructive" as const } : {}),
        })
      }
      onSaved({
        customer: r.customer,
        customer_gstin: r.customer_gstin,
        ...(r.customer_address === undefined ? {} : { customer_address: r.customer_address }),
      })
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) { onOpenChange(v) } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{billNo === "" ? "Name / GSTIN / address on this bill" : `Name / GSTIN / address on Bill #${billNo}`}</DialogTitle>
          <DialogDescription>
            This bill is settled. Only the name, GSTIN and address printed on it change — never its
            amounts or payment. Reprint it afterwards for a corrected copy.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="settled-bill-customer-name">Guest name</Label>
          <Input
            id="settled-bill-customer-name"
            placeholder="e.g. Mr Sharma"
            value={customerName}
            onChange={(e) => { setCustomerName(e.target.value); setServerError(null) }}
            onKeyDown={(e) => { if (e.key === "Enter" && !busy) { void save() } }}
            maxLength={120}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="settled-bill-customer-gstin">
            Customer GSTIN <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="settled-bill-customer-gstin"
            placeholder="e.g. 29ABCDE1234F1Z5"
            value={gstin}
            // Uppercased and de-spaced AS THEY TYPE, so what is on screen is
            // what the server will store.
            onChange={(e) => { setGstin(gstinAsTyped(e.target.value)); setGstinTouched(true); setGstinMessage(null); setServerError(null) }}
            onKeyDown={(e) => { if (e.key === "Enter" && !busy) { void save() } }}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={gstinMessage !== null ? true : undefined}
            className="font-mono uppercase"
          />
          {gstinMessage !== null ? (
            <p className="text-xs text-destructive">{gstinMessage}</p>
          ) : (
            <p className="text-xs text-muted-foreground">For corporate parties. Leave empty for none.</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="settled-bill-customer-address">
            Guest address <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          {/* ENTER IS A NEW LINE here, never Save: an address is typed as lines
              and printed as lines. No maxLength — over the limits is REFUSED,
              never cut — so the counter is the server's measure, drawn by hand. */}
          <Textarea
            id="settled-bill-customer-address"
            placeholder={"e.g. 4th Floor, Prestige Tower\n12 Residency Road, Bengaluru 560025"}
            value={address}
            rows={2}
            onChange={(e) => { setAddress(e.target.value); setAddressTouched(true); setServerError(null) }}
            aria-invalid={addressLimit !== null ? true : undefined}
          />
          <div className="flex items-start justify-between gap-3">
            {addressLimit !== null ? (
              <p className="text-xs text-destructive">{addressLimit}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{ADDRESS_HELP}</p>
            )}
            <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {usage.lines}/{ADDRESS_MAX_LINES} lines · {usage.chars}/{ADDRESS_MAX_CHARS}
            </p>
          </div>
        </div>
        {serverError !== null ? <p className="text-sm text-destructive" role="alert">{serverError}</p> : null}
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              setCustomerName("")
              setGstin("")
              setAddress("")
              setGstinTouched(true)
              setAddressTouched(true)
              setGstinMessage(null)
              setServerError(null)
            }}
            disabled={busy}
          >Clear</Button>
          <Button variant="ghost" onClick={() => { onOpenChange(false) }} disabled={busy}>Cancel</Button>
          {/* Off while the address is over a limit: the sentence above says why. */}
          <Button onClick={() => { void save() }} disabled={busy || addressLimit !== null}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The control that opens the dialog: compact draws the row's quiet person
 * icon, otherwise the labelled outline button for the bill's own sheet. Reads
 * the bill first when the payload in hand has no `customer_address` key, so
 * the dialog shows the address it is about to edit; a failed read is not a
 * reason to refuse the edit (the address then goes out only if typed).
 */
export function EditSettledBillCustomerButton({
  restaurantId,
  bill,
  compact = false,
  onSaved,
}: {
  restaurantId: string
  bill: { id: string; bill_no?: string | null; customer?: string | null; customer_gstin?: string | null; customer_address?: string | null }
  compact?: boolean
  onSaved: (saved: SettledBillCustomerSaved) => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  const [reading, setReading] = useState(false)
  const [seed, setSeed] = useState<SettledBillCustomerSeed | null>(null)

  const edit = async (): Promise<void> => {
    if (bill.id === "") { return }
    let doc: SettledBillCustomerSeed = {
      id: bill.id,
      bill_no: bill.bill_no,
      customer: bill.customer,
      customer_gstin: bill.customer_gstin,
      customer_address: bill.customer_address,
      addressKnown: "customer_address" in bill,
    }
    if (!doc.addressKnown) {
      // A row's payload has no address: read the bill itself, so the dialog
      // shows the address it is about to edit. The detail's name and GSTIN
      // seed it too — one document, not a stale row beside a fresh address.
      setReading(true)
      try {
        const detail = await fetchClosedBillDetail(restaurantId, bill.id)
        if ("customer_address" in detail) {
          doc = {
            id: bill.id,
            bill_no: detail.bill_no ?? bill.bill_no,
            customer: detail.customer,
            customer_gstin: detail.customer_gstin,
            customer_address: detail.customer_address,
            addressKnown: true,
          }
        }
      } catch {
        // Offline, refused or gone: the row's own name and GSTIN, address unknown.
      } finally {
        setReading(false)
      }
    }
    setSeed(doc)
    setOpen(true)
  }

  return (
    <>
      {compact ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground"
          title={BILL_CUSTOMER_EDIT_LABEL}
          aria-label={BILL_CUSTOMER_EDIT_LABEL}
          disabled={reading}
          onClick={(e) => { e.stopPropagation(); void edit() }}
        >
          <UserRound className="h-4 w-4" />
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled={reading} onClick={() => { void edit() }}>
          <UserRound className="mr-2 h-4 w-4" />
          {reading ? "Loading…" : BILL_CUSTOMER_EDIT_LABEL}
        </Button>
      )}
      <SettledBillCustomerDialog
        open={open}
        onOpenChange={setOpen}
        restaurantId={restaurantId}
        seed={seed}
        onSaved={onSaved}
      />
    </>
  )
}
