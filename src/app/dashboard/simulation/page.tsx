"use client";

// What-if simulator — the web copy of Flutter `lib/screens/simulation.dart`.
//
// Levers card (editable picker over the 34-parameter catalogue in
// src/lib/simulation-params.ts) beside the Current Performance card (flex
// 3 : 2 at >= 760px), then the Projected impact section. Only ACTIVE levers
// are POSTed; an omitted field resolves server-side to this tenant's neutral
// value, so a removed lever contributes its default and keeps its value here.
//
// NO date-range control, deliberately: GET /simulation/baseline takes no
// window (it is fixed at the backend's SIM_WINDOW_DAYS), so the window is
// STATED on the Current Performance card instead.

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { Loader2, Play, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ForkCard } from "@/components/ui/fork-card";
import { SkeletonBox, SkeletonRows } from "@/components/ui/fork-skeleton";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { SectionHeader } from "@/components/ui/section-header";
import { CacheStalePill } from "@/components/ui/stale-pill";
import { useAuth } from "@/context/AuthContext";
import { isUnreachableError, useCachedFetch } from "@/hooks/use-cached-fetch";
import { useCurrency } from "@/hooks/use-currency";
import {
  fetchSimulationBaseline,
  runSimulation,
  type SimulationBaseline,
  type SimulationResult,
} from "@/lib/api/simulation";
import {
  INITIAL_ACTIVE_KEYS,
  PLAN_TIERS,
  allowsSecondOutlet,
  buildRunBody,
  changedCount,
  effectivePlanTier,
  groupedParams,
  isChanged,
  resolveDefaults,
  toggleValue,
  type ParamValue,
  type ParamValues,
  type RunBody,
} from "@/lib/simulation-params";
import { CurrentCard } from "@/components/simulation/current-card";
import { LeverPicker } from "@/components/simulation/lever-picker";
import { LeverRow } from "@/components/simulation/lever-row";
import { ResultsSection } from "@/components/simulation/results-section";
import { simMoneyWith } from "@/components/simulation/sim-format";

/** POST /simulation/run saves nothing, so an offline run lost nothing. */
const OFFLINE_MESSAGE =
  "The simulator needs a connection. This projection is calculated on the " +
  "server and saves nothing, so no work was lost — reconnect and run it again. " +
  "Your levers are still exactly where you left them.";

const errorText = (e: unknown): string =>
  e instanceof Error && e.message ? e.message : "The simulation could not run.";

