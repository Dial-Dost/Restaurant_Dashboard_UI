"use client"

// Flutter `_RazorpaySettingsCard` (modules.dart 33653–33758) and
// `_MessagingSettingsCard` (33760–33984). Secrets are write-only: blank keeps
// the stored one, so a secret is sent only when typed.

import * as React from "react"
import { Eye, EyeOff, Loader2, Save } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StatusChip } from "@/components/ui/status-chip"
import { useToast } from "@/hooks/use-toast"
import { errorText, postSettings, type SettingsDoc } from "@/lib/api/settings"

import { FieldLabel, SettingsCard } from "./settings-card"

function SecretInput({ id, value, onChange, placeholder, disabled }: {
  id: string; value: string; onChange: (v: string) => void; placeholder: string; disabled?: boolean
}): React.JSX.Element {
  const [show, setShow] = React.useState(false)
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        autoComplete="new-password"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => { onChange(e.target.value) }}
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => { setShow((s) => !s) }}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
        aria-label={show ? "Hide secret" : "Show secret"}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}

function SaveButton({ busy, label, onClick, disabled }: { busy: boolean; label: string; onClick: () => void; disabled?: boolean }): React.JSX.Element {
  return (
    <div className="flex justify-end">
      <Button type="button" size="sm" className="gap-1.5" disabled={busy || disabled} onClick={onClick}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        {busy ? "Saving…" : label}
      </Button>
    </div>
  )
}

export { SaveButton }

export function RazorpayCard({ rid, initialKeyId, configured, onSaved }: {
  rid: string; initialKeyId: string; configured: boolean; onSaved: () => void
}): React.JSX.Element {
  const { toast } = useToast()
  const [keyId, setKeyId] = React.useState(initialKeyId)
  const [secret, setSecret] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  const save = (): void => {
    const payload: SettingsDoc = { razorpay_key_id: keyId.trim() }
    if (secret.trim()) {payload.razorpay_key_secret = secret.trim()}
    setBusy(true)
    void postSettings(rid, payload)
      .then(() => { toast({ description: "Razorpay settings saved." }); onSaved() })
      .catch((e: unknown) => { toast({ variant: "destructive", description: errorText(e) }) })
      .finally(() => { setBusy(false) })
  }

  return (
    <SettingsCard
      title="Razorpay (online payments)"
      trailing={<StatusChip dense status={configured ? "success" : "neutral"} label={configured ? "Connected" : "Not connected"} />}
      caption="Enter your own Razorpay API keys so online payments go straight to your account. Get them from the Razorpay Dashboard → Settings → API Keys."
    >
      <div className="space-y-1.5">
        <FieldLabel htmlFor="rzp-key-id">Key ID</FieldLabel>
        <Input id="rzp-key-id" value={keyId} placeholder="rzp_live_… / rzp_test_…" disabled={busy} onChange={(e) => { setKeyId(e.target.value) }} />
      </div>
      <div className="space-y-1.5">
        <FieldLabel htmlFor="rzp-key-secret">Key secret</FieldLabel>
        <SecretInput
          id="rzp-key-secret"
          value={secret}
          onChange={setSecret}
          disabled={busy}
          placeholder={configured ? "Leave blank to keep current secret" : "Enter your key secret"}
        />
      </div>
      <SaveButton busy={busy} label="Save Razorpay keys" onClick={save} />
    </SettingsCard>
  )
}

const PROVIDERS: [string, string][] = [
  ["none", "Off (log only)"],
  ["twilio", "Twilio (SMS / WhatsApp)"],
  ["meta", "Meta WhatsApp Cloud API"],
]

