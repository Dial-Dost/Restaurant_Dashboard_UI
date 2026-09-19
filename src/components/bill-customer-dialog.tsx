"use client"

/*
  R2 ITEM 1 — THE ONE "NAME / GSTIN / ADDRESS ON THE BILL" DIALOG.

  6.5 shipped a name dialog inside the orders grid's Bill menu. The client then
  asked for the customer's GSTIN as well, and for the same edit in two more
  places: on top of a clicked live table, and on a past bill in Accounting. Three
  copies of a form that validates a tax registration is three chances for them
  to disagree, so this is the 6.5 dialog lifted out and extended, and every one
  of those places opens it.

  WHICH ROUTE is decided by `target` (see billCustomerPayload): a running table
  is addressed by name on POST /bills/customer-name, a settled bill by id on POST
  /bills/:billId/customer-details. Everything else — seeding, validation, the
  server's refusal shown verbatim, the not-updated wording — is shared.
*/

import { useEffect, useRef, useState, type ReactElement } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { getBillForTable } from "@/lib/db"
import {
  billCustomerSeed,
  gstinAsTyped,
  gstinError,
  gstinToSend,
  type BillCustomerTarget,
} from "@/lib/bill-customer"
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
import { fetchClosedBillDetail, saveSettledBillCustomer } from "@/lib/api/history"
import { saveTableBillCustomer } from "@/lib/api/bill-print"

/** What the dialog already knows about the bill, when its host has the payload. */
export interface BillCustomerInitial {
  customer: string | null | undefined
  /** Omit the key (or pass a payload without it) when the backend did not send one. */
  customer_gstin?: string | null
  /** Omit the key when the payload in hand carried no address (the dialog then never wipes one). */
  customer_address?: string | null
}

/** Flutter `billCustomerEditLabel` — every entry point's button. */
export const BILL_CUSTOMER_EDIT_LABEL = "Edit name / GSTIN / address"

