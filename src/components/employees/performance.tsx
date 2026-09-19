"use client";

// Staff performance — the web copy of Flutter `_perfComponentRow`,
// `_scoringBand` and `_metricBoard` (modules.dart ~29346–30240).
//
// "Not enough data" is sacred: a component counts only when the server says
// `available: true` AND sends a score; a missing score, value or weight is
// never printed as 0, and excluded people are listed BELOW the ranking,
// never sorted to its bottom. One `memberScore` helper feeds the roster, the
// band and the boards so they can never disagree.

import * as React from "react";

import { StatCard } from "@/components/ui/stat-card";
import { StatusChip, type StatusChipStatus } from "@/components/ui/status-chip";
import { SectionHeader } from "@/components/ui/section-header";
import { ForkCard } from "@/components/ui/fork-card";
import { DrillSheet } from "@/components/ui/drill-sheet";
import { Donut, HBarRow, WeekdayBars } from "@/components/ui/fork-charts";
import { scoreOf } from "@/components/overview/overview-utils";
import type { Row } from "@/lib/api/employees";
import type { User } from "@/lib/db";
import { intOrNull, numOrNull, str } from "./shared";

/** The four measures, in the server's order (`_perfComponents`). */
export const PERF_COMPONENTS: readonly (readonly [string, string])[] = [
  ["apc", "Average per cover"],
  ["rating", "Guest rating"],
  ["attendance", "Attendance"],
  ["tat", "Table turnaround"],
];

/** Overall first, then the four (`_scoringBoxes`). */
export const SCORING_BOXES: readonly (readonly [string, string])[] = [["", "Overall score"], ...PERF_COMPONENTS];

export interface TeamMember {
  user: User;
  empId: string;
  display: string;
  initials: string;
  roleLabels: string[];
  isSuper: boolean;
  perfRow: Row | null;
  leaves: Row[];
}

const asRow = (v: unknown): Row | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Row) : null);

export const componentOf = (m: TeamMember, key: string): Row | null => asRow(asRow(m.perfRow?.components)?.[key]);

/** `_perfScoreColor` bands: ≥80 success, ≥60 info, ≥40 warning, else danger. */
export const perfScoreStatus = (score: number): StatusChipStatus =>
  score >= 80 ? "success" : score >= 60 ? "info" : score >= 40 ? "warning" : "danger";

export const perfMeasured = (c: Row | null): boolean => c?.available === true && numOrNull(c.score) != null;

/** Null-safe `effective_weights` read — absent on older backends, never 0%. */
export const perfWeight = (weights: unknown, key: string): number | null => numOrNull(asRow(weights)?.[key]);

export function memberScore(m: TeamMember, key: string): number | null {
  if (key === "") { return numOrNull(m.perfRow?.score); }
  const c = componentOf(m, key);
  return perfMeasured(c) ? numOrNull(c?.score) : null;
}

const memberValue = (m: TeamMember, key: string): unknown => (key === "" ? m.perfRow?.score : componentOf(m, key)?.value);

export function perfValueLabel(key: string, value: unknown, money: (v: unknown) => string): string {
  if (value == null || value === "") { return "—"; }
  switch (key) {
    case "apc":
      return money(value);
    case "rating":
      return `${scoreOf(value)} ★`;
    case "attendance":
      return `${scoreOf(value)}%`;
    case "tat":
      return `${scoreOf(value)} min`;
    default:
      return `${scoreOf(value)} / 100`;
  }
}

export function perfBenchmarkLine(key: string, benchmarks: Row, money: (v: unknown) => string): string {
  const apc = benchmarks.apc;
  const tat = benchmarks.tat_minutes;
  switch (key) {
    case "apc":
      return apc == null ? "no house average to compare against" : `house ${money(apc)} per cover`;
    case "rating":
      return "absolute 1–5 star scale";
    case "attendance":
      return "presence first, then punctuality";
    case "tat":
      return tat == null ? "no house median to compare against" : `house median ${scoreOf(tat)} min`;
    default:
      return "weighted over the measures each person had";
  }
}

