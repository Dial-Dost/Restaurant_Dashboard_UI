"use client"

// SETTINGS — the web copy of Flutter `settingsModule` (modules.dart ~31578).
// One centered column of cards under section headers, in Flutter's order:
// Profile → Time → Ordering → Payments → Messaging → Billing & taxes →
// Appearance — this device → Branding. Every card carries its own Save (or
// saves on flip/pick); there is no page-level form or submit.
//
// The cards seeded from the settings document are keyed on the payload (as
// Flutter's KeyedSubtree on settingsPayloadKey): a refresh that really changed
// the settings remounts them, one that only confirmed them does not.

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import QRCodeLib from "qrcode"
import { Save, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LoadErrorState } from "@/components/ui/load-error-state"
import { SectionHeader } from "@/components/ui/section-header"
import { SkeletonRows } from "@/components/ui/fork-skeleton"
import { CacheStalePill } from "@/components/ui/stale-pill"
import { useToast } from "@/hooks/use-toast"
import { useCachedFetch } from "@/hooks/use-cached-fetch"
import { useAuth } from "@/context/AuthContext"
import { getRestaurantProfile } from "@/lib/db"
import {
  errorText,
  fetchSettingsBundle,
  kotDocketSupported,
  num,
  payloadKey,
  readKotSize,
  readKotStyle,
  saveRestaurantProfile,
  str,
  type ProfileFields,
  type SettingsBundle,
} from "@/lib/api/settings"
import { PERM_SETTINGS, hasPermission } from "@/lib/mis-capture"
import { AppearanceCard } from "@/components/settings/appearance-card"
import { BillLogoCard, BillingControlsCard, TaxCard } from "@/components/settings/billing-cards"
import { BrandingLogoCard, FeedbackFormCard } from "@/components/settings/branding-feedback-cards"
import { AutoPushCard, KotAutoPrintCard, KotDocketCard, QueueMenuCard, RequireOtpCard } from "@/components/settings/ordering-cards"
import { MessagingCard, RazorpayCard } from "@/components/settings/razorpay-messaging-cards"
import { FieldLabel, SettingsCard } from "@/components/settings/settings-card"
import { BillPrintSettingsCard } from "./bill-print-settings"
import { BillingCountersCard } from "./billing-counters"
import { PaymentMethodsCard } from "./payment-methods-settings"
import { BrandingCustomizer } from "./branding-customizer"
import { PostersEditor } from "./posters-editor"
import { TimezoneSelector } from "./timezone-selector"

/** 24px between groups, 14px between the cards of a group. */
function Group({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="space-y-3.5">
      <SectionHeader title={title} />
      {children}
    </section>
  )
}

const EMPTY_PROFILE: ProfileFields = { name: "", address: "", phone: "", email: "", hours: "" }

function ProfileCard({ rid, employeeId, onName, onLogo }: {
  rid: string; employeeId: string; onName: (n: string) => void; onLogo: (url: string) => void
}): React.JSX.Element {
  const { toast } = useToast()
  const [p, setP] = useState<ProfileFields>(EMPTY_PROFILE)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    getRestaurantProfile(rid, employeeId)
      .then((profile) => {
        if (!active) {return}
        setP({
          name: profile.restaurant_name || "",
          address: profile.outlet_add || "",
          phone: profile.outlet_phone || "",
          email: profile.email || "",
          hours: profile.outlet_hours || "",
        })
        onName(profile.restaurant_name || "")
        onLogo(profile.restaurant_logo_url || "")
      })
      .catch(() => { /* fields stay blank; a save still sends what is typed */ })
    return () => { active = false }
  }, [rid, employeeId, onName, onLogo])

  const save = (): void => {
    setBusy(true)
    saveRestaurantProfile(rid, p)
      .then(() => { onName(p.name.trim()); toast({ description: "Profile saved." }) })
      .catch((e: unknown) => { toast({ variant: "destructive", description: errorText(e) }) })
      .finally(() => { setBusy(false) })
  }

  const field = (key: keyof ProfileFields, label: string, placeholder: string, type = "text"): React.JSX.Element => (
    <div className="space-y-1.5">
      <FieldLabel htmlFor={`profile-${key}`}>{label}</FieldLabel>
      <Input id={`profile-${key}`} type={type} value={p[key]} placeholder={placeholder} disabled={busy}
        onChange={(e) => { const v = e.target.value; setP((prev) => ({ ...prev, [key]: v })) }} />
    </div>
  )

  return (
    <SettingsCard title="Restaurant profile" caption="Name, address, contact and working hours shown on bills and guest pages.">
      {field("name", "Name", "Your restaurant's name")}
      {field("address", "Address", "Street, area, city")}
      <div className="grid gap-4 sm:grid-cols-2">
        {field("phone", "Phone", "Phone number", "tel")}
        {field("email", "Email", "contact@yourrestaurant.com", "email")}
      </div>
      {field("hours", "Hours", "e.g. Mon–Sun 11:00–23:00")}
      <div className="flex justify-end">
        <Button type="button" size="sm" className="gap-1.5" disabled={busy} onClick={save}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {busy ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </SettingsCard>
  )
}

