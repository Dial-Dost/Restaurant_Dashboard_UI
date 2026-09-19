"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StaffPunctuality } from "@/lib/api/attendance";
import { initialsOf } from "./format";

/** Flutter `_kv`: 148px uppercase micro-label + value. */
export function Kv({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex gap-3 border-b border-divider py-2 last:border-b-0">
      <div className="micro-label w-[148px] shrink-0 pt-0.5">{label}</div>
      <div className="min-w-0 flex-1 text-sm tabular-nums text-foreground">{value}</div>
    </div>
  );
}

/** Flutter `InitialsAvatar`, optionally warning-tinted (pending rows). */
export function Avatar({ name, warning }: { name: string; warning?: boolean }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border-[1.2px] bg-inset text-xs font-semibold uppercase tracking-[0.5px]",
        warning ? "border-warning/40 text-warning" : "border-[hsl(var(--primary)/0.35)] text-accent-foreground",
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Flutter `_sheetRecordRow`: name, sub line, copper trailing figure, tappable. */
export function SheetRecordRow({
  title, sub, trailing, onClick,
}: { title: string; sub: string; trailing: string; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b border-divider px-1 py-2.5 text-left transition-colors duration-fast last:border-b-0 hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{sub}</div>
      </div>
      {trailing && <span className="shrink-0 text-sm font-semibold tabular-nums text-accent-foreground">{trailing}</span>}
      <ChevronRight className="h-4 w-4 shrink-0 text-tertiary" />
    </button>
  );
}

export type PunctualityState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "done"; byEmp: Partial<Record<string, StaffPunctuality>> };

/** Flutter `_punctualityBlock` — all verdicts are the server's. */
export function PunctualityBlock({
  empId, allowed, state, ensure, baselineOnly,
}: {
  empId: string;
  allowed: boolean;
  state: PunctualityState;
  ensure: () => void;
  baselineOnly?: boolean;
}): React.JSX.Element | null {
  React.useEffect(() => {
    if (allowed && empId) { ensure(); }
  }, [allowed, empId, ensure]);

  const small = "text-xs text-muted-foreground";
  if (!empId) { return null; }
  if (!allowed) {
    return <p className={small}>Punctuality needs the analytics permission, which this login does not hold.</p>;
  }
  if (state.status === "error") {
    return <p className={small}>Punctuality couldn&apos;t be loaded: {state.error}</p>;
  }
  if (state.status !== "done") {
    return <p className={small}>Reading punctuality…</p>;
  }
  const r = state.byEmp[empId];
  const typical = r?.typical_start ?? "";
  const hasBaseline = typical !== "" && typical !== "—";
  if (baselineOnly) {
    return (
      <p className={small}>
        {hasBaseline
          ? `This person usually starts around ${typical} — the median first clock-in over the last 30 days, in restaurant time.`
          : "No usual start time yet: too few worked days in the last 30 to set a baseline, so this clock-in cannot be called early or late."}
      </p>
    );
  }
  if (!r) {
    return <p className={small}>No punctuality record in the last 30 days.</p>;
  }
  const n = (v: unknown): number => Math.trunc(Number(v) || 0);
  const late = n(r.late_shifts);
  const latePct = r.late_pct == null ? "" : ` · ${Number(r.late_pct).toFixed(0)}% of shifts`;
  return (
    <div>
      <Kv label="Usual start" value={hasBaseline ? typical : "No baseline yet"} />
      <Kv label="Late starts" value={hasBaseline ? `${late}${latePct}` : "—"} />
      <Kv label="Days present" value={n(r.days_present)} />
      <Kv label="Excused by leave" value={n(r.leave_days)} />
      <Kv label="Absent, unexplained" value={n(r.absent_days)} />
      <p className={cn(small, "mt-2.5")}>
        Late is measured against this person&apos;s own usual start, not a rota — there is no scheduled start
        time in the system to compare against. Approved leave is already taken out of the absent count.
      </p>
    </div>
  );
}