export default function SimulationPage(): JSX.Element {
  const { user } = useAuth();
  const { currencySymbol } = useCurrency();
  const rid = user?.restaurantUsername ?? "";
  const money = useMemo(() => simMoneyWith(currencySymbol), [currencySymbol]);

  const fetcher = useCallback(() => fetchSimulationBaseline(rid), [rid]);
  const { data: baseline, loading, error, offline, fromCache, updatedAt, retry, refresh } =
    useCachedFetch<SimulationBaseline>(`simulation:baseline:${rid}`, fetcher, { enabled: rid !== "" });

  const defaults = useMemo(() => resolveDefaults(baseline as Record<string, unknown> | null), [baseline]);
  const [values, setValues] = useState<ParamValues>(() => resolveDefaults(null));
  const [active, setActive] = useState<Set<string>>(() => new Set(INITIAL_ACTIVE_KEYS));
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [ranWith, setRanWith] = useState<RunBody | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // Re-seed every lever from a NEW baseline (fresh numbers, fresh defaults);
  // the active selection is preserved and the stale result cleared.
  const seededFrom = useRef<string | null>(null);
  useEffect(() => {
    if (!baseline) {return;}
    const sig = JSON.stringify(baseline);
    if (sig === seededFrom.current) {return;}
    const first = seededFrom.current == null;
    seededFrom.current = sig;
    setValues(resolveDefaults(baseline as unknown as Record<string, unknown>));
    if (!first) {
      setResult(null);
      setRanWith(null);
      setRunError(null);
    }
  }, [baseline]);

  const reloadBaseline = (): void => {
    setValues({ ...defaults });
    setResult(null);
    setRanWith(null);
    setRunError(null);
    refresh();
  };

  const toggleLever = (key: string): void => {
    setActive((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) {next.add(key);}
      return next;
    });
  };
  const removeLever = (key: string): void => {
    setActive((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };
  const setValue = (key: string, v: ParamValue): void => { setValues((prev) => ({ ...prev, [key]: v })); };
  const resetLever = (key: string): void => {
    setValue(key, defaults[key]);
  };
  /** Resets EVERY parameter, active or not; the active selection is untouched. */
  const resetAll = (): void => {
    setValues({ ...defaults });
    setResult(null);
    setRanWith(null);
  };

  const run = async (): Promise<void> => {
    if (!rid) {return;}
    const body = buildRunBody(active, values);
    setRunning(true);
    setRunError(null);
    try {
      const res = await runSimulation(rid, body);
      setResult(res);
      setRanWith(body);
    } catch (e) {
      setRunError(isUnreachableError(e) ? OFFLINE_MESSAGE : errorText(e));
    } finally {
      setRunning(false);
    }
  };

  /** The second-outlet plan gate sentence, or null when the plan allows it. */
  const secondOutletGate = (): string | null => {
    if (allowsSecondOutlet(active, values)) {return null;}
    const tier = PLAN_TIERS[effectivePlanTier(active, values)].label;
    const how = active.has("plan_tier")
      ? 'Switch the "Subscription plan" lever to Enterprise to model it.'
      : 'Add the "Subscription plan" lever and choose Enterprise to model it.';
    return toggleValue(values, "second_outlet")
      ? `Switched on, but the ${tier} plan does not include multi-outlet — the run will simulate a single outlet and say so. ${how}`
      : `Multi-outlet is an Enterprise-plan capability. ${how}`;
  };

  if (loading && !baseline) {
    return (
      <div className="grid gap-4 min-[760px]:grid-cols-5">
        <ForkCard className="min-[760px]:col-span-3"><SkeletonRows rows={8} title /></ForkCard>
        <ForkCard className="min-[760px]:col-span-2"><SkeletonBox height={320} /></ForkCard>
      </div>
    );
  }
  if (!baseline) {
    return (
      <ForkCard>
        <LoadErrorState whatFailed="Couldn't load the live baseline." error={error} onRetry={retry} />
      </ForkCard>
    );
  }

  const groups = groupedParams("", (spec) => active.has(spec.key));
  const changed = changedCount(values, defaults);

  return (
    <div className="relative grid gap-4">
      <div className="grid items-start gap-4 min-[760px]:grid-cols-5">
        {/* ------------------------------------------------ What-If Simulator */}
        <ForkCard className="min-[760px]:col-span-3">
          <SectionHeader className="mb-1" title="What-If Simulator" />
          <p className="text-xs text-muted-foreground">
            Pick the levers you want to test, adjust them, then run. Anything you remove keeps its value and goes back
            to contributing your own default. Nothing here writes to the live data.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <LeverPicker active={active} onToggle={toggleLever} />
            <Button variant="ghost" size="sm" disabled={changed === 0} onClick={resetAll}>
              <RotateCcw className="mr-1.5 h-4 w-4" />
              {changed > 0 ? `Reset values (${changed})` : "Reset values"}
            </Button>
          </div>

          <div className="mt-3">
            {groups.length === 0 ? (
              <ForkCard inset>
                <p className="text-xs text-muted-foreground">
                  Nothing active. Use &lsquo;+ Add a lever&rsquo; to pick what you want to test.
                </p>
              </ForkCard>
            ) : (
              groups.map((g) => (
                <div key={g.group}>
                  <div className="micro-label pb-1.5 pt-2 text-muted-foreground">{g.group}</div>
                  {g.specs.map((spec) => (
                    <LeverRow
                      key={spec.key}
                      spec={spec}
                      values={values}
                      defaults={defaults}
                      changed={isChanged(values, defaults, spec.key)}
                      gate={spec.key === "second_outlet" ? secondOutletGate() : null}
                      money={money}
                      onChange={setValue}
                      onReset={resetLever}
                      onRemove={removeLever}
                    />
                  ))}
                </div>
              ))
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button onClick={() => { void run(); }} disabled={running}>
              <Play className="mr-1.5 h-4 w-4" />
              Run Simulation
            </Button>
            {running && <Loader2 aria-label="Running" className="h-4 w-4 animate-spin text-accent-hi" />}
            <span className="text-xs text-muted-foreground">
              {active.size === 0
                ? "No levers active — this runs your baseline unchanged."
                : `${active.size} lever${active.size === 1 ? "" : "s"} in this run.`}
            </span>
          </div>
        </ForkCard>

        {/* --------------------------------------------- Current Performance */}
        <div className="min-[760px]:col-span-2">
          <CurrentCard baseline={baseline} money={money} currencySymbol={currencySymbol} onReload={reloadBaseline} />
        </div>
      </div>

      <ResultsSection
        result={result}
        ranWith={ranWith}
        runError={runError}
        running={running}
        money={money}
        onRetry={() => { void run(); }}
      />

      <CacheStalePill offline={offline} fromCache={fromCache} updatedAt={updatedAt} />
    </div>
  );
}
