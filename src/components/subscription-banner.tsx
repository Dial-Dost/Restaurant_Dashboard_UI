"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { getBilling, type BillingInfo } from "@/lib/db";

// Dashboard-wide nudge shown to admins when the trial is ending or payment is
// overdue, linking to the Billing page. Reads only stable subscription fields and
// fails silent (best-effort) so it never blocks the dashboard.
export function SubscriptionBanner() {
  const { user } = useAuth();
  const rid = user?.restaurantUsername ?? "";
  const isAdmin = [user?.role, ...(((user as any)?.role_all as string[] | undefined) ?? [])]
    .map((r) => String(r ?? "").toLowerCase())
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

  const days = sub.trial_ends_at
    ? Math.ceil((new Date(sub.trial_ends_at).getTime() - Date.now()) / 86_400_000)
    : null;

  let message: string | null = null;
  let urgent = false;
  if (sub.status === "trial" && days != null) {
    message = days >= 0
      ? `Your free trial ends in ${days} day${days === 1 ? "" : "s"} — choose a plan to keep your features.`
      : "Your free trial has ended — choose a plan to continue.";
    urgent = days <= 3;
  } else if (sub.status === "past_due") {
    message = "Your subscription payment is overdue. Please update your billing.";
    urgent = true;
  }
  if (!message) {return null;}

  const cls = urgent
    ? "bg-red-50 border-red-300 text-red-800"
    : "bg-amber-50 border-amber-300 text-amber-900";

  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-4 py-2 text-sm ${cls}`}>
      <span>{message}</span>
      <Link href="/dashboard/billing" className="rounded-md border border-current px-3 py-1 font-medium hover:opacity-80">
        View plans
      </Link>
    </div>
  );
}
