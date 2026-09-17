"use client"

// Scheduled report delivery — WHERE IT WENT.
//
// Until client item 9 this card was the whole feature: three accounting
// reports, a CSV each, delivered to the notification bell. Item 9 made it
// "any of the eighteen reports, emailed at any time of day to addresses the
// owner chooses", and asked for it "in the reports section" — so the schedules,
// the address book and the delivery history now live in Insights → Reports →
// Email reports (src/app/dashboard/reports/email-reports.tsx), which manages
// the in-app inbox schedules made here before as well.
//
// The card stays on Accounting so an owner who set a schedule up here finds
// where it went, instead of concluding it was deleted. Every rule the old card
// documented (the combined-view refusal, "Run now" queues rather than runs,
// the restaurant's wall clock) moved with the editor.

import Link from "next/link"
import { ArrowRight, Mail } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EMAIL_AREA_TITLE } from "@/lib/report-email"

export const SCHEDULES_MOVED_SENTENCE =
    "Scheduled reports — emailed, or to the in-app inbox — are set up in Insights → Reports → Email reports, with the address book and the delivery history."

export function ScheduledReportsSection(_props: { rid: string }) {
    return (
        <Card id="scheduled-reports-section" className="scroll-mt-20">
            <CardHeader>
                <CardTitle>Scheduled reports</CardTitle>
                <CardDescription>{SCHEDULES_MOVED_SENTENCE}</CardDescription>
            </CardHeader>
            <CardContent>
                <Button asChild variant="outline" size="sm">
                    <Link href="/dashboard/reports?view=email">
                        <Mail className="mr-1.5 h-4 w-4" /> Open {EMAIL_AREA_TITLE} <ArrowRight className="ml-1.5 h-4 w-4" />
                    </Link>
                </Button>
            </CardContent>
        </Card>
    )
}
