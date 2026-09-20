"use client"

// EMAIL DELIVERY — the Settings card that switches email on from inside the web
// app. Owner-only, and the server says so: every action here re-checks the
// signed-in identity against GET /auth/me (lib/api/mail-settings.ts), so hiding
// the card is a courtesy to everyone else and not the protection.
//
// A saved password is never read back — the box shows dots and an untouched box
// keeps what is stored. The card also prints what the RESTAURANT SERVER needs
// in its environment, because the scheduled reports it sends on its own clock
// are its own business and nothing here can reach them.

import * as React from "react"
import { Copy, Loader2, Mail, Save, Send, Trash2 } from "lucide-react"

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StatusChip } from "@/components/ui/status-chip"
import { Switch } from "@/components/ui/switch"
import { FieldLabel, Hint, SettingsCard } from "@/components/settings/settings-card"
import { useToast } from "@/hooks/use-toast"
import { clearMailSettings, loadMailPanel, saveMailSettings, sendTestMail } from "@/lib/api/mail-settings"
import {
  MAIL_ADMIN_ONLY, MAIL_CARD_CAPTION, MAIL_CARD_TITLE, MAIL_SECRET_KEPT_HINT, MAIL_SECRET_PLACEHOLDER,
  MAIL_SERVER_ENV_HINT, MAIL_SERVER_ENV_TITLE, MAIL_TRANSPORT_KINDS, TRANSPORT_CAPTIONS, TRANSPORT_LABELS,
  refusedMailPanel,
  type MailPanel, type MailSettingsEdit, type MailTransportKind,
} from "@/lib/mail-settings"
import { fetchSendSetup } from "@/lib/api/reports"
import { configFromJson } from "@/components/reports/report-email"

interface Form {
  transport: MailTransportKind
  host: string
  port: string
  secure: boolean
  user: string
  from: string
  pass: string
  resendApiKey: string
}

const formFrom = (panel: MailPanel): Form => ({
  transport: panel.view.transport,
  host: panel.view.host,
  port: String(panel.view.port),
  secure: panel.view.secure,
  user: panel.view.user,
  from: panel.view.from,
  pass: "",
  resendApiKey: "",
})

const LOADING = refusedMailPanel("")

