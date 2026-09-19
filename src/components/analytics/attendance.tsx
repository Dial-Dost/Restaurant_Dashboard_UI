"use client"

// Attendance — the Flutter Staff-view attendance section (modules.dart
// ~21769–21913): clock-in derived, over the same window as the rest of
// /analytics/advanced. Six tappable metric tiles with per-staff breakdown
// drill-downs, the methodology caption ("late" is measured against each
// person's own typical start — there is no roster), a sortable per-staff card
// list with the On-shift / late / absent / pending chips, and the summary +
// 13-column per-staff CSVs.

import * as React from "react"

import { ForkCard } from "@/components/ui/fork-card"
import { InfoChip, StatusChip } from "@/components/ui/status-chip"
import { MicroStat } from "@/components/ui/micro-stat"
import { SectionHeader } from "@/components/ui/section-header"
import type { AttendanceSummary, StaffAttendanceRow } from "@/lib/api/analytics"
import { Dl } from "@/components/analytics/csv"
import { InitialsBadge, NothingToShow, StatTile } from "@/components/analytics/charts"
import { hrs, num0, ranked, str } from "@/components/analytics/format"
import type { SeriesPoint } from "@/components/analytics/format"
import type { MetricDrillRequest } from "@/components/analytics/metric-sheet"
import { applySort, SortHeader, useSectionSort } from "@/components/analytics/sort"
import type { SortOption } from "@/components/analytics/sort"

const ATTENDANCE_SORTS: SortOption<StaffAttendanceRow>[] = [
    { label: "Hours worked", key: (m) => num0(m.hours_worked) },
    { label: "Shifts", key: (m) => num0(m.shifts) },
    { label: "Days present", key: (m) => num0(m.days_present) },
    { label: "Absent days", key: (m) => num0(m.absent_days) },
    // late_pct is null until someone has enough worked days for a baseline;
    // num0 reads that as 0, which sorts them below anyone actually late.
    { label: "Late %", key: (m) => num0(m.late_pct) },
    { label: "Name", key: (m) => str(m.name).toLowerCase() },
]

