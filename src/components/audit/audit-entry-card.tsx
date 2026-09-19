"use client";

import { Ban, History, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ForkCard } from "@/components/ui/fork-card";
import { InfoChip, StatusChip } from "@/components/ui/status-chip";
import { TickTag } from "@/components/ui/tick-tag";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { utcToWallClockInZone } from "@/lib/tz";
import type { AuditLog } from "@/lib/api/audit-logs";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** RestaurantTime.short — "Jun 26, 14:05" in the restaurant's zone. */
export function shortStamp(iso: string, timeZone: string): string {
  const wall = utcToWallClockInZone(iso, timeZone);
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wall);
  if (!m) { return ""; }
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[4]}:${m[5]}`;
}

/** Empty or the server's "—" placeholder both mean "nothing to show". */
export const hasText = (s: string | null | undefined): s is string =>
  s != null && s.trim() !== "" && s.trim() !== "—";

interface Props {
  log: AuditLog;
  timeZone: string;
  mayUndo: boolean;
  onUndo: (log: AuditLog) => void;
}

/** One trail entry — the app's `_AuditLogView` ForkCard row. */
export function AuditEntryCard({ log, timeZone, mayUndo, onUndo }: Props): React.JSX.Element {
  const isUndo = hasText(log.undo_of);
  const actionable = mayUndo && !log.undone && !isUndo;
  const reason = log.undo_block_reason ?? "";
  const shortReason = reason.length > 30 ? `${reason.substring(0, 29)}…` : reason;

  return (
    <ForkCard className="px-3.5 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[7px] border border-border bg-inset">
          <History className="h-3.5 w-3.5 text-accent-base" />
        </div>
        <div className="min-w-[10rem] flex-1">
          <div className="truncate text-sm font-medium">{log.action}</div>
          {hasText(log.details) && (
            <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{log.details}</div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {log.undone && <StatusChip label="Undone" status="neutral" dense />}
          {isUndo && <TickTag label="Undo" color="hsl(var(--info))" />}
          {hasText(log.employee) && <InfoChip icon={<User />} label={log.employee} />}
          <span className="whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.4px] text-muted-foreground tabular-nums">
            {shortStamp(log.timestamp, timeZone)}
          </span>
          {actionable && log.undoable && (
            <Button variant="outline" size="sm" onClick={() => { onUndo(log); }}>
              Undo
            </Button>
          )}
          {actionable && !log.undoable && hasText(reason) && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <InfoChip icon={<Ban />} label={shortReason} />
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{reason}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
    </ForkCard>
  );
}
