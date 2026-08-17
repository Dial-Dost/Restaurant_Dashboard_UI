import {
  buildSchedulePatch,
  describeActionError,
  runScheduleAction,
  type ScheduleActionToast,
  type ScheduleFormState,
} from "../report-schedule-actions";

/// The Scheduled reports section (src/app/dashboard/accounting/scheduled-reports.tsx)
/// has four mutating handlers — save, pause/resume, delete and run-now — and each
/// is one network call away from the two failures that cost the owner the feature:
///
///   * the request fails and NOTHING is said, so the owner believes a schedule was
///     paused/removed/queued when the backend refused it. /run-now really can
///     answer 409 now ("This report was just queued"), and any write attempted
///     from the all-outlets combined view is answered 400.
///   * the request fails and `busy` is never released, so Run now / Pause / Delete
///     stay disabled for the rest of the session. Nothing on the page clears that
///     flag except the handler itself, so the only recovery is a page reload.
///
/// Every handler routes through runScheduleAction, so these pin both.

const collect = (): {
  deps: { setBusy: (b: boolean) => void; toast: (t: ScheduleActionToast) => unknown };
  busy: boolean[];
  toasts: ScheduleActionToast[];
} => {
  const busy: boolean[] = [];
  const toasts: ScheduleActionToast[] = [];
  return {
    deps: {
      setBusy: (b) => busy.push(b),
      toast: (t) => toasts.push(t),
    },
    busy,
    toasts,
  };
};

describe("runScheduleAction — the success path", () => {
  it("brackets the work in busy and raises the caller's own success toast", async () => {
    const { deps, busy, toasts } = collect();
    const seen: boolean[] = [];

    const ok = await runScheduleAction(deps, "Couldn't change the schedule", async () => {
      // What the handler sees WHILE its request is in flight.
      seen.push(busy[busy.length - 1] ?? false);
      await Promise.resolve();
      return { title: "Schedule paused" };
    });

    expect(ok).toBe(true);
    expect(seen).toEqual([true]);
    expect(busy).toEqual([true, false]);
    expect(toasts).toEqual([{ title: "Schedule paused" }]);
  });

  it("carries the description through, which is the run-now copy", async () => {
    const { deps, toasts } = collect();
    await runScheduleAction(deps, "Couldn't queue this report", () =>
      Promise.resolve({
        title: "Queued",
        description: "The sweep renders it on its next tick — refresh the history in a minute to download the file.",
      }),
    );
    expect(toasts[0]?.title).toBe("Queued");
    expect(toasts[0]?.description).toMatch(/next tick/);
    expect(toasts[0]?.variant).toBeUndefined();
  });
});

describe("runScheduleAction — a failed request", () => {
  it("releases busy, so the section is not disabled for the rest of the session", async () => {
    const { deps, busy } = collect();
    await runScheduleAction(deps, "Couldn't remove the schedule", () =>
      Promise.reject(new Error("Unable to remove the scheduled report")),
    );
    // The last thing it did was let go. Without the `finally` this reads [true].
    expect(busy).toEqual([true, false]);
    expect(busy[busy.length - 1]).toBe(false);
  });

  it("tells the owner, in the backend's own words", async () => {
    const { deps, toasts } = collect();
    // The 409 the backend can now genuinely answer on /run-now.
    await runScheduleAction(deps, "Couldn't queue this report", () =>
      Promise.reject(new Error("This report was just queued — try again in a minute")),
    );
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toEqual({
      title: "Couldn't queue this report",
      description: "This report was just queued — try again in a minute",
      variant: "destructive",
    });
  });

  it("surfaces the combined-view refusal rather than swallowing it", async () => {
    const { deps, toasts } = collect();
    await runScheduleAction(deps, "Couldn't change the schedule", () =>
      Promise.reject(new Error("Select a specific outlet before making changes")),
    );
    expect(toasts[0]?.variant).toBe("destructive");
    expect(toasts[0]?.description).toBe("Select a specific outlet before making changes");
  });

  it("never announces success on a path that threw", async () => {
    const { deps, toasts } = collect();
    const ok = await runScheduleAction(deps, "Couldn't remove the schedule", async () => {
      await Promise.resolve();
      throw new Error("Unable to remove the scheduled report");
    });
    expect(ok).toBe(false);
    expect(toasts.map((t) => t.title)).not.toContain("Schedule removed");
  });

  it("stays readable when what was thrown is not an Error", async () => {
    const { deps, toasts } = collect();
    // backendCall can reject with a bare string, and "[object Object]" in a toast
    // is the same as saying nothing.
    await runScheduleAction(deps, "Couldn't save the schedule", () => Promise.reject("Action forbidden"));
    expect(toasts[0]?.description).toBe("Action forbidden");
  });

  it("leaves the next action able to run — the failure is not sticky", async () => {
    const { deps, busy, toasts } = collect();
    await runScheduleAction(deps, "Couldn't queue this report", () => Promise.reject(new Error("offline")));
    const ok = await runScheduleAction(deps, "Couldn't queue this report", () =>
      Promise.resolve({ title: "Queued" }),
    );
    expect(ok).toBe(true);
    expect(busy).toEqual([true, false, true, false]);
    expect(toasts.map((t) => t.variant)).toEqual(["destructive", undefined]);
  });

  it("still releases busy when the reload after a successful write is what fails", async () => {
    // save/remove/runNow all `await load()` INSIDE the action, so a write that
    // succeeded and a refresh that did not must not strand the flag either.
    const { deps, busy } = collect();
    const reloadThatFails = async (): Promise<void> => {
      await Promise.resolve();
      throw new Error("Failed to fetch");
    };
    let wrote = false;
    const ok = await runScheduleAction(deps, "Couldn't save the schedule", async () => {
      wrote = true;
      await reloadThatFails();
      return { title: "Schedule updated" };
    });
    expect(wrote).toBe(true);
    expect(ok).toBe(false);
    expect(busy).toEqual([true, false]);
  });
});

