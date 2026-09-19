"use client";

// Printer — the web copy of Flutter `printerModule` (modules.dart
// ~30981–31556), scoped to what a browser can honestly do (settings.md #41):
// the connection status, the outlet's printers and their health, the
// server-side "What each printer prints" rules, the registered printing
// devices, and a test slip down the real routing path. The device-local half
// (network printer IPs, default spooler printer, print queue, activity log)
// lives on each till/phone and is explained in the connection card.

import { useCallback, useState } from "react";
import type { JSX } from "react";

import { ConnectionCard, DestinationsSection, DevicesSection, TestResultsSheet } from "@/components/printer/printer-parts";
import { RoutingCard } from "@/components/printer/routing-card";
import { SkeletonRows, SkeletonStats } from "@/components/ui/fork-skeleton";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { CacheStalePill } from "@/components/ui/stale-pill";
import { useAuth } from "@/context/AuthContext";
import { isUnreachableError, useCachedFetch } from "@/hooks/use-cached-fetch";
import { useToast } from "@/hooks/use-toast";
import {
  deletePrintDestination,
  fetchPrintingBundle,
  savePrintRoutes,
  sendTestSlip,
  upsertPrintDestination,
  type PrintDestination,
  type PrintingBundle,
  type TestSlipResponse,
} from "@/lib/api/printer";

const messageOf = (e: unknown, fallback: string): string =>
  isUnreachableError(e)
    ? "This device is offline — nothing was changed. Try again when it's back online."
    : e instanceof Error && e.message
      ? e.message
      : fallback;

export default function PrinterPage(): JSX.Element {
  const { user } = useAuth();
  const rid = user?.restaurantUsername ?? "";
  const { toast } = useToast();

  const load = useCachedFetch<PrintingBundle>(
    `printer:bundle:${rid}`,
    useCallback(() => fetchPrintingBundle(rid), [rid]),
    { enabled: rid.length > 0, pollMs: 30_000 },
  );
  const data = load.data;
  const { refresh } = load;

  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestSlipResponse | null>(null);

  const fail = useCallback(
    (e: unknown, fallback: string) =>
      toast({ variant: "destructive", title: fallback, description: messageOf(e, fallback) }),
    [toast],
  );

  const runTest = useCallback(
    async (role?: string) => {
      setTesting(role ?? "*");
      try {
        setTestResult(await sendTestSlip(rid, role));
      } catch (e) {
        fail(e, "Couldn't send a test slip.");
      } finally {
        setTesting(null);
      }
    },
    [rid, fail],
  );

  const saveRoutes = useCallback(
    async (next: { role: string; destination_id: string }[]) => {
      try {
        await savePrintRoutes(rid, next);
        toast({ title: "Printing rules saved." });
      } catch (e) {
        fail(e, "Couldn't save the printing rules.");
      } finally {
        refresh();
      }
    },
    [rid, toast, fail, refresh],
  );

  const saveDestination = useCallback(
    async (input: { id?: string; name: string; active?: boolean }) => {
      try {
        await upsertPrintDestination(rid, input);
        toast({ title: input.id ? `${input.name} updated.` : `${input.name} added.` });
        refresh();
      } catch (e) {
        fail(e, "Couldn't save this printer.");
        throw e;
      }
    },
    [rid, toast, fail, refresh],
  );

  const removeDestination = useCallback(
    async (d: PrintDestination) => {
      try {
        await deletePrintDestination(rid, d.id);
        toast({ title: `${d.name} removed.` });
        refresh();
      } catch (e) {
        fail(e, "Couldn't remove this printer.");
        throw e;
      }
    },
    [rid, toast, fail, refresh],
  );

  if (load.loading || (!data && !load.error)) {
    return (
      <div className="flex flex-col gap-6">
        <SkeletonStats tiles={1} />
        <SkeletonRows rows={4} title />
        <SkeletonRows rows={3} title />
      </div>
    );
  }
  if (!data) {
    return <LoadErrorState whatFailed="Couldn't load printing." error={load.error} onRetry={load.retry} />;
  }

  return (
    <div className="relative flex flex-col gap-6">
      <ConnectionCard
        devices={data.devices}
        presence={data.presence}
        health={data.health}
        testing={testing != null}
        onTestAll={() => void runTest()}
      />
      {!data.routingEnabled ? (
        <p className="text-sm text-muted-foreground">
          Printing rules aren&apos;t available on this server yet — every device prints every job.
        </p>
      ) : (
        <>
          <DestinationsSection
            destinations={data.destinations}
            health={data.health}
            stations={data.stations}
            onSave={saveDestination}
            onDelete={removeDestination}
          />
          <RoutingCard
            routes={data.routes}
            destinations={data.destinations}
            stations={data.stations}
            onSave={saveRoutes}
            onTest={(role) => void runTest(role)}
            testingRole={testing}
          />
        </>
      )}
      <DevicesSection devices={data.devices} />
      <TestResultsSheet
        result={testResult}
        stations={data.stations}
        onClose={() => { setTestResult(null); }}
      />
      <CacheStalePill offline={load.offline} fromCache={load.fromCache} updatedAt={load.updatedAt} />
    </div>
  );
}
