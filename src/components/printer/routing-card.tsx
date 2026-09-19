"use client";

// "What each printer prints" — the web copy of Flutter `_PrinterRoutingCard`
// (modules.dart ~31409–31552). The app's rules are per device; the web edits
// the SERVER's rules (PUT /print/routes, a whole-set replace), which pick the
// device that prints each job. Save-on-pick with optimistic move + revert.

import { useState } from "react";
import type { JSX } from "react";
import { Info, Loader2, Printer, ReceiptText, Soup } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ForkCard } from "@/components/ui/fork-card";
import { SectionHeader } from "@/components/ui/section-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ROLE_ANY_KOT,
  ROLE_BILL,
  roleLabel,
  stationRole,
  type PrintDestination,
  type PrintRoute,
} from "@/lib/api/printer";

const DEFAULT = "__default__";

export interface RoutingCardProps {
  routes: PrintRoute[];
  destinations: PrintDestination[];
  stations: string[];
  /** Persist the whole rule set; throws the server's sentence on refusal. */
  onSave: (next: { role: string; destination_id: string }[]) => Promise<void>;
  onTest: (role: string) => void;
  testingRole: string | null;
}

export function RoutingCard({ routes, destinations, stations, onSave, onTest, testingRole }: RoutingCardProps): JSX.Element {
  // Optimistic overlay: role -> destination id ("" = Default), cleared once saved.
  const [pending, setPending] = useState<Record<string, string> | null>(null);
  const [saving, setSaving] = useState(false);

  const base: Record<string, string> = {};
  for (const r of routes) {base[r.role] = r.destination_id;}
  const current = pending ?? base;

  // Every role worth a rule: bills, any KOT, the menu's stations, then any
  // station a rule already names (so a rule is never hidden).
  const roles: string[] = [ROLE_BILL, ROLE_ANY_KOT];
  for (const s of stations) {
    const r = stationRole(s);
    if (!roles.includes(r)) {roles.push(r);}
  }
  for (const r of routes) {if (!roles.includes(r.role)) {roles.push(r.role);}}

  const active = destinations.filter((d) => d.active);
  const knows = (id: string | undefined): boolean => !!id && active.some((d) => d.id === id);

  const pick = async (role: string, value: string): Promise<void> => {
    const next = Object.fromEntries(Object.entries(current).filter(([r]) => r !== role));
    if (value !== DEFAULT) {
      next[role] = value;
    }
    setPending(next);
    setSaving(true);
    try {
      await onSave(Object.entries(next).map(([r, id]) => ({ role: r, destination_id: id })));
    } finally {
      setPending(null);
      setSaving(false);
    }
  };

  return (
    <section>
      <SectionHeader
        title="What each printer prints"
        count={routes.length}
        className="mb-1.5"
        trailing={saving ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Saving" /> : null}
      />
      <p className="mb-3 text-xs text-muted-foreground">
        Send bills to the till printer and each kitchen station to its own. One printer can take several jobs —
        leave everything on Default if a single printer does it all.
      </p>
      <ForkCard>
        <div className="flex flex-col divide-y divide-divider">
          {roles.map((role) => {
            const chosen = current[role];
            return (
              <div key={role} className="flex items-center gap-3 py-1.5">
                {role === ROLE_BILL ? (
                  <ReceiptText className="size-[15px] shrink-0 text-muted-foreground" aria-hidden />
                ) : (
                  <Soup className="size-[15px] shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{roleLabel(role, stations)}</span>
                <div className="w-[150px] shrink-0 min-[760px]:w-[190px]">
                  <Select
                    value={knows(chosen) ? chosen : DEFAULT}
                    onValueChange={(v) => void pick(role, v)}
                    disabled={saving}
                  >
                    <SelectTrigger className="h-8" aria-label={`Printer for ${roleLabel(role, stations)}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={DEFAULT}>Default</SelectItem>
                      {active.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  title="Print a test slip"
                  aria-label={`Print a test slip for ${roleLabel(role, stations)}`}
                  disabled={testingRole != null}
                  onClick={() => { onTest(role); }}
                >
                  {testingRole === role ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
                </Button>
              </div>
            );
          })}
        </div>
        {roles.length <= 2 && (
          <p className="pt-2 text-xs text-muted-foreground">
            No kitchen stations configured yet. Assign stations to dishes in Menu and they appear here.
          </p>
        )}
        {active.length === 0 && (
          <p className="pt-2 text-xs text-muted-foreground">
            No printers added yet — add one under Printers below, then pick it here.
          </p>
        )}
        <div className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            Anything without a rule — or whose printer is switched off or uninstalled — prints on the default printer
            instead of being dropped.
          </span>
        </div>
      </ForkCard>
    </section>
  );
}
