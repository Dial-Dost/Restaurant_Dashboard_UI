"use client";

// Attendance — Flutter parity (docs/parity/attendance.md; modules.dart
// `_AttendanceView`). Tiles → my-shift card → pending approval → team hours,
// with the four drill-down sheets and the lazily-read punctuality block.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { Briefcase, Check, Hourglass, LogIn, LogOut, Repeat, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DrillSheet } from "@/components/ui/drill-sheet";
import { ForkCard } from "@/components/ui/fork-card";
import { SkeletonRows, SkeletonStats } from "@/components/ui/fork-skeleton";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { MicroStat } from "@/components/ui/micro-stat";
import { SectionHeader } from "@/components/ui/section-header";
import { CacheStalePill } from "@/components/ui/stale-pill";
import { StatCard } from "@/components/ui/stat-card";
import { InfoChip, StatusChip } from "@/components/ui/status-chip";
import { useCachedFetch } from "@/hooks/use-cached-fetch";
import { usePlanFeatures } from "@/hooks/use-plan-features";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { useTimezone } from "@/lib/use-timezone";
import { todayInZone } from "@/lib/tz";
import { hasPermission, PERM_ACCOUNTING } from "@/lib/mis-capture";
import { cn } from "@/lib/utils";
import {
  fetchAttendanceBoard,
  fetchPunctuality,
  reviewAttendance,
  toggleClock,
} from "@/lib/api/attendance";
import type { AttendanceBoard, AttendanceSummaryRow, PendingClockIn } from "@/lib/api/attendance";
import { Avatar, Kv, PunctualityBlock, SheetRecordRow } from "@/components/attendance/bits";
import type { PunctualityState } from "@/components/attendance/bits";
import { clock, dayLabel, hm, shiftMinutes, stamp, windowLabel, zoneLabel } from "@/components/attendance/format";

/** Flutter `_analyticsPermissionId` — the analytics action id. */
const ANALYTICS_PERMISSION = PERM_ACCOUNTING;
const COPPER = "hsl(var(--primary))";
const RUNAWAY_MINUTES = 16 * 60;

type Sheet =
  | { kind: "me" }
  | { kind: "pending"; row: PendingClockIn }
  | { kind: "team"; row: AttendanceSummaryRow }
  | { kind: "people-pending" }
  | { kind: "people-on-shift" };

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const stop = { onClick: (e: React.SyntheticEvent) => { e.stopPropagation(); }, onKeyDown: (e: React.SyntheticEvent) => { e.stopPropagation(); } };