export function MailSettingsCard(): React.JSX.Element {
  const { toast } = useToast()
  const [panel, setPanel] = React.useState<MailPanel>(LOADING)
  const [form, setForm] = React.useState<Form>(formFrom(LOADING))
  const [passTouched, setPassTouched] = React.useState(false)
  const [keyTouched, setKeyTouched] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [testTo, setTestTo] = React.useState("")
  const [testResult, setTestResult] = React.useState<{ ok: boolean; message: string } | null>(null)
  const [confirmClear, setConfirmClear] = React.useState(false)
  /** What the RESTAURANT SERVER says about its own mail — null while unknown. */
  const [serverMail, setServerMail] = React.useState<{ available: boolean; reason: string | null } | null>(null)

  const adopt = React.useCallback((next: MailPanel): void => {
    setPanel(next)
    setForm(formFrom(next))
    setPassTouched(false)
    setKeyTouched(false)
  }, [])

  React.useEffect(() => {
    let live = true
    loadMailPanel()
      .then((p) => { if (live) { adopt(p) } })
      .catch(() => { if (live) { setPanel(refusedMailPanel("Couldn't read the mail settings on this server.")) } })
      .finally(() => { if (live) { setLoading(false) } })
    return () => { live = false }
  }, [adopt])

  React.useEffect(() => {
    let live = true
    fetchSendSetup()
      .then((setup) => {
        const cfg = configFromJson(setup.config)
        if (live && cfg) { setServerMail({ available: cfg.emailAvailable, reason: cfg.reason }) }
      })
      .catch(() => { /* the reports permission or an older server — the line just stays off */ })
    return () => { live = false }
  }, [])

  // The Reports banner deep-links to #email-settings, and that jump happens
  // before this card exists — the settings page is still fetching, and the card
  // itself is still asking who is signed in. So make the jump again once it is
  // on the screen, and only then.
  React.useEffect(() => {
    if (loading || typeof window === "undefined" || window.location.hash !== "#email-settings") { return }
    let ours = -1
    const jump = (): void => {
      const el = document.getElementById("email-settings")
      if (!el) { return }
      // Whoever scrolled somewhere else in the meantime is not dragged back.
      if (ours >= 0 && Math.abs(window.scrollY - ours) > 4) { return }
      const top = el.getBoundingClientRect().top
      if (top > 0 && top < window.innerHeight / 2) { return }
      // Instant, not the page's smooth default: this is a link's own jump, and
      // an animated one to a target that is still moving (and that a background
      // tab never animates at all) lands somewhere else.
      el.scrollIntoView({ block: "start", behavior: "instant" })
      ours = window.scrollY
    }
    jump()
    // The settings page keeps growing underneath this one (branding images,
    // posters), so the first jump lands short of the card. Two more, then the
    // page belongs to whoever is reading it.
    const timers = [setTimeout(jump, 600), setTimeout(jump, 1600)]
    return () => { for (const t of timers) { clearTimeout(t) } }
  }, [loading])

  const edit = (patch: Partial<Form>): void => { setForm((f) => ({ ...f, ...patch })) }

  const payload = (): MailSettingsEdit => ({
    transport: form.transport,
    host: form.host.trim(),
    port: Number.parseInt(form.port, 10) || 587,
    secure: form.secure,
    user: form.user.trim(),
    from: form.from.trim(),
    pass: passTouched ? form.pass : null,
    resendApiKey: keyTouched ? form.resendApiKey.trim() : null,
  })

  const run = (work: Promise<{ ok: boolean; message: string; panel: MailPanel }>, onDone?: (ok: boolean, message: string) => void): void => {
    setBusy(true)
    work
      .then((res) => {
        adopt(res.panel)
        if (onDone) { onDone(res.ok, res.message) } else {
          toast(res.ok ? { description: res.message } : { variant: "destructive", description: res.message })
        }
      })
      .catch((e: unknown) => {
        toast({ variant: "destructive", description: e instanceof Error ? e.message : String(e) })
      })
      .finally(() => { setBusy(false) })
  }

  if (loading) {
    return (
      <SettingsCard title={MAIL_CARD_TITLE} caption={MAIL_CARD_CAPTION}>
        <p className="text-sm text-muted-foreground">Checking the mail settings…</p>
      </SettingsCard>
    )
  }

  if (!panel.allowed) {
    return (
      <SettingsCard title={MAIL_CARD_TITLE} caption={MAIL_CARD_CAPTION}>
        <p className="text-sm text-muted-foreground">{panel.message || MAIL_ADMIN_ONLY}</p>
      </SettingsCard>
    )
  }

  const smtp = form.transport === "smtp"
  const resend = form.transport === "resend"
  const sending = form.transport !== "off"
  const storedWorks = sending && panel.problem === null

  return (
    <SettingsCard
      className="scroll-mt-24"
      title={<span id="email-settings" className="scroll-mt-24">{MAIL_CARD_TITLE}</span>}
      caption={MAIL_CARD_CAPTION}
      trailing={
        <StatusChip
          status={storedWorks ? "success" : sending ? "warning" : "neutral"}
          label={storedWorks ? "Ready" : sending ? "Needs attention" : "Off"}
        />
      }
    >
      <div className="space-y-1.5">
        <FieldLabel htmlFor="mail-transport">How email is sent</FieldLabel>
        <Select value={form.transport} onValueChange={(v) => { edit({ transport: v as MailTransportKind }) }}>
          <SelectTrigger id="mail-transport"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MAIL_TRANSPORT_KINDS.map((k) => (
              <SelectItem key={k} value={k} disabled={k === "log" && panel.production}>
                {TRANSPORT_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Hint>{TRANSPORT_CAPTIONS[form.transport]}</Hint>
      </div>

      {smtp ? (
        <>
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <div className="space-y-1.5">
              <FieldLabel htmlFor="mail-host">Mail server</FieldLabel>
              <Input id="mail-host" value={form.host} placeholder="smtp.gmail.com" disabled={busy}
                onChange={(e) => { edit({ host: e.target.value }) }} />
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="mail-port">Port</FieldLabel>
              <Input id="mail-port" inputMode="numeric" value={form.port} placeholder="587" disabled={busy}
                onChange={(e) => {
                  const port = e.target.value.replace(/[^0-9]/g, "")
                  // 465 is implicit TLS, here and on the server that sends.
                  edit(port === "465" ? { port, secure: true } : { port })
                }} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-md border border-border/60 px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-sm font-medium">TLS from the first byte</div>
              <Hint>On for port 465. Leave it off for 587 and 25, which upgrade with STARTTLS on their own.</Hint>
            </div>
            <Switch id="mail-secure" checked={form.secure} disabled={busy || form.port === "465"}
              aria-label="TLS from the first byte"
              onCheckedChange={(v) => { edit({ secure: v }) }} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <FieldLabel htmlFor="mail-user">Username</FieldLabel>
              <Input id="mail-user" autoComplete="off" value={form.user} placeholder="reports@yourrestaurant.com" disabled={busy}
                onChange={(e) => { edit({ user: e.target.value }) }} />
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="mail-pass">Password</FieldLabel>
              <Input id="mail-pass" type="password" autoComplete="new-password" disabled={busy}
                value={passTouched ? form.pass : panel.view.hasPassword ? MAIL_SECRET_PLACEHOLDER : ""}
                placeholder="The mailbox password or app password"
                onChange={(e) => { setPassTouched(true); edit({ pass: e.target.value }) }} />
              {panel.view.hasPassword && !passTouched ? <Hint>{MAIL_SECRET_KEPT_HINT}</Hint> : null}
            </div>
          </div>
        </>
      ) : null}

      {resend ? (
        <div className="space-y-1.5">
          <FieldLabel htmlFor="mail-resend-key">Resend API key</FieldLabel>
          <Input id="mail-resend-key" type="password" autoComplete="off" disabled={busy}
            value={keyTouched ? form.resendApiKey : panel.view.hasResendKey ? MAIL_SECRET_PLACEHOLDER : ""}
            placeholder="re_…"
            onChange={(e) => { setKeyTouched(true); edit({ resendApiKey: e.target.value }) }} />
          {panel.view.hasResendKey && !keyTouched ? <Hint>{MAIL_SECRET_KEPT_HINT}</Hint> : null}
        </div>
      ) : null}

      {sending ? (
        <div className="space-y-1.5">
          <FieldLabel htmlFor="mail-from">Send as</FieldLabel>
          <Input id="mail-from" value={form.from} disabled={busy}
            placeholder={smtp ? "Reports <reports@yourrestaurant.com> — blank uses the username" : "Reports <reports@yourrestaurant.com>"}
            onChange={(e) => { edit({ from: e.target.value }) }} />
          <Hint>
            {resend
              ? "Must be an address on a domain verified with Resend."
              : "What guests and staff see in the From line."}
          </Hint>
        </div>
      ) : null}

      {panel.problem !== null ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
          {panel.problem}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          {panel.view.updatedAt === ""
            ? "Not set up yet on this server."
            : `Last changed ${new Date(panel.view.updatedAt).toLocaleString()}${panel.view.updatedBy === "" ? "" : ` by ${panel.view.updatedBy}`}.`}
        </div>
        <div className="flex gap-2">
          {panel.view.updatedAt === "" ? null : (
            <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-destructive hover:text-destructive"
              disabled={busy} onClick={() => { setConfirmClear(true) }}>
              <Trash2 className="h-3.5 w-3.5" /> Clear
            </Button>
          )}
          <Button type="button" size="sm" className="gap-1.5" disabled={busy}
            onClick={() => { run(saveMailSettings(payload())) }}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
          </Button>
        </div>
      </div>

      {/* The proof. It sends with what is STORED, so a pass here is a pass for
          everything this app emails — never with the unsaved boxes above. */}
      <div className="space-y-2 rounded-md border border-border/60 p-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Mail className="h-4 w-4 text-muted-foreground" /> Send a test email
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1 space-y-1.5">
            <FieldLabel htmlFor="mail-test-to">To</FieldLabel>
            <Input id="mail-test-to" type="email" value={testTo} placeholder="you@yourrestaurant.com" disabled={busy}
              onChange={(e) => { setTestTo(e.target.value); setTestResult(null) }} />
          </div>
          <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={busy || testTo.trim() === ""}
            onClick={() => {
              run(sendTestMail(testTo), (ok, message) => { setTestResult({ ok, message }) })
            }}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send test
          </Button>
        </div>
        <Hint>Save first — the test uses the saved settings.</Hint>
        {testResult ? (
          <p className={testResult.ok ? "text-xs text-success" : "text-xs text-destructive"}>{testResult.message}</p>
        ) : null}
      </div>

      {/* Scheduled reports are the restaurant server's own job. */}
      <div className="space-y-2 rounded-md border border-border/60 p-3">
        <div className="text-sm font-semibold">{MAIL_SERVER_ENV_TITLE}</div>
        {serverMail ? (
          <p className="text-xs text-muted-foreground">
            {serverMail.available
              ? "That server can send email already — scheduled reports go out on their own."
              : `That server can't send email yet${serverMail.reason === null || serverMail.reason === "" ? "" : ` (${serverMail.reason})`}.`}
          </p>
        ) : null}
        <Hint>{MAIL_SERVER_ENV_HINT}</Hint>
        <pre className="overflow-x-auto rounded bg-muted px-3 py-2 text-[11px] leading-5 text-foreground">
          {panel.envLines.join("\n")}
        </pre>
        <Button type="button" variant="ghost" size="sm" className="gap-1.5"
          onClick={() => {
            navigator.clipboard.writeText(panel.envLines.join("\n"))
              .then(() => { toast({ description: "Copied the server settings." }) })
              .catch(() => { toast({ variant: "destructive", description: "Couldn't copy — select the lines instead." }) })
          }}>
          <Copy className="h-3.5 w-3.5" /> Copy
        </Button>
        {panel.storeLabel === "" ? null : (
          <Hint>Kept on this server in {panel.storeLabel} (readable only by the app), never in the restaurant database.</Hint>
        )}
      </div>

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear the mail settings?</AlertDialogTitle>
            <AlertDialogDescription>
              The password or API key is deleted from this server. Nothing this app sends will be emailed until it is set up again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmClear(false); run(clearMailSettings()) }}>Clear</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsCard>
  )
}
