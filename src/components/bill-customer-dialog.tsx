"use client"

/*
  R2 ITEM 1 — THE ONE "NAME / GSTIN ON THE BILL" DIALOG.
  CLIENT ITEM 7 — AND THE GUEST'S ADDRESS, in the same dialog.

  6.5 shipped a name dialog inside the orders grid's Bill menu. The client then
  asked for the customer's GSTIN as well, and for the same edit in two more
  places: on top of a clicked live table, and on a past bill in Accounting. Three
  copies of a form that validates a tax registration is three chances for them
  to disagree, so this is the 6.5 dialog lifted out and extended, and every one
  of those places opens it. The address (item 7) is its third field, so all
  three places got it at once.

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
import { getBillForTable, setBillCustomerName, setSettledBillCustomerDetails } from "@/lib/db"
import {
  ADDRESS_HELP,
  ADDRESS_MAX_CHARS,
  ADDRESS_MAX_LINES,
  ADDRESS_NOT_SAVED_MESSAGE,
  addressError,
  addressToSend,
  addressUsage,
  billCustomerSeed,
  gstinAsTyped,
  gstinError,
  gstinToSend,
  type BillCustomerTarget,
} from "@/lib/bill-customer"

/** What the dialog already knows about the bill, when its host has the payload. */
export interface BillCustomerInitial {
  customer: string | null | undefined
  /** Omit the key (or pass a payload without it) when the backend did not send one. */
  customer_gstin?: string | null
  /**
   * Client item 7. Omit the key when the host's payload has none — a settled
   * bill LIST row never does — and the address is then left off the request
   * unless somebody types in its box.
   */
  customer_address?: string | null
}

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
   * itself from GET /bill-for-table, which is what the 6.5 dialog always did.
   */
  initial?: BillCustomerInitial | null
  onSaved: (saved: { customer: string | null; customer_gstin: string | null; customer_address: string | null }) => void
}): ReactElement {
  const { toast } = useToast()
  const [customerName, setCustomerName] = useState("")
  const [gstin, setGstin] = useState("")
  const [address, setAddress] = useState("")
  /** The address the dialog opened with — an unchanged one is not re-sent (see addressToSend). */
  const [addressSeed, setAddressSeed] = useState("")
  /**
   * Do we know the bill's CURRENT GSTIN? False after a failed read or against a
   * backend that sends no such field — and then an untouched box is left off the
   * request rather than sent as "clear it". See billCustomerPayload.
   */
  const [gstinKnown, setGstinKnown] = useState(false)
  const [gstinTouched, setGstinTouched] = useState(false)
  /** The same two facts for the address (client item 7). */
  const [addressKnown, setAddressKnown] = useState(false)
  const [addressTouched, setAddressTouched] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const tableName = target.kind === "table" ? target.tableName : null
  // `initial` is read once PER OPENING, through a ref: a host re-rendering under
  // the open dialog (a poll, a list refresh) must not overwrite what the person
  // is in the middle of typing.
  const initialRef = useRef(initial)
  initialRef.current = initial

  /**
   * H6 — the fields are SEEDED WITH THE CURRENT VALUES rather than opening blank,
   * because the common case is fixing a typo in something somebody already
   * typed, and an empty box invites retyping the whole thing (and so a second
   * typo). "Guest" is the server's no-name placeholder, so it is not seeded back.
   */
  useEffect(() => {
    if (!open) {return}
    let active = true
    setServerError(null)
    setGstinTouched(false)
    setAddressTouched(false)
    const apply = (bill: unknown): void => {
      const seed = billCustomerSeed(bill)
      setCustomerName(seed.customer)
      setGstin(seed.gstin)
      setGstinKnown(seed.gstinKnown)
      setAddress(seed.address)
      setAddressSeed(seed.address)
      setAddressKnown(seed.addressKnown)
      setLoaded(true)
    }
    const known = initialRef.current
    if (known) {
      apply(known)
      return
    }
    setLoaded(false)
    if (!tableName) { apply(null); return }
    getBillForTable(restaurantId, tableName)
      .then((bill: unknown) => { if (active) {apply(bill)} })
      // Seeding is a convenience, not a precondition — a failed read must not
      // stop somebody correcting the name.
      .catch(() => { if (active) {apply(null)} })
    return () => { active = false }
  }, [open, restaurantId, tableName])

  const formatError = gstinError(gstin)
  // Refused, never cut: the box has no maxLength (a browser silently truncates
  // a paste to it); the counter and the server's own sentence say what to fix.
  const addressLimitError = addressError(address)
  const usage = addressUsage(address)
  const invalid = formatError !== null || addressLimitError !== null

  const save = async (): Promise<void> => {
    if (invalid) {return}
    setBusy(true)
    setServerError(null)
    try {
      const sendGstin = gstinToSend(gstin, gstinKnown, gstinTouched)
      const sendAddress = addressToSend(address, addressSeed, addressKnown, addressTouched)
      const r = target.kind === "table"
        ? await setBillCustomerName(restaurantId, target.tableName, customerName, sendGstin, sendAddress)
        : await setSettledBillCustomerDetails(restaurantId, target.billId, customerName, sendGstin, sendAddress)
      if (!r.ok) {
        if (r.outdated) {
          // A 404 with no sentence means one specific thing: the dashboard and the
          // backend deploy on separate pipelines and the WEB is a release ahead.
          // "Cannot POST /bills/…" tells the person holding the phone nothing.
          toast({ title: "Not available yet", description: r.message, variant: "destructive" })
        }
        // The SERVER's sentence, verbatim, where the person is looking.
        setServerError(r.message)
        return
      }
      if (sendGstin !== undefined && sendGstin.trim() !== "" && !r.gstinSaved) {
        // An older backend accepted the name and ignored the GSTIN. Saying "saved"
        // would send a corporate party away with a bill that lacks it.
        toast({
          title: "Name saved — GSTIN not saved",
          description: "This server has not finished updating, so the GSTIN could not be stored yet. Ask your administrator to complete the update.",
          variant: "destructive",
        })
      } else if (sendAddress !== undefined && sendAddress.trim() !== "" && !r.addressSaved) {
        // The same for a backend a release before client item 7.
        toast({ title: "Name saved — address not saved", description: ADDRESS_NOT_SAVED_MESSAGE, variant: "destructive" })
      } else {
        toast({
          title: "Bill details updated",
          description: [
            r.customer ? `Name: ${r.customer}` : "No guest name",
            r.customer_gstin ? `GSTIN: ${r.customer_gstin}` : "no GSTIN",
            r.customer_address ? "address on the bill" : "no address",
          ].join(" · "),
        })
      }
      onSaved({ customer: r.customer, customer_gstin: r.customer_gstin, customer_address: r.customer_address })
      onOpenChange(false)
    } finally { setBusy(false) }
  }

  const title = target.kind === "table"
    ? `Name / GSTIN / address on bill · Table ${target.tableName}`
    : `Name / GSTIN / address on bill #${target.billNo ?? "—"}`

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) {onOpenChange(v)} }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {/* Said plainly because the behaviour is not obvious: on a live table
                the name is stored on the ORDERS, so this changes every round on
                the table; on a settled bill it changes only these fields and
                never an amount. */}
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
            onChange={(e) => { setGstin(gstinAsTyped(e.target.value)); setGstinTouched(true); setServerError(null) }}
            onKeyDown={(e) => { if (e.key === "Enter" && !busy && loaded) { void save() } }}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={formatError ? true : undefined}
            className="font-mono uppercase"
          />
          {formatError ? (
            <p className="text-xs text-destructive">{formatError}</p>
          ) : (
            <p className="text-xs text-muted-foreground">Leave it empty to print no GSTIN.</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="bill-customer-address">
            Guest address <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          {/* ENTER IS A NEW LINE HERE, never Save: an address is typed as lines,
              and the paper prints them as lines. */}
          <Textarea
            id="bill-customer-address"
            rows={3}
            placeholder={loaded ? "e.g. 4th Floor, Prestige Tower\n12 Residency Road, Bengaluru 560025" : "Loading…"}
            value={address}
            onChange={(e) => { setAddress(e.target.value); setAddressTouched(true); setServerError(null) }}
            autoComplete="off"
            aria-invalid={addressLimitError ? true : undefined}
            aria-describedby="bill-customer-address-help"
          />
          <div id="bill-customer-address-help" className="flex flex-wrap justify-between gap-x-3 text-xs">
            {addressLimitError ? (
              <p className="text-destructive" role="alert">{addressLimitError}</p>
            ) : (
              <p className="text-muted-foreground">{ADDRESS_HELP}</p>
            )}
            <p
              data-testid="bill-customer-address-count"
              className={addressLimitError ? "text-destructive" : "text-muted-foreground"}
            >
              {usage.lines}/{ADDRESS_MAX_LINES} lines · {usage.chars}/{ADDRESS_MAX_CHARS}
            </p>
          </div>
        </div>
        {serverError ? <p className="text-sm text-destructive" role="alert">{serverError}</p> : null}
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              setCustomerName(""); setGstin(""); setAddress("")
              setGstinTouched(true); setAddressTouched(true); setServerError(null)
            }}
            disabled={busy}
          >Clear</Button>
          <Button onClick={() => { void save() }} disabled={busy || !loaded || invalid}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
