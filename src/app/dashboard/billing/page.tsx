"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Check, RefreshCw, Crown } from "lucide-react"
import { useAuth } from "@/context/AuthContext"
import { useToast } from "@/hooks/use-toast"
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

function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {resolve(false); return;}
    if ((window as any).Razorpay) {resolve(true); return;}
    const s = document.createElement("script")
    s.src = "https://checkout.razorpay.com/v1/checkout.js"
    s.onload = () => { resolve(true); }
    s.onerror = () => { resolve(false); }
    document.body.appendChild(s)
  })
}

function daysUntil(iso: string | null): number | null {
  if (!iso) {return null}
  const ms = new Date(iso).getTime() - Date.now()
  return Number.isNaN(ms) ? null : Math.ceil(ms / 86_400_000)
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  trial: "bg-blue-100 text-blue-800",
  past_due: "bg-amber-100 text-amber-900",
  suspended: "bg-red-100 text-red-700",
  cancelled: "bg-red-100 text-red-700",
  expired: "bg-red-100 text-red-700",
}

export default function BillingPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const rid = user?.restaurantUsername ?? ""

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState<BillingInfo | null>(null)

  const money = (cents: number) => `₹${(Number(cents || 0) / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`

  const load = useCallback(async () => {
    if (!rid) {return}
    setLoading(true)
    try {
      setInfo(await getBilling(rid))
    } catch (e: any) {
      toast({ title: "Couldn't load billing", description: String(e?.message ?? e), variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [rid, toast])

  useEffect(() => { void load() }, [load])

  const payInvoice = async (invoiceId: string) => {
    const ok = await loadRazorpay()
    if (!ok) { toast({ title: "Couldn't load the payment window", variant: "destructive" }); return }
    const order = await billingPayCreate(rid, invoiceId)
    const rzp = new (window as any).Razorpay({
      key: order.key_id,
      amount: order.amount,
      currency: order.currency,
      order_id: order.order_id,
      name: "Restaurant Dash",
      description: "Subscription payment",
      handler: async (resp: any) => {
        try {
          await billingPayVerify(rid, {
            invoice_id: invoiceId,
            razorpay_order_id: resp.razorpay_order_id,
            razorpay_payment_id: resp.razorpay_payment_id,
            razorpay_signature: resp.razorpay_signature,
          })
          toast({ title: "Payment successful", description: "Your plan is now active." })
          await load()
        } catch (e: any) {
          toast({ title: "Payment verification failed", description: String(e?.message ?? e), variant: "destructive" })
        }
      },
      modal: {
        ondismiss: async () => {
          toast({ title: "Payment cancelled", description: "Your invoice is still pending — you can pay it anytime." })
          await load()
        },
      },
    })
    rzp.open()
  }

  const choosePlan = async (plan: BillingPlan) => {
    setBusy(true)
    try {
      const r = await changePlan(rid, plan.id)
      if (r.mode === "noop") { toast({ title: "You're already on this plan." }); await load(); return }
      if (r.mode === "downgrade_scheduled") {
        toast({ title: "Downgrade scheduled", description: `You'll move to ${plan.name} at the end of your current period.` })
        await load(); return
      }
      // upgrade
      if (r.invoice) {
        if (info?.online_pay) {
          await payInvoice(r.invoice.id)
        } else {
          toast({ title: "Invoice created", description: "Your provider will confirm the payment to activate the plan." })
          await load()
        }
      } else {
        toast({ title: `Switched to ${plan.name}` })
        await load()
      }
    } catch (e: any) {
      toast({ title: "Couldn't change plan", description: String(e?.message ?? e), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const sub = info?.subscription
  const currentPlanId = sub?.plan_id ?? null
  const trialDays = sub?.status === "trial" ? daysUntil(sub.trial_ends_at) : null
  const periodDays = sub?.status === "active" ? daysUntil(sub?.current_period_end ?? null) : null

  return (
    <div className="space-y-6 p-1">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Subscription &amp; billing</h1>
          <p className="text-sm text-muted-foreground">Manage your plan, upgrade for more features, and view invoices.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {loading && !info ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
      ) : !info?.configured ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Billing isn&apos;t set up for this workspace yet. Please contact support.</CardContent></Card>
      ) : (
        <>
          {/* Current plan */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Current plan: {info.plan?.name ?? "No plan"}
                {sub?.status && <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[sub.status] ?? "bg-muted"}`}>{sub.status}</span>}
              </CardTitle>
              <CardDescription>
                {trialDays != null ? `Trial — ${trialDays > 0 ? `${trialDays} day(s) left` : "expired"}.` : null}
                {periodDays != null ? `Renews in ${periodDays} day(s).` : null}
                {!sub ? "You're on an unlimited starter (no plan assigned)." : null}
                {info.pending_plan ? ` Scheduled change → ${info.pending_plan.name} at period end.` : null}
              </CardDescription>
            </CardHeader>
          </Card>

          {/* Tiers */}
          <div className="grid gap-4 md:grid-cols-3">
            {info.plans.map((plan) => {
              const isCurrent = plan.id === currentPlanId && sub?.status === "active"
              const features = Object.entries(FEATURE_LABELS).filter(([k]) => plan.features?.[k] !== false)
              const empLimit = (plan.limits as any)?.employees
              const outletLimit = (plan.limits as any)?.outlets
              const dearer = info.plan ? plan.price_cents > info.plan.price_cents : true
              return (
                <Card key={plan.id} className={isCurrent ? "border-primary ring-1 ring-primary" : ""}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      {plan.name}
                      {isCurrent && <Crown className="h-4 w-4 text-primary" />}
                    </CardTitle>
                    <CardDescription>
                      <span className="text-2xl font-bold text-foreground">{plan.price_cents === 0 ? "Free" : money(plan.price_cents)}</span>
                      {plan.price_cents > 0 && <span className="text-xs"> /month</span>}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <ul className="space-y-1 text-sm">
                      {features.map(([k, label]) => (
                        <li key={k} className="flex items-center gap-2"><Check className="h-4 w-4 text-green-600" /> {label}</li>
                      ))}
                      <li className="text-muted-foreground">{empLimit ? `Up to ${empLimit} staff` : "Unlimited staff"}</li>
                      <li className="text-muted-foreground">{outletLimit ? `Up to ${outletLimit} outlet(s)` : "Unlimited outlets"}</li>
                    </ul>
                    {isCurrent ? (
                      <Button className="w-full" disabled variant="secondary">Current plan</Button>
                    ) : (
                      <Button className="w-full" disabled={busy} onClick={() => choosePlan(plan)}>
                        {dearer ? "Upgrade" : "Switch"}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* Invoices */}
          <Card>
            <CardHeader>
              <CardTitle>Invoices</CardTitle>
              <CardDescription>
                {info.online_pay ? "Pay pending invoices online." : "Online payment isn't enabled — your provider confirms payments."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {info.invoices.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">No invoices yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-muted-foreground">
                      <tr className="border-b">
                        <th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Note</th>
                        <th className="py-2 pr-3 text-right">Amount</th><th className="py-2 pr-3">Status</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {info.invoices.map((inv) => (
                        <tr key={inv.id} className="border-b last:border-0">
                          <td className="py-2 pr-3 whitespace-nowrap">{new Date(inv.created_at).toLocaleDateString()}</td>
                          <td className="py-2 pr-3">{inv.note ?? "—"}</td>
                          <td className="py-2 pr-3 text-right">{money(inv.amount_cents)}</td>
                          <td className="py-2 pr-3">{inv.status}</td>
                          <td className="py-2 text-right">
                            {inv.status === "pending" && info.online_pay && (
                              <Button size="sm" onClick={() => void payInvoice(inv.id)}>Pay</Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
