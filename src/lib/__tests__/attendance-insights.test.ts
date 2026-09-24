// The attendance headline: what the tiles may claim, and who lands on the
// exceptions list.

import {
  attendanceExceptions,
  attendanceHeadline,
  earlierShiftMinutes,
  hoursMinutes,
  punctualityCaption,
  shiftElapsed,
  type AttendanceStatRow,
} from "@/lib/attendance-insights";

const row = (over: Partial<AttendanceStatRow> = {}): AttendanceStatRow => ({
  emp_id: "e1",
  name: "Rohit Mehta",
  shifts: 10,
  hours_worked: 60,
  days_present: 10,
  absent_days: 0,
  late_shifts: 0,
  late_pct: 0,
  pending_shifts: 0,
  ...over,
});

describe("the headline figures", () => {
  it("prefers the server's own summary over re-adding the rows", () => {
    const h = attendanceHeadline([row(), row({ emp_id: "e2", shifts: 4 })], {
      total_shifts: 20, late_shifts: 2, total_hours: 111, staff_tracked: 3, operating_days: 28, pending_shifts: 1,
    });
    expect(h.countedShifts).toBe(20);
    expect(h.punctuality).toBe(90);
    expect(h.totalHours).toBe(111);
    expect(h.staffTracked).toBe(3);
    expect(h.awaitingApproval).toBe(1);
  });

  it("adds the rows up when there is no summary", () => {
    const h = attendanceHeadline([row({ shifts: 6, late_shifts: 3 }), row({ emp_id: "e2", shifts: 6, late_shifts: 0 })], null);
    expect(h.countedShifts).toBe(12);
    expect(h.lateShifts).toBe(3);
    expect(h.punctuality).toBe(75);
  });

  it("refuses to print a punctuality rate over no shifts at all", () => {
    const h = attendanceHeadline([], null);
    expect(h.punctuality).toBeNull();
    expect(punctualityCaption(h)).toBe("No counted shifts yet");
  });

  it("says the denominator under the tile", () => {
    const h = attendanceHeadline([row({ shifts: 14, late_shifts: 2 })], null);
    expect(punctualityCaption(h)).toBe("12 of 14 shifts on time");
  });

  it("counts who is on shift at this moment", () => {
    const h = attendanceHeadline([row({ currently_clocked_in: true }), row({ emp_id: "e2" })], null);
    expect(h.onShiftNow).toBe(1);
  });
});

describe("who lands on the exceptions list", () => {
  it("leaves out anyone with nothing to answer for", () => {
    expect(attendanceExceptions([row()])).toEqual([]);
  });

  it("names the worst thing about each person, once, worst first", () => {
    const list = attendanceExceptions([
      row({ emp_id: "a", name: "Late Larry", late_shifts: 4 }),
      row({ emp_id: "b", name: "Absent Anna", absent_days: 2, late_shifts: 9 }),
      row({ emp_id: "c", name: "Pending Pat", pending_shifts: 1 }),
    ]);
    expect(list.map((e) => e.name)).toEqual(["Absent Anna", "Late Larry", "Pending Pat"]);
    expect(list[0].kind).toBe("absent");
    expect(list[1].detail).toContain("Late 4 of 10 shifts");
  });

  it("says when leave covers part of the absence", () => {
    const [only] = attendanceExceptions([row({ absent_days: 1, leave_days: 3 })]);
    expect(only.detail).toBe("1 day absent · 3 on leave");
  });

  it("quotes the person's own usual start beside a late count", () => {
    const [only] = attendanceExceptions([row({ late_shifts: 1, typical_start: "17:45" })]);
    expect(only.detail).toContain("usually starts 17:45");
  });
});

describe("the shift clock", () => {
  const start = Date.parse("2026-09-24T13:39:00.000Z");

  it("measures an open shift to this moment", () => {
    expect(shiftElapsed("2026-09-24T13:39:00.000Z", start + 134 * 60_000)).toBe(134);
    expect(hoursMinutes(134)).toBe("2h 14m");
    expect(hoursMinutes(9)).toBe("0h 09m");
  });

  it("answers nothing rather than a negative or an unreadable time", () => {
    expect(shiftElapsed("2026-09-24T13:39:00.000Z", start - 60_000)).toBeNull();
    expect(shiftElapsed("", start)).toBeNull();
    expect(shiftElapsed(null, start)).toBeNull();
    expect(hoursMinutes(null)).toBe("—");
  });

  it("splits today's hours from the shift running now", () => {
    expect(earlierShiftMinutes(200, 134)).toBe(66);
    expect(earlierShiftMinutes(136, 134)).toBeNull();
    expect(earlierShiftMinutes(200, null)).toBeNull();
  });
});
