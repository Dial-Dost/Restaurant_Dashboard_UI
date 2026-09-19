"use client";

// Employees — the web copy of Flutter `employeesModule` (modules.dart
// ~30515): a team dashboard, not an admin table. One scrolling page:
// password-requests banner → "Team" card grid (every card drills into the
// employee sheet) → "Scoring" band (five box-level drill-downs into ranking
// boards) → "Leave" register (tiles, approvals, request-leave). Roles live on
// their own page (/dashboard/roles); role ASSIGNMENT stays here, in the
// per-card "Manage roles" sheet.
//
// Performance and leave are optional reads: each is gated on its own
// permission + plan feature, fetched separately, and a refusal is stated once
// in words above the roster — never an empty list that reads as "no leave".

import type { JSX } from "react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck, CalendarX2, Crown, Gauge, KeyRound, MoreVertical, Palmtree, Shield, UserMinus, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ForkCard } from "@/components/ui/fork-card";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { SkeletonRows, SkeletonStats } from "@/components/ui/fork-skeleton";
import { CacheStalePill } from "@/components/ui/stale-pill";
import { InfoChip, StatusChip } from "@/components/ui/status-chip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InitialsAvatar } from "@/components/customers/guest-bits";
import { moneyOf } from "@/components/overview/overview-utils";
import { EmployeeSheet } from "@/components/employees/employee-sheet";
import {
  LeaveListSheet,
  LeaveSection,
  LeaveSheet,
  PickMemberDialog,
  RequestLeaveDialog,
  leaveCovers,
  type LeaveList,
} from "@/components/employees/leave";
import { ManageRolesSheet } from "@/components/employees/manage-roles-sheet";
import { MetricBoard, ScoreChip, ScoringBand, memberScore, type TeamMember } from "@/components/employees/performance";
import { ConfirmDialog, RoleChip, roleLabel, str, todayIn } from "@/components/employees/shared";
import { AddEmployeeDialog, PasswordRequestsBanner, ResetPasswordDialog, type NewEmployee } from "@/components/employees/staff-dialogs";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useCachedFetch } from "@/hooks/use-cached-fetch";
import { useCurrency } from "@/hooks/use-currency";
import { useHighlightRow } from "@/hooks/use-highlight-row";
import { usePlanFeatures } from "@/hooks/use-plan-features";
import { useTimezone } from "@/lib/use-timezone";
import { cn } from "@/lib/utils";
import { dismissPasswordRequest, setUserPassword, type User } from "@/lib/db";
import {
  PERM_ANALYTICS,
  PERM_REVIEW_ATTENDANCE,
  addEmployee,
  decideLeave,
  fetchEmployeesBundle,
  removeEmployee,
  requestLeave,
  type Row,
} from "@/lib/api/employees";
import {
  hasPermission,
  PERM_ADD_EMPLOYEE,
  PERM_PASSWORDS,
  PERM_REMOVE_EMPLOYEE,
  PERM_VIEW_EMPLOYEES,
} from "@/lib/session-scope";

type Sheet =
  | { kind: "member"; empId: string }
  | { kind: "board"; key: string; title: string }
  | { kind: "leave"; leave: Row }
  | { kind: "list"; list: LeaveList }
  | { kind: "roles"; empId: string }
  | { kind: "pick" }
  | { kind: "request"; member: TeamMember }
  | { kind: "reset"; employeeId: string; name: string }
  | { kind: "remove"; member: TeamMember }
  | { kind: "add" };

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function buildTeam(users: User[], nameById: Record<string, string>, perfByEmp: Map<string, Row>, leavesByEmp: Map<string, Row[]>): TeamMember[] {
  return users.map((u) => {
    const raw = u as unknown as Row;
    const empId = str(raw, "employee_id", str(raw, "id"));
    const roleAll = Array.isArray(u.role_all)
      ? u.role_all.filter((s) => s !== "")
      : [str(raw, "role", "staff")];
    const name = `${str(raw, "emp_Fname")} ${str(raw, "emp_Lname")}`.trim();
    const display = name || str(raw, "employee_Username");
    return {
      user: u,
      empId,
      display,
      initials: display.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join("").toUpperCase(),
      roleLabels: roleAll.map((r) => roleLabel(r, nameById)),
      isSuper: u.is_superadmin === true,
      perfRow: perfByEmp.get(empId) ?? null,
      leaves: leavesByEmp.get(empId) ?? [],
    };
  });
}

