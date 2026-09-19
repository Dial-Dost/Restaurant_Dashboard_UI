"use client";

// The leave register — the web copy of Flutter `_leaveSection`,
// `_leaveTeamRow`, `_leaveRow`, `_leaveSheet`, `_requestLeave` and
// `_requestLeaveForMember` (modules.dart ~29420–30500).
//
// A decision is never what a stray tap does: the row tap opens the sheet,
// Approve / Reject are separate buttons. Pending leave whose range has started
// is COUNTING as unexplained absence, and the sheet says so in words.

import * as React from "react";
import { CalendarClock, CalendarX2, Check, Palmtree, Send, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ForkCard } from "@/components/ui/fork-card";
import { MetricTile } from "@/components/ui/metric-tile";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusChip, type StatusChipStatus } from "@/components/ui/status-chip";
import { DrillSheet } from "@/components/ui/drill-sheet";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Row } from "@/lib/api/employees";
import type { TeamMember } from "./performance";
import { Kv, fmtDay, intOrNull, shiftDay, stamp, str } from "./shared";

export const LEAVE_MAX_DAYS = 366;

export const leaveTypeLabel = (t: string): string =>
  t === "sick" ? "Sick leave" : t === "casual" ? "Casual leave" : t === "unpaid" ? "Unpaid leave" : t === "holiday" ? "Holiday" : t || "Leave";

export const leaveStatus = (l: Row): string => str(l, "status", "requested");

export const leaveStatusChip = (s: string): StatusChipStatus =>
  s === "approved" ? "success" : s === "rejected" ? "danger" : "warning";

export function leaveRange(l: Row): string {
  const from = str(l, "start_day");
  const to = str(l, "end_day");
  if (!from) { return "—"; }
  return from === to || !to ? fmtDay(from) : `${fmtDay(from)} – ${fmtDay(to)}`;
}

export function leaveDayCount(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) { return 0; }
  return Math.round((b - a) / 86_400_000) + 1;
}

export function leaveCovers(l: Row, day: string): boolean {
  const from = str(l, "start_day");
  const to = str(l, "end_day", from);
  return from !== "" && from <= day && to >= day;
}

const days = (l: Row): number => intOrNull(l.days) ?? 1;
const dayWord = (n: number): string => `${n} day${n === 1 ? "" : "s"}`;
const named = (s: string): boolean => s !== "" && s !== "—";

function absenceEffect(l: Row, today: string): string {
  const status = leaveStatus(l);
  const started = str(l, "start_day") <= today;
  if (status === "approved") {
    return "Approved, so every day in this range is excluded from this person's absence count — an excused day is not an absence.";
  }
  if (status === "rejected") {
    return "Rejected, so none of these days is excused. Any the person did not clock in for counts as an unexplained absence.";
  }
  return started
    ? "Still awaiting a decision. Attendance only excuses APPROVED leave, so the days in this range that have already passed are counting as unexplained absences until somebody decides it."
    : "Still awaiting a decision. Nothing is excused until it is approved.";
}

export type DecideFn = (leave: Row, approve: boolean) => void;

function DecisionButtons({ leave, onDecide }: { leave: Row; onDecide: DecideFn }): React.JSX.Element {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Button size="sm" onClick={(e) => { e.stopPropagation(); onDecide(leave, true); }}>
        <Check /> Approve
      </Button>
      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onDecide(leave, false); }}>
        <X /> Reject
      </Button>
    </div>
  );
}

/** `_leaveRow` — one leave inside the employee sheet. */
export function LeaveRow({
  leave,
  canReview,
  onDecide,
  onOpen,
}: {
  leave: Row;
  canReview: boolean;
  onDecide: DecideFn;
  onOpen: (l: Row) => void;
}): React.JSX.Element {
  const status = leaveStatus(leave);
  const reason = str(leave, "reason");
  const by = str(leave, "requested_by_name");
  const decided = str(leave, "decided_by_name");
  return (
    <div className="py-1.5">
      <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => { onOpen(leave); }}>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold hover:text-accent-foreground">
          {leaveTypeLabel(str(leave, "leave_type"))} · {leaveRange(leave)}
        </span>
        <StatusChip status={leaveStatusChip(status)} label={status} dense />
      </button>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {dayWord(days(leave))}
        {named(by) ? ` · filed by ${by}` : ""}
        {named(decided) ? ` · decided by ${decided}` : ""}
      </p>
      {named(reason) && <p className="mt-0.5 text-xs text-tertiary">{reason}</p>}
      {canReview && status === "requested" && <DecisionButtons leave={leave} onDecide={onDecide} />}
    </div>
  );
}