/** The groups seeded from GET /restaurant/settings (+ the branding read). */
function SeededGroups({ rid, bundle, refresh, profileLogo, restaurantName, isAdmin, canEditSettings }: {
  rid: string
  bundle: SettingsBundle
  refresh: () => void
  profileLogo: string
  restaurantName: string
  isAdmin: boolean
  canEditSettings: boolean
}): React.JSX.Element {
  const m = bundle.settings
  const brand = bundle.brand
  const queueShowMenu = (brand.queue_show_menu ?? m.queue_show_menu) !== false
  const feedback = m.feedback_config && typeof m.feedback_config === "object"
    ? (m.feedback_config as Record<string, unknown>)
    : {}

  return (
    <>
      <Group title="Ordering">
        <AutoPushCard rid={rid} initial={m.auto_push_orders !== false} />
        <RequireOtpCard rid={rid} initial={m.require_table_otp === true} />
        <KotAutoPrintCard rid={rid} initial={m.kot_auto_print !== false} />
        {kotDocketSupported(m) ? (
          <KotDocketCard rid={rid} initialStyle={readKotStyle(m)} initialSize={readKotSize(m)} />
        ) : null}
        <QueueMenuCard rid={rid} initial={queueShowMenu} />
      </Group>

      <Group title="Payments">
        <PaymentMethodsCard
          restaurantId={rid}
          canEdit={canEditSettings}
          initialCurrency={str(m, "currency", "₹")}
          initialMethods={m.payment_methods}
        />
        <RazorpayCard
          rid={rid}
          initialKeyId={str(m, "razorpay_key_id")}
          configured={m.razorpay_configured === true}
          onSaved={refresh}
        />
      </Group>

      <Group title="Messaging">
        <MessagingCard
          rid={rid}
          slug={rid}
          initialProvider={str(m, "msg_provider", "none")}
          initialSender={str(m, "msg_sender")}
          initialKeyId={str(m, "msg_key_id")}
          secretConfigured={m.msg_secret_configured === true}
          initialReminderHours={Math.trunc(num(m, "msg_reminder_hours", 2))}
          webhookSecret={str(m, "msg_webhook_secret")}
          onSaved={refresh}
        />
      </Group>

      <Group title="Billing & taxes">
        <TaxCard
          rid={rid}
          initialTaxes={Array.isArray(m.taxes) ? m.taxes : []}
          initialServiceCharge={num(m, "service_charge", 0)}
          onSaved={refresh}
        />
        <BillingControlsCard
          rid={rid}
          initialThreshold={num(m, "discount_approval_threshold", 0)}
          initialReopenWindow={Math.trunc(num(m, "bill_reopen_window_min", 240))}
          onSaved={refresh}
        />
        <BillingCountersCard restaurantId={rid} canEdit={canEditSettings} />
        <BillLogoCard
          rid={rid}
          initialSvg={str(m, "bill_logo_svg")}
          initialPaperWidth={str(m, "bill_paper_width", "80mm")}
          onSaved={refresh}
        />
        <BillPrintSettingsCard restaurantId={rid} isAdmin={isAdmin} />
      </Group>

      <Group title="Appearance — this device">
        <AppearanceCard />
      </Group>

      <Group title="Branding">
        <BrandingLogoCard
          rid={rid}
          initialLogo={str(brand, "logo_url") || profileLogo}
          initialColor={str(brand, "theme_color")}
          onSaved={refresh}
        />
        {isAdmin ? (
          <BrandingCustomizer restaurantId={rid} isAdmin={isAdmin} restaurantName={restaurantName} />
        ) : null}
        {/* Same job as the branding cards — what the guest pages look like —
            and gated the same way (the poster routes require Manage Branding). */}
        {isAdmin ? <PostersEditor restaurantId={rid} isAdmin={isAdmin} /> : null}
        <FeedbackFormCard rid={rid} initial={feedback} />
      </Group>
    </>
  )
}