function EmployeesPageInner(): JSX.Element {
  const { user } = useAuth();
  const { toast } = useToast();
  const { timezone } = useTimezone();
  const { currencySymbol } = useCurrency();
  const { featureEnabled } = usePlanFeatures();
  const money = useMemo(() => moneyOf(currencySymbol), [currencySymbol]);
  const hasShownAccessToastRef = useRef(false);

  const actions = user?.actions_set;
  const restaurantId = user?.restaurantUsername ?? "";
  const selfId = user?.employeeId ?? "";
  const canSeeEmployees = hasPermission(actions, PERM_VIEW_EMPLOYEES);
  const canAddEmployee = hasPermission(actions, PERM_ADD_EMPLOYEE);
  const canRemoveEmployee = hasPermission(actions, PERM_REMOVE_EMPLOYEE);
  const canManagePasswords = hasPermission(actions, PERM_PASSWORDS);
  const canPerf = hasPermission(actions, PERM_ANALYTICS) && featureEnabled("analytics");
  const canLeave = hasPermission(actions, PERM_REVIEW_ATTENDANCE) && featureEnabled("attendance");

  const fetcher = useCallback(
    () => fetchEmployeesBundle({ restaurantId, canPerf, canLeave, canPasswords: canManagePasswords }),
    [restaurantId, canPerf, canLeave, canManagePasswords],
  );
  const { data, loading, error, offline, fromCache, updatedAt, retry, refresh } = useCachedFetch(
    `employees:${restaurantId}:${String(canPerf)}:${String(canLeave)}:${String(canManagePasswords)}`,
    fetcher,
    { enabled: restaurantId !== "" && canSeeEmployees },
  );

  const [sheet, setSheet] = useState<Sheet | null>(null);
  const close = (): void => { setSheet(null); };
  const today = todayIn(timezone);

  const derived = useMemo(() => {
    if (!data) { return null; }
    const perf = data.performance.data;
    const leavePage = data.leaves.data;
    const perfNote = !data.canPerf
      ? "Performance scores need the analytics permission, which this login does not hold."
      : data.performance.error ? `Performance scores couldn't be loaded: ${data.performance.error}` : "";
    const leaveNote = !data.canLeave
      ? "Leave records need the Review Attendance permission, which this login does not hold."
      : data.leaves.error ? `Leave records couldn't be loaded: ${data.leaves.error}` : "";
    const perfByEmp = new Map<string, Row>();
    for (const r of Array.isArray(perf.rows) ? perf.rows : []) {
      if (r && typeof r === "object") {
        const id = str(r as Row, "employee_id");
        if (id) { perfByEmp.set(id, r as Row); }
      }
    }
    const leavesByEmp = new Map<string, Row[]>();
    for (const l of Array.isArray(leavePage.leaves) ? leavePage.leaves : []) {
      if (l && typeof l === "object") {
        const id = str(l as Row, "emp_id");
        if (id) { leavesByEmp.set(id, [...(leavesByEmp.get(id) ?? []), l as Row]); }
      }
    }
    // A custom role is stored on the employee as its uuid — map it back to a name.
    const nameById: Record<string, string> = {};
    for (const r of data.roles) {
      if (r.id && r.role_name) { nameById[r.id.trim()] = r.role_name.trim(); }
    }
    const team = buildTeam(data.users, nameById, perfByEmp, leavesByEmp);
    return { perf, leavePage, perfNote, leaveNote, team };
  }, [data]);

  const team = derived?.team ?? [];
  const highlight = useHighlightRow("highlightEmployee", team.length);
  const canReview = data?.canLeave === true;

  useEffect(() => {
    if (!user || canSeeEmployees || hasShownAccessToastRef.current) { return; }
    toast({
      title: "Access denied",
      description: "This page needs the “View Employees” permission.",
      variant: "destructive",
    });
    hasShownAccessToastRef.current = true;
  }, [user, canSeeEmployees, toast]);

  // ------------------------------------------------------------- actions

  const fail = (e: unknown): void => { toast({ title: errText(e), variant: "destructive" }); };

  const onDecide = (leave: Row, approve: boolean): void => {
    const id = str(leave, "id");
    if (!id) { return; }
    void (async () => {
      try {
        const changed = await decideLeave(restaurantId, id, approve);
        const word = approve ? "approved" : "rejected";
        toast({ title: changed ? `Leave ${word}.` : `Already ${word} — nothing changed.` });
      } catch (e) {
        fail(e);
      }
      refresh();
    })();
  };

  const submitLeave = async (
    member: TeamMember,
    v: { leave_type: string; start_day: string; end_day: string; reason?: string },
  ): Promise<boolean> => {
    try {
      // Filing for yourself omits emp_id, so it needs no permission.
      await requestLeave(restaurantId, member.empId === selfId ? v : { ...v, emp_id: member.empId });
      toast({ title: `Leave requested for ${member.display}.` });
      refresh();
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  };

  const submitPassword = async (employeeId: string, password: string): Promise<boolean> => {
    try {
      await setUserPassword(restaurantId, employeeId, password);
      toast({ title: "Password updated." });
      refresh();
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  };

  const submitAdd = async (v: NewEmployee): Promise<boolean> => {
    try {
      await addEmployee(restaurantId, user?.outlet_id, v);
      toast({ title: "Employee added." });
      refresh();
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  };

  const doRemove = (m: TeamMember): void => {
    void (async () => {
      try {
        await removeEmployee(restaurantId, m.empId);
        toast({ title: "Employee removed." });
      } catch (e) {
        fail(e);
      }
      refresh();
    })();
  };

  const doDismiss = (id: string): void => {
    void (async () => {
      try {
        await dismissPasswordRequest(restaurantId, id);
      } catch (e) {
        fail(e);
      }
      refresh();
    })();
  };

  // ------------------------------------------------------------- render

  if (!user || !canSeeEmployees) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">You do not have permission to view this page.</p>
        <p className="mt-1">Viewing staff needs the “View Employees” permission. An admin can grant it from Roles.</p>
      </div>
    );
  }

  const fab = canAddEmployee ? (
    <Button
      size="lg"
      onClick={() => { setSheet({ kind: "add" }); }}
      className="fixed bottom-6 right-6 z-40 h-12 rounded-full px-5 shadow-card-hover"
    >
      <UserPlus /> Add employee
    </Button>
  ) : null;

  const memberById = (id: string): TeamMember | undefined => team.find((m) => m.empId === id);
  const sheetMember = sheet?.kind === "member" ? memberById(sheet.empId) : undefined;
  const rolesMember = sheet?.kind === "roles" ? memberById(sheet.empId) : undefined;

  let body: JSX.Element;
  if (loading) {
    body = (
      <div className="grid gap-6">
        <SkeletonStats tiles={4} />
        <SkeletonRows rows={6} />
      </div>
    );
  } else if (error || !data || !derived) {
    body = <LoadErrorState whatFailed="Couldn't load the team." error={error} onRetry={retry} />;
  } else if (data.users.length === 0) {
    body = (
      <EmptyState
        icon={<BadgeCheck />}
        title="No employees yet"
        caption="Add your first team member to hand out logins and roles."
      />
    );
  } else {
    const { perf, leavePage, perfNote, leaveNote } = derived;
    const windowDays = Number(perf.window_days);
    body = (
      <div className="grid gap-8">
        {canManagePasswords && data.requests.length > 0 && (
          <PasswordRequestsBanner
            requests={data.requests}
            onReset={(r) => { setSheet({ kind: "reset", employeeId: r.employee_id, name: r.name || r.username }); }}
            onDismiss={(r) => { doDismiss(r.id); }}
          />
        )}

        <section>
          <SectionHeader
            title="Team"
            count={data.users.length}
            trailing={
              perfNote === "" && Object.keys(perf).length > 0 ? (
                <InfoChip icon={<Gauge />} label={`Scored over ${Number.isFinite(windowDays) && windowDays > 0 ? windowDays : 30} days`} />
              ) : undefined
            }
          />
          {(perfNote || leaveNote) && (
            <div className="mb-3 grid gap-0.5 text-xs text-muted-foreground">
              {perfNote && <p>{perfNote}</p>}
              {leaveNote && <p>{leaveNote}</p>}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 min-[720px]:grid-cols-2 min-[1120px]:grid-cols-3 min-[1500px]:grid-cols-4">
            {team.map((m) => {
              const pending = m.leaves.filter((l) => str(l, "status") === "requested").length;
              const onLeaveNow = m.leaves.some((l) => str(l, "status") === "approved" && leaveCovers(l, today));
              const hl = highlight.rowProps(m.empId);
              const mayRequest = m.empId !== "" && (canReview || m.empId === selfId);
              return (
                <ForkCard
                  key={m.empId || m.display}
                  id={hl.id}
                  className={cn("px-3.5 py-3", hl.className)}
                  chevron={false}
                  onClick={() => { setSheet({ kind: "member", empId: m.empId }); }}
                  aria-label={`Open ${m.display}`}
                >
                  <div className="flex items-center gap-3">
                    <InitialsAvatar
                      initials={m.initials || "?"}
                      className={m.isSuper ? "border-warning/50 text-warning" : undefined}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold">{m.display}</span>
                        {m.isSuper && (
                          <span title="Superadmin (owner)" aria-label="Superadmin (owner)" className="shrink-0">
                            <Crown className="h-[15px] w-[15px] text-warning" />
                          </span>
                        )}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">@{m.user.employee_Username}</div>
                    </div>
                    <div onClick={(e) => { e.stopPropagation(); }} onKeyDown={(e) => { e.stopPropagation(); }}>
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" aria-label={`Actions for ${m.display}`} className="h-8 w-8 text-muted-foreground">
                            <MoreVertical className="h-[18px] w-[18px]" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => { setSheet({ kind: "roles", empId: m.empId }); }}>
                            <Shield className="mr-2 h-4 w-4" /> Manage roles
                          </DropdownMenuItem>
                          {mayRequest && (
                            <DropdownMenuItem onSelect={() => { setSheet({ kind: "request", member: m }); }}>
                              <CalendarX2 className="mr-2 h-4 w-4" /> Request leave
                            </DropdownMenuItem>
                          )}
                          {canManagePasswords && (
                            <DropdownMenuItem onSelect={() => { setSheet({ kind: "reset", employeeId: m.empId, name: m.display }); }}>
                              <KeyRound className="mr-2 h-4 w-4" /> Reset password
                            </DropdownMenuItem>
                          )}
                          {canRemoveEmployee && !m.isSuper && (
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => { setSheet({ kind: "remove", member: m }); }}
                            >
                              <UserMinus className="mr-2 h-4 w-4" /> Remove
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {m.roleLabels.slice(0, 2).map((r, i) => (
                      <RoleChip key={`${r}-${String(i)}`} role={r} />
                    ))}
                    {m.roleLabels.length > 2 && <RoleChip role={`+${m.roleLabels.length - 2}`} colorKey="employee" />}
                  </div>
                  {(perfNote === "" || onLeaveNow || pending > 0) && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {perfNote === "" && <ScoreChip score={memberScore(m, "")} suffix=" score" />}
                      {onLeaveNow ? (
                        <InfoChip icon={<Palmtree />} label="On leave" />
                      ) : pending > 0 ? (
                        <StatusChip status="warning" label={`${pending} to review`} dense />
                      ) : null}
                    </div>
                  )}
                </ForkCard>
              );
            })}
          </div>
        </section>

        {perfNote === "" && (
          <ScoringBand
            team={team}
            perf={perf}
            money={money}
            onOpenBoard={(key, title) => { setSheet({ kind: "board", key, title }); }}
          />
        )}

        {leaveNote === "" && (
          <LeaveSection
            leavePage={leavePage}
            canReview={canReview}
            today={today}
            onOpenLeave={(l) => { setSheet({ kind: "leave", leave: l }); }}
            onOpenList={(list) => { setSheet({ kind: "list", list }); }}
            onDecide={onDecide}
            onRequest={() => { setSheet({ kind: "pick" }); }}
          />
        )}
      </div>
    );
  }

  const onOpenChange = (o: boolean): void => { if (!o) { close(); } };

  return (
    <div className="relative pb-24">
      {body}
      {fab}
      <CacheStalePill offline={offline} fromCache={fromCache} updatedAt={updatedAt} />

      {sheetMember && derived && (
        <EmployeeSheet
          member={sheetMember}
          perfMeta={derived.perf}
          perfNote={derived.perfNote}
          leaveNote={derived.leaveNote}
          canReview={canReview}
          selfId={selfId}
          onDecide={onDecide}
          onOpenLeave={(l) => { setSheet({ kind: "leave", leave: l }); }}
          onRequestLeave={(m) => { setSheet({ kind: "request", member: m }); }}
          onOpenChange={onOpenChange}
        />
      )}
      {sheet?.kind === "board" && derived && (
        <MetricBoard
          metricKey={sheet.key}
          title={sheet.title}
          team={team}
          perf={derived.perf}
          perfNote={derived.perfNote}
          money={money}
          onOpenMember={(m) => { setSheet({ kind: "member", empId: m.empId }); }}
          onOpenChange={onOpenChange}
        />
      )}
      {sheet?.kind === "leave" && (
        <LeaveSheet
          leave={sheet.leave}
          canReview={canReview}
          timezone={timezone}
          today={today}
          onDecide={onDecide}
          onOpenChange={onOpenChange}
        />
      )}
      {sheet?.kind === "list" && (
        <LeaveListSheet
          list={sheet.list}
          onOpenLeave={(l) => { setSheet({ kind: "leave", leave: l }); }}
          onOpenChange={onOpenChange}
        />
      )}
      {rolesMember && data && (
        <ManageRolesSheet
          restaurantId={restaurantId}
          employee={rolesMember.user}
          display={rolesMember.display}
          initials={rolesMember.initials}
          isSuper={rolesMember.isSuper}
          customRoles={data.roles}
          onDone={(changed) => {
            close();
            if (changed) { refresh(); }
          }}
        />
      )}
      {sheet?.kind === "pick" && (
        <PickMemberDialog
          team={team}
          onPick={(m) => { setSheet({ kind: "request", member: m }); }}
          onOpenChange={onOpenChange}
        />
      )}
      {sheet?.kind === "request" && (
        <RequestLeaveDialog
          member={sheet.member}
          today={today}
          onSubmit={(v) => submitLeave(sheet.member, v)}
          onOpenChange={onOpenChange}
        />
      )}
      {sheet?.kind === "reset" && (
        <ResetPasswordDialog
          name={sheet.name}
          onSubmit={(pw) => submitPassword(sheet.employeeId, pw)}
          onOpenChange={onOpenChange}
        />
      )}
      {sheet?.kind === "add" && data && (
        <AddEmployeeDialog customRoles={data.roles} onSubmit={submitAdd} onOpenChange={onOpenChange} />
      )}
      <ConfirmDialog
        open={sheet?.kind === "remove"}
        title="Remove employee"
        body={sheet?.kind === "remove" ? `Remove ${sheet.member.display}? This cannot be undone.` : ""}
        confirmLabel="Remove"
        onConfirm={() => {
          if (sheet?.kind === "remove") { doRemove(sheet.member); }
          close();
        }}
        onOpenChange={onOpenChange}
      />
    </div>
  );
}

export default function EmployeesPage(): JSX.Element {
  return (
    <Suspense fallback={<SkeletonRows rows={6} />}>
      <EmployeesPageInner />
    </Suspense>
  );
}
