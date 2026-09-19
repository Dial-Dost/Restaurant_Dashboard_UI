"use client"

import { useCallback, useEffect, useState } from "react"
import { ArrowRight, BadgeCheck, CreditCard, ReceiptText, Store } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ForkCard } from "@/components/ui/fork-card"
import { StatCard } from "@/components/ui/stat-card"
import { StatusChip, InfoChip, type StatusChipStatus } from "@/components/ui/status-chip"
import { MicroStat } from "@/components/ui/micro-stat"
import { SectionHeader } from "@/components/ui/section-header"
import { EmptyState } from "@/components/ui/empty-state"
import { LoadErrorState } from "@/components/ui/load-error-state"
import { SkeletonBox, SkeletonRows } from "@/components/ui/fork-skeleton"
import { CacheStalePill } from "@/components/ui/stale-pill"
import { useCachedFetch } from "@/hooks/use-cached-fetch"
import { useAuth } from "@/context/AuthContext"
import { useToast } from "@/hooks/use-toast"
import { daysLate, daysLeft, plural, subscriptionState } from "@/components/subscription-banner"
import {
  getBilling, changePlan, billingPayCreate, billingPayVerify,
  type BillingInfo, type BillingPlan,
} from "@/lib/db"

const FEATURE_LABELS: Record<string, string> = {
  accounting: "Accounting & cash",
  analytics: "Analytics",
  inventory: "Inventory & purchasing",
  valet: "Valet",
  coupons: "Coupons",
  attendance: "Attendance",
  multi_outlet: "Multi-outlet",
}

const COPPER = "hsl(var(--accent-base))"
const COPPER_HI = "hsl(var(--accent-hi))"
const DANGER = "hsl(var(--destructive))"
const WARNING = "hsl(var(--warning))"

interface RazorpayResponse { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }
interface RazorpayInstance { open: () => void }
type RazorpayCtor = new (opts: Record<string, unknown>) => RazorpayInstance
const razorpayCtor = (): RazorpayCtor | undefined =>
  (window as unknown as { Razorpay?: RazorpayCtor }).Razorpay

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {resolve(false); return;}
    if (razorpayCtor()) {resolve(true); return;}
    const s = document.createElement("script")
    s.src = "https://checkout.razorpay.com/v1/checkout.js"
    s.onload = () => { resolve(true); }
    s.onerror = () => { resolve(false); }
    document.body.appendChild(s)
  })
}

/** The app's _stageColor for invoice statuses. */
function stageStatus(status: string): StatusChipStatus {
  const s = status.toLowerCase()
  if (s.includes("pending") || s.includes("verifying")) {return "warning"}
  if (s.includes("paid")) {return "success"}
  if (s.includes("cancel")) {return "danger"}
  return "neutral"
}

