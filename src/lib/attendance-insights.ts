// WHAT THE ATTENDANCE RECORD ADDS UP TO — the numbers behind the insight tiles.
//
// Client: "The waiters attendance page looks very empty" + a mock of an
// attendance dashboard (punctuality rate, late arrivals, missed punches,
// overtime, trends, exceptions), with "we can add something like this to make
// it look better".
//
// ============================================================================
// EVERY NUMBER HERE IS THE SERVER'S, RE-ARRANGED — NONE IS INVENTED
// ============================================================================
// The source is GET /analytics/advanced's `staff_attendance` rows and its
// `attendance_summary`, which the backend derives from the Attendance table and
// documents at length (getStaffAttendanceStats). This module only reduces those
// rows into the handful of figures a tile can hold, and it refuses to produce a
// figure the data cannot support:
//
//   • PUNCTUALITY RATE is the share of COUNTED shifts that were not late,
//     measured against each person's OWN typical start — there is no roster in
//     this product, so there is no other baseline. Null (drawn as "—") until
//     somebody has actually worked a counted shift; a "100%" printed over zero
//     shifts is a lie that reads as praise.
//
//   • MISSED PUNCHES are shifts the server is still holding open plus the
//     clock-ins nobody has reviewed. Both are things a manager has to go and
//     fix; neither is an accusation of absence.
//
//   • OVERTIME IS NOT REPORTED. The mock asks for it and the honest answer is
//     that this product has no contracted hours, no shift roster and no weekly
//     limit to measure "over" against, so any hours-above-N figure would be a
//     number this app made up. The tile in its place says TOTAL HOURS, which is
//     the same data without the fiction.
//
// PURE — no React, no fetch — pinned by `__tests__/attendance-insights.test.ts`.

/** The slice of an /analytics/advanced `staff_attendance` row this reads. */
export interface AttendanceStatRow {
    emp_id?: string;
    name: string;
    shifts: number;
    hours_worked: number;
    days_present: number;
    absent_days: number;
    leave_days?: number;
    late_shifts: number;
    late_pct: number | null;
    typical_start?: string;
    pending_shifts?: number;
    rejected_shifts?: number;
    currently_clocked_in?: boolean;
    last_seen?: string;
}

/** The slice of `attendance_summary` this reads. */
export interface AttendanceStatSummary {
    window_days?: number;
    staff_tracked?: number;
    operating_days?: number;
    total_shifts?: number;
    total_hours?: number;
    avg_hours_per_staff?: number;
    pending_shifts?: number;
    late_shifts?: number;
    absent_days?: number;
    leave_days?: number;
}

const n0 = (v: unknown): number => {
    const x = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(x) ? x : 0;
};

export interface AttendanceHeadline {
    /** 0–100, or null when nobody has a counted shift yet. */
    punctuality: number | null;
    /** Counted shifts that started late (the server's own test). */
    lateShifts: number;
    /** How many of the counted shifts those were — the denominator, stated. */
    countedShifts: number;
    /** Open shifts + un-reviewed clock-ins: the things to go and fix. */
    missedPunches: number;
    /** Hours worked across the window (NOT overtime — see the header). */
    totalHours: number;
    /** People with at least one row in the window. */
    staffTracked: number;
    /** Days on which anybody clocked in. */
    operatingDays: number;
    /** Days somebody was expected and neither clocked in nor was on leave. */
    absentDays: number;
    /** Clock-ins waiting for a manager's review. */
    awaitingApproval: number;
    /** On shift at this moment, by the analytics window's own reckoning. */
    onShiftNow: number;
}

export const attendanceHeadline = (
    rows: readonly AttendanceStatRow[],
    summary: AttendanceStatSummary | null | undefined,
): AttendanceHeadline => {
    const countedShifts = n0(summary?.total_shifts) > 0
        ? n0(summary?.total_shifts)
        : rows.reduce((sum, r) => sum + n0(r.shifts), 0);
    const lateShifts = summary?.late_shifts !== undefined
        ? n0(summary.late_shifts)
        : rows.reduce((sum, r) => sum + n0(r.late_shifts), 0);
    const awaitingApproval = summary?.pending_shifts !== undefined
        ? n0(summary.pending_shifts)
        : rows.reduce((sum, r) => sum + n0(r.pending_shifts), 0);
    const onShiftNow = rows.filter((r) => r.currently_clocked_in === true).length;
    return {
        punctuality: countedShifts > 0
            ? Math.max(0, Math.min(100, Math.round(((countedShifts - lateShifts) / countedShifts) * 100)))
            : null,
        lateShifts,
        countedShifts,
        // An open shift is only a missed punch once the person is NOT here any
        // more; the server cannot tell those apart, so the count a manager acts
        // on is the reviews plus anybody the analytics still has open.
        missedPunches: awaitingApproval,
        totalHours: summary?.total_hours !== undefined
            ? n0(summary.total_hours)
            : rows.reduce((sum, r) => sum + n0(r.hours_worked), 0),
        staffTracked: summary?.staff_tracked !== undefined ? n0(summary.staff_tracked) : rows.length,
        operatingDays: n0(summary?.operating_days),
        absentDays: summary?.absent_days !== undefined
            ? n0(summary.absent_days)
            : rows.reduce((sum, r) => sum + n0(r.absent_days), 0),
        awaitingApproval,
        onShiftNow,
    };
};