function perfBasisLine(key: string): string {
  switch (key) {
    case "apc":
      return "Pre-tax spend per cover, scored against the house average";
    case "rating":
      return "Average guest rating, on an absolute 1–5 star scale";
    case "attendance":
      return "Presence on open days, then punctuality once there is a baseline";
    case "tat":
      return "Median seated-to-released time against the house median — faster scores higher";
    default:
      return "The weighted composite of every measure that could be taken for each person";
  }
}

function memberGapReason(m: TeamMember, key: string, perfNote: string): string {
  if (m.perfRow == null) {
    return perfNote || "No performance row was returned for them in this window.";
  }
  if (key === "") {
    return `Not one of the ${PERF_COMPONENTS.length} measures could be taken for them, so there is no score — this is not a score of zero.`;
  }
  const note = str(componentOf(m, key), "note");
  return note || "Nothing measurable on this in the window.";
}

/** The roster card's score chip (or neutral "Not enough data"). */
export function ScoreChip({ score, suffix = "" }: { score: number | null; suffix?: string }): React.JSX.Element {
  return score == null ? (
    <StatusChip status="neutral" label="Not enough data" dense />
  ) : (
    <StatusChip status={perfScoreStatus(score)} label={`${Math.round(score)} / 100${suffix}`} dense />
  );
}

/** `_perfComponentRow`: chip, raw value + sample, server note, weight line. */
export function PerfComponentRow({
  label,
  c,
  weight,
}: {
  label: string;
  c: Row | null;
  weight: number | null;
}): React.JSX.Element {
  const measured = perfMeasured(c);
  const note = str(c, "note");
  const unit = str(c, "unit");
  const sample = intOrNull(c?.sample) ?? 0;
  const value = c?.value;
  const pct = weight == null ? null : Math.round(weight * 100);
  const score = measured ? numOrNull(c?.score) : null;
  return (
    <div className="py-[7px]">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 text-sm font-semibold text-foreground">{label}</div>
        <ScoreChip score={score} />
      </div>
      {measured && value != null && (
        <p className="mt-[3px] text-xs text-muted-foreground">
          {scoreOf(value)}
          {unit ? ` ${unit}` : ""}
          {sample > 0 ? ` · from ${sample} observation${sample === 1 ? "" : "s"}` : ""}
        </p>
      )}
      {note && <p className="mt-[3px] text-xs text-tertiary">{note}</p>}
      <p className="mt-[3px] text-[10.5px] text-tertiary">
        {!measured
          ? "Left out of the score — the measures that could be taken were reweighted between them to still make 100%."
          : pct == null
            ? "It counted towards this score, but the server did not say by how much."
            : `Counts for ${pct}% of this score.`}
      </p>
    </div>
  );
}

/** `_scoringBand`: five box-level drill-downs. Omitted when perf failed. */
export function ScoringBand({
  team,
  perf,
  money,
  onOpenBoard,
}: {
  team: TeamMember[];
  perf: Row;
  money: (v: unknown) => string;
  onOpenBoard: (key: string, title: string) => void;
}): React.JSX.Element | null {
  if (team.length === 0) { return null; }
  const benchmarks = asRow(perf.benchmarks) ?? {};
  return (
    <section>
      <SectionHeader title="Scoring" />
      <div className="grid grid-cols-1 gap-3 min-[620px]:grid-cols-2 min-[900px]:grid-cols-3 min-[1180px]:grid-cols-4 min-[1500px]:grid-cols-5">
        {SCORING_BOXES.map(([key, label]) => {
          const measured = team
            .filter((m) => memberScore(m, key) != null)
            .sort((a, b) => (memberScore(b, key) ?? 0) - (memberScore(a, key) ?? 0));
          const avg = measured.length === 0
            ? null
            : measured.reduce((s, m) => s + (memberScore(m, key) ?? 0), 0) / measured.length;
          const shown = measured.slice(0, 7);
          let chart: React.ReactNode = null;
          if (avg != null) {
            chart = key === "" || key === "attendance" ? (
              <div className="flex h-14 items-center">
                <Donut
                  fraction={Math.min(1, Math.max(0, avg / 100))}
                  size={46}
                  tooltip={`${Math.round(avg)} / 100 averaged over ${measured.length} of ${team.length} — best ${Math.round(memberScore(measured[0], key) ?? 0)}`}
                />
              </div>
            ) : (
              <WeekdayBars
                values={shown.map((m) => memberScore(m, key) ?? 0)}
                labels={shown.map((m) => m.initials)}
                tooltip={(i) =>
                  `${shown[i].display} — ${perfValueLabel(key, memberValue(shown[i], key), money)} · score ${Math.round(memberScore(shown[i], key) ?? 0)} / 100`
                }
              />
            );
          }
          return (
            <StatCard
              key={key || "overall"}
              value={avg == null ? "—" : String(Math.round(avg))}
              unit={avg == null ? undefined : "/ 100"}
              caption={`${label} — team average`}
              chart={chart}
              footer={
                <span className="line-clamp-2 text-[10.5px] leading-[1.3] text-tertiary">
                  {avg == null
                    ? "not measurable for anyone in this window"
                    : `${perfBenchmarkLine(key, benchmarks, money)} · ${measured.length} of ${team.length} measured`}
                </span>
              }
              onClick={() => { onOpenBoard(key, label); }}
            />
          );
        })}
      </div>
    </section>
  );
}

