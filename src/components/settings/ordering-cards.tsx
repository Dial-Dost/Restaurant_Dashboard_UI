"use client"

// ORDERING group — Flutter `_AutoPushCard`, `_RequireTableOtpCard`,
// `_KotAutoPrintCard`, `_KotDocketCard`, `_QueueMenuCard` (modules.dart
// 32543–32949, 34148–34209). Each switch saves on flip with an optimistic
// move that reverts on failure; a 403 shows the server's own sentence.

import * as React from "react"
import { Loader2, Printer } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import {
  KOT_PRINT_STYLE_KEY,
  KOT_STYLE_CLASSIC,
  KOT_TEXT_SIZE_KEY,
  errorStatus,
  errorText,
  kotTestPrintOutcome,
  postBranding,
  postSettings,
  printTestKot,
  type SettingsDoc,
} from "@/lib/api/settings"
import { isUnreachableError } from "@/hooks/use-cached-fetch"
import { cn } from "@/lib/utils"

import { SettingsCard, SwitchCard } from "./settings-card"

type Poster = (rid: string, body: SettingsDoc) => Promise<SettingsDoc | null>

function useFlip(
  rid: string,
  key: string,
  initial: boolean,
  opts: { post?: Poster; ok: (v: boolean) => string; refusal403?: string },
): [boolean, boolean, (v: boolean) => void] {
  const { toast } = useToast()
  const [on, setOn] = React.useState(initial)
  const [busy, setBusy] = React.useState(false)
  const flip = (v: boolean): void => {
    if (busy) {return}
    const prev = on
    setOn(v)
    setBusy(true)
    void (opts.post ?? postSettings)(rid, { [key]: v })
      .then(() => { toast({ description: opts.ok(v) }) })
      .catch((e: unknown) => {
        setOn(prev)
        const status = errorStatus(e)
        toast({
          variant: "destructive",
          title: "Couldn't save",
          description: status === 403 ? errorText(e, opts.refusal403) : errorText(e),
        })
      })
      .finally(() => { setBusy(false) })
  }
  return [on, busy, flip]
}

export function AutoPushCard({ rid, initial }: { rid: string; initial: boolean }): React.JSX.Element {
  const [on, busy, flip] = useFlip(rid, "auto_push_orders", initial, {
    ok: (v) => (v ? "Customer QR orders now go straight to the kitchen." : "Customer QR orders now wait for staff approval."),
  })
  return (
    <SwitchCard
      id="auto-push-orders"
      title="Push orders directly to the kitchen"
      caption={on
        ? "Customer QR orders go straight to the kitchen."
        : "Customer QR orders wait for staff approval (Orders tab) before the kitchen sees them."}
      checked={on}
      disabled={busy}
      onChange={flip}
    />
  )
}

export function RequireOtpCard({ rid, initial }: { rid: string; initial: boolean }): React.JSX.Element {
  const [on, busy, flip] = useFlip(rid, "require_table_otp", initial, {
    ok: (v) => (v
      ? "Guests must now enter the 4-digit table code (shown on the Tables screen) before ordering."
      : "Guests can order from the QR page without a code."),
    refusal403: "Only an admin can change this setting.",
  })
  return (
    <SwitchCard
      id="require-table-otp"
      title="Require table OTP to order"
      caption="Guests enter a 4-digit code shown by staff before ordering. Admin-only."
      checked={on}
      disabled={busy}
      onChange={flip}
    />
  )
}

export function KotAutoPrintCard({ rid, initial }: { rid: string; initial: boolean }): React.JSX.Element {
  const [on, busy, flip] = useFlip(rid, "kot_auto_print", initial, {
    ok: (v) => (v
      ? "Barking an order now prints its kitchen docket automatically."
      : "Dockets print only when someone presses Print KOT."),
    refusal403: "Only an admin can change this setting.",
  })
  return (
    <SwitchCard
      id="kot-auto-print"
      title="Print the KOT when an order is barked"
      caption={on
        ? "The docket goes to the kitchen printer the moment the order is barked. The Reprint button sends the same ticket again."
        : "Nothing prints on a bark. Staff press Print KOT themselves."}
      checked={on}
      disabled={busy}
      onChange={flip}
    />
  )
}

export function QueueMenuCard({ rid, initial }: { rid: string; initial: boolean }): React.JSX.Element {
  const [on, busy, flip] = useFlip(rid, "queue_show_menu", initial, {
    post: postBranding,
    ok: (v) => (v ? "Guests in the queue can now browse the menu & pre-order." : "Queue page now shows only the place in line."),
  })
  return (
    <SwitchCard
      id="queue-show-menu"
      title="Show menu & pre-order in the queue"
      caption="When off, waiting guests on the public queue page only see their place in line (no menu, no pre-order)."
      checked={on}
      disabled={busy}
      onChange={flip}
    />
  )
}

/* ── KOT docket (print style + text size + test print) ──────────────── */

interface Opt { value: string; label: string; detail: string }

const STYLE_OPTIONS: Opt[] = [
  {
    value: "reference",
    label: "Match the reference docket (recommended)",
    detail: "Clear type, laid out like the printed ticket you approved. Its size is set below.",
  },
  {
    value: "classic",
    label: "Classic text docket",
    detail: "Plain text in the printer's own font, at its normal size. Use it if the new one does not print.",
  },
]
const STYLE_HELP =
  "The new docket prints as an image, which almost every thermal printer supports. If a kitchen printer prints a blank ticket, switch back to the classic text docket here and the next KOT prints as text again."