export function SettingsForm(): React.JSX.Element {
  const { user } = useAuth()
  const rid = user?.restaurantUsername ?? ""
  const [restaurantName, setRestaurantName] = useState("")
  const [profileLogo, setProfileLogo] = useState("")

  const isAdmin = !!user && (user.role === "admin" || (Array.isArray(user.role_all) && user.role_all.includes("admin")))
  const canEditSettings = !!user && hasPermission(user.actions_set, PERM_SETTINGS)

  const { data, loading, error, offline, fromCache, updatedAt, retry, refresh } = useCachedFetch(
    `settings:${rid}`,
    () => fetchSettingsBundle(rid),
    { enabled: rid.length > 0 },
  )

  if (!user?.restaurantUsername) {
    return <SkeletonRows rows={6} />
  }

  return (
    <div className="relative space-y-6 pb-8">
      <Group title="Profile">
        <ProfileCard rid={rid} employeeId={user.employeeId} onName={setRestaurantName} onLogo={setProfileLogo} />
      </Group>

      {/* Sits high on purpose: it governs how every other screen's numbers are dated. */}
      <Group title="Time">
        <TimezoneSelector restaurantId={rid} isAdmin={isAdmin} />
      </Group>

      {loading ? (
        <SkeletonRows rows={8} title />
      ) : error || !data ? (
        <LoadErrorState whatFailed="Couldn't load settings." error={error} onRetry={retry} />
      ) : (
        <div key={payloadKey(data)} className="space-y-6">
          <SeededGroups
            rid={rid}
            bundle={data}
            refresh={refresh}
            profileLogo={profileLogo}
            restaurantName={restaurantName}
            isAdmin={isAdmin}
            canEditSettings={canEditSettings}
          />
        </div>
      )}

      <Group title="My feedback QR">
        <FeedbackQrCard />
      </Group>

      <CacheStalePill offline={offline} fromCache={fromCache} updatedAt={updatedAt} />
    </div>
  )
}

interface QrLib { toDataURL: (text: string, opts: { width: number; margin: number }) => Promise<string> }

/* ── Web-extra (kept on purpose): the signed-in employee's feedback link ── */

function FeedbackQrCard(): React.JSX.Element {
  const { toast } = useToast()
  const { user } = useAuth()
  const [qr, setQr] = useState("")
  const [qrError, setQrError] = useState("")

  const url = useMemo(() => {
    if (!user?.res_id || !user.employeeId || !user.outlet_id || typeof window === "undefined") {return ""}
    // The feedback form lives inside this app at /feedback, so same-origin is the
    // default; NEXT_PUBLIC_FEEDBACK_FORM_URL still overrides it.
    let base = (process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL ?? "").trim() || `${window.location.origin}/feedback`
    try {
      const parsed = new URL(base)
      const local = (h: string): boolean => h === "localhost" || h === "127.0.0.1"
      // Keep explicit public URLs, but fix local placeholders on deployed hosts.
      if (local(parsed.hostname.toLowerCase()) && !local(window.location.hostname.toLowerCase())) {
        parsed.protocol = window.location.protocol
        parsed.hostname = window.location.hostname
        base = parsed.toString()
      }
    } catch {
      /* invalid env URL — use as-is */
    }
    base = base.replace(/\/$/, "")
    const params = new URLSearchParams({
      restaurantId: user.res_id,
      employeeId: user.employeeId,
      outletId: user.outlet_id,
    })
    return `${base}?${params.toString()}`
  }, [user?.res_id, user?.employeeId, user?.outlet_id])

  useEffect(() => {
    let active = true
    if (!url) {
      setQr("")
      setQrError("Feedback URL is unavailable.")
      return
    }
    (QRCodeLib as unknown as QrLib).toDataURL(url, { width: 280, margin: 2 })
      .then((d: string) => { if (active) { setQr(d); setQrError("") } })
      .catch(() => { if (active) { setQr(""); setQrError("Unable to generate QR code") } })
    return () => { active = false }
  }, [url])

  return (
    <SettingsCard title="My feedback QR" caption="Share this QR with customers so feedback is linked to your employee profile.">
      <div className="space-y-1.5">
        <FieldLabel htmlFor="feedback-link">Feedback link</FieldLabel>
        <Input id="feedback-link" value={url} readOnly />
      </div>
      {qr ? (
        <div className="space-y-3">
          <Image src={qr} alt="Feedback QR code" width={224} height={224} className="h-56 w-56 rounded-md border bg-white p-2" />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => {
              if (!url) {return}
              navigator.clipboard.writeText(url)
                .then(() => { toast({ description: "Feedback link copied to clipboard." }) })
                .catch(() => { toast({ variant: "destructive", description: "Could not copy feedback link." }) })
            }}>
              Copy link
            </Button>
            <Button asChild size="sm">
              <a href={qr} download={`feedback-qr-${user?.employeeId ?? "employee"}.png`}>Download QR</a>
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{qrError || "Generating QR code…"}</p>
      )}
    </SettingsCard>
  )
}
