"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { getBilling, type BillingInfo, type BillingSubscription } from "@/lib/db";

/* ── Subscription state (the app's _BillingView derivation) ─────────────── */

/** A lapsed period is a renewal IN FLIGHT for 48h (charge settles async,
 *  one nightly retry), then a failed renewal. */
export const GRACE_AFTER_PERIOD_END_MS = 48 * 3_600_000;

/** Whole days left, rounded UP (20h left -> 1). */
export const daysLeft = (ms: number): number => Math.ceil(Math.trunc(ms / 60_000) / 1440);
/** Whole days late, rounded DOWN (silent for the first 24h). */
export const daysLate = (ms: number): number => Math.floor(-Math.trunc(ms / 60_000) / 1440);
export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

function msUntil(iso: string | null | undefined): number | null {
  if (!iso) { return null; }
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t - Date.now();
}

export interface SubscriptionState {
  status: string;
  trialLeft: number | null;
  periodLeft: number | null;
  renewing: boolean;
  overdue: boolean;
}

export function subscriptionState(sub: BillingSubscription | null | undefined): SubscriptionState {
  const status = sub?.status ?? "";
  const trialLeft = status === "trial" ? msUntil(sub?.trial_ends_at) : null;
  const periodLeft = msUntil(sub?.current_period_end);
  const lapsed = status === "active" && periodLeft != null && periodLeft < 0;
  const renewing = lapsed && -periodLeft <= GRACE_AFTER_PERIOD_END_MS;
  const overdue = status === "past_due" || status === "suspended" || (lapsed && !renewing);
  return { status, trialLeft, periodLeft, renewing, overdue };
}

// Dashboard-wide nudge shown to admins when the trial is ending or payment is
// overdue, linking to the Billing page. Reads only stable subscription fields and
// fails silent (best-effort) so it never blocks the dashboard. Its overdue test
// is the billing page's, so the two never disagree.
export function SubscriptionBanner(): React.JSX.Element | null {
  const { user } = useAuth();
  const rid = user?.restaurantUsername ?? "";
  const isAdmin = [user?.role, ...(user?.role_all ?? [])]
    .map((r) => (r ?? "").toLowerCase())
    .includes("admin");
  const [info, setInfo] = useState<BillingInfo | null>(null);

  useEffect(() => {
    if (!rid || !isAdmin) {return;}
    let active = true;
    getBilling(rid)
      .then((d) => { if (active) {setInfo(d);} })
      .catch(() => { /* best-effort */ });
    return () => { active = false; };
  }, [rid, isAdmin]);

  if (!isAdmin || !info?.configured) {return null;}
  const sub = info.subscription;
  if (!sub) {return null;}

  const st = subscriptionState(sub);
  let message: string | null = null;
  let urgent = false;
  if (st.overdue) {
    message = "Your subscription payment is overdue. Settle it to keep your plan.";
    urgent = true;
  } else if (sub.status === "trial" && st.trialLeft != null) {
    const days = daysLeft(st.trialLeft);
    message = st.trialLeft >= 0
      ? days <= 0
        ? "Your free trial ends today — choose a plan to keep your features."
        : `Your free trial ends in ${plural(days, "day")} — choose a plan to keep your features.`
      : "Your free trial has ended — choose a plan to continue.";
    urgent = days <= 3;
  }
  if (!message) {return null;}

  const cls = urgent
    ? "border-destructive/30 bg-destructive/10 text-destructive"
    : "border-warning/30 bg-warning/10 text-warning";

  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-4 py-2 text-sm ${cls}`}>
      <span>{message}</span>
      <Link href="/dashboard/billing" className="rounded-md border border-current px-3 py-1 font-medium hover:opacity-80">
        View plans
      </Link>
    </div>
  );
}
