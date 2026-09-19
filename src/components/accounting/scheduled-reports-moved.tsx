"use client"

// Where Accounting's scheduled reports went (client item 9 asked for them
// "in the reports section") — web copy of `_ScheduledReportsMovedCard`
// (restaurant_owner_app/lib/screens/report_email.dart 1526–1561). Kept on
// Accounting so an owner who set one up here finds it, rather than concluding
// it was deleted. The button is hidden outright when the Reports module is
// not reachable for this user, never disabled.

import * as React from "react"
import { useRouter } from "next/navigation"
import { Mail } from "lucide-react"

import { Button } from "@/components/ui/button"
import { SectionHeader } from "@/components/ui/section-header"
import { useVisibleNav } from "@/hooks/use-nav"
import { moduleByLabel } from "@/lib/nav-registry"

export const kSchedulesMovedSentence =
  "Scheduled reports — emailed, or to the in-app inbox — are set up in Insights → Reports → Email reports, " +
  "with the address book and the delivery history."

export function ScheduledReportsMovedCard(): React.JSX.Element {
  const router = useRouter()
  const { labels } = useVisibleNav()
  const canOpen = labels.includes("Reports")
  const href = moduleByLabel("Reports")?.href ?? "/dashboard/reports"

  return (
    <section>
      <SectionHeader title="Scheduled reports" className="mb-1.5" />
      <p className="text-xs text-muted-foreground">{kSchedulesMovedSentence}</p>
      {canOpen && (
        <div className="mt-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { router.push(`${href}?view=email`) }}
          >
            <Mail /> Open Email reports
          </Button>
        </div>
      )}
    </section>
  )
}