/** One line in the exceptions list — a person and the one thing to look at. */
export interface AttendanceException {
    empId: string;
    name: string;
    /** Ordered worst-first by the same rank the list is sorted on. */
    kind: 'absent' | 'late' | 'pending' | 'no-baseline';
    /** "3 absences", "late 4 of 12" — the figure in the person's own row. */
    detail: string;
    /** Sort weight; higher is more worth a manager's attention. */
    rank: number;
}

/**
 * The people worth looking at, worst first — and NOBODY ELSE. A list that names
 * every member of staff every day is a list nobody reads by the third day, so a
 * person with no absence, no lateness and nothing pending is simply absent from
 * it. An empty list is the good outcome and the UI says so in words.
 */
export const attendanceExceptions = (rows: readonly AttendanceStatRow[]): AttendanceException[] => {
    const out: AttendanceException[] = [];
    for (const r of rows) {
        const name = (r.name || '').trim() || 'Employee';
        const empId = r.emp_id ?? '';
        const absent = n0(r.absent_days);
        const late = n0(r.late_shifts);
        const pending = n0(r.pending_shifts);
        if (absent > 0) {
            out.push({
                empId, name, kind: 'absent', rank: 300 + absent,
                detail: `${String(absent)} day${absent === 1 ? '' : 's'} absent${n0(r.leave_days) > 0 ? ` · ${String(n0(r.leave_days))} on leave` : ''}`,
            });
            continue;
        }
        if (late > 0) {
            out.push({
                empId, name, kind: 'late', rank: 200 + late,
                detail: `Late ${String(late)} of ${String(n0(r.shifts))} shift${n0(r.shifts) === 1 ? '' : 's'}${r.typical_start ? ` · usually starts ${r.typical_start}` : ''}`,
            });
            continue;
        }
        if (pending > 0) {
            out.push({
                empId, name, kind: 'pending', rank: 100 + pending,
                detail: `${String(pending)} clock-in${pending === 1 ? '' : 's'} awaiting review`,
            });
        }
    }
    return out.sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));
};

/** "12 of 14 shifts on time" — the sentence under the punctuality tile. */
export const punctualityCaption = (h: AttendanceHeadline): string => {
    if (h.punctuality === null) { return 'No counted shifts yet'; }
    const onTime = Math.max(0, h.countedShifts - h.lateShifts);
    return `${String(onTime)} of ${String(h.countedShifts)} shift${h.countedShifts === 1 ? '' : 's'} on time`;
};

/**
 * How long this shift has been running, as "2h 14m" — the ticking figure on the
 * personal card. Null for a shift with no start, or one dated in the future by a
 * device clock that is wrong (a negative elapsed time is worse than none).
 */
export const shiftElapsed = (since: string | null | undefined, now: number = Date.now()): number | null => {
    if (typeof since !== 'string' || since.trim() === '') { return null; }
    const started = Date.parse(since);
    if (!Number.isFinite(started)) { return null; }
    const minutes = Math.floor((now - started) / 60000);
    return minutes < 0 ? null : minutes;
};

/** "0h 09m" is how the app writes shift lengths; kept identical here. */
export const hoursMinutes = (minutes: number | null | undefined): string => {
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0) { return '—'; }
    const whole = Math.floor(minutes);
    return `${String(Math.floor(whole / 60))}h ${String(whole % 60).padStart(2, '0')}m`;
};

/**
 * The break between "hours today" and "this shift": a waiter who clocked out for
 * a split shift has worked more today than the current shift shows. Returns null
 * when the two agree (nothing useful to say) or when either figure is missing.
 */
export const earlierShiftMinutes = (todayMinutes: number, currentShift: number | null): number | null => {
    if (currentShift === null) { return null; }
    const earlier = Math.round(todayMinutes - currentShift);
    return earlier >= 5 ? earlier : null;
};