const money = (cents: number): string =>
  `₹${((cents || 0) / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 759px)")
    const on = (): void => { setNarrow(mq.matches) }
    on()
    mq.addEventListener("change", on)
    return () => { mq.removeEventListener("change", on) }
  }, [])
  return narrow
}

function FooterRow({ chip, text }: { chip: React.ReactNode; text: string }): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0">{chip}</span>
      <span className="line-clamp-2 min-w-0 text-xs text-muted-foreground">{text}</span>
    </div>
  )
}

export default function BillingPage(): React.JSX.Element {
  const { user } = useAuth()
  const { toast } = useToast()
  const rid = user?.restaurantUsername ?? ""
  const narrow = useNarrow()
  const [busy, setBusy] = useState(false)

  const billing = useCachedFetch<BillingInfo>(
    `billing:${rid}`,
    useCallback(() => getBilling(rid), [rid]),
    { enabled: rid.length > 0 },
  )
  const info = billing.data
  const load = billing.refresh

  const payInvoice = async (invoiceId: string): Promise<void> => {
    const ok = await loadRazorpay()
    if (!ok) { toast({ title: "Couldn't load the payment window", variant: "destructive" }); return }
    const order = await billingPayCreate(rid, invoiceId)
    const Razorpay = razorpayCtor()
    if (!Razorpay) { return }
    const rzp = new Razorpay({
      key: order.key_id,
      amount: order.amount,
      currency: order.currency,
      order_id: order.order_id,
      name: "Restaurant Dash",
      description: "Subscription payment",
      handler: async (resp: RazorpayResponse) => {
        try {
          await billingPayVerify(rid, {
            invoice_id: invoiceId,
            razorpay_order_id: resp.razorpay_order_id,
            razorpay_payment_id: resp.razorpay_payment_id,
            razorpay_signature: resp.razorpay_signature,
          })
          toast({ title: "Payment successful", description: "Your plan is now active." })
          load()
        } catch (e) {
          toast({ title: "Payment verification failed", description: errText(e), variant: "destructive" })
        }
      },
      modal: {
        ondismiss: () => {
          toast({ title: "Payment cancelled", description: "Your invoice is still pending — you can pay it anytime." })
          load()
        },
      },
    })
    rzp.open()
  }

  const choosePlan = async (plan: BillingPlan): Promise<void> => {
    setBusy(true)
    try {
      const r = await changePlan(rid, plan.id)
      if (r.mode === "noop") { toast({ title: `You're already on ${plan.name}.` }); load(); return }
      if (r.mode === "downgrade_scheduled") {
        toast({ title: `Scheduled — switches to ${plan.name} at period end.` })
        load(); return
      }
      if (r.invoice) {
        if (info?.online_pay) {
          // [web-extra] Pay in the browser straight away.
          await payInvoice(r.invoice.id)
        } else {
          toast({ title: `Invoice created for ${plan.name}. Your provider will confirm the payment.` })
          load()
        }
      } else {
        toast({ title: `Switched to ${plan.name}.` })
        load()
      }
    } catch (e) {
      toast({ title: "Couldn't change plan", description: errText(e), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  if (billing.loading) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-3 p-1" aria-busy="true">
        <SkeletonBox height={120} className="mb-6 rounded-lg" />
        <SkeletonRows rows={6} />
      </div>
    )
  }
  if (billing.error != null || !info) {
    return (
      <LoadErrorState whatFailed="Could not load billing" error={billing.error} onRetry={billing.retry} />
    )
  }
  if (!info.configured) {
    return (
      <EmptyState
        icon={<CreditCard />}
        title="Billing not set up"
        caption="Billing isn't set up for this workspace yet."
      />
    )
  }

  const sub = info.subscription
  const st = subscriptionState(sub)
  const { status, trialLeft, periodLeft, renewing, overdue } = st
  const currentPlanId = sub?.plan_id ?? null
  const pending = info.pending_plan

  const renewal = (): string => {
    if (overdue) {
      const late = periodLeft == null ? 0 : daysLate(periodLeft)
      return late >= 1 ? `Payment overdue by ${plural(late, "day")}` : "Payment overdue"
    }
    if (renewing) {return "Renewing — payment not confirmed yet"}
    if (status !== "active" || periodLeft == null) {return ""}
    const days = daysLeft(periodLeft)
    return days <= 0 ? "Renews today" : `Renews in ${plural(days, "day")}`
  }
  const trial = (): string => {
    if (trialLeft == null) {return ""}
    if (trialLeft < 0) {return "Trial expired"}
    const days = daysLeft(trialLeft)
    return days <= 0 ? "Trial ends today" : `Trial — ${plural(days, "day")} left`
  }
  const subCaption = [trial(), renewal(), sub == null ? "Unlimited starter (no plan assigned)." : ""]
    .filter((s) => s.length > 0)
    .join(" · ")

  const footer = overdue ? (
    <FooterRow
      chip={<StatusChip label="Renewal failed" status="danger" dense />}
      text="This subscription did not renew. Settle it to keep your plan."
    />
  ) : renewing ? (
    <FooterRow
      chip={<StatusChip label="Renewing" status="warning" dense />}
      text="The billing period ended and the payment has not confirmed yet."
    />
  ) : pending ? (
    <FooterRow
      chip={<StatusChip label="Scheduled" status="warning" dense />}
      text={`Switches to ${pending.name} at period end.`}
    />
  ) : undefined

  return (
    <div className="relative mx-auto w-full max-w-3xl p-1">
      <StatCard
        value={info.plan?.name ?? "No plan"}
        caption={<span className="uppercase tracking-[0.06em]">{subCaption ? `Current plan · ${subCaption}` : "Current plan"}</span>}
        tag={status || undefined}
        tagColor={overdue ? DANGER : renewing ? WARNING : COPPER_HI}
        footer={footer}
      />

      <div className="mt-8">
        <SectionHeader title="Plans" count={info.plans.length} />
        <div className="space-y-3">
          {info.plans.map((plan) => {
            const isCurrent = plan.id === currentPlanId && status === "active"
            const features = Object.entries(FEATURE_LABELS)
              .filter(([k]) => plan.features[k] !== false)
              .map(([, label]) => label)
            const limits = plan.limits as Partial<Record<string, string | number>>
            return (
              <ForkCard key={plan.id} selected={isCurrent}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1 truncate text-[15px] font-semibold">{plan.name}</div>
                  <MicroStat
                    value={plan.price_cents === 0 ? "Free" : `${money(plan.price_cents)}/mo`}
                    label="per month"
                    alignEnd
                  />
                </div>
                {features.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">{features.join(" · ")}</p>
                )}
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <InfoChip
                    icon={<BadgeCheck />}
                    label={limits.employees != null ? `Up to ${limits.employees} staff` : "Unlimited staff"}
                  />
                  <InfoChip
                    icon={<Store />}
                    label={limits.outlets != null ? `Up to ${limits.outlets} outlet(s)` : "Unlimited outlets"}
                  />
                </div>
                <div className="mt-3 flex justify-end">
                  {isCurrent ? (
                    <StatusChip label="Current plan" color={COPPER} />
                  ) : (
                    <Button size="sm" disabled={busy} onClick={() => void choosePlan(plan)}>
                      Choose <ArrowRight />
                    </Button>
                  )}
                </div>
              </ForkCard>
            )
          })}
        </div>
      </div>

      {info.invoices.length > 0 && (
        <div className="mt-6">
          <SectionHeader title="Invoices" count={info.invoices.length} />
          <div className="space-y-2.5">
            {info.invoices.map((inv) => (
              <ForkCard key={inv.id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[7px] border border-border bg-inset">
                    <ReceiptText className="h-4 w-4 text-accent-base" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold tabular-nums">{money(inv.amount_cents)}</div>
                    {inv.note && <div className="mt-0.5 truncate text-xs text-muted-foreground">{inv.note}</div>}
                  </div>
                  <StatusChip label={inv.status} status={stageStatus(inv.status)} dense={narrow} />
                  {inv.status === "pending" && info.online_pay && (
                    <Button size="sm" onClick={() => void payInvoice(inv.id)}>Pay</Button>
                  )}
                </div>
              </ForkCard>
            ))}
          </div>
        </div>
      )}

      <CacheStalePill offline={billing.offline} fromCache={billing.fromCache} updatedAt={billing.updatedAt} />
    </div>
  )
}