export default function AttendancePage(): JSX.Element {
  const { user } = useAuth();
  const { toast } = useToast();
  const { timezone } = useTimezone();
  const { featureEnabled } = usePlanFeatures();
  const restaurantId = user?.restaurantUsername ?? "";

  const isManager = useMemo(() => {
    if (!user) { return false; }
    const roles = [user.role, ...(Array.isArray(user.role_all) ? user.role_all : [])];
    return roles.includes("admin") || roles.includes("manager");
  }, [user]);
  const canReadPunctuality = hasPermission(user?.actions_set, ANALYTICS_PERMISSION) && featureEnabled("analytics");

  const fetcher = useCallback(() => fetchAttendanceBoard(restaurantId, isManager), [restaurantId, isManager]);
  const { data, loading, error, offline, fromCache, updatedAt, retry, refresh } = useCachedFetch<AttendanceBoard>(
    `attendance:${restaurantId}:${isManager ? "m" : "s"}`,
    fetcher,
    { enabled: Boolean(restaurantId) },
  );

  // Refetch when the tab regains focus — the web stand-in for pull-to-refresh.
  useEffect(() => {
    const onFocus = (): void => { if (document.visibilityState === "visible") { refresh(); } };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

  // Punctuality: one memoised GET, requested the first time a sheet shows it.
  const punctualityRequested = useRef(false);
  const [punctuality, setPunctuality] = useState<PunctualityState>({ status: "idle" });
  const ensurePunctuality = useCallback(() => {
    if (punctualityRequested.current || !restaurantId) { return; }
    punctualityRequested.current = true;
    setPunctuality({ status: "loading" });
    fetchPunctuality(restaurantId)
      .then((byEmp) => { setPunctuality({ status: "done", byEmp }); })
      .catch((e: unknown) => { setPunctuality({ status: "error", error: errText(e) }); });
  }, [restaurantId]);

  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [busy, setBusy] = useState(false);

  const me = data?.me;
  const clockedIn = me?.clocked_in === true;
  const todayMins = me?.today_minutes ?? 0;
  const pending = data?.pending ?? [];
  const team = data?.team ?? [];
  const onShift = team.filter((t) => t.open);
  const period = windowLabel(data?.from ?? "", data?.to ?? "", timezone);

  const doToggle = async (): Promise<void> => {
    if (!restaurantId || !me || busy) { return; }
    setBusy(true);
    try {
      await toggleClock(restaurantId, !clockedIn);
    } catch (e) {
      toast({ title: errText(e), variant: "destructive" });
    } finally {
      refresh();
      setBusy(false);
    }
  };

  const doReview = async (id: string, approve: boolean): Promise<void> => {
    try {
      await reviewAttendance(restaurantId, id, approve);
    } catch (e) {
      toast({ title: errText(e), variant: "destructive" });
    } finally {
      // Whole-screen reload: my own "awaiting approval" note clears too.
      refresh();
    }
  };

  const pendingSub = (p: PendingClockIn): string =>
    p.clock_out ? `In ${clock(p.clock_in, timezone)} · out ${clock(p.clock_out, timezone)}` : `In ${clock(p.clock_in, timezone)} · still on shift`;

  if (loading) {
    return (
      <div className="grid gap-4">
        <SkeletonStats tiles={isManager ? 3 : 1} />
        <SkeletonRows rows={6} title />
      </div>
    );
  }
  if (error || !data) {
    return <LoadErrorState whatFailed="Could not load attendance" error={error} onRetry={retry} />;
  }

  // --- sheets -----------------------------------------------------------------
  const renderSheet = (): { eyebrow: string; title: string; body: JSX.Element } | null => {
    if (!sheet) { return null; }
    const small = "text-xs text-muted-foreground";
    switch (sheet.kind) {
      case "me":
        return {
          eyebrow: "Attendance · my day",
          title: dayLabel(todayInZone(timezone), timezone),
          body: (
            <>
              <Kv label="Hours today" value={hm(todayMins)} />
              <Kv label="Right now" value={clockedIn ? "On shift" : "Off shift"} />
              <Kv label="Since" value={me?.since ? stamp(me.since, timezone) : "—"} />
              <Kv label="Timezone" value={zoneLabel(timezone)} />
              {me?.pending_approval && <Kv label="Approval" value="One clock-in today is awaiting review" />}
              <p className={cn(small, "mt-3.5")}>
                Every shift you started today is added together. A rejected clock-in is left out; an open shift is
                counted up to this moment, so this figure keeps rising while you are on it.
              </p>
              <SectionHeader title="My punctuality — last 30 days" className="mb-2 mt-5" />
              <PunctualityBlock empId={user?.employeeId ?? ""} allowed={canReadPunctuality} state={punctuality} ensure={ensurePunctuality} />
              <Button size="sm" className="mt-3.5" disabled={busy} onClick={() => { setSheet(null); void doToggle(); }}>
                {clockedIn ? <LogOut className="mr-2 h-4 w-4" /> : <LogIn className="mr-2 h-4 w-4" />}
                {clockedIn ? "Clock out" : "Clock in"}
              </Button>
            </>
          ),
        };
      case "pending": {
        const p = sheet.row;
        const mins = shiftMinutes(p.clock_in, p.clock_out);
        const open = !p.clock_out;
        return {
          eyebrow: "Attendance · pending approval",
          title: p.name || "Employee",
          body: (
            <>
              <Kv label="Clocked in" value={stamp(p.clock_in, timezone)} />
              <Kv label="Clocked out" value={p.clock_out ? stamp(p.clock_out, timezone) : "Still on shift"} />
              <Kv label="Length" value={mins == null ? "—" : `${hm(mins)}${open ? " so far" : ""}`} />
              <Kv label="Status" value="Awaiting approval" />
              <div className="mt-3">
                <PunctualityBlock empId={p.emp_id} allowed={canReadPunctuality} state={punctuality} ensure={ensurePunctuality} baselineOnly />
              </div>
              {open && mins != null && mins > RUNAWAY_MINUTES && (
                <p className="mt-3 text-xs font-medium text-warning">
                  Still open after more than 16 hours. Payroll and staff analytics both credit a shift at 16 hours, so
                  approving this as it stands records a length nothing else will agree with — check for a missed
                  clock-out first.
                </p>
              )}
              <p className={cn(small, "mt-3.5")}>
                Approving keeps the clock-in time above exactly as recorded — the decision is stamped separately.
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => { setSheet(null); void doReview(p.id, true); }}>
                  <Check className="mr-1.5 h-4 w-4" /> Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setSheet(null); void doReview(p.id, false); }}>
                  <X className="mr-1.5 h-4 w-4" /> Reject
                </Button>
              </div>
            </>
          ),
        };
      }
      case "team": {
        const t = sheet.row;
        return {
          eyebrow: "Attendance · team hours",
          title: t.name || "Employee",
          body: (
            <>
              <Kv label="Hours" value={hm(t.minutes)} />
              <Kv label="Shifts" value={t.shifts} />
              <Kv label="Average shift" value={t.shifts > 0 ? hm(Math.floor(t.minutes / t.shifts)) : "—"} />
              <Kv label="Right now" value={t.open ? "On shift" : "Off shift"} />
              {period && <Kv label="Period" value={period} />}
              <p className={cn(small, "mt-3.5")}>
                Totals count approved shifts only — a pending or rejected clock-in adds nothing here. An open shift is
                counted up to this moment.
              </p>
              <SectionHeader title="Punctuality — last 30 days" className="mb-2 mt-5" />
              <PunctualityBlock empId={t.emp_id} allowed={canReadPunctuality} state={punctuality} ensure={ensurePunctuality} />
            </>
          ),
        };
      }
      case "people-pending":
        return {
          eyebrow: "Attendance · pending approval",
          title: `${pending.length} clock-in${pending.length === 1 ? "" : "s"} awaiting review`,
          body: (
            <>
              <p className={cn(small, "mb-4")}>
                Each one is already recorded — approving confirms the time as clocked, it does not set it. Open a name
                to review it.
              </p>
              {pending.map((p) => {
                const mins = shiftMinutes(p.clock_in, p.clock_out);
                return (
                  <SheetRecordRow
                    key={p.id}
                    title={p.name || "Employee"}
                    sub={pendingSub(p)}
                    trailing={mins == null ? "" : hm(mins)}
                    // Replace rather than stack.
                    onClick={() => { setSheet({ kind: "pending", row: p }); }}
                  />
                );
              })}
            </>
          ),
        };
      case "people-on-shift":
        return {
          eyebrow: "Attendance · on shift",
          title: `${onShift.length} on shift now`,
          body: (
            <>
              <p className={cn(small, "mb-4")}>
                Clocked in with no clock-out yet, over {period || "the summarised window"}. Hours shown are this
                window&apos;s total, not the open shift alone.
              </p>
              {onShift.map((t) => (
                <SheetRecordRow
                  key={t.emp_id}
                  title={t.name || "Employee"}
                  sub={`${t.shifts} shift${t.shifts === 1 ? "" : "s"} in the window`}
                  trailing={hm(t.minutes)}
                  onClick={() => { setSheet({ kind: "team", row: t }); }}
                />
              ))}
            </>
          ),
        };
    }
  };
  const openSheet = renderSheet();

  return (
    <div className="relative grid gap-4">
      <CacheStalePill offline={offline} fromCache={fromCache} updatedAt={updatedAt} />

      {/* 1. Stat tiles */}
      <div className={cn("grid grid-cols-1 gap-4", isManager && "min-[760px]:grid-cols-3")}>
        <StatCard
          value={hm(todayMins)}
          caption="HOURS TODAY"
          tag={clockedIn ? "On shift" : undefined}
          tagColor={COPPER}
          onClick={() => { setSheet({ kind: "me" }); }}
        />
        {isManager && (
          <StatCard
            value={String(pending.length)}
            caption="PENDING APPROVALS"
            tag={pending.length > 0 ? "Review" : undefined}
            tagColor="hsl(var(--warning))"
            // Nothing waiting is nothing to open: inert at zero.
            onClick={pending.length === 0 ? undefined : () => { setSheet({ kind: "people-pending" }); }}
          />
        )}
        {isManager && (
          <StatCard
            value={String(onShift.length)}
            caption="ON SHIFT NOW"
            onClick={onShift.length === 0 ? undefined : () => { setSheet({ kind: "people-on-shift" }); }}
          />
        )}
      </div>

      {/* 2. My shift card */}
      <ForkCard onClick={() => { setSheet({ kind: "me" }); }}>
        <div className="flex items-center gap-3 pr-5">
          <span
            aria-hidden
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border transition-colors duration-base",
              clockedIn ? "border-[hsl(var(--primary)/0.4)] bg-[hsl(var(--primary)/0.12)] text-accent-foreground" : "border-border bg-inset text-muted-foreground",
            )}
          >
            <Briefcase className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-foreground">
                {clockedIn ? `Clocked in · since ${clock(data.me.since, timezone) || "—"}` : "Not clocked in"}
              </span>
              {clockedIn
                ? <StatusChip key="on" color={COPPER} label="On shift" dense />
                : <StatusChip key="off" status="neutral" label="Off shift" dense />}
            </div>
            {me?.pending_approval && (
              <p className="mt-1 flex items-center gap-1 text-xs font-medium text-warning">
                <Hourglass className="h-[13px] w-[13px]" />
                Awaiting admin approval — your clock-in time is already recorded.
              </p>
            )}
          </div>
          <div {...stop} className="shrink-0">
            <Button size="sm" onClick={() => void doToggle()} disabled={busy || !me}>
              {clockedIn ? <LogOut className="mr-2 h-4 w-4" /> : <LogIn className="mr-2 h-4 w-4" />}
              {busy ? "…" : clockedIn ? "Clock out" : "Clock in"}
            </Button>
          </div>
        </div>
      </ForkCard>

      {/* 3. Pending approval (manager, only when non-empty) */}
      {isManager && pending.length > 0 && (
        <section className="grid gap-2">
          <SectionHeader title="Pending approval" count={pending.length} />
          <p className="-mt-1 text-xs text-muted-foreground">Approving keeps the employee&apos;s original clock-in time.</p>
          {pending.map((p) => (
            <ForkCard key={p.id} onClick={() => { setSheet({ kind: "pending", row: p }); }} className="py-3">
              <div className="flex flex-col gap-2.5 pr-5 min-[760px]:flex-row min-[760px]:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={p.name} warning />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">{p.name || "Employee"}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <InfoChip icon={<LogIn />} label={`In ${clock(p.clock_in, timezone)}`} />
                      {p.clock_out
                        ? <StatusChip key="ended" status="neutral" label="Shift ended" dense />
                        : <StatusChip key="on" color={COPPER} label="On shift" dense />}
                    </div>
                  </div>
                </div>
                <div {...stop} className="flex shrink-0 gap-2">
                  <Button size="sm" onClick={() => void doReview(p.id, true)}>
                    <Check className="mr-1.5 h-4 w-4" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void doReview(p.id, false)}>
                    <X className="mr-1.5 h-4 w-4" /> Reject
                  </Button>
                </div>
              </div>
            </ForkCard>
          ))}
        </section>
      )}

      {/* 4. Team hours (manager) */}
      {isManager && (
        <section className="grid gap-2">
          <SectionHeader title="Team hours — last 30 days" count={team.length} />
          {team.length === 0 ? (
            <p className="text-xs text-muted-foreground">No attendance recorded yet.</p>
          ) : (
            team.map((t) => (
              <ForkCard key={t.emp_id} onClick={() => { setSheet({ kind: "team", row: t }); }} className="py-3">
                <div className="flex flex-col gap-2.5 pr-5 min-[760px]:flex-row min-[760px]:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar name={t.name} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-foreground">{t.name || "Employee"}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <InfoChip icon={<Repeat />} label={`${t.shifts} shift${t.shifts === 1 ? "" : "s"}`} />
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {t.open && <StatusChip color={COPPER} label="On shift" dense />}
                    <MicroStat value={hm(t.minutes)} label="hours" alignEnd />
                  </div>
                </div>
              </ForkCard>
            ))
          )}
        </section>
      )}

      <DrillSheet
        open={openSheet != null}
        onOpenChange={(o) => { if (!o) { setSheet(null); } }}
        eyebrow={openSheet?.eyebrow}
        title={openSheet?.title ?? ""}
      >
        {openSheet?.body}
      </DrillSheet>
    </div>
  );
}