/** `_leaveTeamRow` — a tappable inset card in the register. */
function LeaveTeamRow({
  leave,
  canReview,
  onDecide,
  onOpen,
}: {
  leave: Row;
  canReview: boolean;
  onDecide: DecideFn;
  onOpen: (l: Row) => void;
}): React.JSX.Element {
  const status = leaveStatus(leave);
  const reason = str(leave, "reason");
  const by = str(leave, "requested_by_name");
  return (
    <ForkCard inset className="px-3.5 py-2.5" onClick={() => { onOpen(leave); }}>
      <div className="flex flex-wrap items-center gap-2 pr-4">
        <span className="truncate text-sm font-semibold">{str(leave, "employee_name", "Employee")}</span>
        <StatusChip status={leaveStatusChip(status)} label={status} dense />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {leaveTypeLabel(str(leave, "leave_type"))} · {leaveRange(leave)} · {dayWord(days(leave))}
        {named(by) ? ` · filed by ${by}` : ""}
      </p>
      {named(reason) && <p className="mt-0.5 line-clamp-2 text-xs text-tertiary">{reason}</p>}
      {canReview && status === "requested" && <DecisionButtons leave={leave} onDecide={onDecide} />}
    </ForkCard>
  );
}

/** `_leaveSheet` — the individual leave drill-down. */
export function LeaveSheet({
  leave,
  canReview,
  timezone,
  today,
  onDecide,
  onOpenChange,
}: {
  leave: Row;
  canReview: boolean;
  timezone: string;
  today: string;
  onDecide: DecideFn;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const status = leaveStatus(leave);
  const reason = str(leave, "reason");
  const filedBy = str(leave, "requested_by_name");
  const decidedBy = str(leave, "decided_by_name");
  const decidedAt = str(leave, "decided_at");
  const createdAt = str(leave, "created_at");
  return (
    <DrillSheet open onOpenChange={onOpenChange} eyebrow={`Leave · ${status}`} title={str(leave, "employee_name", "Employee")}>
      <Kv k="Type">{leaveTypeLabel(str(leave, "leave_type"))}</Kv>
      <Kv k="Dates">{leaveRange(leave)}</Kv>
      <Kv k="Days">{dayWord(days(leave))}</Kv>
      <Kv k="Status">{status}</Kv>
      <Kv k="Reason">{named(reason) ? reason : "None given"}</Kv>
      <Kv k="Filed by">{named(filedBy) ? filedBy : "Not recorded"}</Kv>
      <Kv k="Filed on">{createdAt ? stamp(createdAt, timezone) : "—"}</Kv>
      <Kv k="Decided by">{named(decidedBy) ? decidedBy : "Not decided yet"}</Kv>
      <Kv k="Decided on">{decidedAt ? stamp(decidedAt, timezone) : "—"}</Kv>
      <p className={cn("mt-3 text-xs", status === "requested" ? "text-warning" : "text-muted-foreground")}>
        {absenceEffect(leave, today)}
      </p>
      {canReview && status === "requested" && (
        <DecisionButtons
          leave={leave}
          onDecide={(l, a) => { onOpenChange(false); onDecide(l, a); }}
        />
      )}
    </DrillSheet>
  );
}

export interface LeaveList {
  title: string;
  note: string;
  leaves: Row[];
}

/** A tile's list sheet — rows drill into the leave sheet (replacing it). */
export function LeaveListSheet({
  list,
  onOpenLeave,
  onOpenChange,
}: {
  list: LeaveList;
  onOpenLeave: (l: Row) => void;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  return (
    <DrillSheet open onOpenChange={onOpenChange} eyebrow="Leave" title={list.title}>
      <p className="mb-2 text-xs text-muted-foreground">{list.note}</p>
      <div className="divide-y divide-divider">
        {list.leaves.map((l, i) => {
          const status = leaveStatus(l);
          return (
            <button
              key={str(l, "id", String(i))}
              type="button"
              onClick={() => { onOpenLeave(l); }}
              className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-foreground/[0.04]"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{str(l, "employee_name", "Employee")}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {leaveTypeLabel(str(l, "leave_type"))} · {leaveRange(l)} · {dayWord(days(l))}
                </div>
              </div>
              <StatusChip status={leaveStatusChip(status)} label={status} dense />
            </button>
          );
        })}
      </div>
    </DrillSheet>
  );
}

/** `_leaveSection` — tiles, request button, grouped lists, precise empty copy. */
export function LeaveSection({
  leavePage,
  canReview,
  today,
  onOpenLeave,
  onOpenList,
  onDecide,
  onRequest,
}: {
  leavePage: Row;
  canReview: boolean;
  today: string;
  onOpenLeave: (l: Row) => void;
  onOpenList: (list: LeaveList) => void;
  onDecide: DecideFn;
  onRequest: () => void;
}): React.JSX.Element {
  const all = (Array.isArray(leavePage.leaves) ? leavePage.leaves : []).filter(
    (l): l is Row => l != null && typeof l === "object",
  );
  const start = (l: Row): string => str(l, "start_day");
  const nameOf = (l: Row): string => str(l, "employee_name", "Employee");
  const approved = (l: Row): boolean => str(l, "status") === "approved";
  const onLeave = all.filter((l) => approved(l) && leaveCovers(l, today)).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const ahead = all.filter((l) => approved(l) && start(l) > today).sort((a, b) => start(a).localeCompare(start(b)));
  const pending = all.filter((l) => str(l, "status") === "requested").sort((a, b) => start(a).localeCompare(start(b)));
  const names = (ls: Row[]): string => {
    const first = ls.slice(0, 2).map(nameOf).join(", ");
    return ls.length > 2 ? `${first} +${ls.length - 2}` : first;
  };
  const open = (title: string, note: string, ls: Row[]): (() => void) | undefined =>
    ls.length === 0 ? undefined : () => { onOpenList({ title, note, leaves: ls }); };

  const group = (title: string, ls: Row[]): React.ReactNode =>
    ls.length === 0 ? null : (
      <div className="mt-4">
        <SectionHeader title={title} count={ls.length} />
        <div className="grid gap-2">
          {ls.map((l, i) => (
            <LeaveTeamRow key={str(l, "id", String(i))} leave={l} canReview={canReview} onDecide={onDecide} onOpen={onOpenLeave} />
          ))}
        </div>
      </div>
    );

  return (
    <section>
      <SectionHeader title="Leave" count={all.length} />
      <div className="grid grid-cols-1 gap-3 min-[620px]:grid-cols-3">
        <MetricTile
          label={<span className="inline-flex items-center gap-1.5"><Palmtree className="h-3.5 w-3.5" />On leave today</span>}
          value={<span className={onLeave.length > 0 ? "text-info" : undefined}>{onLeave.length}</span>}
          footer={<span className="truncate text-xs text-muted-foreground">{onLeave.length === 0 ? "everyone is in" : names(onLeave)}</span>}
          onClick={open(
            "On leave today",
            `Approved leave covering ${fmtDay(today)}. These days are already excluded from each person's absence count.`,
            onLeave,
          )}
        />
        <MetricTile
          label={<span className="inline-flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" />Awaiting decision</span>}
          value={<span className={pending.length > 0 ? "text-warning" : undefined}>{pending.length}</span>}
          footer={<span className="truncate text-xs text-muted-foreground">{pending.length === 0 ? "nothing to review" : names(pending)}</span>}
          onClick={open(
            "Awaiting decision",
            "Filed and not yet decided. Until one is approved its days are NOT excused — any that have already passed are counting as unexplained absences.",
            pending,
          )}
        />
        <MetricTile
          label={<span className="inline-flex items-center gap-1.5"><CalendarX2 className="h-3.5 w-3.5" />Booked ahead</span>}
          value={ahead.length}
          footer={<span className="truncate text-xs text-muted-foreground">{ahead.length === 0 ? "nothing booked" : `next ${leaveRange(ahead[0])}`}</span>}
          onClick={open(
            "Booked ahead",
            `Approved leave starting after ${fmtDay(today)}, earliest first. Leave already running is counted under "on leave today" instead.`,
            ahead,
          )}
        />
      </div>
      {canReview && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onRequest}>
          <CalendarX2 /> Request leave
        </Button>
      )}
      {all.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          No leave on record between {fmtDay(str(leavePage, "from"))} and {fmtDay(str(leavePage, "to"))}.
        </p>
      ) : (
        <>
          {group("Awaiting decision", pending)}
          {group("On leave today", onLeave)}
          {group("Booked ahead", ahead)}
          {pending.length === 0 && onLeave.length === 0 && ahead.length === 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Nothing current — every leave in this window is decided and past.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** `_requestLeaveForMember` — "Request leave for" picker. */
export function PickMemberDialog({
  team,
  onPick,
  onOpenChange,
}: {
  team: TeamMember[];
  onPick: (m: TeamMember) => void;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Request leave for</DialogTitle>
        </DialogHeader>
        <div className="-mx-2 max-h-[60vh] overflow-y-auto">
          {team.filter((m) => m.empId).map((m) => (
            <button
              key={m.empId}
              type="button"
              className="block w-full rounded-md px-2 py-2 text-left text-sm hover:bg-foreground/5"
              onClick={() => { onPick(m); }}
            >
              {m.display}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** `_requestLeave` — type, From/To (±1 year), live day count, reason. */
export function RequestLeaveDialog({
  member,
  today,
  onSubmit,
  onOpenChange,
}: {
  member: TeamMember;
  today: string;
  onSubmit: (v: { leave_type: string; start_day: string; end_day: string; reason?: string }) => Promise<boolean>;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const [type, setType] = React.useState("casual");
  const [from, setFrom] = React.useState(today);
  const [to, setTo] = React.useState(today);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const min = shiftDay(today, -365);
  const max = shiftDay(today, 365);
  const count = leaveDayCount(from, to);
  const over = count > LEAVE_MAX_DAYS;

  const submit = async (): Promise<void> => {
    setBusy(true);
    const ok = await onSubmit({
      leave_type: type,
      start_day: from,
      end_day: to,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    });
    setBusy(false);
    if (ok) { onOpenChange(false); }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Request leave — {member.display}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="casual">Casual leave</SelectItem>
                <SelectItem value="sick">Sick leave</SelectItem>
                <SelectItem value="unpaid">Unpaid leave</SelectItem>
                <SelectItem value="holiday">Holiday</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="leave-from">From {fmtDay(from)}</Label>
              <Input
                id="leave-from"
                type="date"
                min={min}
                max={max}
                value={from}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) { return; }
                  setFrom(v);
                  if (to < v) { setTo(v); }
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="leave-to">To {fmtDay(to)}</Label>
              <Input
                id="leave-to"
                type="date"
                min={min}
                max={max}
                value={to}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) { return; }
                  setTo(v);
                  if (v < from) { setFrom(v); }
                }}
              />
            </div>
          </div>
          <p className={cn("text-xs", over ? "text-destructive" : "text-tertiary")}>
            {over
              ? `${count} days — one request cannot span more than ${LEAVE_MAX_DAYS}. Shorten the range, or file it in parts.`
              : `${count} day${count === 1 ? "" : "s"}, both ends included.`}
          </p>
          <div className="grid gap-1.5">
            <Label htmlFor="leave-reason">Reason (optional)</Label>
            <Input id="leave-reason" value={reason} onChange={(e) => { setReason(e.target.value); }} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); }} disabled={busy}>Cancel</Button>
          <Button onClick={() => { void submit(); }} disabled={busy}>
            <Send /> {busy ? "Sending…" : "Send request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