const SIZE_OPTIONS: Opt[] = [
  { value: "small", label: "Small", detail: "A size down: more of a long order fits on less paper." },
  { value: "standard", label: "Standard — matches your reference docket", detail: "The same size as the printed ticket you approved." },
  { value: "large", label: "Large", detail: "A size up, for a pass read from further away. Long dish names wrap sooner." },
]
const SIZE_HELP =
  "Applies to the new docket only. The classic text docket prints in the printer's own font at its normal size, and ignores this setting."
const SIZE_CLASSIC_NOTE =
  "Your kitchens are on the classic text docket, so this size is not used until you switch back."
const NOT_SUPPORTED = "This server does not support this setting yet, so nothing was saved."

const savedMessage = (key: string, saved: string, style: string): string => {
  if (key === KOT_PRINT_STYLE_KEY) {
    return saved === KOT_STYLE_CLASSIC
      ? "The next kitchen docket prints as plain text."
      : "The next kitchen docket prints in the reference layout."
  }
  return style === KOT_STYLE_CLASSIC
    ? "Saved. It applies when the kitchen is back on the new docket."
    : `The next kitchen docket prints at the ${saved} size.`
}

export function KotDocketCard({ rid, initialStyle, initialSize }: { rid: string; initialStyle: string; initialSize: string }): React.JSX.Element {
  const { toast } = useToast()
  const [style, setStyle] = React.useState(initialStyle)
  const [size, setSize] = React.useState(initialSize)
  const [busy, setBusy] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const choicesDisabled = busy || testing

  const pick = (key: string, value: string): void => {
    const previous = key === KOT_PRINT_STYLE_KEY ? style : size
    if (choicesDisabled || value === previous) {return}
    const set = key === KOT_PRINT_STYLE_KEY ? setStyle : setSize
    set(value)
    setBusy(true)
    void postSettings(rid, { [key]: value })
      .then((reply) => {
        let saved = value
        if (reply && typeof reply === "object") {
          if (!(key in reply)) {throw new Error(NOT_SUPPORTED)}
          const v = reply[key]
          saved = typeof v === "string" ? v : value
        }
        set(saved)
        toast({ description: savedMessage(key, saved, key === KOT_PRINT_STYLE_KEY ? saved : style) })
      })
      .catch((e: unknown) => {
        set(previous)
        toast({
          variant: "destructive",
          title: "Couldn't save",
          description: errorStatus(e) === 403 ? errorText(e, "Only an admin can change how kitchen dockets print.") : errorText(e),
        })
      })
      .finally(() => { setBusy(false) })
  }

  const testPrint = (): void => {
    if (busy || testing) {return}
    setTesting(true)
    void printTestKot(rid)
      .then((reply) => { toast({ title: "Test KOT sent", description: kotTestPrintOutcome(reply) }) })
      .catch((e: unknown) => {
        toast({
          variant: "destructive",
          title: "Couldn't print a test KOT",
          description: isUnreachableError(e) || errorStatus(e) === undefined
            ? "A test KOT needs a connection — reconnect and try again."
            : errorText(e),
        })
      })
      .finally(() => { setTesting(false) })
  }

  const group = (key: string, options: Opt[], selected: string): React.JSX.Element => (
    <div role="radiogroup" className="grid gap-2">
      {options.map((o) => {
        const on = o.value === selected
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={choicesDisabled}
            onClick={() => { pick(key, o.value) }}
            className={cn(
              "flex items-start gap-3 rounded-lg border bg-inset p-3 text-left transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-60",
              on ? "border-accent-base/60" : "border-border hover:border-input",
            )}
          >
            <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", on ? "border-accent-base" : "border-input")}>
              {on ? <span className="h-2 w-2 rounded-full bg-accent-base" /> : null}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{o.label}</span>
              <span className="block text-xs text-muted-foreground">{o.detail}</span>
            </span>
          </button>
        )
      })}
    </div>
  )

  return (
    <SettingsCard title="KOT print style" caption="How kitchen dockets are printed. This does not change the customer bill.">
      {group(KOT_PRINT_STYLE_KEY, STYLE_OPTIONS, style)}
      <p className="text-xs text-muted-foreground">{STYLE_HELP}</p>
      <div className="space-y-2 pt-1">
        <div className="text-sm font-semibold">KOT text size</div>
        {group(KOT_TEXT_SIZE_KEY, SIZE_OPTIONS, size)}
        <p className="text-xs text-muted-foreground">{SIZE_HELP}</p>
        {style === KOT_STYLE_CLASSIC ? <p className="text-xs font-semibold">{SIZE_CLASSIC_NOTE}</p> : null}
      </div>
      <div className="space-y-2 border-t border-divider pt-3">
        <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={busy || testing} onClick={testPrint}>
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
          {testing ? "Sending a test KOT…" : "Print a test KOT"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Sends one test docket to the kitchen printer in the style and size chosen above, so you can check the paper before service.
        </p>
      </div>
    </SettingsCard>
  )
}