export function MessagingCard({
  rid, slug, initialProvider, initialSender, initialKeyId, secretConfigured, initialReminderHours, webhookSecret, onSaved,
}: {
  rid: string
  slug: string
  initialProvider: string
  initialSender: string
  initialKeyId: string
  secretConfigured: boolean
  initialReminderHours: number
  webhookSecret: string
  onSaved: () => void
}): React.JSX.Element {
  const { toast } = useToast()
  const [provider, setProvider] = React.useState(initialProvider === "twilio" || initialProvider === "meta" ? initialProvider : "none")
  const [sender, setSender] = React.useState(initialSender)
  const [keyId, setKeyId] = React.useState(initialKeyId)
  const [secret, setSecret] = React.useState("")
  const [hours, setHours] = React.useState(String(initialReminderHours))
  const [busy, setBusy] = React.useState(false)
  const on = provider !== "none"
  const meta = provider === "meta"

  const save = (): void => {
    const parsed = Number.parseInt(hours.trim(), 10)
    const payload: SettingsDoc = {
      msg_provider: provider,
      msg_sender: sender.trim(),
      msg_key_id: keyId.trim(),
      msg_reminder_hours: Number.isFinite(parsed) ? parsed : initialReminderHours,
    }
    if (secret.trim()) {payload.msg_key_secret = secret.trim()}
    setBusy(true)
    void postSettings(rid, payload)
      .then(() => { toast({ description: "Messaging settings saved." }); onSaved() })
      .catch((e: unknown) => { toast({ variant: "destructive", description: errorText(e) }) })
      .finally(() => { setBusy(false) })
  }

  return (
    <SettingsCard
      title="Guest messaging (SMS / WhatsApp)"
      trailing={<StatusChip dense status={on ? "success" : "neutral"} label={on ? `On · ${provider}` : "Off · log only"} />}
      caption="Automatic booking confirmations & reminders, plus WhatsApp chat bookings. Works with Twilio or the Meta WhatsApp Cloud API — while set to Off, messages are logged (not sent) so you can preview them on the web Bookings page."
    >
      <div className="space-y-1.5">
        <FieldLabel>Provider</FieldLabel>
        <Select value={provider} onValueChange={setProvider} disabled={busy}>
          <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PROVIDERS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <FieldLabel htmlFor="msg-sender">{meta ? "Phone number ID (Meta)" : "Sender phone number (Twilio)"}</FieldLabel>
        <Input id="msg-sender" value={sender} disabled={busy} placeholder={meta ? "e.g. 106540118xxxxxx" : "e.g. +14155238886"} onChange={(e) => { setSender(e.target.value) }} />
      </div>
      {!meta ? (
        <div className="space-y-1.5">
          <FieldLabel htmlFor="msg-key-id">Account SID (Twilio)</FieldLabel>
          <Input id="msg-key-id" value={keyId} disabled={busy} placeholder="AC…" onChange={(e) => { setKeyId(e.target.value) }} />
        </div>
      ) : null}
      <div className="space-y-1.5">
        <FieldLabel htmlFor="msg-secret">{meta ? "Permanent access token (Meta)" : "Auth token (Twilio)"}</FieldLabel>
        <SecretInput
          id="msg-secret"
          value={secret}
          onChange={setSecret}
          disabled={busy}
          placeholder={secretConfigured ? "Leave blank to keep current secret" : "Enter the provider secret"}
        />
      </div>
      <div className="space-y-1.5">
        <FieldLabel htmlFor="msg-hours">Reminder lead time (hours before the booking, 0 = off)</FieldLabel>
        <Input id="msg-hours" inputMode="numeric" value={hours} disabled={busy} className="max-w-[8rem]" onChange={(e) => { setHours(e.target.value.replace(/[^0-9]/g, "")) }} />
      </div>
      <SaveButton busy={busy} label="Save messaging settings" onClick={save} />
      <div className="space-y-2 border-t border-divider pt-4">
        <div className="text-sm font-semibold">WhatsApp chat bookings (webhook)</div>
        <p className="text-xs text-muted-foreground">
          Point your provider&apos;s inbound-message webhook at the backend so guests can book by sending e.g. &quot;book 4 tomorrow 19:30&quot;:
        </p>
        <code className="block select-all break-all rounded-md border bg-inset px-3 py-2 font-mono text-xs">/webhooks/whatsapp/{slug}</code>
        {webhookSecret ? (
          <>
            <p className="text-xs text-muted-foreground">Meta verify token (also signs webhook payloads):</p>
            <code className="block select-all break-all rounded-md border bg-inset px-3 py-2 font-mono text-xs">{webhookSecret}</code>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Save once to generate the webhook verify token.</p>
        )}
      </div>
    </SettingsCard>
  )
}
