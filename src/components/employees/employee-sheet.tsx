"use client";

// `_employeeSheet` (modules.dart ~29830): the per-member mini overview —
// username, roles, PERFORMANCE (score + the four measures with their notes
// and server weights) and LEAVE (rows with inline decisions), plus
// "Request leave" when it can never 403 (self, or a Review Attendance holder).

import * as React from "react";
import { CalendarX2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DrillSheet } from "@/components/ui/drill-sheet";
import { StatusChip } from "@/components/ui/status-chip";
import type { Row } from "@/lib/api/employees";
import { LeaveRow, type DecideFn } from "./leave";
import { PERF_COMPONENTS, PerfComponentRow, componentOf, perfScoreStatus, perfWeight, type TeamMember } from "./performance";
import { Kv, intOrNull, numOrNull, str } from "./shared";

export function EmployeeSheet({
  member,
  perfMeta,
  perfNote,
  leaveNote,
  canReview,
  selfId,
  onDecide,
  onOpenLeave,
  onRequestLeave,
  onOpenChange,
}: {
  member: TeamMember;
  perfMeta: Row;
  perfNote: string;
  leaveNote: string;
  canReview: boolean;
  selfId: string;
  onDecide: DecideFn;
  onOpenLeave: (l: Row) => void;
  onRequestLeave: (m: TeamMember) => void;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const perfRow = member.perfRow;
  const score = numOrNull(perfRow?.score);
  const windowDays = intOrNull(perfMeta.window_days);
  const measured = intOrNull(perfRow?.components_available) ?? 0;
  return (
    <DrillSheet open onOpenChange={onOpenChange} eyebrow="Employees" title={member.display}>
      <Kv k="Username">@{member.user.employee_Username}</Kv>
      <Kv k="Roles">{member.roleLabels.length === 0 ? "—" : member.roleLabels.join(", ")}</Kv>

      <div className="micro-label mt-4">Performance</div>
      {perfRow == null ? (
        <p className="mt-1.5 text-xs text-tertiary">
          {perfNote || "No performance figures were returned for this person."}
        </p>
      ) : (
        <>
          <div className="mt-2 flex items-center gap-2.5">
            {score == null ? (
              <StatusChip status="neutral" label="Not enough data" />
            ) : (
              <StatusChip status={perfScoreStatus(score)} label={`${Math.round(score)} / 100`} />
            )}
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">
              {score == null
                ? "Not one of the four measures below could be taken, so there is no score — this is not a score of zero."
                : `Built from ${measured} of ${PERF_COMPONENTS.length} measures${windowDays == null ? "" : ` over the last ${windowDays} days`}.`}
            </p>
          </div>
          <div className="mt-1 divide-y divide-divider">
            {PERF_COMPONENTS.map(([key, label]) => (
              <PerfComponentRow
                key={key}
                label={label}
                c={componentOf(member, key)}
                weight={perfWeight(perfRow.effective_weights, key)}
              />
            ))}
          </div>
        </>
      )}

      <div className="micro-label mt-4">Leave</div>
      {leaveNote ? (
        <p className="mt-1.5 text-xs text-tertiary">{leaveNote}</p>
      ) : member.leaves.length === 0 ? (
        <p className="mt-1.5 text-xs text-muted-foreground">No leave on record in this window.</p>
      ) : (
        <div className="mt-1 divide-y divide-divider">
          {member.leaves.map((l, i) => (
            <LeaveRow key={str(l, "id", String(i))} leave={l} canReview={canReview} onDecide={onDecide} onOpen={onOpenLeave} />
          ))}
        </div>
      )}
      {member.empId && (canReview || member.empId === selfId) && (
        <Button variant="outline" size="sm" className="mt-3" onClick={() => { onRequestLeave(member); }}>
          <CalendarX2 /> Request leave
        </Button>
      )}
    </DrillSheet>
  );
}
