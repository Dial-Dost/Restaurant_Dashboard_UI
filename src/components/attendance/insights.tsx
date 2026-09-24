"use client";

/*
  THE HALF OF THE ATTENDANCE PAGE THAT WAS BLANK.

  Client: "The waiters attendance page looks very empty", with a mock of an
  attendance dashboard attached — "we can add something like this to make it
  look better".

  WHY IT WAS EMPTY, WHICH DECIDES WHAT GOES IN IT
  -----------------------------------------------
  Everything below the my-shift card was manager-only: pending approvals and
  team hours. A waiter therefore got ONE tile, ONE card, and half a screen of
  nothing. The two halves need different filling, and neither may be filled with
  data the server does not have:

    • A WAITER can be told about their own shift, and that is genuinely all the
      backend will tell them — GET /attendance/me returns four fields and the
      team endpoint is permission-gated. So their half is made useful rather than
      made bigger: the shift clock ticks, today's hours are broken into "this
      shift" and "earlier today", and the rules that decide those numbers are
      written down where the question gets asked instead of hidden in a sheet.

    • A MANAGER gets the insight block from the mock — punctuality, late
      arrivals, missed punches, hours, and the exceptions list — all reduced
      from /analytics/advanced, which has computed exactly these figures for a
      long time and was only ever read on the Analytics page.

  WHAT IS DELIBERATELY NOT HERE: an overtime figure. See the header of
  lib/attendance-insights.ts — there is no roster to be "over".
*/

import * as React from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock3, Hourglass, TimerReset, UserRound } from "lucide-react";

import { ForkCard } from "@/components/ui/fork-card";
import { MicroStat } from "@/components/ui/micro-stat";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";
import {
    attendanceExceptions,
    attendanceHeadline,
    earlierShiftMinutes,
    hoursMinutes,
    punctualityCaption,
    shiftElapsed,
    type AttendanceStatRow,
    type AttendanceStatSummary,
} from "@/lib/attendance-insights";
import { Avatar } from "./bits";

/* ────────────────────────────────────────────────────────────────────────
   The personal half — everyone sees this, waiters ONLY see this
   ──────────────────────────────────────────────────────────────────────── */

export interface MyShiftPanelProps {
    clockedIn: boolean;
    /** ISO instant the open shift started, or null. */
    since: string | null;
    /** Everything counted today, open shift included (GET /attendance/me). */
    todayMinutes: number;
    pendingApproval: boolean;
    /** "09:41" in the restaurant's zone — the caller formats, this only draws. */
    startedAtLabel: string;
    zone: string;
}

export function MyShiftPanel({
    clockedIn, since, todayMinutes, pendingApproval, startedAtLabel, zone,
}: MyShiftPanelProps): React.JSX.Element {
    /*
      ONE TICK A MINUTE, and only while a shift is actually open. The figure it
      moves changes once a minute, so a per-second timer would be 59 renders of
      the same string — and this screen is left open on a till all night.
    */
    const [now, setNow] = React.useState(() => Date.now());
    React.useEffect(() => {
        if (!clockedIn || since === null) { return; }
        const id = window.setInterval(() => { setNow(Date.now()); }, 30_000);
        return () => { window.clearInterval(id); };
    }, [clockedIn, since]);

    const current = clockedIn ? shiftElapsed(since, now) : null;
    const earlier = earlierShiftMinutes(todayMinutes, current);

    return (
        <div className="grid gap-4 min-[880px]:grid-cols-2">
            <ForkCard className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                    <span className="micro-label">This shift</span>
                    {clockedIn
                        ? <StatusChip color="hsl(var(--primary))" label="Running" dense />
                        : <StatusChip status="neutral" label="Not started" dense />}
                </div>
                <div className="display-md tabular-nums">{clockedIn ? hoursMinutes(current) : "—"}</div>
                <p className="text-xs text-muted-foreground">
                    {clockedIn
                        ? `Started ${startedAtLabel} (${zone}). The clock runs until you clock out.`
                        : "You are off shift. Clock in when you arrive and your hours start counting."}
                </p>
                {pendingApproval ? (
                    <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
                        <Hourglass aria-hidden className="h-[13px] w-[13px] shrink-0" />
                        Waiting on a manager&apos;s approval — the time you clocked in is already recorded.
                    </p>
                ) : null}
            </ForkCard>

            <ForkCard className="flex flex-col gap-3">
                <span className="micro-label">Today</span>
                <div className="display-md tabular-nums">{hoursMinutes(todayMinutes)}</div>
                <div className="flex flex-wrap gap-6">
                    <MicroStat icon={<Clock3 />} value={clockedIn ? hoursMinutes(current) : "—"} label="this shift" />
                    <MicroStat icon={<TimerReset />} value={earlier === null ? "—" : hoursMinutes(earlier)} label="earlier today" />
                    <MicroStat icon={<CalendarClock />} value={clockedIn ? startedAtLabel : "—"} label="started" />
                </div>
                <p className="text-xs text-muted-foreground">
                    Every shift you started today is added together. A rejected clock-in is left out, and an open
                    shift counts up to this moment — so this figure keeps rising while you are on it.
                </p>
            </ForkCard>
        </div>
    );
}