export function AttendanceSection({ attendance, summary, range, sectionRange, dlOrder, openMetric }: {
    attendance: StaffAttendanceRow[]
    summary: AttendanceSummary
    range: { from: string; to: string }
    /** The section header's own copy of the date chip. */
    sectionRange: React.ReactNode
    dlOrder: number
    openMetric: (req: MetricDrillRequest) => void
}): React.JSX.Element {
    const sort = useSectionSort("attendance", true)

    // Attendance breakdowns for the tile drill-downs — same already-fetched
    // payload, one series per headline number.
    const attHours: SeriesPoint[] = ranked(attendance.map((e) => ({ label: str(e.name, "Staff"), value: num0(e.hours_worked) })))
    const attShifts: SeriesPoint[] = ranked(attendance.map((e) => ({ label: str(e.name, "Staff"), value: num0(e.shifts) })))
    const attLate: SeriesPoint[] = ranked(attendance.map((e) => ({ label: str(e.name, "Staff"), value: num0(e.late_shifts) })))
    const attAbsent: SeriesPoint[] = ranked(attendance.map((e) => ({ label: str(e.name, "Staff"), value: num0(e.absent_days) })))
    const attDays = summary.window_days ?? 90

    const staffTracked = summary.staff_tracked ?? attendance.length
    const rows = applySort(attendance, ATTENDANCE_SORTS, sort)

    return (
        <section id="analytics-section-attendance" className="scroll-mt-24">
            <Dl
                id="attendance-summary"
                order={dlOrder}
                headers={["Metric", "Value"]}
                rows={[
                    ["Staff tracked", staffTracked],
                    ["Operating days", summary.operating_days ?? 0],
                    ["Total shifts", summary.total_shifts ?? 0],
                    ["Total hours", hrs(num0(summary.total_hours))],
                    ["Avg hours per staff", hrs(num0(summary.avg_hours_per_staff))],
                    ["Late shifts", summary.late_shifts ?? 0],
                    ["Absent days", summary.absent_days ?? 0],
                    ["Awaiting approval", summary.pending_shifts ?? 0],
                    ["Window", `${range.from} to ${range.to}`],
                    ["Window (days)", attDays],
                ]}
            />
            <SectionHeader title="Attendance" trailing={sectionRange} />
            {attendance.length === 0 ? (
                <NothingToShow caption="No attendance recorded yet — staff clock-ins will show up here." />
            ) : (
                <div>
                    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
                        <StatTile
                            label="Hours worked"
                            value={hrs(num0(summary.total_hours))}
                            onClick={() => {
                                openMetric({
                                    label: "Hours worked",
                                    value: hrs(num0(summary.total_hours)),
                                    note: `${summary.total_shifts ?? 0} shifts across ${staffTracked} staff`,
                                    series: attHours,
                                    kind: "bar",
                                    fmt: hrs,
                                })
                            }}
                        />
                        <StatTile
                            label="Avg hours / staff"
                            value={hrs(num0(summary.avg_hours_per_staff))}
                            onClick={() => {
                                openMetric({
                                    label: "Avg hours / staff",
                                    value: hrs(num0(summary.avg_hours_per_staff)),
                                    note: `${summary.operating_days ?? 0} operating days in the window`,
                                    series: attHours,
                                    kind: "bar",
                                    fmt: hrs,
                                })
                            }}
                        />
                        <StatTile
                            label="Shifts"
                            value={`${summary.total_shifts ?? 0}`}
                            onClick={() => {
                                openMetric({
                                    label: "Shifts",
                                    value: `${summary.total_shifts ?? 0}`,
                                    note: "Approved clock-ins only",
                                    series: attShifts,
                                    kind: "bar",
                                })
                            }}
                        />
                        <StatTile
                            label="Late shifts"
                            value={`${summary.late_shifts ?? 0}`}
                            onClick={() => {
                                openMetric({
                                    label: "Late shifts",
                                    value: `${summary.late_shifts ?? 0}`,
                                    note: "More than 15 min after that person’s typical start",
                                    series: attLate,
                                    kind: "bar",
                                })
                            }}
                        />
                        <StatTile
                            label="Absent days"
                            value={`${summary.absent_days ?? 0}`}
                            onClick={() => {
                                openMetric({
                                    label: "Absent days",
                                    value: `${summary.absent_days ?? 0}`,
                                    note: "Open days with no clock-in, after their first shift",
                                    series: attAbsent,
                                    kind: "bar",
                                })
                            }}
                        />
                        <StatTile
                            label="Awaiting approval"
                            value={`${summary.pending_shifts ?? 0}`}
                            onClick={() => {
                                openMetric({
                                    label: "Awaiting approval",
                                    value: `${summary.pending_shifts ?? 0}`,
                                    note: "Pending shifts do not count toward hours",
                                })
                            }}
                        />
                    </div>

                    <div className="mt-4">
                        <Dl
                            id="attendance-by-staff"
                            order={dlOrder + 1}
                            headers={[
                                "Staff", "Shifts", "Hours worked", "Avg shift hours", "Days present",
                                "Absent days", "Late shifts", "Late %", "Typical start", "Pending",
                                "Rejected", "On shift now", "Last seen",
                            ]}
                            rows={rows.map((m) => [
                                str(m.name, "Staff"),
                                m.shifts,
                                num0(m.hours_worked).toFixed(2),
                                num0(m.avg_shift_hours).toFixed(2),
                                m.days_present,
                                m.absent_days,
                                m.late_shifts,
                                // Null until the person has a baseline — export it
                                // as blank, not a misleading 0.
                                m.late_pct == null ? "" : num0(m.late_pct).toFixed(1),
                                str(m.typical_start),
                                m.pending_shifts ?? 0,
                                m.rejected_shifts ?? 0,
                                m.currently_clocked_in === true ? "Yes" : "No",
                                str(m.last_seen),
                            ])}
                        />
                        <SortHeader title="Attendance by staff" opts={ATTENDANCE_SORTS} sort={sort} className="mb-1.5" />
                        <p className="text-[11px] text-muted-foreground">
                            Hours use the same approved-shift rule and 16h cap as payroll. There is no roster, so
                            {" “"}late{"”"} is measured against each person{"’"}s own typical start (median first
                            clock-in, 15 min grace) and {"“"}absent{"”"} counts days the restaurant was open after
                            their first shift.
                        </p>
                        <div className="mt-3 space-y-2">
                            {rows.map((m, i) => {
                                const name = str(m.name, "Staff")
                                const onShift = m.currently_clocked_in === true
                                const latePct = m.late_pct
                                const pending = Math.round(num0(m.pending_shifts))
                                const absent = Math.round(num0(m.absent_days))
                                const start = str(m.typical_start)
                                return (
                                    <ForkCard key={`${str(m.emp_id) || name}-${i}`} className="px-4 py-3" chevron={false}>
                                        <div className="flex items-center gap-3">
                                            <InitialsBadge text={name === "" ? "?" : name.slice(0, 1)} />
                                            <div className="min-w-0 flex-1">
                                                <div className="flex min-w-0 items-center gap-2">
                                                    <span className="min-w-0 truncate text-[13.5px] font-semibold text-foreground">{name}</span>
                                                    {onShift && <StatusChip dense status="success" label="On shift" />}
                                                </div>
                                                <div className="mt-1 truncate text-xs text-muted-foreground">
                                                    {m.shifts} shifts · {m.days_present} days present
                                                    {start === "" ? "" : ` · usually starts ${start}`}
                                                </div>
                                                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                                    <InfoChip label={`Avg shift ${hrs(num0(m.avg_shift_hours))}`} />
                                                    {latePct != null && (
                                                        <StatusChip
                                                            dense
                                                            status={num0(latePct) >= 25 ? "warning" : "neutral"}
                                                            label={`${m.late_shifts} late (${num0(latePct).toFixed(0)}%)`}
                                                        />
                                                    )}
                                                    {absent > 0 && <StatusChip dense status="warning" label={`${absent} absent`} />}
                                                    {pending > 0 && <StatusChip dense status="info" label={`${pending} pending`} />}
                                                </div>
                                            </div>
                                            <MicroStat value={hrs(num0(m.hours_worked))} label="Hours" alignEnd />
                                        </div>
                                    </ForkCard>
                                )
                            })}
                        </div>
                    </div>
                </div>
            )}
        </section>
    )
}