export function BillCustomerDialog({
  open,
  onOpenChange,
  restaurantId,
  target,
  initial,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  restaurantId: string
  target: BillCustomerTarget
  /**
   * The bill as the host already holds it. Without it a TABLE target seeds
   * itself from GET /bill-for-table; a settled target without an address reads
   * GET /bills/closed/:id first so it can show the address it is editing.
   */
  initial?: BillCustomerInitial | null
  onSaved: (saved: { customer: string | null; customer_gstin: string | null; customer_address?: string | null }) => void
}): ReactElement {
  const { toast } = useToast()
  const [customerName, setCustomerName] = useState("")
  const [gstin, setGstin] = useState("")
  /**
   * Do we know the bill's CURRENT GSTIN? False after a failed read or against a
   * backend that sends no such field — and then an untouched box is left off the
   * request rather than sent as "clear it". See billCustomerPayload.
   */
  const [gstinKnown, setGstinKnown] = useState(false)
  const [gstinTouched, setGstinTouched] = useState(false)
  /** Finding 16 — the format error shows only once Save was tried, and clears on edit. */
  const [gstinMessage, setGstinMessage] = useState<string | null>(null)
  const [address, setAddress] = useState("")
  const [addressSeed, setAddressSeed] = useState("")
  const [addressKnown, setAddressKnown] = useState(false)
  const [addressTouched, setAddressTouched] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const tableName = target.kind === "table" ? target.tableName : null
  const billId = target.kind === "bill" ? target.billId : null
  // `initial` is read once PER OPENING, through a ref: a host re-rendering under
  // the open dialog (a poll, a list refresh) must not overwrite what the person
  // is in the middle of typing.
  const initialRef = useRef(initial)
  initialRef.current = initial

  /**
   * H6 — the fields are SEEDED WITH THE CURRENT VALUES rather than opening blank,
   * because the common case is fixing a typo in something somebody already
   * typed. "Guest" is the server's no-name placeholder, so it is not seeded back.
   */
  useEffect(() => {
    if (!open) {return}
    let active = true
    setServerError(null)
    setGstinTouched(false)
    setGstinMessage(null)
    setAddressTouched(false)
    const apply = (bill: unknown): void => {
      const seed = billCustomerSeed(bill)
      setCustomerName(seed.customer)
      setGstin(seed.gstin)
      setGstinKnown(seed.gstinKnown)
      const hasAddress = bill !== null && typeof bill === "object" && "customer_address" in bill
      const a = hasAddress ? billAddressSeed((bill as { customer_address?: unknown }).customer_address) : ""
      setAddress(a)
      setAddressSeed(a)
      setAddressKnown(hasAddress)
      setLoaded(true)
    }
    const known = initialRef.current
    if (known && (billId === null || "customer_address" in known)) {
      apply(known)
      return
    }
    setLoaded(false)
    const read: Promise<unknown> | null = tableName !== null
      ? getBillForTable(restaurantId, tableName)
      : billId !== null ? fetchClosedBillDetail(restaurantId, billId) : null
    if (read === null) { apply(known ?? null); return }
    read
      .then((bill: unknown) => { if (active) {apply(bill)} })
      // Seeding is a convenience, not a precondition — a failed read must not
      // stop somebody correcting the name (the address then stays off the wire).
      .catch(() => { if (active) {apply(known ?? null)} })
    return () => { active = false }
  }, [open, restaurantId, tableName, billId])

  const addressLimit = billAddressError(address)
  const usage = billAddressUsage(address)

  const save = async (): Promise<void> => {
    const formatError = gstinError(gstin)
    if (formatError) { setGstinMessage(formatError); return }
    if (addressLimit !== null) {return}
    setBusy(true)
    setServerError(null)
    try {
      const sendGstin = gstinToSend(gstin, gstinKnown, gstinTouched)
      const sendAddress = billAddressToSend({ address, seed: addressSeed, known: addressKnown, touched: addressTouched })
      const normalisedAddress = normalizeBillAddress(address)
      const input = {
        customer: customerName,
        ...(sendGstin === undefined ? {} : { gstin: sendGstin }),
        ...(sendAddress ? { address: normalisedAddress } : {}),
      }
      const r = target.kind === "table"
        ? await saveTableBillCustomer(restaurantId, target.tableName, input)
        : await saveSettledBillCustomer(restaurantId, target.billId, input)
      if (!r.ok) {
        if (r.outdated) {
          toast({ title: "Not available yet", description: r.message, variant: "destructive" })
        }
        // The SERVER's sentence, verbatim, where the person is looking.
        setServerError(r.message)
        return
      }
      const addressIgnored = sendAddress && normalisedAddress !== "" && r.customer_address === undefined
      if (sendGstin !== undefined && sendGstin.trim() !== "" && !r.gstinSaved) {
        // An older backend accepted the name and ignored the GSTIN.
        toast({
          title: "Name saved — GSTIN not saved",
          description: "This server has not finished updating, so the GSTIN could not be stored yet. Ask your administrator to complete the update.",
          variant: "destructive",
        })
      } else if (addressIgnored) {
        toast({ title: "Name and GSTIN saved", description: ADDRESS_NOT_SAVED_MESSAGE, variant: "destructive" })
      } else {
        toast({
          title: "Bill details updated",
          description: [
            r.customer ? `Name: ${r.customer}` : "No guest name",
            r.customer_gstin ? `GSTIN: ${r.customer_gstin}` : "no GSTIN",
          ].join(" · "),
        })
      }
      onSaved({
        customer: r.customer,
        customer_gstin: r.customer_gstin,
        ...(r.customer_address === undefined ? {} : { customer_address: r.customer_address }),
      })
      onOpenChange(false)
    } finally { setBusy(false) }
  }

  const title = target.kind === "table"
    ? `Name / GSTIN / address on bill · Table ${target.tableName}`
    : `Name / GSTIN / address on Bill #${target.billNo ?? "—"}`

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) {onOpenChange(v)} }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {target.kind === "table"
              ? "Printed at the top of the bill. Applies to the whole table, and can be changed until the bill is settled."
              : "Changes only the name, GSTIN and address printed on this bill. The amounts, payment and settlement stay exactly as they were."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="bill-customer-name">Guest name</Label>
          <Input
            id="bill-customer-name"
            placeholder={loaded ? "e.g. Mr Sharma" : "Loading…"}
            value={customerName}
            onChange={(e) => { setCustomerName(e.target.value); setServerError(null) }}
            onKeyDown={(e) => { if (e.key === "Enter" && !busy && loaded) { void save() } }}
            maxLength={120}
            autoCapitalize="words"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">Leave it empty to print no name.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="bill-customer-gstin">
            Customer GSTIN <span className="font-normal text-muted-foreground">(optional, for corporate parties)</span>
          </Label>
          <Input
            id="bill-customer-gstin"
            placeholder={loaded ? "e.g. 29ABCDE1234F1Z5" : "Loading…"}
            value={gstin}
            // Uppercased and de-spaced AS THEY TYPE, so what is on screen is what
            // the server will store.
            onChange={(e) => { setGstin(gstinAsTyped(e.target.value)); setGstinTouched(true); setGstinMessage(null); setServerError(null) }}
            onKeyDown={(e) => { if (e.key === "Enter" && !busy && loaded) { void save() } }}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={gstinMessage !== null ? true : undefined}
            className="font-mono uppercase"
          />
          {gstinMessage !== null ? (
            <p className="text-xs text-destructive">{gstinMessage}</p>
          ) : (
            <p className="text-xs text-muted-foreground">Leave it empty to print no GSTIN.</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="bill-customer-address">
            Guest address <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          {/* ENTER IS A NEW LINE here, never Save. Over the limits is REFUSED,
              never cut — so the counter is the server's measure. */}
          <Textarea
            id="bill-customer-address"
            placeholder={loaded ? "e.g. 4th Floor, Prestige Tower\n12 Residency Road, Bengaluru 560025" : "Loading…"}
            value={address}
            rows={2}
            className="max-h-[8.5rem]"
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
        {serverError ? <p className="text-sm text-destructive" role="alert">{serverError}</p> : null}
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
          <Button onClick={() => { void save() }} disabled={busy || !loaded || addressLimit !== null}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