describe("describeActionError", () => {
  it("prefers the message and falls back to the value itself", () => {
    expect(describeActionError(new Error("Action forbidden"))).toBe("Action forbidden");
    expect(describeActionError("Unable to update the scheduled report")).toBe("Unable to update the scheduled report");
    expect(describeActionError(null)).toBe("null");
  });
});

describe("buildSchedulePatch — the save handler's validation", () => {
  const form = (over: Partial<ScheduleFormState> = {}): ScheduleFormState => ({
    name: "Morning sales",
    report_key: "sales",
    frequency: "daily",
    time: "08:00",
    weekday: "1",
    day_of_month: "1",
    channel: "inbox",
    ...over,
  });

  it("splits HH:MM into the backend's hour_local + minute_local pair", () => {
    const r = buildSchedulePatch(form({ time: "08:05" }));
    expect(r).toEqual({
      ok: true,
      patch: expect.objectContaining({ name: "Morning sales", hour_local: 8, minute_local: 5 }),
    });
  });

  it("refuses a blank or whitespace-only name instead of letting a CHECK do it", () => {
    expect(buildSchedulePatch(form({ name: "   " }))).toEqual({ ok: false, message: "Give the schedule a name" });
  });

  it("trims the name it does accept", () => {
    const r = buildSchedulePatch(form({ name: "  Weekly GST  " }));
    expect(r.ok && r.patch.name).toBe("Weekly GST");
  });

  it("refuses a time the browser never filled in", () => {
    // <input type="time"> reports "" when it is empty, not a default.
    expect(buildSchedulePatch(form({ time: "" }))).toEqual({ ok: false, message: "Pick a time of day" });
  });

  it("sends only the shape the frequency uses, and nulls the other", () => {
    const weekly = buildSchedulePatch(form({ frequency: "weekly", weekday: "6", day_of_month: "14" }));
    expect(weekly.ok && weekly.patch.weekday).toBe(6);
    expect(weekly.ok && weekly.patch.day_of_month).toBeNull();

    // The regression this exists for: weekly → monthly must not keep a weekday.
    const monthly = buildSchedulePatch(form({ frequency: "monthly", weekday: "6", day_of_month: "14" }));
    expect(monthly.ok && monthly.patch.day_of_month).toBe(14);
    expect(monthly.ok && monthly.patch.weekday).toBeNull();

    const daily = buildSchedulePatch(form({ frequency: "daily", weekday: "6", day_of_month: "14" }));
    expect(daily.ok && daily.patch.weekday).toBeNull();
    expect(daily.ok && daily.patch.day_of_month).toBeNull();
  });

  it("keeps Sunday as 0 rather than losing it to a falsy check", () => {
    const r = buildSchedulePatch(form({ frequency: "weekly", weekday: "0" }));
    expect(r.ok && r.patch.weekday).toBe(0);
  });
});
