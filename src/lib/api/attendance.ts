// THE ATTENDANCE MODULE'S OWN DATA LAYER — Flutter parity (docs/parity/attendance.md).
//
// db.ts's attendance readers swallow failures (a failed /attendance/me read
// came back as "not clocked in"; clock-in/out returned a bare boolean and
// discarded the server's reason). These throw instead — status 0 as a
// TypeError so `isUnreachableError` reads it as an outage, anything else with
// the server's own sentence — which is what `useCachedFetch` + `LoadErrorState`
// and the Flutter snackbar-with-raw-error behaviour need.

import { requestBackend } from '@/lib/db';
import type { MyAttendance, AttendanceSummaryRow, PendingClockIn } from '@/lib/db';
import { refusalSentence } from '@/lib/error-message';
import type { AttendanceStatRow, AttendanceStatSummary } from '@/lib/attendance-insights';

export type { MyAttendance, AttendanceSummaryRow, PendingClockIn };

const throwBackendError = (status: number, text: string, fallback: string): never => {
    if (status === 0) {
        throw new TypeError('Failed to fetch');
    }
    let message = '';
    try {
        message = refusalSentence(JSON.parse(text)) ?? '';
    } catch {
        /* not JSON — the raw body is the best we have */
    }
    if (!message) {
        message = text.trim() || fallback;
    }
    throw Object.assign(new Error(message), { status });
};

/** One full load of the attendance screen (Flutter `_AttendanceView._load`). */
export interface AttendanceBoard {
    me: MyAttendance;
    /** Manager-only summary; empty for staff. */
    team: AttendanceSummaryRow[];
    pending: PendingClockIn[];
    /** The server-chosen window (Flutter `_from` / `_to`); '' when absent. */
    from: string;
    to: string;
}

/**
 * GET /attendance/me, plus GET /attendance (no range — the server's default
 * window, exactly like the app) for managers.
 */
/**
 * GET /attendance/me on its own — this employee's shift, nothing else.
 *
 * The board reader above also needs the manager summary and therefore needs
 * the attendance PERMISSION; a waiter asking "am I on shift" holds no such
 * permission and must not be made to pay for a 403 to find out. Used by the
 * shift gate (hooks/use-shift-gate.ts) and by the personal attendance view.
 */
export const fetchMyShift = async (restaurantId: string): Promise<MyAttendance> => {
    const res = await requestBackend<MyAttendance>({ restaurantId, path: '/attendance/me', method: 'GET' });
    if (!res.ok) {
        throwBackendError(res.status, res.text, 'Could not load your shift');
    }
    return res.data ?? { clocked_in: false, since: null, today_minutes: 0 };
};

export const fetchAttendanceBoard = async (restaurantId: string, isManager: boolean): Promise<AttendanceBoard> => {
    const meRes = await requestBackend<MyAttendance>({ restaurantId, path: '/attendance/me', method: 'GET' });
    if (!meRes.ok) {
        throwBackendError(meRes.status, meRes.text, 'Could not load attendance');
    }
    const me: MyAttendance = meRes.data ?? { clocked_in: false, since: null, today_minutes: 0 };
    if (!isManager) {
        return { me, team: [], pending: [], from: '', to: '' };
    }
    const sum = await requestBackend<{ from?: string; to?: string; rows?: AttendanceSummaryRow[]; pending?: PendingClockIn[] }>({
        restaurantId,
        path: '/attendance',
        method: 'GET',
    });
    if (!sum.ok) {
        throwBackendError(sum.status, sum.text, 'Could not load attendance');
    }
    return {
        me,
        team: Array.isArray(sum.data?.rows) ? sum.data.rows : [],
        pending: Array.isArray(sum.data?.pending) ? sum.data.pending : [],
        from: sum.data?.from ?? '',
        to: sum.data?.to ?? '',
    };
};

/** POST /attendance/clock-in | clock-out — throws the server's sentence on refusal. */
export const toggleClock = async (restaurantId: string, clockIn: boolean): Promise<void> => {
    const r = await requestBackend({
        restaurantId,
        path: clockIn ? '/attendance/clock-in' : '/attendance/clock-out',
        method: 'POST',
        parseJson: false,
    });
    if (!r.ok) {
        throwBackendError(r.status, r.text, 'Could not update attendance');
    }
};

/** POST /attendance/:id/approve | reject. */
export const reviewAttendance = async (restaurantId: string, attendanceId: string, approve: boolean): Promise<void> => {
    const r = await requestBackend({
        restaurantId,
        path: `/attendance/${encodeURIComponent(attendanceId)}/${approve ? 'approve' : 'reject'}`,
        method: 'POST',
        parseJson: false,
    });
    if (!r.ok) {
        throwBackendError(r.status, r.text, 'Unable to review clock-in');
    }
};

/** One `staff_attendance` row of GET /analytics/advanced — every verdict is the server's. */
export interface StaffPunctuality {
    emp_id?: string;
    employee_id?: string;
    typical_start?: string | null;
    late_shifts?: number | null;
    late_pct?: number | string | null;
    days_present?: number | null;
    leave_days?: number | null;
    absent_days?: number | null;
}

/**
 * The SAME read as `fetchPunctuality`, returning the rows as a list and the
 * team summary beside them — what the Attendance page's insight tiles reduce
 * (lib/attendance-insights.ts).
 *
 * Kept separate from `fetchPunctuality` rather than replacing it: that reader is
 * keyed by employee for the per-person drill-downs and is called from four
 * places, and widening its return type to serve one more caller would touch all
 * of them for no gain. Both are behind the analytics permission, so a waiter
 * never calls either.
 */
export const fetchAttendanceInsights = async (
    restaurantId: string,
): Promise<{ rows: AttendanceStatRow[]; summary: AttendanceStatSummary | null }> => {
    const r = await requestBackend<{ staff_attendance?: AttendanceStatRow[]; attendance_summary?: AttendanceStatSummary }>({
        restaurantId,
        path: `/analytics/advanced?restaurantId=${encodeURIComponent(restaurantId)}&days=30`,
        method: 'GET',
    });
    if (!r.ok) {
        throwBackendError(r.status, r.text, 'Could not load attendance insights');
    }
    return {
        rows: Array.isArray(r.data?.staff_attendance) ? r.data.staff_attendance : [],
        summary: r.data?.attendance_summary ?? null,
    };
};

/**
 * GET /analytics/advanced?days=30 → `staff_attendance` keyed by `emp_id`
 * (falling back to `employee_id`). Flutter `_punctuality()`.
 */
export const fetchPunctuality = async (restaurantId: string): Promise<Record<string, StaffPunctuality>> => {
    const r = await requestBackend<{ staff_attendance?: StaffPunctuality[] }>({
        restaurantId,
        path: `/analytics/advanced?restaurantId=${encodeURIComponent(restaurantId)}&days=30`,
        method: 'GET',
    });
    if (!r.ok) {
        throwBackendError(r.status, r.text, 'Could not load punctuality');
    }
    const out: Record<string, StaffPunctuality> = {};
    for (const row of r.data?.staff_attendance ?? []) {
        const id = row.emp_id ?? row.employee_id ?? '';
        if (id) { out[id] = row; }
    }
    return out;
};