/** `_metricBoard`: Ranked (score/100 bars, never re-based) + Not enough data. */
export function MetricBoard({
  metricKey,
  title,
  team,
  perf,
  perfNote,
  money,
  onOpenMember,
  onOpenChange,
}: {
  metricKey: string;
  title: string;
  team: TeamMember[];
  perf: Row;
  perfNote: string;
  money: (v: unknown) => string;
  onOpenMember: (m: TeamMember) => void;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const windowDays = intOrNull(perf.window_days);
  const ranked = team
    .filter((m) => memberScore(m, metricKey) != null)
    .sort((a, b) => {
      const d = (memberScore(b, metricKey) ?? 0) - (memberScore(a, metricKey) ?? 0);
      return d !== 0 ? d : a.display.localeCompare(b.display);
    });
  const excluded = team.filter((m) => memberScore(m, metricKey) == null);
  return (
    <DrillSheet open onOpenChange={onOpenChange} eyebrow="Scoring" title={title}>
      <p className="text-xs text-muted-foreground">
        {perfBasisLine(metricKey)}
        {windowDays == null ? "" : `, over the last ${windowDays} days`}.{" "}
        {perfBenchmarkLine(metricKey, asRow(perf.benchmarks) ?? {}, money)}.
      </p>
      <SectionHeader title="Ranked" count={ranked.length} className="mt-4" />
      {ranked.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nobody could be measured on this in the window.</p>
      ) : (
        <div className="grid gap-1">
          {ranked.map((m, i) => {
            const s = memberScore(m, metricKey) ?? 0;
            const own = perfValueLabel(metricKey, memberValue(m, metricKey), money);
            return (
              <HBarRow
                key={m.empId || m.display}
                label={`${i + 1}. ${m.display}`}
                fraction={Math.min(1, Math.max(0, s / 100))}
                value={own}
                sub={`score ${Math.round(s)}`}
                tooltip={`${m.display} — ${own} · score ${Math.round(s)} / 100`}
                onSelect={() => { onOpenMember(m); }}
              />
            );
          })}
        </div>
      )}
      {excluded.length > 0 && (
        <>
          <SectionHeader title="Not enough data" count={excluded.length} className="mt-4" />
          <div className="grid gap-2">
            {excluded.map((m) => (
              <ForkCard key={m.empId || m.display} inset className="px-3.5 py-2.5" onClick={() => { onOpenMember(m); }}>
                <div className="flex flex-wrap items-center gap-2 pr-4">
                  <span className="truncate text-sm font-semibold">{m.display}</span>
                  <StatusChip status="neutral" label="Not enough data" dense />
                </div>
                <p className="mt-1 text-xs text-tertiary">{memberGapReason(m, metricKey, perfNote)}</p>
              </ForkCard>
            ))}
          </div>
        </>
      )}
    </DrillSheet>
  );
}