/* ────────────────────────────────────────────────────────────────────────
   The manager half — the insight block from the client's mock
   ──────────────────────────────────────────────────────────────────────── */

const TILE_TONE: Record<"good" | "warn" | "bad" | "plain", string> = {
    good: "text-success",
    warn: "text-warning",
    bad: "text-destructive",
    plain: "text-foreground",
};

function InsightTile({
    value, label, caption, tone = "plain", icon,
}: {
    value: string;
    label: string;
    caption: string;
    tone?: "good" | "warn" | "bad" | "plain";
    icon: React.ReactNode;
}): React.JSX.Element {
    return (
        <ForkCard inset className="flex flex-col gap-1.5 !p-3.5">
            <span className="flex items-center gap-1.5 micro-label">
                <span aria-hidden className="text-muted-foreground [&>svg]:h-[13px] [&>svg]:w-[13px]">{icon}</span>
                {label}
            </span>
            <span className={cn("text-[26px] font-light leading-none tracking-[-0.5px] tabular-nums", TILE_TONE[tone])}>
                {value}
            </span>
            <span className="text-[11px] leading-snug text-muted-foreground">{caption}</span>
        </ForkCard>
    );
}

export type InsightsState =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "error"; error: string }
    | { status: "done"; rows: AttendanceStatRow[]; summary: AttendanceStatSummary | null };

export interface TeamInsightsProps {
    state: InsightsState;
    /** Asked for the first time this renders — the page owns the fetch. */
    ensure: () => void;
    /** False when this session may not read analytics; the block says so once. */
    allowed: boolean;
}

export function TeamInsights({ state, ensure, allowed }: TeamInsightsProps): React.JSX.Element | null {
    React.useEffect(() => { if (allowed) { ensure(); } }, [allowed, ensure]);

    if (!allowed) { return null; }

    if (state.status === "loading" || state.status === "idle") {
        return (
            <section className="grid gap-2">
                <SectionHeader title="Attendance insights — last 30 days" />
                <p className="text-xs text-muted-foreground">Reading the attendance record…</p>
            </section>
        );
    }
    if (state.status === "error") {
        return (
            <section className="grid gap-2">
                <SectionHeader title="Attendance insights — last 30 days" />
                <p className="text-xs text-muted-foreground">Insights unavailable — {state.error}</p>
            </section>
        );
    }

    const headline = attendanceHeadline(state.rows, state.summary);
    const exceptions = attendanceExceptions(state.rows);
    const punctualityTone = headline.punctuality === null
        ? "plain"
        : headline.punctuality >= 90 ? "good" : headline.punctuality >= 75 ? "warn" : "bad";

    return (
        <section className="grid gap-3">
            <SectionHeader title="Attendance insights — last 30 days" />
            <div className="grid grid-cols-2 gap-3 min-[880px]:grid-cols-4">
                <InsightTile
                    icon={<CheckCircle2 />}
                    label="Punctuality"
                    value={headline.punctuality === null ? "—" : `${String(headline.punctuality)}%`}
                    caption={punctualityCaption(headline)}
                    tone={punctualityTone}
                />
                <InsightTile
                    icon={<Clock3 />}
                    label="Late arrivals"
                    value={String(headline.lateShifts)}
                    caption="Started later than that person's own usual time"
                    tone={headline.lateShifts > 0 ? "warn" : "good"}
                />
                <InsightTile
                    icon={<AlertTriangle />}
                    label="Missed punches"
                    value={String(headline.missedPunches)}
                    caption={headline.missedPunches === 0 ? "Nothing waiting on a review" : "Clock-ins still to review"}
                    tone={headline.missedPunches > 0 ? "bad" : "good"}
                />
                <InsightTile
                    icon={<UserRound />}
                    label="Hours worked"
                    value={hoursMinutes(Math.round(headline.totalHours * 60))}
                    caption={`${String(headline.staffTracked)} staff · ${String(headline.operatingDays)} operating days`}
                />
            </div>

            <div className="grid gap-2">
                <SectionHeader title="Exceptions" count={exceptions.length} />
                {exceptions.length === 0 ? (
                    <ForkCard inset className="!py-3 text-sm text-muted-foreground">
                        Nobody absent, nobody late, nothing awaiting review. This list stays empty when attendance is clean.
                    </ForkCard>
                ) : (
                    exceptions.map((e) => (
                        <ForkCard key={`${e.empId}-${e.kind}`} inset className="flex items-center gap-3 !py-2.5">
                            <Avatar name={e.name} warning={e.kind !== "pending"} />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-semibold text-foreground">{e.name}</div>
                                <div className="truncate text-xs text-muted-foreground">{e.detail}</div>
                            </div>
                            <StatusChip
                                status={e.kind === "absent" ? "danger" : e.kind === "late" ? "warning" : "neutral"}
                                label={e.kind === "absent" ? "Absent" : e.kind === "late" ? "Late" : "To review"}
                                dense
                            />
                        </ForkCard>
                    ))
                )}
                <p className="text-[11px] text-tertiary">
                    &quot;Late&quot; is measured against each person&apos;s own median start time — this product has no shift
                    roster, so there is no other baseline. Absences count only the days the restaurant was open after
                    that person&apos;s first shift, and approved leave is never counted as one.
                </p>
            </div>
        </section>
    );
}
